// Deterministic SRS / bundle summarizer.
//
// Reads a bundle directory and returns a structured summary:
//   {
//     entityCounts: { concepts, forms, subjectTypes, programs, ... },
//     anomalies: [
//       { type, severity, where, value, note }
//     ],
//     formTypes: { ProgramEncounter: 5, IndividualProfile: 1, ... },
//     dataTypes: { Coded: 100, Numeric: 30, ... },
//     codedAnswerStats: { totalCoded, emptyCoded, mostAnswers },
//     ruleStats: { populated, types: {validationRule: 5, decisionRule: 3, ...} },
//   }
//
// This runs INSTANTLY (deterministic, no LLM, no network). The agent or CLI
// can call it as a cheap first-pass evaluation. Costs nothing.
//
// "Anomalies" are pattern-based heuristics observed in real org SRSes:
//   • trailing-whitespace in entity names
//   • Coded concepts with empty answers array (will block form save)
//   • subject types referenced by forms but not declared
//   • zero programs when forms have formType ProgramEncounter (mismatch)
//   • dataType mismatch between concepts.json and form-element concept ref
//   • concepts duplicated case-insensitively
//   • orphan answer UUIDs (Coded answer references a UUID not in concepts.json)

import fs from "node:fs";
import path from "node:path";

function safeJson(fp) {
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { return null; }
}
function asArray(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === "object") return x.concepts || x.subjectTypes || x.programs || x.encounterTypes || x.formMappings || x.operationalSubjectTypes || x.operationalPrograms || x.operationalEncounterTypes || [];
  return [];
}

