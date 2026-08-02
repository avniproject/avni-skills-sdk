"use strict";
// Unit tests for src/crl/compliance-doc.js — the CRL's YAML loader.
// Bridges CJS → the ESM loader via a cached dynamic import (mirrors
// tests/corpus/lib/rule-grounding.cjs's bridge to src/rules-brain/validate.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { manifest } = require("../manifest.cjs");

const MOD = path.resolve(__dirname, "..", "..", "..", "src", "crl", "compliance-doc.js");
let _mod;
async function load() {
  if (!_mod) _mod = await import(pathToFileURL(MOD).href);
  return _mod;
}

// ─── Task 1.0 — js-yaml provisioned via the brain's node_modules (MAJ-2) ───
test("loadYaml resolves js-yaml from the brain and parses a YAML string (MAJ-2)", async () => {
  const { loadYaml } = await load();
  const yaml = loadYaml();
  assert.equal(typeof yaml.load, "function", "js-yaml exposes .load()");
  const parsed = yaml.load("version: 1\nrules: []\n");
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.rules, []);
});

// ─── Task 1.1 — compliance-doc.yaml + spec-template.yaml (raw structural) ───
// These parse the authored YAML directly via loadYaml (no loader/accessors yet;
// those land in 1.2) to drive the data-artifact contract from IC-7/MAJ-3/MAJ-11.
async function rawDoc(pathKey) {
  const { loadYaml, [pathKey]: p } = await load();
  return { doc: loadYaml().load(fs.readFileSync(p, "utf8")), p };
}

test("compliance-doc.yaml parses with 16 rules — 7 deterministic + 9 ai-judged (IC-7 w/ MAJ-11 FK split, prose-as-entity-name, + the 4 SRS-conformance rules)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  assert.equal(doc.version, 1);
  assert.ok(Array.isArray(doc.rules), "rules is an array");
  const det = doc.rules.filter((r) => r.tier === "deterministic");
  const ai = doc.rules.filter((r) => r.tier === "ai-judged");
  // MAJ-11 splits the single FK rule into fk-coded-answer-resolves (error) +
  // fk-coded-answer-optional-present (warning), so there are 7 deterministic
  // rules, not the plan verify-snippet's stale "6".
  // ai-judged is 9: the 4 original design-gap rules (prose-should-be-form,
  // orphan-stray-concept, rule-contradicts-intent, naming-incoherent), the
  // prose-as-entity-name prune rule added with prose-scrub, and the 4
  // design-gap#4 SRS-conformance rules (intent-vs-config) — roster, form
  // content, behaviour/automation, and the unrequested-config mirror.
  assert.equal(doc.rules.length, 16, "16 rules total");
  assert.equal(det.length, 7, "7 deterministic rules");
  assert.equal(ai.length, 9, "9 ai-judged rules");
});

test("FK rule is split by severity — resolves owns MISSING_REQUIRED_REF (error), optional-present owns DANGLING_REF (warning) (MAJ-11)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const byId = Object.fromEntries(doc.rules.map((r) => [r.id, r]));
  assert.deepEqual(byId["fk-coded-answer-resolves"].codes, ["MISSING_REQUIRED_REF"]);
  assert.equal(byId["fk-coded-answer-resolves"].severity, "error");
  assert.deepEqual(byId["fk-coded-answer-optional-present"].codes, ["DANGLING_REF"]);
  assert.equal(byId["fk-coded-answer-optional-present"].severity, "warning");
});

test("the original ai-judged design-gap classes are present, incl. the concept-level orphan/stray rule with the right inputs (MAJ-3/IC-7)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const ai = doc.rules.filter((r) => r.tier === "ai-judged");
  const classes = ai.map((r) => r.class);
  assert.ok(classes.includes("stray"), "stray class present (prose-form + orphan-concept)");
  assert.ok(classes.includes("contradicts-intent"), "rule-matches-intent class present");
  assert.ok(classes.includes("incoherent-name"), "naming-coherence class present");

  const byId = Object.fromEntries(ai.map((r) => [r.id, r]));
  assert.ok(byId["prose-should-be-form"], "prose-vs-form rule exists");
  const orphan = byId["orphan-stray-concept"];
  assert.ok(orphan, "concept-level orphan/stray rule exists (not just prose-forms)");
  for (const req of ["artifact.concepts", "scopingCtx", "deterministicFindings"]) {
    assert.ok(orphan.inputs.includes(req), `orphan-stray-concept inputs include ${req}`);
  }
});

