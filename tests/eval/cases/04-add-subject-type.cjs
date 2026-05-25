// 04-add-subject-type.cjs  (PENDING — registry stub)
//
// What this case WILL prove once implemented: when the user asks to add a
// new subject type ("Sessions"), the agent must (a) append to
// subjectTypes.json, (b) MIRROR it into operationalSubjectTypes.json, and
// (c) add a corresponding entry to formMappings.json so the registration
// form (or new placeholder) maps to the new subject type. All three files
// must change in ONE turn.
//
// Why it's stubbed:
//   The assertion surface needs to verify a 3-file atomic edit — and the
//   prompt phrasing strongly influences whether the agent invents a
//   registration form (it shouldn't, unless the user said so) or just adds
//   the subject type. Need a tight prompt that's specific enough to test
//   without ambiguity.
//
// Implementation sketch:
//   setupFixture: buildBaseSrsBuffers
//   prompt:       "Add a new subject type named 'Sessions' (type: Group) — wire it up to formMappings using the existing 'Beneficiary Registration' form."
//   assertions:
//     - assertSubjectTypeExists(bundleDir, "Sessions")
//     - assertOperationalMirror(bundleDir, "subjectTypes.json", "operationalSubjectTypes.json", "subjectType")
//     - formMappings.json now has a row whose subjectTypeUUID === Sessions.uuid
//     - validator clean (no F1/F2/F5 regression)
//
// Estimated cost when implemented: ~$0.30

"use strict";

module.exports = {
  name: "04-add-subject-type",
  description:
    "[PENDING] Agent must add a subject type AND mirror it into operationalSubjectTypes AND wire a formMapping — all in one turn.",
  pending: true,
  pendingReason:
    "Needs prompt-engineering to pin down whether 'wire up' implies a new form vs reuse — to be implemented in v0.3.",
  maxCostUsd: 0.30,
};
