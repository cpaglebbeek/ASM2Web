/**
 * TASM parser — recursive descent vanaf token-stream.
 *
 * Grammatica (vereenvoudigd voor TECHNO-subset):
 *   module     := { topItem }
 *   topItem    := segmentBlock | directive | procDecl | instrLine | dataLine | label | comment
 *   segmentBlock := IDENT 'SEGMENT' { ... } | (oude stijl: directives los)
 *   procDecl   := IDENT 'PROC' ('NEAR'|'FAR')? NEWLINE { ... } IDENT 'ENDP'
 *   instrLine  := MNEMONIC [ operandList ] NEWLINE
 *   dataLine   := ('db'|'dw'|'dd') dataItem { ',' dataItem } NEWLINE
 *   dataItem   := NUMBER | STRING | NUMBER 'dup' '(' dataItem ')' | '?' | IDENT
 *   operand    := REG | NUMBER | IDENT | memOperand | unary | binary
 *   memOperand := '[' expr ']' (met optionele segment-override en displacement)
 *
 * Deze parser is permissief: onbekende directives worden geregistreerd als RAW
 * (zonder fout), zodat we TECHNO grotendeels door de pipeline krijgen ook
 * als we niet 100% van TASM-syntax dekken. Onbekendheden tellen we in stats.
 */
"use strict";

import { TOK } from "./tokenizer.js";

export const NODE = Object.freeze({
  MODULE:    "module",
  SEGMENT:   "segment",
  PROC:      "proc",
  LABEL:     "label",
  INSTR:     "instr",
  DATA:      "data",
  DIRECTIVE: "directive",
  EXTERN:    "extern",
  PUBLIC:    "public",
  INCLUDE:   "include",
  ASSUME:    "assume",
  ALIGN:     "align",
  EQU:       "equ",
  RAW:       "raw",      // unrecognised line, preserved
  COMMENT:   "comment",
});

export class ParseError extends Error {
  constructor(msg, tok) {
    super(`${tok.file}:${tok.line}:${tok.col}: ${msg}`);
    this.tok = tok;
  }
}

/** Convert mnemonic to canonical lowercase. */
function lc(s) { return String(s).toLowerCase(); }

const X86_MNEMONICS = new Set([
  // data movement
  "mov","movzx","movsx","xchg","lea","push","pop","pusha","popa","pushf","popf",
  "lds","les","lfs","lgs","lss","movsb","movsw","stosb","stosw","lodsb","lodsw",
  "cmpsb","cmpsw","scasb","scasw","rep","repe","repz","repne","repnz",
  // arithmetic
  "add","adc","sub","sbb","neg","mul","imul","div","idiv","inc","dec","cmp",
  "aaa","aas","aam","aad","daa","das","cbw","cwd",
  // logic / bit
  "and","or","xor","not","test","shl","sal","shr","sar","rol","ror","rcl","rcr",
  "shld","shrd",
  // control flow
  "jmp","call","ret","retn","retf","int","into","iret","loop","loope","loopz",
  "loopne","loopnz","jcxz","jecxz",
  // conditional jumps
  "ja","jae","jb","jbe","jc","jcxz","je","jecxz","jg","jge","jl","jle","jna",
  "jnae","jnb","jnbe","jnc","jne","jng","jnge","jnl","jnle","jno","jnp","jns",
  "jnz","jo","jp","jpe","jpo","js","jz",
  // io
  "in","out",
  // flags
  "clc","stc","cli","sti","cld","std","cmc",
  // 386+
  "bsf","bsr","bt","btc","btr","bts","seta","setae","setb","setbe","setc","sete",
  "setg","setge","setl","setle","setna","setnae","setnb","setnbe","setnc","setne",
  "setng","setnge","setnl","setnle","setno","setnp","setns","setnz","seto","setp",
  "setpe","setpo","sets","setz",
  // misc
  "nop","hlt","wait","fwait","esc",
]);

const REG16 = new Set(["ax","bx","cx","dx","si","di","bp","sp"]);
const REG8  = new Set(["al","ah","bl","bh","cl","ch","dl","dh"]);
const REG32 = new Set(["eax","ebx","ecx","edx","esi","edi","ebp","esp"]);
const SREG  = new Set(["cs","ds","es","ss","fs","gs"]);

