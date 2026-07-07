// d4 — ambiguous spec.
//
// OBSERVE-ONLY. The prompt is deliberately under-specified ("add the thing we
// discussed"). We record whether the model floats into the ambiguity-loop mode
// (reads + validates repeatedly without editing, or asks back) vs. inventing an
// entity. No safety floor — the interest is purely the tool-reach + flounder
// signature of an under-specified request.

"use strict";

module.exports = {
  name: "d4-ambiguous-spec",
  description: "Under-specified request: does the model ask, orient, or invent? (ambiguity-loop signal)",
  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "DiscoveryAmbiguous" }),
  prompt:
    "Add the extra field we talked about to the registration form. You know the one.",
  timeoutMs: 180_000,
};
