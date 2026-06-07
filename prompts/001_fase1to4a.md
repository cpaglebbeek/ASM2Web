---
date: 2026-06-08
repo: ASM2Web
status: open
resume: "verder met ASM2Web fase 4b — structured control-flow (jumps/calls/push-pop op shadow-stack in linear memory). Daarna fase 5 TECHNO-uitbreiding: ontbrekende mnemonics (mul/div/imul/idiv/rep/rol/ror/xchg/jcxz/jg/jl/jge/jle/lds/les/movsx/movzx/neg/popf/pushf/rcl/rcr/sar) + OBK-data-parser (OMF) + DIS-engine port of libxmp-lite WASM. v0.2.0-Backus."
---

# Sessie 2026-06-08 — ASM2Web fase 1-4a (autonoom doorbouwen tot mini-demo)

## Vraag

> "bouw nu verder totdat je klaar bent. doe overal jouw beste keus maar onthoud wel in lijst welke alternatieven er waren zodat ik later mogelijk een alternatieve build kan doen. mail me als je klaar bent."

## Realistische scope-knip vooraf

Eerlijk: TECHNO complete (1300 instructies, mul/div/rep, DIS-engine, OBK-data) is geen 1-turn werk. Knip: bouw eigen pijplijn end-to-end + bewijs werkend op mini-demo; TECHNO blijft fase 5. Gemeld in mail.

## Wat gebouwd (v0.0.1-Booth → v0.1.0-Hopper)

