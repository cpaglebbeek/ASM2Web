/**
 * IR -> WASM codegen.
 *
 * Strategie:
 *   - Elke IR-functie -> één WASM-functie (van geen-args naar geen-return).
 *   - Cross-function `call procname` -> WASM `call $procname` opcode.
 *   - Intra-function jumps -> dispatch-loop met br_table over basic blocks.
 *   - Push/pop -> shadow-stack in linear memory; SP-local = LOCAL_SP.
 *   - Per function: SP initialiseerd op STACK_TOP bij eerste binnenkomst
 *     (via een one-shot guard om re-entry te ondersteunen).
 *
 * Linear-memory layout:
 *   0x00000..0x0FFFF  data (klein-model)
 *   0x10000..0x8FFFF  RAM
 *   0x90000           STACK_TOP (groeit naar beneden)
 *   0xA0000..0xAFFFF  VGA mode-13h framebuffer (64 KiB)
 *   0xB0000..0xFFFFF  reserved
 */
"use strict";

import {
  buildModule, InstrBuilder, ValType, ExternalKind, Op, BlockType,
  sleb128,
} from "./wasm-encode.js";

import {
  LOCAL_AX, LOCAL_BX, LOCAL_CX, LOCAL_DX, LOCAL_SI, LOCAL_DI, LOCAL_BP, LOCAL_SP,
  LOCAL_ZF, LOCAL_CF, LOCAL_SF, LOCAL_OF, NUM_FIXED_LOCALS,
  STACK_TOP,
} from "../ir/types.js";

const ABI_IMPORTS = [
  { name: "io_out",            params: [ValType.i32, ValType.i32], results: [] },
  { name: "io_in",             params: [ValType.i32],              results: [ValType.i32] },
  { name: "exit",              params: [ValType.i32],              results: [] },
  { name: "mode13h_setpixel",  params: [ValType.i32, ValType.i32, ValType.i32], results: [] },
  { name: "dis_musrow",        params: [],                         results: [ValType.i32] },
  { name: "waitb",             params: [],                         results: [] },
  { name: "dis_init",          params: [ValType.i32, ValType.i32], results: [] },
  { name: "dis_waitb",         params: [],                         results: [] },
];

const FN_IO_OUT = 0;
const FN_IO_IN  = 1;
const FN_EXIT   = 2;
const FN_SETPIX = 3;
const FN_MUSROW = 4;
const FN_WAITB  = 5;
const FN_DIS_INIT  = 6;
const FN_DIS_WAITB = 7;

/**
 * Naming-collision-safe: convert IR-function-name -> WASM-export-name.
 * Strip underscores at start (TASM externs often have leading `_`).
 */
function sanitize(name) {
  return name.replace(/^_+/, "") || "main";
}

/**
 * @param {IRModule} ir
 * @returns {{ wasm: Uint8Array, layout: object }}
 */
export function compileIRtoWASM(ir) {
  // ----- type table -----
  const types = [];
  function typeOf(params, results) {
    const key = `${params.join(",")}->${results.join(",")}`;
    let idx = types.findIndex(t => `${t.params.join(",")}->${t.results.join(",")}` === key);
    if (idx === -1) { idx = types.length; types.push({ params, results }); }
    return idx;
  }
  for (const a of ABI_IMPORTS) typeOf(a.params, a.results);
  const TYPE_VOID = typeOf([], []);

  // ----- function index map -----
  // imports first (0..ABI_IMPORTS.length-1), then user functions.
  const userFnIndex = new Map(); // ir-name -> wasm fn index
  ir.functions.forEach((fn, i) => userFnIndex.set(fn.name, ABI_IMPORTS.length + i));

  // ----- emit per function -----
  const wasmFns = ir.functions.map((fn, fnIdx) => emitFunction(fn, userFnIndex, TYPE_VOID));

  // ----- build module -----
  const spec = {
    types,
    imports: [
      { module: "env", name: "memory", kind: "memory", min: 16, max: 16 },
      ...ABI_IMPORTS.map(a => ({
        module: "env", name: a.name, kind: "function",
        typeIndex: typeOf(a.params, a.results),
      })),
    ],
    exports: wasmFns.map(f => ({
      name: f.exportName,
      kind: "function",
      index: f.wasmIndex,
    })),
    start: null,
    functions: wasmFns.map(f => ({ typeIndex: f.typeIndex, locals: f.locals, body: f.body })),
    data: ir.data.map(emitDataSegment).filter(Boolean),
  };

  const wasm = buildModule(spec);

  return {
    wasm,
    layout: {
      types,
      imports: spec.imports.map(i => `${i.module}.${i.name} (${i.kind})`),
      exports: spec.exports.map(e => `${e.name} -> fn#${e.index}`),
      memoryPages: 16,
      stats: ir.stats,
    },
  };
}

