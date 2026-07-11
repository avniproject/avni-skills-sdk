"use strict";
// Live Spec View — P1 rich emitter tests. CJS reaches the ESM emitter via the
// dynamic-import bridge (rule §5). Deterministic / no-LLM — no ANTHROPIC_API_KEY.
delete process.env.ANTHROPIC_API_KEY; // belt: any AI pass reachable from here clean-skips
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { manifest } = require("../corpus/manifest.cjs");
const { loadOracle } = require("../corpus/lib/corpus-loader.cjs");

async function loadEmit() { return import("../../src/spec-view/emit.js?t=" + Date.now()); }

// Shared row lookups — declared ONCE here; later tasks reference these directly.
const phulwariRow = manifest().find((r) => r.org === "phulwari");
const communityRow = manifest().find((r) => r.org === "community");
const socialSecurityRow = manifest().find((r) => r.org === "social_security");
const skipNoCorpus = !fs.existsSync(phulwariRow.oracle.dir) && "committed corpus siblings not checked out";
const skipNoCommunity = !fs.existsSync(communityRow.oracle.dir) && "community oracle not checked out";
const skipNoSocialSecurity = !fs.existsSync(socialSecurityRow.oracle.dir) && "social_security oracle not checked out";

// ─── Task 1 — readRichBundleFileMap + CI wiring ─────────────────────

test("readRichBundleFileMap reads ancillary files the 13-file whitelist skips", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap } = await loadEmit();
  const dir = loadOracle(phulwariRow);
  const files = readRichBundleFileMap(dir);
  for (const f of ["reportCard.json", "identifierSource.json", "groupRole.json",
                    "catchments.json", "locations.json", "groupDashboards.json",
                    "menuItem.json", "messageRule.json", "groupPrivilege.json",
                    "organisationConfig.json", "formMappings.json"]) {
    assert.ok(f in files, `${f} missing from rich file map`);
  }
  assert.ok(Object.keys(files).some((p) => p.startsWith("forms/")), "forms/ not read");
});

test("genericity-guard scans src/spec-view (new engine surface stays org-agnostic)", async () => {
  const { runGenericityGuard } = require("../corpus/lib/genericity-guard.cjs");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const { pass, violations } = runGenericityGuard(repoRoot);
  assert.ok(pass, `genericity guard failed: ${JSON.stringify(violations)}`);
});

test("package.json test scripts include tests/spec-view and are SDK_SPEC_VIEW-safe", () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"));
  for (const key of ["test", "test:entities"]) {
    assert.match(pkgJson.scripts[key], /tests\/spec-view\/\*\.test\.cjs/, `${key} must run tests/spec-view`);
    assert.match(pkgJson.scripts[key], /SDK_SPEC_VIEW=off/, `${key} must set SDK_SPEC_VIEW=off`);
  }
});
