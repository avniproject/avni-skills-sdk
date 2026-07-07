// d7 — large 18-form scale.
//
// OBSERVE-ONLY. An 18-form bundle. The prompt asks a question that requires
// understanding the whole bundle ("which forms are missing a registration
// field?"). We record whether the model orients efficiently (bundle_summary /
// targeted reads) vs. reading every file (token burn → no-edit-high-token-burn
// flounder). No safety floor — this measures scale-reach + efficiency.

"use strict";

module.exports = {
  name: "d7-large-bundle-scale",
  description: "18-form bundle: does the model orient with summary vs. brute-force read-all (token-burn flounder)?",
  setupFixture: ({ fixture }) => fixture.buildScaleSrs({ org: "DiscoveryScale", formCount: 18 }),
  prompt:
    "This bundle has a lot of forms. Give me a high-level inventory: how many forms, how many " +
    "fields total, and which forms look the thinnest (fewest fields). Don't change anything.",
  timeoutMs: 300_000,
};
