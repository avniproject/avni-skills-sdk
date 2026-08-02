"use strict";
// Read an Avni bundle directory and reduce it to sets of active entity names.
// UUID-independent (generator mints deterministic UUIDs; a server export has
// random ones), so parity is compared on normalized NAMES, not raw JSON.
const fs = require("node:fs");
const path = require("node:path");

function normalizeName(name) {
  return String(name == null ? "" : name)
    .replace(/\(voided~\d+\)/gi, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isVoided(entity) {
  if (!entity || typeof entity !== "object") return false;
  if (entity.voided === true) return true;
  return /voided~/i.test(String(entity.name || ""));
}

function readJson(fp) {
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; }
}

function asArray(v, key) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && Array.isArray(v[key])) return v[key];
  return [];
}

function activeNameSet(arr) {
  const s = new Set();
  for (const e of arr) {
    if (!e || isVoided(e)) continue;
    const nm = normalizeName(e.name || e.formName);
    if (nm) s.add(nm);
  }
  return s;
}

// A form "carries" a rule when the field is a non-empty string. The generator
// emits absent/empty for rules it never authored, and a real server export
// carries the function source, so presence is the honest signal either way.
function carriesRule(form, field) {
  const v = form && form[field];
  return typeof v === "string" && v.trim() !== "";
}

function formsCarrying(forms, field) {
  const s = new Set();
  for (const f of forms) {
    if (!f || isVoided(f) || !carriesRule(f, field)) continue;
    const nm = normalizeName(f.name);
    if (nm) s.add(nm);
  }
  return s;
}

// BEHAVIOURAL classes (design gap#4). The six name classes above answer "is the
// entity roster the same". They are silent about whether the config DOES
// anything — and that silence is exactly where the generator's output diverges
// from a real, human-finished bundle. A UAT export of Door Step School carries
// visit schedules on 9 of 30 forms, decision rules on 3, real named user roles
// and real dashboards; a freshly generated bundle carries none of it, and the
// name-only comparator reports full parity regardless.
//
// These are compared as NAME SETS, not counts, for the same reason the entity
// classes are: a count tells you a gap exists, a name set tells you which form
// to fix. Reported by default; gated only via FULL_GATE_CLASSES (parity.cjs),
// so existing callers keep their previous pass/fail semantics.
const BEHAVIOUR_CLASSES = [
  "formsWithVisitScheduleRule",
  "formsWithDecisionRule",
  "formsWithValidationRule",
  "groups",
  "reportCards",
  "reportDashboards",
];

function bundleActiveNames(dir) {
  const j = (f) => readJson(path.join(dir, f));
  const formsDir = path.join(dir, "forms");
  const forms = [];
  if (fs.existsSync(formsDir)) {
    for (const f of fs.readdirSync(formsDir).filter((n) => n.endsWith(".json"))) {
      const form = readJson(path.join(formsDir, f));
      if (form) forms.push(form);
    }
  }
  return {
    addressLevelTypes: activeNameSet(asArray(j("addressLevelTypes.json"), "addressLevelTypes")),
    subjectTypes:      activeNameSet(asArray(j("subjectTypes.json"), "subjectTypes")),
    programs:          activeNameSet(asArray(j("programs.json"), "programs")),
    encounterTypes:    activeNameSet(asArray(j("encounterTypes.json"), "encounterTypes")),
    forms:             activeNameSet(forms),
    formMappings:      activeNameSet(asArray(j("formMappings.json"), "formMappings")),
    // ── behavioural ──
    formsWithVisitScheduleRule: formsCarrying(forms, "visitScheduleRule"),
    formsWithDecisionRule:      formsCarrying(forms, "decisionRule"),
    formsWithValidationRule:    formsCarrying(forms, "validationRule"),
    groups:                     activeNameSet(asArray(j("groups.json"), "groups")),
    reportCards:                activeNameSet(asArray(j("reportCard.json"), "reportCard")),
    reportDashboards:           activeNameSet(asArray(j("reportDashboard.json"), "reportDashboard")),
  };
}

module.exports = { normalizeName, isVoided, bundleActiveNames, BEHAVIOUR_CLASSES };
