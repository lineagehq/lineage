# Read state and manage claims

Pass `--profile` on every operational command. Use the relevant commands:

```bash
lineage-stable next --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --json
lineage-stable brief --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --json
lineage-stable inspect --profile "$LINEAGE_PROD_PROFILE" --project demo-project --asset-id <asset-id> --json
lineage-stable agent claim --profile "$LINEAGE_PROD_PROFILE" --project demo-project --scope lineage_workspace --target <workspace-id> --agent-name "Codex task" --ttl 20m --json
lineage-stable agent heartbeat --profile "$LINEAGE_PROD_PROFILE" --claim-token "$LINEAGE_CLAIM_TOKEN" --json
lineage-stable link-child --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --child <child-id> --summary "Cleaner type" --claim-token "$LINEAGE_CLAIM_TOKEN" --confirm-write --json
lineage-stable agent release --profile "$LINEAGE_PROD_PROFILE" --claim-token "$LINEAGE_CLAIM_TOKEN" --json
```

Export the returned raw token as `LINEAGE_CLAIM_TOKEN`. Heartbeat while working,
pass the token to claim-scoped writes, and release it before handoff. Use
`link-child` only for a visible child variation, and supply a one- or two-word
`--summary` describing the change from parent to child. Use `reroll mark`, `reroll
plan`, and `reroll import` for a new attempt on the same node.
