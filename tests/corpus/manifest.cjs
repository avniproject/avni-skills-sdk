"use strict";
// Acceptance-harness corpus manifest. Each org declares its capability:
//   { org, tier:"committed"|"proprietary", inputs?:{srs,modelling?}, oracle:{dir}|{zip}, tolerate?:[] }
// Orgs with no `inputs` are oracle-only (the generation dimension is skipped).
// Only `committed` orgs load without RUN_REAL=1; proprietary orgs stay gitignored (rule §2).
// The engine (loader/differ/orchestrator) carries ZERO org names — they live here.
const path = require("node:path");

const AI = process.env.SDK_CORPUS_AI_PATH || path.resolve(__dirname, "../../../avni-ai");
const IMPL = process.env.SDK_CORPUS_IMPL_PATH || path.resolve(__dirname, "../../../avni-impl-bundles");
const scoping = (f) => path.join(AI, "tests", "resources", "scoping", f);
const ref = (o) => path.join(IMPL, "reference", o);
const dss = (f) => path.join(__dirname, "..", "resources", "doorstep", f);

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
];

function manifest() {
  return ORGS.map((o) => ({ ...o, inputs: o.inputs ? { ...o.inputs } : undefined, oracle: { ...o.oracle } }));
}

module.exports = { manifest };
