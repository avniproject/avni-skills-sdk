// 17-large-bundle-converges.cjs  (category: correctness)
//
// What it proves: on a LARGE bundle (18 subject-type registration forms) with a
// handful of seeded errors, the agent converges to a clean validator within a
// small turn/cost budget — without regressing the ~17 forms it wasn't asked to
// touch.
//
// The fixture is a large, otherwise-clean bundle; the poison seeds a MIX: C5
// (dangling coded answer), plus F1 (duplicate displayOrder) + F2 (same concept
// twice) from a cloned form element.
//
// Expectations:
//   • final validator is clean (0 errors)
//   • no NEW validator code appeared vs the pre-dispatch baseline
//   • stayed under the per-case cost cap

"use strict";

module.exports = {
  name: "17-large-bundle-converges",
  description:
    "[correctness] Large bundle + mixed seeded errors → converges to 0 errors under budget, no collateral regression.",

  setupFixture: ({ fixture }) => fixture.buildLargeSrs({ org: "TestOrgLarge", formCount: 18 }),
  poison: "C5+F2",

  prompt:
    "This bundle has a few validator errors. Fix ALL of them so the bundle is " +
    "upload-ready. Don't touch anything that isn't broken.",

  maxTurns: 4,
  maxCostUsd: 0.60,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. Converged to clean.
    await A.assertValidatorClean({ getValidator: ctx.getValidator });

    // 2. No new code appeared vs baseline (collateral-regression guard).
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });

    // (cost cap enforced by the runner via maxCostUsd)
  },
};
