"use strict";
// Diff two full-depth name-graphs (from deep-names.cjs). Every class is a flat
// Set (nested layers are flattened to "parent › child" tokens), so one diffOne
// serves all. `pass` gates on the full-depth FLOOR set (the user's decision);
// formGroups is reported but not floor-gated.
const FLOOR_CLASSES = [
  "subjectTypes", "programs", "encounterTypes", "forms", "formMappings",
  "concepts", "codedAnswers", "formElements", "ruleFields",
];
const REPORT_CLASSES = ["formGroups"];
const ALL_CLASSES = [...FLOOR_CLASSES, ...REPORT_CLASSES];

function diffOne(gen, tgt) {
  const present = [], missing = [];
  for (const n of tgt) (gen.has(n) ? present : missing).push(n);
  const extra = [...gen].filter((n) => !tgt.has(n));
  return { present: present.sort(), missing: missing.sort(), extra: extra.sort() };
}

// generated vs target (target = oracle = source of truth). `tolerate` drops named
// classes from the gate (per-org legitimate differences).
function diffDeep(generated, target, { gateClasses = FLOOR_CLASSES, tolerate = [] } = {}) {
  const classes = {};
  for (const k of ALL_CLASSES) classes[k] = diffOne(generated[k] || new Set(), target[k] || new Set());
  const gates = gateClasses.filter((k) => !tolerate.includes(k));
  const pass = gates.every((k) => (classes[k]?.missing.length ?? 0) === 0);
  return { classes, pass, gateClasses: gates };
}

function formatDeepReport(diff) {
  const lines = [`DEEP PARITY: ${diff.pass ? "PASS" : "FAIL"}  (floor: ${diff.gateClasses.join(", ")})`];
  for (const [k, c] of Object.entries(diff.classes)) {
    const tot = c.present.length + c.missing.length;
    const tag = diff.gateClasses.includes(k) ? "" : " (report)";
    const miss = c.missing.length
      ? `  missing ${c.missing.length} [${c.missing.slice(0, 6).join(" | ")}${c.missing.length > 6 ? " …" : ""}]`
      : "";
    const extra = c.extra.length ? `  extra ${c.extra.length}` : "";
    lines.push(`  ${k}${tag}: ${c.present.length}/${tot}${miss}${extra}`);
  }
  return lines.join("\n");
}

module.exports = { diffDeep, formatDeepReport, FLOOR_CLASSES, REPORT_CLASSES, ALL_CLASSES };
