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
   BEFORE adding any new concept to concepts.json, you MUST run this exact Bash command and read its output:
     \`AVNI_FIND_CONCEPT="<name to add>"; node /Users/samanvay/Developer/avni-skills-sdk/scripts/agent-tools/find-concept.mjs "$AVNI_FIND_CONCEPT"\`
   The CLI does a case-insensitive scan of concepts.json in cwd and returns JSON with a "guidance" field. Read the guidance and act on it literally:
     • If guidance says "EXACT MATCH. REUSE UUID..." → DO NOT add a new concept. Use that UUID in your edit instead.
     • If guidance says "Multiple case-insensitive matches" → pick the first match's UUID and reuse, OR ask the user.
     • Only if guidance says "SAFE to add a new concept" → proceed to add it.
   The C3/D1 validator treats concept names case-insensitively ("Other" and "other" collide). This gate exists because a real agent run "fixed" a C5 error by adding a lowercase "other" while "Other" already existed, introducing a C3 regression. The CLI prevents that mistake mechanically. SKIPPING THIS STEP IS A HARD-RULE VIOLATION.

7. HONESTY ON FIXES — when your prompt is to fix a validator error or known issue:
   a) BEFORE editing: Read the validation state (the user's prompt will usually quote the error code class — F2, C3, C5, etc.).
   b) Apply the edit.
   c) The server reports the validator delta in the turn event automatically. You will NOT see it during your turn. So commit to an EXPLICIT prediction in your reply. Example: "I removed the duplicate Gender field. Expected validator delta: F2 errors drop by 1." NEVER say "Fixed ✅" or "Done!" without naming what should change.
   d) If the user reports "you introduced a regression / errors went up / new error code appeared": this is a FACT, not a debate. The validator output is authoritative. Trust it over your own analysis, investigate, and fix immediately.
   e) When making a structural fix where multiple resolutions are possible (add new vs. reuse existing, rename vs. delete), STATE the choice you made AND the alternative you didn't pick, in one sentence. So the user can spot wrong choices before they cascade.

8. FORM-ELEMENT.CONCEPT SHAPE (mandatory). Every \`formElement.concept\` in a forms/*.json file MUST be a NESTED OBJECT with at minimum these keys: \`{ name, uuid, dataType }\` (typically also \`active: true, media: [], answers: [] }\`). It must NEVER be a bare UUID string. AVNI's server-side Jackson deserializer rejects \`"concept": "<uuid>"\` with a \`MismatchedInputException\` and the bundle fails to upload — even though the local validator passes (the local check only verifies UUID resolution, not shape). This trap was first observed when an agent was asked "fix all errors" and "fixed" F2 cross-group reuse by replacing the inline concept with just its UUID — 148 elements broken across 8 forms, server crashed on upload. The recovery workflow is \`scripts/workflows/fix-formelement-concept-shape.mjs\`. The prevention is this rule: NEVER flatten the concept field; if you're editing a formElement, copy the full nested object verbatim.

9. If you can't satisfy a constraint, STOP and explain what's missing. Do not paper over with placeholder UUIDs or guessed enum values.`;

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
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    allowedTools = ["Read", "Glob", "Grep", "Bash", "Edit", "Write", "Skill"],
    permissionMode = "bypassPermissions",
    skillScope = "all",
    abortController,
    resume,
  } = opts;

  if (!apiKey) throw new Error("apiKey is required (provide via Authorization header)");
  if (!prompt) throw new Error("prompt is required");

  const cwd = workspace || ensureAgentWorkspace();
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
      allowedTools,
      permissionMode,
      // Isolate from the host's ~/.claude/* settings so we don't leak the
      // user's personal skills/settings into this session. Empty array =
      // SDK isolation mode.
      settingSources: [],
      // Explicitly enable our skills (filters out anything else the SDK
      // might discover, and turns the Skill tool on).
      skills: skillNames.length ? skillNames : "all",
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
