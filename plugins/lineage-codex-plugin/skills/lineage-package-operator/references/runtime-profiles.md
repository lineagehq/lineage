# Runtime and profile identity

## Choose one channel

- Stable daily use: `lineage-stable` from the isolated npm `latest` runtime.
- Preview candidate: `lineage-preview` from the isolated npm `next` runtime.
- Development: `npm run lineage:dev --` from the intended checkout/worktree.

Stable resolves npm `latest` once into an isolated, receipt-bound code root;
preview resolves `next` into a different root. A published `lineage-dev` must
fail closed: dev is checkout-only.

Do not globally install `latest` and `next` into one prefix. Do not use `npx`, a
PATH-resolved `lineage-dev`, or checkout code for production operations.

Fresh-profile bootstrap exception: when the intended named profile does not
exist yet, run runtime doctor first, run the atomic `profile init --profile
<profile> --confirm-write --json`, and then immediately run runtime doctor,
profile doctor, and `db info --profile <profile> --json`. Do not run another
operational command or write until that post-init gate passes.

## Prove identity before work

Set the intended profile selector, then run the matching launcher:

```bash
lineage-stable runtime doctor --json
lineage-stable profile doctor --profile "$LINEAGE_PROD_PROFILE" --json
lineage-stable db info --profile "$LINEAGE_PROD_PROFILE" --json
```

Check the verified code root, origin, and fingerprint in runtime doctor and
the matching `code.root`, `code.fingerprint`, and `code.verified` fields in
runtime/database responses. Use `runtime info` only to diagnose an unverified
installation; it does not satisfy the gate.

Require all three results to agree on verified code origin/fingerprint, channel,
profile ID/environment/fingerprint, database path/identity, and service origin.
Stop on any failed doctor, unbound profile, wrong database, or unexpected code
root. Legacy-unbound access is diagnostic/read-only and never authorizes writes.
In offline `db info`, require `process.role` to be `command` and expect no
`service` object; that PID is only the one-shot CLI. A live managed status must
instead match its profile-scoped receipt to `/api/runtime`, where
`process.role` is `service` and `service.mode` is `managed`. Never treat either
field alone as health proof.

For preview, substitute `lineage-preview` and `$LINEAGE_PREVIEW_PROFILE`. For
dev, substitute `npm run lineage:dev --` and `$LINEAGE_DEV_PROFILE`.

## Repin intentional checkout changes

A normal checkout edit changes the verified dev fingerprint. Stop the managed
dev service before repinning; an active service owns the profile writer lease
and must make repin fail. From the exact intended checkout, run:

```bash
npm run lineage:dev -- profile repin-runtime \
  --profile "$LINEAGE_DEV_PROFILE" \
  --checkout-root "$PWD" \
  --confirm-write \
  --json
```

Or use `make repin-dev LINEAGE_DEV_PROFILE="$LINEAGE_DEV_PROFILE"`, which runs
runtime doctor, the confirmed repin, profile doctor, and profile-selected
database info in order. Repin is only for an owner-only development manifest
already marked `dev`/`checkout` and a verified checkout whose canonical root
matches `--checkout-root`. It changes only `expected_runtime`; never use or
adapt it for stable, preview, package code, a wrong checkout root, or a running
service. Stop on any refusal instead of editing the manifest by hand.
