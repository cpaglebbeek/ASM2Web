/**
 * IR-emitter — converteert TASM-AST naar IR.
 *
 * Scope: support voor mini-demo en TECHNO-subset.
 * Niet 100% van x86 — emiteren we 'unknown' voor non-supported mnemonics zodat
 * de pipeline blijft draaien (stats tellen unknowns).
 */
"use strict";

import {
  newModule, newFunction, addOp, allocScratch,
  REG_TO_LOCAL, REG_IS_HIGH_BYTE, REG_SIZE, NUM_FIXED_LOCALS, SREG_TO_LOCAL,
  LOCAL_AX, LOCAL_BX, LOCAL_CX, LOCAL_DX, LOCAL_SI, LOCAL_DI, LOCAL_BP, LOCAL_SP,
  LOCAL_ZF, LOCAL_CF, LOCAL_SF, LOCAL_OF,
} from "./types.js";

import { NODE } from "../tasm/parser.js";

const SREG_NAMES = new Set(["cs", "ds", "es", "ss", "fs", "gs"]);

/**
 * @param {Module} ast  output of parser.parse()
 * @param {{name?:string, entry?:string}} [opts]
 */
export function emitIR(ast, opts = {}) {
  const mod = newModule(opts.name || ast.file || "module");

  // Pre-pass: collect all data-label names (incl. nested in SEGMENT) so that a
  // bare label used as an operand (`mov ax, cs:Op`) is treated as a memory
  // reference rather than an unresolved symbol.
  const dataNames = new Set();
  (function collectData(items) {
    for (const it of items || []) {
      if (!it) continue;
      if (it.kind === NODE.DATA && it.name) dataNames.add(it.name);
      if (Array.isArray(it.items)) collectData(it.items);
    }
  })(ast.items || []);
  // Walk top-level items, building functions when we see PROC.
  // Bare instructions (no enclosing PROC) go into an implicit __init function.
  let initFn = null;
  function getInit() {
    if (!initFn) {
      initFn = newFunction("__init", "near");
      mod.functions.push(initFn);
    }
    return initFn;
  }

  walkItems(ast.items || [], null);

  function walkItems(items, fn) {
    for (const it of items) {
      if (!it) continue;
      switch (it.kind) {
        case NODE.SEGMENT:
          walkItems(it.items, fn);
          break;
        case NODE.PROC: {
          const f = newFunction(it.name, it.attr || "near");
          f._segConst = {};   // tracked segment-register constants (paragraph values)
          f._regConst = {};   // tracked GP-register immediate values (for `mov seg, reg`)
          mod.functions.push(f);
          walkItems(it.items, f);
          // Implicit RET at end if not present (TASM often omits).
          if (f.ops.length === 0 || f.ops[f.ops.length - 1].op !== "ret") {
            addOp(f, { op: "ret" });
          }
          break;
        }
        case NODE.LABEL: {
          const target = fn || getInit();
          addOp(target, { op: "label", name: it.name, local: !!it.local });
          break;
        }
        case NODE.INSTR: {
          const target = fn || getInit();
          emitInstr(it, target);
          break;
        }
        case NODE.DATA:
          if (it.name) {
            mod.data.push({ name: it.name, size: it.size, items: it.items });
          } else {
            mod.data.push({ name: null, size: it.size, items: it.items });
          }
          break;
        case NODE.EXTERN:
        case NODE.PUBLIC:
        case NODE.INCLUDE:
        case NODE.ASSUME:
        case NODE.ALIGN:
        case NODE.EQU:
        case NODE.DIRECTIVE:
        case NODE.RAW:
          // No IR emission — these are metadata.
          break;
        default:
          break;
      }
    }
  }

  function emitInstr(instr, fn) {
    mod.stats.ops++;
    const mn = instr.mnemonic;
    const operands = instr.operands || [];

    // Segment/immediate tracking: only consecutive `mov reg, imm` instructions
    // keep a register's tracked constant alive (the `mov ax,0a000h / mov es,ax`
    // idiom). Any other instruction invalidates GP-register constants.
    if (mn === "mov") trackMov(fn, operands);
    else if (fn._regConst) fn._regConst = {};

    switch (mn) {
      case "mov":   return emitBinaryMove(fn, operands);
      case "add":   return emitArith(fn, "add", operands);
      case "adc":   return emitArith(fn, "add", operands);  // approximation: ignore carry
      case "sub":   return emitArith(fn, "sub", operands);
      case "sbb":   return emitArith(fn, "sub", operands);  // approximation: ignore borrow
      case "shld":
      case "shrd":  return emitArith(fn, "shl", operands.slice(0, 2));  // double-prec shift: approximate
      case "and":   return emitArith(fn, "and", operands);
      case "or":    return emitArith(fn, "or",  operands);
      case "xor":   return emitArith(fn, "xor", operands);
      case "shl":
      case "sal":   return emitShift(fn, "shl", operands);
      case "shr":   return emitShift(fn, "shr", operands);
      case "inc":   return emitArith(fn, "add", [operands[0], { kind: "imm", value: 1 }]);
      case "dec":   return emitArith(fn, "sub", [operands[0], { kind: "imm", value: 1 }]);
      case "cmp":   return emitCmp(fn, operands);
      case "test":  return emitTest(fn, operands);
      case "jmp":   return emitJump(fn, operands, null);
      case "je":
      case "jz":    return emitJump(fn, operands, "zf");
      case "jne":
      case "jnz":   return emitJump(fn, operands, "nzf");
      case "jc":
      case "jb":
      case "jnae":  return emitJump(fn, operands, "cf");
      case "jnc":
      case "jnb":
      case "jae":   return emitJump(fn, operands, "ncf");
      case "js":    return emitJump(fn, operands, "sf");
      case "jns":   return emitJump(fn, operands, "nsf");
      case "jg":
      case "jnle":  return emitJump(fn, operands, "gt_s");
      case "jge":
      case "jnl":   return emitJump(fn, operands, "ge_s");
      case "jl":
      case "jnge":  return emitJump(fn, operands, "lt_s");
      case "jle":
      case "jng":   return emitJump(fn, operands, "le_s");
      case "ja":
      case "jnbe":  return emitJump(fn, operands, "gt_u");
      case "jbe":
      case "jna":   return emitJump(fn, operands, "le_u");
      case "jcxz":  return emitJump(fn, operands, "cx_zero");
      case "call":  return emitCall(fn, operands);
      case "ret":
      case "retn":
      case "retf":  return addOp(fn, { op: "ret" });
      case "push":  return emitPush(fn, operands);
      case "pop":   return emitPop(fn, operands);
      case "in":    return emitIn(fn, operands);
      case "out":   return emitOut(fn, operands);
      case "int":   return emitInt(fn, operands);
      case "nop":   return addOp(fn, { op: "nop" });
      case "cld":
      case "std":
      case "clc":
      case "stc":
      case "cmc":   return addOp(fn, { op: "flagop", which: mn });
      case "neg":   return emitNeg(fn, operands);
      case "not":   return emitBitNot(fn, operands);
      case "xchg":  return emitXchg(fn, operands);
      case "mul":   return emitMulDiv(fn, "mul", operands);
      case "imul":  return emitMulDiv(fn, "imul", operands);
      case "div":   return emitMulDiv(fn, "div", operands);
      case "idiv":  return emitMulDiv(fn, "idiv", operands);
      case "rol":   return emitRotate(fn, "rol", operands);
      case "ror":   return emitRotate(fn, "ror", operands);
      case "rcl":   return emitRotate(fn, "rcl", operands);  // through carry — approximated as rol
      case "rcr":   return emitRotate(fn, "rcr", operands);
      case "sar":   return emitShift(fn, "sar", operands);
      case "loop":  return emitLoop(fn, operands);
      case "loope":
      case "loopz": return emitLoop(fn, operands);
      case "loopne":
      case "loopnz":return emitLoop(fn, operands);
      case "movsx":
      case "movzx": return emitBinaryMove(fn, operands);  // size-extending handled in storeTo
      case "lds":
      case "les":
      case "lfs":
      case "lgs":
      case "lss":   return emitBinaryMove(fn, operands);  // ignore segment-load
      case "pushf": return addOp(fn, { op: "push", src: operandToValue(fn, { kind: "reg", name: "ax" }) });
      case "popf":  return addOp(fn, { op: "pop",  dest: operandToValue(fn, { kind: "reg", name: "ax" }) });
      case "pusha": return emitPushAll(fn);
      case "popa":  return emitPopAll(fn);
      case "rep":
      case "repe":
      case "repz":
      case "repne":
      case "repnz":
        // String-op prefix — emit comment-marker; the next instr is the actual string op.
        return addOp(fn, { op: "nop", note: "rep-prefix" });
      case "movsb":
      case "movsw":
      case "stosb":
      case "stosw":
      case "lodsb":
      case "lodsw":
      case "cmpsb":
      case "cmpsw":
      case "scasb":
      case "scasw":
        // String-ops without rep: single iteration (approx).
        return addOp(fn, { op: "nop", note: "string-op-" + mn });
      default:
        mod.stats.unknownOps++;
        mod.stats.unknownMnemonics.add(mn);
        return addOp(fn, { op: "unknown", mnemonic: mn, operands });
    }
  }

  // ---------- helpers ----------

  function operandToValue(fn, op) {
    if (!op) return { kind: "const", value: 0 };
    if (op.kind === "reg") {
      const sr = SREG_TO_LOCAL[op.name];
      if (sr !== undefined) return { kind: "local", index: sr, size: 16 };
      const li = REG_TO_LOCAL[op.name];
      if (li === undefined) return { kind: "const", value: 0 };
      return { kind: "local", index: li, size: REG_SIZE[op.name] || 16, isHigh: !!REG_IS_HIGH_BYTE[op.name] };
    }
    if (op.kind === "imm") {
      return { kind: "const", value: Number(op.value) | 0 };
    }
    if (op.kind === "label") {
      // A bare data-label is a memory reference (load/store the variable).
      if (dataNames.has(op.name)) {
        return { kind: "mem", exprText: op.name, exprTokens: [{ type: "IDENT", value: op.name }], sizeHint: op.sizeHint };
      }
      return { kind: "sym", name: op.name };
    }
    if (op.kind === "mem") {
      return { kind: "mem", exprText: op.exprText, exprTokens: op.exprTokens, sizeHint: op.sizeHint };
    }
    if (op.kind === "segref") {
      const inner = operandToValue(fn, op.inner);
      // A `byte/word ptr` hint sits on the segref wrapper; carry it to the mem.
      if (op.sizeHint && inner && inner.sizeHint === undefined) inner.sizeHint = op.sizeHint;
      // Resolve the segment prefix, but only for register/numeric expressions: when
      // the expression already references a data symbol, that symbol resolves to an
      // absolute linear offset and the segment prefix is redundant.
      if (inner.kind === "mem" && !memHasSymbol(inner)) {
        if (SREG_TO_LOCAL[op.seg] !== undefined) {
          // Stage 8.2: consume the segment-register *global* at runtime so the
          // effective address is (seg<<4)+offset even when the segment value was
          // loaded in another function (machine state survives call boundaries).
          inner.segReg = op.seg;
        } else if (fn && fn._segConst && fn._segConst[op.seg] !== undefined) {
          // fs/gs have no register-global yet: fall back to a const-folded base
          // (e.g. es=0a000h -> +0xA0000) when the paragraph value is statically known.
          inner.segBase = (fn._segConst[op.seg] << 4) >>> 0;
        }
      }
      return inner;
    }
    return { kind: "const", value: 0 };
  }

  // True when a memory expression references a non-register identifier (a data
  // symbol or code label) — used to decide whether a segment base should fold in.
  function memHasSymbol(mem) {
    const toks = mem.exprTokens || [];
    return toks.some(t => t.type === "IDENT" && REG_TO_LOCAL[String(t.value).toLowerCase()] === undefined);
  }

  // Track `mov reg, imm` and `mov seg, reg/imm` to recover constant segment
  // bases. Conservative: unknown sources clear the tracked value.
  function trackMov(fn, operands) {
    if (!fn || operands.length < 2) return;
    fn._segConst = fn._segConst || {};
    fn._regConst = fn._regConst || {};
    const dst = operands[0], src = operands[1];
    const dn = dst && dst.kind === "reg" ? String(dst.name).toLowerCase() : null;
    if (dn && SREG_NAMES.has(dn)) {
      if (src.kind === "imm") fn._segConst[dn] = Number(src.value) | 0;
      else if (src.kind === "reg" && fn._regConst[String(src.name).toLowerCase()] !== undefined)
        fn._segConst[dn] = fn._regConst[String(src.name).toLowerCase()];
      else delete fn._segConst[dn];
      return;
    }
    if (dn && REG_TO_LOCAL[dn] !== undefined) {
      if (src.kind === "imm") fn._regConst[dn] = Number(src.value) | 0;
      else delete fn._regConst[dn];
    }
  }

  function emitBinaryMove(fn, operands) {
    if (operands.length < 2) return;
    const dst = operandToValue(fn, operands[0]);
    const src = operandToValue(fn, operands[1]);
    if (dst.kind === "mem") {
      // store. Size-prioriteit: 1) expliciete BYTE/WORD/DWORD PTR-hint, 2) src register-grootte, 3) default 16.
      let size;
      if (dst.sizeHint === "byte") size = 8;
      else if (dst.sizeHint === "dword") size = 32;
      else if (dst.sizeHint === "word") size = 16;
      else if (src.kind === "local" && src.size === 8) size = 8;
      else if (src.kind === "local" && src.size === 32) size = 32;
      else size = 16;
      addOp(fn, { op: "store", addr: dst, src, size });
      return;
    }
    if (src.kind === "mem") {
      let size;
      if (src.sizeHint === "byte") size = 8;
      else if (src.sizeHint === "dword") size = 32;
      else if (src.sizeHint === "word") size = 16;
      else if (dst.kind === "local" && dst.size === 8) size = 8;
      else if (dst.kind === "local" && dst.size === 32) size = 32;
      else size = 16;
      addOp(fn, { op: "load", dest: dst, addr: src, size });
      return;
    }
    addOp(fn, { op: "mov", dest: dst, src });
  }

  function emitArith(fn, op, operands) {
    if (operands.length < 2) return;
    const dst = operandToValue(fn, operands[0]);
    const src = operandToValue(fn, operands[1]);
    addOp(fn, { op, dest: dst, a: dst, b: src });
  }

  function emitShift(fn, op, operands) {
    if (operands.length < 2) return;
    const dst = operandToValue(fn, operands[0]);
    const count = operandToValue(fn, operands[1]);
    addOp(fn, { op, dest: dst, a: dst, count });
  }

  function emitCmp(fn, operands) {
    if (operands.length < 2) return;
    const a = operandToValue(fn, operands[0]);
    const b = operandToValue(fn, operands[1]);
    addOp(fn, { op: "cmp", a, b });
  }

  function emitTest(fn, operands) {
    if (operands.length < 2) return;
    const a = operandToValue(fn, operands[0]);
    const b = operandToValue(fn, operands[1]);
    addOp(fn, { op: "test", a, b });
  }

  function emitJump(fn, operands, cond) {
    if (operands.length < 1) return;
    const t = operands[0];
    const target = t.kind === "label" ? t.name : (t.kind === "imm" ? `__off_${t.value}` : "?");
    if (cond === null) addOp(fn, { op: "jump", target });
    else addOp(fn, { op: "jcond", cond, target });
  }

  function emitCall(fn, operands) {
    if (operands.length < 1) return addOp(fn, { op: "call", target: "?" });
    const t = operands[0];
    const target = t.kind === "label" ? t.name : "?";
    addOp(fn, { op: "call", target });
  }

  function emitPush(fn, operands) {
    if (operands.length < 1) return;
    const v = operandToValue(fn, operands[0]);
    addOp(fn, { op: "push", src: v });
  }

  function emitPop(fn, operands) {
    if (operands.length < 1) return;
    const dst = operandToValue(fn, operands[0]);
    addOp(fn, { op: "pop", dest: dst });
  }

  function emitIn(fn, operands) {
    // in al, port  OR  in al, dx
    if (operands.length < 2) return;
    const dst  = operandToValue(fn, operands[0]);
    const port = operandToValue(fn, operands[1]);
    addOp(fn, { op: "in", dest: dst, port });
  }

  function emitOut(fn, operands) {
    // out port, al   OR  out dx, al
    if (operands.length < 2) return;
    const port = operandToValue(fn, operands[0]);
    const src  = operandToValue(fn, operands[1]);
    addOp(fn, { op: "out", port, src });
  }

  function emitNeg(fn, operands) {
    if (operands.length < 1) return;
    const dst = operandToValue(fn, operands[0]);
    addOp(fn, { op: "sub", dest: dst, a: { kind: "const", value: 0 }, b: dst });
  }

  function emitBitNot(fn, operands) {
    if (operands.length < 1) return;
    const dst = operandToValue(fn, operands[0]);
    // not = xor with 0xFFFF
    addOp(fn, { op: "xor", dest: dst, a: dst, b: { kind: "const", value: 0xFFFF } });
  }

  function emitXchg(fn, operands) {
    if (operands.length < 2) return;
    const a = operandToValue(fn, operands[0]);
    const b = operandToValue(fn, operands[1]);
    addOp(fn, { op: "xchg", a, b });
  }

  function emitMulDiv(fn, kind, operands) {
    // mul/div have implicit AX/DX:AX operand. We emit a single op.
    addOp(fn, { op: kind, src: operandToValue(fn, operands[0]) });
  }

  function emitRotate(fn, kind, operands) {
    if (operands.length < 2) return;
    addOp(fn, {
      op: kind, dest: operandToValue(fn, operands[0]),
      a: operandToValue(fn, operands[0]),
      count: operandToValue(fn, operands[1]),
    });
  }

  function emitLoop(fn, operands) {
    // loop label: cx--; if cx != 0 jump to label.
    if (operands.length < 1) return;
    const t = operands[0];
    const target = t.kind === "label" ? t.name : "?";
    addOp(fn, { op: "loop_dec_cx", target });
  }

  function emitPushAll(fn) {
    for (const r of ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"]) {
      addOp(fn, { op: "push", src: operandToValue(fn, { kind: "reg", name: r }) });
    }
  }

  function emitPopAll(fn) {
    for (const r of ["di", "si", "bp", "sp", "bx", "dx", "cx", "ax"]) {
      addOp(fn, { op: "pop", dest: operandToValue(fn, { kind: "reg", name: r }) });
    }
  }

  function emitInt(fn, operands) {
    if (operands.length < 1) return addOp(fn, { op: "int", num: 0 });
    const num = operands[0].kind === "imm" ? Number(operands[0].value) : 0;
    addOp(fn, { op: "int", num });
  }

  // Finalize stats.
  mod.stats.unknownMnemonics = Array.from(mod.stats.unknownMnemonics).sort();
  return mod;
}

