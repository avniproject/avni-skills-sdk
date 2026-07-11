// src/spec-view/emit.js — the ONE rich spec emitter (Live Spec View, P1).
//
// Reconstructs a name-keyed, UUID-free, ~25-family entities dict from a bundle
// file map and hands it to the brain's `entitiesToSpec` (unchanged) as the YAML
// serializer. This is the single emitter feeding: pipeline.emitSpec, the MCP
// spec_emit / spec_review tools, the per-turn live-view sync (P3), and
// reviewSpec's subject. Deterministic, no LLM.
//
// Why SDK-side (not in the brain): the missing work is *bundle-shape knowledge*
// — reshaping operational mirrors, resolving cross-ref UUIDs → names, reading
// the ~30 ancillary files. Every piece of bundle-shape knowledge already lives
// SDK-side; the brain's `entitiesToSpec` consumes an entities dict, not a
// bundle, so it is the wrong layer to teach bundle-file shapes. Keeping the
// serializer identical preserves the parser↔emitter round-trip contract.
//
// Public API:
//   readRichBundleFileMap(bundleDir) -> fileMap        // full dir, sorted forms
//   buildIdentityIndex(fileMap)      -> { byKind, resolve }
//   bundleToRichEntities(fileMap, { identityIndex }) -> entities
//   emitRichSpec({ bundleDir, existingBundleFiles, org }) -> YAML string
//
// The module carries ZERO org names (org is a parameter) so the genericity
// guard stays green.

import fs from "node:fs";
import path from "node:path";

// ─── 1. Full-bundle file map ─────────────────────────────────────────
//
// Superset of bundle-mcp-server.js's private 13-file `readBundleFileMap`. Reads
// every ancillary family too. NOTE the singular filenames the real corpus uses
// (`groupRole.json`, not the plural `groupRoles.json` that private map carries —
// that plural is a latent bug against real bundles; this map uses the
// corpus-verified singular name).

const RICH_TOP_LEVEL = [
  // 13 core
  "organisationConfig.json", "addressLevelTypes.json", "subjectTypes.json",
  "operationalSubjectTypes.json", "programs.json", "operationalPrograms.json",
  "encounterTypes.json", "operationalEncounterTypes.json", "concepts.json",
  "formMappings.json", "groups.json", "groupPrivilege.json",
  "individualRelation.json", "relationshipType.json",
  // ancillary — present in the committed corpus
  "groupRole.json", "identifierSource.json", "messageRule.json",
  "catchments.json", "locations.json", "documentations.json",
  "reportCard.json", "reportDashboard.json", "menuItem.json",
  "groupDashboards.json", "ruleDependency.json",
  // ancillary — no committed-corpus example, read defensively if present
  "checklist.json", "video.json", "customQuery.json",
];

export function readRichBundleFileMap(bundleDir) {
  const files = {};
  for (const rel of RICH_TOP_LEVEL) {
    const fp = path.join(bundleDir, rel);
    if (fs.existsSync(fp)) {
      try { files[rel] = JSON.parse(fs.readFileSync(fp, "utf8")); }
      catch { /* malformed JSON degrades to a thin emit — the validator's job */ }
    }
  }
  const formsDir = path.join(bundleDir, "forms");
  if (fs.existsSync(formsDir)) {
    // Sorted so key-insertion order (and downstream Object.entries traversal)
    // is deterministic across machines — readdirSync order is NOT guaranteed.
    for (const f of fs.readdirSync(formsDir).sort()) {
      if (!f.endsWith(".json")) continue;
      try { files[`forms/${f}`] = JSON.parse(fs.readFileSync(path.join(formsDir, f), "utf8")); }
      catch { /* validator's job */ }
    }
  }
  return files;
}

// ─── 2. Identity index — two-way uuid↔name per entity kind ───────────
//
// Used INTERNALLY to resolve cross-ref UUIDs → names during reshaping AND
// (P2) serialized as identity-map.yaml. 11 kinds; the exact singular key
// spelling is a contract (P2's KIND_TO_SECTION binds to these). Voided
// entities are excluded — a voided entity's UUID resolves to null.

