// Claude Agent SDK wrapper — spawns an agent session with cwd pointed at a
// staged workspace where avni-skills's 16 skills are exposed at the path
// the SDK auto-discovery expects ($cwd/.claude/skills/<name>/SKILL.md).
//
// Also disables filesystem-level settings (settingSources: []) so the agent
// runs in isolation from the host's ~/.claude/skills/ — only avni-skills's
// 16 are visible.
//
// Caller provides their own Anthropic API key (BYO key model).

import { query } from "@anthropic-ai/claude-agent-sdk";
import { ensureAgentWorkspace } from "./workspace.js";
import { listSkills, listBundleAuthoringSkills } from "./skills.js";
import { createBundleMcpServer } from "./agents/bundle-mcp-server.js";
import { BUNDLE_TOOL_NAME } from "./agents/bundle-mcp-tool-names.js";
import { toolTiersFor, loadMatrix } from "./model-matrix.js";

// Bash commands the agent is forbidden from running. The server is the sole
// committer (it runs `git add -A && git commit` after each turn ends), so
// any agent-initiated git write corrupts the turn counter and orphans audit
// rows. We also block destructive shell. Read-only git stays allowed.
//
// Regex deliberately liberal — we'd rather block too much (false positive
// surfaces a clear deny message the agent can react to) than too little
// (silent contract violation, as in bug B2 / sess_7b4a7ad42b244487).
//
// IMPORTANT: this is a LEX-LEVEL filter; it cannot be made bulletproof
// against an adversary that knows shell. Bypass vectors observed in
// adversarial tests: `eval "git commit"`, `bash -c "git commit"`,
// backtick `\`git ...\``, `$(git ...)`, hex-encoded args. The patterns
// below catch the obvious bypass attempts, but the REAL defense is the
// post-turn git-scope detector in src/security/post-turn-detector.js,
// which runs after the SDK stream ends and reverts any commit not
// authored by the server's identity. Treat this regex set as a first
// line of defense, NOT a complete one.
const FORBIDDEN_BASH_PATTERNS = [
  // Git write commands (any subcommand that mutates the repo)
  /(^|[\s;&|])git\s+(commit|push|reset|checkout\s+[^-]|rm|restore|stash|merge|rebase|cherry-pick|tag|clean|gc)\b/,
  // Destructive filesystem ops, both short flags and long flags.
  // Catches `rm -rf`, `rm --recursive --force`, `rm -r --force`, etc.
  /(^|[\s;&|])rm\s+(-[rR]f|-fr|-rf|(-[rR]\s+(--force|-f\b))|(--force\s+(-[rR]\b|--recursive))|(--recursive\s+(--force|-f\b))|(--recursive\b.*--force)|(--force\b.*--recursive))/,
  // --no-preserve-root is a hard red flag with rm regardless of other flags
  /(^|[\s;&|])rm\b[^|;&]*--no-preserve-root\b/,
  // Privilege escalation has no place inside the agent loop
  /(^|[\s;&|])sudo\b/,
  // Shell re-entry — these are the obvious bypass vectors for the git/rm
  // filters above. The agent has no legitimate reason to invoke another
  // shell from within Bash. Blocks `bash -c "..."`, `sh -c`, `zsh -c`,
  // and `eval`.
  /(^|[\s;&|])(bash|sh|zsh|ksh|dash)\s+-c\b/,
  /(^|[\s;&|])eval\b/,
  // Command substitution containing git — `\`git commit ...\`` and
  // `$(git commit ...)`. We're permissive: any backtick/`$(`-wrapped git
  // (read-only or not) gets blocked because the wrapping itself signals
  // an attempt to evade the top-level git regex.
  /`[^`]*\bgit\b/,
  /\$\(\s*git\b/,
];

