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
