"use strict";

// Phase 4 Task 3 — bundle_review / bundle_scrub / spec_review MCP tools.
//
// These are DETERMINISTIC by construction here: ANTHROPIC_API_KEY is unset for
// this test process so the CRL's ai-judged pass clean-skips (CRIT-1), exactly
// as it does in CI. The tests assert STRUCTURAL invariants of the Phase-4
// wiring (the tools register; reviewOnDir is read-only; scrub carries the
// executor summary; spec_review returns a spec-kind ReviewResult) — never a
// specific pass:true/false outcome, which depends on the doc's rule set.
delete process.env.ANTHROPIC_API_KEY;

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

async function loadMcp() { return import("../../src/agents/bundle-mcp-server.js?t=" + Date.now()); }

function writeSkeleton(dir, files) {
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
}

test("createBundleMcpServer registers bundle_review + bundle_scrub + spec_review alongside the original 10", async () => {
  const { createBundleMcpServer } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-tools-srv-"));
  const server = createBundleMcpServer(dir);
  const names = Object.keys(server?.instance?._registeredTools || {});
  assert.ok(names.includes("bundle_review"), `bundle_review not registered; saw: ${names.join(", ")}`);
  assert.ok(names.includes("bundle_scrub"), `bundle_scrub not registered; saw: ${names.join(", ")}`);
  assert.ok(names.includes("spec_review"), `spec_review not registered; saw: ${names.join(", ")}`);
  for (const n of ["bundle_validator_run", "bundle_find_references", "spec_apply", "bundle_read_srs"]) {
    assert.ok(names.includes(n), `original tool ${n} missing; saw: ${names.join(", ")}`);
  }
  assert.equal(names.length, 13, `expected 13 registered tools; saw ${names.length}: ${names.join(", ")}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("reviewOnDir: returns a ReviewResult-shaped payload without mutating the bundle", async () => {
  const { reviewOnDir, buildMinimalSkeleton } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-review-"));
  writeSkeleton(dir, buildMinimalSkeleton());
  const before = fs.readFileSync(path.join(dir, "concepts.json"), "utf8");

  const res = await reviewOnDir(dir);
  assert.notEqual(res.isError, true, `reviewOnDir must not error on a clean bundle; got: ${res.content[0].text}`);
  const payload = JSON.parse(res.content[0].text);
  assert.ok("deterministic" in payload, "ReviewResult must carry the deterministic pass");
  assert.ok("ai" in payload, "ReviewResult must carry the ai-judged pass");
  assert.equal(payload.kind, "bundle");
  assert.equal(fs.readFileSync(path.join(dir, "concepts.json"), "utf8"), before, "bundle_review is READ-ONLY — it must not mutate the bundle");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("scrubOnDir: accepts an explicit confidenceThreshold and returns an executed summary", async () => {
  const { scrubOnDir, buildMinimalSkeleton } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-scrub-"));
  writeSkeleton(dir, buildMinimalSkeleton());

  const res = await scrubOnDir(dir, { confidenceThreshold: 0.95 });
  assert.notEqual(res.isError, true, `scrubOnDir must not error on a clean bundle; got: ${res.content[0].text}`);
  const payload = JSON.parse(res.content[0].text);
  assert.ok("executed" in payload, "scrub mode's ReviewResult must carry the executor's pass-3 summary");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("specReviewOnDir: returns a spec-kind ReviewResult against spec-template.yaml (O-1), read-only", async () => {
  const { specReviewOnDir, buildMinimalSkeleton } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-specreview-"));
  writeSkeleton(dir, buildMinimalSkeleton());
  const before = fs.readFileSync(path.join(dir, "concepts.json"), "utf8");

  const res = await specReviewOnDir(dir);
  assert.notEqual(res.isError, true, `specReviewOnDir must not error on a clean bundle; got: ${res.content[0].text}`);
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.kind, "spec", "spec_review must review the SPEC artifact, not the bundle");
  assert.ok("deterministic" in payload, "spec ReviewResult must carry the deterministic pass");
  assert.equal(fs.readFileSync(path.join(dir, "concepts.json"), "utf8"), before, "spec_review is READ-ONLY — it must not mutate the bundle");

  fs.rmSync(dir, { recursive: true, force: true });
});
