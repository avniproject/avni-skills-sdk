// tests/discovery/histogram.test.cjs
//
// Synthetic unit tests (NO API) for the discovery histogram builder + flounder
// detector. We feed hand-built agentEvents / tool sequences and assert the
// histogram shape + flounder verdict. These run on every `npm test`.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildToolHistogram,
  detectFlounder,
  classifyTool,
  listToolUses,
  MCP,
} = require("./lib/histogram.cjs");

// ─── synthetic SSE event builders ───────────────────────────────────

function assistantEvent(...toolUses) {
  return {
    type: "assistant",
    message: { content: toolUses.map((t) => ({ type: "tool_use", name: t.name, input: t.input || {} })) },
  };
}
function textEvent(text) {
  return { type: "assistant", message: { content: [{ type: "text", text }] } };
}

// ─── listToolUses ───────────────────────────────────────────────────

test("listToolUses extracts tool_use blocks from SSE events", () => {
  const events = [
    textEvent("thinking..."),
    assistantEvent({ name: "Read", input: { file_path: "concepts.json" } }),
    assistantEvent({ name: MCP.VALIDATOR }, { name: MCP.INTEGRITY }),
  ];
  const tools = listToolUses(events);
  assert.equal(tools.length, 3);
  assert.deepEqual(tools.map((t) => t.name), ["Read", MCP.VALIDATOR, MCP.INTEGRITY]);
});

test("listToolUses is idempotent on already-extracted lists", () => {
  const pre = [{ name: "Read", input: {} }, { name: "Edit", input: {} }];
  const tools = listToolUses(pre);
  assert.deepEqual(tools.map((t) => t.name), ["Read", "Edit"]);
});

// ─── classifyTool ───────────────────────────────────────────────────

test("classifyTool buckets MCP + built-in tools correctly", () => {
  assert.equal(classifyTool("Read"), "read");
  assert.equal(classifyTool("Edit"), "edit");
  assert.equal(classifyTool("Write"), "edit");
  assert.equal(classifyTool("Bash"), "bash");
  assert.equal(classifyTool("Skill"), "skill");
  assert.equal(classifyTool(MCP.VALIDATOR), "validate");
  assert.equal(classifyTool(MCP.INTEGRITY), "integrity");
  assert.equal(classifyTool(MCP.FIND_CONCEPT), "findConcept");
  assert.equal(classifyTool(MCP.SUMMARY), "read");
  assert.equal(classifyTool(MCP.EXPORT), "export");
  assert.equal(classifyTool("SomethingNew"), "other");
});

// ─── buildToolHistogram ─────────────────────────────────────────────

test("buildToolHistogram counts totals, classes, distinct, and reach flags", () => {
  const events = [
    assistantEvent({ name: "Read" }, { name: "Read" }),
    assistantEvent({ name: "Edit" }),
    assistantEvent({ name: MCP.VALIDATOR }),
    assistantEvent({ name: MCP.INTEGRITY }),
    assistantEvent({ name: "Skill", input: { command: "avni-bundle-spec" } }),
  ];
  const h = buildToolHistogram(events);
  assert.equal(h.total, 6);
  assert.equal(h.byName["Read"], 2);
  assert.equal(h.byClass.read, 2);
  assert.equal(h.byClass.edit, 1);
  assert.equal(h.byClass.validate, 1);
  assert.equal(h.byClass.integrity, 1);
  assert.equal(h.byClass.skill, 1);
  assert.equal(h.distinctTools, 5);
  assert.equal(h.usedIntegrityCheck, true);
  assert.equal(h.usedValidator, true);
  assert.equal(h.usedSkill, true);
  assert.deepEqual(h.sequence, ["Read", "Read", "Edit", MCP.VALIDATOR, MCP.INTEGRITY, "Skill"]);
});

test("buildToolHistogram on empty input is a zeroed histogram", () => {
  const h = buildToolHistogram([]);
  assert.equal(h.total, 0);
  assert.equal(h.distinctTools, 0);
  assert.equal(h.usedIntegrityCheck, false);
  assert.equal(h.usedValidator, false);
  assert.equal(h.usedSkill, false);
  assert.deepEqual(h.sequence, []);
});

// ─── detectFlounder — each mode in isolation ────────────────────────