// ============================================================================
// per-function emission
// ============================================================================

function emitFunction(fn, userFnIndex, voidTypeIndex) {
  const exportName = sanitize(fn.name);
  const wasmIndex  = userFnIndex.get(fn.name);

  // Compute basic blocks: each label-op starts a new block; first op = block 0.
  // Build pc -> block-index map.
  const blocks = [];
  let currentBlock = { startPc: 0, ops: [], labels: [] };
  blocks.push(currentBlock);

  for (let pc = 0; pc < fn.ops.length; pc++) {
    const op = fn.ops[pc];
    if (op.op === "label" && pc > 0) {
      currentBlock = { startPc: pc, ops: [], labels: [] };
      blocks.push(currentBlock);
    }
    if (op.op === "label") {
      currentBlock.labels.push(op.name);
    }
    currentBlock.ops.push(op);
  }

  // Map label-name -> block-index for jump-resolution.
  const labelBlockIdx = new Map();
  for (let bi = 0; bi < blocks.length; bi++) {
    for (const lbl of blocks[bi].labels) labelBlockIdx.set(lbl, bi);
  }

  const PC_LOCAL = fn.locals.count;          // dispatcher PC
  const SP_INIT_GUARD = fn.locals.count + 1; // 0=uninitialised, 1=initialised
  const TMP1 = fn.locals.count + 2;          // tmp for swap/push helpers
  const TMP2 = fn.locals.count + 3;
  const totalLocals = fn.locals.count + 4;

  const locals = [{ count: totalLocals, type: ValType.i32 }];

  const hasControlFlow = fn.ops.some(o => o.op === "jump" || o.op === "jcond" || o.op === "ret" || (o.op === "label" && o !== fn.ops[0]));
  const needsDispatch  = blocks.length > 1;

  const b = new InstrBuilder();

  // ------ function entry: init SP if first call ------
  // if ($sp_init == 0) { $sp = STACK_TOP; $sp_init = 1 }
  b.localGet(SP_INIT_GUARD);
  b.eqz();
  b.if_();
    b.i32Const(STACK_TOP);
    b.localSet(LOCAL_SP);
    b.i32Const(1);
    b.localSet(SP_INIT_GUARD);
  b.end();

  if (!needsDispatch) {
    // Single basic block: straight-line emission.
    for (const op of blocks[0].ops) {
      emitOp(b, op, fn, labelBlockIdx, /*pcLocal*/PC_LOCAL, /*tmps*/{TMP1,TMP2}, userFnIndex);
    }
    // Implicit ret (already in ir, or fallback).
    if (!blocks[0].ops.length || blocks[0].ops[blocks[0].ops.length-1].op !== "ret") {
      b.ret();
    }
  } else {
    // Multi-block: dispatch loop.
    //
    //   $pc = 0
    //   loop $main
    //     block $exit
    //       block $L_{n-1}
    //         ...
    //           block $L_0
    //             local.get $pc
    //             br_table $L_0 $L_1 ... $L_{n-1} $exit
    //           end (L_0)
    //           ;; L_0 body
    //         end (L_1)
    //         ;; L_1 body
    //         ...
    //       end (L_{n-1})
    //       ;; L_{n-1} body
    //     end ($exit)
    //   end ($main)
    //
    // Body of block $L_i contains the ops for block i, plus an explicit
    // jump/fall-through to next-block-or-exit.
    b.i32Const(0); b.localSet(PC_LOCAL);
    b.loop(BlockType.void);                  // $main, depth 0
      b.block(BlockType.void);               // $exit, depth 1
        // Open N nested blocks: outermost = block N-1, innermost = block 0.
        for (let k = 0; k < blocks.length; k++) b.block(BlockType.void);
        // br_table:
        b.localGet(PC_LOCAL);
        // br_table operands: number of labels, then labels, then default.
        b.emit(Op.br_table);
        b.uleb(blocks.length);                // count
        for (let k = 0; k < blocks.length; k++) {
          // labels are 0..blocks.length-1 from innermost outward;
          // index 0 = innermost = block 0 (smallest depth from current pos).
          // After br_table, br to label L_k means jump out of $L_k.
          // Inside the innermost-most block: depth-0 = innermost, depth-1 = next...
          // So branch target k = depth k (innermost = L_0 = depth 0).
          b.uleb(k);
        }
        b.uleb(blocks.length);                // default = $exit (depth = blocks.length)
        b.end();                              // close innermost (L_0) — fall-through enters block-0 body

        // Emit each block's body:
        // After body-i runs, we hit the next `end` which closes either L_{i+1}
        // (for i < N-1) or $exit (for i == N-1). So we emit exactly N closes
        // here — no separate $exit-close after the for-loop.
        for (let bi = 0; bi < blocks.length; bi++) {
          const blk = blocks[bi];
          let endedExplicitly = false;
          for (const op of blk.ops) {
            const ended = emitOpInBlock(b, op, fn, labelBlockIdx, PC_LOCAL, {TMP1,TMP2}, userFnIndex, blocks.length, bi);
            if (ended) { endedExplicitly = true; break; }
          }
          if (!endedExplicitly) {
            // Fall-through to next block: set pc to bi+1 and continue dispatch via $main.
            // Last block falls through naturally to $exit.
            if (bi + 1 < blocks.length) {
              b.i32Const(bi + 1);
              b.localSet(PC_LOCAL);
              // Depth to $main: number of L-blocks remaining to be closed + $exit + $main
              // Inside this body, current enclosing nesting (from innermost out):
              //   L_{bi+1} (next close), L_{bi+2}, ..., L_{N-1}, $exit, $main
              // That's (blocks.length - bi - 1) L-blocks + $exit + $main = blocks.length - bi + 1.
              // br $main = depth from innermost = blocks.length - bi.
              b.br(blocks.length - bi);
            }
            // For bi == N-1: do nothing — natural fall-through to $exit-end (which
            // is this iteration's b.end() below).
          }
          b.end();
        }
    b.end();                                  // close $main loop
    // After exit: function returns.
  }

  return {
    exportName,
    wasmIndex,
    typeIndex: voidTypeIndex,
    locals,
    body: b.toArray(),
  };
}

