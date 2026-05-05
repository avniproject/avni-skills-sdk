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

const DEFAULT_SYSTEM_PROMPT = `You are the Avni bundle authoring agent.

Your job: take an Avni implementation problem (typically: "convert this SRS to a bundle and refine it"), use the skills available in this workspace to solve it, and explain what you did.

The skills in this workspace are the canonical AVNI knowledge base, exposed at .claude/skills/<name>/SKILL.md. Always consult the relevant SKILL.md before writing code, generating bundles, or applying edits.

Workflow:
1. Identify which skill(s) apply (read SKILL.md files via the Skill tool, or directly)
2. Use Read / Glob / Bash / Edit / Write tools as needed
3. For SRS → bundle: the deterministic generator script is at the avni-skills root the skills point to
4. For mechanical fixes: apply via Edit/Write
5. For semantic decisions: explain the choice and apply

Be concise. Cite skill files when consulting them.`;

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
