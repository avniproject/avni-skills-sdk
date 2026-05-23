---
name: AVNI Implementer Reference
description: Canonical AVNI implementer documentation — advanced features, how-to guides, sidebar docs, sample implementations, reporting, architecture. Distilled from avni-ai/dify/merged.md (drops case studies + end-user guide + faqs + general marketing).
version: 2026-05-23
---

# AVNI Implementer Reference

This skill bundles the **technical implementer's reference** vendored from
`avniproject/avni-ai/dify/merged.md` (branch `app-configurator-dev`).

The kept content covers four domains useful for bundle authoring:
1. **Advanced features** — auth, audit, draft-save, encryption, fast-sync,
   approval workflow, etc.
2. **How-to guides** — task-oriented (e.g. "how do I set up a worklist?")
3. **Basic features** — onboarding reference for new implementers
4. **Webapp / sidebar docs** — UI conventions referenced when authoring forms
5. **Sample implementations** — real-world patterns
6. **Reporting** — Metabase, ETL, dashboards
7. **Architecture + terminology** — entity model, definitions

**Dropped from upstream:** case studies (NGO field stories), End User Guide
(for app users not implementers), FAQs (vendor comparisons), general
marketing/roadmap, internal scripts/prompts.

Stats: kept **117** sections, dropped **36** sections
out of 153 total in upstream merged.md.

## Files

| File | Domain | Use when |
|---|---|---|
| [advanced-features.md](advanced-features.md) | advanced-feature-guide | authoring auth/audit/encryption/sync configs, debugging non-trivial features |
| [how-to.md](how-to.md) | how-do-i | a concrete task you've not done before — search here first |
| [basic-features.md](basic-features.md) | basic-feature-guide | onboarding or basic form-config questions |
| [webapp-docs.md](webapp-docs.md) | webapp sidebar | UI conventions, form widget options |
| [sample-implementations.md](sample-implementations.md) | sample bundles | real-world reference patterns |
| [reporting.md](reporting.md) | reporting / Metabase / ETL | reportCard / reportDashboard authoring |
| [architecture.md](architecture.md) | architecture / definitions | entity-model questions, terminology |

## How the agent should use this

Prefer **Read** of a specific supporting file (Glob `avni-implementer-reference/*.md`)
over loading the whole skill. The files are large — each is hundreds of KB
of reference content. Search for the section header (every chunk starts
with a `## \`<original path>\`` heading) to locate what you need without
reading whole files.
