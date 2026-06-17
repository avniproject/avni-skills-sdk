// tests/discovery/slim-prompt.test.cjs
//
// Pins the OPT-IN slim outcome contract behaviour in src/agent.js:
//   • DEFAULT (SDK_DISCOVERY_PROMPT unset) → the full BUNDLE_HARD_RULES, unchanged.
//   • SDK_DISCOVERY_PROMPT=1 → the ~210-word BUNDLE_OUTCOME_CONTRACT.
//   • The contract states the outcomes the design requires + points at the skill.
//
// No API spend — pure string + env-flag checks.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() { return import("../../src/agent.js"); }

const wc = (s) => s.trim().split(/\s+/).length;

test("default (env unset): activeRulesBlock is the full hard rules", async () => {
  delete process.env.SDK_DISCOVERY_PROMPT;
  const m = await load();
  assert.equal(m.discoveryPromptEnabled(), false);
  assert.equal(m.activeRulesBlock(), m.BUNDLE_HARD_RULES);
  // The hard rules are the ~1,181-word block — the default must NOT shrink.
  assert.ok(wc(m.BUNDLE_HARD_RULES) > 1000, "default hard rules must remain the full block");
});

test("SDK_DISCOVERY_PROMPT=1: activeRulesBlock swaps to the slim outcome contract", async () => {
  const prev = process.env.SDK_DISCOVERY_PROMPT;
  process.env.SDK_DISCOVERY_PROMPT = "1";
  try {
    const m = await load();
    assert.equal(m.discoveryPromptEnabled(), true);
    assert.equal(m.activeRulesBlock(), m.BUNDLE_OUTCOME_CONTRACT);
  } finally {
    if (prev === undefined) delete process.env.SDK_DISCOVERY_PROMPT;
    else process.env.SDK_DISCOVERY_PROMPT = prev;
  }
});

test("SDK_DISCOVERY_PROMPT=true is also accepted", async () => {
  const prev = process.env.SDK_DISCOVERY_PROMPT;
  process.env.SDK_DISCOVERY_PROMPT = "true";
  try {
    const m = await load();
    assert.equal(m.discoveryPromptEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.SDK_DISCOVERY_PROMPT;
    else process.env.SDK_DISCOVERY_PROMPT = prev;
  }
});

test("the outcome contract is ~210 words and states the required outcomes", async () => {
  const m = await load();
  const c = m.BUNDLE_OUTCOME_CONTRACT;
  const words = wc(c);
  assert.ok(words >= 150 && words <= 280, `outcome contract should be ~210 words, got ${words}`);
  // States the two gates (outcome, not procedure).
  assert.match(c, /bundle_integrity_check/);
  assert.match(c, /validator/);
  // The two server-only invariants.
  assert.match(c, /formElement\.concept/);
  assert.match(c, /nested object/i);
  assert.match(c, /addressLevelType/);
  assert.match(c, /< > = " '/);
  // Points at the skill for the "how".
  assert.match(c, /avni-bundle-spec/);
  // Does NOT re-enumerate the long procedural rules (no rule-numbering 1..12 prose).
  assert.ok(!/CONCEPT-LOOKUP GATE/.test(c), "the slim contract must NOT re-import procedural hard-rule prose");
});

test("the default DEFAULT_SYSTEM_PROMPT path is unchanged when the flag is off", async () => {
  delete process.env.SDK_DISCOVERY_PROMPT;
  const m = await load();
  // activeRulesBlock under default == the hard rules; this is what the system
  // prompt embeds, so the default agent behaviour is byte-for-byte unchanged.
  assert.ok(m.activeRulesBlock().includes("HARD RULES"));
});
