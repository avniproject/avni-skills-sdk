# Doorstep Parity Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a test harness that generates an Avni bundle from Forms+Modelling workbooks and reports name-normalized **entity-graph parity** against a reference bundle, proven on a committed synthetic org and runnable locally against the (gitignored) real Door Step School inputs.

**Architecture:** Small CJS units under `tests/corpus/doorstep/lib/` — name normalization, a bundle→active-name-set reader, and a set-diff/report. A `node:test` file wires them end-to-end on a synthetic org (always run in CI) plus a gated real-data case (skipped when the proprietary files are absent). A thin CLI (`scripts/doorstep-parity.mjs`) runs the same pipeline against the real inputs and prints the gap that seeds Phase 3.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`), CommonJS (`.cjs`) per repo rule §5, the existing `tests/entities/lib/fixture.cjs` generate/validate primitives, and the `avni-skills` generator (located via `AVNI_SKILLS_PATH` or sibling clone).

## Global Constraints

- **Module system (rule §5):** all test/lib files here are **CommonJS `.cjs`** (`require`/`module.exports`). No ESM in these files.
- **No proprietary data (rule §2):** the real DSS files (`*.xlsx`, `*.zip`) are gitignored and never committed. Only the synthetic org-agnostic fixture is committed. Tests auto-skip when real files are absent.
- **Org-agnostic committed tests (rule §1):** the committed fixture is an invented org ("Acme Wellness"), never a real NGO.
- **avni-skills required:** generation needs `avni-skills` at `$AVNI_SKILLS_PATH` or `../avni-skills`. `fixture.cjs` already enforces this.
- **Scope:** this plan is **Phase 2** of the spec (`docs/superpowers/specs/2026-07-10-doorstep-bundle-generation-design.md`). Phase 3 (authoring the real workbooks to reach parity) is a **follow-up plan**, seeded by this plan's final baseline-gap output.
- **Parity gate classes (active-only, by normalized name):** `subjectTypes`, `programs`, `encounterTypes`, `forms`. `addressLevelTypes` and `formMappings` are reported as **informational** dimensions, not pass/fail gates (aligns with the user-approved success bar). Concepts are informational only.
- **Commit convention:** conventional commits; end every message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit after each task.

---

## File Structure

- `tests/corpus/doorstep/lib/entity-names.cjs` — `normalizeName`, `isVoided`, `bundleActiveNames(dir)`. Pure JSON reading + normalization; no avni-skills dependency (independently unit-testable).
- `tests/corpus/doorstep/lib/parity.cjs` — `diffNames(generated, target, gateClasses)`, `formatParityReport(diff)`. Pure set logic; no I/O.
- `tests/corpus/doorstep/lib/synthetic-fixture.cjs` — the committed invented-org SRS (`formsSheets`, `modellingSheets`) + its declared `EXPECTED` active-name graph.
- `tests/corpus/doorstep/parity.test.cjs` — `node:test`: synthetic end-to-end (generate→validate→diff) + gated real-data case.
- `tests/resources/doorstep/README.md` — committed: how to place the real files locally.
- `.gitignore` — add an explicit `tests/resources/doorstep/` data guard (keep the README).
- `scripts/doorstep-parity.mjs` — CLI runner: extract UAT zip, generate from real workbooks, print parity report, write gap JSON.
- `package.json` — add `tests/corpus/doorstep/*.test.cjs` to the `test` script glob.

---

### Task 1: Name normalization helpers

**Files:**
- Create: `tests/corpus/doorstep/lib/entity-names.cjs`
- Test: `tests/corpus/doorstep/lib/entity-names.test.cjs`

**Interfaces:**
- Produces: `normalizeName(name: string): string` — lowercased, `(voided~NNN)` suffix stripped, whitespace collapsed, trimmed. `isVoided(entity: object): boolean` — true if `entity.voided === true` or the name contains `voided~`.

- [ ] **Step 1: Write the failing test**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeName, isVoided } = require("./entity-names.cjs");

test("normalizeName lowercases, trims, collapses whitespace, strips voided suffix", () => {
  assert.equal(normalizeName("  FLN   Enrolment "), "fln enrolment");
  assert.equal(normalizeName("Donor Association (voided~2240)"), "donor association");
  assert.equal(normalizeName("Attendance (voided~23177)"), "attendance");
});

test("isVoided detects the voided flag and the name marker", () => {
  assert.equal(isVoided({ name: "FLN", voided: true }), true);
  assert.equal(isVoided({ name: "Attendance (voided~23177)", voided: false }), true);
  assert.equal(isVoided({ name: "FLN", voided: false }), false);
  assert.equal(isVoided({ name: "FLN" }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/corpus/doorstep/lib/entity-names.test.cjs`
Expected: FAIL — `Cannot find module './entity-names.cjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
"use strict";
// Read an Avni bundle directory and reduce it to sets of active entity names.
// UUID-independent (generator mints deterministic UUIDs; a server export has
// random ones), so parity is compared on normalized NAMES, not raw JSON.
const fs = require("node:fs");
const path = require("node:path");

function normalizeName(name) {
  return String(name == null ? "" : name)
    .replace(/\(voided~\d+\)/gi, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isVoided(entity) {
  if (!entity || typeof entity !== "object") return false;
  if (entity.voided === true) return true;
  return /voided~/i.test(String(entity.name || ""));
}

module.exports = { normalizeName, isVoided };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/corpus/doorstep/lib/entity-names.test.cjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/corpus/doorstep/lib/entity-names.cjs tests/corpus/doorstep/lib/entity-names.test.cjs
git commit -m "feat(doorstep): name-normalization helpers for parity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `bundleActiveNames(dir)` reader

**Files:**
- Modify: `tests/corpus/doorstep/lib/entity-names.cjs` (add `bundleActiveNames`)
- Test: `tests/corpus/doorstep/lib/entity-names.test.cjs` (add cases)

**Interfaces:**
- Consumes: `normalizeName`, `isVoided` from Task 1.
- Produces: `bundleActiveNames(dir: string): { addressLevelTypes:Set<string>, subjectTypes:Set<string>, programs:Set<string>, encounterTypes:Set<string>, forms:Set<string>, formMappings:Set<string> }` — normalized names of **non-voided** entities. Reads `addressLevelTypes.json`, `subjectTypes.json`, `programs.json`, `encounterTypes.json`, `forms/*.json`, and (for `formMappings`) `formMappings.json` resolved to `formName` when present. Missing files → empty sets.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/corpus/doorstep/lib/entity-names.test.cjs
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bundleActiveNames } = require("./entity-names.cjs");

function tmpBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dss-bundle-"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(content));
  }
  return dir;
}

test("bundleActiveNames collects active names and excludes voided", () => {
  const dir = tmpBundle({
    "subjectTypes.json": [{ name: "Student" }, { name: "Old", voided: true }],
    "programs.json": [{ name: "FLN" }, { name: "Donor Association (voided~2240)", voided: true }],
    "encounterTypes.json": [{ name: "FLN Performance Assessment" }],
    "addressLevelTypes.json": [{ name: "School" }],
    "forms/a.json": { name: "Student Register" },
    "forms/b.json": { name: "Attendance (voided~1)", voided: true },
    "formMappings.json": [{ formName: "Student Register" }],
  });
  const n = bundleActiveNames(dir);
  assert.deepEqual([...n.subjectTypes].sort(), ["student"]);
  assert.deepEqual([...n.programs].sort(), ["fln"]);
  assert.deepEqual([...n.encounterTypes].sort(), ["fln performance assessment"]);
  assert.deepEqual([...n.forms].sort(), ["student register"]);
  assert.deepEqual([...n.addressLevelTypes].sort(), ["school"]);
  assert.deepEqual([...n.formMappings].sort(), ["student register"]);
});

test("bundleActiveNames tolerates missing files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dss-empty-"));
  const n = bundleActiveNames(dir);
  for (const k of ["subjectTypes","programs","encounterTypes","forms","addressLevelTypes","formMappings"]) {
    assert.equal(n[k].size, 0, `${k} empty`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/corpus/doorstep/lib/entity-names.test.cjs`
Expected: FAIL — `bundleActiveNames is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// add to tests/corpus/doorstep/lib/entity-names.cjs, then export it
function readJson(fp) {
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; }
}
function asArray(v, key) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && Array.isArray(v[key])) return v[key];
  return [];
}
function activeNameSet(arr) {
  const s = new Set();
  for (const e of arr) {
    if (!e || isVoided(e)) continue;
    const nm = normalizeName(e.name || e.formName);
    if (nm) s.add(nm);
  }
  return s;
}

function bundleActiveNames(dir) {
  const j = (f) => readJson(path.join(dir, f));
  const formsDir = path.join(dir, "forms");
  const forms = [];
  if (fs.existsSync(formsDir)) {
    for (const f of fs.readdirSync(formsDir).filter((n) => n.endsWith(".json"))) {
      const form = readJson(path.join(formsDir, f));
      if (form) forms.push(form);
    }
  }
  return {
    addressLevelTypes: activeNameSet(asArray(j("addressLevelTypes.json"), "addressLevelTypes")),
    subjectTypes:      activeNameSet(asArray(j("subjectTypes.json"), "subjectTypes")),
    programs:          activeNameSet(asArray(j("programs.json"), "programs")),
    encounterTypes:    activeNameSet(asArray(j("encounterTypes.json"), "encounterTypes")),
    forms:             activeNameSet(forms),
    formMappings:      activeNameSet(asArray(j("formMappings.json"), "formMappings")),
  };
}

module.exports = { normalizeName, isVoided, bundleActiveNames };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/corpus/doorstep/lib/entity-names.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/corpus/doorstep/lib/entity-names.cjs tests/corpus/doorstep/lib/entity-names.test.cjs
git commit -m "feat(doorstep): bundleActiveNames reader (active-only, UUID-independent)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `diffNames` + `formatParityReport`

**Files:**
- Create: `tests/corpus/doorstep/lib/parity.cjs`
- Test: `tests/corpus/doorstep/lib/parity.test.cjs`

**Interfaces:**
- Consumes: name-set objects shaped like `bundleActiveNames`' return.
- Produces:
  - `diffNames(generated, target, gateClasses = ["subjectTypes","programs","encounterTypes","forms"]): { classes: {[k]: {present:string[], missing:string[], extra:string[]}}, pass: boolean }` — `pass` is true iff every **gate class** has zero `missing`. Non-gate classes are still diffed and reported, but do not affect `pass`.
  - `formatParityReport(diff): string` — a human-readable summary.

- [ ] **Step 1: Write the failing test**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { diffNames, formatParityReport } = require("./parity.cjs");

const mk = (o) => ({
  addressLevelTypes: new Set(o.addressLevelTypes || []),
  subjectTypes: new Set(o.subjectTypes || []),
  programs: new Set(o.programs || []),
  encounterTypes: new Set(o.encounterTypes || []),
  forms: new Set(o.forms || []),
  formMappings: new Set(o.formMappings || []),
});

test("diffNames passes when all gate classes are fully covered", () => {
  const target = mk({ subjectTypes: ["student"], programs: ["fln"], encounterTypes: ["e"], forms: ["f"] });
  const generated = mk({ subjectTypes: ["student"], programs: ["fln"], encounterTypes: ["e"], forms: ["f","extra"] });
  const d = diffNames(generated, target);
  assert.equal(d.pass, true, "extra form does not fail parity");
  assert.deepEqual(d.classes.forms.extra, ["extra"]);
  assert.deepEqual(d.classes.forms.missing, []);
});

test("diffNames fails when a gate class is missing an entity", () => {
  const target = mk({ subjectTypes: ["student","teacher"], programs: ["fln"], encounterTypes: ["e"], forms: ["f"] });
  const generated = mk({ subjectTypes: ["student"], programs: ["fln"], encounterTypes: ["e"], forms: ["f"] });
  const d = diffNames(generated, target);
  assert.equal(d.pass, false);
  assert.deepEqual(d.classes.subjectTypes.missing, ["teacher"]);
});

test("non-gate classes (addressLevelTypes/formMappings) do not affect pass", () => {
  const target = mk({ subjectTypes: ["s"], programs: ["p"], encounterTypes: ["e"], forms: ["f"], addressLevelTypes: ["ward"] });
  const generated = mk({ subjectTypes: ["s"], programs: ["p"], encounterTypes: ["e"], forms: ["f"] });
  const d = diffNames(generated, target);
  assert.equal(d.pass, true, "missing addressLevelType is informational only");
  assert.deepEqual(d.classes.addressLevelTypes.missing, ["ward"]);
});

test("formatParityReport renders a string mentioning missing entities", () => {
  const target = mk({ subjectTypes: ["student","teacher"], programs: ["fln"], encounterTypes: ["e"], forms: ["f"] });
  const generated = mk({ subjectTypes: ["student"], programs: ["fln"], encounterTypes: ["e"], forms: ["f"] });
  const s = formatParityReport(diffNames(generated, target));
  assert.match(s, /teacher/);
  assert.match(s, /FAIL|missing/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/corpus/doorstep/lib/parity.test.cjs`
Expected: FAIL — `Cannot find module './parity.cjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
"use strict";
// Compare two bundles' active-name sets. `pass` gates only on the entity
// classes the approved success bar names; other classes are reported for
// insight but never fail the run.
const GATE_CLASSES = ["subjectTypes", "programs", "encounterTypes", "forms"];
const ALL_CLASSES = ["addressLevelTypes", "subjectTypes", "programs", "encounterTypes", "forms", "formMappings"];

function diffOne(gen, tgt) {
  const present = [], missing = [];
  for (const name of tgt) (gen.has(name) ? present : missing).push(name);
  const extra = [...gen].filter((n) => !tgt.has(n));
  return { present: present.sort(), missing: missing.sort(), extra: extra.sort() };
}

function diffNames(generated, target, gateClasses = GATE_CLASSES) {
  const classes = {};
  for (const k of ALL_CLASSES) {
    classes[k] = diffOne(generated[k] || new Set(), target[k] || new Set());
  }
  const pass = gateClasses.every((k) => classes[k].missing.length === 0);
  return { classes, pass };
}

function formatParityReport(diff) {
  const lines = [`PARITY: ${diff.pass ? "PASS" : "FAIL"}`];
  for (const [k, c] of Object.entries(diff.classes)) {
    const tot = c.present.length + c.missing.length;
    lines.push(`  ${k}: ${c.present.length}/${tot} present` +
      (c.missing.length ? `, missing [${c.missing.join(", ")}]` : "") +
      (c.extra.length ? `, extra [${c.extra.join(", ")}]` : ""));
  }
  return lines.join("\n");
}

module.exports = { diffNames, formatParityReport, GATE_CLASSES, ALL_CLASSES };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/corpus/doorstep/lib/parity.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/corpus/doorstep/lib/parity.cjs tests/corpus/doorstep/lib/parity.test.cjs
git commit -m "feat(doorstep): name-set diff + parity report (gate on ST/P/ET/forms)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Synthetic-org fixture + end-to-end harness test

**Files:**
- Create: `tests/corpus/doorstep/lib/synthetic-fixture.cjs`
- Create: `tests/corpus/doorstep/parity.test.cjs`
- Modify: `package.json` (add `tests/corpus/doorstep/*.test.cjs` to the `test` script)

**Interfaces:**
- Consumes: `generate`, `validate` from `tests/entities/lib/fixture.cjs`; `bundleActiveNames` (Task 2); `diffNames`, `formatParityReport` (Task 3).
- Produces: `synthetic-fixture.cjs` exports `{ formsSheets, modellingSheets, org, EXPECTED }` where `EXPECTED` is a name-set object (same shape as `bundleActiveNames`' return) declaring the org-agnostic invented org's active entity graph.

- [ ] **Step 1: Write the fixture (committed test data)**

Create `tests/corpus/doorstep/lib/synthetic-fixture.cjs`:

```js
"use strict";
// Invented, org-agnostic org ("Acme Wellness") — proves the harness mechanics
// end-to-end without any proprietary data (rule §1/§2). Mirrors the Doorstep
// shape in miniature: a Person subject with a registration form, one Program
// with enrolment/exit forms + a program encounter.
const form = (rows) => [["Field Name", "Data Type", "Mandatory (default No)"], ...rows];

const formsSheets = {
  "Member Registration": form([["Full Name", "Text", "Yes"], ["Date of Birth", "Date", "No"]]),
  "Wellness Enrolment":  form([["Enrolment Date", "Date", "Yes"], ["Baseline Score", "Numeric", "No"]]),
  "Wellness Exit":       form([["Exit Date", "Date", "Yes"], ["Exit Reason", "Text", "No"]]),
  "Wellness Checkup":    form([["Visit Date", "Date", "Yes"], ["Weight", "Numeric", "No"]]),
};

const modellingSheets = {
  "Subject Types": [
    ["Subject Type Name", "Type", "Form Link"],
    ["Member", "Person", "Member Registration"],
  ],
  "Program": [
    ["Program Name", "Enrolment Form", "Exit Form", "Description", "Target Subject Type"],
    ["Wellness", "Wellness Enrolment", "Wellness Exit", "", "Member"],
  ],
  "Program Encounters": [
    ["Encounter Name", "Program name"],
    ["Wellness Checkup", "Wellness"],
  ],
  "Location Hierarchy": [
    ["Location Type"],
    ["Village"],
  ],
};

// Declared expected active-name graph. NOTE: calibrate on first run — see the
// test's Step-3 note; update these to the printed generator output if it differs.
const EXPECTED = {
  addressLevelTypes: new Set(["village"]),
  subjectTypes: new Set(["member"]),
  programs: new Set(["wellness"]),
  encounterTypes: new Set(["wellness checkup"]),
  forms: new Set(["member registration", "wellness enrolment", "wellness exit", "wellness checkup"]),
  formMappings: new Set(["member registration", "wellness enrolment", "wellness exit", "wellness checkup"]),
};

module.exports = { formsSheets, modellingSheets, org: "AcmeWellness", EXPECTED };
```

- [ ] **Step 2: Write the failing end-to-end test**

Create `tests/corpus/doorstep/parity.test.cjs`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generate, validate } = require("../../entities/lib/fixture.cjs");
const { bundleActiveNames } = require("./lib/entity-names.cjs");
const { diffNames, formatParityReport } = require("./lib/parity.cjs");
const fixture = require("./lib/synthetic-fixture.cjs");

test("synthetic org: generates, validates clean, and reaches entity-graph parity", () => {
  const b = generate({
    formsSheets: fixture.formsSheets,
    modellingSheets: fixture.modellingSheets,
    org: fixture.org,
  });

  // Validation gate: 0 errors.
  const v = validate(b.__outDir);
  assert.equal(v.errors.length, 0, `validator errors:\n${JSON.stringify(v.errors, null, 2)}`);

  // Parity gate vs the declared expected graph.
  const generated = bundleActiveNames(b.__outDir);
  const diff = diffNames(generated, fixture.EXPECTED);
  assert.equal(diff.pass, true, `\n${formatParityReport(diff)}`);
  // No unexpected extras in gate classes either (tightens the synthetic case).
  for (const k of ["subjectTypes", "programs", "encounterTypes", "forms"]) {
    assert.deepEqual(diff.classes[k].extra, [], `${k} extras: ${diff.classes[k].extra}`);
  }
});
```

- [ ] **Step 3: Run test to verify it fails, then calibrate**

Run: `AVNI_SKILLS_PATH=~/IdeaProjects/avni-skills node --test tests/corpus/doorstep/parity.test.cjs`
Expected: FAIL initially (module wiring, or an `EXPECTED`/validator mismatch).
**Calibration:** if it fails only on `EXPECTED` vs generated names or on validator errors, print the actuals:
```bash
AVNI_SKILLS_PATH=~/IdeaProjects/avni-skills node -e '
const {generate,validate}=require("./tests/entities/lib/fixture.cjs");
const f=require("./tests/corpus/doorstep/lib/synthetic-fixture.cjs");
const {bundleActiveNames}=require("./tests/corpus/doorstep/lib/entity-names.cjs");
const b=generate({formsSheets:f.formsSheets,modellingSheets:f.modellingSheets,org:f.org});
console.log("errors:",JSON.stringify(validate(b.__outDir).errors,null,2));
const n=bundleActiveNames(b.__outDir);
for(const k of Object.keys(n)) console.log(k,[...n[k]].sort());
'
```
Then reconcile: adjust `synthetic-fixture.cjs` `formsSheets`/`modellingSheets` until the validator is clean, and set `EXPECTED` to the generator's actual active names. The fixture is test data we own — this calibration is expected TDD, not a shortcut.

- [ ] **Step 4: Wire the test into `npm test` and run the full check**

Edit `package.json` — change the `test` script from:
```
"test": "node --test tests/entities/*.test.cjs tests/discovery/*.test.cjs scripts/recovery/*.test.cjs",
```
to:
```
"test": "node --test tests/entities/*.test.cjs tests/discovery/*.test.cjs tests/corpus/doorstep/*.test.cjs scripts/recovery/*.test.cjs",
```
Run: `AVNI_SKILLS_PATH=~/IdeaProjects/avni-skills npm test`
Expected: PASS — all prior tests plus the new doorstep lib + parity tests green.

- [ ] **Step 5: Commit**

```bash
git add tests/corpus/doorstep/lib/synthetic-fixture.cjs tests/corpus/doorstep/parity.test.cjs package.json
git commit -m "test(doorstep): synthetic-org end-to-end parity harness + npm test wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Gated real-data case + resource staging

**Files:**
- Create: `tests/resources/doorstep/README.md`
- Modify: `.gitignore`
- Modify: `tests/corpus/doorstep/parity.test.cjs` (add a gated real-data test)

**Interfaces:**
- Consumes: everything from Tasks 2–4, plus `node:child_process` `execSync` to `unzip` the UAT, and `fixture.cjs` `generate`.
- Produces: a test that **skips** unless all three real files exist under `tests/resources/doorstep/`.

- [ ] **Step 1: Add the .gitignore guard**

Append to `.gitignore`:
```
# Doorstep proprietary org data — local-only, never committed (rule §2)
tests/resources/doorstep/*.xlsx
tests/resources/doorstep/*.zip
tests/resources/doorstep/uat/
```

- [ ] **Step 2: Write the resource README (committed)**

Create `tests/resources/doorstep/README.md`:
```markdown
# Doorstep real inputs (local-only, gitignored)

These proprietary Door Step School files are **never committed** (CLAUDE.md §2).
Place them here to enable the gated real-data parity test + the CLI:

- `Doorstep school Scoping Document  [To-Use].xlsx`  — Forms source
- `Doorstep school Modelling.xlsx`                    — Modelling source
- `Door Step School UAT.zip`                          — parity oracle

Absent these, the real-data test auto-skips and CI runs only the synthetic fixture.

Run the report: `node scripts/doorstep-parity.mjs`
```

- [ ] **Step 3: Write the gated real-data test**

Append to `tests/corpus/doorstep/parity.test.cjs`:
```js
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const XLSX = require("../../entities/lib/fixture.cjs"); // ensures avni-skills present
const RES = path.join(__dirname, "..", "..", "resources", "doorstep");
const FORMS_XLSX = path.join(RES, "Doorstep school Scoping Document  [To-Use].xlsx");
const MODEL_XLSX = path.join(RES, "Doorstep school Modelling.xlsx");
const UAT_ZIP = path.join(RES, "Door Step School UAT.zip");
const haveReal = [FORMS_XLSX, MODEL_XLSX, UAT_ZIP].every((p) => fs.existsSync(p));

test("real Doorstep inputs: entity-graph parity vs UAT", { skip: !haveReal && "real DSS files absent (see tests/resources/doorstep/README.md)" }, () => {
  const { runDoorstepParity } = require("./lib/run-parity.cjs");
  const { diff, validation } = runDoorstepParity({ formsXlsx: FORMS_XLSX, modelXlsx: MODEL_XLSX, uatZip: UAT_ZIP });
  assert.equal(validation.errors.length, 0, `validator errors: ${JSON.stringify(validation.errors, null, 2)}`);
  const { formatParityReport } = require("./lib/parity.cjs");
  assert.equal(diff.pass, true, `\n${formatParityReport(diff)}`);
});
```

- [ ] **Step 4: Extract the shared runner used by the test and the CLI**

Create `tests/corpus/doorstep/lib/run-parity.cjs` (single source of truth for "generate from real xlsx + unzip UAT + diff"):
```js
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { AVNI_SKILLS_PATH, validate } = require("../../../entities/lib/fixture.cjs");
const { bundleActiveNames } = require("./entity-names.cjs");
const { diffNames } = require("./parity.cjs");

const GENERATOR = path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "scripts", "generate_bundle_v2.js");

// Generate a bundle directly from real .xlsx files (not the in-memory fixture).
function generateFromXlsx({ formsXlsx, modelXlsx, org = "Doorstep" }) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dss-gen-"));
  const args = ["--srs", modelXlsx, "--forms", formsXlsx, "--org", org, "--output", outDir, "--no-validate"];
  execSync(`node "${GENERATOR}" ${args.map((a) => `"${a}"`).join(" ")}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return outDir;
}

function unzipTo(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dss-uat-"));
  execSync(`unzip -o "${zip}" -d "${dir}"`, { stdio: ["ignore", "pipe", "pipe"] });
  return dir;
}

function runDoorstepParity({ formsXlsx, modelXlsx, uatZip, org = "Doorstep" }) {
  const genDir = generateFromXlsx({ formsXlsx, modelXlsx, org });
  const uatDir = unzipTo(uatZip);
  const generated = bundleActiveNames(genDir);
  const target = bundleActiveNames(uatDir);
  const diff = diffNames(generated, target);
  const validation = validate(genDir);
  return { diff, validation, genDir, uatDir, generated, target };
}

module.exports = { runDoorstepParity, generateFromXlsx, unzipTo };
```
Then simplify the Step-3 test to `const { runDoorstepParity } = require("./lib/run-parity.cjs");` (already written that way).

- [ ] **Step 5: Run — confirm skip without files, then commit**

Run: `AVNI_SKILLS_PATH=~/IdeaProjects/avni-skills node --test tests/corpus/doorstep/parity.test.cjs`
Expected: synthetic test PASS; real-data test **SKIP** (files absent).
Confirm `git status` shows the real files are NOT staged (only README + code).
```bash
git add .gitignore tests/resources/doorstep/README.md tests/corpus/doorstep/parity.test.cjs tests/corpus/doorstep/lib/run-parity.cjs
git commit -m "test(doorstep): gated real-data parity case + local-only resource staging

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: CLI runner + capture the baseline gap (Phase-3 seed)

**Files:**
- Create: `scripts/doorstep-parity.mjs`

**Interfaces:**
- Consumes: `runDoorstepParity` + `formatParityReport` from Task 5.
- Produces: a CLI that prints the parity report and writes a gap JSON, for iterating Phase 3.

- [ ] **Step 1: Write the CLI**

Create `scripts/doorstep-parity.mjs`:
```js
#!/usr/bin/env node
// Run Doorstep bundle generation from the real (gitignored) workbooks and print
// entity-graph parity vs the UAT bundle. Seeds Phase 3 authoring.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { runDoorstepParity } = require("../tests/corpus/doorstep/lib/run-parity.cjs");
const { formatParityReport } = require("../tests/corpus/doorstep/lib/parity.cjs");

const RES = path.resolve("tests/resources/doorstep");
const args = {
  formsXlsx: path.join(RES, "Doorstep school Scoping Document  [To-Use].xlsx"),
  modelXlsx: path.join(RES, "Doorstep school Modelling.xlsx"),
  uatZip: path.join(RES, "Door Step School UAT.zip"),
};
for (const [k, p] of Object.entries(args)) {
  if (!fs.existsSync(p)) { console.error(`missing: ${p}\nSee ${RES}/README.md`); process.exit(2); }
}
const { diff, validation } = runDoorstepParity(args);
console.log(`validator errors: ${validation.errors.length}`);
console.log(formatParityReport(diff));
const outFp = path.join(RES, "parity-gap.json");
fs.writeFileSync(outFp, JSON.stringify({ pass: diff.pass, validatorErrors: validation.errors.length, classes: diff.classes }, null, 2));
console.log(`gap written: ${outFp} (gitignored)`);
process.exit(diff.pass && validation.errors.length === 0 ? 0 : 1);
```
Add `tests/resources/doorstep/parity-gap.json` to `.gitignore`.

- [ ] **Step 2: Run against the real inputs (local only) to capture the baseline**

Run: `AVNI_SKILLS_PATH=~/IdeaProjects/avni-skills node scripts/doorstep-parity.mjs`
Expected: it prints a report (likely FAIL initially — that's the point). Capture the printed missing/extra + validator errors. This baseline gap **is the input to the Phase-3 plan**.

- [ ] **Step 3: Commit the CLI (not the gap output)**

```bash
git add scripts/doorstep-parity.mjs .gitignore
git commit -m "feat(doorstep): CLI parity runner over real inputs (Phase-3 seed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand off to Phase 3**

Summarize the baseline gap (missing subjectTypes/programs/encounterTypes/forms + validator errors) and start a **new plan** (`docs/superpowers/plans/2026-07-1x-doorstep-enablement.md`) via `writing-plans` to author/curate the workbooks until `node scripts/doorstep-parity.mjs` exits 0. Do NOT expand this plan — Phase 3 tasks depend on the runtime gap captured here.

---

## Self-Review

**Spec coverage:**
- Generates & validates (spec §success 1) → Task 4 (synthetic), Task 5/6 (real) assert validator errors === 0.
- Entity-graph parity by name, active-only (spec §success 2) → Tasks 2–3 (mechanics), 4 (synthetic), 5/6 (real). Gate classes = ST/P/ET/forms per approved bar; addressLevelTypes/formMappings informational.
- Voided & admin-artifact exclusion (spec §scope) → `isVoided` (Task 1) + reading only the generatable-core files (Task 2); admin artifacts never read.
- Data handling / §2 (spec §data) → Task 5 gitignore + gated skip + committed synthetic fixture (Task 4).
- Name-normalized comparison (spec §scope) → `normalizeName` (Task 1).
- Phase 3 seed → Task 6 captures the baseline gap and hands off to a follow-up plan.

**Placeholder scan:** No TBD/TODO. The one calibration note (Task 4 Step 3) is explicit, reproducible test-data tuning, not a placeholder — concrete `EXPECTED` values are provided as the starting point.

**Type consistency:** `bundleActiveNames` returns the six-key Set object used identically by `diffNames` (Task 3), the synthetic test (Task 4), and `run-parity.cjs` (Task 5). `diffNames`→`{classes,pass}` consumed consistently by `formatParityReport` and both tests + CLI. Generator invoked identically (`--srs`/`--forms`/`--org`/`--output`/`--no-validate`) in `fixture.cjs` and `run-parity.cjs`.

**Note on real-data reachability:** whether the real inputs reach parity **without** an upstream generator change is the empirical question Task 6 answers. If a generator-core gap blocks parity, the Phase-3 plan records it as a documented finding + upstream ticket (spec §risks) — this harness plan is complete regardless of that outcome.
