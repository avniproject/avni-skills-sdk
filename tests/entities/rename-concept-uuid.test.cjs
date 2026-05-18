// rename-concept-uuid workflow: atomic cross-file UUID rewrite.
// This is the workflow that closes the gap we hit in the live re-test
// today — Haiku updated concepts.json but left an orphan UUID in
// forms/Participant Details_*.json. This workflow does both in one shot.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "..", "scripts", "workflows", "rename-concept-uuid.mjs");

function tmpBundle() {
  const dir = path.join(os.tmpdir(), "rename-uuid-test-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  return dir;
}
function run(dir, ...args) {
  return JSON.parse(execFileSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

const OLD = "11111111-1111-1111-1111-111111111111";
const NEW = "22222222-2222-2222-2222-222222222222";
const FORM_UUID = "33333333-3333-3333-3333-333333333333";

test("rename across concepts + form + form mapping + rule body — atomic", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "Other", uuid: NEW, dataType: "NA" },
    { name: "Religion", uuid: "44444444-4444-4444-4444-444444444444", dataType: "Coded",
      answers: [{ name: "other", uuid: OLD }] },  // <- orphan answer ref
  ]));
  fs.writeFileSync(path.join(dir, "forms/Participant.json"), JSON.stringify({
    name: "Participant", uuid: FORM_UUID,
    formElementGroups: [{
      formElements: [{
        name: "Religion field",
        concept: { name: "Religion", uuid: "44444444-4444-4444-4444-444444444444",
                   answers: [{ name: "other", uuid: OLD }] },  // <- same orphan
      }],
    }],
    validationRule: `({params,imports}) => { const x = params.entity.getObservationValue("${OLD}"); return []; }`,
  }));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify([{ uuid: "fm1", formUUID: FORM_UUID }]));

  const r = run(dir, "--old", OLD, "--new", NEW);
  // 2 files should change (concepts.json + forms/Participant.json)
  assert.equal(r.filesChanged, 2);
  assert.ok(r.replacements >= 3, `expected ≥3 replacements; got ${r.replacements}`);

  // Verify on disk: NO occurrence of OLD anywhere
  const c = JSON.parse(fs.readFileSync(path.join(dir, "concepts.json"), "utf8"));
  const f = JSON.parse(fs.readFileSync(path.join(dir, "forms/Participant.json"), "utf8"));
  assert.equal(JSON.stringify(c).includes(OLD), false, "old UUID should not survive in concepts.json");
  assert.equal(JSON.stringify(f).includes(OLD), false, "old UUID should not survive in forms/Participant.json");
  // Religion's answer should now point to the new UUID
  assert.equal(c[1].answers[0].uuid, NEW);
  // The rule body should also be rewritten
  assert.ok(f.validationRule.includes(NEW));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("--dry-run reports without writing", () => {
  const dir = tmpBundle();
  const original = JSON.stringify([{ name: "X", uuid: OLD }]);
  fs.writeFileSync(path.join(dir, "concepts.json"), original);

  const r = run(dir, "--old", OLD, "--new", NEW, "--dry-run");
  assert.equal(r.dryRun, true);
  assert.equal(r.replacements, 1);
  // File unchanged on disk
  assert.equal(fs.readFileSync(path.join(dir, "concepts.json"), "utf8"), original);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("idempotent — second run is a no-op", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "X", uuid: OLD, dataType: "NA" },
  ]));
  run(dir, "--old", OLD, "--new", NEW);
  const r2 = run(dir, "--old", OLD, "--new", NEW);
  assert.equal(r2.replacements, 0);
  assert.equal(r2.filesChanged, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--new-name renames the (target) concept's display name", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "OldName", uuid: NEW, dataType: "NA" },
  ]));
  const r = run(dir, "--old", OLD, "--new", NEW, "--new-name", "Canonical Name");
  // No old-UUID swap happened, but the rename still counts
  assert.ok(r.replacements >= 1);
  const c = JSON.parse(fs.readFileSync(path.join(dir, "concepts.json"), "utf8"));
  assert.equal(c[0].name, "Canonical Name");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects invalid UUIDs", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");
  assert.throws(() => execFileSync("node", [CLI, "--old", "not-a-uuid", "--new", NEW], { cwd: dir, stdio: "pipe" }));
  fs.rmSync(dir, { recursive: true, force: true });
});
