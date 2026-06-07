# CLAUDE.md — ASM2Web

## Wat is dit project

ASM2Web is een **deterministische** TASM-naar-WebAssembly transpilatieketen voor historische 16-bit x86 demoscene-modules. Eerste doel-module: **TECHNO** uit Second Reality (Future Crew, 1993).

**Architectuur-keuze (route B uit WhatIf 2026-06-08):** per-instructie .ASM → WASM-codegen. Geen x86-emulator, geen per-scene rewrite.

## Niet-onderhandelbare principes (zie PRINCIPLES.md)

1. **Determinisme** — frame N is pure functie van (program-bytes, frame-index, input). Zelfde input → byte-identieke output.
2. **Geen stochastische rendering** — geen `Math.random()`, geen wallclock-timing in render-loop, geen async race in frame-pad.
3. **Expliciete vastlegging** — elke ASM-file, elke proc, elke instructie-mapping is gedocumenteerd vóór code wordt geschreven.
4. **Reproduceerbare build** — `npm run build` (later) levert byte-identieke output bij identieke source (geen timestamps in bundle).

## Feature/Bugfix kleurcodering (cf. global protocol)

**Nieuwe feature:**
- Groen: per-instructie support uitbreiden (bv. nieuwe opcode-handler) → +0.0.1
- Oranje: nieuwe module geport (bv. STARFIELD na TECHNO) of nieuwe runtime-subsystem (bv. DIS-player) → +0.1.0
- Rood: architectuur-shift (bv. WASM-MVP → SIMD-extensies, of bytecode-IR herontwerp) → +1.0.0

**Bugfix:**
- Groen: codegen-fix in 1 opcode-handler (fysiek)
- Geel: IR-emitter logica-fout (logisch)
- Rood: determinisme-breuk gevonden (conceptueel — vereist Security Audit + Determinism Audit)
- Loop: hopeloze debug → wissel aanpak

**RCA verplicht** bij elke bugfix: oorzaak op 3 niveaus (Functioneel / Technisch / Architectonisch).

## Codenaam-thema

Pioniers van assembler / lage-niveau talen:
- v0.0.x **Booth** (Kathleen Booth, 1947 — eerste assembleertaal voor ARC)
- v0.0.2+ **Wheeler** (David Wheeler, EDSAC subroutines 1949)
- v0.1.x **Hopper** (Grace Hopper, A-0 compiler 1952)
- v0.2.x **Backus** (John Backus, FORTRAN 1957)
- v0.3.x **Rochester** (Nathaniel Rochester, IBM 701 assembler 1954)
- v0.4.x **Wilkes** (Maurice Wilkes, EDSAC + microprogrammering)

## WhatIf-protocol (verplicht, voor elke wijziging)

Vóór elke actie: terugkoppel begrip → plan → impact → vraag akkoord. Alleen triviale fixes (typo, 1-regel-edit op expliciete instructie) mogen zonder volledige WhatIf — maar benoem dan minimaal wat je gaat doen.

## ZSH-veiligheid

Dit project draait op een Mac met zsh. **Nooit** `path` als variabelenaam gebruiken in bash-commando's (zsh tied parameter overschrijft `PATH`). Gebruik `repo_path`, `local_path`, `p`, `dir`.

## Versioning

Elke functionele wijziging → bump `version.json` + codenaam vóór build/commit.

## Build

Fase 0 (huidig): geen build — pure statische HTML/CSS/JS. Deploy = `deploy/deploy-hc55.sh` (rsync naar `/var/www/asm2web/web/`).

Fase 1+ (BUILD_PLAN.md): TASM-parser + IR + WASM-codegen — tooling-stack nog te kiezen (waarschijnlijk TypeScript-strict + Vite of esbuild). Reproduceerbare build (geen timestamps in output) is non-negotiable.

## Deploy

Live op `horsecloud55.ddns.net/ASM2Web/`. Nginx-direct static (geen backend). Path conventie als LLMShapes/PDFHorse. Deploy-script: `deploy/deploy-hc55.sh`.

**SHARED_INFRASTRUCTURE awareness:** ASM2Web heeft géén poort (static). Wijzigingen aan nginx ALTIJD via snippet `/etc/nginx/snippets/asm2web-locations.conf` zodat de gedeelde `/etc/nginx/sites-enabled/horsecloud` niet wordt overschreven.

## Bron-relatie

- Upstream: `mtuomi/SecondReality` @ `071a82e` (Unlicense, 1993-source).
- Lokaal naast: `/Users/christian/Documents/Gemini_Projects/SecondReality_source/` — bevroren, nooit wijzigen.
- Per module in `modules/<name>/INVENTORY.md`: SHA256 van elk gebruikt bronbestand. Bij upstream-hash-mismatch → fail-hard, geen silent-update.

## Memory & Meta_Master

- Memory file: `~/.claude/projects/-Users-christian/memory/project_asm2web.md`
- Git-mirror: `Meta_Master/claude_memory/project_asm2web.md`
- Resume-tag in `prompts/000_newp.md` frontmatter — verschijnt automatisch in `Meta_Master/RESUME.md` na `tools/update_resume.py`.

## Sessie-protocol

- Bij sessiestart: pull Meta_Master, lees deze CLAUDE.md, lees `ARCHITECTURE.md` voor route-B-context.
- Bij `/sanitycheck`: verifieer dat elke ASM-file in `modules/*/INVENTORY.md` voorkomt en dat SHA's matchen tegen `vendor/SecondReality_source` (of zustermap).
- Bij `/verifyrules`: post-response statusblok, frontmatter-check op sessie-MD, multi-session check, ZSH-veiligheid.
- Bij "over en uit" / OEU: commit + push + Meta_Master update + memory sync + RESUME regenereren.
