"use strict";
// CJS ⇄ ESM bridge for src/crl/{compliance-doc,deterministic-checker}.js —
// mirrors tests/corpus/lib/rule-grounding.cjs's bridge to
// src/rules-brain/validate.js. Runs compliance-doc.yaml's deterministic rule
// set over a bundle dir and reduces it to the CRL1-doc-validity acceptance
// dimension: a small, fixed set of "floor-gating" rule ids (structural,
// non-negotiable — see FLOOR_GATING_RULE_IDS) fail the floor; everything else
// deterministic (bundle-shape-valid's C/F/M/G/D output, and the two
// *-liveness / *-optional-present warning rules) is report-only — mirrors
// acceptance-core.cjs's existing C3-rule-grounding precedent: "amber, never
// fails the floor, since these are pre-existing deployed rules."
//
// Verified against the full 14-org corpus (10 committed + 4 proprietary,
// RUN_REAL=1) at authoring time: all 4 floor-gating rules are green on every
// committed org with ZERO exceptions declared (the committed Astitva/Durga
// oracles carry zero integrity findings — see manifest.cjs). The only
// floor-gating red in the whole corpus is the proprietary Udgam Handicrafts
// bundle's rule-body-parses (2×R1-SYNTAX + 1×R2-WRAPPER) — see manifest.cjs's
// `complianceExceptions` on that row.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const COMPLIANCE_DOC = path.resolve(__dirname, "..", "..", "..", "src", "crl", "compliance-doc.js");
const DETERMINISTIC_CHECKER = path.resolve(__dirname, "..", "..", "..", "src", "crl", "deterministic-checker.js");

let _docMod, _checkerMod;
async function loadDocMod() {
  if (!_docMod) _docMod = await import(pathToFileURL(COMPLIANCE_DOC).href);
  return _docMod;
}
async function loadCheckerMod() {
  if (!_checkerMod) _checkerMod = await import(pathToFileURL(DETERMINISTIC_CHECKER).href);
  return _checkerMod;
}

// Structural, non-negotiable rule ids — a red here means the bundle would
// crash the server or corrupt sync, never "pre-existing deployed rule noise".
const FLOOR_GATING_RULE_IDS = [
  "rule-body-parses",
  "fk-coded-answer-resolves",
  "formelement-concept-is-object",
  "address-level-type-name-valid",
];

// Subtract a documented, exact-count ceiling of ALREADY-KNOWN findings for a
// specific rule+code before deciding status. Never loosens the rule itself
// (compliance-doc.yaml's codes/severity are untouched) — a genuinely NEW
// finding beyond the declared count still reds, and an org that FIXES a
// known defect (fewer live findings than declared) is never penalised.
function withExceptionsApplied(ruleId, findings, exceptions) {
  const remaining = new Map();
  for (const ex of exceptions) if (ex.ruleId === ruleId) remaining.set(ex.code, (remaining.get(ex.code) || 0) + ex.count);
  return findings.filter((f) => {
    const left = remaining.get(f.code) || 0;
    if (left > 0) { remaining.set(f.code, left - 1); return false; }
    return true;
  });
}

async function complianceCorpusValidity(bundleDir, { docPath, exceptions = [] } = {}) {
  const { loadComplianceDoc } = await loadDocMod();
  const { deterministicChecker } = await loadCheckerMod();
  const doc = loadComplianceDoc(docPath);
  const result = await deterministicChecker(bundleDir, doc);

  const floorReds = [];
  const reportOnlyReds = [];
  for (const [ruleId, r] of Object.entries(result.byRule)) {
    const unexplained = withExceptionsApplied(ruleId, r.findings, exceptions);
    const stillRed = unexplained.some((f) => f.severity === "error");
    if (FLOOR_GATING_RULE_IDS.includes(ruleId)) {
      if (stillRed) floorReds.push(ruleId);
    } else if (r.status === "red") {
      reportOnlyReds.push(ruleId);
    }
  }

  return {
    status: floorReds.length === 0 ? "green" : "red",
    floorReds,
    reportOnlyReds,
    byRule: result.byRule,
  };
}

module.exports = { complianceCorpusValidity, FLOOR_GATING_RULE_IDS };
