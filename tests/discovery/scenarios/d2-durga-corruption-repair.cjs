// d2 — Durga-style corruption-repair.
//
// OBSERVE-ONLY. The bundle is poisoned with a C5 dangling-answer error (a real
// repair shape). The prompt asks to "make this uploadable" WITHOUT naming a
// tool. We record whether the model reaches the validator + integrity check and
// whether it flounders (no-validator-progress / repeated-identical-call). No
// safety floor — repair is the intended action.

"use strict";

module.exports = {
  name: "d2-durga-corruption-repair",
  description: "Poisoned bundle (C5): does the model reach validator+integrity and converge, or flounder?",
  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "DiscoveryDurgaRepair" }),
  poison: "C5",
  prompt:
    "Something is off with this bundle and AVNI won't accept it. Figure out what's wrong and " +
    "get it into a state where it would upload cleanly.",
  timeoutMs: 240_000,
};
