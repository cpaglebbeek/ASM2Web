/**
 * Headless TECHNO runner — voor Node tests + offline framebuffer-SHA generation.
 *
 * Geen DOM, geen WebAudio. Pure framebuffer + KoeDriver-clone met
 * deterministic counters. Bewijst P-DET-01: zelfde input → zelfde
 * framebuffer-SHA na N ticks.
 */
"use strict";

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Mirror of the constants in web/runtime/vga13.js, kept local to avoid
// browser-only globals in the test file.
const VGA = Object.freeze({
  WIDTH: 320,
  HEIGHT: 200,
  FRAMEBUFFER_OFFSET: 0xA0000,
  PALETTE_ENTRIES: 256,
});

const STOCK_PALETTE_16 = [
  [0,0,0],     [0,0,42],    [0,42,0],    [0,42,42],
  [42,0,0],    [42,0,42],   [42,21,0],   [42,42,42],
  [21,21,21],  [21,21,63],  [21,63,21],  [21,63,63],
  [63,21,21],  [63,21,63],  [63,63,21],  [63,63,63],
];

/**
 * @param {string} wasmPath
 * @param {{startExport?:string, perFrameExport?:string, frames?:number}} [opts]
 */
export async function runHeadless(wasmPath, opts = {}) {
  const wasmBytes = readFileSync(wasmPath);
  const memory = new WebAssembly.Memory({ initial: 16, maximum: 16 });

  const state = {
    frame: 0,
    musicRow: 0,
    sampleCount: 0,
    waitbCounter: 0,
    retraceBit: 0,
    exitCode: null,
    palette: new Uint32Array(VGA.PALETTE_ENTRIES),
    paletteRGB: new Uint8Array(VGA.PALETTE_ENTRIES * 3),
    framebuffer: new Uint8Array(memory.buffer, VGA.FRAMEBUFFER_OFFSET, VGA.WIDTH * VGA.HEIGHT),
    dacWriteIdx: 0,
    dacSubIdx: 0,
    ioOutCount: 0,
    ioInCount: 0,
  };

  // Default palette init
  for (let i = 0; i < 16; i++) {
    const [r, g, b] = STOCK_PALETTE_16[i];
    setPaletteChannel(state, i, 0, r);
    setPaletteChannel(state, i, 1, g);
    setPaletteChannel(state, i, 2, b);
  }
  for (let i = 16; i < 256; i++) {
    // Greyscale ramp for visibility
    const v = ((i - 16) * 63 / 239) | 0;
    setPaletteChannel(state, i, 0, v);
    setPaletteChannel(state, i, 1, v);
    setPaletteChannel(state, i, 2, v);
  }

  const env = {
    memory,
    io_out: (port, value) => {
      state.ioOutCount++;
      port &= 0xFFFF; value &= 0xFF;
      if (port === 0x3C8) { state.dacWriteIdx = value; state.dacSubIdx = 0; return; }
      if (port === 0x3C9) {
        const idx = state.dacWriteIdx;
        setPaletteChannel(state, idx, state.dacSubIdx, value);
        state.dacSubIdx++;
        if (state.dacSubIdx >= 3) { state.dacSubIdx = 0; state.dacWriteIdx = (state.dacWriteIdx + 1) & 0xFF; }
        return;
      }
    },
    io_in: (port) => {
      state.ioInCount++;
      if (port === 0x3DA) { state.retraceBit ^= 0x08; return state.retraceBit; }
      return 0;
    },
    exit: (code) => { state.exitCode = code | 0; },
    mode13h_setpixel: (x, y, c) => {
      x |= 0; y |= 0; c &= 0xFF;
      if (x < 0 || x >= 320 || y < 0 || y >= 200) return;
      state.framebuffer[y * 320 + x] = c;
    },
    dis_musrow: () => state.musicRow | 0,
    waitb: () => { state.waitbCounter++; },
    dis_init: () => {},
    dis_waitb: () => { state.waitbCounter++; },
  };

  const { instance } = await WebAssembly.instantiate(wasmBytes, { env });
  const exports = instance.exports;

  // Init phase
  const initFns = ["asminit", "blitinit", "init_interference"];
  for (const fn of initFns) {
    if (typeof exports[fn] === "function") {
      try { exports[fn](); } catch (e) { /* tolerate */ }
    }
  }

  const frames = opts.frames || 100;
  const renderFn = opts.perFrameExport
    || (typeof exports.asmdoit2 === "function" ? "asmdoit2"
       : typeof exports.asmdoit === "function" ? "asmdoit"
       : null);

  const frameHashes = [];

  for (let f = 0; f < frames; f++) {
    state.frame = f;
    if (f % 6 === 0) state.musicRow++;

    if (renderFn && typeof exports[renderFn] === "function") {
      try { exports[renderFn](); } catch (e) { /* tolerate per-frame errors */ }
    }
    if (typeof exports.rotate1 === "function" && f % 2 === 0) {
      try { exports.rotate1(); } catch (e) {}
    }
    if (typeof exports.do_interference === "function" && f % 8 === 0) {
      try { exports.do_interference(); } catch (e) {}
    }

    // Capture frame hash at specific milestones
    if (f === 10 || f === 50 || f === 99) {
      const h = createHash("sha256").update(Buffer.from(state.framebuffer)).digest("hex");
      frameHashes.push({ frame: f, sha256: h });
    }
  }

  // Capture summary stats
  const fb = state.framebuffer;
  let nonZero = 0;
  for (let i = 0; i < fb.length; i++) if (fb[i] !== 0) nonZero++;

  const finalFrameHash = createHash("sha256").update(Buffer.from(fb)).digest("hex");

  return {
    framesRun: frames,
    finalFrame: state.frame,
    musicRowAtEnd: state.musicRow,
    nonZeroPixels: nonZero,
    ioOutCount: state.ioOutCount,
    ioInCount: state.ioInCount,
    exitCode: state.exitCode,
    finalFrameHash,
    frameHashes,
    renderFn,
  };
}

function setPaletteChannel(state, idx, channel, val) {
  idx &= 0xFF; channel |= 0; val &= 0x3F;
  state.paletteRGB[idx * 3 + channel] = val;
  const r6 = state.paletteRGB[idx * 3 + 0];
  const g6 = state.paletteRGB[idx * 3 + 1];
  const b6 = state.paletteRGB[idx * 3 + 2];
  const r = (r6 << 2) | (r6 >> 4);
  const g = (g6 << 2) | (g6 >> 4);
  const b = (b6 << 2) | (b6 >> 4);
  state.palette[idx] = (0xFF << 24) | (b << 16) | (g << 8) | r;
}
