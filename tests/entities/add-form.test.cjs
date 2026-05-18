// add-form workflow tests. Synthetic bundles only.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "..", "scripts", "workflows", "add-form.mjs");

function tmpBundle({ concepts = [], subjectTypes = [], formMappings = [] } = {}) {
  const dir = path.join(os.tmpdir(), "add-form-test-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify(concepts));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify(subjectTypes));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify(formMappings));
  return dir;
}
function run(dir, spec, ...args) {
  const specPath = path.join(dir, "spec.json");
  fs.writeFileSync(specPath, JSON.stringify(spec));
  try {
    const out = execFileSync("node", [CLI, "--spec", specPath, ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out);
  } catch (e) {
    // Non-zero exit → still try to parse stdout, otherwise throw
    if (e.stdout) try { return JSON.parse(e.stdout); } catch {}
    throw e;
  }
}

const ST_UUID = "11111111-1111-1111-1111-111111111111";

test("adds a new form with new concepts, atomic file writes", () => {
  const dir = tmpBundle({
    subjectTypes: [{ name: "Cohort", uuid: ST_UUID }],
    concepts: [],
  });
  const r = run(dir, {
    name: "Volunteer Registration",
    formType: "IndividualProfile",
    subjectTypeName: "Cohort",
    formElements: [
      { name: "Volunteer Name", conceptName: "Name", dataType: "Text", mandatory: true },
      { name: "Age",            conceptName: "Age",  dataType: "Numeric", mandatory: true },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.newConcepts.length, 2);
  // Form file written
  const formsList = fs.readdirSync(path.join(dir, "forms"));
  assert.equal(formsList.length, 1);
  assert.match(formsList[0], /^Volunteer Registration_/);
  // Form JSON sane shape
  const f = JSON.parse(fs.readFileSync(path.join(dir, "forms", formsList[0]), "utf8"));
  assert.equal(f.name, "Volunteer Registration");
  assert.equal(f.formType, "IndividualProfile");
  assert.equal(f.formElementGroups[0].formElements.length, 2);
  // concepts.json updated
  const c = JSON.parse(fs.readFileSync(path.join(dir, "concepts.json"), "utf8"));
  assert.equal(c.length, 2);
  // formMappings.json updated
  const fm = JSON.parse(fs.readFileSync(path.join(dir, "formMappings.json"), "utf8"));
  assert.equal(fm.length, 1);
  assert.equal(fm[0].subjectTypeUUID, ST_UUID);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("REUSES existing concept by case-insensitive name match — no duplicates", () => {
  const EXISTING = "22222222-2222-2222-2222-222222222222";
  const dir = tmpBundle({
    subjectTypes: [{ name: "Subject", uuid: ST_UUID }],
    concepts: [{ name: "Name", uuid: EXISTING, dataType: "Text", active: true }],
  });
  const r = run(dir, {
    name: "F1",
    formType: "IndividualProfile",
    subjectTypeName: "Subject",
    formElements: [
      // Case-different conceptName ("name") — must match existing "Name"
      { name: "Their name", conceptName: "name", dataType: "Text", mandatory: true },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.newConcepts.length, 0);
  assert.equal(r.reusedConcepts.length, 1);
  // No duplicate concept added
  const c = JSON.parse(fs.readFileSync(path.join(dir, "concepts.json"), "utf8"));
  assert.equal(c.length, 1, "concepts.json must still have exactly 1 concept");
  // The form's inline concept ref must point at the EXISTING UUID
  const formFile = fs.readdirSync(path.join(dir, "forms"))[0];
  const f = JSON.parse(fs.readFileSync(path.join(dir, "forms", formFile), "utf8"));
  assert.equal(f.formElementGroups[0].formElements[0].concept.uuid, EXISTING);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Coded element with answers creates answer concepts + reuses Yes/No when present", () => {
  const YES = "00000000-0000-0000-0000-00000000aaaa";
  const NO  = "00000000-0000-0000-0000-00000000bbbb";
  const dir = tmpBundle({
    subjectTypes: [{ name: "S", uuid: ST_UUID }],
    concepts: [
      { name: "Yes", uuid: YES, dataType: "NA", active: true },
      { name: "No",  uuid: NO,  dataType: "NA", active: true },
    ],
  });
  const r = run(dir, {
    name: "F",
    formType: "IndividualProfile",
    subjectTypeName: "S",
    formElements: [
      { name: "Active?", conceptName: "Is Active", dataType: "Coded",
        type: "SingleSelect", answers: ["Yes", "No"], mandatory: false },
    ],
  });
  assert.equal(r.ok, true);
  // The field concept "Is Active" is new
  assert.equal(r.newConcepts.length, 1);
  // The answer concepts Yes / No were REUSED
  assert.equal(r.newAnswerConcepts.length, 0);
  assert.equal(r.reusedConcepts.length, 0);
  // The new "Is Active" concept references existing Yes / No UUIDs
  const c = JSON.parse(fs.readFileSync(path.join(dir, "concepts.json"), "utf8"));
  const active = c.find((x) => x.name === "Is Active");
  assert.ok(active, "Is Active concept should be added");
  assert.equal(active.answers.length, 2);
  assert.equal(active.answers[0].uuid, YES);
  assert.equal(active.answers[1].uuid, NO);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--dry-run does not write any files", () => {
  const dir = tmpBundle({
    subjectTypes: [{ name: "S", uuid: ST_UUID }],
    concepts: [],
  });
  const beforeForms = fs.readdirSync(path.join(dir, "forms"));
  const beforeConcepts = fs.readFileSync(path.join(dir, "concepts.json"), "utf8");
  const beforeMaps = fs.readFileSync(path.join(dir, "formMappings.json"), "utf8");
  const r = run(dir, {
    name: "F", formType: "IndividualProfile", subjectTypeName: "S",
    formElements: [{ name: "X", conceptName: "X", dataType: "Text" }],
  }, "--dry-run");
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  // No files written
  assert.deepEqual(fs.readdirSync(path.join(dir, "forms")), beforeForms);
  assert.equal(fs.readFileSync(path.join(dir, "concepts.json"), "utf8"), beforeConcepts);
  assert.equal(fs.readFileSync(path.join(dir, "formMappings.json"), "utf8"), beforeMaps);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects duplicate form name", () => {
  const dir = tmpBundle({ subjectTypes: [{ name: "S", uuid: ST_UUID }] });
  fs.writeFileSync(path.join(dir, "forms", "Existing.json"), JSON.stringify({ name: "Existing", uuid: "xxx" }));
  const r = run(dir, {
    name: "Existing", formType: "IndividualProfile", subjectTypeName: "S",
    formElements: [{ name: "X", conceptName: "X", dataType: "Text" }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("already exists")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects missing subjectType", () => {
  const dir = tmpBundle({ subjectTypes: [{ name: "OtherSubject", uuid: ST_UUID }] });
  const r = run(dir, {
    name: "F", formType: "IndividualProfile", subjectTypeName: "MissingOne",
    formElements: [{ name: "X", conceptName: "X", dataType: "Text" }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes("subjectType"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects dataType mismatch with existing concept", () => {
  const EXISTING = "22222222-2222-2222-2222-222222222222";
  const dir = tmpBundle({
    subjectTypes: [{ name: "S", uuid: ST_UUID }],
    concepts: [{ name: "Age", uuid: EXISTING, dataType: "Numeric" }],
  });
  const r = run(dir, {
    name: "F", formType: "IndividualProfile", subjectTypeName: "S",
    formElements: [{ name: "Age", conceptName: "Age", dataType: "Text" }], // mismatch
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes("dataType"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("formElement.type is always SingleSelect (F8 regression)", () => {
  // The AVNI bundle validator rejects any formElement.type other than
  // SingleSelect / MultiSelect (validator code F8). This locks the default.
  const dir = tmpBundle({ subjectTypes: [{ name: "S", uuid: ST_UUID }] });
  const r = run(dir, {
    name: "F", formType: "IndividualProfile", subjectTypeName: "S",
    formElements: [
      // Caller can pass "SingleLineText" — the workflow should override
      { name: "Name", conceptName: "Name", dataType: "Text", type: "SingleLineText" },
      { name: "Age",  conceptName: "Age",  dataType: "Numeric" }, // no type → defaults to SingleSelect
    ],
  });
  assert.equal(r.ok, true);
  const formFile = fs.readdirSync(path.join(dir, "forms"))[0];
  const f = JSON.parse(fs.readFileSync(path.join(dir, "forms", formFile), "utf8"));
  for (const fe of f.formElementGroups[0].formElements) {
    assert.ok(["SingleSelect", "MultiSelect"].includes(fe.type), `formElement.type must be SingleSelect/MultiSelect; got "${fe.type}"`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("MultiSelect type is honored when explicitly requested", () => {
  const dir = tmpBundle({ subjectTypes: [{ name: "S", uuid: ST_UUID }] });
  const r = run(dir, {
    name: "F", formType: "IndividualProfile", subjectTypeName: "S",
    formElements: [
      { name: "Multi tags", conceptName: "Tags", dataType: "Coded", type: "MultiSelect", answers: ["A", "B"] },
    ],
  });
  assert.equal(r.ok, true);
  const formFile = fs.readdirSync(path.join(dir, "forms"))[0];
  const f = JSON.parse(fs.readFileSync(path.join(dir, "forms", formFile), "utf8"));
  assert.equal(f.formElementGroups[0].formElements[0].type, "MultiSelect");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("v1 rejects ProgramEncounter formType", () => {
  const dir = tmpBundle({ subjectTypes: [{ name: "S", uuid: ST_UUID }] });
  const r = run(dir, {
    name: "F", formType: "ProgramEncounter", subjectTypeName: "S",
    formElements: [{ name: "X", conceptName: "X", dataType: "Text" }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes("v1") || r.errors[0].includes("IndividualProfile"));
  fs.rmSync(dir, { recursive: true, force: true });
});
