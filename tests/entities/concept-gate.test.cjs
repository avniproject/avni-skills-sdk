// Server-side concept-collision interceptor — pure unit tests.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() { return await import("../../src/rules-brain/concept-gate.js"); }

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const UUID_C = "33333333-3333-3333-3333-333333333333";

test("clean add (no collision) returns no violations", async () => {
  const { detectConceptCollisions } = await load();
  const old = [{ name: "Religion", uuid: UUID_A, dataType: "Coded" }];
  const next = [
    { name: "Religion", uuid: UUID_A, dataType: "Coded" },
    { name: "Brand New", uuid: UUID_B, dataType: "NA" },
  ];
  const { collisions } = detectConceptCollisions(old, next);
  assert.equal(collisions.length, 0);
});

test("case-different new concept colliding with existing → flagged", async () => {
  const { detectConceptCollisions } = await load();
  const old = [{ name: "Other", uuid: UUID_A, dataType: "NA" }];
  const next = [
    { name: "Other", uuid: UUID_A, dataType: "NA" },
    { name: "other", uuid: UUID_B, dataType: "NA" }, // <- the bug we're catching
  ];
  const { collisions } = detectConceptCollisions(old, next);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].newConcept.uuid, UUID_B);
  assert.equal(collisions[0].existingConcept.uuid, UUID_A);
  assert.equal(collisions[0].kind, "case-only");
});

test("two new concepts colliding with each other → flagged", async () => {
  const { detectConceptCollisions } = await load();
  const old = [];
  const next = [
    { name: "Female", uuid: UUID_A, dataType: "NA" },
    { name: "female", uuid: UUID_B, dataType: "NA" }, // also new
  ];
  const { collisions } = detectConceptCollisions(old, next);
  // One of them is flagged (the one with the higher-indexed UUID in
  // newConcepts order, since we iterate forward and find an earlier match)
  assert.ok(collisions.length >= 1);
  assert.ok(collisions.some((v) => v.newConcept.uuid === UUID_B));
});

test("editing an existing concept's name to clash is NOT flagged (different rule)", async () => {
  const { detectConceptCollisions } = await load();
  // UUID_A already existed; user renames it to clash with UUID_B. We skip
  // this — it's a different validator-level concern. The interceptor is
  // specifically about NEW concepts being added.
  const old = [
    { name: "Foo", uuid: UUID_A, dataType: "NA" },
    { name: "Bar", uuid: UUID_B, dataType: "NA" },
  ];
  const next = [
    { name: "Bar", uuid: UUID_A, dataType: "NA" }, // renamed
    { name: "Bar", uuid: UUID_B, dataType: "NA" },
  ];
  const { collisions } = detectConceptCollisions(old, next);
  assert.equal(collisions.length, 0, "rename collisions are out of scope for this gate");
});

test("trailing whitespace normalized — collides with stripped name", async () => {
  const { detectConceptCollisions } = await load();
  const old = [{ name: "Yes", uuid: UUID_A, dataType: "NA" }];
  const next = [
    { name: "Yes", uuid: UUID_A, dataType: "NA" },
    { name: "yes ", uuid: UUID_B, dataType: "NA" }, // trailing space
  ];
  const { collisions } = detectConceptCollisions(old, next);
  assert.equal(collisions.length, 1, "should detect collision after normalize");
});

test("violation message mentions both UUIDs + suggests reuse", async () => {
  const { detectConceptCollisions, formatViolationMessage } = await load();
  const old = [{ name: "Other", uuid: UUID_A }];
  const next = [...old, { name: "other", uuid: UUID_B }];
  const { collisions } = detectConceptCollisions(old, next);
  const msg = formatViolationMessage(collisions);
  assert.ok(msg.includes(UUID_A));
  assert.ok(msg.includes(UUID_B));
  assert.match(msg, /reuse/i);
  assert.match(msg, /bundle_find_concept/);
  assert.doesNotMatch(msg, /\/Users\//); // no hardcoded absolute machine path
});

test("accepts dict-shaped concepts.json ({concepts: [...]})", async () => {
  const { detectConceptCollisions } = await load();
  const old = { concepts: [{ name: "Foo", uuid: UUID_A }] };
  const next = { concepts: [{ name: "Foo", uuid: UUID_A }, { name: "foo", uuid: UUID_B }] };
  const { collisions } = detectConceptCollisions(old, next);
  assert.equal(collisions.length, 1);
});