const KIND_SOURCES = [
  ["subjectType",      "subjectTypes.json"],
  ["program",          "programs.json"],
  ["encounterType",    "encounterTypes.json"],
  ["group",            "groups.json"],
  ["addressLevelType", "addressLevelTypes.json"],
  ["concept",          "concepts.json"],
  ["reportCard",       "reportCard.json"],
  ["reportDashboard",  "reportDashboard.json"],
  ["identifierSource", "identifierSource.json"],
  ["documentation",    "documentations.json"], // plural filename, singular kind
];

function buildBucket(rows) {
  const uuidToName = new Map(), nameToUuid = new Map();
  for (const e of (rows || [])) {
    if (!e || e.voided || !e.uuid) continue;
    uuidToName.set(e.uuid, e.name || "");
    if (e.name && !nameToUuid.has(e.name)) nameToUuid.set(e.name, e.uuid);
  }
  return { uuidToName, nameToUuid };
}

export function buildIdentityIndex(fileMap) {
  const map = fileMap || {};
  const byKind = {};
  for (const [kind, file] of KIND_SOURCES) {
    byKind[kind] = buildBucket(Array.isArray(map[file]) ? map[file] : []);
  }
  // form: keyed from forms/*.json entries (object values, not an array file)
  const formRows = Object.entries(map)
    .filter(([p]) => p.startsWith("forms/") && p.endsWith(".json"))
    .map(([, v]) => v);
  byKind.form = buildBucket(formRows);

  function resolve(uuid) {
    if (!uuid) return null;
    for (const kind of Object.keys(byKind)) {
      const name = byKind[kind].uuidToName.get(uuid);
      if (name !== undefined) return name;
    }
    return null;
  }
  return { byKind, resolve };
}

// ─── 3. Rich entities reconstruction ─────────────────────────────────

const arrOf = (fileMap, k) => (Array.isArray(fileMap[k]) ? fileMap[k] : []);
const notVoided = (e) => !(e && e.voided);

// Real bundle forms carry NO subjectType/program/encounterType — only
// {name, uuid, formType}. Scope lives in formMappings.json. This enriches each
// form in place (on a clone) so the emitter's findForm can nest it under the
// right subjectType/program/encounterType block. Idempotent: only fills a field
// when absent, so SDK-patched forms (which already carry scope) are untouched.
function enrichFormsFromMappings(forms, formMappings, identityIndex) {
  const byName = new Map(), byUuid = new Map();
  for (const fm of (formMappings || [])) {
    if (fm.voided) continue;
    if (fm.formName && !byName.has(fm.formName)) byName.set(fm.formName, fm);
    if (fm.formUUID && !byUuid.has(fm.formUUID)) byUuid.set(fm.formUUID, fm);
  }
  for (const f of forms) {
    const fm = byUuid.get(f.uuid) || byName.get(f.name);
    if (!fm) continue;
    if (!f.formType && fm.formType) f.formType = fm.formType;
    if (!f.subjectType && fm.subjectTypeUUID) f.subjectType = identityIndex.resolve(fm.subjectTypeUUID) || "";
    if (!f.program && fm.programUUID) f.program = identityIndex.resolve(fm.programUUID) || "";
    if (!f.encounterType && fm.encounterTypeUUID) f.encounterType = identityIndex.resolve(fm.encounterTypeUUID) || "";
  }
}

// Direct formMappings → scope maps (mirrors avni-ai spec_handlers.py's
// enc_uuid_to_prog / enc_uuid_to_st / prog_uuid_to_st). Derived independently of
// the forms array, so program/encounterType scope never depends on form
// enrichment having run first (M4 — removes the ordering hazard by construction).
function deriveScopeMaps(formMappings, identityIndex) {
  const progUuidToSt = new Map(), encUuidToProg = new Map(), encUuidToSt = new Map();
  for (const fm of (formMappings || [])) {
    if (fm.voided) continue;
    const { encounterTypeUUID: e, programUUID: p, subjectTypeUUID: s, formType } = fm;
    if (e && p) encUuidToProg.set(e, identityIndex.resolve(p) || "");
    if (e && s) encUuidToSt.set(e, identityIndex.resolve(s) || "");
    if (p && s && formType === "ProgramEnrolment") progUuidToSt.set(p, identityIndex.resolve(s) || "");
  }
  return { progUuidToSt, encUuidToProg, encUuidToSt };
}

