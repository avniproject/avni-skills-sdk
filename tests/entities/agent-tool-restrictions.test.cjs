// FIX 2 (disallowedTools / SSRF-exfil) + FIX 4 (real toolTiers).
//
// FIX 2: per the SDK docs `allowedTools` is auto-approve-without-prompt, NOT a
// restriction — WebFetch/WebSearch/Task/NotebookEdit were therefore reachable.
// `disallowedTools` is the actual restriction (tools removed from the model's
// context). runAgent's assembled options must carry the baseline block.
//
// FIX 4: toolTiers were decorative (nothing read them). They now REALLY
// constrain the tool set: a KNOWN read-only-tier model loses the write /
// structural / export tools; a full-tier model is unchanged; an UNKNOWN model
// is left open (unknown ≠ weak → no regression).
//
// No API key, no LLM — deterministic unit tests of the option builder + the
// tier→disallow derivation. Synthetic fixtures only (CLAUDE.md §1).

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

async function loadAgent() {
  return import("../../src/agent.js?t=" + Date.now());
}

const EXPORT_TOOL = "mcp__avni-bundle__bundle_export_to_path";
const SPEC_APPLY = "mcp__avni-bundle__spec_apply";
const GEN_BASELINE = "mcp__avni-bundle__bundle_generate_baseline";

// ─── FIX 2: baseline SSRF / exfil block ─────────────────────────────

test("FIX2: BASELINE_DISALLOWED_TOOLS blocks WebFetch/WebSearch/Task/NotebookEdit", async () => {
  const A = await loadAgent();
  for (const t of ["WebFetch", "WebSearch", "Task", "NotebookEdit"]) {
    assert.ok(A.BASELINE_DISALLOWED_TOOLS.includes(t), `${t} must be in the baseline disallow set`);
  }
});

