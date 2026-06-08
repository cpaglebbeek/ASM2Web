/**
 * Linker — combineer meerdere IR-modules + OBK-data in 1 WASM-module.
 *
 * Strategie:
 *   - Verzamel alle functions uit alle IR-modules (alfabetisch, deterministisch).
 *   - Symbol-table: function-naam -> linked-function-index. Cross-file `call`
 *     wordt geresolveerd naar globale index.
 *   - Data-segments: per extern-ref (bv. `_circle`) → toegewezen offset in linear
 *     memory. WASM data-section bevat de OBK-bytes op die offset.
 *   - Symbol-references in IR (kind=sym, name=X): rewriten naar const(offset).
 *   - Duplicate-function-namen tussen modules: eerst-gedefinieerd wint, anderen
 *     skip met warning.
 *
 * Output: gecombineerd IR-module dat naar codegen kan + symbol-binding info.
 */
"use strict";

import { newModule, newFunction } from "../ir/types.js";

/**
 * @param {Array<{name: string, ir: IRModule}>} modules
 * @param {Array<{name: string, bytes: Uint8Array}>} externData  - name=symbol naam, bytes=raw data
 * @returns {{ir: IRModule, layout: object}}
 */
export function link(modules, externData = []) {
  const linked = newModule("linked");

  // ----- Data layout -----
  // Place each extern's bytes at a fixed offset starting at 0x10000 (after 64K data segment).
  // Align each to 256-byte boundary for cleanliness.
  const DATA_BASE = 0x10000;
  const ALIGN = 256;
  let dataCursor = DATA_BASE;
  const symbolOffset = new Map();  // symbol-name -> linear-memory offset
  const dataBytes = [];            // [{offset, bytes}]

  // Sort externData by name for deterministic layout
  const sortedExternData = externData.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const ed of sortedExternData) {
    symbolOffset.set(ed.name, dataCursor);
    dataBytes.push({ offset: dataCursor, bytes: ed.bytes });
    // Bump cursor + align
    dataCursor += ed.bytes.length;
    dataCursor = (dataCursor + (ALIGN - 1)) & ~(ALIGN - 1);
  }

  // ----- Function collection -----
  // Collect all functions, deduplicate by name (first wins).
  const seenFns = new Set();
  const duplicates = [];
  const moduleNames = [];

  for (const m of modules) {
    moduleNames.push(m.name);
    for (const fn of m.ir.functions) {
      // Skip __init from all but the first module to avoid duplicate exports.
      if (fn.name === "__init") {
        if (linked.functions.some(f => f.name === "__init")) continue;
      }
      if (seenFns.has(fn.name)) {
        duplicates.push({ name: fn.name, sourceModule: m.name });
        continue;
      }
      seenFns.add(fn.name);
      // Deep-clone fn so we can mutate without affecting originals.
      linked.functions.push(cloneFunction(fn));
    }
  }

  // ----- Collect data definitions from IR -----
  for (const m of modules) {
    for (const d of m.ir.data) linked.data.push(d);
  }

  // ----- Rewrite sym-references to const-offsets -----
  // Walk every op in every function, find {kind:'sym', name:X}, replace with const-offset
  // (or 0 if symbol unknown — warn).
  const unresolvedSymbols = new Set();
  for (const fn of linked.functions) {
    for (const op of fn.ops) rewriteOp(op, symbolOffset, unresolvedSymbols);
  }

  // ----- Stats merge -----
  let totalOps = 0;
  let totalUnknown = 0;
  for (const m of modules) {
    totalOps += m.ir.stats.ops || 0;
    totalUnknown += m.ir.stats.unknownOps || 0;
  }
  linked.stats = {
    ops: totalOps,
    unknownOps: totalUnknown,
    unknownMnemonics: [],
    modulesLinked: modules.length,
    duplicateFunctions: duplicates.map(d => d.name),
    externSymbolsResolved: Array.from(symbolOffset.entries()).map(([n, o]) => ({name: n, offset: o})),
    unresolvedSymbols: Array.from(unresolvedSymbols).sort(),
  };

  // Pre-built data segments (bytes) for codegen
  linked.preBuiltData = dataBytes;

  const layout = {
    moduleNames,
    functions: linked.functions.map(f => f.name),
    dataBase: DATA_BASE,
    dataCursor,
    symbolOffsets: Object.fromEntries(symbolOffset),
    duplicates: duplicates.map(d => `${d.name} (from ${d.sourceModule})`),
    unresolvedSymbols: Array.from(unresolvedSymbols).sort(),
  };

  return { ir: linked, layout };
}

function cloneFunction(fn) {
  const out = newFunction(fn.name, fn.attr);
  out.paramCount = fn.paramCount;
  out.locals = { count: fn.locals.count, types: fn.locals.types ? fn.locals.types.slice() : [] };
  out.ops = fn.ops.map(cloneOp);
  return out;
}

function cloneOp(op) {
  // Shallow-deep mix: clone the top-level op + clone any nested operand objects.
  const out = { ...op };
  for (const key of ["a", "b", "src", "dest", "addr", "count", "port"]) {
    if (out[key] && typeof out[key] === "object") out[key] = { ...out[key] };
  }
  return out;
}

function rewriteOp(op, symbolOffset, unresolvedSymbols) {
  for (const key of ["a", "b", "src", "dest", "addr", "count", "port"]) {
    const v = op[key];
    if (!v || typeof v !== "object") continue;
    if (v.kind === "sym") {
      if (symbolOffset.has(v.name)) {
        // Rewrite to const with the resolved offset
        op[key] = { kind: "const", value: symbolOffset.get(v.name) };
      } else {
        unresolvedSymbols.add(v.name);
        // Keep as sym (will emit i32.const 0 in codegen) — fail soft.
      }
    } else if (v.kind === "mem" && v.exprTokens) {
      // Rewrite ident refs inside memory expressions to constants
      // (e.g. mov al, [_circle + bx] -> _circle resolves to offset)
      for (const t of v.exprTokens) {
        if (t.type === "IDENT" && symbolOffset.has(t.value)) {
          t.type = "NUMBER";
          t.value = symbolOffset.get(t.value);
        }
      }
    }
  }
}

/** Read OBK files and build externData array suitable for link(). */
export async function loadOBKExterns(obkFiles) {
  const { readFileSync } = await import("node:fs");
  const { parseOMF, bytesForPublic } = await import("../obk/omf-parser.js");
  const result = [];
  for (const filePath of obkFiles) {
    const bytes = readFileSync(filePath);
    const omf = parseOMF(bytes);
    for (const pub of omf.publics) {
      const data = bytesForPublic(omf, pub.name);
      if (!data) continue;
      result.push({ name: pub.name, bytes: data });
    }
  }
  return result;
}
