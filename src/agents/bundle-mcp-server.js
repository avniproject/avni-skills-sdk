// In-process MCP server exposing deterministic bundle operations as named
// tools. The agent calls these instead of free-form Bash + ad-hoc scripts.
//
// Why: audit of sess_7b4a7ad42b244487 showed the agent burning $0.20+ on
// "fix the error" turns where it never even ran the concept-lookup gate,
// hallucinated codes, and committed unrelated whitespace changes. Explicit
// typed tools with structured I/O are the Claude-Code-style pattern that
// keeps agents on rails — they can't "forget" to call a tool the way they
// forget to run a Bash one-liner.
//
// All tools operate on the per-request bundle directory captured at server
// construction time. The factory is invoked PER session/request so the
// closure binds the correct bundle path — `process.cwd()` is NOT safe here
// because @anthropic-ai/claude-agent-sdk runs in-process tool handlers in
// the host server process (the server's startup cwd, not the session dir).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import XLSX from "xlsx"; // SheetJS is CJS — default import gives module.exports (readFile/utils/write)
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { validateBundle, generateBundle, zipBundle as zipBundleDir } from "../bundle.js";
import { applySpec, emitSpec } from "../pipeline.js";
import { BUNDLE_TOOL_NAMES as FROZEN_BUNDLE_TOOL_NAMES } from "./bundle-mcp-tool-names.js";

// ─── brain dependency-graph loader (yaml-driven, single source of truth) ──
//
// The FK / edge integrity logic lives in the BRAIN (avni-skills), not here.
// As of #14 the brain's spec/graph.js is a generic interpreter that emits one
// edge per rule declared in spec/fk-matrix.yaml — so it is the single source
// of truth for EVERY edge kind, including the graph-only ones the SDK's old
// local `checkIntegrityOnFileMap` never covered (encounterType.conceptUuid,
// form.decisionConcepts[], addressLevelType.parentUuid, groupRoles,
// formMapping.taskTypeUUID). `bundle_integrity_check` builds the graph in
// memory from a file map and runs the brain's `integrityCheck`, so it inherits
// full, yaml-driven edge coverage with zero duplicated FK logic.
//
// Resolve the brain the SAME way the rest of the SDK does (env var or sibling
// clone) — mirrors src/pipeline.js + tests/entities/spec-graph.test.cjs.
const require = createRequire(import.meta.url);

function resolveBrainPath() {
  if (process.env.AVNI_SKILLS_PATH) return process.env.AVNI_SKILLS_PATH;
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "avni-skills");
}

// Load buildBundleGraph + integrityCheck from the brain. FAIL LOUD if the brain
// is missing or is an OLD build without the file-map-capable buildBundleGraph
// (#14) — we must NOT silently fall back to partial coverage, because that
// would re-open exactly the graph-only-edge gap this tool exists to close.
function loadBrainGraph() {
  const brainPath = resolveBrainPath();
  const graphModulePath = path.join(brainPath, "srs-bundle-generator/spec/graph.js");
  let mod;
  try {
    mod = require(graphModulePath);
  } catch (e) {
    throw new Error(
      `bundle_integrity_check could not load the avni-skills dependency graph from ` +
      `"${graphModulePath}". Set AVNI_SKILLS_PATH to a checkout of avni-skills that ` +
      `includes the yaml-driven graph (buildBundleGraph(fileMap) + MISSING_REQUIRED_REF). ` +
      `Underlying error: ${e.message}`,
    );
  }
  const { buildBundleGraph, integrityCheck } = mod;
  if (typeof buildBundleGraph !== "function" || typeof integrityCheck !== "function") {
    throw new Error(
      `bundle_integrity_check loaded "${graphModulePath}" but it does not export ` +
      `buildBundleGraph + integrityCheck. AVNI_SKILLS_PATH points at an incompatible ` +
      `avni-skills build — it must be one with the #14 yaml-driven graph.`,
    );
  }
  return { buildBundleGraph, integrityCheck };
}

// MCP CallToolResult helper — wrap a JS value as a text content block.
function textResult(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }] };
}

function errorResult(message) {
  return { content: [{ type: "text", text: `ERROR: ${message}` }], isError: true };
}

// ─── export path jail ───────────────────────────────────────────────
// Audit C3: an adversarial SRS could induce the agent to write the zip to
// `~/../etc/cron.d` or similar. We only permit writes under a small set of
// user-visible directories (plus an ops-overridable env var).

