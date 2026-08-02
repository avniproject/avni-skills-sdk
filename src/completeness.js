// Deterministic completeness floor — the semantic-build gate that a clean
// validator + integrity + (AI-judged) CRL do NOT cover.
//
// A bundle can be validator-clean, integrity-clean, and CRL-passed yet be
// semantically half-built. The over-claim this closes (2026-07-13, Door Step
// School): the agent cleared the validator (0 errors) and declared the bundle
// "production-ready 🎉" while ~half the config was missing and requirement prose
// had leaked in as encounter types. The CRL flagged the prose strays — and the
// agent downgraded them to "optional" and shipped.
//
// This floor is DETERMINISTIC (no LLM), so — unlike the AI-judged CRL — it
// cannot be argued down. It surfaces per turn via the injected validator
// preamble (currentValidatorStateText); like the integrity fold, it does NOT
// hard-revert — the agent iterates until it is green. Never throws: an
// unreadable bundle degrades to a null-ish result the caller treats as
// "not evaluated", never as clean.

import fs from "node:fs";
import path from "node:path";

function readJson(fp) { try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; } }
function isVoided(e) { return !!(e && (e.voided === true || /voided~/i.test(String(e.name || "")))); }
function activeItems(arr) { return (Array.isArray(arr) ? arr : []).filter((e) => e && !isVoided(e)); }

// A name that reads like a requirement/prose line, not an entity label. Catches
// the exact over-claim shape: "7. Custom Report Cards (9 cards…)" became an
// encounter type. Conservative — tuned to avoid flagging real multi-word names.
export function looksLikeProse(name) {
  const n = String(name || "").trim();
  if (!n) return false;
  if (/^\d+[.)]\s+/.test(n)) return true;                                  // leading numbering "7. ..."
  if (/\(\s*\d+\s+(cards?|forms?|concepts?|reports?|questions?)\b/i.test(n)) return true; // "(9 cards…)"
  if (/[:;]\s*$/.test(n)) return true;                                     // trailing colon/semicolon
  // Sentence-length. Real Avni entity names top out at 8 words across the
  // reference corpus; requirement prose runs 10+. >9 clears every real name
  // (incl. a 9-word retired "…Don't use (till Dec'23)" form) while catching
  // genuine run-on requirement lines.
  if (n.split(/\s+/).filter((t) => /\w/.test(t)).length > 9) return true;
  return false;
}

// Form types that may legitimately carry zero custom fields, so they must not
// trip FORM_NO_ELEMENTS: enrolment/exit/cancellation shells (generator fix #3),
// and IndividualProfile registration forms (name/DOB come from the subject type,
// so a field-less registration form is valid — confirmed against the reference
// corpus, e.g. water_bodies "Gram panchayat Registration").
const SHELL_TYPES = new Set([
  "ProgramEnrolment", "ProgramExit",
  "ProgramEncounterCancellation", "IndividualEncounterCancellation",
  "IndividualProfile",
]);

