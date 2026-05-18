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
const RESUME_SID = arg("resume", null);
let FORMS_PATH = arg("forms");
let MODELLING_PATH = arg("modelling");
let ORG = arg("org", DEMO ? "DemoOrg" : "Bundle");
// MODEL is `let` (not `const`) so the `:model` REPL command can swap it mid-session.
// Haiku 4.5 is great for cheap mechanical edits but is NOT reliable for structural
// fixes (case-insensitive concept reuse, schema-level decisions). Use `:model sonnet`
// before issuing those prompts. See README "Model selection" for details.
let MODEL = arg("model", "claude-haiku-4-5-20251001");
const MODEL_ALIASES = {
  haiku:  "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus:   "claude-opus-4-7",
};
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

if (RESUME_SID) {
  if (!/^sess_[0-9a-f]{16}$/.test(RESUME_SID)) {
    console.error(`--resume: invalid session id "${RESUME_SID}" (expected sess_<16-hex>)`);
    process.exit(2);
  }
  // On resume, the forms/modelling xlsx files are not needed — the bundle
  // already lives in <session>/bundle/ with full git history. We attach to
  // the existing session and skip the deterministic generator.
} else {
  if (!FORMS_PATH || !fs.existsSync(FORMS_PATH)) {
    console.error(`
No SRS provided. Try one of:

  npm run verify                              # built-in synthetic SRS (recommended for first-time)

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

// Visible-character length, ignoring ANSI escape codes (so coloured strings
// don't overflow the box).
function visibleLen(s) { return s.replace(/\x1b\[[0-9;]*m/g, "").length; }

function box(lines, { style = "round", indent = 0 } = {}) {
  const w = Math.max(...lines.map(visibleLen)) + 2;
  const corners = style === "square" ? "┌┐└┘" : "╭╮╰╯";
  const pad = " ".repeat(indent);
  const top = pad + corners[0] + "─".repeat(w) + corners[1];
  const bot = pad + corners[2] + "─".repeat(w) + corners[3];
  console.log(top);
  for (const l of lines) {
    const padding = " ".repeat(w - visibleLen(l) - 1);
    console.log(pad + "│ " + l + padding + "│");
  }
  console.log(bot);
}

// Horizontal rule with optional label.
function rule(label = "", color = dim) {
  const w = Math.max(40, (process.stdout.columns || 80) - 2);
  if (!label) { console.log(color("─".repeat(w))); return; }
  const left = "── " + label + " ";
  const right = "─".repeat(Math.max(3, w - visibleLen(left)));
  console.log(color(left + right));
}

// ───────────────────────────────────────────────────────────────────
// Server lifecycle
// ───────────────────────────────────────────────────────────────────
async function serverHealthy() {
  try { const r = await fetch(`${BASE}/health`); return r.ok; }
  catch { return false; }
}

let serverProc = null;
// Tracks the validator's `groups` map from the last turn so we can detect
// regressions (new error codes, growing counts) and surface them in red
// after each turn — even when the agent's prose says ✅.
let priorValidationGroups = null;
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

// Attach to an existing session — used by `--resume`. Returns the same shape
// as createSession so the caller path stays uniform.
async function attachSession(sid) {
  const r = await fetch(`${BASE}/v1/sessions/${sid}`);
  if (r.status === 404) throw new Error(`session not found: ${sid}`);
  if (!r.ok) throw new Error(`attach session failed: ${r.status} ${await r.text()}`);
  const meta = await r.json();
  return {
    sessionId: sid,
    meta,
    validation: meta.validationAtCurrent,
    resumed: true,
  };
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
${bold(":rules")}         list every populated rule (entity, field, bytes)
${bold(":rulev")}         run Layer-4 rules validator (R1-R6) on every rule
${bold(":summary")}       deterministic bundle audit — entity counts, anomalies, rule stats (free)
${bold(":eval")}          LLM semantic-gap audit via /v1/sessions/:id/evaluate (~$0.05-0.20)
${bold(":refs")} <q>      find every reference to a UUID or name across the bundle. q = UUID or "Name"
${bold(":rename")} <old> <new> [new-name]
                rewrite every occurrence of <old-uuid> to <new-uuid> across the bundle
                (concepts + forms + mappings + rule bodies). Optional 3rd arg renames the concept.
${bold(":add-form")} <spec.json> [--dry-run]
                atomic multi-file form insertion (creates form file, appends concepts + formMapping).
                Spec shape: {name, formType, subjectTypeName, formElements[{name,conceptName,dataType,...}]}.
                ${dim("(deterministic shortcut — for arbitrary add/edit, just talk to the agent in free text.)")}
${bold(":transcript")} [N]   tail conversation memory (user/assistant/turn events from transcript.jsonl)
${bold(":steps")} [N]        tail operational log (validator runs, agent turns, commits, durations)
${bold(":cost")}              wallet snapshot — total spent / remaining / tokens / cap-percentage
${bold(":model")} [name]  show or change agent model. Aliases: haiku | sonnet | opus.
                Use sonnet for structural fixes (concept dedup, schema-level decisions);
                haiku is fine for mechanical edits and rule authoring.
${bold(":revert <N>")}    hard-reset to turn N
${bold(":zip [path]")}    download final ZIP (default: <repo>/output-bundle/<org>-<sid>.zip)
${bold(":state")}         re-fetch session metadata
${bold(":help")}          this list
${bold(":quit")} / ${bold(":q")}     exit (session is preserved on disk — resume via ${cyan("npm run cli -- --resume <sid>")})
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
  const out = dest || path.join(SDK_DIR, "output-bundle", `${meta.org}-${sid}.zip`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = await fetch(`${BASE}/v1/sessions/${sid}/zip`);
  if (!r.ok) throw new Error("zip failed: " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(out, buf);
  console.log(green(`✓ ${out}  (${(buf.length / 1024).toFixed(1)} KB)`));
}
async function cmdRules(sid) {
  const d = await getJson(`/v1/sessions/${sid}/rules`);
  if (d.count === 0) {
    console.log(yellow("  no populated rules"));
    return;
  }
  const groups = {};
  for (const r of d.rules) {
    const k = `${r.entity}.${r.field}`;
    (groups[k] ||= []).push(r);
  }
  for (const k of Object.keys(groups).sort()) {
    console.log(`  ${bold(k)}  (${groups[k].length})`);
    for (const r of groups[k].slice(0, 5)) {
      console.log(`    ${dim(r.file)}  ${cyan(r.entityName || "")}  ${dim(r.bytes + " bytes")}`);
    }
    if (groups[k].length > 5) console.log(dim(`    … ${groups[k].length - 5} more`));
  }
  console.log(dim(`  total: ${d.count}`));
}

async function cmdRuleValidate(sid) {
  const d = await getJson(`/v1/sessions/${sid}/rules/validation`);
  const s = d.summary;
  const tag = s.errors > 0 ? red(`✗ errors=${s.errors}`) : s.warnings > 0 ? yellow(`⚠ warnings=${s.warnings}`) : green("✓ all rules valid");
  console.log(`  ${tag}   filesAffected=${s.filesAffected}`);
  for (const e of (d.errors || []).slice(0, 8)) {
    console.log(`  ${red("E")} ${e.code}  ${e.message.slice(0, 140)}`);
  }
  for (const w of (d.warnings || []).slice(0, 8)) {
    console.log(`  ${yellow("W")} ${w.code}  ${w.message.slice(0, 140)}`);
  }
  if (d.errors?.length > 8) console.log(dim(`  … ${d.errors.length - 8} more errors`));
  if (d.warnings?.length > 8) console.log(dim(`  … ${d.warnings.length - 8} more warnings`));
}

async function cmdSummary(sid) {
  const d = await getJson(`/v1/sessions/${sid}/summary`);
  const ec = d.entityCounts;
  box([
    bold("bundle summary") + dim(" · deterministic · free"),
    "",
    `${dim("concepts")}        ${cyan(String(ec.concepts))}        ${dim("Coded:")} ${cyan(String(d.codedAnswerStats.totalCoded))} ${dim("(empty:")} ${d.codedAnswerStats.emptyCoded > 0 ? red(String(d.codedAnswerStats.emptyCoded)) : green("0")}${dim(")")}`,
    `${dim("forms")}           ${cyan(String(ec.forms))}        ${dim("rules populated:")} ${cyan(String(d.ruleStats.populated))}`,
    `${dim("subjectTypes")}    ${cyan(String(ec.subjectTypes))}`,
    `${dim("programs")}        ${cyan(String(ec.programs))}`,
    `${dim("encounterTypes")}  ${cyan(String(ec.encounterTypes))}`,
    `${dim("formMappings")}    ${cyan(String(ec.formMappings))}`,
  ]);
  if (d.anomalyCount === 0) {
    console.log("  " + green("✓ no anomalies"));
    return;
  }
  console.log("  " + bold(`anomalies (${d.anomalyCount})`) + dim(" · ") + red(String(d.errorCount)) + dim(" errors · ") + yellow(String(d.warningCount)) + dim(" warnings"));
  for (const a of d.anomalies.slice(0, 20)) {
    const sev = a.severity === "error" ? red("E") : a.severity === "warning" ? yellow("W") : dim("I");
    console.log("    " + sev + " " + bold(a.type) + dim("  " + a.where));
    console.log("      " + dim("→ ") + (a.value || "").slice(0, 110));
  }
  if (d.anomalies.length > 20) console.log(dim(`    … ${d.anomalies.length - 20} more`));
}

async function cmdEval(sid) {
  console.log(dim("  ⠋ running LLM semantic-gap audit (~$0.05-0.20)…"));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log(red("  ANTHROPIC_API_KEY not set")); return; }
  const r = await fetch(`${BASE}/v1/sessions/${sid}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({}),
  });
  if (!r.ok) { console.log(red(`  evaluate failed: ${r.status} ${await r.text()}`)); return; }
  const d = await r.json();
  const findings = d.findings || [];
  console.log(green(`  ✓ evaluated`) + dim(` · cost $${(d.costUsd || 0).toFixed(4)} · ${findings.length} findings`));
  if (d.summary) {
    console.log("");
    for (const ln of d.summary.split("\n")) console.log("  " + ln);
  }
  for (const f of findings) {
    const sev = f.severity === "error" ? red("E") : f.severity === "warning" ? yellow("W") : dim("I");
    console.log("");
    console.log("  " + sev + " " + bold(f.title));
    if (f.evidence) console.log("    " + dim("evidence:    ") + f.evidence);
    if (f.recommendation) console.log("    " + dim("recommend:   ") + f.recommendation);
  }
}

