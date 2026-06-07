# PRINCIPLES.md — ASM2Web

> Niet-onderhandelbare ontwerpkeuzes. Wijziging = rood (major) en vereist expliciete WhatIf + akkoord.

## P-DET-01 — Frame is een pure functie

`frame(N, program, input_trace[0..N]) → ImageData`

Geen verborgen state. Geen `Math.random()`. Geen `Date.now()` / `performance.now()` in render-pad. Geen `requestIdleCallback`. Geen async-werk dat frame-grens kan overschrijden.

**Toets:** twee runs van programma met identieke input-trace produceren identieke pixel-bytes bij elke frame-index.

## P-DET-02 — Build is reproduceerbaar

`build(source_tree) → wasm_bytes`

Zelfde source → identieke `.wasm`. Geen timestamps in bundle. Geen environment-specifieke paden. Geen parallel-codegen met race-condities.

**Toets:** `sha256(build1.wasm) == sha256(build2.wasm)` op verschillende machines.

## P-DET-03 — Audio is sample-accurate

`audio(N, program) → Float32Array[44100]` voor seconde N.

Geen `AudioContext.currentTime` in scheduler. WebAudio's worklet draait op tellingen, niet op wallclock. `dis_musrow()` retourneert pattern-row als pure functie van sample-count.

**Toets:** WAV-checksum per 10 seconden identiek tussen runs.

## P-DET-04 — Geen optimizer-randomness

Codegen mag geen pass-ordering hebben die afhangt van hashmap-iteratie of pointer-adressen. Gebruik gesorteerde collecties, deterministische seeds (waar überhaupt nodig — meestal niet).

## P-ARC-01 — Expliciete vastlegging vóór code

Elke ASM-file → INVENTORY.md vóór parser-werk. Elke proc → MAP.md vóór codegen. Elke runtime-hook → INSTRUMENTATION.md vóór runtime-werk.

"Maar het is toch overduidelijk wat dit doet" is **geen** geldig argument om dit over te slaan.

## P-ARC-02 — Modules zijn zelfbeschrijvend

Een module-dir (`modules/<name>/`) bevat **alles** om die module te begrijpen, los van de rest van de repo. Toekomstige lezers moeten met alleen die map de module-context kunnen reconstrueren.

## P-ARC-03 — Bron is bevroren

`vendor/SecondReality_source/` is **read-only**. Nooit patches, nooit fixes. Als bron buggy is, fixen we in onze transpilatieketen of in de module-INSTRUMENTATION — niet in de bron.

Bron-SHA per gebruikt bestand vastleggen in `modules/<name>/INVENTORY.md`. Hash-mismatch bij build → fail-hard.

## P-ARC-04 — Runtime-API is een contract

Functies die WASM-modules aanroepen op de runtime (mode13h_write, dis_musrow, waitb, ...) zijn een **stabiel ABI**. Wijziging = rood, alle modules moeten worden ge-hertranspileerd.

## P-ARC-05 — Geen frameworks in productie-frontend

Frontend (`web/*`) is pure HTML/CSS/JS. Geen React, geen Vue, geen jQuery, geen bundler in fase 0. Reden: determinisme + transparantie + minimale supply-chain. Pas vanaf fase 1 (TASM-parser) komt TypeScript + Vite/esbuild in beeld — voor de **build-keten**, niet voor de runtime-frontend.

## P-ARC-06 — Architectuur-viewer is statisch

`web/architecture/index.html` toont een hand-crafted SVG. Geen D3, geen Mermaid, geen layout-engine. Reden: layout-engines hebben non-deterministische edge-cases (force-directed layouts, font-metric verschillen). De architectuur is bekend; we tekenen 'm zelf.

## P-DOC-01 — Drie bewijslast-niveaus

Elke claim "deterministisch" moet bewijsbaar zijn op drie niveaus:
1. **Build-determinisme** (P-DET-02)
2. **Runtime-determinisme** (P-DET-01)
3. **Audio-determinisme** (P-DET-03)

Geen "we denken dat het deterministisch is". Of bewezen, of gemarkeerd als open.

## P-DOC-02 — Codenamen verwijzen naar pioniers

Versie-codenaam moet een echte historische figuur zijn uit de assembler/lage-niveau-talen lineage. Geen marketing-namen.

## P-AGT-01 — Multi-session

Bij sessiestart: `git pull` + `git log --oneline -5` op deze repo. Uncommitted changes → vraag of andere sessie actief is. Recente commits van andere agenten → lees commit-messages voor context.

## P-AGT-02 — Architectuur-keuzes hebben een WhatIf-spoor

Elke architectuur-shift (route A→B, IR-design, codegen-strategie) heeft een sessie-MD in `prompts/` met expliciete impact-analyse en akkoord. Geen "het is nu zo gegroeid".

## P-SEC-01 — AGPL-3.0 voor eigen code

Eigen code = AGPL-3.0. Vendor-code blijft onder eigen licentie (mtuomi/SecondReality = Unlicense; respecteren we). Mengvormen vermijden — vendor blijft in `vendor/`, eigen code in `src/` + `web/`.
