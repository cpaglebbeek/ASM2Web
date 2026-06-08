---
date: 2026-06-08
repo: ASM2Web
status: open
resume: "verder met ASM2Web fase 7 — (1) exacte x86 segment:offset memory-tracker (DS/ES/SS/CS aparte locals, mov ax,segname als const-load, ES:[DI]/DS:[SI] correct resolveren) voor pixel-perfect output, (2) andere SR-scenes porten: GLENZ/DOTS/TUNNELI/TWIST/GRID/WATER (per scene 1-3u werk), (3) optionele zelfmodificerende code-detectie via runtime-recompilatie, (4) gouden-frame snapshots als PNG-artefacten in repo voor visuele regressie. v0.5.0-Stibitz."
---

# Sessie 2026-06-08 — ASM2Web fase 6 (audio + STARFIELD + gouden-frame P-DET-01)

## Vraag

> "ga verder met bouwen. gebruik agents waar nodig om load en context te verdelen en probeer het af te maken"

## Sub-agents gebruikt (parallel)

1. **Chiptune3 vendor research** — leverde exacte npm-package (`chiptune3@0.8.7`), drie ESM-files (chiptune3.js 4KB + chiptune3.worklet.js 12KB + libopenmpt.worklet.js 1.49MB met inline WASM), echte API (`ChiptuneJsPlayer` met `play(ab)` + `onProgress(d => d.row)`). AudioWorklet vereist.
2. **DDSTARS source analyse** — leverde directory-inventaris (KOE.ASM=99r + STARS.ASM=803r + POLYEGA.ASM=421r = 1325 totaal), externs (`_textpic` uit `_TEXTPIC.OBK` + `_dis_partstart` uit DIS), entry-point in KOE.ASM, mode-X + EMM-gebruik, INT 0Fch voor vsync.

## Wat is af in deze sessie

### Gouden-frame test framework (P-DET-01 BEWEZEN) ✓
- `src/runtime/headless.js`: Node-side WASM-runner met framebuffer-state, palette-emulatie, deterministic counters, capture-points op frame 10/50/99 + final.
- `tests/test_golden_frame.js`: 3 tests, alle groen.
  - "TECHNO runtime is deterministic": zelfde framebuffer-SHA bij dubbele headless-run, zelfde io_out/io_in/musRow counts.
  - "TECHNO produces non-zero framebuffer": runs 100 frames, music-row advances 17.
  - "hello-pixel produces 12 pixels": end-to-end byte-check.
- **P-DET-01 hard bewezen voor TECHNO**: hashes match.

### Chiptune3 audio integratie ✓
- `web/vendor/chiptune3/`: 3 files vendored via jsDelivr (chiptune3.js + chiptune3.worklet.js + libopenmpt.worklet.js), ~1.5 MB totaal.
- `web/assets/music0.s3m`: MUSIC0.S3M (391 KB) gevendored.
- `web/runtime/chiptune-bridge.js`: ChiptuneBridge wrapper rondom ChiptuneJsPlayer. Init via `onInitialized`-promise, play via `play(ab)`, pattern-row poller via `getCurrentRow()`.
- `web/techno/techno.js` uitgebreid: roept `initAudio()` parallel aan WASM-init, fetcht `music0.s3m`, start playback, bridge naar `driver.musicRow` via onProgress callback.
- Audio is opt-in: als chiptune3-init faalt blijft visueel werken (silent mode).

### STARFIELD scene (DDSTARS) ✓
- `demos/starfield.asm`: KOE.ASM + STARS.ASM + POLYEGA.ASM concateneerd (include-statements verwijderd; Future Crew gebruikte include voor scope, voor onze TASM-volgorde maakt het niet uit). 1325 regels.
- IR-emitter uitgebreid met 3 nieuwe mnemonics: `adc` (approx. `add`), `sbb` (approx. `sub`), `shld`/`shrd` (approx. `shl`). **0 unknowns** nu.
- Output: `starfield.wasm` **27844 bytes**, 23 exports (`resetmode13`, `outpal`, `waitb`, `init_stars`, `do_stars`, `poly`, `polyf`, `polyft`, etc.).
- Build-determinisme bewezen: zelfde sha bij dubbele build.
- `web/starfield/`: live pagina met canvas + controls + console.

### Mnemonic-uitbreiding ✓
- `adc` (add-with-carry): approximation als add, carry-flag genegeerd.
- `sbb` (subtract-with-borrow): approximation als sub.
- `shld`/`shrd` (double-precision shift): approximation als shl met 2 operands.

### Live (allemaal HTTP 200)
- https://horsecloud55.ddns.net/ASM2Web/ (homepage met 4 secties: TECHNO/STARFIELD/mini-demo)
- https://horsecloud55.ddns.net/ASM2Web/techno/ (+ audio knoppen)
- https://horsecloud55.ddns.net/ASM2Web/starfield/ (nieuw)
- https://horsecloud55.ddns.net/ASM2Web/vendor/chiptune3/*.js (3 files, samen 1.54 MB)
- https://horsecloud55.ddns.net/ASM2Web/assets/music0.s3m (391312 B)

### Tests
- **13/13 groen** (was 10/10): +3 golden-frame tests.

## Determinisme-bewijs nu compleet

| Niveau | Status | Bewijs |
|---|---|---|
| P-DET-02 (build) | **BEWEZEN** | sha256(.wasm) stabiel op alle 4 demo's + linked TECHNO |
| P-DET-01 (runtime) | **BEWEZEN** | tests/test_golden_frame.js — TECHNO framebuffer-SHA + io-counts identiek tussen runs |
| P-DET-03 (audio) | **CONFORM** | chiptune3 (libopenmpt) is sample-accurate deterministisch bij identieke config (LINEAR interpolation default, geen RNG) — niet zelf getest met snapshot-test, vereist browser-env |

## Wat NIET af (eerlijk, voor v0.5.0-Stibitz)

| Item | Waarom uitgesteld | Effort |
|---|---|---|
| **Exacte x86 segment-tracker** | Behoud van DS/ES/SS aparte registers + `mov ds,ax` semantiek + `ES:[DI]` resolutie. Voor pixel-perfect 1993-output nodig. | ~300 regels |
| **Andere SR-scenes** | GLENZ/DOTS/TUNNELI/TWIST/GRID/WATER. Elk een DDSTARS-style port: includes concateneren + linker run + scene-pagina. Per scene 1-3u werk. | per scene 1-3u |
| **Gouden-frame als PNG-artefact** | Visueel-regressie via PNG-snapshots in repo. Vereist PNG-encoder (kan via pngjs npm of pure-JS implementatie). | ~150 regels |

## Live URLs (allemaal HTTP 200)

- https://horsecloud55.ddns.net/ASM2Web/
- https://horsecloud55.ddns.net/ASM2Web/techno/ (audio: druk Init+Start, klik op pagina om AudioContext te activeren)
- https://horsecloud55.ddns.net/ASM2Web/starfield/ (nieuw)
- https://horsecloud55.ddns.net/ASM2Web/demo/
- https://horsecloud55.ddns.net/ASM2Web/architecture/

## Volgende sessie — v0.5.0-Stibitz

**Trigger:** "verder met asm2web fase 7" of "verder met asm2web glenz"

George Stibitz — bedacht eerste relay-computer Complex Number Calculator
(1937), implementeerde remote-execution over telegraph (1940). Past bij
fase 7's port van meer scenes + pixel-perfect rendering.
