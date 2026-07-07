// agent-author-mode.test.cjs — story #12: agent-authored generation.
//
// Covers the agent-mode session flow end-to-end WITHOUT any LLM call, to the
// EPIC contract:
//   • session mode: baseline (default) is unchanged; agent creates a session
//     around an SRS with an empty bundle dir; mode recorded in meta.json.
//   • bundle_read_srs: parses the uploaded Excel via SheetJS, jailed to input/.
//     No sheet → {sheets:[{name,rows,columns}]}; with sheet → rows sliced to a
//     limit (json/csv) with pagination. A path-escape (../.., absolute) is
//     REFUSED. A baseline-mode session / missing file / no meta → actionable
//     isError (never throws). A prose/JSON inline SRS still honours { section }.
//   • bundle_generate_baseline: an agent session with XLSX inputs bootstraps a
//     CLEAN bundle via the brain generator; one lacking generator inputs writes
//     a CLEAN minimal skeleton; a bad state returns isError (never throws).
//   • an end-to-end-ish agent path: create → generate_baseline → integrity clean
//     → spec_apply a refinement → still clean.
//   • the contract addendum + tool registration.
//
// Synthetic, org-agnostic fixtures only (CLAUDE.md rule §1). No API key. Excel
// fixtures are built with the SDK's OWN xlsx direct dependency.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

// Generator dependency — same env contract as fixture.cjs.
const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, "..", "..", "..", "avni-skills");

if (!fs.existsSync(AVNI_SKILLS_PATH)) {
  console.log(`SKIP agent-author-mode: avni-skills not at ${AVNI_SKILLS_PATH}`);
  return;
}

// xlsx is a DIRECT SDK dependency now — build fixtures with the same lib the
// tool parses with (do NOT reach into avni-skills/node_modules).
const XLSX = require("xlsx");

// ?t cache-busts each import so process.env.SDK_SESSIONS_DIR changes propagate.
function tag() { return "?t=" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"); }
async function loadSessions() { return import("../../src/sessions.js" + tag()); }
async function loadMcp() { return import("../../src/agents/bundle-mcp-server.js" + tag()); }
async function loadAgent() { return import("../../src/agent.js" + tag()); }
async function loadBundle() { return import("../../src/bundle.js" + tag()); }

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avni-agent-"));
  process.env.SDK_SESSIONS_DIR = root;
  return root;
}

// A minimal, generator-clean Forms.xlsx: one sheet = one form (per-sheet format).
function buildFormsBuffer() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Field Name", "Data Type", "Pre added Options Datatype", "Mandatory (default No)"],
    ["Name", "Text", "", "Yes"],
  ]), "Individual Registration");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
function buildModellingBuffer() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Subject Type Name", "Type"],
    ["Individual", "Person"],
  ]), "Subject Types");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
// A forms workbook with a large sheet, to exercise the read_srs row limit/paging.
function buildBigFormsBuffer(nRows) {
  const rows = [["Field Name", "Data Type"]];
  for (let i = 0; i < nRows; i++) rows.push([`Field ${i}`, "Text"]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Big Sheet");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
function jsonOf(res) { return JSON.parse(res.content[0].text); }

// ─── session mode ────────────────────────────────────────────────────

test("session mode: baseline is the DEFAULT and runs the generator at turn 0 (unchanged)", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const created = sessions.createSession({
    formsBuffer: buildFormsBuffer(), formsFilename: "forms.xlsx",
    modellingBuffer: buildModellingBuffer(), org: "BaselineOrg",
  });
  assert.equal(created.meta.currentTurn, 0);
  // Baseline-mode meta now records mode:"baseline"; the bundle generation path
  // itself stays byte-identical to pre-#12 sessions.
  assert.equal(created.meta.mode, "baseline");
  assert.equal(sessions.getSessionMode(created.sessionId), "baseline");
  const files = sessions.listFiles(created.sessionId);
  assert.ok(files.includes("subjectTypes.json"), "baseline mode generates a bundle at turn 0");
  assert.ok(files.some((f) => f.startsWith("forms/")), "baseline mode generates forms at turn 0");
});

test("session mode: agent creates a session around an Excel SRS with an EMPTY bundle dir", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const created = sessions.createSession({
    mode: "agent", org: "AgentOrg",
    formsBuffer: buildFormsBuffer(), modellingBuffer: buildModellingBuffer(),
  });
  assert.equal(created.meta.mode, "agent");
  assert.equal(created.meta.currentTurn, 0);
  assert.equal(created.meta.srs.kind, "xlsx");
  assert.equal(sessions.getSessionMode(created.sessionId), "agent");
  const files = sessions.listFiles(created.sessionId);
  assert.ok(!files.includes("subjectTypes.json"), "agent bundle starts empty (no generated entities)");
  assert.ok(!files.some((f) => f.startsWith("forms/")), "agent bundle has no forms yet");
  // The Excel binaries are persisted OUT of git, under ../input/.
  const inForms = path.join(sessions.bundleDir(created.sessionId), "..", "input", "forms.xlsx");
  assert.ok(fs.existsSync(inForms), "forms.xlsx persisted under the session input/ dir");
  // turn 0 is the near-empty workspace commit.
  const turns = sessions.listTurns(created.sessionId);
  assert.equal(turns[0].turn, 0);
  assert.match(turns[0].summary, /empty workspace \(agent mode\)/);
});

