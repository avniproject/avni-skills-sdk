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
const GEN_BASELINE = "mcp__avni-bundle__generate_baseline";

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
    // A full-tier model (the production default) — proves the baseline is always applied.
    const opts = A.buildQueryOptions({ model: "claude-sonnet-4-6", workspace: ws });
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

test("FIX4: a full-tier model (sonnet) is UNCHANGED — keeps write/structural/export", async () => {
  const A = await loadAgent();
  const list = A.disallowedToolsForModel("claude-sonnet-4-6"); // full tiers in the seed
  for (const t of ["Write", "Edit", EXPORT_TOOL, SPEC_APPLY, GEN_BASELINE]) {
    assert.ok(!list.includes(t), `full tier must NOT disallow ${t}`);
  }
  // Only the baseline SSRF/exfil block remains.
  assert.deepEqual([...list].sort(), [...A.BASELINE_DISALLOWED_TOOLS].sort());
});

test("FIX4: an UNKNOWN model is left OPEN (no regression — unknown ≠ weak)", async () => {
  const A = await loadAgent();
  // Dated/aliased model id not present in the matrix.
  const list = A.disallowedToolsForModel("claude-sonnet-4-6-20260101");
  for (const t of ["Write", "Edit", EXPORT_TOOL]) {
    assert.ok(!list.includes(t), `unknown model must keep ${t} (baseline only)`);
  }
  assert.deepEqual([...list].sort(), [...A.BASELINE_DISALLOWED_TOOLS].sort());
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
    const full = A.buildQueryOptions({ model: "claude-sonnet-4-6", workspace: ws });
    assert.ok(readOnly.disallowedTools.includes("Write"), "read-only model's options exclude Write");
    assert.ok(readOnly.disallowedTools.includes(EXPORT_TOOL), "read-only model's options exclude export");
    assert.ok(!full.disallowedTools.includes("Write"), "full-tier model keeps Write");
    assert.ok(!full.disallowedTools.includes(EXPORT_TOOL), "full-tier model keeps export");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
