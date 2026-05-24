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
// All tools operate on the AGENT'S CWD (the session bundle dir). The agent
// doesn't have to know the session id — cwd resolution is implicit.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { validateBundle, zipBundle as zipBundleDir } from "../bundle.js";

// MCP CallToolResult helper — wrap a JS value as a text content block.
function textResult(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }] };
}

function errorResult(message) {
  return { content: [{ type: "text", text: `ERROR: ${message}` }], isError: true };
}

// Resolve the bundle dir from the agent's cwd. We trust cwd because the
// server sets it to the session's bundleDir before spawning the agent.
function bundleDirFromCwd() {
  return process.cwd();
}

// ─── tools ──────────────────────────────────────────────────────────

const validatorTool = tool(
  "bundle_validator_run",
  "Run the AVNI bundle validator on the current bundle (the agent's cwd). Returns structured JSON with valid:boolean, errors:string[], warnings:string[], groups:{code:count}. Use this BEFORE making any edit and AFTER, to confirm the delta. Cheaper and more reliable than running the validator via Bash.",
  {},
  async () => {
    try {
      const dir = bundleDirFromCwd();
      const r = validateBundle(dir);
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

const findConceptTool = tool(
  "bundle_find_concept",
  "Case-insensitive lookup of a concept by name in the current bundle's concepts.json. Returns guidance on whether to REUSE an existing UUID (exact match) or whether it's SAFE to add a new concept. ALWAYS call this before adding a new concept — concept names collide case-insensitively per C3/D1 validator. Replaces the legacy scripts/agent-tools/find-concept.mjs CLI wrapper.",
  { name: z.string().describe("Concept name to look up (case-insensitive)") },
  async ({ name }) => {
    try {
      const dir = bundleDirFromCwd();
      const fp = path.join(dir, "concepts.json");
      if (!fs.existsSync(fp)) return errorResult("concepts.json not found in cwd");
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

const summaryTool = tool(
  "bundle_summary",
  "Quick deterministic summary of the current bundle: counts of concepts, subjectTypes, programs, encounterTypes, forms, formMappings. Use this to orient yourself BEFORE reading specific files. Free, instant, no validator overhead.",
  {},
  async () => {
    try {
      const dir = bundleDirFromCwd();
      const readJson = (rel) => {
        const fp = path.join(dir, rel);
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
      const formsDir = path.join(dir, "forms");
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

const exportTool = tool(
  "bundle_export_to_path",
  'Zip the current bundle and copy it to a destination path. Use this when the user asks to "save the bundle", "put the bundle on Desktop", "download the bundle", "give me the zip". Resolves ~ and validates the destination is writable. Returns the absolute path of the written file. This replaces the ambiguous Bash + cp dance that silently failed in audit B5.',
  {
    destPath: z.string().describe('Destination — either a directory (where the zip is named <Org>.zip) or a full file path ending in .zip. Tildes resolved (e.g. "~/Desktop").'),
  },
  async ({ destPath }) => {
    try {
      const dir = bundleDirFromCwd();
      // Determine org name from meta — try ../meta.json (session dir parent of bundle dir)
      let org = "Bundle";
      try {
        const metaFp = path.join(dir, "..", "meta.json");
        if (fs.existsSync(metaFp)) {
          org = JSON.parse(fs.readFileSync(metaFp, "utf8")).org || org;
        }
      } catch {}
      // Resolve ~
      let resolved = destPath.startsWith("~")
        ? path.join(process.env.HOME || "/", destPath.slice(1))
        : path.resolve(destPath);
      // If it's a directory (or looks like one), append filename
      let finalPath;
      if (resolved.endsWith(".zip")) {
        finalPath = resolved;
      } else {
        // Treat as directory
        try { fs.mkdirSync(resolved, { recursive: true }); } catch {}
        finalPath = path.join(resolved, `${org}.zip`);
      }
      // Ensure parent dir exists
      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      const result = await zipBundleDir(dir, finalPath);
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

// ─── server factory ─────────────────────────────────────────────────

export function createBundleMcpServer() {
  return createSdkMcpServer({
    name: "avni-bundle",
    version: "1.0.0",
    tools: [validatorTool, findConceptTool, summaryTool, exportTool],
    alwaysLoad: true,
  });
}

export const BUNDLE_TOOL_NAMES = [
  "mcp__avni-bundle__bundle_validator_run",
  "mcp__avni-bundle__bundle_find_concept",
  "mcp__avni-bundle__bundle_summary",
  "mcp__avni-bundle__bundle_export_to_path",
];
