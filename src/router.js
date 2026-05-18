// Cheap deterministic model router.
//
// Routes a user prompt to a Claude model based on intent keywords drawn from
// observed failure modes on real sessions. The principle: Haiku does cheap
// mechanical edits fine; structural fixes (concept dedup, cross-bundle rename,
// schema decisions) need Sonnet's better adherence to multi-step rules.
//
// This is a router, not a planner. It picks ONE model per turn. Users can
// always override with an explicit `model` field in the /messages payload,
// or via the CLI `:model` command.
//
// Returns: { model, modelAlias, reason }
//
// To extend, add to STRUCTURAL_KEYWORDS or DEEP_REASONING_KEYWORDS.

export const MODELS = {
  haiku:  "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus:   "claude-opus-4-7",
};

// Triggers Sonnet — these are structural / schema-level operations where
// case-insensitive search and cross-file consistency matter. Each entry must
// match against a lowercased word boundary in the user prompt.
const STRUCTURAL_KEYWORDS = [
  // concept management
  "dedup", "duplicate", "deduplicate", "merge concept", "rename concept",
  "reuse concept", "case-insensitive",
  // schema-level
  "schema", "datatype", "data type",
  "subject type", "subjecttype",
  "encounter type", "encountertype",
  "form mapping", "formmapping",
  "add program", "add subject", "add encounter type", "add form",
  // multi-file operations
  "rename", "restructure", "refactor",
  "all forms", "every form", "across the bundle",
  // Structural validator codes — cross-file consistency, dedup, schema issues
  "c3", "d1", "f2 cross-group",
  "c5",         // answer references orphan concept — often needs multi-file UUID fix
  "f5",         // form references concept not in concepts.json
  "uuid mismatch", "answer uuid", "concept uuid",  // cross-file UUID alignment
];

// Triggers Opus — currently no auto-route; reserved. The escalation knobs
// the user can pull explicitly via `:model opus`.
const DEEP_REASONING_KEYWORDS = [
  "comprehensive audit", "deep review", "explain the architecture",
];

function matchesAny(text, keywords) {
  return keywords.find((kw) => text.includes(kw)) || null;
}

/**
 * @param {string} prompt — the user's free text
 * @param {object} [opts]
 * @param {string} [opts.explicit] — if the caller passed `model` explicitly,
 *   return that (no routing). Bypasses the heuristic entirely.
 * @returns {{model, modelAlias, reason}}
 */
export function routePrompt(prompt, { explicit } = {}) {
  if (explicit) {
    const alias = aliasFor(explicit);
    return { model: MODELS[alias] || explicit, modelAlias: alias, reason: "explicit (caller specified)" };
  }
  const text = String(prompt || "").toLowerCase();

  const deepHit = matchesAny(text, DEEP_REASONING_KEYWORDS);
  if (deepHit) return { model: MODELS.opus, modelAlias: "opus", reason: `keyword: "${deepHit}" → opus` };

  const structHit = matchesAny(text, STRUCTURAL_KEYWORDS);
  if (structHit) return { model: MODELS.sonnet, modelAlias: "sonnet", reason: `keyword: "${structHit}" → sonnet` };

  return { model: MODELS.haiku, modelAlias: "haiku", reason: "default → haiku (cheap, mechanical)" };
}

function aliasFor(modelOrAlias) {
  if (MODELS[modelOrAlias]) return modelOrAlias;
  for (const [alias, full] of Object.entries(MODELS)) if (full === modelOrAlias) return alias;
  return modelOrAlias.includes("haiku") ? "haiku"
       : modelOrAlias.includes("sonnet") ? "sonnet"
       : modelOrAlias.includes("opus") ? "opus"
       : modelOrAlias;
}

// Export the keyword sets so tests can inspect them; also handy for the
// /v1/sessions/:id/wallet endpoint to surface what triggers escalation.
export const _routingKeywords = { STRUCTURAL_KEYWORDS, DEEP_REASONING_KEYWORDS };
