// Recovery workflow: re-inlines bare-UUID concept references on form elements.
// Triggered by a real upload-blocking incident: "fix all errors" agent turn
// flattened 148 elements across 8 forms; AVNI server rejected the upload.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "..", "scripts", "workflows", "fix-formelement-concept-shape.mjs");

function tmpBundle({ concepts = [], forms = [] } = {}) {
  const dir = path.join(os.tmpdir(), "fix-shape-test-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify(concepts));
  for (const f of forms) fs.writeFileSync(path.join(dir, "forms", `${f.name}.json`), JSON.stringify(f));
  return dir;
}
function run(dir, ...args) {
  return JSON.parse(execFileSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";

test("re-inlines a single bare-UUID concept reference", () => {
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: UUID, dataType: "Numeric", active: true }],
    forms: [{ name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "e1", concept: UUID }] }] }],
  });
  const r = run(dir);
  assert.equal(r.replacements, 1);
  assert.equal(r.unresolved, 0);
  const f = JSON.parse(fs.readFileSync(path.join(dir, "forms", "F.json"), "utf8"));
  const c = f.formElementGroups[0].formElements[0].concept;
  assert.equal(typeof c, "object");
  assert.equal(c.uuid, UUID);
  assert.equal(c.name, "Age");
  assert.equal(c.dataType, "Numeric");
  assert.ok(Array.isArray(c.media));
  assert.ok(Array.isArray(c.answers));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("preserves Coded concept's answers array when re-inlining", () => {
  const dir = tmpBundle({
    concepts: [{ name: "Religion", uuid: UUID, dataType: "Coded",
      answers: [{ name: "Hindu", uuid: UUID2, order: 0 }] }],
    forms: [{ name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "rel", concept: UUID }] }] }],
  });
  run(dir);
  const f = JSON.parse(fs.readFileSync(path.join(dir, "forms", "F.json"), "utf8"));
  const c = f.formElementGroups[0].formElements[0].concept;
  assert.equal(c.answers.length, 1);
  assert.equal(c.answers[0].uuid, UUID2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("idempotent — does nothing on already-correct bundle", () => {
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: UUID, dataType: "Numeric" }],
    forms: [{ name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [
        { name: "e1", concept: { name: "Age", uuid: UUID, dataType: "Numeric" } },
      ] }] }],
  });
  const r = run(dir);
  assert.equal(r.replacements, 0);
  assert.equal(r.filesChanged, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("reports unresolved when bare UUID doesn't match any concept", () => {
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: UUID, dataType: "Numeric" }],
    forms: [{ name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [
        { name: "ghost", concept: "GHOST-UUID-NOT-IN-CONCEPTS" },
      ] }] }],
  });
  const r = run(dir);
  assert.equal(r.replacements, 0);
  assert.equal(r.unresolved, 1);
  // The bad element is NOT modified
  const f = JSON.parse(fs.readFileSync(path.join(dir, "forms", "F.json"), "utf8"));
  assert.equal(f.formElementGroups[0].formElements[0].concept, "GHOST-UUID-NOT-IN-CONCEPTS");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--dry-run does not write", () => {
  const dir = tmpBundle({
    concepts: [{ name: "X", uuid: UUID, dataType: "Text" }],
    forms: [{ name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "e", concept: UUID }] }] }],
  });
  const before = fs.readFileSync(path.join(dir, "forms", "F.json"), "utf8");
  const r = run(dir, "--dry-run");
  assert.equal(r.dryRun, true);
  assert.equal(r.replacements, 1);
  assert.equal(fs.readFileSync(path.join(dir, "forms", "F.json"), "utf8"), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("walks ALL forms in the bundle, not just the first", () => {
  const dir = tmpBundle({
    concepts: [
      { name: "A", uuid: UUID, dataType: "Text" },
      { name: "B", uuid: UUID2, dataType: "Numeric" },
    ],
    forms: [
      { name: "F1", uuid: "ff1", formType: "IndividualProfile",
        formElementGroups: [{ formElements: [{ name: "a", concept: UUID }] }] },
      { name: "F2", uuid: "ff2", formType: "IndividualProfile",
        formElementGroups: [{ formElements: [{ name: "b", concept: UUID2 }] }] },
    ],
  });
  const r = run(dir);
  assert.equal(r.filesChanged, 2);
  assert.equal(r.replacements, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
