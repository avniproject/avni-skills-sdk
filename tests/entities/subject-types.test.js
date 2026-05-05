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

describe("Subject Types", () => {

  test("emits one entry per row in the Subject Types sheet", () => {
    const b = generate({
      formsSheets: minimalForm(),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["Beneficiary", "Person"],
          ["Anganwadi", "Individual"],
          ["School", "Individual"],
        ],
      },
    });
    assert.equal(b.subjectTypes.length, 3);
    assert.deepEqual(
      b.subjectTypes.map(s => s.name).sort(),
      ["Anganwadi", "Beneficiary", "School"],
    );
  });

  test("Type=Person → type:Person, household:false, group:false", () => {
    const b = generate({
      formsSheets: minimalForm(),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["Person Subject", "Person"],
        ],
      },
    });
    const s = b.subjectTypes.find(x => x.name === "Person Subject");
    assert.equal(s.type, "Person");
    assert.equal(s.household, false);
    assert.equal(s.group, false);
    assert.equal(s.allowMiddleName, true);
  });

  test("Type=Group → type:Individual, group:true", () => {
    const b = generate({
      formsSheets: minimalForm(),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["MyGroup", "Group"],
        ],
      },
    });
    const s = b.subjectTypes.find(x => x.name === "MyGroup");
    assert.equal(s.type, "Individual");
    assert.equal(s.group, true);
  });

  test("Type=Household → type:Household, household:true", () => {
    const b = generate({
      formsSheets: minimalForm(),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["MyHousehold", "Household"],
        ],
      },
    });
    const s = b.subjectTypes.find(x => x.name === "MyHousehold");
    assert.equal(s.type, "Household");
    assert.equal(s.household, true);
  });

  test("auto-creates a subject type referenced by a regular Encounter but missing from Subject Types sheet", () => {
    // SRS gap: Encounters sheet refers to "Worker" but Subject Types sheet
    // doesn't list it. Without auto-create the formMapping would dangle (M3).
    const b = generate({
      formsSheets: minimalForm("Field Visit"),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["Beneficiary", "Person"],
        ],
        Encounters: [
          ["Encounter Name", "Subject Type"],
          ["Field Visit", "Worker"],   // Worker is not in Subject Types sheet
        ],
      },
    });
    const worker = b.subjectTypes.find(s => s.name === "Worker");
    assert.ok(worker, "expected 'Worker' to be auto-created");
    assert.equal(worker._autoCreated, true);
    assert.equal(worker.type, "Person", "auto-created defaults to Person");
  });

  test("'X Registration' suffix in encounter ref matches existing 'X' subject type", () => {
    // SRS author wrote "Beneficiary Registration" in Subject Types sheet but
    // Encounters sheet refers to plain "Beneficiary". They should resolve to the
    // same subject type (and not produce two entries).
    const b = generate({
      formsSheets: minimalForm("Awareness"),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["Beneficiary", "Person"],
        ],
        Encounters: [
          ["Encounter Name", "Subject Type"],
          ["Awareness", "Beneficiary Registration"],
        ],
      },
    });
    // Should resolve to "Beneficiary" — not create a "Beneficiary Registration" duplicate
    assert.equal(b.subjectTypes.length, 1);
    assert.equal(b.subjectTypes[0].name, "Beneficiary");
  });

  test("UUIDs are deterministic across runs (same SRS → same UUIDs)", () => {
    const sheets = {
      formsSheets: minimalForm(),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["StableSubject", "Person"],
        ],
      },
    };
    const a = generate(sheets);
    const b = generate(sheets);
    assert.equal(a.subjectTypes[0].uuid, b.subjectTypes[0].uuid);
  });

  test("UUIDs are valid v4-shaped", () => {
    const b = generate({
      formsSheets: minimalForm(),
      modellingSheets: {
        "Subject Types": [
          ["Subject Type Name", "Type"],
          ["X", "Person"],
        ],
      },
    });
    const u = b.subjectTypes[0].uuid;
    assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

});
