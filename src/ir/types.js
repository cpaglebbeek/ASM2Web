/**
 * IR — Intermediate Representation tussen TASM-AST en WASM-codegen.
 *
 * Vlakke instructie-lijst per functie. Geen SSA-passes — instructies refereren
 * naar virtuele 'locals' die 1:1 corresponderen met x86-registers + flag-bits.
 * Dit houdt de mapping naar WASM rechtstreeks (geen register-allocator nodig).
 *
 * Locals (per functie, vaste index-volgorde):
 *   0: ax    1: bx    2: cx    3: dx
 *   4: si    5: di    6: bp    7: sp
 *   8: zf    9: cf   10: sf   11: of
 *   12+: scratch
 *
 * Linear memory:
 *   0x00000..0x9FFFF  RAM  (data-segment, stack, etc.)
 *   0xA0000..0xAFFFF  VGA mode-13h framebuffer (64 KiB; 320*200 = 64000 < 64K)
 *   0xB0000..0xFFFFF  reserved
 *
 * IR-ops (mnemonics in lowercase). Argument-conventie als JS-object met velden.
 *   { op:'const',  dest, value }                      dest <- value
 *   { op:'load',   dest, addr, size }                 dest <- mem[size]@addr
 *   { op:'store',  addr, src, size }                  mem[size]@addr <- src
 *   { op:'mov',    dest, src }                        dest <- src
 *   { op:'add',    dest, a, b, size? }                dest <- a + b   (sets ZF/SF)
 *   { op:'sub',    dest, a, b, size? }                dest <- a - b   (sets ZF/SF/CF)
 *   { op:'and'|'or'|'xor',  dest, a, b }              dest <- a OP b  (sets ZF/SF, clears CF/OF)
 *   { op:'shl'|'shr',  dest, a, count }               dest <- a << count   (sets flags)
 *   { op:'cmp',    a, b }                             ZF/CF/SF/OF <- compare(a,b)
 *   { op:'jump',   target }                           unconditional
 *   { op:'jcond',  cond, target }                     cond in {'zf','nzf','cf','ncf'}
 *   { op:'call',   target }                           push retaddr; jump target
 *   { op:'ret' }                                      pop retaddr; jump
 *   { op:'in',     dest, port }                       dest <- io_in(port)
 *   { op:'out',    port, src }                        io_out(port, src)
 *   { op:'int',    num }                              software interrupt (we mappen 21h/4C als exit)
 *   { op:'syscall', name, args }                      host-runtime ABI call (mode13h_setpixel etc.)
 *   { op:'label',  name }                             pseudo-op voor jump-targets
 *   { op:'unknown', mnemonic, operands }              parser->IR kon niet vertalen (geteld)
 *
 * Locals zijn refereerd via { kind:'local', index } of { kind:'const', value } of { kind:'sym', name }.
 */
"use strict";

// x86 machine registers are modeled as persistent WASM *globals* (not per-function
// locals), so a value set in one exported/internal call survives into the next.
// The IR refers to them by these fixed indices; codegen routes index < NUM_FIXED_LOCALS
// to a module global, and index >= NUM_FIXED_LOCALS to a per-function scratch local.
export const LOCAL_AX = 0, LOCAL_BX = 1, LOCAL_CX = 2, LOCAL_DX = 3;
export const LOCAL_SI = 4, LOCAL_DI = 5, LOCAL_BP = 6, LOCAL_SP = 7;
export const LOCAL_ZF = 8, LOCAL_CF = 9, LOCAL_SF = 10, LOCAL_OF = 11;
// Segment registers (paragraph values). Written by `mov es,ax` etc.
export const LOCAL_ES = 12, LOCAL_DS = 13, LOCAL_CS = 14, LOCAL_SS = 15;
export const LOCAL_SCRATCH_START = 16;
export const NUM_FIXED_LOCALS = 16;

export const SREG_TO_LOCAL = Object.freeze({
  es: LOCAL_ES, ds: LOCAL_DS, cs: LOCAL_CS, ss: LOCAL_SS,
});

export const REG_TO_LOCAL = Object.freeze({
  ax: LOCAL_AX, bx: LOCAL_BX, cx: LOCAL_CX, dx: LOCAL_DX,
  si: LOCAL_SI, di: LOCAL_DI, bp: LOCAL_BP, sp: LOCAL_SP,
  // 8-bit halves share storage with 16-bit; high-byte ops mask appropriately at codegen.
  al: LOCAL_AX, ah: LOCAL_AX,
  bl: LOCAL_BX, bh: LOCAL_BX,
  cl: LOCAL_CX, ch: LOCAL_CX,
  dl: LOCAL_DX, dh: LOCAL_DX,
});

export const REG_SIZE = Object.freeze({
  ax:16, bx:16, cx:16, dx:16, si:16, di:16, bp:16, sp:16,
  al:8,  bl:8,  cl:8,  dl:8,
  ah:8,  bh:8,  ch:8,  dh:8,
});

export const REG_IS_HIGH_BYTE = Object.freeze({
  ah:true, bh:true, ch:true, dh:true,
});

/** Linear memory layout constants. */
export const VGA_FRAMEBUFFER_OFFSET = 0xA0000;
export const VGA_FRAMEBUFFER_SIZE   = 320 * 200;
export const STACK_TOP              = 0x90000;
export const MEMORY_PAGES           = 16;   // 16 * 64KiB = 1 MiB
export const PAGE_SIZE              = 65536;

/** Make a fresh IR-module. */
export function newModule(name) {
  return {
    name,
    globals:   {},        // name -> { type, size, init? }
    functions: [],        // [{ name, params, locals, ops, attr }]
    data:      [],        // [{ name, offset, bytes }]
    startFunction: null,
    stats: { ops: 0, unknownOps: 0, unknownMnemonics: new Set() },
  };
}

/** Make a fresh IR-function. */
export function newFunction(name, attr = "near") {
  return {
    name,
    attr,                     // 'near' | 'far'
    paramCount: 0,
    locals: { count: NUM_FIXED_LOCALS, types: [] },  // all i32 in WASM
    ops: [],
  };
}

/** Add an op to a function, returning the op. */
export function addOp(fn, op) {
  fn.ops.push(op);
  return op;
}

/** Get next scratch-local index for a function. */
export function allocScratch(fn) {
  const idx = fn.locals.count;
  fn.locals.count++;
  return idx;
}
