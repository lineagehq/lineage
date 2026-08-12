---
title: Integration overview and maturity
description: Understand generic Lineage capabilities, current providers, and what each maturity label promises.
currentProviders:
  - Amazon S3
  - Buffer
  - Codex handoff
providerIds:
  - s3
  - buffer
  - codex-handoff
---

## Maturity labels

- **Available** means the documented workflow is supported in a released
  package.
- **Preview** means the workflow is usable within explicit limitations.
- **Planned** describes product direction, not current behavior.

| Capability | Current provider | Maturity | Important boundary |
| --- | --- | --- | --- |
| Cloud storage | Amazon S3 | Available | Configuration and writes are explicit |
| Social scheduling | Buffer | Preview | Release 1 channel sync and local composition only; live scheduling is unavailable |
| Image generation | Codex handoff | Available | Handoff and import receipts; no embedded model |

Provider credentials and project configuration are never stored in the public
capability catalog.
