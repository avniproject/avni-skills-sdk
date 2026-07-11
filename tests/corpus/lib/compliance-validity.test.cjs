"use strict";
// CRL1 corpus-validity bridge tests: floor-gating structural rules red the
// gate; bundle-shape-valid + the two warning rules are report-only; documented
// exact-count exceptions absorb known findings without becoming a blanket
// allowlist. tmpBundle mirrors rule-grounding.test.cjs / deep-diff.test.cjs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { manifest } = require("../manifest.cjs");
const { loadOracle } = require("./corpus-loader.cjs");
const { complianceCorpusValidity } = require("./compliance-validity.cjs");

const phulwari = manifest().find((r) => r.org === "phulwari");
const skipNoCorpus = !fs.existsSync(phulwari.oracle.dir) && "committed corpus siblings not checked out";

function tmpBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  for (const [rel, c] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, typeof c === "string" ? c : JSON.stringify(c));
  }
  return dir;
}

test("a minimal-but-plausible bundle is green on the floor even though bundle-shape-valid reports pre-existing shape noise", async () => {
  const dir = tmpBundle({
    "concepts.json": [{ name: "Weight", uuid: "11111111-1111-1111-1111-111111111111", dataType: "Numeric" }],
    "subjectTypes.json": [{ name: "Member", uuid: "22222222-2222-2222-2222-222222222222", type: "Individual" }],
    "forms/reg.json": { name: "Registration", uuid: "33333333-3333-3333-3333-333333333333", formType: "IndividualProfile", formElementGroups: [] },
    "formMappings.json": [],
    "organisationConfig.json": {},
    "addressLevelTypes.json": [],
  });
  const cv = await complianceCorpusValidity(dir);
  assert.equal(cv.status, "green", `unexpected floor reds: ${cv.floorReds.join(",")}`);
  assert.deepEqual(cv.floorReds, []);
  assert.ok(cv.reportOnlyReds.includes("bundle-shape-valid"), "missing operational files still surface as report-only, not floor-gating");
});

test("a syntactically broken rule reds the floor via rule-body-parses", async () => {
  const dir = tmpBundle({
    "concepts.json": [],
    "forms/x.json": { name: "Visit", decisionRule: "({ params, imports }) => { this is not valid js" },
  });
  const cv = await complianceCorpusValidity(dir);
  assert.equal(cv.status, "red");
  assert.ok(cv.floorReds.includes("rule-body-parses"));
});

test("a dangling REQUIRED FK reds the floor via fk-coded-answer-resolves", async () => {
  const dir = tmpBundle({
    "concepts.json": [],
    "subjectTypes.json": [{ name: "Member", uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", type: "Individual" }],
    "formMappings.json": [{ uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", formUUID: "cccccccc-cccc-cccc-cccc-cccccccccccc", subjectTypeUUID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }],
  });
  const cv = await complianceCorpusValidity(dir);
  assert.equal(cv.status, "red");
  assert.ok(cv.floorReds.includes("fk-coded-answer-resolves"));
});

test("a dangling OPTIONAL FK is report-only via fk-coded-answer-optional-present, never reds the floor", async () => {
  const dir = tmpBundle({
    "concepts.json": [],
    "encounterTypes.json": [{ name: "Visit", uuid: "dddddddd-dddd-dddd-dddd-dddddddddddd", conceptUuid: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" }],
  });
  const cv = await complianceCorpusValidity(dir);
  assert.equal(cv.status, "green");
  assert.deepEqual(cv.floorReds, []);
  // The DANGLING_REF finding is captured (not silently dropped) but is a
  // warning, so the rule stays green — never a floor red, and never a
  // report-only RED either (reportOnlyReds holds only red non-floor rules;
  // a warning-only rule is green by MAJ-11's finding-severity keying).
  const opt = cv.byRule["fk-coded-answer-optional-present"];
  assert.equal(opt.status, "green");
  assert.ok(opt.findings.some((f) => f.code === "DANGLING_REF" && f.severity === "warning"), "the dangling optional ref is surfaced as a warning finding");
  assert.ok(!cv.floorReds.includes("fk-coded-answer-optional-present"));
});

test("a documented exact-count exception absorbs known findings but under-declaring it still reds (drift detection)", async () => {
  const dir = tmpBundle({
    "concepts.json": [],
    "forms/a.json": { name: "A", decisionRule: "({ params, imports }) => { not valid #1" },
    "forms/b.json": { name: "B", decisionRule: "({ params, imports }) => { not valid #2" },
  });
  const under = await complianceCorpusValidity(dir, { exceptions: [{ ruleId: "rule-body-parses", code: "R1-SYNTAX", count: 1 }] });
  assert.equal(under.status, "red", "1 exception can't absorb 2 real findings");

  const exact = await complianceCorpusValidity(dir, { exceptions: [{ ruleId: "rule-body-parses", code: "R1-SYNTAX", count: 2 }] });
  assert.equal(exact.status, "green");
});

test("real bundle (phulwari): CRL1 floor-gating rules are green", { skip: skipNoCorpus }, async () => {
  const dir = loadOracle(phulwari);
  const cv = await complianceCorpusValidity(dir);
  assert.equal(cv.status, "green", `floor reds: ${cv.floorReds.join(",")}`);
});
