# TECHNO — Inventory

> Module 1 van ASM2Web. Bron: Future Crew, Second Reality (1993), scene "TECHNO".

## Bron-relatie

- **Upstream:** [`mtuomi/SecondReality`](https://github.com/mtuomi/SecondReality) @ commit `071a82eddb7a7390dbaa491a8a473e0e923a55c2`
- **Lokaal:** `../../../SecondReality_source/TECHNO/`
- **Licentie bron:** Unlicense (1993-source, 2013-release)
- **Output (gold-standard EXE):** `SecondReality_source/MAIN/DATA/TECHNO.EXE` — 31849 bytes, SHA256 `2339b059596ff0b9107e146f6bea91ca11e852ec281cbb7fc9ee2f4b21597c1f`
- **Muziek-asset:** `SecondReality_source/MAIN/MUSIC0.S3M` (391312 B, SHA `aacdb968…d28fe1`) of `MUSIC1.S3M` (600860 B, SHA `3393f848…0e8dde54`) — welke TECHNO daadwerkelijk gebruikt te bepalen in fase 1

## Module-files

| File | Type | Regels | Bytes | Labels | Externs | Procs | SHA256 (eerste 16) |
|---|---|---|---|---|---|---|---|
| `KOEA.ASM` | TASM x86 16-bit (.386 directive) | 1065 | 16116 | 94 | 13 | 21 | `7d584fe7caefdb45` |
| `KOEB.ASM` | TASM x86 16-bit (.386 directive) | 632 | 9619 | 54 | 4 | 10 | `07fa13cb513b7146` |
| `POLYCLIP.ASM` | TASM (geen segment-header — wordt geïnclude) | 273 | 5014 | 41 | 0 | 3 | `67298057837e5fd3` |
| `ROT.ASM` | TASM standalone test/driver | 26 | 297 | 1 | 0 | 2 | `c39ef80478bd67a2` |
| `KOE.C` | Microsoft C (large model, inline `_asm`) | 728 | 11981 | — | — | — | `6fec2912a9af6e4e` |
| `READP.C` | C-helper (palette read) | 72 | 943 | — | — | — | `01040e68d4769f8c` |
| `MAKEFILE` | NMAKE (TASM + Microsoft C) | 26 | 402 | — | — | — | `bbda872f9d182771` |

**Volledige SHA's:**
- KOEA.ASM `7d584fe7caefdb45f98b1ed47958adebaca9e8df25720458ed812ac7b1287573`
- KOEB.ASM `07fa13cb513b7146330a1980ed489314d969a73330e014c8351ddc09e135b7a4`
- POLYCLIP.ASM `67298057837e5fd3dd3bbc7b1677ce460754dbf80c01ee4eda2453c248e61bcc`
- ROT.ASM `c39ef80478bd67a2e1f1ab688714b1fe06f9281258dc37fddc5a63605bff84c3`
- KOE.C `6fec2912a9af6e4e43e6e157bd2ca2a612df8cd8d7a4cea0d438bb1c3aadc56c`
- READP.C `01040e68d4769f8c4b3917de0ad041333fe637445913643b8087faada3a97ae4`
- MAKEFILE `bbda872f9d18277129ac31e8555571078d046ce5022186b6a3beadd614bfc313`

## Per-file doel

### KOEA.ASM — primaire rendering-engine (21 procs)
- `_asminit / _asmdoit / _asmdoit2` — externe entries, aangeroepen vanuit KOE.C
- `blitinit / blit16 / blit16b` — 16-pixel-block blitter, kern van de polygon-fill
- `drawline / bltline / bltlinerev` — line-drawing helpers
- `_asmbox` — rechthoek-fill primitive
- Data-segmenten: `_rows` (200 dup), `_blit16t` (256 dup) — line-offset table + blit-lookup
- Externs: `_circle:byte`, `_circle2:byte` (data uit `_CIRCLE.OBK` + `_CIRCLE2.OBK`)

### KOEB.ASM — secundaire effecten + palette (10 procs)
- `resetmode13` — VGA mode-set
- `mixpal / outpal` — palette-fade + write naar 3C8h/3C9h
- `waitb` — vsync wait (3DAh poll bit 3)
- `rotate1` — rotatie-effect helper
- `init_interference / do_interference / _dointerference2` — moiré/interference pattern (een van de signatuur-effecten van de scene)
- Include: `sin1024.inc` — sine-table 1024 entries

### POLYCLIP.ASM — polygon-clipping (3 procs)
- `clipanypoly` — Sutherland-Hodgman variant tegen viewport (320×200)
- `cliplinex / clipliney` — per-as clipping
- Geen externs (wordt zelf geïnclude / linked)

### ROT.ASM — standalone test-driver (2 procs)
- `waitb + rol` + `start` — standalone EXE-entry voor `int 21h, 4Ch` exit
- Niet onderdeel van TECHNO.EXE — testbed/scaffold

### KOE.C — driver (Microsoft C, large model)
- VGA framebuffer-pointer `vram = (char*)0xa0000000L`
- Palette-management (`flash`, `border`, `setborder`)
- `waitborder` — sync met DIS music-row
- Aanroep van `_asminit` / `_asmdoit*` (uit KOEA)
- Aanroep DIS-engine: `dis_musrow()`, `dis_waitb()` (uit `../dis/disc.obj`)
- Inline `_asm`-blok in `setborder` voor VGA attribute controller

### READP.C — palette-read helper (klein)

### MAKEFILE — build-recept
```makefile
asm_f = /ML /m9 /s /JJUMPS    # TASM flags: large-model, max passes, JUMPS-mode
c_f   = /AL /c /W3            # MS C: Large memory model
.asm.obj: tasm $(asm_f) $<
.c.obj:   cl /qc $(c_f) $<
koe.exe : $(objs)
    link /E $(objs)+$(data)+..\dis\disc.obj,koe.exe,koe.map;
    copy koe.exe ..\main\data\techno.exe
```
Link met `_circle.obk + _circle2.obk` (data) + `disc.obj` (DIS music engine, extern).

## Externe symbolen (cross-file)

KOEA + KOEB importeren:
- `_circle:byte` — uit `_CIRCLE.OBK`
- `_circle2:byte` — uit `_CIRCLE2.OBK`
- (vermoedelijk) `_pic1:byte`, `_pic2:byte` — uit `_PIC1.OBK`, `_PIC2.OBK` (gecommentarieerd in MAKEFILE)

KOE.C importeert uit DIS-engine (`disc.obj`):
- `dis_musrow()`
- `dis_waitb()`
- `dis_*` (init, mute, etc. — exacte API in dis/dis.h)

## Aandachtspunten voor transpilatie

1. **`.386` directive** in beide hoofd-ASM-files — 32-bit registers + 386-instructies in beeld (te detecteren in fase 1 parser-pass).
2. **`LOCALS` directive** — TASM lokale labels (`@@1:` etc.) — parser moet scope correct hanteren.
3. **Large memory model + inline `_asm` in C** — KOE.C linkt op object-niveau. Beslissing fase 2/3: transpileren we KOE.C ook (via TCC-achtige route) of herschrijven we het in TypeScript als "driver" en transpileren we alleen de pure ASM-files? **Voorkeur:** driver in TS (KOE.C is in feite glue-code), pure rendering in WASM.
4. **DIS-engine** — `disc.obj` is binary, geen source in TECHNO/. Bron mogelijk in andere SR-subdir; anders S3M-player als vervanging (fase 4).
5. **VGA mode-13h pixel-writes** naar `0xA0000` — mappen naar runtime-ABI `mode13h_setpixel` of direct linear-memory-window dat op frame-eind ge-blit wordt (efficiënter).
6. **Vsync via 3DAh-poll** (`in al, 3dah; test al, 8`) — vervangen door runtime-ABI `waitb()` count-gebaseerd.
7. **OBK-data files** (`_CIRCLE.OBK`, `_CIRCLE2.OBK`) — binary data, in OMF-formaat (Object Module Format). Te parsen + naar WASM-data-segment of statische `Uint8Array`. SHA's nog te leggen.

## Status

- Fase 0 (huidig): **inventaris compleet**, geen transpilatie
- Fase 1: TASM-parser werkend voor deze 4 ASM-files
- Fase 4: TECHNO speelbaar in browser
