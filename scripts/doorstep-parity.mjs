#!/usr/bin/env node
// Run Doorstep bundle generation from the real (gitignored) workbooks and print
// entity-graph parity vs the UAT bundle. Seeds Phase 3 authoring.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { runDoorstepParity } = require("../tests/corpus/doorstep/lib/run-parity.cjs");
const { formatParityReport } = require("../tests/corpus/doorstep/lib/parity.cjs");

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(SCRIPT_DIR, "..", "tests", "resources", "doorstep");
// Input paths default to the raw org files; env overrides (DSS_FORMS / DSS_MODEL
// / DSS_UAT) let Phase-3 point at the enhanced workbooks without editing this
// committed script.
const args = {
  formsXlsx: process.env.DSS_FORMS || path.join(RES, "Doorstep school Scoping Document  [To-Use].xlsx"),
  modelXlsx: process.env.DSS_MODEL || path.join(RES, "Doorstep school Modelling.xlsx"),
  uatZip: process.env.DSS_UAT || path.join(RES, "Door Step School UAT.zip"),
};
for (const p of Object.values(args)) {
  if (!fs.existsSync(p)) { console.error(`missing: ${p}\nSee ${RES}/README.md`); process.exit(2); }
}
const { diff, validation, nonF2Errors, f2Count } = runDoorstepParity(args);
// Ship-gate is NON-F2 errors (F2 = tolerated cross-form concept reuse).
console.log(`validator errors: ${validation.errors.length} total (${f2Count} F2 tolerated, ${nonF2Errors.length} non-F2 blocking)`);
console.log(formatParityReport(diff));
const shipReady = diff.pass && nonF2Errors.length === 0;
const outFp = path.join(RES, "parity-gap.json");
fs.writeFileSync(outFp, JSON.stringify({
  shipReady, pass: diff.pass,
  validatorErrorsTotal: validation.errors.length, f2Count, nonF2Errors,
  classes: diff.classes,
}, null, 2));
console.log(`gap written: ${outFp} (gitignored)`);
process.exit(shipReady ? 0 : 1);
