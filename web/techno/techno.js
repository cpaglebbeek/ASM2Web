/**
 * TECHNO orchestrator: laad techno-linked.wasm, init driver, frame-loop.
 */
"use strict";

import { loadModule, sha256Hex, VGA } from "../runtime/loader.js";
import { KoeDriver } from "../runtime/koe-driver.js";

const WASM_URL     = "../demo/build/techno-linked.wasm";
const MANIFEST_URL = "../demo/build/techno-linked.manifest.json";

const $ = id => document.getElementById(id);

let runtime = null;
let driver  = null;
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

async function loadManifest() {
  try {
    const r = await fetch(MANIFEST_URL, { cache: "no-cache" });
    const m = await r.json();
    $("info-wasm").textContent = m.wasm.bytes + " B";
    $("info-wasm-sha").textContent = m.wasm.sha256.slice(0, 16) + "…";
    $("info-fns").textContent = String(m.stats.modulesLinked + " modules, "
      + Object.keys(m.layout.symbolOffsets).length + " externs");
  } catch (e) { log("warn: kon manifest niet laden: " + e.message); }
}

async function initAndStart() {
  if (running) return;
  log("Loading WASM van " + WASM_URL + "...");
  try {
    runtime = await loadModule(WASM_URL);
    log("WASM loaded, " + runtime.wasmBytes.length + " bytes");
    const hash = await sha256Hex(runtime.wasmBytes);
    log("WASM sha256: " + hash);
    log("Exports: " + Object.keys(runtime.exports).length + " functions");

    driver = new KoeDriver(runtime.instance, runtime.vga);
    log("KoeDriver gemaakt");
    driver.init();
    log("Driver init OK");

    $("info-status").textContent = "draait";
    running = true;
    fpsLastTime = performance.now();
    fpsFrames = 0;
    loop();
  } catch (e) {
    log("FAIL: " + e.message);
    $("info-status").textContent = "fail: " + e.message;
  }
}

function loop() {
  if (!running || !driver) return;
  try {
    const cont = driver.tick();
    if (!cont) {
      log("Program ended (exit-code: " + runtime.vga.exitCode + ")");
      running = false;
      $("info-status").textContent = "ended (exit " + runtime.vga.exitCode + ")";
      return;
    }
  } catch (e) {
    errorCount++;
    if (errorCount < 5) log("Tick error: " + e.message);
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
  $("info-frame").textContent = String(driver.frame);
  $("info-musrow").textContent = String(driver.musicRow);
  let nz = 0;
  const fb = runtime.vga.framebuffer;
  for (let i = 0; i < fb.length; i++) if (fb[i] !== 0) nz++;
  $("info-pixels").textContent = String(nz);
}

function pause() {
  running = !running;
  if (running) {
    $("info-status").textContent = "draait";
    fpsLastTime = performance.now();
    fpsFrames = 0;
    loop();
  } else {
    $("info-status").textContent = "pause";
    if (rafId) cancelAnimationFrame(rafId);
  }
}

function step() {
  if (!driver) return;
  driver.tick();
  blit();
  updateStats();
}

function reset() {
  if (rafId) cancelAnimationFrame(rafId);
  running = false;
  runtime = null;
  driver  = null;
  errorCount = 0;
  $("info-frame").textContent = "0";
  $("info-musrow").textContent = "0";
  $("info-fps").textContent = "—";
  $("info-pixels").textContent = "0";
  $("info-errors").textContent = "0";
  $("info-status").textContent = "niet gestart";
  const canvas = $("screen");
  canvas.getContext("2d").clearRect(0, 0, 320, 200);
  log("--- reset ---");
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadManifest();
  $("btn-init").addEventListener("click", initAndStart);
  $("btn-pause").addEventListener("click", pause);
  $("btn-step").addEventListener("click", step);
  $("btn-reset").addEventListener("click", reset);
});