// ============================================================================
// op emission
// ============================================================================

/** Emit an op in straight-line mode (no block-nesting awareness). */
function emitOp(b, op, fn, labelBlockIdx, pcLocal, tmps, userFnIndex) {
  switch (op.op) {
    case "label":
    case "nop":
    case "flagop":
      b.nop();
      return;
    case "mov":      return emitMov(b, op, tmps);
    case "const":    b.i32Const(op.value | 0); storeTo(b, op.dest, tmps); return;
    case "add":
    case "sub":
    case "and":
    case "or":
    case "xor":
    case "shl":
    case "shr":
    case "sar":
    case "rol":
    case "ror":
    case "rcl":
    case "rcr":      return emitArith(b, op, tmps);
    case "xchg":     return emitXchg(b, op, tmps);
    case "mul":
    case "imul":     return emitMul(b, op, tmps);
    case "div":
    case "idiv":     return emitDiv(b, op, tmps);
    case "loop_dec_cx": return emitLoopDecCx(b, op, tmps);
    case "cmp":
    case "test":     return emitCmpTest(b, op, tmps);
    case "store":    return emitStore(b, op, tmps);
    case "load":     return emitLoad(b, op, tmps);
    case "out":      pushValue(b, op.port, tmps); pushValue(b, op.src, tmps); b.call(FN_IO_OUT); return;
    case "in":       pushValue(b, op.port, tmps); b.call(FN_IO_IN); storeTo(b, op.dest, tmps); return;
    case "int":
      if (op.num === 0x21) { b.i32Const(0); b.call(FN_EXIT); b.ret(); }
      else { b.i32Const(0xFF); b.call(FN_EXIT); b.ret(); }
      return;
    case "push":     pushValue(b, op.src, tmps); doPush(b); return;
    case "pop":      doPop(b); storeTo(b, op.dest, tmps); return;
    case "ret":      b.ret(); return;
    case "call": {
      const wasmIdx = userFnIndex.get(op.target) ?? userFnIndex.get("_" + op.target);
      if (wasmIdx !== undefined) b.call(wasmIdx);
      else b.nop();   // unresolved — silent no-op
      return;
    }
    case "jump":
    case "jcond":
    case "unknown":
      // In straight-line mode these shouldn't be emitted; ignore safely.
      b.nop();
      return;
    default:         b.nop(); return;
  }
}