function checkForbiddenBash(command) {
  if (typeof command !== "string" || !command.trim()) return null;
  for (const pat of FORBIDDEN_BASH_PATTERNS) {
    if (pat.test(command)) {
      return {
        pattern: pat.source,
        reason: `BLOCKED: this Bash command matches a forbidden pattern (${pat.source}). The server is the sole committer — it runs \`git add -A && git commit\` after your turn ends. Read-only git (status/log/diff/show) is fine. If you tried to "clean up" file formatting outside of the user's request, stop — see BUNDLE_HARD_RULES #10.`,
      };
    }
  }
  return null;
}

// Hard rules — LEGACY prose ruleset, retired as the default in story #11.
//
// As of #11 these are NO LONGER the default agent rules. The slim
// BUNDLE_OUTCOME_CONTRACT below is the active block; this 1,181-word prose
// is kept ONLY behind the SDK_LEGACY_RULES=1 backout flag (Himesh-style
// reversible escape hatch — the prose equivalent of keeping default.realm.bak).
// It is safe to demote because every invariant these rules described is now
// enforced by a deterministic GATE, not by prose the model may ignore:
//   • formElement.concept shape + addressLevelType name chars → bundle_integrity_check
//       (FE_CONCEPT_NOT_OBJECT + ALT_INVALID_NAME)
//   • dangling UUID refs / FK coherence → the yaml-driven bundle graph + validator
//   • C3/D1 concept-name collisions → the concept-collision interceptor
//   • no agent-initiated git writes → PreToolUse bash hook + post-turn detector
//   • out-of-scope mutations → post-turn detector + path-jail
// See CLAUDE.md §8 (code-enforced rules vs prompt rules) for the full matrix.
//
// Distilled from real failure modes observed against multi-org SRS runs:
//   • agents inventing UUIDs that aren't v4-shaped, then references break
//   • agents adding a form-element with a concept UUID that's never added
//     to concepts.json (F5 errors)
//   • agents inventing AVNI enum values like "CreateEncounter" instead of
//     consulting the canonical PrivilegeType list (G2 errors)
//   • agents creating a duplicate "Other" concept rather than reusing the
//     existing one (C3/D1 errors)
//
// ENFORCEMENT MATRIX — read before trusting any rule below at face value.
// Rules 1–9 are GUIDANCE: the model is asked to follow them, but nothing
// stops the model from violating them mid-turn. They will produce validator
// errors and the user will see them downstream.
//
// Rules 10–12 (added in the audit) are ENFORCED by server-side code; the
// model cannot circumvent them even if it ignores the prompt text:
//   • Rule #10 (no opportunistic hygiene work)  → still soft (prompt-only).
//   • Rule #11 (no agent-initiated git writes)  → LEX enforcement via
//       FORBIDDEN_BASH_PATTERNS + PreToolUse hook in THIS file (above);
//       POST-HOC enforcement via detectUnauthorizedMutations() in
//       src/security/post-turn-detector.js (caller wires it into
//       src/routes/sessions-messages.js before commitWorkspaceChanges).
//   • Rule #12 (validator state is authoritative) → ENFORCED by server-side
//       state injection at the top of every turn in
//       src/routes/sessions-messages.js (the "CURRENT VALIDATOR STATE"
//       block is appended programmatically, not relying on the agent to
//       fetch it).
// Future-proofing note: if you add a new rule, mark it [GUIDANCE] or
// [ENFORCED → <file>] in this matrix. Don't let prompt-only rules drift
// into being treated as guarantees.
export const BUNDLE_HARD_RULES = `HARD RULES — do NOT violate any of these. They map to real validator errors that block server upload.

1. NEVER invent UUIDs. Every UUID you introduce must be v4-shaped: 8-4-4-4-12 lowercase hex. Use \`crypto.randomUUID()\` in Node, or copy an existing UUID from the bundle if you're referencing one. NO short tokens like "c-cancel-reason-001" or "ans-other".

2. ATOMICITY: when you reference a concept UUID anywhere — in a form's formElement.concept, in a Coded answer, in a formMapping — that concept MUST exist in concepts.json with the matching UUID. Add the concept and the reference in the SAME turn. Never leave a dangling reference.

3. CODED ANSWERS: every \`answer\` inside a Coded concept must ALSO exist as a standalone concept in concepts.json (typically dataType="NA"). Same UUID-match rule.

4. NEVER invent enum values. The canonical sets:
   • PrivilegeType (groupPrivilege.privilegeType): ViewSubject, RegisterSubject, VoidSubject, EditSubject, EnrolSubject, UnVoidSubject, ExitEnrolment, VoidEnrolment, UnVoidEnrolment, ViewVisit, PerformVisit, EditVisit, CancelVisit, ScheduleVisit, VoidVisit, UnVoidVisit, ViewChecklist, EditChecklist
   • Concept dataType: Numeric, Text, Notes, Coded, NA, Date, DateTime, Time, Duration, Image, ImageV2, Id, Video, Subject, Location, PhoneNumber, GroupAffiliation, Audio, File, QuestionGroup, Encounter
   • For ANYTHING else (formType, subjectType.type, etc.) read .claude/skills/backend-architecture/ or .claude/skills/product-codebase/ first. DO NOT guess.

5. NAME UNIQUENESS + UPSERT (concepts AND every top-level entity):
   When the user asks you to "add X" — a concept, a subject type, a program, an encounter type, a form — DO NOT blindly append. The flow is always: Read the target file → case-insensitive name lookup → if it exists, REUSE the UUID and update fields in place (upsert) → if it doesn't, append a new entry that matches the existing-entry shape verbatim (copy field names + defaults from a neighbour, don't invent). Then Edit/Write back. The server does the git diff + commit. You do not need a special command for this — Read + Edit is the path.

   • concepts.json: validator C3/D1 checks this case-insensitively. See rule #6 below for the mandatory CLI gate.
   • subjectTypes.json / programs.json / encounterTypes.json: same upsert pattern. Match by name (case-insensitive trim). Mirror existing entries' shape — never invent fields the generator doesn't emit.
   • formMappings.json: when you add a new top-level entity that needs a registration/visit form, also append the matching mapping in the SAME turn (atomicity, rule #2).

6. CONCEPT-LOOKUP GATE (mandatory pre-edit step, NOT optional).
   BEFORE adding any new concept to concepts.json, you MUST call the MCP tool:
     \`bundle_find_concept({ name: "<name to add>" })\`
   (registered as \`mcp__avni-bundle__bundle_find_concept\` — exposed by the in-process avni-bundle MCP server; no Bash shell-out, no absolute paths.) The tool does a case-insensitive scan of concepts.json in the bundle cwd and returns JSON with a "guidance" field. Read the guidance and act on it literally:
     • If guidance says "EXACT MATCH. REUSE UUID..." → DO NOT add a new concept. Use that UUID in your edit instead.
     • If guidance says "Multiple case-insensitive matches" → pick the first match's UUID and reuse, OR ask the user.
     • Only if guidance says "SAFE to add a new concept" → proceed to add it.
   The C3/D1 validator treats concept names case-insensitively ("Other" and "other" collide). This gate exists because a real agent run "fixed" a C5 error by adding a lowercase "other" while "Other" already existed, introducing a C3 regression. The MCP tool prevents that mistake mechanically. SKIPPING THIS STEP IS A HARD-RULE VIOLATION. (Legacy CLI \`scripts/agent-tools/find-concept.mjs\` may still exist as a fallback for non-agent use, but the agent loop must use the MCP tool.)

7. HONESTY ON FIXES — when your prompt is to fix a validator error or known issue:
   a) BEFORE editing: Read the validation state (the user's prompt will usually quote the error code class — F2, C3, C5, etc.).
   b) Apply the edit.
   c) The server reports the validator delta in the turn event automatically. You will NOT see it during your turn. So commit to an EXPLICIT prediction in your reply. Example: "I removed the duplicate Gender field. Expected validator delta: F2 errors drop by 1." NEVER say "Fixed ✅" or "Done!" without naming what should change.
   d) If the user reports "you introduced a regression / errors went up / new error code appeared": this is a FACT, not a debate. The validator output is authoritative. Trust it over your own analysis, investigate, and fix immediately.
   e) When making a structural fix where multiple resolutions are possible (add new vs. reuse existing, rename vs. delete), STATE the choice you made AND the alternative you didn't pick, in one sentence. So the user can spot wrong choices before they cascade.

8. FORM-ELEMENT.CONCEPT SHAPE (mandatory). Every \`formElement.concept\` in a forms/*.json file MUST be a NESTED OBJECT with at minimum these keys: \`{ name, uuid, dataType }\` (typically also \`active: true, media: [], answers: [] }\`). It must NEVER be a bare UUID string. AVNI's server-side Jackson deserializer rejects \`"concept": "<uuid>"\` with a \`MismatchedInputException\` and the bundle fails to upload — even though the local validator passes (the local check only verifies UUID resolution, not shape). This trap was first observed when an agent was asked "fix all errors" and "fixed" F2 cross-group reuse by replacing the inline concept with just its UUID — 148 elements broken across 8 forms, server crashed on upload. The recovery workflow is \`scripts/workflows/fix-formelement-concept-shape.mjs\`. The prevention is this rule: NEVER flatten the concept field; if you're editing a formElement, copy the full nested object verbatim.

9. If you can't satisfy a constraint, STOP and explain what's missing. Do not paper over with placeholder UUIDs or guessed enum values.

10. ANSWER THE USER'S EXPLICIT REQUEST FIRST. Do NOT opportunistically:
   - rename files / strip trailing whitespace / add final newlines / reformat JSON
   - rebuild operational mirrors that already exist
   - "tidy up" unrelated entries you happened to read
   in the same turn as a user-facing fix. Hygiene work is its own turn and only when the user asks. A bundle author asking "fix the C5 error" wants the C5 error fixed — not a 12-file cleanup commit. Audit logs show the agent has done this and burned $0.20+ doing the wrong thing. Stop.

11. NEVER run \`git commit\`, \`git push\`, \`git reset\`, \`git checkout --\`, \`git rm\`, \`git restore\`, or \`git stash\`. The server is the ONLY committer — it runs \`git add -A && git commit\` after your turn ends and labels it \`turn N: <summary>\`. Read-only git commands (\`git status\`, \`git log\`, \`git diff\`, \`git show\`) are fine. Any write-mode git from inside your turn corrupts the turn counter, orphans cost entries, and creates commits the audit log can't account for. The Bash tool will reject these commands at the gate — if you see "BLOCKED: agent-initiated git write", that is by design.

12. CURRENT VALIDATOR STATE is provided to you at the top of every turn. Trust it. If the user asks "what is the error" → quote the items listed verbatim. If the user asks "fix the error" → fix EXACTLY the errors listed; do NOT speculate about other issues you might find. If your prompt does NOT include a "CURRENT VALIDATOR STATE" section, run the validator yourself before answering.`;

