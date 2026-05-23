// bundle-path.mjs — locate a session's bundle dir on disk so we can invoke
// the workflow + agent-tool CLIs (which take a cwd, not a session id).
//
// We try the documented tmpdir convention used by sessions.js plus the
// home-dir default. SDK_SESSIONS_DIR overrides both for test isolation.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function guessBundlePath(sid) {
  const tmp = os.tmpdir();
  const home = os.homedir();
  const override = process.env.SDK_SESSIONS_DIR;
  const candidates = [
    override ? path.join(override, sid, "bundle") : null,
    path.join(home, ".avni-skills-sdk", "sessions", sid, "bundle"),
    path.join(tmp, "avni-sdk-sessions", sid, "bundle"),
    path.join("/private" + tmp, "avni-sdk-sessions", sid, "bundle"),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("could not locate bundle dir for " + sid);
}
