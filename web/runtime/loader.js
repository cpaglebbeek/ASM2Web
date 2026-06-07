/**
 * WASM loader: download `.wasm`, instantiate with ABI, return handle.
 */
"use strict";

import { makeAbi } from "./abi.js";
import { newVgaState, VGA } from "./vga13.js";

/**
 * @param {string} wasmUrl
 * @returns {Promise<{ instance, memory, vga, abi, exports }>}
 */
export async function loadModule(wasmUrl) {
  const memory = new WebAssembly.Memory({ initial: 16, maximum: 16 });
  const vga    = newVgaState(memory);
  const abi    = makeAbi(memory, vga);

  const res = await fetch(wasmUrl, { cache: "no-cache" });
  if (!res.ok) throw new Error("Kan WASM niet laden: " + res.status + " " + res.statusText);
  const bytes  = await res.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, { env: abi });

  return { instance, memory, vga, abi, exports: instance.exports, wasmBytes: new Uint8Array(bytes) };
}

/** Hash the WASM bytes (SHA-256 via SubtleCrypto) — for build-determinisme display. */
export async function sha256Hex(bytes) {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export { VGA };