// address levels — resolve parent (object {uuid} | name string) to a name; the
// emitter sorts DESC by level, so this leaves file order otherwise untouched.
function buildAddressLevels(rows, identityIndex) {
  return (rows || []).filter(notVoided).map((a) => {
    const out = { name: a.name, level: a.level == null ? 1 : a.level };
    const parentRef = a.parent && typeof a.parent === "object" ? a.parent.uuid : a.parent;
    if (parentRef) {
      const parentName = identityIndex.resolve(parentRef) || (typeof a.parent === "string" ? a.parent : "");
      if (parentName) out.parent = parentName;
    }
    return out;
  });
}

// ─── settings (organisationConfig) — resolve every cross-ref UUID → name ──
// searchFilters/myDashboardFilters carry raw FK UUIDs (subjectTypeUUID,
// groupSubjectTypeUUID, scopeParameters.{programUUIDs,encounterTypeUUIDs}) and a
// conceptUUID alongside an already-resolved conceptName. Resolve/strip them all
// so ZERO raw UUIDs survive into the body (M11).
const SETTINGS_PASSTHROUGH = [
  "enableComments", "enableMessaging", "saveDrafts", "skipRuleExecution",
  "enableRuleDesigner", "metabaseSetupEnabled", "showHierarchicalLocation",
  "customRegistrationLocations", "searchResultFields", "worklistUpdationRule",
];

function resolveFilterEntry(f, identityIndex) {
  const out = { ...f };
  if (out.subjectTypeUUID) { out.subjectType = identityIndex.resolve(out.subjectTypeUUID) || ""; delete out.subjectTypeUUID; }
  if (out.groupSubjectTypeUUID) { out.groupSubjectType = identityIndex.resolve(out.groupSubjectTypeUUID) || ""; delete out.groupSubjectTypeUUID; }
  if (out.conceptUUID) delete out.conceptUUID; // conceptName already carries the resolved name
  if (out.scopeParameters && typeof out.scopeParameters === "object") {
    const sp = { ...out.scopeParameters };
    if (sp.programUUIDs) { sp.programs = sp.programUUIDs.map((u) => identityIndex.resolve(u)).filter(Boolean); delete sp.programUUIDs; }
    if (sp.encounterTypeUUIDs) { sp.encounterTypes = sp.encounterTypeUUIDs.map((u) => identityIndex.resolve(u)).filter(Boolean); delete sp.encounterTypeUUIDs; }
    out.scopeParameters = sp;
  }
  return out;
}

function buildSettings(orgConfig, identityIndex) {
  const src = (orgConfig && (orgConfig.settings || orgConfig.organisationConfig)) || {};
  const out = {};
  const langs = Array.isArray(src.languages) && src.languages.length ? src.languages : ["en"];
  out.languages = langs;
  for (const k of SETTINGS_PASSTHROUGH) {
    if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
  }
  for (const key of ["searchFilters", "myDashboardFilters"]) {
    if (Array.isArray(src[key]) && src[key].length) {
      out[key] = src[key].map((f) => resolveFilterEntry(f, identityIndex));
    }
  }
  return out;
}

// concepts_detail — name-keyed, UUID-free. Reads BOTH numeric-bound spellings:
// server exports use lowAbsolute/highAbsolute; the brain's parser writes SDK-
// authored bounds as lowAbsolute/hiAbsolute (asymmetric — M6). NA structural
// concepts with no answers/keyValues carry no intent and are dropped.
function buildConceptsDetail(rows) {
  const out = [];
  for (const c of (rows || [])) {
    if (!c || c.voided || c.active === false) continue;
    const answers = Array.isArray(c.answers)
      ? c.answers.filter((a) => a && !a.voided).map((a) => (typeof a === "object" ? a.name : String(a)))
      : null;
    const hasKeyValues = Array.isArray(c.keyValues) ? c.keyValues.length > 0
      : (c.keyValues && typeof c.keyValues === "object" && Object.keys(c.keyValues).length > 0);
    if (c.dataType === "NA" && !(answers && answers.length) && !hasKeyValues) continue;
    const rc = { name: c.name, dataType: c.dataType };
    if (answers && answers.length) rc.answers = answers;
    const lowAbsolute = c.lowAbsolute;
    const highAbsolute = c.highAbsolute ?? c.hiAbsolute;
    const lowNormal = c.lowNormal;
    const highNormal = c.highNormal ?? c.hiNormal;
    if (lowAbsolute != null) rc.lowAbsolute = lowAbsolute;
    if (highAbsolute != null) rc.highAbsolute = highAbsolute;
    if (lowNormal != null) rc.lowNormal = lowNormal;
    if (highNormal != null) rc.highNormal = highNormal;
    if (c.unit) rc.unit = c.unit;
    out.push(rc);
  }
  return out;
}

