#!/usr/bin/env node
// sdk-cli.mjs — interactive terminal client for avni-skills-sdk.
//
// Thin entrypoint. Argument parsing + env validation + main loop. All UI
// helpers, server lifecycle, command handlers, and the SSE renderer live in
// `scripts/cli/` and `scripts/cli/commands/`.
//
// Drives the full Phase 4+ flow against any SRS:
//   1. Boots the server if it's not already running.
//   2. Uploads your SRS (Forms + optional Modelling Excel) → creates a session
//      (or `--resume <sid>` to re-attach to an existing one).
//   3. Drops you into a REPL. Free text is sent to the agent at
//      POST /v1/sessions/:id/messages and the SSE stream is rendered live.
//      Lines starting with `:` run session commands (see `:help`).
//
// No external npm deps for the REPL itself — all built-ins (fetch, FormData,
// readline). The server-side stack has its own deps in package.json.
//
// Usage:
//   export ANTHROPIC_API_KEY='sk-ant-...'
//   AVNI_SKILLS_PATH=~/code/avni-skills npm run cli -- \
//     --forms /path/to/Forms.xlsx [--modelling /path/to/Modelling.xlsx] [--org MyOrg]
//
//   # Or built-in synthetic SRS:
//   npm run cli -- --demo
//
//   # Or attach to an existing session:
//   npm run cli -- --resume sess_xxxxxxxxxxxxxxxx

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { createRequire } from "node:module";

import { cyan, dim, green, red, TTY, withSpinner } from "./cli/ui.mjs";
import { makeServerHelpers } from "./cli/server-mgmt.mjs";
import { makeSessionHelpers } from "./cli/session.mjs";
import { makeSseSender }     from "./cli/sse.mjs";
import { renderHeader, renderBundleStats, renderSuggestions } from "./cli/banner.mjs";
import { makeTurnsCommands }         from "./cli/commands/turns.mjs";
import { makeRulesCommands }         from "./cli/commands/rules.mjs";
import { makeAuditCommands }         from "./cli/commands/audit.mjs";
import { makeWorkflowsCommands }     from "./cli/commands/workflows.mjs";
import { makeObservabilityCommands } from "./cli/commands/observability.mjs";
import { makeSessionsCommands }      from "./cli/commands/sessions.mjs";
import { makeDispatcher }            from "./cli/dispatch.mjs";

const SDK_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPTS_DIR = path.join(SDK_DIR, "scripts");
const require = createRequire(import.meta.url);

// ───────────────────────────────────────────────────────────────────
// Args
// ───────────────────────────────────────────────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}
function flag(name) { return process.argv.includes(`--${name}`); }

const DEMO = flag("demo");
const RESUME_SID = arg("resume", null);
let FORMS_PATH = arg("forms");
let MODELLING_PATH = arg("modelling");
let ORG = arg("org", DEMO ? "DemoOrg" : "Bundle");
const PORT = Number(arg("port", process.env.PORT || 3030));
const BASE = `http://localhost:${PORT}`;

// Mutable shared state across SSE renderer + commands. MODEL is `let`-y
// (mutated by :model). priorValidationGroups is updated after each turn by
// the SSE renderer so it can detect validator regressions. sid is mutated
// by `:session resume <id>` so the REPL can hop between sessions without a
// restart — Claude-Code-style.
const state = {
  MODEL: arg("model", "claude-haiku-4-5-20251001"),
  priorValidationGroups: null,
  sid: null,
};

// ─── Resolve AVNI_SKILLS_PATH automatically if possible ───────────
function resolveAvniSkillsPath() {
  if (process.env.AVNI_SKILLS_PATH && fs.existsSync(process.env.AVNI_SKILLS_PATH)) {
    return process.env.AVNI_SKILLS_PATH;
  }
  const sibling = path.resolve(SDK_DIR, "..", "avni-skills");
  if (fs.existsSync(sibling)) {
    process.env.AVNI_SKILLS_PATH = sibling;
    return sibling;
  }
  return null;
}
const AVNI_SKILLS_PATH = resolveAvniSkillsPath();
if (!AVNI_SKILLS_PATH) {
  console.error(`
Cannot find avni-skills. Do one of:

  1. Set the env var:
       export AVNI_SKILLS_PATH=~/code/avni-skills

  2. Or clone it as a sibling of this repo:
       git clone https://github.com/avniproject/avni-skills.git "${path.resolve(SDK_DIR, "..", "avni-skills")}"
`);
  process.exit(2);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(`
ANTHROPIC_API_KEY is required (BYO key — never paste it into prompts).

Get one from https://console.anthropic.com/settings/keys, then:
  export ANTHROPIC_API_KEY='sk-ant-...'

If you only want to verify the deterministic + machinery layers without
spending tokens, run:
  npm test                                    # 401 entity + integration tests
  AVNI_SKILLS_PATH=${AVNI_SKILLS_PATH} bash scripts/verify.sh   # L1–L5 (no key)
`);
  process.exit(2);
}

