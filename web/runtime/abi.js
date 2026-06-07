/**
 * Runtime ABI: host-functies die door WASM-modules worden aangeroepen.
 * Aanroep-conventie & types matchen src/codegen/codegen.js.
 *
 * Determinisme:
 *   - geen Math.random(), Date.now() of performance.now() in deze hot-paths
 *   - palette en framebuffer alleen via expliciete operaties
 */
"use strict";

import { VGA } from "./vga13.js";

export function makeAbi(memory, vga) {
  // VGA palette write-state machine (DAC):
  //   write port 3C8h with index -> palette-index latched, sub-index = 0 (R)
  //   write port 3C9h three times -> R, G, B (waarden 0..63), bij elke 4e write
  //   auto-advances naar volgende palette-index.
  const dac = { writeIndex: 0, subIndex: 0 };

  return {
    memory,

    io_out(port, value) {
      port = port & 0xFFFF;
      value = value & 0xFF;
      if (port === 0x3C8) {
        dac.writeIndex = value;
        dac.subIndex   = 0;
        return;
      }
      if (port === 0x3C9) {
        const idx = dac.writeIndex;
        if (dac.subIndex === 0)      vga.setPaletteChannel(idx, 0, value);
        else if (dac.subIndex === 1) vga.setPaletteChannel(idx, 1, value);
        else if (dac.subIndex === 2) vga.setPaletteChannel(idx, 2, value);
        dac.subIndex++;
        if (dac.subIndex >= 3) {
          dac.subIndex = 0;
          dac.writeIndex = (dac.writeIndex + 1) & 0xFF;
        }
        return;
      }
      // Ignored ports (sound, timer, ...) silently for now; the demo only uses VGA.
    },

    io_in(port) {
      port = port & 0xFFFF;
      // 3DAh bit-3 = vertical retrace; we toggle each frame to mimic vsync polling.
      if (port === 0x3DA) return vga.fakeRetraceStatus();
      return 0;
    },

    exit(code) {
      // Tag program-done. Runtime caller checks this after main returns.
      vga.exitCode = code | 0;
    },

    mode13h_setpixel(x, y, color) {
      x = x | 0; y = y | 0; color = color & 0xFF;
      if (x < 0 || x >= 320 || y < 0 || y >= 200) return;
      vga.framebuffer[y * 320 + x] = color;
    },

    dis_musrow() {
      return vga.musicRow | 0;
    },

    waitb() {
      // Sync hook — runtime will pump this once per scheduled frame.
      // Here we just record a request; the host frame-loop honors it.
      vga.waitbCounter++;
    },

    dis_init(offset, len) {
      // S3M-player init hook — implemented later via libxmp/chiptune3.
      vga.disInitOffset = offset | 0;
      vga.disInitLen    = len | 0;
    },

    dis_waitb() {
      // music-tick wait — same semantics as waitb for now.
      vga.waitbCounter++;
    },
  };
}
