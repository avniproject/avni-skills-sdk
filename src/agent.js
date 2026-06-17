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
import { createBundleMcpServer, BUNDLE_TOOL_NAMES } from "./agents/bundle-mcp-server.js";

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

// Hard rules — agents that produce bundles MUST follow these. Distilled from
// real failure modes observed against multi-org SRS runs:
//   • agents inventing UUIDs that aren't v4-shaped, then references break
//   • agents adding a form-element with a concept UUID that's never added
//     to concepts.json (F5 errors)
//   • agents inventing AVNI enum values like "CreateEncounter" instead of
//     consulting the canonical PrivilegeType list (G2 errors)
//   • agents creating a duplicate "Other" concept rather than reusing the
//     existing one (C3/D1 errors)
// Embedded into both DEFAULT_SYSTEM_PROMPT (for /v1/agent/query) and the
// session-messages system prompt (for /v1/sessions/:id/messages).
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

// SLIM OUTCOME CONTRACT — opt-in alternative to BUNDLE_HARD_RULES.
//
// Gated behind SDK_DISCOVERY_PROMPT=1 so it changes NOTHING by default (env
// unset → the full hard rules above are used, byte-for-byte unchanged). Story
// #11 makes the slim contract the DEFAULT; until then it exists ONLY so the
// observe-only discovery harness (tests/discovery/) can measure how a model
// reaches for tools when it is given OUTCOMES instead of procedures.
//
// It states the end-state the bundle must reach + the two server-only
// invariants, and points at the avni-bundle-spec skill for the "how". It does
// NOT enumerate procedures. ~210 words (vs the ~1,181-word hard rules).
export const BUNDLE_OUTCOME_CONTRACT = `OUTCOME CONTRACT — what a correct bundle must achieve. Consult the avni-bundle-spec skill for HOW; this contract states only the required end-state.

The bundle you produce or edit MUST satisfy ALL of these, or the AVNI server rejects the whole upload:

1. Zero errors from \`mcp__avni-bundle__bundle_integrity_check\` AND zero errors from the validator (\`mcp__avni-bundle__bundle_validator_run\` / validator.js). A clean validator alone does NOT guarantee a clean upload — always run the integrity check before you finish.

2. Every \`formElement.concept\` is a NESTED OBJECT ({ name, uuid, dataType, ... }), never a bare UUID string. The server's Jackson deserializer crashes on a flattened concept and the validator does not catch it.

3. Every \`addressLevelType\` name is non-empty and contains none of the characters \`< > = " '\`. The server's LocationService rejects these and the validator does not catch it.

4. Every UUID you reference resolves to an entity that exists in the same bundle, in the same turn. No dangling references. No invented UUIDs (v4-shaped only) and no invented enum values.

HOW to satisfy these — entity shapes, the closed enum sets, the FK matrix, the review checklist — lives in the avni-bundle-spec skill. Consult it before authoring or editing. Answer the user's explicit request only; do not do opportunistic cleanup in the same turn.`;

// Opt-in: SDK_DISCOVERY_PROMPT=1 swaps the full hard rules for the slim
// outcome contract. DEFAULT (env unset) is the full hard rules — the discovery
// flag exists ONLY for the observe-only discovery harness to measure tool-reach
// under the slim prompt. Story #11 flips slim to the default.
export function discoveryPromptEnabled() {
  const v = process.env.SDK_DISCOVERY_PROMPT;
  return v === "1" || v === "true";
}