export function isMnemonic(s) { return X86_MNEMONICS.has(lc(s)); }
export function isReg(s) {
  const x = lc(s);
  return REG16.has(x) || REG8.has(x) || REG32.has(x) || SREG.has(x);
}
export function regKind(s) {
  const x = lc(s);
  if (REG16.has(x)) return "r16";
  if (REG8.has(x))  return "r8";
  if (REG32.has(x)) return "r32";
  if (SREG.has(x))  return "sreg";
  return null;
}

/**
 * @param {Array<Token>} tokens
 * @param {{file?:string}} [opts]
 * @returns {Module}
 */
export function parse(tokens, opts = {}) {
  const file = opts.file || (tokens[0] && tokens[0].file) || "<source>";
  let i = 0;
  const stats = {
    instructions: 0,
    procs:        0,
    labels:       0,
    dataLines:    0,
    segments:     0,
    externs:      0,
    publics:      0,
    raw:          0,
    unknownMnemonics: new Set(),
  };

  function peek(k = 0) { return tokens[i + k]; }
  function eat()       { return tokens[i++]; }
  function isEof()     { return peek().type === TOK.EOF; }
  function err(msg, t) { throw new ParseError(msg, t || peek()); }

  function skipBlankLines() {
    while (peek().type === TOK.NEWLINE) i++;
  }

  function readToEol() {
    const start = i;
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) i++;
    if (peek().type === TOK.NEWLINE) i++;
    return tokens.slice(start, peek().type === TOK.EOF ? i : i - 1);
  }

  function parseModule() {
    const items = [];
    skipBlankLines();
    while (!isEof()) {
      const it = parseTopItem();
      if (it) items.push(it);
      skipBlankLines();
    }
    return { kind: NODE.MODULE, file, items };
  }

  function parseTopItem() {
    const t = peek();
    if (t.type === TOK.LABEL) {
      const node = { kind: NODE.LABEL, name: t.value, local: t.value.startsWith("@@"), loc: tokLoc(t) };
      stats.labels++;
      i++;
      // The rest of the line may contain a directive/instr.
      const t2 = peek();
      if (t2.type === TOK.NEWLINE || t2.type === TOK.EOF) {
        if (t2.type === TOK.NEWLINE) i++;
        return node;
      }
      // Combined "label: instr": emit label first, then parse the rest of the line again.
      // (We return label here; loop continues and picks up the rest.)
      return node;
    }
    if (t.type === TOK.IDENT) {
      const name = lc(t.value);

      // PROC declaration: IDENT 'PROC' ...
      if (peek(1).type === TOK.IDENT && lc(peek(1).value) === "proc") {
        return parseProc();
      }
      // IDENT 'EQU' expr
      if (peek(1).type === TOK.IDENT && lc(peek(1).value) === "equ") {
        return parseEqu();
      }
      // IDENT 'SEGMENT' attrs
      if (peek(1).type === TOK.IDENT && lc(peek(1).value) === "segment") {
        return parseSegment();
      }
      // IDENT 'ENDS' / 'ENDP'  (ends-of-block — treated as raw structural marker)
      if (peek(1).type === TOK.IDENT && (lc(peek(1).value) === "ends" || lc(peek(1).value) === "endp")) {
        const startTok = t;
        const endTok = peek(1);
        i += 2; skipEol();
        return { kind: NODE.DIRECTIVE, name: lc(endTok.value), target: t.value, loc: tokLoc(startTok) };
      }
      // Directives at line start (no preceding IDENT)
      const dirName = name;
      if (dirName === "extrn" || dirName === "extern") return parseExtern();
      if (dirName === "public" || dirName === "global") return parsePublic();
      if (dirName === "include") return parseInclude();
      if (dirName === "assume") return parseAssume();
      if (dirName === "align") return parseAlign();
      if (dirName === "db" || dirName === "dw" || dirName === "dd"
          || dirName === "dq" || dirName === "dt") {
        return parseData(dirName);
      }
      if (dirName === ".386" || dirName === ".286" || dirName === ".186"
          || dirName === ".8086" || dirName === ".486"
          || dirName === "locals" || dirName === ".model" || dirName === ".code"
          || dirName === ".data" || dirName === ".stack" || dirName === "end") {
        const dt = t;
        const operandToks = [];
        i++;
        while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) {
          operandToks.push(eat());
        }
        skipEol();
        return {
          kind: NODE.DIRECTIVE,
          name: dirName,
          operandText: operandToks.map(x => String(x.value)).join(" "),
          loc: tokLoc(dt),
        };
      }
      if (isMnemonic(t.value)) {
        return parseInstr();
      }

      // Unknown leading IDENT — try data-after-ident pattern: IDENT db/dw/...
      // "_rows dw 200 dup(0)"
      if (peek(1).type === TOK.IDENT && /^(db|dw|dd|dq|dt)$/i.test(peek(1).value)) {
        const labelTok = eat(); // IDENT
        const dt = peek();
        stats.labels++;
        const dirNm = lc(dt.value); i++;
        const data = parseDataBody(dirNm, dt);
        return {
          kind: NODE.DATA,
          name: labelTok.value,
          size: dirNm,
          items: data,
          loc: tokLoc(labelTok),
        };
      }

      // Unknown — collect line as RAW.
      stats.raw++;
      stats.unknownMnemonics.add(t.value);
      const rawTokens = readToEol();
      return {
        kind: NODE.RAW,
        text: rawTokens.map(x => x.type === TOK.STRING ? `"${x.value}"` : String(x.value)).join(" "),
        loc: tokLoc(t),
      };
    }
    // Unexpected leading token: collect and skip.
    stats.raw++;
    const rawTokens = readToEol();
    return {
      kind: NODE.RAW,
      text: rawTokens.map(x => String(x.value)).join(" "),
      loc: tokLoc(t),
    };
  }

  function tokLoc(t) { return { line: t.line, col: t.col, offset: t.offset }; }
  function skipEol() {
    if (peek().type === TOK.NEWLINE) i++;
  }

  function parseProc() {
    const nameTok = eat(); // IDENT
    const procTok = eat(); // 'PROC'
    let attr = null;
    if (peek().type === TOK.IDENT && /^(near|far)$/i.test(peek().value)) {
      attr = lc(eat().value);
    }
    // skip any USES clause etc.
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) i++;
    skipEol();

    const body = [];
    while (!isEof()) {
      // ENDP terminator: IDENT 'ENDP'
      if (peek().type === TOK.IDENT && peek(1).type === TOK.IDENT && lc(peek(1).value) === "endp") {
        i += 2; skipEol();
        break;
      }
      // bare ENDP (no name)
      if (peek().type === TOK.IDENT && lc(peek().value) === "endp") {
        i++; skipEol();
        break;
      }
      skipBlankLines();
      if (isEof()) break;
      const it = parseTopItem();
      if (it) body.push(it);
    }
    stats.procs++;
    return {
      kind: NODE.PROC,
      name: nameTok.value,
      attr,
      items: body,
      loc: tokLoc(nameTok),
    };
  }

  function parseEqu() {
    const nameTok = eat();
    eat(); // 'equ'
    const exprToks = [];
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) {
      exprToks.push(eat());
    }
    skipEol();
    return {
      kind: NODE.EQU,
      name: nameTok.value,
      exprText: exprToks.map(x => String(x.value)).join(" "),
      loc: tokLoc(nameTok),
    };
  }

  function parseSegment() {
    const nameTok = eat();
    eat(); // 'SEGMENT'
    const attrToks = [];
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) attrToks.push(eat());
    skipEol();
    const body = [];
    while (!isEof()) {
      if (peek().type === TOK.IDENT && peek(1).type === TOK.IDENT && lc(peek(1).value) === "ends") {
        // possibly "name ENDS"
        if (peek().value === nameTok.value) {
          i += 2; skipEol(); break;
        }
      }
      // bare ENDS
      if (peek().type === TOK.IDENT && lc(peek().value) === "ends") {
        i++; skipEol(); break;
      }
      skipBlankLines();
      if (isEof()) break;
      const it = parseTopItem();
      if (it) body.push(it);
    }
    stats.segments++;
    return {
      kind: NODE.SEGMENT,
      name: nameTok.value,
      attrs: attrToks.map(x => String(x.value)).join(" "),
      items: body,
      loc: tokLoc(nameTok),
    };
  }

  function parseExtern() {
    const dt = eat();
    const names = [];
    // forms: extrn name:type, name:type, ...
    // Tokenizer ziet "name:" als LABEL — in extern-context behandelen we LABEL als IDENT + impliciete ':'.
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) {
      const t = peek();
      if (t.type === TOK.IDENT || t.type === TOK.LABEL) {
        const n = eat().value;
        let type = null;
        // After LABEL the ':' is already consumed. After IDENT we expect ':' optionally.
        if (t.type === TOK.LABEL) {
          if (peek().type === TOK.IDENT) type = lc(eat().value);
        } else {
          if (peek().type === TOK.PUNCT && peek().value === ":") {
            eat(); // ':'
            if (peek().type === TOK.IDENT) type = lc(eat().value);
          }
        }
        names.push({ name: n, type });
        stats.externs++;
        if (peek().type === TOK.PUNCT && peek().value === ",") eat();
        continue;
      }
      i++;
    }
    skipEol();
    return { kind: NODE.EXTERN, names, loc: tokLoc(dt) };
  }

  function parsePublic() {
    const dt = eat();
    const names = [];
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) {
      if (peek().type === TOK.IDENT || peek().type === TOK.LABEL) {
        names.push(eat().value);
        stats.publics++;
        if (peek().type === TOK.PUNCT && peek().value === ",") eat();
        continue;
      }
      i++;
    }
    skipEol();
    return { kind: NODE.PUBLIC, names, loc: tokLoc(dt) };
  }

  function parseInclude() {
    const dt = eat();
    const restToks = [];
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) restToks.push(eat());
    skipEol();
    return {
      kind: NODE.INCLUDE,
      path: restToks.map(x => x.type === TOK.STRING ? x.value : String(x.value)).join("").trim(),
      loc: tokLoc(dt),
    };
  }

  function parseAssume() {
    const dt = eat();
    const restToks = [];
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) restToks.push(eat());
    skipEol();
    return {
      kind: NODE.ASSUME,
      text: restToks.map(x => String(x.value)).join(" "),
      loc: tokLoc(dt),
    };
  }

  function parseAlign() {
    const dt = eat();
    let n = null;
    if (peek().type === TOK.NUMBER) n = eat().value;
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) i++;
    skipEol();
    return { kind: NODE.ALIGN, value: n, loc: tokLoc(dt) };
  }

  function parseData(sizeDirName) {
    const dt = eat();
    const items = parseDataBody(sizeDirName, dt);
    return { kind: NODE.DATA, name: null, size: sizeDirName, items, loc: tokLoc(dt) };
  }

  function parseDataBody(sizeDirName, dt) {
    stats.dataLines++;
    const items = [];
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) {
      items.push(parseDataItem());
      if (peek().type === TOK.PUNCT && peek().value === ",") { eat(); continue; }
      if (peek().type === TOK.NEWLINE || peek().type === TOK.EOF) break;
    }
    skipEol();
    return items;
  }

  function parseDataItem() {
    const t = peek();
    if (t.type === TOK.NUMBER) {
      const v = eat().value;
      // 'N dup(...)'
      if (peek().type === TOK.IDENT && lc(peek().value) === "dup") {
        eat(); // 'dup'
        if (peek().type === TOK.PUNCT && peek().value === "(") eat();
        const inner = parseDataItem();
        // allow extra , inside
        while (peek().type !== TOK.PUNCT || peek().value !== ")") {
          if (peek().type === TOK.NEWLINE || peek().type === TOK.EOF) break;
          eat();
        }
        if (peek().type === TOK.PUNCT && peek().value === ")") eat();
        return { kind: "dup", count: v, inner };
      }
      return { kind: "num", value: v };
    }
    if (t.type === TOK.STRING) { eat(); return { kind: "str", value: t.value }; }
    if (t.type === TOK.IDENT) {
      const v = eat().value;
      if (v === "?") return { kind: "uninit" };
      return { kind: "ref", value: v };
    }
    if (t.type === TOK.PUNCT && t.value === "?") { eat(); return { kind: "uninit" }; }
    // Unknown — eat one and return raw.
    eat();
    return { kind: "raw", value: String(t.value) };
  }

  function parseInstr() {
    const mnTok = eat();
    stats.instructions++;
    const operands = [];
    while (peek().type !== TOK.NEWLINE && peek().type !== TOK.EOF) {
      operands.push(parseOperand());
      if (peek().type === TOK.PUNCT && peek().value === ",") { eat(); continue; }
      if (peek().type === TOK.NEWLINE || peek().type === TOK.EOF) break;
      // Stray punctuation we don't recognise — skip.
      if (peek().type === TOK.PUNCT) { eat(); continue; }
      break;
    }
    skipEol();
    return {
      kind: NODE.INSTR,
      mnemonic: lc(mnTok.value),
      operands,
      loc: tokLoc(mnTok),
    };
  }

  function parseOperand() {
    const t = peek();
    // Memory operand '[expr]'
    if (t.type === TOK.PUNCT && t.value === "[") {
      eat();
      const exprToks = [];
      while (peek().type !== TOK.PUNCT || peek().value !== "]") {
        if (peek().type === TOK.NEWLINE || peek().type === TOK.EOF) break;
        exprToks.push(eat());
      }
      if (peek().type === TOK.PUNCT && peek().value === "]") eat();
      return {
        kind: "mem",
        exprText: exprToks.map(x => String(x.value)).join(" "),
        exprTokens: exprToks.map(x => ({ type: x.type, value: x.value })),
      };
    }
    // Segment-override prefix:  ds:[bx]  or  es:di
    if (t.type === TOK.IDENT && SREG.has(lc(t.value)) && peek(1).type === TOK.PUNCT && peek(1).value === ":") {
      const seg = lc(eat().value);
      eat(); // ':'
      const inner = parseOperand();
      return { kind: "segref", seg, inner };
    }
    if (t.type === TOK.IDENT) {
      const name = t.value;
      eat();
      if (isReg(name)) {
        return { kind: "reg", name: lc(name), regKind: regKind(name) };
      }
      // PTR-keyword: 'BYTE PTR [foo]' etc.
      if (/^(byte|word|dword|qword|ptr|near|far|short)$/i.test(name)) {
        // We swallow the size hint and recursively parse the next operand.
        const rest = parseOperand();
        if (rest) rest.sizeHint = lc(name);
        return rest;
      }
      return { kind: "label", name };
    }
    if (t.type === TOK.NUMBER) { eat(); return { kind: "imm", value: t.value }; }
    if (t.type === TOK.STRING) { eat(); return { kind: "imm", value: t.value, isString: true }; }
    if (t.type === TOK.PUNCT && (t.value === "+" || t.value === "-")) {
      eat();
      const rest = parseOperand();
      if (rest && rest.kind === "imm") {
        if (t.value === "-") rest.value = -rest.value;
        return rest;
      }
      return rest;
    }
    // Fallback — consume.
    eat();
    return { kind: "raw", text: String(t.value) };
  }

  const module = parseModule();
  module.stats = {
    instructions:  stats.instructions,
    procs:         stats.procs,
    labels:        stats.labels,
    dataLines:     stats.dataLines,
    segments:      stats.segments,
    externs:       stats.externs,
    publics:       stats.publics,
    raw:           stats.raw,
    unknownMnemonics: Array.from(stats.unknownMnemonics).sort(),
  };
  return module;
}

/** Walk every INSTR-node in a module, in source order. */
export function* walkInstructions(node) {
  if (!node) return;
  if (node.kind === NODE.INSTR) { yield node; return; }
  if (Array.isArray(node.items)) for (const c of node.items) yield* walkInstructions(c);
}

/** Walk every node (depth-first). */
export function* walk(node) {
  if (!node) return;
  yield node;
  if (Array.isArray(node.items)) for (const c of node.items) yield* walk(c);
}
