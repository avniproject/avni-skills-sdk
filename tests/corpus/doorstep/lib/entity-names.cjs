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
  };
}

module.exports = { normalizeName, isVoided, bundleActiveNames };