/**
 * Emit an op inside a dispatch-block. Returns `true` if the op terminated
 * the block (jump/ret), so the caller skips the auto-fall-through.
 */
function emitOpInBlock(b, op, fn, labelBlockIdx, pcLocal, tmps, userFnIndex, totalBlocks, blockIdx) {
  switch (op.op) {
    case "jump": {
      const target = labelBlockIdx.get(op.target);
      if (target === undefined) { b.nop(); return false; }
      b.i32Const(target);
      b.localSet(pcLocal);
      // Open blocks at this point (innermost outward): L_{blockIdx+1}..L_{N-1}, $exit, $main.
      // L_{blockIdx} is already closed (its body started AFTER its end-opcode).
      // br to $main = depth = (N - blockIdx - 1) L-blocks + 1 ($exit) = N - blockIdx.
      b.br(totalBlocks - blockIdx);
      return true;
    }
    case "jcond": {
      const target = labelBlockIdx.get(op.target);
      if (target === undefined) { b.nop(); return false; }
      pushFlag(b, op.cond);
      b.if_(BlockType.void);
        b.i32Const(target);
        b.localSet(pcLocal);
        // Add 1 for the $if we just opened.
        b.br(totalBlocks - blockIdx + 1);
      b.end();
      return false;
    }
    case "ret": {
      // Return from function: br to $exit (then fall out of $main = function returns).
      // $exit at depth = (N - blockIdx - 1) L-blocks above us = N - blockIdx - 1.
      b.br(totalBlocks - blockIdx - 1);
      return true;
    }
    case "int":
      if (op.num === 0x21) {
        b.i32Const(0);
        b.call(FN_EXIT);
        b.br(totalBlocks - blockIdx - 1);
        return true;
      }
      b.i32Const(0xFF);
      b.call(FN_EXIT);
      return false;
    default:
      emitOp(b, op, fn, labelBlockIdx, pcLocal, tmps, userFnIndex);
      return false;
  }
}

// ============================================================================
// op helpers
// ============================================================================

function emitMov(b, op, tmps) {
  const src = op.src;
  const dst = op.dest;
  if (dst.kind === "mem") {
    emitStore(b, { addr: dst, src, size: inferSize(dst, src) }, tmps);
    return;
  }
  if (src.kind === "mem") {
    emitLoad(b, { addr: src, dest: dst, size: inferSize(src, dst) }, tmps);
    return;
  }
  pushValue(b, src, tmps);
  storeTo(b, dst, tmps);
}

function inferSize(memOp, otherOp) {
  if (memOp.sizeHint === "byte") return 8;
  if (memOp.sizeHint === "word") return 16;
  if (memOp.sizeHint === "dword") return 32;
  if (otherOp && otherOp.kind === "local") {
    if (otherOp.size === 8)  return 8;
    if (otherOp.size === 32) return 32;
  }
  return 16;
}

function emitArith(b, op, tmps) {
  pushValue(b, op.a, tmps);
  pushValue(b, op.b || op.count, tmps);
  switch (op.op) {
    case "add": b.add(); break;
    case "sub": b.sub(); break;
    case "and": b.and(); break;
    case "or":  b.or();  break;
    case "xor": b.xor(); break;
    case "shl": b.shl(); break;
    case "shr": b.shrU(); break;
    case "sar": b.emit(Op.i32_shr_s); break;
    case "rol":
    case "rcl": b.emit(Op.i32_rotl); break;
    case "ror":
    case "rcr": b.emit(Op.i32_rotr); break;
  }
  b.localTee(tmps.TMP1);
  b.eqz();
  b.localSet(LOCAL_ZF);
  b.localGet(tmps.TMP1);
  storeTo(b, op.dest, tmps);
}