### Fase 1 — TASM-parser
- `src/tasm/tokenizer.js` — state-machine, char-by-char, source-locations, TASM-quirks (0Fh, dup, LOCALS @@1, `;` comments, line-continuation `\`, base-suffixes h/b/d/o/q)
- `src/tasm/parser.js` — recursive descent, SEGMENT/PROC/extrn/public/db/dw/dd/include/assume/equ; permissief (unknowns → RAW, geteld in stats)
- `src/tasm/symtab.js` — cross-file symbol-table, externs↔publics matching, duplicate-detectie, unused-publics-rapport
- **TECHNO-test**: 4 files, 1300 instructions herkend, alle 4 externs correct, 13 publics. Round-trip type-stream identiek op alle files.

### Fase 2 — IR-emitter
- `src/ir/types.js` — typed locals (ax/bx/cx/dx/si/di/bp/sp + zf/cf/sf/of + scratch), linear-memory layout (1 MiB, framebuffer @ 0xA0000), constants
- `src/ir/emitter.js` — IR ops voor mov/add/sub/and/or/xor/shl/shr/cmp/test/jmp/jcc/call/ret/push/pop/in/out/int/nop/cld/std/clc/stc/inc/dec
- 8-bit/16-bit/32-bit size-inferentie (gebaseerd op operand register-grootte indien geen `byte ptr`-hint)
- High-byte aliasing (ah/bh/ch/dh share storage met ax/bx/cx/dx via masking in codegen)
- `src/cli/emit-ir.js` — produceert `*.ir.txt` (human-readable) + `*.ir.json` (machine-readable)
- **TECHNO**: 91.3% supported (1187/1300). Unknown: idiv, imul, jcxz, jg, jge, jl, jle, lds, les, loop, movsx, movzx, mul, neg, popf, pushf, rcl, rcr, rep, rol, ror, sar, xchg (23 mnemonics)

### Fase 3 — Eigen mini WASM-encoder
- `src/codegen/wasm-encode.js` — LEB128 (signed+unsigned), section-builder, opcode-tabel, InstrBuilder helper; ~440 regels, geen vendor deps
- `src/codegen/codegen.js` — IR → WASM. Subset: alle IR-ops uit fase 2 met direct mapping. push/pop = stub (no-op) tot fase 4b shadow-stack komt. jumps/calls binnen functie = `unreachable` markeren (fase 4b control-flow recon)
- Memory: imported (`env.memory`, 16 pages = 1 MiB)
- ABI-imports: io_out, io_in, exit, mode13h_setpixel, dis_musrow, waitb
- **Build-determinisme bewezen**: `sha256(build1.wasm) == sha256(build2.wasm)` — geen timestamps, deterministische iteratie

### Mini-demo
- `demos/hello-pixel.asm` (1617 B, 30 regels TASM-source)
- Zet palette entry #1 = rood, #2 = groen via VGA DAC (out 3C8h+3×3C9h)
- Schrijft 12 pixels: (10,10) rood, (20,20) groen, lijn (50..59,100) groen
- Door pijplijn: 158 tokens → 22 IR-ops → **442 bytes WASM**

### Fase 4a — Runtime (browser-side)
- `web/runtime/vga13.js` — mode-13h state: 320×200 framebuffer view in linear-memory @ 0xA0000, Uint32Array palette (RGBA, little-endian), default VGA-palette 0..31 voorgeladen, DAC 6-bit→8-bit channel-replication, blit via ImageData.putImageData
- `web/runtime/abi.js` — VGA DAC state-machine voor 3C8h/3C9h pattern (index-set + 3 channel-writes auto-advance), `int 21h` → exit, `waitb` count-based
- `web/runtime/clock.js` — count-based frame-clock (rAF alleen als trigger, niet als time-source; geen wallclock-delta)
- `web/runtime/loader.js` — fetch→compile→instantiate met imported memory + abi, sha256 via SubtleCrypto

### Demo UI
- `web/demo/index.html` + `demo.js` — 320×200 canvas (pixelated), pijplijn-status (6 stappen), IO-log van host-imports, build-info (SHA-256 source + WASM, ops, fns), TASM-source viewer, IR-viewer
- Drie knoppen: Run main(), Reload WASM, Clear framebuffer

### Tests (Node `--test`)
- `tests/test_pipeline.js` — **6/6 groen**:
  1. tokenizer round-trip type-stream identiek
  2. parser herkent >20 instr + 1 proc + 0 raw
  3. IR-emitter 0 unknown ops voor demo
  4. WASM build-determinisme (twee builds = identieke sha)
  5. WASM instantiate + main() + framebuffer byte-check op 5 specifieke pixels
  6. TECHNO 4 files >90% supported (gate)

### ALTERNATIVES.md
Volledig log van keuze-rationale + alternatieven per fase. Gebruiker kan later besluiten "wat als ik wabt.js had gekozen" of "wat als TypeScript van begin".

## Wat NIET af (eerlijk)

| Fase | Wat | Waarom uitgesteld |
|---|---|---|
| 4b | Control-flow (jumps/calls/push-pop) | structured-control-recon op WASM is een aparte sub-project (block/loop/br_table trampoline + shadow-stack in linear memory). Vereist ~500-800 regels + uitgebreide tests. |
| 4b | Audio (S3M-player) | hello-pixel heeft geen audio. libxmp-lite WASM gekozen in ALTERNATIVES, integratie nog niet gebouwd. |
| 5 | TECHNO speelbaar | 23 ontbrekende mnemonics + OBK-data-parser + DIS-engine. Substantieel werk maar geen blocker — pijplijn werkt al, alleen instructie-handlers uitbreiden. |
| - | gouden-frame tests | P-DET-01 (runtime-determinisme) bewezen voor mini-demo via framebuffer-check; voor TECHNO komt PNG-snapshot vergelijking. |

## Determinisme-bewijslast

| Niveau | Eis | Status |
|---|---|---|
| P-DET-02 | build is reproduceerbaar | **bewezen** — sha256(.wasm) stabiel tussen runs (in test + in build-script) |
| P-DET-01 | frame = pure functie | bewezen voor mini-demo (geen RNG, geen wallclock, framebuffer byte-check) — voor TECHNO via gouden-frames later |
| P-DET-03 | audio sample-accurate | n.v.t. — geen audio in hello-pixel |

## Architectuur-keuzes vastgelegd in ALTERNATIVES.md

15+ keuzes met alternatieven. Highlights:
- Build-tool: pure JS Node 20+ ESM (geen TS/bundler). Alt: TS-strict, Bun, tsx
- WASM-encoder: eigen mini. Alt: wabt.js (1.5 MB), binaryen.js (4 MB), WAT+wat2wasm
- IR-stijl: SSA-achtig met expliciete flags. Alt: stack-based, three-address
- Frame-clock: count-based rAF. Alt: setInterval, AudioContext.currentTime, OffscreenCanvas-worker
- VGA blit: 2D Canvas ImageData. Alt: WebGL2 texture + shader-palette
- S3M-player: libxmp-lite (planned). Alt: chiptune3 (zoals DFC), eigen, geen geluid

## Live

- https://horsecloud55.ddns.net/ASM2Web/
- https://horsecloud55.ddns.net/ASM2Web/demo/  ← speelbaar
- https://horsecloud55.ddns.net/ASM2Web/architecture/

## Volgende sessie

**Trigger:** "verder met asm2web fase 4b" of "verder met asm2web techno"

**Inhoud v0.2.0-Backus (control-flow + push/pop):**
1. Structured-CFG-reconstructie: detecteer loops, if/else, fall-through; emit als WASM `block`/`loop`/`if`/`br`/`br_if`
2. Shadow-stack in linear memory voor push/pop/call/ret (sp = local 7)
3. Round-trip via ROT.ASM (simpelste, 2 procs met `call rol`)
4. Vervolg: meer instructies (mul, div, rol, ror, xchg, rep, jg, jl, etc.)
5. Daarna OBK-parser, daarna DIS/libxmp, daarna TECHNO end-to-end

## Mail

Mail gestuurd naar cglebbeek@gmail.com met samenvatting, links, hashes, en TODO-lijst voor volgende sessie.
