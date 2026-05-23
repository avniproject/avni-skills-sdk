// server-mgmt.mjs — server lifecycle + thin HTTP helpers.
//
// The CLI auto-boots `node src/server.js` if nothing is listening on the
// configured port, and pipes its stdio to a tmpfile so REPL output stays
// clean. `getJson` / `postJson` / `getText` are tiny wrappers that throw
// on non-2xx so callers don't need to repeat the same `if (!r.ok)` dance.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dim, green, red } from "./ui.mjs";

export function makeServerHelpers({ BASE, PORT, SDK_DIR }) {
  async function serverHealthy() {
    try { const r = await fetch(`${BASE}/health`); return r.ok; }
    catch { return false; }
  }

  let serverProc = null;
  async function ensureServer() {
    if (await serverHealthy()) return { startedServer: false, serverProc: null };
    process.stdout.write(dim("starting server on :" + PORT + "..."));
    serverProc = spawn("node", ["src/server.js"], {
      cwd: SDK_DIR,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // pipe server output to a logfile so the REPL stays clean
    const logPath = path.join(os.tmpdir(), `avni-sdk-cli-${process.pid}.log`);
    const logFile = fs.createWriteStream(logPath);
    serverProc.stdout.pipe(logFile);
    serverProc.stderr.pipe(logFile);
    for (let i = 0; i < 50; i++) {
      await sleep(100);
      if (await serverHealthy()) {
        process.stdout.write(green(" ok\n"));
        console.log(dim("  server log: " + logPath));
        return { startedServer: true, serverProc };
      }
    }
    console.log(red(" timeout — see " + logPath));
    process.exit(1);
  }

  async function getJson(p) {
    const r = await fetch(BASE + p);
    if (!r.ok) throw new Error(`${p} → ${r.status}`);
    return r.json();
  }
  async function getText(p) {
    const r = await fetch(BASE + p);
    if (!r.ok) throw new Error(`${p} → ${r.status}`);
    return r.text();
  }
  async function postJson(p, body) {
    const r = await fetch(BASE + p, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${p} → ${r.status} ${await r.text()}`);
    return r.json();
  }

  return { serverHealthy, ensureServer, getJson, getText, postJson };
}