function emitXchg(b, op, tmps) {
  // tmp = a; a = b; b = tmp
  pushValue(b, op.a, tmps);
  b.localSet(tmps.TMP1);
  pushValue(b, op.b, tmps);
  storeTo(b, op.a, tmps);
  b.localGet(tmps.TMP1);
  storeTo(b, op.b, tmps);
}

function emitMul(b, op, tmps) {
  // AX = AL * src  (8-bit) or DX:AX = AX * src (16-bit)
  // Approximation: AX = AX * src (16-bit result truncated)
  b.localGet(LOCAL_AX);
  b.i32Const(0xFFFF); b.and();
  pushValue(b, op.src, tmps);
  b.mul();
  storeTo(b, { kind: "local", index: LOCAL_AX, size: 16 }, tmps);
}

function emitDiv(b, op, tmps) {
  // AX = AX / src  (8-bit divide)
  // Approximation: AX = AX / src
  b.localGet(LOCAL_AX);
  b.i32Const(0xFFFF); b.and();
  pushValue(b, op.src, tmps);
  if (op.op === "idiv") b.emit(Op.i32_div_s);
  else b.emit(Op.i32_div_u);
  storeTo(b, { kind: "local", index: LOCAL_AX, size: 16 }, tmps);
}

function emitLoopDecCx(b, op, tmps) {
  // CX--; if (CX != 0) goto target — handled by control-flow caller.
  // We just emit CX decrement here; the actual jump must come from the dispatcher.
  // For now, decrement CX. In multi-block mode, parser-emit translates `loop`
  // to two IR ops: dec_cx + jcond(nzf). But our current emitter emits as a single
  // op, so we just decrement here without jumping (best-effort).
  b.localGet(LOCAL_CX);
  b.i32Const(1); b.sub();
  b.i32Const(0xFFFF); b.and();
  b.localSet(LOCAL_CX);
}

function emitCmpTest(b, op, tmps) {
  pushValue(b, op.a, tmps);
  pushValue(b, op.b, tmps);
  if (op.op === "cmp") b.sub();
  else b.and();
  b.eqz();
  b.localSet(LOCAL_ZF);
}

function emitStore(b, op, tmps) {
  const sz = op.size || 16;
  // Compute address.
  if (op.addr.kind === "mem") {
    b.i32Const(0);  // base
    const lit = parseMemExpr(op.addr) | 0;
    pushValue(b, op.src, tmps);
    if (sz === 8)       b.store8(0, lit);
    else if (sz === 32) b.store(0, lit);
    else                b.store16(0, lit);
    return;
  }
  if (op.addr.kind === "const") {
    b.i32Const(0);
    pushValue(b, op.src, tmps);
    if (sz === 8)       b.store8(0, op.addr.value | 0);
    else if (sz === 32) b.store(0, op.addr.value | 0);
    else                b.store16(0, op.addr.value | 0);
    return;
  }
  if (op.addr.kind === "local") {
    b.localGet(op.addr.index);
    pushValue(b, op.src, tmps);
    if (sz === 8)       b.store8(0, 0);
    else if (sz === 32) b.store(0, 0);
    else                b.store16(0, 0);
    return;
  }
  // Fallback drop.
  pushValue(b, op.src, tmps);
  b.drop();
}

function emitLoad(b, op, tmps) {
  const sz = op.size || 16;
  if (op.addr.kind === "mem") {
    b.i32Const(0);
    const lit = parseMemExpr(op.addr) | 0;
    if (sz === 8)       b.load8U(0, lit);
    else if (sz === 32) b.load(0, lit);
    else                b.load16U(0, lit);
  } else if (op.addr.kind === "const") {
    b.i32Const(0);
    if (sz === 8)       b.load8U(0, op.addr.value | 0);
    else if (sz === 32) b.load(0, op.addr.value | 0);
    else                b.load16U(0, op.addr.value | 0);
  } else if (op.addr.kind === "local") {
    b.localGet(op.addr.index);
    if (sz === 8)       b.load8U(0, 0);
    else if (sz === 32) b.load(0, 0);
    else                b.load16U(0, 0);
  } else {
    b.i32Const(0);
  }
  storeTo(b, op.dest, tmps);
}

