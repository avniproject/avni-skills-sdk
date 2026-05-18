#!/usr/bin/env node
// add-subject-type workflow — atomic subjectTypes.json insertion.
//
// Inserts a new subjectType matching the deterministic-generator shape
// (see avni-skills/srs-bundle-generator/scripts/generate_bundle_v2.js
//  registerSubjectTypeForForm + ensureDefaultSubjectTypes).
//
// What this does atomically (all-or-nothing):
//   1. Reject if a subjectType with the same (case-insensitive) name exists.
//   2. Generate a v4 UUID, build the entry with sensible defaults.
//   3. If --bind-registration-form <FormName> is supplied AND a forms/<...>.json
//      exists with that `name`, also append a formMappings.json entry binding
//      that form to this subjectType (entityTypeUUID set, formType=IndividualProfile).
//   4. Write subjectTypes.json (+ formMappings.json if bound). With --dry-run,
//      write nothing and report planned changes.
//
// Usage:
//   node add-subject-type.mjs --name Volunteer
//   node add-subject-type.mjs --name Cohort --type Group
//   node add-subject-type.mjs --name Household --type Household
//   node add-subject-type.mjs --name Volunteer --bind-registration-form "Volunteer Registration"
//   node add-subject-type.mjs --name X --dry-run
//
// Output: JSON on stdout. { ok: true, ... } | { ok: false, errors: [...] }

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const argsArr = process.argv.slice(2);
function arg(name) { const i = argsArr.indexOf(`--${name}`); return i < 0 ? null : argsArr[i + 1]; }
function flag(name) { return argsArr.includes(`--${name}`); }

if (flag("help") || flag("h")) {
  process.stdout.write(fs.readFileSync(new URL(import.meta.url).pathname, "utf8").split("\n").slice(0, 22).join("\n") + "\n");
  process.exit(0);
}

const name = arg("name");
const typeRaw = arg("type") || "Person";
const bindForm = arg("bind-registration-form");
const dryRun = flag("dry-run");

const VALID_TYPES = ["Person", "Individual", "Group", "Household"];

const errors = [];
if (!name || !name.trim()) errors.push("--name <SubjectTypeName> required");
if (!VALID_TYPES.includes(typeRaw)) errors.push(`--type must be one of ${VALID_TYPES.join("/")}; got "${typeRaw}"`);

if (errors.length) {
  process.stdout.write(JSON.stringify({ ok: false, errors }, null, 2) + "\n");
  process.exit(1);
}

const cwd = process.cwd();
function loadJson(rel) {
  const fp = path.join(cwd, rel);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, "utf8"));
}

const subjectTypes = loadJson("subjectTypes.json") || [];
if (!Array.isArray(subjectTypes)) {
  process.stdout.write(JSON.stringify({ ok: false, errors: ["subjectTypes.json must be an array"] }, null, 2) + "\n");
  process.exit(1);
}

// Case-insensitive duplicate check
const nameLc = name.trim().toLowerCase();
const dup = subjectTypes.find((s) => String(s.name || "").trim().toLowerCase() === nameLc);
if (dup) {
  process.stdout.write(JSON.stringify({
    ok: false,
    errors: [`subjectType "${name}" already exists (matches "${dup.name}", uuid ${dup.uuid})`],
    existing: { name: dup.name, uuid: dup.uuid, type: dup.type },
  }, null, 2) + "\n");
  process.exit(1);
}

// Build the new entry — mirror the generator's shape exactly
const newUuid = crypto.randomUUID();
const isHousehold = typeRaw === "Household";
const isGroup = typeRaw === "Group" || isHousehold;
const entry = {
  name: name.trim(),
  uuid: newUuid,
  active: true,
  type: typeRaw,
  allowMiddleName: typeRaw === "Person",
  allowProfilePicture: false,
  allowEmptyLocation: false,
  lastNameOptional: false,
  uniqueName: false,
  shouldSyncByLocation: true,
  settings: {
    displayRegistrationDetails: true,
    displayPlannedEncounters: true,
  },
  household: isHousehold,
  group: isGroup,
  directlyAssignable: false,
  voided: false,
};

// Optional: bind a registration form to this subjectType
const planFormMapping = { added: false, formUuid: null, formName: null, file: null };
if (bindForm) {
  const formsDir = path.join(cwd, "forms");
  let matched = null;
  if (fs.existsSync(formsDir)) {
    for (const fn of fs.readdirSync(formsDir)) {
      if (!fn.endsWith(".json")) continue;
      let f; try { f = JSON.parse(fs.readFileSync(path.join(formsDir, fn), "utf8")); } catch { continue; }
      if (f && f.name === bindForm) { matched = { json: f, file: `forms/${fn}` }; break; }
    }
  }
  if (!matched) {
    process.stdout.write(JSON.stringify({
      ok: false,
      errors: [`--bind-registration-form: no form named "${bindForm}" found in forms/`],
    }, null, 2) + "\n");
    process.exit(1);
  }
  if (matched.json.formType !== "IndividualProfile") {
    process.stdout.write(JSON.stringify({
      ok: false,
      errors: [`--bind-registration-form: form "${bindForm}" is formType=${matched.json.formType}; only IndividualProfile forms can register a subjectType`],
    }, null, 2) + "\n");
    process.exit(1);
  }
  planFormMapping.formUuid = matched.json.uuid;
  planFormMapping.formName = matched.json.name;
  planFormMapping.file = matched.file;
}

// Build the new state (in memory)
const newSubjectTypes = subjectTypes.concat([entry]);
let newFormMappings = null;
if (planFormMapping.formUuid) {
  const formMappings = loadJson("formMappings.json") || [];
  // Avoid duplicate mapping
  const already = formMappings.find((m) => m.formUUID === planFormMapping.formUuid && m.entityUUID === newUuid);
  if (!already) {
    const mappingEntry = {
      uuid: crypto.randomUUID(),
      formUUID: planFormMapping.formUuid,
      entityUUID: newUuid,
      isVoided: false,
      formType: "IndividualProfile",
      subjectTypeUuid: newUuid,
    };
    newFormMappings = formMappings.concat([mappingEntry]);
    planFormMapping.added = true;
    planFormMapping.mappingUuid = mappingEntry.uuid;
  }
}

const result = {
  ok: true,
  dryRun,
  subjectType: { name: entry.name, uuid: entry.uuid, type: entry.type, group: entry.group, household: entry.household },
  totalSubjectTypesAfter: newSubjectTypes.length,
  formMapping: planFormMapping,
};

if (!dryRun) {
  fs.writeFileSync(path.join(cwd, "subjectTypes.json"), JSON.stringify(newSubjectTypes, null, 2));
  if (newFormMappings) fs.writeFileSync(path.join(cwd, "formMappings.json"), JSON.stringify(newFormMappings, null, 2));
  result.message = `subjectType "${entry.name}" added`;
} else {
  result.message = `[dry-run] subjectType "${entry.name}" would be added (${VALID_TYPES.indexOf(typeRaw) >= 0 ? typeRaw : "Person"})`;
}

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
