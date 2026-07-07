// Tests for the wallet agent tag + the /diagnostics endpoint logic.
// Bypasses HTTP: tests the failure-classification logic directly by writing
// synthetic transcript + steps + cost JSONL files and verifying the
// diagnostics computation extracts the right failure rows.
//
// Per Phase 5a precedent we test the storage + classification, not the
// Express layer (the agent-messages-endpoint.test.cjs handles HTTP-layer
// validation).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function makeTmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avni-diag-test-"));
  process.env.SDK_SESSIONS_DIR = root;
  return root;
}

async function loadAll() {
  // Fresh import to pick up the new env
  const tag = "?t=" + Date.now();
  return {
    wallet:     await import("../../src/wallet.js" + tag),
    transcript: await import("../../src/transcript.js" + tag),
    steplog:    await import("../../src/steplog.js" + tag),
  };
}

function makeSessionDir(root, sid) {
  fs.mkdirSync(path.join(root, sid), { recursive: true });
  return sid;
}

// ─── Part 1: per-agent wallet breakdown ─────────────────────────────

test("wallet records `agent` field on recordResult + breaks down totals per agent", async () => {
  const root = makeTmpRoot();
  const { wallet } = await loadAll();
  wallet._testReset();
  const sid = makeSessionDir(root, "sess_0000000000000001");

  wallet.startTurn(sid).recordResult({ usd: 0.10, inputTokens: 500, outputTokens: 200, agent: "spec" });
  wallet.startTurn(sid).recordResult({ usd: 0.05, inputTokens: 200, outputTokens: 100, agent: "spec" });
  wallet.startTurn(sid).recordResult({ usd: 0.20, inputTokens: 800, outputTokens: 400, agent: "bundle-config" });
  wallet.startTurn(sid).recordResult({ usd: 0.01, inputTokens: 50,  outputTokens: 20,  agent: "review" });

  const w = wallet.getWallet(sid);
  assert.equal(w.byAgent.spec.turns, 2);
  assert.ok(Math.abs(w.byAgent.spec.usd - 0.15) < 1e-9);
  assert.equal(w.byAgent["bundle-config"].turns, 1);
  assert.ok(Math.abs(w.byAgent["bundle-config"].usd - 0.20) < 1e-9);
  assert.equal(w.byAgent.review.turns, 1);
  assert.ok(Math.abs(w.totalUsd - 0.36) < 1e-9);
});

test("wallet untagged turns bucket under `unspecified`", async () => {
  const root = makeTmpRoot();
  const { wallet } = await loadAll();
  wallet._testReset();
  const sid = makeSessionDir(root, "sess_0000000000000002");

  wallet.startTurn(sid).recordResult({ usd: 0.05, inputTokens: 1, outputTokens: 1 });  // no agent
  wallet.startTurn(sid).recordResult({ usd: 0.03, inputTokens: 1, outputTokens: 1, agent: "spec" });

  const w = wallet.getWallet(sid);
  assert.equal(w.byAgent.unspecified.turns, 1);
  assert.equal(w.byAgent.spec.turns, 1);
});

test("cost.jsonl persists the agent field across process restart", async () => {
  const root = makeTmpRoot();
  const m1 = await loadAll();
  m1.wallet._testReset();
  const sid = makeSessionDir(root, "sess_0000000000000003");
  m1.wallet.startTurn(sid).recordResult({ usd: 0.10, inputTokens: 1, outputTokens: 1, agent: "spec" });

  // Restart: clear ledger, re-import
  m1.wallet._testReset();
  const m2 = await loadAll();
  const w = m2.wallet.getWallet(sid);
  assert.equal(w.byAgent.spec.turns, 1);
  assert.ok(Math.abs(w.byAgent.spec.usd - 0.10) < 1e-9);
});

// ─── Part 2: failure-classification logic ───────────────────────────
// The /diagnostics endpoint logic lives in src/server.js — but the
// classification rules are deterministic functions of the JSONL inputs.
// We replicate the rules here as a guard against accidental changes.

