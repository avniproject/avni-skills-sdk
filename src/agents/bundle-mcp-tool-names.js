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
 * @type {Readonly<{ VALIDATOR_RUN: string, FIND_CONCEPT: string, SUMMARY: string, EXPORT_TO_PATH: string, INTEGRITY_CHECK: string }>}
 */
export const BUNDLE_TOOL_NAME = Object.freeze({
  VALIDATOR_RUN: "mcp__avni-bundle__bundle_validator_run",
  FIND_CONCEPT: "mcp__avni-bundle__bundle_find_concept",
  SUMMARY: "mcp__avni-bundle__bundle_summary",
  EXPORT_TO_PATH: "mcp__avni-bundle__bundle_export_to_path",
  INTEGRITY_CHECK: "mcp__avni-bundle__bundle_integrity_check",
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
]);
