/**
 * Minimal OMF (Object Module Format) parser voor TASM `.OBK`/`.OBJ` data-modules.
 *
 * Scope: extracteer data-bytes per public-symbol. Geen code-relocaties.
 * Records die we parsen: THEADR(80), LNAMES(96), SEGDEF(98), PUBDEF(90),
 * LEDATA(A0), LIDATA(A2), MODEND(8A). COMENT(88), EXTDEF(8C), FIXUPP(9C) etc. = skip.
 *
 * Spec-referentie: TIS Relocatable Object Module Format Spec v1.1 (1995).
 *
 * Determinisme: pure byte-in -> object-out. Geen RNG, geen tijd.
 */
"use strict";

const REC = Object.freeze({
  THEADR: 0x80,
  COMENT: 0x88,
  MODEND: 0x8A,
  EXTDEF: 0x8C,
  PUBDEF: 0x90,
  LNAMES: 0x96,
  SEGDEF: 0x98,
  FIXUPP: 0x9C,
  LEDATA: 0xA0,
  LIDATA: 0xA2,
});

/**
 * @param {Uint8Array} bytes
 * @returns {{
 *   modulName: string,
 *   names: string[],
 *   segments: {nameIdx: number, length: number, name: string}[],
 *   publics: {segIdx: number, name: string, offset: number}[],
 *   dataBySegment: Map<number, Uint8Array>,  // segIdx -> consolidated data
 * }}
 */
export function parseOMF(bytes) {
  const out = {
    moduleName: "",
    names: [""],         // index 0 = unused (1-based)
    segments: [{nameIdx: 0, length: 0, name: ""}], // index 0 unused
    publics: [],
    dataBySegment: new Map(),
  };

  let i = 0;
  while (i < bytes.length) {
    const type = bytes[i++];
    const len  = bytes[i++] | (bytes[i++] << 8);
    if (i + len > bytes.length) {
      throw new Error("OMF: record-length overflows file at offset " + (i - 3));
    }
    const payload = bytes.subarray(i, i + len - 1);  // exclude checksum byte
    const checksum = bytes[i + len - 1];
    i += len;

    switch (type) {
      case REC.THEADR: {
        // [name-length-byte, name-bytes]
        const nlen = payload[0];
        out.moduleName = utf8Decode(payload.subarray(1, 1 + nlen));
        break;
      }
      case REC.LNAMES: {
        let p = 0;
        while (p < payload.length) {
          const nl = payload[p]; p++;
          out.names.push(utf8Decode(payload.subarray(p, p + nl)));
          p += nl;
        }
        break;
      }
      case REC.SEGDEF: {
        // [attrs-byte, length(2), name-idx, class-idx, overlay-idx]
        const attrs = payload[0];
        let p = 1;
        // If A=0 in attrs, alignment=absolute, frame/offset follow (3 bytes)
        const alignment = (attrs >> 5) & 0x7;
        if (alignment === 0) p += 3;
        const length = payload[p] | (payload[p+1] << 8); p += 2;
        const nameIdx = readIndex(payload, p); p += indexLen(payload[p]);
        // class-idx + overlay-idx (skip)
        out.segments.push({
          nameIdx,
          length,
          name: out.names[nameIdx] || "?",
        });
        break;
      }
      case REC.PUBDEF: {
        // [base-group-idx, base-seg-idx, [base-frame if base-seg==0], publics...]
        let p = 0;
        const groupIdx = readIndex(payload, p); p += indexLen(payload[p]);
        const segIdx   = readIndex(payload, p); p += indexLen(payload[p]);
        if (segIdx === 0) p += 2;  // base-frame
        while (p < payload.length) {
          const nl = payload[p]; p++;
          const name = utf8Decode(payload.subarray(p, p + nl)); p += nl;
          const offset = payload[p] | (payload[p+1] << 8); p += 2;
          const typeIdx = readIndex(payload, p); p += indexLen(payload[p]);
          out.publics.push({ segIdx, name, offset });
        }
        break;
      }
      case REC.LEDATA: {
        // [seg-idx, offset(2), data-bytes]
        let p = 0;
        const segIdx = readIndex(payload, p); p += indexLen(payload[p]);
        const offset = payload[p] | (payload[p+1] << 8); p += 2;
        const data = payload.subarray(p);
        mergeIntoSegment(out, segIdx, offset, data);
        break;
      }
      case REC.LIDATA: {
        // [seg-idx, offset(2), iterated-data-blocks]
        let p = 0;
        const segIdx = readIndex(payload, p); p += indexLen(payload[p]);
        const offset = payload[p] | (payload[p+1] << 8); p += 2;
        const expanded = expandIterated(payload.subarray(p));
        mergeIntoSegment(out, segIdx, offset, expanded);
        break;
      }
      case REC.MODEND:
        // end of module
        return out;
      // skip unimplemented record types
      case REC.COMENT:
      case REC.EXTDEF:
      case REC.FIXUPP:
      default:
        // unknown / not parsed
        break;
    }
  }
  return out;
}

/** Read MS-OMF variable index: 1-byte if <0x80, else 2-byte BE with high-bit clear in MSB. */
function readIndex(buf, off) {
  const b = buf[off];
  if (b & 0x80) return ((b & 0x7F) << 8) | buf[off + 1];
  return b;
}
function indexLen(b) { return (b & 0x80) ? 2 : 1; }

/** Expand LIDATA's nested iterated-data-blocks into a flat byte-array. */
function expandIterated(buf) {
  const out = [];
  let p = 0;
  function readBlock() {
    const repeat = buf[p] | (buf[p+1] << 8); p += 2;
    const blockCount = buf[p] | (buf[p+1] << 8); p += 2;
    const piece = [];
    if (blockCount === 0) {
      const dataLen = buf[p]; p++;
      for (let k = 0; k < dataLen; k++) piece.push(buf[p + k]);
      p += dataLen;
    } else {
      const before = p;
      for (let k = 0; k < blockCount; k++) {
        const sub = readBlock();
        piece.push(...sub);
      }
    }
    const repeated = [];
    for (let r = 0; r < repeat; r++) repeated.push(...piece);
    return repeated;
  }
  while (p < buf.length) out.push(...readBlock());
  return Uint8Array.from(out);
}

function mergeIntoSegment(out, segIdx, offset, data) {
  let seg = out.dataBySegment.get(segIdx);
  const needed = offset + data.length;
  if (!seg || seg.length < needed) {
    const grown = new Uint8Array(needed);
    if (seg) grown.set(seg, 0);
    seg = grown;
  }
  seg.set(data, offset);
  out.dataBySegment.set(segIdx, seg);
}

function utf8Decode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Convenience: extract bytes for a named public symbol. */
export function bytesForPublic(omf, publicName) {
  const pub = omf.publics.find(p => p.name === publicName);
  if (!pub) return null;
  const seg = omf.dataBySegment.get(pub.segIdx);
  if (!seg) return null;
  return seg.subarray(pub.offset);  // from offset to end of segment
}

/** Convenience: extract whole segment by name (e.g. "DATA__CIRCLE"). */
export function bytesForSegment(omf, segName) {
  const segIdx = omf.segments.findIndex(s => s && s.name === segName);
  if (segIdx <= 0) return null;
  return omf.dataBySegment.get(segIdx);
}
