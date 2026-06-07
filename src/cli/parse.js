#!/usr/bin/env node
/**
 * CLI: parse all .ASM in a module-dir into AST + symbol-table.
 *   node src/cli/parse.js modules/techno
 */
"use strict";

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { tokenize } from "../tasm/tokenizer.js";
import { parse } from "../tasm/parser.js";
import { buildSymtab, serializeSymtab } from "../tasm/symtab.js";

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

console.log(`# Parse ${moduleArg}  (${files.length} .ASM files)`);

const modules = [];
const report = { module: basename(moduleArg), files: [] };

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const toks = tokenize(src, { file: basename(f) });
  const mod  = parse(toks, { file: basename(f) });
  modules.push(mod);

  console.log(`\n## ${basename(f)}`);
  console.log(`   instructions: ${mod.stats.instructions}`);
  console.log(`   procs:        ${mod.stats.procs}`);
  console.log(`   labels:       ${mod.stats.labels}`);
  console.log(`   data lines:   ${mod.stats.dataLines}`);
  console.log(`   segments:     ${mod.stats.segments}`);
  console.log(`   externs:      ${mod.stats.externs}`);
  console.log(`   publics:      ${mod.stats.publics}`);
  console.log(`   RAW lines:    ${mod.stats.raw}  (unrecognised: ${mod.stats.unknownMnemonics.slice(0, 10).join(",")}${mod.stats.unknownMnemonics.length > 10 ? "..." : ""})`);

  report.files.push({ file: basename(f), stats: mod.stats });

  // Write AST JSON (deterministic key-order via JSON.stringify with sorted keys).
  const astPath = join(outDir, basename(f).replace(/\.[Aa][Ss][Mm]$/, ".ast.json"));
  writeFileSync(astPath, JSON.stringify(mod, replacerSorted, 2));
}

const sym = buildSymtab(modules);
const symPath = join(outDir, "symtab.json");
writeFileSync(symPath, JSON.stringify(serializeSymtab(sym), replacerSorted, 2));

const reportPath = join(outDir, "parse-report.json");
writeFileSync(reportPath, JSON.stringify(report, replacerSorted, 2));

console.log(`\n## Symbol-table`);
console.log(`   matched cross-file refs:  ${sym.matched.length}`);
console.log(`   undefined externs:        ${sym.undefinedExterns.length}`);
console.log(`   unused publics:           ${sym.unusedPublics.length}`);
console.log(`   duplicates:               ${sym.duplicates.length}`);

if (sym.undefinedExterns.length > 0) {
  console.log("\n   Undefined externs:");
  for (const u of sym.undefinedExterns) console.log(`     ${u.name}  (importers: ${u.importers.join(",")})`);
}

console.log(`\nOutput: ${outDir}/*.ast.json  +  symtab.json  +  parse-report.json`);

function replacerSorted(_k, v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v).sort();
    const out = {};
    for (const k of keys) out[k] = v[k];
    return out;
  }
  return v;
}
