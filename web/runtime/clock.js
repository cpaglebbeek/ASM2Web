/**
 * Frame-clock — count-based.
 *
 * `requestAnimationFrame` is alleen een trigger, NIET een time-source.
 * `frame` increment is monotonous; mode-13h klassiek = 70 Hz; we runnen
 * effectief op de display-refresh (~60 Hz) maar tellen frames als integer.
 */
"use strict";

export class FrameClock {
  constructor(onTick) {
    this.frame  = 0;
    this.onTick = onTick;
    this.running = false;
    this._rafId = null;
    this._loop = this._loop.bind(this);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this._rafId = requestAnimationFrame(this._loop);
  }
  stop() {
    this.running = false;
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }
  step() {
    // Single deterministic tick (for testing).
    this.onTick(this.frame);
    this.frame++;
  }
  _loop() {
    if (!this.running) return;
    // Geen wallclock-delta; we tick één keer per rAF.
    this.onTick(this.frame);
    this.frame++;
    this._rafId = requestAnimationFrame(this._loop);
  }
}
