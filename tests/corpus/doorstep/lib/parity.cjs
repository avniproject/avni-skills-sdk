"use strict";
// Compare two bundles' active-name sets. `pass` gates only on the entity
// classes the approved success bar names; other classes are reported for
// insight but never fail the run.
const { BEHAVIOUR_CLASSES } = require("./entity-names.cjs");

const GATE_CLASSES = ["subjectTypes", "programs", "encounterTypes", "forms"];
const ENTITY_CLASSES = ["addressLevelTypes", "subjectTypes", "programs", "encounterTypes", "forms", "formMappings"];
const ALL_CLASSES = [...ENTITY_CLASSES, ...BEHAVIOUR_CLASSES];

// The behavioural gate (design gap#4). GATE_CLASSES asks only "is the roster the
// same" — a bundle can satisfy it completely while doing nothing: no visit
// schedules, no decision rules, a one-card dashboard stub. FULL_GATE_CLASSES
// adds the behavioural classes a real finished bundle carries, so a loop gating
// on it cannot declare success on a config that merely has the right names.
//
// `groups` and `formsWithValidationRule` are REPORTED but deliberately NOT
// gated. Groups because a server export accumulates operational artifacts that
// it would be wrong to reproduce — the Door Step School UAT carries an "SQLite
// Migration" group — so a name-equality gate there would demand the generator
// invent migration scaffolding. Validation rules because the generator already
// emits them broadly, making the class near-parity by default and therefore
// uninformative as a gate.
const FULL_GATE_CLASSES = [
  ...GATE_CLASSES,
  "formsWithVisitScheduleRule",
  "formsWithDecisionRule",
  "reportCards",
  "reportDashboards",
];

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

module.exports = {
  diffNames, formatParityReport,
  GATE_CLASSES, ALL_CLASSES, ENTITY_CLASSES, BEHAVIOUR_CLASSES, FULL_GATE_CLASSES,
};
