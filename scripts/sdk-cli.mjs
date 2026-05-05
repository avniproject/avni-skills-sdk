#!/usr/bin/env node
// sdk-cli.mjs — interactive terminal client for avni-skills-sdk.
//
// Drives the full Phase 4 flow against any SRS:
//   1. Boots the server if it's not already running.
//   2. Uploads your SRS (Forms + optional Modelling Excel) → creates a session.
//   3. Drops you into a REPL. Free text is sent to the agent at
//      POST /v1/sessions/:id/messages and the SSE stream is rendered live.
//      Lines starting with `:` run session commands.
//
// No npm deps — all built-ins (fetch, FormData, Blob, readline).
//
// Usage (anyone can run this):
//   export ANTHROPIC_API_KEY='sk-ant-...'
//
//   # Quickest: built-in synthetic SRS, zero arguments
//   npm run verify
//
//   # Or with your own SRS files
//   AVNI_SKILLS_PATH=~/code/avni-skills npm run cli -- --forms /path/to/Forms.xlsx [--modelling /path/to/Modelling.xlsx] [--org MyOrg]
//
// Resolves AVNI_SKILLS_PATH automatically if you cloned avni-skills as a
// sibling of this repo (../avni-skills).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";

const SDK_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
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
let FORMS_PATH = arg("forms");
let MODELLING_PATH = arg("modelling");
const ORG = arg("org", DEMO ? "DemoOrg" : "Bundle");
const MODEL = arg("model", "claude-haiku-4-5-20251001");
const PORT = Number(arg("port", process.env.PORT || 3030));
const BASE = `http://localhost:${PORT}`;

