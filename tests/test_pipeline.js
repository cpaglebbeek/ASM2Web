/**
 * Integration test: hello-pixel.asm through tokenizer -> parser -> IR -> WASM,
 * instantiate, run main, verify framebuffer.
 *
 * Run: node --test tests/
 */
"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { tokenize, detokenize, TOK } from "../src/tasm/tokenizer.js";
import { parse } from "../src/tasm/parser.js";
import { emitIR } from "../src/ir/emitter.js";
import { compileIRtoWASM } from "../src/codegen/codegen.js";

function sha256(b) { return createHash("sha256").update(Buffer.from(b)).digest("hex"); }

test("tokenizer round-trips type-stream for hello-pixel", () => {
  const src = readFileSync("demos/hello-pixel.asm", "utf8");
  const t1 = tokenize(src, { file: "x" });
  const t2 = tokenize(detokenize(t1), { file: "x" });
  const s1 = t1.filter(t => t.type !== TOK.COMMENT).map(t => t.type).join(",");
  const s2 = t2.filter(t => t.type !== TOK.COMMENT).map(t => t.type).join(",");
  assert.equal(s1, s2);
});

test("parser produces expected proc and instruction counts", () => {
  const src = readFileSync("demos/hello-pixel.asm", "utf8");
  const ast = parse(tokenize(src), { file: "hello-pixel.asm" });
  assert.ok(ast.stats.procs >= 1, "at least 1 proc expected");
  assert.ok(ast.stats.instructions > 20, "should have >20 instructions");
  assert.equal(ast.stats.raw, 0, "no unrecognised lines");
});

test("IR-emitter recognises all hello-pixel instructions (0 unknown)", () => {
  const src = readFileSync("demos/hello-pixel.asm", "utf8");
  const ir = emitIR(parse(tokenize(src), { file: "x" }), { name: "demo" });
  assert.equal(ir.stats.unknownOps, 0, "no unknown ops");
});

test("WASM build is deterministic (same source => same bytes)", () => {
  const src = readFileSync("demos/hello-pixel.asm", "utf8");
  const { wasm: w1 } = compileIRtoWASM(emitIR(parse(tokenize(src), { file: "x" }), { name: "demo" }));
  const { wasm: w2 } = compileIRtoWASM(emitIR(parse(tokenize(src), { file: "x" }), { name: "demo" }));
  assert.equal(sha256(w1), sha256(w2));
});

test("WASM instantiates and main() writes expected pixels", async () => {
  const src = readFileSync("demos/hello-pixel.asm", "utf8");
  const { wasm } = compileIRtoWASM(emitIR(parse(tokenize(src), { file: "x" }), { name: "demo" }));
  const memory = new WebAssembly.Memory({ initial: 16, maximum: 16 });
  const env = {
    memory,
    io_out: () => {}, io_in: () => 0, exit: () => {},
    mode13h_setpixel: () => {}, dis_musrow: () => 0, waitb: () => {},
    dis_init: () => {}, dis_waitb: () => {},
  };
  const { instance } = await WebAssembly.instantiate(wasm, { env });
  assert.ok(typeof instance.exports.main === "function", "main export present");
  instance.exports.main();
  const fb = new Uint8Array(memory.buffer, 0xA0000, 320 * 200);
  assert.equal(fb[10 * 320 + 10], 1, "pixel (10,10) = 1 (red)");
  assert.equal(fb[20 * 320 + 20], 2, "pixel (20,20) = 2 (green)");
  assert.equal(fb[100 * 320 + 50], 2, "pixel (50,100) = 2");
  assert.equal(fb[100 * 320 + 59], 2, "pixel (59,100) = 2");
  assert.equal(fb[100 * 320 + 60], 0, "pixel (60,100) = 0");
});

