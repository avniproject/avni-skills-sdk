// dispatch.mjs — REPL line dispatcher.
//
// The case-switch that routes ":command args" → handler functions. Lines
// that don't start with ":" are sent to the agent via sendMessage (with an
// animated spinner that stops on the first SSE frame).
//
// Returns "quit" when the loop should exit, "continue" otherwise.

import { cyan, dim, red, rule, startSpinner } from "./ui.mjs";
import { buildHelp } from "./help.mjs";

export function makeDispatcher({ commands, sendMessage, state }) {
  // Flatten the command bundles into a single name → handler map. Each value
  // is `(sid, arg1?, rest?) => Promise<void>`; we wrap to normalise calling.
  const {
    turns, rules, audit, workflows, observability, agents,
  } = commands;

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

        // rules + workflows
        case "rules":   await rules.cmdRules(sid); break;
        case "rulev": case "rules-validate":
                        await rules.cmdRuleValidate(sid); break;
        case "refs": case "references":
                        await rules.cmdRefs(sid, rest.join(" ")); break;
        case "rename":  await rules.cmdRename(sid, rest); break;
        case "add-form": case "addform":
                        await rules.cmdAddForm(sid, rest); break;
        case "apply":   await workflows.cmdApply(sid, arg1); break;

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

        // agents
        case "agent":   await agents.cmdAgent(sid, rest); break;
        case "model":   agents.cmdModel(arg1); break;

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
