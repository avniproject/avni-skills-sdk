"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generate, validate } = require("../../entities/lib/fixture.cjs");
const { bundleActiveNames } = require("./lib/entity-names.cjs");
const { diffNames, formatParityReport } = require("./lib/parity.cjs");
const fixture = require("./lib/synthetic-fixture.cjs");

test("synthetic org: generates, validates clean, and reaches entity-graph parity", () => {
  const b = generate({
    formsSheets: fixture.formsSheets,
    modellingSheets: fixture.modellingSheets,
    org: fixture.org,
  });

  // Validation gate: 0 errors.
  const v = validate(b.__outDir);
  assert.equal(v.errors.length, 0, `validator errors:\n${JSON.stringify(v.errors, null, 2)}`);

  // Parity gate vs the declared expected graph.
  const generated = bundleActiveNames(b.__outDir);
  const diff = diffNames(generated, fixture.EXPECTED);
  assert.equal(diff.pass, true, `\n${formatParityReport(diff)}`);
  // No unexpected extras in gate classes either (tightens the synthetic case).
  for (const k of ["subjectTypes", "programs", "encounterTypes", "forms"]) {
    assert.deepEqual(diff.classes[k].extra, [], `${k} extras: ${diff.classes[k].extra}`);
  }
});
