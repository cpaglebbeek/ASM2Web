# ASM2Web

> **Deterministische x86-assembly → browser-runtime, modulair en interactief.**

ASM2Web compileert historische 16-bit x86 assembly (TASM-dialect) per-instructie naar **WebAssembly** zodat klassieke DOS-demoscene-modules byte-exact reproduceerbaar in de browser draaien — zonder DOSBox-wrapper en zonder enige stochastische rendering.

**Status:** `v0.0.1-Booth` — skeleton (fase 0). Eerste module: **TECHNO** uit Second Reality (Future Crew, 1993).

**Live:** https://horsecloud55.ddns.net/ASM2Web/
**Architectuur-viewer:** https://horsecloud55.ddns.net/ASM2Web/architecture/
**Repo:** https://github.com/cpaglebbeek/ASM2Web (AGPL-3.0)

## Wat ASM2Web wel/niet is

- **Wel:** TASM-bron → IR → WebAssembly via een eigen translator (route B). Frame N is een **pure functie** van (program-bytes, frame-index, input). Geen RNG, geen wallclock-jitter, geen async race-conditions in render-loop.
- **Niet:** géén x86-emulator (zoals v86 / DOSBox), géén per-scene rewrite in JavaScript (zoals zusterproject DecompilingFutureCrew). Geen pixel-perfect 320×200 mandate — wel een **bewijsbaar identiek frame-stream** bij identieke input.

## Modules

| Module | Bron | Regels ASM | Status |
|---|---|---|---|
| **TECHNO** | `SecondReality/TECHNO/` (Future Crew 1993) | 1996 | Fase 0 — inventaris compleet, transpilatie nog niet |

Zie [`modules/techno/INVENTORY.md`](modules/techno/INVENTORY.md) voor per-file metadata, SHA's en doelbeschrijving.

## Architectuur (kort)

```
TASM-bron (.ASM)
  ──> tokenizer ──> parser ──> IR (typed, deterministic SSA-achtig)
  ──> WASM-codegen ──> .wasm-module
  ──> runtime (mode-13h canvas + DIS→WebAudio + frame-clock)
  ──> browser
```

Volledige uitwerking: [`ARCHITECTURE.md`](ARCHITECTURE.md).
Roadmap fase-per-fase: [`BUILD_PLAN.md`](BUILD_PLAN.md).
Determinisme-principes (geen RNG, frame=pure-functie, etc.): [`PRINCIPLES.md`](PRINCIPLES.md).

## Ecosysteem

Onderdeel van `Retro_Computing` (sub-master `Meta_Retro_Computing`), naast:
- **DecompilingFutureCrew** — zusterproject, andere aanpak (per-scene TS-rewrite + WebGL2).
- **QuickBasicEmulator-cluster** — runtime + decompiler voor GW/QBasic/QB4.5.

## Upstream

Bron-repo: [`mtuomi/SecondReality`](https://github.com/mtuomi/SecondReality) (Unlicense, commit `071a82e`).
Lokaal gekloond naast deze repo als `../SecondReality_source/` — **bewust géén git-submodule** (bron is bevroren, 1993-source / 2013-release).

## Codenaam-thema

Pioniers van de assembler en lage-niveau programmeertalen. v0.0.x = **Booth** (Kathleen Booth, 1947 — eerste assembler). Volgende: Wheeler, Hopper, Backus, Rochester, Wilkes.

## Licentie

[AGPL-3.0](LICENSE) — zelfde licentie als bron-werk waarvan wordt afgeleid (mtuomi/SecondReality is Unlicense; ASM2Web's eigen code is AGPL).