function expandTilde(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function buildAllowedRoots() {
  const home = os.homedir();
  const roots = [
    path.resolve(path.join(home, "Desktop")),
    path.resolve(path.join(home, "Downloads")),
    path.resolve(path.join(home, "Documents")),
    path.resolve(path.join(home, ".avni-skills-sdk", "exports")),
  ];
  const override = process.env.SDK_EXPORT_DIR;
  if (override && override.trim()) {
    roots.push(path.resolve(expandTilde(override.trim())));
  }
  return roots;
}

/**
 * Validate that `destPath` (which may end in .zip or be a directory) resolves
 * to a path strictly inside one of the allowed export roots.
 *
 * Returns `{ ok: true, finalPath }` (absolute, .zip) on success, or
 * `{ ok: false, error }` otherwise. Auto-creates `~/.avni-skills-sdk/exports`.
 */
export function resolveExportPath(destPath, org) {
  if (typeof destPath !== "string" || !destPath.trim()) {
    return { ok: false, error: "destPath is required" };
  }
  const allowedRoots = buildAllowedRoots();
  // Auto-create the dedicated exports root so it exists for the prefix check.
  const exportsRoot = path.resolve(path.join(os.homedir(), ".avni-skills-sdk", "exports"));
  try { fs.mkdirSync(exportsRoot, { recursive: true }); } catch {}

  const expanded = expandTilde(destPath.trim());
  // path.resolve normalises `..` segments against cwd if relative.
  const resolved = path.resolve(expanded);

  // Decide whether this is a file or dir target. If it ends in .zip we treat
  // as file; otherwise as directory and append `<org>.zip`.
  let finalPath;
  if (resolved.toLowerCase().endsWith(".zip")) {
    finalPath = resolved;
  } else {
    finalPath = path.join(resolved, `${org || "Bundle"}.zip`);
  }

  // The PARENT directory of finalPath must sit inside an allowed root.
  // (Equivalently: finalPath itself must.) We use path.relative — if it
  // starts with `..` or is absolute, the target escaped the jail.
  const allowedRoot = allowedRoots.find((root) => {
    const rel = path.relative(root, finalPath);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!allowedRoot) {
    const list = allowedRoots.map((r) => `  - ${r}`).join("\n");
    return {
      ok: false,
      error:
        `destination "${destPath}" resolves to "${finalPath}" which is OUTSIDE the allowed export roots. ` +
        `Pick a path under one of:\n${list}\n` +
        `(Or set SDK_EXPORT_DIR to whitelist another directory.)`,
    };
  }
  return { ok: true, finalPath, allowedRoot };
}

// ─── tools ──────────────────────────────────────────────────────────
//
// Each tool factory takes the captured `bundleCwd` so the handler closes
// over the correct per-session bundle directory (NOT process.cwd()).

function buildValidatorTool(bundleCwd) {
  return tool(
    "bundle_validator_run",
    "Run the AVNI bundle validator on the current bundle. Returns structured JSON with valid:boolean, errors:string[], warnings:string[], groups:{code:count}. Use this BEFORE making any edit and AFTER, to confirm the delta. Cheaper and more reliable than running the validator via Bash.",
    {},
    async () => {
      try {
        const r = validateBundle(bundleCwd);
        const groups = {};
        for (const e of r.errors) {
          const k = (e.match(/^([A-Z][0-9]+)/) || ["?"])[0];
          groups[k] = (groups[k] || 0) + 1;
        }
        return textResult({
          valid: r.valid,
          errorCount: r.errors.length,
          warningCount: r.warnings.length,
          groups,
          errors: r.errors,
          warnings: r.warnings,
        });
      } catch (e) {
        return errorResult(e.message);
      }
    },
  );
}

function buildFindConceptTool(bundleCwd) {
  return tool(
    "bundle_find_concept",
    "Case-insensitive lookup of a concept by name in the current bundle's concepts.json. Returns guidance on whether to REUSE an existing UUID (exact match) or whether it's SAFE to add a new concept. ALWAYS call this before adding a new concept — concept names collide case-insensitively per C3/D1 validator. Replaces the legacy scripts/agent-tools/find-concept.mjs CLI wrapper.",
    { name: z.string().describe("Concept name to look up (case-insensitive)") },
    async ({ name }) => {
      try {
        const fp = path.join(bundleCwd, "concepts.json");
        if (!fs.existsSync(fp)) return errorResult("concepts.json not found in bundle");
        const concepts = JSON.parse(fs.readFileSync(fp, "utf8"));
        const needle = String(name || "").trim().toLowerCase();
        if (!needle) return errorResult("name is required");
        const exact = concepts.filter((c) => String(c.name || "").trim().toLowerCase() === needle);
        const prefix = concepts.filter((c) =>
          String(c.name || "").trim().toLowerCase().startsWith(needle) && !exact.includes(c),
        ).slice(0, 5);
        let guidance;
        if (exact.length === 1) {
          guidance = `EXACT MATCH. REUSE UUID ${exact[0].uuid} (dataType=${exact[0].dataType}). Do NOT add a new concept. Use this UUID in your edit.`;
        } else if (exact.length > 1) {
          guidance = `Multiple case-insensitive matches (${exact.length}). Pick one UUID to reuse (or ask the user). Do NOT add another duplicate.`;
        } else if (prefix.length > 0) {
          guidance = `No exact match. ${prefix.length} prefix matches — confirm none are what you want before adding new. If none match, it is SAFE to add a new concept named "${name}".`;
        } else {
          guidance = `No matches. SAFE to add a new concept named "${name}".`;
        }
        return textResult({ query: name, exact, prefix, guidance });
      } catch (e) {
        return errorResult(e.message);
      }
    },
  );
}

// ─── bundle-wide reference finder (story #13 tool promotion) ─────────
//
// Promotes scripts/agent-tools/find-references.mjs (a CLI) to a first-class MCP
// tool. Scans every entity JSON + forms/*.json for a target UUID or concept
// name, returning the full blast radius so the agent can see EVERY reference
// before a rename / dedup — the discovery harness (d8 multi-file-rename) and
// eval case 05 (rename-concept) both hinge on finding ALL references first.
// Rule strings (decisionRule etc.) are scanned as text, so a UUID embedded in a
// rule body is found. Pure/deterministic; exported for unit testing.

const REFERENCE_SCAN_FILES = [
  "concepts.json", "subjectTypes.json", "programs.json", "encounterTypes.json",
  "formMappings.json", "organisationConfig.json",
  "operationalSubjectTypes.json", "operationalPrograms.json", "operationalEncounterTypes.json",
  "groupPrivilege.json", "groups.json", "groupRoles.json", "groupRole.json",
  "addressLevelTypes.json", "individualRelation.json", "relationshipType.json", "taskTypes.json",
];

export function findReferencesOnDir(bundleCwd, { uuid, name } = {}) {
  const target = (typeof uuid === "string" && uuid.trim()) ? uuid.trim()
    : (typeof name === "string" && name.trim()) ? name.trim()
    : null;
  if (!target) {
    return { ok: false, error: "provide either { uuid } or { name } to search for" };
  }
  const mode = (typeof uuid === "string" && uuid.trim()) ? "uuid" : "name";
  const refs = [];

  const walk = (node, jsonPath, file) => {
    if (node == null) return;
    if (typeof node === "string") {
      if (node.includes(target)) {
        refs.push({ file, jsonPath, value: node.length > 200 ? node.slice(0, 200) + "…" : node, kind: "string-contains" });
      }
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${jsonPath}[${i}]`, file);
      return;
    }
    if (typeof node === "object") {
      if (mode === "name" && node.name === target) {
        refs.push({ file, jsonPath, kind: "name-field-exact", uuid: node.uuid, dataType: node.dataType });
      }
      if (mode === "uuid" && node.uuid === target) {
        refs.push({ file, jsonPath, kind: "uuid-field-exact", name: node.name, dataType: node.dataType });
      }
      for (const [k, v] of Object.entries(node)) walk(v, jsonPath ? `${jsonPath}.${k}` : k, file);
    }
  };

  for (const rel of REFERENCE_SCAN_FILES) {
    const fp = path.join(bundleCwd, rel);
    if (!fs.existsSync(fp)) continue;
    let json;
    try { json = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
    walk(json, "", rel);
  }
  const formsDir = path.join(bundleCwd, "forms");
  if (fs.existsSync(formsDir)) {
    for (const fn of fs.readdirSync(formsDir)) {
      if (!fn.endsWith(".json")) continue;
      let json;
      try { json = JSON.parse(fs.readFileSync(path.join(formsDir, fn), "utf8")); } catch { continue; }
      walk(json, "", `forms/${fn}`);
    }
  }

  const byFile = {};
  for (const r of refs) (byFile[r.file] ||= []).push(r);
  return {
    ok: true,
    query: { mode, value: target },
    totalReferences: refs.length,
    filesAffected: Object.keys(byFile).length,
    byFile,
    references: refs,
  };
}

function buildFindReferencesTool(bundleCwd) {
  return tool(
    "bundle_find_references",
    "Find EVERY reference to a concept/entity UUID or name across the whole bundle (all entity JSON + forms/*.json, including UUIDs embedded inside rule strings). Returns { totalReferences, filesAffected, byFile, references }. Call this BEFORE a rename or dedup so you know the full blast radius and don't leave a dangling reference behind (F5). Deterministic — prefer it over Bash grep. Promoted from scripts/agent-tools/find-references.mjs.",
    {
      uuid: z.string().optional().describe("UUID to find every reference to (exact + substring, incl. rule bodies)"),
      name: z.string().optional().describe("Concept/entity name to find (exact name-field matches + substring)"),
    },
    async ({ uuid, name }) => {
      const r = findReferencesOnDir(bundleCwd, { uuid, name });
      return r.ok ? textResult(r) : errorResult(r.error);
    },
  );
}

function buildSummaryTool(bundleCwd) {
  return tool(
    "bundle_summary",
    "Quick deterministic summary of the current bundle: counts of concepts, subjectTypes, programs, encounterTypes, forms, formMappings. Use this to orient yourself BEFORE reading specific files. Free, instant, no validator overhead.",
    {},
    async () => {
      try {
        const readJson = (rel) => {
          const fp = path.join(bundleCwd, rel);
          if (!fs.existsSync(fp)) return null;
          return JSON.parse(fs.readFileSync(fp, "utf8"));
        };
        const arrOf = (val, key) => {
          if (Array.isArray(val)) return val;
          if (val && typeof val === "object" && Array.isArray(val[key])) return val[key];
          return [];
        };
        const concepts = readJson("concepts.json") || [];
        const subjectTypes = readJson("subjectTypes.json") || [];
        const programs = readJson("programs.json") || [];
        const encounterTypes = readJson("encounterTypes.json") || [];
        const formMappings = readJson("formMappings.json") || [];
        const formsDir = path.join(bundleCwd, "forms");
        const forms = fs.existsSync(formsDir) ? fs.readdirSync(formsDir).filter((f) => f.endsWith(".json")) : [];
        const operationalSubjectTypes = arrOf(readJson("operationalSubjectTypes.json"), "operationalSubjectTypes");
        const operationalPrograms = arrOf(readJson("operationalPrograms.json"), "operationalPrograms");
        const operationalEncounterTypes = arrOf(readJson("operationalEncounterTypes.json"), "operationalEncounterTypes");
        return textResult({
          counts: {
            concepts: concepts.length,
            subjectTypes: subjectTypes.length,
            programs: programs.length,
            encounterTypes: encounterTypes.length,
            forms: forms.length,
            formMappings: formMappings.length,
            operationalSubjectTypes: operationalSubjectTypes.length,
            operationalPrograms: operationalPrograms.length,
            operationalEncounterTypes: operationalEncounterTypes.length,
          },
          subjectTypeNames: subjectTypes.map((s) => s.name),
          programNames: programs.map((p) => p.name),
          encounterTypeNames: encounterTypes.map((e) => e.name),
          formNames: forms.map((f) => f.replace(/_[0-9a-f-]+\.json$/, "")),
        });
      } catch (e) {
        return errorResult(e.message);
      }
    },
  );
}

/**
 * Zip the bundle at `bundleCwd` to `destPath` (path-jailed), REFUSING to write
 * anything if the bundle has any data-integrity ERROR.
 *
 * This is the HARD SHIP GATE (FIX 1b): a clean local validator does NOT
 * guarantee a clean AVNI upload — FE_CONCEPT_NOT_OBJECT (Durga), ALT_INVALID_NAME
 * (Astitva), and dangling REQUIRED refs all pass the validator yet crash the
 * server on upload. runBundleIntegrityCheck is the deterministic gate; we run it
 * BEFORE zipping and refuse (isError) on any severity:error finding, so a dirty
 * bundle can never leave the system via this tool. Returns an MCP CallToolResult;
 * never throws. Exported for unit testing (mirrors specApplyOnDir / specEmitOnDir).
 */
export async function exportBundleToPath(bundleCwd, destPath) {
  try {
    // Determine org name from meta — try ../meta.json (session dir parent of bundle dir)
    let org = "Bundle";
    try {
      const metaFp = path.join(bundleCwd, "..", "meta.json");
      if (fs.existsSync(metaFp)) {
        org = JSON.parse(fs.readFileSync(metaFp, "utf8")).org || org;
      }
    } catch {}

    // HARD INTEGRITY GATE at the ship boundary. Never zip a bundle AVNI will
    // reject. A load failure of the brain graph is itself a refusal — we do not
    // silently ship an unchecked bundle.
    let integrity;
    try {
      integrity = runBundleIntegrityCheck(bundleCwd);
    } catch (e) {
      return errorResult(
        `cannot export — the data-integrity check could not run (${e.message}). ` +
        `Fix the environment (AVNI_SKILLS_PATH must point at an avni-skills build with the yaml graph) and retry. ` +
        `The bundle was NOT written.`,
      );
    }
    if (!integrity.ok) {
      const errs = integrity.findings.filter((f) => f.severity === "error");
      const shown = errs.slice(0, 20)
        .map((f) => `  • [${f.code}] ${f.file} ${f.locator} — ${f.message}`)
        .join("\n");
      return errorResult(
        `REFUSING TO EXPORT: the bundle has ${errs.length} data-integrity error(s) that AVNI rejects ` +
        `on upload (a clean validator does NOT guarantee a clean upload). Fix these, re-run ` +
        `bundle_integrity_check to confirm zero errors, then export again — nothing was written:\n${shown}` +
        (errs.length > 20 ? `\n  … and ${errs.length - 20} more` : ""),
      );
    }

    const jail = resolveExportPath(destPath, org);
    if (!jail.ok) return errorResult(jail.error);
    const finalPath = jail.finalPath;

    // Ensure parent dir exists (it's already proven to be inside the jail).
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    const result = await zipBundleDir(bundleCwd, finalPath);
    return textResult({
      ok: true,
      zipPath: finalPath,
      bytes: result?.bytes || (fs.existsSync(finalPath) ? fs.statSync(finalPath).size : 0),
      message: `Bundle exported to ${finalPath}`,
    });
  } catch (e) {
    return errorResult(`failed to export: ${e.message}`);
  }
}

function buildExportTool(bundleCwd) {
  return tool(
    "bundle_export_to_path",
    'Zip the current bundle and copy it to a destination path. Use this when the user asks to "save the bundle", "put the bundle on Desktop", "download the bundle", "give me the zip". REFUSES to write if the bundle has any data-integrity error (runs bundle_integrity_check first — a clean validator does NOT guarantee a clean upload). Destination MUST be inside one of the allowed roots (~/Desktop, ~/Downloads, ~/Documents, ~/.avni-skills-sdk/exports, or $SDK_EXPORT_DIR if set) — paths that escape are rejected. Tildes are resolved. Returns the absolute path of the written file.',
    {
      destPath: z.string().describe('Destination — either a directory (where the zip is named <Org>.zip) or a full file path ending in .zip. Tildes resolved (e.g. "~/Desktop"). Must resolve to a path inside an allowed export root.'),
    },
    async ({ destPath }) => exportBundleToPath(bundleCwd, destPath),
  );
}

// ─── deterministic data-integrity checks ────────────────────────────
//
// Two real shipped incidents motivated this tool — both slipped past BOTH the
// local validator AND the model:
//
//   • Durga  — a "fix all errors" turn flattened formElement `concept` objects
//     down to bare UUID strings. The local validator was happy; the AVNI
//     server expects a nested ConceptContract object and Jackson crashed on
//     deserialize. → FE_CONCEPT_NOT_OBJECT.
//
//   • Astitva — addressLevelType names carried URLs / arrow chains / empty
//     strings copied from an SRS hierarchy diagram. The local validator never
//     checked name chars; the AVNI LocationService rejected them on upload.
//     → ALT_INVALID_NAME.
//
// These are deterministic structural checks, not heuristics. Findings are
// returned as normal tool output (an array), NOT thrown.

// Mirrors avni-server ValidationUtil.COMMON_INVALID_CHARS_PATTERN
// (^.*[<>="'].*$), enforced by LocationService.createAddressLevelTypes — NOT a
// port of summarizer.js (the summarizer used different URL / arrow-chain
// heuristics). This rejects addressLevelType names that are empty or contain
// any of < > = " '. Kept local (not imported) so this safety check has no
// cross-module coupling to the advisory summarizer.
function invalidLocationLevelNameReason(name) {
  if (!name || typeof name !== "string") return "empty";
  const t = name.trim();
  if (!t) return "empty";
  if (/[<>="']/.test(t)) return "contains a character AVNI rejects (< > = \" ')";
  return null;
}

// FE_CONCEPT_NOT_OBJECT shape predicate. The avni-server's
// FormElementContract.validate() fails whenever the deserialized concept is
// null, has no UUID, or (the Durga incident) was flattened to a bare UUID
// string that Jackson can't map onto a ConceptContract object. This is a pure
// SHAPE check — a well-shaped { uuid, ... } object is ACCEPTED here even if that
// uuid is dangling; resolving dangling UUIDs is the FK check's separate job.
// Returns a stable reason key (or null when the shape is valid).
function invalidConceptShapeReason(concept) {
  if (concept === null || concept === undefined) return "missing";      // server: "Concept UUID Not Provided"
  if (typeof concept === "string") return "bare-string";                // Durga: bare UUID string → Jackson crash
  if (typeof concept !== "object" || Array.isArray(concept)) return "not-object"; // number/bool/array etc.
  if (typeof concept.uuid !== "string" || !concept.uuid.trim()) return "no-uuid"; // object without a real uuid
  return null;
}

// Read a bundle directory into the file map shape the brain's buildBundleGraph
// and the shape checks expect: { "concepts.json": [...], "forms/<f>.json": {...}, ... }
// (POSIX-slash keys). The top-level list MUST cover every source the brain's
// fk-matrix.yaml `nodeKinds` loads from — otherwise an entity present on disk
// is invisible to the graph and its edges silently vanish. In particular
// groupRoles.json is REQUIRED here: groupRole is a noded kind whose two FKs to
// subjectType are graph-only edges (the old local checker never saw them).
// groups/groupPrivilege/taskTypes are listed for completeness; the brain does
// not node them yet (#14 follow-up) so they only appear as dangling targets.
function readBundleFileMap(bundleCwd) {
  const files = {};
  const topLevel = [
    "concepts.json",
    "subjectTypes.json",
    "programs.json",
    "encounterTypes.json",
    "formMappings.json",
    "operationalSubjectTypes.json",
    "operationalPrograms.json",
    "operationalEncounterTypes.json",
    "addressLevelTypes.json",
    "groupRoles.json",
    "groups.json",
    "groupPrivilege.json",
    "taskTypes.json",
  ];
  for (const rel of topLevel) {
    const fp = path.join(bundleCwd, rel);
    if (fs.existsSync(fp)) {
      try { files[rel] = JSON.parse(fs.readFileSync(fp, "utf8")); }
      catch { /* malformed JSON is the validator's job, not ours */ }
    }
  }
  const formsDir = path.join(bundleCwd, "forms");
  if (fs.existsSync(formsDir)) {
    for (const f of fs.readdirSync(formsDir)) {
      if (!f.endsWith(".json")) continue;
      const fp = path.join(formsDir, f);
      try { files[`forms/${f}`] = JSON.parse(fs.readFileSync(fp, "utf8")); }
      catch { /* malformed JSON is the validator's job */ }
    }
  }
  return files;
}

/**
 * Run deterministic data-integrity checks on a bundle directory.
 *
 * Combines:
 *   (a) FK / dangling-reference integrity — built from the BRAIN's yaml-driven
 *       dependency graph (buildBundleGraph + integrityCheck). Because the graph
 *       emits one edge per rule in spec/fk-matrix.yaml, this covers EVERY edge
 *       kind — including the graph-only ones the old local checker missed
 *       (encounterType.conceptUuid, form.decisionConcepts[],
 *       addressLevelType.parentUuid, groupRole FKs, formMapping.taskTypeUUID).
 *       A dangling REQUIRED edge surfaces as MISSING_REQUIRED_REF (error); a
 *       dangling OPTIONAL edge as DANGLING_REF (warning);
 *   (b) FE_CONCEPT_NOT_OBJECT — formElement.concept must be a nested object,
 *       not a bare UUID string (Durga). NOT a graph edge — run alongside;
 *   (c) ALT_INVALID_NAME — addressLevelType names must be non-empty and free of
 *       the chars AVNI's LocationService rejects (Astitva). NOT a graph edge.
 *
 * @param {string} bundleCwd Absolute path to the bundle directory.
 * @returns {{ ok: boolean, findings: Array<{code,severity,file,locator,message}> }}
 *   `ok` is false iff any finding has severity "error".
 */
export function runBundleIntegrityCheck(bundleCwd) {
  const files = readBundleFileMap(bundleCwd);
  const findings = [];

  // (a) FK / dangling-reference integrity — drive it off the brain's
  // yaml-driven dependency graph so this tool inherits FULL edge coverage from
  // the single source of truth (spec/fk-matrix.yaml). buildBundleGraph accepts
  // the in-memory file map directly (no disk I/O); integrityCheck walks every
  // emitted edge and flags the ones whose target uuid is absent. We map each
  // graph issue into the structured finding shape. Loading the brain graph
  // FAILS LOUD (loadBrainGraph) rather than degrading to partial coverage.
  const { buildBundleGraph, integrityCheck } = loadBrainGraph();
  const graph = buildBundleGraph(files);
  const { issues } = integrityCheck(graph);
  for (const issue of issues) {
    const e = issue.edge || {};
    const fromNode = e.from ? graph.nodes.get(e.from) : null;
    const fromKind = fromNode ? fromNode.kind : "?";
    const fromName = fromNode ? (fromNode.name || e.from) : e.from;
    findings.push({
      code: issue.code,                 // "MISSING_REQUIRED_REF" | "DANGLING_REF"
      severity: issue.severity,         // "error" | "warning"
      file: e.field || "(bundle)",      // the FK field that dangles
      // locator names the FROM record (kind + name/uuid), the field, and the
      // dangling TO uuid — enough for the agent to find and fix the ref.
      locator: e.from
        ? `${fromKind} "${fromName}" .${e.field || "?"} → ${e.to} (not found)`
        : (e.to || ""),
      message: issue.message,
    });
  }

  // (b) FE_CONCEPT_NOT_OBJECT — for every form's formElements, the `concept`
  // must be a nested object carrying a non-empty `uuid`. The avni-server's
  // FormElementContract.validate() rejects ANY other shape: a missing/null
  // concept ("Concept UUID Not Provided"), a bare UUID string (Durga — Jackson
  // crashes mapping a string onto ConceptContract), a non-object scalar, or an
  // object that lacks a real uuid. This is a pure SHAPE check; a well-shaped
  // { uuid, ... } whose uuid happens to be dangling is left to the FK check (a).
  const conceptShapeMessage = {
    "missing": (uuid) =>
      `formElement concept is missing/null — AVNI's FormElementContract.validate() ` +
      `rejects it ("Concept UUID Not Provided"). Inline the full concept object ` +
      `(name/uuid/dataType/answers/media).`,
    "bare-string": (uuid) =>
      `formElement concept is a bare UUID string "${uuid}" — AVNI expects a nested ` +
      `ConceptContract object and will fail to deserialize (Jackson). ` +
      `Re-inline the full concept object (name/uuid/dataType/answers/media).`,
    "not-object": (uuid) =>
      `formElement concept is a ${typeof uuid === "object" ? "non-object value" : typeof uuid} ` +
      `instead of a nested ConceptContract object — AVNI will fail to deserialize it. ` +
      `Re-inline the full concept object (name/uuid/dataType/answers/media).`,
    "no-uuid": (uuid) =>
      `formElement concept object has no uuid — AVNI's FormElementContract.validate() ` +
      `rejects a concept without a UUID ("Concept UUID Not Provided"). ` +
      `Restore the concept's uuid (and the rest of the ConceptContract).`,
  };
  for (const [pathStr, form] of Object.entries(files)) {
    if (!pathStr.startsWith("forms/") || !pathStr.endsWith(".json")) continue;
    if (!form || typeof form !== "object") continue;
    for (const grp of (form.formElementGroups || [])) {
      for (const fe of (grp.formElements || [])) {
        if (!fe || typeof fe !== "object") continue;
        const reason = invalidConceptShapeReason(fe.concept);
        if (reason) {
          const msgFor = conceptShapeMessage[reason];
          findings.push({
            code: "FE_CONCEPT_NOT_OBJECT",
            severity: "error",
            file: pathStr,
            locator: `formElements["${fe.name ?? ""}"].concept`,
            message: msgFor ? msgFor(fe.concept) : `formElement concept has an invalid shape (${reason}).`,
          });
        }
      }
    }
  }

  // (c) ALT_INVALID_NAME — for every addressLevelTypes.json entry, an empty name
  // or one containing < > = " ' is rejected by AVNI's LocationService on upload.
  // The deterministic generator emits a bare array, but server-round-tripped and
  // hand-edited bundles can wrap the list ({ addressLevelTypes: [...] } or the
  // generic { data: [...] } envelope) — same quirk the brain graph already
  // tolerates for operational entities. Normalise to the array first so a wrapped
  // shape is NOT silently skipped; the bare-array case is unchanged.
  const altsRaw = files["addressLevelTypes.json"];
  const alts = Array.isArray(altsRaw)
    ? altsRaw
    : (altsRaw && typeof altsRaw === "object" && !Array.isArray(altsRaw))
        ? (Array.isArray(altsRaw.addressLevelTypes)
            ? altsRaw.addressLevelTypes
            : Array.isArray(altsRaw.data)
              ? altsRaw.data
              : null)
        : null;
  if (Array.isArray(alts)) {
    alts.forEach((alt, i) => {
      const name = alt && typeof alt === "object" ? alt.name : alt;
      const reason = invalidLocationLevelNameReason(name);
      if (reason) {
        findings.push({
          code: "ALT_INVALID_NAME",
          severity: "error",
          file: "addressLevelTypes.json",
          locator: `[${i}].name`,
          message:
            `addressLevelType name ${JSON.stringify(name)} is invalid: ${reason}. ` +
            `AVNI's LocationService rejects this on upload.`,
        });
      }
    });
  }

  const ok = !findings.some((f) => f.severity === "error");
  return { ok, findings };
}

function buildIntegrityCheckTool(bundleCwd) {
  return tool(
    "bundle_integrity_check",
    "Run deterministic DATA-INTEGRITY checks on the current bundle that the validator and the model both miss. Covers: (1) FK / dangling references (formMappings, operational entities, form-element concepts, coded answers) pointing at UUIDs not present in the bundle; (2) FE_CONCEPT_NOT_OBJECT — a formElement whose `concept` is a bare UUID string instead of a nested object (AVNI server crashes on deserialize); (3) ALT_INVALID_NAME — an addressLevelType name that is empty or contains < > = \" ' (AVNI LocationService rejects it). Returns { ok, findings:[{code,severity,file,locator,message}], counts }. Run this BEFORE export — a clean validator does NOT guarantee a clean upload.",
    {},
    async () => {
      try {
        const { ok, findings } = runBundleIntegrityCheck(bundleCwd);
        const counts = {};
        for (const f of findings) counts[f.code] = (counts[f.code] || 0) + 1;
        return textResult({
          ok,
          errorCount: findings.filter((f) => f.severity === "error").length,
          warningCount: findings.filter((f) => f.severity === "warning").length,
          counts,
          findings,
        });
      } catch (e) {
        return errorResult(e.message);
      }
    },
  );
}

// ─── spec round-trip tools (spec_apply / spec_emit) ─────────────────
//
// These wrap the pipeline's applySpec / emitSpec as in-process MCP tools so
// the agent can (a) apply a canonical YAML spec onto the bundle in one shot
// and (b) round-trip the current bundle back into the canonical spec to diff
// INTENT vs ARTIFACT. They REPLACE the retired POST /:id/apply-spec HTTP route
// (story #11) — deterministic YAML-spec application now happens in-process via
// the agent, not by curling an endpoint. POST /:id/edit survives as the
// LLM-free Wizard-of-Oz backout path.

/**
 * Apply a canonical YAML spec onto the bundle at `bundleCwd`.
 * Reads the bundle → applySpec (parse spec → materialise rules → patch) → writes
 * the changed files back → runs the deterministic integrity check AFTER.
 * Returns an MCP CallToolResult. A bad spec is surfaced as an isError result —
 * it NEVER throws (the agent loop keeps running and can correct the spec).
 * Exported for direct unit testing (mirrors runBundleIntegrityCheck).
 */
export function specApplyOnDir(bundleCwd, spec) {
  if (typeof spec !== "string" || !spec.trim()) {
    return errorResult("spec is required — a canonical YAML spec string (the format applySpec consumes).");
  }
  let result;
  try {
    const files = readBundleFileMap(bundleCwd);
    result = applySpec({ existingBundleFiles: files, specYaml: spec });
  } catch (e) {
    return errorResult(
      `spec_apply could not apply the spec: ${e.message}. ` +
      `Fix the spec (valid YAML mapping, correct entity shapes) and try again.`,
    );
  }

  // Persist the changed files so subsequent tools (validator / integrity_check)
  // and the post-turn commit see the edit. Only filesChanged are written.
  const written = [];
  try {
    for (const rel of result.filesChanged) {
      const fp = path.join(bundleCwd, rel);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, JSON.stringify(result.patchedFiles[rel], null, 2));
      written.push(rel);
    }
  } catch (e) {
    return errorResult(`spec_apply patched the bundle in memory but failed to write files: ${e.message}`);
  }

  // Run the deterministic integrity check AFTER applying (a clean validator does
  // not guarantee a clean upload — same rationale as bundle_integrity_check).
  let integrityCheck;
  try {
    const { ok, findings } = runBundleIntegrityCheck(bundleCwd);
    const counts = {};
    for (const f of findings) counts[f.code] = (counts[f.code] || 0) + 1;
    integrityCheck = {
      ok,
      errorCount: findings.filter((f) => f.severity === "error").length,
      warningCount: findings.filter((f) => f.severity === "warning").length,
      counts,
      findings,
    };
  } catch (e) {
    integrityCheck = { ok: null, error: e.message };
  }

  return textResult({
    ok: result.integrity.ok !== false && integrityCheck.ok !== false,
    filesChanged: written,
    diffSummary: result.diffSummary,
    diff: result.diff,
    ruleCompilation: result.ruleCompilation,
    specIntegrity: result.integrity,   // FK/graph integrity (from applySpec)
    integrityCheck,                    // deterministic shape/name checks (bundle_integrity_check)
    note:
      "Spec applied. Review integrityCheck.findings before export — a clean validator " +
      "does not guarantee a clean upload. Emitted concept UUIDs inside forms are resolved " +
      "by name (the spec format is name-keyed), so re-check FE_CONCEPT_NOT_OBJECT.",
  });
}

/**
 * Emit the bundle at `bundleCwd` as the canonical YAML spec.
 * Returns an MCP CallToolResult whose text is the YAML spec. Never throws.
 * Exported for direct unit testing.
 */
export function specEmitOnDir(bundleCwd) {
  try {
    const files = readBundleFileMap(bundleCwd);
    let org = "";
    try {
      const metaFp = path.join(bundleCwd, "..", "meta.json");
      if (fs.existsSync(metaFp)) org = JSON.parse(fs.readFileSync(metaFp, "utf8")).org || "";
    } catch {}
    const spec = emitSpec({ existingBundleFiles: files, org });
    return textResult(spec);
  } catch (e) {
    return errorResult(`spec_emit could not emit the bundle as a spec: ${e.message}`);
  }
}

function buildSpecApplyTool(bundleCwd) {
  return tool(
    "spec_apply",
    "Apply a canonical YAML spec onto the current bundle in one shot: parses the spec, " +
      "materialises any declarative rules to JS, patches the bundle (upsert by UUID then " +
      "case-insensitive name — never duplicates), writes the changed files, and runs the " +
      "deterministic integrity check AFTER. Use this when you have a whole desired end-state " +
      "as a spec rather than hand-editing individual JSON files. A malformed spec is returned " +
      "as an actionable error (the turn continues) — it never crashes the loop. Returns " +
      "{ ok, filesChanged, diffSummary, specIntegrity, integrityCheck }.",
    {
      spec: z.string().describe(
        "The canonical YAML spec: top-level " +
          "org / subjectTypes / programs / encounterTypes / concepts / forms, etc.",
      ),
    },
    async ({ spec }) => specApplyOnDir(bundleCwd, spec),
  );
}

function buildSpecEmitTool(bundleCwd) {
  return tool(
    "spec_emit",
    "Emit the CURRENT bundle back as the canonical YAML spec, so you can round-trip and DIFF " +
      "intent vs artifact (what the spec says vs what the bundle actually contains). Returns the " +
      "spec as YAML text. Note: this is a human-readable intent view, not a byte-lossless dump — " +
      "concept UUIDs embedded in form elements are name-resolved (the spec format is name-keyed). " +
      "Re-applying the emitted spec with spec_apply is a no-op for top-level entities (updates in " +
      "place, never duplicates).",
    {},
    async () => specEmitOnDir(bundleCwd),
  );
}

// ─── agent mode: SRS reader + baseline bootstrap (story #12) ────────
//
// Agent mode builds a bundle FROM requirements (an SRS) rather than editing an
// uploaded one. The SRS is persisted by createSession under <session>/input/; the
// tools reach it via the session dir (the parent of bundleCwd) — the SAME
// sibling-access pattern bundle_export_to_path uses to read ../meta.json.

function sessionDirOf(bundleCwd) {
  return path.join(bundleCwd, "..");
}

function readSessionMeta(bundleCwd) {
  try {
    const fp = path.join(sessionDirOf(bundleCwd), "meta.json");
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

const MAX_SRS_INLINE = 8000; // chars — beyond this a text/JSON SRS is summarised, not dumped
const DEFAULT_SRS_ROW_LIMIT = 200; // rows — server-side page size for an Excel sheet read

// ─── input/ path jail (LFI closure, MAJOR-1) ────────────────────────
//
// The divergent #12 build let an agent-mode session carry `srs.externalPath` — a
// caller-supplied filesystem path that generate_baseline handed straight to the
// generator (arbitrary local-file read). That path is GONE: everything read by
// bundle_read_srs / bundle_generate_baseline is the session's OWN input/ dir.
// `resolveInputPath` is the single choke point — it maps the friendly enum
// ('forms'|'modelling') to a filename and refuses anything that escapes input/
// (`../`, absolute), exactly like resolveExportPath jails exports. Exported for
// unit testing the path-escape refusal.
export function resolveInputPath(inputDir, fileArg) {
  const root = path.resolve(inputDir);
  const name =
    (fileArg === undefined || fileArg === null || fileArg === "" || fileArg === "forms") ? "forms.xlsx"
    : fileArg === "modelling" ? "modelling.xlsx"
    : String(fileArg);
  const resolved = path.resolve(root, name);
  const rel = path.relative(root, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      ok: false,
      error:
        `file ${JSON.stringify(fileArg)} escapes the session input/ directory — refused. ` +
        `bundle_read_srs only reads the session's own uploaded spreadsheets (file: "forms" | "modelling").`,
    };
  }
  return { ok: true, path: resolved, name };
}

// MINOR-2: cap a JSON-serialisable SRS value (whole doc, a section, or a
// top-level array) so a big one can't flood the agent's context. Returns either
// `{ content }` (small enough) or `{ truncated, totalChars, preview, note }`
// (too big) — a size-bounded preview + guidance to narrow the request.
function capJsonValue(value) {
  const full = JSON.stringify(value);
  if (full.length <= MAX_SRS_INLINE) return { content: value };
  let preview;
  if (Array.isArray(value)) {
    preview = { items: value.length, first: value.slice(0, 20) };
  } else if (value && typeof value === "object") {
    preview = Object.fromEntries(
      Object.keys(value).slice(0, 30).map((k) => [k, Array.isArray(value[k]) ? `[${value[k].length} items]` : typeof value[k]]),
    );
  } else {
    preview = String(value).slice(0, MAX_SRS_INLINE);
  }
  return {
    truncated: true,
    totalChars: full.length,
    preview,
    note: `This content is large (${full.length} chars) and was truncated to fit context. ` +
      `Narrow the request (a specific section, or a specific sheet via file/sheet) to read it fully.`,
  };
}

// Markdown-style heading extraction for prose SRS section navigation.
function extractHeadings(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) out.push(m[2]);
  }
  return out;
}

// Return the text of the first heading whose title contains `name`
// (case-insensitive), through to the next same-or-higher-level heading (or EOF).
// null when no heading matches.
function sliceSection(text, name) {
  const lines = String(text || "").split(/\r?\n/);
  const needle = String(name || "").toLowerCase();
  let start = -1, startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && m[2].toLowerCase().includes(needle)) { start = i; startLevel = m[1].length; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= startLevel) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

/**
 * Read the SRS attached to the session that owns `bundleCwd`.
 *
 * Epic signature: `{ file?: 'forms'|'modelling', sheet?, format?: 'json'|'csv',
 * limit?, offset? }` for Excel SRSes (parsed via SheetJS, jailed to input/):
 *   • no `sheet` → `{ sheets: [{ name, rows, columns }] }` (an index to paginate from)
 *   • with `sheet` → the sheet's rows as JSON (default) or CSV, sliced to `limit`
 *     (default 200) from `offset` (0), with a `truncated` flag + a pagination note.
 * A prose/JSON inline SRS (no spreadsheet) still returns structured/raw content and
 * honours `{ section }`.
 *
 * Returns an MCP CallToolResult. Never throws — a baseline-mode session (no SRS),
 * a path escape, or a missing file all surface as an actionable isError. Exported
 * for unit tests.
 */
export function readSrsOnDir(bundleCwd, opts = {}) {
  const section = opts && typeof opts.section === "string" ? opts.section.trim() : "";
  const meta = readSessionMeta(bundleCwd);
  if (!meta) {
    return errorResult("could not read session meta (../meta.json) — bundle_read_srs needs a session-backed bundle directory.");
  }
  if (meta.mode !== "agent" || !meta.srs) {
    return errorResult(
      "no SRS is attached to this session. bundle_read_srs is for AGENT-mode sessions created around an SRS; " +
      "this is a baseline-mode session (its bundle was generated from an uploaded SRS at turn 0). " +
      "Read the bundle files directly (bundle_summary / Read) instead.",
    );
  }
  const srs = meta.srs;
  const srsDir = path.join(sessionDirOf(bundleCwd), "input");
  const head = {
    kind: srs.kind,
    hasGeneratorInputs: !!srs.hasGeneratorInputs,
    available: Object.keys(srs.files || {}),
  };

  // ── Excel SRS (epic primary path) — {file, sheet, format, limit, offset} ──
  // When the session carries a forms/modelling spreadsheet, that is the SRS the
  // agent reads directly. All file access is jailed to input/ (resolveInputPath).
  const hasExcel = !!(srs.files && (srs.files.forms || srs.files.modelling));
  const wantsExcel = hasExcel || opts.file !== undefined || opts.sheet !== undefined;
  if (wantsExcel) {
    const jail = resolveInputPath(srsDir, opts.file);
    if (!jail.ok) return errorResult(jail.error);
    if (!fs.existsSync(jail.path)) {
      return errorResult(
        `no ${jail.name} in the session input/ dir. Available SRS inputs: ${head.available.join(", ") || "(none)"}. ` +
        `Pass file: "forms" or "modelling" to pick a spreadsheet that exists.`,
      );
    }
    let wb;
    try { wb = XLSX.readFile(jail.path); }
    catch (e) { return errorResult(`could not parse ${jail.name} as an Excel workbook: ${e.message}`); }
    const sheetNames = wb.SheetNames || [];
    const wantSheet = typeof opts.sheet === "string" ? opts.sheet.trim() : "";

    // No sheet → return the sheet index (name + row/column counts) to paginate from.
    if (!wantSheet) {
      const sheets = sheetNames.map((name) => {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", blankrows: false });
        return { name, rows: Math.max(0, aoa.length - 1), columns: (aoa[0] || []).map((c) => String(c)) };
      });
      return textResult({
        ...head, file: jail.name, format: "sheet-list", sheets,
        note: `Pass { sheet: "<name>", limit } (json default, or format:"csv") to read a sheet's rows; { offset } paginates.`,
      });
    }

    // Resolve the sheet name (exact, then case-insensitive).
    const actual = sheetNames.find((n) => n === wantSheet) || sheetNames.find((n) => n.toLowerCase() === wantSheet.toLowerCase());
    if (!actual) {
      return errorResult(`sheet "${wantSheet}" not found in ${jail.name}. Available sheets: ${sheetNames.join(", ") || "(none)"}.`);
    }
    const ws = wb.Sheets[actual];
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : DEFAULT_SRS_ROW_LIMIT;
    const offset = Number.isInteger(opts.offset) && opts.offset > 0 ? opts.offset : 0;
    const format = opts.format === "csv" ? "csv" : "json";

    if (format === "csv") {
      const lines = XLSX.utils.sheet_to_csv(ws).split(/\r?\n/);
      const header = lines.length ? lines[0] : "";
      const dataLines = lines.slice(1).filter((l) => l.length > 0);
      const page = dataLines.slice(offset, offset + limit);
      const truncated = offset + limit < dataLines.length;
      return textResult({
        ...head, file: jail.name, sheet: actual, format: "csv",
        totalRows: dataLines.length, offset, returnedRows: page.length, truncated,
        note: truncated ? `Rows ${offset}–${offset + page.length} of ${dataLines.length}. Pass { offset: ${offset + limit}, limit } for the next page.` : undefined,
        csv: [header, ...page].join("\n"),
      });
    }
    const all = XLSX.utils.sheet_to_json(ws, { defval: "" });
    const page = all.slice(offset, offset + limit);
    const truncated = offset + limit < all.length;
    return textResult({
      ...head, file: jail.name, sheet: actual, format: "json",
      totalRows: all.length, offset, returnedRows: page.length, truncated,
      note: truncated ? `Rows ${offset}–${offset + page.length} of ${all.length}. Pass { offset: ${offset + limit}, limit } for the next page.` : undefined,
      rows: page,
    });
  }

  // JSON SRS — structured. Honour a section arg (top-level key); summarise large.
  if (srs.files && srs.files.json) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(srsDir, "srs.json"), "utf8")); }
    catch (e) { return errorResult(`SRS JSON could not be parsed: ${e.message}`); }
    const isObj = doc && typeof doc === "object" && !Array.isArray(doc);
    if (section && isObj) {
      if (!(section in doc)) {
        return textResult({ ...head, format: "json", section, error: `section "${section}" not found`, sections: Object.keys(doc) });
      }
      // MINOR-2: a single section can itself be huge (a concepts array with
      // thousands of entries) — cap it too, not just the whole doc.
      return textResult({ ...head, format: "json", section, ...capJsonValue(doc[section]) });
    }
    // MINOR-2: cap BOTH a large top-level object AND a large top-level array
    // (the array branch previously fell through and dumped everything).
    const capped = capJsonValue(doc);
    if (capped.truncated) {
      return textResult({ ...head, format: "json", ...(isObj ? { sections: Object.keys(doc) } : {}), ...capped });
    }
    return textResult({ ...head, format: "json", content: doc });
  }

  // Text SRS — raw. Honour a section (heading) arg; summarise large.
  if (srs.files && srs.files.text) {
    let text;
    try { text = fs.readFileSync(path.join(srsDir, "srs.txt"), "utf8"); }
    catch (e) { return errorResult(`SRS text could not be read: ${e.message}`); }
    const headings = extractHeadings(text);
    if (section) {
      const sec = sliceSection(text, section);
      if (sec == null) return textResult({ ...head, format: "text", section, error: `section "${section}" not found`, headings });
      // MINOR-2: a matched section can be larger than the cap — truncate it too.
      if (sec.length > MAX_SRS_INLINE) {
        return textResult({
          ...head, format: "text", section, truncated: true, totalChars: sec.length,
          note: `Section "${section}" is large (${sec.length} chars) and was truncated to fit context.`,
          preview: sec.slice(0, MAX_SRS_INLINE),
        });
      }
      return textResult({ ...head, format: "text", section, content: sec });
    }
    if (text.length > MAX_SRS_INLINE) {
      return textResult({
        ...head, format: "text", truncated: true, totalChars: text.length, headings,
        note: `SRS is large (${text.length} chars). Pass { section: "<heading>" } to read one section, or Read ../input/srs.txt directly.`,
        preview: text.slice(0, MAX_SRS_INLINE),
      });
    }
    return textResult({ ...head, format: "text", content: text });
  }

  // Nothing readable attached to this session.
  return textResult({
    ...head, format: "reference",
    note: "No SRS content is attached to this session. Call bundle_generate_baseline to bootstrap a minimal bundle, then author from your own requirements.",
  });
}

