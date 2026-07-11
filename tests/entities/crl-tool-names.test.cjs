"use strict";

// Phase 4 (CRL edit-loop wiring) — the three new frozen tool names appended to
// the avni-bundle MCP tool-name constant: bundle_review (read-only whole-config
// inspector), bundle_scrub (guardrailed deliberate-apply), and spec_review
// (O-1 — the spec-completeness inspector). Append-only, frozen, never repurposed.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function loadNames() { return import("../../src/agents/bundle-mcp-tool-names.js?t=" + Date.now()); }

test("frozen names: bundle_review / bundle_scrub / spec_review appended (Phase 4 — CRL edit-loop wiring)", async () => {
  const { BUNDLE_TOOL_NAME, BUNDLE_TOOL_NAMES } = await loadNames();

  assert.equal(BUNDLE_TOOL_NAME.REVIEW, "mcp__avni-bundle__bundle_review");
  assert.equal(BUNDLE_TOOL_NAME.SCRUB, "mcp__avni-bundle__bundle_scrub");
  assert.equal(BUNDLE_TOOL_NAME.SPEC_REVIEW, "mcp__avni-bundle__spec_review");

  assert.deepEqual(BUNDLE_TOOL_NAMES, [
    "mcp__avni-bundle__bundle_validator_run",
    "mcp__avni-bundle__bundle_find_concept",
    "mcp__avni-bundle__bundle_summary",
    "mcp__avni-bundle__bundle_export_to_path",
    "mcp__avni-bundle__bundle_integrity_check",
    "mcp__avni-bundle__spec_apply",
    "mcp__avni-bundle__spec_emit",
    "mcp__avni-bundle__bundle_read_srs",
    "mcp__avni-bundle__bundle_generate_baseline",
    "mcp__avni-bundle__bundle_find_references",
    "mcp__avni-bundle__bundle_review",
    "mcp__avni-bundle__bundle_scrub",
    "mcp__avni-bundle__spec_review",
  ]);

  // The prior ten remain first and unchanged (append-only guarantee).
  assert.equal(BUNDLE_TOOL_NAMES[0], "mcp__avni-bundle__bundle_validator_run");
  assert.equal(BUNDLE_TOOL_NAMES[9], "mcp__avni-bundle__bundle_find_references");

  assert.ok(Object.isFrozen(BUNDLE_TOOL_NAME));
  assert.ok(Object.isFrozen(BUNDLE_TOOL_NAMES));
});