/** Pretty-print IR (for debugging + .ir.txt artefacts). */
export function dumpIR(mod) {
  const lines = [];
  lines.push(`; IR module: ${mod.name}`);
  lines.push(`; functions: ${mod.functions.length}, data: ${mod.data.length}, ops: ${mod.stats.ops}, unknown: ${mod.stats.unknownOps}`);
  if (mod.stats.unknownMnemonics.length) {
    lines.push(`; unknown mnemonics: ${mod.stats.unknownMnemonics.join(", ")}`);
  }
  for (const fn of mod.functions) {
    lines.push("");
    lines.push(`function ${fn.name} (${fn.attr}) locals=${fn.locals.count}`);
    for (const op of fn.ops) {
      lines.push("  " + formatOp(op));
    }
  }
  if (mod.data.length) {
    lines.push("");
    lines.push("; data:");
    for (const d of mod.data) {
      lines.push(`  ${d.name || "<anon>"}  ${d.size}  ${JSON.stringify(d.items)}`);
    }
  }
  return lines.join("\n") + "\n";
}

function formatOp(op) {
  switch (op.op) {
    case "label":   return `.${op.name}:`;
    case "const":   return `${fmtVal(op.dest)} = const ${op.value}`;
    case "mov":     return `${fmtVal(op.dest)} = ${fmtVal(op.src)}`;
    case "load":    return `${fmtVal(op.dest)} = load.u${op.size} ${fmtVal(op.addr)}`;
    case "store":   return `store.u${op.size} ${fmtVal(op.addr)}, ${fmtVal(op.src)}`;
    case "add":
    case "sub":
    case "and":
    case "or":
    case "xor":     return `${fmtVal(op.dest)} = ${op.op} ${fmtVal(op.a)}, ${fmtVal(op.b)}`;
    case "shl":
    case "shr":
    case "sar":
    case "rol":
    case "ror":
    case "rcl":
    case "rcr":     return `${fmtVal(op.dest)} = ${op.op} ${fmtVal(op.a)}, ${fmtVal(op.count)}`;
    case "cmp":     return `cmp ${fmtVal(op.a)}, ${fmtVal(op.b)}`;
    case "test":    return `test ${fmtVal(op.a)}, ${fmtVal(op.b)}`;
    case "jump":    return `jump .${op.target}`;
    case "jcond":   return `j${op.cond} .${op.target}`;
    case "call":    return `call ${op.target}`;
    case "ret":     return `ret`;
    case "push":    return `push ${fmtVal(op.src)}`;
    case "pop":     return `pop ${fmtVal(op.dest)}`;
    case "in":      return `${fmtVal(op.dest)} = io.in ${fmtVal(op.port)}`;
    case "out":     return `io.out ${fmtVal(op.port)}, ${fmtVal(op.src)}`;
    case "int":     return `int 0x${op.num.toString(16)}`;
    case "nop":     return `nop${op.note ? " ; " + op.note : ""}`;
    case "flagop":  return `${op.which}`;
    case "xchg":    return `xchg ${fmtVal(op.a)}, ${fmtVal(op.b)}`;
    case "mul":
    case "imul":
    case "div":
    case "idiv":    return `${op.op} ${fmtVal(op.src)}`;
    case "loop_dec_cx": return `loop_dec_cx .${op.target}`;
    case "unknown": return `; UNKNOWN ${op.mnemonic} ${op.operands.length} operands`;
    default:        return `; ?? ${JSON.stringify(op)}`;
  }
}
function fmtVal(v) {
  if (!v) return "?";
  if (v.kind === "local") return v.isHigh ? `r${v.index}.h` : (v.size === 8 ? `r${v.index}.l` : `r${v.index}`);
  if (v.kind === "const") return `0x${(v.value >>> 0).toString(16)}`;
  if (v.kind === "sym")   return `@${v.name}`;
  if (v.kind === "mem")   return `${v.segReg ? v.segReg + ":" : ""}[${v.exprText}]`;
  return JSON.stringify(v);
}
