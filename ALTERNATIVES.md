# ALTERNATIVES.md — gemaakte keuzes en hun alternatieven

> Elke key-keuze tijdens de bouw is hier vastgelegd met **wat gekozen**, **welke alternatieven** er waren, en **waarom**. Bedoeld als checklist voor een toekomstige alternatieve build (heb je een gemaakte keuze terug willen draaien, hier vind je de reden + de optie die je had kunnen kiezen).

Indeling: gegroepeerd per fase. Per keuze: `[KEUZE]` + `Alternatieven` + `Reden`.

---

## Fase 0 — Repo + architectuur

### KEUZE 0.1 — Runtime-route = B (per-instructie .ASM → WASM)
- **Gekozen:** Eigen TASM→IR→WASM-pipeline. Geen emulator.
- **Alternatieven overwogen:**
  - **A** — Bouw TECHNO.EXE reproducible + draai in v86 (Fabrice Bellard x86-emu) — sneller speelbaar, lagere determinisme-belofte want emulator-internals zijn black-box.
  - **C** — Cycle-accurate 286-emu (martypc-port) — wetenschappelijk mooist, maar geen bestaande WASM-port; weken extra werk.
- **Reden:** route B is enige route die **build-determinisme** als bewijsbare property heeft (sha256-stable .wasm), niet alleen runtime-determinisme. Gebruiker-keuze 2026-06-08.

### KEUZE 0.2 — Hosting = HC55 nginx-direct (geen GitHub Pages)
- **Gekozen:** HC55 static via snippet `asm2web-locations.conf` (LLMShapes-patroon).
- **Alternatieven:**
  - GitHub Pages via Actions (zoals DecompilingFutureCrew) — gratis CDN, automatic SSL, maar geen control over cache-headers en COOP/COEP voor WASM-threads later.
  - Cloudflare Pages — vergelijkbaar.
- **Reden:** gebruiker vroeg expliciet HC55. Geeft ons full control over MIME-types en CORS/COOP-headers die later nodig zijn voor WebAssembly SharedArrayBuffer.

### KEUZE 0.3 — Architectuur-viewer = hand-crafted SVG (geen layout-engine)
- **Gekozen:** Statische SVG met handgeplaatste coördinaten.
- **Alternatieven:**
  - Mermaid.js — populair, maar layout is font-metric-afhankelijk → non-deterministisch tussen browsers.
  - D3.js force-directed — animeert, random start-positions = stochastisch.
  - Graphviz (server-side render naar SVG) — deterministisch maar build-step.
- **Reden:** P-ARC-06 — alles determinitisch, ook de viewer.

### KEUZE 0.4 — Codenaam-thema = assembler-pioniers
- **Gekozen:** Booth / Wheeler / Hopper / Backus / Rochester / Wilkes.
- **Alternatieven:** WASM-spec-auteurs (Rossberg/Hilbrich), x86-architects (Faggin/Morse), Future Crew leden (al gebruikt door DFC).
- **Reden:** matcht het "assembler" in project-naam, los van Future Crew-thema dat DFC al claimt.

---

## Fase 1 — Tokenizer + parser

### KEUZE 1.1 — Implementatie-taal = pure JavaScript (ESM), géén TypeScript, géén bundler
- **Gekozen:** Vanilla JS, Node 20+ ESM.
- **Alternatieven:**
  - **TypeScript strict + tsx/Vite** — type-veiligheid, maar build-step + dep-overhead.
  - **TypeScript + `node --experimental-strip-types`** — geen build maar experimentele Node-feature.
  - **Bun** — snel maar extra runtime-dep.
- **Reden:** Geen tooling-laag = geen tooling-bug. P-ARC-05 (geen frameworks runtime) doorgetrokken naar build-keten in fase 1. Bij groei kan later TS bovenop.

### KEUZE 1.2 — Tokenizer = hand-written (geen regex-monster, geen lex-generator)
- **Gekozen:** State-machine per char.
- **Alternatieven:**
  - Regex-table — sneller te schrijven, lastiger te debuggen, edge-cases met TASM-comments (`;...EOL`).
  - moo.js (JS lexer-generator) — extra dep.
  - JISON / chevrotain — overkill.
- **Reden:** Volledige controle over source-locations (file:line:col) voor diagnostics; geen surprises bij `0Fh`-hex, `dup()`-syntax, `@@1`-LOCALS.

### KEUZE 1.3 — Parser = recursive descent
- **Gekozen:** Hand-written recursive descent.
- **Alternatieven:**
  - PEG.js / Ohm — declaratief, maar TASM is contextueel (SEGMENT-state, PROC-scope) — minder helder in PEG.
  - LALR (Jison) — overkill.
