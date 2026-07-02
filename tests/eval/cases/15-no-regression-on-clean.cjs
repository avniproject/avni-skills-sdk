// 15-no-regression-on-clean.cjs  (category: no-thrash)
//
// What it proves: on an already-clean, upload-ready bundle, "make sure it's
// upload-ready" must produce a pure verification answer — ZERO edit turns, no
// thrash, no validator regression. The failure mode is an agent that "fixes"
// things that aren't broken, churning the bundle and risking regressions.
//
// The fixture is the genuinely-clean registration-only SRS (0 validator errors
// under the pinned brain).
//
// Expectations:
//   • no commit landed (turn.noChanges === true)
//   • no thrash warning (turn.thrash !== true)
//   • no validator regression vs the pre-dispatch baseline (stays clean)
//   • the assistant produced a real answer

"use strict";

module.exports = {
  name: "15-no-regression-on-clean",
  category: "no-thrash",
  description:
    "[no-thrash] A clean bundle + 'is it upload-ready?' → verification only, zero edit turns, no regression.",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgClean" }),

  prompt:
    "Please double-check this bundle is upload-ready. Only change something if it " +
    "is actually broken — otherwise just confirm it looks good.",

  maxTurns: 1,
  maxCostUsd: 0.20,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. Zero edit turns.
    if (ctx.turnEvent && ctx.turnEvent.noChanges !== true) {
      throw new Error(
        `expected no edits on a clean bundle, but a turn committed (${ctx.turnEvent.agentActionSummary || ctx.turnEvent.sha})`,
      );
    }

    // 2. No thrash.
    if (ctx.turnEvent && ctx.turnEvent.thrash) {
      throw new Error(`thrash warning fired: ${JSON.stringify(ctx.turnEvent)}`);
    }

    // 3. No validator regression (baseline is clean → stays clean).
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });

    // 4. A real answer came back.
    const transcript = await ctx.getTranscript();
    const text = A.joinAssistantText(transcript);
    if (text.trim().length < 40) {
      throw new Error(`assistant answer too short (${text.length} chars): ${text}`);
    }
  },
};
