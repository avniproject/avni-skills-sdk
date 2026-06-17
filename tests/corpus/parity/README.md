# `corpus:parity` — integrity-detection parity gate

> avni-product#1882 "agentic realignment" epic · story #10 exit criterion

## Why this exists

The epic consolidates three deterministic data-integrity detectors into one
(`bundle_integrity_check`, in `src/agents/bundle-mcp-server.js`) so the two OLD
ones can be deleted. Before deleting `checkIntegrityOnFileMap`, we must **prove**
the new detector loses nothing the old ones caught — over the **real org corpus**,
not just synthetic fixtures.

This gate is the proof. It is **pure deterministic detection — zero LLM calls,
zero API spend.** As of SDK #15 / brain #3 the proof is **GREEN and meaningful**:
NEW drives its FK half off the same yaml-driven brain graph as the OLD graph
detector, so it covers the formerly graph-only kinds — Σ LOST = 0 over the real
17-org corpus is now a genuine **superset proof**, and the precondition for
deleting `checkIntegrityOnFileMap` is **SATISFIED** (see "Coverage status" below).

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

Since SDK #15 / brain #3, `bundle_integrity_check` drives its FK / dangling-ref
half off the **same yaml-driven brain graph** the OLD graph detector uses
(`buildBundleGraph` + `integrityCheck`), so it now covers BOTH the file-map kinds
AND the edge kinds that were previously **graph-only**. OLD-a ⊆ NEW and OLD-b ⊆ NEW
by construction. The gap that used to hide in the OLD-b (graph) half is **CLOSED**
— and this gate now proves NEW is a genuine superset of OLD over the real corpus,
which is the precondition for deleting `checkIntegrityOnFileMap`.

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
`{ class, file, locator }` plus diagnostic fields (`_field`, `_fromKind`, …) used
by the set key (`normalize.cjs`):

- **`class`** — a coarse, **detector-agnostic** category. All three spell a
  missing-FK finding differently; they all collapse to one class.
- **`file`** — best-effort bundle file the finding anchors to. The graph detector
  is directory-based and can't supply a file, so its findings carry
  `file="(bundle)"`. **`file` is deliberately NOT part of the DANGLING_REF set
  key** — keying on it would mark every graph dangling-ref "lost" vs the file-map
  detector that *does* know the file. False LOST avoided.
- **`locator`** — the **referenced (dangling) UUID** — the `to` uuid — NEVER
  message text or array index. The file-map and graph detectors expose the missing
  uuid as a bare `to`; the NEW detector packs it as
  `'<fromKind> "<name>" .<field> → <to> (not found)'`, from which `normalize.cjs`
  extracts the bare `to` (text after the arrow, trailing ` (not found)` stripped)
  so it keys identically to the OLD surfaces.
- **`_field` + `_fromKind`** — the edge **SOURCE**. `_field` is the detector-spelled
  field (e.g. `formMapping.subjectTypeUUID`, `encounterType.conceptUuid`), which is
  **identical across all three surfaces** for a given edge. `_fromKind` is derived
  from the field's entity prefix, so it too is identical across surfaces (the NEW
  finding carries the field in its `file` slot — see `bundle-mcp-server.js`
  `file: issue.field` — from which we recover both). These are part of the
  DANGLING_REF set key (next section) — that is what makes the comparison **symmetric**
  and closes the co-referenced false-green (see below).

### CODE → CLASS mapping

