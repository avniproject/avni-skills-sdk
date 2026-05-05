#!/usr/bin/env node
/**
 * Bundle Generator Test Harness
 *
 * Runs against a freshly-generated bundle in OUTPUT_DIR.
 * Each test returns { name, pass, detail }. Exit code 0 if all pass.
 *
 * Tests are intentionally strict — a regression in any one of them
 * means the generator changed in an unintended way.
 *
 * Usage:
 *   node tests/run-tests.js <bundle-dir>
 *
 * Run twice with the same SRS to verify determinism (test #2).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BUNDLE = process.argv[2];
if (!BUNDLE) {
  console.error("Usage: node run-tests.js <bundle-dir>");
  process.exit(2);
}

const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, "..", "..", "avni-skills");
const VALIDATOR = path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "validators", "bundle_validator");
// Reference outputs (optional). Point at known-good bundles via these env vars
// to enable the UUID-drift tests (12, 13).
const REF_V1 = process.env.AVNI_REF_V1 || path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "output", "JK-Laxmi-Cements");
const REF_V2 = process.env.AVNI_REF_V2 || path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "output", "JK-Laxmi-V2");
const DETERMINISM_REF = process.env.DETERMINISM_REF || null;

function load(dir, file) {
  const fp = path.join(dir, file);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; }
}

function listForms(dir) {
  const fp = path.join(dir, "forms");
  if (!fs.existsSync(fp)) return [];
  return fs.readdirSync(fp).filter(f => f.endsWith(".json")).sort();
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ───────────────────────────────────────────────────────────────────
// REQUIRED FILES & STRUCTURE
// ───────────────────────────────────────────────────────────────────
test("01: required files all present", () => {
  const required = [
    "concepts.json", "subjectTypes.json", "programs.json",
    "encounterTypes.json", "formMappings.json",
    "operationalSubjectTypes.json", "operationalPrograms.json", "operationalEncounterTypes.json",
    "organisationConfig.json", "addressLevelTypes.json",
  ];
  const missing = required.filter(f => !fs.existsSync(path.join(BUNDLE, f)));
  if (missing.length) return { pass: false, detail: `missing: ${missing.join(", ")}` };
  if (!fs.existsSync(path.join(BUNDLE, "forms"))) return { pass: false, detail: "no forms/ dir" };
  return { pass: true, detail: `all ${required.length} top-level files + forms/ present` };
});

test("02: every JSON file parses", () => {
  const fails = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir)) {
      const fp = path.join(dir, e);
      if (fs.statSync(fp).isDirectory()) walk(fp);
      else if (fp.endsWith(".json")) {
        try { JSON.parse(fs.readFileSync(fp, "utf8")); }
        catch (err) { fails.push(fp + ": " + err.message); }
      }
    }
  }
  walk(BUNDLE);
  return { pass: fails.length === 0, detail: fails.length ? fails.slice(0,3).join("; ") : "all parse" };
});

// ───────────────────────────────────────────────────────────────────
// COUNT SANITY
// ───────────────────────────────────────────────────────────────────
test("03: concept count within ±30 of references", () => {
  const c = load(BUNDLE, "concepts.json").length;
  const v1 = load(REF_V1, "concepts.json").length;
  const v2 = load(REF_V2, "concepts.json").length;
  const lo = Math.min(v1, v2) - 30;
  const hi = Math.max(v1, v2) + 30;
  return { pass: c >= lo && c <= hi, detail: `POC=${c}  V1=${v1}  V2=${v2}  range=[${lo}, ${hi}]` };
});

test("04: form count exactly 34", () => {
  const n = listForms(BUNDLE).length;
  return { pass: n === 34, detail: `forms=${n}, expected 34` };
});

test("05: programs=2, encounterTypes=14, subjectTypes=2", () => {
  const p = load(BUNDLE, "programs.json").length;
  const e = load(BUNDLE, "encounterTypes.json").length;
  const s = load(BUNDLE, "subjectTypes.json").length;
  const ok = p === 2 && e === 14 && s === 2;
  return { pass: ok, detail: `p=${p} e=${e} s=${s}` };
});

// ───────────────────────────────────────────────────────────────────
// THE BUGS WE'RE FIXING
// ───────────────────────────────────────────────────────────────────
test("06: no SRS-template-bleed concepts (column headers leaked as values)", () => {
  // dataType=NA is VALID in AVNI — answer-concepts (options of a Coded
  // question) use NA. The bug we're catching is when SRS column-header text
  // OR a single condition-sentence (e.g. "In case of Gravida do not show 2,3,5
  // scheme option") leaks into the concepts list as if it were a real concept.
  const c = load(BUNDLE, "concepts.json");
  // Patterns must be precise enough to not match real concept names that
  // happen to start with "if" (e.g. "If others, please mention" is real).
  const JUNK_NAME_PATTERNS = [
    /^pre\s*added\s*options(\s+datatype)?$/i,
    /^OPTIONS\s*\(needed[^)]*\)$/i,
    /^field\s*name$/i,
    /^in\s+case\s+of\s+\w+\s+do\s+not\s+show/i,   // narrow: the exact "in case of X do not show" pattern
    /^[0-9]+\s+scheme\s+option$/i,                  // "5 scheme option"
  ];
  const junk = c.filter(x => JUNK_NAME_PATTERNS.some(p => p.test(x.name)));
  // dataType must be in AVNI's valid set
  const VALID_DTS = new Set(['Numeric','Text','Notes','Coded','NA','Date','DateTime','Time','Image','Video','Subject','Id','Audio','File','Location','PhoneNumber','Duration','Encounter']);
  const invalidDt = c.filter(x => x.dataType && !VALID_DTS.has(x.dataType));
  if (invalidDt.length) return { pass: false, detail: `invalid dataType: ${invalidDt.slice(0,3).map(x=>`"${x.name}"=${x.dataType}`).join(", ")}` };
  return {
    pass: junk.length === 0,
    detail: junk.length ? `${junk.length} junk-pattern: ${junk.slice(0,5).map(x=>`"${x.name}"`).join(", ")}` : "no template-bleed found",
  };
});

test("07: operational files are wrapped objects with N items inside", () => {
  // AVNI server contract (validators/bundle_validator.js) requires
  // operational files to be { "operationalXxx": [...] } not bare arrays.
  // Earlier audit reasoning was wrong — wrapped is correct.
  const files = [
    { name: "operationalSubjectTypes.json", key: "operationalSubjectTypes", expectMin: 1 },
    { name: "operationalPrograms.json",     key: "operationalPrograms",     expectMin: 1 },
    { name: "operationalEncounterTypes.json", key: "operationalEncounterTypes", expectMin: 1 },
  ];
  const bad = [];
  for (const f of files) {
    const d = load(BUNDLE, f.name);
    if (Array.isArray(d)) bad.push(`${f.name} is bare array`);
    else if (!d || !Array.isArray(d[f.key])) bad.push(`${f.name} missing key '${f.key}'`);
    else if (d[f.key].length < f.expectMin) bad.push(`${f.name} has ${d[f.key].length} entries (want ≥ ${f.expectMin})`);
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.join("; ") : "all 3 wrapped correctly" };
});

test("08: Yes/No use STANDARD_UUIDs", () => {
  const STD_YES = "e1018fd6-6a74-45e5-9191-6dec7647d817";
  const STD_NO  = "cca1df60-04c2-497c-a5ad-47438ae9fb7c";
  const c = load(BUNDLE, "concepts.json");
  const yes = c.filter(x => x.name === "Yes");
  const no  = c.filter(x => x.name === "No");
  // there should be either zero (referenced via standard UUID inline only)
  // OR exactly one with the standard UUID
  const yesOk = yes.length === 0 || (yes.length === 1 && yes[0].uuid === STD_YES);
  const noOk  = no.length  === 0 || (no.length  === 1 && no[0].uuid  === STD_NO);
  if (!yesOk || !noOk) {
    const det = [
      yes.length ? `Yes count=${yes.length} uuids=${yes.map(x=>x.uuid).join(",")}` : null,
      no.length ? `No count=${no.length} uuids=${no.map(x=>x.uuid).join(",")}` : null,
    ].filter(Boolean).join("; ");
    return { pass: false, detail: det };
  }
  return { pass: true, detail: "Yes/No either absent or use standard UUIDs" };
});

// ───────────────────────────────────────────────────────────────────
// REFERENTIAL INTEGRITY
// ───────────────────────────────────────────────────────────────────
test("09: every form-element concept UUID exists in concepts.json", () => {
  const concepts = load(BUNDLE, "concepts.json");
  const known = new Set(concepts.map(c => c.uuid));
  const formsDir = path.join(BUNDLE, "forms");
  const missing = [];
  for (const ff of listForms(BUNDLE)) {
    const f = JSON.parse(fs.readFileSync(path.join(formsDir, ff), "utf8"));
    for (const g of f.formElementGroups || []) {
      for (const el of g.formElements || []) {
        if (el.concept?.uuid && !known.has(el.concept.uuid)) {
          missing.push(`${f.name}/${el.name} -> ${el.concept.uuid}`);
        }
      }
    }
  }
  return { pass: missing.length === 0, detail: missing.length ? missing.slice(0,3).join(" | ") : "all linked" };
});

test("10: formMappings reference real forms + subject types", () => {
  const fms = load(BUNDLE, "formMappings.json");
  const formUuids = new Set();
  for (const ff of listForms(BUNDLE)) {
    const f = JSON.parse(fs.readFileSync(path.join(BUNDLE, "forms", ff), "utf8"));
    if (f.uuid) formUuids.add(f.uuid);
  }
  const subjUuids = new Set((load(BUNDLE, "subjectTypes.json") || []).map(s => s.uuid));
  const bad = fms.filter(m =>
    (m.formUUID && !formUuids.has(m.formUUID)) ||
    (m.subjectTypeUUID && !subjUuids.has(m.subjectTypeUUID))
  );
  return { pass: bad.length === 0, detail: bad.length ? `${bad.length} bad refs` : "all linked" };
});

// ───────────────────────────────────────────────────────────────────
// VALIDATOR (server contract)
// ───────────────────────────────────────────────────────────────────
test("11: validator error count ≤ 22 (current baseline)", () => {
  const { BundleValidator } = require(VALIDATOR);
  const orig = console.log; console.log = () => {};
  const r = new BundleValidator(BUNDLE).validate();
  console.log = orig;
  const max = Number(process.env.MAX_ERRORS || 22);
  return {
    pass: r.errors.length <= max,
    detail: `errors=${r.errors.length} (cap=${max})  warnings=${r.warnings.length}`,
  };
});

// ───────────────────────────────────────────────────────────────────
// RECONCILIATION: UUID consistency vs references
// ───────────────────────────────────────────────────────────────────
test("12: UUID drift vs V1 ≤ baseline (no new drift introduced)", () => {
  // V1 was generated by a different (older) generator path. Some drift is
  // expected. We pin the cap to the current baseline (158) so any *new*
  // drift introduced by our fixes will fail this test. We do NOT want
  // our fixes to increase drift further.
  const poc = new Map(load(BUNDLE, "concepts.json").map(c => [c.name, c.uuid]));
  const v1  = new Map(load(REF_V1, "concepts.json").map(c => [c.name, c.uuid]));
  const drift = [];
  for (const [name, uuid] of poc) {
    if (v1.has(name) && v1.get(name) !== uuid) drift.push(`"${name}"`);
  }
  const cap = Number(process.env.UUID_DRIFT_CAP_V1 || 158);
  return { pass: drift.length <= cap, detail: `drift=${drift.length} (cap=${cap})` };
});

test("13: UUID drift vs V2 ≤ baseline (no new drift introduced)", () => {
  // V2 was generated by an earlier run of THIS generator. Drift should
  // stay constant unless our fixes change UUID seeds (which they shouldn't).
  const poc = new Map(load(BUNDLE, "concepts.json").map(c => [c.name, c.uuid]));
  const v2  = new Map(load(REF_V2, "concepts.json").map(c => [c.name, c.uuid]));
  const drift = [];
  for (const [name, uuid] of poc) {
    if (v2.has(name) && v2.get(name) !== uuid) drift.push(`"${name}"`);
  }
  const cap = Number(process.env.UUID_DRIFT_CAP_V2 || 151);
  return { pass: drift.length <= cap, detail: `drift=${drift.length} (cap=${cap})` };
});

// ───────────────────────────────────────────────────────────────────
// DETERMINISM
// ───────────────────────────────────────────────────────────────────
test("14: bundle is deterministic (same SRS → same concept UUIDs)", () => {
  if (!DETERMINISM_REF) return { pass: true, detail: "skipped (set DETERMINISM_REF env to enable)" };
  const a = load(BUNDLE, "concepts.json").map(c => `${c.name}::${c.uuid}`).sort().join("\n");
  const b = load(DETERMINISM_REF, "concepts.json").map(c => `${c.name}::${c.uuid}`).sort().join("\n");
  return { pass: sha256(a) === sha256(b), detail: `BUNDLE_sha=${sha256(a).slice(0,12)} REF_sha=${sha256(b).slice(0,12)}` };
});

// ───────────────────────────────────────────────────────────────────
// SHAPE: form structure
// ───────────────────────────────────────────────────────────────────
test("15: every form has uuid, name, formType", () => {
  const bad = [];
  for (const ff of listForms(BUNDLE)) {
    const f = JSON.parse(fs.readFileSync(path.join(BUNDLE, "forms", ff), "utf8"));
    if (!f.uuid || !f.name || !f.formType) bad.push(ff);
  }
  return { pass: bad.length === 0, detail: bad.length ? `${bad.length} malformed: ${bad.slice(0,3).join(", ")}` : "all good" };
});

test("16: every form has at least one formElementGroup with elements", () => {
  // Cancellation forms can be empty; only check non-cancellation
  const empty = [];
  for (const ff of listForms(BUNDLE)) {
    if (ff.includes("Cancellation")) continue;
    const f = JSON.parse(fs.readFileSync(path.join(BUNDLE, "forms", ff), "utf8"));
    const total = (f.formElementGroups || []).reduce((s, g) => s + (g.formElements?.length || 0), 0);
    if (total === 0) empty.push(f.name);
  }
  return { pass: empty.length === 0, detail: empty.length ? `empty: ${empty.join(", ")}` : "all populated" };
});

// ───────────────────────────────────────────────────────────────────
// RUN
// ───────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const results = [];
for (const t of tests) {
  let r;
  try { r = t.fn(); } catch (e) { r = { pass: false, detail: "THROW: " + e.message }; }
  results.push({ name: t.name, ...r });
  if (r.pass) pass++; else fail++;
}

console.log("┌─────────────────────────────────────────────────────────────────────┐");
console.log(`│ Bundle:   ${BUNDLE.padEnd(58)} │`);
console.log(`│ Result:   ${pass}/${tests.length} pass, ${fail} fail`.padEnd(70) + "│");
console.log("└─────────────────────────────────────────────────────────────────────┘");
for (const r of results) {
  const tag = r.pass ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${tag}  ${r.name}`);
  console.log(`         ${r.detail}`);
}

// Machine-readable JSON to stderr-tagged line for CI parsing
console.error("RESULTS_JSON=" + JSON.stringify({
  bundle: BUNDLE,
  total: tests.length,
  pass, fail,
  results: results.map(r => ({ name: r.name, pass: r.pass, detail: r.detail })),
}));

process.exit(fail === 0 ? 0 : 1);