test("segment:offset tracker resolves es:[di]/ds:[si] to linear 0xA0000", async () => {
  const src = readFileSync("demos/seg-test.asm", "utf8");
  const ast = parse(tokenize(src), { file: "seg-test.asm" });
  assert.equal(ast.stats.raw, 0, "no unrecognised lines (segref must parse)");
  const ir = emitIR(ast, { name: "seg" });
  assert.equal(ir.stats.unknownOps, 0, "no unknown ops");
  const { wasm } = compileIRtoWASM(ir);
  const memory = new WebAssembly.Memory({ initial: 16, maximum: 16 });
  const env = {
    memory,
    io_out: () => {}, io_in: () => 0, exit: () => {},
    mode13h_setpixel: () => {}, dis_musrow: () => 0, waitb: () => {},
    dis_init: () => {}, dis_waitb: () => {},
  };
  const { instance } = await WebAssembly.instantiate(wasm, { env });
  instance.exports.main();
  const u8 = new Uint8Array(memory.buffer);
  // `mov ax,0a000h / mov es,ax` must fold the segment base so es:[di] lands in the
  // VGA frame-buffer at linear 0xA0000+offset (byte-sized, no neighbouring spill).
  assert.equal(u8[0xA0000 + 3210], 15, "es:[di] pixel (10,10)");
  assert.equal(u8[0xA0000 + 6420], 31, "es:[di] pixel (20,20)");
  assert.equal(u8[0xA0000 + 100], 7, "ds:[si] write");
  assert.equal(u8[0xA0000 + 3211], 0, "byte ptr must write exactly 1 byte (no word spill)");
});

test("x86 registers persist across separate function calls (globals, not locals)", async () => {
  // proc1 sets ax/bx; proc2 — a *separate* exported call — reads them and stores to
  // memory. With registers modeled as per-function locals this would read 0; as
  // persistent module globals the values survive the call boundary.
  const asm = [
    "code segment",
    "proc1 proc", "  mov ax, 1234h", "  mov bx, 5678h", "  ret", "proc1 endp",
    "proc2 proc", "  mov word ptr [0], ax", "  mov word ptr [2], bx", "  ret", "proc2 endp",
    "code ends", "",
  ].join("\n");
  const ir = emitIR(parse(tokenize(asm, { file: "x" }), { file: "x" }), { name: "persist" });
  const { wasm } = compileIRtoWASM(ir);
  const memory = new WebAssembly.Memory({ initial: 16, maximum: 16 });
  const env = {
    memory,
    io_out: () => {}, io_in: () => 0, exit: () => {},
    mode13h_setpixel: () => {}, dis_musrow: () => 0, waitb: () => {},
    dis_init: () => {}, dis_waitb: () => {},
  };
  const { instance } = await WebAssembly.instantiate(wasm, { env });
  instance.exports.proc1();
  instance.exports.proc2();
  const u16 = new Uint16Array(memory.buffer);
  assert.equal(u16[0], 0x1234, "ax persisted from proc1 into proc2");
  assert.equal(u16[1], 0x5678, "bx persisted from proc1 into proc2");
});

test("TECHNO IR-emitter achieves >90% supported ops on KOEA+KOEB+POLYCLIP+ROT", async () => {
  const { readFileSync, readdirSync, existsSync } = await import("node:fs");
  const { join, resolve } = await import("node:path");
  const SR = resolve("..", "SecondReality_source", "TECHNO");
  if (!existsSync(SR)) { return; }  // skip if vendor not present
  let total = 0, unknown = 0;
  for (const f of readdirSync(SR).filter(x => x.toUpperCase().endsWith(".ASM"))) {
    const src = readFileSync(join(SR, f), "utf8");
    const ir  = emitIR(parse(tokenize(src), { file: f }), { name: f });
    total += ir.stats.ops;
    unknown += ir.stats.unknownOps;
  }
  const pct = 100 * (total - unknown) / total;
  assert.ok(pct > 90, `expected >90% supported, got ${pct.toFixed(1)}% (total=${total}, unknown=${unknown})`);
});
