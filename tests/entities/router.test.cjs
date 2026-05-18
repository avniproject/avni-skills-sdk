// Router test — pins the keyword routing so behaviour can't drift silently.
// These keywords are derived from real failure modes observed on Durga India:
// the C5→C3 regression that Haiku couldn't avoid required Sonnet.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() { return await import("../../src/router.js"); }

test("vague prompt → haiku (default)", async () => {
  const { routePrompt } = await load();
  const r = routePrompt("look at the bundle and tell me what to fix");
  assert.equal(r.modelAlias, "haiku");
});

test("concept dedup → sonnet", async () => {
  const { routePrompt } = await load();
  for (const p of [
    "deduplicate the duplicate 'Other' concept",
    "rename concept Religion → Faith",
    "the C3 error needs case-insensitive lookup",
  ]) {
    const r = routePrompt(p);
    assert.equal(r.modelAlias, "sonnet", `expected sonnet for "${p}", got ${r.modelAlias} (${r.reason})`);
  }
});

test("schema decision → sonnet", async () => {
  const { routePrompt } = await load();
  for (const p of [
    "add a new subject type for Households",
    "change the dataType of Age from Numeric to Text",
    "add encounter type for Vaccination",
    "fix form mapping for the ANC form",
  ]) {
    const r = routePrompt(p);
    assert.equal(r.modelAlias, "sonnet", `expected sonnet for "${p}", got ${r.modelAlias}`);
  }
});

test("cross-bundle rename → sonnet", async () => {
  const { routePrompt } = await load();
  const r = routePrompt("Rename the BPSystolic concept across the bundle including rule bodies");
  assert.equal(r.modelAlias, "sonnet");
});

test("simple rule edit → haiku", async () => {
  const { routePrompt } = await load();
  const r = routePrompt("Add a validationRule on the Cohort form that rejects negative ages");
  assert.equal(r.modelAlias, "haiku", `expected haiku for cheap rule add; got ${r.modelAlias} (${r.reason})`);
});

test("trailing-whitespace fix → haiku", async () => {
  const { routePrompt } = await load();
  const r = routePrompt('remove the trailing space from "Cohort Endline "');
  assert.equal(r.modelAlias, "haiku");
});

test("explicit override bypasses heuristics", async () => {
  const { routePrompt } = await load();
  const r = routePrompt("Rename concept Foo to Bar", { explicit: "claude-haiku-4-5-20251001" });
  assert.equal(r.modelAlias, "haiku");
  assert.match(r.reason, /explicit/);
});

test("alias resolves explicit short names", async () => {
  const { routePrompt } = await load();
  const r1 = routePrompt("anything", { explicit: "sonnet" });
  assert.equal(r1.modelAlias, "sonnet");
  assert.equal(r1.model, "claude-sonnet-4-6");
});

test("comprehensive audit → opus", async () => {
  const { routePrompt } = await load();
  const r = routePrompt("Do a comprehensive audit of the bundle structure");
  assert.equal(r.modelAlias, "opus");
});

test("C5 / orphan-uuid error → sonnet (added after observed cross-file failure)", async () => {
  const { routePrompt } = await load();
  for (const p of [
    "Fix the C5 validator error in concepts.json",
    "Answer UUID mismatch in Participant Details form",
    "Update the answer concept uuid across the bundle",
  ]) {
    const r = routePrompt(p);
    assert.equal(r.modelAlias, "sonnet", `expected sonnet for "${p}", got ${r.modelAlias}`);
  }
});

test("returns reason that names the trigger", async () => {
  const { routePrompt } = await load();
  const r = routePrompt("Rename concept Pregnancy");
  assert.match(r.reason, /rename/i);
  // reason references the keyword that hit
  assert.ok(r.reason.includes("→"), `expected reason to include →: "${r.reason}"`);
});
