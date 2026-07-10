"use strict";
// Compare two bundles' active-name sets. `pass` gates only on the entity
// classes the approved success bar names; other classes are reported for
// insight but never fail the run.
const GATE_CLASSES = ["subjectTypes", "programs", "encounterTypes", "forms"];
const ALL_CLASSES = ["addressLevelTypes", "subjectTypes", "programs", "encounterTypes", "forms", "formMappings"];

function diffOne(gen, tgt) {
  const present = [], missing = [];
  for (const name of tgt) (gen.has(name) ? present : missing).push(name);
  const extra = [...gen].filter((n) => !tgt.has(n));
  return { present: present.sort(), missing: missing.sort(), extra: extra.sort() };
}

function diffNames(generated, target, gateClasses = GATE_CLASSES) {
  const classes = {};
  for (const k of ALL_CLASSES) {
    classes[k] = diffOne(generated[k] || new Set(), target[k] || new Set());
  }
  const pass = gateClasses.every((k) => (classes[k]?.missing.length ?? 0) === 0);
  return { classes, pass };
}

function formatParityReport(diff) {
  const lines = [`PARITY: ${diff.pass ? "PASS" : "FAIL"}`];
  for (const [k, c] of Object.entries(diff.classes)) {
    const tot = c.present.length + c.missing.length;
    lines.push(`  ${k}: ${c.present.length}/${tot} present` +
      (c.missing.length ? `, missing [${c.missing.join(", ")}]` : "") +
      (c.extra.length ? `, extra [${c.extra.join(", ")}]` : ""));
  }
  return lines.join("\n");
}

module.exports = { diffNames, formatParityReport, GATE_CLASSES, ALL_CLASSES };
