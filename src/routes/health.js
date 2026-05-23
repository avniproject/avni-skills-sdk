// GET /health — liveness + which avni-skills checkout the server resolved at startup.

import { avniSkillsPath } from "../skills.js";

export function register(app) {
  app.get("/health", (_req, res) => {
    try {
      res.json({ ok: true, avniSkillsPath: avniSkillsPath(), nodeVersion: process.version });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
