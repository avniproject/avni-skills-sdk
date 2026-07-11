"use strict";
// Tests for the C5 genericity guard's coverage of the CRL engine (MAJ-10):
// src/crl/** (recursive) + skills/avni-bundle-spec/reference/*.yaml (glob), so
// new CRL engine files and hand-authored reference docs are scanned for org
// names automatically.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const guard = require("./genericity-guard.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

test("guard exposes ENGINE_DIRS (src/crl) + ENGINE_GLOBS (reference *.yaml) (MAJ-10)", () => {
  assert.ok(Array.isArray(guard.ENGINE_DIRS) && guard.ENGINE_DIRS.includes("src/crl"), "src/crl in ENGINE_DIRS");
  assert.ok(Array.isArray(guard.ENGINE_GLOBS), "ENGINE_GLOBS present");
  assert.ok(guard.ENGINE_GLOBS.some((g) => g.dir === "skills/avni-bundle-spec/reference" && g.ext === ".yaml"), "reference *.yaml glob present");
});

test("collectEngineFiles covers the new CRL engine files + reference yaml", () => {
  const files = guard.collectEngineFiles(REPO_ROOT).map((f) => path.relative(REPO_ROOT, f));
  for (const expected of [
    "src/crl/compliance-doc.js",
    "src/crl/deterministic-checker.js",
    "skills/avni-bundle-spec/reference/compliance-doc.yaml",
    "skills/avni-bundle-spec/reference/spec-template.yaml",
    "skills/avni-bundle-spec/reference/spec-format.yaml",
  ]) {
    assert.ok(files.includes(expected), `expected ${expected} in engine scan set, got: ${files.join(", ")}`);
  }
});

test("the real repo passes the genericity guard (spec-format.yaml de-leaked, src/crl org-free)", () => {
  const r = guard.runGenericityGuard(REPO_ROOT);
  assert.equal(r.pass, true, `violations: ${JSON.stringify(r.violations)}`);
});

test("the recursive src/crl scan actually detects a planted org name (coverage is real, not cosmetic)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gg-"));
  fs.mkdirSync(path.join(root, "src", "crl"), { recursive: true });
  const org = require("../manifest.cjs").manifest()[0].org; // a real manifest org name
  fs.writeFileSync(path.join(root, "src", "crl", "evil.js"), `// leaks ${org}\n`);
  const r = guard.runGenericityGuard(root);
  assert.equal(r.pass, false);
  assert.ok(r.violations.some((v) => v.file === path.join("src", "crl", "evil.js") && v.org === org));
});