// A MINIMAL VALID bundle skeleton: one Person subject type + its registration
// form (a single Text concept) + the operational mirror + the required
// empty entity files + org config + one address level. Proven validator-clean
// AND integrity-clean (see tests/entities/agent-agent-mode.test.cjs). Uses
// fresh v4 UUIDs so the skeleton is generator-independent — the baseline the
// agent gets when the session has no XLSX generator inputs. Exported for tests.
export function buildMinimalSkeleton() {
  const ST = crypto.randomUUID();
  const OST = crypto.randomUUID();
  const C = crypto.randomUUID();
  const F = crypto.randomUUID();
  const FEG = crypto.randomUUID();
  const FE = crypto.randomUUID();
  const FM = crypto.randomUUID();
  const OC = crypto.randomUUID();
  const EG = crypto.randomUUID();
  const ALT = crypto.randomUUID();
  return {
    "subjectTypes.json": [{ name: "Individual", uuid: ST, active: true, type: "Person", allowMiddleName: true, allowProfilePicture: false, allowEmptyLocation: false, lastNameOptional: false, uniqueName: false, shouldSyncByLocation: true, settings: { displayRegistrationDetails: true, displayPlannedEncounters: true }, household: false, group: false, directlyAssignable: false, voided: false }],
    "operationalSubjectTypes.json": { operationalSubjectTypes: [{ uuid: OST, subjectType: { uuid: ST, voided: false }, name: "Individual", voided: false }] },
    "programs.json": [],
    "operationalPrograms.json": { operationalPrograms: [] },
    "encounterTypes.json": [],
    "operationalEncounterTypes.json": { operationalEncounterTypes: [] },
    "concepts.json": [{ name: "Name", uuid: C, dataType: "Text", active: true }],
    "formMappings.json": [{ uuid: FM, formUUID: F, subjectTypeUUID: ST, formType: "IndividualProfile", formName: "Individual Registration", enableApproval: false }],
    "organisationConfig.json": { uuid: OC, settings: { languages: ["en"], myDashboardFilters: [], searchFilters: [], enableMessaging: false } },
    "groups.json": [{ uuid: EG, name: "Everyone", notEveryoneGroup: false }],
    "groupPrivilege.json": [],
    "addressLevelTypes.json": [{ uuid: ALT, name: "Village", level: 1, isRegistrationLocation: true }],
    [`forms/Individual Registration_${F}.json`]: { name: "Individual Registration", uuid: F, formType: "IndividualProfile", formElementGroups: [{ uuid: FEG, name: "Name", displayOrder: 1, formElements: [{ name: "Name", uuid: FE, keyValues: [], concept: { name: "Name", uuid: C, dataType: "Text", active: true, media: [], answers: [] }, displayOrder: 1, type: "SingleSelect", mandatory: true }], timed: false, display: "Name" }], decisionRule: "", visitScheduleRule: "", validationRule: "", checklistsRule: "", decisionConcepts: [] },
  };
}