test("session mode: unknown mode is rejected", async () => {
  freshRoot();
  const sessions = await loadSessions();
  assert.throws(
    () => sessions.createSession({ mode: "banana", org: "X" }),
    /unknown session mode/,
  );
});

// ─── agent-mode empty-workspace sentinel (epic gotcha) ───────────────

test("sentinel: an empty agent workspace injects the sentinel, NOT missing-file errors", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const created = sessions.createSession({ mode: "agent", org: "A", formsBuffer: buildFormsBuffer() });
  // meta.validationAtCurrent must not claim a dozen errors.
  assert.equal(created.meta.validationAtCurrent.errors, 0);
  assert.equal(created.meta.validationAtCurrent.emptyWorkspace, true);

  sessions._resetValidatorCache();
  const text = sessions.currentValidatorStateText(created.sessionId);
  assert.match(text, /AGENT MODE/);
  assert.match(text, /EMPTY/);
  assert.doesNotMatch(text, /Missing required file/, "must NOT list missing-file errors");
  assert.doesNotMatch(text, /errors \(\d+\)/, "must NOT report an error count");
});

test("sentinel: once files are authored, the real validator+integrity state is reported", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { generateBaselineOnDir } = await loadMcp();
  // Prose agent session → the minimal-skeleton baseline (written in place, so
  // the session git repo survives), then commit it so HEAD advances.
  const created = sessions.createSession({ mode: "agent", org: "A", srs: "prose requirements" });
  const dir = sessions.bundleDir(created.sessionId);
  generateBaselineOnDir(dir);
  await sessions.commitWorkspaceChanges(created.sessionId, "author baseline");

  sessions._resetValidatorCache();
  const text = sessions.currentValidatorStateText(created.sessionId);
  assert.doesNotMatch(text, /workspace is EMPTY/, "sentinel must not fire once authored");
  assert.match(text, /clean|VALIDATOR/, "real state is reported after authoring");
});

// ─── bundle_read_srs (Excel via SheetJS) ─────────────────────────────

test("bundle_read_srs: no sheet → lists sheets with row + column counts", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "A", formsBuffer: buildFormsBuffer() });
  const res = readSrsOnDir(sessions.bundleDir(created.sessionId), {});
  assert.ok(!res.isError, `read_srs errored: ${res.content?.[0]?.text}`);
  const out = jsonOf(res);
  assert.equal(out.format, "sheet-list");
  assert.equal(out.file, "forms.xlsx");
  const sheet = out.sheets.find((s) => s.name === "Individual Registration");
  assert.ok(sheet, `expected a sheet index; saw ${JSON.stringify(out.sheets)}`);
  assert.equal(sheet.rows, 1, "one data row");
  assert.deepEqual(sheet.columns, ["Field Name", "Data Type", "Pre added Options Datatype", "Mandatory (default No)"]);
});

test("bundle_read_srs: with sheet → parses rows as JSON (SheetJS sheet_to_json)", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "A", formsBuffer: buildFormsBuffer() });
  const res = readSrsOnDir(sessions.bundleDir(created.sessionId), { sheet: "Individual Registration" });
  assert.ok(!res.isError, `read_srs errored: ${res.content?.[0]?.text}`);
  const out = jsonOf(res);
  assert.equal(out.format, "json");
  assert.equal(out.sheet, "Individual Registration");
  assert.equal(out.totalRows, 1);
  assert.equal(out.rows[0]["Field Name"], "Name");
  assert.equal(out.rows[0]["Data Type"], "Text");
});

