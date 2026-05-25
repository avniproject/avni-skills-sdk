// 05-rename-concept.cjs  (PENDING — registry stub)
//
// What this case WILL prove once implemented: renaming a concept (changing
// its `name` field, NOT its UUID) is a cross-file operation — the new name
// has to be reflected in (a) concepts.json, (b) every forms/*.json that
// embeds the concept inside a formElement.concept block (BUNDLE_HARD_RULES
// rule #8 mandates the NESTED OBJECT shape, so the name lives in two
// places). The validator should stay green throughout.
//
// Why it's stubbed:
//   The agent has a deterministic primitive — `scripts/workflows/rename-concept-uuid.mjs`
//   — but that's for UUID swaps, not name changes. A name-only rename
//   without breaking the validator is a multi-file Edit that the agent has
//   to coordinate by reading all forms first. The assertion needs to walk
//   every forms/*.json and check the embedded concept.name in any
//   formElement that references the target UUID.
//
// Implementation sketch:
//   setupFixture: buildBaseSrsBuffers (has Religion + Beneficiary Registration)
//   prompt:       "Rename the concept 'Religion' to 'Faith' everywhere it appears — concepts.json AND any forms that embed it."
//   assertions:
//     - concepts.json: name "Religion" gone, "Faith" present, same UUID
//     - every forms/*.json: any formElement whose concept.uuid === <religion UUID> has concept.name === "Faith"
//     - validator unchanged (still clean)
//     - no NEW concept added (Faith reuses Religion's UUID)
//
// Estimated cost when implemented: ~$0.30

"use strict";

module.exports = {
  name: "05-rename-concept",
  description:
    "[PENDING] Agent must rename a concept everywhere it's embedded — concepts.json AND every form that references it.",
  pending: true,
  pendingReason:
    "Needs an assertion helper that walks all forms/*.json and inspects nested formElement.concept blocks — to be implemented in v0.3.",
  maxCostUsd: 0.30,
};
