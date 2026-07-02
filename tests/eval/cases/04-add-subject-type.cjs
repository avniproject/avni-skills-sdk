// 04-add-subject-type.cjs  (category: srs-authorship)
//
// What it proves: adding a subject type is an ATOMIC multi-file edit. The agent
// must write the master subjectTypes.json entry AND its operational mirror
// (operationalSubjectTypes.json) in the SAME turn, so the bundle never lands in
// a half-authored state. A subject type without its operational mirror is a
// silent upload failure the validator alone doesn't always surface.
//
// Expectations:
//   • subjectTypes.json contains "Household"
//   • operationalSubjectTypes.json mirrors EVERY subjectType (incl. Household)
//   • it all landed in one committed turn (turn.noChanges === false)
//   • no validator regression vs the pre-dispatch baseline

"use strict";

module.exports = {
  name: "04-add-subject-type",
  category: "srs-authorship",
  description:
    "[srs-authorship] Adding a subject type writes subjectTypes.json + operationalSubjectTypes.json (+ any touched formMappings) in one turn.",

  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "TestOrgAddSubject" }),

  prompt:
    "Add a new subject type named 'Household' (a group that contains members). " +
    "Make sure the bundle stays consistent — mirror it into the operational files " +
    "and wire up any form mappings it needs, all in this turn.",

  maxTurns: 2,
  maxCostUsd: 0.35,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. Master entry present.
    A.assertSubjectTypeExists(ctx.bundleDir, "Household");

    // 2. Operational mirror present for every subject type (atomicity check).
    A.assertOperationalMirror(
      ctx.bundleDir,
      "subjectTypes.json",
      "operationalSubjectTypes.json",
      "subjectType",
    );

    // 3. It landed as a real committed turn.
    if (ctx.turnEvent && ctx.turnEvent.noChanges === true) {
      throw new Error("expected an edit turn (subject type added), but nothing was committed");
    }

    // 4. No validator regression.
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });
  },
};
