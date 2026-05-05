# Claude Code instructions for `avni-skills-sdk`

You are working in **avni-skills-sdk** — the body that wraps [`avniproject/avni-skills`](https://github.com/avniproject/avni-skills) (the brain) as agent-callable HTTP endpoints. This repo does NOT contain the generator or the SKILL.md knowledge base — those live in `avni-skills`.

Read this whole file before making changes. It's the contract.

---

## Mental model

```
avni-skills-sdk (this repo, body)
  ├── src/server.js         ← Express, 5 endpoints
  ├── src/skills.js         ← reads avni-skills/*/SKILL.md
  ├── src/bundle.js         ← wraps avni-skills's generator + validator
  ├── src/workspace.js      ← stages avni-skills as .claude/skills/ for the SDK
  └── src/agent.js          ← Claude Agent SDK wrapper (BYO key)

avni-skills (separate repo, brain)
  ├── 16 skill folders (architecture-patterns, backend-architecture, ...)
  └── srs-bundle-generator/  ← generator + validator
```

The SDK locates `avni-skills` via env var `AVNI_SKILLS_PATH` or sibling clone `../avni-skills`. If neither exists, every helper throws at startup.

**Do NOT copy or vendor `avni-skills` into this repo.** Updates flow through the symlink-staging in `src/workspace.js`. Single source of truth.

---

## Verified state (do not re-discover)

End-to-end tested 2026-05-05 with a real Anthropic key. All six levels of `bash scripts/verify.sh` pass:

| Level | What it proves |
|---|---|
| L1 | 45 entity tests pass |
| L2 | server starts, `/health` ok |
| L3 | `/v1/skills` returns the 16 skills |
| L4 | `/v1/skills/:slug` returns SKILL.md body |
| L5 | `/v1/bundles/generate` produces a valid ZIP, validator-errors=0 |
| L6 | `/v1/agent/query` runs Claude session, agent reads `.claude/skills/<name>/SKILL.md`, returns end_turn, 0 errors |

If you change anything in `src/`, re-run `bash scripts/verify.sh` (L1–L5 minimum) before committing.

---

## Hard rules

### 1. Tests are org-agnostic

Every test in `tests/entities/` builds a synthetic in-memory SRS workbook via `tests/entities/lib/fixture.cjs`. **Tests must never reference a real NGO, organization, or fixture file.** If you need to verify behavior on a real SRS, run `scripts/multi-org-run.js` against your private manifest — but the test code itself stays generic.

To add a test, copy the shape of an existing one. The fixture builder accepts `formsSheets` and `modellingSheets`, both maps of sheet name → row arrays.

### 2. No proprietary data ever

- `*.xlsx`, `*.xls`, `*.xlsm` are gitignored at root, recursively.
- `fixtures/`, `**/prod-*`, `*-errors.csv` are also blocked.
- Run `git status` before every commit. If you see anything resembling NGO data, stop.
- Real org SRSes belong in private storage outside this repo. The repo currently ships **zero** proprietary data and stays that way.

### 3. Generator changes go upstream

Generator code (`generate_bundle_v2.js`, `bundle_validator.js`, parsers, etc.) lives in `avniproject/avni-skills`. **Do not modify those files via this repo.** If a bug needs a generator fix:

1. Add a regression test in `tests/entities/<entity>.test.cjs` that fails on the bug.
2. Switch to `avni-skills/`, fix the generator there, PR it.
3. Re-run `npm test` here to confirm it passes.

### 4. No hardcoded org-specific heuristics

The generator (and anything that calls it) MUST be SRS-driven. There must be no fallback like "if sheet name contains `pregnancy` → assume `Pregnancy` program". Every program / encounter / subject-type decision must trace to a specific SRS cell. See `docs/bug-a-and-dehardcoding.md` for the full sweep that removed these.

If you find yourself reaching for a hardcoded fallback, the SRS author needs to fix the SRS — not the generator.

### 5. Module-system rules

- `package.json` declares `"type": "module"` because `@anthropic-ai/claude-agent-sdk` is ESM-only.
- All `src/*.js` files are ESM. Use `import` / `export`.
- All `tests/*.cjs` files are CommonJS. Use `require` / `module.exports`. The `.cjs` extension overrides the package-level type field.
- Don't change this without understanding the cascade.

### 6. The lockfile is committed

`package-lock.json` is in the repo. Don't delete it. The SDK depends on `@anthropic-ai/claude-agent-sdk` which ships native binaries — pinning matters.

---

## Common tasks

### Run all tests

```bash
AVNI_SKILLS_PATH=~/code/avni-skills npm test
```

### Run the verify script (L1–L5)

```bash
AVNI_SKILLS_PATH=~/code/avni-skills bash scripts/verify.sh
```

### Run all six levels (needs API key)

```bash
export ANTHROPIC_API_KEY='sk-ant-...'   # in your shell only — NEVER paste in conversations
AVNI_SKILLS_PATH=~/code/avni-skills bash scripts/verify.sh
```

### Start the dev server

```bash
AVNI_SKILLS_PATH=~/code/avni-skills npm run dev
```

Listens on `:3030`. Endpoints documented in `README.md`.

### Run the multi-org generator across N orgs

```bash
cp examples/manifest.example.json my-manifest.json
# edit my-manifest.json with your orgs' Forms+Modelling paths
AVNI_SKILLS_PATH=~/code/avni-skills node scripts/multi-org-run.js \
  --manifest=./my-manifest.json --out=./out
```

The manifest contains absolute paths to private SRS files. **Do not commit the manifest.**

### Add a regression test for a generator bug

1. Reproduce the bug locally — generator output diverges from the entity invariant.
2. Open the relevant `tests/entities/<entity>.test.cjs`.
3. Add a `test("description (regression)", ...)` block with a synthetic SRS that triggers the bug.
4. Run `npm test` — confirm it fails.
5. Fix the generator in `avniproject/avni-skills`, PR it.
6. Pull the fix into your local `~/code/avni-skills`, re-run `npm test` — confirm it now passes.

---

## Roadmap (where we are)

| Phase | Scope | Status |
|---|---|---|
| 0 | Generator hardened, 45 entity tests, multi-org pass | ✅ |
| 1 | `IndividualEncounterCancellation` encounterTypeUUID bug + regression test | ✅ |
| 2 | HTTP API + Claude Agent SDK runtime, BYO key, verified L1–L6 | ✅ |
| 3 | **Workspace persistence — multi-turn editing sessions with git-per-turn diff** | next |
| 4 | Token-cost wallet (pay-per-use) | TODO |
| 5 | Avni admin upload integration via MCP | TODO |
| 6 | UI inside Avni SaaS, Avni SSO | TODO |
| 7 | Skill eval harness | TODO |

If you're picking up Phase 3, the sketch is in `README.md` under "Phase 3 sketch (next)".

---

## What problems live where

If a teammate / user reports a bug, classify it before assigning:

| Symptom | Likely culprit | Where to fix |
|---|---|---|
| "The generator produced a junk concept like `'Pre added Options'`" | Bug 1 class | `avni-skills` parser |
| "Subject type names look like form names" | Bug A class | `avni-skills` modelling parser |
| "Cancellation form mappings are missing encounterTypeUUID" | Cancellation suffix bug | `avni-skills` formMapping logic |
| "F2 cross-group concept reuse errors" | Semantic — NOT a generator bug | Agent loop (Phase 2 already handles in principle; concrete prompts come in Phase 3) |
| "Programs are missing for forms that look like enrolment" | SRS missing Modelling sheet | Either fix the SRS, or have the agent infer programs from form names |
| "The agent saw the wrong skills (24 instead of 16)" | Workspace staging not active | `src/workspace.js` + `src/agent.js` `settingSources: []` |
| "API endpoint hangs / aborts immediately" | Express SSE event-listener bug | `src/server.js` — must be `res.on('close')`, not `req.on('close')` |
| "Agent has access to MCP tools we didn't configure" | Host's `~/.claude/settings.json` leaking in | `src/agent.js` — confirm `settingSources: []` is set |

---

## Don't

- Don't paste API keys, passwords, or any secret in conversations or commits. Set them in your shell.
- Don't run destructive git commands (`reset --hard`, `push --force`, branch deletion) without explicit user confirmation.
- Don't push to `main` without running `bash scripts/verify.sh` and seeing L1–L5 green.
- Don't modify `avni-skills/*` files from this repo's working tree. Make those changes in the `avni-skills` checkout and PR them.
- Don't introduce a new ESM/CJS mix without reading rule §5 above.
- Don't add a hardcoded org-specific heuristic. Re-read rule §4.

---

## Where to find context

- `README.md` — public-facing intro, API reference, architecture, journey
- `docs/` — bug-fix journey (read in order: summary → audit → path-a → astitva → bug-a → multi-org)
- `tests/entities/README.md` — explains the test framework
- This file — rules + status for Claude Code agents working here