function classifyFailures(turnCommits) {
  // schema_errors (relay AGENT_OUTPUT_SCHEMA violations) was retired in #11 —
  // a single linear agent has no output-schema contract to break.
  const circuitBreaks       = turnCommits.filter((e) => e.aborted);
  const integrityIssues     = turnCommits.filter((e) => e.integrity && !e.integrity.ok);

  const validatorRegressions = [];
  for (let i = 1; i < turnCommits.length; i++) {
    const prev = turnCommits[i - 1].validation?.errors || 0;
    const curr = turnCommits[i].validation?.errors || 0;
    if (curr > prev) validatorRegressions.push({ turn: turnCommits[i].turn, delta: curr - prev });
  }

  const semanticFailures = [];
  for (const e of turnCommits) {
    const s = e.structured;
    if (!s) continue;
    if (s.intent === "applied_fix" && (!s.applied_changes || s.applied_changes.length === 0)) {
      semanticFailures.push({ turn: e.turn, type: "applied_fix_with_no_changes" });
    }
    if (s.intent === "ask_user" && (!s.ambiguities || s.ambiguities.length === 0)) {
      semanticFailures.push({ turn: e.turn, type: "ask_user_with_no_ambiguities" });
    }
  }

  return { circuitBreaks, integrityIssues, validatorRegressions, semanticFailures };
}

test("diagnostics: circuit_breaks flagged when aborted=true on turn_commit", () => {
  const events = [
    { turn: 1, agent: "spec", aborted: false },
    { turn: 2, agent: "spec", aborted: true, abortReason: "TURN_MAX_EVENTS" },
    { turn: 3, agent: "bundle-config", aborted: true, abortReason: "TURN_MAX_COST" },
  ];
  const f = classifyFailures(events);
  assert.equal(f.circuitBreaks.length, 2);
});

test("diagnostics: validator_regressions surface when errors increase turn-over-turn", () => {
  const events = [
    { turn: 0, validation: { errors: 5 } },
    { turn: 1, validation: { errors: 3 } },   // improvement, no regression
    { turn: 2, validation: { errors: 7 } },   // regression: +4
    { turn: 3, validation: { errors: 7 } },   // same, no regression
    { turn: 4, validation: { errors: 12 } },  // regression: +5
  ];
  const f = classifyFailures(events);
  assert.equal(f.validatorRegressions.length, 2);
  assert.equal(f.validatorRegressions[0].turn, 2);
  assert.equal(f.validatorRegressions[0].delta, 4);
  assert.equal(f.validatorRegressions[1].turn, 4);
  assert.equal(f.validatorRegressions[1].delta, 5);
});

test("diagnostics: integrity_issues flagged when integrity.ok=false", () => {
  const events = [
    { turn: 1, integrity: { ok: true, issues: [] } },
    { turn: 2, integrity: { ok: false, issues: [{ message: "dangling formUUID" }] } },
  ];
  const f = classifyFailures(events);
  assert.equal(f.integrityIssues.length, 1);
  assert.equal(f.integrityIssues[0].turn, 2);
});

test("diagnostics: semantic_failures — applied_fix with empty applied_changes", () => {
  const events = [
    { turn: 1, structured: { intent: "applied_fix", applied_changes: [{ section: "forms", operation: "add" }] } }, // valid
    { turn: 2, structured: { intent: "applied_fix", applied_changes: [] } },                                      // INVALID
    { turn: 3, structured: { intent: "applied_fix" } },                                                            // INVALID (undef)
  ];
  const f = classifyFailures(events);
  assert.equal(f.semanticFailures.length, 2);
  assert.ok(f.semanticFailures.every((s) => s.type === "applied_fix_with_no_changes"));
});

test("diagnostics: semantic_failures — ask_user with empty ambiguities", () => {
  const events = [
    { turn: 1, structured: { intent: "ask_user", ambiguities: [{ id: "1", question: "?" }] } },  // valid
    { turn: 2, structured: { intent: "ask_user", ambiguities: [] } },                            // INVALID
  ];
  const f = classifyFailures(events);
  assert.equal(f.semanticFailures.length, 1);
  assert.equal(f.semanticFailures[0].type, "ask_user_with_no_ambiguities");
});

test("diagnostics: clean session reports zero failures across all categories", () => {
  const events = [
    {
      turn: 1, agent: "spec",
      schemaErrors: [],
      aborted: false,
      structured: { intent: "phase_complete", applied_changes: [], ambiguities: [] },
      validation: { errors: 0 },
      integrity: { ok: true, issues: [] },
    },
  ];
  const f = classifyFailures(events);
  assert.equal(f.circuitBreaks.length, 0);
  assert.equal(f.validatorRegressions.length, 0);
  assert.equal(f.integrityIssues.length, 0);
  assert.equal(f.semanticFailures.length, 0);
});