// Families that must be ABSENT (undefined) when they have no active rows, so the
// emitter's truthy/non-empty passthrough guard omits the key entirely.
function undefinedIfEmpty(rows) { return rows && rows.length ? rows : undefined; }

function buildGroupRoles(rows, identityIndex) {
  const active = (rows || []).filter(notVoided).map((r) => {
    const out = {
      role: r.role || "",
      groupSubjectType: identityIndex.resolve(r.groupSubjectTypeUUID) || "",
      memberSubjectType: identityIndex.resolve(r.memberSubjectTypeUUID) || "",
    };
    if (r.maximumNumberOfMembers != null) out.maximumNumberOfMembers = r.maximumNumberOfMembers;
    if (r.minimumNumberOfMembers != null) out.minimumNumberOfMembers = r.minimumNumberOfMembers;
    if (r.primary) out.primary = true;
    return out;
  });
  return undefinedIfEmpty(active);
}

function buildIdentifierSources(rows) {
  const active = (rows || []).filter(notVoided).map((s) => {
    const out = { name: s.name || "" };
    if (s.type) out.type = s.type;
    const prefix = s.options && typeof s.options === "object" ? s.options.prefix : undefined;
    if (prefix) out.prefix = prefix;
    if (s.minLength != null) out.minLength = s.minLength;
    if (s.maxLength != null) out.maxLength = s.maxLength;
    return out;
  });
  return undefinedIfEmpty(active);
}

// relationshipType.json stores individualAIsToBRelation/BIsToARelation as nested
// {uuid,id,name,genders} objects in the real corpus; the string branch is a
// defensive fallback for a hypothetical alternate export shape (M7).
function relationName(v) {
  if (v == null) return "";
  return typeof v === "string" ? v : (v.name || "");
}
function buildRelationshipTypes(rows) {
  const active = (rows || []).filter(notVoided)
    .map((r) => ({ aIsToB: relationName(r.individualAIsToBRelation), bIsToA: relationName(r.individualBIsToARelation) }));
  return undefinedIfEmpty(active);
}
function buildIndividualRelations(rows) {
  const active = (rows || []).filter(notVoided).map((r) => ({
    name: r.name || "",
    genders: (r.genders || []).filter((g) => g && !g.voided).map((g) => (typeof g === "object" ? g.name : String(g))),
  }));
  return undefinedIfEmpty(active);
}

// reportCard: strip uuid/id; resolve every standardReportCardInput* UUID array
// (subjectTypes/programs/encounterTypes) to names; drop standardReportCardType
// (a UUID with no bundle-local name source). `color` is the real corpus spelling
// (not `colour`). nested/count are kept — the intent view wants them.
function resolveUuidArray(arr, identityIndex) {
  return (Array.isArray(arr) ? arr : []).map((u) => identityIndex.resolve(u)).filter(Boolean);
}
function buildReportCards(rows, identityIndex) {
  const active = (rows || []).filter(notVoided).map((c) => {
    const out = { name: c.name || "" };
    if (c.color != null) out.color = c.color;
    if (c.nested != null) out.nested = c.nested;
    if (c.count != null) out.count = c.count;
    if (c.description) out.description = c.description;
    for (const [src, key] of [
      ["standardReportCardInputSubjectTypes", "standardReportCardInputSubjectTypes"],
      ["standardReportCardInputPrograms", "standardReportCardInputPrograms"],
      ["standardReportCardInputEncounterTypes", "standardReportCardInputEncounterTypes"],
    ]) {
      const names = resolveUuidArray(c[src], identityIndex);
      if (names.length) out[key] = names;
    }
    return out;
  });
  return undefinedIfEmpty(active);
}
function buildReportDashboards(rows) {
  const active = (rows || []).filter(notVoided).map((d) => {
    const out = { name: d.name || "" };
    if (d.description) out.description = d.description;
    return out;
  });
  return undefinedIfEmpty(active);
}

