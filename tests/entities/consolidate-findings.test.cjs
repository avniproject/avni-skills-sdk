"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

async function loadConsolidate() {
  return import(pathToFileURL(path.resolve(__dirname, "../../scripts/consolidate-findings.mjs")).href);
}

test("consolidate merges scorecard + review findings and classifies them", async () => {
  const { consolidate } = await loadConsolidate();

  const scorecard = {
    completeness: {
      findings: [
        { entity: "form:MyForm", code: "MISSING_ELEMENTS" },
        { entity: "program:MyProgram", code: "NO_ENROLLMENT_FORM" },
      ],
    },
    prose: {
      candidates: ["FormWithStrayProse", "AnotherForm"],
    },
    parity: {
      byFamily: {
        subjectTypes: { coverage: 0.9, missing: 0, extra: 0 },
        programs: { coverage: 0.8, missing: 2, extra: 0 },
        encounterTypes: { coverage: 1, missing: 0, extra: 0 },
        forms: { coverage: 0.7, missing: 5, extra: 0 },
      },
    },
    floorGreen: false,
  };

  const reviewFindings = [
    {
      entity: "form:MyForm",
      category: "MISSING_ELEMENTS",
      kind: "completeness-fill",
      confidence: 0.95,
      rootCause: "bundle",
    },
    {
      entity: "rule:RuleX",
      category: "syntax-error",
      kind: "rule-authoring",
      confidence: 0.8,
      rootCause: "generator",
    },
    {
      entity: "concept:TestConcept",
      category: "MISSING_ANSWERS",
      kind: "completeness-fill",
      confidence: 0.9,
    },
  ];

  const result = consolidate(scorecard, reviewFindings);

  // Check basic structure
  assert.ok(result.findings, "should have findings array");
  assert.ok(result.generatorDefects, "should have generatorDefects array");
  assert.ok(result.counts, "should have counts object");

  // Check counts
  assert.equal(result.counts.total, 8, "total should include all deduped findings");
  assert.equal(result.counts.fixable, 7, "should have 7 bundle-fixable findings");
  assert.equal(result.counts.generatorDefects, 1, "should have 1 generator-defect");

  // Check that generator-rootCause finding is in generatorDefects
  const generatorFind = result.generatorDefects.find((f) => f.entity === "rule:RuleX");
  assert.ok(generatorFind, "generator-rootCause finding should be in generatorDefects");
  assert.equal(generatorFind.rootCause, "generator");

  // Check that bundle-fixable findings are in findings array
  const bundleFix = result.findings.find((f) => f.entity === "concept:TestConcept");
  assert.ok(bundleFix, "bundle-fixable finding should be in findings");

  // Check that parity gaps are included
  const parityFind = result.findings.find((f) => f.entity === "parity:programs");
  assert.ok(parityFind, "parity gap should be in findings");
  assert.equal(parityFind.category, "parity-gap");

  // Check that prose candidates are converted
  const proseFind = result.findings.find((f) => f.entity === "form:FormWithStrayProse");
  assert.ok(proseFind, "prose candidate should be in findings as form entity");
  assert.equal(proseFind.category, "PROSE_AS_ENTITY");

  // Check dedupe: form:MyForm should keep the higher-confidence review finding (0.95 vs 1)
  const dedupedForm = result.findings.find((f) => f.entity === "form:MyForm" && f.category === "MISSING_ELEMENTS");
  assert.ok(dedupedForm, "deduped form finding should exist");
  assert.equal(dedupedForm.confidence, 1, "should keep the later-seen scorecard's confidence (1) since it's also 1");
});

test("consolidate deduplicates by entity|category, keeping highest confidence", async () => {
  const { consolidate } = await loadConsolidate();

  const scorecard = {
    completeness: {
      findings: [{ entity: "form:F1", code: "MISSING_ELEMENTS" }],
    },
    prose: { candidates: [] },
  };

  const reviewFindings = [
    {
      entity: "form:F1",
      category: "MISSING_ELEMENTS",
      kind: "completeness-fill",
      confidence: 0.95,
    },
  ];

  const result = consolidate(scorecard, reviewFindings);

  // Both have the same entity|category key, should dedupe to 1
  const matching = result.findings.filter(
    (f) => f.entity === "form:F1" && f.category === "MISSING_ELEMENTS"
  );
  assert.equal(matching.length, 1, "should dedupe to single finding");
});

test("consolidate CLI round-trip: reads files and prints JSON", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consolidate-test-"));
  try {
    const scorecard = {
      completeness: {
        findings: [{ entity: "form:F1", code: "MISSING" }],
      },
      prose: { candidates: ["FormWithProse"] },
      parity: {
        byFamily: {
          subjectTypes: { missing: 0 },
          programs: { missing: 1 },
          encounterTypes: { missing: 0 },
          forms: { missing: 0 },
        },
      },
    };

    const reviewFindings = [
      {
        entity: "concept:C1",
        category: "SYNTAX",
        confidence: 0.8,
        rootCause: "generator",
      },
    ];

    const scPath = path.join(tmpDir, "scorecard.json");
    const rvPath = path.join(tmpDir, "review-findings.json");

    fs.writeFileSync(scPath, JSON.stringify(scorecard));
    fs.writeFileSync(rvPath, JSON.stringify(reviewFindings));

    const scriptPath = path.resolve(__dirname, "../../scripts/consolidate-findings.mjs");
    const output = execFileSync("node", [scriptPath, scPath, rvPath], {
      encoding: "utf-8",
    });

    const result = JSON.parse(output);

    // Verify structure
    assert.ok(result.findings, "output should have findings");
    assert.ok(result.generatorDefects, "output should have generatorDefects");
    assert.ok(result.counts, "output should have counts");
    assert.ok(Number.isInteger(result.counts.total), "counts.total should be an integer");
    assert.ok(Number.isInteger(result.counts.fixable), "counts.fixable should be an integer");
    assert.ok(
      Number.isInteger(result.counts.generatorDefects),
      "counts.generatorDefects should be an integer"
    );

    // Verify the generator-defect was separated
    const genDef = result.generatorDefects.find((f) => f.entity === "concept:C1");
    assert.ok(genDef, "generator-defect should be in generatorDefects");

    // Verify scorecard findings are present
    const scFind = result.findings.find((f) => f.entity === "form:F1");
    assert.ok(scFind, "scorecard finding should be in findings");

    // Verify prose conversion
    const proseFind = result.findings.find((f) => f.entity === "form:FormWithProse");
    assert.ok(proseFind, "prose candidate should be converted");

    // Verify parity gap
    const parityFind = result.findings.find((f) => f.entity === "parity:programs");
    assert.ok(parityFind, "parity gap should be included");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("consolidate handles empty scorecard and review findings", async () => {
  const { consolidate } = await loadConsolidate();

  const scorecard = {
    completeness: { findings: [] },
    prose: { candidates: [] },
  };

  const reviewFindings = [];

  const result = consolidate(scorecard, reviewFindings);

  assert.equal(result.findings.length, 0, "should have no findings");
  assert.equal(result.generatorDefects.length, 0, "should have no generator defects");
  assert.equal(result.counts.total, 0);
});
