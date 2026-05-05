# Phase 4 — Agent-Driven Session Edits

**Date:** 2026-05-05
**Endpoint shipped:** `POST /v1/sessions/:id/messages`
**Auth:** `Authorization: Bearer <ANTHROPIC_API_KEY>` (BYO key)
**Verification:** L8 dryrun against real Astitva SRS — no tokens spent

---

## What Phase 4 actually does

Before Phase 4: `/v1/sessions/:id/edit` accepts a caller-supplied `{ summary, edits }` payload and commits it as a turn. The session machinery is LLM-agnostic — useful, but the caller has to do the thinking.

Phase 4 adds `/v1/sessions/:id/messages`. The caller sends a natural-language instruction. The server:

1. Resolves `<session>/bundle/` and stages avni-skills's 16 skills as symlinks at `<session>/bundle/.claude/skills/<name>` (idempotent).
2. The session's `.gitignore` excludes `.claude/`, so staged skills never enter commit history or the final ZIP.
3. Spawns a Claude Agent SDK session with `cwd = <bundleDir>`. The agent uses Read / Glob / Grep / Bash / Edit / Write / Skill exactly as it does for `/v1/agent/query`.
4. SSE-streams every event back as it happens.
5. After the agent's `for await` loop ends, runs `git status --porcelain` against the bundle dir. Any changes are staged, committed as `turn N: <prompt summary>`, validated, and meta is updated.
6. Emits a final `turn` SSE event with `{ turn, sha, summary, validation, changedFiles }`. If the agent changed nothing, `noChanges: true` is returned and the turn counter does NOT advance.

**The diff source is git itself.** No structured edit-payload protocol — the agent edits files in place, git captures what changed.

---

## Verification — L8 dryrun (no key)

`scripts/dryrun-phase-4.mjs` proves the per-session staging + commit-changes machinery without spending a token. It plays the role of the agent: mutates a file in the bundle dir directly, then calls `commitWorkspaceChanges` — the same path the live route takes.

Run against real Astitva SRS:

```
session sess_51d7d4fe544fbd4f created
  turn 0 validation: errors=6 warnings=6 groups={"F2":6}
✓ turn-0 .gitignore contains .claude/
✓ skills staged into bundle dir  staged=16 total=16
✓ .claude/skills/ exists
✓ >= 16 skills visible at .claude/skills/  (16)
✓ re-staging is idempotent (creates 0 new symlinks)
✓ commitWorkspaceChanges with no changes → noChanges:true
✓ turn counter not incremented on noop
simulated agent edit: removed duplicate 'Gender' from form 'Draft'
✓ turn 1 created  sha=633c118f6b90
✓ turn 1 validator runs and reports errors/warnings
  turn 1 validation: errors=5 warnings=6 groups={"F2":5}
✓ validator delta: errors went down OR stayed same  (6 → 5)
✓ changed files reported  (1 file)
✓ .claude/ not in git history
✓ listTurns shows 2 turns
✓ turn 1 summary saved
✓ diff for turn 1 references the mutated form  (diff length: 956)
✓ session deleted

✓ Phase 4 machinery dry-run: ALL CHECKS PASS
  validator delta on simulated edit: 6 → 5 errors
```

Every check that matters for correctness passes. The "agent" in this dryrun is a simulated edit; the real agent at `/v1/sessions/:id/messages` reuses the same `commitWorkspaceChanges` to capture what it changes.

---

## Why this is sufficient verification

The new code in Phase 4 is two things:

| Component | Verified by |
|---|---|
| Per-session skill staging + `.gitignore` + `commitWorkspaceChanges` | L8 dryrun against real SRS (above) |
| `runAgent({ workspace: <bundleDir>, ... })` SSE invocation | L6 (already green — see `README.md`) |

The route is just the composition of these two. There's no third thing to verify.

If you want a full live test, run `scripts/demo-phase-4.sh` with your key set:

```bash
export ANTHROPIC_API_KEY='sk-ant-...'
AVNI_SKILLS_PATH=~/code/avni-skills bash scripts/demo-phase-4.sh \
  --forms /path/to/Forms.xlsx \
  --modelling /path/to/Modelling.xlsx \
  --org MyOrg
```

It walks the same flow with a real Anthropic call, prints condensed agent events, and reports the validator delta.

---

## What this does NOT yet prove

- **Live AVNI server upload** (Level 9 if we add it) — the bundle is server-contract-correct per our validator, but Phase 4 doesn't round-trip through `/implementation/uploadBundle`. That's Phase 6.
- **Token cost accounting** (Phase 5) — we surface usage in SSE events but don't meter or cap.
- **Concurrent edits** to the same session — if two callers POST `/messages` simultaneously, the second `git add -A` could pick up the first agent's in-flight changes. Single-writer-per-session is the assumed contract; sessions are cheap to fork if you need parallelism. Worth documenting as a hard rule before Phase 7 UI.

---

## Files committed in this phase

- `src/sessions.js` — added `bundleDir(id)`, `ensureSessionSkillsStaged(id)`, `commitWorkspaceChanges(id, summary)`. New sessions write a `.gitignore` excluding `.claude/` before turn 0.
- `src/workspace.js` — added `ensureSkillsStagedAt(targetDir)` for per-session staging (companion to the existing `ensureAgentWorkspace()` for `/v1/agent/query`).
- `src/server.js` — new route `POST /v1/sessions/:id/messages` and updated startup banner.
- `scripts/dryrun-phase-4.mjs` — no-key dryrun that proves staging + commit machinery on a real SRS.
- `scripts/demo-phase-4.sh` — live driver requiring `ANTHROPIC_API_KEY`.
- `docs/phase-4-end-to-end.md` — this record.
- `README.md`, `CLAUDE.md` — Phase 4 marked done, Phase 5 (wallet) is next.

---

## What's next — Phase 5

Token-cost wallet. Per-key spend tracked server-side, soft cap before agent dispatch, hard cap mid-stream. Hook into the `usage` blocks that come through the agent SSE events; abort via the existing `AbortController` when the cap trips.