| Detector | Raw code / signal | → `class` | Appears in |
|----------|-------------------|-----------|------------|
| `checkIntegrityOnFileMap` | `DANGLING_REF` | `DANGLING_REF` | OLD |
| `graph.integrityCheck` | `MISSING_REQUIRED_REF` (required edge → error) **or** `DANGLING_REF` (optional → warning), any edge kind: mappingForm, mappingSubjectType, mappingProgram, mappingEncounterType, mappingTaskType, conceptAnswer, formElementConcept, decisionConcept, displayConcept, operationalMirror, hierarchy, groupRole | `DANGLING_REF` | OLD |
| `runBundleIntegrityCheck` | `MISSING_REQUIRED_REF` **or** `DANGLING_REF` (same yaml-driven `integrityCheck` as OLD-b) | `DANGLING_REF` | NEW |
| `runBundleIntegrityCheck` | `FE_CONCEPT_NOT_OBJECT` | `FE_CONCEPT_NOT_OBJECT` *(NEW class)* | NEW only → GAINED |
| `runBundleIntegrityCheck` | `ALT_INVALID_NAME` | `ALT_INVALID_NAME` *(NEW class)* | NEW only → GAINED |

Since SDK #15 / brain #3 the yaml-driven `integrityCheck` splits a dangling edge
into `MISSING_REQUIRED_REF` (required edge, error) vs `DANGLING_REF` (optional,
warning). **Both** OLD-b and NEW emit this pair, and **both codes collapse to the
single canonical class `DANGLING_REF`** here — the required/optional split is
*severity*, not class. `normalize.cjs` maps `MISSING_REQUIRED_REF` and
`DANGLING_REF` identically and extracts the bare `to` uuid from the NEW detector's
`"<fromKind> \"<name>\" .<field> → <to> (not found)"` locator, so a now-covered
edge keys IDENTICALLY on both surfaces (no false LOST/GAINED).

The two NEW classes can ONLY appear in GAINED, never LOST — they have no OLD
counterpart by definition.

### Set-membership key