async function cmdRefs(sid, query) {
  if (!query) { console.log(red("  usage: :refs <uuid-or-name>")); return; }
  // Detect: UUID-shaped → --uuid, else --name
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.trim());
  const dir = await getJson(`/v1/sessions/${sid}`).then((s) => s).catch(() => null);
  if (!dir) { console.log(red("  session not found")); return; }
  // Run CLI server-side via Bash isn't an option from the CLI side — call via local node spawn
  const { spawnSync } = await import("node:child_process");
  const cliPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "agent-tools/find-references.mjs");
  // Session bundle dir from meta (we need cwd to be the bundle dir)
  const meta = await getJson(`/v1/sessions/${sid}`);
  const bundlePath = meta._bundlePath || guessBundlePath(sid);
  const args = isUuid ? ["--uuid", query.trim()] : ["--name", query.trim()];
  const res = spawnSync("node", [cliPath, ...args], { cwd: bundlePath, encoding: "utf8" });
  if (res.status !== 0) { console.log(red("  refs failed: " + (res.stderr || res.stdout))); return; }
  const out = JSON.parse(res.stdout);
  console.log(`  ${bold(String(out.totalReferences))}` + dim(" references across ") + cyan(String(out.filesAffected)) + dim(" files"));
  for (const [f, list] of Object.entries(out.byFile || {})) {
    console.log("    " + bold(f) + dim(" (" + list.length + ")"));
    for (const ref of list.slice(0, 5)) {
      console.log(dim("      " + ref.jsonPath + "  ") + (ref.kind === "string-contains" ? dim("(in string body)") : cyan(ref.kind)));
    }
    if (list.length > 5) console.log(dim(`      … ${list.length - 5} more`));
  }
}

