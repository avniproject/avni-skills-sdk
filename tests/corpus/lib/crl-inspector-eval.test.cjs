"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspectorCatch } = require("./crl-inspector-eval.cjs");

function tmpBundle(concepts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inspector-eval-"));
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify(concepts));
  return dir;
}

test("a matching ai-judged finding with a catch verdict is caught", () => {
  const cleanDir = tmpBundle([{ name: "Age", dataType: "Numeric" }]);
  const seededDefect = {
    kind: "orphan-concept", file: "concepts.json",
    uuids: ["11111111-1111-1111-1111-111111111111"],
    names: ["Orphan NA Alpha"],
  };
  const aiFindings = [
    { ruleId: "ai-orphan-concept", class: "stray", severity: "warning",
      target: { file: "concepts.json", entityKind: "concept", name: "Orphan NA Alpha", uuid: "11111111-1111-1111-1111-111111111111" },
      verdict: "orphan", action: "prune-candidate", confidence: 0.95, rationale: "no form/answer references it" },
  ];
  const r = inspectorCatch(cleanDir, seededDefect, aiFindings);
  assert.equal(r.caught, true, JSON.stringify(r));
  assert.equal(r.matchedCount, 1);
  assert.equal(r.seededWasNovel, true);
});

test("no matching finding → not caught", () => {
  const cleanDir = tmpBundle([{ name: "Age", dataType: "Numeric" }]);
  const seededDefect = { kind: "orphan-concept", file: "concepts.json", uuids: [], names: ["Orphan NA Alpha"] };
  const aiFindings = [
    { ruleId: "other-rule", class: "shape", severity: "warning",
      target: { file: "forms/x.json", entityKind: "form", name: "Some Form" },
      verdict: "compliant", action: "flag", confidence: 0.5, rationale: "n/a" },
  ];
  assert.equal(inspectorCatch(cleanDir, seededDefect, aiFindings).caught, false);
});

test("a finding with a non-catch verdict (compliant) does not count, even on a name match", () => {
  const cleanDir = tmpBundle([{ name: "Age", dataType: "Numeric" }]);
  const seededDefect = { kind: "orphan-concept", file: "concepts.json", uuids: [], names: ["Orphan NA Alpha"] };
  const aiFindings = [
    { ruleId: "ai-orphan-concept", class: "stray", severity: "warning",
      target: { file: "concepts.json", entityKind: "concept", name: "Orphan NA Alpha" },
      verdict: "compliant", action: "flag", confidence: 0.4, rationale: "looked fine" },
  ];
  assert.equal(inspectorCatch(cleanDir, seededDefect, aiFindings).caught, false);
});

test("seededWasNovel is false when the defect's name already exists in the clean bundle", () => {
  const cleanDir = tmpBundle([{ name: "Orphan NA Alpha", dataType: "NA" }]);
  const seededDefect = { kind: "orphan-concept", file: "concepts.json", uuids: [], names: ["Orphan NA Alpha"] };
  assert.equal(inspectorCatch(cleanDir, seededDefect, []).seededWasNovel, false);
});
