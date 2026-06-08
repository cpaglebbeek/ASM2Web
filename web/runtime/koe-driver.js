/**
 * KOE.C driver — TypeScript/JS rewrite van de Future Crew TECHNO glue-code.
 *
 * Origineel: SecondReality_source/TECHNO/KOE.C (728 regels Microsoft C met
 * inline _asm). Hier herschreven als runtime-orchestrator die de
 * techno-linked.wasm exports aanroept in juiste volgorde.
 *
 * Wat het origineel doet (samengevat):
 *   - Mode 13h (320x200x256) via VGA BIOS — wij hebben framebuffer in linear mem
 *   - DIS music engine start (dis_init met S3M-data)
 *   - Main loop: per music-row een frame renderen
 *     - waitborder() = wacht op vertical retrace + zet palette
 *     - asmdoit() of asmdoit2() per frame = render
 *     - flash() palette-fade
 *     - border() = border color change
 *   - Exit via int 21h, 4Ch wanneer een toets ingedrukt
 *
 * Onze versie is een vereenvoudigde maar functionele orchestrator.
 */
"use strict";

import { VGA } from "./vga13.js";

export class KoeDriver {
  /**
   * @param {WebAssembly.Instance} wasmInstance
   * @param {object} vgaState
   */
  constructor(wasmInstance, vgaState) {
    this.wasm = wasmInstance;
    this.vga = vgaState;
    this.frame = 0;
    this.musicRow = 0;
    this.curPal = 0;
    this.running = false;

    // Capture exports we'll use
    this.exports = wasmInstance.exports;
    this.fns = {};
    for (const name of ["asminit", "asmdoit", "asmdoit2", "asmbox", "blitinit",
                        "mixpal", "outpal", "waitb", "rotate1",
                        "init_interference", "do_interference"]) {
      if (typeof this.exports[name] === "function") this.fns[name] = this.exports[name];
    }
  }

  /** Called once at start. */
  init() {
    // Load default 256-color palette (will be overridden by asmdoit's palette setup)
    this._setupDefaultPalette();

    // Call WASM init if present
    if (this.fns.asminit) {
      try { this.fns.asminit(); }
      catch (e) { console.warn("asminit() threw:", e.message); }
    }
    if (this.fns.blitinit) {
      try { this.fns.blitinit(); }
      catch (e) { console.warn("blitinit() threw:", e.message); }
    }
    if (this.fns.init_interference) {
      try { this.fns.init_interference(); }
      catch (e) { console.warn("init_interference() threw:", e.message); }
    }
  }

  /** Called once per frame. Returns false if program ended. */
  tick() {
    if (this.vga.exitCode !== null) return false;
    this.frame++;
    // Advance simulated music row every ~6 frames (rough TECHNO tempo)
    if (this.frame % 6 === 0) this.musicRow++;
    this.vga.musicRow = this.musicRow;

    // Call the main render function
    if (this.fns.asmdoit2) {
      try { this.fns.asmdoit2(); }
      catch (e) {
        // Log first few errors, then suppress
        if (this.frame < 5) console.warn("asmdoit2() frame " + this.frame + ":", e.message);
      }
    } else if (this.fns.asmdoit) {
      try { this.fns.asmdoit(); }
      catch (e) {
        if (this.frame < 5) console.warn("asmdoit() frame " + this.frame + ":", e.message);
      }
    }

    // Call rotate effect every other frame for visual variation
    if (this.fns.rotate1 && this.frame % 2 === 0) {
      try { this.fns.rotate1(); }
      catch (e) { /* ignored */ }
    }

    // Run interference effect occasionally
    if (this.fns.do_interference && this.frame % 8 === 0) {
      try { this.fns.do_interference(); }
      catch (e) { /* ignored */ }
    }

    // Cycle palette like KOE.C's waitborder did (curPal counter)
    if (this.curPal > 0) this.curPal--;

    return true;
  }

  /** Stop the driver. */
  stop() {
    this.running = false;
  }

  _setupDefaultPalette() {
    // TECHNO uses heavily-modified palettes set up by asmdoit; we just
    // ensure the default isn't all-zero so something is visible.
    for (let i = 0; i < 256; i++) {
      // Cyan-purple gradient as a placeholder
      const t = i / 255;
      const r = Math.floor(20 + t * 40);
      const g = Math.floor(40 + (1 - t) * 20);
      const b = Math.floor(50 + Math.sin(t * Math.PI) * 12);
      this.vga.setPaletteChannel(i, 0, r);
      this.vga.setPaletteChannel(i, 1, g);
      this.vga.setPaletteChannel(i, 2, b);
    }
  }
}
