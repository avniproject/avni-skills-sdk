"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generate, validate } = require("../../entities/lib/fixture.cjs"); // also ensures avni-skills present
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

// Gated real-data parity case. Requires BOTH the three real Door Step School
// files staged locally (gitignored, see tests/resources/doorstep/README.md)
// AND an explicit opt-in env var — file presence alone does not run this,
// because the real files may be staged locally well before the generator is
// authored to reach parity against them (Phase 3), which would otherwise
// break `npm test` for anyone with the files present but no fix yet.
const RES = path.join(__dirname, "..", "..", "resources", "doorstep");
const FORMS_XLSX = path.join(RES, "Doorstep school Scoping Document  [To-Use].xlsx");
const MODEL_XLSX = path.join(RES, "Doorstep school Modelling.xlsx");
const UAT_ZIP = path.join(RES, "Door Step School UAT.zip");
const haveReal = [FORMS_XLSX, MODEL_XLSX, UAT_ZIP].every((p) => fs.existsSync(p));
const runReal = process.env.RUN_DOORSTEP_REAL === "1" && haveReal;
const skipReason = process.env.RUN_DOORSTEP_REAL !== "1"
  ? "set RUN_DOORSTEP_REAL=1 to run the real-data parity gate"
  : (!haveReal ? "real DSS files absent (see tests/resources/doorstep/README.md)" : false);

test("real Doorstep inputs: entity-graph parity vs UAT", { skip: runReal ? false : skipReason }, () => {
  const { runDoorstepParity } = require("./lib/run-parity.cjs");
  const { diff, nonF2Errors, target } = runDoorstepParity({ formsXlsx: FORMS_XLSX, modelXlsx: MODEL_XLSX, uatZip: UAT_ZIP });
  // Oracle shape, refreshed 2026-08-02 against the current UAT export (the
  // previous pin said 5 subject types; the export now carries 4).
  assert.equal(target.subjectTypes.size, 4, "UAT should have 4 active subject types");
  assert.equal(target.programs.size, 4, "UAT should have 4 active programs");
  assert.equal(target.encounterTypes.size, 6, "UAT should have 6 active encounter types");
  assert.equal(target.forms.size, 25, "UAT should have 25 active forms");
  // Behavioural oracle (design gap#4). These are the classes the name-only
  // comparator was blind to, and the reason a generated bundle could report
  // full parity while doing nothing. Pinned so a silently-thinner UAT export
  // cannot quietly lower the bar the generator is measured against.
  assert.equal(target.formsWithVisitScheduleRule.size, 9, "UAT carries visit schedules on 9 forms");
  assert.equal(target.formsWithDecisionRule.size, 3, "UAT carries decision rules on 3 forms");
  assert.equal(target.reportCards.size, 37, "UAT carries 37 report cards");
  assert.equal(target.reportDashboards.size, 6, "UAT carries 6 dashboards");
  // Ship-gate is NON-F2 errors (F2 = cross-form concept reuse, a tolerated
  // semantic class per bundle-harness.cjs; the UAT export itself isn't clean).
  assert.equal(nonF2Errors.length, 0, `non-F2 validator errors: ${JSON.stringify(nonF2Errors, null, 2)}`);
  assert.equal(diff.pass, true, `\n${formatParityReport(diff)}`);
});