// Mirror of generator's invalidLocationLevelNameReason — AVNI server rejects
// addressLevelType names containing URLs, arrow chains, parenthesized
// descriptions, or "Hierarchy"-suffix section headers. Universal lint.
function invalidLocationLevelNameReason(name) {
  if (!name || typeof name !== "string") return "empty";
  const t = name.trim();
  if (!t) return "empty";
  if (/^https?:\/\//i.test(t)) return "URL, not a level name";
  if (/[→←⟶⇒➡↦]/.test(t) || /\s->\s|\s=>\s/.test(t)) return "arrow — describes a hierarchy chain";
  if (/^\(.*\)$/.test(t)) return "parenthesized — description, not a name";
  if (/hierarchy\s*$/i.test(t)) return "section header (ends with \"Hierarchy\")";
  return null;
}

export function summarizeBundle(bundleDir) {
  const concepts        = asArray(safeJson(path.join(bundleDir, "concepts.json"))) || [];
  const subjectTypes    = asArray(safeJson(path.join(bundleDir, "subjectTypes.json"))) || [];
  const programs        = asArray(safeJson(path.join(bundleDir, "programs.json"))) || [];
  const encounterTypes  = asArray(safeJson(path.join(bundleDir, "encounterTypes.json"))) || [];
  const formMappings    = asArray(safeJson(path.join(bundleDir, "formMappings.json"))) || [];
  const addressLevelTypes = asArray(safeJson(path.join(bundleDir, "addressLevelTypes.json"))) || [];
  const formsDir = path.join(bundleDir, "forms");
  const forms = fs.existsSync(formsDir)
    ? fs.readdirSync(formsDir).filter((f) => f.endsWith(".json"))
        .map((f) => safeJson(path.join(formsDir, f))).filter(Boolean)
    : [];

  const conceptByUuid = new Map(concepts.map((c) => [c.uuid, c]));
  const conceptByLcName = new Map();
  for (const c of concepts) {
    if (!c.name) continue;
    const k = c.name.toLowerCase().trim();
    if (!conceptByLcName.has(k)) conceptByLcName.set(k, []);
    conceptByLcName.get(k).push(c);
  }

  const anomalies = [];

  // 1. Trailing-whitespace in entity names (encounter types, programs, subject types, forms)
  const trailingCheck = [
    { collection: encounterTypes, where: "encounterTypes.json" },
    { collection: programs,       where: "programs.json" },
    { collection: subjectTypes,   where: "subjectTypes.json" },
    { collection: forms,          where: "forms/*.json" },
  ];
  for (const { collection, where } of trailingCheck) {
    for (const item of collection) {
      const name = item?.name;
      if (typeof name === "string" && name !== name.trim()) {
        anomalies.push({
          type: "trailing-whitespace",
          severity: "warning",
          where,
          value: name,
          uuid: item.uuid,
          note: "Name has trailing/leading whitespace; this can cause case-insensitive mismatches when forms reference the entity.",
        });
      }
    }
  }

  // 2. Coded concepts with empty answers — mandatory fields will block form save
  let totalCoded = 0;
  let emptyCoded = 0;
  for (const c of concepts) {
    if (c.dataType !== "Coded") continue;
    totalCoded++;
    if (!Array.isArray(c.answers) || c.answers.length === 0) {
      emptyCoded++;
      anomalies.push({
        type: "empty-coded-answers",
        severity: "error",
        where: "concepts.json",
        value: c.name,
        uuid: c.uuid,
        note: "Coded concept has no answer options. Forms with mandatory fields referencing this concept will block save.",
      });
    }
  }

  // 3. Case-insensitive duplicate concept names
  for (const [lcName, list] of conceptByLcName) {
    if (list.length > 1) {
      anomalies.push({
        type: "case-insensitive-duplicate",
        severity: "error",
        where: "concepts.json",
        value: list.map((c) => `${c.name} (${c.uuid})`).join(" + "),
        note: "Multiple concepts share the same case-insensitive name; AVNI validator C3/D1 will reject the bundle on upload.",
      });
    }
  }

  // 4. Orphan answer UUIDs — Coded answer references a UUID not in concepts.json
  for (const c of concepts) {
    if (c.dataType !== "Coded") continue;
    for (const a of (c.answers || [])) {
      if (a.uuid && !conceptByUuid.has(a.uuid)) {
        anomalies.push({
          type: "orphan-answer-uuid",
          severity: "error",
          where: "concepts.json",
          value: `${c.name}: answer "${a.name}" → ${a.uuid}`,
          note: "Answer references a UUID with no matching standalone concept. AVNI validator C5 rejects this.",
        });
      }
    }
  }

  // 5. Zero programs while ProgramEncounter forms exist — likely missing Modelling sheet
  const formTypes = {};
  for (const f of forms) {
    formTypes[f.formType] = (formTypes[f.formType] || 0) + 1;
  }
  const programEncounterForms = formTypes.ProgramEncounter || 0;
  if (programs.length === 0 && programEncounterForms > 0) {
    anomalies.push({
      type: "missing-programs",
      severity: "warning",
      where: "programs.json",
      value: `0 programs but ${programEncounterForms} ProgramEncounter forms`,
      note: "Forms expect Programs. The SRS Modelling sheet likely lacks Program definitions, or the parser didn't pick them up.",
    });
  }

  // 6. DataType mismatch — form's formElement.concept.dataType disagrees with concepts.json
  // 6b. CONCEPT-SHAPE — formElement.concept must be a nested object, never a bare
  //     UUID string. AVNI's Jackson deserializer rejects bare strings. This was
  //     a real upload-blocking incident: a "fix all errors" turn flattened 148
  //     concept references across 8 forms; the local validator passed but the
  //     AVNI server crashed on upload.
  for (const f of forms) {
    for (const g of (f.formElementGroups || [])) {
      for (const el of (g.formElements || [])) {
        const ec = el.concept;
        if (ec == null) continue;
        if (typeof ec === "string") {
          anomalies.push({
            type: "concept-shape-flattened",
            severity: "error",
            where: `forms/* (form: ${f.name})`,
            value: `formElement "${el.name}": concept is a bare UUID string (${ec.slice(0, 38)}) — must be a nested object`,
            note: "AVNI's server-side Jackson deserializer requires concept to be a ConceptContract object with at minimum {name, uuid, dataType}. Bare UUIDs are rejected at upload. Fix: run scripts/workflows/fix-formelement-concept-shape.mjs to re-inline.",
          });
          continue;
        }
        if (!ec.uuid) continue;
        const canon = conceptByUuid.get(ec.uuid);
        if (canon && ec.dataType && canon.dataType && ec.dataType !== canon.dataType) {
          anomalies.push({
            type: "datatype-mismatch",
            severity: "warning",
            where: `forms/* (form: ${f.name})`,
            value: `${ec.name}: form says ${ec.dataType}, concepts.json says ${canon.dataType}`,
            note: "Form element's inline concept dataType doesn't match the canonical concept's dataType.",
          });
        }
      }
    }
  }

  // 7. Invalid addressLevelType names — AVNI's LocationService rejects URLs,
  //    arrow-spec rows, parenthesized descriptions, and "Hierarchy" section
  //    headers. A 2026-05-15 Astitva upload failed at the very first deploy
  //    step because a Google Drive link was emitted as a level name. The
  //    generator now filters these; this detector catches anything that slips
  //    through (e.g. manually-edited bundles, pre-fix bundles).
  for (const lt of addressLevelTypes) {
    const reason = invalidLocationLevelNameReason(lt?.name);
    if (reason) {
      anomalies.push({
        type: "invalid-location-type-name",
        severity: "error",
        where: "addressLevelTypes.json",
        value: `"${lt?.name}" — ${reason}`,
        uuid: lt?.uuid,
        note: "AVNI's LocationService.createAddressLevelType throws ValidationException on this name. The whole bundle deploy aborts before any other file is imported. Fix: remove or rename the level in addressLevelTypes.json.",
      });
    }
  }

  // Stats
  const ruleFields = ["decisionRule", "validationRule", "visitScheduleRule", "checklistsRule", "editFormRule"];
  const ruleTypes = {};
  let populatedRules = 0;
  for (const f of forms) {
    for (const rf of ruleFields) {
      if (typeof f[rf] === "string" && f[rf].trim()) {
        ruleTypes[rf] = (ruleTypes[rf] || 0) + 1;
        populatedRules += 1;
      }
    }
    for (const g of (f.formElementGroups || [])) {
      for (const el of (g.formElements || [])) {
        if (typeof el.rule === "string" && el.rule.trim()) {
          ruleTypes["formElement.rule"] = (ruleTypes["formElement.rule"] || 0) + 1;
          populatedRules += 1;
        }
      }
    }
  }

  const dataTypes = {};
  for (const c of concepts) dataTypes[c.dataType] = (dataTypes[c.dataType] || 0) + 1;

  // Sort anomalies by severity desc, then type
  const sevOrder = { error: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => (sevOrder[a.severity] - sevOrder[b.severity]) || a.type.localeCompare(b.type));

  return {
    entityCounts: {
      concepts: concepts.length,
      forms: forms.length,
      subjectTypes: subjectTypes.length,
      programs: programs.length,
      encounterTypes: encounterTypes.length,
      formMappings: formMappings.length,
    },
    formTypes,
    dataTypes,
    codedAnswerStats: { totalCoded, emptyCoded },
    ruleStats: { populated: populatedRules, byType: ruleTypes },
    anomalies,
    anomalyCount: anomalies.length,
    errorCount: anomalies.filter((a) => a.severity === "error").length,
    warningCount: anomalies.filter((a) => a.severity === "warning").length,
  };
}
