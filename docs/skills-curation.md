# Skills curation for the bundle-authoring agent

**Shipped 2026-05-22 IST (Phase 6a) · WS4 · 8/17 skills active for `/messages`**

The bundle-authoring agent (the one driving `/v1/sessions/:id/messages`) used to load **all 17** skills it could find in `avni-skills/` + `avni-skills-sdk/skills/`. Many of those skills are off-topic for bundle authoring — they're for post-launch debugging, mobile device QA, support tickets, metabase reports. Loading them inflates the agent's per-turn cache_creation_input_tokens without adding signal.

This audit reduces the agent's exposed skill set to the **8 load-bearing skills**. The other 9 stay in the brain (still readable via `GET /v1/skills/:slug`) — just not pre-loaded into the agent's context.

## The kept 8

| Skill | Why it's load-bearing |
|---|---|
| `srs-bundle-generator` (brain) | The canonical deterministic generator + validator. Every bundle edit touches its conventions. |
| `backend-architecture` (brain) | AVNI server's entity model, observation format, ETL. Needed for any cross-entity reasoning. |
| `product-codebase` (brain) | rules-config API reference. Cited by every rule-authoring task. |
| `architecture-patterns` (brain) | Design patterns from official analysis. Agent consults this when proposing structural fixes. |
| `implementation-engineer` (brain) | Form configuration + JS rule patterns + impl playbook. |
| `project-scoping` (brain) | SRS → AVNI mapping workflow. Cited during the YAML-spec drafting phase. |
| `product-knowledge` (brain) | Codebase feasibility checks — "does AVNI support X?" The agent reads this before promising features. |
| `rules-author` (sdk-local) | Canonical rule body shapes for the 5 rule types (validation/decision/visitSchedule/eligibility/skipLogic). |

## The dropped 9

These remain accessible via `/v1/skills/:slug` and the SDK's `Skill` tool — they're just not in the agent's allowed-skills set during bundle-authoring turns.

| Skill | Why dropped |
|---|---|
| `mobile-testing` | Device + bundle QA on Android. Not the agent's job; happens post-bundle. |
| `support-engineer` | Post-launch debugging from 90k+ support tickets. Different agent should handle this. |
| `support-patterns` | Same: support workflow, not authoring. |
| `metabase-reports` | Reporting layer. Touches AVNI bundles only via dashboards, not entities. |
| `data-migration` | CSV-based bulk imports/corrections. Different verb (import vs author). |
| `go-live-checklist` | Production launch procedures. The agent helps build the bundle, not ship it. |
| `org-setup` | Organisation provisioning, users, catchments. Pre-bundle work. |
| `field-implementation` | Field-team operations playbook. Post-bundle. |
| `console-prompt` | Internal AVNI server console prompt template. Not user-facing. |

## How to revisit

If a real bundle-authoring task starts citing a dropped skill (you'll see the agent's `tool_use` events trying to access it via the `Skill` tool), promote it back into `LOAD_BEARING_BUNDLE_SKILLS` in `src/skills.js`. The curation test (`tests/entities/skills-curation.test.cjs`) will fail until you do — that test is intentionally rigid so the set doesn't drift by accident.

To audit empirically: scan a session's `transcript.jsonl` for `tool_use` events where `tool: "Skill"` and bucket by `skill: <slug>`. Skills with zero hits over a representative sample are safe to drop.

## What this does NOT do

- It does NOT delete any skills from disk. Every skill remains in `avni-skills/` and is accessible via the read APIs.
- It does NOT change the `/v1/agent/query` flow (the one-shot agent, not the session agent). That still loads all skills — it's a general-purpose endpoint.
- It does NOT touch the `Skill` tool. The agent can still call `Skill` to read any of the 17 — including the dropped ones — if a turn truly needs them. The drop only affects what's pre-loaded into the system prompt's `skills:` config.

## Expected impact

Token drop on a representative turn: ~30-50% reduction in `cache_creation_input_tokens` (the per-turn cache prefill). Wallet cost per turn drops proportionally. End-to-end latency drops ~5-10% (fewer skill manifests to evaluate when the agent decides what to consult).
