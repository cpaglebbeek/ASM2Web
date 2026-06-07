/**
 * TASM tokenizer — state-machine, char-by-char, deterministisch.
 * Output: vlakke token-stream met source-locaties.
 *
 * Token-types:
 *   NEWLINE  (significant — TASM is line-based)
 *   IDENT    (identifier of mnemonic; case-preserved)
 *   LABEL    (identifier gevolgd door ':')
 *   NUMBER   (decimal of hex met h-suffix; intern als bigint of number)
 *   STRING   (enkele of dubbele quotes)
 *   PUNCT    (een uit `,`, `[`, `]`, `+`, `-`, `*`, `/`, `:`, `(`, `)`)
 *   COMMENT  (alles na `;` tot end-of-line; optioneel teruggegeven)
 *   EOF
 *
 * Quirks van TASM:
 *   - hex eindigt op `h` of `H` (0Fh = 15). Een hex die met letter begint moet
 *     met `0` worden geprefixed (anders zou het een ident zijn).
 *   - decimal eindigt op `d`/`D` of niets.
 *   - binary `b`/`B`.
 *   - octal `o`/`O`/`q`/`Q`.
 *   - LOCALS-labels beginnen met `@@` (bv. `@@1:`).
 *   - `;` start een comment tot het einde van de regel.
 *   - Strings ondersteunen single quotes en double quotes.
 *   - Whitespace is alleen-spatie/tab; newline is significant.
 *
 * Niet ondersteund (fase 1):
 *   - Macro-bodies (`macro` ... `endm` — uitgebreid)
 *   - Conditional assembly (`if`/`endif` — kan toegevoegd)
 *   - Echo/`%out`
 */
"use strict";

export const TOK = Object.freeze({
  NEWLINE: "NEWLINE",
  IDENT:   "IDENT",
  LABEL:   "LABEL",
  NUMBER:  "NUMBER",
  STRING:  "STRING",
  PUNCT:   "PUNCT",
  COMMENT: "COMMENT",
  EOF:     "EOF",
});

const PUNCT_CHARS = ",[]+-*/:()=<>&|^!~%";

export class TokenizeError extends Error {
  constructor(msg, file, line, col) {
    super(`${file}:${line}:${col}: ${msg}`);
    this.file = file;
    this.line = line;
    this.col  = col;
  }
}

/**
 * @param {string} source
 * @param {{file?:string, keepComments?:boolean}} [opts]
 * @returns {Array<Token>}
 */
