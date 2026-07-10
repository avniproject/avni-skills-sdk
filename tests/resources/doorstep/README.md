# Doorstep real inputs (local-only, gitignored)

These proprietary Door Step School files are **never committed** (CLAUDE.md §2).
Place them here to enable the gated real-data parity test + the CLI:

- `Doorstep school Scoping Document  [To-Use].xlsx`  — Forms source
- `Doorstep school Modelling.xlsx`                    — Modelling source
- `Door Step School UAT.zip`                          — parity oracle

Absent these, the real-data test auto-skips and CI runs only the synthetic fixture.

The real-data test also requires the env var `RUN_DOORSTEP_REAL=1` to be set
explicitly — file presence alone is not enough. This keeps `npm test` green
by default even when the real files happen to be staged locally (e.g. during
active development of the parity gate itself), and only opts in to running
against real data when a human deliberately asks for it:

```bash
RUN_DOORSTEP_REAL=1 AVNI_SKILLS_PATH=~/code/avni-skills npm test
```

Run the report: `node scripts/doorstep-parity.mjs`
