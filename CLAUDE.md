# Claude Code Instructions

## You are working in avni-skills-sdk

This repo is a **test framework + SDK scaffold** that wraps [`avniproject/avni-skills`](https://github.com/avniproject/avni-skills). It does NOT contain the generator itself — that lives in `avni-skills`.

## Where the brain lives

The canonical skill set is at:

- `$AVNI_SKILLS_PATH/` (env var) — required to be set
- or `../avni-skills/` (sibling clone) — fallback

If neither exists, helpers throw at startup. Always confirm `avni-skills` is checked out before writing tests or running scripts.

## Test framework rules

- Tests MUST be org-agnostic. Build synthetic SRS workbooks via `tests/entities/lib/fixture.js` — never reference real NGO data.
- Tests live in `tests/entities/` — one file per entity (subject types, programs, encounter types, forms, concepts, form mappings, operational files).
- The bundle-level harness (`tests/bundle-harness.js`) is parametrized over a single bundle directory and is run *post-generation* to verify a specific bundle.
- The multi-org runner (`scripts/multi-org-run.js`) takes a manifest JSON and tabulates errors across N orgs.

## Privacy / data hygiene

- **NEVER commit** `.xlsx`, `.xls`, real fixture files, production bundles, or server logs (`*-errors.csv`).
- `.gitignore` enforces this; double-check `git status` before any commit.
- Real org SRSes belong in private storage outside this repo.

## Status memory

For status / plan / progress, the source of truth is `README.md`. For the bug-fix journey, see `docs/`:

- `summary.md` — 5-step POC report
- `audit.md` — initial bundle audit
- `path-a-reconciliation.md` — first generator fix
- `astitva-reconciliation.md` — second-org reconciliation
- `bug-a-and-dehardcoding.md` — Bug A fix + removal of hardcoded heuristics
- `multi-org-empirical.md` — 10-org empirical run

## What's next (Path B)

The deterministic baseline is solid. Next milestone: wrap it in `@anthropic-ai/claude-agent-sdk` for an iterative chat loop. See README "Phased delivery" table.