function writeMinimalSkeleton(bundleCwd) {
  const files = buildMinimalSkeleton();
  const written = [];
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(bundleCwd, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
    written.push(rel);
  }
  return written.sort();
}

/**
 * Run validator + integrity on the freshly-written baseline and build the
 * generate_baseline report. Extracted + EXPORTED so the "never reports
 * clean-when-dirty" property (MINOR-1) is unit-testable against a deliberately
 * dirty bundle: `clean` is DERIVED from the actual validator+integrity result,
 * never hardcoded — this function returns clean:false whenever the bundle on
 * disk has any validator error or integrity error. Never throws.
 */
export function baselineStatusReport(bundleCwd, { source, filesWritten } = {}) {
  let validator, integrity;
  try {
    const v = validateBundle(bundleCwd);
    validator = { valid: v.valid, errorCount: v.errors.length, warningCount: v.warnings.length, errors: v.errors.slice(0, 20), warnings: v.warnings.slice(0, 10) };
  } catch (e) { validator = { valid: null, error: e.message }; }
  try {
    const { ok, findings } = runBundleIntegrityCheck(bundleCwd);
    const counts = {};
    for (const f of findings) counts[f.code] = (counts[f.code] || 0) + 1;
    integrity = {
      ok,
      errorCount: findings.filter((f) => f.severity === "error").length,
      warningCount: findings.filter((f) => f.severity === "warning").length,
      counts, findings,
    };
  } catch (e) { integrity = { ok: null, error: e.message }; }

  const clean = validator.valid === true && integrity.ok === true;
  return textResult({
    ok: true,
    source,
    clean,
    ...(filesWritten ? { filesWritten } : {}),
    validator,
    integrity,
    note: clean
      ? `Baseline generated (${source}) and is validator+integrity CLEAN. Now refine it to satisfy the SRS, keeping it clean (zero errors) before export.`
      : `Baseline generated (${source}) but is NOT yet clean — see validator/integrity above. Refine to zero errors before export.`,
  });
}

