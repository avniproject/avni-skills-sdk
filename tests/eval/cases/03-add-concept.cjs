// 03-add-concept.cjs  (PENDING — registry stub)
//
// What this case WILL prove once implemented: when the user asks to "add a
// new concept", the agent must call `bundle_find_concept` first to check
// for a case-insensitive name collision (BUNDLE_HARD_RULES rule #6). Only
// if the tool returns "SAFE to add" may the agent append a new concept.
//
// Why it's stubbed:
//   The assertion surface is wider than the high-value 5 — we need to
//   verify (a) the tool was called BEFORE the Edit/Write, (b) the new
//   concept landed in concepts.json with a valid v4 UUID, (c) operational
//   files weren't disturbed, (d) no C3/D1 regression. The fixture also has
//   to seed an existing "Religion" concept and the prompt has to ask for
//   "religion" lowercase to test the case-insensitivity gate.
//
// Implementation sketch:
//   setupFixture: buildBaseSrsBuffers (already has Religion)
//   prompt:       "Add a new concept named 'religion' with dataType Text."
//   assertions:
//     - assertToolUsed(agentEvents, t => t.name.includes("bundle_find_concept"))
//     - the tool call must come BEFORE any Edit on concepts.json
//     - no NEW Religion-like concept in concepts.json (case-insensitive count stays 1)
//     - no C3/D1 errors
//
// Estimated cost when implemented: ~$0.20

"use strict";

module.exports = {
  name: "03-add-concept",
  description:
    "[PENDING] Agent must call bundle_find_concept BEFORE adding a concept; refuse on case-insensitive collision.",
  pending: true,
  pendingReason:
    "Assertion needs tool-ordering check (find_concept before Edit on concepts.json) — to be implemented in v0.3.",
  maxCostUsd: 0.20,
};
