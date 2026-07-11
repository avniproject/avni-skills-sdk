"use strict";
// Acceptance-harness corpus manifest. Each org declares its capability:
//   { org, tier:"committed"|"proprietary", inputs?:{srs,modelling?}, oracle:{dir}|{zip}, tolerate?:[],
//     complianceExceptions?:[{ruleId,code,count}] }
// Orgs with no `inputs` are oracle-only (the generation dimension is skipped).
// Only `committed` orgs load without RUN_REAL=1; proprietary orgs stay gitignored (rule §2).
// The engine (loader/differ/orchestrator) carries ZERO org names — they live here.
const path = require("node:path");

const AI = process.env.SDK_CORPUS_AI_PATH || path.resolve(__dirname, "../../../avni-ai");
const IMPL = process.env.SDK_CORPUS_IMPL_PATH || path.resolve(__dirname, "../../../avni-impl-bundles");
const scoping = (f) => path.join(AI, "tests", "resources", "scoping", f);
const ref = (o) => path.join(IMPL, "reference", o);
const dss = (f) => path.join(__dirname, "..", "resources", "doorstep", f);
const res = (org, f) => path.join(__dirname, "..", "resources", org, f);

const ORGS = [
  // --- oracle-only, committed (avni-impl-bundles reference bundles, anonymized) ---
  { org: "community", tier: "committed", oracle: { dir: ref("community") } },
  { org: "farming", tier: "committed", oracle: { dir: ref("farming") } },
  { org: "phulwari", tier: "committed", oracle: { dir: ref("phulwari") } },
  { org: "social_security", tier: "committed", oracle: { dir: ref("social_security") } },
  { org: "water_bodies", tier: "committed", oracle: { dir: ref("water_bodies") } },

  // --- input+oracle, committed (avni-ai scoping triads) ---
  { org: "Astitva", tier: "committed",
    inputs: { srs: scoping("Astitva SRS .xlsx"), modelling: scoping("Astitva Modelling.xlsx") },
    oracle: { zip: scoping("Astitva UAT.zip") } },
  { org: "Durga India", tier: "committed",
    inputs: { srs: scoping("Durga India Scoping Document.xlsx"), modelling: scoping("Durga India Modelling.xlsx") },
    oracle: { zip: scoping("Durga India Uat.zip") } },
  { org: "Kshamata", tier: "committed",
    inputs: { srs: scoping("Kshamata Scoping Document .xlsx"), modelling: scoping("Kshamata Modelling.xlsx") },
    oracle: { zip: scoping("kshmata_launchpad.zip") } },
  { org: "Mazi Saheli", tier: "committed",
    inputs: { srs: scoping("Mazi Saheli Charitable Trust Scoping .xlsx"), modelling: scoping("Mazi Saheli Charitable Trust Modelling.xlsx") },
    oracle: { zip: scoping("Mazi Saheli UAT.zip") } },
  { org: "Yenepoya", tier: "committed",
    inputs: { srs: scoping("Yenepoya_SRS.xlsx") },
    oracle: { zip: scoping("Yenepoya.zip") } },

  // --- proprietary, gitignored (RUN_REAL=1 only) ---
  { org: "Doorstep", tier: "proprietary",
    inputs: { srs: dss("Doorstep school Scoping Document  [To-Use].xlsx"), modelling: dss("Doorstep school Modelling.xlsx") },
    oracle: { zip: dss("Door Step School UAT.zip") } },
  { org: "Udgam Handicrafts", tier: "proprietary",
    inputs: { srs: res("udgam", "Udgam Handicrafts Scoping Document_.xlsx"), modelling: res("udgam", "Udgam Handicrafts LLP Avni Modelling.xlsx") },
    oracle: { zip: res("udgam", "Udgam Handicrafts.zip") },
    // Documented, exact-count CRL1 floor exception (O-5 / MAJ-11) — verified
    // via `RUN_REAL=1 node --test tests/acceptance/compliance-doc.test.cjs`:
    // 2 formElement skip-logic rules + 1 subjectSummaryRule fail
    // rule-body-parses in the committed proprietary oracle. NEVER a blanket
    // allowlist — complianceCorpusValidity() only absorbs exactly this many
    // findings per code; any new/additional defect still reds the floor.
    // The committed-tier oracles (incl. Astitva/Durga) need NO exception:
    // measured live, they carry zero floor-gating findings (runBundleIntegrity
    // ok=true, empty), so O-5's committed-org exact-count list is empty here.
    complianceExceptions: [
      { ruleId: "rule-body-parses", code: "R1-SYNTAX", count: 2 },
      { ruleId: "rule-body-parses", code: "R2-WRAPPER", count: 1 },
    ] },
  { org: "Bal Kalyan Sangh", tier: "proprietary",
    inputs: { srs: res("bks", "Bal Kalyan Sangh Scoping Document_.xlsx"), modelling: res("bks", "Bal Kalyan Sangh Modelling Document.xlsx") },
    oracle: { zip: res("bks", "Bal Kalyan Sangh.zip") } },
  { org: "Gubbachi", tier: "proprietary",
    inputs: { srs: res("gubbachi", "Gubbachi New Program Scoping Document - 22.03.2026.xlsx"), modelling: res("gubbachi", "Gubbachi New Scope Modeling.xlsx") },
    oracle: { zip: res("gubbachi", "Gubbachi.zip") } },
];

function manifest() {
  return ORGS.map((o) => ({ ...o, inputs: o.inputs ? { ...o.inputs } : undefined, oracle: { ...o.oracle } }));
}

module.exports = { manifest };
