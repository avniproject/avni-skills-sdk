// Layer 4 static-validator tests. Org-agnostic: synthetic rule bodies only.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() {
  return await import("../../src/rules-brain/validate.js");
}

const CONCEPT_A = "11111111-1111-1111-1111-111111111111";
const CONCEPT_B = "22222222-2222-2222-2222-222222222222";

const conceptUuids = new Set([CONCEPT_A, CONCEPT_B]);

function arrowWrap(body) {
  return `"use strict";\n({params, imports}) => {\n${body}\n}`;
}
function legacyWrap(body) {
  return `"use strict";\nfunction(params, imports) {\n${body}\n}`;
}

test("empty body is valid", async () => {
  const { validateRuleBody } = await load();
  const r = validateRuleBody("");
  assert.equal(r.valid, true);
});

test("syntax error reported", async () => {
  const { validateRuleBody } = await load();
  const r = validateRuleBody(`'use strict';\n({params, imports}) => { let x = ; }`);
  assert.equal(r.valid, false);
  assert.match(r.errors[0].code, /R1-SYNTAX/);
});

test("wrapper must accept {params, imports} destructuring (arrow ok)", async () => {
  const { validateRuleBody } = await load();
  const ok = arrowWrap(`return [];`);
  assert.equal(validateRuleBody(ok).valid, true);
});

test("wrapper accepts parenthesised legacy function expression", async () => {
  const { validateRuleBody } = await load();
  // Bare `function(...)` at script top is a syntax error; legacy bundles
  // (if any survive) would have parenthesised it. Corpus is 100% arrow,
  // but we keep this path for forward compat.
  const ok = `"use strict";\n(function(params, imports) { return []; })`;
  assert.equal(validateRuleBody(ok).valid, true);
});

test("wrong wrapper shape errors", async () => {
  const { validateRuleBody } = await load();
  const bad = `"use strict"; ({x, y}) => { return []; }`;
  const r = validateRuleBody(bad);
  assert.equal(r.valid, false);
  assert.match(r.errors[0].code, /R2-WRAPPER/);
});

test("require() is rejected", async () => {
  const { validateRuleBody } = await load();
  const bad = arrowWrap(`const fs = require("fs"); return [];`);
  const r = validateRuleBody(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.find((e) => e.code === "R3-BLOCKED-GLOBAL" && /require/.test(e.message)));
});

test("eval() and Function constructor are rejected", async () => {
  const { validateRuleBody } = await load();
  const e1 = validateRuleBody(arrowWrap(`eval("1+1"); return [];`));
  const e2 = validateRuleBody(arrowWrap(`new Function("return 1")(); return [];`));
  assert.equal(e1.valid, false);
  assert.equal(e2.valid, false);
});

test("imports.X is whitelisted", async () => {
  const { validateRuleBody } = await load();
  const ok = arrowWrap(`return imports.moment(); imports.lodash.isEmpty([]); imports.rulesConfig.RuleCondition;`);
  const r = validateRuleBody(ok);
  // moment, lodash, rulesConfig allowed
  assert.ok(!r.errors.find((e) => e.code === "R4-BAD-IMPORT"), `unexpected R4: ${JSON.stringify(r.errors)}`);
});

test("imports.globalFn is rejected (not injected by rules-server)", async () => {
  const { validateRuleBody } = await load();
  const bad = arrowWrap(`imports.globalFn.frobnicate(); return [];`);
  const r = validateRuleBody(bad);
  assert.ok(r.errors.find((e) => e.code === "R4-BAD-IMPORT" && /globalFn/.test(e.message)));
});

test("imports.rulesConfig.UnknownClass is rejected", async () => {
  const { validateRuleBody } = await load();
  const bad = arrowWrap(`new imports.rulesConfig.WhatNow(); return [];`);
  const r = validateRuleBody(bad);
  assert.ok(r.errors.find((e) => e.code === "R5-BAD-RULESCONFIG-CLASS" && /WhatNow/.test(e.message)));
});

test("imports.rulesConfig.VisitScheduleBuilder is accepted", async () => {
  const { validateRuleBody } = await load();
  const ok = arrowWrap(`return new imports.rulesConfig.VisitScheduleBuilder({}).getAll();`);
  const r = validateRuleBody(ok);
  assert.ok(!r.errors.find((e) => e.code === "R5-BAD-RULESCONFIG-CLASS"));
});

test("known concept UUID passes; unknown UUID warns", async () => {
  const { validateRuleBody } = await load();
  const body = arrowWrap(`const v = "${CONCEPT_A}"; const w = "33333333-3333-3333-3333-333333333333"; return [];`);
  const r = validateRuleBody(body, { conceptUuids });
  // Known UUID -> no warning. Unknown -> one warning (but no error)
  assert.equal(r.valid, true);
  const uuidWarns = r.warnings.filter((w) => w.code === "R6-UUID-UNKNOWN");
  assert.equal(uuidWarns.length, 1);
  assert.match(uuidWarns[0].message, /33333333/);
});

test("UUID liveness skipped if conceptUuids absent (warns instead)", async () => {
  const { validateRuleBody } = await load();
  const body = arrowWrap(`const v = "${CONCEPT_A}"; return [];`);
  const r = validateRuleBody(body); // no conceptUuids
  const w = r.warnings.find((w) => w.code === "R6-UUID-UNCHECKED");
  assert.ok(w, "expected R6-UUID-UNCHECKED warning");
});

test("real-shape rule from a generated template passes", async () => {
  const { validateRuleBody } = await load();
  const body = `"use strict";
({params, imports}) => {
  const programEncounter = params.entity;
  const moment = imports.moment;
  const scheduleBuilder = new imports.rulesConfig.VisitScheduleBuilder({programEncounter});
  const earliestDate = moment(programEncounter.encounterDateTime).add(28, 'days').toDate();
  const maxDate = moment(programEncounter.encounterDateTime).add(42, 'days').toDate();
  scheduleBuilder.add({name: "ANC 2", encounterType: "ANC 2", earliestDate, maxDate});
  return scheduleBuilder.getAll();
};`;
  const r = validateRuleBody(body, { conceptUuids });
  assert.equal(r.valid, true, `unexpected errors: ${JSON.stringify(r.errors, null, 2)}`);
});
