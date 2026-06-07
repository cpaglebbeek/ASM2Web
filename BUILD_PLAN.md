# BUILD_PLAN.md — ASM2Web fase-roadmap

## Fase 0 — Skeleton (v0.0.1-Booth) — **HUIDIG**

Doel: project op kaart, alle docs, eerste module ge-inventariseerd, viewer + frontend live.

- [x] Repo + LICENSE AGPL-3.0
- [x] Alle newp-docs (CLAUDE/ARCHITECTURE/BUILD_PLAN/PRINCIPLES/DEPENDENCIES)
- [x] TECHNO-module inventaris (4 ASM + 2 C + MAKEFILE, SHA's, procs)
- [x] Frontend-skeleton statisch (geen libs, geen RNG)
- [x] Architecture-viewer SVG
- [x] Deploy naar `horsecloud55.ddns.net/ASM2Web/`
- [x] Meta_Master + memory sync + RESUME-tag

**Bewijs:** site bereikbaar, viewer leest `docs/modules.json`, INVENTORY toont 7 files met SHA's.

## Fase 1 — TASM-parser (v0.0.2-Wheeler)

Doel: alle 4 TECHNO ASM-files parseren tot AST zonder verlies.

- [ ] Tokenizer: TASM-syntax (directives, labels, instructies, operanden, `dup()`, `0Fh`-hex)
- [ ] Parser: SEGMENT/PROC/ASSUME/extrn/public/include
- [ ] Symbol-table cross-file (KOEA ↔ KOEB ↔ POLYCLIP ↔ ROT)
- [ ] AST-dump → `modules/techno/AST.json` (deterministisch, byte-identiek bij rebuild)
- [ ] Test: 100% van regels in 4 ASM-files round-trippen (lex → parse → pretty-print → identiek aan input modulo whitespace)

**Bewijs:** `npm run parse:techno` → `AST.json` SHA matcht referentie-hash.

## Fase 2 — IR-emitter (v0.0.3-Wheeler)

Doel: AST → typed SSA-IR voor alle 21+10+3+2 = 36 procs in TECHNO.

- [ ] IR-types: registers (ax/bx/...) als SSA-values, flags expliciet, memory-ops getypeerd
- [ ] Instructie-set TECHNO-subset: minimaal `mov`/`add`/`sub`/`xor`/`and`/`or`/`shr`/`shl`/`cmp`/`jmp`/`jz`/`jnz`/`call`/`ret`/`push`/`pop`/`int`/`in`/`out`/`loop`/`mul`/`div`/`stosb`/`movsb`
- [ ] String-ops + segment-overrides (ES:DI, DS:SI, FS:, GS:)
- [ ] 386-extensies indien gevonden in pass-1 (vermoedelijk pusha/popa + 32-bit reg-vars)
- [ ] IR-dump → `modules/techno/IR.json` deterministisch

**Bewijs:** elke proc heeft IR + IR rondrekent niet (geen impliciete-flag-bug).

## Fase 3 — WASM-codegen (v0.1.0-Hopper)

Doel: IR → `.wasm` voor TECHNO. Symbool-export per proc.

- [ ] WASM-emitter: linear memory, vaste opcode-mapping per IR-instructie
- [ ] Reproducible: zelfde IR → byte-identieke `.wasm` (geen timestamps, geen optimizer-randomness)
- [ ] `techno.wasm` + `techno.wasm.map` (source-map terug naar .ASM:regel)
- [ ] Build-CI: `sha256(build).wasm` matcht referentie

**Bewijs:** twee builds in een rij produceren identieke `.wasm` bytes.

## Fase 4 — Runtime + TECHNO live (v0.2.0-Backus)

Doel: TECHNO daadwerkelijk speelbaar in browser, byte-identiek frame-stream.

- [ ] Frame-clock 70 Hz, telling-gebaseerd
- [ ] Mode-13h canvas (`ImageData(320,200)` + 256-palette)
- [ ] DIS→WebAudio S3M-player (MUSIC0.S3M of MUSIC1.S3M — TECHNO-specifieke kiezen na inspectie)
- [ ] vsync-wait (`waitb`) → WebAudio sample-count-based
- [ ] Input-stub (TECHNO heeft waarschijnlijk geen input nodig)
- [ ] Gouden-frame test: frame 0, 100, 500, 1000 → PNG-SHA matcht referentie

**Bewijs:** TECHNO loopt 60 seconden in browser, frame-100 PNG-SHA identiek tussen run-1 en run-2.

## Fase 5 — Tweede module (v0.3.0-Rochester+)

Doel: bewijs dat het systeem generiek werkt (niet alleen TECHNO-specifiek).

Kandidaten op volgorde van complexiteit:
- **STARFIELD** (DDSTARS) — eenvoudig, klein, weinig procs
- **GLENZ** — 3D wireframe, palet-tricks
- **DOTS** — particles
- **TUNNELI** — pipe-snake, complexer
- **TWIST/GRID** — mesh-effects

Mogelijk dat nieuwe ASM-constructies (macros, andere int-calls) parser/IR-uitbreiding eisen. Elke uitbreiding is een aparte versie-bump.

## Fase 6+ — Tooling rijper maken

- Source-map UI in viewer (klik op WASM-symbol → spring naar .ASM-regel)
- Interactieve debugger (pauze, single-step IR, registers tonen)
- Side-by-side: originele TECHNO.EXE in v86 vs ASM2Web-versie → frame-diff visualisatie
- LIVE-coding: pas .ASM aan in browser, zie hertranspilatie + herstart
- Multi-module compositie: meerdere modules sequentieel zoals SR-timeline

## Risico's / niet-doelen

- **DIS-engine kost veel werk** — S3M is open spec maar Future Crew's mixer is custom. Fallback: open-source S3M-player (libxmp-port) als DIS te ondoorgrondelijk blijkt. Trade-off: lager determinisme-garantie maar wel speelbaar.
- **TASM-macro's** — zware uitbreidingen kosten weken. Strategie: alleen wat TECHNO + volgende-module daadwerkelijk gebruikt.
- **Compleetheid x86-instructieset** — geen doel. Alleen wat in modules voorkomt.
