// Pins the ACTIVE agent rules block — the slim BUNDLE_OUTCOME_CONTRACT, which
// became the default in story #11 (the deterministic gate layer now enforces
// every invariant the old prose hard rules merely described).
//
// This guard exists because of a real failure on Durga India:
//   - Agent claimed "Fixed ✅" for a C5 error but introduced a C3 regression
//   - Agent added a lowercase "other" concept while "Other" already existed
// The slim contract must KEEP carrying those invariants (C3 find-before-create,
// C5 coded-answer-is-a-concept) plus the two server-only traps the validator
// can't see (formElement.concept shape, addressLevelType name chars) and the
// sole-committer rule. If a future edit drops one of these from the contract,
// this test fails — retargeted from the legacy hard-rules text, not deleted.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function loadAgent() {
  return import("../../src/agent.js");
}
async function loadContract() {
  return (await loadAgent()).BUNDLE_OUTCOME_CONTRACT;
}

test("slim contract is the active rules block by default (SDK_LEGACY_RULES unset)", async () => {
  const prev = process.env.SDK_LEGACY_RULES;
  delete process.env.SDK_LEGACY_RULES;
  try {
    const m = await loadAgent();
    assert.equal(m.activeRulesBlock(), m.BUNDLE_OUTCOME_CONTRACT,
      "default rules block must be the slim outcome contract");
    assert.equal(m.legacyRulesEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.SDK_LEGACY_RULES;
    else process.env.SDK_LEGACY_RULES = prev;
  }
});

test("SDK_LEGACY_RULES=1 backs out to the full legacy hard rules", async () => {
  const prev = process.env.SDK_LEGACY_RULES;
  process.env.SDK_LEGACY_RULES = "1";
  try {
    const m = await loadAgent();
    assert.equal(m.legacyRulesEnabled(), true);
    assert.equal(m.activeRulesBlock(), m.BUNDLE_HARD_RULES,
      "SDK_LEGACY_RULES=1 must restore the legacy prose ruleset");
  } finally {
    if (prev === undefined) delete process.env.SDK_LEGACY_RULES;
    else process.env.SDK_LEGACY_RULES = prev;
  }
});

test("contract carries the integrity + validator zero-error gate", async () => {
  const c = await loadContract();
  assert.match(c, /bundle_integrity_check/, "must require the integrity check");
  assert.match(c, /validator/, "must require the validator to be clean");
  assert.match(c, /zero errors/i, "must state zero-errors as the gate");
});

test("contract carries the formElement.concept-is-an-object trap (Jackson/upload)", async () => {
  const c = await loadContract();
  assert.match(c, /formElement\.concept/);
  assert.match(c, /nested object/i, "concept must be a nested object, never a bare UUID");
  assert.match(c, /bare UUID string/i);
});

test("contract carries the addressLevelType name-chars trap", async () => {
  const c = await loadContract();
  assert.match(c, /addressLevelType/);
  // The exact forbidden character set the server's LocationService rejects.
  assert.match(c, /< > = " '/);
});

test("contract carries C3 find-before-create (case-insensitive concept reuse)", async () => {
  const c = await loadContract();
  assert.match(c, /\bC3\b/);
  assert.match(c, /case-insensitive/i);
  assert.match(c, /bundle_find_concept/, "must point at the mandatory concept-search tool");
  assert.match(c, /reuse a match's UUID/i);
});

test("contract carries C5 coded-answer-is-a-standalone-concept", async () => {
  const c = await loadContract();
  assert.match(c, /\bC5\b/);
  assert.match(c, /Coded concept/i);
  assert.match(c, /answer is itself a concept|standalone concept/i);
});

test("contract carries no-invented-UUIDs / no-invented-enums + same-turn resolution", async () => {
  const c = await loadContract();
  assert.match(c, /v4-shaped/i, "UUIDs must be v4-shaped");
  assert.match(c, /invented enum/i);
  assert.match(c, /same turn/i, "references must resolve in the same turn (no dangling refs)");
});

test("contract carries the server-is-the-sole-committer (no-git) invariant", async () => {
  const c = await loadContract();
  assert.match(c, /committer/, "must state the server is the sole committer");
  assert.match(c, /git add -A && git commit/, "must name the server's commit command");
  assert.match(c, /Read-only git/i, "read-only git stays allowed");
});

test("contract points at the avni-bundle-spec skill for the HOW (no procedural prose)", async () => {
  const c = await loadContract();
  assert.match(c, /avni-bundle-spec/, "must defer the HOW to the skill");
  // It must NOT re-import the long procedural hard-rule prose.
  assert.ok(!/CONCEPT-LOOKUP GATE/.test(c),
    "the slim contract must not re-import procedural hard-rule prose");
});

test("the contract stays slim (well under the legacy hard rules)", async () => {
  const m = await loadAgent();
  const words = (s) => s.trim().split(/\s+/).length;
  const contractWords = words(m.BUNDLE_OUTCOME_CONTRACT);
  assert.ok(contractWords < words(m.BUNDLE_HARD_RULES),
    "slim contract must stay well under the legacy hard rules");
  assert.ok(contractWords <= 340, `contract should stay slim (~250 words); got ${contractWords}`);
});
