"use strict";
// Unit + (opt-in) live tests for src/crl/ai-judge.js — the CRL's ai-judged
// pass. CJS harness bridges ESM via a cached dynamic import (rule-grounding.cjs
// pattern). The no-key tests are CI-safe; the two live tests self-skip unless
// ANTHROPIC_API_KEY is set (budget-capped via SDK_EVAL_BUDGET_USD).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const AIJ = path.resolve(__dirname, "..", "..", "src", "crl", "ai-judge.js");
async function loadAij() { return await import(pathToFileURL(AIJ).href + "?t=" + Date.now()); }

function tmpBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-aij-"));
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
  return dir;
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

const C_ORPHAN = "11111111-1111-1111-1111-111111111111";
const C_USED = "22222222-2222-2222-2222-222222222222";

// A concept-orphan ai rule in the REAL P1 flat shape (tier/class/action/inputs
// — NOT the master §2 judge{} block; P1's yaml has no judge{} sub-mapping).
function orphanRule() {
  return {
    id: "orphan-stray-concept", tier: "ai-judged", class: "stray", severity: "warning",
    action: "prune-candidate", inputs: ["artifact.concepts", "scopingCtx"],
    description: "A concept present in concepts.json that no form/rule/answer references and that reads as leftover junk (obviously placeholder name) is a stray — flag it prune-candidate.",
  };
}
function seededBundleFiles() {
  return {
    "concepts.json": [
      { name: "Age", uuid: C_USED, dataType: "Numeric" },
      { name: "JunkConceptNobodyUses_DELETE_ME", uuid: C_ORPHAN, dataType: "Text" },
    ],
    "forms/Registration_f1.json": {
      name: "Registration", uuid: "f1", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "age-el", concept: { name: "Age", uuid: C_USED, dataType: "Numeric" } }] }],
    },
    "subjectTypes.json": [{ name: "Individual", uuid: "st-1" }],
  };
}

// ─── no-key: zero-rule no-op ───
test("aiJudge: an empty ai-rule set is a free no-op — {findings:[],confidence:1,costUsd:0}, never touches the network", async () => {
  const { aiJudge } = await loadAij();
  const out = await aiJudge({ kind: "bundle", files: {} }, [], null, {});
  assert.deepEqual(out, { findings: [], confidence: 1, costUsd: 0 });
});

