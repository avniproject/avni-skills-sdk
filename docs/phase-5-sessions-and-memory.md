# Phase 5 — Durable sessions, conversation memory, and per-session cost

**Shipped 2026-05-18 IST · 193/193 tests · authored by Samanvay**

This doc is for teammates picking up the codebase. It explains what landed in Phase 5 + 5a, *why* the design is shaped this way, and how to navigate the new surface. If you're hitting a bug, jump to [Pitfalls](#9-common-pitfalls).

---

## Table of contents

1. [The problem we were solving](#1-the-problem-we-were-solving)
2. [The shape of a session on disk](#2-the-shape-of-a-session-on-disk)
3. [Lifecycle — create, edit, resume](#3-lifecycle--create-edit-resume)
4. [Four memory surfaces — and why each one exists](#4-four-memory-surfaces--and-why-each-one-exists)
5. [HTTP API surface](#5-http-api-surface)
6. [CLI surface](#6-cli-surface)
7. [The agent contract — add/edit is NOT a command](#7-the-agent-contract--addedit-is-not-a-command)
8. [Wallet — three circuit breakers, one ledger](#8-wallet--three-circuit-breakers-one-ledger)
9. [Common pitfalls](#9-common-pitfalls)
10. [Test coverage](#10-test-coverage)

---

## 1. The problem we were solving

Phase 4 shipped real-agent edits via `POST /v1/sessions/:id/messages`. The session machinery worked, validator deltas were tracked, costs were metered. But the **session itself was ephemeral** in two distinct, dangerous ways:

```
                    Phase 4 reality (broken)               Phase 5 reality (fixed)
                    ─────────────────────────              ─────────────────────────
Session storage:    $TMPDIR/avni-sdk-sessions/  ❌         ~/.avni-skills-sdk/sessions/  ✅
                    (macOS purges on reboot,               (durable; survives reboot,
                     temp-cleanup daemons wipe              cleanups, $TMPDIR resets)
                     it asynchronously)

CLI invocation:     `npm run cli -- --forms x.xlsx`  ❌    `--resume <sid>`  ✅
                    every run = NEW session via             attaches to existing
                    Stage 1 generator → agent edits         session, bundle + git
                    from the prior session never seen       history intact, resumes
                    in the new one                          mid-conversation

Wallet:             in-memory only  ❌                     in-memory + cost.jsonl  ✅
                    process restart zeroed totals →        cap survives restart →
                    user could bypass the $5/session       no bypass possible
                    hard cap by re-launching the CLI

Conversation:       lost on exit  ❌                       transcript.jsonl  ✅
                    git commits captured FILESYSTEM         every user msg, every
                    diffs but NOT the user's words          agent turn, every
                    or the agent's reasoning trail          tool call is replayable
```

A real user run made this visible: an agent added a `Volunteer` subject type in one session, the user quit, came back the next day with a fresh `npm run cli`, and the bundle was missing the subject type. Stage 1 had regenerated everything from the Excel files. From the user's perspective: silent data loss.

The cut: **persist everything load-bearing to disk, expose explicit resume, mirror Claude Code's JSONL transcript model.**

---

## 2. The shape of a session on disk

Every session is a single directory. One session = one organization's bundle in flight.

```
~/.avni-skills-sdk/sessions/sess_8c183339758df0c6/
│
├── input/                          ← original SRS uploads (frozen at turn 0)
│   ├── forms.xlsx
│   └── modelling.xlsx              ← optional
│
├── bundle/                         ← THE working bundle. A git repo.
│   ├── .git/                       ← every turn = one commit (see §3)
│   ├── .gitignore                  ← excludes .claude/ (skill staging)
│   ├── .claude/skills/             ← symlinked AVNI knowledge base
│   │                                 (not committed, agent reads from here)
│   ├── concepts.json
│   ├── subjectTypes.json
│   ├── programs.json
│   ├── encounterTypes.json
│   ├── formMappings.json
│   ├── operationalSubjectTypes.json
│   ├── operationalPrograms.json
│   ├── operationalEncounterTypes.json
│   ├── organisationConfig.json
│   ├── addressLevelTypes.json
│   ├── groups.json
│   ├── groupPrivilege.json
│   └── forms/
│       └── <FormName>_<uuid>.json
│
├── meta.json                       ← {sessionId, org, currentTurn, validationAtCurrent, ...}
├── transcript.jsonl                ← Claude-Code-style conversation memory
├── steps.jsonl                     ← operational log: validator runs, agent turns, commits
└── cost.jsonl                      ← per-turn USD + tokens; hydrates wallet on resume
```

**Why a git repo inside the session dir?** Because every agent turn produces a filesystem diff, and `git` already has the perfect data model for "a sequence of named, reversible state mutations." We get free diff/revert/rebase semantics, free SHAs for each turn, and the validator state is captured per-commit in the commit message. We are NOT trying to be Subversion — we're using git as a turn ledger. See `src/sessions.js` for the public API (`commitTurn`, `diffTurn`, `revertToTurn`, `listTurns`).

**Why JSONL for the other three?** Append-only, line-by-line parseable, no schema migrations needed, survives partial writes, trivially `tail -f`-able for debugging. Three separate files because they have three separate readers and three separate access patterns (see §4).

---

## 3. Lifecycle — create, edit, resume

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  CREATE          │      │  EDIT (loop)     │      │  RESUME          │
└──────────────────┘      └──────────────────┘      └──────────────────┘

  npm run cli --                npm run cli --              npm run cli --
    --forms x.xlsx                (continuing the             --resume sess_xxx
    --modelling y.xlsx             same REPL session)
    --org "Durga"                                          GET /v1/sessions/:id
       │                            you ›  fix the F2          │ → meta.json
       ▼                            ─────                       │ → currentTurn=4
  POST /v1/sessions                   │                         │ → wallet hydrated
       │                              ▼                         │   from cost.jsonl
  sessions.createSession()       /v1/sessions/:id/messages       │
       │                              │                         ▼
       ├── Stage 1: generator         │ agent stream         re-attach to bundle/
       │   parses xlsx → JSON         │ ↳ Read/Edit/Write    git history intact
       ├── git init bundle/           │ ↳ tool_use events    transcript replayable
       ├── git commit turn 0          │                      $4.40 spent of $5
       ├── meta.json written          ▼
       ├── transcript: system event   commitWorkspaceChanges
       └── steps: session_create      ↳ git add -A
                                      ↳ git commit "turn N: ..."
                                      ↳ recordResult → wallet
                                      ↳ transcript: turn_commit
                                      ↳ steps: agent_turn (ok/aborted)
                                      ↳ cost.jsonl: append turn cost
```

Three things to internalize:

1. **Create is non-idempotent.** Calling `POST /v1/sessions` always spawns a NEW session id and runs Stage 1. There is no "find or create." If you want to continue editing, use resume.
2. **Edit is the only mutating verb.** `POST /v1/sessions/:id/edit` (Wizard-of-Oz, no LLM) and `POST /v1/sessions/:id/messages` (real agent) both end in `commitTurn` → one new git commit + one new line in each of transcript / steps / cost. The four files stay aligned by construction.
3. **Resume does NOT re-run Stage 1.** The xlsx files in `input/` are reference-only after turn 0. The bundle git history is canonical. This is intentional — Stage 1 is a one-shot deterministic transform of the SRS, not part of the agent loop.

---

## 4. Four memory surfaces — and why each one exists

We could have shoved everything into one log. We didn't. Each file has a distinct reader and a distinct semantic contract.

| File | Captures | Reader | Reset on... |
|---|---|---|---|
| `bundle/.git/` | Filesystem state at each turn | `git diff`, `:revert`, validator | `:revert <N>` |
| `transcript.jsonl` | What was *said* (user, agent, tools) | `:transcript`, `GET /transcript`, future replay UI | never (append-only) |
| `steps.jsonl` | What was *done* (durations, status, errors) | `:steps`, `GET /steps`, ops dashboards | never (append-only) |
| `cost.jsonl` | What was *spent* (USD, tokens, per turn) | `:cost`, wallet hydrator, hard-cap check | never (append-only); `POST /wallet/reset` raises cap, doesn't truncate |

### 4.1 `transcript.jsonl` — conversation memory

Event kinds (open set, kebab-case):

```jsonl
{"ts":"2026-05-18T13:01:02Z","kind":"system","action":"session_created","org":"Durga"}
{"ts":"2026-05-18T13:02:11Z","kind":"user_message","content":"fix the F2 errors","model":"haiku"}
{"ts":"2026-05-18T13:02:34Z","kind":"turn_commit","source":"agent","turn":1,"sha":"3a7f9c1b","summary":"fix the F2 errors","cost_usd":0.0421,"tokens":{"in":2840,"out":1102},"model":"claude-haiku-4-5-20251001","validation":{"valid":true,"errors":0,"warnings":2}}
{"ts":"2026-05-18T13:05:47Z","kind":"user_message","content":"add a Volunteer subject type"}
{"ts":"2026-05-18T13:06:30Z","kind":"turn_commit","source":"agent","turn":2,"sha":"e1d4ab02","summary":"add a Volunteer subject type","cost_usd":0.0181,"tokens":{"in":3210,"out":620}}
```

This is the same model Claude Code uses for its own conversation persistence. **The reader you should build first is `:transcript`** — it tails the last N events in human-readable form so a returning user can see "what did I ask, what did the agent do" without re-running anything.

Helpers: `src/transcript.js` exports `appendEvent`, `readTranscript`, `transcriptStats`, `transcriptPath`.

### 4.2 `steps.jsonl` — operational log

Distinct from the transcript because the questions you ask are different. Transcript answers "what did we say?"; steps answer "what ran, how long did it take, did it succeed?".

```jsonl
{"ts":"...","step_id":"a1b2c3d4e5f6","kind":"session_create","status":"ok","duration_ms":null,"meta":{"org":"Durga","errors":3}}
{"ts":"...","step_id":"f6e5d4c3b2a1","kind":"agent_turn","status":"ok","duration_ms":15432,"meta":{"turn":1,"model":"claude-haiku-4-5-20251001","cost_usd":0.0421,"events":18}}
{"ts":"...","step_id":"...","kind":"agent_turn","status":"aborted","duration_ms":8120,"meta":{"abortReason":"TURN_MAX_COST"}}
{"ts":"...","step_id":"...","kind":"workflow_run","status":"error","duration_ms":62,"meta":{"name":"add-form"},"error":"subjectType \"Cohort\" not in subjectTypes.json"}
```

Step kinds in use today: `session_create`, `agent_turn`, `commit`. The `wrap()` helper in `src/steplog.js` is the convenient way to add new ones — pass an async fn, get timing + status + error logging for free:

```js
const result = await steplog.wrap(sid, "workflow_run", async () => {
  return await runWorkflow(...);
}, { name: "add-form" });
```

### 4.3 `cost.jsonl` — wallet ledger

One line per `recordResult` call. Authoritative.

```jsonl
{"ts":"...","turnIndex":0,"usd":0.0421,"inputTokens":2840,"outputTokens":1102,"aborted":false,"abortReason":null,"endedAt":1747569754000}
{"ts":"...","turnIndex":1,"usd":0.0181,"inputTokens":3210,"outputTokens":620,"aborted":false,"abortReason":null,"endedAt":1747570092000}
```

On any `getWallet(sid)` or `startTurn(sid)` for a previously-unseen session, the in-memory ledger is **hydrated** from `cost.jsonl` (`src/wallet.js` `hydrateFromDisk`). This is the mechanism that makes the $5/session hard cap restart-safe. See §8.

---

## 5. HTTP API surface

```
                Session lifecycle
                ─────────────────
POST    /v1/sessions                       multipart: forms.xlsx[+modelling.xlsx,+org] → {sessionId, meta, validation}
GET     /v1/sessions                       list all session metas
GET     /v1/sessions/:id                   meta + file tree + validatorAtCurrent
GET     /v1/sessions/:id/files/<path>      read a bundle file
GET     /v1/sessions/:id/turns             list edit turns (each = git commit)
GET     /v1/sessions/:id/turns/:n/diff     unified diff for turn N
GET     /v1/sessions/:id/zip               packaged ZIP of current state
DELETE  /v1/sessions/:id                   cleanup
POST    /v1/sessions/:id/edit              Wizard-of-Oz: {summary, edits:{path:content}} → commit
POST    /v1/sessions/:id/messages          BYO Anthropic key (Bearer), SSE stream of agent events
POST    /v1/sessions/:id/revert            {to_turn} — hard-reset bundle to that turn

                Memory + observability  ← NEW in Phase 5a
                ──────────────────────
GET     /v1/sessions/:id/transcript        ?limit=N&kinds=user_message,turn_commit
GET     /v1/sessions/:id/steps             ?limit=N&kinds=agent_turn&status=error
GET     /v1/sessions/:id/cost              wallet snapshot (totals + remaining + caps)

                Wallet controls
                ───────────────
POST    /v1/sessions/:id/wallet/reset      bump hard cap by N×default (audit trail preserved)

                Rules / audits
                ──────────────
GET     /v1/sessions/:id/rules             every populated rule, classified by carrier + field
GET     /v1/sessions/:id/rules/validation  Layer-4 acorn-based validator (R1-R6)
PUT     /v1/sessions/:id/rules             {summary, updates:[{file,field,ir|js}]} → compile+commit
GET     /v1/sessions/:id/summary           deterministic anomaly detector (free)
POST    /v1/sessions/:id/evaluate          LLM semantic-gap audit (BYO key, ~$0.05–0.20)
```

---

## 6. CLI surface

`scripts/sdk-cli.mjs` is the REPL. Two ways to launch:

```bash
# New session
npm run cli -- --forms ./Forms.xlsx [--modelling ./Modelling.xlsx] [--org "MyOrg"]

# Resume — bundle + transcript + cost + steps all carry over
npm run cli -- --resume sess_8c183339758df0c6
```

Inside the REPL, free-text is sent to the agent (costs tokens). Commands prefixed with `:` are local (free):

```
:summary             deterministic bundle audit
:eval                LLM semantic audit (~$0.05–0.20)
:turns               list all turns
:diff [N]            diff for turn N (default = current)
:files / :read       inspect bundle files
:rules / :rulev      list / validate rules
:refs <q>            find every reference to a UUID or name
:rename <old> <new>  rewrite a UUID across the bundle (atomic workflow)
:add-form <spec>     atomic form insertion (deterministic shortcut)
:model haiku|sonnet  switch routing for next turn
:revert <N>          hard-reset to turn N
:zip [path]          download ZIP
:state               re-fetch session meta
:transcript [N]      tail conversation memory  ← NEW
:steps [N]           tail operational log      ← NEW
:cost                wallet snapshot           ← NEW
:quit                preserves session on disk (resume via --resume <sid>)
```

---

## 7. The agent contract — add/edit is NOT a command

When Phase 5a was being built, I added a `:add-subject-type` REPL command for symmetry with `:add-form`. The user pushed back: *"adding or editing anything should not be a command right? agent should add correctly and upsert and put that in bundle after doing diff."*

They were right. The agent is the universal interface. Special commands for every entity type don't scale and they confuse the mental model. So:

- **`scripts/workflows/add-subject-type.mjs`** ships and has 9 tests. It exists as a **deterministic primitive** the agent can invoke via `Bash` when atomicity matters, and it documents the canonical entry shape. It is NOT exposed as a REPL command.
- **`BUNDLE_HARD_RULES` rule #5** (in `src/agent.js`) was extended to teach the universal upsert pattern:

> **NAME UNIQUENESS + UPSERT (concepts AND every top-level entity):**
> When the user asks you to "add X" — a concept, a subject type, a program, an encounter type, a form — DO NOT blindly append. The flow is always: Read the target file → case-insensitive name lookup → if it exists, REUSE the UUID and update fields in place (upsert) → if it doesn't, append a new entry that matches the existing-entry shape verbatim (copy field names + defaults from a neighbour, don't invent). Then Edit/Write back. The server does the git diff + commit. You do not need a special command for this — Read + Edit is the path.

The takeaway for the team: **before adding a new workflow script with a `:command` shortcut, ask whether the agent could just do the same thing through Read+Edit.** Most of the time, yes. Workflow scripts are escape hatches for cases where determinism beats LLM cost (mass renames, schema-level migrations, atomic multi-file edits).

---

## 8. Wallet — three circuit breakers, one ledger

```
                Pre-dispatch                    Mid-stream                   Post-turn
                ────────────                    ──────────                   ─────────
                preDispatchCheck(sid)           meter.shouldAbort(           meter.recordResult(
                  - hydrate from cost.jsonl       events, costUsd)              {usd, tokens})
                  - if totalUsd >= cap →            ┌──────────────────┐         │
                    throw 402 WALLET_HARD_CAP      ▼                  │         ▼
                                                TURN_MAX_EVENTS   SESSION_HARD_   in-memory  + append
                                                (default 250)     CAP_MID_TURN    to cost.jsonl
                                                                  (cumulative
                                                TURN_MAX_COST     check across
                                                (default $1.00)   all turns)
```

Three independent caps, all configurable via env:

| Cap | Default | Env var | Fires when |
|---|---|---|---|
| `hardCapUsd` | $5.00 | `SDK_WALLET_HARD_CAP_USD` | Session has spent ≥ cap (pre-dispatch + mid-turn) |
| `turnMaxEvents` | 250 | `SDK_WALLET_TURN_MAX_EVENTS` | One turn has emitted > 250 SSE events (runaway loop guard) |
| `turnMaxCostUsd` | $1.00 | `SDK_WALLET_TURN_MAX_COST_USD` | One turn has spent > $1 (one bad prompt can't drain the budget) |

When a cap fires mid-stream, the AbortController fires, the agent stops, **whatever the agent already wrote to disk is still committed as a turn** (partial work is recorded), and the abortReason is in transcript + step + cost entries.

`POST /v1/sessions/:id/wallet/reset` does NOT truncate `cost.jsonl` — it raises the per-session cap so the audit trail is preserved.

---

## 9. Common pitfalls

**"My old session is gone."** If `sess_xxxx` was created before 2026-05-18, it lived in `$TMPDIR/avni-sdk-sessions/` and macOS may have purged it. The CLI's `guessBundlePath()` checks the new path first, falls back to `$TMPDIR`. If neither exists, the session is unrecoverable. The bundle ZIP from `:zip` is the only durable artifact for pre-Phase-5a sessions.

**"Wallet says I've spent $X but I haven't run anything."** Either (a) the session was previously used and `cost.jsonl` is hydrating correctly — this is the *feature*; or (b) `SDK_SESSIONS_DIR` is pointing at a stale directory from a prior test run. Check `echo $SDK_SESSIONS_DIR` in your shell.

**"transcript.jsonl is empty but I sent messages."** The transcript writer is wrapped in `try/catch` and logs to stderr (`console.warn`). It must not fail the agent path. Check the server logs (`/tmp/avni-sdk-cli-*.log`). The session dir must exist — if you're hitting the API for a session id that was deleted, you'll get warnings on every write.

**"The agent invented a UUID for the new subject type."** Rule #1 in `BUNDLE_HARD_RULES`. If you see short tokens like `c-cancel-reason-001`, the agent skipped its hard rules. Either the model is wrong (Haiku will sometimes do this on long edit chains — `:model sonnet`) or the system prompt isn't reaching the agent (check `src/server.js` line 593 onward).

**"`--resume` says 'session not found' for a sid I can see in `~/.avni-skills-sdk/sessions/`."** The server validates the session id shape (`/^sess_[0-9a-f]{16}$/`). Anything else is a 400/404. Also: meta.json must exist in the session dir — if it's missing, the session was corrupted (likely a Ctrl-C during create).

**"Tests pass locally but `cost.jsonl` isn't being written."** Check that the session dir actually exists on disk. `appendCostEntry` no-ops if the directory is missing (so unit tests with arbitrary session ids don't crash). This is intentional but easy to miss when chasing a bug.

---

## 10. Test coverage

```
                                  Phase 4 baseline  →  Phase 5+5a  =  Δ
src/                              ────────────────     ──────────     ──
  wallet.js                              7                  +4         11   wallet + persistence
  transcript.js (new)                    —                  +9          9   JSONL conversation memory
  steplog.js (new)                       —                  +6          6   structured op log
  sessions.js (modified)             (covered)               —      (covered)

scripts/workflows/
  add-subject-type.mjs (new)             —                  +9          9   atomic upsert primitive
                                                                       __
                                                                       28 new

End-to-end                                                              2   resume preserves state
                                                                            wallet accumulates across restarts

Pre-existing entity invariants (45+) ─────── unchanged ─────── 163

                                          TOTAL: 193/193 passing
```

To run:

```bash
AVNI_SKILLS_PATH=~/Developer/avni-skills npm test
```

The two newest files are the ones to read first if you're picking up:

- `tests/entities/e2e-resume-with-memory.test.cjs` — the end-to-end proof. Shows the full create → edit → quit → resume path with all four memory surfaces verified. If something regresses, this is the test that will tell you.
- `tests/entities/wallet-persist.test.cjs` — confirms the hard cap can't be bypassed by restart. Security-adjacent; don't loosen without thinking.

---

## Where to go next

| If you're picking up... | Start here |
|---|---|
| The CLI UX | `scripts/sdk-cli.mjs` — search for `RESUME_SID` and the new REPL commands |
| Server endpoints | `src/server.js` — the three new GET handlers are right after `/turns/:n/diff` |
| Memory model | `src/transcript.js` and `src/steplog.js` — both <120 LOC, read top-to-bottom |
| Wallet semantics | `src/wallet.js` — `hydrateFromDisk` and `appendCostEntry` are the new bits |
| Agent contract | `src/agent.js` — `BUNDLE_HARD_RULES` rule #5 is the upsert principle |
| The session model | `src/sessions.js` — unchanged semantics, just a durable storage default |

Phase 6 (Avni admin upload integration via MCP) is the next milestone. The session resume + cost ledger gives us a clean surface to bridge to a hosted version — sessions become tenant-scoped, but the on-disk shape stays the same. Don't break the JSONL contracts. The reader-tooling on top of them is going to matter more over time than the writers.

— Samanvay
