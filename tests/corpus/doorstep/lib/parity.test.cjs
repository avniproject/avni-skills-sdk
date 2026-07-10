"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { diffNames, formatParityReport } = require("./parity.cjs");

const mk = (o) => ({
  addressLevelTypes: new Set(o.addressLevelTypes || []),
  subjectTypes: new Set(o.subjectTypes || []),
  programs: new Set(o.programs || []),
  encounterTypes: new Set(o.encounterTypes || []),
  forms: new Set(o.forms || []),
  formMappings: new Set(o.formMappings || []),
});

test("diffNames passes when all gate classes are fully covered", () => {
  const target = mk({ subjectTypes: ["student"], programs: ["fln"], encounterTypes: ["e"], forms: ["f"] });
  const generated = mk({ subjectTypes: ["student"], programs: ["fln"], encounterTypes: ["e"], forms: ["f","extra"] });
  const d = diffNames(generated, target);
  assert.equal(d.pass, true, "extra form does not fail parity");
  assert.deepEqual(d.classes.forms.extra, ["extra"]);
  assert.deepEqual(d.classes.forms.missing, []);
});

test("diffNames fails when a gate class is missing an entity", () => {
  const target = mk({ subjectTypes: ["student","teacher"], programs: ["fln"], encounterTypes: ["e"], forms: ["f"] });
  const generated = mk({ subjectTypes: ["student"], programs: ["fln"], encounterTypes: ["e"], forms: ["f"] });
  const d = diffNames(generated, target);
  assert.equal(d.pass, false);
  assert.deepEqual(d.classes.subjectTypes.missing, ["teacher"]);
});

test("non-gate classes (addressLevelTypes/formMappings) do not affect pass", () => {
  const target = mk({ subjectTypes: ["s"], programs: ["p"], encounterTypes: ["e"], forms: ["f"], addressLevelTypes: ["ward"] });
  const generated = mk({ subjectTypes: ["s"], programs: ["p"], encounterTypes: ["e"], forms: ["f"] });
  const d = diffNames(generated, target);
  assert.equal(d.pass, true, "missing addressLevelType is informational only");
  assert.deepEqual(d.classes.addressLevelTypes.missing, ["ward"]);
});

test("formatParityReport renders a string mentioning missing entities", () => {
  const target = mk({ subjectTypes: ["student","teacher"], programs: ["fln"], encounterTypes: ["e"], forms: ["f"] });
  const generated = mk({ subjectTypes: ["student"], programs: ["fln"], encounterTypes: ["e"], forms: ["f"] });
  const s = formatParityReport(diffNames(generated, target));
  assert.match(s, /teacher/);
  assert.match(s, /FAIL|missing/i);
});
