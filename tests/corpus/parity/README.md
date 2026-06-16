# `corpus:parity` — integrity-detection parity gate

> avni-product#1882 "agentic realignment" epic · story #10 exit criterion

## Why this exists

The epic consolidates three deterministic data-integrity detectors into one
(`bundle_integrity_check`, in `src/agents/bundle-mcp-server.js`) so the two OLD
ones can be deleted. Before deleting `checkIntegrityOnFileMap`, we must **prove**
the new detector loses nothing the old ones caught — over the **real org corpus**,
not just synthetic fixtures.

This gate is the proof. It is **pure deterministic detection — zero LLM calls,
zero API spend.**

The three detectors:

| Role | Detector | Source | Shape |
|------|----------|--------|-------|
| OLD-a | `checkIntegrityOnFileMap(fileMap)` | `src/pipeline.js` | file-map based; `{severity,code:"DANGLING_REF",message,from,to,field}` |
| OLD-b | `buildBundleGraph(dir)` + `integrityCheck(graph)` | `$AVNI_SKILLS_PATH/srs-bundle-generator/spec/graph.js` | directory based; `{ok,issues:[{severity,code:"DANGLING_REF",message,edge}]}` |
| NEW | `runBundleIntegrityCheck(dir)` | `src/agents/bundle-mcp-server.js` | directory based; `{ok,findings:[{code,severity,file,locator,message}]}` |

```
OLD detection surface = normalize(OLD-a) ∪ normalize(OLD-b)
NEW detection surface = normalize(NEW)

LOST   = OLD \ NEW   → MUST be empty           (a real coverage gap if non-empty)
GAINED = NEW \ OLD   → logged, NEVER blocks    (expect the 2 new checks here)

PARITY PASS  iff  Σ_orgs |LOST| == 0.
```

`bundle_integrity_check` **reuses** `checkIntegrityOnFileMap` verbatim for its FK
half, so OLD-a ⊆ NEW by construction. The meaningful diff is the **OLD-b
(graph.integrityCheck) half** — that's where a real gap can hide.

## Run it

```bash
# Real corpus (local only — corpus is never committed):
SDK_CORPUS_PATH=/path/to/orgs-bundle \
AVNI_SKILLS_PATH=/path/to/avni-skills \
  npm run corpus:parity

# Re-freeze the committed OLD baseline witness:
SDK_CORPUS_PATH=... AVNI_SKILLS_PATH=... npm run corpus:parity:snapshot

# Synthetic gate-logic unit test (runs in normal CI, no corpus needed):
AVNI_SKILLS_PATH=... npm test     # includes tests/corpus/parity/parity-gate.test.cjs
```

Without `SDK_CORPUS_PATH` the gate **skips gracefully (exit 0)** — CI without the
proprietary corpus still passes. Same convention as `tests/corpus/run.cjs`.

## Normalization (the critical part — avoid false LOST)

Every finding from all three detectors is reduced to a canonical triple
`{ class, file, locator }` (`normalize.cjs`):

- **`class`** — a coarse, **detector-agnostic** category. All three spell a
  missing-FK finding differently; they all collapse to one class.
- **`file`** — best-effort bundle file the finding anchors to. The graph detector
  is directory-based and can't supply a file, so its findings carry
  `file="(bundle)"`. **`file` is deliberately NOT part of the DANGLING_REF set
  key** — keying on it would mark every graph dangling-ref "lost" vs the file-map
  detector that *does* know the file. False LOST avoided.
- **`locator`** — keyed on the **referenced (dangling) UUID** — the `to` uuid —
  NEVER on message text or array index. Both file-map and graph detectors expose
  the missing uuid as `to` (the NEW detector packs it as `"<from> → <to>"`, from
  which we extract `to`). This is what makes the three detectors comparable.

### CODE → CLASS mapping

| Detector | Raw code / signal | → `class` | Appears in |
|----------|-------------------|-----------|------------|
| `checkIntegrityOnFileMap` | `DANGLING_REF` | `DANGLING_REF` | OLD |
| `graph.integrityCheck` | `DANGLING_REF` (any `edge.kind`: mappingForm, mappingSubjectType, mappingProgram, mappingEncounterType, mappingTaskType, conceptAnswer, formElementConcept, decisionConcept, displayConcept, operationalMirror, hierarchy, groupRole) | `DANGLING_REF` | OLD |
| `runBundleIntegrityCheck` | `DANGLING_REF` (reused from `checkIntegrityOnFileMap`) | `DANGLING_REF` | NEW |
| `runBundleIntegrityCheck` | `FE_CONCEPT_NOT_OBJECT` | `FE_CONCEPT_NOT_OBJECT` *(NEW class)* | NEW only → GAINED |
| `runBundleIntegrityCheck` | `ALT_INVALID_NAME` | `ALT_INVALID_NAME` *(NEW class)* | NEW only → GAINED |

The two NEW classes can ONLY appear in GAINED, never LOST — they have no OLD
counterpart by definition.

### Set-membership key

- `DANGLING_REF` → key is `class|locator` (file excluded; see above).
- NEW-only classes → key is `class|file|locator` (both file-anchored; each
  distinct site is its own member).

## SCOPE — what is NOT here

The 28-code **validator** (`bundle_validator.js`, codes like `A1`/`B2`/`C3`/`D1`)
is **KEPT** and **OUT OF SCOPE** — it is not part of the consolidation. None of
the three detectors above emit validator codes; `normalize.cjs`
(`assertNoValidatorCodes`) throws if a validator code ever leaks into the
comparison. The runner prints a confirming log line each run.

This gate is ONLY about the integrity/graph detectors being deleted/merged.

## Known coverage observation (the gate's reason to exist)

`graph.integrityCheck` walks several edge kinds that
`checkIntegrityOnFileMap`/`bundle_integrity_check` do **not**:

- `encounterType.conceptUuid` (display concept)
- `form.decisionConcepts[].uuid`
- `addressLevelType.parentUuid` (location hierarchy)
- `groupRoles.json` → `groupSubjectTypeUUID` / `memberSubjectTypeUUID`
- `formMapping.taskTypeUUID`

On the **current real corpus none of these dangle**, so parity holds (Σ LOST = 0).
But if a future bundle has a dangling ref of one of these kinds, **the graph
detector would catch it and the NEW detector would not — and THIS GATE WOULD GO
RED**, correctly blocking the deletion of `checkIntegrityOnFileMap` until the gap
is closed. The gate has been verified to fail on exactly this case (a synthetic
`encounterType.conceptUuid → <missing>` produces `LOST=1`, exit 1).

**Recommendation before deleting `checkIntegrityOnFileMap`:** either (a) port these
graph-only edge kinds into `bundle_integrity_check`, or (b) keep this gate wired
into CI permanently so the consolidation can never silently regress on a future
corpus.

## Files

| File | Role |
|------|------|
| `normalize.cjs` | code→class mapping, canonical triple, set key, diff |
| `detectors.cjs` | loads all three detectors; computes OLD / NEW surfaces per org |
| `snapshot.cjs` | freezes OLD surface → `baseline-detections.json` (committed witness) |
| `run.cjs` | the gate (`npm run corpus:parity`) — LOST/GAINED, verdict, exit code |
| `parity-gate.test.cjs` | synthetic unit test of the gate logic (runs in `npm test`) |
| `baseline-detections.json` | committed OLD-surface witness (empty per org on current corpus) |
| `gained.json` | NEW\OLD, regenerated each run (informational) |
| `lost.json` | OLD\NEW, written ONLY when the gate fails |
```
