// Claude Agent SDK wrapper — spawns an agent session with cwd = avni-skills/
// so all skills auto-load. Caller provides their own Anthropic API key
// (BYO key model — anyone with a Claude API key can use this SDK).

import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { avniSkillsPath } from "./skills.js";

const DEFAULT_SYSTEM_PROMPT = `You are the Avni bundle authoring agent.

Your job: take an Avni implementation problem (typically: "convert this SRS to a bundle and refine it"), use the skills available in this directory to solve it, and explain what you did.

The skills in this folder are the canonical AVNI knowledge base. Always consult the relevant SKILL.md before writing code, generating bundles, or applying edits to a workspace.

Workflow:
1. Identify which skill(s) apply (read SKILL.md files)
2. Use Read / Glob / Bash / Edit / Write tools as needed
3. Run the deterministic generator (srs-bundle-generator/scripts/generate_bundle_v2.js) for first-pass bundle generation
4. Use the validator (srs-bundle-generator/validators/bundle_validator) to identify issues
5. For mechanical fixes: apply via Edit/Write
6. For semantic decisions: explain the choice and apply

Be concise. Cite skill files when consulting them.`;

/**
 * Run a one-shot agent query and yield events.
 *
 * @param {Object} opts
 * @param {string} opts.prompt — the user's request / instruction
 * @param {string} opts.apiKey — Anthropic API key (provided by caller)
 * @param {string} [opts.model] — Claude model ID, default = haiku-4-5
 * @param {string} [opts.workspace] — cwd; defaults to avni-skills/ root
 * @param {string} [opts.systemPrompt]
 * @param {string[]} [opts.allowedTools] — defaults to a sensible read+exec set
 * @param {string} [opts.permissionMode] — 'bypassPermissions' for unattended runs
 * @param {AbortSignal} [opts.signal]
 * @returns {AsyncIterable} stream of agent events
 */
export async function* runAgent(opts) {
  const {
    prompt,
    apiKey,
    model = "claude-haiku-4-5-20251001",
    workspace,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    allowedTools = ["Read", "Glob", "Grep", "Bash", "Edit", "Write"],
    permissionMode = "bypassPermissions",
    signal,
  } = opts;

  if (!apiKey) throw new Error("apiKey is required (provide via Authorization header)");
  if (!prompt) throw new Error("prompt is required");

  const cwd = workspace || avniSkillsPath();

  // The SDK reads ANTHROPIC_API_KEY from env; we set it for this call only.
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = apiKey;

  try {
    const result = query({
      prompt,
      options: {
        cwd,
        model,
        systemPrompt,
        allowedTools,
        permissionMode,
        ...(signal ? { abortController: { signal } } : {}),
      },
    });
    for await (const event of result) {
      yield event;
    }
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
}
