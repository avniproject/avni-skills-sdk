"use strict";

// Phase 4 Task 2 — buildCrlScopingCtx: the SRS-grounded scoping context the
// CRL's ai-judged pass consumes ("what did the org actually ask for"). Reads the
// session's own attached SRS (the same source bundle_read_srs uses), capped to a
// small preview so it never floods the review payload.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "crl-scoping-sessions-"));
process.env.SDK_SESSIONS_DIR = SESSIONS_ROOT;

async function loadSessions() { return import("../../src/sessions.js?t=" + Date.now()); }
async function loadMcp() { return import("../../src/agents/bundle-mcp-server.js?t=" + Date.now()); }

test("buildCrlScopingCtx: an agent-mode session with a prose SRS returns { srs: <text> }", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", srs: "Register beneficiaries with name, age, and village." });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.equal(ctx.srs, "Register beneficiaries with name, age, and village.");
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: a JSON SRS is returned as its raw text", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", srs: { entities: ["Beneficiary"] } });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.match(ctx.srs, /Beneficiary/);
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: caps a large SRS instead of flooding the review payload", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const big = "x".repeat(10000);
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", srs: big });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.ok(ctx.srs.length <= 4000, `expected capped srs, got ${ctx.srs.length} chars`);
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: an agent-mode session with no SRS attached returns {}", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest" });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.deepEqual(ctx, {});
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: a baseline-mode session returns {} (no attached SRS to ground on)", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  // A baseline-mode session bundleDir. Fake a session dir with a baseline meta.
  const fakeSession = fs.mkdtempSync(path.join(SESSIONS_ROOT, "sess_faux-"));
  fs.mkdirSync(path.join(fakeSession, "bundle"), { recursive: true });
  fs.writeFileSync(path.join(fakeSession, "meta.json"), JSON.stringify({ mode: "baseline" }));
  const ctx = buildCrlScopingCtx(path.join(fakeSession, "bundle"));
  assert.deepEqual(ctx, {});
});

// ─── attached-workbook digest ───────────────────────────────────────
//
// The common agent-mode session is created from Excel workbooks: meta.srs is
// { kind:"xlsx", files:{forms, modelling} } with NEITHER .text nor .json, so
// reading only srs.txt/srs.json returned {} and the ai-judge reviewed the
// bundle blind. Every workbook below is SYNTHETIC and built in-test (rule §1) —
// no real NGO, no fixture file, no path outside the temp sessions root.

const XLSX = require("xlsx");

/** Build an .xlsx Buffer from a map of sheet name → array-of-arrays. */
function makeWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const SYNTHETIC_FORMS = makeWorkbook({
  "Widget Intake": [
    ["Field Name", "Datatype", "Mandatory"],
    ["Widget Serial", "Text", "Yes"],
    ["Widget Colour", "Pre added Options", "No"],
  ],
  "Sprocket Checkup": [
    ["Field Name", "Datatype", "Mandatory"],
    ["Sprocket Torque", "Numeric", "Yes"],
  ],
});

const SYNTHETIC_MODELLING = makeWorkbook({
  "Subject Types": [
    ["Subject Type Name", "Type", "Form Link"],
    ["Widget", "Person", "Widget Intake"],
  ],
  "Program": [
    ["Program Name", "Enrolment Form"],
    ["Sprocket Care", "Sprocket Enrolment"],
  ],
});

// A .xlsx-looking file that SheetJS cannot parse: the ZIP magic bytes force the
// xlsx/zip code path (plain garbage would be sniffed as CSV and parse happily),
// then the body is noise so the unzip fails.
const CORRUPT_WORKBOOK = Buffer.concat([Buffer.from("PK\x03\x04"), require("node:crypto").randomBytes(512)]);

