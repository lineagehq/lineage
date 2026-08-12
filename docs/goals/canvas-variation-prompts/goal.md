# Canvas Variation Prompts and Codex Handoff

## Objective

Build an intuitive Canvas workflow that lets a user attach an exact restyling prompt when selecting a node for a branch or reroll, keeps that prompt persistently visible on the node, and makes the prompt available to profile-scoped Codex generation planning. Establish whether an explicit direct-send-to-Codex action is feasible and implement the safest coherent version that can be proven locally.

## Original Request

Start from a fresh worktree off GitHub main. For branch and reroll selections, let users enter, save, and review the exact restyling prompt on the Canvas node; make those prompts available when Codex returns to the session and when the user asks Codex to generate variations. Explore a direct Canvas-to-Codex path that could begin the work without manually opening the Codex app session.

## Intake Summary

- Input shape: `specific`
- Audience: Lineage users directing image variations from Canvas and Codex agents fulfilling those directions
- Authority: `requested`
- Proof type: `demo`
- Completion proof: A browser walkthrough and profile-scoped CLI/API proof show branch and reroll prompts can be entered, persisted, revisited on their nodes, and consumed by Codex generation planning; any direct-send behavior is explicit, safe, and truthfully bounded.
- Goal oracle: A fresh-profile end-to-end flow from Canvas selection plus prompt through reload and Codex-readable generation plan, with branch/reroll coverage and no mutation of the landing or walkthrough branches.
- Likely misfire: Shipping a beautiful text box whose value is browser-only, absent from the node/CLI handoff, or able to trigger opaque autonomous work without clear consent and runtime identity.
- Blind spots considered: prompt ownership across reroll attempts versus node branches, edit/clear semantics, empty prompts, stale selection state, narrow screens, profile/database identity, transport availability when Codex is closed, and safe user consent for direct dispatch.
- Existing plan facts: Preserve the two existing landing/walkthrough branches unchanged; branch fresh from current `origin/main`; reuse the existing selection and image-generation planning contracts rather than inventing a parallel handoff.

## Goal Oracle

The oracle for this goal is:

`On a verified checkout-dev profile, select branch and reroll targets in Canvas, enter distinct exact prompts, reload and inspect both nodes, then invoke the profile-scoped Codex/CLI generation-plan path and prove it returns the correct selections and prompts; if direct send is implemented, prove it requires an explicit user action and produces an inspectable handoff/job state.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`specific`

## Current Tranche

Trace the existing Canvas selection, persistence, server/CLI projection, and generation-plan flow; choose the smallest compatible data-model extension; implement the full branch/reroll prompt vertical slice; then add an explicit direct handoff only if the existing local service/Codex integration provides a safe, testable boundary.

## Non-Negotiable Constraints

- Work only in `/Users/neonwatty/.codex/worktrees/lineage-canvas-variation-prompts` on `codex/canvas-variation-prompts`, based directly on fresh `origin/main`.
- Do not modify, rebase, or merge the landing-page or Swissifier walkthrough branches.
- Persist prompt data in Lineage's profile-scoped source of truth; do not rely on browser-only storage.
- Keep branch and reroll semantics distinct and preserve compatibility for existing selections without prompts.
- Codex-facing reads and writes must remain profile-scoped and honor runtime, database, claim, and service identity gates.
- Direct dispatch, if feasible, must be initiated by a visible user action and leave an inspectable status; no hidden autonomous generation.
- Do not commit private media, credentials, customer content, real presigned URLs, or local SQLite databases.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete, or when all safe local prompt/persistence/handoff work is complete and direct dispatch is truthfully recorded as blocked on a product/transport decision that cannot be made locally.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. The preferred Worker package is a vertical slice across the existing storage, API/CLI projection, Canvas interaction, tests, and browser proof—not a series of disconnected helpers.

## Board Health

The PM owns board health. Machine truth lives in `docs/goals/canvas-variation-prompts/state.yaml`.

## Canonical Board

`docs/goals/canvas-variation-prompts/state.yaml`

## Run Command

```text
/goal Follow docs/goals/canvas-variation-prompts/goal.md.
```

## PM Loop

Follow the GoalBuddy `/goal` execution contract, work only on the active task, record receipts, keep one write-capable task active, run the full oracle at phase/final boundaries, and complete only through a final audit with `full_outcome_complete: true`.
