# Phase 6 — YAML spec pipeline, dependency graph, deterministic patcher, multi-agent foundation

**Shipped 2026-05-22 IST · 380/380 tests · authored by Samanvay**

This is the team-facing writeup for Phase 6 (workstreams WS1, WS1.5, WS2, WS4, WS5). Phase 5 made sessions durable. **Phase 6 makes editing deterministic.** Customers + agents now have a structured way to express bundle changes (YAML spec) and a guaranteed-safe way to apply them (deterministic patcher). The agent's job collapses from "freelance JSON edits" to "compose a spec and call the pipeline."

If you're picking up the codebase, read this end-to-end. The companion docs are [`phase-5-sessions-and-memory.md`](phase-5-sessions-and-memory.md) (the durable-session substrate) and [`skills-curation.md`](skills-curation.md) (the knowledge-base reduction).

---

## TL;DR

```
                ┌───────────────────────────────────────────────────────┐
                │  Phase 6 pipeline — what's new this milestone         │
                │                                                       │
                │  YAML spec  ─parser→  entities  ─materializer→        │
                │     │                              entities-with-JS   │
                │     │                                    │            │
                │  emitter◄────┐                           ▼            │
                │              │     bundle file map ─patcher→ patched  │
                │              │              │                +diff    │
                │              │              ▼                         │
                │   bundle-io ─┴── ZIP buffer ──────────────────────┐   │
                │                                                   │   │
                │   graph.js  ─reads any file map→  integrity check ┘   │
                └───────────────────────────────────────────────────────┘

  Wired into:    POST /v1/sessions/:id/apply-spec      (server)
                 :apply <yaml-file>                    (REPL)
                 :changes [N]                          (REPL — per-turn diff)
```

Single new pipeline produces: structured per-file diff, materialised rule JS, integrity report, validator delta, transcript event — all in one atomic turn. No regeneration from scratch. UUIDs preserved by construction.

---

## Table of contents

