# DEPENDENCIES.md — ASM2Web component-impact matrix

> Welke wijziging raakt wat. Gebruik bij elke PR/commit-overweging.

## Componenten

| ID | Component | Locatie | Fase |
|---|---|---|---|
| C1 | Vendor (SR-source) | `vendor/SecondReality_source/` (extern, symlink/clone) | 0 (read-only) |
| C2 | Inventory-data | `modules/<name>/INVENTORY.md` + `docs/modules.json` | 0 |
| C3 | Tokenizer | `src/tasm/tokenizer.ts` | 1 |
| C4 | Parser + AST | `src/tasm/parser.ts` | 1 |
| C5 | Symbol-table | `src/tasm/symtab.ts` | 1 |
| C6 | IR-types | `src/ir/types.ts` | 2 |
| C7 | IR-emitter | `src/ir/emitter.ts` | 2 |
| C8 | WASM-codegen | `src/codegen/wasm.ts` | 3 |
| C9 | Runtime-ABI | `web/runtime/abi.ts` | 4 |
| C10 | Frame-clock | `web/runtime/clock.ts` | 4 |
| C11 | Mode-13h canvas | `web/runtime/vga13.ts` | 4 |
| C12 | DIS→WebAudio | `web/runtime/dis.ts` + S3M-player | 4 |
| C13 | Frontend (statisch) | `web/index.html` + `style.css` + `main.js` | 0 |
| C14 | Architecture-viewer | `web/architecture/index.html` | 0 |
| C15 | Deploy-script | `deploy/deploy-hc55.sh` | 0 |

## Impact-matrix (wat breekt wat)

| Wijzig | Breekt direct | Breekt indirect | Kleur |
|---|---|---|---|
| C1 (vendor SHA-mismatch) | C2 (build fail-hard) | alles downstream | rood |
| C2 (INVENTORY veranderen) | C14 (viewer-data), CI-checks | — | groen |
| C3 (tokenizer) | C4 (parser-input) | C6, C7, C8 (via IR) | oranje |
| C4 (parser/AST) | C5 (symtab), C7 (IR-emitter) | C8 | oranje |
| C5 (symtab) | C7 | C8 | oranje |
| C6 (IR-types) | C7, C8 | runtime-ABI mogelijk | **rood** |
| C7 (IR-emitter logica) | C8-input | bug in gegenereerde WASM | oranje/geel |
| C8 (WASM-codegen) | `.wasm` output | runtime-fail | oranje |
| C9 (runtime-ABI) | **alle bestaande .wasm modules** | hertranspilatie vereist | **rood** |
| C10 (frame-clock) | C9-timing | mogelijk audio-sync | oranje |
| C11 (mode-13h) | render-output | gouden-frame tests | oranje |
| C12 (DIS) | audio-output | audio-determinisme | oranje |
| C13 (frontend) | UX | niets in build-keten | groen |
| C14 (viewer) | docs-UI | niets | groen |
| C15 (deploy) | live site | niets in code | groen |

## Build-keten flow

```
C1 → C2 (validate SHAs)
C1 → C3 → C4 → C5 → C7 → C8 → .wasm
                    ^
                    │
                   C6 (IR-types — contract)
C8 + C9 + C10 + C11 + C12 → runtime executes .wasm
```

## Runtime-ABI (C9) — stabiel contract

Functies aangeroepen door WASM-modules op de host:

| Functie | Doel | Determinisme-eis |
|---|---|---|
| `mode13h_setpixel(x, y, c)` | Pixel naar linear memory + canvas | direct, vrij van side-effects |
| `mode13h_setpal(idx, r, g, b)` | Palette-entry zetten | direct |
| `waitb()` | Wacht op vsync | count-gebaseerd, niet wallclock |
| `dis_musrow()` | Huidige music-pattern-row | pure functie van sample-count |
| `dis_init(s3m_offset)` | Music engine starten | side-effect bij init, daarna pure |
| `dis_waitb()` | Wacht op music-tick (border-sync hybride) | count-gebaseerd |
| `int_21h_4c(code)` | DOS exit | program-end signal |

**Stabiliteitsbelofte:** v0.x.y → v0.(x+1).y mag deze ABI niet breken zonder rood.

## Externe afhankelijkheden (toekomstig)

- `wabt.js` — WAT → WASM encoder (mogelijk fase 3; alternatief: eigen encoder)
- S3M-spec — Scream Tracker 3 module format (publiek)
- DIS-engine — Future Crew custom, mogelijk te omzeilen via libxmp-equivalent
- Geen NPM-deps in runtime-frontend (P-ARC-05)

## Niet-deps (bewust)

- Geen React/Vue/Svelte
- Geen webpack/rollup in fase 0
- Geen WebGL/WebGPU (mode-13h via plain 2D Canvas ImageData volstaat)
- Geen DOSBox / v86 / martypc — dat is de hele reden voor route B