// ─── design gap#4 — SRS-conformance rules (intent vs. config) ───
// These three are the only rules that judge the bundle against the org's SRS
// (the SCOPING_INTENT block) rather than against itself. Their safety
// properties are asserted here so a later edit cannot quietly relax them.
const SRS_CONFORMANCE_RULE_IDS = [
  "srs-requested-entity-absent",
  "srs-requested-form-content-absent",
  "srs-specified-behaviour-not-configured",
  "config-not-requested-by-srs",
];

test("the 4 SRS-conformance rules exist as ai-judged flag-only rules declaring [artifact.files, scopingCtx]", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const byId = Object.fromEntries(doc.rules.map((r) => [r.id, r]));
  for (const id of SRS_CONFORMANCE_RULE_IDS) {
    const rule = byId[id];
    assert.ok(rule, `SRS-conformance rule "${id}" exists`);
    assert.equal(rule.tier, "ai-judged", `${id} is ai-judged`);
    assert.equal(rule.action, "flag-only", `${id} must be flag-only — a conformance rule that prunes could delete a real entity that only LOOKS unrequested`);
    assert.equal(rule.severity, "warning", `${id} is a warning — a prose-vs-config judgment must not harden a ship gate`);
    assert.ok(rule.class, `${id} declares a class (assertRuleShape requires it for ai-judged)`);
    // Bundle-config comparison, never the spec layer: spec-template.yaml has no
    // top-level `rules:` key, so aiRulesOf() is [] there and a spec-kind rule
    // would be inert by construction (crl-gate-wiring.test.cjs:400).
    for (const req of ["artifact.files", "scopingCtx"]) {
      assert.ok(Array.isArray(rule.inputs) && rule.inputs.includes(req), `${id} inputs include ${req}`);
    }
    assert.ok(!rule.inputs.includes("artifact.spec"), `${id} must not declare artifact.spec — it is judged on the bundle_review path`);
  }
});

test("every SRS-conformance rule states its no-SRS behaviour in the model-facing description (a 'missing X' finding with no SRS to compare against is a pure false positive)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const byId = Object.fromEntries(doc.rules.map((r) => [r.id, r]));
  for (const id of SRS_CONFORMANCE_RULE_IDS) {
    // ai-judge.js buildUserMessage sends `description || provenance` to the
    // model, so the guard has to live in the field that is actually sent.
    const sent = byId[id].description || byId[id].provenance || "";
    assert.match(sent, /SCOPING_INTENT/, `${id} names the SCOPING_INTENT block the guard keys on`);
    assert.match(sent, /INAPPLICABLE|zero findings/, `${id} tells the judge to emit nothing when no SRS was supplied`);
  }
});

test("every SRS-conformance rule teaches the judge the SRS-side sampling convention — the workbook index is complete, a sheet's rows are not", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const byId = Object.fromEntries(doc.rules.map((r) => [r.id, r]));
  for (const id of SRS_CONFORMANCE_RULE_IDS) {
    const sent = byId[id].description || byId[id].provenance || "";
    // buildCrlScopingCtx renders a spreadsheet SRS as a COMPLETE workbook index
    // plus ~2 rows per sheet under a char cap, ending each sheet with
    // "… N more row(s) of this sheet not shown". Presence of a sheet is
    // evidence; absence of a row is not. A rule that asks the judge to
    // enumerate SRS fields against that payload manufactures gaps.
    assert.match(sent, /sheet/i, `${id} grounds the judge in the sheet-level view it actually receives`);
    assert.match(sent, /not shown|SAMPLE|sample/, `${id} tells the judge the SRS rows it sees are a sample, not the whole sheet`);
  }
});

