// d8 — multi-file rename.
//
// OBSERVE-ONLY. A shared concept ("Age") is used across three forms. The prompt
// asks to rename it everywhere. We record whether the model finds ALL references
// before editing (find_concept / grep / read-all-forms) vs. editing one file and
// declaring done — and whether it floods identical calls (repeated-identical-call
// flounder). No safety floor — rename is the intended action.

"use strict";

module.exports = {
  name: "d8-multi-file-rename",
  description: "Rename a shared concept across 3 forms: does the model find ALL references first?",
  setupFixture: ({ fixture }) => fixture.buildMultiFormSharedConceptSrs({ org: "DiscoveryRename" }),
  prompt:
    "We want to rename the \"Age\" field to \"Age in years\" everywhere it appears in this bundle. " +
    "Make sure you catch every place it's used.",
  timeoutMs: 240_000,
};