// SLIM OUTCOME CONTRACT — the DEFAULT agent rules block as of story #11.
//
// This is now the active rules block injected into every agent system prompt.
// It states the end-state the bundle must reach + the two server-only
// invariants, and points at the avni-bundle-spec skill for the "how". It does
// NOT enumerate procedures. ~250 words (vs the ~1,181-word legacy hard rules).
//
// Backout: set SDK_LEGACY_RULES=1 to restore the full BUNDLE_HARD_RULES prose
// (reversible escape hatch — see activeRulesBlock() below). The slim contract
// is safe as the default because every invariant the prose protected is now
// enforced by a deterministic gate (integrity check, yaml-driven graph,
// concept-collision interceptor, PreToolUse bash hook + post-turn detector),
// not by prose the model may ignore.
export const BUNDLE_OUTCOME_CONTRACT = `OUTCOME CONTRACT — what a correct bundle must achieve. Consult the avni-bundle-spec skill for HOW; this contract states only the required end-state.

The bundle you produce or edit MUST satisfy ALL of these, or the AVNI server rejects the whole upload:

1. Zero errors from \`mcp__avni-bundle__bundle_integrity_check\` AND zero errors from the validator (\`mcp__avni-bundle__bundle_validator_run\` / validator.js). A clean validator alone does NOT guarantee a clean upload — always run the integrity check before you finish.

2. Every \`formElement.concept\` is a NESTED OBJECT ({ name, uuid, dataType, ... }), never a bare UUID string. The server's Jackson deserializer crashes on a flattened concept and the validator does not catch it.

3. Every \`addressLevelType\` name is non-empty and contains none of the characters \`< > = " '\`. The server's LocationService rejects these and the validator does not catch it.

4. Every UUID you reference resolves to an entity that exists in the same bundle, in the same turn. No dangling references. No invented UUIDs (v4-shaped only) and no invented enum values.

5. Concept names are unique CASE-INSENSITIVELY (C3/D1). Before creating a concept, search existing concepts with \`bundle_find_concept\` and reuse a match's UUID — never add a duplicate name under a new UUID.

6. Every Coded concept's answer also exists as a standalone concept in concepts.json with a matching UUID (C5) — an answer is itself a concept, not just a label.

7. NEVER run git or any destructive shell — the server is the sole committer (it runs \`git add -A && git commit\` after your turn). Read-only git (status/log/diff) is fine; you are not the committer.

HOW to satisfy these — entity shapes, the closed enum sets, the FK matrix, the review checklist — lives in the avni-bundle-spec skill. Consult it before authoring or editing. Answer the user's explicit request only; do not do opportunistic cleanup in the same turn.`;