test("bundle_read_srs: with format csv → returns CSV rows", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "A", formsBuffer: buildFormsBuffer() });
  const out = jsonOf(readSrsOnDir(sessions.bundleDir(created.sessionId), { sheet: "Individual Registration", format: "csv" }));
  assert.equal(out.format, "csv");
  assert.match(out.csv, /Field Name/);
  assert.match(out.csv, /Name,Text/);
});

test("bundle_read_srs: a big sheet is sliced to `limit` and paginates via offset", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "A", formsBuffer: buildBigFormsBuffer(500) });
  const dir = sessions.bundleDir(created.sessionId);
  const page1 = jsonOf(readSrsOnDir(dir, { sheet: "Big Sheet", limit: 200 }));
  assert.equal(page1.totalRows, 500);
  assert.equal(page1.returnedRows, 200, "sliced to the limit");
  assert.equal(page1.truncated, true);
  assert.match(page1.note, /offset: 200/);
  const page2 = jsonOf(readSrsOnDir(dir, { sheet: "Big Sheet", limit: 200, offset: 200 }));
  assert.equal(page2.returnedRows, 200);
  assert.equal(page2.rows[0]["Field Name"], "Field 200", "offset advances the window");
});

test("bundle_read_srs: applies a server-side default row limit (200) when none given", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "A", formsBuffer: buildBigFormsBuffer(500) });
  const out = jsonOf(readSrsOnDir(sessions.bundleDir(created.sessionId), { sheet: "Big Sheet" }));
  assert.equal(out.returnedRows, 200, "defaults to 200 rows, not the full 500");
  assert.equal(out.truncated, true);
});

// ─── bundle_read_srs jail (LFI closure, MAJOR-1) ─────────────────────

test("resolveInputPath: refuses a relative escape and an absolute path", async () => {
  const { resolveInputPath } = await loadMcp();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jail-"));
  try {
    assert.equal(resolveInputPath(root, "forms").ok, true);
    assert.equal(resolveInputPath(root, "modelling").ok, true);
    assert.equal(resolveInputPath(root, "../../etc/passwd").ok, false);
    assert.equal(resolveInputPath(root, "/etc/passwd").ok, false);
    assert.match(resolveInputPath(root, "../secret").error, /escapes the session input/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bundle_read_srs: a path-escape file arg is REFUSED (never reads outside input/)", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "A", formsBuffer: buildFormsBuffer() });
  const dir = sessions.bundleDir(created.sessionId);
  for (const bad of ["../../etc/passwd", "/etc/passwd", "../meta.json"]) {
    const res = readSrsOnDir(dir, { file: bad });
    assert.ok(res.isError, `expected refusal for ${bad}`);
    assert.match(res.content[0].text, /escapes the session input/);
  }
});

test("bundle_read_srs: a missing file surfaces an actionable error", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  // Agent session with forms only — asking for modelling should error cleanly.
  const created = sessions.createSession({ mode: "agent", org: "A", formsBuffer: buildFormsBuffer() });
  const res = readSrsOnDir(sessions.bundleDir(created.sessionId), { file: "modelling" });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /no modelling\.xlsx/);
});

test("bundle_read_srs: a baseline-mode session returns an actionable error (no SRS)", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const created = sessions.createSession({
    formsBuffer: buildFormsBuffer(), modellingBuffer: buildModellingBuffer(), org: "E",
  });
  const res = readSrsOnDir(sessions.bundleDir(created.sessionId), {});
  assert.ok(res.isError, "baseline-mode read_srs must be an error");
  assert.match(res.content[0].text, /no SRS is attached|AGENT-mode/);
});

test("bundle_read_srs: a dir with no session meta returns an actionable error, never throws", async () => {
  const { readSrsOnDir } = await loadMcp();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "no-meta-"));
  let res;
  assert.doesNotThrow(() => { res = readSrsOnDir(tmp, {}); });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /session meta/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── bundle_read_srs (inline prose / JSON SRS) ───────────────────────

test("bundle_read_srs: returns the attached prose SRS and honours a section arg", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const created = sessions.createSession({
    mode: "agent", org: "A",
    srs: "# Goal\nTrack pregnant women.\n# Forms\nANC visit form.",
  });
  const dir = sessions.bundleDir(created.sessionId);
  const whole = jsonOf(readSrsOnDir(dir, {}));
  assert.equal(whole.format, "text");
  assert.match(whole.content, /Track pregnant women/);
  const sec = jsonOf(readSrsOnDir(dir, { section: "Forms" }));
  assert.equal(sec.section, "Forms");
  assert.match(sec.content, /ANC visit form/);
});

