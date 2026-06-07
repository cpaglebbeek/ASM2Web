/**
 * Architecture-viewer: laadt modules.json en vult ABI-tabel + module-lijst.
 * SVG-pipeline is hand-crafted in index.html (zie P-ARC-06).
 * Deterministisch: gesorteerde iteratie, geen RNG, geen tijdsafhankelijke logica.
 */
"use strict";

async function init() {
  let data;
  try {
    const res = await fetch("../modules.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (err) {
    document.getElementById("mod-list-arch").innerHTML =
      '<li class="loading">Kon modules.json niet laden: ' +
      escapeHtml(String(err && err.message ? err.message : err)) +
      "</li>";
    return;
  }

  renderAbi(data && Array.isArray(data.runtimeAbi) ? data.runtimeAbi : []);
  renderModules(data && Array.isArray(data.modules) ? data.modules : []);
}

function renderAbi(abi) {
  const tbody = document.querySelector("#abi-table tbody");
  if (!tbody) return;
  if (abi.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="purpose">Geen ABI-entries gedefinieerd.</td></tr>';
    return;
  }
  // Sort by fn-name for deterministic output.
  const sorted = abi.slice().sort((a, b) => String(a.fn).localeCompare(String(b.fn)));
  tbody.innerHTML = sorted.map(function (e) {
    return (
      "<tr>" +
        '<td class="fn">' + escapeHtml(e.fn || "") + "</td>" +
        '<td class="args">' + escapeHtml(e.args || "") + "</td>" +
        '<td class="purpose">' + escapeHtml(e.purpose || "") + "</td>" +
      "</tr>"
    );
  }).join("");
}

function renderModules(mods) {
  const ul = document.getElementById("mod-list-arch");
  if (!ul) return;
  if (mods.length === 0) {
    ul.innerHTML = '<li class="loading">Geen modules.</li>';
    return;
  }
  const sorted = mods.slice().sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
  ul.innerHTML = sorted.map(function (m) {
    return (
      "<li>" +
        '<span class="mod-name">' + escapeHtml(m.name || "?") + "</span>" +
        '<span class="mod-status"> &middot; ' + escapeHtml(m.status || "?") + "</span>" +
        '<span class="mod-stats"> &middot; ' +
          escapeHtml(String(m.totalAsmLines || 0)) + " ASM-regels &middot; " +
          escapeHtml(String(m.totalProcs || 0)) + " procs &middot; " +
          escapeHtml(String((m.files || []).length)) + " files" +
        "</span>" +
      "</li>"
    );
  }).join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

document.addEventListener("DOMContentLoaded", init);