// AGENT-MODE ADDENDUM (story #12) — appended to the active contract ONLY for
// agent-mode sessions (activeRulesBlock({ mode: "agent" })). Baseline mode's
// contract stays BYTE-IDENTICAL (the default no-arg call is unchanged), so the
// slim-prompt / hard-rules pins keep passing. A few lines: it tells the agent the
// agent flow (bundle_read_srs → optional bundle_generate_baseline → refine to
// clean) and that the SAME data-integrity invariants above still hold — agent
// mode adds a starting point, not a lower bar.
export const AGENT_MODE_ADDENDUM = `AGENT MODE — you are building this bundle FROM requirements, not editing an uploaded one. Your cwd may be EMPTY or a bare skeleton; do NOT assume a bundle already exists. Flow:
1. Call \`mcp__avni-bundle__bundle_read_srs\` FIRST to read the session's SRS (the uploaded spreadsheet(s) in ../input/). With no args it lists the sheets; pass { sheet, limit, offset } to page through a sheet's rows (concept sheets can be thousands of rows — paginate, don't dump).
2. OPTIONALLY call \`mcp__avni-bundle__bundle_generate_baseline\` to bootstrap a deterministic baseline (it runs the SRS→bundle generator when XLSX inputs exist, else writes a minimal valid skeleton). You may instead hand-author via spec_apply / Edit.
3. Refine with judgment until BOTH the validator and the integrity check report ZERO errors — honouring EXACTLY the same invariants above (find-before-create concept search, formElement.concept is a nested object, valid addressLevelType names, coded answers exist as standalone concepts, no dangling/invented UUIDs, server is the sole committer). Agent mode gives you a starting point, not a lower bar.`;

