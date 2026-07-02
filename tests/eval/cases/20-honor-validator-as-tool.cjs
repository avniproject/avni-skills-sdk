// 20-honor-validator-as-tool.cjs  (category: no-thrash)
//
// What it proves: the agent treats the validator as a TOOL to confirm its work,
// not as a fact to assert. After editing to fix an F2 error, it must re-run
// `bundle_validator_run` to confirm the delta — closing the loop rather than
// declaring victory blind.
//
// Expectations:
//   • validator F2 count → 0 (the fix actually worked)
//   • bundle_validator_run was called
//   • the validator run happened AFTER the fixing edit (edit → validate order)
//   • no validator regression vs the pre-dispatch baseline

"use strict";

module.exports = {
  name: "20-honor-validator-as-tool",
  category: "no-thrash",
  description:
    "[no-thrash] After the fix, the agent re-runs bundle_validator_run to confirm the delta (edit → validate).",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgHonorTool" }),
  poison: "F2",

  prompt:
    "One of the forms uses the same concept twice (validator F2). Fix it, and " +
    "then RUN the validator to confirm the error is actually gone before you finish.",

  maxTurns: 3,
  maxCostUsd: 0.35,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. F2 actually cleared.
    await A.assertValidatorCount({ getValidator: ctx.getValidator, code: "F2", expected: 0 });

    // 2. The validator tool was used.
    A.assertToolUsed(ctx.agentEvents, (t) =>
      String(t.name || "").includes("bundle_validator_run"),
    );

    // 3. It ran AFTER the fixing edit (Edit/Write/spec_apply → validator).
    A.assertToolOrder(ctx.agentEvents, {
      first: (t) => A.isFileEditTool(t) || /spec_apply/.test(String(t.name || "")),
      then: (t) => String(t.name || "").includes("bundle_validator_run"),
      label: "edit before confirming validator run",
    });

    // 4. No regression.
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });
  },
};
