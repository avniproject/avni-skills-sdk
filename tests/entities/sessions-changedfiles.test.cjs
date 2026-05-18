// Regression: the porcelain parser in commitWorkspaceChanges must handle
// filenames with spaces correctly. The previous parser used
// `git status --porcelain` + `.trim()` + `.slice(3)` which (a) over-stripped
// when `.trim()` ate the leading space of " M filename" and (b) included
// leading/trailing quotes around space-containing paths because porcelain v1
// double-quotes them. Fix: use `-z` and split on NUL. This test mirrors that
// logic and locks the contract.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// The parser used by commitWorkspaceChanges. Kept in sync with src/sessions.js.
// Inputs: NUL-separated `git status -z --porcelain` output.
function parseChangedFiles(status) {
  if (!status) return [];
  return status.split("\0").filter((e) => e.length >= 4).map((e) => e.slice(3));
}

function tmpRepo() {
  const dir = path.join(os.tmpdir(), "avni-sdk-changedfiles-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@x");
  git(dir, "config", "user.name", "test");
  return dir;
}

test("parses unquoted filenames after slice(3)", () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, "a.json"), "{}");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  fs.writeFileSync(path.join(dir, "a.json"), '{"x":1}');
  const out = git(dir, "status", "-z", "--porcelain");
  assert.deepEqual(parseChangedFiles(out), ["a.json"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parses filenames with spaces — NO leading/trailing quote, NO truncation", () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, "forms"));
  fs.writeFileSync(path.join(dir, "forms/Has Space.json"), "{}");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  fs.writeFileSync(path.join(dir, "forms/Has Space.json"), '{"x":1}');
  const out = git(dir, "status", "-z", "--porcelain");
  assert.deepEqual(parseChangedFiles(out), ["forms/Has Space.json"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("multiple changes in one porcelain output, mixed quoting", () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, "forms"));
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");
  fs.writeFileSync(path.join(dir, "forms/Plain.json"), "{}");
  fs.writeFileSync(path.join(dir, "forms/Has Space.json"), "{}");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  fs.writeFileSync(path.join(dir, "concepts.json"), '["x"]');
  fs.writeFileSync(path.join(dir, "forms/Plain.json"), '{"a":1}');
  fs.writeFileSync(path.join(dir, "forms/Has Space.json"), '{"a":1}');
  const out = git(dir, "status", "-z", "--porcelain");
  const changed = parseChangedFiles(out).sort();
  assert.deepEqual(changed, [
    "concepts.json",
    "forms/Has Space.json",
    "forms/Plain.json",
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("untracked file (status ?? prefix) parsed correctly", () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, "init.json"), "{}");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  fs.writeFileSync(path.join(dir, "new file.json"), "{}");
  const out = git(dir, "status", "-z", "--porcelain");
  assert.deepEqual(parseChangedFiles(out), ["new file.json"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("empty output → empty array", () => {
  assert.deepEqual(parseChangedFiles(""), []);
  assert.deepEqual(parseChangedFiles("\0"), []);
});

test("OLD-BUG REGRESSION: `.trim()` + slice(3) over-stripped the leading 'f'", () => {
  // This is what the broken parser produced (documented for posterity):
  //   raw porcelain  ─ "<space>M<space>forms/Draft.json"
  //   after .trim()  ─ "M<space>forms/Draft.json"
  //   after slice(3) ─ "orms/Draft.json"   ← 'f' missing!
  // The new parser must produce "forms/Draft.json".
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, "forms"));
  fs.writeFileSync(path.join(dir, "forms/Draft.json"), "{}");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  fs.writeFileSync(path.join(dir, "forms/Draft.json"), '{"x":1}');
  const out = git(dir, "status", "-z", "--porcelain");
  const changed = parseChangedFiles(out);
  assert.deepEqual(changed, ["forms/Draft.json"]);
  // Specifically: first char is 'f', not 'o'
  assert.equal(changed[0][0], "f");
  fs.rmSync(dir, { recursive: true, force: true });
});
