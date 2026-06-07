---
date: 2026-06-08
repo: ASM2Web
status: done
resume: ""
---

> **Status update 2026-06-08**: fase 1-4a afgehandeld in sessie `001_fase1to4a.md` (v0.1.0-Hopper, mini-demo speelbaar). Resume-haak doorgeschoven naar die sessie.

---

# Sessie 2026-06-08 — newp ASM2Web v0.0.1-Booth (skeleton + deploy)

## Vraag

> newp "ASM2Web" op basis van https://github.com/mtuomi/SecondReality. Modulair beschikbaar, interactief in browser, deterministisch en voorspelbaar vanuit architectuur, geen stochastische rendering. Begin met "Techno" (beeld + geluid). Plaats op horsecloud55.ddns.net/ASM2Web. Architecture viewer HTML beschikbaar, link op de plaats. Meteen bouwen + deploy.

## WhatIf-uitkomst

Vijf vragen voorgelegd; gebruiker antwoordde **B** = route B (per-instructie .ASM → WASM transpilatie, geen x86-emulator). Aannames voor 1/3/4/5 (mtuomi/SR + turn-1 skeleton-scope + Retro_Computing ecosysteem + codenaam Booth) als default genomen.

## Wat gebouwd

### Repo + docs (newp-protocol)
- `LICENSE` AGPL-3.0
- `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `BUILD_PLAN.md`, `PRINCIPLES.md`, `DEPENDENCIES.md`
- `version.json` = `0.0.1-Booth`
- `.gitignore`

### TECHNO-module inventaris
- `modules/techno/INVENTORY.md` — 7 files (KOEA/KOEB/POLYCLIP/ROT + KOE/READP + MAKEFILE) met regels, bytes, labels, externs, procs, **SHA256**, per-file rol
- `docs/modules.json` + `web/modules.json` — machine-readable, leesbaar door viewer en frontend
- Bron-EXE TECHNO.EXE = 31849 bytes, SHA `2339b0…597c1f`
- Bron-muziek MUSIC0.S3M (391312 B) + MUSIC1.S3M (600860 B) met SHA's

### Frontend
- `web/index.html` + `style.css` + `main.js` — pure HTML/CSS/JS, geen libs, geen `Math.random()`, geen wallclock
- Toont fase-status, module-overzicht, determinisme-bewijslast, links naar docs

### Architectuur-viewer
- `web/architecture/index.html` + `viewer.js`
- Hand-crafted SVG (geen D3/Mermaid) — pipeline + runtime + ABI-contract
- Leest modules.json voor ABI-tabel en module-lijst (gesorteerd op ordinal)

### Deploy
- `deploy/deploy-hc55.sh` — rsync naar `/var/www/asm2web/web/` + nginx snippet `/etc/nginx/snippets/asm2web-locations.conf`
- Live op `https://horsecloud55.ddns.net/ASM2Web/`
- Architectuur-viewer op `https://horsecloud55.ddns.net/ASM2Web/architecture/`

### Meta_Master sync
- `PROJECTS.json` Retro_Computing-entry voor ASM2Web
- `STATUS.md` rij
- `SHARED_INFRASTRUCTURE.md` — ASM2Web als nginx-direct static (geen poort, conform LLMShapes-patroon)
- Memory file + git-mirror + MEMORY.md pointer

## Architectuur-keuze (route B)

**Per-instructie .ASM → WASM** met eigen pipeline:
```
Tokenizer → Parser → IR (typed SSA-achtig) → WASM-codegen → .wasm-module → Runtime (mode-13h + DIS-WebAudio)
```

Drie determinisme-eisen, elk apart bewijsbaar:
1. **Build:** zelfde source → byte-identieke .wasm
2. **Runtime:** zelfde program + frame-N → byte-identieke ImageData
3. **Audio:** zelfde program + frame-N → byte-identieke samples

Niet-doelen: pixel-perfect 320×200 hardware, cycle-accurate 80386-timing, complete DOS int-set, hardware Sound Blaster emulatie.

## Trade-offs / risico's (voor fase 1+)

- **DIS-engine** is binary (`disc.obj`) — vermoedelijk geen TASM-source in `TECHNO/`. Strategie fase 4: óf bron elders in SR-repo zoeken, óf vervangen door open-source S3M-player (libxmp-port) als DIS-engine te ondoorgrondelijk. Trade-off: hogere garantie vs sneller speelbaar.
- **TASM-macro's** — alleen wat TECHNO + volgende module daadwerkelijk gebruiken. Geen volledige TASM-compat.
- **KOE.C (driver)** — voorkeur: in TypeScript herschrijven (glue-code), niet via C→WASM. Pure rendering blijft WASM. Alternatief: TCC-route (ingewikkeld).
- **OBK-data files** (`_CIRCLE.OBK`, `_CIRCLE2.OBK`) — OMF-formaat parsen + naar WASM-data-segment.

## Volgende sessie

**Trigger:** "verder met ASM2Web" of "verder met asm2web fase 1"

**Inhoud v0.0.2-Wheeler:**
1. `src/` tooling-stack opzetten (TypeScript strict + Vite of esbuild, beslissing fase-1-start)
2. Tokenizer: TASM-syntax volledig voor TECHNO-subset (directives, labels, instructies, operanden, `dup()`, `0Fh`)
3. Parser: SEGMENT/PROC/ASSUME/extrn/public/include + AST-dump deterministisch
4. Symbol-table cross-file (KOEA ↔ KOEB ↔ POLYCLIP)
5. Round-trip test: lex → parse → pretty-print = identiek aan input modulo whitespace
6. AST-dump SHA-stabiel tussen runs

## Bestanden gemaakt in deze sessie

(structuur in alfabetische volgorde voor reproduceerbaarheid)
```
.gitignore
ARCHITECTURE.md
BUILD_PLAN.md
CLAUDE.md
DEPENDENCIES.md
LICENSE
PRINCIPLES.md
README.md
deploy/deploy-hc55.sh
docs/modules.json
modules/techno/INVENTORY.md
prompts/000_newp.md
prompts/README.md
version.json
web/architecture/index.html
web/architecture/viewer.js
web/index.html
web/main.js
web/modules.json
web/style.css
```

## Cross-refs

- DecompilingFutureCrew (zusterproject Retro_Computing) — andere aanpak (per-scene TS-rewrite), aanvullend niet vervangend
- Meta_Retro_Computing sub-master — ecosysteem-coördinatie
- SecondReality_source `071a82e` — gedeelde bron met DecompilingFutureCrew