// Shadow-stack helpers.
// Push pops top-of-stack and writes to mem16[SP-2]; SP -= 2.
function doPush(b) {
  // stack: [value]
  // need: store16 at SP-2, then SP-=2
  // Sequence: tee value -> TMP, sp-=2, load_value, store16
  // Simpler:  sp -= 2; mem16[sp] = value
  // Use:  local.get sp; i32.const 2; i32.sub; local.tee sp; local.get value; i32.store16
  // But value is already on stack. We need address first, then value, then store.
  // Trick: capture value via local.
  // Reorder with a tmp: (value already top)
  //   localSet $tmp        ; pop value to tmp
  //   localGet $sp
  //   i32.const 2
  //   i32.sub
  //   localTee $sp
  //   localGet $tmp
  //   i32.store16 0 0
  // We use a fixed tmp register (TMP1 via emitArith may conflict — emit local).
  // For simplicity use a unique local: we won't collide with TMP1 because push/pop
  // are sequential. But to be safe use TMP2.
  // (Caller must pass TMP2 via tmps object; we have tmps in scope.)
  // -- here we use a literal index, but since this fn is internal we know we're
  //    being called from emitOp which has tmps.TMP2 = fn.locals.count + 3.
  // To avoid global state, we accept a known local index for push tmp.
  // For now: hard-code via a passed param — but doPush is currently param-less.
  // -> Just use TMP2 by convention (last fixed scratch).
  // Simpler approach: keep push/pop param-less and use a fixed offset based on
  // assumption set in emitFunction.  Caller MUST ensure totalLocals includes them.
  // We don't have tmps here. Hack: inline a sequence that uses i32 stack only:
  //   value is at TOS. Use store at variable address by swapping.
  // Actually best: change signature. Let me just rewrite to use Op-level swap via
  // local at fixed index 16 (after fixed=12 + PC + SP_INIT_GUARD + TMP1 + TMP2 = 16).
  // Wait we allocated TMP1 = fixed.count+2 and TMP2 = fixed.count+3, with
  // fn.locals.count = NUM_FIXED_LOCALS = 12. So PC=12, SP_INIT_GUARD=13, TMP1=14, TMP2=15.
  const TMP_PUSH = 15; // matches TMP2 allocation in emitFunction (fn.locals.count + 3 with count=12)
  b.localSet(TMP_PUSH);
  b.localGet(LOCAL_SP);
  b.i32Const(2);
  b.sub();
  b.localTee(LOCAL_SP);
  b.localGet(TMP_PUSH);
  b.emit(Op.i32_store16); b.uleb(0); b.uleb(0);
}

function doPop(b) {
  // result = mem16[SP], SP += 2
  b.localGet(LOCAL_SP);
  b.emit(Op.i32_load16_u); b.uleb(0); b.uleb(0);
  // result on stack now — bump SP
  // need to keep result, so capture and restore
  const TMP_POP = 15;
  b.localSet(TMP_POP);
  b.localGet(LOCAL_SP);
  b.i32Const(2);
  b.add();
  b.localSet(LOCAL_SP);
  b.localGet(TMP_POP);
}

// Flag retrieval for jcond.
function pushFlag(b, cond) {
  switch (cond) {
    case "zf":  b.localGet(LOCAL_ZF); break;
    case "nzf": b.localGet(LOCAL_ZF); b.eqz(); break;
    case "cf":  b.localGet(LOCAL_CF); break;
    case "ncf": b.localGet(LOCAL_CF); b.eqz(); break;
    case "sf":  b.localGet(LOCAL_SF); break;
    case "nsf": b.localGet(LOCAL_SF); b.eqz(); break;
    default:    b.i32Const(0);
  }
}

function pushValue(b, v, tmps) {
  if (!v) { b.i32Const(0); return; }
  switch (v.kind) {
    case "const": b.i32Const(v.value | 0); return;
    case "local":
      b.localGet(v.index);
      if (v.size === 8 && v.isHigh) {
        b.i32Const(8); b.shrU();
        b.i32Const(0xFF); b.and();
      } else if (v.size === 8) {
        b.i32Const(0xFF); b.and();
      } else if (v.size === 16) {
        b.i32Const(0xFFFF); b.and();
      }
      return;
    case "sym":
      // unresolved symbol -> 0 (todo: data-segment offsets)
      b.i32Const(0);
      return;
    case "mem":
      b.i32Const(0);
      b.load16U(0, parseMemExpr(v) | 0);
      return;
    default:
      b.i32Const(0);
      return;
  }
}

