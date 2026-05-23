// Tests for src/agent-output-schema.js — parses + validates the
// {intent, target_phase, ambiguities, applied_changes, reason} JSON contract
// matching avniproject/avni-ai prompts/spec-agent.txt.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() {
  return await import("../../src/agent-output-schema.js?t=" + Date.now());
}

// ─── parseAgentOutput ────────────────────────────────────────────────

test("parseAgentOutput: extracts the trailing fenced JSON block", async () => {
  const { parseAgentOutput } = await load();
  const text = `Here's what I did.

\`\`\`json
{"intent": "applied_fix", "target_phase": "bundle_generating", "reason": "OK"}
\`\`\``;
  const r = parseAgentOutput(text);
  assert.deepEqual(r.errors, []);
  assert.equal(r.json.intent, "applied_fix");
});

test("parseAgentOutput: when multiple json blocks exist, uses the LAST one (contract)", async () => {
  const { parseAgentOutput } = await load();
  const text = `Illustrative example:
\`\`\`json
{"intent": "ask_user"}
\`\`\`

Actual output:
\`\`\`json
{"intent": "phase_complete", "target_phase": "ready_to_upload", "reason": "done"}
\`\`\``;
  const r = parseAgentOutput(text);
  assert.equal(r.json.intent, "phase_complete");
});

test("parseAgentOutput: no json block → error", async () => {
  const { parseAgentOutput } = await load();
  const r = parseAgentOutput("Just plain narrative, no fence.");
  assert.equal(r.json, null);
  assert.match(r.errors[0], /no.*json.*block/i);
});

test("parseAgentOutput: malformed JSON → error message includes parse detail", async () => {
  const { parseAgentOutput } = await load();
  const r = parseAgentOutput('Here:\n```json\n{not valid}\n```');
  assert.equal(r.json, null);
  assert.match(r.errors[0], /malformed JSON/);
});

test("parseAgentOutput: non-string input rejected", async () => {
  const { parseAgentOutput } = await load();
  const r = parseAgentOutput(null);
  assert.match(r.errors[0], /string/);
});

// ─── validateAgentOutput ─────────────────────────────────────────────