// messageRule: entityType is the type-enum STRING (passes through); entityTypeUuid
// is the FK to the concrete entity — resolved to entityTypeName, then dropped.
function buildMessageRules(rows, identityIndex) {
  const active = (rows || []).filter(notVoided).map((r) => {
    const out = { name: r.name || "" };
    if (r.entityType) out.entityType = r.entityType;
    if (r.entityTypeUuid) { const n = identityIndex.resolve(r.entityTypeUuid); if (n) out.entityTypeName = n; }
    if (r.receiverType) out.receiverType = r.receiverType;
    if (r.messageRule) out.messageRule = r.messageRule;
    if (r.scheduleRule) out.scheduleRule = r.scheduleRule;
    return out;
  });
  return undefinedIfEmpty(active);
}
function buildMenuItems(rows) {
  const active = (rows || []).filter(notVoided).map((m) => {
    const out = { displayKey: m.displayKey || "" };
    if (m.type) out.type = m.type;
    if (m.icon) out.icon = m.icon;
    if (m.group) out.group = m.group;
    if (m.linkFunction) out.linkFunction = m.linkFunction;
    return out;
  });
  return undefinedIfEmpty(active);
}

// groupPrivilege rows carry groupUUID only (never groupName) plus optional
// scoping FKs (subjectTypeUUID/programUUID/encounterTypeUUID/programEncounterType
// UUID). Group by resolved group name; resolve every scoping UUID; drop allow:false
// and voided rows.
function buildGroupPrivileges(rows, identityIndex) {
  const byGroup = new Map();
  for (const r of (rows || [])) {
    if (r.voided || r.allow === false) continue;
    const group = identityIndex.resolve(r.groupUUID) || "";
    const priv = {};
    if (r.privilegeType) priv.type = r.privilegeType;
    for (const [uKey, nKey] of [
      ["subjectTypeUUID", "subjectType"], ["programUUID", "program"],
      ["encounterTypeUUID", "encounterType"], ["programEncounterTypeUUID", "programEncounterType"],
    ]) {
      if (r[uKey]) { const n = identityIndex.resolve(r[uKey]); if (n) priv[nKey] = n; }
    }
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(priv);
  }
  if (!byGroup.size) return undefined;
  return [...byGroup.entries()].map(([group, privileges]) => ({ group, privileges }));
}

function buildGroupDashboards(rows) {
  const active = (rows || []).filter(notVoided).map((d) => {
    const out = { groupName: d.groupName || "", dashboardName: d.dashboardName || "" };
    if (d.primaryDashboard != null) out.primaryDashboard = d.primaryDashboard;
    if (d.secondaryDashboard != null) out.secondaryDashboard = d.secondaryDashboard;
    return out;
  });
  return undefinedIfEmpty(active);
}

// catchments.json is wrapped {catchments:[...]} in real exports (or a bare
// array). Emit {name, locationCount?} — the location membership itself is
// instance data, out of scope for the intent view.
function buildCatchments(raw) {
  const rows = Array.isArray(raw) ? raw
    : (raw && typeof raw === "object" && Array.isArray(raw.catchments) ? raw.catchments : []);
  const active = rows.filter(notVoided).map((c) => {
    const out = { name: c.name || "" };
    if (Array.isArray(c.locations)) out.locationCount = c.locations.length;
    return out;
  });
  return undefinedIfEmpty(active);
}

