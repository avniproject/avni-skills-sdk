// Deterministic bundle generation — wraps avni-skills's generate_bundle_v2.js.
// No LLM call. Used by /v1/bundles/generate.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import archiver from "archiver";
import { avniSkillsPath } from "./skills.js";

export function generateBundle({ formsPath, modellingPath, org = "Bundle", outDir }) {
  const root = avniSkillsPath();
  const generator = path.join(root, "srs-bundle-generator", "scripts", "generate_bundle_v2.js");
  if (!fs.existsSync(generator)) {
    throw new Error("generate_bundle_v2.js not found in avni-skills");
  }
  outDir = outDir || path.join(os.tmpdir(), `bundle-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(outDir, { recursive: true });
  const args = ["--forms", formsPath, "--org", org, "--output", outDir, "--no-validate"];
  if (modellingPath) args.unshift("--srs", modellingPath);
  let stdout = "";
  try {
    stdout = execFileSync("node", [generator, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`generator failed: ${(e.stderr || e.message).slice(0, 500)}`);
  }
  return { outDir, stdout };
}

export function validateBundle(outDir) {
  const root = avniSkillsPath();
  const validatorPath = path.join(root, "srs-bundle-generator", "validators", "bundle_validator");
  // Use createRequire to load CJS validator from this ESM module.
  const { createRequire } = require("node:module");
  const req = createRequire(import.meta.url);
  const { BundleValidator } = req(validatorPath);
  const orig = console.log; console.log = () => {};
  const r = new BundleValidator(outDir).validate();
  console.log = orig;
  return { valid: r.valid, errors: r.errors, warnings: r.warnings };
}

export function zipBundle(outDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve({ zipPath, bytes: archive.pointer() }));
    archive.on("error", reject);
    archive.pipe(output);

    // Canonical order matches avni-skills/srs-bundle-generator/scripts/zip_bundle.js
    const order = [
      "organisationConfig.json",
      "addressLevelTypes.json",
      "subjectTypes.json",
      "operationalSubjectTypes.json",
      "programs.json",
      "operationalPrograms.json",
      "encounterTypes.json",
      "operationalEncounterTypes.json",
      "concepts.json",
    ];
    for (const f of order) {
      const fp = path.join(outDir, f);
      if (fs.existsSync(fp)) archive.file(fp, { name: f });
    }
    const formsDir = path.join(outDir, "forms");
    if (fs.existsSync(formsDir)) {
      for (const f of fs.readdirSync(formsDir).sort()) {
        archive.file(path.join(formsDir, f), { name: `forms/${f}` });
      }
    }
    for (const f of [
      "formMappings.json",
      "groups.json",
      "groupPrivilege.json",
      "individualRelation.json",
      "relationshipType.json",
    ]) {
      const fp = path.join(outDir, f);
      if (fs.existsSync(fp)) archive.file(fp, { name: f });
    }
    archive.finalize();
  });
}

// Importing CJS in ESM helper
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
