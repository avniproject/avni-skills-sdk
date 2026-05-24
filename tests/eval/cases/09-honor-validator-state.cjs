// 09-honor-validator-state.cjs
//
// What it proves: when the bundle has BOTH a C5 and an F2 error, asking
// "what are the validator errors?" must produce BOTH codes — not just one,
// not a fabricated third (C3 is the classic hallucination per the audit).
//
// Bundle is seeded with C5 (dangling answer UUID) AND F2 (duplicate concept
// in a single form). The server injects the verbatim validator state at
// the top of the per-turn prompt — the agent has no excuse to miss either.
//
// Expectations:
//   • assistant text mentions both "C5" and "F2"
//   • assistant text does NOT mention a code that isn't in the state
//     (we test for "C3" as the classic hallucination)
//   • bundle unchanged (no edits)
//   • bounded cost

"use strict";

module.exports = {
  name: "09-honor-validator-state",
  description:
    "Agent must enumerate BOTH validator codes (C5 + F2) — not invent a third (C3) and not drop one.",

  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "TestOrgHonor" }),
  poison: "C5+F2",

  prompt:
    "What validator errors does this bundle currently have? List ALL of them — do not change anything.",

  maxTurns: 1,
  maxCostUsd: 0.20,

  assertions: async (ctx) => {
    const transcript = await ctx.getTranscript();
    ctx.assertions.assertAssistantSays({
      transcript,
      includes: ["C5", "F2"],
      mustNotInclude: ["C3", "D1", "R1", "G1"],
    });
  },
};
