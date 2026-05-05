"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generate } = require("./lib/fixture");

// These tests verify the AVNI server-contract: operational files MUST be
// wrapped objects ({ "operationalSubjectTypes": [...] }) — not bare arrays.
// We use the upstream validator's expectation as the source of truth.
function rawJson(outDir, file) {
  return JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8"));
}

describe("Operational files (server contract)", () => {

  test("operationalSubjectTypes.json is a wrapped object", () => {
    const b = generate({
      formsSheets: { F: [["Field Name", "Data Type"], ["x", "Text"]] },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["Beneficiary", "Person"]],
      },
    });
    const raw = rawJson(b.__outDir, "operationalSubjectTypes.json");
    assert.ok(!Array.isArray(raw), "must NOT be a bare array");
    assert.ok(Array.isArray(raw.operationalSubjectTypes), "must wrap with key 'operationalSubjectTypes'");
    assert.ok(raw.operationalSubjectTypes.length >= 1);
  });

  test("operationalPrograms.json is a wrapped object", () => {
    const b = generate({
      formsSheets: { "ANC Visit": [["Field Name", "Data Type"], ["W", "Numeric"]] },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["M", "Person"]],
        Program: [["Program Name","Enrolment Form","Exit Form","Description","Target Subject Type"],
                  ["Maternal","ME","MX","","M"]],
        "Program Encounters": [["Encounter Name", "Program name"], ["ANC Visit", "Maternal"]],
      },
    });
    const raw = rawJson(b.__outDir, "operationalPrograms.json");
    assert.ok(!Array.isArray(raw));
    assert.ok(Array.isArray(raw.operationalPrograms));
  });

  test("operationalEncounterTypes.json is a wrapped object", () => {
    const b = generate({
      formsSheets: { "Field Visit": [["Field Name", "Data Type"], ["N", "Text"]] },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["W", "Person"]],
        Encounters: [["Encounter Name", "Subject Type"], ["Field Visit", "W"]],
      },
    });
    const raw = rawJson(b.__outDir, "operationalEncounterTypes.json");
    assert.ok(!Array.isArray(raw));
    assert.ok(Array.isArray(raw.operationalEncounterTypes));
  });

  test("each operational entry has subjectType/program/encounterType back-reference UUID", () => {
    const b = generate({
      formsSheets: { "Field Visit": [["Field Name", "Data Type"], ["N", "Text"]] },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["W", "Person"]],
        Encounters: [["Encounter Name", "Subject Type"], ["Field Visit", "W"]],
      },
    });
    const knownSubj = new Set(b.subjectTypes.map(s => s.uuid));
    const knownEnc  = new Set(b.encounterTypes.map(e => e.uuid));
    for (const op of b.operationalSubjectTypes) {
      assert.ok(op.subjectType?.uuid && knownSubj.has(op.subjectType.uuid),
        `op-subject-type "${op.name}" has invalid subjectType.uuid`);
    }
    for (const op of b.operationalEncounterTypes) {
      assert.ok(op.encounterType?.uuid && knownEnc.has(op.encounterType.uuid),
        `op-encounter "${op.name}" has invalid encounterType.uuid`);
    }
  });

  test("operational entry counts match base entity counts (no orphans, no missing)", () => {
    const b = generate({
      formsSheets: { "Field Visit": [["Field Name", "Data Type"], ["N", "Text"]] },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["W", "Person"], ["S", "Individual"]],
        Encounters: [
          ["Encounter Name", "Subject Type"],
          ["Field Visit", "W"],
          ["Other", "S"],
        ],
      },
    });
    assert.equal(b.subjectTypes.length, b.operationalSubjectTypes.length);
    assert.equal(b.encounterTypes.length, b.operationalEncounterTypes.length);
  });

});
