// d1 — cold SRS authoring.
//
// OBSERVE-ONLY (design §4.4). A clean freshly-generated bundle; the prompt is
// open-ended ("get this ready to upload") and DELIBERATELY names no tool. We
// record which tools the model reaches for unaided under the slim prompt: does
// it orient (summary), consult the skill, run the integrity check before
// declaring done? No behavioural assertion — there is no safety floor here.

"use strict";

module.exports = {
  name: "d1-cold-srs-authoring",
  description: "Cold SRS → bundle: does the model orient + reach the integrity gate unaided?",
  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "DiscoveryColdAuthoring" }),
  prompt:
    "I just generated this bundle from an SRS. Look it over and tell me whether it's ready " +
    "to upload to AVNI, and if not, what needs fixing. Don't change anything yet — just assess.",
  timeoutMs: 240_000,
  // No safetyFloor: cold authoring assessment has no safety-critical surface.
};
