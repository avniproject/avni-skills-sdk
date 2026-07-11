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

// M11 (grounded via the T16 corpus scan): community's organisationConfig also
// carries customRegistrationLocations (subjectTypeUUID + locationTypeUUIDs FKs)
// and searchResultFields (subjectTypeUUID + searchResultConcepts[].uuid) — both
// SETTINGS_PASSTHROUGH families the original Task 5 left as raw-UUID passthrough.
// "Zero raw UUIDs in the body" requires resolving these too, exactly like the
// searchFilters treatment.
test("bundleToRichEntities: settings customRegistrationLocations + searchResultFields resolve every FK to a name (real community)", { skip: skipNoCommunity }, async () => {
  const { readRichBundleFileMap, buildIdentityIndex, bundleToRichEntities } = await loadEmit();
  const fileMap = readRichBundleFileMap(loadOracle(communityRow));
  const e = bundleToRichEntities(fileMap, { identityIndex: buildIdentityIndex(fileMap) });

  const crl = e.settings.customRegistrationLocations || [];
  assert.ok(crl.length > 0, "community has customRegistrationLocations");
  for (const c of crl) {
    assert.equal(c.subjectTypeUUID, undefined, "raw subjectTypeUUID must not survive");
    assert.equal(c.locationTypeUUIDs, undefined, "raw locationTypeUUIDs must not survive");
    assert.equal(typeof c.subjectType, "string");
    assert.ok(Array.isArray(c.locationTypes));
  }
  const labFacility = crl.find((c) => c.subjectType === "Lab Facility");
  assert.ok(labFacility, `subjectTypes: ${crl.map((c) => c.subjectType).join(", ")}`);
  assert.deepEqual(labFacility.locationTypes, ["Village"]);

  const srf = e.settings.searchResultFields || [];
  assert.ok(srf.length > 0, "community has searchResultFields");
  for (const f of srf) {
    assert.equal(f.subjectTypeUUID, undefined, "raw subjectTypeUUID must not survive");
    assert.equal(f.subjectTypeName, undefined, "subjectTypeName collapses to subjectType");
    assert.equal(typeof f.subjectType, "string");
    for (const c of (f.searchResultConcepts || [])) {
      assert.equal(c.uuid, undefined, "raw searchResultConcepts[].uuid must not survive");
      assert.equal(typeof c.name, "string");
    }
  }
  const vhsnd = srf.find((f) => f.subjectType === "VHSND");
  assert.ok(vhsnd, `srf subjectTypes: ${srf.map((f) => f.subjectType).join(", ")}`);
  assert.ok(vhsnd.searchResultConcepts.some((c) => c.name === "VHSND Planned day"));
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

// ─── Task 16 — corpus-fidelity acceptance gate (the P1 acceptance test) ──
// Runs the full rich emit over EVERY runnable committed org and asserts the
// name-keyed / UUID-free / deterministic / voided-excluded contract against real
// bundles. Deterministic, no LLM, CI-safe.

const { listRunnableOrgs } = require("../corpus/lib/corpus-loader.cjs");
const { bundleDeepNames } = require("../corpus/lib/deep-names.cjs");
const { normalizeName } = require("../corpus/doorstep/lib/entity-names.cjs");

// Mirrors src/crl/compliance-doc.js's resolveBrainPath — env or sibling clone
// (C2: never a bare, undeclared AVNI_SKILLS_PATH reference).
function resolveBrainPath() {
  return process.env.AVNI_SKILLS_PATH || path.resolve(__dirname, "..", "..", "..", "avni-skills");
}
const YAML = require(path.join(resolveBrainPath(), "node_modules", "js-yaml"));

const real = process.env.RUN_REAL === "1";
const orgs = listRunnableOrgs(manifest(), { real });
// >=5 (avni-impl-bundles oracle-only orgs) is the hard floor; >=10 additionally
// requires the avni-ai sibling to be cloned — common here, not guaranteed on
// every machine, so it's a conditional, not a hard CI requirement (note #9).
const hasAvniAi = fs.existsSync(path.resolve(resolveBrainPath(), "..", "avni-ai"));

// Memoize oracle dirs so zip-based orgs extract at most once across all tests.
const _oracleDir = new Map();
function oracleDir(row) {
  if (!_oracleDir.has(row.org)) _oracleDir.set(row.org, loadOracle(row));
  return _oracleDir.get(row.org);
}

// Keys whose SUBTREE the value/key scans do NOT descend into — brain-emitter
// passthrough this module does not reshape: rule bodies + declarative-rule IR
// (which legitimately reference concepts/answers by UUID, exactly the rule-body
// exception note #13 documents), form-element config the brain emits verbatim
// (keyValues, documentation refs, parentFormElementUuid, validFormat), and S3
// asset keys (iconFileS3Key — an asset URL, not an entity FK). Verified across
// all committed orgs: with these skipped, ZERO UUID values and ZERO banned FK
// key-names survive anywhere this reshaper is responsible for.
const SKIP_SUBTREE = new Set([
  "subjectSummaryRule", "programEligibilityCheckRule", "memberAdditionEligibilityCheckRule",
  "enrolmentEligibilityCheckRule", "manualEnrolmentEligibilityCheckRule", "enrolmentSummaryRule",
  "encounterEligibilityCheckRule", "entityEligibilityCheckRule", "decisionRule", "validationRule",
  "visitScheduleRule", "checklistsRule", "editFormRule", "rule", "declarativeRule", "skipLogic",
  "entityEligibilityCheckDeclarativeRule", "enrolmentEligibilityCheckDeclarativeRule",
  "manualEnrolmentEligibilityCheckDeclarativeRule", "messageRule", "scheduleRule",
  "worklistUpdationRule", "keyValues", "documentation", "parentFormElementUuid",
  "validFormat", "iconFileS3Key",
]);

test("corpus fidelity: baseline org count", { skip: orgs.length === 0 && "no runnable orgs" }, async () => {
  assert.ok(orgs.length >= 5, `expected >=5 committed orgs (avni-impl-bundles), got ${orgs.length}`);
  if (hasAvniAi && !real) assert.ok(orgs.length >= 10, `avni-ai sibling present but only ${orgs.length} orgs runnable`);
});

test(`corpus fidelity: every active subjectType/program/encounterType name appears by name in emitRichSpec (${orgs.length} orgs)`, { skip: orgs.length === 0 && "no runnable orgs" }, async () => {
  const { emitRichSpec } = await loadEmit();
  for (const row of orgs) {
    const dir = oracleDir(row);
    const spec = YAML.load(emitRichSpec({ bundleDir: dir, org: row.org }));
    const deep = bundleDeepNames(dir);
    // normalizeName on BOTH sides (collapses whitespace + strips "(voided~N)").
    const specNames = new Set([
      ...(spec.subjectTypes || []).map((s) => s.name),
      ...(spec.programs || []).map((p) => p.name),
      ...(spec.encounterTypes || []).map((e) => e.name),
      ...(spec.concepts || []).map((c) => c.name),
    ].map(normalizeName));
    for (const nm of deep.subjectTypes) assert.ok(specNames.has(nm), `${row.org}: subjectType "${nm}" missing from spec`);
    for (const nm of deep.programs) assert.ok(specNames.has(nm), `${row.org}: program "${nm}" missing from spec`);
    for (const nm of deep.encounterTypes) assert.ok(specNames.has(nm), `${row.org}: encounterType "${nm}" missing from spec`);
  }
});

test(`corpus fidelity: subjectTypes with an active IndividualProfile mapping get a non-empty registrationForm (${orgs.length} orgs)`, { skip: orgs.length === 0 && "no runnable orgs" }, async () => {
  const { emitRichSpec } = await loadEmit();
  for (const row of orgs) {
    const dir = oracleDir(row);
    const fmPath = path.join(dir, "formMappings.json");
    if (!fs.existsSync(fmPath)) continue;
    const fm = JSON.parse(fs.readFileSync(fmPath, "utf8") || "[]");
    if (!fm.some((m) => !m.voided && m.formType === "IndividualProfile")) continue;
    const spec = YAML.load(emitRichSpec({ bundleDir: dir, org: row.org }));
    assert.ok((spec.subjectTypes || []).some((s) => s.registrationForm?.sections?.length),
      `${row.org}: no subjectType got a non-empty registrationForm despite an IndividualProfile mapping`);
  }
});

// M4 — the encounter/program form-nesting fix, distinct from registrationForm
// (this exercises ProgramEncounter, which the ordering bug would have emptied).
test(`corpus fidelity: encounterTypes with an active ProgramEncounter mapping get a non-empty form block (${orgs.length} orgs)`, { skip: orgs.length === 0 && "no runnable orgs" }, async () => {
  const { emitRichSpec } = await loadEmit();
  for (const row of orgs) {
    const dir = oracleDir(row);
    const fmPath = path.join(dir, "formMappings.json");
    if (!fs.existsSync(fmPath)) continue;
    const fm = JSON.parse(fs.readFileSync(fmPath, "utf8") || "[]");
    if (!fm.some((m) => !m.voided && m.formType === "ProgramEncounter")) continue;
    const spec = YAML.load(emitRichSpec({ bundleDir: dir, org: row.org }));
    assert.ok((spec.encounterTypes || []).some((e) => e.form?.sections?.length),
      `${row.org}: no encounterType got a non-empty form: despite an active ProgramEncounter mapping`);
  }
});

test(`corpus fidelity: every non-empty ancillary family present in the bundle appears as a spec key (${orgs.length} orgs)`, { skip: orgs.length === 0 && "no runnable orgs" }, async () => {
  const { emitRichSpec } = await loadEmit();
  const FAMILY_FILES = [
    ["groupRole.json", "groupRoles"], ["identifierSource.json", "identifierSources"],
    ["relationshipType.json", "relationshipTypes"], ["reportCard.json", "reportCards"],
    ["reportDashboard.json", "reportDashboards"], ["groupPrivilege.json", "groupPrivileges"],
    ["groupDashboards.json", "groupDashboards"], ["individualRelation.json", "individualRelations"],
    ["catchments.json", "catchments"], ["locations.json", "locations"],
    ["documentations.json", "documentations"], ["menuItem.json", "menuItems"],
    ["ruleDependency.json", "ruleDependency"],
  ];
  for (const row of orgs) {
    const dir = oracleDir(row);
    const spec = YAML.load(emitRichSpec({ bundleDir: dir, org: row.org }));
    for (const [file, key] of FAMILY_FILES) {
      const fp = path.join(dir, file);
      if (!fs.existsSync(fp)) continue;
      let raw; try { raw = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
      const rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw[Object.keys(raw)[0]]) ? raw[Object.keys(raw)[0]] : []);
      const hasActive = Array.isArray(rows) ? rows.some((r) => r && !r.voided) : !!(raw && raw.code);
      if (hasActive) assert.ok(spec[key], `${row.org}: ${file} has active rows but spec.${key} is missing`);
    }
  }
});

test(`corpus fidelity: voided subjectTypes never appear by name (${orgs.length} orgs)`, { skip: orgs.length === 0 && "no runnable orgs" }, async () => {
  const { emitRichSpec } = await loadEmit();
  for (const row of orgs) {
    const dir = oracleDir(row);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8") || "[]");
    const activeNorm = new Set(raw.filter((s) => !s.voided).map((s) => normalizeName(s.name)));
    // Only names that are voided AND NOT independently active (a voided/active
    // name collision is legitimate — the active one MUST appear).
    const voidedOnly = raw.filter((s) => s.voided).map((s) => normalizeName(s.name)).filter((n) => n && !activeNorm.has(n));
    if (!voidedOnly.length) continue;
    const spec = YAML.load(emitRichSpec({ bundleDir: dir, org: row.org }));
    const specNorm = new Set((spec.subjectTypes || []).map((s) => normalizeName(s.name)));
    for (const vn of voidedOnly) assert.ok(!specNorm.has(vn), `${row.org}: voided subjectType "${vn}" leaked into spec`);
  }
});

test(`corpus fidelity: no banned cross-ref FK key-names survive outside rule/form-config subtrees (${orgs.length} orgs)`, { skip: orgs.length === 0 && "no runnable orgs" }, async () => {
  const { emitRichSpec } = await loadEmit();
  const BANNED_FK_KEYS = new Set([
    "standardReportCardType", "entityTypeUuid", "groupSubjectTypeUUID", "memberSubjectTypeUUID",
    "subjectTypeUUID", "programUUID", "encounterTypeUUID", "groupUUID", "privilegeUUID",
    "dashboardUUID", "addressLevelTypeUUID", "conceptUUID",
  ]);
  function walkKeys(node, keyName, loc, out) {
    if (node == null || SKIP_SUBTREE.has(keyName)) return;
    if (Array.isArray(node)) { node.forEach((v, i) => walkKeys(v, keyName, `${loc}[${i}]`, out)); return; }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (BANNED_FK_KEYS.has(k)) out.push(`${loc}.${k}`);
        walkKeys(v, k, `${loc}.${k}`, out);
      }
    }
  }
  for (const row of orgs) {
    const spec = YAML.load(emitRichSpec({ bundleDir: oracleDir(row), org: row.org }));
    const hits = [];
    walkKeys(spec, null, row.org, hits);
    assert.deepEqual(hits, [], `${row.org}: raw FK field name(s) leaked into the spec body: ${hits.join("; ")}`);
  }
});

