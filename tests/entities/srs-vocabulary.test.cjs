"use strict";

// src/srs-vocabulary.js — split a parity diff into what the SRS actually asks
// for and what only the (older) reference export carries. Org-agnostic per
// CLAUDE.md §1: every workbook here is built synthetically in-test.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const XLSX = require("xlsx");

async function load() { return import("../../src/srs-vocabulary.js?t=" + Date.now()); }

function tmpWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const fp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "srs-vocab-")), "wb.xlsx");
  XLSX.writeFile(wb, fp);
  return fp;
}

test("buildSrsVocabulary collects sheet names and string cells; numbers and blanks contribute nothing", async () => {
  const { buildSrsVocabulary } = await load();
  const fp = tmpWorkbook({
    "Enrolment Visit": [["Field Name", "Data Type"], ["Haemoglobin Level", "Numeric"], [42, ""]],
  });
  const v = buildSrsVocabulary([fp]);
  assert.ok(v.has("enrolment visit"), "sheet name is vocabulary");
  assert.ok(v.has("haemoglobin level"), "cell text is vocabulary");
  assert.ok(v.has("field name"));
  assert.ok(!v.has("42"));
});

test("isNamedInSrs matches case- and whitespace-insensitively, and by containment for long names", async () => {
  const { buildSrsVocabulary, isNamedInSrs } = await load();
  const fp = tmpWorkbook({ Sheet1: [["Please complete the Household Assessment form each visit"]] });
  const v = buildSrsVocabulary([fp]);
  assert.equal(isNamedInSrs(v, "Household Assessment"), true, "long name found inside a prose cell");
  assert.equal(isNamedInSrs(v, "  household   assessment "), true, "whitespace/case normalised");
  assert.equal(isNamedInSrs(v, "Nutrition Survey"), false);
});

test("isNamedInSrs will NOT containment-match a short name — 'fln' must not match every cell mentioning it", async () => {
  const { buildSrsVocabulary, isNamedInSrs } = await load();
  const fp = tmpWorkbook({ Sheet1: [["The FLN programme runs weekly"]] });
  const v = buildSrsVocabulary([fp]);
  assert.equal(isNamedInSrs(v, "fln"), false, "below the substring threshold, exact match only");
});

test("classifyMissing splits a diff into SRS-backed (chase) and reference-only drift (skip)", async () => {
  const { buildSrsVocabulary, classifyMissing } = await load();
  const fp = tmpWorkbook({
    "Reading Performance Assessment": [["Field Name"], ["Score"]],
    Modelling: [["Encounter Name"], ["Reading Enrolment"]],
  });
  const v = buildSrsVocabulary([fp]);
  const { backed, drift } = classifyMissing(v, [
    "reading performance assessment",
    "reading enrolment",
    "reading program exit",              // reference-only: SRS never names it
    "library performance assessment cancellation",
  ]);
  assert.deepEqual(backed.sort(), ["reading enrolment", "reading performance assessment"]);
  assert.deepEqual(drift.sort(), ["library performance assessment cancellation", "reading program exit"]);
});

// The bias is asymmetric on purpose: a false "backed" wastes one iteration and
// is visible; a false "drift" silently drops a real requirement from the gate
// while the scorecard reads green.
test("an UNREADABLE or absent SRS yields an empty vocabulary and treats EVERYTHING as backed — a missing workbook must never silently empty the gate", async () => {
  const { buildSrsVocabulary, classifyMissing } = await load();
  const v = buildSrsVocabulary(["/nonexistent/nope.xlsx", null, undefined]);
  assert.equal(v.size, 0);
  const { backed, drift, vocabEmpty } = classifyMissing(v, ["anything", "at all"]);
  assert.equal(vocabEmpty, true);
  assert.deepEqual(backed, ["anything", "at all"]);
  assert.deepEqual(drift, []);
});

test("buildSrsVocabulary tolerates a corrupt workbook among good ones rather than throwing", async () => {
  const { buildSrsVocabulary } = await load();
  const good = tmpWorkbook({ Good: [["Growth Monitoring"]] });
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "srs-bad-")), "bad.xlsx");
  fs.writeFileSync(bad, Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(512, 7)]));
  const v = buildSrsVocabulary([bad, good]);
  assert.ok(v.has("growth monitoring"), "the readable workbook still contributes");
});