// Backout flag (story #11): SDK_LEGACY_RULES=1 restores the full legacy
// BUNDLE_HARD_RULES prose. DEFAULT (env unset) is the slim BUNDLE_OUTCOME_CONTRACT.
// This is the reversible escape hatch Himesh asks for ("where's the backout?") —
// the prose ruleset is demoted, not deleted, so a regression can be diagnosed
// against the old behaviour without a code change.
export function legacyRulesEnabled() {
  const v = process.env.SDK_LEGACY_RULES;
  return v === "1" || v === "true";
}

// Back-compat alias — the discovery harness (tests/discovery/run.cjs) used to
// set SDK_DISCOVERY_PROMPT=1 to opt INTO the slim contract. Slim is now the
// default, so the flag is a no-op for prompt selection; the predicate is kept
// so any caller that still reads it doesn't break. Always reflects "is the slim
// contract active", which is now true unless SDK_LEGACY_RULES is set.
export function discoveryPromptEnabled() {
  return !legacyRulesEnabled();
}

// The rules block injected into the system prompt: the slim outcome contract by
// default, the full legacy hard rules iff SDK_LEGACY_RULES is set. Evaluated
// per-call so a test can toggle the env without a module reload.
//
// `opts.mode === "agent"` (story #12) appends the AGENT_MODE_ADDENDUM. The
// no-arg / baseline-mode call is BYTE-IDENTICAL to before — the guard keeps the
// default contract unchanged (slim-prompt.test.cjs pins activeRulesBlock() ===
// BUNDLE_OUTCOME_CONTRACT).
export function activeRulesBlock(opts = {}) {
  const base = legacyRulesEnabled() ? BUNDLE_HARD_RULES : BUNDLE_OUTCOME_CONTRACT;
  if (opts && opts.mode === "agent") return `${base}\n\n${AGENT_MODE_ADDENDUM}`;
  return base;
}

