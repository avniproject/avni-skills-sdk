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
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { validateBundle, zipBundle as zipBundleDir } from "../bundle.js";
import { BUNDLE_TOOL_NAMES as FROZEN_BUNDLE_TOOL_NAMES } from "./bundle-mcp-tool-names.js";

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

function buildExportTool(bundleCwd) {
  return tool(
    "bundle_export_to_path",
    'Zip the current bundle and copy it to a destination path. Use this when the user asks to "save the bundle", "put the bundle on Desktop", "download the bundle", "give me the zip". Destination MUST be inside one of the allowed roots (~/Desktop, ~/Downloads, ~/Documents, ~/.avni-skills-sdk/exports, or $SDK_EXPORT_DIR if set) — paths that escape are rejected. Tildes are resolved. Returns the absolute path of the written file.',
    {
      destPath: z.string().describe('Destination — either a directory (where the zip is named <Org>.zip) or a full file path ending in .zip. Tildes resolved (e.g. "~/Desktop"). Must resolve to a path inside an allowed export root.'),
    },
    async ({ destPath }) => {
      try {
        // Determine org name from meta — try ../meta.json (session dir parent of bundle dir)
        let org = "Bundle";
        try {
          const metaFp = path.join(bundleCwd, "..", "meta.json");
          if (fs.existsSync(metaFp)) {
            org = JSON.parse(fs.readFileSync(metaFp, "utf8")).org || org;
          }
        } catch {}

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
    },
  );
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
    ],
    alwaysLoad: true,
  });
}

// Re-export the frozen, single-source-of-truth tool-name list.
// DO NOT redefine here — see src/agents/bundle-mcp-tool-names.js for the
// rename-warning rationale (these strings live forever in transcripts).
export const BUNDLE_TOOL_NAMES = FROZEN_BUNDLE_TOOL_NAMES;
