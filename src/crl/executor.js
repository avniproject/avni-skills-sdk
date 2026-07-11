// src/crl/executor.js — the guardrailed, deterministic (NO-LLM) apply/revert
// pass of the CRL. Takes findings (only AiFinding-shaped entries carrying an
// `action` + numeric `confidence` are ever appliable — plain DetFinding
// entries have neither, so they always land in skipped(reason:"flag-only"))
// and applies the high-confidence ones under three CI-tested hard guardrails:
//
//   guardrail 3 — confidence/action gate: only confidence >= threshold AND an
//     appliable action (prune-candidate, or fix-candidate >= fixThreshold with
//     a replacement) are attempted; everything else → skipped.
//   guardrail 1 — never touch a referenced/required entity: before any change,
//     call findReferencesOnDir; if references exist beyond the entity's own
//     record → skipped(reason:"referenced"). For a FORM target the form's OWN
//     formMapping(s) are excluded from this check (MAJ-6): they are pruned
//     together with the form as one unit, so they must not look like a
//     blocking reference.
//   guardrail 2 — revalidate + surgical revert (IC-5): snapshot every file the
//     change touches IN MEMORY (raw bytes), re-run deterministicChecker, and
//     on any deterministic regression restore each touched file from THAT
//     snapshot — never `git checkout HEAD` (which would destroy an agent's
//     uncommitted edits, MAJ-1).
//
// Only `prune-candidate` and confident `fix-candidate` are applied. Pruning is
// scoped to entityKind "concept" and "form"; any other kind throws a clear
// error (fails loud). entityKind matching is case-insensitive — a live model
// can return "Concept" rather than "concept".

import fs from "node:fs";
import path from "node:path";
import { findReferencesOnDir } from "../agents/bundle-mcp-server.js";
import { loadComplianceDoc } from "./compliance-doc.js";
import { deterministicChecker } from "./deterministic-checker.js";

function normKind(k) { return typeof k === "string" ? k.trim().toLowerCase() : k; }

function readConceptArray(raw) { return Array.isArray(raw) ? raw : (raw?.concepts || []); }

function findEntityIndex(arr, target) {
  if (target.uuid) return arr.findIndex((e) => e && e.uuid === target.uuid);
  return arr.findIndex((e) => e && e.name === target.name);
}

// Every reference to `target`, EXCLUDING the entity's own record (same-file,
// jsonPath-prefix match) AND any cross-file exclusions the caller names
// explicitly (MAJ-6: a form's own formMapping entries).
function externalReferences(bundleDir, target, { ownJsonPath = null, crossFileExclusions = [] } = {}) {
  const query = target.uuid ? { uuid: target.uuid } : { name: target.name };
  const r = findReferencesOnDir(bundleDir, query);
  if (!r.ok) return [];
  return r.references.filter((ref) => {
    if (ref.file === target.file) {
      if (ownJsonPath == null) return false; // whole file IS the entity (e.g. a form)
      return ref.jsonPath !== ownJsonPath && !ref.jsonPath.startsWith(ownJsonPath + ".");
    }
    for (const ex of crossFileExclusions) {
      if (ref.file === ex.file && (ref.jsonPath === ex.jsonPath || ref.jsonPath.startsWith(ex.jsonPath + "."))) return false;
    }
    return true;
  });
}

