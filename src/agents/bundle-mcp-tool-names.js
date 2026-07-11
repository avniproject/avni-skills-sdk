// Frozen tool-name constants for the in-process avni-bundle MCP server.
//
// DO NOT RENAME — these strings appear in historical agent transcripts,
// step logs (steps.jsonl), wallet ledgers (cost.jsonl), and any downstream
// analytics or tooling that grep for tool-use events. Renaming silently
// breaks replay / audit / search across every persisted session.
//
// New tools must be added with a NEW name; never repurpose an old one.

/**
 * Fully-qualified MCP tool names exposed by the `avni-bundle` server.
 * Frozen so a stray mutation throws instead of corrupting downstream logs.
 * APPEND-ONLY: new tools get a new key + name; never rename/remove an existing one.
 * @type {Readonly<{ VALIDATOR_RUN: string, FIND_CONCEPT: string, SUMMARY: string, EXPORT_TO_PATH: string, INTEGRITY_CHECK: string, SPEC_APPLY: string, SPEC_EMIT: string, READ_SRS: string, GENERATE_BASELINE: string, FIND_REFERENCES: string, REVIEW: string, SCRUB: string, SPEC_REVIEW: string }>}
 */
export const BUNDLE_TOOL_NAME = Object.freeze({
  VALIDATOR_RUN: "mcp__avni-bundle__bundle_validator_run",
  FIND_CONCEPT: "mcp__avni-bundle__bundle_find_concept",
  SUMMARY: "mcp__avni-bundle__bundle_summary",
  EXPORT_TO_PATH: "mcp__avni-bundle__bundle_export_to_path",
  INTEGRITY_CHECK: "mcp__avni-bundle__bundle_integrity_check",
  // APPENDED in story #11 (part B). New names only — never repurpose the above.
  SPEC_APPLY: "mcp__avni-bundle__spec_apply",
  SPEC_EMIT: "mcp__avni-bundle__spec_emit",
  // APPENDED in story #12 (agent mode). New names only.
  // NOTE: these frozen names use the `bundle_` prefix mandated by the epic
  // acceptance criteria (bundle_read_srs / bundle_generate_baseline). The
  // earlier divergent #12 build briefly named them read_srs / generate_baseline;
  // that build never shipped (this is the unmerged epic integration branch), so
  // there are no persisted transcripts to break — the rename to the epic's
  // frozen contract happens ONCE here, before merge. Never rename after merge.
  READ_SRS: "mcp__avni-bundle__bundle_read_srs",
  GENERATE_BASELINE: "mcp__avni-bundle__bundle_generate_baseline",
  // APPENDED in story #13 (tool promotion). Promotes the CLI blast-radius
  // finder (scripts/agent-tools/find-references.mjs) to a first-class MCP tool —
  // the discovery harness (d8 multi-file-rename) + eval case 05 (rename-concept)
  // show the agent repeatedly needs full reference coverage before rename/dedup.
  // New name only — never repurpose the above.
  FIND_REFERENCES: "mcp__avni-bundle__bundle_find_references",
  // APPENDED in Phase 4 (compliance-guided review layer — wire into the edit
  // loop). New names only — never repurpose the above. bundle_review is the
  // READ-ONLY whole-config inspector; bundle_scrub is the deliberate-apply
  // (guardrailed executor) entry point; spec_review (O-1) is the read-only
  // spec-completeness inspector against spec-template.yaml. The AUTOMATIC
  // per-change gate (crlGate) is wired directly into src/sessions.js
  // commitWorkspaceChanges — it is NOT a tool the agent calls.
  REVIEW: "mcp__avni-bundle__bundle_review",
  SCRUB: "mcp__avni-bundle__bundle_scrub",
  SPEC_REVIEW: "mcp__avni-bundle__spec_review",
});

/**
 * Frozen list form, for spread into `allowedTools`.
 * @type {ReadonlyArray<string>}
 */
export const BUNDLE_TOOL_NAMES = Object.freeze([
  BUNDLE_TOOL_NAME.VALIDATOR_RUN,
  BUNDLE_TOOL_NAME.FIND_CONCEPT,
  BUNDLE_TOOL_NAME.SUMMARY,
  BUNDLE_TOOL_NAME.EXPORT_TO_PATH,
  BUNDLE_TOOL_NAME.INTEGRITY_CHECK,
  BUNDLE_TOOL_NAME.SPEC_APPLY,
  BUNDLE_TOOL_NAME.SPEC_EMIT,
  BUNDLE_TOOL_NAME.READ_SRS,
  BUNDLE_TOOL_NAME.GENERATE_BASELINE,
  BUNDLE_TOOL_NAME.FIND_REFERENCES,
  BUNDLE_TOOL_NAME.REVIEW,
  BUNDLE_TOOL_NAME.SCRUB,
  BUNDLE_TOOL_NAME.SPEC_REVIEW,
]);
