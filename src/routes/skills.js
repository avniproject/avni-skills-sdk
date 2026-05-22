// /v1/skills — list & read skill metadata (deterministic, no LLM).

import { listSkills, readSkill } from "../skills.js";

export function register(app) {
  app.get("/v1/skills", (_req, res) => {
    try { res.json({ skills: listSkills() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/v1/skills/:slug", (req, res) => {
    try {
      const skill = readSkill(req.params.slug);
      if (!skill) return res.status(404).json({ error: "skill not found" });
      res.json(skill);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
