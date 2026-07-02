// 16-ambiguous-f2-asks-or-states.cjs  (category: no-thrash)
//
// What it proves: faced with an under-specified fix request on an F2 error (the
// same concept appears twice in one form — which occurrence should go?), the
// agent either (a) ASKS a clarifying question, or (b) APPLIES a defensible fix
// and STATES its rationale. What it must NOT do is thrash — burn tokens in a
// Read/Edit/revert loop that commits nothing.
//
// Expectations:
//   • no thrash warning (turn.thrash !== true)
//   • EITHER the assistant asked a clarifying question (ends with "?")
//     OR a fix was committed (turn.noChanges === false) with F2 reduced and a
//     non-trivial rationale
//   • no validator regression vs the pre-dispatch baseline

"use strict";

module.exports = {
  name: "16-ambiguous-f2-asks-or-states",
  description:
    "[no-thrash] Ambiguous F2 fix request → ask_user OR applied_fix + rationale; never thrash.",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgAmbiguous" }),
  poison: "F2",

  prompt:
    "Something looks off with one of the forms. Have a look and sort it out.",

  maxTurns: 2,
  maxCostUsd: 0.30,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. Never thrash.
    if (ctx.turnEvent && ctx.turnEvent.thrash) {
      throw new Error(`thrash warning fired: ${JSON.stringify(ctx.turnEvent)}`);
    }

    const transcript = await ctx.getTranscript();
    const text = A.joinAssistantText(transcript);
    const applied = ctx.turnEvent && ctx.turnEvent.noChanges === false;

    if (applied) {
      // Applied a fix — F2 should be reduced and a rationale given.
      const v = await ctx.getValidator();
      const f2 = v.groups?.F2 || 0;
      const baselineF2 = ctx.baselineValidator.groups?.F2 || 0;
      if (f2 >= baselineF2 && baselineF2 > 0) {
        throw new Error(`applied a fix but F2 did not drop (${baselineF2} → ${f2})`);
      }
      if (text.trim().length < 60) {
        throw new Error(`applied a fix but gave no rationale (answer: ${text.slice(0, 120)})`);
      }
      await A.assertNoValidatorRegression({
        getValidator: ctx.getValidator,
        baseline: ctx.baselineValidator,
      });
    } else {
      // Did not apply — it must have asked a clarifying question.
      if (!/\?/.test(text)) {
        throw new Error(`neither applied a fix nor asked a question. Answer: ${text.slice(0, 200)}`);
      }
    }
  },
};
