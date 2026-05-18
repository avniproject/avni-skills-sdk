// End-to-end resume test. Proves the user-reported gap is closed:
//   1. Create a session via the deterministic generator
//   2. Apply a Wizard-of-Oz edit that adds a new subject type
//   3. Record transcript + step + cost entries (mirroring what server.js does)
//   4. Simulate process restart (clear in-memory wallet, re-import modules)
//   5. Verify on resume:
//        - the subject type is still in the bundle (git turn persisted)
//        - the transcript replays the edit event
//        - the step log shows the operations
//        - the wallet totals are recovered from cost.jsonl

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

// Generator dependency — same env contract as fixture.cjs
const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, "..", "..", "..", "avni-skills");

if (!fs.existsSync(AVNI_SKILLS_PATH)) {
  // Skip — same way the rest of the suite handles missing brain repo
  console.log(`SKIP e2e-resume-with-memory: avni-skills not at ${AVNI_SKILLS_PATH}`);
  return;
}

const XLSX = require(path.join(AVNI_SKILLS_PATH, "node_modules", "xlsx"));

function makeMinimalSrsBuffer() {
  // Generator needs a valid Forms.xlsx. The minimum surface that produces a
  // sane bundle: 1 subject type, 1 form, a couple of form elements.
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Subject Type", "Type"],
    ["Beneficiary", "Person"],
  ]), "Subject Types");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Form Name", "Form Type", "Form Element Group", "Form Element", "Concept Data Type", "Concept Answers"],
    ["Beneficiary Registration", "IndividualProfile", "Identity", "Full Name", "Text", ""],
    ["Beneficiary Registration", "IndividualProfile", "Identity", "Age", "Numeric", ""],
  ]), "Forms");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function makeTmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avni-sdk-e2e-resume-"));
  process.env.SDK_SESSIONS_DIR = root;
  return root;
}

async function loadModules() {
  // ?t cache-busts each call so env changes propagate
  const tag = "?t=" + Date.now() + "-" + crypto.randomBytes(2).toString("hex");
  const sessions   = await import("../../src/sessions.js"   + tag);
  const transcript = await import("../../src/transcript.js" + tag);
  const steplog    = await import("../../src/steplog.js"    + tag);
  const wallet     = await import("../../src/wallet.js"     + tag);
  return { sessions, transcript, steplog, wallet };
}