// Copy the generated bundle files from `srcDir` INTO `destDir`, MERGING (dest's
// own .git / .gitignore survive because srcDir has neither). This is why the
// brain generator runs into a TEMP dir first: generate_bundle_v2.js rmSync's its
// output dir before writing, which would otherwise destroy the session's git
// repo (turn 0) and break every subsequent server commit.
function copyGeneratedInto(srcDir, destDir) {
  fs.cpSync(srcDir, destDir, { recursive: true, force: true });
}

/**
 * Bootstrap a baseline bundle for the agent-mode session that owns `bundleCwd`,
 * writing it into `bundleCwd`. Sources the baseline from the BRAIN generator
 * (wrapping generateBundle against the session's input/ SRS) when the session
 * carries XLSX inputs; otherwise writes a minimal valid skeleton. REFUSES in a
 * baseline-mode session (already generated at turn 0). Always runs validator +
 * integrity AFTER and surfaces the status (never claims clean without proving
 * it — see baselineStatusReport). Returns an MCP CallToolResult; never throws.
 * Exported for unit tests.
 */
export function generateBaselineOnDir(bundleCwd) {
  const meta = readSessionMeta(bundleCwd);
  if (!meta) {
    return errorResult("could not read session meta (../meta.json) — bundle_generate_baseline needs a session-backed bundle directory.");
  }
  if (meta.mode !== "agent") {
    return errorResult(
      "bundle_generate_baseline is only for AGENT-mode sessions. A baseline-mode session already has a deterministic " +
      "first-pass bundle (generated from the uploaded SRS at turn 0) — there is no baseline to bootstrap.",
    );
  }

  const srsDir = path.join(sessionDirOf(bundleCwd), "input");
  const srs = meta.srs || {};
  let source;
  let filesWritten;

  // Prefer the BRAIN generator when the session carries usable XLSX inputs. This
  // is the deterministic SRS→bundle generator DEMOTED to a tool: the same code
  // baseline mode runs at turn 0, but here the AGENT chooses to invoke it.
  // LFI closure (MAJOR-1): the ONLY forms source is the session's own
  // input/forms.xlsx — never a caller-supplied external path.
  let formsPath = null;
  if (srs.files && srs.files.forms && fs.existsSync(path.join(srsDir, "forms.xlsx"))) {
    formsPath = path.join(srsDir, "forms.xlsx");
  }

  if (formsPath) {
    const modellingCandidate = path.join(srsDir, "modelling.xlsx");
    const modellingPath = (srs.files && srs.files.modelling && fs.existsSync(modellingCandidate)) ? modellingCandidate : null;
    // Generate into a TEMP dir, then copy in — the generator rmSync's its output
    // dir, which would destroy the session's turn-0 git repo if pointed at
    // bundleCwd directly (breaking every later server commit).
    const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "agent-baseline-"));
    try {
      generateBundle({ formsPath, modellingPath, org: meta.org || "Bundle", outDir: tmpOut });
      copyGeneratedInto(tmpOut, bundleCwd);
      source = "brain-generator";
    } catch (e) {
      return errorResult(
        `bundle_generate_baseline: the deterministic generator failed on the session's SRS XLSX: ${e.message}. ` +
        `Fix the SRS spreadsheet, or hand-author the bundle (spec_apply / Edit).`,
      );
    } finally {
      try { fs.rmSync(tmpOut, { recursive: true, force: true }); } catch {}
    }
  } else {
    try {
      filesWritten = writeMinimalSkeleton(bundleCwd);
      source = "minimal-skeleton";
    } catch (e) {
      return errorResult(`bundle_generate_baseline: failed to write the minimal skeleton: ${e.message}`);
    }
  }

  // Surface the resulting status — NEVER claim clean without proving it (a real
  // SRS the generator can't fully satisfy yields a dirty baseline, reported
  // truthfully so the agent knows what to refine).
  return baselineStatusReport(bundleCwd, { source, filesWritten });
}

