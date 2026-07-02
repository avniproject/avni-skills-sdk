// dispatch.mjs — REPL line dispatcher.
//
// The case-switch that routes ":command args" → handler functions. Lines
// that don't start with ":" are sent to the agent via sendMessage (with an
// animated spinner that stops on the first SSE frame).
//
// Returns "quit" when the loop should exit, "continue" otherwise.

import { cyan, dim, green, red, rule, startSpinner } from "./ui.mjs";
import { buildHelp } from "./help.mjs";

// Model aliases for the `:model` REPL command. The keyword model-router was
// deleted in #11; `:model` remains a per-session override for free-text turns
// (it mutates state.MODEL, which sse.mjs sends on every /messages call).
const MODEL_ALIASES = {
  haiku:  "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus:   "claude-opus-4-8",
};

export function makeDispatcher({ commands, sendMessage, state }) {
  // Flatten the command bundles into a single name → handler map. Each value
  // is `(sid, arg1?, rest?) => Promise<void>`; we wrap to normalise calling.
  const {
    turns, rules, audit, observability, sessions,
  } = commands;

  // `:model [name|alias]` — show or change the model used for free-text turns.
  function cmdModel(arg) {
    if (!arg) {
      console.log(`  current: ${cyan(state.MODEL)}`);
      console.log(dim("  aliases: " + Object.entries(MODEL_ALIASES).map(([k, v]) => `${k}→${v}`).join(", ")));
      console.log(dim("  usage:   :model sonnet"));
      return;
    }
    state.MODEL = MODEL_ALIASES[arg.toLowerCase()] || arg;
    console.log(`  ${green("✓")} model set to ${cyan(state.MODEL)}`);
  }

  async function handleLine(input, sid) {
    if (input.startsWith(":")) {
      const [cmd, ...rest] = input.slice(1).split(/\s+/);
      const arg1 = rest[0];
      switch (cmd) {
        case "help": case "h": case "?": console.log(buildHelp()); break;

        // turns + file inspection
        case "turns":   await turns.cmdTurns(sid); break;
        case "diff":    await turns.cmdDiff(sid, arg1); break;
        case "files":   await turns.cmdFiles(sid); break;
        case "read":    await turns.cmdRead(sid, rest.join(" ")); break;
        case "state":   await turns.cmdState(sid); break;
        case "revert":  await turns.cmdRevert(sid, arg1); break;
        case "zip":     await turns.cmdZip(sid, arg1); break;

        // rules
        case "rules":   await rules.cmdRules(sid); break;
        case "rulev": case "rules-validate":
                        await rules.cmdRuleValidate(sid); break;
        case "refs": case "references":
                        await rules.cmdRefs(sid, rest.join(" ")); break;

        // audit
        case "summary": await audit.cmdSummary(sid); break;
        case "eval": case "evaluate":
                        await audit.cmdEval(sid); break;

        // observability (Phase 5a + Phase 6)
        case "transcript": case "tx":
                        await observability.cmdTranscript(sid, arg1); break;
        case "steps": case "log":
                        await observability.cmdSteps(sid, arg1); break;
        case "cost": case "wallet":
                        await observability.cmdCost(sid); break;
        case "changes": case "semantic-diff": case "sdiff":
                        await observability.cmdChanges(sid, arg1); break;
        case "diag": case "diagnostics":
                        await observability.cmdDiag(sid); break;

        // model override for free-text turns
        case "model":   cmdModel(arg1); break;

        // session management — list / resume / info (Claude Code /resume style)
        case "session": case "sessions": case "s":
                        await sessions.cmdSession(rest); break;
        case "resume":
                        // shorthand: `:resume sess_xxx` == `:session resume sess_xxx`
                        await sessions.cmdSession(["resume", ...rest]); break;

        // exit
        case "quit": case "q": case "exit": return "quit";

        default:
          console.log(red(`unknown command: :${cmd}  (try :help)`));
      }
    } else {
      // The user's prompt line was already echoed by readline; render a
      // visible separator + animated spinner. sendMessage streams SSE frames
      // and prints them; the spinner stops on the FIRST agent frame so it
      // doesn't clobber the streamed output.
      rule(cyan("agent · " + state.MODEL.replace(/^claude-/, "").split("-").slice(0, 3).join("-")), dim);
      const stopSpinner = startSpinner("thinking…");
      await sendMessage(sid, input, { onFirstFrame: () => stopSpinner() });
      rule("", dim);
    }
    return "continue";
  }

  return { handleLine };
}