// Default model for live agent dispatch — the no-evidence FALLBACK floor.
//
// Story #13 (P5) added the evidence-based model-qualification matrix
// (spec/model-qualification.json) + selectModel() in src/model-matrix.js, which
// is now what /v1/sessions/:id/messages calls. DEFAULT_MODEL is no longer the
// primary path — it is the fallback selectModel() returns when the matrix has NO
// evidence for a request's category (so nothing breaks and a weaker model is
// never chosen without evidence). It is pinned to the matrix's `fallbackModel`
// by a test (model-matrix.test.cjs) so the two can't drift.
//
// defaultModel() (SDK_MODEL env override, else DEFAULT_MODEL) is retained for
// back-compat callers; the SDK_MODEL override is also honored (highest priority)
// inside selectModel().
export const DEFAULT_MODEL = "claude-sonnet-4-6";
export function defaultModel() {
  const v = process.env.SDK_MODEL;
  return (typeof v === "string" && v.trim()) ? v.trim() : DEFAULT_MODEL;
}

function buildDefaultSystemPrompt() {
  return `You are the Avni bundle authoring agent.

Your job: take an Avni implementation problem (typically: "convert this SRS to a bundle and refine it"), use the skills available in this workspace to solve it, and explain what you did.

The skills in this workspace are the canonical AVNI knowledge base, exposed at .claude/skills/<name>/SKILL.md. Always consult the relevant SKILL.md before writing code, generating bundles, or applying edits.

Workflow:
1. Identify which skill(s) apply (read SKILL.md files via the Skill tool, or directly)
2. Use Read / Glob / Bash / Edit / Write tools as needed
3. For SRS → bundle: the deterministic generator script is at the avni-skills root the skills point to
4. For mechanical fixes: apply via Edit/Write
5. For semantic decisions: explain the choice and apply

Be concise. Cite skill files when consulting them.

${activeRulesBlock()}`;
}

// ─── FIX 2 — disallowedTools (SSRF / data-exfil surface) ─────────────
//
// Per the SDK docs, `allowedTools` is NOT a restriction — it is the set of tools
// auto-approved WITHOUT a permission prompt ("List of tool names that are
// auto-allowed without prompting for permission"). Under permissionMode
// "bypassPermissions" everything is auto-approved anyway, so an empty/absent
// allowedTools never confined the agent. The ACTUAL restriction is
// `disallowedTools` — "These tools will be removed from the model's context and
// cannot be used, even if they would otherwise be allowed." Everything below is
// blocked at the SDK boundary regardless of prompt drift.
//
// WebFetch / WebSearch have no place in offline bundle authoring and are the
// SSRF / data-exfil surface (an adversarial SRS could induce the agent to POST
// bundle contents to an attacker URL). Task spawns uncontrolled sub-agents;
// NotebookEdit is an unused write path. None are needed to author a bundle.
export const BASELINE_DISALLOWED_TOOLS = Object.freeze([
  "WebFetch", "WebSearch", "Task", "NotebookEdit",
]);

