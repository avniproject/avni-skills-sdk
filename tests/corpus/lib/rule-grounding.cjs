"use strict";
// Deterministic rule-grounding over a bundle's existing rules: static R1–R6
// (parse / wrapper / forbidden globals / bad imports / concept-UUID liveness)
// via the rules-brain validator. Zero LLM. Bridges CJS → the ESM validator
// through a cached dynamic import.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const VALIDATE = path.resolve(__dirname, "..", "..", "..", "src", "rules-brain", "validate.js");
let _mod;
async function loadValidator() {
  if (!_mod) _mod = await import(pathToFileURL(VALIDATE).href);
  return _mod;
}

async function ruleGrounding(bundleDir) {
  const { validateBundleRules } = await loadValidator();
  const agg = await validateBundleRules(bundleDir);
  const errors = agg.errors || [];
  const warnings = agg.warnings || [];
  const byCode = {};
  for (const e of errors) byCode[e.code] = (byCode[e.code] || 0) + 1;
  const filesWithErrors = Object.keys(agg.byFile || {})
    .filter((f) => (agg.byFile[f].errors || []).length).length;
  return { errorCount: errors.length, warningCount: warnings.length, filesWithErrors, byCode };
}

module.exports = { ruleGrounding };
