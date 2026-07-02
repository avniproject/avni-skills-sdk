// commands/rules.mjs — rule + reference inspection commands:
//   :rules                list every populated rule
//   :rulev                Layer-4 rules validator (R1-R6)
//   :refs <q>             find every reference to a UUID or "Name"
//
// :refs shells out to scripts/agent-tools/find-references.mjs — a read-only
// deterministic primitive. The deterministic edit workflows (:add-form /
// :rename) were retired in story #11; adding/renaming entities is now the
// agent's job (Read + Edit/Write; the gates catch bad mutations).

import path from "node:path";
import { bold, cyan, dim, green, red, yellow } from "../ui.mjs";
import { guessBundlePath } from "../bundle-path.mjs";

export function makeRulesCommands({ http, SCRIPTS_DIR }) {
  const { getJson } = http;

  async function cmdRules(sid) {
    const d = await getJson(`/v1/sessions/${sid}/rules`);
    if (d.count === 0) {
      console.log(yellow("  no populated rules"));
      return;
    }
    const groups = {};
    for (const r of d.rules) {
      const k = `${r.entity}.${r.field}`;
      (groups[k] ||= []).push(r);
    }
    for (const k of Object.keys(groups).sort()) {
      console.log(`  ${bold(k)}  (${groups[k].length})`);
      for (const r of groups[k].slice(0, 5)) {
        console.log(`    ${dim(r.file)}  ${cyan(r.entityName || "")}  ${dim(r.bytes + " bytes")}`);
      }
      if (groups[k].length > 5) console.log(dim(`    … ${groups[k].length - 5} more`));
    }
    console.log(dim(`  total: ${d.count}`));
  }

  async function cmdRuleValidate(sid) {
    const d = await getJson(`/v1/sessions/${sid}/rules/validation`);
    const s = d.summary;
    const tag = s.errors > 0 ? red(`✗ errors=${s.errors}`) : s.warnings > 0 ? yellow(`⚠ warnings=${s.warnings}`) : green("✓ all rules valid");
    console.log(`  ${tag}   filesAffected=${s.filesAffected}`);
    for (const e of (d.errors || []).slice(0, 8)) {
      console.log(`  ${red("E")} ${e.code}  ${e.message.slice(0, 140)}`);
    }
    for (const w of (d.warnings || []).slice(0, 8)) {
      console.log(`  ${yellow("W")} ${w.code}  ${w.message.slice(0, 140)}`);
    }
    if (d.errors?.length > 8) console.log(dim(`  … ${d.errors.length - 8} more errors`));
    if (d.warnings?.length > 8) console.log(dim(`  … ${d.warnings.length - 8} more warnings`));
  }

  async function cmdRefs(sid, query) {
    if (!query) { console.log(red("  usage: :refs <uuid-or-name>")); return; }
    // Detect: UUID-shaped → --uuid, else --name
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.trim());
    const dir = await getJson(`/v1/sessions/${sid}`).then((s) => s).catch(() => null);
    if (!dir) { console.log(red("  session not found")); return; }
    const { spawnSync } = await import("node:child_process");
    const cliPath = path.join(SCRIPTS_DIR, "agent-tools/find-references.mjs");
    // Session bundle dir from meta (we need cwd to be the bundle dir)
    const meta = await getJson(`/v1/sessions/${sid}`);
    const bundlePath = meta._bundlePath || guessBundlePath(sid);
    const args = isUuid ? ["--uuid", query.trim()] : ["--name", query.trim()];
    const res = spawnSync("node", [cliPath, ...args], { cwd: bundlePath, encoding: "utf8" });
    if (res.status !== 0) { console.log(red("  refs failed: " + (res.stderr || res.stdout))); return; }
    const out = JSON.parse(res.stdout);
    console.log(`  ${bold(String(out.totalReferences))}` + dim(" references across ") + cyan(String(out.filesAffected)) + dim(" files"));
    for (const [f, list] of Object.entries(out.byFile || {})) {
      console.log("    " + bold(f) + dim(" (" + list.length + ")"));
      for (const ref of list.slice(0, 5)) {
        console.log(dim("      " + ref.jsonPath + "  ") + (ref.kind === "string-contains" ? dim("(in string body)") : cyan(ref.kind)));
      }
      if (list.length > 5) console.log(dim(`      … ${list.length - 5} more`));
    }
  }

  return { cmdRules, cmdRuleValidate, cmdRefs };
}
