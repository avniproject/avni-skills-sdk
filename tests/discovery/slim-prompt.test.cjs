// tests/discovery/slim-prompt.test.cjs
//
// Pins the rules-block selection in src/agent.js after story #11:
//   • DEFAULT (SDK_LEGACY_RULES unset) → the slim BUNDLE_OUTCOME_CONTRACT.
//   • SDK_LEGACY_RULES=1 → backs out to the full legacy BUNDLE_HARD_RULES.
//   • The contract states the outcomes the design requires + points at the skill.
//
// No API spend — pure string + env-flag checks.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() { return import("../../src/agent.js"); }

const wc = (s) => s.trim().split(/\s+/).length;

test("default (env unset): activeRulesBlock is the slim outcome contract", async () => {
  const prev = process.env.SDK_LEGACY_RULES;
  delete process.env.SDK_LEGACY_RULES;
  try {
    const m = await load();
    assert.equal(m.legacyRulesEnabled(), false);
    assert.equal(m.activeRulesBlock(), m.BUNDLE_OUTCOME_CONTRACT);
  } finally {
    if (prev === undefined) delete process.env.SDK_LEGACY_RULES;
    else process.env.SDK_LEGACY_RULES = prev;
  }
});

test("SDK_LEGACY_RULES=1: activeRulesBlock backs out to the full hard rules", async () => {
  const prev = process.env.SDK_LEGACY_RULES;
  process.env.SDK_LEGACY_RULES = "1";
  try {
    const m = await load();
    assert.equal(m.legacyRulesEnabled(), true);
    assert.equal(m.activeRulesBlock(), m.BUNDLE_HARD_RULES);
    // The hard rules are the ~1,181-word block — the backout must restore it.
    assert.ok(wc(m.BUNDLE_HARD_RULES) > 1000, "legacy hard rules must remain the full block");
  } finally {
    if (prev === undefined) delete process.env.SDK_LEGACY_RULES;
    else process.env.SDK_LEGACY_RULES = prev;
  }
});

test("SDK_LEGACY_RULES=true is also accepted as the backout trigger", async () => {
  const prev = process.env.SDK_LEGACY_RULES;
  process.env.SDK_LEGACY_RULES = "true";
  try {
    const m = await load();
    assert.equal(m.legacyRulesEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.SDK_LEGACY_RULES;
    else process.env.SDK_LEGACY_RULES = prev;
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

test("the default system prompt embeds the slim contract when no backout flag is set", async () => {
  const prev = process.env.SDK_LEGACY_RULES;
  delete process.env.SDK_LEGACY_RULES;
  try {
    const m = await load();
    // activeRulesBlock under default == the slim contract; this is what the
    // system prompt embeds, so the default agent runs on the outcome contract.
    assert.ok(m.activeRulesBlock().includes("OUTCOME CONTRACT"));
  } finally {
    if (prev === undefined) delete process.env.SDK_LEGACY_RULES;
    else process.env.SDK_LEGACY_RULES = prev;
  }
});
