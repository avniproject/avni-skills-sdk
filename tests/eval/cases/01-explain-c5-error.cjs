// 01-explain-c5-error.cjs
//
// What it proves: when the validator state is injected into the per-turn
// prompt, the agent must quote the C5 error VERBATIM rather than re-discover
// it (which costs a wasted turn) or hallucinate a different code (C3, F2,
// etc.) — see src/sessions.js `currentValidatorStateText`.
//
// The bundle is seeded with one C5 error. The user simply asks "what is the
// validator error?" — no edit instruction. Expectations:
//   • assistant text mentions "C5"
//   • assistant text does NOT name an unrelated code (C3, F2, R1, ...)
//   • the validator state on disk is unchanged (no commit/poking around)
//   • bounded cost

"use strict";

module.exports = {
  name: "01-explain-c5-error",
  category: "no-thrash",
  description:
    "Agent must quote the C5 validator error verbatim from the injected state — no rediscovery, no fabricated codes.",

  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "TestOrgC5Explain" }),
  poison: "C5",

  prompt:
    "What validator errors does this bundle currently have? Just describe them — do not change anything.",

  maxTurns: 1,
  maxCostUsd: 0.15,

  assertions: async (ctx) => {
    const transcript = await ctx.getTranscript();
    // The agent must name C5 (the only error in the bundle).
    ctx.assertions.assertAssistantSays({
      transcript,
      includes: ["C5"],
      // Codes that should NEVER appear — there are no other errors.
      mustNotInclude: ["F2", "R1", "R2", "G1", "G2"],
    });

    // The bundle should be unchanged — no commit beyond the poison turn.
    const meta = await ctx.getMeta();
    const turns = await ctx.http.getJson(`/v1/sessions/${ctx.sessionId}/turns`);
    // Turn 0 (initial) + turn 1 (poison) = 2 turns. Any additional turn
    // with file changes means the agent unnecessarily edited.
    const editTurns = turns.turns.filter((t) => !t.summary?.startsWith("eval: seed"));
    // turn 0 is the deterministic first-pass (summary "deterministic first-pass bundle")
    // We allow that one but nothing post-poison.
    const postPoison = turns.turns.filter((t) => t.summary?.includes("eval: seed")).pop();
    const idx = postPoison ? turns.turns.indexOf(postPoison) : -1;
    const after = turns.turns.slice(idx + 1);
    // If the agent didn't change anything, `commitWorkspaceChanges` skips
    // the commit. So any turn after the poison is a real edit.
    if (after.length > 0) {
      // It's OK if the only "after" turn is a no-changes turn (turn counter
      // didn't increment). But if it bumped, the agent wrote files.
      const editing = after.filter((t) => !t.summary?.includes("no changes"));
      if (editing.length > 0) {
        throw new Error(
          `agent made unsolicited edits: ${editing.map((t) => t.summary).join("; ")}`,
        );
      }
    }
  },
};
