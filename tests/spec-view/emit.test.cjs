"use strict";
// Live Spec View — P1 rich emitter tests. CJS reaches the ESM emitter via the
// dynamic-import bridge (rule §5). Deterministic / no-LLM — no ANTHROPIC_API_KEY.
delete process.env.ANTHROPIC_API_KEY; // belt: any AI pass reachable from here clean-skips
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { manifest } = require("../corpus/manifest.cjs");
const { loadOracle } = require("../corpus/lib/corpus-loader.cjs");

async function loadEmit() { return import("../../src/spec-view/emit.js?t=" + Date.now()); }

// Shared row lookups — declared ONCE here; later tasks reference these directly.
const phulwariRow = manifest().find((r) => r.org === "phulwari");
const communityRow = manifest().find((r) => r.org === "community");
const socialSecurityRow = manifest().find((r) => r.org === "social_security");
const skipNoCorpus = !fs.existsSync(phulwariRow.oracle.dir) && "committed corpus siblings not checked out";
const skipNoCommunity = !fs.existsSync(communityRow.oracle.dir) && "community oracle not checked out";
const skipNoSocialSecurity = !fs.existsSync(socialSecurityRow.oracle.dir) && "social_security oracle not checked out";

// ─── Task 1 — readRichBundleFileMap + CI wiring ─────────────────────

test("readRichBundleFileMap reads ancillary files the 13-file whitelist skips", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap } = await loadEmit();
  const dir = loadOracle(phulwariRow);
  const files = readRichBundleFileMap(dir);
  for (const f of ["reportCard.json", "identifierSource.json", "groupRole.json",
                    "catchments.json", "locations.json", "groupDashboards.json",
                    "menuItem.json", "messageRule.json", "groupPrivilege.json",
                    "organisationConfig.json", "formMappings.json"]) {
    assert.ok(f in files, `${f} missing from rich file map`);
  }
  assert.ok(Object.keys(files).some((p) => p.startsWith("forms/")), "forms/ not read");
});

test("genericity-guard scans src/spec-view (new engine surface stays org-agnostic)", async () => {
  const { runGenericityGuard } = require("../corpus/lib/genericity-guard.cjs");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const { pass, violations } = runGenericityGuard(repoRoot);
  assert.ok(pass, `genericity guard failed: ${JSON.stringify(violations)}`);
});

test("package.json test scripts include tests/spec-view and are SDK_SPEC_VIEW-safe", () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"));
  for (const key of ["test", "test:entities"]) {
    assert.match(pkgJson.scripts[key], /tests\/spec-view\/\*\.test\.cjs/, `${key} must run tests/spec-view`);
    assert.match(pkgJson.scripts[key], /SDK_SPEC_VIEW=off/, `${key} must set SDK_SPEC_VIEW=off`);
  }
});

// ─── Task 2 — buildIdentityIndex (11 kinds, C1) ─────────────────────

test("buildIdentityIndex resolves a real groupRole's subject-type UUIDs to names (phulwari)", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex } = await loadEmit();
  const idx = buildIdentityIndex(readRichBundleFileMap(loadOracle(phulwariRow)));
  assert.equal(idx.resolve("ea7e5c94-5e90-4288-803d-6a1aa9d80acd"), "Phulwari"); // subjectTypes.json
  assert.equal(idx.resolve("9f2af1f9-e150-4f8e-aad3-40bb7eb05aa3"), "Child");
});

test("buildIdentityIndex resolves reportCard/reportDashboard/identifierSource/documentation UUIDs to names", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex } = await loadEmit();
  const pIdx = buildIdentityIndex(readRichBundleFileMap(loadOracle(phulwariRow)));
  assert.equal(pIdx.resolve("6085c2f4-52e7-4b08-85b6-d6b2612b4cf5"), "Scheduled visits");   // reportCard.json
  assert.equal(pIdx.resolve("c4d3bc0a-027e-4a6a-87dd-85e5b7285523"), "Default Dashboard");  // reportDashboard.json
  if (!skipNoCommunity) {
    const cIdx = buildIdentityIndex(readRichBundleFileMap(loadOracle(communityRow)));
    assert.equal(cIdx.resolve("12e20f5c-cf7a-42e8-877e-c139c8baa938"), "JSCS sample identifier source"); // identifierSource.json
    assert.equal(cIdx.resolve("802174fe-feee-4a72-b453-388f0cb113e4"), "Don't give Sodium valproate to Epileptic women"); // documentations.json
  }
});

