// find-references CLI: scans every bundle JSON for occurrences of a UUID
// or name. Used by the rename workflow to know the full blast radius.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "..", "scripts", "agent-tools", "find-references.mjs");

function tmpBundle() {
  const dir = path.join(os.tmpdir(), "find-refs-test-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  return dir;
}
function run(dir, ...args) {
  return JSON.parse(execFileSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

const UUID = "11111111-2222-3333-4444-555555555555";

test("finds UUID across concepts.json + forms + rule body", () => {
  const dir = tmpBundle();
  // 1. concepts.json — concept's own uuid
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "Age", uuid: UUID, dataType: "Numeric" },
  ]));
  // 2. forms/X.json — formElement.concept.uuid
  fs.writeFileSync(path.join(dir, "forms/X.json"), JSON.stringify({
    name: "X", uuid: "aaa", formElementGroups: [{
      formElements: [{ name: "age field", concept: { name: "Age", uuid: UUID } }],
    }],
  }));
  // 3. forms/Y.json — UUID embedded in a rule body string
  fs.writeFileSync(path.join(dir, "forms/Y.json"), JSON.stringify({
    name: "Y", uuid: "bbb",
    validationRule: `"use strict"; ({params, imports}) => { if (params.entity.getObservationValue("${UUID}") < 0) {/* ... */} return []; };`,
  }));
  // 4. formMappings.json — also references the same UUID
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify([
    { uuid: "fm1", formUUID: "aaa", subjectTypeUUID: UUID },
  ]));

  const r = run(dir, "--uuid", UUID);
  // 4 distinct files referenced
  assert.equal(r.filesAffected, 4);
  // All four file names present
  const files = Object.keys(r.byFile).sort();
  assert.deepEqual(files, ["concepts.json", "formMappings.json", "forms/X.json", "forms/Y.json"]);
  // The rule-body hit is captured as a string-contains, not a strong field match
  const y = r.byFile["forms/Y.json"];
  assert.ok(y.some((ref) => ref.kind === "string-contains"));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("--name mode flags exact name-field hits", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "Other", uuid: "11111111-1111-1111-1111-111111111111", dataType: "NA" },
    { name: "Religion", uuid: "22222222-2222-2222-2222-222222222222", dataType: "Coded",
      answers: [{ name: "Other", uuid: "11111111-1111-1111-1111-111111111111" }] },
  ]));
  const r = run(dir, "--name", "Other");
  // Both the standalone Other and the answer "Other" should be found
  assert.ok(r.totalReferences >= 2);
  const strong = r.references.filter((x) => x.kind === "name-field-exact");
  assert.ok(strong.length >= 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("missing target produces empty result, not error", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([{ name: "X", uuid: "aaa" }]));
  const r = run(dir, "--uuid", "00000000-0000-0000-0000-000000000000");
  assert.equal(r.totalReferences, 0);
  assert.equal(r.filesAffected, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI errors on missing --uuid / --name", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");
  assert.throws(() => {
    execFileSync("node", [CLI], { cwd: dir, stdio: "pipe" });
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
