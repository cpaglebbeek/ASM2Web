/**
 * chiptune3 audio bridge — wraps ChiptuneJsPlayer + exposes dis_musrow.
 *
 * chiptune3 vereist AudioWorklet (geen ScriptProcessor fallback).
 * Voor offline-determinisme test: silent-mode bypass.
 */
"use strict";

import { ChiptuneJsPlayer } from "../vendor/chiptune3/chiptune3.js";

export class ChiptuneBridge {
  /**
   * @param {{onProgress?: (d:{row:number,pattern:number,order:number,pos:number}) => void}} [opts]
   */
  constructor(opts = {}) {
    this.player = null;
    this.ready = false;
    this.row = 0;
    this.pattern = 0;
    this.order = 0;
    this.pos = 0;
    this.errorMsg = null;
    this.onProgress = opts.onProgress || (() => {});
    this.playing = false;
  }

  /**
   * Init the AudioWorklet + libopenmpt.
   * @returns {Promise<{ok: boolean, msg: string}>}
   */
  async init() {
    if (this.ready) return { ok: true, msg: "already ready" };
    if (typeof AudioContext === "undefined") {
      this.errorMsg = "no AudioContext (vereist HTTPS of localhost)";
      return { ok: false, msg: this.errorMsg };
    }
    try {
      const ctx = new AudioContext();
      // chiptune3 constructor doet zelf audioWorklet.addModule
      this.player = new ChiptuneJsPlayer({ context: ctx, repeatCount: -1 });
      // Wacht op onInitialized
      await new Promise((resolve, reject) => {
        const tm = setTimeout(() => reject(new Error("chiptune3 init timeout (5s)")), 5000);
        this.player.onInitialized(() => { clearTimeout(tm); resolve(); });
        this.player.onError && this.player.onError((e) => { clearTimeout(tm); reject(e); });
      });
      this.player.onProgress((d) => {
        this.row = d.row | 0;
        this.pattern = d.pattern | 0;
        this.order = d.order | 0;
        this.pos = d.pos || 0;
        this.onProgress(d);
      });
      this.ready = true;
      return { ok: true, msg: "ready" };
    } catch (e) {
      this.errorMsg = e.message || String(e);
      return { ok: false, msg: this.errorMsg };
    }
  }

  /**
   * Play an S3M/MOD/XM/IT file from ArrayBuffer.
   * @param {ArrayBuffer} ab
   */
  async play(ab) {
    if (!this.ready) throw new Error("chiptune3 not initialized");
    this.player.play(ab);
    this.playing = true;
  }

  /** Stop playback. */
  stop() {
    if (this.player) this.player.stop();
    this.playing = false;
  }

  /** Pattern-row poller — voor dis_musrow ABI binding. */
  getCurrentRow() {
    return this.row;
  }
}
