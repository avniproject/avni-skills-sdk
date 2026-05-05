// Helper: build a synthetic SRS Excel workbook in memory and run the
// generator against it. Each test composes the SHEETS it needs and asserts
// invariants on the resulting bundle. Org-agnostic — tests document the
// generator contract, not a specific organisation's data.
//
// Requires the `avni-skills` repo to be available locally:
//   - either at $AVNI_SKILLS_PATH
//   - or as a sibling directory of this repo: ../avni-skills

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");

const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, "..", "..", "..", "..", "avni-skills");

if (!fs.existsSync(AVNI_SKILLS_PATH)) {
  throw new Error(
    `avni-skills not found at ${AVNI_SKILLS_PATH}.\n` +
    `Set AVNI_SKILLS_PATH env var, or clone avni-skills as a sibling of this repo.`,
  );
}

const XLSX = require(path.join(AVNI_SKILLS_PATH, "node_modules", "xlsx"));
const GENERATOR = path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "scripts", "generate_bundle_v2.js");
const VALIDATOR_PATH = path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "validators", "bundle_validator");

function makeWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const fp = path.join(os.tmpdir(), `srs-${Date.now()}-${Math.floor(Math.random() * 1e6)}.xlsx`);
  XLSX.writeFile(wb, fp);
  return fp;
}

function generate({ formsSheets, modellingSheets, org = "Test" }) {
  const formsPath = makeWorkbook(formsSheets);
  const modellingPath = modellingSheets ? makeWorkbook(modellingSheets) : null;
  const outDir = path.join(os.tmpdir(), `bundle-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(outDir, { recursive: true });
  const args = ["--forms", formsPath, "--org", org, "--output", outDir, "--no-validate"];
  if (modellingPath) args.unshift("--srs", modellingPath);
  let stdout = "";
  try {
    stdout = execSync(`node "${GENERATOR}" ${args.map(a => `"${a}"`).join(" ")}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    throw new Error(`generator failed: ${e.message}\nstdout: ${e.stdout}\nstderr: ${e.stderr}`);
  }
  const bundle = loadBundle(outDir);
  bundle.__outDir = outDir;
  bundle.__stdout = stdout;
  return bundle;
}

function loadBundle(dir) {
  const json = (f) => {
    const fp = path.join(dir, f);
    return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : null;
  };
  const opUnwrap = (file, key) => {
    const d = json(file);
    if (!d) return null;
    return Array.isArray(d) ? d : (d[key] || []);
  };
  const formsDir = path.join(dir, "forms");
  const formsByName = new Map();
  if (fs.existsSync(formsDir)) {
    for (const f of fs.readdirSync(formsDir).filter(n => n.endsWith(".json"))) {
      const form = JSON.parse(fs.readFileSync(path.join(formsDir, f), "utf8"));
      formsByName.set(form.name, form);
    }
  }
  return {
    concepts:                 json("concepts.json")                 || [],
    subjectTypes:             json("subjectTypes.json")             || [],
    programs:                 json("programs.json")                 || [],
    encounterTypes:           json("encounterTypes.json")           || [],
    formMappings:             json("formMappings.json")             || [],
    organisationConfig:       json("organisationConfig.json")       || null,
    addressLevelTypes:        json("addressLevelTypes.json")        || [],
    operationalSubjectTypes:  opUnwrap("operationalSubjectTypes.json",  "operationalSubjectTypes")  || [],
    operationalPrograms:      opUnwrap("operationalPrograms.json",      "operationalPrograms")      || [],
    operationalEncounterTypes:opUnwrap("operationalEncounterTypes.json","operationalEncounterTypes")|| [],
    forms:                    formsByName,
    conceptByName:            new Map((json("concepts.json")||[]).map(c => [c.name, c])),
    conceptByUuid:            new Map((json("concepts.json")||[]).map(c => [c.uuid, c])),
  };
}

function validate(dir) {
  const { BundleValidator } = require(VALIDATOR_PATH);
  const orig = console.log; console.log = () => {};
  const r = new BundleValidator(dir).validate();
  console.log = orig;
  return r;
}

module.exports = { makeWorkbook, generate, loadBundle, validate, AVNI_SKILLS_PATH };
