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
