// Rules endpoints (rules-brain):
//   GET /v1/sessions/:id/rules                — list every populated rule, classified
//   GET /v1/sessions/:id/rules/validation     — Layer-4 static validator across all rules
//   PUT /v1/sessions/:id/rules                — { updates: [{file, field, ir?, js?}, ...] }
//
// Each update either supplies IR (compiled via rules-config DeclarativeRuleHolder
// → JS) or pre-baked JS; both paths land at sessions.commitTurn() like /edit.

import fs from "node:fs";
import path from "node:path";
import * as sessions from "../sessions.js";
import * as rulesCompile from "../rules-brain/compile.js";
import { validateBundleRules as runRulesValidator } from "../rules-brain/validate.js";

function guessCarrier(relPath) {
  if (relPath.startsWith("forms/")) return "form";
  if (relPath.endsWith("encounterTypes.json")) return "encounterType";
  if (relPath.endsWith("programs.json")) return "program";
  if (relPath.endsWith("subjectTypes.json")) return "subjectType";
  if (relPath.endsWith("organisationConfig.json")) return "organisationConfig";
  return "unknown";
}

function listAllRulesInBundle(dir) {
  const out = [];
  const FORM_FIELDS = ["decisionRule", "visitScheduleRule", "validationRule", "checklistsRule", "editFormRule"];
  const formsDir = path.join(dir, "forms");
  if (fs.existsSync(formsDir)) {
    for (const fn of fs.readdirSync(formsDir)) {
      if (!fn.endsWith(".json")) continue;
      const fp = path.join(formsDir, fn);
      let f; try { f = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
      for (const fld of FORM_FIELDS) {
        if (typeof f[fld] === "string" && f[fld].trim()) {
          out.push({ file: `forms/${fn}`, entity: "form", entityName: f.name, field: fld, bytes: f[fld].length });
        }
      }
      for (const g of (f.formElementGroups || [])) {
        for (const el of (g.formElements || [])) {
          if (typeof el.rule === "string" && el.rule.trim()) {
            out.push({ file: `forms/${fn}`, entity: "formElement", entityName: el.name, field: "rule", bytes: el.rule.length });
          }
        }
      }
    }
  }
  const scan = (file, fields, entity) => {
    const fp = path.join(dir, file);
    if (!fs.existsSync(fp)) return;
    let arr; try { arr = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return; }
    if (!Array.isArray(arr)) arr = [arr];
    for (const it of arr) for (const f of fields) {
      if (typeof it[f] === "string" && it[f].trim()) {
        out.push({ file, entity, entityName: it.name, field: f, bytes: it[f].length });
      }
    }
  };
  scan("encounterTypes.json", ["encounterEligibilityCheckRule"], "encounterType");
  scan("programs.json", ["enrolmentEligibilityCheckRule", "manualEnrolmentEligibilityCheckRule", "enrolmentSummaryRule"], "program");
  scan("subjectTypes.json", ["subjectSummaryRule"], "subjectType");
  scan("organisationConfig.json", ["worklistUpdationRule"], "organisationConfig");
  return out;
}

export function register(app) {
  app.get("/v1/sessions/:id/rules", (req, res) => {
    try {
      const dir = sessions.bundleDir(req.params.id);
      const rules = listAllRulesInBundle(dir);
      res.json({ sessionId: req.params.id, count: rules.length, rules });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/v1/sessions/:id/rules/validation", async (req, res) => {
    try {
      const dir = sessions.bundleDir(req.params.id);
      const result = await runRulesValidator(dir);
      const summary = {
        errors: result.errors.length,
        warnings: result.warnings.length,
        filesAffected: Object.keys(result.byFile).length,
      };
      res.json({ sessionId: req.params.id, summary, ...result });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/v1/sessions/:id/rules", (req, res) => {
    try {
      const { summary, updates, formType } = req.body || {};
      if (!summary) return res.status(400).json({ error: "summary required" });
      if (!Array.isArray(updates) || updates.length === 0) return res.status(400).json({ error: "updates[] required" });
      const dir = sessions.bundleDir(req.params.id);
      const edits = {}; // file relPath → new content
      const compiled = []; // log of what we did
      for (const u of updates) {
        const fp = path.join(dir, u.file);
        if (!fp.startsWith(dir + path.sep)) return res.status(400).json({ error: `path traversal: ${u.file}` });
        if (!fs.existsSync(fp)) return res.status(400).json({ error: `file not found: ${u.file}` });
        const json = JSON.parse(fs.readFileSync(fp, "utf8"));
        const field = u.field;
        let js = u.js;
        if (u.ir) {
          const fieldPath = `${guessCarrier(u.file)}.${field}`;
          const r = rulesCompile.compileByField(u.ir, fieldPath, { formType });
          if (r.error) return res.status(400).json({ error: `compile failed for ${u.file}#${field}: ${r.error}` });
          js = r.js || "";
        }
        if (typeof js !== "string") return res.status(400).json({ error: `${u.file}#${field}: ir or js required` });
        // Apply field on the JSON. If the file is an array (e.g. concepts.json
        // shaped lists), this caller pattern doesn't apply — keep it simple
        // and only patch object-shaped bundle JSONs.
        if (Array.isArray(json)) return res.status(400).json({ error: `${u.file}: array-shaped JSON not supported by this endpoint` });
        json[field] = js;
        edits[u.file] = JSON.stringify(json, null, 2);
        compiled.push({ file: u.file, field, mode: u.ir ? "ir" : "js", bytes: js.length });
      }
      const turn = sessions.commitTurn(req.params.id, summary, edits);
      res.json({ ...turn, compiled });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
