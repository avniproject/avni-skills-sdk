// Locks the two new BUNDLE_HARD_RULES clauses to prevent silent drift.
// These rules were added after a real failure on Durga India:
//   - Agent claimed "Fixed ✅" for a C5 error but introduced a C3 regression
//   - Agent added a lowercase "other" concept while "Other" already existed
// Both behaviors are now prohibited by the system prompt. This test pins
// the relevant strings.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function loadRules() {
  const m = await import("../../src/agent.js");
  return m.BUNDLE_HARD_RULES;
}

test("hard rules include CONCEPT-LOOKUP GATE with CLI path", async () => {
  const rules = await loadRules();
  // The rule now points at the forced-tool CLI (not just guidance)
  assert.match(rules, /CONCEPT-LOOKUP GATE/);
  // Should explicitly call out the C3/D1 trap
  assert.match(rules, /C3\/D1/);
  // Should reference the actual CLI path the agent must invoke
  assert.match(rules, /find-concept\.mjs/);
  // Should document the historical incident (so future maintainers know why)
  assert.match(rules, /"Other"/);
  assert.match(rules, /"other"/);
  // And explicitly forbid skipping the step
  assert.match(rules, /HARD-RULE VIOLATION|SKIPPING THIS STEP/);
});

test("hard rules include HONESTY-ON-FIXES guidance", async () => {
  const rules = await loadRules();
  assert.match(rules, /HONESTY ON FIXES/);
  // Should prohibit "Fixed ✅" without a delta prediction
  assert.match(rules, /NEVER say "Fixed/);
  // Should require explicit prediction of validator delta
  assert.match(rules, /validator delta/);
  // Should defer to validator output when contested
  assert.match(rules, /authoritative/);
  // Should require stating the alternative when fixing a structural issue
  assert.match(rules, /alternative you didn't pick/);
});

test("hard rules numbering is contiguous (no skipped numbers)", async () => {
  const rules = await loadRules();
  const ns = [...rules.matchAll(/^(\d+)\./gm)].map((m) => Number(m[1]));
  ns.sort((a, b) => a - b);
  for (let i = 0; i < ns.length; i++) {
    assert.equal(ns[i], i + 1, `rule numbers must be 1..N contiguous; got ${ns.join(",")}`);
  }
  assert.ok(ns.length >= 9, `at least 9 hard rules expected; got ${ns.length}`);
});

test("hard rules include FORM-ELEMENT.CONCEPT SHAPE clause (AVNI upload regression)", async () => {
  const rules = await loadRules();
  assert.match(rules, /FORM-ELEMENT\.CONCEPT SHAPE/);
  assert.match(rules, /Jackson/);
  assert.match(rules, /MismatchedInputException/);
  assert.match(rules, /never.{0,20}flatten/i);
  assert.match(rules, /fix-formelement-concept-shape\.mjs/);
});
