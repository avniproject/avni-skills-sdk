# Model-matrix run — 2026-07-13

Data-driven model routing for the avni-skills-sdk. Real evals on the Anthropic API,
across Haiku 4.5 / Sonnet 4.5 / Sonnet 5 / Opus 4.8, for the two model-bearing
surfaces: **authoring** (the agent that edits bundles) and the **CRL judge**
(compliance review — prune/inspect). Harness knobs used: `SDK_EVAL_MODEL`
(authoring model), `SDK_JUDGE_MODEL` / `SDK_JUDGE_ESCALATION_MODEL` (judge tiers),
`SDK_EVAL_TIMEOUT_MS` (dispatch deadline).

## Decision (now the app defaults)

- **Authoring → Opus 4.8** — `agent.js DEFAULT_MODEL`, `model-matrix.js
  FALLBACK_DEFAULT_MODEL`, and `spec/model-qualification.json` (Opus is the sole
  structural-qualified model; Sonnet demoted to read-only).
- **CRL judge → Haiku 4.5** — `src/crl/ai-judge.js` both tiers default to Haiku
  4.5 (env-overridable via `SDK_JUDGE_MODEL` / `SDK_JUDGE_ESCALATION_MODEL`).

## Authoring — case 24 (rule authoring), repeat-N = 5

| model | pass-rate | $/pass | s/run | note |
|---|---|---|---|---|
| **Opus 4.8** | **4/5** | $0.29 | 176 | most reliable — the pick |
| Haiku 4.5 | 3/5 | $0.08 | 55 | flaky (~60%) but cheap/fast, all completed |
| Sonnet 4.5 | 1/5 | $0.15 | 72 | genuinely weak at authoring |
| Sonnet 5 | 0/5 (timeouts) | — | 360–600 | **inherent**: isolated re-run also 3/3 timed out at 600s — not just load; unusable for authoring here |

Authoring is the one surface where a stronger model earns its cost.

## CRL judge — hard inverted-cue case (CRL2a precision / CRL2b recall), N = 5

Case design: plausible-named strays that MUST be caught + junk-named *referenced*
decoys that MUST survive (defeats name-based pattern-matching; forces reference-checking).

| judge model | N | precision | recall | false-prunes | $/run | s/run |
|---|---|---|---|---|---|---|
| Haiku 4.5 | 5 | 1.000 | 1.000 | 0 | **$0.081** | 44 |
| Sonnet 4.5 | 5 | 1.000 | 1.000 | 0 | $0.083 | 47 |
| Sonnet 5 | 5 | 1.000 | 1.000 | 0 | $0.084 | 46 |
| Opus 4.8 | 5 | 1.000 | 1.000 | 0 | $0.084 | 48 |

Every model is perfect and cost converges (~$0.08) — the judge's output is tiny, so
a stronger tier buys **nothing**. Route to Haiku (cheapest). The deterministic
never-prune-referenced guardrail is what actually protects precision (guardrail
saves = 0 because no model even flagged a decoy). *Scope: the stray/orphan class
(what CRL2a/2b measure); fuzzier judged classes (prose-as-form, matches-intent)
were not tested and could still discriminate.*

## Operational note — Sonnet 5 authoring timeouts

Sonnet 5's authoring turns run very long (adaptive thinking) and, on this account,
appear to hit a tight Sonnet-5 rate limit → backoff-retry stalls. Isolated runs
still ran past 10 minutes. The dispatch timeout is a **client-side** deadline
(`runner.cjs` AbortController; the real server streams SSE with no self-imposed
timeout), so production exposure depends on the client timeout + concurrency. Not
relevant to the chosen defaults (Opus/Haiku), recorded for completeness.

## Reproduce

Authoring sweep: `SDK_EVAL_MODEL=<id> SDK_EVAL_TIMEOUT_MS=360000 SDK_EVAL_FILTER='^24-'
SDK_EVAL_RESULTS_JSONL=out.jsonl npm run eval`.
Judge sweep: drive `reviewBundle(mode:"scrub")` with `SDK_JUDGE_MODEL=<id>
SDK_JUDGE_ESCALATION_MODEL=<id>` over a poisoned bundle (strays + referenced decoys),
score pruned-vs-ground-truth. N=5 per model.
