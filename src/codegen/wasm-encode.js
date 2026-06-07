/**
 * Mini WASM-binary encoder. Geen vendor deps.
 * Genoeg om onze subset te emitteren: imports, memory, functions, exports,
 * code-section, data-section.
 *
 * Spec: WebAssembly 1.0 (MVP).
 *
 * Deterministisch: alle iteraties over arrays in vaste volgorde,
 * geen Map/Set met insertion-volgorde-afhankelijk gedrag.
 */
"use strict";

// ----- LEB128 -----

export function uleb128(n) {
  if (n < 0) throw new RangeError("uleb128 requires non-negative");
  const out = [];
  let v = BigInt(n);
  do {
    let byte = Number(v & 0x7Fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return out;
}

export function sleb128(n) {
  const out = [];
  let v = BigInt(n);
  let more = true;
  while (more) {
    let byte = Number(v & 0x7Fn);
    v >>= 7n;
    const signBit = (byte & 0x40) !== 0;
    if ((v === 0n && !signBit) || (v === -1n && signBit)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    out.push(byte);
  }
  return out;
}

// ----- value & block types -----

export const ValType = Object.freeze({
  i32: 0x7F,
  i64: 0x7E,
  f32: 0x7D,
  f64: 0x7C,
});

export const BlockType = Object.freeze({
  void: 0x40,
});

export const ExternalKind = Object.freeze({
  function: 0x00,
  table:    0x01,
  memory:   0x02,
  global:   0x03,
});

// ----- Opcodes (subset) -----

export const Op = Object.freeze({
  unreachable: 0x00,
  nop:         0x01,
  block:       0x02,
  loop:        0x03,
  if:          0x04,
  else:        0x05,
  end:         0x0B,
  br:          0x0C,
  br_if:       0x0D,
  br_table:    0x0E,
  return:      0x0F,
  call:        0x10,
  drop:        0x1A,
  select:      0x1B,
  local_get:   0x20,
  local_set:   0x21,
  local_tee:   0x22,
  global_get:  0x23,
  global_set:  0x24,

  i32_load:    0x28,
  i32_load8_u: 0x2D,
  i32_load16_u:0x2F,
  i32_store:   0x36,
  i32_store8:  0x3A,
  i32_store16: 0x3B,

  memory_size: 0x3F,
  memory_grow: 0x40,

  i32_const:   0x41,
  i64_const:   0x42,

  i32_eqz:     0x45,
  i32_eq:      0x46,
  i32_ne:      0x47,
  i32_lt_s:    0x48,
  i32_lt_u:    0x49,
  i32_gt_s:    0x4A,
  i32_gt_u:    0x4B,
  i32_le_s:    0x4C,
  i32_le_u:    0x4D,
  i32_ge_s:    0x4E,
  i32_ge_u:    0x4F,

  i32_add:     0x6A,
  i32_sub:     0x6B,
  i32_mul:     0x6C,
  i32_div_s:   0x6D,
  i32_div_u:   0x6E,
  i32_rem_s:   0x6F,
  i32_rem_u:   0x70,
  i32_and:     0x71,
  i32_or:      0x72,
  i32_xor:     0x73,
  i32_shl:     0x74,
  i32_shr_s:   0x75,
  i32_shr_u:   0x76,
  i32_rotl:    0x77,
  i32_rotr:    0x78,
});

// ----- byte-builder -----

export class Bytes {
  constructor() { this.out = []; }
  u8(n)        { this.out.push(n & 0xFF); return this; }
  bytes(arr)   { for (const b of arr) this.out.push(b & 0xFF); return this; }
  uleb(n)      { this.bytes(uleb128(n)); return this; }
  sleb(n)      { this.bytes(sleb128(n)); return this; }
  name(s)      { const enc = utf8(s); this.uleb(enc.length); this.bytes(enc); return this; }
  toBytes()    { return Uint8Array.from(this.out); }
}

function utf8(s) {
  // Pure UTF-8 encoder. Avoids TextEncoder for byte-exact reproducibility across runtimes.
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if ((c & 0xFC00) === 0xD800 && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      if ((c2 & 0xFC00) === 0xDC00) {
        c = 0x10000 + ((c & 0x3FF) << 10) + (c2 & 0x3FF);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
  }
  return out;
}

// ----- section helper -----

function section(id, payload) {
  const out = new Bytes();
  out.u8(id);
  out.uleb(payload.length);
  out.bytes(payload);
  return out.out;
}

// ----- module-spec builder -----

/**
 * Build a WASM module from a high-level spec.
 *
 * Spec shape:
 *   types:    [{ params: [ValType], results: [ValType] }]
 *   imports:  [{ module, name, kind: 'function', typeIndex }]   // only 'function' supported here
 *   memory:   { minPages, maxPages? }                            // module declares its own memory
 *   exports:  [{ name, kind, index }]
 *   functions:[{ typeIndex, locals: [{type, count}], body: Bytes-like }]
 *   data:     [{ offset, bytes }]
 *
 * Returns: Uint8Array of valid WASM bytecode.
 */
export function buildModule(spec) {
  const out = new Bytes();
  // magic + version
  out.bytes([0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00]);

  // 1. Type section.
  if (spec.types && spec.types.length) {
    const p = new Bytes();
    p.uleb(spec.types.length);
    for (const t of spec.types) {
      p.u8(0x60); // function type
      p.uleb(t.params.length);
      for (const v of t.params) p.u8(v);
      p.uleb(t.results.length);
      for (const v of t.results) p.u8(v);
    }
    out.bytes(section(1, p.out));
  }

  // 2. Import section.
  if (spec.imports && spec.imports.length) {
    const p = new Bytes();
    p.uleb(spec.imports.length);
    for (const im of spec.imports) {
      p.name(im.module);
      p.name(im.name);
      if (im.kind === "function") {
        p.u8(ExternalKind.function);
        p.uleb(im.typeIndex);
      } else if (im.kind === "memory") {
        p.u8(ExternalKind.memory);
        if (im.max !== undefined) { p.u8(0x01); p.uleb(im.min); p.uleb(im.max); }
        else { p.u8(0x00); p.uleb(im.min); }
      } else {
        throw new Error("import kind not supported: " + im.kind);
      }
    }
    out.bytes(section(2, p.out));
  }

  // 3. Function section.
  if (spec.functions && spec.functions.length) {
    const p = new Bytes();
    p.uleb(spec.functions.length);
    for (const fn of spec.functions) p.uleb(fn.typeIndex);
    out.bytes(section(3, p.out));
  }

  // 5. Memory section.
  if (spec.memory) {
    const p = new Bytes();
    p.uleb(1);
    if (spec.memory.maxPages !== undefined) {
      p.u8(0x01); p.uleb(spec.memory.minPages); p.uleb(spec.memory.maxPages);
    } else {
      p.u8(0x00); p.uleb(spec.memory.minPages);
    }
    out.bytes(section(5, p.out));
  }

  // 7. Export section.
  if (spec.exports && spec.exports.length) {
    const p = new Bytes();
    p.uleb(spec.exports.length);
    for (const e of spec.exports) {
      p.name(e.name);
      p.u8(ExternalKind[e.kind]);
      p.uleb(e.index);
    }
    out.bytes(section(7, p.out));
  }

  // 8. Start section.
  if (spec.start !== undefined && spec.start !== null) {
    const p = new Bytes();
    p.uleb(spec.start);
    out.bytes(section(8, p.out));
  }

  // 10. Code section.
  if (spec.functions && spec.functions.length) {
    const p = new Bytes();
    p.uleb(spec.functions.length);
    for (const fn of spec.functions) {
      const body = new Bytes();
      // locals
      body.uleb(fn.locals.length);
      for (const l of fn.locals) {
        body.uleb(l.count);
        body.u8(l.type);
      }
      // body bytes
      body.bytes(fn.body);
      // end opcode
      body.u8(Op.end);
      // length-prefixed
      const inner = body.out;
      p.uleb(inner.length);
      p.bytes(inner);
    }
    out.bytes(section(10, p.out));
  }

  // 11. Data section.
  if (spec.data && spec.data.length) {
    const p = new Bytes();
    p.uleb(spec.data.length);
    for (const d of spec.data) {
      p.uleb(0);                  // memory index 0
      p.u8(Op.i32_const);
      p.bytes(sleb128(d.offset));
      p.u8(Op.end);
      p.uleb(d.bytes.length);
      p.bytes(d.bytes);
    }
    out.bytes(section(11, p.out));
  }

  return out.toBytes();
}

// ----- instruction helpers (build body bytes incrementally) -----

export class InstrBuilder {
  constructor() { this.bytes = []; }
  emit(...bs) { for (const b of bs) this.bytes.push(b & 0xFF); return this; }
  uleb(n)     { for (const b of uleb128(n)) this.bytes.push(b); return this; }
  sleb(n)     { for (const b of sleb128(n)) this.bytes.push(b); return this; }
  i32Const(n) { this.emit(Op.i32_const); this.sleb(n | 0); return this; }
  localGet(i) { this.emit(Op.local_get); this.uleb(i); return this; }
  localSet(i) { this.emit(Op.local_set); this.uleb(i); return this; }
  localTee(i) { this.emit(Op.local_tee); this.uleb(i); return this; }
  call(i)     { this.emit(Op.call); this.uleb(i); return this; }
  ret()       { this.emit(Op.return); return this; }
  add()       { this.emit(Op.i32_add); return this; }
  sub()       { this.emit(Op.i32_sub); return this; }
  mul()       { this.emit(Op.i32_mul); return this; }
  and()       { this.emit(Op.i32_and); return this; }
  or()        { this.emit(Op.i32_or); return this; }
  xor()       { this.emit(Op.i32_xor); return this; }
  shl()       { this.emit(Op.i32_shl); return this; }
  shrU()      { this.emit(Op.i32_shr_u); return this; }
  eq()        { this.emit(Op.i32_eq); return this; }
  ne()        { this.emit(Op.i32_ne); return this; }
  eqz()       { this.emit(Op.i32_eqz); return this; }
  load(align, offset)   { this.emit(Op.i32_load);   this.uleb(align); this.uleb(offset); return this; }
  load8U(align, offset) { this.emit(Op.i32_load8_u);this.uleb(align); this.uleb(offset); return this; }
  load16U(align,offset) { this.emit(Op.i32_load16_u);this.uleb(align);this.uleb(offset); return this; }
  store(align, offset)  { this.emit(Op.i32_store);   this.uleb(align); this.uleb(offset); return this; }
  store8(align, offset) { this.emit(Op.i32_store8);  this.uleb(align); this.uleb(offset); return this; }
  store16(align,offset) { this.emit(Op.i32_store16); this.uleb(align); this.uleb(offset); return this; }
  block(blockType = BlockType.void) { this.emit(Op.block, blockType); return this; }
  loop(blockType = BlockType.void)  { this.emit(Op.loop,  blockType); return this; }
  if_(blockType = BlockType.void)   { this.emit(Op.if,    blockType); return this; }
  else_() { this.emit(Op.else); return this; }
  end()   { this.emit(Op.end); return this; }
  br(d)   { this.emit(Op.br);    this.uleb(d); return this; }
  brIf(d) { this.emit(Op.br_if); this.uleb(d); return this; }
  drop()  { this.emit(Op.drop); return this; }
  nop()   { this.emit(Op.nop); return this; }
  unreachable() { this.emit(Op.unreachable); return this; }
  raw(arr) { for (const b of arr) this.bytes.push(b & 0xFF); return this; }
  toArray() { return this.bytes.slice(); }
}