function buildReadSrsTool(bundleCwd) {
  return tool(
    "bundle_read_srs",
    "Read the SRS (requirements) attached to the CURRENT agent-mode session so you can ground bundle authoring in the requirements instead of guessing. For an Excel SRS: call with no args to get the sheet index ({sheets:[{name,rows,columns}]}), then pass { sheet, limit, offset, format } to read a sheet's rows (json default or csv), sliced to `limit` rows (default 200) from `offset` — paginate large sheets (concept sheets run thousands of rows) instead of dumping. File access is JAILED to the session input/ dir. For a prose/JSON inline SRS: pass { section } to read one section. AGENT-mode only; a baseline-mode session (bundle already generated from an uploaded SRS) returns an actionable error. Call this FIRST in agent mode.",
    {
      file: z.enum(["forms", "modelling"]).optional().describe("Which uploaded spreadsheet to read (default 'forms'). Only the session's own input/ files are readable."),
      sheet: z.string().optional().describe("Sheet name to read rows from. Omit to list all sheets with their row/column counts."),
      format: z.enum(["json", "csv"]).optional().describe("Row format when reading a sheet: 'json' (default) or 'csv'."),
      limit: z.number().int().positive().optional().describe("Max rows to return from a sheet (default 200). Paginate with offset."),
      offset: z.number().int().nonnegative().optional().describe("Row offset to start from (default 0), for paginating a large sheet."),
      section: z.string().optional().describe("For a prose/JSON inline SRS only: read a single named section/key."),
    },
    async ({ file, sheet, format, limit, offset, section }) =>
      readSrsOnDir(bundleCwd, { file, sheet, format, limit, offset, section }),
  );
}

