# Claude Code instructions for `avni-skills-sdk`

You are working in **avni-skills-sdk** — the body that wraps [`avniproject/avni-skills`](https://github.com/avniproject/avni-skills) (the brain) as agent-callable HTTP endpoints. This repo does NOT contain the generator or the SKILL.md knowledge base — those live in `avni-skills`.

Read this whole file before making changes. It's the contract.

---

## Mental model

```
avni-skills-sdk (this repo, body)
  ├── src/server.js              ← thin Express bootstrap + CORS + mountRoutes(app)
  ├── src/routes/                ← per-domain HTTP endpoint modules
  │     ├── index.js                ← mountRoutes(app) — wires each module
  │     ├── health.js               ← GET /health
  │     ├── skills.js               ← /v1/skills + /v1/skills/:slug
  │     ├── bundles.js              ← POST /v1/bundles/generate
  │     ├── agent-query.js          ← POST /v1/agent/query
  │     ├── sessions-lifecycle.js   ← POST/GET/DELETE /v1/sessions + files + turns + diff + zip + revert
  │     ├── sessions-edit.js        ← POST /:id/edit + POST /:id/apply-spec
  │     ├── sessions-messages.js    ← /:id/messages (single linear agent, slim contract)
  │     ├── sessions-observability.js ← /:id/{transcript,steps,cost,diagnostics}
  │     ├── sessions-rules.js       ← /:id/rules + /rules/validation + PUT /rules
  │     └── sessions-summary-evaluate.js  ← /summary, /evaluate, /wallet[/reset]
  ├── src/middleware/multipart.js ← small multipart parser (used by /bundles/generate)
  ├── src/pipeline.js            ← WS2 orchestrator: parse YAML → materialise rules → patch
  ├── src/skills.js              ← reads avni-skills/*/SKILL.md + bundle-authoring filter
  ├── src/bundle.js              ← wraps avni-skills's generator + validator
  ├── src/workspace.js           ← stages avni-skills as .claude/skills/ for the SDK
  ├── src/sessions.js            ← session storage (default: ~/.avni-skills-sdk/sessions/)
  ├── src/session-prune.js       ← prune logic (older-than, dry-run, audit)
  ├── src/transcript.js          ← append-only JSONL conversation memory per session
  ├── src/steplog.js             ← append-only JSONL operational log per session
  ├── src/wallet.js              ← per-session cost ledger (in-memory + cost.jsonl on disk)
  ├── src/locks.js               ← per-session async mutex (serialises concurrent writes)
  ├── src/logging.js             ← structured logger (one place for rate-limit/prune/security events)
  ├── src/middleware/rate-limit.js ← per-IP rate-limit middleware (429s logged)
  ├── src/security/post-turn-detector.js ← diffs the working tree after each turn,
  │                                  reverts out-of-scope writes, rejects the turn
  ├── src/agents/bundle-mcp-server.js     ← per-request factory createBundleMcpServer(bundleCwd)
  │                                  exposes 4 in-process MCP tools to the agent
  ├── src/agents/bundle-mcp-tool-names.js ← FROZEN tool-name constants (see rule §7)
  ├── src/agent.js               ← Claude Agent SDK wrapper (BYO key); slim outcome
  │                                  contract (default) / legacy hard rules (SDK_LEGACY_RULES=1);
  │                                  open tool set; defaultModel() (SDK_MODEL override)
  ├── src/rules-brain/           ← R1–R6 acorn-based JS-rule validator + vendored
  │                                  rules-config DeclarativeRuleHolder
  ├── scripts/sdk-cli.mjs        ← thin REPL entrypoint (args + boot + readline loop)
  ├── scripts/prune-sessions.mjs ← CLI wrapper for src/session-prune.js
  └── scripts/cli/               ← REPL implementation (factory-pattern modules)
        ├── ui.mjs                 ← ANSI helpers, box, rule, startSpinner, withSpinner
        ├── server-mgmt.mjs        ← ensureServer + http helpers (getJson/postJson/getText)
        ├── session.mjs            ← createSession + attachSession (REPL bootstrap)
        ├── sse.mjs                ← sendMessage — POST /messages + SSE renderer
        ├── banner.mjs             ← header box + bundle-stats box + suggestions
        ├── render.mjs             ← formatValidation + describeToolUse
        ├── help.mjs               ← buildHelp() — the :help text
        ├── bundle-path.mjs        ← guessBundlePath(sid) for tool-cwd resolution
        ├── dispatch.mjs           ← makeDispatcher — ":command args" routing
        └── commands/              ← REPL command bundles (factory functions)
              ├── turns.mjs           ← :turns, :diff, :files, :read, :state, :revert, :zip
              ├── rules.mjs           ← :rules, :rulev, :refs
              ├── audit.mjs           ← :summary, :eval
              ├── workflows.mjs       ← :apply
              └── observability.mjs   ← :transcript, :steps, :cost, :changes, :diag
              (:model is an inline override in dispatch.mjs; the :agent/:rename/:add-form
               deterministic-edit commands were retired in story #11)
  └── tests/eval/                ← real-LLM regression scenarios (gated on
                                    SDK_EVAL_BUDGET_USD + ANTHROPIC_API_KEY);
                                    the ONLY place model behaviour is exercised

avni-skills (separate repo, brain)
  ├── 16 skill folders (architecture-patterns, backend-architecture, ...)
  └── srs-bundle-generator/  ← generator + validator
```

The SDK locates `avni-skills` via env var `AVNI_SKILLS_PATH` or sibling clone `../avni-skills`. If neither exists, every helper throws at startup.

**Do NOT copy or vendor `avni-skills` into this repo.** Updates flow through the symlink-staging in `src/workspace.js`. Single source of truth.

---

## Verified state (do not re-discover)

End-to-end tested 2026-05-05 IST with a real Anthropic key. All times below are **Asia/Kolkata (UTC+5:30)**. All eight levels green:

| Level | What it proves | Verified (IST) |
|---|---|---|
| L1 | 45 entity tests pass | 2026-05-05 12:55 |
| L2 | server starts, `/health` ok | 2026-05-05 13:17 |
| L3 | `/v1/skills` returns the 16 skills | 2026-05-05 13:24 |
| L4 | `/v1/skills/:slug` returns SKILL.md body | 2026-05-05 13:30 |
| L5 | `/v1/bundles/generate` produces a valid ZIP, validator-errors=0 | 2026-05-05 13:44 |
| L6 | `/v1/agent/query` runs Claude session, agent reads `.claude/skills/<name>/SKILL.md`, returns end_turn, 0 errors | 2026-05-05 13:56 |
| L7 | Phase 3 session lifecycle: create → first-pass turn 0 → real edit drops validator errors → diff → revert → ZIP. Org-agnostic 16/16 invariants harness passes on the post-edit bundle. Demo: `bash scripts/demo-phase-3.sh` | 2026-05-05 15:17 |
| L8 | Phase 4 machinery (no key): per-session skill staging + `commitWorkspaceChanges` proven via `node scripts/dryrun-phase-4.mjs` — `.gitignore` excludes `.claude/`, idempotent re-stage, no-op detection, simulated agent edit drops validator errors **6 → 5** on real Astitva SRS, `.claude/` never in git history. The live (`/v1/sessions/:id/messages`) path reuses the L6-verified `runAgent()`. | 2026-05-05 16:20 |
| L9+ | **Phase 7 — Audit-driven A+ roundup**: per-session async mutex (`src/locks.js`), per-IP rate-limit middleware, structured logger, session-prune CLI, real-LLM eval harness (`tests/eval/`), post-turn unauthorized-mutation detector, path-jailed `bundle_export_to_path` (allowlist: ~/Desktop, ~/Downloads, ~/Documents, ~/.avni-skills-sdk/exports, $SDK_EXPORT_DIR), MCP server changed to per-request factory `createBundleMcpServer(bundleCwd)` so the cwd closure can't race. 433/433 tests + 21/21 corpus still green. | 2026-05-25 |

If you change anything in `src/`, re-run `bash scripts/verify.sh` (L1–L5 minimum) before committing. For session-API changes also re-run `bash scripts/demo-phase-3.sh`. For changes to `src/sessions.js` or `/v1/sessions/:id/messages`, also re-run `node scripts/dryrun-phase-4.mjs`.

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

### 5b. Adding / editing is the agent's job, not a CLI command

When a user asks to add a subject type, program, encounter type, concept, or form, **do not reach for a workflow script as a user-facing command**. The flow is: agent reads the current bundle → case-insensitive name lookup → upsert (update in place if exists, append otherwise, copying field shapes from existing neighbours verbatim) → Edit/Write back → server commits the diff as a new turn. The deterministic edit scripts (`add-form` / `add-subject-type` / `rename-concept-uuid`) were retired in story #11 — the slim `BUNDLE_OUTCOME_CONTRACT` (items 4–6) states the required end-state, and the deterministic gates (`bundle_integrity_check`, the yaml-driven graph, the concept-collision interceptor, the post-turn detector) catch any bad mutation. Only `scripts/workflows/fix-formelement-concept-shape.mjs` (the Durga recovery primitive) survives.

For concept lookup + validation the agent SHOULD prefer the in-process MCP tools over raw Bash:

- `mcp__avni-bundle__bundle_find_concept` — case-insensitive concept lookup by name or UUID (replaces `Bash grep`)
- `mcp__avni-bundle__bundle_validator_run` — validator with structured output (replaces `Bash node …/bundle_validator.js`)
- `mcp__avni-bundle__bundle_summary` — deterministic anomaly summary
- `mcp__avni-bundle__bundle_export_to_path` — path-jailed ZIP export

These give atomicity + auditability for free.

### 6. The lockfile is committed

`package-lock.json` is in the repo. Don't delete it. The SDK depends on `@anthropic-ai/claude-agent-sdk` which ships native binaries — pinning matters.

### 7. Tool name freeze (in-process MCP)

The four MCP tools' **fully-qualified names MUST NOT be renamed**:

- `mcp__avni-bundle__bundle_validator_run`
- `mcp__avni-bundle__bundle_find_concept`
- `mcp__avni-bundle__bundle_summary`
- `mcp__avni-bundle__bundle_export_to_path`

These strings appear verbatim in every persisted `transcript.jsonl` and `steps.jsonl` across every session ever run. Renaming silently breaks replay, audit grep, and analytics. The frozen constants live in `src/agents/bundle-mcp-tool-names.js` (`Object.freeze`); new tools get NEW names, never repurposed.

### 8. Code-enforced rules vs prompt rules

The active rules block (in `src/agent.js`) is the slim `BUNDLE_OUTCOME_CONTRACT` — guidance injected into the agent's system prompt, stating the required end-state. It became the default in story #11; the full legacy `BUNDLE_HARD_RULES` prose is kept behind the `SDK_LEGACY_RULES=1` backout (see `activeRulesBlock()`). Crucially, every invariant either block describes is ALSO enforced by code, independent of prompt drift — the prose is now a thin layer over deterministic gates:

| Rule intent | Code that enforces it |
|---|---|
| No destructive shell (git writes, `rm -rf`, `sudo`) | PreToolUse Bash hook in `src/agent.js` |
| No out-of-scope file mutations per turn | `src/security/post-turn-detector.js` — diffs working tree post-turn, reverts violations, rejects the turn |
| `formElement.concept` shape + `addressLevelType` name chars (server rejects, validator doesn't) | `bundle_integrity_check` (FE_CONCEPT_NOT_OBJECT + ALT_INVALID_NAME) |
| Dangling UUID refs / FK coherence | yaml-driven bundle graph + validator |
| C3/D1 case-insensitive concept-name collisions | concept-collision interceptor + `bundle_find_concept` |
| ZIP export must land inside an allowlisted path | Path-jail in `src/agents/bundle-mcp-server.js` (`bundle_export_to_path`) — allowlist: `~/Desktop`, `~/Downloads`, `~/Documents`, `~/.avni-skills-sdk/exports`, `$SDK_EXPORT_DIR` |
| No concurrent writes to the same session | Per-session async mutex in `src/locks.js` |
| Inbound traffic capped | Per-IP rate-limit middleware in `src/middleware/rate-limit.js` |

When you add a new rule: if it is safety-critical, write the code-enforcement first and link it from the outcome contract. Prompt-only rules are documentation of intent, not guarantees.

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

### Resume a previous session

Sessions persist at `~/.avni-skills-sdk/sessions/<sid>/` (override with `SDK_SESSIONS_DIR`). Each session dir contains: the `bundle/` git repo, `meta.json`, `transcript.jsonl`, `steps.jsonl`, `cost.jsonl`. To pick up where you left off:

```bash
npm run cli -- --resume sess_xxxxxxxxxxxxxxxx
```

No forms/modelling args needed — the bundle is already on disk. The CLI re-attaches via `GET /v1/sessions/:id`, shows the current turn count, and the REPL works normally. Wallet totals hydrate from `cost.jsonl` so the hard-cap circuit breaker can't be bypassed by restarting. `:transcript` / `:steps` / `:cost` REPL commands tail each JSONL file.

### Prune old sessions

```bash
# safe — show what would be removed, touch nothing
node scripts/prune-sessions.mjs --older-than 30 --dry-run

# actually delete sessions older than 30 days
node scripts/prune-sessions.mjs --older-than 30
```

The script reads from `SDK_SESSIONS_DIR` (default `~/.avni-skills-sdk/sessions/`) and refuses to run without `--older-than`. Audit lines go through `src/logging.js`.

### Run the real-LLM eval harness

```bash
export ANTHROPIC_API_KEY='sk-ant-...'
export SDK_EVAL_BUDGET_USD=5   # required — harness aborts past this
npm run eval
```

`tests/eval/` is gated on both env vars so it can never accidentally burn tokens in CI. Cost: ~$1–3 per full sweep against Haiku 4.5.

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
| 3 | Workspace persistence — sessions, git-per-turn, diff, revert, ZIP, org-agnostic invariants harness | ✅ 2026-05-05 15:17 IST |
| 4 | Real Claude integration on `/v1/sessions/:id/messages` — agent edits in `<session>/bundle/`, server `git add -A && git commit` after the SSE stream ends. Per-session skill staging + `.gitignore` for `.claude/`. Dryrun (L8) green. | ✅ 2026-05-05 16:20 IST |
| 5 | Token-cost wallet (in-memory + persisted cost.jsonl, hard cap $5/session, mid-turn abort, restart-safe via disk hydrate) | ✅ 2026-05-18 IST |
| 5a | Durable session storage (default `~/.avni-skills-sdk/sessions/`, override via `SDK_SESSIONS_DIR`), `--resume <sid>` CLI flag, JSONL `transcript.jsonl` (Claude-Code-style conversation memory), JSONL `steps.jsonl` (operational log: validator/workflow/agent-turn/commit with durations + status), endpoints `GET /v1/sessions/:id/{transcript,steps,cost}`, REPL commands `:transcript / :steps / :cost`. 193 tests pass. | ✅ 2026-05-18 IST |
| 6 | Avni admin upload integration via MCP | TODO |
| 7 | UI inside Avni SaaS, Avni SSO | TODO |
| 8 | Skill eval harness | TODO |

If you're picking up Phase 5 (wallet), the sketch is open: caller's per-key spend tracked server-side, soft cap before agent dispatch, hard cap mid-stream. Read `src/server.js`'s `/v1/sessions/:id/messages` for where to hook the meter — the `usage` blocks come through in the agent SSE events.

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
| "Caller getting HTTP 429 / rate-limit-exceeded" | Per-IP middleware cap hit | `src/middleware/rate-limit.js` — tune the bucket; logs go through `src/logging.js` |
| "`prune-sessions` removed a session I wanted" / wrong dir purged | Misconfigured `SDK_SESSIONS_DIR` or forgotten `--dry-run` | `src/session-prune.js` + `scripts/prune-sessions.mjs` — audit log records every deletion |
| "Turn rejected / files reverted that the agent legitimately needed to touch" | Post-turn unauthorized-mutation detector flagged it | `src/security/post-turn-detector.js` — extend the allowlist; do NOT silently disable |

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
