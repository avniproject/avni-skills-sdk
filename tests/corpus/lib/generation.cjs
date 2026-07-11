"use strict";
// C4: generate a bundle from the org's scoping (forms) + modelling inputs via the
// avni-skills generator, then deep-diff generated-vs-oracle. Deterministic (no LLM).
// A raw baseline gap is EXPECTED for un-enhanced inputs (the Doorstep Phase-3
// pattern: scoping docs are incomplete) → reported as a gap, never a floor failure.
const { generateFromXlsx } = require("../doorstep/lib/run-parity.cjs");
const { bundleDeepNames } = require("./deep-names.cjs");
const { diffDeep } = require("./deep-diff.cjs");

const GAP_CLASSES = ["subjectTypes", "programs", "encounterTypes", "forms", "concepts", "formElements"];

async function generateAndDiff(row, oracleDir) {
  if (!row.inputs || !row.inputs.srs || !row.inputs.modelling) {
    return { skipped: true, reason: "needs srs+modelling inputs" };
  }
  let genDir;
  try {
    // generator flags: --forms ← scoping/forms workbook, --srs ← modelling workbook
    genDir = generateFromXlsx({ formsXlsx: row.inputs.srs, modelXlsx: row.inputs.modelling, org: row.org });
  } catch (e) {
    return { generated: false, error: String(e.message || e).split("\n")[0] };
  }
  const diff = diffDeep(bundleDeepNames(genDir), bundleDeepNames(oracleDir), { tolerate: row.tolerate || [] });
  const gap = {};
  for (const k of GAP_CLASSES) {
    const c = diff.classes[k];
    if (c) gap[k] = { present: c.present.length, missing: c.missing.length, extra: c.extra.length };
  }
  return { generated: true, pass: diff.pass, gap, genDir };
}

module.exports = { generateAndDiff, GAP_CLASSES };
