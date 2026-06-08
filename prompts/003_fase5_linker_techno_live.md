---
date: 2026-06-08
repo: ASM2Web
status: open
resume: "verder met ASM2Web fase 6 — (1) chiptune3 (libopenmpt, BSD-3-Clause) vendoren + AudioWorklet binding voor S3M-playback van MUSIC0.S3M, (2) exacte x86-semantiek: segment:offset memory + zelfmodificerende code-detectie, (3) gouden-frame test (PNG-SHA snapshots) voor P-DET-01 vol bewijs op TECHNO frames 100/500/1000, (4) andere SR-scenes geport: STARFIELD/GLENZ/DOTS/TUNNELI/TWIST/GRID, (5) optionele Driver-mod-tester voor visuele verschillen tussen runs. v0.4.0-Wilkes."
---

# Sessie 2026-06-08 — ASM2Web fase 5 (linker + TECHNO browser-runtime)

## Vraag

> "ga verder met bouwen"

## Wat is af in deze sessie

### Linker (`src/link/linker.js`) ✓
- Cross-file IR-module combinatie: KOEA + KOEB + POLYCLIP samen.
- Symbol-table: function-naam → global-fn-index. Duplicate handling (first-wins, 8 duplicates in TECHNO).
- Data-layout: extern bytes geplaatst op aligned offsets vanaf 0x10000.
- Symbol-rewrite: `{kind:'sym', name:'_circle'}` → `{kind:'const', value:0x10000}`.
- Memory-expression rewrite: `[_circle + bx]` met IDENT-resolutie naar NUMBER-offset.
- Stats: totaal-ops, duplicates, externals resolved, unresolved.

### TECHNO-link CLI (`src/cli/link-techno.js`) ✓
- Parse KOEA+KOEB+POLYCLIP, load _CIRCLE.OBK + _CIRCLE2.OBK.
- Output: `techno-linked.wasm` **59699 bytes**, 27 exports.
- _circle @ 0x10000 (24000 B), _circle2 @ 0x15E00 (8000 B).
- 8 duplicate functies tussen KOEA en KOEB (waitb, bltline, etc.) — eerste wint.
- 1288 totaal IR-ops gelinkt. 3 unresolved symbols (no critical impact).
- **Link+build-determinisme bewezen**: zelfde sha256 bij dubbele link.

### KOE.C driver (`web/runtime/koe-driver.js`) ✓
- KOE.C 728 regels MS C → ~150 regels JavaScript orchestrator.
- Per-frame aanroep van asminit/blitinit/asmdoit/rotate1/do_interference.
- Default palette setup voor zichtbaarheid bij start.
- Music-row counter voor pseudo-DIS-sync.
- Error-handling: log eerste 5 errors, daarna suppress.

### Audio engine basis (`web/runtime/audio.js`) ✓
- Silent-mode + deterministic music-row counter (pure JS).
- Plek voor chiptune3 (libopenmpt) vendoring — fase 6 werk.

### TECHNO browser-runtime (`web/techno/`) ✓
- `index.html`: 320×200 canvas (2× scaled = 640×400), info-panel
  (WASM bytes/SHA, frame counter, FPS, non-zero pixels, errors), 4
  control-knoppen (Init+Start / Single Step / Pause / Reset), console.
- `techno.js`: laadt techno-linked.wasm, init KoeDriver, draait frame-loop
  via requestAnimationFrame, blit naar canvas, update stats.
- Live op https://horsecloud55.ddns.net/ASM2Web/techno/.

### Test-suite uitgebreid (10/10 groen)
- `tests/test_linker.js`: 4 nieuwe tests
  1. OBK-parser extracts _circle 24000 B met exacte SHA
  2. TECHNO link produceert valid WASM module (>50K, <200K)
  3. Link is deterministisch (zelfde sha bij dubbele build)
  4. WASM instantieert + OBK-data op verwachte offsets + functies callable

## Wat NIET af (eerlijk, voor v0.4.0-Wilkes)

| Item | Waarom uitgesteld | Effort |
|---|---|---|
| **Chiptune3 S3M-audio** | Vendor van libopenmpt WASM (~500 KB) + AudioWorklet scriptlet als aparte file. Inhoudelijk verbinding tussen WebAudio sample-count en dis_musrow. | ~200 regels + asset |
| **Exacte x86 segment-semantiek** | TECHNO's IR heeft segment-overrides (ES:[DI], DS:[SI]) die nu als flat-memory worden behandeld. Voor pixel-perfect output zou een segment-tracker nodig zijn. | ~300 regels |
| **Gouden-frame test** | PNG-SHA snapshot framework voor frames 100/500/1000. Vereist deterministische seed + sample-trace. | ~150 regels |
| **Andere SR-scenes** | STARFIELD/GLENZ/DOTS/TUNNELI/TWIST/GRID — per scene aparte IR+codegen run. Sommige hebben andere ASM-constructs (POVRay-input voor WATER, etc.). | per scene 1-3u |

## Determinisme-bewijs

| Niveau | Status |
|---|---|
| P-DET-02 (build) | **BEWEZEN** op alle niveaus: hello-pixel, rot, koea, techno-linked. Alle 4 sha-stabiel. |
| P-DET-01 (runtime) | Bewezen voor mini-demo + ROT.ASM (byte-exact). TECHNO draait deterministisch (geen RNG, geen wallclock in driver) maar visuele output is approximatie (geen segment-tracker). |
| P-DET-03 (audio) | Silent-mode is volledig deterministisch (pure counter). Echte chiptune3-audio zou sample-count-deterministisch zijn. |

## Live

- https://horsecloud55.ddns.net/ASM2Web/
- https://horsecloud55.ddns.net/ASM2Web/techno/      ← **TECHNO browser-runtime**
- https://horsecloud55.ddns.net/ASM2Web/demo/
- https://horsecloud55.ddns.net/ASM2Web/architecture/

## Volgende sessie — v0.4.0-Wilkes

**Trigger:** "verder met asm2web fase 6" of "verder met asm2web audio"

Maurice Wilkes — schreef EDSAC (1949) en microprogrammering, conceptueel
de architect die hardware-doelen op een hogere laag vertaalde naar
microcode. Past bij fase 6 die exact-x86-semantiek + audio toevoegt.

**Stappen:**
1. Vendor chiptune3 (BSD-3-Clause) + AudioWorklet binding.
2. Implementeer x86 segment-tracker in IR: DS/ES/SS/CS aparte locals,
   `mov ax, segname` → const-load, segment-overrides in mem-ops correct
   resolveren.
3. Detect + handle zelfmodificerende code: WASM-modules zijn read-only
   na compile — vereist runtime-recompilatie of interpreter-mode.
4. Build gouden-frame test framework.
5. Port STARFIELD (simpel, single-effect).
