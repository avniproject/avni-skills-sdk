// 21-agent-mode-authors-clean-bundle.cjs  (category: srs-authorship)
//
// What it proves (story #12, epic AC "at least one enforcing agent-mode case"):
// AGENT MODE end-to-end. The session starts as an EMPTY workspace with a small
// SRS spreadsheet in ../input/. The agent must read it (bundle_read_srs), author
// a complete bundle (optionally bootstrapping with bundle_generate_baseline), and
// finish with BOTH the validator and the deterministic integrity check reporting
// zero errors — all within a per-case cost cap.
//
// ENFORCING (not observe-only): the assertions fail the case if the final bundle
// is validator-dirty or integrity-dirty, if nothing was authored, or if the run
// blows the cost cap.
//
// Gated exactly like every other eval case: `npm run eval` skips clean when
// ANTHROPIC_API_KEY is unset (it is NOT part of `npm test`). DEFINED here, run
// only under an explicit budgeted eval.

"use strict";

module.exports = {
  name: "21-agent-mode-authors-clean-bundle",
  category: "srs-authorship",
  description:
    "[srs-authorship] AGENT MODE: from a small SRS in input/, the agent authors a bundle that passes validator + integrity within a cost cap.",

  // story #12 — create the session in AGENT mode: empty bundle dir + the SRS
  // spreadsheet(s) persisted under ../input/ (read via bundle_read_srs).
  mode: "agent",

  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "AgentAuthoredOrg" }),

  prompt:
    "This is an EMPTY agent-mode workspace — there is no bundle yet. Read the uploaded SRS " +
    "with the bundle_read_srs tool (the spreadsheets live in ../input/), then author a " +
    "complete, uploadable AVNI bundle from it. You may bootstrap with bundle_generate_baseline " +
    "and refine. Finish only when BOTH the validator and the integrity check report zero errors.",

  // Full authoring is the expensive path — a generous but real cap.
  maxTurns: 8,
  maxCostUsd: 1.5,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;
    const fs = require("node:fs");
    const path = require("node:path");

    // 1. The agent must have authored something (a real committed turn).
    if (ctx.turnEvent && ctx.turnEvent.noChanges === true) {
      throw new Error("expected the agent to author a bundle, but nothing was committed");
    }

    // 2. Validator clean (zero errors) on the final bundle.
    await A.assertValidatorClean({ getValidator: ctx.getValidator });

    // 3. Integrity clean — folded into validationAtCurrent by commitWorkspaceChanges.
    const v = await ctx.getValidator();
    if (v.integrity && v.integrity.ok === false) {
      throw new Error(`integrity not clean: ${JSON.stringify(v.integrity.counts)}`);
    }

    // 4. A minimally viable authored bundle: at least one subject type + one form.
    const stPath = path.join(ctx.bundleDir, "subjectTypes.json");
    if (!fs.existsSync(stPath)) throw new Error("agent did not author subjectTypes.json");
    const st = JSON.parse(fs.readFileSync(stPath, "utf8"));
    if (!Array.isArray(st) || st.length < 1) throw new Error("expected at least one subject type");
    const formsDir = path.join(ctx.bundleDir, "forms");
    const forms = fs.existsSync(formsDir) ? fs.readdirSync(formsDir).filter((f) => f.endsWith(".json")) : [];
    if (forms.length < 1) throw new Error("expected at least one authored form");
  },
};