async function cmdRename(sid, args) {
  if (args.length < 2) { console.log(red("  usage: :rename <old-uuid> <new-uuid> [new-name]")); return; }
  const [oldU, newU, ...rest] = args;
  const newName = rest.length ? rest.join(" ") : null;
  console.log(dim(`  ⠋ rewriting ${oldU} → ${newU}${newName ? " (rename to '" + newName + "')" : ""} across the bundle…`));
  const { spawnSync } = await import("node:child_process");
  const cliPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "workflows/rename-concept-uuid.mjs");
  const bundlePath = guessBundlePath(sid);
  const cliArgs = ["--old", oldU, "--new", newU];
  if (newName) cliArgs.push("--new-name", newName);
  const res = spawnSync("node", [cliPath, ...cliArgs], { cwd: bundlePath, encoding: "utf8" });
  if (res.status !== 0) { console.log(red("  rename failed: " + (res.stderr || res.stdout))); return; }
  const out = JSON.parse(res.stdout);
  console.log("  " + green("✓") + " " + out.message);
  for (const [f, info] of Object.entries(out.byFile || {})) {
    console.log("    " + dim(f) + "  " + cyan(String(info.replacements)) + dim(" replacements"));
  }
  console.log(dim("  Tip: now commit the change as a turn via free text (e.g. 'commit the rename'), or it'll be in the working tree."));
}

