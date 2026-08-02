"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MODULE = path.resolve(__dirname, "..", "..", "src", "spec-view", "identity-map.js");
let _mod;
async function loadIdentityMap() {
  if (!_mod) _mod = await import(pathToFileURL(MODULE).href);
  return _mod;
}

test("emitIdentityMap: versioned, name+uuid per kind, voided entities excluded, sorted by name", async () => {
  const { emitIdentityMap } = await loadIdentityMap();
  const fileMap = {
    "subjectTypes.json": [
      { uuid: "11111111-1111-1111-1111-111111111111", name: "Individual", type: "Person" },
      { uuid: "22222222-2222-2222-2222-222222222222", name: "Household", type: "Household" },
    ],
    "programs.json": [
      { uuid: "33333333-3333-3333-3333-333333333333", name: "ANC", voided: false },
      { uuid: "99999999-9999-9999-9999-999999999999", name: "Retired Program (voided~1234)", voided: true },
    ],
    "encounterTypes.json": [
      { uuid: "44444444-4444-4444-4444-444444444444", name: "Birth Encounter" },
    ],
    "concepts.json": [
      { uuid: "55555555-5555-5555-5555-555555555555", name: "Age", dataType: "Numeric" },
      { uuid: "66666666-6666-6666-6666-666666666666", name: "Weight", dataType: "Numeric" },
    ],
    "forms/Registration.json": {
      uuid: "77777777-7777-7777-7777-777777777777",
      name: "Registration Form",
      formType: "IndividualProfile",
      formElementGroups: [],
    },
  };

  const { yaml, map } = emitIdentityMap({ existingBundleFiles: fileMap });

  assert.equal(map.version, 1);
  assert.deepEqual(map.subjectTypes, [
    { name: "Household", uuid: "22222222-2222-2222-2222-222222222222" },
    { name: "Individual", uuid: "11111111-1111-1111-1111-111111111111" },
  ]);
  assert.deepEqual(map.programs, [
    { name: "ANC", uuid: "33333333-3333-3333-3333-333333333333" },
  ]);
  assert.deepEqual(map.encounterTypes, [
    { name: "Birth Encounter", uuid: "44444444-4444-4444-4444-444444444444" },
  ]);
  assert.deepEqual(map.concepts, [
    { name: "Age", uuid: "55555555-5555-5555-5555-555555555555" },
    { name: "Weight", uuid: "66666666-6666-6666-6666-666666666666" },
  ]);
  assert.deepEqual(map.forms, [
    { name: "Registration Form", uuid: "77777777-7777-7777-7777-777777777777" },
  ]);
  assert.ok(
    !yaml.includes("99999999-9999-9999-9999-999999999999"),
    "voided entity must not leak a uuid<->name binding",
  );
  assert.ok(yaml.startsWith("version: 1"));
});

test("emitIdentityMap: re-emit of the same bundle is byte-identical (stable ordering, no LLM)", async () => {
  const { emitIdentityMap } = await loadIdentityMap();
  const fileMap = {
    "subjectTypes.json": [
      { uuid: "aaaa1111-0000-0000-0000-000000000001", name: "Zebra Type" },
      { uuid: "bbbb2222-0000-0000-0000-000000000002", name: "Alpha Type" },
    ],
  };
  const first = emitIdentityMap({ existingBundleFiles: fileMap });
  const second = emitIdentityMap({ existingBundleFiles: JSON.parse(JSON.stringify(fileMap)) });
  assert.equal(first.yaml, second.yaml, "re-emit must be byte-identical for an unchanged bundle");
  assert.ok(
    first.yaml.indexOf("Alpha Type") < first.yaml.indexOf("Zebra Type"),
    "rows sort by name ascending within a kind",
  );
});

test("emitIdentityMap: bundleDir input resolves via P1's readRichBundleFileMap", async () => {
  const { emitIdentityMap } = await loadIdentityMap();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "identity-map-dir-"));
  fs.writeFileSync(
    path.join(dir, "subjectTypes.json"),
    JSON.stringify([{ uuid: "cccc3333-0000-0000-0000-000000000003", name: "Beneficiary" }]),
  );
  const { map } = emitIdentityMap({ bundleDir: dir });
  assert.deepEqual(map.subjectTypes, [
    { name: "Beneficiary", uuid: "cccc3333-0000-0000-0000-000000000003" },
  ]);
});

test("emitIdentityMap: throws a clear error when neither bundleDir nor existingBundleFiles is given", async () => {
  const { emitIdentityMap } = await loadIdentityMap();
  assert.throws(() => emitIdentityMap({}), /bundleDir or existingBundleFiles/);
});