test("FIX2: runAgent's assembled options include the disallowedTools baseline set", async () => {
  const A = await loadAgent();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-opts-"));
  try {
    // A full-tier model (the production default, Opus 4.8) — proves the baseline is always applied.
    const opts = A.buildQueryOptions({ model: "claude-opus-4-8", workspace: ws });
    assert.ok(Array.isArray(opts.disallowedTools), "options must carry a disallowedTools array");
    for (const t of A.BASELINE_DISALLOWED_TOOLS) {
      assert.ok(opts.disallowedTools.includes(t), `disallowedTools must include ${t}`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("FIX2: caller-supplied disallowedTools are merged with the baseline (deduped)", async () => {
  const A = await loadAgent();
  const list = A.disallowedToolsForModel("claude-sonnet-4-6", { extra: ["WebFetch", "SomethingCustom"] });
  assert.ok(list.includes("SomethingCustom"));
  assert.equal(list.filter((t) => t === "WebFetch").length, 1, "no duplicates");
});

// ─── FIX 4: read-only tier really excludes write tools ──────────────

test("FIX4: a KNOWN read-only-tier model (haiku, interim seed) loses write/structural/export tools", async () => {
  const A = await loadAgent();
  const list = A.disallowedToolsForModel("claude-haiku-4-5"); // toolTiers=["read"] in the interim seed
  for (const t of ["Write", "Edit", EXPORT_TOOL, SPEC_APPLY, GEN_BASELINE]) {
    assert.ok(list.includes(t), `read-only tier must disallow ${t}`);
  }
  // Baseline still present.
  assert.ok(list.includes("WebFetch"));
});

test("FIX4: a full-tier model (opus) is UNCHANGED — keeps write/structural/export", async () => {
  const A = await loadAgent();
  const list = A.disallowedToolsForModel("claude-opus-4-8"); // full tiers in the seed (2026-07-13 structural default)
  for (const t of ["Write", "Edit", EXPORT_TOOL, SPEC_APPLY, GEN_BASELINE]) {
    assert.ok(!list.includes(t), `full tier must NOT disallow ${t}`);
  }
  // Only the baseline SSRF/exfil block + the claude.ai account-MCP block remain.
  assert.deepEqual(
    [...list].sort(),
    [...A.BASELINE_DISALLOWED_TOOLS, ...A.BLOCKED_ACCOUNT_MCP_SERVERS].sort(),
  );
});

test("FIX4: an UNKNOWN model is left OPEN (no regression — unknown ≠ weak)", async () => {
  const A = await loadAgent();
  // Dated/aliased model id not present in the matrix.
  const list = A.disallowedToolsForModel("claude-sonnet-4-6-20260101");
  for (const t of ["Write", "Edit", EXPORT_TOOL]) {
    assert.ok(!list.includes(t), `unknown model must keep ${t} (baseline only)`);
  }
  // Baseline SSRF/exfil block + the always-on claude.ai account-MCP block.
  assert.deepEqual(
    [...list].sort(),
    [...A.BASELINE_DISALLOWED_TOOLS, ...A.BLOCKED_ACCOUNT_MCP_SERVERS].sort(),
  );
});

test("FIX4: synthetic low/read-only-tier model → effective tool set excludes write tools", async () => {
  const A = await loadAgent();
  const synthMatrix = {
    models: {
      "synthetic-lowtier": { toolTiers: ["read"] },
      "synthetic-fulltier": { toolTiers: ["read", "write", "structural", "export"] },
    },
  };
  const low = A.disallowedToolsForModel("synthetic-lowtier", { matrix: synthMatrix });
  const full = A.disallowedToolsForModel("synthetic-fulltier", { matrix: synthMatrix });
  for (const t of ["Write", "Edit", EXPORT_TOOL, SPEC_APPLY, GEN_BASELINE]) {
    assert.ok(low.includes(t), `synthetic low-tier must disallow ${t}`);
    assert.ok(!full.includes(t), `synthetic full-tier must NOT disallow ${t}`);
  }
});

test("FIX4: buildQueryOptions honours the tier — read-only model restricts, full-tier does not", async () => {
  const A = await loadAgent();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-opts-tier-"));
  try {
    const readOnly = A.buildQueryOptions({ model: "claude-haiku-4-5", workspace: ws });
    // 2026-07-13 model-matrix: opus is the structural/full-tier model (sonnet demoted to read-only).
    const full = A.buildQueryOptions({ model: "claude-opus-4-8", workspace: ws });
    assert.ok(readOnly.disallowedTools.includes("Write"), "read-only model's options exclude Write");
    assert.ok(readOnly.disallowedTools.includes(EXPORT_TOOL), "read-only model's options exclude export");
    assert.ok(!full.disallowedTools.includes("Write"), "full-tier model keeps Write");
    assert.ok(!full.disallowedTools.includes(EXPORT_TOOL), "full-tier model keeps export");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ─── FIX 5: block the operator's claude.ai account MCP integrations ──
//
// The Agent SDK injects the operator's claude.ai account-connected MCP tools
// (mcp__claude_ai_*: Google Drive / Gmail / Calendar) into every dispatch,
// unaffected by settingSources:[]. Two layers must hold: (a) the known servers
// are in disallowedTools (context removal), and (b) a matcher-less PreToolUse
// hook hard-denies ANY mcp__claude_ai_* tool (future-proof enforcement).

const DRIVE_TOOL = "mcp__claude_ai_Google_Drive__search_files";
const GMAIL_TOOL = "mcp__claude_ai_Gmail__authenticate";

// Invoke every callback in a PreToolUse matcher entry with a synthetic input;
// return the first block decision, else the last pass-through result.
async function runPreToolUse(hookEntry, toolName) {
  const input = { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: {} };
  let out = { continue: true };
  for (const cb of hookEntry.hooks) {
    out = await cb(input, undefined, { signal: new AbortController().signal });
    if (out?.decision === "block") return out;
  }
  return out;
}

test("FIX5: BLOCKED_ACCOUNT_MCP_SERVERS covers Drive/Gmail/Calendar", async () => {
  const A = await loadAgent();
  assert.deepEqual([...A.BLOCKED_ACCOUNT_MCP_SERVERS].sort(), [
    "mcp__claude_ai_Gmail",
    "mcp__claude_ai_Google_Calendar",
    "mcp__claude_ai_Google_Drive",
  ]);
});

test("FIX5: disallowedToolsForModel always includes the account-MCP block (every tier)", async () => {
  const A = await loadAgent();
  for (const model of ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-sonnet-4-6-20260101"]) {
    const list = A.disallowedToolsForModel(model);
    for (const s of A.BLOCKED_ACCOUNT_MCP_SERVERS) {
      assert.ok(list.includes(s), `${model}: disallowedTools must include ${s}`);
    }
  }
});

test("FIX5: buildQueryOptions carries the account-MCP block in disallowedTools", async () => {
  const A = await loadAgent();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-opts-mcp-"));
  try {
    const opts = A.buildQueryOptions({ model: "claude-sonnet-4-6", workspace: ws });
    for (const s of A.BLOCKED_ACCOUNT_MCP_SERVERS) {
      assert.ok(opts.disallowedTools.includes(s), `disallowedTools must include ${s}`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("FIX5: isBlockedAccountMcpTool matches claude.ai tools, not our own or built-ins", async () => {
  const A = await loadAgent();
  assert.equal(A.isBlockedAccountMcpTool(DRIVE_TOOL), true);
  assert.equal(A.isBlockedAccountMcpTool(GMAIL_TOOL), true);
  assert.equal(A.isBlockedAccountMcpTool("mcp__claude_ai_Slack__post_message"), true, "future connections too");
  assert.equal(A.isBlockedAccountMcpTool("mcp__avni-bundle__bundle_find_concept"), false, "our own MCP is safe");
  assert.equal(A.isBlockedAccountMcpTool("Read"), false);
  assert.equal(A.isBlockedAccountMcpTool(undefined), false);
  assert.equal(A.isBlockedAccountMcpTool(null), false);
});

test("FIX5: the PreToolUse hook DENIES a claude.ai tool and PASSES everything else", async () => {
  const A = await loadAgent();
  const entry = A.blockAccountMcpPreToolUseHook();

  const denied = await runPreToolUse(entry, DRIVE_TOOL);
  assert.equal(denied.decision, "block", "claude.ai Drive tool must be blocked");
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");

  for (const allowed of ["Read", "Bash", "mcp__avni-bundle__bundle_find_concept"]) {
    const res = await runPreToolUse(entry, allowed);
    assert.deepEqual(res, { continue: true }, `${allowed} must pass through`);
  }
});

test("FIX5: buildQueryOptions wires the account-MCP deny hook into PreToolUse", async () => {
  const A = await loadAgent();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-opts-hook-"));
  try {
    const opts = A.buildQueryOptions({ model: "claude-sonnet-4-6", workspace: ws });
    const entries = opts.hooks.PreToolUse;
    let blocks = false;
    for (const entry of entries) {
      const res = await runPreToolUse(entry, DRIVE_TOOL);
      if (res?.decision === "block") { blocks = true; break; }
    }
    assert.ok(blocks, "one PreToolUse entry must block a claude.ai account MCP tool");
    // And the existing Bash forbidden-command gate must still be present.
    let bashBlocks = false;
    for (const entry of entries) {
      const input = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "sudo rm -rf /" } };
      for (const cb of entry.hooks) {
        const r = await cb(input, undefined, { signal: new AbortController().signal });
        if (r?.decision === "block") { bashBlocks = true; break; }
      }
      if (bashBlocks) break;
    }
    assert.ok(bashBlocks, "the Bash forbidden-command gate must remain wired");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
