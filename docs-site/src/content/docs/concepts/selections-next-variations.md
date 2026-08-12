---
title: Selections and next variations
description: Turn human choices into explicit structured inputs for the next creative operation.
---

## What this does

Selections identify the asset or assets that should drive the next variation.
They let an agent retrieve the exact visual context chosen by a human instead
of inferring it from a chat message.

## How it works

Lineage stores selection state with the workspace and can produce a selection
packet containing parent asset identifiers, root context, campaign context, and
the exact prompt attached to each branch or re-roll. The same prompt is visible
on the node, editable in the Variation Queue, and available to agent tasks,
briefs, and generation handoffs. Multi-parent generation preserves an explicit
output-to-parent mapping.

A branch and a re-roll may be queued on the same node with different prompts.
If no prompt is supplied, the handoff explicitly tells the agent to ask what
should change before generating.

## Safety behavior

Inspect the current selection and its per-action prompts before planning
generation. Do not import outputs whose parent mapping is ambiguous. Do not
invent a missing prompt. Claimed or in-progress task prompts are locked against
conflicting Canvas edits. Successful imports can clear selection state when
configured so stale inputs are not reused accidentally.

Related: [Generate and import variations](../workflows/generate-import-variations).
