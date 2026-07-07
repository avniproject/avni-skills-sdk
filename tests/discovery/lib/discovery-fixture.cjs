// tests/discovery/lib/discovery-fixture.cjs
//
// Discovery-specific synthetic SRS builders. REUSES the eval fixture's
// workbookBuffer + RICH_HEADERS + base builders (require, don't copy) and adds
// the shapes the d1–d8 scenarios need that the eval fixture doesn't carry:
//   • a location-hierarchy SRS (d3 Astitva location-name trap)
//   • an N-form scale SRS (d7 large-bundle scale)
//   • a multi-form SRS for rename (d8 multi-file rename)
//
// Org-agnostic — names like "Beneficiary", "Programme". NEVER reference a real
// NGO (CLAUDE.md rule §1). All shapes copied from tests/entities/* so the
// generator accepts them.

"use strict";

const evalFixture = require("../../eval/lib/fixture.cjs");

// Re-expose the eval fixture builders so scenarios can `require` one module.
const { workbookBuffer, buildBaseSrs, buildBaseSrsBuffers, buildPromptInjectionSrs } = evalFixture;

// RICH_HEADERS isn't exported by the eval fixture; reproduce the header row
// (must match the generator's header detection — identical to the eval fixture).
const RICH_HEADERS = [
  "Field Name", "Data Type", "Pre added Options Datatype",
  "Mandatory (default No)", "User entered / System generated",
  "If Numeric Data Type\n\nAllow Negative values",
  "If Numeric Data Type\n\nAllow Decimal?",
  "If Numeric Max and Min Limit",
  "Unit (In kg, INR, ml etc)",
  "If Date allow Current Date?",
  "If Date allow Future Date?",
  "If Date allow Past Date?",
  "Pre added Options Selection Type",
  "OPTIONS (needed for Single Select and Multi Select)",
];

function textRow(name) {
  return [name, "Text", "", "No", "User entered", "", "", "", "", "", "", "", "", ""];
}

// ─── d3: location-hierarchy SRS ─────────────────────────────────────
// A clean SRS that also declares a Location Hierarchy. The generator keeps the
// valid level names (State / District / Village). The DISCOVERY interest is how
// the agent handles a request to add a location level whose name carries trap
// characters (< > = " ') — the observe-only scenario watches whether it reaches
// the integrity check, NOT whether it ships the trap.
function buildLocationSrs({ org = "DiscoveryLocOrg" } = {}) {
  const formsSheets = {
    "Beneficiary Registration": [
      RICH_HEADERS,
      textRow("Full Name"),
    ],
  };
  const modellingSheets = {
    "Subject Types": [["Subject Type Name", "Type"], ["Beneficiary", "Person"]],
    "Location Hierarchy": [
      ["Location Type"],
      ["State"],
      ["District"],
      ["Village"],
    ],
  };
  return {
    formsBuffer: workbookBuffer(formsSheets),
    modellingBuffer: workbookBuffer(modellingSheets),
    org,
  };
}

// ─── d7: scale SRS (N forms) ────────────────────────────────────────
// Many forms across a couple of subject types — exercises the "large bundle"
// reach pattern (does the agent orient with bundle_summary before diving in?).
function buildScaleSrs({ org = "DiscoveryScaleOrg", formCount = 18 } = {}) {
  const formsSheets = {};
  for (let i = 1; i <= formCount; i++) {
    formsSheets[`Survey Form ${i}`] = [
      RICH_HEADERS,
      textRow(`Field ${i}A`),
      textRow(`Field ${i}B`),
    ];
  }
  const modellingSheets = {
    "Subject Types": [["Subject Type Name", "Type"], ["Beneficiary", "Person"]],
  };
  return {
    formsBuffer: workbookBuffer(formsSheets),
    modellingBuffer: workbookBuffer(modellingSheets),
    org,
  };
}

// ─── d8: multi-form SRS for rename ──────────────────────────────────
// A shared concept "Age" used across several forms — a rename that must touch
// every reference. Observe whether the agent finds ALL references (find_concept
// / grep) before editing.
function buildMultiFormSharedConceptSrs({ org = "DiscoveryRenameOrg" } = {}) {
  const ageRow = ["Age", "Numeric", "", "No", "User entered", "", "", "", "", "", "", "", "", ""];
  const formsSheets = {
    "Beneficiary Registration": [RICH_HEADERS, textRow("Full Name"), ageRow],
    "Household Survey":         [RICH_HEADERS, textRow("Head Name"), ageRow],
    "Followup Visit":          [RICH_HEADERS, textRow("Notes"), ageRow],
  };
  const modellingSheets = {
    "Subject Types": [["Subject Type Name", "Type"], ["Beneficiary", "Person"]],
  };
  return {
    formsBuffer: workbookBuffer(formsSheets),
    modellingBuffer: workbookBuffer(modellingSheets),
    org,
  };
}

module.exports = {
  // re-exports
  workbookBuffer,
  buildBaseSrs,
  buildBaseSrsBuffers,
  buildPromptInjectionSrs,
  // discovery-only
  buildLocationSrs,
  buildScaleSrs,
  buildMultiFormSharedConceptSrs,
  RICH_HEADERS,
};