// ─── Resolve AVNI_SKILLS_PATH automatically if possible ───────────
function resolveAvniSkillsPath() {
  if (process.env.AVNI_SKILLS_PATH && fs.existsSync(process.env.AVNI_SKILLS_PATH)) {
    return process.env.AVNI_SKILLS_PATH;
  }
  // Try sibling
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
  npm test                                    # 45 entity invariants
  AVNI_SKILLS_PATH=${AVNI_SKILLS_PATH} bash scripts/verify.sh   # L1–L5 (no key)
`);
  process.exit(2);
}

// ─── Demo mode: build a tiny synthetic SRS in tmpdir ───────────────
if (DEMO && !FORMS_PATH) {
  console.log("(demo mode) building synthetic SRS workbook in tmpdir...");
  // Load xlsx as CJS so it has the fs hooks wired (the ESM build doesn't).
  let XLSX;
  try { XLSX = require(path.join(AVNI_SKILLS_PATH, "node_modules", "xlsx")); }
  catch (e) { console.error("could not load xlsx from avni-skills/node_modules:", e.message); process.exit(2); }
  const wb = XLSX.utils.book_new();

  // Subject Types sheet
  const stRows = [
    ["Subject Type", "Type"],
    ["Beneficiary", "Person"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stRows), "Subject Types");

  // Forms sheet — 1 registration form, with a deliberate F2 duplicate so the agent has something to fix
  const formRows = [
    ["Form Name", "Form Type", "Form Element Group", "Form Element", "Concept Data Type", "Concept Answers"],
    ["Beneficiary Registration", "IndividualProfile", "Identity", "Full Name", "Text", ""],
    ["Beneficiary Registration", "IndividualProfile", "Identity", "Gender", "Coded", "Male, Female, Other"],
    ["Beneficiary Registration", "IndividualProfile", "Demographics", "Age", "Numeric", ""],
    ["Beneficiary Registration", "IndividualProfile", "Demographics", "Gender", "Coded", "Male, Female, Other"], // ← duplicate F2
    ["Beneficiary Registration", "IndividualProfile", "Demographics", "Phone Number", "PhoneNumber", ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formRows), "Forms");

  const fp = path.join(os.tmpdir(), `avni-sdk-demo-srs-${process.pid}.xlsx`);
  XLSX.writeFile(wb, fp);
  FORMS_PATH = fp;
  console.log(`  ${fp}`);
  console.log("  ↳ contains 1 subject type + 1 registration form with a deliberate duplicate `Gender` reference (F2 error) so the agent has something to fix.");
}

if (!FORMS_PATH || !fs.existsSync(FORMS_PATH)) {
  console.error(`
No SRS provided. Try one of:

  npm run verify                              # built-in synthetic SRS (recommended for first-time)

  npm run cli -- --forms ./MyOrg-Forms.xlsx [--modelling ./MyOrg-Modelling.xlsx] [--org MyOrg]
`);
  process.exit(2);
}
if (MODELLING_PATH && !fs.existsSync(MODELLING_PATH)) {
  console.error(`--modelling not found: ${MODELLING_PATH}`); process.exit(2);
}

// ANSI helpers — only colorise when stdout is a TTY
const TTY = process.stdout.isTTY;
const c = (code) => (s) => TTY ? `\x1b[${code}m${s}\x1b[0m` : s;
const dim = c("2");
const bold = c("1");
const cyan = c("36");
const green = c("32");
const yellow = c("33");
const red = c("31");
const blue = c("34");
const magenta = c("35");

function box(lines) {
  const w = Math.max(...lines.map((l) => l.length)) + 2;
  const top = "╭" + "─".repeat(w) + "╮";
  const bot = "╰" + "─".repeat(w) + "╯";
  console.log(top);
  for (const l of lines) console.log("│ " + l + " ".repeat(w - l.length - 1) + "│");
  console.log(bot);
}

// ───────────────────────────────────────────────────────────────────
// Server lifecycle
// ───────────────────────────────────────────────────────────────────
async function serverHealthy() {
  try { const r = await fetch(`${BASE}/health`); return r.ok; }
  catch { return false; }
}

let serverProc = null;
async function ensureServer() {
  if (await serverHealthy()) return false;
  process.stdout.write(dim("starting server on :" + PORT + "..."));
  serverProc = spawn("node", ["src/server.js"], {
    cwd: SDK_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // pipe server output to a logfile so the REPL stays clean
  const logPath = path.join(os.tmpdir(), `avni-sdk-cli-${process.pid}.log`);
  const logFile = fs.createWriteStream(logPath);
  serverProc.stdout.pipe(logFile);
  serverProc.stderr.pipe(logFile);
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    if (await serverHealthy()) {
      process.stdout.write(green(" ok\n"));
      console.log(dim("  server log: " + logPath));
      return true;
    }
  }
  console.log(red(" timeout — see " + logPath));
  process.exit(1);
}

// ───────────────────────────────────────────────────────────────────
// Session bootstrap
// ───────────────────────────────────────────────────────────────────
async function createSession() {
  const fd = new FormData();
  fd.set("forms", new Blob([fs.readFileSync(FORMS_PATH)]), path.basename(FORMS_PATH));
  if (MODELLING_PATH) fd.set("modelling", new Blob([fs.readFileSync(MODELLING_PATH)]), path.basename(MODELLING_PATH));
  fd.set("org", ORG);
  const r = await fetch(`${BASE}/v1/sessions`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`create session failed: ${r.status} ${await r.text()}`);
  return r.json();
}

// ───────────────────────────────────────────────────────────────────
// Session commands (`:` prefix)
// ───────────────────────────────────────────────────────────────────
async function getJson(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return r.json();
}
async function getText(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return r.text();
}
async function postJson(p, body) {
  const r = await fetch(BASE + p, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${p} → ${r.status} ${await r.text()}`);
  return r.json();
}

function formatValidation(v) {
  if (!v) return "(no validation)";
  const groups = Object.entries(v.groups || {}).map(([k, n]) => `${k}:${n}`).join(" ");
  return `errors=${v.errors} warnings=${v.warnings}${groups ? "  " + dim(groups) : ""}`;
}

const HELP = `
${bold("Free text")}     send to the agent (Phase 4 — costs tokens)
${bold(":turns")}         list all turns
${bold(":diff [N]")}      unified diff for turn N (default = current turn)
${bold(":files")}         list files in the bundle
${bold(":read <path>")}   print a file
${bold(":revert <N>")}    hard-reset to turn N
${bold(":zip [path]")}    download final ZIP (default: /tmp/<org>.zip)
${bold(":state")}         re-fetch session metadata
${bold(":help")}          this list
${bold(":quit")} / ${bold(":q")}     exit (session is preserved on disk)
`;

async function cmdTurns(sid) {
  const { turns } = await getJson(`/v1/sessions/${sid}/turns`);
  for (const t of turns) {
    console.log(`  ${cyan("turn " + t.turn)}  ${dim(t.sha)}  ${t.summary}`);
  }
}
async function cmdDiff(sid, n) {
  const meta = await getJson(`/v1/sessions/${sid}`);
  const target = n === undefined ? meta.currentTurn : Number(n);
  if (target === 0) { console.log(yellow("turn 0 is the deterministic first-pass — no parent diff")); return; }
  const diff = await getText(`/v1/sessions/${sid}/turns/${target}/diff`);
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) console.log(bold(line));
    else if (line.startsWith("+")) console.log(green(line));
    else if (line.startsWith("-")) console.log(red(line));
    else if (line.startsWith("@@")) console.log(magenta(line));
    else console.log(dim(line));
  }
}
async function cmdFiles(sid) {
  const meta = await getJson(`/v1/sessions/${sid}`);
  console.log(dim(`${meta.files.length} files:`));
  for (const f of meta.files) console.log("  " + f);
}
async function cmdRead(sid, p) {
  if (!p) { console.log(red("usage: :read <path>")); return; }
  const txt = await getText(`/v1/sessions/${sid}/files/${encodeURI(p)}`);
  // Pretty-print JSON if it parses, else raw
  try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); }
  catch { console.log(txt); }
}
async function cmdRevert(sid, n) {
  if (n === undefined) { console.log(red("usage: :revert <turn>")); return; }
  const r = await postJson(`/v1/sessions/${sid}/revert`, { to_turn: Number(n) });
  console.log(green(`✓ reverted to turn ${r.currentTurn} — ${formatValidation(r.validationAtCurrent)}`));
}
async function cmdZip(sid, dest) {
  const meta = await getJson(`/v1/sessions/${sid}`);
  const out = dest || path.join(os.tmpdir(), `${meta.org}-${sid}.zip`);
  const r = await fetch(`${BASE}/v1/sessions/${sid}/zip`);
  if (!r.ok) throw new Error("zip failed: " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(out, buf);
  console.log(green(`✓ ${out}  (${(buf.length / 1024).toFixed(1)} KB)`));
}
async function cmdState(sid) {
  const meta = await getJson(`/v1/sessions/${sid}`);
  console.log(`  org=${meta.org}  currentTurn=${meta.currentTurn}  files=${meta.files.length}`);
  console.log(`  validator: ${formatValidation(meta.validationAtCurrent)}`);
}

// ───────────────────────────────────────────────────────────────────
// Agent message — SSE-stream the response from /messages
// ───────────────────────────────────────────────────────────────────
function describeToolUse(b) {
  const inp = b.input || {};
  if (b.name === "Read" || b.name === "Edit" || b.name === "Write") {
    const fp = inp.file_path || inp.path;
    if (fp) return `${b.name}  ${dim(fp.split("/").slice(-2).join("/"))}`;
  }
  if (b.name === "Glob" || b.name === "Grep") return `${b.name}  ${dim(inp.pattern || inp.glob || "")}`;
  if (b.name === "Bash") return `${b.name}  ${dim((inp.command || "").slice(0, 60))}`;
  if (b.name === "Skill") return `${b.name}  ${dim(inp.skill || "")}`;
  return b.name;
}

async function sendMessage(sid, prompt) {
  const r = await fetch(`${BASE}/v1/sessions/${sid}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.ANTHROPIC_API_KEY}`,
    },
    body: JSON.stringify({ prompt, model: MODEL }),
  });
  if (!r.ok) {
    console.log(red(`agent call failed: ${r.status} — ${await r.text()}`)); return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let inputTokens = 0, outputTokens = 0, costUsd = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = (block.match(/^event:\s*(.*)$/m) || [, ""])[1];
      const dataLine = (block.match(/^data:\s*([\s\S]*)$/m) || [, "{}"])[1];
      let data; try { data = JSON.parse(dataLine); } catch { continue; }
      handleEvent(ev, data);
    }
  }
  function handleEvent(ev, data) {
    if (ev === "start") {
      console.log(dim(`  [start] model=${data.model}  cwd=${data.cwd?.split("/").slice(-2).join("/")}`));
    } else if (ev === "agent") {
      const t = data.type;
      const sub = data.subtype;
      if (t === "system" && sub === "init") {
        console.log(dim(`  [system.init] ${(data.tools || []).length} tools  model=${data.model}`));
      } else if (t === "assistant" && data.message?.content) {
        for (const b of data.message.content) {
          if (b.type === "text" && b.text) {
            for (const ln of b.text.split("\n")) console.log("  " + ln);
          } else if (b.type === "tool_use") {
            console.log(blue(`  ⚙ ${describeToolUse(b)}`));
          } else if (b.type === "thinking") {
            // Suppress — too noisy for chat UX
          }
        }
        const u = data.message?.usage;
        if (u) { inputTokens = u.input_tokens || inputTokens; outputTokens = u.output_tokens || outputTokens; }
      } else if (t === "user" && data.message?.content) {
        // tool_result blocks — keep terse
        for (const b of data.message.content) {
          if (b.type === "tool_result") {
            const content = Array.isArray(b.content) ? b.content.map((x) => x.text || "").join("") : String(b.content || "");
            const first = content.split("\n")[0].slice(0, 80);
            console.log(dim(`    ↳ ${first}${content.length > 80 ? "…" : ""}`));
          }
        }
      } else if (t === "result") {
        if (typeof data.total_cost_usd === "number") costUsd = data.total_cost_usd;
        if (data.usage) {
          inputTokens = data.usage.input_tokens || inputTokens;
          outputTokens = data.usage.output_tokens || outputTokens;
        }
      }
    } else if (ev === "turn") {
      console.log("");
      if (data.noChanges) {
        console.log(yellow("  ── no changes (turn counter unchanged) ──"));
      } else {
        console.log(green(`  ── turn ${data.turn} committed (${data.sha}) ──`));
        console.log(`     changedFiles: ${data.changedFiles?.join(", ") || "(none)"}`);
      }
      console.log(`     validator: ${formatValidation(data.validation)}`);
    } else if (ev === "done") {
      console.log(dim(`  [done] events=${data.agentEvents}  tokens in=${inputTokens} out=${outputTokens}  cost=$${costUsd.toFixed(4)}`));
    } else if (ev === "error") {
      console.log(red("  ✗ " + (data.message || JSON.stringify(data))));
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────
const startedServer = await ensureServer();

box([
  bold("avni-skills-sdk CLI"),
  `server:  ${BASE}  ${green("✓ healthy")}`,
  `model:   ${MODEL}`,
  `forms:   ${path.basename(FORMS_PATH)}`,
  `modelling: ${MODELLING_PATH ? path.basename(MODELLING_PATH) : "(none)"}`,
  `org:     ${ORG}`,
]);

console.log(dim("\ncreating session..."));
const sess = await createSession();
const sid = sess.sessionId;
console.log(green(`✓ session ${sid}`));
console.log(`  turn 0 (deterministic first-pass): ${formatValidation(sess.validation)}`);
console.log("");
console.log(dim("Type free text to talk to the agent, or `:help` for commands.\n"));

// Use readline as an async iterator so each command's awaits complete fully
// before the next line is read. This makes piped/scripted runs work the same
// as interactive use.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: cyan("you> "),
  terminal: TTY,
});

