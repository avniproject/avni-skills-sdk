# Model-Qualification Matrix — Addendum (#13)

> **Status: INTERIM — PENDING PAID EVAL RUN.** The data columns below are
> placeholders. They are filled by running the full enforcing eval suite once
> **per candidate model** and regenerating `spec/model-qualification.json` from
> the results. Until that budgeted run happens, model selection uses the
> **documented interim seed** (last section) and falls back to the #11 default
> (`claude-sonnet-4-6`) for any category with no qualified model.
>
> **Date:** `{{DATE}}` &nbsp;·&nbsp; **Eval run id:** `{{RUN_ID}}` &nbsp;·&nbsp;
> **Suite:** 23 enforcing cases (`tests/eval/cases/01..23`)
>
> **Staging note:** this file is drafted in the SDK repo for review and is
> **staged for publishing to the private `avni-product-ops` repo** (per the epic
> AC "published as a dated addendum in avni-product-ops"). Do NOT commit real
> per-org data here. This repo ships zero proprietary data.

---

## 1. Why observation, not assertion

Per the June article, cost and capability decisions are made **from evidence**,
not from vibes. This matrix turns per-model eval evidence into three artifacts:

1. a **qualification** (pass/fail per category, per model),
2. a **default-model decision** (recorded with rationale),
3. **per-model tool tiers** (a model earns write/structural/export only where it
   is qualified for a structural category — see `deriveToolTiers`).

The mechanism already ships (`src/model-matrix.js` + `selectModel` +
`scripts/build-model-matrix.mjs`); only the **paid execution** that fills the
numbers is deferred.

## 2. How to produce the real matrix (fills every PENDING cell)

```bash
export ANTHROPIC_API_KEY='sk-ant-...'
export SDK_EVAL_BUDGET_USD=<per-model budget>          # a matrix run is N× the suite

# Run the full suite ONCE PER CANDIDATE MODEL, appending to a shared JSONL.
for M in claude-haiku-4-5-<date> claude-sonnet-4-6-<date> claude-opus-4-8-<date>; do
  SDK_EVAL_MODEL="$M" \
  SDK_EVAL_RESULTS_JSONL=./tests/eval/out/results.jsonl \
    AVNI_SKILLS_PATH=~/code/avni-skills npm run eval
done

# Regenerate the qualification JSON from the accumulated results.
node scripts/build-model-matrix.mjs --in ./tests/eval/out/results.jsonl
```

- Matrix runs on cheaper models will legitimately fail some cases — **that is the
  data, not flake**. Keep matrix runs OUT of any pass/fail CI gate.
- **Record FULL model IDs + date, never aliases** (the repo already shipped a
  stale `opus` alias; alias drift is exactly what this addendum must avoid).
- The live observability dashboard reads the same JSONL — see the "eval" panel in
  `scripts/observability-dashboard.mjs` (per-model pass-rate + $, API-free).

## 3. Pass-rate × cost matrix — PENDING PAID EVAL RUN

Candidate tiers (record the resolved full model ID + date in the header cell):

| category \\ model | haiku-tier<br>`claude-haiku-4-5-<date>` | opus-tier<br>`claude-sonnet-4-6-<date>` | frontier<br>`claude-opus-4-8-<date>` |
|---|---|---|---|
| data-integrity | `__/__ (__%)` · `$__` | `__/__ (__%)` · `$__` | `__/__ (__%)` · `$__` |
| safety-refusal | `__/__ (__%)` · `$__` | `__/__ (__%)` · `$__` | `__/__ (__%)` · `$__` |
| correctness | `__/__ (__%)` · `$__` | `__/__ (__%)` · `$__` | `__/__ (__%)` · `$__` |
| no-thrash | `__/__ (__%)` · `$__` | `__/__ (__%)` · `$__` | `__/__ (__%)` · `$__` |
| srs-authorship | `__/__ (__%)` · `$__` | `__/__ (__%)` · `$__` | `__/__ (__%)` · `$__` |
| **suite total** | `__/23 (__%)` · `$__` | `__/23 (__%)` · `$__` | `__/23 (__%)` · `$__` |

Per-case pass/$ detail (23 rows × N models) is emitted by the runner into the
results JSONL and rendered by `build-model-matrix.mjs`; paste the generated table
here on run.

## 4. Qualification threshold + provenance

- **Qualification rule (interim):** a model is `qualified: true` for a category
  when its pass-rate on that category's cases is **100%** in the matrix run
  (every enforcing case for the category passes). This is deliberately strict for
  the structural categories (`data-integrity`, `correctness`, `srs-authorship`) —
  a single structural miss can corrupt a real org's bundle. Loosen only with
  recorded rationale.
- **Selection policy:** among models qualified for the request's category, the
  **cheapest** wins (cost rank `haiku < sonnet < opus < fable`); ties break by
  name. Absent any qualified model, selection returns the #11 default
  (`claude-sonnet-4-6`) — **never a silent downgrade** to a weaker model.
- **Provenance discipline:** `spec/model-qualification.json` carries a checksum
  over its `models` payload; a mutation-proven test (`model-matrix.test.cjs`)
  goes RED if any qualification value is edited by hand instead of regenerated.
  `source` records where the numbers came from (`interim-seed` → real `runId`).

## 5. Default-model decision (record on run)

- **Shipped default (current):** `claude-sonnet-4-6` — the #11 default, retained
  pending matrix evidence. Set in ONE place each: `src/agent.js` (`DEFAULT_MODEL`)
  and `scripts/sdk-cli.mjs` (REPL default), with the alias map in
  `scripts/cli/dispatch.mjs` (`haiku`/`sonnet`/`opus` → full IDs).
- **Decision (fill from §3):** `<default model + any per-task-class tiering,
  with the rationale from the matrix>`.

## 6. Interim seed currently in effect (documented judgment, NOT eval data)

Source `interim-seed` in `spec/model-qualification.json`. `Y` = qualified.

| category \\ model | `claude-haiku-4-5` (costRank 1) | `claude-sonnet-4-6` (costRank 2) | `claude-opus-4-8` (costRank 3) |
|---|---|---|---|
| data-integrity | n | Y | Y |
| safety-refusal | n | Y | Y |
| correctness | n | Y | Y |
| no-thrash | Y | Y | Y |
| srs-authorship | n | Y | Y |
| **tool tiers** | read | read/write/structural/export | read/write/structural/export |

Rationale (interim): haiku is trusted only for low-risk explain/verify work
(`no-thrash`); structural work routes to sonnet/opus until eval evidence says
otherwise. `claude-fable-5` carries a cost rank (4) but no qualification row yet.

Under this seed, every structural category routes to **`claude-sonnet-4-6`**
(cheapest structurally-qualified) — matching the shipped #11 default, so the
common case is unchanged until the paid matrix run repopulates §3–§5.
