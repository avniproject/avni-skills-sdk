// 10-no-thrash.cjs
//
// What it proves: a "pure question" prompt should produce a pure answer
// turn — no file edits, no validator regression, low token burn. The
// thrash-warning event (src/routes/sessions-messages.js) fires when the
// agent burns ≥3k output tokens but commits nothing, indicating a
// Read/Edit/revert loop. We don't want to see that on a simple
// "how do concepts work" question.
//
// Expectations:
//   • no thrash warning emitted
//   • no commit landed (no file changes)
//   • assistant produced a non-trivial answer (>100 chars)
//   • output tokens stay under a cheap threshold
//   • bounded cost

"use strict";

module.exports = {
  name: "10-no-thrash",
  description:
    "Pure-question prompt → no edits, no thrash warning, bounded output tokens.",

  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "TestOrgNoThrash" }),

  prompt:
    "In one short paragraph, explain how AVNI concepts work — what is a Coded concept versus a Numeric concept? " +
    "Do NOT read or change any file in the bundle.",

  maxTurns: 1,
  maxCostUsd: 0.15,

  assertions: async (ctx) => {
    // Watch the SSE stream for any thrash-warning event the runner
    // surfaces (the runner promotes circuit-break to errorEvent; the
    // thrash event is a separate one we capture indirectly via the turn
    // event's `thrash: true` flag).
    if (ctx.turnEvent?.thrash) {
      throw new Error(`thrash warning fired: ${JSON.stringify(ctx.turnEvent)}`);
    }

    // No commit should have landed.
    if (ctx.turnEvent && ctx.turnEvent.noChanges !== true) {
      throw new Error(`expected no commit, got turn ${ctx.turnEvent.turn} sha=${ctx.turnEvent.sha}`);
    }

    // The assistant must have produced a non-trivial answer.
    const transcript = await ctx.getTranscript();
    const text = ctx.assertions.joinAssistantText(transcript);
    if (text.trim().length < 80) {
      throw new Error(`assistant answer too short (${text.length} chars): ${text}`);
    }

    // Output token cap — sanity ceiling. A one-paragraph answer should
    // never exceed ~1500 output tokens.
    if (ctx.outputTokens > 1500) {
      throw new Error(`output tokens ${ctx.outputTokens} exceeds cap 1500`);
    }
  },
};
