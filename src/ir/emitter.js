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
  REG_TO_LOCAL, REG_IS_HIGH_BYTE, REG_SIZE, NUM_FIXED_LOCALS,
  LOCAL_AX, LOCAL_BX, LOCAL_CX, LOCAL_DX, LOCAL_SI, LOCAL_DI, LOCAL_BP, LOCAL_SP,
  LOCAL_ZF, LOCAL_CF, LOCAL_SF, LOCAL_OF,
} from "./types.js";

import { NODE } from "../tasm/parser.js";

/**
 * @param {Module} ast  output of parser.parse()
 * @param {{name?:string, entry?:string}} [opts]
 */
export function emitIR(ast, opts = {}) {
  const mod = newModule(opts.name || ast.file || "module");
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

    switch (mn) {
      case "mov":   return emitBinaryMove(fn, operands);
      case "add":   return emitArith(fn, "add", operands);
      case "sub":   return emitArith(fn, "sub", operands);
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
      case "stc":   return addOp(fn, { op: "flagop", which: mn });
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
      const li = REG_TO_LOCAL[op.name];
      if (li === undefined) return { kind: "const", value: 0 };
      return { kind: "local", index: li, size: REG_SIZE[op.name] || 16, isHigh: !!REG_IS_HIGH_BYTE[op.name] };
    }
    if (op.kind === "imm") {
      return { kind: "const", value: Number(op.value) | 0 };
    }
    if (op.kind === "label") {
      return { kind: "sym", name: op.name };
    }
    if (op.kind === "mem") {
      return { kind: "mem", exprText: op.exprText, exprTokens: op.exprTokens, sizeHint: op.sizeHint };
    }
    if (op.kind === "segref") {
      // Flat-mapping: ignore segment prefix in fase 1 IR-emitter.
      return operandToValue(fn, op.inner);
    }
    return { kind: "const", value: 0 };
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
    case "shr":     return `${fmtVal(op.dest)} = ${op.op} ${fmtVal(op.a)}, ${fmtVal(op.count)}`;
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
    case "nop":     return `nop`;
    case "flagop":  return `${op.which}`;
    case "unknown": return `; UNKNOWN ${op.mnemonic} ${op.operands.length} operands`;
    default:        return `; ?? ${JSON.stringify(op)}`;
  }
}
function fmtVal(v) {
  if (!v) return "?";
  if (v.kind === "local") return v.isHigh ? `r${v.index}.h` : (v.size === 8 ? `r${v.index}.l` : `r${v.index}`);
  if (v.kind === "const") return `0x${(v.value >>> 0).toString(16)}`;
  if (v.kind === "sym")   return `@${v.name}`;
  if (v.kind === "mem")   return `[${v.exprText}]`;
  return JSON.stringify(v);
}
