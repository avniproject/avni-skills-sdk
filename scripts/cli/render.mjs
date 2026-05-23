// render.mjs — shared formatting helpers used by REPL commands + SSE renderer.
//
// `formatValidation` returns a compact one-liner like
//   `errors=3 warnings=1  F2:2 D1:1`
// `describeToolUse` maps an SDK tool-use block to an (icon, label, detail)
// triple used by the assistant stream renderer.

import { cyan, dim } from "./ui.mjs";

export function formatValidation(v) {
  if (!v) return "(no validation)";
  const groups = Object.entries(v.groups || {}).map(([k, n]) => `${k}:${n}`).join(" ");
  return `errors=${v.errors} warnings=${v.warnings}${groups ? "  " + dim(groups) : ""}`;
}

// Tool icon + one-line description. No emojis — just box-drawing/symbols.
export function describeToolUse(b) {
  const inp = b.input || {};
  let icon = "▸";
  let label = b.name;
  let detail = "";
  if (b.name === "Read")  { icon = "◇"; const fp = inp.file_path || inp.path; if (fp) detail = fp.split("/").slice(-2).join("/"); }
  else if (b.name === "Edit") { icon = "◆"; const fp = inp.file_path || inp.path; if (fp) detail = fp.split("/").slice(-2).join("/"); }
  else if (b.name === "Write"){ icon = "✎"; const fp = inp.file_path || inp.path; if (fp) detail = fp.split("/").slice(-2).join("/"); }
  else if (b.name === "Glob" || b.name === "Grep") { icon = "◈"; detail = inp.pattern || inp.glob || ""; }
  else if (b.name === "Bash") { icon = "$"; detail = (inp.command || "").slice(0, 64).replace(/\s+/g, " "); }
  else if (b.name === "Skill"){ icon = "§"; detail = inp.skill || ""; label = "skill"; }
  return { icon, label, detail };
}