// ─── FIX 4 — real toolTiers (write / structural / export restriction) ──
//
// toolTiers were decorative (nothing read them). These are the tools a
// READ-ONLY-tier model must NOT get: built-in writers plus the structural /
// export MCP tools. A model the matrix marks read-only (not qualified for any
// structural category) is steered away from data-mutating tools at the SDK
// boundary — WITHOUT weakening any deterministic gate (they still run). Full-tier
// models (write/structural/export) are unchanged; UNKNOWN models are left OPEN
// (unknown ≠ weak) so no existing path regresses.
export const WRITE_STRUCTURAL_EXPORT_TOOLS = Object.freeze([
  "Write", "Edit", "NotebookEdit",
  BUNDLE_TOOL_NAME.EXPORT_TO_PATH,     // export tier
  BUNDLE_TOOL_NAME.SPEC_APPLY,         // structural mutation (whole-bundle patch)
  BUNDLE_TOOL_NAME.GENERATE_BASELINE,  // structural mutation (agent baseline)
]);

/**
 * Compute the `disallowedTools` set for a dispatch given the selected model.
 *
 * Always includes BASELINE_DISALLOWED_TOOLS (SSRF/exfil). Additionally, IFF the
 * matrix KNOWS `model` and marks it read-only-tier (no "write" tier), the
 * write/structural/export tools are added — this is toolTiers made real. Unknown
 * models and full-tier models get ONLY the baseline (no regression: unknown ≠
 * weak, and the interim seed keeps every SELECTED model — sonnet/opus — full).
 * `extra` lets a caller add its own restrictions. Never throws.
 *
 * @param {string} model
 * @param {{ extra?: string[], matrix?: object }} [opts]
 * @returns {string[]}
 */
export function disallowedToolsForModel(model, { extra = [], matrix } = {}) {
  const set = new Set([...BASELINE_DISALLOWED_TOOLS, ...(Array.isArray(extra) ? extra : [])]);
  try {
    const m = matrix || loadMatrix();
    const known = !!(m && m.models && m.models[model]);
    if (known) {
      const tiers = toolTiersFor(model, m);
      if (!tiers.includes("write")) {
        for (const t of WRITE_STRUCTURAL_EXPORT_TOOLS) set.add(t);
      }
    }
  } catch {
    // Matrix unavailable → baseline only (fail open, no regression).
  }
  return Array.from(set);
}

/**
 * Build the SDK `query()` options for a dispatch. Extracted from runAgent so the
 * assembled options (disallowedTools, tool tiers, mcpServers, skills) are unit-
 * testable without an LLM call. Pure w.r.t. the API key (that env swap stays in
 * runAgent around the actual query() call).
 */