// locations.json can be 9,000+ instance rows — never list them; aggregate to a
// count + a per-type breakdown. byType keys are sorted alphabetically for
// byte-stability (locations aren't name-array-shaped so the per-array name-sort
// doesn't apply — this is a deliberate determinism choice).
function buildLocationsSummary(rows) {
  const active = (rows || []).filter(notVoided);
  if (!active.length) return undefined;
  const counts = {};
  for (const l of active) { const t = l.type || "Unknown"; counts[t] = (counts[t] || 0) + 1; }
  const byType = {};
  for (const t of Object.keys(counts).sort()) byType[t] = counts[t];
  return { totalCount: active.length, byType };
}

export function bundleToRichEntities(fileMap, { identityIndex } = {}) {
  if (!fileMap || typeof fileMap !== "object") {
    throw new Error("bundleToRichEntities: fileMap object required");
  }
  const idx = identityIndex || buildIdentityIndex(fileMap);

  const subjectTypes   = arrOf(fileMap, "subjectTypes.json").filter(notVoided);
  const programsRaw    = arrOf(fileMap, "programs.json").filter(notVoided);
  const encounterTypes = arrOf(fileMap, "encounterTypes.json").filter(notVoided);
  const groups         = arrOf(fileMap, "groups.json").filter(notVoided);
  const formMappings   = arrOf(fileMap, "formMappings.json");
  const { progUuidToSt, encUuidToProg, encUuidToSt } = deriveScopeMaps(formMappings, idx);

  // Forms — collected from the file map, deep-CLONED (so the caller's fileMap is
  // never mutated and enrich/sanitize is fully idempotent for the
  // order-independence re-emit), voided-filtered, then enriched in place.
  const forms = Object.entries(fileMap)
    .filter(([p]) => p.startsWith("forms/") && p.endsWith(".json"))
    .map(([, f]) => f)
    .filter((f) => f && typeof f === "object" && !Array.isArray(f) && !f.voided)
    .map((f) => structuredClone(f));
  enrichFormsFromMappings(forms, formMappings, idx);

  const orgConfig = fileMap["organisationConfig.json"];

  return {
    org_name: "",
    settings: buildSettings(orgConfig, idx),
    address_levels: buildAddressLevels(arrOf(fileMap, "addressLevelTypes.json"), idx),
    subject_types: subjectTypes.map((s) => ({ ...s })),
    programs: programsRaw.map((p) => ({
      ...p,
      name: p.name,
      target_subject_type: p.target_subject_type || progUuidToSt.get(p.uuid) || "",
    })),
    encounter_types: encounterTypes.map((e) => ({
      ...e,
      name: e.name,
      program_name: e.program_name || encUuidToProg.get(e.uuid) || "",
      subject_type: e.subject_type || encUuidToSt.get(e.uuid) || "",
      is_program_encounter: e.is_program_encounter != null ? !!e.is_program_encounter : encUuidToProg.has(e.uuid),
      is_scheduled: e.is_scheduled == null ? true : !!e.is_scheduled,
    })),
    groups: groups.map((g) => ({ name: g.name, has_all_privileges: !!g.hasAllPrivileges })),
    forms,
    concepts_detail: buildConceptsDetail(arrOf(fileMap, "concepts.json")),
    group_roles: buildGroupRoles(arrOf(fileMap, "groupRole.json"), idx),
    identifier_sources: buildIdentifierSources(arrOf(fileMap, "identifierSource.json")),
    relationship_types: buildRelationshipTypes(arrOf(fileMap, "relationshipType.json")),
    individual_relations: buildIndividualRelations(arrOf(fileMap, "individualRelation.json")),
    report_cards: buildReportCards(arrOf(fileMap, "reportCard.json"), idx),
    report_dashboards: buildReportDashboards(arrOf(fileMap, "reportDashboard.json")),
    message_rules: buildMessageRules(arrOf(fileMap, "messageRule.json"), idx),
    menu_items: buildMenuItems(arrOf(fileMap, "menuItem.json")),
    group_privileges: buildGroupPrivileges(arrOf(fileMap, "groupPrivilege.json"), idx),
    group_dashboards: buildGroupDashboards(arrOf(fileMap, "groupDashboards.json")),
    catchments: buildCatchments(fileMap["catchments.json"]),
    locations: buildLocationsSummary(arrOf(fileMap, "locations.json")),
  };
}
