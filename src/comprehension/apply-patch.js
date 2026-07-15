// src/comprehension/apply-patch.js — deterministic patcher. Applies a validated
// scoping-comprehension correction patch to the draft bundle, per op, each op
// guarded: snapshot the touched files → apply → re-validate → revert on
// regression (non-F2 validator errors must not increase). No LLM. Never throws.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { validateBundle } from "../bundle.js";
import { validatePatch } from "./patch-schema.js";

function rd(dir, f) { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } }
function wr(dir, f, v) { fs.writeFileSync(path.join(dir, f), JSON.stringify(v, null, 2)); }
function isF2(e) { const s = typeof e === "string" ? e : (e?.code || e?.message || ""); return /^\s*F2\b/.test(s) || String(e?.code).toUpperCase() === "F2"; }
function nonF2(dir) { const v = validateBundle(dir); return (v.errors || []).filter((e) => !isF2(e)).length; }

function formsFiles(dir) {
  const fd = path.join(dir, "forms");
  return fs.existsSync(fd) ? fs.readdirSync(fd).filter((n) => n.endsWith(".json")).map((n) => path.join("forms", n)) : [];
}
function eachForm(dir, fn) { for (const rel of formsFiles(dir)) { const j = rd(dir, rel); if (j && fn(j, rel) === true) wr(dir, rel, j); } }
function snapshot(dir, rels) { const s = {}; for (const r of rels) s[r] = fs.existsSync(path.join(dir, r)) ? fs.readFileSync(path.join(dir, r), "utf8") : null; return s; }
function restore(dir, snap) { for (const [r, c] of Object.entries(snap)) { const fp = path.join(dir, r); if (c === null) { if (fs.existsSync(fp)) fs.rmSync(fp); } else fs.writeFileSync(fp, c); } }

// ── op implementations (each returns the rel files it may touch) ──
function opTouchedFiles(dir, op) {
  switch (op.op) {
    case "add-answers": return ["concepts.json", ...formsFiles(dir)];
    case "reclassify-form": return ["formMappings.json", ...formsFiles(dir)];
    case "set-subject": return ["formMappings.json"];
    case "drop-entity": return ["concepts.json", "encounterTypes.json", "operationalEncounterTypes.json", "formMappings.json", ...formsFiles(dir)];
    default: return ["concepts.json", "formMappings.json", ...formsFiles(dir)];
  }
}

function addAnswers(dir, op) {
  const concepts = rd(dir, "concepts.json") || [];
  const target = concepts.find((c) => c && (c.uuid === op.uuid || c.name === op.concept));
  if (!target) return false;
  target.dataType = "Coded";
  target.answers = target.answers || [];
  const have = new Set(target.answers.map((a) => String(a.name).toLowerCase()));
  for (const name of op.answers) {
    if (have.has(String(name).toLowerCase())) continue;
    let ans = concepts.find((c) => c && c.name === name && c.dataType === "NA");
    if (!ans) { ans = { name, uuid: crypto.randomUUID(), dataType: "NA", active: true }; concepts.push(ans); }
    target.answers.push({ name, uuid: ans.uuid, order: target.answers.length });
    have.add(String(name).toLowerCase());
  }
  wr(dir, "concepts.json", concepts);
  // mirror onto embedded copies in form elements
  eachForm(dir, (form) => {
    let touched = false;
    for (const g of form.formElementGroups || []) for (const fe of g.formElements || []) {
      if (fe.concept && typeof fe.concept === "object" && fe.concept.name === target.name) { fe.concept.answers = target.answers.map((a) => ({ ...a })); fe.concept.dataType = "Coded"; touched = true; }
    }
    return touched;
  });
  return true;
}

