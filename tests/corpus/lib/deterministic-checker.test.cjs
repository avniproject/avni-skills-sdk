"use strict";
// Unit tests for src/crl/deterministic-checker.js — composes the three
// existing deterministic engines and buckets findings under each
// compliance-doc.yaml rule. Bridges CJS → ESM via a cached dynamic import
// (rule-grounding.cjs pattern).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { manifest } = require("../manifest.cjs");
const { loadOracle } = require("./corpus-loader.cjs");

const DOC = path.resolve(__dirname, "..", "..", "..", "src", "crl", "compliance-doc.js");
const CHK = path.resolve(__dirname, "..", "..", "..", "src", "crl", "deterministic-checker.js");
let _doc, _chk;
async function loadDoc() { if (!_doc) _doc = await import(pathToFileURL(DOC).href); return _doc; }
async function loadChk() { if (!_chk) _chk = await import(pathToFileURL(CHK).href); return _chk; }

function tmpBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-"));
  for (const [rel, c] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, typeof c === "string" ? c : JSON.stringify(c));
  }
  return dir;
}

const FLOOR = ["rule-body-parses", "fk-coded-answer-resolves", "formelement-concept-is-object", "address-level-type-name-valid"];

const phulwari = manifest().find((r) => r.org === "phulwari");
const skipNoCorpus = !fs.existsSync(phulwari.oracle.dir) && "committed corpus siblings not checked out";

test("deterministicChecker(bundleDir, WHOLE doc) filters to its own deterministic rules — byRule holds exactly the 7 det rule ids, no ai-judged (IC-1)", { skip: skipNoCorpus }, async () => {
  const { loadComplianceDoc, aiRulesOf } = await loadDoc();
  const { deterministicChecker } = await loadChk();
  const doc = loadComplianceDoc();
  const r = await deterministicChecker(loadOracle(phulwari), doc);
  const ids = Object.keys(r.byRule).sort();
  assert.equal(ids.length, 7, `expected 7 deterministic rule ids, got ${ids.join(",")}`);
  const aiIds = aiRulesOf(doc).map((x) => x.id);
  for (const aid of aiIds) assert.ok(!ids.includes(aid), `ai-judged rule ${aid} must not appear in byRule`);
});

test("phulwari oracle: all four floor-gating rules are green with zero error findings", { skip: skipNoCorpus }, async () => {
  const { loadComplianceDoc } = await loadDoc();
  const { deterministicChecker } = await loadChk();
  const r = await deterministicChecker(loadOracle(phulwari), loadComplianceDoc());
  for (const id of FLOOR) {
    assert.equal(r.byRule[id].status, "green", `${id} should be green on phulwari`);
    assert.equal(r.byRule[id].findings.filter((f) => f.severity === "error").length, 0);
  }
});

test("MAJ-11: every rule's status is a pure function of its OWN findings' severity, never the rule's declared severity", { skip: skipNoCorpus }, async () => {
  const { loadComplianceDoc } = await loadDoc();
  const { deterministicChecker } = await loadChk();
  const r = await deterministicChecker(loadOracle(phulwari), loadComplianceDoc());
  for (const [id, res] of Object.entries(r.byRule)) {
    const expected = res.findings.some((f) => f.severity === "error") ? "red" : "green";
    assert.equal(res.status, expected, `${id}: status must key on finding severity`);
  }
});

test("a syntactically broken rule body reds rule-body-parses (error finding)", async () => {
  const { loadComplianceDoc } = await loadDoc();
  const { deterministicChecker } = await loadChk();
  const dir = tmpBundle({
    "concepts.json": [],
    "forms/x.json": { name: "Visit", decisionRule: "({ params, imports }) => { this is not valid js" },
  });
  const r = await deterministicChecker(dir, loadComplianceDoc());
  assert.equal(r.byRule["rule-body-parses"].status, "red");
  assert.ok(r.byRule["rule-body-parses"].findings.some((f) => f.severity === "error"));
});

test("a dangling OPTIONAL FK yields a warning finding under fk-coded-answer-optional-present and stays green (MAJ-11)", async () => {
  const { loadComplianceDoc } = await loadDoc();
  const { deterministicChecker } = await loadChk();
  const dir = tmpBundle({
    "concepts.json": [],
    "encounterTypes.json": [{ name: "Visit", uuid: "dddddddd-dddd-dddd-dddd-dddddddddddd", conceptUuid: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" }],
  });
  const r = await deterministicChecker(dir, loadComplianceDoc());
  const opt = r.byRule["fk-coded-answer-optional-present"];
  assert.ok(opt.findings.some((f) => f.severity === "warning" && f.code === "DANGLING_REF"), "expected a DANGLING_REF warning");
  assert.equal(opt.status, "green");
  assert.equal(r.byRule["fk-coded-answer-resolves"].status, "green", "no MISSING_REQUIRED_REF here");
});
