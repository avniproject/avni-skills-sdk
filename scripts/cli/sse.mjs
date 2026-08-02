// sse.mjs — POST to /v1/sessions/:id/messages and render the SSE stream
// frame-by-frame. Maintains regression state via the caller-supplied `state`
// object (priorValidationGroups). MODEL is read off the same state object so
// the `:model` command can swap it mid-session.

import { bold, box, cyan, dim, green, magenta, red, yellow, blue } from "./ui.mjs";
import { describeToolUse } from "./render.mjs";

export function makeSseSender({ BASE, state }) {
  async function sendMessage(sid, prompt, { onFirstFrame } = {}) {
    const r = await fetch(`${BASE}/v1/sessions/${sid}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ANTHROPIC_API_KEY}`,
      },
      body: JSON.stringify({ prompt, model: state.MODEL }),
    });
    if (!r.ok) {
      if (onFirstFrame) onFirstFrame();   // stop spinner on error too
      console.log(red(`agent call failed: ${r.status} — ${await r.text()}`)); return;
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let inputTokens = 0, outputTokens = 0, costUsd = 0;
    let firedFirstFrame = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (block.match(/^event:\s*(.*)$/m) || [, ""])[1];
        const dataLine = (block.match(/^data:\s*([\s\S]*)$/m) || [, "{}"])[1];
        let data; try { data = JSON.parse(dataLine); } catch { continue; }
        if (!firedFirstFrame && onFirstFrame) {
          firedFirstFrame = true;
          onFirstFrame();
        }
        handleEvent(ev, data);
      }
    }
    function handleEvent(ev, data) {
      if (ev === "start") {
        // Slim header — one dim line, no spam
        const m = (data.model || "").split("-").slice(0, 4).join("-");
        console.log(dim(`  ${m} · cwd=${data.cwd?.split("/").slice(-2).join("/")}`));
      } else if (ev === "agent") {
        const t = data.type;
        const sub = data.subtype;
        if (t === "system" && sub === "init") {
          // First system event after start — show tool/skill count subtly
          const ntools = (data.tools || []).length;
          const nskills = (data.skills || []).length;
          console.log(dim(`  ${ntools} tools · ${nskills} skills available`));
        } else if (t === "assistant" && data.message?.content) {
          let printedAgentPrefix = false;
          for (const b of data.message.content) {
            if (b.type === "text" && b.text) {
              if (!printedAgentPrefix) { console.log(magenta("agent ›")); printedAgentPrefix = true; }
              for (const ln of b.text.split("\n")) console.log("  " + ln);
            } else if (b.type === "tool_use") {
              const { icon, label, detail } = describeToolUse(b);
              const labelColor = label === "skill" ? cyan : label === "Edit" || label === "Write" ? yellow : blue;
              console.log("  " + labelColor(icon + " " + label) + (detail ? "  " + dim(detail) : ""));
            } else if (b.type === "thinking") {
              // Suppress — too noisy for chat UX
            }
          }
          const u = data.message?.usage;
          if (u) { inputTokens = u.input_tokens || inputTokens; outputTokens = u.output_tokens || outputTokens; }
        } else if (t === "user" && data.message?.content) {
          // tool_result blocks — render very dim, short, indented
          for (const b of data.message.content) {
            if (b.type === "tool_result") {
              const content = Array.isArray(b.content) ? b.content.map((x) => x.text || "").join("") : String(b.content || "");
              const lines = content.split("\n").filter((l) => l.trim());
              const first = (lines[0] || "").slice(0, 96);
              const more = lines.length > 1 ? dim(` · +${lines.length - 1} lines`) : "";
              console.log("    " + dim("↳ " + first) + more);
            }
          }
        } else if (t === "result") {
          if (typeof data.total_cost_usd === "number") costUsd = data.total_cost_usd;
          if (data.usage) {
            inputTokens = data.usage.input_tokens || inputTokens;
            outputTokens = data.usage.output_tokens || outputTokens;
          }
        }
      } else if (ev === "turn") {
        console.log("");
        // Compute regression deltas BEFORE rendering so we can include in the panel
        const prior = state.priorValidationGroups || {};
        const now = data.validation?.groups || {};
        const newCodes = Object.keys(now).filter((k) => !(k in prior));
        const grewCodes = Object.keys(now).filter((k) => k in prior && now[k] > prior[k]);
        const shrunkCodes = Object.keys(prior).filter((k) => !(k in now) || now[k] < (prior[k] || 0));
        const priorTotal = Object.values(prior).reduce((a, b) => a + b, 0);
        const nowTotal = Object.values(now).reduce((a, b) => a + b, 0);
        const delta = nowTotal - priorTotal;
        const isRegression = newCodes.length || grewCodes.length || delta > 0;
        const isImprovement = !isRegression && (shrunkCodes.length || delta < 0);
        // Build panel lines
        const v = data.validation;
        const validIcon = v?.valid ? green("✓ valid") : red("✗ " + v?.errors + " errors");
        const warnTag = v?.warnings ? dim(" · " + v.warnings + " warnings") : "";
        const codes = Object.entries(now).map(([k, n]) => `${k}:${n}`).join(" ");
        const deltaStr = delta === 0 ? dim("Δ 0")
                       : isRegression ? red(`Δ +${delta}`)
                       : green(`Δ ${delta}`);

        const lines = [];
        if (data.noChanges) {
          // A no-op turn is the single most common way a session silently stalls:
          // the agent explains what it WOULD do, edits nothing, and the reply reads
          // like success. The old one-line dim note was routinely missed — three
          // consecutive no-op turns went unnoticed in a real session. Say it plainly.
          lines.push(red("✗ NO FILES CHANGED") + dim("  · the agent edited nothing · turn counter still ") + bold(String(data.turn ?? "?")));
        } else {
          lines.push(bold("turn " + data.turn) + dim("  · " + data.sha));
          const cf = (data.changedFiles || []);
          lines.push(dim("changed     ") + (cf.length ? cf.join(", ") : dim("(none)")));
        }
        lines.push(dim("validator   ") + validIcon + warnTag + (codes ? dim("   " + codes) : "") + "   " + deltaStr);
        if (isRegression) {
          const why = [];
          if (newCodes.length) why.push("new: " + newCodes.join(","));
          if (grewCodes.length) why.push("grew: " + grewCodes.join(","));
          lines.push(red("⚠ regression ") + why.join(" · "));
        }
        if (data.rulesValidation) {
          const r = data.rulesValidation;
          const tag = r.errors > 0 ? red("✗ " + r.errors + " errors")
                    : r.warnings > 0 ? dim("⚠ " + r.warnings + " warnings")
                    : green("✓ clean");
          lines.push(dim("rules       ") + tag + (Object.keys(r.codes || {}).length ? dim("   " + Object.keys(r.codes).join(",")) : ""));
        }
        // Cost line — but only once we've seen at least one usage event
        if (inputTokens || outputTokens || costUsd) {
          lines.push(dim("cost        $") + costUsd.toFixed(4) + dim("   tokens in/out  ") + inputTokens + "/" + outputTokens);
        }

        box(lines, { style: (isRegression || data.noChanges) ? "square" : "round", indent: 0 });

        if (data.noChanges) {
          console.log(dim("  ↪ Nothing was written. If you asked for an edit, the agent answered in prose instead —"));
          console.log(dim("    re-send with an imperative opener: ") + cyan("\"Edit the files now — do not describe the changes, make them.\""));
        }
        if (isRegression && !data.noChanges) {
          console.log(dim("  ↪ The agent may have claimed success. Consider ") + cyan(":diff " + data.turn) + dim(" then ") + cyan(":revert " + (data.turn - 1)) + dim(" — or ") + cyan(":model opus") + dim(" (deeper reasoning) before re-attempting."));
        }
        state.priorValidationGroups = { ...now };
      } else if (ev === "done") {
        // Trailing dim line only when we didn't already show cost in the turn panel
        // (turn panel already includes it). Keep this minimal.
        console.log(dim("  [stream end · " + data.agentEvents + " events]"));
      } else if (ev === "error") {
        console.log(red("  ✗ " + (data.message || JSON.stringify(data))));
      }
    }
  }
  return { sendMessage };
}