test("buildIdentityIndex excludes voided entities from resolution", async () => {
  const { buildIdentityIndex } = await loadEmit();
  const idx = buildIdentityIndex({
    "subjectTypes.json": [{ uuid: "u1", name: "Live", voided: false }, { uuid: "u2", name: "Dead", voided: true }],
  });
  assert.equal(idx.resolve("u1"), "Live");
  assert.equal(idx.resolve("u2"), null);
  assert.equal(idx.resolve("nope"), null);
});

test("buildIdentityIndex byKind exposes the 11 pinned singular keys (P2 KIND_TO_SECTION binds to these)", async () => {
  const { buildIdentityIndex } = await loadEmit();
  const { byKind } = buildIdentityIndex({});
  assert.deepEqual(Object.keys(byKind).sort(), [
    "addressLevelType", "concept", "documentation", "encounterType", "form",
    "group", "identifierSource", "program", "reportCard", "reportDashboard", "subjectType",
  ]);
});

// ─── Task 3 — bundleToRichEntities core + formMappings scope (M3, M4) ─

test("bundleToRichEntities: real phulwari 'Child Enrolment' resolves subjectType/program via formMappings (not on the raw form)", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex, bundleToRichEntities } = await loadEmit();
  const fileMap = readRichBundleFileMap(loadOracle(phulwariRow));
  const identityIndex = buildIdentityIndex(fileMap);
  const entities = bundleToRichEntities(fileMap, { identityIndex });
  const enrolForm = entities.forms.find((f) => f.name === "Child Enrolment");
  assert.ok(enrolForm, "Child Enrolment form missing");
  assert.equal(enrolForm.formType, "ProgramEnrolment");
  assert.equal(enrolForm.program, "Phulwari");
  // M3: the ProgramEnrolment row's subjectTypeUUID 9f2af1f9 = "Child" — a
  // DIFFERENT subject type from the "Phulwari" GROUP subject type (ea7e5c94).
  assert.equal(enrolForm.subjectType, "Child");

  const prog = entities.programs.find((p) => p.name === "Phulwari");
  assert.equal(prog.target_subject_type, "Child");
  const enc = entities.encounter_types.find((e) => e.name === "Anthropometry Assessment");
  assert.equal(enc.program_name, "Phulwari");
  assert.equal(enc.subject_type, "Child");
});

test("bundleToRichEntities: SDK-patched form (already carries subjectType/program) is left untouched", async () => {
  const { bundleToRichEntities } = await loadEmit();
  const entities = bundleToRichEntities({
    "subjectTypes.json": [{ uuid: "s1", name: "X" }],
    "forms/F_a.json": { uuid: "f1", name: "Reg", formType: "IndividualProfile", subjectType: "X", formElementGroups: [] },
  });
  assert.equal(entities.forms[0].subjectType, "X");
});

test("bundleToRichEntities: caller's fileMap forms are not mutated (deep-cloned before enrich)", async () => {
  const { bundleToRichEntities } = await loadEmit();
  const fileMap = {
    "subjectTypes.json": [{ uuid: "s1", name: "Child" }],
    "formMappings.json": [{ formUUID: "f1", formType: "ProgramEnrolment", subjectTypeUUID: "s1" }],
    "forms/F.json": { uuid: "f1", name: "Enrol", formElementGroups: [] },
  };
  bundleToRichEntities(fileMap);
  assert.equal(fileMap["forms/F.json"].subjectType, undefined, "original fileMap form must stay un-enriched");
});

// ─── Task 4 — address_levels ────────────────────────────────────────

test("bundleToRichEntities: address levels resolve parent by name, voided excluded", async () => {
  const { bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities({
    "addressLevelTypes.json": [
      { uuid: "a1", name: "State", level: 3 },
      { uuid: "a2", name: "Village", level: 1, parent: { uuid: "a1" } },
      { uuid: "a3", name: "Ghost", level: 2, voided: true },
    ],
  });
  assert.deepEqual(e.address_levels.map((r) => r.name).sort(), ["State", "Village"]);
  const village = e.address_levels.find((r) => r.name === "Village");
  assert.equal(village.parent, "State");
});

test("bundleToRichEntities: real phulwari addressLevelTypes.json → one address level (Village, no parent)", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex, bundleToRichEntities } = await loadEmit();
  const fileMap = readRichBundleFileMap(loadOracle(phulwariRow));
  const e = bundleToRichEntities(fileMap, { identityIndex: buildIdentityIndex(fileMap) });
  assert.deepEqual(e.address_levels.map((r) => r.name), ["Village"]);
  assert.equal(e.address_levels[0].parent, undefined);
});

