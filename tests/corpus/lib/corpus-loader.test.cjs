"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { manifest } = require("../manifest.cjs");
const { hasInputs, loadOracle, listRunnableOrgs } = require("./corpus-loader.cjs");

// Committed corpus lives in sibling repos; self-skip corpus-dependent cases when absent.
const phulwariRow = manifest().find((r) => r.org === "phulwari");
const skipNoCorpus = !fs.existsSync(phulwariRow.oracle.dir) && "committed corpus siblings not checked out";

test("manifest distinguishes oracle-only (impl-bundles) from input+oracle (avni-ai)", () => {
  const byOrg = Object.fromEntries(manifest().map((r) => [r.org, r]));
  assert.ok(byOrg["phulwari"], "phulwari present");
  assert.equal(hasInputs(byOrg["phulwari"]), false, "impl-bundles refs are oracle-only");
  assert.ok(byOrg["Astitva"], "Astitva present");
  assert.equal(hasInputs(byOrg["Astitva"]), true, "avni-ai triads have scoping inputs");
});

test("loadOracle returns a real bundle dir for a committed oracle-only org (phulwari)", { skip: skipNoCorpus }, () => {
  const row = manifest().find((r) => r.org === "phulwari");
  const dir = loadOracle(row);
  assert.ok(
    fs.existsSync(path.join(dir, "subjectTypes.json")) || fs.existsSync(path.join(dir, "forms")),
    `expected a bundle at ${dir}`
  );
});

test("loadOracle unzips and auto-descends a single wrapper dir", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-zip-src-"));
  const inner = path.join(tmp, "wrapper", "inner");
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, "subjectTypes.json"), JSON.stringify([{ name: "Member" }]));
  const zip = path.join(tmp, "b.zip");
  execSync(`cd "${path.join(tmp, "wrapper")}" && zip -q -r "${zip}" .`, { stdio: ["ignore", "pipe", "pipe"] });
  const dir = loadOracle({ org: "syn", oracle: { zip } });
  assert.ok(fs.existsSync(path.join(dir, "subjectTypes.json")), "descended into the bundle dir");
});

test("listRunnableOrgs excludes proprietary orgs unless real=true", { skip: skipNoCorpus }, () => {
  const rows = manifest();
  const committed = listRunnableOrgs(rows, { real: false });
  assert.ok(committed.length > 0, "some committed orgs present");
  assert.ok(committed.every((r) => r.tier === "committed"), "no proprietary org without real=true");
  assert.ok(committed.some((r) => r.org === "phulwari"), "phulwari runnable");
});
