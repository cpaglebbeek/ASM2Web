/**
 * Cross-file symbol-table voor TASM-modules.
 *
 * Verzamelt:
 *   - exports per file (PUBLIC + auto-public PROC FAR)
 *   - imports per file (EXTERN/EXTRN)
 *   - alle label-definities (LABEL, PROC, named DATA)
 *
 * Detecteert:
 *   - undefined externs (geïmporteerd maar geen export bij andere file)
 *   - duplicate symbol-definities
 *   - matchend extern <-> public (cross-file resolutie)
 */
"use strict";

import { NODE, walk } from "./parser.js";

export function buildSymtab(modules) {
  const symtab = {
    exports:        new Map(),  // name -> { file, defKind }
    imports:        new Map(),  // name -> [{ file, type }]
    duplicates:     [],
    undefinedExterns: [],
    unusedPublics:    [],
    matched:          [],
    perFile:        new Map(),  // file -> { defs:[], publics:[], externs:[] }
  };

  for (const m of modules) {
    const fileRec = { file: m.file, defs: [], publics: [], externs: [] };
    symtab.perFile.set(m.file, fileRec);

    for (const n of walk(m)) {
      if (n.kind === NODE.LABEL) {
        addDef(symtab, fileRec, n.name, "label", m.file);
      } else if (n.kind === NODE.PROC) {
        addDef(symtab, fileRec, n.name, n.attr === "far" ? "proc-far" : "proc-near", m.file);
        // auto-public for PROC FAR is TASM-context-dependent; we don't auto-mark.
      } else if (n.kind === NODE.DATA && n.name) {
        addDef(symtab, fileRec, n.name, `data:${n.size}`, m.file);
      } else if (n.kind === NODE.EQU) {
        addDef(symtab, fileRec, n.name, "equ", m.file);
      } else if (n.kind === NODE.PUBLIC) {
        for (const nm of n.names) {
          fileRec.publics.push(nm);
          symtab.exports.set(nm, { file: m.file, defKind: "explicit-public" });
        }
      } else if (n.kind === NODE.EXTERN) {
        for (const e of n.names) {
          fileRec.externs.push(e);
          const list = symtab.imports.get(e.name) || [];
          list.push({ file: m.file, type: e.type });
          symtab.imports.set(e.name, list);
        }
      }
    }
  }

  // Resolve.
  for (const [name, importers] of symtab.imports) {
    const expr = symtab.exports.get(name);
    if (expr) {
      symtab.matched.push({ name, defFile: expr.file, importers: importers.map(i => i.file) });
    } else {
      // Could also be defined globally even without explicit PUBLIC (TASM linker behaviour).
      // Search all defs.
      let foundFile = null;
      for (const [f, rec] of symtab.perFile) {
        if (rec.defs.some(d => d.name === name)) { foundFile = f; break; }
      }
      if (foundFile) {
        symtab.matched.push({ name, defFile: foundFile, importers: importers.map(i => i.file), implicit: true });
      } else {
        symtab.undefinedExterns.push({ name, importers: importers.map(i => i.file) });
      }
    }
  }
  // Unused publics: exported but no importer.
  for (const [name, expr] of symtab.exports) {
    if (!symtab.imports.has(name)) symtab.unusedPublics.push({ name, defFile: expr.file });
  }

  return symtab;
}

function addDef(symtab, fileRec, name, defKind, file) {
  if (fileRec.defs.some(d => d.name === name && d.kind === defKind)) return;
  fileRec.defs.push({ name, kind: defKind });
  // Global duplicates check.
  for (const [f, rec] of symtab.perFile) {
    if (f === file) continue;
    if (rec.defs.some(d => d.name === name)) {
      symtab.duplicates.push({ name, files: [f, file] });
    }
  }
}

/** Minimal serializable form for JSON output. */
export function serializeSymtab(symtab) {
  return {
    matched:           symtab.matched.slice().sort((a, b) => a.name.localeCompare(b.name)),
    undefinedExterns:  symtab.undefinedExterns.slice().sort((a, b) => a.name.localeCompare(b.name)),
    unusedPublics:     symtab.unusedPublics.slice().sort((a, b) => a.name.localeCompare(b.name)),
    duplicates:        symtab.duplicates,
    perFile: Array.from(symtab.perFile, ([file, rec]) => ({
      file,
      defs:     rec.defs.slice().sort((a, b) => a.name.localeCompare(b.name)),
      publics:  rec.publics.slice().sort(),
      externs:  rec.externs.slice().sort((a, b) => a.name.localeCompare(b.name)),
    })),
  };
}