test("buildCrlScopingCtx: an agent-mode session with an attached forms workbook renders a digest", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", formsBuffer: SYNTHETIC_FORMS });
  // Precondition: this is exactly the meta shape that used to yield {}.
  const meta = JSON.parse(fs.readFileSync(path.join(SESSIONS_ROOT, created.sessionId, "meta.json"), "utf8"));
  assert.equal(meta.srs.kind, "xlsx");
  assert.equal(meta.srs.files.text, undefined);
  assert.equal(meta.srs.files.json, undefined);

  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.ok(ctx.srs, "expected a non-empty scoping srs for an xlsx-only agent session");
  assert.match(ctx.srs, /Widget Intake/, "sheet name must appear");
  assert.match(ctx.srs, /Sprocket Checkup/, "every sheet name must appear");
  assert.match(ctx.srs, /Widget Serial/, "a known cell value must appear");
  assert.match(ctx.srs, /Sprocket Torque/, "a cell from the second sheet must appear");
  assert.match(ctx.srs, /FIDELITY/, "the digest must carry a fidelity label");
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: both attached workbooks are represented", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({
    mode: "agent", org: "ScopeTest",
    formsBuffer: SYNTHETIC_FORMS, modellingBuffer: SYNTHETIC_MODELLING,
  });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.match(ctx.srs, /forms\.xlsx/);
  assert.match(ctx.srs, /modelling\.xlsx/);
  assert.match(ctx.srs, /Widget Serial/, "forms content present");
  assert.match(ctx.srs, /Sprocket Care/, "modelling content present");
  assert.match(ctx.srs, /Subject Types/, "modelling sheet name present");
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: mixed prose SRS + workbook emits the prose first, then the digest", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const prose = "Track widgets through intake and periodic sprocket checkups.";
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", srs: prose, formsBuffer: SYNTHETIC_FORMS });
  // The branch must be on files.forms, not srs.kind — kind stays "text" here.
  const meta = JSON.parse(fs.readFileSync(path.join(SESSIONS_ROOT, created.sessionId, "meta.json"), "utf8"));
  assert.equal(meta.srs.kind, "text");
  assert.equal(meta.srs.files.forms, "input/forms.xlsx");

  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.ok(ctx.srs.startsWith(prose), "prose must lead the scoping context");
  assert.match(ctx.srs, /Widget Serial/, "digest must follow the prose");
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: mixed JSON SRS + workbook emits both", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({
    mode: "agent", org: "ScopeTest",
    srs: { entities: ["Widget"] }, formsBuffer: SYNTHETIC_FORMS,
  });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.match(ctx.srs, /Widget/);
  assert.match(ctx.srs, /Sprocket Checkup/);
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: a large workbook is capped at the xlsx cap and says so", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const sheets = {};
  for (let s = 0; s < 12; s += 1) {
    const rows = [["Field Name", "Description", "Example"]];
    for (let r = 0; r < 200; r += 1) {
      rows.push([`Field ${s}-${r}`, "d".repeat(400), "e".repeat(400)]);
    }
    sheets[`Sheet ${s}`] = rows;
  }
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", formsBuffer: makeWorkbook(sheets) });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.ok(ctx.srs.length <= 16000, `expected capped digest, got ${ctx.srs.length} chars`);
  assert.match(ctx.srs, /FIDELITY: PARTIAL/, "a truncated digest must be labelled PARTIAL");
  assert.match(ctx.srs, /bundle_read_srs/, "the label must name the full-fidelity path");
  // The index is above the truncation boundary — EVERY sheet is still named,
  // including the last one, so the judge cannot mistake truncation for absence.
  assert.match(ctx.srs, /Sheet 0/);
  assert.match(ctx.srs, /Sheet 11/);
  // ...and the budget must not overshoot and get hard-sliced, which would chop
  // whole sections off the TAIL — the exact failure the fair-share allocator
  // exists to prevent (regression: 6 of 29 sections lost on a real workbook).
  assert.equal((ctx.srs.match(/\n### /g) || []).length, 12, "every sheet must keep its own section");
  assert.match(ctx.srs, /### forms\.xlsx > Sheet 11 \(/, "the LAST sheet must still have a section");
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: every sheet gets rendered rows, not just the first few", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const sheets = {};
  for (let s = 0; s < 10; s += 1) {
    const rows = [["Field Name", "Description"]];
    for (let r = 0; r < 60; r += 1) rows.push([`Marker-${s}-${r}`, "n".repeat(200)]);
    sheets[`Tab ${s}`] = rows;
  }
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", formsBuffer: makeWorkbook(sheets) });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  for (let s = 0; s < 10; s += 1) {
    assert.match(ctx.srs, new RegExp(`### forms\\.xlsx > Tab ${s} \\(`), `sheet ${s} must have its own section`);
    assert.match(ctx.srs, new RegExp(`Marker-${s}-0`), `sheet ${s} must contribute at least one rendered row`);
  }
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: the label distinguishes a clipped WIDE ROW from a shortened CELL", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  // Many short cells → the row exceeds the row cap while no single cell does.
  // The two losses are not interchangeable: a clipped row drops whole trailing
  // COLUMNS, and the judge must be told that, not "a cell was shortened".
  const wide = ["Widget Intake"].concat(Array.from({ length: 40 }, (_, i) => `Col${i}`));
  const created = sessions.createSession({
    mode: "agent", org: "ScopeTest",
    formsBuffer: makeWorkbook({ "Wide Sheet": [wide, wide.slice()] }),
  });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.match(ctx.srs, /wide row\(s\) clipped at \d+ chars \(trailing columns dropped\)/);
  assert.doesNotMatch(ctx.srs, /cell\(s\) shortened/, "no cell exceeded the cell cap — do not claim one did");
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: a small workbook that fits entirely is labelled COMPLETE", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", formsBuffer: SYNTHETIC_FORMS });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.match(ctx.srs, /FIDELITY: COMPLETE/, "nothing was dropped — must not scare the judge with a PARTIAL label");
  assert.doesNotMatch(ctx.srs, /more row\(s\) of this sheet not shown/);
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: a corrupt workbook degrades to {} and does not throw", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", formsBuffer: CORRUPT_WORKBOOK });
  let ctx;
  assert.doesNotThrow(() => { ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId)); });
  assert.deepEqual(ctx, {});
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: a corrupt workbook alongside prose degrades to the prose alone", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const prose = "Track widgets through intake.";
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", srs: prose, formsBuffer: CORRUPT_WORKBOOK });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.equal(ctx.srs, prose);
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: one corrupt + one readable workbook returns the readable one", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({
    mode: "agent", org: "ScopeTest",
    formsBuffer: CORRUPT_WORKBOOK, modellingBuffer: SYNTHETIC_MODELLING,
  });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.ok(ctx.srs, "the readable workbook must still produce a digest");
  assert.match(ctx.srs, /Sprocket Care/);
  assert.doesNotMatch(ctx.srs, /forms\.xlsx/, "the unparseable workbook must not be claimed as rendered");
  sessions.deleteSession(created.sessionId);
});

test.after(() => { try { fs.rmSync(SESSIONS_ROOT, { recursive: true, force: true }); } catch {} });