1. [Why this exists](#1-why-this-exists)
2. [The YAML spec pipeline (WS1)](#2-the-yaml-spec-pipeline-ws1)
3. [The dependency graph (WS1.5)](#3-the-dependency-graph-ws15)
4. [The patcher + bundle-io + pipeline orchestrator (WS2)](#4-the-patcher--bundle-io--pipeline-orchestrator-ws2)
5. [Skills curation (WS4)](#5-skills-curation-ws4)
6. [Multi-agent foundation (WS5)](#6-multi-agent-foundation-ws5)
7. [Dogfood story: the bugs only the live loop caught](#7-dogfood-story-the-bugs-only-the-live-loop-caught)
8. [Test coverage](#8-test-coverage)
9. [API + CLI surface](#9-api--cli-surface)
10. [What's still pending](#10-whats-still-pending)

---

## 1. Why this exists

Phase 4 shipped real-agent edits via `POST /v1/sessions/:id/messages`. The agent could Read + Edit any JSON file in the bundle. Three problems surfaced quickly:

```
   Phase 4 reality                       Phase 6 reality
   ───────────────                       ───────────────
   Agent freelance-edits JSON files     Agent composes a YAML spec; deterministic
   (UUIDs invented, structural          patcher applies it (UUIDs preserved by
   violations, format drift)            construction)

   No diff visibility — only            Every edit returns a structured
   line-level git diffs                 per-file diff: { added[], updated[]
                                        with field-level change tracking,
                                        removed[] }

   "Generate from scratch" was the      Patch-in-place model:
   only path → all UUIDs change         download bundle → spec deltas →
   on every iteration → live AVNI       JSON patch in memory → canonical
   servers reject because cached        rezip. UUIDs stable across iterations.
   references break
```

avni-ai (the parallel Python project) had figured this out — three-agent architecture, YAML as canonical form, `/patch-bundle` flow, structured output contracts. Phase 6 ports the useful parts of that thinking into our Node stack without depending on the Python service.

---

## 2. The YAML spec pipeline (WS1)

Two modules, ~500 LOC combined, full round-trip stable.

```
   spec/parser.js     YAML  ──→  entities dict
                              ↑
   spec/emitter.js  entities ──→  YAML
```

**Where it lives:** `avni-skills/srs-bundle-generator/spec/` (in the brain repo — per CLAUDE.md §3 generator code goes upstream). Both modules CJS (matching avni-skills convention) — different from the SDK's ESM.

**Canonical schema:** the 318-line `avni-comprehensive-spec-format.yaml` in `avniproject/avni-ai`. Generated from 21 real org bundles. Top-level: `org`, `settings`, `addressLevels`, `subjectTypes`, `programs`, `encounterTypes`, `groups`, plus 9 passthrough sections (`menuItems`, `messageRules`, `groupPrivileges`, etc.).

**Round-trip contract:** `parse(emit(parse(yaml))) ≡ parse(yaml)`. 29 tests enforce this across all 7 formTypes, every passthrough field, Unicode names, negative + float numeric bounds, declarative rules, anchors, type tags, empty inputs.

**Form discovery rule:** forms are matched by `(formType, subjectType, program, encounterType)` — the unique tuple that gives a form its identity per the validator's 7-row spec table. Renaming a form mid-spec doesn't create a duplicate file.

---

## 3. The dependency graph (WS1.5)

Why it exists: when an agent (or user) asks "what breaks if I delete this subjectType?" the answer needs to be deterministic — not LLM-inferred. `spec/graph.js` (~280 LOC) gives three queries:

```js
const g = buildBundleGraph(bundleDir);
//   { nodes: Map<uuid, {kind, uuid, name, raw}>,
//     edges: [{from, to, field, kind, required, formType?}],
//     counts: { concept: 234, form: 18, ... } }

findDependents(g, uuid)    // what breaks if I delete this?
findDependencies(g, uuid)  // what does this entity require?
integrityCheck(g)          // walk all edges; flag dangling refs
```

The FK matrix is **extracted from real code**, not hand-drawn:
- `bundle_validator.js:68-74` — the 7-row formType → required-mapping table
- `avni-server-data/.../domain/FormMapping.java` JPA annotations — 5 FKs (form + subjectType + program + encounterType + taskType)
- `avni-server-data/.../domain/FormElement.java` — concept + group + parent (self-ref for QuestionGroups) + documentation
- `avni-server-data/.../domain/EncounterType.java` — concept (display binding)

The graph encodes the **union** of generator-emitted shape + validator-checked edges + server-side JPA constraints. Tests cover all 7 formTypes + concept-answer edges + decisionConcept (JPA-only) + AddressLevelType.parent self-refs + GroupRole's two SubjectType FKs.

---

## 4. The patcher + bundle-io + pipeline orchestrator (WS2)

### 4.1 `spec/patcher.js` — entity-level merge

```js
patchBundle({ bundleFiles, entities }) → { newFiles, diff, filesChanged }
```

Merge semantics:
- **UUID match first** → update in place. UUIDs are NEVER replaceable (the critical invariant for live AVNI servers).
- **Case-insensitive name match** → update in place (with new fields layered, UUID preserved).
- **No match** → append, mint new UUID via `crypto.randomUUID()`.

Diff structure per file:
```js
{
  'concepts.json': {
    added:   [{ uuid, name }],
    updated: [{ uuid, name, fields: [...] }],   // field-level change tracking
    removed: []   // patcher never removes — that's a separate destructive verb
  },
  'forms/*': { added, updated, removed }
}
```

Forms tracked by their `(formType, subjectType, program, encounterType)` identity, not by file path — so renaming preserves the file across iterations.

### 4.2 `spec/bundle-io.js` — ZIP ↔ file map

```js
bundleFromZip(zipBuffer) → fileMap   // adm-zip reader
bundleToZip(fileMap)     → Buffer    // canonical-zip writer (preserves
                                     // BundleService.java fileSequence order)
```

The write path reuses the existing `scripts/zip_bundle.js` `createOrderedZip` (a manual ZIP-format implementation that avoids adm-zip's alphabetical sort) — a 2-line export refactor on that file. Files preserved across round-trip: parsed JSON for `.json`, raw Buffer for everything else.

### 4.3 `src/pipeline.js` — the orchestrator (in the SDK, ESM)

```js
applySpec({ existingBundleFiles | existingBundleZip,
            specYaml,
            materialize = true,
            runIntegrityCheck = true,
            outputZip = false })
  → { patchedFiles, patchedZip?, diff, filesChanged, diffSummary,
      ruleCompilation: { compiled, errors },
      integrity: { ok, issues } }
```

Five-step pipeline:

1. **Parse** YAML → entities (via brain's `parser.js`).
2. **Materialise** any `*DeclarativeRule` field → JS via the SDK's vendored `rules-brain/compile.js` (which wraps avni-rules-config's `DeclarativeRuleHolder`). Five rule types: `viewFilter`, `formElementGroup`, `eligibility`, `formValidation`, `decision`, `visitSchedule`. Hand-written JS rules pass through untouched.
3. **Patch** into the existing file map (brain's `patcher.js`). UUIDs preserved.
4. **Integrity-check** the patched state (handles wrapped + bare-array operational shapes; nested + flat FK refs — both real-bundle quirks).
5. **Optionally re-emit ZIP** via canonical writer.

The integrity check is critical: it catches dangling references that would crash on AVNI upload but slip past the local validator.

### 4.4 New session endpoint + REPL commands

```
POST /v1/sessions/:id/apply-spec  body: { yaml, materialize? }
  → reads bundle dir into file map
  → calls applySpec
  → writes changes back via sessions.commitTurn
  → emits transcript turn_commit event with structured diff
  → returns { turn, diff, diffSummary, filesChanged, ruleCompilation, integrity }

REPL:
  :apply <spec.yaml>   deterministic patch; renders diff + rules + integrity
  :changes [N]         per-file added/updated/removed for turn N (or last)
```

---

## 5. Skills curation (WS4)

The agent used to load **all 17 skills** it could find. Many were off-topic for bundle authoring (mobile-testing, support-engineer, metabase-reports, etc.). After audit:

```
  Brain skills:    16  →  7 active for bundle authoring
  SDK-local:        1  →  1 active (rules-author)
  ─────────────────────────────────────────
  Total exposed:   17  →  8  (~53% reduction)
```

The dropped skills remain readable via `GET /v1/skills/:slug` and the agent's `Skill` tool — they're just not pre-loaded into the system prompt's `skills:` config. Expected impact: ~30-50% drop in `cache_creation_input_tokens` per turn.

Audit is committed in [`src/skills.js LOAD_BEARING_BUNDLE_SKILLS`](../src/skills.js) — a frozen `Set` that the curation test will refuse to drift accidentally. See [`docs/skills-curation.md`](skills-curation.md) for the per-skill keep/drop rationale.

---

## 6. Multi-agent foundation (WS5)

Three agent configs landed; live dispatch is the next increment.

```
   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │   Spec Agent     │  → │  Bundle Config   │  → │   Review Agent   │
   │  ─────────────   │    │  ─────────────   │    │  ─────────────   │
   │  SRS / user msg  │    │  spec → bundle,  │    │  spec ↔ bundle   │
   │      → YAML      │    │  fix F2/F5/M1/M2 │    │  completeness +  │
   │  Edit/Write      │    │  Edit/Write      │    │  integrity audit │
   │  + Skill         │    │  + Skill         │    │  read-only       │
   └──────────────────┘    └──────────────────┘    └──────────────────┘
        ↓                       ↓                       ↓
   each ends with a fenced ```json``` block:
   { intent, target_phase, ambiguities[], applied_changes[], reason }
```

**Schema** (`src/agent-output-schema.js`):

```js
{
  "intent":       "ask_user" | "applied_fix" | "phase_complete" | "error",
  "target_phase": "spec_awaiting_user" | "bundle_correcting" | "ready_to_upload" | ...,
  "ambiguities":  [{ id, question, options[], target_section, target_store }],
  "applied_changes": [{ section, operation: add|update|remove, item_names[], reason }],
  "reason":       string ≤500 chars
}
```

This is the **byte-identical** contract from `avniproject/avni-ai/prompts/spec-agent.txt`. Anthropic Strict Tool Use can use `AGENT_OUTPUT_SCHEMA` as its `input_schema` to constrain decoding. Until that lands (needs live API keys for tests), `parseAgentOutput()` + `validateAgentOutput()` handle the same job at the SDK level.

Semantic guards in the validator:
- `intent: "ask_user"` requires `ambiguities` to be non-empty
- `intent: "applied_fix"` requires `applied_changes` to be non-empty
- All enum fields rejected on unknown values
- `reason` capped at 500 chars (one-line rationale, not a treatise)

**What's NOT in this increment:** live LLM dispatch with the schema enforced. That's a `/v1/sessions/:id/agent-messages` endpoint with `agent: "spec" | "bundle-config" | "review"` param + `outputFormat: AGENT_OUTPUT_SCHEMA` per Anthropic's Strict Tool Use docs. Deferred until WS3 corpus is in (the agent needs real bundles to be useful).

---

## 7. Dogfood story: the bugs only the live loop caught

Halfway through WS2 we spun up a live server, created a synthetic session, and posted a real YAML spec to `/apply-spec`. Three bugs surfaced that the 200+ unit tests had missed:

1. **`operationalXxx.json` is wrapped**, not a bare array. The generator emits `{ operationalSubjectTypes: [...] }`. Synthetic test fixtures used bare arrays. Pipeline now handles both via an `asArray(value, wrappedKey)` helper.

2. **Operational FK shape is nested**: `op.subjectType.uuid`, not `op.subjectTypeUUID`. Synthetic tests used the flat shape. Graph + integrity check now tolerate both.

3. **Parser dropped `*DeclarativeRule` fields** from program + encounterType passthrough lists. Even though `materializeRules` was wired correctly, the IR never reached it because the parser silently discarded the field. Fixed by adding `enrolmentEligibilityCheckDeclarativeRule`, `manualEnrolmentEligibilityCheckDeclarativeRule`, `entityEligibilityCheckDeclarativeRule` to the passthrough.

After the fixes: declarative IR compiled to 386 bytes of canonical `imports.rulesConfig.RuleCondition` JS, landed in the right `programs.json` field. Integrity check passed. Turn 3 committed.

**Moral:** unit tests cover the matrix; dogfooding catches the integration. Future workstreams should include a "live loop" verification phase before claiming done.

---

## 8. Test coverage

```
                                       Baseline   After Phase 6   Δ
                                       ────────   ─────────────   ──
  Phase 5+5a (sessions + memory)         193          193          0
  Spec parser                                          16        +16
  Spec emitter                                         13        +13
  Spec graph                                           15        +15
  Spec patcher                                         15        +15
  Pipeline + ZIP integration                           20        +20
  Spec bundle-io                                        9         +9
  Coverage hardening (matrix tests)                   37        +37
  Adversarial inputs                                  25        +25
  Integration (multi-entity, ZIP)                     14        +14
  Skills curation                                      7         +7
  Agent output schema + configs                       23        +23
                                                    ────       ────
                                                     380       +187
```

**Test files added this phase** (12):

- `spec-parser.test.cjs` · `spec-emitter.test.cjs` · `spec-graph.test.cjs`
- `spec-patcher.test.cjs` · `spec-bundle-io.test.cjs` · `pipeline.test.cjs`
- `spec-coverage.test.cjs` · `spec-adversarial.test.cjs` · `spec-integration.test.cjs`
- `skills-curation.test.cjs` · `agent-schema.test.cjs`
- (existing test files unchanged)

Properties enforced:

- All 7 formTypes flow through patcher and produce valid form files
- All 6 rule types compile via rules-brain without throwing
- Round-trip stability across 13 representative YAML shapes
- ZIP round-trip is idempotent at the file-map level
- Patcher never mutates input objects (mutation safety)
- Pipeline survives wrapped + bare-array bundle shapes (real-bundle vs synthetic)
- Hard rule #5 (case-insensitive trim upsert) enforced in patcher behavior
- Skill set drift detection: curation test refuses growth-by-default
- Agent schema validates against avni-ai's canonical contract verbatim

---

## 9. API + CLI surface

```
                Phase 6 additions                  When to use
                ────────────────                   ───────────
HTTP:
POST /v1/sessions/:id/apply-spec    yaml-driven    Deterministic patch from a
                                                   YAML spec (no LLM cost).
                                                   Use when you / an agent
                                                   already have the spec.

REPL:
:apply <spec.yaml>                  drives ↑       Local equivalent.
:changes [N]                        diff renderer  Inspect what turn N did.

Modules (the brain — call from any Node code):
require('.../spec/parser')     specToEntities
require('.../spec/emitter')    entitiesToSpec
require('.../spec/graph')      buildBundleGraph, findDependents,
                               findDependencies, integrityCheck
require('.../spec/patcher')    patchBundle, summarizeDiff
require('.../spec/bundle-io')  bundleFromZip, bundleToZip

Modules (the SDK):
import { applySpec, materializeRules } from './pipeline.js';
import { AGENT_OUTPUT_SCHEMA, parseAgentOutput, validateAgentOutput }
  from './agent-output-schema.js';
import { SPEC_AGENT, BUNDLE_CONFIG_AGENT, REVIEW_AGENT, getAgent, listAgentNames }
  from './agents/index.js';
import { listBundleAuthoringSkills, isBundleAuthoringSkill }
  from './skills.js';
```

---

## 10. What's still pending

- **WS3 — Corpus validation.** Blocks on you sharing the 21 real bundles (or confirming the 5 visible ones are all). Once unblocked: run the full pipeline through each, prove no fields lost, lock in regressions.
- **WS5 (live dispatch).** The schema + agent configs are landed. The next increment is `POST /v1/sessions/:id/agent-messages?agent=spec` that invokes the right system prompt + applies Anthropic Strict Tool Use against `AGENT_OUTPUT_SCHEMA`. Needs API keys for meaningful tests.
- **SRS-prose → IR parser.** Today: a user authors the declarative IR by hand (or an LLM does). Going from "Skip Logic" Excel column text → IR is a separate parsing problem. The existing brain generator handles skip-logic; expanding to validation/decision/eligibility text columns is real work (~1-2 days).
- **Brain-as-HTTPS deployment.** You picked Option E in the topology question (deploy avni-skills as its own HTTPS service). Once WS3 stabilises, wrapping the brain's modules in Express + deploying to Railway is ~2 hours.

Phase 6 closes the **edit-deterministically** loop. The next phase is **multi-agent orchestration** — actually running the three agents in sequence against a real session, with the structured-output contract enforced at the API layer. That's where the customer-visible "I want to add this rule and have the agent figure out the IR" magic happens.

— Samanvay
