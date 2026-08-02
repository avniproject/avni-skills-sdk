// session.mjs — create + attach helpers for the /v1/sessions endpoints.
//
// `createSession` uploads forms + optional modelling xlsx as multipart and
// returns the server's session-created payload. `attachSession` re-hydrates
// an existing on-disk session for `--resume` so the caller path stays uniform.
//
// `mode` (story #12) selects the session kind the server builds:
//   • "baseline" (DEFAULT) — server runs the deterministic generator at turn 0.
//   • "agent"              — bundle starts empty; the SRS is attached under
//                            input/ so the agent can read EVERY sheet via
//                            bundle_read_srs (including the tabs the generator
//                            skips) and bootstrap via bundle_generate_baseline.
// The field is omitted for baseline so the request stays byte-identical to the
// pre-#12 CLI — the server defaults to baseline on an absent `mode`.

import fs from "node:fs";
import path from "node:path";

export function makeSessionHelpers({ BASE }) {
  async function createSession({ formsPath, modellingPath, org, mode }) {
    const fd = new FormData();
    fd.set("forms", new Blob([fs.readFileSync(formsPath)]), path.basename(formsPath));
    if (modellingPath) fd.set("modelling", new Blob([fs.readFileSync(modellingPath)]), path.basename(modellingPath));
    fd.set("org", org);
    if (mode && mode !== "baseline") fd.set("mode", mode);
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
      // Work left behind by a turn that never committed (process killed
      // mid-stream). Surfaced by the banner — meta alone would show the PREVIOUS
      // turn's state over a tree that may hold a half-applied edit.
      uncommitted: meta.uncommitted || [],
      resumed: true,
    };
  }

  return { createSession, attachSession };
}