function buildGenerateBaselineTool(bundleCwd) {
  return tool(
    "bundle_generate_baseline",
    "Bootstrap a BASELINE bundle for the current agent-mode session, written into the session bundle dir so you can then refine it. Source: if the session carries XLSX generator inputs, this runs the deterministic SRS→bundle generator against the session's input/ SRS (the same one baseline mode runs at turn 0, now demoted to a tool you choose to call); otherwise it writes a MINIMAL VALID skeleton (one subject type + registration form + operational mirror) you can build on. Opt-in — you may instead hand-author via spec_apply/Edit. Returns { source, clean, validator, integrity }; it NEVER silently reports clean when the bundle is dirty — the resulting validator+integrity status is always surfaced. AGENT-mode only; it REFUSES in a baseline-mode session (already generated at turn 0) with an actionable error (never throws).",
    {},
    async () => generateBaselineOnDir(bundleCwd),
  );
}

// ─── CRL review / scrub / spec-review (Phase 4 — wire the compliance-guided
// review layer into the edit loop) ──────────────────────────────────────────
//
// Agent-invokable entry points on top of the review layer (src/crl/review.js).
// Distinct from crlGate, which src/sessions.js wires in as the AUTOMATIC
// per-change gate after every mutating turn — these tools let the agent (or a
// human driving it) ask for a review/scrub/spec-review explicitly, e.g. to
// re-inspect a mature bundle before a targeted additive change.