// ─── Task 5 — settings (M11: real Concept + GroupSubject filters) ────

test("bundleToRichEntities: settings resolve subjectType/groupSubjectType/scopeParameters UUIDs, no raw UUID left (phulwari)", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex, bundleToRichEntities } = await loadEmit();
  const fileMap = readRichBundleFileMap(loadOracle(phulwariRow));
  const e = bundleToRichEntities(fileMap, { identityIndex: buildIdentityIndex(fileMap) });
  assert.deepEqual(e.settings.languages, ["en", "hi_IN"]);
  assert.ok(e.settings.searchFilters.length > 0);

  for (const f of e.settings.searchFilters) {
    assert.equal(f.subjectTypeUUID, undefined, "raw subjectTypeUUID must not survive");
    assert.equal(f.groupSubjectTypeUUID, undefined, "raw groupSubjectTypeUUID must not survive");
    assert.equal(f.conceptUUID, undefined, "raw conceptUUID must not survive");
  }
  const nameFilter = e.settings.searchFilters.find((f) => f.type === "Name" && f.subjectType === "Child");
  assert.ok(nameFilter);
  const groupFilter = e.settings.searchFilters.find((f) => f.type === "GroupSubject");
  assert.equal(groupFilter.subjectType, "Child");
  assert.equal(groupFilter.groupSubjectType, "Phulwari");
  const conceptFilter = e.settings.searchFilters.find((f) => f.type === "Concept");
  assert.equal(conceptFilter.conceptName, "Growth Faltering Status"); // preserved as-is
  assert.equal(conceptFilter.scopeParameters.programUUIDs, undefined);
  assert.equal(conceptFilter.scopeParameters.encounterTypeUUIDs, undefined);
  assert.deepEqual(conceptFilter.scopeParameters.programs, ["Phulwari"]);
  assert.deepEqual(conceptFilter.scopeParameters.encounterTypes, ["Anthropometry Assessment"]);
});

// ─── Task 6 — concepts_detail reshape (M6) ──────────────────────────

test("bundleToRichEntities: concepts_detail strips uuid/voided, keeps dataType+bounds+answers, drops NA structural concepts", async () => {
  const { bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities({
    "concepts.json": [
      { uuid: "c1", name: "Weight", dataType: "Numeric", lowAbsolute: 0, highAbsolute: 300, unit: "kg", active: true },
      { uuid: "c2", name: "Gender", dataType: "Coded", answers: [{ uuid: "a1", name: "Male" }, { uuid: "a2", name: "Other", voided: true }] },
      { uuid: "c3", name: "QGroupWrapper", dataType: "NA", active: true },
    ],
  });
  const weight = e.concepts_detail.find((c) => c.name === "Weight");
  assert.equal(weight.uuid, undefined);
  assert.equal(weight.lowAbsolute, 0);
  assert.equal(weight.highAbsolute, 300);
  const gender = e.concepts_detail.find((c) => c.name === "Gender");
  assert.deepEqual(gender.answers, ["Male"]);
  assert.equal(e.concepts_detail.some((c) => c.name === "QGroupWrapper"), false);
});

test("bundleToRichEntities: real phulwari numeric concept bounds use lowAbsolute/highAbsolute", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(phulwariRow)));
  const c = e.concepts_detail.find((x) => x.name === "Day of month for growth monitoring visit");
  assert.equal(c.lowAbsolute, 15);
  assert.equal(c.highAbsolute, 30);
});

