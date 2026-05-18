// Summarizer tests — synthetic bundles cover each anomaly class.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

async function load() { return await import("../../src/agents/summarizer.js"); }

function tmpBundle({ concepts = [], forms = [], subjectTypes = [], programs = [], encounterTypes = [], formMappings = [], addressLevelTypes = [] } = {}) {
  const dir = path.join(os.tmpdir(), "summarizer-test-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify(concepts));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify(subjectTypes));
  fs.writeFileSync(path.join(dir, "programs.json"), JSON.stringify(programs));
  fs.writeFileSync(path.join(dir, "encounterTypes.json"), JSON.stringify(encounterTypes));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify(formMappings));
  fs.writeFileSync(path.join(dir, "addressLevelTypes.json"), JSON.stringify(addressLevelTypes));
  for (const f of forms) fs.writeFileSync(path.join(dir, "forms", `${f.name}.json`), JSON.stringify(f));
  return dir;
}

test("counts entities accurately", async () => {
  const { summarizeBundle } = await load();
  const dir = tmpBundle({
    concepts: [{ name: "A", uuid: "a", dataType: "Text" }, { name: "B", uuid: "b", dataType: "Numeric" }],
    forms: [{ name: "F1", uuid: "f1", formType: "ProgramEncounter" }],
    subjectTypes: [{ name: "Individual", uuid: "i" }],
    encounterTypes: [{ name: "Visit", uuid: "v" }],
  });
  const s = summarizeBundle(dir);
  assert.equal(s.entityCounts.concepts, 2);
  assert.equal(s.entityCounts.forms, 1);
  assert.equal(s.entityCounts.subjectTypes, 1);
  assert.equal(s.entityCounts.encounterTypes, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("flags trailing-whitespace in entity names", async () => {
  const { summarizeBundle } = await load();
  const dir = tmpBundle({
    encounterTypes: [{ name: "Visit ", uuid: "v" }],
  });
  const s = summarizeBundle(dir);
  const tw = s.anomalies.filter((a) => a.type === "trailing-whitespace");
  assert.equal(tw.length, 1);
  assert.equal(tw[0].value, "Visit ");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("flags empty-Coded concepts", async () => {
  const { summarizeBundle } = await load();
  const dir = tmpBundle({
    concepts: [
      { name: "Gender", uuid: "g", dataType: "Coded", answers: [{ name: "M", uuid: "m" }, { name: "F", uuid: "f" }] },
      { name: "Religion", uuid: "r", dataType: "Coded", answers: [] }, // empty
      { name: "Donor", uuid: "d", dataType: "Coded" }, // no answers field at all
    ],
  });
  const s = summarizeBundle(dir);
  const ec = s.anomalies.filter((a) => a.type === "empty-coded-answers");
  assert.equal(ec.length, 2, `expected 2 empty-Coded, got ${ec.length}`);
  assert.equal(s.codedAnswerStats.totalCoded, 3);
  assert.equal(s.codedAnswerStats.emptyCoded, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("flags case-insensitive duplicate concepts", async () => {
  const { summarizeBundle } = await load();
  const dir = tmpBundle({
    concepts: [
      { name: "Other", uuid: "o1", dataType: "NA" },
      { name: "other", uuid: "o2", dataType: "NA" },
    ],
  });
  const s = summarizeBundle(dir);
  const dup = s.anomalies.filter((a) => a.type === "case-insensitive-duplicate");
  assert.equal(dup.length, 1);
  assert.equal(s.errorCount >= 1, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("flags orphan answer UUIDs", async () => {
  const { summarizeBundle } = await load();
  const dir = tmpBundle({
    concepts: [
      { name: "Religion", uuid: "r", dataType: "Coded",
        answers: [{ name: "other", uuid: "GHOST-UUID-NOT-IN-CONCEPTS" }] },
    ],
  });
  const s = summarizeBundle(dir);
  const orphans = s.anomalies.filter((a) => a.type === "orphan-answer-uuid");
  assert.equal(orphans.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("flags missing-programs when ProgramEncounter forms exist", async () => {
  const { summarizeBundle } = await load();
  const dir = tmpBundle({
    forms: [{ name: "F1", uuid: "f1", formType: "ProgramEncounter" }],
    programs: [],
  });
  const s = summarizeBundle(dir);
  const mp = s.anomalies.find((a) => a.type === "missing-programs");
  assert.ok(mp);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("flags dataType mismatch between form element and concepts.json", async () => {
  const { summarizeBundle } = await load();
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: "age", dataType: "Numeric" }],
    forms: [{
      name: "F", uuid: "f", formType: "IndividualProfile",
      formElementGroups: [{
        formElements: [{
          name: "age field",
          concept: { name: "Age", uuid: "age", dataType: "Text" }, // mismatch
        }],
      }],
    }],
  });
  const s = summarizeBundle(dir);
  const mm = s.anomalies.find((a) => a.type === "datatype-mismatch");
  assert.ok(mm, `expected datatype-mismatch; got ${s.anomalies.map((a) => a.type).join(",")}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rule stats count populated rule fields", async () => {
  const { summarizeBundle } = await load();
  const dir = tmpBundle({
    forms: [
      { name: "F1", uuid: "f1", formType: "IndividualProfile",
        validationRule: "({params,imports}) => { return []; }",
        decisionRule: "",
        formElementGroups: [{
          formElements: [
            { name: "x", rule: "stub-rule" },
            { name: "y", rule: "" },
          ],
        }],
      },
    ],
  });
  const s = summarizeBundle(dir);
  assert.equal(s.ruleStats.populated, 2, "1 form rule + 1 formElement rule");
  assert.equal(s.ruleStats.byType.validationRule, 1);
  assert.equal(s.ruleStats.byType["formElement.rule"], 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("flags concept-shape-flattened — bare-UUID concept (AVNI server rejects)", async () => {
  // Regression: a previous "fix all errors" agent turn flattened 148
  // concept fields. AVNI Jackson rejected the upload. Local validator
  // didn't catch it. Summarizer must.
  const { summarizeBundle } = await load();
  const UUID = "11111111-1111-1111-1111-111111111111";
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: UUID, dataType: "Numeric" }],
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{
        formElements: [
          { name: "ok element", concept: { name: "Age", uuid: UUID, dataType: "Numeric" } }, // object — fine
          { name: "broken element", concept: UUID }, // bare string — bug
        ],
      }],
    }],
  });
  const s = summarizeBundle(dir);
  const flat = s.anomalies.filter((a) => a.type === "concept-shape-flattened");
  assert.equal(flat.length, 1);
  assert.equal(flat[0].severity, "error");
  assert.match(flat[0].value, /bare UUID string/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("flags invalid-location-type-name — URL, arrow, parens, Hierarchy header", async () => {
  const { summarizeBundle } = await load();
  const dir = tmpBundle({
    addressLevelTypes: [
      { uuid: "ok",  name: "District",       level: 3, isRegistrationLocation: false },
      { uuid: "u1",  name: "https://drive.google.com/file/d/abc/view", level: 4, isRegistrationLocation: false },
      { uuid: "u2",  name: "District -> Block -> Village",             level: 2, isRegistrationLocation: false },
      { uuid: "u3",  name: "(Reserved)",                               level: 1, isRegistrationLocation: false },
      { uuid: "u4",  name: "Nourish Location Hierarchy",               level: 5, isRegistrationLocation: false },
      { uuid: "ok2", name: "Village",        level: 0, isRegistrationLocation: true  },
    ],
  });
  const s = summarizeBundle(dir);
  const bad = s.anomalies.filter((a) => a.type === "invalid-location-type-name");
  assert.equal(bad.length, 4, `expected 4 invalid, got ${bad.length}: ${JSON.stringify(bad.map(b => b.value))}`);
  assert.ok(bad.every((a) => a.severity === "error"));
  const reasons = bad.map((b) => b.value).join("\n");
  assert.match(reasons, /URL/);
  assert.match(reasons, /arrow/);
  assert.match(reasons, /parenthesized/);
  assert.match(reasons, /section header/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("anomalies sorted: errors first", async () => {
  const { summarizeBundle } = await load();
  const dir = tmpBundle({
    encounterTypes: [{ name: "ET ", uuid: "et" }], // warning
    concepts: [{ name: "C", uuid: "c", dataType: "Coded", answers: [] }], // error
  });
  const s = summarizeBundle(dir);
  // First anomaly should be the error
  assert.equal(s.anomalies[0].severity, "error");
});
