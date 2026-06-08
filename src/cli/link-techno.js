#!/usr/bin/env node
/**
 * CLI: link TECHNO modules (KOEA+KOEB+POLYCLIP+ROT) into one WASM module.
 *   node src/cli/link-techno.js
 *
 * Output: web/demo/build/techno-linked.wasm + .ir.txt + .manifest.json
 */
"use strict";

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { createHash } from "node:crypto";

import { tokenize } from "../tasm/tokenizer.js";
import { parse } from "../tasm/parser.js";
import { emitIR, dumpIR } from "../ir/emitter.js";
import { link, loadOBKExterns } from "../link/linker.js";
import { compileIRtoWASM } from "../codegen/codegen.js";

const SR = resolve("..", "SecondReality_source");
const TECHNO_DIR = join(SR, "TECHNO");
const ASM_FILES = ["KOEA.ASM", "KOEB.ASM", "POLYCLIP.ASM"];   // ROT.ASM is standalone test, skip
const OBK_FILES = ["_CIRCLE.OBK", "_CIRCLE2.OBK"];
const outDir = "web/demo/build";
mkdirSync(outDir, { recursive: true });

console.log("# Link TECHNO modules");

// 1. Parse + emit IR for each ASM
const modules = [];
for (const f of ASM_FILES) {
  const path = join(TECHNO_DIR, f);
  const src = readFileSync(path, "utf8");
  const toks = tokenize(src, { file: f });
  const ast = parse(toks, { file: f });
  const ir = emitIR(ast, { name: basename(f, ".ASM") });
  console.log(`  ${f.padEnd(14)} fns=${ir.functions.length} ops=${ir.stats.ops}`);
  modules.push({ name: basename(f, ".ASM"), ir });
}

// 2. Load OBK externs
console.log("\n# Load OBK data");
const externData = await loadOBKExterns(OBK_FILES.map(f => join(TECHNO_DIR, f)));
for (const ed of externData) {
  console.log(`  ${ed.name.padEnd(14)} ${ed.bytes.length} bytes`);
}

// 3. Link
console.log("\n# Link");
const { ir: linked, layout } = link(modules, externData);
console.log(`  total functions:        ${linked.functions.length}`);
console.log(`  total ops:              ${linked.stats.ops}`);
console.log(`  duplicate functions:    ${linked.stats.duplicateFunctions.length}`);
if (linked.stats.duplicateFunctions.length > 0) {
  console.log(`    ${linked.stats.duplicateFunctions.join(", ")}`);
}
console.log(`  extern symbols resolved: ${linked.stats.externSymbolsResolved.length}`);
for (const s of linked.stats.externSymbolsResolved) {
  console.log(`    ${s.name.padEnd(14)} @ 0x${s.offset.toString(16)}`);
}
console.log(`  unresolved symbols:     ${linked.stats.unresolvedSymbols.length}`);

// 4. Codegen
console.log("\n# Codegen WASM");
const { wasm, layout: codegenLayout } = compileIRtoWASM(linked);
console.log(`  WASM bytes: ${wasm.length}`);
console.log(`  WASM sha256: ${sha256Bytes(wasm).slice(0, 16)}…`);
console.log(`  exports: ${codegenLayout.exports.length}`);

// 5. Write artefacts
writeFileSync(join(outDir, "techno-linked.wasm"), Buffer.from(wasm));
writeFileSync(join(outDir, "techno-linked.ir.txt"), dumpIR(linked));
writeFileSync(join(outDir, "techno-linked.manifest.json"), JSON.stringify({
  name: "techno-linked",
  built: new Date().toISOString().slice(0, 10),
  wasm: { bytes: wasm.length, sha256: sha256Bytes(wasm) },
  stats: linked.stats,
  layout,
  modules: ASM_FILES,
  obkFiles: OBK_FILES,
}, null, 2));

// 6. Determinisme test
console.log("\n# Determinisme test (link+build twice)");
const modules2 = ASM_FILES.map(f => {
  const src = readFileSync(join(TECHNO_DIR, f), "utf8");
  return { name: basename(f, ".ASM"), ir: emitIR(parse(tokenize(src), {file:f}), {name: basename(f, ".ASM")}) };
});
const externData2 = await loadOBKExterns(OBK_FILES.map(f => join(TECHNO_DIR, f)));
const { ir: linked2 } = link(modules2, externData2);
const { wasm: wasm2 } = compileIRtoWASM(linked2);
const h1 = sha256Bytes(wasm), h2 = sha256Bytes(wasm2);
console.log(`  sha1: ${h1.slice(0, 16)}…`);
console.log(`  sha2: ${h2.slice(0, 16)}…`);
console.log(`  ${h1 === h2 ? "OK: link+build-determinisme bewezen" : "FAIL: builds differ!"}`);

function sha256Bytes(b) { return createHash("sha256").update(Buffer.from(b)).digest("hex"); }
