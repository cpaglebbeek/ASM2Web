#!/usr/bin/env node
/**
 * CLI: parse an OBK file and dump its structure.
 *   node src/cli/parse-obk.js path/to/file.OBK
 */
"use strict";

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseOMF, bytesForPublic } from "../obk/omf-parser.js";
import { createHash } from "node:crypto";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: node src/cli/parse-obk.js path/to/file.OBK");
  process.exit(1);
}

const bytes = readFileSync(inputPath);
const omf = parseOMF(bytes);

console.log(`# Parse ${inputPath}  (${bytes.length} bytes)`);
console.log(`  module name:     ${JSON.stringify(omf.moduleName)}`);
console.log(`  LNAMES entries:  ${omf.names.length - 1}`);
for (let i = 1; i < omf.names.length; i++) console.log(`    ${i}: ${JSON.stringify(omf.names[i])}`);
console.log(`  SEGDEF entries:  ${omf.segments.length - 1}`);
for (let i = 1; i < omf.segments.length; i++) {
  const s = omf.segments[i];
  console.log(`    ${i}: name=${JSON.stringify(s.name)} length=${s.length}`);
}
console.log(`  PUBDEF entries:  ${omf.publics.length}`);
for (const p of omf.publics) console.log(`    ${p.name}  seg=${p.segIdx}  offset=0x${p.offset.toString(16)}`);
console.log(`  Data segments:   ${omf.dataBySegment.size}`);
for (const [segIdx, data] of omf.dataBySegment) {
  const h = createHash("sha256").update(Buffer.from(data)).digest("hex");
  console.log(`    seg ${segIdx}: ${data.length} bytes, sha256=${h.slice(0, 16)}…`);
}

// Write extracted bytes as raw files for downstream linkage.
const outDir = "build/obk-extract";
mkdirSync(outDir, { recursive: true });
for (const p of omf.publics) {
  const data = bytesForPublic(omf, p.name);
  if (!data) continue;
  const outFile = join(outDir, p.name + ".bin");
  writeFileSync(outFile, Buffer.from(data));
  console.log(`  → ${outFile}  (${data.length} bytes)`);
}