function storeTo(b, v, tmps) {
  if (!v) { b.drop(); return; }
  if (v.kind === "local") {
    if (v.size === 8 && v.isHigh) {
      // value on top. We want: existing = (existing & 0x00FF) | ((value & 0xFF) << 8)
      // Use TMP to swap order.
      b.localSet(tmps.TMP1);                    // tmp = new value
      b.localGet(v.index); b.i32Const(0x00FF); b.and();
      b.localGet(tmps.TMP1); b.i32Const(0xFF); b.and(); b.i32Const(8); b.shl();
      b.or();
      b.localSet(v.index);
      return;
    }
    if (v.size === 8) {
      // value on top. (existing & 0xFF00) | (new & 0xFF)
      b.localSet(tmps.TMP1);
      b.localGet(v.index); b.i32Const(0xFF00); b.and();
      b.localGet(tmps.TMP1); b.i32Const(0xFF); b.and();
      b.or();
      b.localSet(v.index);
      return;
    }
    // 16-bit: mask to low 16
    b.i32Const(0xFFFF); b.and();
    b.localSet(v.index);
    return;
  }
  b.drop();
}

function parseMemExpr(memOperand) {
  if (!memOperand.exprTokens) return 0;
  const toks = memOperand.exprTokens.filter(t => t.type !== "WS");
  let i = 0;
  function parseTerm() {
    let v = parsePrimary();
    while (i < toks.length) {
      const t = toks[i];
      if (t.type === "PUNCT" && (t.value === "*" || t.value === "/")) {
        i++;
        const r = parsePrimary();
        v = t.value === "*" ? v * r : Math.trunc(v / r);
      } else break;
    }
    return v;
  }
  function parseExpr() {
    let v = parseTerm();
    while (i < toks.length) {
      const t = toks[i];
      if (t.type === "PUNCT" && (t.value === "+" || t.value === "-")) {
        i++;
        const r = parseTerm();
        v = t.value === "+" ? v + r : v - r;
      } else break;
    }
    return v;
  }
  function parsePrimary() {
    const t = toks[i++];
    if (!t) return 0;
    if (t.type === "NUMBER") return Number(t.value) | 0;
    if (t.type === "IDENT")  return 0;
    if (t.type === "PUNCT" && t.value === "-") return -parsePrimary();
    if (t.type === "PUNCT" && t.value === "(") {
      const v = parseExpr();
      if (toks[i] && toks[i].type === "PUNCT" && toks[i].value === ")") i++;
      return v;
    }
    return 0;
  }
  return parseExpr() | 0;
}

function emitDataSegment(d, idx) {
  if (!d || !d.items || !d.items.length) return null;
  const bytes = [];
  for (const it of d.items) appendDataItem(bytes, it, d.size);
  if (!bytes.length) return null;
  return { offset: 0x1000 + idx * 0x100, bytes };
}

function appendDataItem(out, it, size) {
  switch (it.kind) {
    case "num": {
      const v = Number(it.value) | 0;
      if (size === "db") out.push(v & 0xFF);
      else if (size === "dw") { out.push(v & 0xFF); out.push((v >> 8) & 0xFF); }
      else if (size === "dd") {
        out.push(v & 0xFF); out.push((v >> 8) & 0xFF);
        out.push((v >> 16) & 0xFF); out.push((v >> 24) & 0xFF);
      }
      return;
    }
    case "str":
      for (let k = 0; k < it.value.length; k++) out.push(it.value.charCodeAt(k) & 0xFF);
      return;
    case "dup": {
      const n = Number(it.count) | 0;
      const before = out.length;
      appendDataItem(out, it.inner, size);
      const piece = out.slice(before);
      for (let k = 1; k < n; k++) out.push(...piece);
      return;
    }
    case "uninit":
    case "ref":
    case "raw": {
      const n = size === "db" ? 1 : size === "dw" ? 2 : 4;
      for (let k = 0; k < n; k++) out.push(0);
      return;
    }
    default: return;
  }
}
