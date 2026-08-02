"use strict";

// Live Spec View × interrupted-turn recovery — the INTERACTION the two features
// never had a test for.
//
// They were written three weeks apart and touch the same surface in
// sessions.js, neither aware of the other:
//
//   • syncSpecView (O-2) WRITES spec.yaml + identity-map.yaml into the bundle
//     root on every mutating turn, then commits them with a HARDCODED scoped
//     add: git add spec.yaml identity-map.yaml.
//   • uncommittedChanges(id) (interrupted-turn recovery) reports `git status
//     --porcelain` on that same bundle dir, and the REPL banner leads with its
//     output as "⚠ N uncommitted files from a turn that never finished".
//
// So any derived file syncSpecView writes but does NOT commit — a third
// artifact added later, a rename, a partial write — makes every healthy session
// permanently report phantom stranded work, and the banner's loudest warning
// starts crying wolf on turn 1. Nothing caught that, because the spec-view
// tests assert on git log and the recovery tests never enable spec view.
//
// These tests pin the seam: after a mutating turn the tree must be CLEAN, the
// derived files must be in HEAD (not merely on disk), and a GENUINE stray edit
// must still be reported.
//
// Hermetic, org-agnostic (rule §1): synthetic skeleton, no real org, no key.

delete process.env.ANTHROPIC_API_KEY;

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "spec-uncommitted-"));
process.env.SDK_SESSIONS_DIR = SESSIONS_ROOT;

async function loadSessions() { return import("../../src/sessions.js?t=" + Date.now()); }
async function loadServer() { return import("../../src/agents/bundle-mcp-server.js?t=" + Date.now()); }

function writeSkeleton(bundleDir, files) {
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(bundleDir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
}

function filesInHead(bundleDir) {
  return execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: bundleDir, encoding: "utf8" })
    .split("\n").filter(Boolean);
}

// Run `fn` with SDK_SPEC_VIEW forced to `specView` ("on" | "off" | undefined to
// DELETE it and exercise the ambient production default), SDK_CRL_GATE off.
// Both saved + restored — package.json pins SDK_SPEC_VIEW=off for the suite, so
// neither the flag nor its absence can be assumed.
async function withEnv(specView, fn) {
  const prevSpecView = process.env.SDK_SPEC_VIEW;
  const prevCrlGate = process.env.SDK_CRL_GATE;
  if (specView === undefined) delete process.env.SDK_SPEC_VIEW;
  else process.env.SDK_SPEC_VIEW = specView;
  process.env.SDK_CRL_GATE = "off";
  try {
    return await fn();
  } finally {
    if (prevSpecView === undefined) delete process.env.SDK_SPEC_VIEW; else process.env.SDK_SPEC_VIEW = prevSpecView;
    if (prevCrlGate === undefined) delete process.env.SDK_CRL_GATE; else process.env.SDK_CRL_GATE = prevCrlGate;
  }
}

test("spec-view ON: a mutating turn leaves NO uncommitted files — the derived spec must not read as stranded work", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "SpecUncommitted", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  writeSkeleton(bundleDir, buildMinimalSkeleton());

  const res = await withEnv("on", () =>
    sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton"));

  // Guard: if the sync didn't actually run, the rest asserts nothing.
  assert.equal(res.specSync.specChanged, true, "precondition — the spec sync must have run and changed the spec");

  const stranded = sessions.uncommittedChanges(created.sessionId);
  assert.deepEqual(stranded, [],
    `a completed spec-view turn must leave a CLEAN tree; uncommittedChanges reported: ${JSON.stringify(stranded)}. ` +
    `Anything here is surfaced to the operator as "work stranded by a turn that never finished".`);

  // On disk is not enough — the banner only goes quiet if they are in HEAD.
  const head = filesInHead(bundleDir);
  assert.ok(head.includes("spec.yaml"), `spec.yaml must be committed, not just written; HEAD holds: ${head.join(", ")}`);
  assert.ok(head.includes("identity-map.yaml"), `identity-map.yaml must be committed, not just written; HEAD holds: ${head.join(", ")}`);

  sessions.deleteSession(created.sessionId);
});

test("spec-view at its PRODUCTION default (SDK_SPEC_VIEW unset): sync runs AND the tree is still clean", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "SpecDefault", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  writeSkeleton(bundleDir, buildMinimalSkeleton());

  // Every other spec-view test sets the flag EXPLICITLY, so the config production
  // actually runs (unset → `!== "off"` → on) was never exercised.
  const res = await withEnv(undefined, () =>
    sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton"));

  assert.notEqual(res.specSync.disabled, true, "with SDK_SPEC_VIEW unset the spec sync must RUN — the default is on");
  assert.equal(res.specSync.specChanged, true, "the default-on sync must emit a spec on a fresh mutating turn");

  const stranded = sessions.uncommittedChanges(created.sessionId);
  assert.deepEqual(stranded, [],
    `default-on spec view must not strand files; uncommittedChanges reported: ${JSON.stringify(stranded)}`);

  sessions.deleteSession(created.sessionId);
});

test("spec-view ON does not blind the stranded-work report — a genuine post-turn edit is still surfaced", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "SpecStranded", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  writeSkeleton(bundleDir, buildMinimalSkeleton());

  await withEnv("on", () => sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton"));
  assert.deepEqual(sessions.uncommittedChanges(created.sessionId), [], "precondition — clean after the turn");

  // Simulate the real failure mode: an agent edit that the process died before
  // committing. The .spec follow-up commit must not have swept it up, and the
  // report must still name it.
  const concepts = JSON.parse(fs.readFileSync(path.join(bundleDir, "concepts.json"), "utf8"));
  concepts.push({ name: "Half Finished Edit", uuid: "11111111-2222-3333-4444-555555555555", dataType: "Text", voided: false });
  fs.writeFileSync(path.join(bundleDir, "concepts.json"), JSON.stringify(concepts, null, 2));

  const stranded = sessions.uncommittedChanges(created.sessionId);
  assert.deepEqual(stranded, ["concepts.json"],
    `an uncommitted post-turn edit must still be reported with spec view on; got: ${JSON.stringify(stranded)}`);

  sessions.deleteSession(created.sessionId);
});
