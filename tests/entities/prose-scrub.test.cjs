"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const os = require("node:os");
async function loadDoc() {
  const m = await import(pathToFileURL(path.resolve(__dirname, "../../src/crl/compliance-doc.js")).href);
  return m.loadComplianceDoc();
}
test("prose-as-entity-name rule exists as ai-judged prune-candidate", async () => {
  const doc = await loadDoc();
  const rule = doc.rules.find((r) => r.id === "prose-as-entity-name");
  assert.ok(rule, "prose-as-entity-name rule must be present");
  assert.equal(rule.tier, "ai-judged");
  assert.equal(rule.class, "stray");
  assert.equal(rule.action, "prune-candidate");
});

async function loadScrub() { return import(pathToFileURL(path.resolve(__dirname, "../../src/crl/prose-scrub.js")).href); }

// Minimal bundle dir: subjectTypes + a real form + a prose-named form + a form
// that a real concept-in-another-form references is out of scope here (forms
// aren't cross-referenced by name), so "referenced" is exercised in Task 6/eval.
function tmpBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prose-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([{ name: "Student", uuid: "s-1" }]));
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([]));
  fs.mkdirSync(path.join(dir, "forms"));
  const good = { name: "Student Registration", uuid: "f-good", formType: "IndividualProfile",
    formElementGroups: [{ name: "G", formElements: [{ name: "Age", concept: { name: "Age", uuid: "c-age", dataType: "Numeric" } }] }] };
  const prose = { name: "7. Custom Report Cards (9 cards with Realm queries):", uuid: "f-prose", formType: "Encounter", formElementGroups: [] };
  fs.writeFileSync(path.join(dir, "forms", "Student Registration_f-good.json"), JSON.stringify(good));
  fs.writeFileSync(path.join(dir, "forms", "prose_f-prose.json"), JSON.stringify(prose));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify([
    { uuid: "m-good", formUUID: "f-good", formName: "Student Registration", formType: "IndividualProfile", subjectTypeUUID: "s-1" },
    { uuid: "m-prose", formUUID: "f-prose", formName: "7. Custom Report Cards (9 cards with Realm queries):", formType: "Encounter", subjectTypeUUID: "s-1" },
  ]));
  return dir;
}

test("scrubProse prunes a prose-named form (deterministic), keeps the real form", async () => {
  const { scrubProse } = await loadScrub();
  const dir = tmpBundle();
  const r = await scrubProse(dir, { ai: false });
  const prunedNames = r.pruned.map((p) => p.name);
  assert.ok(prunedNames.includes("7. Custom Report Cards (9 cards with Realm queries):"),
    `prose form should be pruned; got ${JSON.stringify(prunedNames)}`);
  assert.ok(!fs.existsSync(path.join(dir, "forms", "prose_f-prose.json")), "prose form file removed");
  assert.ok(fs.existsSync(path.join(dir, "forms", "Student Registration_f-good.json")), "real form kept");
  const maps = JSON.parse(fs.readFileSync(path.join(dir, "formMappings.json"), "utf8")).map((m) => m.formName);
  assert.ok(!maps.includes("7. Custom Report Cards (9 cards with Realm queries):"), "prose form mapping cascade-removed");
  assert.ok(maps.includes("Student Registration"), "real form mapping kept");
});
