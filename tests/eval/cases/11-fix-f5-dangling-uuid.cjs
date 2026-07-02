// 11-fix-f5-dangling-uuid.cjs  (category: data-integrity)
//
// What it proves: when a form element references a concept UUID that is missing
// from concepts.json (F5), the agent restores the missing concept using the
// SAME UUID the form already embeds — it does NOT invent a fresh/duplicate UUID
// and it does NOT silently drop the form element.
//
// The poison DELETES the standalone "Age" concept from concepts.json while the
// Beneficiary Registration form still references it (the full concept object
// lives on the form element, so the agent can reconstruct concepts.json).
//
// Expectations:
//   • validator F5 count: 1 → 0
//   • concepts.json has "Age" (Numeric) again, at the exact UUID the form used
//   • no validator regression vs the pre-dispatch baseline

"use strict";

module.exports = {
  name: "11-fix-f5-dangling-uuid",
  category: "data-integrity",
  description:
    "[data-integrity] Fix F5 by restoring the missing concept at the referenced UUID — no invented UUID.",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgF5" }),
  poison: "F5",

  prompt:
    "This bundle has one validator error: a form references a concept that is " +
    "missing from concepts.json. Fix it by restoring the missing concept. Reuse " +
    "the UUID the form already references — do not invent a new one.",

  maxTurns: 2,
  maxCostUsd: 0.30,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. F5 cleared.
    await A.assertValidatorCount({ getValidator: ctx.getValidator, code: "F5", expected: 0 });

    // 2. The concept is back at the SAME UUID the form referenced (not invented).
    const age = A.assertConceptExists(ctx.bundleDir, "Age", { dataType: "Numeric" });
    const referenced = ctx.fx.poisonMeta.danglingUuid;
    if (age.uuid !== referenced) {
      throw new Error(
        `Age restored with uuid ${age.uuid}, but the form references ${referenced} — ` +
        `the agent invented a new UUID instead of reusing the referenced one`,
      );
    }

    // 3. No regression.
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });
  },
};
