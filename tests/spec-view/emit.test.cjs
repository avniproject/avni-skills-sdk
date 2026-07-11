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

// ─── Task 2 — buildIdentityIndex (11 kinds, C1) ─────────────────────

test("buildIdentityIndex resolves a real groupRole's subject-type UUIDs to names (phulwari)", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex } = await loadEmit();
  const idx = buildIdentityIndex(readRichBundleFileMap(loadOracle(phulwariRow)));
  assert.equal(idx.resolve("ea7e5c94-5e90-4288-803d-6a1aa9d80acd"), "Phulwari"); // subjectTypes.json
  assert.equal(idx.resolve("9f2af1f9-e150-4f8e-aad3-40bb7eb05aa3"), "Child");
});

test("buildIdentityIndex resolves reportCard/reportDashboard/identifierSource/documentation UUIDs to names", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex } = await loadEmit();
  const pIdx = buildIdentityIndex(readRichBundleFileMap(loadOracle(phulwariRow)));
  assert.equal(pIdx.resolve("6085c2f4-52e7-4b08-85b6-d6b2612b4cf5"), "Scheduled visits");   // reportCard.json
  assert.equal(pIdx.resolve("c4d3bc0a-027e-4a6a-87dd-85e5b7285523"), "Default Dashboard");  // reportDashboard.json
  if (!skipNoCommunity) {
    const cIdx = buildIdentityIndex(readRichBundleFileMap(loadOracle(communityRow)));
    assert.equal(cIdx.resolve("12e20f5c-cf7a-42e8-877e-c139c8baa938"), "JSCS sample identifier source"); // identifierSource.json
    assert.equal(cIdx.resolve("802174fe-feee-4a72-b453-388f0cb113e4"), "Don't give Sodium valproate to Epileptic women"); // documentations.json
  }
});

test("buildIdentityIndex excludes voided entities from resolution", async () => {
  const { buildIdentityIndex } = await loadEmit();
  const idx = buildIdentityIndex({
    "subjectTypes.json": [{ uuid: "u1", name: "Live", voided: false }, { uuid: "u2", name: "Dead", voided: true }],
  });
  assert.equal(idx.resolve("u1"), "Live");
  assert.equal(idx.resolve("u2"), null);
  assert.equal(idx.resolve("nope"), null);
});

test("buildIdentityIndex byKind exposes the 11 pinned singular keys (P2 KIND_TO_SECTION binds to these)", async () => {
  const { buildIdentityIndex } = await loadEmit();
  const { byKind } = buildIdentityIndex({});
  assert.deepEqual(Object.keys(byKind).sort(), [
    "addressLevelType", "concept", "documentation", "encounterType", "form",
    "group", "identifierSource", "program", "reportCard", "reportDashboard", "subjectType",
  ]);
});
