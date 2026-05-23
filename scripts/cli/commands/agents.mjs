// commands/agents.mjs — agent + model commands:
//   :agent <spec|bundle-config|review> <prompt>   live-dispatch a structured
//                       turn to the named WS5 agent. Streams SSE; renders
//                       routing, structured output, schema validation result.
//   :model [name|alias]  show or change the agent model. Aliases:
//                       haiku → claude-haiku-4-5-...
//                       sonnet → claude-sonnet-4-6
//                       opus → claude-opus-4-7
//
// `:model` mutates `state.MODEL` which is shared with sse.mjs + agents — that
// way subsequent free-text turns (and :agent dispatches) pick up the change.

import { cyan, dim, green, magenta, red, rule, yellow } from "../ui.mjs";

const MODEL_ALIASES = {
  haiku:  "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus:   "claude-opus-4-7",
};

export function makeAgentsCommands({ http, BASE, state }) {
  async function cmdAgent(sid, rest) {
    if (!rest || rest.length < 2) {
      console.log(red("  usage: :agent <spec|bundle-config|review> <prompt>"));
      return;
    }
    const agentName = rest[0];
    const userPrompt = rest.slice(1).join(" ");
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log(red("  ANTHROPIC_API_KEY not set in env — :agent requires a live key."));
      return;
    }

    rule(cyan("agent · " + agentName + " · " + state.MODEL.replace(/^claude-/, "").split("-").slice(0, 3).join("-")), dim);
    const body = JSON.stringify({ agent: agentName, prompt: userPrompt, model: state.MODEL });
    const r = await fetch(`${BASE}/v1/sessions/${sid}/agent-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body,
    });
    if (!r.ok) {
      const txt = await r.text();
      console.log(red("  ✗ " + r.status + ": " + txt.slice(0, 200)));
      return;
    }

    // Stream SSE — render salient events; ignore noisy intermediate frames.
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let structured = null;
    let schemaErrors = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const evMatch = block.match(/^event:\s*(.+)$/m);
        const dataMatch = block.match(/^data:\s*([\s\S]+)$/m);
        if (!evMatch || !dataMatch) continue;
        const ev = evMatch[1].trim();
        let data;
        try { data = JSON.parse(dataMatch[1]); } catch { continue; }
        if (ev === "agent_routing") {
          console.log(dim("  routing → ") + agentName + dim(" · model ") + cyan(data.model.replace(/^claude-/, "")));
        } else if (ev === "structured_output") {
          structured = data;
        } else if (ev === "structured_output_error") {
          schemaErrors = data.errors || [];
        } else if (ev === "turn") {
          console.log(dim("  → turn ") + cyan(String(data.turn)) + dim(" · sha=") + dim(data.sha) +
                      dim(" · validator ") + (data.validation?.valid ? green("✓") : red("✗ " + (data.validation?.errors || 0) + " errors")));
        } else if (ev === "done") {
          console.log(dim("  done · " + data.agentEvents + " events · cost $" +
                         (data.wallet?.totalUsd || 0).toFixed(4) +
                         " · schema " + (data.schemaOk ? green("✓") : red("✗"))));
        } else if (ev === "error") {
          console.log(red("  ✗ " + (data.message || JSON.stringify(data))));
        }
      }
    }
    rule("", dim);
    if (structured) {
      console.log(dim("  ── structured output ──"));
      console.log(dim("  intent:       ") + cyan(structured.intent));
      console.log(dim("  target_phase: ") + structured.target_phase);
      console.log(dim("  reason:       ") + structured.reason);
      if (structured.applied_changes?.length) {
        console.log(dim("  applied_changes:"));
        for (const c of structured.applied_changes) {
          console.log("    " + green("✓") + " " + c.operation + " " + c.section + " · " + (c.item_names || []).join(", "));
        }
      }
      if (structured.ambiguities?.length) {
        console.log(yellow("  ambiguities (agent is asking you):"));
        for (const a of structured.ambiguities) {
          console.log("    " + yellow("?") + " " + a.question);
          for (const o of (a.options || [])) console.log("       · " + o);
        }
      }
    } else if (schemaErrors.length) {
      console.log(red("  ✗ structured-output contract broken:"));
      for (const e of schemaErrors.slice(0, 5)) console.log("    " + e);
    }
  }

  function cmdModel(arg) {
    if (!arg) {
      console.log(`  current: ${cyan(state.MODEL)}`);
      console.log(dim("  aliases: " + Object.entries(MODEL_ALIASES).map(([k, v]) => `${k}→${v}`).join(", ")));
      console.log(dim("  usage:   :model sonnet"));
      return;
    }
    const resolved = MODEL_ALIASES[arg.toLowerCase()] || arg;
    state.MODEL = resolved;
    console.log(`  ${green("✓")} model set to ${cyan(state.MODEL)}`);
    if (arg.toLowerCase() === "sonnet" || resolved.includes("sonnet")) {
      console.log(dim("  (sonnet recommended for structural fixes — case-insensitive concept reuse, schema decisions)"));
    } else if (arg.toLowerCase() === "haiku" || resolved.includes("haiku")) {
      console.log(dim("  (haiku is cheap+fast for mechanical edits and rule authoring; switch to sonnet for structural fixes)"));
    }
  }

  return { cmdAgent, cmdModel };
}

export { MODEL_ALIASES };
