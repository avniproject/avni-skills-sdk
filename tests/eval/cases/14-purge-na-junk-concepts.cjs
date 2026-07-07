// 14-purge-na-junk-concepts.cjs  (category: correctness)
//
// What it proves: housekeeping precision. concepts.json has accumulated
// unreferenced dataType:"NA" junk concepts that no form or coded answer points
// at. The agent must remove ONLY the orphans — every concept that is still
// referenced (the Hindu/Muslim/Christian/Other answers of Religion) must
// survive untouched.
//
// The poison appends three orphan NA concepts ("Orphan NA Alpha/Beta/Gamma").
//
// Expectations:
//   • all three orphan NA concepts are gone
//   • the referenced NA concepts (Hindu/Muslim/Christian/Other) still exist
//   • the real content concepts (Full Name/Age/Religion) still exist
//   • no validator regression vs the pre-dispatch baseline

"use strict";

module.exports = {
  name: "14-purge-na-junk-concepts",
  category: "correctness",
  description:
    "[correctness] Remove ONLY unreferenced dataType:NA junk concepts; leave referenced concepts untouched.",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgNAJunk" }),
  poison: "NAJunk",

  prompt:
    "concepts.json has some junk concepts with dataType 'NA' that no form or " +
    "answer references (their names start with 'Orphan NA'). Remove ONLY the " +
    "unreferenced NA junk. Do not touch any concept that is still referenced.",

  maxTurns: 2,
  maxCostUsd: 0.30,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. Every junk concept is gone.
    for (const name of ctx.fx.poisonMeta.junkNames) {
      A.assertConceptDoesNotExist(ctx.bundleDir, name);
    }

    // 2. Referenced NA concepts survive.
    for (const name of ctx.fx.poisonMeta.keepNANames) {
      A.assertConceptExists(ctx.bundleDir, name);
    }

    // 3. Real content concepts survive.
    A.assertConceptExists(ctx.bundleDir, "Religion", { dataType: "Coded" });
    A.assertConceptExists(ctx.bundleDir, "Age", { dataType: "Numeric" });

    // 4. No regression.
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });
  },
};
