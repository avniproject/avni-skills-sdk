"use strict";
// Invented, org-agnostic org ("Acme Wellness") — proves the harness mechanics
// end-to-end without any proprietary data (rule §1/§2). Mirrors the Doorstep
// shape in miniature: a Person subject with a registration form, one Program
// with enrolment/exit forms + a program encounter.
const form = (rows) => [["Field Name", "Data Type", "Mandatory (default No)"], ...rows];

const formsSheets = {
  "Member Registration": form([["Full Name", "Text", "Yes"], ["Date of Birth", "Date", "No"]]),
  "Wellness Enrolment":  form([["Enrolment Date", "Date", "Yes"], ["Baseline Score", "Numeric", "No"]]),
  "Wellness Exit":       form([["Exit Date", "Date", "Yes"], ["Exit Reason", "Text", "No"]]),
  "Wellness Checkup":    form([["Visit Date", "Date", "Yes"], ["Weight", "Numeric", "No"]]),
};

const modellingSheets = {
  "Subject Types": [
    ["Subject Type Name", "Type", "Form Link"],
    ["Member", "Person", "Member Registration"],
  ],
  "Program": [
    ["Program Name", "Enrolment Form", "Exit Form", "Description", "Target Subject Type"],
    ["Wellness", "Wellness Enrolment", "Wellness Exit", "", "Member"],
  ],
  // "Subject Type" is explicit here (rather than relying on the generator's
  // positional column-2 fallback) so the encounter row's Program-name value
  // ("Wellness" in column 2) is never mistaken for a subject-type reference
  // and auto-created as a spurious subject type.
  "Program Encounters": [
    ["Encounter Name", "Subject Type", "Program name"],
    ["Wellness Checkup", "Member", "Wellness"],
  ],
  "Location Hierarchy": [
    ["Location Type"],
    ["Village"],
  ],
};

// Declared expected active-name graph, calibrated against the real generator
// output. The generator auto-derives a "<encounter> Encounter Cancellation"
// form + formMapping for every encounter type
// (IndividualEncounterCancellation/ProgramEncounterCancellation) — deployed
// convention, generator fix #1 (2026-07-14) — so "wellness checkup encounter
// cancellation" is a genuine, deterministic entry — not hand-authored in
// either forms sheet or modelling sheet above.
const EXPECTED = {
  addressLevelTypes: new Set(["village"]),
  subjectTypes: new Set(["member"]),
  programs: new Set(["wellness"]),
  encounterTypes: new Set(["wellness checkup"]),
  forms: new Set([
    "member registration",
    "wellness enrolment",
    "wellness exit",
    "wellness checkup",
    "wellness checkup encounter cancellation",
  ]),
  formMappings: new Set([
    "member registration",
    "wellness enrolment",
    "wellness exit",
    "wellness checkup",
    "wellness checkup encounter cancellation",
  ]),
};

module.exports = { formsSheets, modellingSheets, org: "AcmeWellness", EXPECTED };