- **Reden:** Match met tokenizer-aanpak; debugbaar; één lezer-pass voor heel TECHNO subset.

### KEUZE 1.4 — Macros = niet uitgebreid, alleen `LOCALS` + `include` + `dup()`
- **Gekozen:** Minimaal voor TECHNO-subset.
- **Alternatieven:**
  - Volledige TASM macro-engine (`macro`/`endm`/`%out`) — weken extra werk.
  - Pre-processor stage met aparte expansie-pass.
- **Reden:** YAGNI tot module 2 anders vraagt.

### KEUZE 1.5 — AST-formaat = JSON met deterministische key-volgorde
- **Gekozen:** Plain JSON, sortable keys, geen `Set`/`Map` (niet JSON-stable).
- **Alternatieven:**
  - Protobuf — binary, schema-validated, maar tooling-overhead.
  - S-expressions — leesbaar maar geen native parser.
- **Reden:** Round-trippable, diffable, version-controllable.

---

## Fase 2 — IR

### KEUZE 2.1 — IR-stijl = SSA-achtig met expliciete flags
- **Gekozen:** Elke instructie produceert %N met type; flags zijn aparte values.
- **Alternatieven:**
  - Stack-based (zoals WASM zelf) — past 1:1 op WASM-output maar verbergt x86-flag-semantiek (ZF/CF/SF/OF).
  - Three-address-code zonder SSA — eenvoudiger, maar register-allocation lastiger bij codegen.
- **Reden:** SSA + expliciete flags = makkelijker bewijzen dat semantiek behouden blijft.

### KEUZE 2.2 — Linear memory = 1 MiB DOS-segment-vlak
- **Gekozen:** `WebAssembly.Memory({initial: 16})` = 16 pages × 64 KiB.
- **Alternatieven:**
  - 64 KiB single-segment (one-page) — past niet (TECHNO heeft data > 64 KiB).
  - Full 4 GiB virtuele adres-ruimte (groeit on-demand) — overhead.
- **Reden:** TECHNO is large-model maar past ruim in 1 MiB.

### KEUZE 2.3 — Segment-mapping = vlak (geen segment:offset)
- **Gekozen:** ds:bx → flat-address = (DS-base << 4) + bx, alle base-registers vast initialiseren bij module-start.
- **Alternatieven:**
  - Echte segment-emulatie met dynamische segment-tabel — closer aan x86, complexer.
  - Negeer segments (alle 64K) — werkt voor small-model, niet voor TECHNO large.
- **Reden:** TECHNO heeft static segment-layout; vlak mappen is correct én sneller.

---

## Fase 3 — WASM-codegen

### KEUZE 3.1 — WASM-encoder = eigen mini-encoder
- **Gekozen:** ~500 regels JS, ondersteunt onze subset (i32-ops + memory + functions + branches + calls).
- **Alternatieven:**
  - **wabt.js** — Emscripten port van WABT (text-to-binary). 1.5 MB dep, externe vendor.
  - **binaryen.js** — Emscripten port van Binaryen. Krachtiger optimizer, 4 MB.
  - WAT-text + serverside `wat2wasm` — geen browser-deps, maar build-step.
- **Reden:** Volledige bytewise controle (P-DET-02 build-determinisme). Geen optimizer-randomness. Compact, te auditen.

### KEUZE 3.2 — Codegen-strategie = direct IR → WASM (geen LLVM-tier)
- **Gekozen:** Vaste mapping per IR-instructie, geen optimizer pass.
- **Alternatieven:**
  - LLVM-IR tussen-laag → wasm-ld — krachtig maar megabytes aan dep + non-deterministisch.
  - WebAssembly-Reference-Interpreter als doel — alleen WAT-output.
- **Reden:** Determinisme + transparantie.

### KEUZE 3.3 — Register-mapping = ax/bx/cx/dx als locals + flags als locals
- **Gekozen:** Acht x86-16-bit regs (ax,bx,cx,dx,si,di,bp,sp) + 4 flags (zf,cf,sf,of) = 12 WASM `i32` locals per function.
- **Alternatieven:**
  - Globals — sneller bij many-small-fns maar conflicteert met re-entrancy.
  - Linear-memory-spill — closer-to-CPU maar 10× trager.
- **Reden:** Standaard WASM-pattern; native fast.

---

## Fase 4 — Runtime