// ─── no-key: hard-throw guard for direct callers (CRIT-1: reviewBundle key-guards BEFORE this) ───
test("aiJudge: a non-empty ai-rule set with NO ANTHROPIC_API_KEY throws (the guard reviewBundle/reviewSpec front with a key check)", async () => {
  const { aiJudge } = await loadAij();
  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(() => aiJudge({ kind: "bundle", files: {} }, [orphanRule()], null, {}), /ANTHROPIC_API_KEY/);
  } finally {
    if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

// ─── no-key: model policy (whole-config → Sonnet ; delta → Haiku) ───
test("selectJudgeModel: whole-artifact inspection (delta===null) routes to Sonnet; a per-change delta routes to Haiku", async () => {
  const { selectJudgeModel, HAIKU_MODEL, SONNET_MODEL } = await loadAij();
  assert.equal(selectJudgeModel(null), SONNET_MODEL);
  assert.equal(selectJudgeModel({ changedFiles: ["concepts.json"] }), HAIKU_MODEL);
});

// ─── no-key: content projection (CRIT-2 — the model must see real content, not {kind,bundleDir}) ───
test("buildBundleProjection: emits real concept + form content (names, uuids, dataTypes) so the judge is never blind", async () => {
  const { buildBundleProjection } = await loadAij();
  const dir = tmpBundle(seededBundleFiles());
  const proj = buildBundleProjection(dir);
  assert.ok(Array.isArray(proj.concepts));
  assert.ok(proj.concepts.some((c) => c.uuid === C_ORPHAN && /JunkConceptNobodyUses/.test(c.name)));
  assert.ok(proj.concepts.some((c) => c.uuid === C_USED));
  assert.ok(Array.isArray(proj.forms) && proj.forms.some((f) => f.uuid === "f1"));
  cleanup(dir);
});

// ─── no-key: attribution — a finding we cannot map to a rule must be DROPPED ───
// stampFindings used to fall back to rules[0] whenever the set held exactly one
// rule, silently re-labelling an absent/hallucinated ruleId as that rule — and
// handing it that rule's authoritative class, severity and action. The
// whole-artifact pass has many rules so it never saw this; the low-confidence
// Sonnet re-judge filters down to just the escalated ids, which is exactly the
// single-rule case.
test("stampFindings: a finding with an UNKNOWN ruleId is dropped even when only one rule was judged — never re-labelled as that rule", async () => {
  const { stampFindings } = await loadAij();
  const rules = [orphanRule()];
  const out = stampFindings(
    [{ ruleId: "some-rule-that-does-not-exist", entity: "concept:X", confidence: 0.9 }],
    rules,
  );
  assert.deepEqual(out, [], "unattributable finding must not inherit the lone rule's identity");
});

test("stampFindings: a finding with NO ruleId at all is dropped from a single-rule set", async () => {
  const { stampFindings } = await loadAij();
  const out = stampFindings([{ entity: "concept:X", confidence: 0.9 }], [orphanRule()]);
  assert.deepEqual(out, []);
});

test("stampFindings: a correctly-attributed finding still stamps the rule's class/severity/action", async () => {
  const { stampFindings } = await loadAij();
  const out = stampFindings(
    [{ ruleId: "orphan-stray-concept", entity: "concept:Junk", confidence: 0.9 }],
    [orphanRule()],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].ruleId, "orphan-stray-concept");
  assert.equal(out[0].class, "stray");
  assert.equal(out[0].action, "prune-candidate");
});

// ─── no-key: widened projection (design gap#4 — the SRS-conformance categories) ───
// The projection used to stop at concepts/forms/subjectTypes/programs/
// encounterTypes/formMappings, so user groups, privileges, dashboards, report
// cards, address levels and the per-form rule bodies were invisible to the
// judge. A conformance rule cannot flag "the org asked for it and it isn't
// there" for a category the artifact never carries.
function conformanceBundleFiles() {
  return {
    ...seededBundleFiles(),
    "groups.json": [{ name: "Everyone", uuid: "g-1" }, { name: "Template Default", uuid: "g-2" }],
    "groupPrivilege.json": [
      { uuid: "p-1", groupUUID: "g-1", privilegeType: "ViewSubject", allow: true, voided: false },
      { uuid: "p-2", groupUUID: "g-1", privilegeType: "EditSubject", allow: true, voided: false },
      { uuid: "p-3", groupUUID: "g-2", privilegeType: "ViewSubject", allow: false, voided: false },
      { uuid: "p-4", groupUUID: "g-2", privilegeType: "ViewSubject", allow: true, voided: true },
    ],
    "addressLevelTypes.json": [{ name: "Village", level: 1, isRegistrationLocation: true }],
    "reportCard.json": [{ name: "Total", standardReportCardType: "src-1" }],
    "reportDashboard.json": [{ name: "Main", sections: [{ name: "Overview", cards: [{ uuid: "c-1" }, { uuid: "c-2" }] }] }],
    "groupDashboards.json": [{ groupName: "Everyone", dashboardName: "Main" }],
    "forms/Visit_f2.json": {
      name: "Visit", uuid: "f2", formType: "ProgramEncounter",
      visitScheduleRule: "({params}) => { return []; }",
      formElementGroups: [{ formElements: [{ name: "el", concept: { name: "Age", uuid: C_USED, dataType: "Numeric" } }] }],
    },
  };
}

test("buildBundleProjection: carries the SRS-conformance categories — groups, privileges, address levels, report cards, dashboards", async () => {
  const { buildBundleProjection } = await loadAij();
  const dir = tmpBundle(conformanceBundleFiles());
  const proj = buildBundleProjection(dir);
  assert.deepEqual(proj.groups.map((g) => g.name), ["Everyone", "Template Default"]);
  assert.equal(proj.groupPrivileges.total, 3, "voided privileges are excluded");
  assert.equal(proj.groupPrivileges.allowed, 2);
  assert.deepEqual(proj.groupPrivileges.byGroupUUID, { "g-1": 2, "g-2": 1 });
  assert.deepEqual(proj.addressLevelTypes, [{ name: "Village", level: 1, isRegistrationLocation: true }]);
  assert.deepEqual(proj.reportCards, [{ name: "Total", standardReportCardType: "src-1" }]);
  assert.deepEqual(proj.reportDashboards, [{ name: "Main", sections: [{ name: "Overview", cardCount: 2 }] }]);
  assert.deepEqual(proj.groupDashboards, [{ groupName: "Everyone", dashboardName: "Main" }]);
  cleanup(dir);
});

test("buildBundleProjection: carries per-form visitScheduleRule/decisionRule/validationRule — null when the form has none, so 'no automation configured' is a readable fact", async () => {
  const { buildBundleProjection } = await loadAij();
  const dir = tmpBundle(conformanceBundleFiles());
  const proj = buildBundleProjection(dir);
  const visit = proj.forms.find((f) => f.uuid === "f2");
  const reg = proj.forms.find((f) => f.uuid === "f1");
  assert.match(visit.visitScheduleRule, /scheduleBuilder|=>/);
  assert.equal(visit.decisionRule, null);
  assert.equal(reg.visitScheduleRule, null, "a form with no schedule rule reads as null, not absent");
  assert.equal(reg.decisionRule, null);
  assert.equal(reg.validationRule, null);
  cleanup(dir);
});

test("buildBundleProjection: an absent file projects as null, an empty one as [] — 'could not look' and 'looked, found nothing' must be distinguishable", async () => {
  const { buildBundleProjection } = await loadAij();
  const dir = tmpBundle({ ...seededBundleFiles(), "reportCard.json": [] });
  const proj = buildBundleProjection(dir);
  assert.equal(proj.groups, null, "no groups.json at all → null");
  assert.equal(proj.groupPrivileges, null);
  assert.equal(proj.reportDashboards, null);
  assert.deepEqual(proj.reportCards, [], "present but empty → []");
  cleanup(dir);
});

test("buildBundleProjection: counts report total vs projected so a truncated tail is never read as missing configuration", async () => {
  const { buildBundleProjection } = await loadAij();
  const many = Array.from({ length: 200 }, (_, i) => ({ name: `C${i}`, uuid: `u-${i}`, dataType: "Text" }));
  const dir = tmpBundle({ ...seededBundleFiles(), "concepts.json": many });
  const proj = buildBundleProjection(dir);
  assert.equal(proj.counts.concepts.total, 200);
  assert.ok(proj.counts.concepts.projected < 200);
  assert.equal(proj.counts.concepts.truncated, true);
  assert.equal(proj.counts.forms.truncated, false, "1 form is under the cap");
  cleanup(dir);
});

test("buildBundleProjection: a long rule body is clipped with an explicit truncation marker, never presented as the whole rule", async () => {
  const { buildBundleProjection } = await loadAij();
  const long = `// ${"x".repeat(5000)}`;
  const dir = tmpBundle({
    ...seededBundleFiles(),
    "forms/Big_f9.json": { name: "Big", uuid: "f9", formType: "ProgramEncounter", decisionRule: long, formElementGroups: [] },
  });
  const proj = buildBundleProjection(dir);
  const big = proj.forms.find((f) => f.uuid === "f9");
  assert.ok(big.decisionRule.length < long.length);
  assert.match(big.decisionRule, /truncated, 5\d{3} chars total/);
  cleanup(dir);
});

// ─── LIVE (opt-in): real Haiku call reads content, flags the orphan, reports cost (CRIT-2 + MAJ-7) ───
test("aiJudge: live Haiku call reads real bundle content, flags the seeded orphan, and reports a non-zero costUsd", async (t) => {
  if (!process.env.ANTHROPIC_API_KEY) { t.skip("ANTHROPIC_API_KEY not set — live test, opt-in"); return; }
  const { aiJudge } = await loadAij();
  const dir = tmpBundle(seededBundleFiles());
  // Pass a delta → routes to Haiku (cheap). No files in artifact → aiJudge
  // self-loads the projection from bundleDir (CRIT-2 belt-and-suspenders).
  const out = await aiJudge(
    { kind: "bundle", bundleDir: dir },
    [orphanRule()],
    { changedFiles: ["concepts.json"] },
    { orgAsk: "Track individual age at registration.", confidenceThreshold: 0.85 },
  );
  assert.ok(Array.isArray(out.findings));
  const flagged = out.findings.find((f) => f.target && (f.target.uuid === C_ORPHAN || /JunkConceptNobodyUses/i.test(JSON.stringify(f.target))));
  assert.ok(flagged, `a content-reading judge must flag the seeded orphan; got: ${JSON.stringify(out.findings)}`);
  assert.equal(flagged.ruleId, "orphan-stray-concept");
  assert.equal(flagged.action, "prune-candidate", "action is stamped from the rule, not invented by the model");
  assert.equal(typeof out.costUsd, "number");
  assert.ok(out.costUsd > 0, "a real paid Haiku call must report a non-zero cost");
  cleanup(dir);
});

// ─── no-key: O-2 merge semantics (Sonnet wins for re-judged rules) ───
test("mergeSonnetOverHaiku: re-judged rule ids are dropped from the Haiku set and replaced by the Sonnet findings (Sonnet wins)", async () => {
  const { mergeSonnetOverHaiku } = await loadAij();
  const haiku = [
    { ruleId: "orphan-stray-concept", confidence: 0.6, judgedBy: "haiku", target: { uuid: "x" } },
    { ruleId: "naming-incoherent", confidence: 0.95, judgedBy: "haiku", target: { uuid: "y" } },
  ];
  const sonnet = [
    { ruleId: "orphan-stray-concept", confidence: 0.92, judgedBy: "sonnet", target: { uuid: "x" } },
  ];
  const merged = mergeSonnetOverHaiku(haiku, sonnet, ["orphan-stray-concept"]);
  // the high-confidence naming finding (not re-judged) is kept as-is
  assert.ok(merged.some((f) => f.ruleId === "naming-incoherent" && f.judgedBy === "haiku"));
  // the re-judged orphan finding is the SONNET one, not the Haiku one
  const orphan = merged.filter((f) => f.ruleId === "orphan-stray-concept");
  assert.equal(orphan.length, 1);
  assert.equal(orphan[0].judgedBy, "sonnet");
  assert.equal(orphan[0].confidence, 0.92);
});

// ─── LIVE (opt-in): a sub-threshold Haiku finding IS re-judged on Sonnet (O-2/MAJ-9) ───
test("aiJudge: a Haiku finding below the confidence threshold is re-judged on Sonnet (Sonnet's verdict wins)", async (t) => {
  if (!process.env.ANTHROPIC_API_KEY) { t.skip("ANTHROPIC_API_KEY not set — live test, opt-in"); return; }
  const { aiJudge, SONNET_MODEL } = await loadAij();
  const dir = tmpBundle(seededBundleFiles());
  // Delta → Haiku primary; threshold pinned to 0.999 so ANY Haiku finding
  // (confidence < 0.999) forces the Sonnet re-judge path.
  const out = await aiJudge(
    { kind: "bundle", bundleDir: dir },
    [orphanRule()],
    { changedFiles: ["concepts.json"] },
    { orgAsk: "Track individual age at registration.", confidenceThreshold: 0.999 },
  );
  const flagged = out.findings.find((f) => f.ruleId === "orphan-stray-concept");
  assert.ok(flagged, `the orphan must still be flagged after re-judge; got: ${JSON.stringify(out.findings)}`);
  assert.equal(flagged.judgedBy, SONNET_MODEL, "a sub-threshold Haiku finding must be re-judged on Sonnet");
  assert.ok(out.costUsd > 0);
  cleanup(dir);
});