const CRL_SCOPING_TEXT_CAP = 4000; // chars — keep the review payload small; bundle_read_srs remains the full-fidelity path

/**
 * Build the "what did the org actually ask for" grounding context the
 * ai-judged pass needs (design.md "A single review = three passes"). Reads the
 * session's own attached SRS the same way bundle_read_srs does, capped to a
 * small preview. Returns `{}` for a baseline-mode session, or an agent-mode
 * session with no readable SRS text attached — the review layer still runs,
 * just without scoping grounding. Exported for direct testing.
 */
export function buildCrlScopingCtx(bundleCwd) {
  const meta = readSessionMeta(bundleCwd);
  if (!meta || meta.mode !== "agent" || !meta.srs) return {};
  const srsDir = path.join(sessionDirOf(bundleCwd), "input");
  try {
    if (meta.srs.files && meta.srs.files.text) {
      const text = fs.readFileSync(path.join(srsDir, "srs.txt"), "utf8");
      return { srs: text.slice(0, CRL_SCOPING_TEXT_CAP) };
    }
    if (meta.srs.files && meta.srs.files.json) {
      const text = fs.readFileSync(path.join(srsDir, "srs.json"), "utf8");
      return { srs: text.slice(0, CRL_SCOPING_TEXT_CAP) };
    }
  } catch {
    // SRS unreadable — review proceeds without scoping context, not an error.
  }
  return {};
}

// ─── server factory ─────────────────────────────────────────────────

/**
 * Build an in-process MCP server bound to a SPECIFIC bundle directory.
 *
 * The signature changed (audit C1): the SDK runs in-process tool handlers
 * in the host server process, so `process.cwd()` resolves to the SERVER's
 * startup cwd, not the per-session bundle. Callers MUST invoke this factory
 * per request with the resolved bundle path so each handler closes over the
 * correct directory.
 *
 * Example:
 *   const mcp = createBundleMcpServer("/sessions/sess_xyz/bundle");
 *
 * @param {string} bundleCwd Absolute path to the session's bundle directory.
 * @returns {ReturnType<typeof createSdkMcpServer>}
 */
export function createBundleMcpServer(bundleCwd) {
  if (typeof bundleCwd !== "string" || !bundleCwd) {
    throw new Error("createBundleMcpServer(bundleCwd): bundleCwd is required (per-session bundle directory).");
  }
  return createSdkMcpServer({
    name: "avni-bundle",
    version: "1.0.0",
    tools: [
      buildValidatorTool(bundleCwd),
      buildFindConceptTool(bundleCwd),
      buildSummaryTool(bundleCwd),
      buildExportTool(bundleCwd),
      buildIntegrityCheckTool(bundleCwd),
      buildSpecApplyTool(bundleCwd),
      buildSpecEmitTool(bundleCwd),
      buildReadSrsTool(bundleCwd),
      buildGenerateBaselineTool(bundleCwd),
      buildFindReferencesTool(bundleCwd),
    ],
    alwaysLoad: true,
  });
}

// Re-export the frozen, single-source-of-truth tool-name list.
// DO NOT redefine here — see src/agents/bundle-mcp-tool-names.js for the
// rename-warning rationale (these strings live forever in transcripts).
export const BUNDLE_TOOL_NAMES = FROZEN_BUNDLE_TOOL_NAMES;
