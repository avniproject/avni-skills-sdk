// 05-rename-concept.cjs  (category: data-integrity)
//
// What it proves: renaming a concept is a CROSS-FILE operation. The new name
// must land in concepts.json AND in the NESTED concept object of every form
// that embeds it (the slim contract requires the full ConceptContract object on
// each form element). The UUID must NOT change — if it did, forms would dangle
// (F5). The validator must stay clean.
//
// Expectations:
//   • concepts.json: "Religion" gone, "Faith" present (same UUID)
//   • every form embedding that UUID has concept.name === "Faith"
//   • exactly one "Faith" concept (no duplicate created)
//   • no validator regression (notably no F5) vs the pre-dispatch baseline

"use strict";

module.exports = {
  name: "05-rename-concept",
  category: "data-integrity",
  description:
    "[data-integrity] Renaming a concept rewrites concepts.json AND every form that embeds it — same UUID, no F5.",

  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "TestOrgRename" }),

  prompt:
    "Rename the concept 'Religion' to 'Faith' everywhere it appears — in concepts.json " +
    "AND inside any form that embeds it. Keep the SAME UUID; only the name changes.",

  maxTurns: 3,
  maxCostUsd: 0.30,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. concepts.json flipped Religion → Faith, exactly one Faith.
    A.assertConceptDoesNotExist(ctx.bundleDir, "Religion");
    const faith = A.assertConceptExists(ctx.bundleDir, "Faith");
    A.assertConceptCountByName(ctx.bundleDir, "Faith", 1);

    // 2. Every form that embeds this UUID now embeds concept.name === "Faith".
    const touched = A.assertFormsEmbedConceptName(ctx.bundleDir, faith.uuid, "Faith");
    if (touched === 0) {
      throw new Error("no form embedded the Faith concept — rename did not reach the forms");
    }

    // 3. No validator regression (a UUID change would surface as F5).
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });
  },
};
