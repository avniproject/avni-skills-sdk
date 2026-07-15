"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
async function load() { return import(pathToFileURL(path.resolve(__dirname, "../../src/comprehension/patch-schema.js")).href); }
const prov = { sheet: "Attendance", row: 6 };

test("validatePatch keeps provenanced valid ops, drops the rest", async () => {
  const { validatePatch } = await load();
  const r = validatePatch({ corrections: [
    { op: "add-answers", concept: "Gender", answers: ["Male", "Female"], provenance: prov },
    { op: "add-answers", concept: "Gender", answers: ["Male"] }, // NO provenance → dropped
    { op: "reclassify-form", form: "Student Register", formType: "IndividualProfile", provenance: prov },
    { op: "bogus-op", provenance: prov }, // unknown → dropped
    { op: "drop-entity", entityKind: "form", provenance: prov }, // missing name/uuid → dropped
  ] });
  assert.equal(r.valid.length, 2, JSON.stringify(r));
  assert.equal(r.dropped.length, 3);
  assert.ok(r.dropped.some((d) => d.reason === "no-provenance"));
  assert.ok(r.dropped.some((d) => d.reason === "unknown-op"));
  assert.ok(r.dropped.some((d) => d.reason === "missing-required-fields"));
});
