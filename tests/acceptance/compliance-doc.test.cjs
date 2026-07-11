"use strict";
// CRL1 doc-validity acceptance tests: (1) compliance-doc.yaml /
// spec-template.yaml are structurally well-formed and cover the contracted
// rule classes, (2) the deterministic floor-gating rule set is green across
// the full committed corpus, (3) the documented Udgam proprietary exception
// is exact — never a blanket "ignore all defects" allowlist. Self-skips
// corpus-dependent cases when the sibling repos aren't checked out, same
// convention as tests/acceptance/floor.test.cjs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { manifest } = require("../corpus/manifest.cjs");
const { loadOracle, listRunnableOrgs } = require("../corpus/lib/corpus-loader.cjs");
const { complianceCorpusValidity } = require("../corpus/lib/compliance-validity.cjs");
const { runAcceptance, CRITERIA } = require("../corpus/lib/acceptance-core.cjs");

const AVNI_SKILLS_PATH = process.env.AVNI_SKILLS_PATH || path.resolve(__dirname, "..", "..", "..", "avni-skills");
const skipNoBrain = !fs.existsSync(path.join(AVNI_SKILLS_PATH, "node_modules", "js-yaml")) && "avni-skills brain (js-yaml) not checked out — see AVNI_SKILLS_PATH";

const phulwari = manifest().find((r) => r.org === "phulwari");
const skipNoCorpus = !fs.existsSync(phulwari.oracle.dir) && "committed corpus siblings not checked out";

test("compliance-doc.yaml is well-formed and covers the four ai-judged design-gap classes, org-free provenance", { skip: skipNoBrain }, async () => {
  const { loadComplianceDoc } = await import("../../src/crl/compliance-doc.js");
  const doc = loadComplianceDoc();
  assert.ok(Array.isArray(doc.rules) && doc.rules.length > 0, "rules array present");

  const byId = Object.fromEntries(doc.rules.map((r) => [r.id, r]));
  // MAJ-11: FK severity split — no single rule owns both codes.
  assert.deepEqual(byId["fk-coded-answer-resolves"].codes, ["MISSING_REQUIRED_REF"]);
  assert.deepEqual(byId["fk-coded-answer-optional-present"].codes, ["DANGLING_REF"]);
  assert.equal(byId["fk-coded-answer-resolves"].severity, "error");
  assert.equal(byId["fk-coded-answer-optional-present"].severity, "warning");

  // MAJ-3: all four ai-judged design-gap classes present, not just prose-form.
  const aiRules = doc.rules.filter((r) => r.tier === "ai-judged");
  const aiClasses = aiRules.map((r) => r.class);
  assert.ok(aiClasses.includes("stray"), "stray class present (covers both prose-form and orphan-concept)");
  assert.ok(aiClasses.includes("contradicts-intent"), "rule-matches-intent class present");
  assert.ok(aiClasses.includes("incoherent-name"), "naming-coherence class present");
  const strayRuleIds = aiRules.filter((r) => r.class === "stray").map((r) => r.id);
  assert.ok(strayRuleIds.includes("orphan-stray-concept"), "concept-level orphan/stray rule exists (not just prose-forms)");
  assert.ok(strayRuleIds.includes("prose-should-be-form"), "prose-as-form rule exists");

  // MAJ-10: provenance fields are org-free.
  const orgs = manifest().map((r) => r.org);
  for (const rule of doc.rules) {
    for (const org of orgs) {
      assert.ok(!String(rule.provenance || "").includes(org), `rule "${rule.id}" provenance leaks org name "${org}"`);
    }
  }
});

test("CRL1-doc-validity is a live floor-tier dimension surfaced green per committed org by runAcceptance", { skip: skipNoCorpus || skipNoBrain }, async () => {
  const crit = CRITERIA.find((c) => c.key === "CRL1-doc-validity");
  assert.ok(crit, "CRL1-doc-validity is registered in CRITERIA");
  assert.equal(crit.tier, "floor", "CRL1-doc-validity is a floor-tier dimension");
  assert.equal(crit.live, true, "CRL1-doc-validity runs live (deterministic, CI-safe)");

  const res = await runAcceptance({ real: false, hasKey: false });
  assert.ok(res.orgs.length >= 10, `expected the committed corpus, got ${res.orgs.length}`);
  for (const o of res.orgs) {
    const d = o.dims["CRL1-doc-validity"];
    assert.ok(d, `${o.org} has a CRL1-doc-validity dim`);
    assert.equal(d.status, "green", `${o.org} CRL1 not green: ${d.detail}`);
  }
  assert.equal(res.floorPass, true, `floor reds: ${res.floorReds.join(", ")}`);
});

test("spec-template.yaml is well-formed", { skip: skipNoBrain }, async () => {
  const { loadSpecTemplate } = await import("../../src/crl/compliance-doc.js");
  const tpl = loadSpecTemplate();
  assert.ok(Array.isArray(tpl.sections) && tpl.sections.length > 0, "sections array present");
});

test("CRL1 deterministic floor-gating rules are green across the full committed corpus (10 orgs)", { skip: skipNoCorpus || skipNoBrain }, async () => {
  const rows = listRunnableOrgs(manifest(), { real: false });
  assert.ok(rows.length >= 10, `expected the full 10-org committed corpus, got ${rows.length}`);
  const reds = [];
  for (const row of rows) {
    const dir = loadOracle(row);
    const cv = await complianceCorpusValidity(dir, { exceptions: row.complianceExceptions || [] });
    if (cv.status !== "green") reds.push(`${row.org}: ${cv.floorReds.join(",")}`);
  }
  assert.deepEqual(reds, [], `CRL1 floor reds: ${reds.join(" | ")}`);
});

const udgam = manifest().find((r) => r.org === "Udgam Handicrafts");
const haveUdgam = udgam && fs.existsSync(udgam.oracle.zip);
const runReal = process.env.RUN_REAL === "1" && haveUdgam;
const udgamSkipReason = process.env.RUN_REAL !== "1"
  ? "set RUN_REAL=1 to run the proprietary-tier exact-count exception check"
  : (!haveUdgam ? "Udgam's gitignored resources not staged locally (see tests/resources/udgam/)" : false);

test("RUN_REAL=1: Udgam's 3 known rule-body-parses defects are an exact-count exception, never a blanket allowlist", { skip: runReal ? false : udgamSkipReason }, async () => {
  const dir = loadOracle(udgam);

  const withoutExceptions = await complianceCorpusValidity(dir, { exceptions: [] });
  assert.ok(withoutExceptions.floorReds.includes("rule-body-parses"), "unexempted, Udgam's real defects red the floor (proves the exception isn't a no-op)");

  const withExceptions = await complianceCorpusValidity(dir, { exceptions: udgam.complianceExceptions || [] });
  assert.equal(withExceptions.status, "green", `still red after the documented exception: ${withExceptions.floorReds.join(",")}`);

  // Drift detection: an exception one short of the real count must NOT fully absorb it.
  const underCounted = (udgam.complianceExceptions || []).map((e) => ({ ...e, count: Math.max(0, e.count - 1) }));
  const withUnderCount = await complianceCorpusValidity(dir, { exceptions: underCounted });
  assert.ok(withUnderCount.floorReds.includes("rule-body-parses"), "an under-declared exception still surfaces the remaining unexplained finding");
});
