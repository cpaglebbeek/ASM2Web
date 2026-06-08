/**
 * Integration test: linker + OBK + codegen end-to-end.
 *
 * Run: node --test tests/
 */
"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import { tokenize } from "../src/tasm/tokenizer.js";
import { parse } from "../src/tasm/parser.js";
import { emitIR } from "../src/ir/emitter.js";
import { compileIRtoWASM } from "../src/codegen/codegen.js";
import { link, loadOBKExterns } from "../src/link/linker.js";

const SR = resolve("..", "SecondReality_source");
const TECHNO_DIR = join(SR, "TECHNO");

function sha256(b) { return createHash("sha256").update(Buffer.from(b)).digest("hex"); }

test("OBK-parser extracts _circle bytes correctly", async () => {
  if (!existsSync(join(TECHNO_DIR, "_CIRCLE.OBK"))) return;
  const externs = await loadOBKExterns([join(TECHNO_DIR, "_CIRCLE.OBK")]);
  assert.equal(externs.length, 1, "one extern from _CIRCLE.OBK");
  assert.equal(externs[0].name, "_circle", "extern named _circle");
  assert.equal(externs[0].bytes.length, 24000, "_circle is 24000 bytes");
  // sha256 is stable for given source; record exact value.
  const expected = "c42cf0062e81fa195c516b80b195334cbb9a3c4cda63ae0f3e4c6730dfebe2b0";
  assert.equal(sha256(externs[0].bytes), expected, "sha matches");
});

test("TECHNO link produces valid WASM module", async () => {
  if (!existsSync(TECHNO_DIR)) return;
  const ASM_FILES = ["KOEA.ASM", "KOEB.ASM", "POLYCLIP.ASM"];
  const modules = [];
  for (const f of ASM_FILES) {
    const src = readFileSync(join(TECHNO_DIR, f), "utf8");
    const ir = emitIR(parse(tokenize(src), {file:f}), {name: f.replace(".ASM", "")});
    modules.push({ name: f, ir });
  }
  const externs = await loadOBKExterns([join(TECHNO_DIR, "_CIRCLE.OBK"), join(TECHNO_DIR, "_CIRCLE2.OBK")]);
  const { ir: linked, layout } = link(modules, externs);

  assert.ok(linked.functions.length >= 25, "should have 25+ functions after dedupe");
  assert.equal(layout.symbolOffsets._circle, 0x10000, "_circle at 0x10000");
  assert.ok(layout.symbolOffsets._circle2 > 0x10000, "_circle2 after _circle");

  const { wasm } = compileIRtoWASM(linked);
  assert.ok(wasm.length > 50000, "WASM should be 50KB+");
  assert.ok(wasm.length < 200000, "WASM should be under 200KB");
});

test("TECHNO link is deterministic (sha-stable)", async () => {
  if (!existsSync(TECHNO_DIR)) return;
  const ASM_FILES = ["KOEA.ASM", "KOEB.ASM", "POLYCLIP.ASM"];
  const build = async () => {
    const modules = ASM_FILES.map(f => {
      const src = readFileSync(join(TECHNO_DIR, f), "utf8");
      return { name: f, ir: emitIR(parse(tokenize(src), {file:f}), {name:f}) };
    });
    const externs = await loadOBKExterns([join(TECHNO_DIR, "_CIRCLE.OBK"), join(TECHNO_DIR, "_CIRCLE2.OBK")]);
    const { ir: linked } = link(modules, externs);
    const { wasm } = compileIRtoWASM(linked);
    return sha256(wasm);
  };
  const h1 = await build();
  const h2 = await build();
  assert.equal(h1, h2, "build determinism");
});

test("TECHNO WASM instantiates and OBK data is at expected offsets", async () => {
  if (!existsSync(TECHNO_DIR)) return;
  const ASM_FILES = ["KOEA.ASM", "KOEB.ASM", "POLYCLIP.ASM"];
  const modules = ASM_FILES.map(f => {
    const src = readFileSync(join(TECHNO_DIR, f), "utf8");
    return { name: f, ir: emitIR(parse(tokenize(src), {file:f}), {name:f}) };
  });
  const externs = await loadOBKExterns([join(TECHNO_DIR, "_CIRCLE.OBK"), join(TECHNO_DIR, "_CIRCLE2.OBK")]);
  const { ir: linked } = link(modules, externs);
  const { wasm } = compileIRtoWASM(linked);

  const mem = new WebAssembly.Memory({ initial: 16, maximum: 16 });
  const { instance } = await WebAssembly.instantiate(wasm, { env: {
    memory: mem, io_out: () => {}, io_in: () => 0, exit: () => {},
    mode13h_setpixel: () => {}, dis_musrow: () => 0, waitb: () => {},
    dis_init: () => {}, dis_waitb: () => {},
  }});

  // _circle should be at 0x10000
  const view = new Uint8Array(mem.buffer);
  // First few bytes of _circle (from OBK extraction)
  assert.equal(view[0x10000], 0xad, "_circle byte 0");
  assert.equal(view[0x10001], 0x29, "_circle byte 1");

  // Try calling several exports without crashing
  for (const fn of ["asminit", "blitinit", "mixpal", "waitb"]) {
    if (typeof instance.exports[fn] === "function") {
      // Should not throw
      instance.exports[fn]();
    }
  }
});