test("bundleToRichEntities: concepts_detail also reads hiAbsolute/hiNormal (SDK-patched-bundle spelling)", async () => {
  const { bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities({
    "concepts.json": [{ uuid: "c1", name: "Pulse", dataType: "Numeric", lowAbsolute: 40, hiAbsolute: 180, lowNormal: 60, hiNormal: 100, active: true }],
  });
  const c = e.concepts_detail[0];
  assert.equal(c.highAbsolute, 180);
  assert.equal(c.highNormal, 100);
});

// ─── Task 7 — groupRoles + identifierSources ────────────────────────

test("bundleToRichEntities: real phulwari groupRole resolves role + both subject-type UUIDs to names", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex, bundleToRichEntities } = await loadEmit();
  const fileMap = readRichBundleFileMap(loadOracle(phulwariRow));
  const e = bundleToRichEntities(fileMap, { identityIndex: buildIdentityIndex(fileMap) });
  const role = e.group_roles.find((r) => r.role === "Phulwari Child");
  assert.equal(role.groupSubjectType, "Phulwari");
  assert.equal(role.memberSubjectType, "Child");
  assert.equal(role.maximumNumberOfMembers, 25);
  assert.equal(role.groupSubjectTypeUUID, undefined);
  assert.equal(role.memberSubjectTypeUUID, undefined);
});

test("bundleToRichEntities: identifier_sources omitted when the only row is voided (real phulwari)", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(phulwariRow)));
  assert.equal(e.identifier_sources, undefined);
});

test("bundleToRichEntities: identifier_sources reads prefix from options.prefix (real community non-voided row)", { skip: skipNoCommunity }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(communityRow)));
  const src = e.identifier_sources.find((s) => s.name === "JSCS sample identifier source");
  assert.ok(src, `sources: ${(e.identifier_sources || []).map((s) => s.name).join(", ")}`);
  assert.equal(src.type, "userBasedIdentifierGenerator");
  assert.equal(src.minLength, 5);
});

// ─── Task 8 — relationshipTypes + individualRelations (M7) ──────────

test("relationshipTypes: real community rows collapse nested individualAIsToB/BIsToA objects to aIsToB/bIsToA names", { skip: skipNoCommunity }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(communityRow)));
  assert.ok(e.relationship_types.some((r) => r.aIsToB === "father" && r.bIsToA === "son"));
});

test("relationshipTypes: defensive string-shape fallback (synthetic)", async () => {
  const { bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities({
    "relationshipType.json": [{ uuid: "r1", individualAIsToBRelation: "aunt", individualBIsToARelation: "niece" }],
  });
  assert.deepEqual(e.relationship_types[0], { aIsToB: "aunt", bIsToA: "niece" });
});

test("individualRelations: real social_security rows keep only non-voided gender names", { skip: skipNoSocialSecurity }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(socialSecurityRow)));
  const father = e.individual_relations.find((r) => r.name === "Father");
  assert.deepEqual(father.genders, ["Male"]);
});

// ─── Task 9 — reportCards + reportDashboards ────────────────────────

test("reportCards: real phulwari card uses color, keeps nested/count, drops unresolvable standardReportCardType", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex, bundleToRichEntities } = await loadEmit();
  const fileMap = readRichBundleFileMap(loadOracle(phulwariRow));
  const e = bundleToRichEntities(fileMap, { identityIndex: buildIdentityIndex(fileMap) });
  const card = e.report_cards.find((c) => c.name === "Scheduled visits");
  assert.equal(card.color, "#388e3c");
  assert.equal(card.nested, false);
  assert.equal(card.count, 1);
  assert.equal(card.standardReportCardType, undefined);
  assert.equal(card.colour, undefined);
});

test("reportCards: standardReportCardInput* UUID arrays resolve to names when present", async () => {
  const { bundleToRichEntities, buildIdentityIndex } = await loadEmit();
  const fileMap = {
    "subjectTypes.json": [{ uuid: "s1", name: "Child" }],
    "programs.json": [{ uuid: "p1", name: "ANC" }],
    "encounterTypes.json": [{ uuid: "et1", name: "Visit" }],
    "reportCard.json": [{ uuid: "r1", name: "By subject", color: "#111",
      standardReportCardInputSubjectTypes: ["s1"], standardReportCardInputPrograms: ["p1"], standardReportCardInputEncounterTypes: ["et1"] }],
  };
  const e = bundleToRichEntities(fileMap, { identityIndex: buildIdentityIndex(fileMap) });
  assert.deepEqual(e.report_cards[0].standardReportCardInputSubjectTypes, ["Child"]);
  assert.deepEqual(e.report_cards[0].standardReportCardInputPrograms, ["ANC"]);
  assert.deepEqual(e.report_cards[0].standardReportCardInputEncounterTypes, ["Visit"]);
});

