#!/usr/bin/env node
/**
 * CLI: emit IR for all .ASM in a module-dir (parses then emits).
 *   node src/cli/emit-ir.js modules/techno
 */
"use strict";

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { tokenize } from "../tasm/tokenizer.js";
import { parse } from "../tasm/parser.js";
import { emitIR, dumpIR } from "../ir/emitter.js";

const SR = resolve("../SecondReality_source");

function findAsmFiles(dir) {
  const sub = basename(dir).toUpperCase();
  const srcDir = join(SR, sub);
  return readdirSync(srcDir)
    .filter(f => f.toUpperCase().endsWith(".ASM"))
    .sort()
    .map(f => join(srcDir, f));
}

const moduleArg = process.argv[2] || "modules/techno";
const files = findAsmFiles(moduleArg);
const outDir = join(moduleArg, "build");
mkdirSync(outDir, { recursive: true });

console.log(`# Emit IR ${moduleArg}`);

let totalOps = 0;
let totalUnknown = 0;
const allUnknown = new Set();

for (const f of files) {
  const src  = readFileSync(f, "utf8");
  const toks = tokenize(src, { file: basename(f) });
  const ast  = parse(toks, { file: basename(f) });
  const ir   = emitIR(ast, { name: basename(f, ".ASM") });

  const supportedOps = ir.stats.ops - ir.stats.unknownOps;
  const pct = ir.stats.ops ? (100 * supportedOps / ir.stats.ops).toFixed(1) : "—";
  console.log(`  ${basename(f).padEnd(14)}  ops=${String(ir.stats.ops).padStart(4)}  supported=${String(supportedOps).padStart(4)}  (${pct}%)  unknown=${ir.stats.unknownOps}`);

  totalOps += ir.stats.ops;
  totalUnknown += ir.stats.unknownOps;
  for (const m of ir.stats.unknownMnemonics) allUnknown.add(m);

  const irPath = join(outDir, basename(f).replace(/\.[Aa][Ss][Mm]$/, ".ir.txt"));
  writeFileSync(irPath, dumpIR(ir));

  const irJsonPath = join(outDir, basename(f).replace(/\.[Aa][Ss][Mm]$/, ".ir.json"));
  writeFileSync(irJsonPath, JSON.stringify({
    name: ir.name,
    stats: ir.stats,
    functions: ir.functions.map(fn => ({ name: fn.name, attr: fn.attr, locals: fn.locals.count, ops: fn.ops })),
    data: ir.data,
  }, null, 2));
}

console.log(`\nTotal: ops=${totalOps}, unknown=${totalUnknown} (${totalOps ? (100*(totalOps-totalUnknown)/totalOps).toFixed(1) : 0}% supported)`);
if (allUnknown.size) console.log(`Unknown mnemonics: ${Array.from(allUnknown).sort().join(", ")}`);