test("flounder: no-edit-high-token-burn fires when many tokens, zero edits", () => {
  const events = [assistantEvent({ name: "Read" })];
  const f = detectFlounder({ agentEvents: events, tokensUsed: 50_000, turnsUsed: 1 });
  assert.equal(f.floundered, true);
  assert.ok(f.reasons.includes("no-edit-high-token-burn"));
});

test("flounder: no token-burn when an edit was made", () => {
  const events = [assistantEvent({ name: "Read" }), assistantEvent({ name: "Edit" })];
  const f = detectFlounder({ agentEvents: events, tokensUsed: 50_000, turnsUsed: 1 });
  assert.ok(!f.reasons.includes("no-edit-high-token-burn"));
});

test("flounder: repeated-identical-call fires at >= 3 identical (tool,input)", () => {
  const same = { name: MCP.VALIDATOR, input: {} };
  const events = [assistantEvent(same), assistantEvent(same), assistantEvent(same)];
  const f = detectFlounder({ agentEvents: events, tokensUsed: 100, turnsUsed: 1 });
  assert.equal(f.floundered, true);
  assert.ok(f.reasons.includes("repeated-identical-call"));
  assert.equal(f.signals.maxRepeat, 3);
});

test("flounder: different inputs on same tool do NOT trip repeated-identical-call", () => {
  const events = [
    assistantEvent({ name: MCP.FIND_CONCEPT, input: { name: "A" } }),
    assistantEvent({ name: MCP.FIND_CONCEPT, input: { name: "B" } }),
    assistantEvent({ name: MCP.FIND_CONCEPT, input: { name: "C" } }),
  ];
  const f = detectFlounder({ agentEvents: events, tokensUsed: 100, turnsUsed: 1 });
  assert.ok(!f.reasons.includes("repeated-identical-call"));
});

test("flounder: no-validator-progress fires when an edit didn't reduce errors", () => {
  const events = [assistantEvent({ name: "Edit" })];
  const f = detectFlounder({
    agentEvents: events, tokensUsed: 100, turnsUsed: 1,
    validatorProgress: { before: 3, after: 3 },
  });
  assert.equal(f.floundered, true);
  assert.ok(f.reasons.includes("no-validator-progress"));
});

test("flounder: validator progress (errors dropped) is NOT a flounder", () => {
  const events = [assistantEvent({ name: "Edit" })];
  const f = detectFlounder({
    agentEvents: events, tokensUsed: 100, turnsUsed: 1,
    validatorProgress: { before: 3, after: 1 },
  });
  assert.equal(f.floundered, false);
});

test("flounder: ambiguity-loop fires on >=6 read/validate calls with no edit", () => {
  const events = [];
  for (let i = 0; i < 6; i++) events.push(assistantEvent({ name: i % 2 ? MCP.VALIDATOR : "Read" }));
  const f = detectFlounder({ agentEvents: events, tokensUsed: 100, turnsUsed: 2 });
  assert.equal(f.floundered, true);
  assert.ok(f.reasons.includes("ambiguity-loop"));
});

test("flounder: turn-cap fires at the turn cap", () => {
  const f = detectFlounder({ agentEvents: [], tokensUsed: 100, turnsUsed: 8 });
  assert.equal(f.floundered, true);
  assert.ok(f.reasons.includes("turn-cap"));
});

test("flounder: a healthy converging run floats no flags", () => {
  const events = [
    assistantEvent({ name: MCP.SUMMARY }),
    assistantEvent({ name: "Read", input: { file_path: "concepts.json" } }),
    assistantEvent({ name: "Edit", input: { file_path: "concepts.json" } }),
    assistantEvent({ name: MCP.VALIDATOR }),
    assistantEvent({ name: MCP.INTEGRITY }),
  ];
  const f = detectFlounder({
    agentEvents: events, tokensUsed: 4000, turnsUsed: 1,
    validatorProgress: { before: 2, after: 0 },
  });
  assert.equal(f.floundered, false);
  assert.deepEqual(f.reasons, []);
});

test("flounder: thresholds are overridable", () => {
  const events = [assistantEvent({ name: "Read" })];
  // With a low token floor, even a modest burn trips it.
  const f = detectFlounder({
    agentEvents: events, tokensUsed: 500, turnsUsed: 1,
    thresholds: { tokenBurnFloor: 100 },
  });
  assert.ok(f.reasons.includes("no-edit-high-token-burn"));
});
