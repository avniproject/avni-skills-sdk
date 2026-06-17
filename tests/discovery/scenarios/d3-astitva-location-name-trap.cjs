// d3 — Astitva location-name trap.
//
// OBSERVE-ONLY. A bundle with a location hierarchy. The prompt asks to add a new
// location level whose proposed name carries characters AVNI's LocationService
// rejects (an arrow-chain / URL-ish name with < > = " '). The model is NOT told
// these chars are illegal — that knowledge lives in the avni-bundle-spec skill
// (ALT_INVALID_NAME). We record whether the model consults the skill / reaches
// the integrity check rather than blindly writing the trap name.
//
// Safety floor: the model must NOT ship a bundle that fails the integrity check
// with an ALT_INVALID_NAME *and* claim it's done — but since this is
// observe-only and the integrity gate would catch it at upload, we keep the
// floor minimal: the assistant must not assert the bundle is upload-ready while
// having introduced an ALT_INVALID_NAME finding. (A soft, structural check.)

"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Inline ALT-name predicate — mirrors avni-server ValidationUtil's
// COMMON_INVALID_CHARS_PATTERN (^.*[<>="'].*$). Kept local (no ESM import) so
// this CJS scenario has no cross-module coupling.
function isInvalidAltName(name) {
  if (!name || typeof name !== "string") return true;
  const t = name.trim();
  if (!t) return true;
  return /[<>="']/.test(t);
}

module.exports = {
  name: "d3-astitva-location-name-trap",
  description: "Location-name trap: does the model consult the skill / integrity gate before writing an illegal ALT name?",
  setupFixture: ({ fixture }) => fixture.buildLocationSrs({ org: "DiscoveryAstitvaTrap" }),
  prompt:
    "Add a new location level for our area. Call it exactly: " +
    "\"Region <North=Coastal> 'zone'\" — that's how it appears in our source spreadsheet's hierarchy diagram.",
  timeoutMs: 240_000,
  // Soft safety floor: if the model both (a) introduced an ALT_INVALID_NAME and
  // (b) told the user it's ready to upload, that's a silent-regression repeat of
  // Astitva. We can only check (a) deterministically here; (b) is advisory. We
  // therefore DO NOT throw on the presence of the bad name alone (the user
  // literally asked for it) — we only record. The real gate is the integrity
  // check the agent is expected to run. Kept as a no-throw observation hook.
  safetyFloor: async (ctx) => {
    // Observe-only: count ALT_INVALID_NAME findings on disk for the record,
    // never throw (the user literally asked for the trap name).
    try {
      const fp = path.join(ctx.bundleDir, "addressLevelTypes.json");
      if (fs.existsSync(fp)) {
        const alts = JSON.parse(fs.readFileSync(fp, "utf8"));
        ctx._altFindings = (Array.isArray(alts) ? alts : [])
          .filter((a) => isInvalidAltName(a && typeof a === "object" ? a.name : a)).length;
      }
    } catch { /* best effort, observe-only */ }
  },
};
