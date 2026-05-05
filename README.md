# avni-skills-sdk

Test framework, validation harness, and SDK scaffolding for the AVNI bundle generator. Wraps [avniproject/avni-skills](https://github.com/avniproject/avni-skills) as the canonical knowledge base.

> **Goal:** turn the deterministic SRS-to-Bundle pipeline into a reliable, agent-driven workflow that takes an Excel SRS and produces a valid AVNI bundle ZIP iteratively, with every step rigidly tested.

---

## Status — May 2026

The deterministic generator runs cleanly on **10 different orgs** (8 unseen during development). The framework that proves it has **44 entity-level tests** that pass without depending on any specific organisation.

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
| `IndividualEncounterCancellation` mappings carry encounterTypeUUID | ⚠ **known bug** — affects 4/10 orgs (~30 min fix) |
| Cross-group concept reuse (`F2`) | ❌ semantic, NOT generator's job — **handled by the agent loop (Path B, not yet built)** |
| Live AVNI server upload (Level 5) | ⏳ never run — needs server credentials |

**On a canonical SRS (Forms.xlsx + proper Modelling.xlsx): ~99% of generator-side bugs are gone.** The remaining 1% is the cancellation-encounter UUID bug above.

**On an SRS missing a Modelling file:** bundle generates, but `ProgramEnrolment` / `ProgramExit` form mappings dangle — fixable two ways: improve the SRS, or have the agent infer programs.

---

## What this repo contains

```
avni-skills-sdk/
├── README.md
├── package.json
├── tests/
│   ├── entities/                  # 44 org-agnostic invariant tests
│   │   ├── lib/fixture.js         # synthetic-SRS workbook builder
│   │   ├── subject-types.test.js  # 8 tests
│   │   ├── programs.test.js       # 6 tests
│   │   ├── encounter-types.test.js# 4 tests
│   │   ├── forms.test.js          # 7 tests
│   │   ├── concepts.test.js       # 8 tests
│   │   ├── form-mappings.test.js  # 6 tests
│   │   ├── operational-files.test.js  # 5 tests
│   │   └── README.md
│   └── bundle-harness.js          # 16-test bundle-level harness (per generated bundle)
├── scripts/
│   └── multi-org-run.js           # generate + classify errors across N orgs
├── examples/
│   └── manifest.example.json      # input shape for multi-org-run
└── docs/
    ├── summary.md                       # 5-step POC report
    ├── audit.md                         # bundle audit (JK Laxmi)
    ├── path-a-reconciliation.md         # generator fix #1 (junk-concept filter)
    ├── astitva-reconciliation.md        # second-org reconciliation against prod UAT bundle
    ├── bug-a-and-dehardcoding.md        # Bug A fix + removal of all hardcoded org assumptions
    └── multi-org-empirical.md           # 10-org empirical run summary
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
| 0 | Deterministic generator hardened, entity tests green, multi-org empirical pass | ✅ done |
| 1 | Fix `IndividualEncounterCancellation` encounterTypeUUID bug | TODO (~30 min) |
| 2 | Wrap generator in `@anthropic-ai/claude-agent-sdk` chat loop with streaming | TODO |
| 3 | Workspace persistence (per session, S3-backed, git-per-turn) | TODO |
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
