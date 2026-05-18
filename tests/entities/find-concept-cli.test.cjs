// Locks the find-concept CLI behaviour. This is the forced-tool gate that
// prevents the Haiku rule-6 regression (adding lowercase "other" while
// "Other" already exists). If this test passes, the CLI returns the right
// guidance string; the agent's BUNDLE_HARD_RULES tells it to obey that.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "..", "scripts", "agent-tools", "find-concept.mjs");

function tmpBundle() {
  const dir = path.join(os.tmpdir(), "find-concept-test-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function run(dir, ...args) {
  const out = execFileSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out);
}

test("case-insensitive match → REUSE guidance", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "Other", uuid: "dde76252-3032-41f5-ab53-1802951574ee", dataType: "NA" },
    { name: "Female", uuid: "11111111-2222-3333-4444-555555555555", dataType: "NA" },
  ]));
  const r = run(dir, "other");
  assert.equal(r.found, true);
  assert.equal(r.matches[0].uuid, "dde76252-3032-41f5-ab53-1802951574ee");
  assert.match(r.guidance, /REUSE/);
  assert.match(r.guidance, /dde76252/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("no match → SAFE to add guidance", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "Existing", uuid: "11111111-2222-3333-4444-555555555555" },
  ]));
  const r = run(dir, "Brand New Concept");
  assert.equal(r.found, false);
  assert.match(r.guidance, /SAFE to add/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("multiple case-insensitive matches → flagged with first UUID", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "Other", uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    { name: "other", uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
    { name: "OTHER", uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
  ]));
  const r = run(dir, "Other");
  assert.equal(r.found, true);
  assert.equal(r.matchCount, 3);
  assert.match(r.guidance, /Multiple/);
  // First match's UUID called out
  assert.ok(r.guidance.includes("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("trimming + accent-fold not applied (only case-insensitive)", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "Other", uuid: "11111111-1111-1111-1111-111111111111" },
  ]));
  // Trailing whitespace IS trimmed in the lookup — important because the
  // bundle has been observed with trailing-space names (Cohort Endline ).
  const r1 = run(dir, "Other ");
  assert.equal(r1.found, true);
  // Accents are NOT folded
  const r2 = run(dir, "Óther");
  assert.equal(r2.found, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--uuid mode finds by uuid exact", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "Religion", uuid: "abcdef00-1111-2222-3333-444444444444", dataType: "Coded" },
  ]));
  const r = run(dir, "--uuid", "abcdef00-1111-2222-3333-444444444444");
  assert.equal(r.found, true);
  assert.equal(r.concept.name, "Religion");
  assert.match(r.guidance, /Reuse its UUID/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--uuid not found → safe-to-use guidance", () => {
  const dir = tmpBundle();
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([{ name: "X", uuid: "aaa" }]));
  const r = run(dir, "--uuid", "00000000-0000-0000-0000-000000000000");
  assert.equal(r.found, false);
  assert.match(r.guidance, /Safe to use/);
  fs.rmSync(dir, { recursive: true, force: true });
});
