"use strict";

// Live Spec View — Phase 3 (Spec-sync step). Contract §2.3 (syncSpecView).
// Task 1 (below) unit-tests syncSpecView directly (pure filesystem + emit — no
// sessions.js, no git). Task 2 (appended lower) exercises the
// commitWorkspaceChanges wiring (git commit + gate ownership).
//
// Synthesis M9 — hermetic against the AI/cost path even when this file is run
// directly (not just via `npm run test:entities`, which already wires
// SDK_CRL_GATE=off SDK_SPEC_VIEW=off itself). Deleting the key here means
// reviewSpec's AI pass clean-skips (CRIT-1) inside runSpecGateSafely regardless
// of which gate flags are set, protecting BOTH halves of this file.
delete process.env.ANTHROPIC_API_KEY;

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

async function loadSync() { return import("../../src/spec-view/sync.js?t=" + Date.now()); }

test("syncSpecView: first call on a fresh bundle writes both files, reports changed:true for both", async () => {
  const { syncSpecView } = await loadSync();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-fresh-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([
    { name: "Individual", uuid: crypto.randomUUID(), active: true, type: "Person", voided: false },
  ], null, 2));
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");

  const result = syncSpecView(dir, { org: "FreshOrg" });

  assert.equal(result.specChanged, true);
  assert.equal(result.identityChanged, true);
  assert.equal(result.specRelPath, "spec.yaml");
  assert.equal(result.identityRelPath, "identity-map.yaml");
  assert.equal(result.error, undefined);

  assert.ok(fs.existsSync(path.join(dir, "spec.yaml")), "spec.yaml must be written to the bundle root");
  assert.ok(fs.existsSync(path.join(dir, "identity-map.yaml")), "identity-map.yaml must be written to the bundle root");
  assert.match(fs.readFileSync(path.join(dir, "spec.yaml"), "utf8"), /Individual/, "the emitted spec must name the subject type");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("syncSpecView: a second call with NO bundle change is a true no-op (byte-identical re-emit)", async () => {
  const { syncSpecView } = await loadSync();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-noop-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([
    { name: "Individual", uuid: crypto.randomUUID(), active: true, type: "Person", voided: false },
  ], null, 2));
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");

  syncSpecView(dir, { org: "NoOpOrg" });
  const specAfterFirst = fs.readFileSync(path.join(dir, "spec.yaml"), "utf8");
  const identityAfterFirst = fs.readFileSync(path.join(dir, "identity-map.yaml"), "utf8");

  const second = syncSpecView(dir, { org: "NoOpOrg" });
  assert.equal(second.specChanged, false, "re-emitting an UNCHANGED bundle must not report a spec change");
  assert.equal(second.identityChanged, false, "re-emitting an UNCHANGED bundle must not report an identity-map change");
  assert.equal(fs.readFileSync(path.join(dir, "spec.yaml"), "utf8"), specAfterFirst, "spec.yaml must be byte-identical across a no-op re-emit");
  assert.equal(fs.readFileSync(path.join(dir, "identity-map.yaml"), "utf8"), identityAfterFirst, "identity-map.yaml must be byte-identical across a no-op re-emit");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("syncSpecView: a real bundle edit between two calls is detected as changed:true", async () => {
  const { syncSpecView } = await loadSync();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-change-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([
    { name: "Individual", uuid: crypto.randomUUID(), active: true, type: "Person", voided: false },
  ], null, 2));
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");
  syncSpecView(dir, { org: "ChangeOrg" });

  const subjectTypes = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8"));
  subjectTypes.push({ name: "Household", uuid: crypto.randomUUID(), active: true, type: "Household", voided: false });
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify(subjectTypes, null, 2));

  const result = syncSpecView(dir, { org: "ChangeOrg" });
  assert.equal(result.specChanged, true, "adding a subject type must change the derived spec");
  assert.match(fs.readFileSync(path.join(dir, "spec.yaml"), "utf8"), /Household/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("syncSpecView: a single corrupt bundle file degrades to a THIN emit — swallowed per-file, not a hard error (synthesis M8 — readRichBundleFileMap's per-file JSON.parse is wrapped, contract §2.1)", async () => {
  const { syncSpecView } = await loadSync();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-file-corrupt-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), "{ not valid json");
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");

  const result = syncSpecView(dir, { org: "PartialOrg" });

  assert.equal(result.error, undefined, "a single corrupt file must NOT surface as a top-level sync error — readRichBundleFileMap swallows per-file parse failures");
  assert.equal(result.specChanged, true, "a fresh (even partial/thin) emit is still a real, written change");
  assert.ok(fs.existsSync(path.join(dir, "spec.yaml")), "a thin spec.yaml must still be written despite the corrupt file");
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "spec.yaml"), "utf8"), /Individual/, "the corrupt subjectTypes.json family must be silently omitted (thin emit), not fabricated from stale/partial parse state");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("syncSpecView: a genuine infra-level failure degrades to {specChanged:false, identityChanged:false, error}, and leaves NO partial file on disk (synthesis M8 — the case per-file swallowing does NOT cover)", async () => {
  const { syncSpecView } = await loadSync();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-infra-broken-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([
    { name: "Individual", uuid: crypto.randomUUID(), active: true, type: "Person", voided: false },
  ], null, 2));
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");

  // Inject a GENUINE infra-level throw distinct from the per-file JSON swallow
  // above. The plan's original suggestion (a broken AVNI_SKILLS_PATH so the
  // brain `entitiesToSpec` require throws) is DEFEATED by the process-level
  // module cache in emit.js/identity-map.js (`_entitiesToSpec`/`_yaml`): once
  // ANY prior test in this process performs a successful emit, the brain is
  // cached and a later broken path no longer re-resolves — verified empirically.
  // Instead, make the `forms` entry a FILE rather than a directory: emitRichSpec
  // calls readRichBundleFileMap FIRST, whose `fs.readdirSync(formsDir)` is NOT
  // inside the per-file try/catch, so it throws ENOTDIR unconditionally,
  // cache-independent and order-independent — reaching syncSpecView's own
  // try/catch exactly as a genuine infra failure would, BEFORE any file write.
  fs.writeFileSync(path.join(dir, "forms"), "not a directory");

  const result = syncSpecView(dir, { org: "InfraBrokenOrg" });

  assert.equal(result.specChanged, false);
  assert.equal(result.identityChanged, false);
  assert.equal(typeof result.error, "string");
  assert.equal(fs.existsSync(path.join(dir, "spec.yaml")), false, "a genuine infra failure must not leave a partial spec.yaml on disk");
  assert.equal(fs.existsSync(path.join(dir, "identity-map.yaml")), false, "a genuine infra failure must not leave a partial identity-map.yaml on disk either");

  fs.rmSync(dir, { recursive: true, force: true });
});
