// 06-save-bundle-to-desktop.cjs
//
// What it proves: when the user asks to "save the bundle to Desktop", the
// agent picks the `bundle_export_to_path` MCP tool rather than free-form
// Bash. The tool is path-jailed to ~/Desktop, ~/Downloads, ~/Documents,
// ~/.avni-skills-sdk/exports, $SDK_EXPORT_DIR. The eval runner sets
// SDK_EXPORT_DIR to a per-case tmp dir so we can assert on a clean target
// without polluting the user's real Desktop.
//
// Expectations:
//   • the agent calls bundle_export_to_path (any input)
//   • a .zip file lands inside the export root
//   • bounded cost

"use strict";

const fs = require("node:fs");
const path = require("node:path");

module.exports = {
  name: "06-save-bundle-to-desktop",
  description:
    "Agent must call bundle_export_to_path (NOT free-form Bash) and the zip must land in the allowed export dir.",

  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "TestOrgExport" }),

  // The runner sets SDK_EXPORT_DIR per case → injected as env on server boot.
  // The path is exposed at runtime via the `env` block on the case (see run.cjs).
  envOverrides: ({ tmpDir }) => ({
    SDK_EXPORT_DIR: tmpDir,
  }),

  // The prompt mentions "the export directory I just set up" rather than a
  // hard Desktop path, so the agent reaches for the MCP tool to honour
  // whatever destination the user prefers.
  prompt:
    "Please save (export) this bundle as a zip file into my export directory " +
    "(the one configured for this session). Use the bundle export tool.",

  maxTurns: 2,
  maxCostUsd: 0.20,

  assertions: async (ctx) => {
    // 1. The agent must have called the export tool
    ctx.assertions.assertToolUsed(ctx.agentEvents, (t) =>
      String(t.name || "").includes("bundle_export_to_path"),
    );

    // 2. A .zip file landed inside the tmp export dir
    const exportDir = ctx.envOverrides?.SDK_EXPORT_DIR;
    if (!exportDir) {
      throw new Error("runner did not propagate SDK_EXPORT_DIR to env");
    }
    if (!fs.existsSync(exportDir)) {
      throw new Error(`export dir does not exist: ${exportDir}`);
    }
    const zips = fs.readdirSync(exportDir).filter((f) => f.toLowerCase().endsWith(".zip"));
    if (zips.length === 0) {
      throw new Error(`no .zip files in export dir ${exportDir} (contents: ${fs.readdirSync(exportDir).join(", ")})`);
    }
    // Best-effort cleanup after pass
    for (const z of zips) {
      try { fs.unlinkSync(path.join(exportDir, z)); } catch {}
    }
  },
};
