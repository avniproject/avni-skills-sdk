#!/usr/bin/env node
// Re-inline formElement.concept that an agent (or human) flattened to a bare
// UUID string. AVNI's server-side Jackson deserializer rejects bare strings
// for the `concept` field — it requires a nested ConceptContract object with
// at minimum { name, uuid, dataType }.
//
// This workflow is recovery, not prevention. The prevention is in
// BUNDLE_HARD_RULES rule #9 + a summarizer anomaly check. This script
// is what you run when you discover the bug already happened.
//
// Usage (from a bundle dir):
//   node fix-formelement-concept-shape.mjs           # apply
//   node fix-formelement-concept-shape.mjs --dry-run # report only
//
// Idempotent. Looks up the bare UUID in concepts.json, builds the canonical
// nested concept stub, swaps it in. If a UUID can't be resolved, the element
// is REPORTED but not modified (so we don't mask other bugs).

import fs from "node:fs";
import path from "node:path";

const dryRun = process.argv.includes("--dry-run");
const cwd = process.cwd();

const conceptsPath = path.join(cwd, "concepts.json");
if (!fs.existsSync(conceptsPath)) {
  console.error("concepts.json not found in cwd");
  process.exit(2);
}

const conceptsRaw = JSON.parse(fs.readFileSync(conceptsPath, "utf8"));
const concepts = Array.isArray(conceptsRaw) ? conceptsRaw : (conceptsRaw.concepts || []);
const conceptByUuid = new Map(concepts.map((c) => [c.uuid, c]));

function canonicalStub(c) {
  return {
    name: c.name,
    uuid: c.uuid,
    dataType: c.dataType,
    active: c.active !== false,
    media: Array.isArray(c.media) ? c.media : [],
    answers: Array.isArray(c.answers) ? c.answers : [],
  };
}

const formsDir = path.join(cwd, "forms");
if (!fs.existsSync(formsDir)) {
  console.error("forms/ not found in cwd");
  process.exit(2);
}

const report = { dryRun, filesChanged: 0, replacements: 0, unresolved: 0, byFile: {} };

for (const fn of fs.readdirSync(formsDir)) {
  if (!fn.endsWith(".json")) continue;
  const fp = path.join(formsDir, fn);
  let json;
  try { json = JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { continue; }

  let replacedInFile = 0;
  let unresolvedInFile = [];
  for (const g of (json.formElementGroups || [])) {
    for (const el of (g.formElements || [])) {
      const c = el.concept;
      if (typeof c === "string") {
        const canon = conceptByUuid.get(c);
        if (canon) {
          el.concept = canonicalStub(canon);
          replacedInFile += 1;
        } else {
          unresolvedInFile.push({ elementName: el.name, uuid: c });
        }
      }
    }
  }
  if (replacedInFile > 0 || unresolvedInFile.length > 0) {
    report.byFile[fn] = { replaced: replacedInFile, unresolved: unresolvedInFile };
    report.filesChanged += replacedInFile > 0 ? 1 : 0;
    report.replacements += replacedInFile;
    report.unresolved += unresolvedInFile.length;
  }
  if (replacedInFile > 0 && !dryRun) {
    fs.writeFileSync(fp, JSON.stringify(json, null, 2));
  }
}

process.stdout.write(JSON.stringify({
  ...report,
  message: dryRun
    ? `DRY-RUN: ${report.replacements} formElement.concept strings would be re-inlined across ${report.filesChanged} files. ${report.unresolved} unresolved.`
    : `Re-inlined ${report.replacements} formElement.concept strings across ${report.filesChanged} files. ${report.unresolved} unresolved.`,
}, null, 2) + "\n");
