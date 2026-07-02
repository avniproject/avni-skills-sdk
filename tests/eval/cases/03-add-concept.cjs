// 03-add-concept.cjs  (category: data-integrity)
//
// What it proves: when the user asks to "add a concept" whose name COLLIDES
// (case-insensitively) with an existing one, the agent must call
// `bundle_find_concept` FIRST and must NOT append a duplicate. The base bundle
// already has a "Religion" (Coded) concept; the user asks for "religion"
// (lowercase). C3/D1 fire on case-insensitive concept-name collisions, so the
// right move is to reuse — not add.
//
// Expectations:
//   • bundle_find_concept is called (and, if any concepts.json edit happens, it
//     happens AFTER the lookup)
//   • case-insensitive count of "religion" stays exactly 1 (no duplicate)
//   • no C3/D1 (or any) validator regression vs the pre-dispatch baseline

"use strict";

module.exports = {
  name: "03-add-concept",
  description:
    "[data-integrity] Agent must call bundle_find_concept before adding a concept and refuse to duplicate on a case-insensitive collision.",

  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "TestOrgAddConcept" }),

  prompt:
    "Add a new concept named 'religion' with dataType Text. " +
    "Check for an existing concept first so we don't create a duplicate.",

  maxTurns: 2,
  maxCostUsd: 0.20,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. The lookup gate ran.
    A.assertToolUsed(ctx.agentEvents, (t) =>
      String(t.name || "").includes("bundle_find_concept"),
    );

    // 2. If the agent edited concepts.json at all, the lookup must precede it.
    const tools = A.listToolUses(ctx.agentEvents);
    const editsConcepts = (t) =>
      A.isFileEditTool(t) && /concepts\.json/.test(JSON.stringify(t.input || {}));
    if (tools.some(editsConcepts)) {
      A.assertToolOrder(ctx.agentEvents, {
        first: (t) => String(t.name || "").includes("bundle_find_concept"),
        then: editsConcepts,
        label: "find_concept before concepts.json edit",
      });
    }

    // 3. No duplicate "religion" concept.
    A.assertConceptCountByName(ctx.bundleDir, "religion", 1);

    // 4. No validator regression (C3/D1 etc.).
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });
  },
};
