// agent-author-mode.test.cjs — story #12: agent-authored generation.
//
// Covers the author-mode session flow end-to-end WITHOUT any LLM call:
//   • session mode: edit (default) is unchanged; author creates a session
//     around an SRS with an empty bundle dir.
//   • bundle_read_srs: returns the attached SRS (text/JSON, section arg); an
//     edit-mode session (no SRS) returns an actionable isError.
//   • bundle_generate_baseline: an author session with XLSX inputs bootstraps a
//     CLEAN bundle via the brain generator; one lacking inputs writes a CLEAN
//     minimal skeleton; a bad state returns isError (never throws).
//   • an end-to-end-ish author path: create → generate_baseline → integrity
//     clean → spec_apply a refinement → still clean.
//   • the contract addendum + tool registration.
//
// Synthetic, org-agnostic fixtures only (CLAUDE.md rule §1). No API key.

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

const XLSX = require(path.join(AVNI_SKILLS_PATH, "node_modules", "xlsx"));

// ?t cache-busts each import so process.env.SDK_SESSIONS_DIR changes propagate.
function tag() { return "?t=" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"); }
async function loadSessions() { return import("../../src/sessions.js" + tag()); }
async function loadMcp() { return import("../../src/agents/bundle-mcp-server.js" + tag()); }
async function loadAgent() { return import("../../src/agent.js" + tag()); }
async function loadBundle() { return import("../../src/bundle.js" + tag()); }

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avni-author-"));
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
function jsonOf(res) { return JSON.parse(res.content[0].text); }

// ─── session mode ────────────────────────────────────────────────────

test("session mode: edit is the DEFAULT and runs the generator at turn 0 (unchanged)", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const created = sessions.createSession({
    formsBuffer: buildFormsBuffer(), formsFilename: "forms.xlsx",
    modellingBuffer: buildModellingBuffer(), org: "EditOrg",
  });
  assert.equal(created.meta.currentTurn, 0);
  // Edit-mode meta must NOT carry a `mode` field — the shape is byte-identical
  // to pre-#12 sessions.
  assert.equal(created.meta.mode, undefined);
  assert.equal(sessions.getSessionMode(created.sessionId), "edit");
  const files = sessions.listFiles(created.sessionId);
  assert.ok(files.includes("subjectTypes.json"), "edit mode generates a bundle at turn 0");
  assert.ok(files.some((f) => f.startsWith("forms/")), "edit mode generates forms at turn 0");
});

test("session mode: author creates a session around an SRS with an EMPTY bundle dir", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const created = sessions.createSession({
    mode: "author", org: "AuthorOrg",
    srs: "# Requirements\nRegister individuals with a name.",
  });
  assert.equal(created.meta.mode, "author");
  assert.equal(created.meta.currentTurn, 0);
  assert.equal(created.meta.srs.kind, "text");
  assert.equal(sessions.getSessionMode(created.sessionId), "author");
  const files = sessions.listFiles(created.sessionId);
  assert.ok(!files.includes("subjectTypes.json"), "author bundle starts empty (no generated entities)");
  assert.ok(!files.some((f) => f.startsWith("forms/")), "author bundle has no forms yet");
  // The SRS is persisted so the tools can reach it via ../srs/.
  const srsFile = path.join(sessions.bundleDir(created.sessionId), "..", "srs", "srs.txt");
  assert.ok(fs.existsSync(srsFile), "SRS text persisted alongside the session");
});

test("session mode: unknown mode is rejected", async () => {
  freshRoot();
  const sessions = await loadSessions();
  assert.throws(
    () => sessions.createSession({ mode: "banana", org: "X" }),
    /unknown session mode/,
  );
});

// ─── bundle_read_srs ─────────────────────────────────────────────────

test("read_srs: returns the attached prose SRS for an author session", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const created = sessions.createSession({
    mode: "author", org: "A",
    srs: "# Goal\nTrack pregnant women.\n# Forms\nANC visit form.",
  });
  const res = readSrsOnDir(sessions.bundleDir(created.sessionId), {});
  assert.ok(!res.isError, `read_srs errored: ${res.content?.[0]?.text}`);
  const out = jsonOf(res);
  assert.equal(out.format, "text");
  assert.match(out.content, /Track pregnant women/);
});

test("read_srs: returns structured JSON and honours a section arg", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const srs = JSON.stringify({ org: "X", subjectTypes: [{ name: "Mother" }], forms: [{ name: "ANC" }] });
  const created = sessions.createSession({ mode: "author", org: "X", srs });
  const dir = sessions.bundleDir(created.sessionId);
  const whole = jsonOf(readSrsOnDir(dir, {}));
  assert.equal(whole.format, "json");
  assert.deepEqual(whole.content.subjectTypes, [{ name: "Mother" }]);
  const sec = jsonOf(readSrsOnDir(dir, { section: "forms" }));
  assert.equal(sec.section, "forms");
  assert.deepEqual(sec.content, [{ name: "ANC" }]);
});

