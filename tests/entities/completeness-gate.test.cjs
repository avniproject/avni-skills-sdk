// PHASE 3 — THE COMPLETENESS FLOOR (agent floor-gate).
//
// Closes the "production-ready 🎉 while half-built" hole: a bundle can be
// validator-clean + integrity-clean + CRL-passed yet be semantically half-built
// (requirement prose leaked in as an entity, no forms, stub content forms). The
// deterministic completeness floor is folded into the per-turn injected preamble
// (currentValidatorStateText), so the agent sees it every turn and the "bundle
// is clean" shortcut cannot fire while it is red. Like the integrity fold, it
// surfaces + iterates; it does not hard-revert.
//
// Synthetic fixtures only (CLAUDE.md §1) — no real org data.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

// Isolate sessions on disk BEFORE importing sessions.js (reads SDK_SESSIONS_DIR
// at module load). Cache-busted dynamic import re-reads it.
const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "compl-sessions-"));
process.env.SDK_SESSIONS_DIR = SESSIONS_ROOT;

async function loadServer() { return import("../../src/agents/bundle-mcp-server.js?t=" + Date.now()); }
async function loadSessions() { return import("../../src/sessions.js?t=" + Date.now()); }

// Author buildMinimalSkeleton (+ optional mutate) into a session's bundle dir,
// commit the turn, reset the preamble cache, and return the injected preamble.
async function preambleFor(mutate, orgName) {
  const sessions = await loadSessions();
  const created = sessions.createSession({ mode: "agent", org: orgName, srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  const files = (await loadServer()).buildMinimalSkeleton();
  if (mutate) mutate(files);
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(bundleDir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
  await sessions.commitWorkspaceChanges(created.sessionId, "author bundle");
  sessions._resetValidatorCache();
  const text = sessions.currentValidatorStateText(created.sessionId);
  sessions.deleteSession(created.sessionId);
  return text;
}

test("clean skeleton → preamble reports the completeness floor green", async () => {
  const text = await preambleFor(null, "ComplClean");
  assert.match(text, /COMPLETENESS/, "the preamble must carry a labeled COMPLETENESS section");
  assert.match(text, /floor green/i,
    `clean bundle preamble should note the floor is green:\n${text}`);
});

test("prose leaked as an encounter type → COMPLETENESS red in the preamble, not 'clean'", async () => {
  // The exact over-claim shape: "7. Custom Report Cards (9 cards…)" as an entity.
  const mutate = (files) => {
    files["encounterTypes.json"] = [{
      name: "7. Custom Report Cards (9 cards to be built)",
      uuid: crypto.randomUUID(),
      entityEligibilityCheckRule: "",
      active: true,
      immutable: false,
    }];
  };
  const text = await preambleFor(mutate, "ComplProse");
  assert.doesNotMatch(text, /✓ bundle is clean/,
    `must NOT report clean while the completeness floor is red:\n${text}`);
  assert.match(text, /COMPLETENESS/, "the preamble must carry a labeled COMPLETENESS section");
  assert.match(text, /PROSE_AS_ENTITY/, "the prose-as-entity finding must surface");
  assert.match(text, /production-ready/i, "the closing line must forbid a production-ready claim while red");
});

test.after(() => { try { fs.rmSync(SESSIONS_ROOT, { recursive: true, force: true }); } catch {} });