// Indices of formMappings.json entries that belong to THIS form (formUUID
// match) — pruned together with the form (MAJ-6), so excluded from the
// referenced-guard, not counted as an external reference.
function ownFormMappingIndices(bundleDir, formUuid) {
  const fp = path.join(bundleDir, "formMappings.json");
  if (!fs.existsSync(fp)) return [];
  let arr;
  try { arr = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const idxs = [];
  arr.forEach((m, i) => { if (m && m.formUUID === formUuid) idxs.push(i); });
  return idxs;
}

// Which files THIS operation could touch — used to scope the in-memory revert
// snapshot (guardrail 2) and to know what to write.
function candidateFiles(target) {
  return normKind(target.entityKind) === "form" ? [target.file, "formMappings.json"] : [target.file];
}

function snapshotFile(bundleDir, rel) {
  const fp = path.join(bundleDir, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : null;
}
function restoreFile(bundleDir, rel, content) {
  const fp = path.join(bundleDir, rel);
  if (content === null) { if (fs.existsSync(fp)) fs.rmSync(fp); }
  else { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, content); }
}

// A regression is: the checker's overall ok flipped true→false, OR a rule that
// was NOT red before is red now. Keyed on the ACTUAL P1 checker shape
// ({ ok, byRule:{<id>:{ruleId,status:"green"|"red"}} }) — reconciled from the
// master §2.3 perRule[]/pass|fail wording this sub-plan was drafted against.
function regressed(before, after) {
  if (before.ok && !after.ok) return true;
  const beforeRed = new Set(Object.values(before.byRule).filter((r) => r.status === "red").map((r) => r.ruleId));
  for (const r of Object.values(after.byRule)) {
    if (r.status === "red" && !beforeRed.has(r.ruleId)) return true;
  }
  return false;
}

// Remove the concept entity from disk. Returns the files actually touched.
function pruneConcept(bundleDir, target) {
  const fp = path.join(bundleDir, target.file);
  const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
  const arr = readConceptArray(raw);
  const idx = findEntityIndex(arr, target);
  if (idx === -1) throw new Error(`executor: prune target not found in ${target.file}: ${target.uuid || target.name}`);
  arr.splice(idx, 1);
  fs.writeFileSync(fp, JSON.stringify(Array.isArray(raw) ? arr : { ...raw, concepts: arr }, null, 2));
  return { filesTouched: [target.file] };
}

// Prune a form AND its own formMapping(s) as one unit (MAJ-6). Returns the
// files actually touched.
function pruneForm(bundleDir, target) {
  const fp = path.join(bundleDir, target.file);
  if (!fs.existsSync(fp)) throw new Error(`executor: prune target file not found: ${target.file}`);
  fs.rmSync(fp);
  const filesTouched = [target.file];
  const mapFp = path.join(bundleDir, "formMappings.json");
  if (fs.existsSync(mapFp)) {
    const arr = JSON.parse(fs.readFileSync(mapFp, "utf8"));
    if (Array.isArray(arr)) {
      const remaining = arr.filter((m) => !(m && m.formUUID === target.uuid));
      if (remaining.length !== arr.length) {
        fs.writeFileSync(mapFp, JSON.stringify(remaining, null, 2));
        filesTouched.push("formMappings.json");
      }
    }
  }
  return { filesTouched };
}

function pruneEntity(bundleDir, target) {
  if (normKind(target.entityKind) === "concept") return pruneConcept(bundleDir, target);
  if (normKind(target.entityKind) === "form") return pruneForm(bundleDir, target);
  throw new Error(`executor: prune not supported for entityKind "${target.entityKind}" (only "concept" and "form" in this delivery)`);
}

// Apply a confident fix-candidate — write the finding's `replacement` in place
// of the target entity (O-3). Concept fixes replace the array slot; the entity
// keeps its uuid, so references stay valid (guardrail 2 catches any regression).
function applyFix(bundleDir, target, replacement) {
  if (normKind(target.entityKind) === "concept") {
    const fp = path.join(bundleDir, target.file);
    const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    const arr = readConceptArray(raw);
    const idx = findEntityIndex(arr, target);
    if (idx === -1) throw new Error(`executor: fix target not found in ${target.file}: ${target.uuid || target.name}`);
    arr[idx] = replacement;
    fs.writeFileSync(fp, JSON.stringify(Array.isArray(raw) ? arr : { ...raw, concepts: arr }, null, 2));
    return { filesTouched: [target.file] };
  }
  throw new Error(`executor: fix not supported for entityKind "${target.entityKind}" (only "concept" in this delivery)`);
}

// Compute the ownJsonPath / crossFileExclusions the referenced-guard needs for
// this target kind (concept: exclude its own array slot; form: exclude its own
// formMapping entries, MAJ-6).
function guardExclusions(bundleDir, target) {
  if (normKind(target.entityKind) === "concept") {
    const fp = path.join(bundleDir, target.file);
    const arr = readConceptArray(JSON.parse(fs.readFileSync(fp, "utf8")));
    const idx = findEntityIndex(arr, target);
    return { ownJsonPath: idx !== -1 ? `[${idx}]` : null, crossFileExclusions: [] };
  }
  if (normKind(target.entityKind) === "form") {
    return {
      ownJsonPath: null,
      crossFileExclusions: ownFormMappingIndices(bundleDir, target.uuid).map((i) => ({ file: "formMappings.json", jsonPath: `[${i}]` })),
    };
  }
  return { ownJsonPath: null, crossFileExclusions: [] };
}

function buildReport(det, applied, reverted, skipped) {
  const rules = Object.values(det.byRule).map((r) => ({
    ruleId: r.ruleId, tag: "deterministic",
    status: r.status === "green" ? "pass" : "unresolved",
  }));
  for (const a of applied) rules.push({ ruleId: a.ruleId, tag: "ai-judged", status: "resolved", action: a.op });
  for (const r of reverted) rules.push({ ruleId: r.ruleId, tag: "ai-judged", status: "unresolved", reason: r.reason });
  for (const s of skipped) rules.push({ ruleId: s.ruleId, tag: "ai-judged", status: "flagged", reason: s.reason });
  return { rules, ok: det.ok && reverted.length === 0 };
}

/**
 * @param {string} bundleDir
 * @param {object[]} findings  (DetFinding|AiFinding)[]
 * @param {object} [opts] { confidenceThreshold=0.85, fixThreshold=0.9, dryRun=false, referencedGuard=true, revalidate=true, doc }
 * @returns {Promise<{applied:object[], reverted:object[], skipped:object[], report:object}>}
 */
export async function executor(bundleDir, findings, opts = {}) {
  const {
    confidenceThreshold = 0.85,
    fixThreshold = 0.9,
    dryRun = false,
    referencedGuard = true,
    revalidate = true,
    doc = loadComplianceDoc(),
  } = opts;
  const applied = [];
  const reverted = [];
  const skipped = [];

  for (const f of findings) {
    // guardrail 3 — action / confidence gate. prune-candidate uses
    // confidenceThreshold; fix-candidate uses the higher fixThreshold on
    // fixConfidence (falling back to confidence). A fix with no replacement
    // has nothing to apply → flag-only.
    const isPrune = f.action === "prune-candidate";
    const isFix = f.action === "fix-candidate";
    if (typeof f.confidence !== "number" || !f.action) { skipped.push({ ruleId: f.ruleId, target: f.target || null, reason: "flag-only" }); continue; }
    if (!isPrune && !isFix) { skipped.push({ ruleId: f.ruleId, target: f.target, reason: "flag-only" }); continue; }
    if (isFix && f.replacement == null) { skipped.push({ ruleId: f.ruleId, target: f.target, reason: "flag-only" }); continue; }
    const conf = isFix ? (typeof f.fixConfidence === "number" ? f.fixConfidence : f.confidence) : f.confidence;
    const threshold = isFix ? fixThreshold : confidenceThreshold;
    if (conf < threshold) { skipped.push({ ruleId: f.ruleId, target: f.target, reason: "below-threshold" }); continue; }

    // guardrail 1 — never touch a referenced/required entity
    if (referencedGuard) {
      const { ownJsonPath, crossFileExclusions } = guardExclusions(bundleDir, f.target);
      const external = externalReferences(bundleDir, f.target, { ownJsonPath, crossFileExclusions });
      if (external.length > 0) { skipped.push({ ruleId: f.ruleId, target: f.target, reason: "referenced" }); continue; }
    }

    const op = isFix ? "fix" : "prune";
    if (dryRun) { applied.push({ ruleId: f.ruleId, target: f.target, op, filesTouched: candidateFiles(f.target) }); continue; }

    // guardrail 2 — snapshot → apply → revalidate → surgical revert on regression
    const candidates = candidateFiles(f.target);
    const preSnapshot = revalidate ? Object.fromEntries(candidates.map((rel) => [rel, snapshotFile(bundleDir, rel)])) : null;
    const before = revalidate ? await deterministicChecker(bundleDir, doc) : null;
    const { filesTouched } = isFix ? applyFix(bundleDir, f.target, f.replacement) : pruneEntity(bundleDir, f.target);

    if (revalidate) {
      const after = await deterministicChecker(bundleDir, doc);
      if (regressed(before, after)) {
        for (const rel of filesTouched) restoreFile(bundleDir, rel, preSnapshot[rel]);
        reverted.push({ ruleId: f.ruleId, target: f.target, reason: "regression" });
        continue;
      }
    }
    applied.push({ ruleId: f.ruleId, target: f.target, op, filesTouched });
  }

  const det = await deterministicChecker(bundleDir, doc);
  const report = buildReport(det, applied, reverted, skipped);
  return { applied, reverted, skipped, report };
}
