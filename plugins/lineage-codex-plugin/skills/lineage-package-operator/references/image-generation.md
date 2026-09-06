# Output targets and image generation

Use these commands as needed; the ordered sequence below applies to
node-target-driven generation.

```bash
lineage-stable output-targets list --profile "$LINEAGE_PROD_PROFILE" --media image --json
lineage-stable output-targets resolve --profile "$LINEAGE_PROD_PROFILE" --query "Instagram Feed portrait" --json
lineage-stable output-targets defaults --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --json
lineage-stable selection packet --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --schema v3 --json
lineage-stable output-targets node get --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --node <node-id> --json
lineage-stable output-targets node set --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --node <node-id> --destination instagram.story --confirm-write --json
lineage-stable output-targets node replace --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --node <node-id> --expected-revision <revision> --destination instagram.feed_portrait --confirm-write --json
lineage-stable output-targets node clear --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --node <node-id> --expected-revision <revision> --confirm-write --json
lineage-stable generate image plan --profile "$LINEAGE_PROD_PROFILE" --project demo-project --prompt "Create two variations" --from-lineage-selection --count 2 --json
lineage-stable generate image plan --profile "$LINEAGE_PROD_PROFILE" --project demo-project --prompt "Create locked variants" --from-lineage-selection --destination instagram.feed_portrait --destination instagram.story --variants-per-target 2 --json
lineage-stable generate image plan --profile "$LINEAGE_PROD_PROFILE" --project demo-project --prompt "Create persisted node variants" --from-lineage-selection --from-node-targets --expected-target-resolution-digest <selection-v3-digest> --variants-per-target 2 --json
lineage-stable generate image cancel --profile "$LINEAGE_PROD_PROFILE" --project demo-project --job-id <job-id> --confirm-write --json
lineage-stable generate image scaffold --profile "$LINEAGE_PROD_PROFILE" --project demo-project --job-id <job-id> --format png --confirm-write --json
lineage-stable generate image import --profile "$LINEAGE_PROD_PROFILE" --project demo-project --job-id <job-id> --manifest .asset-scratch/generation/<job-id>/generation-output-manifest.json --confirm-write --json
```

For a node-target-driven generation, use this exact agent sequence:

1. Read `selection packet --schema v3` and inspect every selected asset's
   separate `current_geometry` and `next_output_targets`. The packet's
   `selected_source_resolution_digest_sha256` covers every selected source.
2. If a requested platform is ambiguous, run `output-targets resolve` and ask
   the user to choose a surface unless the conversation already specifies one.
   Never guess a surface.
3. If a node is unresolved, use `output-targets node set` only after explicit
   target intent. If an existing sticky lock conflicts with the request,
   only the distinct `node replace --expected-revision` operation may change it,
   and only with explicit user approval. An existing explicit request to replace
   that lock with the specified target is sufficient; do not ask again. Ask
   when replacement intent is absent. Never mutate canvas defaults.
4. Persist `generate image plan --from-node-targets
   --expected-target-resolution-digest <packet-digest>` before invoking any
   provider. Variation count is job-time intent.
5. Run `generate image scaffold --job-id <job-id> [--format
   png|jpeg|webp] --confirm-write --profile <profile> --project <project>
   --json`.
6. Read each returned output index, absolute path, width, height, target group,
   variant, and digest. The scaffold creates only
   `.asset-scratch/generation/<job-id>/generation-output-manifest.json`; require
   every reported image destination to remain absent.
7. Invoke image generation outside Lineage for each slot at exactly its stored
   width and height. Do not infer a surface, substitute provider-native
   geometry, resize, or crop.
8. Copy each generated file to its returned absolute path only after
   `test ! -e "$OUTPUT_ABSOLUTE_PATH"`. Stop on any collision.
9. Edit only each empty `edge_summary` to a distinct one- or two-word
   description. Scaffolding already changed only `file_path`; do not change
   parent, group, variant, output specification, or digest.
10. Import the job-scoped manifest with the unchanged `generate image import
   --confirm-write` command, then inspect the imported job and actual decoded
   dimensions.

Scaffolding is provider-neutral, deterministic, atomic, scratch-confined, and
no-clobber. It does not create placeholder images. It refuses legacy/unlocked,
re-roll, imported, unsafe-ID, unsupported-format, missing-spec, escaping,
existing, and partial-collision cases. Do not combine manifest input with
legacy `--files` or `--parent-files`. Discover output targets instead of memorizing
platform sizes. A platform-only resolution is a clarification request, never
permission to choose a surface. One-source target flags may use
`--destination`, `--custom-dimensions`, `--separate-destination`, and
`--variants-per-target`; multiple selected sources require `--target-map`.
Target-aware plans reject legacy count flags. `output-targets defaults` is
read-only: agents and CLI workflows must never mutate canvas defaults. Node
settings contain geometry and provenance only; counts remain job-time intent.
Cancel an abandoned planned job explicitly and never generate after cancellation.
