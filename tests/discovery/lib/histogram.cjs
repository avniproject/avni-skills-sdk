// tests/discovery/lib/histogram.cjs
//
// Tool-usage histogram + flounder detector for the observe-only discovery
// harness (design §4.4). PURE functions over a synthetic-or-real sequence of
// agent SSE events / tool-use records, so they are unit-testable WITHOUT an API
// key (the unit tests feed synthetic agentEvents).
//
// The discovery harness records — it does NOT assert pass/fail on behaviour.
// It throws ONLY on safety floors (handled in the scenarios, not here).

"use strict";

// ─── tool-use extraction ────────────────────────────────────────────
//
// Reuse the eval harness's listToolUses shape: walk `agent` SSE events, collect
// every assistant `tool_use` block as { name, input }. Accepts either the raw
// SSE event array (each { type:"assistant", message:{ content:[...] } }) or an
// already-extracted [{ name, input }] list (idempotent).

function listToolUses(agentEvents) {
  const out = [];
  for (const ev of agentEvents || []) {
    // already-extracted shape
    if (ev && typeof ev.name === "string" && !ev.type && !ev.message) {
      out.push({ name: ev.name, input: ev.input });
      continue;
    }
    if (ev?.type !== "assistant") continue;
    for (const b of ev.message?.content || []) {
      if (b.type === "tool_use") out.push({ name: b.name, input: b.input });
    }
  }
  return out;
}

// ─── histogram schema (design §4.4) ─────────────────────────────────
//
// {
//   total: <int>,                  total tool calls
//   byName: { <toolName>: <int> }, per-tool call counts
//   byClass: {                     coarse buckets for tool-reach analysis
//     read, edit, validate, integrity, findConcept, export, bash, skill, other
//   },
//   distinctTools: <int>,          how many distinct tools were reached
//   usedIntegrityCheck: <bool>,    reached the integrity gate?
//   usedValidator: <bool>,         reached the validator?
//   usedSkill: <bool>,             consulted a Skill?
//   sequence: [<toolName>...]      ordered call sequence (for ordering checks)
// }
//
// Class mapping is by frozen tool name (MCP) + the built-in tool names.

const MCP = {
  VALIDATOR: "mcp__avni-bundle__bundle_validator_run",
  FIND_CONCEPT: "mcp__avni-bundle__bundle_find_concept",
  SUMMARY: "mcp__avni-bundle__bundle_summary",
  EXPORT: "mcp__avni-bundle__bundle_export_to_path",
  INTEGRITY: "mcp__avni-bundle__bundle_integrity_check",
};

function classifyTool(name) {
  switch (name) {
    case "Read": case "Glob": case "Grep": return "read";
    case "Edit": case "Write": case "MultiEdit": return "edit";
    case "Bash": return "bash";
    case "Skill": return "skill";
    case MCP.VALIDATOR: return "validate";
    case MCP.INTEGRITY: return "integrity";
    case MCP.FIND_CONCEPT: return "findConcept";
    case MCP.SUMMARY: return "read";
    case MCP.EXPORT: return "export";
    default: return "other";
  }
}

function buildToolHistogram(agentEvents) {
  const tools = listToolUses(agentEvents);
  const byName = {};
  const byClass = {
    read: 0, edit: 0, validate: 0, integrity: 0,
    findConcept: 0, export: 0, bash: 0, skill: 0, other: 0,
  };
  const sequence = [];
  for (const t of tools) {
    byName[t.name] = (byName[t.name] || 0) + 1;
    byClass[classifyTool(t.name)]++;
    sequence.push(t.name);
  }
  return {
    total: tools.length,
    byName,
    byClass,
    distinctTools: Object.keys(byName).length,
    usedIntegrityCheck: (byName[MCP.INTEGRITY] || 0) > 0,
    usedValidator: (byName[MCP.VALIDATOR] || 0) > 0,
    usedSkill: byClass.skill > 0,
    sequence,
  };
}

