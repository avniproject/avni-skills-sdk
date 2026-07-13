"use strict";
// Reverse a compiled Avni bundle back into the generator's INPUT workbooks:
//   modelling.xlsx  — Subject Types, Program, Program Encounters, Encounters
//   scoping.xlsx    — one sheet per (non-cancellation) form, field rows
//
// Purpose: reverse-golden-input isolation. Seeding the scoping doc from a
// reference bundle's OWN entities hands the generator a COMPLETE entity list,
// so any name-coverage shortfall after re-generation is the generator dropping
// or mangling entities it was explicitly given = pure generator infidelity
// (as opposed to scoping-doc incompleteness, which forward-parity conflates).
//
// It also manufactures a usable scoping doc for the 5 oracle-only orgs that
// have no SRS input at all (community/farming/phulwari/social_security/water_bodies).
//
// Inverts the generator's parse schema (generate_bundle_v2.js):
//   - parseModellingSubjectTypes: "Subject Type Name" + "Type" (Group/Household/Person)
//   - parseModellingProgram:      "Program Name" + Enrolment/Exit Form + "Target Subject Type"
//   - parseModellingEncounters:   "Encounter Name" + "Subject Type" [+ "Program"]
//   - detectColumns/processSheet: "Field Name","Data Type","Mandatory","Selection Type","Options"
//   - getFormType(sheetName):     sheet name drives formType, so we name sheets to reproduce it
//   - encounterName = sheetName - / Form$| Encounter$/  (generator quirk we mirror)
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

function readJson(fp) {
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; }
}
function isVoided(e) {
  return !!(e && (e.voided === true || /voided~/i.test(String(e.name || ""))));
}
function nameOf(byUuid, uuid) {
  const e = byUuid.get(uuid);
  return e ? e.name : null;
}

// Bundle concept dataType → the scoping-doc "Data Type" string the generator's
// mapDataType() recognizes. Location/GroupAffiliation etc. have no scoping
// representation (mapDataType can't emit them) → Text, and we count them as a
// known generator expressivity limit, not a round-trip bug.
const DT_UNEXPRESSIBLE = new Set(["Location", "GroupAffiliation", "PhoneNumber", "Encounter"]);
function reverseDataType(dt) {
  switch (dt) {
    case "Coded": return "Coded";
    case "Numeric": return "Numeric";
    case "Date": return "Date";
    case "DateTime": return "DateTime";
    case "Time": return "Time";
    case "Id": return "Id";
    case "Notes": return "Notes";
    case "Subject": return "Subject";
    case "Image":
    case "ImageV2": return "Image";
    case "Text": return "Text";
    default: return "Text";
  }
}

// getFormType() reproduction check — the sheet NAME is the only signal the
// generator uses for formType, so we confirm the reference form's name yields
// its own formType. (Cancellations are auto-generated, never emitted here.)
function formTypeFromSheetName(name, hasProgram) {
  const n = name.toLowerCase();
  if (n.includes("registration")) return "IndividualProfile";
  if (/\b(details|profile)\b/.test(n) && !n.includes("enrol") && !n.includes("exit")) return "IndividualProfile";
  if (n.includes("enrolment") || n.includes("enrollment")) return "ProgramEnrolment";
  if (n.includes("exit")) return "ProgramExit";
  if (n.includes("cancellation")) return hasProgram ? "ProgramEncounterCancellation" : "IndividualEncounterCancellation";
  return hasProgram ? "ProgramEncounter" : "Encounter";
}

const CANCELLATION_TYPES = new Set(["ProgramEncounterCancellation", "IndividualEncounterCancellation"]);

