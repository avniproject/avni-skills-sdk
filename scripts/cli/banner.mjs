// banner.mjs — top-of-session UI: the header box (server / model / skills /
// org), the post-create bundle-stats box (entity counts + validator state),
// and the context-aware next-step suggestions block printed before the prompt.

import path from "node:path";
import { bold, box, cyan, dim, green, magenta, red, yellow } from "./ui.mjs";

export async function renderHeader({
  BASE,
  MODEL,
  RESUME_SID,
  ORG,
  FORMS_PATH,
  MODELLING_PATH,
  MODE = "baseline",
}) {
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
    headerLines.push(`${dim("mode")}      ${MODE === "agent"
      ? magenta("agent") + dim(" (agent reads every SRS sheet, then bootstraps a baseline)")
      : cyan("baseline") + dim(" (deterministic generator at turn 0)")}`);
    headerLines.push(`${dim("forms")}     ${path.basename(FORMS_PATH)}`);
    headerLines.push(`${dim("modelling")} ${MODELLING_PATH ? path.basename(MODELLING_PATH) : dim("(none)")}`);
  }
  box(headerLines);
}

// Renders the post-session bundle-stats box (entity counts + validator).
// Returns the validation object so caller can seed priorValidationGroups.
export async function renderBundleStats({ BASE, sess, getJson }) {
  const sid = sess.sessionId;
  let bundleStats = null;
  try {
    const ssn = await getJson(`/v1/sessions/${sid}`);
    bundleStats = ssn;
  } catch {}

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
  // An agent-mode turn 0 is an EMPTY workspace, not a validated bundle. Reporting
  // it as "✗ 0 errors" reads as a broken bundle and "✓ valid" would be a false
  // clean claim — both mislead on the very first screen. Say what it actually is.
  const validIcon = v?.emptyWorkspace
    ? yellow("— empty workspace (nothing generated yet)")
    : v?.valid ? green("✓ valid") : red("✗ " + v?.errors + " errors");
  const warnTag = (!v?.emptyWorkspace && v?.warnings) ? dim(" · " + v.warnings + " warnings") : "";

  const headerTurn = sess.resumed ? (sess.meta?.currentTurn ?? 0) : 0;
  const headerTag = sess.resumed
    ? "resumed"
    : (v?.emptyWorkspace ? "empty workspace" : "deterministic first-pass");
  // Session mode (story #12): baseline (generator at turn 0) | agent (author from SRS).
  // Absent on pre-#12 sessions → baseline. Surfaced so the operator knows which
  // pipeline this session runs.
  const sessionMode = bundleStats?.mode || sess.meta?.mode || "baseline";
  const modeTag = sessionMode === "agent"
    ? magenta("agent") + dim(" · author from SRS in input/")
    : cyan("baseline") + dim(" · deterministic generator at turn 0");
  box([
    dim("bundle  ") + bold(`turn ${headerTurn}`) + dim(" · " + headerTag),
    `${dim("mode")}            ${modeTag}`,
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

  return v;
}

// ── Context-aware next-step suggestions ───────────────────────────
// Reads the validator state + recent transcript (for resumed sessions) and
// surfaces the most useful next command. Beats a static "type your prompt
// below" line because the user actually sees what to do next.
export function renderSuggestions(sessMeta, validation, isResumed, uncommitted = []) {
  const groups = validation?.groups || {};
  const errs = validation?.errors || 0;
  const lines = [];

  // Work stranded by a turn that never committed. This OUTRANKS every other
  // suggestion: the numbers above it describe the last COMMITTED turn, so while
  // this is unresolved the whole banner is describing a bundle that isn't the one
  // on disk. A killed mid-edit turn can leave the tree worse than it started
  // (entity deleted, references not yet repointed), so say so before anything else.
  if (uncommitted.length) {
    const shown = uncommitted.slice(0, 8);
    lines.push(red(`⚠ ${uncommitted.length} uncommitted file${uncommitted.length === 1 ? "" : "s"} from a turn that never finished`));
    lines.push(dim("  ") + shown.join(dim(", ")) + (uncommitted.length > shown.length ? dim(` … +${uncommitted.length - shown.length} more`) : ""));
    lines.push(dim("  The counts above are from the last COMMITTED turn — they do not describe these files."));
    lines.push(dim("  Inspect with ") + cyan(":changes") + dim(", then either finish the edit and let the next turn commit it,"));
    lines.push(dim("  or discard it: ") + cyan(":revert " + (sessMeta?.currentTurn ?? 0)));
    lines.push("");
  }

  if (isResumed) {
    lines.push(dim("welcome back. ") + cyan(":transcript") + dim(" to see prior conversation · ") +
               cyan(":cost") + dim(" to see spend so far"));
  }

  if (validation?.emptyWorkspace && uncommitted.length) {
    // emptyWorkspace describes the last COMMITTED turn. With stranded files on
    // disk the workspace plainly isn't empty, so saying so would contradict the
    // warning directly above. The recovery hint there is the actionable one.
    lines.push(dim("The last committed turn was an empty workspace — the files above came after it."));
  } else if (validation?.emptyWorkspace) {
    // Agent mode, turn 0. Zero validator errors here means "nothing to validate",
    // NOT "clean" — suggesting a clean-bundle next step would be a false signal.
    lines.push(dim("agent mode: the bundle is ") + yellow("empty") +
               dim(" and the SRS is attached under input/. Try:"));
    lines.push("  " + cyan("free-text") + dim(" → \"index every sheet in the forms and modelling workbooks, then bootstrap a baseline\""));
    lines.push("  " + cyan("free-text") + dim(" → \"reconcile the baseline against the sheets the generator skips\""));
  } else if (errs === 0) {
    lines.push(dim("validator is clean. Try:"));
    lines.push("  " + cyan("free-text") + dim(" → \"add a Volunteer subject type with a registration form\""));
    lines.push("  " + cyan(":summary") + dim(" → deterministic bundle audit (free)"));
  } else {
    // Validator has errors — suggest concrete fixes per error class.
    lines.push(dim("validator found ") + red(`${errs} error${errs === 1 ? "" : "s"}`) +
               dim(" across: ") + Object.keys(groups).map((k) => yellow(`${k}:${groups[k]}`)).join(" "));
    lines.push(dim("try:"));
    if (groups.F2) lines.push("  " + cyan("free-text") + dim(" → \"fix the F2 cross-group concept reuse errors\""));
    if (groups.F5) lines.push("  " + cyan(":refs <uuid>") + dim(" → trace any dangling concept references"));
    if (groups.C3 || groups.D1) lines.push("  " + cyan("free-text") + dim(" → \"merge the duplicate concept names\""));
    if (groups.M1 || groups.M2) lines.push("  " + cyan("free-text") + dim(" → \"fix the formMapping references\""));
    lines.push("  " + cyan(":summary") + dim(" + ") + cyan(":eval") + dim(" → audit before editing"));
  }

  lines.push("");
  lines.push(dim("anytime: ") + cyan(":help") + dim(" · ") + cyan(":model sonnet") +
             dim(" (structural fixes) · ") + cyan(":cost") + dim(" · ") +
             cyan(":diag") + dim(" (multi-agent failures) · ") + cyan(":quit"));

  for (const ln of lines) console.log(ln);
}