test("bundle_read_srs: returns structured JSON and honours a section arg", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const srs = JSON.stringify({ org: "X", subjectTypes: [{ name: "Mother" }], forms: [{ name: "ANC" }] });
  const created = sessions.createSession({ mode: "agent", org: "X", srs });
  const dir = sessions.bundleDir(created.sessionId);
  const whole = jsonOf(readSrsOnDir(dir, {}));
  assert.equal(whole.format, "json");
  assert.deepEqual(whole.content.subjectTypes, [{ name: "Mother" }]);
  const sec = jsonOf(readSrsOnDir(dir, { section: "forms" }));
  assert.equal(sec.section, "forms");
  assert.deepEqual(sec.content, [{ name: "ANC" }]);
});

// ─── bundle_read_srs output caps (MINOR-2) ───────────────────────────

test("bundle_read_srs (MINOR-2): a large JSON section is truncated, not dumped", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const big = { concepts: Array.from({ length: 2000 }, (_, i) => ({ name: `Concept ${i}`, uuid: `u-${i}`, dataType: "Text" })) };
  const created = sessions.createSession({ mode: "agent", org: "X", srs: JSON.stringify(big) });
  const out = jsonOf(readSrsOnDir(sessions.bundleDir(created.sessionId), { section: "concepts" }));
  assert.equal(out.section, "concepts");
  assert.equal(out.truncated, true, "a huge section must be truncated");
  assert.equal(out.preview.items, 2000, "preview reports the true item count");
  assert.equal(out.content, undefined, "the full section must NOT be inlined");
});

test("bundle_read_srs (MINOR-2): a large top-level JSON array is truncated, not dumped", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const arr = Array.from({ length: 2000 }, (_, i) => ({ name: `Row ${i}`, uuid: `u-${i}` }));
  const created = sessions.createSession({ mode: "agent", org: "X", srs: JSON.stringify(arr) });
  const out = jsonOf(readSrsOnDir(sessions.bundleDir(created.sessionId), {}));
  assert.equal(out.truncated, true, "a huge top-level array must be truncated");
  assert.equal(out.preview.items, 2000);
  assert.equal(out.content, undefined, "the full array must NOT be inlined");
});

test("bundle_read_srs (MINOR-2): a large text section is truncated, not dumped", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const srs = `# Small\nhi\n# Big\n${"x".repeat(20000)}`;
  const created = sessions.createSession({ mode: "agent", org: "X", srs });
  const out = jsonOf(readSrsOnDir(sessions.bundleDir(created.sessionId), { section: "Big" }));
  assert.equal(out.section, "Big");
  assert.equal(out.truncated, true);
  assert.equal(out.content, undefined, "the full section must NOT be inlined");
  assert.ok(out.preview.length <= 8100, "preview is size-bounded");
});

// ─── bundle_generate_baseline ────────────────────────────────────────

test("bundle_generate_baseline: agent session with XLSX inputs bootstraps a CLEAN bundle via the brain generator", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { generateBaselineOnDir } = await loadMcp();
  const created = sessions.createSession({
    mode: "agent", org: "GenOrg",
    formsBuffer: buildFormsBuffer(), modellingBuffer: buildModellingBuffer(),
  });
  const dir = sessions.bundleDir(created.sessionId);
  const res = generateBaselineOnDir(dir);
  assert.ok(!res.isError, `unexpected error: ${res.content?.[0]?.text}`);
  const out = jsonOf(res);
  assert.equal(out.source, "brain-generator");
  assert.equal(out.clean, true, `baseline not clean: ${JSON.stringify(out.validator)} / ${JSON.stringify(out.integrity)}`);
  assert.equal(out.validator.valid, true);
  assert.equal(out.integrity.ok, true);
  assert.ok(sessions.listFiles(created.sessionId).includes("subjectTypes.json"), "generator wrote a bundle into the session dir");
});

