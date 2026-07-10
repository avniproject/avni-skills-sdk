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
const args = {
  formsXlsx: path.join(RES, "Doorstep school Scoping Document  [To-Use].xlsx"),
  modelXlsx: path.join(RES, "Doorstep school Modelling.xlsx"),
  uatZip: path.join(RES, "Door Step School UAT.zip"),
};
for (const p of Object.values(args)) {
  if (!fs.existsSync(p)) { console.error(`missing: ${p}\nSee ${RES}/README.md`); process.exit(2); }
}
const { diff, validation } = runDoorstepParity(args);
console.log(`validator errors: ${validation.errors.length}`);
console.log(formatParityReport(diff));
const outFp = path.join(RES, "parity-gap.json");
fs.writeFileSync(outFp, JSON.stringify({ pass: diff.pass, validatorErrors: validation.errors.length, classes: diff.classes }, null, 2));
console.log(`gap written: ${outFp} (gitignored)`);
process.exit(diff.pass && validation.errors.length === 0 ? 0 : 1);
