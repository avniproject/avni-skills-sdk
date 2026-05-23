// POST /v1/bundles/generate — deterministic generator (no LLM, no API key).
// Multipart: forms.xlsx (required) + optional modelling.xlsx → bundle.zip.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateBundle, validateBundle, zipBundle } from "../bundle.js";
import { readMultipart } from "../middleware/multipart.js";

export function register(app) {
  app.post("/v1/bundles/generate", async (req, res) => {
    try {
      const ct = req.headers["content-type"] || "";
      if (!ct.includes("multipart/form-data")) {
        return res.status(400).json({ error: "Content-Type must be multipart/form-data with 'forms' file" });
      }
      const { fields, files } = await readMultipart(req);
      if (!files.forms) return res.status(400).json({ error: "missing 'forms' file (Forms.xlsx)" });

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "avni-gen-"));
      const formsPath = path.join(tmpDir, "forms.xlsx");
      fs.writeFileSync(formsPath, files.forms.buffer);
      let modellingPath = null;
      if (files.modelling) {
        modellingPath = path.join(tmpDir, "modelling.xlsx");
        fs.writeFileSync(modellingPath, files.modelling.buffer);
      }

      const org = fields.org || "Bundle";
      const out = path.join(tmpDir, "out");
      generateBundle({ formsPath, modellingPath, org, outDir: out });

      const validation = validateBundle(out);
      const zipPath = path.join(tmpDir, `${org}.zip`);
      await zipBundle(out, zipPath);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${org}.zip"`);
      res.setHeader("X-Bundle-Errors", String(validation.errors.length));
      res.setHeader("X-Bundle-Warnings", String(validation.warnings.length));
      // HTTP headers can't contain CR/LF or bytes outside printable ASCII —
      // strip them defensively so a single funky validator message can't 500
      // the whole response (real Astitva errors hit this in practice).
      const headerSafe = (s) => s.replace(/[^\x20-\x7E]/g, " ");
      res.setHeader("X-Bundle-Validation", headerSafe(JSON.stringify({
        errors: validation.errors.slice(0, 50),
        warnings: validation.warnings.slice(0, 20),
      })).slice(0, 4000));
      fs.createReadStream(zipPath).pipe(res).on("close", () => {
        fs.rm(tmpDir, { recursive: true, force: true }, () => {});
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