async function cmdAddForm(sid, args) {
  if (args.length < 1) { console.log(red("  usage: :add-form <spec.json> [--dry-run]")); return; }
  const [specPath, ...rest] = args;
  if (!fs.existsSync(specPath)) { console.log(red("  spec not found: " + specPath)); return; }
  const isDry = rest.includes("--dry-run");
  console.log(dim(`  ⠋ ${isDry ? "[dry-run] " : ""}adding form from ${specPath}…`));
  const { spawnSync } = await import("node:child_process");
  const cliPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "workflows/add-form.mjs");
  const bundlePath = guessBundlePath(sid);
  const cliArgs = ["--spec", specPath, ...rest];
  const res = spawnSync("node", [cliPath, ...cliArgs], { cwd: bundlePath, encoding: "utf8" });
  let out;
  try { out = JSON.parse(res.stdout); } catch { out = null; }
  if (!out) { console.log(red("  add-form failed:\n  " + (res.stderr || res.stdout))); return; }
  if (out.ok === false) {
    console.log(red("  ✗ add-form rejected:"));
    for (const e of (out.errors || [])) console.log("    " + e);
    if (out.availableSubjectTypes) console.log(dim("  available subjectTypes: " + out.availableSubjectTypes.join(", ")));
    return;
  }
  console.log("  " + green("✓") + (out.dryRun ? dim(" [dry-run] ") : " ") + (out.message || `form "${out.form.name}" planned`));
  console.log(dim("    form uuid:           ") + cyan(out.form.uuid));
  console.log(dim("    formElements:        ") + out.formElementCount);
  console.log(dim("    new concepts:        ") + (out.newConcepts || []).length);
  console.log(dim("    new answer concepts: ") + (out.newAnswerConcepts || []).length);
  console.log(dim("    reused concepts:     ") + (out.reusedConcepts || []).length);
  if (!out.dryRun) console.log(dim("  Tip: commit via free text 'commit the new form' or wait for the next agent turn."));
}