test("bundle_generate_baseline: agent session lacking generator inputs writes a CLEAN minimal skeleton", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { generateBaselineOnDir } = await loadMcp();
  // Prose-only agent session — no forms.xlsx → the generator has nothing to run.
  const created = sessions.createSession({
    mode: "agent", org: "SkelOrg",
    srs: "Just prose requirements, no spreadsheet attached.",
  });
  const dir = sessions.bundleDir(created.sessionId);
  const res = generateBaselineOnDir(dir);
  assert.ok(!res.isError, `unexpected error: ${res.content?.[0]?.text}`);
  const out = jsonOf(res);
  assert.equal(out.source, "minimal-skeleton");
  assert.equal(out.clean, true, `skeleton not clean: ${JSON.stringify(out.validator)} / ${JSON.stringify(out.integrity)}`);
  assert.equal(out.validator.valid, true);
  assert.equal(out.integrity.ok, true);
  assert.ok(out.filesWritten.includes("subjectTypes.json"));
  assert.ok(out.filesWritten.some((f) => f.startsWith("forms/")));
  assert.ok(out.filesWritten.includes("formMappings.json"));
});

test("bundle_generate_baseline (brain generator) PRESERVES the session git repo (MAJOR bug fix)", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { generateBaselineOnDir } = await loadMcp();
  const created = sessions.createSession({
    mode: "agent", org: "GitOrg",
    formsBuffer: buildFormsBuffer(), modellingBuffer: buildModellingBuffer(),
  });
  const dir = sessions.bundleDir(created.sessionId);
  const out = jsonOf(generateBaselineOnDir(dir));
  assert.equal(out.source, "brain-generator");
  // The brain generator rmSync's its OWN output dir before writing — proving the
  // session .git survived means we generated into a temp dir and copied in.
  assert.ok(fs.existsSync(path.join(dir, ".git")), ".git must survive generate_baseline");
  const commit = await sessions.commitWorkspaceChanges(created.sessionId, "commit generated baseline");
  assert.equal(commit.noChanges, false, "generated files must be committable as a turn");
  assert.ok(commit.turn >= 1, "the turn counter advances");
});

test("bundle_generate_baseline: NEVER reports clean when the bundle is dirty (MINOR-1)", async () => {
  const { buildMinimalSkeleton, baselineStatusReport } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dirty-baseline-"));
  try {
    const files = buildMinimalSkeleton();
    // Deliberately dirty the skeleton: flatten a formElement.concept to a bare
    // UUID string (FE_CONCEPT_NOT_OBJECT). The validator passes; integrity fails.
    const formKey = Object.keys(files).find((k) => k.startsWith("forms/"));
    const fe = files[formKey].formElementGroups[0].formElements[0];
    fe.concept = fe.concept.uuid; // bare string — the Durga trap
    for (const [rel, val] of Object.entries(files)) {
      const fp = path.join(dir, rel);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, JSON.stringify(val, null, 2));
    }
    // This is the exact status computation generate_baseline runs. It must
    // derive clean from the real result — this test fails if clean is hardcoded.
    const out = jsonOf(baselineStatusReport(dir, { source: "minimal-skeleton" }));
    assert.equal(out.clean, false, "must NOT report clean when integrity is dirty");
    assert.equal(out.integrity.ok, false);
    const codes = out.integrity.findings.map((f) => f.code);
    assert.ok(codes.includes("FE_CONCEPT_NOT_OBJECT"), `expected FE_CONCEPT_NOT_OBJECT; got ${codes.join(",")}`);
    assert.match(out.note, /NOT yet clean/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bundle_generate_baseline: a baseline-mode session returns an actionable error, never throws", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { generateBaselineOnDir } = await loadMcp();
  const created = sessions.createSession({
    formsBuffer: buildFormsBuffer(), modellingBuffer: buildModellingBuffer(), org: "E2",
  });
  const dir = sessions.bundleDir(created.sessionId);
  let res;
  assert.doesNotThrow(() => { res = generateBaselineOnDir(dir); });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /only for AGENT-mode/);
});

