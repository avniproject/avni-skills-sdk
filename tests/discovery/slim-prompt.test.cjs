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

test("the outcome contract is slim (~250 words) and states the required outcomes", async () => {
  const m = await load();
  const c = m.BUNDLE_OUTCOME_CONTRACT;
  const words = wc(c);
  // Completeness over exact count: the contract carries the integrity+validator
  // gates, the two server-only traps, and the C3/C5/committer invariants the
  // hard rules enforce — so it sits ~250 words. Still far below the ~1,181-word
  // hard rules. The bound guards "slim", not a magic number.
  assert.ok(words >= 150 && words <= 340, `outcome contract should be slim (~250 words), got ${words}`);
  assert.ok(words < wc(m.BUNDLE_HARD_RULES), "the slim contract must stay well under the full hard rules");
  // States the two gates (outcome, not procedure).
  assert.match(c, /bundle_integrity_check/);
  assert.match(c, /validator/);
  // The two server-only invariants.
  assert.match(c, /formElement\.concept/);
  assert.match(c, /nested object/i);
  assert.match(c, /addressLevelType/);
  assert.match(c, /< > = " '/);
  // The invariants the hard rules enforce that the slim contract must also carry
  // (M1 from #9): case-insensitive concept search before create (C3/D1 via
  // bundle_find_concept), coded answers exist as standalone concepts (C5), and
  // the no-git / server-is-the-committer rule.
  assert.match(c, /bundle_find_concept/, "must carry the C3/D1 case-insensitive concept-search invariant");
  assert.match(c, /\bC5\b/, "must carry the C5 coded-answer-is-a-standalone-concept invariant");
  assert.match(c, /committer/, "must carry the server-is-the-sole-committer / no-git invariant");
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