test("e2e: edit lands → quit → resume → state fully recovered", async () => {
  const root = makeTmpRoot();
  const mods = await loadModules();
  mods.wallet._testReset();

  // ── 1. Create the session
  const created = mods.sessions.createSession({
    formsBuffer: makeMinimalSrsBuffer(),
    formsFilename: "forms.xlsx",
    org: "ResumeTest",
  });
  const sid = created.sessionId;
  assert.match(sid, /^sess_[0-9a-f]{16}$/);
  assert.equal(created.meta.currentTurn, 0);

  // Server.js would do this on session create; we replicate to keep the test
  // self-contained and prove the contract.
  mods.transcript.appendEvent(sid, { kind: "system", action: "session_created", org: "ResumeTest" });
  mods.steplog.logStep(sid, { kind: "session_create", meta: { org: "ResumeTest" } });

  // ── 2. Apply a Wizard-of-Oz edit that adds a subject type
  const bundleDir = mods.sessions.bundleDir(sid);
  const subjectTypesFp = path.join(bundleDir, "subjectTypes.json");
  const existing = JSON.parse(fs.readFileSync(subjectTypesFp, "utf8"));
  const newSubject = {
    name: "Volunteer", uuid: crypto.randomUUID(), active: true, type: "Person",
    allowMiddleName: true, allowProfilePicture: false, allowEmptyLocation: false,
    lastNameOptional: false, uniqueName: false, shouldSyncByLocation: true,
    settings: { displayRegistrationDetails: true, displayPlannedEncounters: true },
    household: false, group: false, directlyAssignable: false, voided: false,
  };
  const updated = existing.concat([newSubject]);
  const turnResult = mods.sessions.commitTurn(sid, "add Volunteer subject type", {
    "subjectTypes.json": JSON.stringify(updated, null, 2),
  });
  assert.equal(turnResult.turn, 1);

  mods.transcript.appendEvent(sid, {
    kind: "turn_commit", source: "wizard_of_oz", turn: 1,
    sha: turnResult.sha, summary: "add Volunteer subject type",
    filesChanged: ["subjectTypes.json"], cost_usd: 0.0123,
  });
  mods.steplog.logStep(sid, { kind: "commit", duration_ms: 42, meta: { turn: 1, sha: turnResult.sha } });

  // ── 3. Record cost (simulates an agent turn's wallet.recordResult)
  const meter = mods.wallet.startTurn(sid);
  meter.recordResult({ usd: 0.0123, inputTokens: 1500, outputTokens: 480 });
  const w1 = mods.wallet.getWallet(sid);
  assert.ok(Math.abs(w1.totalUsd - 0.0123) < 1e-9);

  // ── 4. Simulate process restart — clear in-memory wallet ledger AND
  //       re-import the modules so a fresh module cache picks up disk state
  mods.wallet._testReset();
  const mods2 = await loadModules();

  // ── 5. Verify everything is recovered
  // Bundle: the subject type is still on disk in the bundle git repo
  const sessionMeta = mods2.sessions.getSession(sid);
  assert.equal(sessionMeta.currentTurn, 1, "currentTurn persisted in meta.json");
  assert.equal(sessionMeta.org, "ResumeTest");
  const bundleDir2 = mods2.sessions.bundleDir(sid);
  const subjectsAfter = JSON.parse(fs.readFileSync(path.join(bundleDir2, "subjectTypes.json"), "utf8"));
  const volunteer = subjectsAfter.find((s) => s.name === "Volunteer");
  assert.ok(volunteer, "Volunteer subject type survives resume");
  assert.equal(volunteer.uuid, newSubject.uuid);

  // Transcript: replayable
  const events = mods2.transcript.readTranscript(sid);
  assert.ok(events.length >= 2, "transcript has at least session_created + turn_commit");
  const commitEv = events.find((e) => e.kind === "turn_commit");
  assert.ok(commitEv, "turn_commit event in transcript");
  assert.equal(commitEv.turn, 1);
  assert.equal(commitEv.summary, "add Volunteer subject type");

  // Steps: operational record intact
  const steps = mods2.steplog.readSteps(sid);
  const commitStep = steps.find((s) => s.kind === "commit");
  assert.ok(commitStep, "commit step persisted");
  assert.equal(commitStep.status, "ok");

  // Wallet: totals hydrated from cost.jsonl
  const w2 = mods2.wallet.getWallet(sid);
  assert.ok(Math.abs(w2.totalUsd - 0.0123) < 1e-9, "USD total recovered from disk");
  assert.equal(w2.totalInputTokens, 1500);
  assert.equal(w2.totalOutputTokens, 480);
  assert.equal(w2.turnCount, 1);

  // Git history: turn 0 + turn 1 both reachable
  const turns = mods2.sessions.listTurns(sid);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].turn, 0);
  assert.equal(turns[1].turn, 1);
  assert.match(turns[1].summary, /Volunteer/);
});

test("e2e: a second resume on top of a resumed session keeps accumulating", async () => {
  const root = makeTmpRoot();
  const mods = await loadModules();
  mods.wallet._testReset();

  const sid = mods.sessions.createSession({
    formsBuffer: makeMinimalSrsBuffer(),
    formsFilename: "forms.xlsx",
    org: "AccumulateTest",
  }).sessionId;

  // Three "turns" with cost — first session
  for (let i = 0; i < 3; i++) {
    const m = mods.wallet.startTurn(sid);
    m.recordResult({ usd: 0.10, inputTokens: 100, outputTokens: 50 });
  }

  // restart 1
  mods.wallet._testReset();
  const mods2 = await loadModules();
  let w = mods2.wallet.getWallet(sid);
  assert.ok(Math.abs(w.totalUsd - 0.30) < 1e-9);

  // Another turn in the resumed session
  mods2.wallet.startTurn(sid).recordResult({ usd: 0.05, inputTokens: 50, outputTokens: 25 });

  // restart 2
  mods2.wallet._testReset();
  const mods3 = await loadModules();
  w = mods3.wallet.getWallet(sid);
  assert.ok(Math.abs(w.totalUsd - 0.35) < 1e-9, "USD accumulates across two restarts");
  assert.equal(w.turnCount, 4);
});
