/**
 * STARFIELD orchestrator — laad starfield.wasm + bouwt simpele driver-loop.
 */
"use strict";

import { loadModule, sha256Hex, VGA } from "../runtime/loader.js";

const WASM_URL = "../demo/build/starfield.wasm";

const $ = id => document.getElementById(id);

let runtime = null;
let frame   = 0;
let rafId   = null;
let running = false;
let errorCount = 0;
let fpsLastTime = 0;
let fpsFrames = 0;

function log(s) {
  const c = $("console");
  c.textContent += s + "\n";
  c.scrollTop = c.scrollHeight;
}

async function initAndStart() {
  if (running) return;
  log("Loading WASM " + WASM_URL + "...");
  try {
    runtime = await loadModule(WASM_URL);
    log("WASM loaded: " + runtime.wasmBytes.length + " bytes");
    const hash = await sha256Hex(runtime.wasmBytes);
    log("WASM sha256: " + hash);
    const exports = Object.keys(runtime.exports);
    log("Exports (" + exports.length + "): " + exports.slice(0, 6).join(", ") + "…");

    $("info-wasm").textContent = runtime.wasmBytes.length + " B";
    $("info-wasm-sha").textContent = hash.slice(0, 16) + "…";
    $("info-fns").textContent = String(exports.length);

    // Init phase — call init-style functions
    for (const fn of ["resetmode13", "init_stars"]) {
      if (typeof runtime.exports[fn] === "function") {
        try { runtime.exports[fn](); log("  init: " + fn + "() OK"); }
        catch (e) { log("  init: " + fn + "(): " + e.message); }
      }
    }

    $("info-status").textContent = "draait";
    running = true;
    fpsLastTime = performance.now();
    fpsFrames = 0;
    loop();
  } catch (e) {
    log("FAIL: " + e.message);
    $("info-status").textContent = "fail";
  }
}

function loop() {
  if (!running) return;
  frame++;

  try {
    // STARFIELD main render = do_stars
    if (typeof runtime.exports.do_stars === "function") {
      runtime.exports.do_stars();
    } else if (typeof runtime.exports.poly === "function") {
      runtime.exports.poly();
    }
    if (typeof runtime.exports.outpal === "function") {
      runtime.exports.outpal();
    }
  } catch (e) {
    errorCount++;
    if (errorCount < 3) log("Tick error: " + e.message);
    $("info-errors").textContent = String(errorCount);
  }

  blit();
  updateStats();
  rafId = requestAnimationFrame(loop);
}

function blit() {
  const canvas = $("screen");
  const ctx = canvas.getContext("2d");
  const id  = ctx.createImageData(VGA.WIDTH, VGA.HEIGHT);
  runtime.vga.blitTo(id);
  ctx.putImageData(id, 0, 0);
}

function updateStats() {
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLastTime >= 1000) {
    const fps = (fpsFrames * 1000 / (now - fpsLastTime)).toFixed(1);
    $("info-fps").textContent = fps;
    fpsLastTime = now;
    fpsFrames = 0;
  }
  $("info-frame").textContent = String(frame);
  let nz = 0;
  const fb = runtime.vga.framebuffer;
  for (let i = 0; i < fb.length; i++) if (fb[i] !== 0) nz++;
  $("info-pixels").textContent = String(nz);
}

function pause() {
  running = !running;
  if (running) { $("info-status").textContent = "draait"; fpsLastTime = performance.now(); fpsFrames = 0; loop(); }
  else { $("info-status").textContent = "pause"; if (rafId) cancelAnimationFrame(rafId); }
}

function step() {
  if (!runtime) return;
  if (typeof runtime.exports.do_stars === "function") {
    try { runtime.exports.do_stars(); } catch (e) {}
  }
  frame++;
  blit();
  updateStats();
}

function reset() {
  if (rafId) cancelAnimationFrame(rafId);
  running = false;
  runtime = null;
  frame = 0;
  errorCount = 0;
  $("info-frame").textContent = "0";
  $("info-fps").textContent = "—";
  $("info-pixels").textContent = "0";
  $("info-errors").textContent = "0";
  $("info-status").textContent = "niet gestart";
  $("screen").getContext("2d").clearRect(0, 0, 320, 200);
  log("--- reset ---");
}

document.addEventListener("DOMContentLoaded", () => {
  $("btn-init").addEventListener("click", initAndStart);
  $("btn-pause").addEventListener("click", pause);
  $("btn-step").addEventListener("click", step);
  $("btn-reset").addEventListener("click", reset);
});