test("bundle_generate_baseline: a dir with no session meta returns an actionable error, never throws", async () => {
  const { generateBaselineOnDir } = await loadMcp();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "no-meta-gb-"));
  let res;
  assert.doesNotThrow(() => { res = generateBaselineOnDir(tmp); });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /session meta/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("buildMinimalSkeleton: is validator-clean AND integrity-clean", async () => {
  const { buildMinimalSkeleton, runBundleIntegrityCheck } = await loadMcp();
  const bundle = await loadBundle();
  const files = buildMinimalSkeleton();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skel-"));
  try {
    for (const [rel, val] of Object.entries(files)) {
      const fp = path.join(dir, rel);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, JSON.stringify(val, null, 2));
    }
    const v = bundle.validateBundle(dir);
    assert.equal(v.valid, true, `skeleton validator errors: ${JSON.stringify(v.errors)}`);
    assert.equal(v.errors.length, 0);
    const ic = runBundleIntegrityCheck(dir);
    assert.equal(ic.ok, true, `skeleton integrity findings: ${JSON.stringify(ic.findings)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── end-to-end-ish agent path (no LLM) ──────────────────────────────

test("agent path: create → generate_baseline → integrity clean → spec_apply refinement → still clean", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { generateBaselineOnDir, specApplyOnDir, runBundleIntegrityCheck } = await loadMcp();
  const created = sessions.createSession({
    mode: "agent", org: "E2EOrg",
    formsBuffer: buildFormsBuffer(), modellingBuffer: buildModellingBuffer(),
  });
  const dir = sessions.bundleDir(created.sessionId);

  // Bootstrap from the SRS spreadsheet.
  const base = jsonOf(generateBaselineOnDir(dir));
  assert.equal(base.source, "brain-generator");
  assert.equal(base.clean, true, `baseline dirty: ${JSON.stringify(base.validator)} / ${JSON.stringify(base.integrity)}`);

  // Refine: add a Household subject type via spec_apply.
  const apply = specApplyOnDir(dir, "subjectTypes:\n  - {name: Household, type: Group, group: true}\n");
  assert.ok(!apply.isError, `spec_apply errored: ${apply.content?.[0]?.text}`);
  const applied = JSON.parse(apply.content[0].text);
  assert.ok(applied.filesChanged.includes("subjectTypes.json"), "refinement changed subjectTypes.json");
  assert.equal(applied.integrityCheck.ok, true, `integrity dirty right after apply: ${JSON.stringify(applied.integrityCheck.findings)}`);

  // Independent re-check: the bundle on disk is still integrity-clean.
  const ic = runBundleIntegrityCheck(dir);
  assert.equal(ic.ok, true, `integrity dirty after refine: ${JSON.stringify(ic.findings)}`);
  const stNames = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8")).map((s) => s.name);
  assert.ok(stNames.includes("Household"));
});

// ─── contract addendum + tool registration ───────────────────────────

test("contract: activeRulesBlock({mode:'agent'}) appends the addendum; baseline mode is byte-identical", async () => {
  const prev = process.env.SDK_LEGACY_RULES;
  delete process.env.SDK_LEGACY_RULES;
  try {
    const m = await loadAgent();
    // Baseline / no-arg — byte-identical to the slim contract (slim-prompt pin).
    assert.equal(m.activeRulesBlock(), m.BUNDLE_OUTCOME_CONTRACT);
    assert.equal(m.activeRulesBlock({ mode: "baseline" }), m.BUNDLE_OUTCOME_CONTRACT);
    // Agent — appends the addendum after the base contract.
    const authored = m.activeRulesBlock({ mode: "agent" });
    assert.ok(authored.startsWith(m.BUNDLE_OUTCOME_CONTRACT), "addendum must follow the base contract");
    assert.ok(authored.includes(m.AGENT_MODE_ADDENDUM));
    assert.match(authored, /AGENT MODE/);
    assert.match(authored, /bundle_read_srs/);
    assert.match(authored, /bundle_generate_baseline/);
    // The addendum stays short (a few lines, not a second ruleset).
    assert.ok(m.AGENT_MODE_ADDENDUM.trim().split(/\s+/).length < 200, "addendum must stay short");
  } finally {
    if (prev === undefined) delete process.env.SDK_LEGACY_RULES;
    else process.env.SDK_LEGACY_RULES = prev;
  }
});

test("createBundleMcpServer registers bundle_read_srs + bundle_generate_baseline alongside the prior tools", async () => {
  const { createBundleMcpServer } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srv-agent-"));
  try {
    const server = createBundleMcpServer(dir);
    const names = Object.keys(server?.instance?._registeredTools || {});
    for (const n of ["bundle_read_srs", "bundle_generate_baseline", "spec_apply", "spec_emit",
      "bundle_validator_run", "bundle_find_concept", "bundle_summary",
      "bundle_export_to_path", "bundle_integrity_check", "bundle_find_references"]) {
      assert.ok(names.includes(n), `${n} not registered; saw: ${names.join(", ")}`);
    }
    // All ten in-process MCP tools are registered.
    assert.equal(names.length, 10, `expected 10 tools; saw ${names.length}: ${names.join(", ")}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