function reverseBundle(bundleDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  const subjectTypes = (readJson(path.join(bundleDir, "subjectTypes.json")) || []).filter((s) => !isVoided(s));
  const programs = (readJson(path.join(bundleDir, "programs.json")) || []).filter((p) => !isVoided(p));
  const encounterTypes = (readJson(path.join(bundleDir, "encounterTypes.json")) || []).filter((e) => !isVoided(e));
  const formMappings = (readJson(path.join(bundleDir, "formMappings.json")) || []).filter((m) => !isVoided(m));
  const addressLevelTypes = (readJson(path.join(bundleDir, "addressLevelTypes.json")) || []).filter((a) => !isVoided(a));

  const stByUuid = new Map(subjectTypes.map((s) => [s.uuid, s]));
  const progByUuid = new Map(programs.map((p) => [p.uuid, p]));
  const encByUuid = new Map(encounterTypes.map((e) => [e.uuid, e]));

  // Load forms
  const formsDir = path.join(bundleDir, "forms");
  const formsByName = new Map();
  if (fs.existsSync(formsDir)) {
    for (const f of fs.readdirSync(formsDir).filter((n) => n.endsWith(".json"))) {
      const form = readJson(path.join(formsDir, f));
      if (form && !isVoided(form)) formsByName.set(form.name, form);
    }
  }

  const notes = [];

  // ---- modelling.xlsx ----
  const wbModel = XLSX.utils.book_new();

  // Location Hierarchy sheet — ordered highest level → lowest (the generator
  // assigns levels by row order: first survivor = highest). Column "Location
  // Type". Without this, the generator falls back to its default State/District/
  // Block/Village hierarchy → an addressLevelTypes mismatch that is a reverse
  // omission, not a generator defect.
  if (addressLevelTypes.length) {
    const sorted = [...addressLevelTypes].sort((a, b) => (b.level || 0) - (a.level || 0));
    const locRows = [["Location Type"]];
    for (const a of sorted) locRows.push([a.name]);
    XLSX.utils.book_append_sheet(wbModel, XLSX.utils.aoa_to_sheet(locRows), "Location Hierarchy");
  }

  // Subject Types sheet
  const stRows = [["Subject Type Name", "Type"]];
  for (const s of subjectTypes) {
    const type = s.group ? "Group" : s.household ? "Household" : "Person";
    stRows.push([s.name, type]);
  }
  XLSX.utils.book_append_sheet(wbModel, XLSX.utils.aoa_to_sheet(stRows), "Subject Types");

  // Program sheet — enrolment/exit forms + target subject type from mappings
  const progRows = [["Program Name", "Enrolment Form", "Exit Form", "Target Subject Type"]];
  for (const p of programs) {
    const enrol = formMappings.find((m) => m.programUUID === p.uuid && m.formType === "ProgramEnrolment");
    const exit = formMappings.find((m) => m.programUUID === p.uuid && m.formType === "ProgramExit");
    const anyProgMap = formMappings.find((m) => m.programUUID === p.uuid && m.subjectTypeUUID);
    const targetST = anyProgMap ? nameOf(stByUuid, anyProgMap.subjectTypeUUID) : "";
    progRows.push([p.name, enrol ? enrol.formName : "", exit ? exit.formName : "", targetST || ""]);
  }
  if (progRows.length > 1) XLSX.utils.book_append_sheet(wbModel, XLSX.utils.aoa_to_sheet(progRows), "Program");

  // Encounter-name the generator will derive from a form sheet = name - suffix.
  const derivedEnc = (formName) => formName.replace(/ Form$/i, "").replace(/ Encounter$/i, "");

  // Real encounter name from the mapping (parseModellingEncounters registers
  // this FIRST, before the form path, so it wins encounter identity). The form
  // sheet still spawns a suffix-variant encounter (the generator ties encounter
  // identity to the sheet name) — that shows up as an EXTRA, but the real name
  // is recovered as a hit. `derivedEnc` is the fallback when the mapping has no
  // encounterTypeUUID.
  const realEnc = (m) => nameOf(encByUuid, m.encounterTypeUUID) || derivedEnc(m.formName);

  // Program Encounters sheet — from ProgramEncounter mappings.
  const progEncRows = [["Encounter Name", "Subject Type", "Program"]];
  for (const m of formMappings.filter((x) => x.formType === "ProgramEncounter")) {
    const st = nameOf(stByUuid, m.subjectTypeUUID) || "";
    const prog = nameOf(progByUuid, m.programUUID) || "";
    progEncRows.push([realEnc(m), st, prog]);
  }
  if (progEncRows.length > 1) XLSX.utils.book_append_sheet(wbModel, XLSX.utils.aoa_to_sheet(progEncRows), "Program Encounters");

  // Encounters sheet — non-program encounter mappings
  const encRows = [["Encounter Name", "Subject Type"]];
  for (const m of formMappings.filter((x) => x.formType === "Encounter")) {
    const st = nameOf(stByUuid, m.subjectTypeUUID) || "";
    encRows.push([realEnc(m), st]);
  }
  if (encRows.length > 1) XLSX.utils.book_append_sheet(wbModel, XLSX.utils.aoa_to_sheet(encRows), "Encounters");

  const modellingPath = path.join(outDir, "modelling.xlsx");
  XLSX.writeFile(wbModel, modellingPath);

  // ---- scoping.xlsx ----
  const wbForms = XLSX.utils.book_new();
  let sheetCount = 0;
  const usedSheetNames = new Set();

  for (const m of formMappings) {
    if (CANCELLATION_TYPES.has(m.formType)) continue; // generator auto-creates these
    const form = formsByName.get(m.formName);
    if (!form) { notes.push(`no form JSON for mapping "${m.formName}" (${m.formType})`); continue; }

    // Sheet name = form name. Verify it reproduces the formType; if not, note it
    // (a coverage-relevant generator-classification divergence to surface).
    const hasProgram = !!m.programUUID;
    const reproduced = formTypeFromSheetName(form.name, hasProgram);
    if (reproduced !== m.formType) {
      notes.push(`formType divergence: "${form.name}" is ${m.formType} but sheet name yields ${reproduced}`);
    }

    // Excel sheet names: max 31 chars, unique, no []*?/\:
    let sheetName = form.name.replace(/[[\]*?/\\:]/g, " ").slice(0, 31).trim();
    let suffix = 1;
    while (usedSheetNames.has(sheetName.toLowerCase())) {
      sheetName = `${form.name.slice(0, 27)} ${++suffix}`.slice(0, 31).trim();
    }
    usedSheetNames.add(sheetName.toLowerCase());

    const rows = [["Page Name", "Field Name", "Data Type", "Mandatory", "Selection Type", "Options"]];
    for (const grp of form.formElementGroups || []) {
      if (isVoided(grp)) continue;
      const page = grp.name || "General";
      for (const fe of grp.formElements || []) {
        if (isVoided(fe)) continue;
        const concept = fe.concept || {};
        const dt = concept.dataType || "Text";
        if (DT_UNEXPRESSIBLE.has(dt)) notes.push(`unexpressible dataType ${dt} on "${fe.name}" (${form.name}) → Text`);
        const dataType = reverseDataType(dt);
        const mandatory = fe.mandatory ? "Yes" : "No";
        const selection = fe.type === "MultiSelect" ? "Multi Select" : "Single Select";
        let options = "";
        if (dt === "Coded") {
          options = (concept.answers || [])
            .filter((a) => !isVoided(a))
            .map((a) => a.name)
            .join("\n");
        }
        rows.push([page, fe.name, dataType, mandatory, dataType === "Coded" ? selection : "", options]);
      }
    }
    if (rows.length === 1) { notes.push(`form "${form.name}" has no active elements — skipped (would be empty sheet)`); continue; }
    XLSX.utils.book_append_sheet(wbForms, XLSX.utils.aoa_to_sheet(rows), sheetName);
    sheetCount++;
  }

  const scopingPath = path.join(outDir, "scoping.xlsx");
  XLSX.writeFile(wbForms, scopingPath);

  return {
    scopingPath,
    modellingPath,
    stats: {
      subjectTypes: subjectTypes.length,
      programs: programs.length,
      encounterTypes: encounterTypes.length,
      formsReversed: sheetCount,
      formMappings: formMappings.length,
    },
    notes,
  };
}

module.exports = { reverseBundle, reverseDataType, formTypeFromSheetName };

if (require.main === module) {
  const [bundleDir, outDir] = process.argv.slice(2);
  if (!bundleDir || !outDir) { console.error("usage: reverse-bundle.cjs <bundleDir> <outDir>"); process.exit(1); }
  const r = reverseBundle(bundleDir, outDir);
  console.log(JSON.stringify(r, null, 2));
}
