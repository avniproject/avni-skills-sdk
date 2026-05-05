"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { generate } = require("./lib/fixture");

const minimalForm = (sheet = "Foo Form") => ({
  [sheet]: [
    ["Field Name", "Data Type", "Pre added Options Datatype", "Mandatory (default No)"],
    ["Name", "Text", "", "Yes"],
  ],
});

describe("Programs", () => {

  test("with no Modelling file, no programs are emitted", () => {
    // SRS-driven by design: no Program sheet, no programs. The old generator
    // used to invent "Pregnancy" / "Child" via keyword heuristic — that's been
    // removed. Honest output: nothing.
    const b = generate({
      formsSheets: minimalForm("Some Encounter"),
    });
    assert.equal(b.programs.length, 0);
  });

  test("emits one entry per encounterType.programName (auto-registered)", () => {
    const b = generate({
      formsSheets: minimalForm("ANC Visit"),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["Beneficiary", "Person"],
        ],
        "Program Encounters": [
          ["Encounter Name", "Program name"],
          ["ANC Visit", "Maternal"],
          ["Child Visit", "Paediatric"],
        ],
      },
    });
    const names = b.programs.map(p => p.name).sort();
    assert.deepEqual(names, ["Maternal", "Paediatric"]);
  });

  test("operationalPrograms.programSubjectLabel comes from Program sheet's Target Subject Type", () => {
    const b = generate({
      formsSheets: minimalForm("ANC Visit"),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["Mother", "Person"],
        ],
        Program: [
          ["Program Name", "Enrolment Form", "Exit Form", "Description", "Target Subject Type"],
          ["Maternal", "Maternal Enrolment", "Maternal Exit", "", "Mother"],
        ],
        "Program Encounters": [
          ["Encounter Name", "Program name"],
          ["ANC Visit", "Maternal"],
        ],
      },
    });
    const op = b.operationalPrograms.find(o => o.name === "Maternal");
    assert.ok(op, "operationalPrograms.Maternal exists");
    assert.equal(op.programSubjectLabel, "Mother");
  });

  test("operationalPrograms uses defaults (program name) when Program sheet doesn't specify subject", () => {
    const b = generate({
      formsSheets: minimalForm("ANC Visit"),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["Beneficiary", "Person"],
        ],
        "Program Encounters": [
          ["Encounter Name", "Program name"],
          ["ANC Visit", "X"],
        ],
      },
    });
    const op = b.operationalPrograms.find(o => o.name === "X");
    // No hardcoded "Pregnant Woman" / "Child" labels. Should fall back to program name.
    assert.equal(op.programSubjectLabel, "X");
  });

  test("Program sheet Enrolment Form column populates form-name → program lookup", () => {
    // A forms-file sheet whose name matches the Enrolment Form should be treated
    // as belonging to that program (so its formMapping gets the right programUUID).
    const b = generate({
      formsSheets: {
        "Maternal Enrolment": [
          ["Field Name", "Data Type"],
          ["Last Period", "Date"],
        ],
      },
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["Mother", "Person"],
        ],
        Program: [
          ["Program Name", "Enrolment Form", "Exit Form", "Description", "Target Subject Type"],
          ["Maternal", "Maternal Enrolment", "", "", "Mother"],
        ],
      },
    });
    // The Maternal Enrolment form should have a formMapping with the Maternal program UUID
    const program = b.programs.find(p => p.name === "Maternal");
    assert.ok(program, "Maternal program registered");
    const mapping = b.formMappings.find(m => m.formName === "Maternal Enrolment");
    assert.ok(mapping, "formMapping for Maternal Enrolment exists");
    assert.equal(mapping.programUUID, program.uuid, "mapping references correct program UUID");
  });

  test("UUIDs deterministic across runs", () => {
    const sheets = {
      formsSheets: minimalForm("E"),
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["B", "Person"]],
        "Program Encounters": [["Encounter Name", "Program name"], ["E", "P1"]],
      },
    };
    const a = generate(sheets);
    const b = generate(sheets);
    const aP = a.programs.find(p => p.name === "P1");
    const bP = b.programs.find(p => p.name === "P1");
    assert.equal(aP.uuid, bP.uuid);
  });

});
