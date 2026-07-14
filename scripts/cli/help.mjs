// help.mjs — :help text. Kept as a function so it picks up the live MODEL
// when called (and so the dim/cyan/bold colours respect TTY at call time).

import { bold, cyan } from "./ui.mjs";

export function buildHelp() {
  return `
${bold("Free text")}     send to the agent (Phase 4 — costs tokens)
${bold(":turns")}         list all turns
${bold(":diff [N]")}      unified diff for turn N (default = current turn)
${bold(":files")}         list files in the bundle
${bold(":read <path>")}   print a file
${bold(":rules")}         list every populated rule (entity, field, bytes)
${bold(":rulev")}         run Layer-4 rules validator (R1-R6) on every rule
${bold(":summary")}       deterministic bundle audit — entity counts, anomalies, rule stats (free)
${bold(":eval")}          LLM semantic-gap audit via /v1/sessions/:id/evaluate (~$0.05-0.20)
${bold(":scrub")} [ai]    run the prose scrub on the live bundle — prunes prose-as-entity strays, prints removals + report.
                ${bold(":scrub ai")} also runs the AI-judged pass (needs ANTHROPIC_API_KEY).
${bold(":refs")} <q>      find every reference to a UUID or name across the bundle. q = UUID or "Name"
${bold(":changes")} [N]      semantic diff for turn N (default = last) — per-file added/updated/removed entries
${bold(":diag")}              multi-agent failure visibility — schema breaks, circuit-breakers,
                validator regressions, integrity issues, ambiguity loops, per-agent durations
${bold(":transcript")} [N]   tail conversation memory (user/assistant/turn events from transcript.jsonl)
${bold(":steps")} [N]        tail operational log (validator runs, agent turns, commits, durations)
${bold(":cost")}              wallet snapshot — total spent / remaining / tokens / cap-percentage
${bold(":model")} [name]  show or change the model for free-text turns. Aliases: haiku | sonnet | opus.
                Default is ${bold("sonnet")} (server-side SDK_MODEL / DEFAULT_MODEL). Override per session here.
${bold(":revert <N>")}    hard-reset to turn N
${bold(":zip [path]")}    download final ZIP (default: <repo>/output-bundle/<org>-<sid>.zip)
${bold(":state")}         re-fetch session metadata
${bold(":session")}       list recent sessions (id, org, age, turn, errors, cost). Aliases: ${bold(":sessions")}, ${bold(":s")}
${bold(":session resume <sess_xxx>")}  hop the live REPL to a different session — Claude-Code-style /resume.
                Alias: ${bold(":resume <sess_xxx>")}. The next free-text prompt and every :command targets the resumed session.
${bold(":session info [sess_xxx]")}    print full meta + cost totals for current (or named) session.
${bold(":help")}          this list
${bold(":quit")} / ${bold(":q")}     exit (session is preserved on disk — resume via ${cyan(":session resume <sid>")} or ${cyan("npm run cli -- --resume <sid>")})
`;
}