export function tokenize(source, opts = {}) {
  const file         = opts.file || "<source>";
  const keepComments = !!opts.keepComments;
  const out          = [];
  const N            = source.length;

  let i      = 0;
  let line   = 1;
  let col    = 1;
  let lineStart = 0;     // index of last char before current line start

  function locHere() { return { file, line, col, offset: i }; }
  function loc(startLine, startCol, startOffset) {
    return { file, line: startLine, col: startCol, offset: startOffset };
  }

  function push(type, value, startLine, startCol, startOffset) {
    out.push({ type, value, ...loc(startLine, startCol, startOffset) });
  }

  function advance(n = 1) {
    for (let k = 0; k < n; k++) {
      if (i >= N) return;
      const ch = source[i];
      if (ch === "\n") {
        line++;
        col = 1;
        lineStart = i + 1;
      } else {
        col++;
      }
      i++;
    }
  }

  function peek(k = 0) { return source[i + k]; }

  function isAlpha(c) { return c !== undefined && /[A-Za-z_\.@?$]/.test(c); }
  function isAlphaNum(c) { return c !== undefined && /[A-Za-z0-9_\.@?$]/.test(c); }
  function isDigit(c) { return c !== undefined && c >= "0" && c <= "9"; }
  function isHex(c) { return c !== undefined && /[0-9A-Fa-f]/.test(c); }
  function isLineSpace(c) { return c === " " || c === "\t" || c === "\r"; }

  while (i < N) {
    const ch = source[i];

    // Skip horizontal whitespace.
    if (isLineSpace(ch)) {
      advance();
      continue;
    }

    // Line continuation: '\' before newline -> skip both.
    if (ch === "\\" && (peek(1) === "\n" || (peek(1) === "\r" && peek(2) === "\n"))) {
      advance(); // backslash
      if (peek() === "\r") advance();
      advance(); // newline
      continue;
    }

    // Newline (significant).
    if (ch === "\n") {
      push(TOK.NEWLINE, "\n", line, col, i);
      advance();
      continue;
    }

    // Comment ;... EOL
    if (ch === ";") {
      const sLine = line, sCol = col, sOff = i;
      let value = "";
      while (i < N && source[i] !== "\n") {
        value += source[i];
        advance();
      }
      if (keepComments) push(TOK.COMMENT, value, sLine, sCol, sOff);
      continue;
    }

    // String literal.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const sLine = line, sCol = col, sOff = i;
      advance(); // opening quote
      let value = "";
      while (i < N && source[i] !== quote && source[i] !== "\n") {
        value += source[i];
        advance();
      }
      if (source[i] !== quote) {
        throw new TokenizeError(`unterminated string (${quote})`, file, sLine, sCol);
      }
      advance(); // closing quote
      push(TOK.STRING, value, sLine, sCol, sOff);
      continue;
    }

    // Number: starts with digit. Handle base-suffixes 'h','b','d','o','q'.
    if (isDigit(ch)) {
      const sLine = line, sCol = col, sOff = i;
      let raw = "";
      while (i < N && /[0-9A-Fa-f]/.test(source[i])) {
        raw += source[i];
        advance();
      }
      let suffix = "";
      // Suffix komt direct na de raw (en is geen ident-start).
      if (i < N && /[hHbBdDoOqQ]/.test(source[i]) && !isAlphaNum(source[i + 1])) {
        suffix = source[i].toLowerCase();
        advance();
      } else if (raw.length > 1 && /[bBdDoOqQ]$/.test(raw)) {
        // Geen losse suffix erna, maar raw eindigt op een base-indicator die ook hex-digit-look-alike is
        // (vooral 'b' bij binary). Behandel laatste char als suffix.
        suffix = raw.slice(-1).toLowerCase();
        raw = raw.slice(0, -1);
      }
      const parsed = parseTasmNumber(raw, suffix);
      if (parsed.error) {
        throw new TokenizeError(parsed.error, file, sLine, sCol);
      }
      push(TOK.NUMBER, parsed.value, sLine, sCol, sOff);
      continue;
    }

    // Punctuation.
    if (PUNCT_CHARS.indexOf(ch) !== -1) {
      const sLine = line, sCol = col, sOff = i;
      // Special: ':' may be label-marker, but we emit it as PUNCT and let parser handle.
      push(TOK.PUNCT, ch, sLine, sCol, sOff);
      advance();
      continue;
    }

    // Identifier / label.
    if (isAlpha(ch)) {
      const sLine = line, sCol = col, sOff = i;
      let value = "";
      while (i < N && isAlphaNum(source[i])) {
        value += source[i];
        advance();
      }
      // Lookahead: if followed by ':' it's a label declaration.
      // But only when ':' is not start of a far/near-call (we don't see those at top-level).
      if (source[i] === ":") {
        advance(); // consume ':'
        push(TOK.LABEL, value, sLine, sCol, sOff);
        continue;
      }
      push(TOK.IDENT, value, sLine, sCol, sOff);
      continue;
    }

    // Unknown char.
    throw new TokenizeError(`unexpected character '${ch}' (0x${ch.charCodeAt(0).toString(16)})`,
      file, line, col);
  }

  push(TOK.EOF, null, line, col, i);
  return out;
}

/** Parse a TASM number literal "FACE" with suffix "h" -> 0xFACE etc. */
export function parseTasmNumber(raw, suffix) {
  // TASM allows underscore? Not commonly. We accept what we see.
  if (suffix === "h") {
    if (!/^[0-9A-Fa-f]+$/.test(raw)) return { error: `bad hex literal '${raw}h'` };
    return { value: parseInt(raw, 16) };
  }
  if (suffix === "b") {
    if (!/^[01]+$/.test(raw)) return { error: `bad binary literal '${raw}b'` };
    return { value: parseInt(raw, 2) };
  }
  if (suffix === "o" || suffix === "q") {
    if (!/^[0-7]+$/.test(raw)) return { error: `bad octal literal '${raw}${suffix}'` };
    return { value: parseInt(raw, 8) };
  }
  if (suffix === "d" || suffix === "") {
    if (!/^[0-9]+$/.test(raw)) return { error: `bad decimal literal '${raw}'` };
    return { value: parseInt(raw, 10) };
  }
  return { error: `unknown number suffix '${suffix}'` };
}

/** Pretty-print a token-stream back to a string (for round-trip tests). */
export function detokenize(tokens) {
  let out = "";
  for (const t of tokens) {
    if (t.type === TOK.EOF) break;
    if (t.type === TOK.NEWLINE) { out += "\n"; continue; }
    if (t.type === TOK.COMMENT) { out += t.value + " "; continue; }
    if (t.type === TOK.STRING)  { out += `"${t.value}" `; continue; }
    if (t.type === TOK.NUMBER)  { out += String(t.value) + " "; continue; }
    if (t.type === TOK.LABEL)   { out += t.value + ": "; continue; }
    if (t.type === TOK.IDENT)   { out += t.value + " "; continue; }
    if (t.type === TOK.PUNCT)   { out += t.value; continue; }
  }
  return out;
}
