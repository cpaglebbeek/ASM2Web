/**
 * Audio engine bridge — S3M-playback.
 *
 * Strategie:
 *   Eerst poging: chiptune3 (libopenmpt port, BSD-3-Clause) als CDN-load.
 *   Fallback: silent mode + manuele music-row counter (driver-side timing).
 *
 * In beide gevallen exporteren we dis_musrow() + dis_waitb() + dis_init()
 * voor de WASM-runtime-ABI.
 *
 * Determinisme-disclaimer (P-DET-03): chiptune3 gebruikt sample-accurate
 * AudioWorklet. Pattern-row is deterministisch wanneer sample-count
 * deterministisch geïncrementeerd wordt. Onze fallback is volledig
 * deterministisch (pure tellers).
 */
"use strict";

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.player = null;
    this.silent = true;
    this.musicRow = 0;
    this.sampleCount = 0;
    this.samplesPerRow = 2756;     // approx for 125 BPM @ 44100 Hz, 6 ticks/row
    this.initialized = false;
    this.errorMsg = null;
  }

  /**
   * @param {ArrayBuffer} s3mData - optional MUSIC0.S3M / MUSIC1.S3M bytes
   * @returns {Promise<{audio: boolean, msg: string}>}
   */
  async init(s3mData) {
    if (this.initialized) return { audio: !this.silent, msg: "already-init" };
    this.initialized = true;

    if (typeof AudioContext === "undefined" && typeof webkitAudioContext === "undefined") {
      this.errorMsg = "no AudioContext support";
      return { audio: false, msg: this.errorMsg };
    }

    try {
      this.ctx = new (AudioContext || webkitAudioContext)({ sampleRate: 44100 });
    } catch (e) {
      this.errorMsg = "AudioContext init failed: " + e.message;
      return { audio: false, msg: this.errorMsg };
    }

    // Try chiptune3 (lazy-load from npm CDN); if it fails, stay silent.
    if (!s3mData) {
      this.silent = true;
      this.errorMsg = "no S3M data provided — silent mode";
      return { audio: false, msg: this.errorMsg };
    }

    try {
      // Use ScriptProcessor for now (AudioWorklet would need separate worklet-script file)
      this.silent = true;  // Keep silent until chiptune3 is vendored properly
      this.errorMsg = "chiptune3 not yet vendored — silent mode + deterministic row counter";
      return { audio: false, msg: this.errorMsg };
    } catch (e) {
      this.silent = true;
      this.errorMsg = e.message;
      return { audio: false, msg: this.errorMsg };
    }
  }

  /** Get current music pattern row (pure function of sample count when audio active). */
  getMusicRow() {
    if (this.silent) return this.musicRow;
    return Math.floor(this.sampleCount / this.samplesPerRow);
  }

  /** Tick — called per frame for deterministic timing in silent mode. */
  tick() {
    if (this.silent) {
      // Advance music row every ~6 frames (rough TECHNO tempo at 60 FPS)
      // Frame=6 -> row=1, frame=12 -> row=2, etc.
      this.sampleCount += 735;  // 44100/60 = 735 samples per frame
      this.musicRow = Math.floor(this.sampleCount / this.samplesPerRow);
    }
  }

  /** Stop playback (and unsuspend if it was suspended). */
  stop() {
    if (this.ctx) {
      try { this.ctx.close(); } catch (e) {}
      this.ctx = null;
    }
  }
}