test("reportDashboards: real phulwari dashboard keeps only name (+description), drops sections/filters", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(phulwariRow)));
  const dash = e.report_dashboards.find((d) => d.name === "Default Dashboard");
  assert.ok(dash);
  assert.equal(dash.sections, undefined);
  assert.equal(dash.filters, undefined);
});

// ─── Task 10 — messageRules + menuItems ─────────────────────────────

test("messageRules omitted for real phulwari (empty in every committed-tier org)", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(phulwariRow)));
  assert.equal(e.message_rules, undefined);
});

test("menuItems: real community row keeps displayKey/type/group/linkFunction, drops uuid, omits icon when absent", { skip: skipNoCommunity }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(communityRow)));
  const item = e.menu_items.find((m) => m.displayKey === "JSS internal site");
  assert.ok(item, `menu_items: ${(e.menu_items || []).map((m) => m.displayKey).join(", ")}`);
  assert.equal(item.type, "Link");
  assert.equal(item.group, "Functionality");
  assert.match(item.linkFunction, /sites\.google\.com/);
  assert.equal(item.uuid, undefined);
  assert.equal(item.icon, undefined);
});

test("messageRules: entityTypeUuid resolves to entityTypeName; entityType enum string passes through (synthetic)", async () => {
  const { bundleToRichEntities, buildIdentityIndex } = await loadEmit();
  const fileMap = {
    "encounterTypes.json": [{ uuid: "e1", name: "ANC Visit" }],
    "messageRule.json": [{ uuid: "m1", name: "Reminder Rule", entityType: "ProgramEncounter",
      entityTypeUuid: "e1", messageRule: "'use strict';...", receiverType: "Subject" }],
  };
  const e = bundleToRichEntities(fileMap, { identityIndex: buildIdentityIndex(fileMap) });
  assert.equal(e.message_rules[0].entityType, "ProgramEncounter");
  assert.equal(e.message_rules[0].entityTypeName, "ANC Visit");
  assert.equal(e.message_rules[0].entityTypeUuid, undefined);
});

// ─── Task 11 — groupPrivileges + groupDashboards ────────────────────

test("groupPrivileges: real phulwari groupUUID resolves to group name (no groupName on the row)", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex, bundleToRichEntities } = await loadEmit();
  const fileMap = readRichBundleFileMap(loadOracle(phulwariRow));
  const e = bundleToRichEntities(fileMap, { identityIndex: buildIdentityIndex(fileMap) });
  const everyone = e.group_privileges.find((g) => g.group === "Everyone");
  assert.ok(everyone, `groups: ${e.group_privileges.map((g) => g.group).join(",")}`);
});

test("groupPrivileges: explicit allow:false rows excluded", async () => {
  const { bundleToRichEntities, buildIdentityIndex } = await loadEmit();
  const fileMap = {
    "groups.json": [{ uuid: "g1", name: "Everyone" }],
    "groupPrivilege.json": [{ uuid: "p1", groupUUID: "g1", privilegeType: "Messaging", allow: false }],
  };
  const e = bundleToRichEntities(fileMap, { identityIndex: buildIdentityIndex(fileMap) });
  assert.equal(e.group_privileges, undefined);
});

test("groupDashboards: real community rows keep only non-voided; voided Everyone/Default row excluded", { skip: skipNoCommunity }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(communityRow)));
  assert.ok(e.group_dashboards.every((g) => g.groupName && g.dashboardName));
  assert.ok(!e.group_dashboards.some((g) => g.groupName === "Everyone" && g.dashboardName === "Default Dashboard"), "voided Everyone/Default row must be excluded");
});

// ─── Task 12 — catchments + locations (aggregate) ───────────────────

test("catchments: real community wrapped {catchments:[...]} unwraps, locationCount from locations.length, voided excluded", { skip: skipNoCommunity }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(communityRow)));
  assert.ok(e.catchments.length > 0);
  assert.ok(e.catchments.every((c) => c.name));
  const mehadwani = e.catchments.find((c) => c.name === "mehadwani_chc");
  assert.equal(mehadwani.locationCount, 1);
});