// Locate the session's bundle dir for direct CLI invocation (find-refs / rename).
// We try the documented tmpdir convention used by sessions.js.
function guessBundlePath(sid) {
  const tmp = os.tmpdir();
  const home = os.homedir();
  const override = process.env.SDK_SESSIONS_DIR;
  const candidates = [
    override ? path.join(override, sid, "bundle") : null,
    path.join(home, ".avni-skills-sdk", "sessions", sid, "bundle"),
    path.join(tmp, "avni-sdk-sessions", sid, "bundle"),
    path.join("/private" + tmp, "avni-sdk-sessions", sid, "bundle"),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("could not locate bundle dir for " + sid);
}

function cmdModel(arg) {
  if (!arg) {
    console.log(`  current: ${cyan(MODEL)}`);
    console.log(dim("  aliases: " + Object.entries(MODEL_ALIASES).map(([k,v]) => `${k}→${v}`).join(", ")));
    console.log(dim("  usage:   :model sonnet"));
    return;
  }
  const resolved = MODEL_ALIASES[arg.toLowerCase()] || arg;
  MODEL = resolved;
  console.log(`  ${green("✓")} model set to ${cyan(MODEL)}`);
  if (arg.toLowerCase() === "sonnet" || resolved.includes("sonnet")) {
    console.log(dim("  (sonnet recommended for structural fixes — case-insensitive concept reuse, schema decisions)"));
  } else if (arg.toLowerCase() === "haiku" || resolved.includes("haiku")) {
    console.log(dim("  (haiku is cheap+fast for mechanical edits and rule authoring; switch to sonnet for structural fixes)"));
  }
}

async function cmdState(sid) {
  const meta = await getJson(`/v1/sessions/${sid}`);
  console.log(`  org=${meta.org}  currentTurn=${meta.currentTurn}  files=${meta.files.length}`);
  console.log(`  validator: ${formatValidation(meta.validationAtCurrent)}`);
}

async function cmdTranscript(sid, limitArg) {
  const limit = limitArg ? Math.max(1, Number(limitArg)) : 20;
  const data = await getJson(`/v1/sessions/${sid}/transcript?limit=${limit}`);
  if (!data.events || data.events.length === 0) {
    console.log(dim("  (no transcript events yet)"));
    return;
  }
  console.log(dim(`  showing last ${data.events.length} of ${data.count} event(s)`));
  for (const ev of data.events) {
    const ts = (ev.ts || "").replace("T", " ").replace(/\.\d+Z$/, "Z");
    const kind = ev.kind.padEnd(18);
    let detail = "";
    if (ev.kind === "user_message") detail = (ev.content || "").slice(0, 80);
    else if (ev.kind === "turn_commit") detail = `turn ${ev.turn} sha=${(ev.sha || "").slice(0,8)} cost=$${(ev.cost_usd ?? 0).toFixed(4)} — ${(ev.summary || "").slice(0, 50)}`;
    else if (ev.kind === "system") detail = ev.action || "";
    else if (ev.kind === "assistant_message") detail = (ev.content || "").slice(0, 80);
    console.log(`  ${dim(ts)}  ${cyan(kind)} ${dim(detail)}`);
  }
}

async function cmdSteps(sid, limitArg) {
  const limit = limitArg ? Math.max(1, Number(limitArg)) : 20;
  const data = await getJson(`/v1/sessions/${sid}/steps?limit=${limit}`);
  if (!data.steps || data.steps.length === 0) {
    console.log(dim("  (no operational steps logged yet)"));
    return;
  }
  console.log(dim(`  showing last ${data.steps.length} of ${data.count} step(s); ${data.stats?.errors || 0} errors total`));
  for (const s of data.steps) {
    const ts = (s.ts || "").replace("T", " ").replace(/\.\d+Z$/, "Z");
    const statusIcon = s.status === "ok" ? green("✓") : s.status === "error" ? red("✗") : yellow("!");
    const ms = s.duration_ms != null ? `${s.duration_ms}ms` : "";
    const metaStr = s.meta ? Object.entries(s.meta).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(" ") : "";
    console.log(`  ${dim(ts)}  ${statusIcon} ${cyan(s.kind.padEnd(15))} ${dim(ms.padEnd(8))} ${dim(metaStr)}`);
  }
  if (data.stats?.avgMs) {
    console.log(dim("  avg ms by kind: " + Object.entries(data.stats.avgMs).map(([k, v]) => `${k}=${v}`).join("  ")));
  }
}

async function cmdCost(sid) {
  const w = await getJson(`/v1/sessions/${sid}/cost`);
  const pct = w.caps?.hardCapUsd ? (w.totalUsd / w.caps.hardCapUsd) * 100 : 0;
  console.log(`  ${dim("total spent")}   ${cyan("$" + w.totalUsd.toFixed(4))} ${dim(`of $${w.caps.hardCapUsd.toFixed(2)} cap`)} (${pct.toFixed(1)}%)`);
  console.log(`  ${dim("remaining")}     ${cyan("$" + w.remainingUsd.toFixed(4))}`);
  console.log(`  ${dim("turns recorded")} ${cyan(String(w.turnCount))}`);
  console.log(`  ${dim("input tokens")}  ${cyan(String(w.totalInputTokens))}`);
  console.log(`  ${dim("output tokens")} ${cyan(String(w.totalOutputTokens))}`);
  if (pct > 80) console.log(yellow(`  ⚠ ${pct.toFixed(0)}% of cap consumed — reset via POST /v1/sessions/${sid}/wallet/reset to continue.`));
}


// ───────────────────────────────────────────────────────────────────
// Agent message — SSE-stream the response from /messages
// ───────────────────────────────────────────────────────────────────
// Tool icon + one-line description. No emojis — just box-drawing/symbols.
function describeToolUse(b) {
  const inp = b.input || {};
  let icon = "▸";
  let label = b.name;
  let detail = "";
  if (b.name === "Read")  { icon = "◇"; const fp = inp.file_path || inp.path; if (fp) detail = fp.split("/").slice(-2).join("/"); }
  else if (b.name === "Edit") { icon = "◆"; const fp = inp.file_path || inp.path; if (fp) detail = fp.split("/").slice(-2).join("/"); }
  else if (b.name === "Write"){ icon = "✎"; const fp = inp.file_path || inp.path; if (fp) detail = fp.split("/").slice(-2).join("/"); }
  else if (b.name === "Glob" || b.name === "Grep") { icon = "◈"; detail = inp.pattern || inp.glob || ""; }
  else if (b.name === "Bash") { icon = "$"; detail = (inp.command || "").slice(0, 64).replace(/\s+/g, " "); }
  else if (b.name === "Skill"){ icon = "§"; detail = inp.skill || ""; label = "skill"; }
  return { icon, label, detail };
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
      // Slim header — one dim line, no spam
      const m = (data.model || "").split("-").slice(0, 4).join("-");
      console.log(dim(`  ${m} · cwd=${data.cwd?.split("/").slice(-2).join("/")}`));
    } else if (ev === "agent") {
      const t = data.type;
      const sub = data.subtype;
      if (t === "system" && sub === "init") {
        // First system event after start — show tool/skill count subtly
        const ntools = (data.tools || []).length;
        const nskills = (data.skills || []).length;
        console.log(dim(`  ${ntools} tools · ${nskills} skills available`));
      } else if (t === "assistant" && data.message?.content) {
        let printedAgentPrefix = false;
        for (const b of data.message.content) {
          if (b.type === "text" && b.text) {
            if (!printedAgentPrefix) { console.log(magenta("agent ›")); printedAgentPrefix = true; }
            for (const ln of b.text.split("\n")) console.log("  " + ln);
          } else if (b.type === "tool_use") {
            const { icon, label, detail } = describeToolUse(b);
            const labelColor = label === "skill" ? cyan : label === "Edit" || label === "Write" ? yellow : blue;
            console.log("  " + labelColor(icon + " " + label) + (detail ? "  " + dim(detail) : ""));
          } else if (b.type === "thinking") {
            // Suppress — too noisy for chat UX
          }
        }
        const u = data.message?.usage;
        if (u) { inputTokens = u.input_tokens || inputTokens; outputTokens = u.output_tokens || outputTokens; }
      } else if (t === "user" && data.message?.content) {
        // tool_result blocks — render very dim, short, indented
        for (const b of data.message.content) {
          if (b.type === "tool_result") {
            const content = Array.isArray(b.content) ? b.content.map((x) => x.text || "").join("") : String(b.content || "");
            const lines = content.split("\n").filter((l) => l.trim());
            const first = (lines[0] || "").slice(0, 96);
            const more = lines.length > 1 ? dim(` · +${lines.length - 1} lines`) : "";
            console.log("    " + dim("↳ " + first) + more);
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
      // Compute regression deltas BEFORE rendering so we can include in the panel
      const prior = priorValidationGroups || {};
      const now = data.validation?.groups || {};
      const newCodes = Object.keys(now).filter((k) => !(k in prior));
      const grewCodes = Object.keys(now).filter((k) => k in prior && now[k] > prior[k]);
      const shrunkCodes = Object.keys(prior).filter((k) => !(k in now) || now[k] < (prior[k] || 0));
      const priorTotal = Object.values(prior).reduce((a, b) => a + b, 0);
      const nowTotal = Object.values(now).reduce((a, b) => a + b, 0);
      const delta = nowTotal - priorTotal;
      const isRegression = newCodes.length || grewCodes.length || delta > 0;
      const isImprovement = !isRegression && (shrunkCodes.length || delta < 0);
      // Build panel lines
      const v = data.validation;
      const validIcon = v?.valid ? green("✓ valid") : red("✗ " + v?.errors + " errors");
      const warnTag = v?.warnings ? dim(" · " + v.warnings + " warnings") : "";
      const codes = Object.entries(now).map(([k, n]) => `${k}:${n}`).join(" ");
      const deltaStr = delta === 0 ? dim("Δ 0")
                     : isRegression ? red(`Δ +${delta}`)
                     : green(`Δ ${delta}`);

      const lines = [];
      if (data.noChanges) {
        lines.push(yellow("turn") + " " + dim("(no changes · counter unchanged)"));
      } else {
        lines.push(bold("turn " + data.turn) + dim("  · " + data.sha));
        const cf = (data.changedFiles || []);
        lines.push(dim("changed     ") + (cf.length ? cf.join(", ") : dim("(none)")));
      }
      lines.push(dim("validator   ") + validIcon + warnTag + (codes ? dim("   " + codes) : "") + "   " + deltaStr);
      if (isRegression) {
        const why = [];
        if (newCodes.length) why.push("new: " + newCodes.join(","));
        if (grewCodes.length) why.push("grew: " + grewCodes.join(","));
        lines.push(red("⚠ regression ") + why.join(" · "));
      }
      if (data.rulesValidation) {
        const r = data.rulesValidation;
        const tag = r.errors > 0 ? red("✗ " + r.errors + " errors")
                  : r.warnings > 0 ? dim("⚠ " + r.warnings + " warnings")
                  : green("✓ clean");
        lines.push(dim("rules       ") + tag + (Object.keys(r.codes || {}).length ? dim("   " + Object.keys(r.codes).join(",")) : ""));
      }
      // Cost line — but only once we've seen at least one usage event
      if (inputTokens || outputTokens || costUsd) {
        lines.push(dim("cost        $") + costUsd.toFixed(4) + dim("   tokens in/out  ") + inputTokens + "/" + outputTokens);
      }

      box(lines, { style: isRegression ? "square" : "round", indent: 0 });

      if (isRegression && !data.noChanges) {
        console.log(dim("  ↪ The agent may have claimed success. Consider ") + cyan(":diff " + data.turn) + dim(" then ") + cyan(":revert " + (data.turn - 1)) + dim(" — or ") + cyan(":model sonnet") + dim(" before re-attempting."));
      }
      priorValidationGroups = { ...now };
    } else if (ev === "done") {
      // Trailing dim line only when we didn't already show cost in the turn panel
      // (turn panel already includes it). Keep this minimal.
      console.log(dim("  [stream end · " + data.agentEvents + " events]"));
    } else if (ev === "error") {
      console.log(red("  ✗ " + (data.message || JSON.stringify(data))));
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────
const startedServer = await ensureServer();

// Fetch live skill list from HTTP API so the banner reflects what the agent
// will actually see in its workspace. This makes the "HTTP API of skills"
// substrate visible to the user.
let bannerSkills = [];
try { const r = await fetch(`${BASE}/v1/skills`); if (r.ok) bannerSkills = await r.json(); } catch {}
const skillCount = Array.isArray(bannerSkills) ? bannerSkills.length : (bannerSkills.skills?.length ?? 0);
const skillList  = Array.isArray(bannerSkills) ? bannerSkills : (bannerSkills.skills || []);
const localSkills = skillList.filter((s) => s.source === "sdk-local").map((s) => s.slug);

const modelHint = MODEL.includes("haiku")
  ? dim("[ haiku · fast & cheap · mechanical edits ]")
  : MODEL.includes("sonnet")
  ? cyan("[ sonnet · structural fixes · case-insensitive reasoning ]")
  : MODEL.includes("opus")
  ? magenta("[ opus · deep reasoning ]")
  : "";

const headerLines = [
  bold(cyan("avni-skills-sdk")) + dim(" · interactive REPL"),
  "",
  `${dim("server")}    ${BASE}  ${green("✓ healthy")}`,
  `${dim("model")}     ${cyan(MODEL)}  ${modelHint}`,
  `${dim("skills")}    ${skillCount} loaded  ${dim("(" + localSkills.length + " sdk-local: " + localSkills.join(", ") + ")")}`,
  "",
];
if (RESUME_SID) {
  headerLines.push(`${dim("resume")}    ${cyan(RESUME_SID)}  ${dim("(skipping deterministic generator)")}`);
} else {
  headerLines.push(`${dim("org")}       ${bold(ORG)}`);
  headerLines.push(`${dim("forms")}     ${path.basename(FORMS_PATH)}`);
  headerLines.push(`${dim("modelling")} ${MODELLING_PATH ? path.basename(MODELLING_PATH) : dim("(none)")}`);
}
box(headerLines);

console.log("");
let sess;
if (RESUME_SID) {
  console.log(dim("⠋ attaching to existing session…"));
  try {
    sess = await attachSession(RESUME_SID);
  } catch (e) {
    console.error(red("  ✗ " + e.message));
    process.exit(2);
  }
  if (sess.meta?.org) ORG = sess.meta.org;
} else {
  console.log(dim("⠋ uploading SRS + running deterministic generator…"));
  sess = await createSession();
}
const sid = sess.sessionId;

// Fetch the just-built bundle stats so the user sees what was produced.
let bundleStats = null;
try {
  // /v1/sessions/:id/files/concepts.json returns the file body; we count entries
  const ssn = await getJson(`/v1/sessions/${sid}`);
  bundleStats = ssn;
} catch {}

console.log(green(`✓`) + " session " + cyan(sid) + "  " + dim(sess.resumed ? `(resumed at turn ${sess.meta?.currentTurn ?? "?"})` : "(turn 0 committed)"));

// Fetch a sample of bundle counts via the file endpoint
async function countFile(rel) {
  try {
    const r = await fetch(`${BASE}/v1/sessions/${sid}/files/${encodeURI(rel)}`);
    if (!r.ok) return null;
    const text = await r.text();
    const j = JSON.parse(text);
    return Array.isArray(j) ? j.length : Object.keys(j).length;
  } catch { return null; }
}
const [nConcepts, nSubj, nProg, nEnc, nFm] = await Promise.all([
  countFile("concepts.json"),
  countFile("subjectTypes.json"),
  countFile("programs.json"),
  countFile("encounterTypes.json"),
  countFile("formMappings.json"),
]);
const filesList = bundleStats?.files || [];
const nForms = filesList.filter((f) => f.startsWith("forms/")).length;

const v = sess.validation;
const validIcon = v?.valid ? green("✓ valid") : red("✗ " + v?.errors + " errors");
const warnTag = v?.warnings ? dim(" · " + v.warnings + " warnings") : "";

const headerTurn = sess.resumed ? (sess.meta?.currentTurn ?? 0) : 0;
const headerTag = sess.resumed ? "resumed" : "deterministic first-pass";
box([
  dim("bundle  ") + bold(`turn ${headerTurn}`) + dim(" · " + headerTag),
  "",
  `${dim("concepts")}        ${cyan(String(nConcepts ?? "?"))}`,
  `${dim("forms")}           ${cyan(String(nForms))}`,
  `${dim("subjectTypes")}    ${cyan(String(nSubj ?? "?"))}`,
  `${dim("programs")}        ${cyan(String(nProg ?? "?"))}`,
  `${dim("encounterTypes")}  ${cyan(String(nEnc ?? "?"))}`,
  `${dim("formMappings")}    ${cyan(String(nFm ?? "?"))}`,
  "",
  `${dim("validator")}       ${validIcon}${warnTag}`,
], { indent: 2 });

priorValidationGroups = { ...(v?.groups || {}) };
console.log("");
console.log(dim("Type your prompt below. ") + cyan(":help") + dim(" for commands · ") + cyan(":model sonnet") + dim(" before structural fixes.\n"));

// Use readline as an async iterator so each command's awaits complete fully
// before the next line is read. This makes piped/scripted runs work the same
// as interactive use.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: cyan("you ›") + " ",
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
      case "rules": await cmdRules(sid); break;
      case "rulev": case "rules-validate": await cmdRuleValidate(sid); break;
      case "summary": await cmdSummary(sid); break;
      case "eval": case "evaluate": await cmdEval(sid); break;
      case "refs": case "references": await cmdRefs(sid, rest.join(" ")); break;
      case "rename": await cmdRename(sid, rest); break;
      case "add-form": case "addform": await cmdAddForm(sid, rest); break;
      case "model": cmdModel(arg1); break;
      case "revert": await cmdRevert(sid, arg1); break;
      case "zip": await cmdZip(sid, arg1); break;
      case "state": await cmdState(sid); break;
      case "transcript": case "tx": await cmdTranscript(sid, arg1); break;
      case "steps": case "log": await cmdSteps(sid, arg1); break;
      case "cost": case "wallet": await cmdCost(sid); break;
      case "quit": case "q": case "exit": return "quit";
      default: console.log(red(`unknown command: :${cmd}  (try :help)`));
    }
  } else {
    // The user's prompt line was already echoed by readline; render a
    // visible separator and the "thinking" placeholder, then stream.
    rule(cyan("agent · " + MODEL.replace(/^claude-/, "").split("-").slice(0,3).join("-")), dim);
    console.log(dim("  ⠋ thinking…"));
    await sendMessage(sid, input);
    rule("", dim);
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