function reclassifyForm(dir, op) {
  let ok = false;
  eachForm(dir, (form) => { if (form.name === op.form) { form.formType = op.formType; ok = true; return true; } return false; });
  const maps = rd(dir, "formMappings.json") || [];
  for (const m of maps) if (m.formName === op.form) { m.formType = op.formType; ok = true; }
  wr(dir, "formMappings.json", maps);
  return ok;
}

function setSubject(dir, op) {
  const subs = rd(dir, "subjectTypes.json") || [];
  const st = subs.find((s) => s && s.name === op.subjectType);
  if (!st) return false;
  const maps = rd(dir, "formMappings.json") || [];
  let ok = false;
  for (const m of maps) if (m.formName === op.form) { m.subjectTypeUUID = st.uuid; ok = true; }
  if (ok) wr(dir, "formMappings.json", maps);
  return ok;
}

function dropEntity(dir, op) {
  const kind = String(op.entityKind).toLowerCase();
  const match = (e) => e && (e.uuid === op.uuid || e.name === op.name || e.formName === op.name);
  if (kind === "concept") { const a = rd(dir, "concepts.json") || []; const n = a.filter((e) => !match(e)); if (n.length === a.length) return false; wr(dir, "concepts.json", n); return true; }
  if (kind === "encountertype") {
    let ok = false;
    for (const f of ["encounterTypes.json", "operationalEncounterTypes.json"]) { const a = rd(dir, f); if (Array.isArray(a)) { const n = a.filter((e) => !(match(e) || e.encounterTypeUUID === op.uuid)); if (n.length !== a.length) { wr(dir, f, n); ok = true; } } }
    const maps = rd(dir, "formMappings.json") || []; const nm = maps.filter((m) => !(m.formName === op.name)); if (nm.length !== maps.length) { wr(dir, "formMappings.json", nm); ok = true; }
    return ok;
  }
  if (kind === "form") {
    let uuid = op.uuid, ok = false;
    for (const rel of formsFiles(dir)) { const j = rd(dir, rel); if (j && (j.name === op.name || j.uuid === op.uuid)) { uuid = j.uuid; fs.rmSync(path.join(dir, rel)); ok = true; } }
    const maps = rd(dir, "formMappings.json") || []; const nm = maps.filter((m) => !(m.formName === op.name || m.formUUID === uuid)); if (nm.length !== maps.length) { wr(dir, "formMappings.json", nm); ok = true; }
    return ok;
  }
  return false;
}

const OPS = { "add-answers": addAnswers, "reclassify-form": reclassifyForm, "set-subject": setSubject, "drop-entity": dropEntity };

export function applyCorrectionPatch(bundleDir, patch, { revalidate = true } = {}) {
  const out = { applied: [], skipped: [], reverted: [] };
  let valid, dropped;
  try { ({ valid, dropped } = validatePatch(patch)); } catch (e) { return { ...out, error: e.message }; }
  for (const d of dropped) out.skipped.push({ op: d.op?.op, reason: d.reason });
  for (const op of valid) {
    const fn = OPS[op.op];
    if (!fn) { out.skipped.push({ op: op.op, reason: "op-not-implemented" }); continue; }
    const touched = opTouchedFiles(bundleDir, op);
    const snap = revalidate ? snapshot(bundleDir, touched) : null;
    const before = revalidate ? nonF2(bundleDir) : 0;
    let changed = false;
    try { changed = fn(bundleDir, op); } catch (e) { out.skipped.push({ op: op.op, reason: "error:" + e.message }); if (snap) restore(bundleDir, snap); continue; }
    if (!changed) { out.skipped.push({ op: op.op, reason: "no-target" }); continue; }
    if (revalidate && nonF2(bundleDir) > before) { restore(bundleDir, snap); out.reverted.push({ op: op.op, target: op.name || op.form || op.concept }); continue; }
    out.applied.push({ op: op.op, target: op.name || op.form || op.concept });
  }
  out.report = `patch: applied ${out.applied.length}, skipped ${out.skipped.length}, reverted ${out.reverted.length}`;
  return out;
}