test("locations: aggregates to totalCount + byType, excludes voided", async () => {
  const { bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities({
    "locations.json": [
      { uuid: "l1", name: "A", type: "District" },
      { uuid: "l2", name: "B", type: "District" },
      { uuid: "l3", name: "C", type: "Village", voided: true },
    ],
  });
  assert.equal(e.locations.totalCount, 2);
  assert.deepEqual(e.locations.byType, { District: 2 });
});

// ─── Task 13 — checklists/videos/documentations/ruleDependency ──────

test("documentations: real community rows pull content from documentationItems[0]", { skip: skipNoCommunity }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(communityRow)));
  const doc = e.documentations.find((d) => d.name === "Don't give Sodium valproate to Epileptic women");
  assert.ok(doc, `docs: ${(e.documentations || []).map((d) => d.name).join(" | ")}`);
  assert.equal(typeof doc.content, "string");
  assert.ok(doc.content.length > 0);
});

test("ruleDependency: real community webpacked blob (743KB+) reduces to hasCode+codeLength", { skip: skipNoCommunity }, async () => {
  const { readRichBundleFileMap, bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities(readRichBundleFileMap(loadOracle(communityRow)));
  assert.equal(e.rule_dependency.hasCode, true);
  assert.equal(typeof e.rule_dependency.codeLength, "number");
  assert.ok(e.rule_dependency.codeLength > 100000);
});

test("checklists + videos: reshape when present (synthetic)", async () => {
  const { bundleToRichEntities } = await loadEmit();
  const e = bundleToRichEntities({
    "checklist.json": [{ uuid: "c1", name: "Vaccination", items: [{ concept: { name: "BCG" }, status: [{ state: "Due" }] }] }],
    "video.json": [{ uuid: "v1", title: "Newborn care", filePath: "" }],
  });
  assert.deepEqual(e.checklists[0], { name: "Vaccination", items: [{ name: "BCG", states: ["Due"] }] });
  assert.deepEqual(e.videos[0], { title: "Newborn care", filePath: "" });
});

// ─── Task 14 — deterministic ordering + emitRichSpec (M12) ──────────

test("emitRichSpec: subjectTypes sorted by name regardless of file order", async () => {
  const { emitRichSpec } = await loadEmit();
  const yaml = emitRichSpec({ existingBundleFiles: {
    "subjectTypes.json": [{ uuid: "s2", name: "Zebra" }, { uuid: "s1", name: "Alpha" }],
  }, org: "T" });
  const alphaIdx = yaml.indexOf("Alpha");
  const zebraIdx = yaml.indexOf("Zebra");
  assert.ok(alphaIdx > 0 && zebraIdx > alphaIdx, "Alpha must sort before Zebra");
});

test("emitRichSpec: order-independent — reversed fileMap key order still emits byte-identical YAML (real phulwari)", { skip: skipNoCorpus }, async () => {
  const { readRichBundleFileMap, emitRichSpec } = await loadEmit();
  const fileMap1 = readRichBundleFileMap(loadOracle(phulwariRow));
  const y1 = emitRichSpec({ existingBundleFiles: fileMap1, org: "Phulwari" });
  const fileMap2 = {};
  for (const k of Object.keys(fileMap1).reverse()) fileMap2[k] = fileMap1[k];
  const y2 = emitRichSpec({ existingBundleFiles: fileMap2, org: "Phulwari" });
  assert.equal(y1, y2, "fileMap key order must not affect emitted YAML");
});

test("emitRichSpec: voided form + name-colliding active form — findForm nests the active one", async () => {
  const { emitRichSpec } = await loadEmit();
  const fileMap = {
    "subjectTypes.json": [{ uuid: "s1", name: "Beneficiary" }],
    "formMappings.json": [
      { formUUID: "f-active", subjectTypeUUID: "s1", formType: "IndividualProfile", formName: "Registration", voided: false },
    ],
    "forms/Registration_voided.json": { uuid: "f-voided", name: "Registration", formType: "IndividualProfile", voided: true, formElementGroups: [{ name: "Old", formElements: [] }] },
    "forms/Registration_active.json": { uuid: "f-active", name: "Registration", formType: "IndividualProfile", formElementGroups: [{ name: "New", formElements: [{ name: "Full Name", displayOrder: 1, mandatory: true }] }] },
  };
  const yaml = emitRichSpec({ existingBundleFiles: fileMap, org: "T" });
  assert.match(yaml, /New/);
  assert.doesNotMatch(yaml, /Old/);
});
