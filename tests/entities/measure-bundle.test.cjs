"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs"); const os = require("node:os");
async function load() { return import(pathToFileURL(path.resolve(__dirname, "../../scripts/measure-bundle.mjs")).href); }
function cleanBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meas-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([{ name: "Child", uuid: "s1" }]));
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([]));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify([{ formName: "Registration", formType: "IndividualProfile", formUUID: "f1", subjectTypeUUID: "s1" }]));
  fs.mkdirSync(path.join(dir, "forms"));
  fs.writeFileSync(path.join(dir, "forms", "Registration_f1.json"), JSON.stringify({ name: "Registration", uuid: "f1", formType: "IndividualProfile", formElementGroups: [{ name: "G", formElements: [{ name: "Age", concept: { name: "Age", uuid: "c1", dataType: "Numeric" } }] }] }));
  return dir;
}
test("measure returns a scorecard with floorGreen for a clean bundle (no UAT)", async () => {
  const { measure } = await load();
  const sc = await measure(cleanBundle());
  assert.equal(sc.completeness.green, true, JSON.stringify(sc.completeness));
  assert.equal(sc.prose.clean, true);
  assert.equal(sc.parity, null, "no UAT → parity null");
  assert.equal(typeof sc.floorGreen, "boolean");
});
