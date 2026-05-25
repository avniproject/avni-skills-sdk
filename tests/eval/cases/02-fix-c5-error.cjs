// 02-fix-c5-error.cjs
//
// What it proves: the agent does the RIGHT fix for C5 — re-points the
// dangling answer back at the EXISTING "Other" UUID instead of inventing
// a new concept (a known regression: see BUNDLE_HARD_RULES rule #6).
//
// Bundle is seeded with one C5 error: Religion's "Other" answer UUID has
// been mutated to a dangling value. The correct standalone "Other" concept
// still exists at its original UUID. After the fix:
//   • validator C5 count: 1 → 0
//   • Religion's "Other" answer UUID equals the original standalone UUID
//   • no NEW "other" concept added (would be a C3/D1 regression)
//   • no validator regression in any other code
//   • bounded cost

"use strict";

module.exports = {
  name: "02-fix-c5-error",
  description:
    "Agent must repoint Religion.answer[Other] back at the existing 'Other' UUID, not add a new concept.",

  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "TestOrgC5Fix" }),
  poison: "C5",

  prompt:
    "There is one validator error in this bundle. Please fix it. " +
    "Use bundle_find_concept before adding any new concepts.",

  maxTurns: 2,
  maxCostUsd: 0.35,

  assertions: async (ctx) => {
    // 1. Validator C5 dropped to zero
    await ctx.assertions.assertValidatorCount({
      getValidator: ctx.getValidator,
      code: "C5",
      expected: 0,
    });

    // 2. Re-point assertion: Religion's Other answer is back at the
    //    original standalone "Other" UUID.
    const correctUuid = ctx.fx.poisonMeta.correctOtherUuid;
    ctx.assertions.assertAnswerUuid(
      ctx.bundleDir,
      "Religion",
      "Other",
      correctUuid,
    );

    // 3. No new concept named "other" (case-insensitive count should be 1).
    const concepts = ctx.assertions.readConceptsJson(ctx.bundleDir);
    const otherCount = concepts.filter(
      (c) => String(c.name || "").trim().toLowerCase() === "other",
    ).length;
    if (otherCount !== 1) {
      throw new Error(`expected exactly 1 "Other" concept, got ${otherCount}`);
    }

    // 4. No regression in any other validator code.
    const v = await ctx.getValidator();
    for (const [code, n] of Object.entries(v.groups || {})) {
      if (n > 0) {
        throw new Error(`unexpected validator code ${code}:${n} after fix`);
      }
    }
  },
};
