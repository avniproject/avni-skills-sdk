// Which parity gaps are worth chasing — and which are the ORACLE being stale.
//
// Parity compares a generated bundle against a reference export (a real, human-
// finished bundle uploaded to Avni). That reference is the best available
// statement of what "done" looks like, but it is a SNAPSHOT: it was exported on
// one date, and the SRS keeps moving. Where the two disagree, the SRS is the
// authority — it is the requirement — and the export is merely older.
//
// Measured on Door Step School (2026-08-02): of 14 "missing" forms, 3 were named
// in the current scoping workbook and 11 were not. The 11 were dominated by
// `<x> cancellation` and `<x> program exit` — configuration the 31 Jul export
// carries and the 2 Aug scoping document no longer asks for. A loop gating on
// the raw diff would have spent its whole budget authoring them, and every one
// of those "fixes" would have moved the bundle FURTHER from current scope. More
// than half the apparent gap was drift, not defect.
//
// So: split the diff. Gate on the part the SRS backs; report the rest as drift.
//
// MATCHING BIAS — deliberately INCLUSIVE. The two error directions are not
// symmetric. Calling drift "SRS-backed" costs one wasted iteration, which is
// visible and cheap. Calling a real requirement "drift" silently drops it from
// the gate, and the bundle ships without it while the scorecard reads green —
// the exact class of silent-pass failure this gate exists to prevent. When the
// evidence is ambiguous, treat the name as backed.

import fs from "node:fs";
import XLSX from "xlsx";

export function normalizeName(name) {
  return String(name == null ? "" : name)
    .replace(/\(voided~\d+\)/gi, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Every sheet name and every string cell across the supplied workbooks. An SRS
// names things in tab titles (one tab per form), in entity tables, and in prose
// cells, so all three are evidence. Unreadable workbooks contribute nothing
// rather than throwing — a missing SRS must not turn into "everything is drift".
export function buildSrsVocabulary(xlsxPaths = []) {
  const vocab = new Set();
  for (const fp of xlsxPaths.filter(Boolean)) {
    let wb;
    try { wb = XLSX.readFile(fp); } catch { continue; }
    for (const sheetName of wb.SheetNames || []) {
      vocab.add(normalizeName(sheetName));
      let rows = [];
      try { rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false }); } catch { continue; }
      for (const row of rows) {
        for (const cell of row || []) {
          if (typeof cell === "string" && cell.trim()) vocab.add(normalizeName(cell));
        }
      }
    }
  }
  return vocab;
}

// Substring containment is allowed only for names long enough that an accidental
// hit is implausible; below that, exact match. "fln" would match half the
// workbook, "reading performance assessment" would not.
const MIN_SUBSTRING_LEN = 7;

export function isNamedInSrs(vocab, name) {
  const n = normalizeName(name);
  if (!n) return false;
  if (vocab.has(n)) return true;
  if (n.length < MIN_SUBSTRING_LEN) return false;
  for (const entry of vocab) if (entry.includes(n)) return true;
  return false;
}

/**
 * Split a list of missing entity names into the ones the SRS asks for and the
 * ones only the reference export has.
 * An EMPTY vocabulary means we could not read the SRS at all — in that case
 * everything is reported as backed, so an unreadable workbook can never silently
 * empty the gate.
 */
export function classifyMissing(vocab, names = []) {
  if (!vocab || vocab.size === 0) return { backed: [...names], drift: [], vocabEmpty: true };
  const backed = [], drift = [];
  for (const n of names) (isNamedInSrs(vocab, n) ? backed : drift).push(n);
  return { backed, drift, vocabEmpty: false };
}
