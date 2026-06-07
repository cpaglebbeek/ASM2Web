/**
 * VGA mode-13h emulation: 320x200, 256-colour palette, ImageData blit.
 *
 * Pure: alle pixel-bytes komen uit linear memory @ 0xA0000;
 * palette komt uit 256-entry Uint32Array (RGBA), beheerd via setPaletteChannel.
 *
 * Default palette = VGA standaard (uit IBM 8514/VGA spec) zodat bij start
 * iets bekend zichtbaar is (anders alles zwart).
 */
"use strict";

export const VGA = Object.freeze({
  WIDTH:  320,
  HEIGHT: 200,
  FRAMEBUFFER_OFFSET: 0xA0000,
  PALETTE_ENTRIES: 256,
});

/** Construct a fresh mode-13h state. */
export function newVgaState(memory) {
  const fbView = new Uint8Array(memory.buffer, VGA.FRAMEBUFFER_OFFSET, VGA.WIDTH * VGA.HEIGHT);
  const palette = new Uint32Array(VGA.PALETTE_ENTRIES);
  loadDefaultPalette(palette);
  return {
    memory,
    framebuffer: fbView,
    palette,                                  // RGBA packed (little-endian -> R, G, B, A)
    paletteRGB: new Uint8Array(VGA.PALETTE_ENTRIES * 3),  // shadow 0..63 ints
    retraceBit: 0,
    musicRow:   0,
    waitbCounter: 0,
    exitCode:   null,
    /** Set R/G/B channel (value 0..63) for palette index. */
    setPaletteChannel(idx, channel, val) {
      idx = idx & 0xFF;
      channel = channel | 0;
      val = val & 0x3F;   // VGA DAC is 6-bit
      this.paletteRGB[idx * 3 + channel] = val;
      const r6 = this.paletteRGB[idx * 3 + 0];
      const g6 = this.paletteRGB[idx * 3 + 1];
      const b6 = this.paletteRGB[idx * 3 + 2];
      // Scale 6-bit -> 8-bit (bit-replication: x = (x<<2) | (x>>4))
      const r = (r6 << 2) | (r6 >> 4);
      const g = (g6 << 2) | (g6 >> 4);
      const b = (b6 << 2) | (b6 >> 4);
      // RGBA in Uint32Array (little-endian byte-order: AABBGGRR)
      this.palette[idx] = (0xFF << 24) | (b << 16) | (g << 8) | r;
    },
    fakeRetraceStatus() {
      // toggle bit 3 each call to mimic vsync polling (used by `in al, 3DAh`)
      this.retraceBit ^= 0x08;
      return this.retraceBit;
    },
    /** Blit framebuffer -> ImageData via palette. */
    blitTo(imageData) {
      const dst32 = new Uint32Array(imageData.data.buffer, imageData.data.byteOffset, VGA.WIDTH * VGA.HEIGHT);
      const fb = this.framebuffer;
      const pal = this.palette;
      const N = fb.length;
      for (let i = 0; i < N; i++) dst32[i] = pal[fb[i]];
    },
  };
}

/** Default VGA 256-colour palette: 0..15 IBM PC, 16..255 mode-13h spec defaults. */
function loadDefaultPalette(palette) {
  // Standard VGA 256-colour mode-13h palette (BIOS INT 10h, AH=10h, AL=17h reads this).
  // 0..15: IBM CGA/EGA-compatible 16 colours.
  const c16 = [
    [0,0,0],     [0,0,42],    [0,42,0],    [0,42,42],
    [42,0,0],    [42,0,42],   [42,21,0],   [42,42,42],
    [21,21,21],  [21,21,63],  [21,63,21],  [21,63,63],
    [63,21,21],  [63,21,63],  [63,63,21],  [63,63,63],
  ];
  for (let i = 0; i < 16; i++) {
    const [r, g, b] = c16[i];
    const r8 = (r << 2) | (r >> 4);
    const g8 = (g << 2) | (g >> 4);
    const b8 = (b << 2) | (b >> 4);
    palette[i] = (0xFF << 24) | (b8 << 16) | (g8 << 8) | r8;
  }
  // 16..31: greyscale ramp (0..63)
  for (let i = 0; i < 16; i++) {
    const v = Math.floor(i * 63 / 15);
    const v8 = (v << 2) | (v >> 4);
    palette[16 + i] = (0xFF << 24) | (v8 << 16) | (v8 << 8) | v8;
  }
  // 32..255: leave as transparent-black for now (programs typically set their own).
  for (let i = 32; i < 256; i++) palette[i] = (0xFF << 24);
}
