# Baseline vs Agent — Head-to-Head Addendum (#12)

> **Status: INTERIM — PENDING REAL-ORG SRSes + PAID EVAL RUN.** The data columns
> below are placeholders. They are filled by running
> `scripts/head-to-head.mjs --srs-dir <dir>` against a directory of **real,
> private SRSes** with a budget. The harness is fully structured and skips
> cleanly until then; only the paid execution is deferred.
>
> **Date:** `{{DATE}}` &nbsp;·&nbsp; **Run id:** `{{RUN_ID}}` &nbsp;·&nbsp;
> **Model (agent arm):** `{{MODEL_ID}}`
>
> **Staging note:** drafted in the SDK repo for review; **staged for publishing
> to the private `avni-product-ops` repo**. Real SRSes and per-org results are
> proprietary and must NEVER be committed to this public repo (`*.xlsx` is
> gitignored; this repo ships zero org data).

---

## 1. What this compares

The same SRS, two pipelines, measured at rest:

- **Arm A — baseline:** `POST /v1/sessions` (mode omitted). The deterministic
  SRS→bundle generator runs at turn 0. No LLM. Cost **$0**.
- **Arm B — agent:** `POST /v1/sessions` with `mode=agent` (empty workspace + the
  SRS persisted under `input/`), then `POST /v1/sessions/:id/messages` with an
  authoring prompt so the agent authors the bundle from the SRS.

For each arm we record **validator-errors-at-rest**, **integrity findings** (the
server-only traps `FE_CONCEPT_NOT_OBJECT` / `ALT_INVALID_NAME` / dangling
REQUIRED refs the validator misses), **cost (USD)**, and **wall-clock (ms)**.

## 2. How to produce the real numbers (fills every PENDING cell)

```bash
export ANTHROPIC_API_KEY='sk-ant-...'
AVNI_SKILLS_PATH=~/code/avni-skills \
  node scripts/head-to-head.mjs --srs-dir ~/private/srs --out ./h2h-report.json \
    [--model <full-model-id>] [--budget 20]
```

- SRS-dir layout: one `*Forms*.xlsx` per SRS; an optional `*Modelling*.xlsx`
  sharing the filename prefix is paired automatically. The prefix is the org
  label (kept anonymous here — use `Org A`, `Org B`, …).
- The harness emits a JSON report (`--out`) + a stderr progress log. Paste the
  per-SRS rows into §3 and the roll-up into §4.
- **Never commit the SRSes or the raw report** — anonymize before publishing.

## 3. Per-SRS results — PENDING REAL-ORG SRSes

| org | forms file | arm | validator errors | integrity ok | integrity error findings | cost (USD) | wall-clock (ms) |
|---|---|---|---|---|---|---|---|
| Org A | `<anon>` | baseline | `__` | `__` | `__` | $0.0000 | `__` |
| Org A | `<anon>` | agent | `__` | `__` | `__` | `$__` | `__` |
| Org B | `<anon>` | baseline | `__` | `__` | `__` | $0.0000 | `__` |
| Org B | `<anon>` | agent | `__` | `__` | `__` | `$__` | `__` |
| … | | | | | | | |

## 4. Roll-up — PENDING

| metric | baseline | agent | delta |
|---|---|---|---|
| SRSes with 0 validator errors at rest | `__/__` | `__/__` | `__` |
| SRSes with clean integrity at rest | `__/__` | `__/__` | `__` |
| mean validator errors at rest | `__` | `__` | `__` |
| total cost | $0.0000 | `$__` | `$__` |
| mean wall-clock | `__ ms` | `__ ms` | `__` |

## 5. Interim expectation + thresholds (documented judgment, NOT data)

- The baseline generator is deterministic and fast but blind to the two
  server-only traps and to semantic gaps that need judgment (F2 cross-group
  reuse, phantom subject types from activity-named forms, NA-junk concepts). The
  agent arm is expected to **reduce validator-errors-at-rest and integrity
  findings toward zero at a bounded $/SRS**, at the cost of wall-clock + tokens.
- **Interim success bar (revise from §3–§4 data):** the agent arm should reach
  **0 validator errors AND integrity-clean** on ≥ the same set of SRSes the
  baseline does, and strictly improve on at least the trap classes, within the
  per-SRS cost cap. If the agent arm is not strictly better on the trap classes,
  that is a finding to record — not a number to massage.
- Provenance: these thresholds are **interim judgment** pending the real run. The
  agent arm's model + the qualification behind it are recorded in the companion
  [`model-qualification-addendum.md`](./model-qualification-addendum.md) (#13).
