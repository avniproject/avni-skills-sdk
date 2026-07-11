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

module.exports = { loadIdentityMap };