export function buildQueryOptions(opts = {}) {
  const {
    model = "claude-haiku-4-5-20251001",
    workspace,
    systemPrompt = buildDefaultSystemPrompt(),
    allowedTools,
    disallowedTools,
    permissionMode = "bypassPermissions",
    skillScope = "all",
    resume,
  } = opts;

  const cwd = workspace || ensureAgentWorkspace();
  // A caller MAY still pass an explicit `allowedTools` to auto-approve a narrow
  // set; when omitted we leave it undefined (auto-approve is moot under
  // bypassPermissions). The real confinement is `disallowedTools` below.
  const effectiveAllowedTools = allowedTools;
  // FIX 2 + FIX 4: baseline SSRF/exfil block, plus tier-driven write/structural/
  // export restriction for a known read-only-tier model, plus any caller extras.
  const effectiveDisallowedTools = disallowedToolsForModel(model, { extra: disallowedTools });
  const skillNames = (
    skillScope === "bundle-authoring"
      ? listBundleAuthoringSkills()
      : listSkills()
  ).map((s) => s.slug);

  const queryOptions = {
    cwd,
    model,
    systemPrompt,
    ...(effectiveAllowedTools ? { allowedTools: effectiveAllowedTools } : {}),
    // The ACTUAL restriction (see BASELINE_DISALLOWED_TOOLS / FIX 4). These
    // tools are removed from the model's context regardless of permissionMode.
    disallowedTools: effectiveDisallowedTools,
    permissionMode,
    // Isolate from the host's ~/.claude/* settings so we don't leak the
    // user's personal skills/settings into this session. Empty array =
    // SDK isolation mode.
    settingSources: [],
    // Explicitly enable our skills (filters out anything else the SDK
    // might discover, and turns the Skill tool on).
    skills: skillNames.length ? skillNames : "all",
    // In-process MCP server exposing bundle-specific deterministic tools.
    // Built per-request as a closure capturing `cwd` — required because
    // in-process MCP handlers run in the host process and `process.cwd()`
    // would resolve to the SERVER's startup dir, not the agent's cwd
    // (confirmed via SDK source inspection — see Phase 7 audit notes).
    //
    // Only register the bundle MCP server when a workspace was explicitly
    // passed (i.e. caller is a session-based endpoint with a real bundle
    // dir). Sessionless callers like /v1/agent/query get an empty
    // mcpServers map — the bundle tools have nothing to operate on.
    mcpServers: workspace
      ? { "avni-bundle": createBundleMcpServer(cwd) }
      : {},
    // PreToolUse gate — block forbidden Bash commands (git writes,
    // recursive rm, sudo) BEFORE execution. The server is the sole
    // committer; agent-initiated commits orphan the audit trail. See
    // FORBIDDEN_BASH_PATTERNS above and audit of sess_7b4a7ad42b244487.
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [async (input) => {
          if (input?.hook_event_name !== "PreToolUse" || input?.tool_name !== "Bash") {
            return { continue: true };
          }
          const cmd = input?.tool_input?.command;
          const violation = checkForbiddenBash(cmd);
          if (violation) {
            return {
              decision: "block",
              reason: violation.reason,
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: violation.reason,
              },
            };
          }
          return { continue: true };
        }],
      }],
    },
  };
  if (resume) queryOptions.resume = resume;
  return queryOptions;
}

/**
 * Run a one-shot agent query and yield events.
 *
 * @param {Object} opts
 * @param {string} opts.prompt
 * @param {string} opts.apiKey — Anthropic API key
 * @param {string} [opts.model] — default claude-haiku-4-5-20251001
 * @param {string} [opts.workspace] — override cwd (default: staged avni-skills workspace)
 * @param {string} [opts.systemPrompt]
 * @param {string[]} [opts.allowedTools] — tools auto-approved without a permission prompt (NOT a restriction; see buildQueryOptions)
 * @param {string[]} [opts.disallowedTools] — extra tools to remove from the model's context (merged with the baseline SSRF/exfil block + any tier restriction)
 * @param {string} [opts.permissionMode]
 * @param {string} [opts.skillScope] — "bundle-authoring" (curated 7) | "all" (default = all)
 * @param {AbortController} [opts.abortController]
 * @param {string} [opts.resume] — SDK session id to resume; when set, the SDK rehydrates the prior transcript server-side and the new prompt is appended as the next turn. Caller is responsible for capturing this from the `system/init` event on turn 1.
 * @returns {AsyncIterable}
 */
export async function* runAgent(opts) {
  const { prompt, apiKey, abortController } = opts;

  if (!apiKey) throw new Error("apiKey is required (provide via Authorization header)");
  if (!prompt) throw new Error("prompt is required");

  // Assemble the SDK options (cwd, tool tiers, disallowedTools, mcpServers,
  // skills, hooks) via the extracted, unit-testable builder. See FIX 2 / FIX 4.
  const queryOptions = buildQueryOptions(opts);
  if (abortController) queryOptions.abortController = abortController;

  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = apiKey;

  try {
    const result = query({ prompt, options: queryOptions });
    for await (const event of result) yield event;
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
}