async function handleLine(input) {
  if (input.startsWith(":")) {
    const [cmd, ...rest] = input.slice(1).split(/\s+/);
    const arg1 = rest[0];
    switch (cmd) {
      case "help": case "h": case "?": console.log(HELP); break;
      case "turns": await cmdTurns(sid); break;
      case "diff": await cmdDiff(sid, arg1); break;
      case "files": await cmdFiles(sid); break;
      case "read": await cmdRead(sid, rest.join(" ")); break;
      case "revert": await cmdRevert(sid, arg1); break;
      case "zip": await cmdZip(sid, arg1); break;
      case "state": await cmdState(sid); break;
      case "quit": case "q": case "exit": return "quit";
      default: console.log(red(`unknown command: :${cmd}  (try :help)`));
    }
  } else {
    console.log(magenta("agent>"));
    await sendMessage(sid, input);
  }
  return "continue";
}

let rlClosed = false;
rl.on("close", () => { rlClosed = true; });
function safePrompt() { if (!rlClosed) rl.prompt(); }

safePrompt();
for await (const line of rl) {
  const input = line.trim();
  if (!input) { safePrompt(); continue; }
  try {
    const r = await handleLine(input);
    if (r === "quit") break;
  } catch (e) {
    console.log(red("error: " + (e?.message || e)));
  }
  console.log("");
  safePrompt();
}
console.log(dim(`session preserved at ${sid}`));
if (!rlClosed) rl.close();
if (startedServer && serverProc) serverProc.kill();
process.exit(0);
