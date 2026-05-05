# avni-skills-sdk

HTTP API + Claude-Agent-SDK runtime that wraps [avniproject/avni-skills](https://github.com/avniproject/avni-skills) as agent-callable endpoints. **Bring your own Anthropic API key** and you can drive the entire AVNI knowledge base from any language.

> **Goal:** turn the deterministic SRS-to-Bundle pipeline into a reliable, agent-driven workflow that takes an Excel SRS and produces a valid Avni bundle ZIP iteratively, with every step rigidly tested using claude code Sdk wrapped into API.

---

## Verify it works

Six levels of verification, ascending in confidence. The first 5 need no API key.

```bash
AVNI_SKILLS_PATH=~/code/avni-skills bash scripts/verify.sh
```

| Level | What it proves | Needs |
|---|---|---|
| L1 | 45 entity invariants pass | — |
| L2 | server starts, `/health` responds | — |
| L3 | `/v1/skills` lists 16 skills | — |
| L4 | `/v1/skills/:slug` returns full SKILL.md + supporting files | — |
| L5 | `/v1/bundles/generate` accepts a synthetic Excel and returns a valid ZIP with 0 validator errors | — |
| L6 | `/v1/agent/query` runs a real Claude Agent session with skills auto-loaded | `ANTHROPIC_API_KEY=sk-ant-...` |

Add `ANTHROPIC_API_KEY` to also run L6:

```bash
ANTHROPIC_API_KEY=sk-ant-... AVNI_SKILLS_PATH=~/code/avni-skills bash scripts/verify.sh
```

---

## Quick start (60 seconds)

```bash
git clone https://github.com/avniproject/avni-skills.git ~/code/avni-skills
git clone https://github.com/avniproject/avni-skills-sdk.git ~/code/avni-skills-sdk

cd ~/code/avni-skills && npm install
cd ~/code/avni-skills-sdk && npm install
AVNI_SKILLS_PATH=~/code/avni-skills npm start
```

API listens on `:3030`. Drive it from any language:

```bash
# List skills (no API key needed)
curl http://localhost:3030/v1/skills

# Read a skill in full
curl http://localhost:3030/v1/skills/srs-bundle-generator

# Deterministic bundle generation (no LLM, no API key)
curl -X POST http://localhost:3030/v1/bundles/generate \
  -F "forms=@./MyOrg-Forms.xlsx" \
  -F "modelling=@./MyOrg-Modelling.xlsx" \
  -F "org=MyOrg" \
  -o MyOrg.zip

# Full Claude-agent loop with skills auto-loaded — BYO Anthropic key
curl -N -X POST http://localhost:3030/v1/agent/query \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What does the data-migration skill cover?"}'
```

## API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | — | liveness + paths |
| `GET` | `/v1/skills` | — | list all skills (slug, name, description, version) |
| `GET` | `/v1/skills/:slug` | — | full SKILL.md body + supporting files |
| `POST` | `/v1/bundles/generate` | — | deterministic SRS → bundle.zip (multipart upload). Returns the ZIP plus `X-Bundle-Errors` / `X-Bundle-Warnings` / `X-Bundle-Validation` headers from the AVNI server-contract validator. |
| `POST` | `/v1/agent/query` | `Authorization: Bearer <ANTHROPIC_API_KEY>` | one-shot agent query. SSE stream of agent events. Skills auto-loaded from `cwd = avni-skills/`. |

The agent endpoint is BYO-key — there is no platform key, no rate limiter, no quota. Anyone with their own Anthropic key can run it.

---

## Status — May 2026

The deterministic generator runs cleanly on **10 different orgs** (8 unseen during development). The framework that proves it has **45 entity-level tests** that pass without depending on any specific organisation. The HTTP API is now live and exposes the entire skill set as Claude-Agent-SDK-driven endpoints.

| Component | Status |
|---|---|
| Generator runs without crashing | ✅ all 10 orgs |
| Output is structurally valid | ✅ all 10 orgs |
| Subject-type resolution (Bug A) | ✅ 0 dangling refs across all orgs |
| Concept emission (Bug 1: column-header / condition-text leak) | ✅ filtered everywhere |
| Operational files (server-contract wrapping) | ✅ all 10 orgs |
| Yes/No use STANDARD_UUIDS | ✅ verified |
| All hardcoded org-specific heuristics removed | ✅ Pregnancy/Child keyword guesser, Td Booster, hardcoded colours/labels — gone |
| Programs auto-discover from SRS Modelling | ✅ proven on Astitva |
| `IndividualEncounterCancellation` mappings carry encounterTypeUUID | ✅ fixed + regression-pinned |
| HTTP API server (deterministic + agent endpoints) | ✅ live (`npm start`) |
| Cross-group concept reuse (`F2`) | ❌ semantic, NOT generator's job — **handled by the agent loop** |
| Live AVNI server upload (Level 5) | ⏳ never run — needs server credentials |

**On a canonical SRS (Forms.xlsx + proper Modelling.xlsx): ~99% of generator-side bugs are gone.** Remaining errors are F2 cross-group reuse — that's what the `/v1/agent/query` endpoint exists to handle.

**On an SRS missing a Modelling file:** bundle generates, but `ProgramEnrolment` / `ProgramExit` form mappings dangle — fixable two ways: improve the SRS, or have the agent infer programs from form-name analysis.

---

## What this repo contains

```
avni-skills-sdk/
├── README.md
├── package.json
├── src/                            # SDK + HTTP API
│   ├── server.js                   # Express server (the API endpoints)
│   ├── agent.js                    # Claude Agent SDK wrapper
│   ├── skills.js                   # Skill discovery from avni-skills/
│   ├── bundle.js                   # Deterministic generator + validator + ZIP
│   └── index.js                    # Programmatic exports
├── tests/
│   ├── entities/                   # 45 org-agnostic invariant tests
│   │   ├── lib/fixture.js          # synthetic-SRS workbook builder
│   │   ├── subject-types.test.js   # 8 tests
│   │   ├── programs.test.js        # 6 tests
│   │   ├── encounter-types.test.js # 4 tests
│   │   ├── forms.test.js           # 7 tests
│   │   ├── concepts.test.js        # 8 tests
│   │   ├── form-mappings.test.js   # 7 tests (incl. cancellation regression)
│   │   ├── operational-files.test.js  # 5 tests
│   │   └── README.md
│   └── bundle-harness.js           # 16-test bundle-level harness (per generated bundle)
├── scripts/
│   └── multi-org-run.js            # generate + classify errors across N orgs
├── examples/
│   └── manifest.example.json       # input shape for multi-org-run
└── docs/
    ├── summary.md                  # 5-step POC report
    ├── audit.md                    # bundle audit
    ├── path-a-reconciliation.md    # generator fix #1 (junk-concept filter)
    ├── astitva-reconciliation.md   # second-org reconciliation
    ├── bug-a-and-dehardcoding.md   # Bug A fix + removal of all hardcoded org assumptions
    └── multi-org-empirical.md      # 10-org empirical run summary
```

**This repo intentionally ships ZERO proprietary data.** Tests build minimal SRS workbooks in memory at runtime via `tests/entities/lib/fixture.js`. Real org Excel files are never committed.

---

## How it depends on `avniproject/avni-skills`

The actual deterministic generator (`generate_bundle_v2.js`) and validator (`bundle_validator.js`) live in [`avniproject/avni-skills`](https://github.com/avniproject/avni-skills). This repo (`avni-skills-sdk`) provides:

- **Test framework** that exercises the generator's contract per entity
- **Validation harness** that pins regression-blocking invariants on any generated bundle
- **Multi-org runner** for empirical confidence checks across N orgs
- **Documentation** of the bug-fix journey

To run anything in this repo, clone `avni-skills` alongside it and run `npm install` there:

```bash
# Sibling layout (recommended)
~/code/avni-skills           # the canonical generator + skills knowledge base
~/code/avni-skills-sdk       # this repo

cd ~/code/avni-skills && npm install
cd ~/code/avni-skills-sdk && npm test
```

Or set `AVNI_SKILLS_PATH=/path/to/avni-skills` and the helpers will pick it up.

---

## Run it

```bash
# Entity tests (44 invariants, ~12s)
npm test

# Or run individual entity files
node --test tests/entities/subject-types.test.js
node --test tests/entities/concepts.test.js

# Validate a single generated bundle dir
node tests/bundle-harness.js /path/to/bundle-dir

# Run the generator on N orgs and tabulate errors
cp examples/manifest.example.json my-manifest.json
# edit my-manifest.json with your orgs' Forms+Modelling paths
AVNI_SKILLS_PATH=~/code/avni-skills node scripts/multi-org-run.js --manifest=./my-manifest.json --out=./out
```

---

## The journey so far (read in order)

1. **[POC summary](docs/summary.md)** — 5-step end-to-end proof: skill discovery → deterministic generation → agent-driven first pass → edit + validate → bundle.zip
2. **[Bundle audit](docs/audit.md)** — first deep look at generated output; surfaces 22 server-blocking errors and classifies them
3. **[Path A reconciliation](docs/path-a-reconciliation.md)** — first generator fix: filter SRS column-header text from concept emission. 16/16 harness tests green afterward
4. **[Astitva reconciliation](docs/astitva-reconciliation.md)** — generator run against a second real production org + diff vs production UAT bundle. Surfaces Bug A (subject types pulled from form names) and 36 cascading mapping errors
5. **[Bug A + de-hardcoding](docs/bug-a-and-dehardcoding.md)** — fixes Bug A, removes ALL hardcoded org-specific heuristics (Pregnancy/Child keyword guesser, vaccine names, colour ternaries). Astitva: 42 → 6 errors, all 6 are semantic (cross-group reuse, agent's job)
6. **[Multi-org empirical run](docs/multi-org-empirical.md)** — generator + validator across 10 orgs with classification of every error. The empirical answer to "does it work for any SRS?"

---

## Plan ahead (Path B)

The deterministic generator is now reliable enough to be the first pass. The next surface is the agent loop:

```
┌─────────────────────────────────────────────────────────────┐
│  Claude Agent SDK session, cwd = avni-skills/               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. User uploads Forms.xlsx + Modelling.xlsx        │   │
│  │  2. Agent runs generate_bundle_v2.js (deterministic) │   │
│  │  3. Validator surfaces N errors, classified by type  │   │
│  │  4. Mechanical errors: agent fixes scripted          │   │
│  │     (cancellation encounterTypeUUID gap, etc)        │   │
│  │  5. Semantic errors (F2 cross-group, dataType drift, │   │
│  │     missing-Modelling-program-inference): agent      │   │
│  │     reads avni-skills/* to make domain decisions     │   │
│  │     and asks user to confirm                         │   │
│  │  6. Loop until errors = 0 OR user clicks "ship"      │   │
│  │  7. ZIP via avni-skills/srs-bundle-generator/        │   │
│  │     scripts/zip_bundle.js → bundle.zip               │   │
│  │  8. Optional: push to AVNI admin via                 │   │
│  │     /implementation/uploadBundle                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Phased delivery

| Phase | Scope | Status |
|---|---|---|
| 0 | Deterministic generator hardened, 45 entity tests green, multi-org empirical pass | ✅ done |
| 1 | Fix `IndividualEncounterCancellation` encounterTypeUUID bug | ✅ done (regression test in `form-mappings.test.js`) |
| 2 | HTTP API + `@anthropic-ai/claude-agent-sdk` runtime (BYO key) | ✅ done (`src/server.js`) |
| 3 | Workspace persistence (per session, file storage, git-per-turn diff) | TODO |
| 4 | Token-cost accounting + per-org wallet (pay-per-use) | TODO |
| 5 | Avni admin upload integration (`/implementation/uploadBundle` MCP tool) | TODO |
| 6 | UI inside Avni SaaS (chat + artifact split-pane), Avni SSO | TODO |
| 7 | Skill eval harness — golden SRS → expected bundle, regression-block PRs | TODO |

---

## Why this scaffold matters

1. **The generator's contract is now testable.** Any change to `generate_bundle_v2.js` runs through 44 invariant checks before merge — no more "looks fine on JK Laxmi, breaks on Astitva" surprises.
2. **The framework is org-agnostic.** Adding a new fixture org (or a new edge case) is a new test, not a fork. Tests build their own minimal SRSes — they don't depend on any specific NGO's data.
3. **The empirical baseline is recorded.** The 10-org multi-org run is the "before" snapshot. When Path B's agent loop ships, we re-run it; the F2 numbers should drop dramatically as the agent handles them.
4. **No proprietary data on disk in this repo.** Real client SRSes stay in private storage; this public repo only ships synthetic test fixtures.

---

## Contributing / extending

To add a test, copy the shape of an existing one:

```js
test("description of the invariant", () => {
  const b = generate({
    formsSheets: { /* minimum sheets to exercise the behavior */ },
    modellingSheets: { /* optional */ },
  });
  assert.equal(b.<entity>.<property>, expected);
});
```

For SDK code itself (the agent loop, future package): land in this repo. Generator changes: PR to `avniproject/avni-skills` upstream.

---

## License

MIT.