// The rules block injected into the system prompt: hard rules by default, the
// slim outcome contract when SDK_DISCOVERY_PROMPT is set. Evaluated per-call so
// a test (or a single discovery scenario) can toggle the env without a reload.
export function activeRulesBlock() {
  return discoveryPromptEnabled() ? BUNDLE_OUTCOME_CONTRACT : BUNDLE_HARD_RULES;
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

// Back-compat constant — the full default prompt with the hard rules. Existing
// callers that import DEFAULT_SYSTEM_PROMPT keep the unchanged (hard-rules)
// behaviour. The discovery flag is honoured by callers that build the prompt
// via buildDefaultSystemPrompt() (the runAgent default below does).
const DEFAULT_SYSTEM_PROMPT = `You are the Avni bundle authoring agent.

Your job: take an Avni implementation problem (typically: "convert this SRS to a bundle and refine it"), use the skills available in this workspace to solve it, and explain what you did.

The skills in this workspace are the canonical AVNI knowledge base, exposed at .claude/skills/<name>/SKILL.md. Always consult the relevant SKILL.md before writing code, generating bundles, or applying edits.

Workflow:
1. Identify which skill(s) apply (read SKILL.md files via the Skill tool, or directly)
2. Use Read / Glob / Bash / Edit / Write tools as needed
3. For SRS → bundle: the deterministic generator script is at the avni-skills root the skills point to
4. For mechanical fixes: apply via Edit/Write
5. For semantic decisions: explain the choice and apply

Be concise. Cite skill files when consulting them.

${BUNDLE_HARD_RULES}`;

/**
 * Run a one-shot agent query and yield events.
 *
 * @param {Object} opts
 * @param {string} opts.prompt
 * @param {string} opts.apiKey — Anthropic API key
 * @param {string} [opts.model] — default claude-haiku-4-5-20251001
 * @param {string} [opts.workspace] — override cwd (default: staged avni-skills workspace)
 * @param {string} [opts.systemPrompt]
 * @param {string[]} [opts.allowedTools]
 * @param {string} [opts.permissionMode]
 * @param {string} [opts.skillScope] — "bundle-authoring" (curated 7) | "all" (default = all)
 * @param {AbortController} [opts.abortController]
 * @param {string} [opts.resume] — SDK session id to resume; when set, the SDK rehydrates the prior transcript server-side and the new prompt is appended as the next turn. Caller is responsible for capturing this from the `system/init` event on turn 1.
 * @returns {AsyncIterable}
 */
export async function* runAgent(opts) {
  const {
    prompt,
    apiKey,
    model = "claude-haiku-4-5-20251001",
    workspace,
    // Built per-call so SDK_DISCOVERY_PROMPT=1 (opt-in) swaps in the slim
    // outcome contract; env unset → the full hard rules, unchanged.
    systemPrompt = buildDefaultSystemPrompt(),
    allowedTools,
    permissionMode = "bypassPermissions",
    skillScope = "all",
    abortController,
    resume,
  } = opts;

  if (!apiKey) throw new Error("apiKey is required (provide via Authorization header)");
  if (!prompt) throw new Error("prompt is required");

  const cwd = workspace || ensureAgentWorkspace();
  // Default allowedTools depend on whether a real bundle workspace is in
  // play. Bundle MCP tools are only registered when `workspace` is passed
  // (see mcpServers below), so don't advertise them when they're absent —
  // the agent would try to call them and get a "tool not found" error.
  const effectiveAllowedTools = allowedTools ?? (workspace
    ? ["Read", "Glob", "Grep", "Bash", "Edit", "Write", "Skill", ...BUNDLE_TOOL_NAMES]
    : ["Read", "Glob", "Grep", "Bash", "Edit", "Write", "Skill"]);
  const skillNames = (
    skillScope === "bundle-authoring"
      ? listBundleAuthoringSkills()
      : listSkills()
  ).map((s) => s.slug);

  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = apiKey;

  try {
    const queryOptions = {
      cwd,
      model,
      systemPrompt,
      allowedTools: effectiveAllowedTools,
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
    if (abortController) queryOptions.abortController = abortController;
    // Native SDK session continuation — the SDK rehydrates the prior
    // transcript (incl. tool_use/tool_result pairing) and the new prompt is
    // appended as the next turn. cwd MUST be identical to turn 1 or the SDK
    // silently starts a fresh session.
    if (resume) queryOptions.resume = resume;

    const result = query({ prompt, options: queryOptions });
    for await (const event of result) yield event;
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
}
