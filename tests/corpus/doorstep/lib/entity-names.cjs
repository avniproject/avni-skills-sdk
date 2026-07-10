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