test("SRS-conformance rules that read nullable projection keys teach the null-vs-array and counts-truncation conventions", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const byId = Object.fromEntries(doc.rules.map((r) => [r.id, r]));
  // Asserted per rule rather than uniformly: boilerplate in a description the
  // rule does not actually rely on is prompt noise, and a test that demands it
  // is a test that rewards padding. Each entry names the conventions THAT
  // rule's judgment genuinely turns on.
  const EXPECT = {
    // roster + mirror: read nullable keys AND the capped concepts/forms lists
    "srs-requested-entity-absent": [/`null`/, /array/i, /truncated/i],
    "config-not-requested-by-srs": [/`null`/, /array/i, /truncated/i],
    // behaviour: reads nullable keys (groups/reportCards/…) and per-form null rules
    "srs-specified-behaviour-not-configured": [/`null`/, /ARRAY|array/, /truncated/i],
    // form-content: a pure magnitude comparison over the capped forms list —
    // no nullable key is involved, so only the truncation convention applies.
    "srs-requested-form-content-absent": [/truncated/i],
  };
  assert.deepEqual(Object.keys(EXPECT).sort(), [...SRS_CONFORMANCE_RULE_IDS].sort(), "every conformance rule has a declared evidence expectation");
  for (const [id, patterns] of Object.entries(EXPECT)) {
    const sent = byId[id].description || byId[id].provenance || "";
    for (const p of patterns) assert.match(sent, p, `${id} states the evidence convention ${p}`);
  }
});

test("the two rules whose phrasing invites enumeration explicitly forbid it and defer to a lens (the other two are roster-level and never enumerate)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const byId = Object.fromEntries(doc.rules.map((r) => [r.id, r]));
  // "Which fields?" / "which schedules?" / "which cards?" are the questions the
  // capped digest cannot answer, and only these two rules are tempted to ask
  // them. They must forbid enumeration outright and hand the job to a human or
  // a review lens with unbounded paginated readSrsOnDir access. The roster and
  // mirror rules are not asserted here because they never enumerate in the
  // first place — asserting on them would pass by exclusion, not by content.
  for (const id of ["srs-requested-form-content-absent", "srs-specified-behaviour-not-configured"]) {
    const sent = byId[id].description || "";
    assert.match(sent, /NEVER name which|Do NOT enumerate|never assert a specific field|never enumerate/i,
      `${id} forbids enumerating SRS content it has not been shown`);
    assert.match(sent, /lens|human/i, `${id} defers enumeration to a human or a review lens`);
  }
});

test("the behaviour rule pins the specific projection keys it needs (a narrowed projection must fail here, not silently produce hallucinated gaps)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const rule = doc.rules.find((r) => r.id === "srs-specified-behaviour-not-configured");
  const sent = rule.description || "";
  // These are the ai-judge.js buildBundleProjection keys the four sub-checks
  // read. Naming them keeps the coupling visible from this side of the seam:
  // the rule is only judgeable while the projection carries them.
  for (const key of ["visitScheduleRule", "decisionRule", "groups", "groupPrivileges", "reportCards", "reportDashboards"]) {
    assert.match(sent, new RegExp(key), `behaviour rule names the projection key "${key}" it depends on`);
  }
  // groupPrivileges is a {total, allowed, byGroupUUID} SUMMARY, not rows — the
  // judge must not be invited to reason about individual privilege entries.
  assert.match(sent, /SUMMARY|summary/, "behaviour rule warns that groupPrivileges is a summary, not rows");
});

test("no SRS-conformance rule is executable by the scrub executor, and every ai-judged action is one the executor actually understands (safety invariant)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  // The executor's guardrail 3 only ever acts on these two; everything else
  // falls through to skipped(reason:"flag-only"). "apply" is NOT one of them —
  // authoring it would silently make a rule a no-op that READS executable.
  const APPLIABLE = new Set(["prune-candidate", "fix-candidate"]);
  const CONFORMANCE_CLASSES = new Set(["missing-requested-config", "unrequested-config"]);
  for (const rule of doc.rules.filter((r) => r.tier === "ai-judged")) {
    assert.ok(
      typeof rule.action === "string" && ["flag-only", ...APPLIABLE].includes(rule.action),
      `rule "${rule.id}" has action ${JSON.stringify(rule.action)} — must be flag-only | prune-candidate | fix-candidate`,
    );
    if (CONFORMANCE_CLASSES.has(rule.class)) {
      assert.equal(rule.action, "flag-only",
        `SRS-conformance rule "${rule.id}" must be flag-only — scrubOnDir runs the CRL in apply mode, and an entity can look unrequested purely because the SRS worded it differently`);
    }
  }
  // The guard above is worthless if no rule is actually in scope for it.
  assert.equal(doc.rules.filter((r) => CONFORMANCE_CLASSES.has(r.class)).length, SRS_CONFORMANCE_RULE_IDS.length,
    "every SRS-conformance rule id carries a conformance class (so the flag-only guard above actually covers them)");
});