// ─── Demo mode: build a tiny synthetic SRS in tmpdir ───────────────
if (DEMO && !FORMS_PATH) {
  console.log("(demo mode) building synthetic SRS workbook in tmpdir...");
  let XLSX;
  try { XLSX = require(path.join(AVNI_SKILLS_PATH, "node_modules", "xlsx")); }
  catch (e) { console.error("could not load xlsx from avni-skills/node_modules:", e.message); process.exit(2); }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Subject Type", "Type"],
    ["Beneficiary", "Person"],
  ]), "Subject Types");
  // 1 registration form, with a deliberate F2 duplicate so the agent has
  // something concrete to fix
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Form Name", "Form Type", "Form Element Group", "Form Element", "Concept Data Type", "Concept Answers"],
    ["Beneficiary Registration", "IndividualProfile", "Identity", "Full Name", "Text", ""],
    ["Beneficiary Registration", "IndividualProfile", "Identity", "Gender", "Coded", "Male, Female, Other"],
    ["Beneficiary Registration", "IndividualProfile", "Demographics", "Age", "Numeric", ""],
    ["Beneficiary Registration", "IndividualProfile", "Demographics", "Gender", "Coded", "Male, Female, Other"],  // ← duplicate F2
    ["Beneficiary Registration", "IndividualProfile", "Demographics", "Phone Number", "PhoneNumber", ""],
  ]), "Forms");
  const fp = path.join(os.tmpdir(), `avni-sdk-demo-srs-${process.pid}.xlsx`);
  XLSX.writeFile(wb, fp);
  FORMS_PATH = fp;
  console.log(`  ${fp}`);
  console.log("  ↳ contains 1 subject type + 1 registration form with a deliberate duplicate `Gender` reference (F2 error) so the agent has something to fix.");
}

// ─── Resume vs new-session arg validation ──────────────────────────
if (RESUME_SID) {
  if (!/^sess_[0-9a-f]{16}$/.test(RESUME_SID)) {
    console.error(`--resume: invalid session id "${RESUME_SID}" (expected sess_<16-hex>)`);
    process.exit(2);
  }
} else {
  if (!FORMS_PATH || !fs.existsSync(FORMS_PATH)) {
    console.error(`
No SRS provided. Try one of:

  npm run cli -- --demo                                     # built-in synthetic SRS

  npm run cli -- --forms ./MyOrg-Forms.xlsx [--modelling ./MyOrg-Modelling.xlsx] [--org MyOrg]

To continue an existing session instead:
  npm run cli -- --resume sess_xxxxxxxxxxxxxxxx
`);
    process.exit(2);
  }
  if (MODELLING_PATH && !fs.existsSync(MODELLING_PATH)) {
    console.error(`--modelling not found: ${MODELLING_PATH}`); process.exit(2);
  }
}

// ───────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────
const { ensureServer, getJson, getText, postJson } = makeServerHelpers({ BASE, PORT, SDK_DIR });
const http = { getJson, getText, postJson, BASE };
const { startedServer, serverProc } = await ensureServer();

const { createSession, attachSession } = makeSessionHelpers({ BASE });
const { sendMessage } = makeSseSender({ BASE, state });

// Command bundles — each factory returns an object of cmdX handlers.
const commands = {
  turns:         makeTurnsCommands({ http, SDK_DIR }),
  rules:         makeRulesCommands({ http, SCRIPTS_DIR }),
  audit:         makeAuditCommands({ http, BASE }),
  workflows:     makeWorkflowsCommands({ http }),
  observability: makeObservabilityCommands({ http }),
  sessions:      makeSessionsCommands({ http, state, attachSession }),
};
const { handleLine } = makeDispatcher({ commands, sendMessage, state });

// Header banner — server URL, model, skills, org/forms/modelling info.
await renderHeader({ BASE, MODEL: state.MODEL, RESUME_SID, ORG, FORMS_PATH, MODELLING_PATH });

console.log("");

// Create or attach the session (phased spinner during the slow ops).
let sess;
if (RESUME_SID) {
  try {
    sess = await withSpinner(
      "attaching to existing session…",
      () => attachSession(RESUME_SID),
      { okMsg: "session reattached " + cyan(RESUME_SID) },
    );
  } catch {
    process.exit(2);
  }
  if (sess.meta?.org) ORG = sess.meta.org;
} else {
  sess = await withSpinner(
    "uploading SRS · running deterministic generator · committing turn 0 · validating…",
    () => createSession({ formsPath: FORMS_PATH, modellingPath: MODELLING_PATH, org: ORG }),
    { okMsg: "session created (turn 0 committed)" },
  );
}
state.sid = sess.sessionId;

// Bundle stats box (entity counts + validator) + context-aware next-step
// suggestions block (different for clean vs error-laden bundles).
const validation = await renderBundleStats({ BASE, sess, getJson });
state.priorValidationGroups = { ...(validation?.groups || {}) };
console.log("");
renderSuggestions(sess.meta, validation, !!sess.resumed);
console.log("");

// ── Readline loop ───────────────────────────────────────────────────
// Async-iterator pattern so each command's awaits complete fully before the
// next line is read. Makes piped/scripted runs work the same as interactive.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: cyan("you ›") + " ",
  terminal: TTY,
});

let rlClosed = false;
rl.on("close", () => { rlClosed = true; });
function safePrompt() { if (!rlClosed) rl.prompt(); }

safePrompt();
for await (const line of rl) {
  const input = line.trim();
  if (!input) { safePrompt(); continue; }
  try {
    // sid is pulled from state on EVERY line so `:session resume <id>` can
    // hop sessions mid-REPL without a restart.
    const r = await handleLine(input, state.sid);
    if (r === "quit") break;
  } catch (e) {
    console.log(red("error: " + (e?.message || e)));
  }
  console.log("");
  safePrompt();
}

console.log(dim(`session preserved at ${state.sid}`));
if (!rlClosed) rl.close();
if (startedServer && serverProc) serverProc.kill();
process.exit(0);
