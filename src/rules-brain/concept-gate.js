// Server-side interceptor: rejects bundle commits that introduce a
// case-insensitive concept-name collision (the C3/D1 trap).
//
// The agent-side instruction in BUNDLE_HARD_RULES rule #6 told Haiku to
// run a CLI before adding concepts. Haiku ignored it. This module exists
// because instructions-only enforcement doesn't work on Haiku. The check
// runs in commitWorkspaceChanges BEFORE the git commit. If a violation
// is detected, the working tree is reverted (`git checkout HEAD -- ...`)
// and the turn is rejected with a structured error the agent can act on.
//
// Public API:
//   detectConceptCollisions(oldConcepts[], newConcepts[]) →
//     { collisions: [{newConcept, existingConcept, kind: "case-only" | "exact"}] }

function normalize(s) {
  return String(s || "").toLowerCase().trim();
}

function listFrom(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.concepts)) return json.concepts;
  return [];
}

/**
 * Detect any concept in `newConcepts` whose name case-insensitively
 * collides with another concept that has a different UUID — either
 * within `oldConcepts` or within `newConcepts` itself.
 *
 * "New concept" = a concept in newConcepts whose UUID was NOT present in
 * oldConcepts. Concepts in newConcepts that existed in oldConcepts (same
 * UUID) are treated as edits and skipped — even if their name has been
 * changed to clash with another name, that's a different kind of issue
 * we'd want to flag separately.
 */
export function detectConceptCollisions(oldConceptsRaw, newConceptsRaw) {
  const oldConcepts = listFrom(oldConceptsRaw);
  const newConcepts = listFrom(newConceptsRaw);

  const oldByUuid = new Map(oldConcepts.map((c) => [c.uuid, c]));
  const newByUuid = new Map(newConcepts.map((c) => [c.uuid, c]));

  // Build a name-bucket of EXISTING concepts (case-insensitive, excluding
  // those that were also in old to avoid self-match if the SRS already
  // had collisions — we surface those separately).
  const nameToConcepts = new Map();
  for (const c of newConcepts) {
    const key = normalize(c.name);
    if (!key) continue;
    if (!nameToConcepts.has(key)) nameToConcepts.set(key, []);
    nameToConcepts.get(key).push(c);
  }

  const collisions = [];
  for (const c of newConcepts) {
    // A concept is "newly added" if its UUID wasn't in oldConcepts
    const isNew = !oldByUuid.has(c.uuid);
    if (!isNew) continue;
    const key = normalize(c.name);
    if (!key) continue;
    const bucket = nameToConcepts.get(key) || [];
    // Find another concept in the same name-bucket with a DIFFERENT UUID
    const other = bucket.find((x) => x.uuid !== c.uuid);
    if (!other) continue;
    const kind = (other.name === c.name) ? "exact-duplicate" : "case-only";
    collisions.push({
      newConcept: { name: c.name, uuid: c.uuid, dataType: c.dataType },
      existingConcept: { name: other.name, uuid: other.uuid, dataType: other.dataType },
      kind,
    });
  }
  return { collisions };
}

/**
 * Format a violation block for the agent / user. Returns a multiline
 * string with explicit corrective guidance.
 */
export function formatViolationMessage(collisions) {
  const lines = [];
  lines.push(`Concept-collision interceptor rejected this commit (${collisions.length} violation${collisions.length > 1 ? "s" : ""}).`);
  lines.push("This is a mechanical gate: the C3/D1 validator treats concept names case-insensitively, so adding a new concept whose name collides with an existing one (even by case) would break the upload.");
  lines.push("");
  for (const v of collisions) {
    lines.push(`  ✗ tried to add: "${v.newConcept.name}"  uuid=${v.newConcept.uuid}  dataType=${v.newConcept.dataType || "?"}`);
    lines.push(`    collides with: "${v.existingConcept.name}"  uuid=${v.existingConcept.uuid}  dataType=${v.existingConcept.dataType || "?"}`);
    lines.push(`    fix: instead of adding a new concept, reuse the existing UUID ${v.existingConcept.uuid} wherever you were going to reference "${v.newConcept.name}".`);
    lines.push("");
  }
  lines.push("Your edit was reverted. Re-attempt with the corrective fix above. Before adding any concept, look up existing UUIDs (case-insensitive) with the in-process MCP tool:");
  lines.push("  mcp__avni-bundle__bundle_find_concept({ name: \"<name>\" })");
  lines.push("It reports whether to REUSE an existing UUID or whether it is SAFE to add a new concept.");
  return lines.join("\n");
}
