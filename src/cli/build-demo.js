#!/usr/bin/env node
/**
 * Build the mini-demo end-to-end: source.asm -> tokens -> AST -> IR -> .wasm
 *   node src/cli/build-demo.js [demos/hello-pixel.asm]
 */
"use strict";

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";

import { tokenize } from "../tasm/tokenizer.js";
import { parse } from "../tasm/parser.js";
import { emitIR, dumpIR } from "../ir/emitter.js";
import { compileIRtoWASM } from "../codegen/codegen.js";

const inputPath = process.argv[2] || "demos/hello-pixel.asm";
const src = readFileSync(inputPath, "utf8");
const name = basename(inputPath, ".asm");
const outDir = "web/demo/build";
mkdirSync(outDir, { recursive: true });

console.log(`# Build demo: ${inputPath}`);
console.log(`   source: ${src.length} bytes, sha256=${sha256(src).slice(0, 12)}…`);

// 1. tokenize
const tokens = tokenize(src, { file: basename(inputPath) });
console.log(`   tokens: ${tokens.length}`);

// 2. parse
const ast = parse(tokens, { file: basename(inputPath) });
console.log(`   parse:  instr=${ast.stats.instructions}  procs=${ast.stats.procs}  labels=${ast.stats.labels}  raw=${ast.stats.raw}`);

// 3. emit IR
const ir = emitIR(ast, { name });
console.log(`   IR:     ops=${ir.stats.ops}  unknown=${ir.stats.unknownOps}  fns=${ir.functions.length}`);

// 4. codegen WASM
const { wasm, layout } = compileIRtoWASM(ir);
console.log(`   WASM:   ${wasm.length} bytes  sha256=${sha256Bytes(wasm).slice(0, 12)}…`);

// 5. write artefacts
writeFileSync(join(outDir, `${name}.tokens.json`), JSON.stringify(tokens.map(t => ({
  type: t.type, value: t.value, line: t.line, col: t.col,
})), null, 2));
writeFileSync(join(outDir, `${name}.ast.json`),    JSON.stringify(ast, replacerSorted, 2));
writeFileSync(join(outDir, `${name}.ir.txt`),      dumpIR(ir));
writeFileSync(join(outDir, `${name}.ir.json`),     JSON.stringify({
  name: ir.name,
  stats: ir.stats,
  functions: ir.functions.map(fn => ({ name: fn.name, attr: fn.attr, locals: fn.locals.count, ops: fn.ops })),
  data: ir.data,
}, null, 2));
writeFileSync(join(outDir, `${name}.wasm`),        Buffer.from(wasm));
writeFileSync(join(outDir, `${name}.layout.json`), JSON.stringify(layout, null, 2));

// 6. Also copy source for the web-demo to display.
writeFileSync(join(outDir, `${name}.asm`), src);

// 7. Build-info manifest
const manifest = {
  name,
  built:           new Date().toISOString().slice(0, 10),  // date only (no time, for reproducibility)
  source:          {
    path:   inputPath,
    bytes:  src.length,
    sha256: sha256(src),
  },
  wasm: {
    bytes:  wasm.length,
    sha256: sha256Bytes(wasm),
  },
  stats: ir.stats,
};
writeFileSync(join(outDir, `${name}.manifest.json`), JSON.stringify(manifest, null, 2));

console.log(`\nOutput in ${outDir}/:`);
console.log(`   ${name}.wasm  ${name}.ir.txt  ${name}.ast.json  ${name}.tokens.json  ${name}.manifest.json`);

console.log(`\n## Determinisme-test (build twice, compare wasm sha)`);
const { wasm: w2 } = compileIRtoWASM(emitIR(parse(tokenize(src), { file: name }), { name }));
const h1 = sha256Bytes(wasm), h2 = sha256Bytes(w2);
console.log(`   sha1: ${h1.slice(0,16)}…`);
console.log(`   sha2: ${h2.slice(0,16)}…`);
console.log(`   ${h1 === h2 ? "OK: build-determinisme bewezen" : "FAIL: builds differ!"}`);

function sha256(s) { return createHash("sha256").update(s, "utf8").digest("hex"); }
function sha256Bytes(b) { return createHash("sha256").update(Buffer.from(b)).digest("hex"); }
function replacerSorted(_k, v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v).sort();
    const out = {};
    for (const k of keys) out[k] = v[k];
    return out;
  }
  return v;
}