// M11 — value-level scan, KEY-AWARE (skips the SKIP_SUBTREE passthrough set). A
// naive full-text regex would false-positive on legitimate rule-body/declarative
// JS embedding UUID-shaped literals (confirmed on multiple committed orgs). This
// walks the PARSED yaml and never descends into rule/form-config subtrees.
test(`corpus fidelity: no unresolved cross-ref UUID VALUES survive outside rule/form-config subtrees (${orgs.length} orgs)`, { skip: orgs.length === 0 && "no runnable orgs" }, async () => {
  const { emitRichSpec } = await loadEmit();
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  function walk(node, keyName, loc, out) {
    if (node == null || SKIP_SUBTREE.has(keyName)) return;
    if (typeof node === "string") {
      if (UUID_RE.test(node)) out.push(`${loc} (key=${keyName})="${node.slice(0, 60)}"`);
      return;
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, keyName, `${loc}[${i}]`, out)); return; }
    if (typeof node === "object") { for (const [k, v] of Object.entries(node)) walk(v, k, `${loc}.${k}`, out); }
  }
  for (const row of orgs) {
    const spec = YAML.load(emitRichSpec({ bundleDir: oracleDir(row), org: row.org }));
    const leaks = [];
    walk(spec, null, row.org, leaks);
    assert.deepEqual(leaks, [], `${row.org}: unresolved UUID value(s) outside rule/form-config subtrees: ${leaks.join("; ")}`);
  }
});