test("read_srs: an edit-mode session returns an actionable error (no SRS)", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { readSrsOnDir } = await loadMcp();
  const created = sessions.createSession({
    formsBuffer: buildFormsBuffer(), modellingBuffer: buildModellingBuffer(), org: "E",
  });
  const res = readSrsOnDir(sessions.bundleDir(created.sessionId), {});
  assert.ok(res.isError, "edit-mode read_srs must be an error");
  assert.match(res.content[0].text, /no SRS is attached|AUTHOR-mode/);
});

test("read_srs: a dir with no session meta returns an actionable error, never throws", async () => {
  const { readSrsOnDir } = await loadMcp();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "no-meta-"));
  let res;
  assert.doesNotThrow(() => { res = readSrsOnDir(tmp, {}); });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /session meta/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── bundle_generate_baseline ────────────────────────────────────────

test("generate_baseline: author session with XLSX inputs bootstraps a CLEAN bundle via the brain generator", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { generateBaselineOnDir } = await loadMcp();
  const created = sessions.createSession({
    mode: "author", org: "GenOrg",
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

test("generate_baseline: author session lacking generator inputs writes a CLEAN minimal skeleton", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { generateBaselineOnDir } = await loadMcp();
  const created = sessions.createSession({
    mode: "author", org: "SkelOrg",
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

test("generate_baseline: an edit-mode session returns an actionable error, never throws", async () => {
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
  assert.match(res.content[0].text, /only for AUTHOR-mode/);
});

test("generate_baseline: a dir with no session meta returns an actionable error, never throws", async () => {
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

// ─── end-to-end-ish author path (no LLM) ─────────────────────────────

test("author path: create → generate_baseline → integrity clean → spec_apply refinement → still clean", async () => {
  freshRoot();
  const sessions = await loadSessions();
  const { generateBaselineOnDir, specApplyOnDir, runBundleIntegrityCheck } = await loadMcp();
  const created = sessions.createSession({
    mode: "author", org: "E2EOrg",
    srs: "# Plan\nStart with individuals, add a Household group.",
  });
  const dir = sessions.bundleDir(created.sessionId);

  // Bootstrap.
  const base = jsonOf(generateBaselineOnDir(dir));
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
  assert.ok(stNames.includes("Household") && stNames.includes("Individual"));
});

// ─── contract addendum + tool registration ───────────────────────────

test("contract: activeRulesBlock({mode:'author'}) appends the addendum; edit mode is byte-identical", async () => {
  const prev = process.env.SDK_LEGACY_RULES;
  delete process.env.SDK_LEGACY_RULES;
  try {
    const m = await loadAgent();
    // Edit / no-arg — byte-identical to the slim contract (slim-prompt pin).
    assert.equal(m.activeRulesBlock(), m.BUNDLE_OUTCOME_CONTRACT);
    assert.equal(m.activeRulesBlock({ mode: "edit" }), m.BUNDLE_OUTCOME_CONTRACT);
    // Author — appends the addendum after the base contract.
    const authored = m.activeRulesBlock({ mode: "author" });
    assert.ok(authored.startsWith(m.BUNDLE_OUTCOME_CONTRACT), "addendum must follow the base contract");
    assert.ok(authored.includes(m.AUTHOR_MODE_ADDENDUM));
    assert.match(authored, /AUTHOR MODE/);
    assert.match(authored, /read_srs/);
    assert.match(authored, /generate_baseline/);
    // The addendum stays short (a few lines, not a second ruleset).
    assert.ok(m.AUTHOR_MODE_ADDENDUM.trim().split(/\s+/).length < 200, "addendum must stay short");
  } finally {
    if (prev === undefined) delete process.env.SDK_LEGACY_RULES;
    else process.env.SDK_LEGACY_RULES = prev;
  }
});

test("createBundleMcpServer registers read_srs + generate_baseline alongside the prior tools", async () => {
  const { createBundleMcpServer } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srv-author-"));
  try {
    const server = createBundleMcpServer(dir);
    const names = Object.keys(server?.instance?._registeredTools || {});
    for (const n of ["read_srs", "generate_baseline", "spec_apply", "spec_emit",
      "bundle_validator_run", "bundle_find_concept", "bundle_summary",
      "bundle_export_to_path", "bundle_integrity_check"]) {
      assert.ok(names.includes(n), `${n} not registered; saw: ${names.join(", ")}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
