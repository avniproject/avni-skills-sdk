// add-subject-type workflow tests. Synthetic bundles only.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "..", "scripts", "workflows", "add-subject-type.mjs");

function tmpBundle({ subjectTypes = [], forms = [], formMappings = [] } = {}) {
  const dir = path.join(os.tmpdir(), "add-st-test-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify(subjectTypes));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify(formMappings));
  for (const f of forms) {
    fs.writeFileSync(path.join(dir, "forms", `${f.name}_${f.uuid}.json`), JSON.stringify(f));
  }
  return dir;
}

function run(dir, args) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out);
  } catch (e) {
    if (e.stdout) try { return JSON.parse(e.stdout); } catch {}
    throw e;
  }
}

test("adds a Person subjectType with sane defaults", () => {
  const dir = tmpBundle();
  const r = run(dir, ["--name", "Volunteer"]);
  assert.equal(r.ok, true);
  assert.equal(r.subjectType.name, "Volunteer");
  assert.equal(r.subjectType.type, "Person");
  assert.equal(r.subjectType.group, false);
  assert.equal(r.subjectType.household, false);
  // File written
  const st = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8"));
  assert.equal(st.length, 1);
  assert.equal(st[0].name, "Volunteer");
  assert.equal(st[0].type, "Person");
  assert.equal(st[0].allowMiddleName, true);
  assert.equal(st[0].voided, false);
  assert.ok(st[0].uuid);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("adds a Group subjectType — group=true, household=false", () => {
  const dir = tmpBundle();
  const r = run(dir, ["--name", "Cohort", "--type", "Group"]);
  assert.equal(r.ok, true);
  assert.equal(r.subjectType.type, "Group");
  assert.equal(r.subjectType.group, true);
  assert.equal(r.subjectType.household, false);
  const st = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8"));
  assert.equal(st[0].group, true);
  assert.equal(st[0].household, false);
  assert.equal(st[0].allowMiddleName, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("adds a Household subjectType — group=true AND household=true", () => {
  const dir = tmpBundle();
  const r = run(dir, ["--name", "Household", "--type", "Household"]);
  assert.equal(r.ok, true);
  const st = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8"));
  assert.equal(st[0].group, true);
  assert.equal(st[0].household, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects duplicate name (case-insensitive)", () => {
  const dir = tmpBundle({
    subjectTypes: [{ name: "Volunteer", uuid: "abc", type: "Person" }],
  });
  const r = run(dir, ["--name", "VOLUNTEER"]);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /already exists/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects invalid --type", () => {
  const dir = tmpBundle();
  const r = run(dir, ["--name", "X", "--type", "Bogus"]);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /must be one of/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("dry-run reports the plan but writes nothing", () => {
  const dir = tmpBundle();
  const before = fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8");
  const r = run(dir, ["--name", "Worker", "--dry-run"]);
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  const after = fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8");
  assert.equal(before, after);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--bind-registration-form links the form via formMappings", () => {
  const formUuid = "form-uuid-1234";
  const dir = tmpBundle({
    forms: [{ name: "Volunteer Registration", uuid: formUuid, formType: "IndividualProfile" }],
  });
  const r = run(dir, ["--name", "Volunteer", "--bind-registration-form", "Volunteer Registration"]);
  assert.equal(r.ok, true);
  assert.equal(r.formMapping.added, true);
  assert.equal(r.formMapping.formUuid, formUuid);
  const fm = JSON.parse(fs.readFileSync(path.join(dir, "formMappings.json"), "utf8"));
  assert.equal(fm.length, 1);
  assert.equal(fm[0].formUUID, formUuid);
  assert.equal(fm[0].subjectTypeUuid, r.subjectType.uuid);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--bind-registration-form rejects missing form", () => {
  const dir = tmpBundle();
  const r = run(dir, ["--name", "X", "--bind-registration-form", "Nonexistent"]);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /no form named/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--bind-registration-form rejects non-IndividualProfile form", () => {
  const dir = tmpBundle({
    forms: [{ name: "Visit", uuid: "f1", formType: "Encounter" }],
  });
  const r = run(dir, ["--name", "X", "--bind-registration-form", "Visit"]);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /IndividualProfile/);
  fs.rmSync(dir, { recursive: true, force: true });
});
