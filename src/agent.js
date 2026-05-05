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
import { listSkills } from "./skills.js";

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

5. NAME UNIQUENESS: before adding a concept named "X", search concepts.json for an existing concept with that name. If one exists, REUSE its UUID instead of creating a duplicate. Concept names must be globally unique across the bundle (the validator's C3/D1 check).

6. If you can't satisfy a constraint, STOP and explain what's missing. Do not paper over with placeholder UUIDs or guessed enum values.`;

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
 * @param {AbortController} [opts.abortController]
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
    abortController,
  } = opts;

  if (!apiKey) throw new Error("apiKey is required (provide via Authorization header)");
  if (!prompt) throw new Error("prompt is required");

  const cwd = workspace || ensureAgentWorkspace();
  const skillNames = listSkills().map((s) => s.slug);

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

    const result = query({ prompt, options: queryOptions });
    for await (const event of result) yield event;
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
}