- `DANGLING_REF` → key is **`class|fromKind|field|to`** (`to` is `locator`).
  Includes the edge **SOURCE** (`fromKind`+`field`), not just the `to` uuid.
  `file` is still excluded (graph can't supply it). Built from the **same logical
  fields on every surface** — `field` is the symmetric anchor, `fromKind` is
  derived identically from it — so each dangling edge matches its OWN OLD↔NEW
  counterpart, and two distinct edges to the same missing uuid stay distinct
  members.
- NEW-only classes → key is `class|file|locator` (both file-anchored; each
  distinct site is its own member).

> **Why the key includes the edge source (not just `to`).** One missing uuid can be
> referenced by BOTH a covered edge (e.g. `formMapping.subjectTypeUUID`) AND a
> formerly-graph-only edge (e.g. `encounterType.conceptUuid`). Keyed on the `to`
> uuid alone, both would collapse to one member `DANGLING_REF|<uuid>` — so a single
> NEW finding could mask whether the OTHER edge is genuinely matched. Now that NEW
> covers both kinds the gate is green either way, but keeping the two edges as
> DISTINCT members makes the match HONEST and per-edge: each edge must be satisfied
> on its own, so the gate cannot be fooled by a key collapse if a future regression
> drops one edge but not the other. This per-edge distinctness is pinned by the
> co-referenced gap-closure test `2c`, and the gate's general loss-detection power
> by the synthetic divergence guard `2d` (see "Coverage status" below).

## SCOPE — what is NOT here

The 28-code **validator** (`bundle_validator.js`, codes like `A1`/`B2`/`C3`/`D1`)
is **KEPT** and **OUT OF SCOPE** — it is not part of the consolidation. None of
the three detectors above emit validator codes; `normalize.cjs`
(`assertNoValidatorCodes`) throws if a validator code ever leaks into the
comparison. The runner prints a confirming log line each run.

This gate is ONLY about the integrity/graph detectors being deleted/merged.

## Coverage status — the graph-only gap is CLOSED

`graph.integrityCheck` walks several edge kinds that the OLD `checkIntegrityOnFileMap`
did **not** — these were the "graph-only" kinds:

- `encounterType.conceptUuid` (display concept)
- `form.decisionConcepts[].uuid`
- `addressLevelType.parentUuid` (location hierarchy)
- `groupRoles.json` → `groupSubjectTypeUUID` / `memberSubjectTypeUUID`
- `formMapping.taskTypeUUID`

**Since SDK #15 / brain #3, `bundle_integrity_check` drives its FK half off the
SAME yaml-driven brain graph (`buildBundleGraph` + `integrityCheck`), so it now
COVERS all of these kinds too.** A dangling ref of any of them is detected by the
NEW surface identically to the OLD graph surface — the graph-only coverage gap is
**CLOSED**, proven a strict superset (9/9, zero loss) by SDK #15. This gate is now
a **MEANINGFUL superset proof**, not a trivially-green check: it proves NEW loses
nothing OLD catches, over the real corpus.

The gap-closure is pinned by two committed **coverage-now-closed** regression tests
in `parity-gate.test.cjs` (formerly RED `LOST≥1` tests, now flipped honestly):

- **`2b` (isolated):** a synthetic dangling `encounterType.conceptUuid → <missing>`
  is now detected by BOTH OLD (graph) and NEW (yaml-driven graph) → `LOST = 0`.
- **`2c` (co-referenced):** the SAME missing uuid referenced by BOTH a covered
  edge (`formMapping.subjectTypeUUID`) AND the formerly-graph-only edge
  (`encounterType.conceptUuid`) → both are covered by NEW → `LOST = 0`, AND the two
  edges remain DISTINCT set members (the dedup key includes the edge source,
  `class|fromKind|field|to`), so this is an honest per-edge match and not a key
  collapse that could mask a loss.

### Divergence guard — the gate still has teeth

Because NEW is now a genuine superset, **real data can no longer produce LOST**, so
every honest run is green. To stop the gate rotting into an always-green no-op, a
**synthetic divergence guard** (`2d` in `parity-gate.test.cjs`) feeds the gate's
real diff logic (`run.cjs` `runOrg`) a deliberately-crippled NEW surface that drops
a finding OLD legitimately has, and asserts the gate reports `LOST ≥ 1` (the
non-zero-exit condition). This proves the gate WOULD catch a future regression where
`bundle_integrity_check` loses a detection — independent of the (now-closed)
graph-only gap.

### Precondition for deleting `checkIntegrityOnFileMap` — SATISFIED

Deleting `checkIntegrityOnFileMap` (relying on `bundle_integrity_check` as the sole
integrity detector) was gated on the NEW surface actually covering the graph-only
edge kinds. **That precondition is now SATISFIED:** SDK #15 ported the FK half onto
the yaml-driven brain graph, and this gate proves Σ LOST = 0 over the real 17-org
corpus as a meaningful superset proof (not a data accident). The deletion is now
**safe and ready for story #10**.

`checkIntegrityOnFileMap` is still present in `src/pipeline.js` pending that explicit
deletion step. Keeping this gate wired into CI permanently remains good practice so
the consolidation can never silently regress on a future corpus.

### Fail-loud on a missing brain

`detectors.cjs` loads the brain's `graph.js` for the graph (OLD-b) detector. If the
brain cannot load, it **throws a clear error** rather than running with a
half-loaded OLD surface that would silently shrink and pass as false parity. This
is distinct from "no corpus": a missing `SDK_CORPUS_PATH` **skips** (exit 0); a
present corpus with a missing/broken brain is a **hard error** (exit 2).

## Files

| File | Role |
|------|------|
| `normalize.cjs` | code→class mapping, canonical triple, set key, diff |
| `detectors.cjs` | loads all three detectors; computes OLD / NEW surfaces per org |
| `snapshot.cjs` | freezes OLD surface → `baseline-detections.json` (committed witness) |
| `run.cjs` | the gate (`npm run corpus:parity`) — LOST/GAINED, verdict, exit code |
| `parity-gate.test.cjs` | synthetic unit tests of the gate logic (runs in `npm test`): always-green dangling/flattened/clean cases, the two coverage-now-closed gap tests (`2b`/`2c`), and the divergence guard (`2d`) that pins the gate's loss-detection power |
| `baseline-detections.json` | committed OLD-surface witness (empty per org on current corpus) |
| `gained.json` | NEW\OLD, regenerated each run (informational) |
| `lost.json` | OLD\NEW, written ONLY when the gate fails |
```
