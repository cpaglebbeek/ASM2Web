#!/usr/bin/env node
/**
 * CLI: tokenize all .ASM files in a module-dir and print stats + first 10 tokens per file.
 *   node src/cli/tokenize.js modules/techno
 */
"use strict";

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { tokenize, detokenize, TOK } from "../tasm/tokenizer.js";

const SR = resolve("../SecondReality_source");

function findAsmFiles(dir) {
  // Look in vendor source dir for the module subdir (TECHNO uppercase).
  const sub = basename(dir).toUpperCase();
  const srcDir = join(SR, sub);
  let files;
  try { files = readdirSync(srcDir); } catch (e) {
    console.error(`SR-source niet gevonden: ${srcDir}`);
    process.exit(1);
  }
  return files
    .filter(f => f.toUpperCase().endsWith(".ASM"))
    .map(f => join(srcDir, f));
}

const moduleArg = process.argv[2] || "modules/techno";
const files = findAsmFiles(moduleArg);
const outDir = join(moduleArg, "build");
mkdirSync(outDir, { recursive: true });

console.log(`# Tokenize ${moduleArg}  (${files.length} .ASM files)`);

let totalTokens = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const toks = tokenize(src, { file: basename(f), keepComments: true });
  totalTokens += toks.length;

  const counts = {};
  for (const t of toks) counts[t.type] = (counts[t.type] || 0) + 1;

  console.log(`\n## ${basename(f)}   (${src.length} bytes, ${toks.length} tokens)`);
  for (const k of Object.keys(counts).sort()) console.log(`   ${k.padEnd(8)} ${counts[k]}`);

  // Round-trip check: detokenize -> tokenize again -> compare type-streams.
  const reSrc = detokenize(toks);
  const toks2 = tokenize(reSrc, { file: basename(f) });
  const types1 = toks.filter(t => t.type !== TOK.COMMENT).map(t => t.type).join(",");
  const types2 = toks2.filter(t => t.type !== TOK.COMMENT).map(t => t.type).join(",");
  console.log(`   round-trip type-stream: ${types1 === types2 ? "OK" : "DIFF"}`);

  // Write tokens JSON.
  const outPath = join(outDir, basename(f).replace(/\.[Aa][Ss][Mm]$/, ".tokens.json"));
  writeFileSync(outPath, JSON.stringify(toks.map(t => ({
    type: t.type, value: t.value, line: t.line, col: t.col,
  })), null, 2));
}

console.log(`\nTotal tokens: ${totalTokens}`);
console.log(`Output: ${outDir}/*.tokens.json`);
