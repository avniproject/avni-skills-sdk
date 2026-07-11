"use strict";
// Reduce a bundle dir to full-depth, name-keyed, UUID-independent sets:
// entity graph + concepts + coded answers + form elements + form groups +
// rule-field PRESENCE. Voided/inactive entities and admin/instance artifacts
// (locations, catchments, groups, privileges, translations, icons) are excluded.
const fs = require("node:fs");
const path = require("node:path");
const { normalizeName, isVoided } = require("../doorstep/lib/entity-names.cjs");

// An entity is out if voided, name-marked voided, or explicitly active:false.
function isInactive(e) {
  if (isVoided(e)) return true;
  return !!(e && e.active === false);
}

function readJson(fp) {
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; }
}
function asArray(v, key) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && Array.isArray(v[key])) return v[key];
  return [];
}
function activeNames(arr) {
  const s = new Set();
  for (const e of arr) {
    if (!e || isInactive(e)) continue;
    const nm = normalizeName(e.name || e.formName);
    if (nm) s.add(nm);
  }
  return s;
}
// A rule field counts as present iff it holds real content (not "", null, "null", {}).
function nonEmpty(v) {
  if (v == null) return false;
  if (typeof v === "string") { const t = v.trim(); return t.length > 0 && t.toLowerCase() !== "null"; }
  if (typeof v === "object") return Object.keys(v).length > 0;
  return !!v;
}

const RULE_FIELDS = {
  subjectType: ["subjectSummaryRule"],
  program: ["enrolmentEligibilityCheckRule", "enrolmentSummaryRule", "manualEnrolmentEligibilityCheckRule"],
  encounterType: ["entityEligibilityCheckRule"],
  form: ["decisionRule", "visitScheduleRule", "validationRule", "checklistsRule", "editFormRule"],
};

function loadForms(dir) {
  const out = [];
  const fd = path.join(dir, "forms");
  if (fs.existsSync(fd)) {
    for (const f of fs.readdirSync(fd).filter((n) => n.endsWith(".json"))) {
      const form = readJson(path.join(fd, f));
      if (form) out.push(form);
    }
  }
  return out;
}

function bundleDeepNames(dir) {
  const j = (f) => readJson(path.join(dir, f));
  const subjectTypes = asArray(j("subjectTypes.json"), "subjectTypes");
  const programs = asArray(j("programs.json"), "programs");
  const encounterTypes = asArray(j("encounterTypes.json"), "encounterTypes");
  const concepts = asArray(j("concepts.json"), "concepts");
  const formMappings = asArray(j("formMappings.json"), "formMappings");
  const forms = loadForms(dir);
  const orgConfig = j("organisationConfig.json");

  const codedAnswers = new Set();
  for (const c of concepts) {
    if (!c || isInactive(c)) continue;
    const cn = normalizeName(c.name);
    for (const a of c.answers || []) {
      if (!a || isInactive(a)) continue;
      const an = normalizeName(a.name);
      if (cn && an) codedAnswers.add(`${cn} › ${an}`);
    }
  }

  const formElements = new Set();
  const formGroups = new Set();
  for (const form of forms) {
    if (isInactive(form)) continue;
    const fn = normalizeName(form.name);
    for (const g of form.formElementGroups || []) {
      if (!g || isInactive(g)) continue;
      const gn = normalizeName(g.name);
      if (fn && gn) formGroups.add(`${fn} › ${gn}`);
      for (const fe of g.formElements || []) {
        if (!fe || isInactive(fe)) continue;
        const en = normalizeName(fe.name);
        if (fn && en) formElements.add(`${fn} › ${en}`);
      }
    }
  }

  const ruleFields = new Set();
  const scan = (kind, arr) => {
    for (const e of arr) {
      if (!e || isInactive(e)) continue;
      const nm = normalizeName(e.name);
      for (const rf of RULE_FIELDS[kind]) if (nonEmpty(e[rf])) ruleFields.add(`${kind}:${nm}:${rf}`);
    }
  };
  scan("subjectType", subjectTypes);
  scan("program", programs);
  scan("encounterType", encounterTypes);
  for (const form of forms) {
    if (isInactive(form)) continue;
    const nm = normalizeName(form.name);
    for (const rf of RULE_FIELDS.form) if (nonEmpty(form[rf])) ruleFields.add(`form:${nm}:${rf}`);
  }
  if (orgConfig && nonEmpty(orgConfig.worklistUpdationRule)) ruleFields.add("organisation::worklistUpdationRule");

  return {
    subjectTypes: activeNames(subjectTypes),
    programs: activeNames(programs),
    encounterTypes: activeNames(encounterTypes),
    forms: activeNames(forms),
    formMappings: activeNames(formMappings),
    concepts: activeNames(concepts),
    codedAnswers,
    formElements,
    formGroups,
    ruleFields,
  };
}

module.exports = { bundleDeepNames, isInactive, RULE_FIELDS };