// Returns { green:boolean, evaluated:boolean, findings:[{code,entity,message}] }.
// green is true only when evaluated AND no findings. evaluated:false signals the
// bundle could not be read — callers must treat that as "unknown", not clean.
export function completenessFloor(dir) {
  const findings = [];
  const push = (code, entity, message) => findings.push({ code, entity, message });

  let subjectTypes, programs, encounterTypes, formMappings, forms;
  try {
    subjectTypes = activeItems(readJson(path.join(dir, "subjectTypes.json")));
    programs = activeItems(readJson(path.join(dir, "programs.json")));
    encounterTypes = activeItems(readJson(path.join(dir, "encounterTypes.json")));
    formMappings = activeItems(readJson(path.join(dir, "formMappings.json")));

    const formsDir = path.join(dir, "forms");
    forms = [];
    if (fs.existsSync(formsDir)) {
      for (const f of fs.readdirSync(formsDir).filter((n) => n.endsWith(".json"))) {
        const form = readJson(path.join(formsDir, f));
        if (form && !isVoided(form)) forms.push(form);
      }
    }
  } catch (e) {
    return { green: false, evaluated: false, findings: [], error: e.message };
  }

  // 1) PROSE_AS_ENTITY — requirement prose leaked in as an entity name.
  for (const [family, arr] of [
    ["subjectType", subjectTypes], ["program", programs],
    ["encounterType", encounterTypes], ["form", forms],
  ]) {
    for (const e of arr) {
      if (looksLikeProse(e.name)) {
        push("PROSE_AS_ENTITY", `${family}:${e.name}`,
          `"${e.name}" reads like requirement prose, not a ${family} name — route it to a rule / report-card / note, or drop it.`);
      }
    }
  }

  // 2) NO_FORMS — subject types exist but nothing was built.
  if (subjectTypes.length > 0 && forms.length === 0) {
    push("NO_FORMS", "bundle",
      "subject types exist but the bundle has no forms — nothing has been built yet.");
  }

  // 3) FORM_NO_ELEMENTS — a content form (not an enrolment/exit/cancellation
  //    shell) with zero fields is a stub, not a finished form.
  const typeByFormName = new Map(formMappings.map((m) => [m.formName, m.formType]));
  for (const form of forms) {
    const ft = form.formType || typeByFormName.get(form.name);
    if (SHELL_TYPES.has(ft)) continue;
    const nEls = (form.formElementGroups || [])
      .reduce((n, g) => n + ((g.formElements || []).filter((fe) => !isVoided(fe)).length), 0);
    if (nEls === 0) {
      push("FORM_NO_ELEMENTS", `form:${form.name}`,
        `form "${form.name}" (${ft || "unknown type"}) has no fields — a content form should carry its questions.`);
    }
  }

  // 4) PROGRAM_NO_ENROLMENT — a program you cannot enrol anyone into is inert.
  //    Universal: every program needs an entry point, whatever the SRS says.
  //    NOT checked here: "every program has an EXIT form". That looked like a
  //    sibling invariant and is not one — a program can legitimately run for
  //    life. Verified against a real bundle: 2 programs, 1 ProgramExit mapping,
  //    because that SRS leaves the Exit Form column blank on purpose. Whether an
  //    exit form is required is a question only the SRS answers, so it belongs
  //    with the SRS-driven checks, never as an assumed universal here.
  const mappedFormTypesByProgram = new Map();
  for (const m of formMappings) {
    if (!m.programUUID) continue;
    if (!mappedFormTypesByProgram.has(m.programUUID)) mappedFormTypesByProgram.set(m.programUUID, new Set());
    mappedFormTypesByProgram.get(m.programUUID).add(m.formType);
  }
  for (const p of programs) {
    const types = mappedFormTypesByProgram.get(p.uuid);
    if (!types || !types.has("ProgramEnrolment")) {
      push("PROGRAM_NO_ENROLMENT", `program:${p.name}`,
        `program "${p.name}" has no ProgramEnrolment form mapping — nobody can be enrolled into it.`);
    }
  }

  // 5) ENCOUNTER_TYPE_NO_FORM — an encounter type with no form can never be
  //    recorded against. Universal regardless of SRS.
  const encounterUuidsWithForms = new Set(
    formMappings.filter((m) => m.encounterTypeUUID).map((m) => m.encounterTypeUUID),
  );
  for (const et of encounterTypes) {
    if (!encounterUuidsWithForms.has(et.uuid)) {
      push("ENCOUNTER_TYPE_NO_FORM", `encounterType:${et.name}`,
        `encounter type "${et.name}" has no form mapped to it — it can never be recorded.`);
    }
  }

  // 6) CODED_CONCEPT_TOO_FEW_ANSWERS — a coded question with fewer than two
  //    answers is not a choice. One answer is a constant; zero is unanswerable.
  //    Concepts are read here rather than above because this is the only check
  //    that needs them, and an unreadable concepts.json must not fail the rest.
  let concepts = [];
  try { concepts = activeItems(readJson(path.join(dir, "concepts.json"))); } catch { /* skip check */ }
  for (const c of concepts) {
    if (String(c.dataType) !== "Coded") continue;
    const answers = (c.answers || []).filter((a) => a && !isVoided(a));
    if (answers.length < 2) {
      push("CODED_CONCEPT_TOO_FEW_ANSWERS", `concept:${c.name}`,
        `coded concept "${c.name}" has ${answers.length} answer(s) — a coded question needs at least two options to be a choice.`);
    }
  }

  return { green: findings.length === 0, evaluated: true, findings };
}
