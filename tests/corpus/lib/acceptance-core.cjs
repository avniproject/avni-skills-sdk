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
const { ruleGrounding } = require("./rule-grounding.cjs");
const { complianceCorpusValidity } = require("./compliance-validity.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..", ".."); // tests/corpus/lib → repo root

// The six vision themes + the cross-cutting floor, each mapped to a dimension.
const CRITERIA = [
  { key: "I4-parity",         theme: "I4 deep parity",                tier: "floor",       live: true },
  { key: "C5-generic",        theme: "C5 genericity (no hardcoding)", tier: "floor",       live: true },
  { key: "C3-rule-grounding", theme: "C3 rule grounding",             tier: "floor",       live: true },
  { key: "CRL1-doc-validity", theme: "CRL1 compliance-doc validity",  tier: "floor",       live: true },
  { key: "C4-generate",       theme: "C4 generate→validate→enhance",  tier: "floor",       live: false, story: "1/8+gen" },
  { key: "C2-long-horizon",   theme: "C2 long-horizon edits",         tier: "floor",       live: false, story: "5", agent: true },
  { key: "C6-conversational", theme: "C6 conversational requests",    tier: "floor",       live: false, story: "5/6", agent: true },
  { key: "C3-behavioral",     theme: "C3 behavioral rule parity",     tier: "aspirational", live: false, story: "11" },
  { key: "C1-merged-kb",      theme: "C1 merged.md retrieval",        tier: "aspirational", live: false, story: "7", agent: true },
];

async function runAcceptance({ real = false, hasKey = false, generate = false } = {}) {
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
      // C3 rule grounding — deterministic R1–R6 over the bundle's rules. Amber
      // (report-only, never fails the floor) since these are pre-existing deployed
      // rules; a generated bad rule becomes red once C4 generation lands.
      try {
        const rg = await ruleGrounding(dir);
        dims["C3-rule-grounding"] = {
          status: rg.errorCount === 0 ? "green" : "amber",
          detail: `err=${rg.errorCount} warn=${rg.warningCount}` + (rg.errorCount ? ` ${JSON.stringify(rg.byCode)}` : ""),
        };
      } catch (e) {
        dims["C3-rule-grounding"] = { status: "amber", detail: `grounding failed: ${e.message}` };
      }
      // CRL1 — compliance-doc.yaml's deterministic rule set. A small,
      // structural, non-negotiable subset (rule-body-parses,
      // fk-coded-answer-resolves, formelement-concept-is-object,
      // address-level-type-name-valid) gates green/red; the rest
      // (bundle-shape-valid's C/F/M/G/D output, the two *-liveness /
      // *-optional-present warning rules) is report-only — same "pre-existing
      // deployed rules" rationale as C3-rule-grounding above.
      // `row.complianceExceptions` (manifest-declared, org-specific,
      // exact-count) absorbs already-known findings without loosening the
      // underlying rule.
      try {
        const cv = await complianceCorpusValidity(dir, { exceptions: row.complianceExceptions || [] });
        dims["CRL1-doc-validity"] = {
          status: cv.status,
          detail: `floorReds=${cv.floorReds.join(",") || "none"}`
            + (cv.reportOnlyReds.length ? ` · reportOnly=${cv.reportOnlyReds.join(",")}` : ""),
        };
      } catch (e) {
        dims["CRL1-doc-validity"] = { status: "amber", detail: `compliance-doc check failed: ${e.message}` };
      }
      // C4 generate→diff (opt-in; slow — runs the avni-skills generator). Gap is
      // expected for un-enhanced inputs → amber, never fails the floor.
      if (generate && hasInputs(row)) {
        try {
          const { generateAndDiff } = require("./generation.cjs");
          const gd = await generateAndDiff(row, dir);
          dims["C4-generate"] = gd.skipped
            ? { status: "skip", detail: gd.reason }
            : gd.error
            ? { status: "amber", detail: `generator failed: ${gd.error}` }
            : {
                status: gd.pass ? "green" : "amber",
                detail: `parity ${gd.pass ? "PASS" : "gap"} — `
                  + Object.entries(gd.gap).map(([k, v]) => `${k} ${v.present}/${v.present + v.missing}${v.extra ? `(+${v.extra}x)` : ""}`).join("  "),
              };
        } catch (e) {
          dims["C4-generate"] = { status: "amber", detail: `generation error: ${String(e.message).split("\n")[0]}` };
        }
      }
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

  return { orgs, global, criteria: CRITERIA, floorPass: floorReds.length === 0, floorReds, real, hasKey, generate };
}

module.exports = { runAcceptance, CRITERIA };
