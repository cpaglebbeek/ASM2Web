# ARCHITECTURE.md — ASM2Web

> **Route B (gekozen 2026-06-08):** per-instructie TASM → WebAssembly. Geen x86-emulator. Geen per-scene rewrite. Frame N is een pure functie.

## 1. Hoog-niveau pipeline

```
┌─────────────────┐    ┌──────────┐    ┌────────┐    ┌──────────────┐    ┌────────────┐
│ TASM-bron (.ASM)│ -> │ Tokenizer│ -> │ Parser │ -> │ IR (typed,   │ -> │ WASM-      │
│ + .INC + macro's│    │          │    │        │    │ deterministic│    │ codegen    │
└─────────────────┘    └──────────┘    └────────┘    │ SSA-achtig)  │    └─────┬──────┘
                                                     └──────────────┘          │
                                                                               v
                                                                       ┌─────────────┐
                                                                       │ .wasm-module│
                                                                       └─────┬───────┘
                                                                             │
            ┌────────────────────────────────────────────────────────────────┘
            v
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Runtime (browser, deterministisch)                                              │
│  - Frame-clock (vast 70 Hz, telling-gebaseerd, GEEN wallclock-fallback)         │
│  - Linear memory (1 MiB DOS-segment-vlak)                                       │
│  - VGA mode-13h canvas (320×200, 256-kleuren palette via Uint32Array)           │
│  - DIS → WebAudio (S3M-player, sample-accurate; eigen scheduler i.p.v. AC.time) │
│  - Input → keyboard/mouse → buffered, sampled op frame-grens                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Componenten

### 2.1 Bron-laag (`vendor/SecondReality_source/`)

Bevroren mtuomi/SecondReality @ `071a82e`. Nooit wijzigen. SHA256 per gebruikt bestand vastgelegd in `modules/<name>/INVENTORY.md`. Bij hash-mismatch → fail-hard.

### 2.2 Tokenizer (`src/tasm/tokenizer.ts` — fase 1)

TASM-tokens: directives (`SEGMENT`, `PROC`, `ASSUME`, `.386`, `LOCALS`, `extrn`), labels (`identifier:`), instructies (mov, add, ...), operanden (registers, memory `[]`, immediates `0...h`, `dup`-syntax), comments (`;`), expressies (`+`, `-`, `*`).

Out: token-stream + bron-locaties (file:line:col) voor diagnostics.

### 2.3 Parser (`src/tasm/parser.ts` — fase 1)

Bouwt AST per file: segment-blokken bevatten label-defs + instructie-defs + data-defs (`dw`, `db`, `dd`). Resolveert `extrn`/`public` cross-file via symbol-table.

### 2.4 IR (`src/ir/types.ts` — fase 2)

Typed SSA-achtige tussenrepresentatie. **Geen impliciete volgorde-vrijheid.** Elke instructie heeft een vaste positie in de program-order. Flag-registers expliciet als waarden, geen impliciete read-after-write.

Voorbeeld:
```
%1 = load.u16 [bp+0x04]           ; mov ax,[bp+4]
%2 = and.u16 %1, 0x000F            ; and ax,000Fh
%3 = setflags.zf %2                ; ZF=(result==0)
br.eq %3, .L1, .L2                 ; jz .L1
```

### 2.5 WASM-codegen (`src/codegen/wasm.ts` — fase 3)

IR → WebAssembly Text (`.wat`) → `.wasm` via `wabt.js` (of eigen encoder voor full determinisme).

Vaste opcode-mapping. Geen optimizer passes die rondom-state afhankelijk zijn (om byte-identieke output te garanderen bij identieke IR).

### 2.6 Runtime (`web/runtime/*` — fase 4)

- **Frame-clock:** `frame++` op vaste tick (70 Hz = 14.285 ms). `requestAnimationFrame` triggert frame-uitvoering MAAR clock-waarde komt nooit uit `performance.now()` — clock is *count*-gebaseerd.
- **Linear memory:** 1 MiB `WebAssembly.Memory({initial: 16})`. Segmenten + offsets via JS-helpers.
- **VGA mode-13h canvas:** `ImageData(320, 200)`. Palette = `Uint32Array(256)`. Pixel-write naar offset `0xA0000` in linear memory wordt op frame-eind ge-blit via palette-lookup.
- **DIS→WebAudio:** S3M-player parseert MUSIC0.S3M/MUSIC1.S3M, genereert samples in `AudioWorklet`. Scheduler-tikken zijn telling-gebaseerd, niet `AudioContext.currentTime`. `dis_musrow()` retourneert huidige pattern-row als pure functie van (sample-count, pattern-table).
- **Input:** keyboard/mouse events → buffered queue, ge-sampled op frame-grens (geen jitter).

### 2.7 Architecture-viewer (`web/architecture/index.html` — fase 0, huidig)

Statische hand-crafted SVG van bovenstaande pipeline. Leest `docs/modules.json` om per module een blok toe te voegen. Geen RNG, geen libs, geen layout-engine.

## 3. Modules

Elke module = subdirectory `modules/<name>/` met:
- `INVENTORY.md` — per-file metadata + SHA's + doel
- `MAP.md` — proc-mapping bron→WASM-symbool (fase 2+)
- `INSTRUMENTATION.md` — welke runtime-hooks deze module nodig heeft (VGA-write, S3M-play, vsync-wait)
- `tests/` — gouden-frame snapshots (PNG bytes) per frame-index (fase 4+)

**TECHNO (eerste module):** zie `modules/techno/INVENTORY.md`.

## 4. Determinisme — bewijslast

Drie aparte determinisme-eisen, elk apart bewijsbaar:

1. **Build-determinisme:** zelfde input-files → byte-identieke `.wasm`. Bewijs: `sha256(build1.wasm) == sha256(build2.wasm)` (CI-check).
2. **Runtime-determinisme:** zelfde program + input-trace + frame-N → byte-identiek `ImageData`. Bewijs: gouden-frame snapshots per module (fase 4+).
3. **Audio-determinisme:** zelfde program + frame-N → byte-identieke sample-buffer (44.1 kHz). Bewijs: WAV-checksum per N seconden (fase 4+).

## 5. Niet-doelen

- **Pixel-perfect originele resolutie:** nee — wel mode-13h 320×200 als logische coördinaten, schalen via CSS `image-rendering: pixelated`.
- **Cycle-accurate 80386-timing:** nee — instructies zijn deterministisch in *programma-volgorde* maar niet in *clock-cycles*. Frame-budget bepaalt aantal instructies per frame.
- **DOS int 21h-volledigheid:** nee — alleen de subset die TECHNO daadwerkelijk gebruikt (4Ch exit). Per module wordt vastgelegd welke ints noodzakelijk zijn.
- **Hardware Sound Blaster / GUS emulatie:** nee — DIS wordt op hoger niveau geport naar S3M-decoding + WebAudio.

## 6. Afhankelijkheden tussen componenten

```
Tokenizer ──> Parser ──> IR ──> WASM-codegen ──> .wasm
                              ^
                              │
                     Symbol-table (cross-file)
                              │
   Runtime API-headers (mode13h-write, dis-musrow, waitb, ...)
                              │
                     Module-MAP.md per module
```

Wijzigingen aan IR-types breken alle codegen (rood). Wijzigingen aan codegen mogen IR niet aanraken (groen/oranje). Runtime-API is een **stabiel contract** — wijzigen = breken van alle WASM-modules (rood).

Volledige impact-matrix: zie `DEPENDENCIES.md`.

## 7. Open vragen (fase 0 → fase 1)

- TASM-macro-systeem: hoever uitwerken? Minimaal `LOCALS` + `include` + `dup(...)` voor TECHNO. Macro-uitbreiding evalueren wanneer module 2 (STARFIELD?) andere constructies gebruikt.
- 386-instructies in TECHNO: `.386` directive aanwezig — welke 32-bit-instructies daadwerkelijk gebruikt? Te bepalen in fase 1 parser-pass.
- `disc.obj` (DIS-engine) linked binary — fase 4-keuze: TASM-source van DIS reconstrueren of OBJ disassemblen of higher-level S3M-player port (laatste = praktisch).
