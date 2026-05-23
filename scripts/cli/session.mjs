// session.mjs — create + attach helpers for the /v1/sessions endpoints.
//
// `createSession` uploads forms + optional modelling xlsx as multipart and
// returns the server's session-created payload. `attachSession` re-hydrates
// an existing on-disk session for `--resume` so the caller path stays uniform.

import fs from "node:fs";
import path from "node:path";

export function makeSessionHelpers({ BASE }) {
  async function createSession({ formsPath, modellingPath, org }) {
    const fd = new FormData();
    fd.set("forms", new Blob([fs.readFileSync(formsPath)]), path.basename(formsPath));
    if (modellingPath) fd.set("modelling", new Blob([fs.readFileSync(modellingPath)]), path.basename(modellingPath));
    fd.set("org", org);
    const r = await fetch(`${BASE}/v1/sessions`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`create session failed: ${r.status} ${await r.text()}`);
    return r.json();
  }

  async function attachSession(sid) {
    const r = await fetch(`${BASE}/v1/sessions/${sid}`);
    if (r.status === 404) throw new Error(`session not found: ${sid}`);
    if (!r.ok) throw new Error(`attach session failed: ${r.status} ${await r.text()}`);
    const meta = await r.json();
    return {
      sessionId: sid,
      meta,
      validation: meta.validationAtCurrent,
      resumed: true,
    };
  }

  return { createSession, attachSession };
}
