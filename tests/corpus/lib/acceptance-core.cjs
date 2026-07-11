"use strict";
// Acceptance-harness core (pure logic, no process side effects). Runs the
// deterministic dimensions over the runnable corpus and returns a scorecard.
// Agent-driven + generation dimensions are catalogued as `pending` here and
// filled in by later stories; this keeps the scorecard an honest full matrix.
const path = require("node:path");
const { manifest } = require("../manifest.cjs");
const { loadOracle, listRunnableOrgs, hasInputs } = require("./corpus-loader.cjs");
const { bundleDeepNames } = require("./deep-names.cjs");
const { diffDeep } = require("./deep-diff.cjs");
const { runGenericityGuard } = require("./genericity-guard.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..", ".."); // tests/corpus/lib → repo root

// The six vision themes + the cross-cutting floor, each mapped to a dimension.
const CRITERIA = [
  { key: "I4-parity",         theme: "I4 deep parity",                tier: "floor",       live: true },
  { key: "C5-generic",        theme: "C5 genericity (no hardcoding)", tier: "floor",       live: true },
  { key: "C4-generate",       theme: "C4 generate→validate→enhance",  tier: "floor",       live: false, story: "1/8+gen" },
  { key: "C3-rule-grounding", theme: "C3 rule grounding",             tier: "floor",       live: false, story: "3" },
  { key: "C2-long-horizon",   theme: "C2 long-horizon edits",         tier: "floor",       live: false, story: "5", agent: true },
  { key: "C6-conversational", theme: "C6 conversational requests",    tier: "floor",       live: false, story: "5/6", agent: true },
  { key: "C3-behavioral",     theme: "C3 behavioral rule parity",     tier: "aspirational", live: false, story: "11" },
  { key: "C1-merged-kb",      theme: "C1 merged.md retrieval",        tier: "aspirational", live: false, story: "7", agent: true },
];

function runAcceptance({ real = false, hasKey = false } = {}) {
  const rows = listRunnableOrgs(manifest(), { real });
  const orgs = [];
  for (const row of rows) {
    const dims = {};
    try {
      const dir = loadOracle(row);
      const g = bundleDeepNames(dir);
      const rich = g.subjectTypes.size > 0 && g.forms.size > 0;
      const self = diffDeep(g, g, { tolerate: row.tolerate || [] });
      dims["I4-parity"] = {
        status: rich && self.pass ? "green" : "red",
        detail: `st=${g.subjectTypes.size} forms=${g.forms.size} concepts=${g.concepts.size} fe=${g.formElements.size} rules=${g.ruleFields.size}`
          + (hasInputs(row) ? " · generation-parity pending (C4)" : " · oracle-only"),
      };
    } catch (e) {
      dims["I4-parity"] = { status: "red", detail: `load failed: ${e.message}` };
    }
    orgs.push({ org: row.org, tier: row.tier, oracleOnly: !hasInputs(row), dims });
  }

  const gen = runGenericityGuard(REPO_ROOT);
  const global = {
    "C5-generic": {
      status: gen.pass ? "green" : "red",
      detail: gen.pass ? "engine carries no org names" : `violations: ${JSON.stringify(gen.violations)}`,
    },
  };

  const floorReds = [];
  const floorKey = (k) => CRITERIA.find((c) => c.key === k && c.tier === "floor");
  for (const o of orgs) for (const [k, d] of Object.entries(o.dims)) {
    if (floorKey(k) && d.status === "red") floorReds.push(`${o.org}/${k}`);
  }
  for (const [k, d] of Object.entries(global)) {
    if (floorKey(k) && d.status === "red") floorReds.push(`global/${k}`);
  }

  return { orgs, global, criteria: CRITERIA, floorPass: floorReds.length === 0, floorReds, real, hasKey };
}

module.exports = { runAcceptance, CRITERIA };
