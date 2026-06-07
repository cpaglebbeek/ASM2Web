/**
 * Demo-orchestrator: load WASM, wire ABI, run main, blit canvas.
 */
"use strict";

import { loadModule, sha256Hex, VGA } from "../runtime/loader.js";

const WASM_URL     = "build/hello-pixel.wasm";
const SRC_URL      = "build/hello-pixel.asm";
const IR_URL       = "build/hello-pixel.ir.txt";
const MANIFEST_URL = "build/hello-pixel.manifest.json";

const $ = id => document.getElementById(id);

const ioLog = [];
function log(s) {
  ioLog.push(s);
  if (ioLog.length > 200) ioLog.splice(0, ioLog.length - 200);
  $("io-log").textContent = ioLog.join("\n");
  $("io-log").scrollTop = $("io-log").scrollHeight;
}

function setStep(id, status, detail) {
  const el = $("step-" + id);
  if (!el) return;
  el.classList.remove("done", "fail", "pending");
  el.classList.add(status);
  el.querySelector(".step-detail").textContent = detail || "";
}

async function loadText(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(url + ": " + r.status);
  return r.text();
}

let runtime = null;

async function init() {
  // Display source + IR + manifest first.
  try {
    const [src, ir, manText] = await Promise.all([
      loadText(SRC_URL), loadText(IR_URL), loadText(MANIFEST_URL),
    ]);
    $("asm-source").textContent = src;
    $("ir-source").textContent = ir;
    const man = JSON.parse(manText);
    $("info-src").textContent     = man.source.path + " (" + man.source.bytes + " B)";
    $("info-src-sha").textContent = man.source.sha256.slice(0, 16) + "…";
    $("info-wasm").textContent    = man.wasm.bytes + " B";
    $("info-wasm-sha").textContent = man.wasm.sha256.slice(0, 16) + "…";
    $("info-ops").textContent     = String(man.stats.ops) + " (unknown: " + man.stats.unknownOps + ")";
  } catch (e) {
    log("WARN: kon manifest niet lezen: " + e.message);
  }

  await loadAndRun(true);

  $("btn-run").addEventListener("click", () => runMain());
  $("btn-reload").addEventListener("click", () => loadAndRun(true));
  $("btn-clear").addEventListener("click", () => clearFramebuffer());
}

async function loadAndRun(autoRun) {
  ioLog.length = 0;
  setStep("fetch", "pending", "fetch " + WASM_URL);
  setStep("compile", "pending", "");
  setStep("imports", "pending", "");
  setStep("instantiate", "pending", "");
  setStep("run", "pending", "");
  setStep("blit", "pending", "");

  try {
    runtime = await loadModule(WASM_URL);
    setStep("fetch", "done", runtime.wasmBytes.length + " bytes");
    const hash = await sha256Hex(runtime.wasmBytes);
    setStep("compile", "done", "WASM compileert");
    setStep("imports", "done", "io_out, io_in, exit, mode13h_setpixel, dis_musrow, waitb");
    setStep("instantiate", "done", "exports: " + Object.keys(runtime.exports).join(", "));
    log("WASM SHA-256: " + hash);
    log("Exports: " + Object.keys(runtime.exports).join(", "));

    // Wrap io_out to also log.
    const origIoOut = runtime.abi.io_out;
    runtime.abi.io_out = (port, value) => {
      log("io_out(0x" + (port & 0xFFFF).toString(16) + ", " + (value & 0xFF) + ")");
      origIoOut(port, value);
    };

    if (autoRun) runMain();
  } catch (e) {
    setStep("fetch", "fail", e.message);
    log("FAIL: " + e.message);
  }
}

function runMain() {
  if (!runtime) return;
  if (!runtime.exports.main) {
    setStep("run", "fail", "geen 'main' export");
    return;
  }
  setStep("run", "pending", "calling main()...");
  try {
    runtime.exports.main();
    setStep("run", "done", "main() retourneerde (exit-code: " + (runtime.vga.exitCode ?? "n.v.t.") + ")");
    blit();
  } catch (e) {
    setStep("run", "fail", e.message);
    log("RUNTIME FAIL: " + e.message);
  }
}

function blit() {
  const canvas = $("screen");
  const ctx = canvas.getContext("2d");
  const id  = ctx.createImageData(VGA.WIDTH, VGA.HEIGHT);
  runtime.vga.blitTo(id);
  ctx.putImageData(id, 0, 0);
  // Count non-zero pixels for status.
  let nz = 0;
  for (let i = 0; i < runtime.vga.framebuffer.length; i++) if (runtime.vga.framebuffer[i] !== 0) nz++;
  setStep("blit", "done", nz + " non-nul pixels naar canvas");
}

function clearFramebuffer() {
  if (!runtime) return;
  runtime.vga.framebuffer.fill(0);
  blit();
  log("Framebuffer cleared");
}

document.addEventListener("DOMContentLoaded", init);