// ─── flounder detector (design §4.4) ────────────────────────────────
//
// A "flounder" = the model is spinning without converging. We detect five
// independent modes; the verdict floundered iff ANY fire. Each is a structural
// heuristic over the tool sequence + cheap signals (no LLM judge).
//
// Inputs (all optional except agentEvents):
//   agentEvents       — SSE event array (for the tool sequence)
//   tokensUsed        — input+output tokens for the turn (no-edit-high-burn)
//   editCount         — # of Edit/Write tool calls (default: derived from histogram)
//   turnsUsed         — # of agent turns (turn-cap)
//   validatorProgress — { before, after } error counts, when known
//   thresholds        — overrides (see DEFAULTS)
//
// Modes:
//   no-edit-high-token-burn : burned > tokenBurnFloor tokens but made 0 edits
//   repeated-identical-call : the SAME (tool, input) called >= repeatFloor times
//   no-validator-progress   : validator errors did not drop after >= 1 edit
//   ambiguity-loop          : alternating Read/validate with no edit, length >= loopFloor
//   turn-cap                : turnsUsed >= turnCap

const FLOUNDER_DEFAULTS = Object.freeze({
  tokenBurnFloor: 15000,   // > this many tokens with no edit = burning
  repeatFloor: 3,          // same (tool,input) >= 3 times = stuck
  loopFloor: 6,            // >= 6 read/validate calls, no edit = circling
  turnCap: 8,              // >= this many turns = capped
});

function inputHash(input) {
  try { return JSON.stringify(input); } catch { return String(input); }
}

function detectFlounder(opts = {}) {
  const {
    agentEvents = [],
    tokensUsed = 0,
    turnsUsed = 0,
    validatorProgress = null,
    thresholds = {},
  } = opts;
  const T = { ...FLOUNDER_DEFAULTS, ...thresholds };

  const tools = listToolUses(agentEvents);
  const hist = buildToolHistogram(tools);
  const editCount = typeof opts.editCount === "number" ? opts.editCount : hist.byClass.edit;

  const reasons = [];

  // 1. no-edit-high-token-burn
  if (editCount === 0 && tokensUsed > T.tokenBurnFloor) {
    reasons.push("no-edit-high-token-burn");
  }

  // 2. repeated-identical-call: same (name, inputHash) >= repeatFloor
  const seen = new Map();
  let maxRepeat = 0;
  for (const t of tools) {
    const k = `${t.name}::${inputHash(t.input)}`;
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    if (n > maxRepeat) maxRepeat = n;
  }
  if (maxRepeat >= T.repeatFloor) reasons.push("repeated-identical-call");

  // 3. no-validator-progress: an edit was made but errors didn't drop
  if (validatorProgress &&
      typeof validatorProgress.before === "number" &&
      typeof validatorProgress.after === "number" &&
      editCount >= 1 &&
      validatorProgress.after >= validatorProgress.before &&
      validatorProgress.before > 0) {
    reasons.push("no-validator-progress");
  }

  // 4. ambiguity-loop: only read/validate calls (no edit), and enough of them
  const onlyReadValidate = tools.length >= T.loopFloor &&
    editCount === 0 &&
    tools.every((t) => {
      const c = classifyTool(t.name);
      return c === "read" || c === "validate" || c === "integrity" || c === "findConcept" || c === "skill";
    });
  if (onlyReadValidate) reasons.push("ambiguity-loop");

  // 5. turn-cap
  if (turnsUsed >= T.turnCap) reasons.push("turn-cap");

  return {
    floundered: reasons.length > 0,
    reasons,
    signals: { editCount, tokensUsed, turnsUsed, maxRepeat, toolCount: tools.length },
  };
}

module.exports = {
  listToolUses,
  classifyTool,
  buildToolHistogram,
  detectFlounder,
  FLOUNDER_DEFAULTS,
  MCP,
};