test("every provenance field is org-free (MAJ-10)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const orgs = manifest().map((r) => r.org);
  for (const rule of doc.rules) {
    for (const org of orgs) {
      assert.ok(!String(rule.provenance || "").includes(org), `rule "${rule.id}" provenance leaks org "${org}"`);
      // `description` is model-facing (buildUserMessage sends it in preference
      // to provenance), so it is at least as exposed as provenance — same guard.
      assert.ok(!String(rule.description || "").includes(org), `rule "${rule.id}" description leaks org "${org}"`);
    }
  }
});

test("spec-template.yaml parses with a non-empty sections array", async () => {
  const { doc } = await rawDoc("DEFAULT_SPEC_TEMPLATE_PATH");
  assert.equal(doc.version, 1);
  assert.ok(Array.isArray(doc.sections) && doc.sections.length > 0, "sections present");
});

// ─── Task 1.2 — loader + accessors + shape validation ───
const os = require("node:os");
function tmpYaml(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdoc-"));
  const fp = path.join(dir, "d.yaml");
  fs.writeFileSync(fp, body);
  return fp;
}

test("loadComplianceDoc + accessors return the default doc: 7 deterministic, 9 ai-judged", async () => {
  const { loadComplianceDoc, deterministicRulesOf, aiRulesOf } = await load();
  const doc = loadComplianceDoc();
  const det = deterministicRulesOf(doc);
  const ai = aiRulesOf(doc);
  assert.equal(doc.rules.length, 16);
  assert.equal(det.length, 7);
  assert.equal(ai.length, 9);
  // The accessors partition the doc — no rule is dropped or double-counted.
  assert.equal(det.length + ai.length, doc.rules.length, "every rule lands in exactly one tier");
});

test("loadSpecTemplate returns the default spec-template", async () => {
  const { loadSpecTemplate } = await load();
  const tpl = loadSpecTemplate();
  assert.ok(Array.isArray(tpl.sections) && tpl.sections.length > 0);
});

test("loadComplianceDoc fails loud on a rule missing id / bad tier / bad severity / missing source / missing class / duplicate id", async () => {
  const { loadComplianceDoc } = await load();
  assert.throws(() => loadComplianceDoc(tmpYaml("version: 1\nfoo: bar\n")), /top-level "rules" array/);
  assert.throws(() => loadComplianceDoc(tmpYaml('version: 1\nrules:\n  - {tier: deterministic, severity: error, source: x}\n')), /missing "id"/);
  assert.throws(() => loadComplianceDoc(tmpYaml('version: 1\nrules:\n  - {id: a, tier: bogus, severity: error, source: x}\n')), /tier "bogus"/);
  assert.throws(() => loadComplianceDoc(tmpYaml('version: 1\nrules:\n  - {id: a, tier: deterministic, severity: fatal, source: x}\n')), /severity "fatal"/);
  assert.throws(() => loadComplianceDoc(tmpYaml('version: 1\nrules:\n  - {id: a, tier: deterministic, severity: error}\n')), /missing "source"/);
  assert.throws(() => loadComplianceDoc(tmpYaml('version: 1\nrules:\n  - {id: a, tier: ai-judged, severity: warning}\n')), /missing "class"/);
  assert.throws(() => loadComplianceDoc(tmpYaml('version: 1\nrules:\n  - {id: a, tier: deterministic, severity: error, source: x}\n  - {id: a, tier: deterministic, severity: error, source: y}\n')), /duplicate rule id/);
});
