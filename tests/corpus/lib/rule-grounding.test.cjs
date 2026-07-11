"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ruleGrounding } = require("./rule-grounding.cjs");

function tmpBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rg-"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  for (const [rel, c] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, typeof c === "string" ? c : JSON.stringify(c));
  }
  return dir;
}

test("a well-formed rule grounds cleanly (0 errors)", async () => {
  const dir = tmpBundle({
    "concepts.json": [],
    "forms/x.json": { name: "Visit", visitScheduleRule: "({ params, imports }) => { return true; }" },
  });
  const r = await ruleGrounding(dir);
  assert.equal(r.errorCount, 0, JSON.stringify(r));
});

test("a syntactically broken rule is reported as a grounding error", async () => {
  const dir = tmpBundle({
    "concepts.json": [],
    "forms/x.json": { name: "Visit", decisionRule: "({ params, imports }) => { this is not valid js" },
  });
  const r = await ruleGrounding(dir);
  assert.ok(r.errorCount > 0, "syntax error detected");
  assert.ok(Object.keys(r.byCode).length > 0, "error grouped by code");
});