// ─── Corpus completeness: every non-voided named entity in a REAL reference
// bundle has a uuid<->name binding in the emitted identity-map. Ground truth
// is read directly from the bundle files (independent of buildIdentityIndex's
// own logic) so a bug that drops or mis-binds an entity is caught, not
// self-certified. Scope = the reconciliation synthesis's contract §2 pin
// (finding C1): the 10 non-forms families below + forms/*.json = the exact
// 11 kinds P1 Task 2 builds. This test does NOT track whatever P1 happens to
// ship — it independently re-derives truth from the bundle files themselves,
// so it still catches a regression even if P1's KIND_TO_SECTION and this
// GROUND_TRUTH_FILES list both quietly rot. ─────────────────────────────────

const { manifest } = require("../corpus/manifest.cjs");
const { listRunnableOrgs, loadOracle } = require("../corpus/lib/corpus-loader.cjs");
const { isVoided } = require("../corpus/doorstep/lib/entity-names.cjs");

const phulwariRow = manifest().find((r) => r.org === "phulwari");
const skipNoCorpus =
  !(phulwariRow && phulwariRow.oracle && fs.existsSync(phulwariRow.oracle.dir)) &&
  "committed corpus siblings not checked out";

// Families verified (by direct inspection of the reference bundles) to carry
// a real top-level uuid + human name, and pinned by the reconciliation
// synthesis's contract §2 (finding C1) as the exact 10 non-forms kinds
// buildIdentityIndex covers (plus `form`, scanned separately below via
// forms/*.json, for 11 total). Deliberately excludes join/relation rows with
// NO name of their own (groupPrivilege.json, groupDashboards.json). Every
// OTHER named family spec.yaml round-trips (groupRole, relationshipType,
// checklist, video, customQuery, messageRule, individualRelation, catchment,
// location, menuItem, ruleDependency) is OUT OF SCOPE for this phase's
// completeness guarantee — buildIdentityIndex isn't built to cover them
// (contract §2), so asserting their coverage here would just be this test
// quietly re-widening scope P1 was never asked to fill.
const GROUND_TRUTH_FILES = [
  "subjectTypes.json", "programs.json", "encounterTypes.json", "concepts.json",
  "groups.json", "addressLevelTypes.json", "identifierSource.json",
  "reportCard.json", "reportDashboard.json", "documentations.json",
];

function readJsonArray(fp) {
  if (!fs.existsSync(fp)) return [];
  try {
    const d = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (Array.isArray(d)) return d;
    if (d && typeof d === "object") return Object.values(d).find(Array.isArray) || [];
  } catch { /* malformed file: treat as empty, not a false-fail */ }
  return [];
}

function groundTruthEntities(dir) {
  const out = [];
  for (const file of GROUND_TRUTH_FILES) {
    for (const e of readJsonArray(path.join(dir, file))) {
      if (!e || isVoided(e) || !e.uuid || !e.name) continue;
      out.push({ uuid: e.uuid, name: e.name });
    }
  }
  const formsDir = path.join(dir, "forms");
  if (fs.existsSync(formsDir)) {
    for (const f of fs.readdirSync(formsDir).filter((n) => n.endsWith(".json"))) {
      const form = JSON.parse(fs.readFileSync(path.join(formsDir, f), "utf8"));
      if (form && !isVoided(form) && form.uuid && form.name) out.push({ uuid: form.uuid, name: form.name });
    }
  }
  return out;
}

test("identity-map completeness: every non-voided named entity across the committed corpus has a uuid<->name binding", { skip: skipNoCorpus }, async () => {
  const { emitIdentityMap } = await loadIdentityMap();
  const rows = listRunnableOrgs(manifest(), { real: false });
  assert.ok(rows.length >= 5, `expected >=5 committed orgs, got ${rows.length}`);

  for (const row of rows) {
    const dir = loadOracle(row);
    const truth = groundTruthEntities(dir);
    assert.ok(truth.length > 0, `${row.org}: ground-truth reader found zero entities — fixture drift?`);

    const { map } = emitIdentityMap({ bundleDir: dir });
    const flat = new Map();
    for (const [key, entries] of Object.entries(map)) {
      if (key === "version") continue;
      for (const { name, uuid } of entries) flat.set(uuid, name);
    }

    const missing = truth.filter((t) => !flat.has(t.uuid));
    assert.deepEqual(missing, [], `${row.org}: ${missing.length} non-voided entities have no identity-map binding: ${JSON.stringify(missing.slice(0, 5))}`);

    const wrongName = truth.filter((t) => flat.has(t.uuid) && flat.get(t.uuid) !== t.name);
    assert.deepEqual(wrongName, [], `${row.org}: uuid bound to the wrong name: ${JSON.stringify(wrongName.slice(0, 5))}`);
  }
});

module.exports = { loadIdentityMap };
