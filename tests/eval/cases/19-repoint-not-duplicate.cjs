// 19-repoint-not-duplicate.cjs  (category: data-integrity)
//
// What it proves: the canonical C5 repair. A coded answer's UUID has been
// mutated to dangle (C5), while the correct standalone "Other" concept still
// exists at its original UUID. The agent must REPOINT the answer back at the
// existing "Other" — it must NOT mint a SECOND "Other" concept (a C3/D1
// duplicate). This is the anti-duplication invariant stated bluntly.
//
// Expectations:
//   • validator C5 count → 0
//   • Religion.answer[Other] points at the existing standalone "Other" UUID
//   • exactly one "Other" concept exists (no duplicate)
//   • no validator regression vs the pre-dispatch baseline

"use strict";

module.exports = {
  name: "19-repoint-not-duplicate",
  description:
    "[data-integrity] Fix C5 by repointing to the existing 'Other' concept — never create a second one.",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgRepoint" }),
  poison: "C5",

  prompt:
    "A coded answer references a concept UUID that no longer exists (validator " +
    "C5). There is already a standalone 'Other' concept in the bundle — repoint " +
    "the answer at THAT existing concept. Do not create a second 'Other'.",

  maxTurns: 2,
  maxCostUsd: 0.30,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. C5 cleared.
    await A.assertValidatorCount({ getValidator: ctx.getValidator, code: "C5", expected: 0 });

    // 2. Repointed at the EXISTING "Other" UUID.
    A.assertAnswerUuid(ctx.bundleDir, "Religion", "Other", ctx.fx.poisonMeta.correctOtherUuid);

    // 3. Exactly one "Other" — no duplicate minted.
    A.assertConceptCountByName(ctx.bundleDir, "Other", 1);

    // 4. No regression.
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });
  },
};
