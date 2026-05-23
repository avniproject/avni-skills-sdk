// commands/audit.mjs — bundle audit commands:
//   :summary  deterministic audit (entity counts, anomalies, rule stats) — free
//   :eval     LLM semantic-gap audit via /v1/sessions/:id/evaluate

import { bold, box, cyan, dim, green, red, yellow } from "../ui.mjs";

export function makeAuditCommands({ http, BASE }) {
  const { getJson } = http;

  async function cmdSummary(sid) {
    const d = await getJson(`/v1/sessions/${sid}/summary`);
    const ec = d.entityCounts;
    box([
      bold("bundle summary") + dim(" · deterministic · free"),
      "",
      `${dim("concepts")}        ${cyan(String(ec.concepts))}        ${dim("Coded:")} ${cyan(String(d.codedAnswerStats.totalCoded))} ${dim("(empty:")} ${d.codedAnswerStats.emptyCoded > 0 ? red(String(d.codedAnswerStats.emptyCoded)) : green("0")}${dim(")")}`,
      `${dim("forms")}           ${cyan(String(ec.forms))}        ${dim("rules populated:")} ${cyan(String(d.ruleStats.populated))}`,
      `${dim("subjectTypes")}    ${cyan(String(ec.subjectTypes))}`,
      `${dim("programs")}        ${cyan(String(ec.programs))}`,
      `${dim("encounterTypes")}  ${cyan(String(ec.encounterTypes))}`,
      `${dim("formMappings")}    ${cyan(String(ec.formMappings))}`,
    ]);
    if (d.anomalyCount === 0) {
      console.log("  " + green("✓ no anomalies"));
      return;
    }
    console.log("  " + bold(`anomalies (${d.anomalyCount})`) + dim(" · ") + red(String(d.errorCount)) + dim(" errors · ") + yellow(String(d.warningCount)) + dim(" warnings"));
    for (const a of d.anomalies.slice(0, 20)) {
      const sev = a.severity === "error" ? red("E") : a.severity === "warning" ? yellow("W") : dim("I");
      console.log("    " + sev + " " + bold(a.type) + dim("  " + a.where));
      console.log("      " + dim("→ ") + (a.value || "").slice(0, 110));
    }
    if (d.anomalies.length > 20) console.log(dim(`    … ${d.anomalies.length - 20} more`));
  }

  async function cmdEval(sid) {
    console.log(dim("  ⠋ running LLM semantic-gap audit (~$0.05-0.20)…"));
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { console.log(red("  ANTHROPIC_API_KEY not set")); return; }
    const r = await fetch(`${BASE}/v1/sessions/${sid}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({}),
    });
    if (!r.ok) { console.log(red(`  evaluate failed: ${r.status} ${await r.text()}`)); return; }
    const d = await r.json();
    const findings = d.findings || [];
    console.log(green(`  ✓ evaluated`) + dim(` · cost $${(d.costUsd || 0).toFixed(4)} · ${findings.length} findings`));
    if (d.summary) {
      console.log("");
      for (const ln of d.summary.split("\n")) console.log("  " + ln);
    }
    for (const f of findings) {
      const sev = f.severity === "error" ? red("E") : f.severity === "warning" ? yellow("W") : dim("I");
      console.log("");
      console.log("  " + sev + " " + bold(f.title));
      if (f.evidence) console.log("    " + dim("evidence:    ") + f.evidence);
      if (f.recommendation) console.log("    " + dim("recommend:   ") + f.recommendation);
    }
  }

  return { cmdSummary, cmdEval };
}
