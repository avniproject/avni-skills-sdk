// src/comprehension/patch-schema.js — the scoping-comprehension correction patch.
// A patch is a list of grounded ops that a deterministic patcher applies to the
// draft bundle. Every op MUST carry provenance (source sheet + cell/row) — an op
// without it is DROPPED. This is the line between extracting-from-noise
// (legitimate) and fabricating (rejected): the Opus pass may only assert a
// correction it can point to in the raw doc.

export const PATCH_OPS = new Set([
  "add-answers",     // attach answer options to an existing Coded concept
  "reclassify-form", // change a form's formType (+ fix its formMapping)
  "set-subject",     // change a formMapping's subject type
  "drop-entity",     // remove a stray entity (concept/form/encounterType)
  "merge-entities",  // fold a duplicate entity into its canonical twin
  "set-field",       // set a scalar on an entity (a rule/eligibility body)
]);

// Required fields per op (beyond op + provenance).
const REQUIRED = {
  "add-answers":     (o) => o.concept && Array.isArray(o.answers) && o.answers.length > 0,
  "reclassify-form": (o) => o.form && typeof o.formType === "string",
  "set-subject":     (o) => o.form && typeof o.subjectType === "string",
  "drop-entity":     (o) => o.entityKind && (o.name || o.uuid),
  "merge-entities":  (o) => o.duplicate && o.canonical && o.entityKind,
  "set-field":       (o) => o.entityKind && (o.name || o.uuid) && typeof o.field === "string" && "value" in o,
};

function hasProvenance(o) {
  const p = o && o.provenance;
  return !!(p && typeof p.sheet === "string" && p.sheet.trim() && (p.cell != null || p.row != null));
}

// Returns { valid: [...ops], dropped: [{op, reason}] }. Never throws.
export function validatePatch(patch) {
  const ops = Array.isArray(patch?.corrections) ? patch.corrections
    : Array.isArray(patch) ? patch : [];
  const valid = [], dropped = [];
  for (const op of ops) {
    if (!op || !PATCH_OPS.has(op.op)) { dropped.push({ op, reason: "unknown-op" }); continue; }
    if (!hasProvenance(op)) { dropped.push({ op, reason: "no-provenance" }); continue; }
    if (!REQUIRED[op.op](op)) { dropped.push({ op, reason: "missing-required-fields" }); continue; }
    valid.push(op);
  }
  return { valid, dropped };
}
