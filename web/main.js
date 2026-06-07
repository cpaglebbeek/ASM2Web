/**
 * ASM2Web frontend — deterministisch.
 * Geen Math.random(), geen Date.now() voor rendering, geen async race-conditions.
 * Pure data-binding: modules.json -> DOM.
 */
"use strict";

async function loadModules() {
  const target = document.getElementById("modules-list");
  let data;
  try {
    const res = await fetch("modules.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (err) {
    target.innerHTML =
      '<p class="loading">Kon modules.json niet laden: ' +
      escapeHtml(String(err && err.message ? err.message : err)) +
      "</p>";
    return;
  }

  if (!data || !Array.isArray(data.modules) || data.modules.length === 0) {
    target.innerHTML = '<p class="loading">Geen modules gedefinieerd.</p>';
    return;
  }

  // Render modules in fixed order (ordinal asc), deterministic.
  const sorted = data.modules.slice().sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
  target.innerHTML = sorted.map(renderModule).join("");

  // Update version line if present.
  if (data.generated) {
    const v = document.getElementById("version-line");
    if (v) {
      v.textContent =
        v.textContent +
        " · modules.json gegenereerd " + data.generated;
    }
  }
}

function renderModule(m) {
  const files = Array.isArray(m.files) ? m.files : [];
  const filesRows = files.map(renderFileRow).join("");
  const gold = m.goldStandardExe;
  return (
    '<article class="module-card">' +
      '<div class="module-head">' +
        '<span class="module-name">' + escapeHtml(m.name || "?") + "</span>" +
        '<span class="module-status">' + escapeHtml(m.status || "?") + "</span>" +
      "</div>" +
      "<dl class=\"module-meta\">" +
        metaItem("ordinal", m.ordinal) +
        metaItem("source", m.sourceDir) +
        metaItem("ASM-regels", m.totalAsmLines) +
        metaItem("procs", m.totalProcs) +
        (gold ? metaItem("gold-EXE", gold.bytes + " B / " + (gold.sha256 || "").slice(0, 12) + "…") : "") +
      "</dl>" +
      (filesRows
        ? '<div class="module-files"><table><thead><tr>' +
            "<th>file</th><th>type</th><th class=\"num\">regels</th><th class=\"num\">bytes</th>" +
            "<th class=\"num\">procs</th><th>sha256</th><th>rol</th>" +
          "</tr></thead><tbody>" +
          filesRows +
          "</tbody></table></div>"
        : "") +
    "</article>"
  );
}

function renderFileRow(f) {
  return (
    "<tr>" +
      "<td>" + escapeHtml(f.name || "") + "</td>" +
      "<td>" + escapeHtml(f.type || "") + "</td>" +
      "<td class=\"num\">" + escapeHtml(f.lines != null ? String(f.lines) : "") + "</td>" +
      "<td class=\"num\">" + escapeHtml(f.bytes != null ? String(f.bytes) : "") + "</td>" +
      "<td class=\"num\">" + escapeHtml(f.procs != null ? String(f.procs) : "") + "</td>" +
      "<td class=\"sha\">" + escapeHtml((f.sha256 || "").slice(0, 12)) + "…</td>" +
      "<td class=\"role\">" + escapeHtml(f.role || "") + "</td>" +
    "</tr>"
  );
}

function metaItem(label, value) {
  if (value == null || value === "") return "";
  return "<dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(String(value)) + "</dd>";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

document.addEventListener("DOMContentLoaded", loadModules);