test("validateAgentOutput: minimal valid object", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({
    intent: "phase_complete",
    target_phase: "ready_to_upload",
    reason: "done",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("validateAgentOutput: missing required fields", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({});
  assert.equal(r.ok, false);
  assert.ok(r.errors.find((e) => e.includes("intent")));
  assert.ok(r.errors.find((e) => e.includes("target_phase")));
  assert.ok(r.errors.find((e) => e.includes("reason")));
});

test("validateAgentOutput: invalid intent enum value", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({
    intent: "bogus",
    target_phase: "ready_to_upload",
    reason: "x",
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.find((e) => e.includes('intent')));
});

test("validateAgentOutput: invalid target_phase enum value", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({
    intent: "applied_fix",
    target_phase: "nonexistent_phase",
    reason: "x",
    applied_changes: [{ section: "forms", operation: "add" }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.find((e) => e.includes('target_phase')));
});

test("validateAgentOutput: ask_user without ambiguities → error (semantic guard)", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({
    intent: "ask_user",
    target_phase: "spec_awaiting_user",
    reason: "x",
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.find((e) => e.includes("ask_user")));
});

test("validateAgentOutput: applied_fix without applied_changes → error", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({
    intent: "applied_fix",
    target_phase: "bundle_correcting",
    reason: "x",
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.find((e) => e.includes("applied_fix")));
});

test("validateAgentOutput: ambiguity item shape — id + question required", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({
    intent: "ask_user",
    target_phase: "spec_awaiting_user",
    reason: "x",
    ambiguities: [{ options: ["A", "B"] }],   // missing id + question
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.find((e) => e.includes("ambiguities[0].id")));
  assert.ok(r.errors.find((e) => e.includes("ambiguities[0].question")));
});

test("validateAgentOutput: applied_changes invalid operation rejected", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({
    intent: "applied_fix",
    target_phase: "bundle_correcting",
    reason: "x",
    applied_changes: [{ section: "forms", operation: "delete" }],     // "delete" not in enum
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.find((e) => e.includes("operation")));
});

test("validateAgentOutput: reason length cap enforced", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({
    intent: "phase_complete",
    target_phase: "ready_to_upload",
    reason: "x".repeat(501),
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.find((e) => e.includes("500 characters")));
});

test("validateAgentOutput: a realistic Spec Agent output passes", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({
    intent: "applied_fix",
    target_phase: "bundle_generating",
    reason: "Updated subject_types section per user instruction to remove Draft entries.",
    applied_changes: [
      { section: "subject_types", operation: "remove", item_names: ["Draft Child"], reason: "user-flagged" },
    ],
    ambiguities: [],
  });
  assert.equal(r.ok, true);
});

test("validateAgentOutput: a realistic Spec Agent ask_user output passes", async () => {
  const { validateAgentOutput } = await load();
  const r = validateAgentOutput({
    intent: "ask_user",
    target_phase: "spec_awaiting_user",
    reason: "Two structural gaps need user input before continuing.",
    ambiguities: [
      {
        id: "ambig-1",
        question: "Subject type 'Volunteer' has no registration form. Create an empty one?",
        options: ["Yes — empty skeleton", "Skip — Volunteer is intentionally subject-less"],
        target_section: "forms",
        target_store: "entities",
      },
    ],
    applied_changes: [],
  });
  assert.equal(r.ok, true);
});

// ─── Agent configs ───────────────────────────────────────────────────

test("listAgentNames returns the 3 canonical agents", async () => {
  const { listAgentNames } = await import("../../src/agents/index.js?t=" + Date.now());
  assert.deepEqual(listAgentNames().sort(), ["bundle-config", "review", "spec"]);
});

test("each agent config has required fields", async () => {
  const { AGENTS_BY_NAME } = await import("../../src/agents/index.js?t=" + Date.now());
  for (const [name, cfg] of Object.entries(AGENTS_BY_NAME)) {
    assert.equal(typeof cfg.name, "string", `${name}: name`);
    assert.equal(typeof cfg.systemPrompt, "string", `${name}: systemPrompt`);
    assert.ok(cfg.systemPrompt.length > 100, `${name}: systemPrompt too short`);
    assert.ok(Array.isArray(cfg.allowedTools), `${name}: allowedTools`);
    assert.equal(cfg.skillScope, "bundle-authoring", `${name}: skillScope`);
    assert.equal(typeof cfg.outputSchema, "object", `${name}: outputSchema`);
  }
});

test("every agent's system prompt references the structured-output contract", async () => {
  const { AGENTS_BY_NAME } = await import("../../src/agents/index.js?t=" + Date.now());
  for (const [name, cfg] of Object.entries(AGENTS_BY_NAME)) {
    assert.match(cfg.systemPrompt, /structured output contract/i, `${name} prompt`);
    assert.match(cfg.systemPrompt, /intent/, `${name} prompt mentions intent field`);
    assert.match(cfg.systemPrompt, /target_phase/, `${name} prompt mentions target_phase`);
  }
});

test("review agent has read-only tools (no Edit/Write)", async () => {
  const { REVIEW_AGENT } = await import("../../src/agents/index.js?t=" + Date.now());
  assert.ok(!REVIEW_AGENT.allowedTools.includes("Edit"));
  assert.ok(!REVIEW_AGENT.allowedTools.includes("Write"));
});

test("spec + bundle-config agents have Edit/Write (mutate)", async () => {
  const { SPEC_AGENT, BUNDLE_CONFIG_AGENT } = await import("../../src/agents/index.js?t=" + Date.now());
  for (const cfg of [SPEC_AGENT, BUNDLE_CONFIG_AGENT]) {
    assert.ok(cfg.allowedTools.includes("Edit"), `${cfg.name}: Edit`);
    assert.ok(cfg.allowedTools.includes("Write"), `${cfg.name}: Write`);
  }
});

test("getAgent returns null for unknown name (caller handles)", async () => {
  const { getAgent } = await import("../../src/agents/index.js?t=" + Date.now());
  assert.equal(getAgent("bogus"), null);
  assert.equal(getAgent("spec"), undefined === null ? null : (await import("../../src/agents/index.js?t=" + Date.now())).SPEC_AGENT);
});

// ─── End-to-end: parse + validate a realistic agent response ────────

test("parse + validate flow: realistic Bundle Config Agent response", async () => {
  const { parseAgentOutput, validateAgentOutput } = await load();
  const response = `
I read the validator output and found 2 F2 errors in \`forms/ANC_xxx.json\`.
Removed the duplicate Gender field at displayOrder 4, kept the one at
displayOrder 2.

\`\`\`json
{
  "intent": "applied_fix",
  "target_phase": "bundle_correcting",
  "reason": "Removed duplicate Gender field from forms/ANC_xxx.json (F2).",
  "applied_changes": [
    {
      "section": "forms",
      "operation": "update",
      "item_names": ["ANC"],
      "reason": "F2: duplicate Gender concept in same form"
    }
  ],
  "ambiguities": []
}
\`\`\``;
  const parsed = parseAgentOutput(response);
  assert.deepEqual(parsed.errors, []);
  const v = validateAgentOutput(parsed.json);
  assert.equal(v.ok, true, "errors: " + v.errors.join("; "));
});