### KEUZE 4.1 — Frame-clock = count-based via `requestAnimationFrame`
- **Gekozen:** `frame++` op rAF, vaste budget X instructies per frame; rAF wordt alleen als trigger gebruikt, niet als time-source.
- **Alternatieven:**
  - `setInterval(16ms)` — drift, niet vsync-sync.
  - WebAudio `AudioContext.currentTime` — sample-accurate maar koppelt aan audio.
  - OffscreenCanvas in Worker met fixed-tick — meer determinisme, extra complexiteit.
- **Reden:** Browser-standaard, deterministisch want telling-gebaseerd.

### KEUZE 4.2 — VGA mode-13h = `ImageData(320,200)` + `Uint32Array` palette
- **Gekozen:** 64 KB pixel-buffer in linear memory @ offset 0xA0000, blit naar ImageData op frame-eind via palette-lookup.
- **Alternatieven:**
  - WebGL2 texture + fragment-shader palette-lookup — sneller bij scaling, GPU-driver-variation gevaar.
  - WebGPU — modern maar slechte browser-support.
- **Reden:** 2D Canvas ImageData is bit-exact reproduceerbaar tussen browsers (geen GPU-pipeline).

### KEUZE 4.3 — S3M-player = libxmp-lite WASM
- **Gekozen:** Open-source libxmp-lite, WASM-build (publiek beschikbaar).
- **Alternatieven:**
  - **chiptune3.js** — wat DecompilingFutureCrew gebruikt. Bekende werkende setup, MIT.
  - **dis.obj reverse-engineren** — meest authentiek, maar custom Future Crew-mixer. Weken werk.
  - **Schrijf eigen S3M-decoder** — overzichtelijk maar minder battle-tested.
  - **Geen geluid in fase 4** — werkt voor visuele bewijslast.
- **Reden:** libxmp-lite is meer mainstream dan chiptune3, beter onderhouden. Acceptabele trade-off voor "authenticity vs maintainability" — dit is route waar wel een determinisme-asterisk staat (P-DET-03 voor onze WASM-codegen, niet voor S3M-decoder zelf).

### KEUZE 4.4 — Vsync (`waitb`) = WebAudio-sample-count-based
- **Gekozen:** `dis_waitb` retourneert na N audio-samples (sample-tellen = enige stabiele monotone count in browser).
- **Alternatieven:**
  - rAF-count — drift bij different refresh rates (60/120/144 Hz).
  - `performance.now()` — wallclock, sluit P-DET-01.
- **Reden:** WebAudio worklet draait op vaste sample-rate (44100 of 48000 Hz), telling is monotone en deterministisch.

### KEUZE 4.5 — DIS-engine = stub + S3M-pattern-row simulator (geen echte port)
- **Gekozen:** `dis_musrow()` retourneert berekende pattern-row op basis van sample-count + S3M-pattern-tabel.
- **Alternatieven:**
  - Echte port van Future Crew DIS (Pascal/asm in andere SR-dir, mogelijk binary-only).
  - Negeer DIS, gebruik alleen audio (visual sync verloren).
- **Reden:** Pattern-row is enige observable die TECHNO uit DIS gebruikt; full port is buiten scope.

---

## Fase 5+ — Reserveert voor later

### Toekomstige modules (volgorde-keuze)
- **Gekozen volgorde:** STARFIELD (DDSTARS) → GLENZ → DOTS → TUNNELI → TWIST/GRID.
- **Alternatieve volgorde:** GLENZ eerst (DFC heeft die al, vergelijking makkelijk).
- **Reden:** Complexiteits-ladder klein → groot.

### Driver KOE.C → TypeScript-rewrite (i.p.v. C→WASM)
- **Gekozen:** Herschrijf glue-code in TS.
- **Alternatieven:**
  - TCC-route (Tiny C Compiler → WASM via Emscripten of clang+lld).
  - C→IR→WASM via eigen translator (consistent met TASM-aanpak).
- **Reden:** KOE.C is 80% glue, 20% logic. Glue makkelijker in TS dan in IR.

### OBK-data files = OMF-parser
- **Gekozen:** Eigen OMF-parser → linear memory data-segment.
- **Alternatieven:**
  - `objconv` (Agner Fog) → ELF/Mach-O → custom adapter.
  - DOS in v86 → extract data files na link.
- **Reden:** OMF is goed gedocumenteerd; eigen parser klein.

---

## Process

### Tooling stack-keuze (build-keten)
- **Gekozen:** Node 20+ ESM, geen TS, geen bundler in fase 1-3.
- **Beslissingspunt:** bij ~3000+ regels of bij eerste type-bug → introduceer TS-strict.

### Test-strategie
- **Gekozen:** Unit-tests per fase als simpele `node --test` scripts. Geen Vitest/Jest.
- **Alternatief:** Vitest met snapshot-tests.
- **Reden:** Minimale deps in fase 1.
