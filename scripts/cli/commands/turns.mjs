// commands/turns.mjs — turn + file inspection commands:
//   :turns           list all turns
//   :diff [N]        unified diff for turn N
//   :files           list files in the bundle
//   :read <path>     print a file (pretty-prints JSON if it parses)
//   :state           re-fetch session metadata
//   :revert <N>      hard-reset to turn N
//   :zip [path]      download final ZIP

import fs from "node:fs";
import path from "node:path";
import { bold, cyan, dim, green, magenta, red, yellow } from "../ui.mjs";
import { formatValidation } from "../render.mjs";

export function makeTurnsCommands({ http, SDK_DIR }) {
  const { getJson, getText, postJson, BASE } = http;

  async function cmdTurns(sid) {
    const { turns } = await getJson(`/v1/sessions/${sid}/turns`);
    for (const t of turns) {
      console.log(`  ${cyan("turn " + t.turn)}  ${dim(t.sha)}  ${t.summary}`);
    }
  }

  async function cmdDiff(sid, n) {
    const meta = await getJson(`/v1/sessions/${sid}`);
    const target = n === undefined ? meta.currentTurn : Number(n);
    if (target === 0) { console.log(yellow("turn 0 is the deterministic first-pass — no parent diff")); return; }
    const diff = await getText(`/v1/sessions/${sid}/turns/${target}/diff`);
    for (const line of diff.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) console.log(bold(line));
      else if (line.startsWith("+")) console.log(green(line));
      else if (line.startsWith("-")) console.log(red(line));
      else if (line.startsWith("@@")) console.log(magenta(line));
      else console.log(dim(line));
    }
  }

  async function cmdFiles(sid) {
    const meta = await getJson(`/v1/sessions/${sid}`);
    console.log(dim(`${meta.files.length} files:`));
    for (const f of meta.files) console.log("  " + f);
  }

  async function cmdRead(sid, p) {
    if (!p) { console.log(red("usage: :read <path>")); return; }
    const txt = await getText(`/v1/sessions/${sid}/files/${encodeURI(p)}`);
    // Pretty-print JSON if it parses, else raw
    try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); }
    catch { console.log(txt); }
  }

  async function cmdRevert(sid, n) {
    if (n === undefined) { console.log(red("usage: :revert <turn>")); return; }
    const r = await postJson(`/v1/sessions/${sid}/revert`, { to_turn: Number(n) });
    console.log(green(`✓ reverted to turn ${r.currentTurn} — ${formatValidation(r.validationAtCurrent)}`));
  }

  async function cmdZip(sid, dest) {
    const meta = await getJson(`/v1/sessions/${sid}`);
    const out = dest || path.join(SDK_DIR, "output-bundle", `${meta.org}-${sid}.zip`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const r = await fetch(`${BASE}/v1/sessions/${sid}/zip`);
    if (!r.ok) throw new Error("zip failed: " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(out, buf);
    console.log(green(`✓ ${out}  (${(buf.length / 1024).toFixed(1)} KB)`));
  }

  async function cmdState(sid) {
    const meta = await getJson(`/v1/sessions/${sid}`);
    console.log(`  org=${meta.org}  currentTurn=${meta.currentTurn}  files=${meta.files.length}`);
    console.log(`  validator: ${formatValidation(meta.validationAtCurrent)}`);
  }

  return { cmdTurns, cmdDiff, cmdFiles, cmdRead, cmdRevert, cmdZip, cmdState };
}
