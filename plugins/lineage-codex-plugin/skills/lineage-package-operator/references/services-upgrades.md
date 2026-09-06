# Services and stable upgrades

## Upgrade a stopped stable production profile

Stable package installation does not implicitly change an existing production
profile's runtime pin. Keep stop, upgrade/gate, and restart explicit:

```bash
make stop-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make upgrade-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make start-prod-bg LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make status-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
```

`make upgrade-prod` installs npm `latest`, runs
`lineage-stable runtime doctor --json`, confirms
`lineage-stable profile upgrade-runtime --profile "$LINEAGE_PROD_PROFILE" --confirm-write --json`,
then repeats runtime doctor, profile doctor, and `db info --profile`. It does
not stop or restart the service.

The executing verified stable package is the only target authority. Never pass
or invent a fingerprint, version, receipt, or code root. An active service,
preview/dev/unverified code, a downgrade, a same-version identity anomaly, or
an unhealthy profile must fail closed. After the gate, start with the matching
stable packaged service manager and require healthy managed status.

## Start and inspect services

From a checkout, use the profile-scoped managed targets:

```bash
make start-prod-bg LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make status-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make logs-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make stop-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
```

Use the equivalent preview/dev target and variable for those channels. Managed
start opens a browser only after exact runtime readiness. Treat nonzero status
as unsafe even if a PID, tmux session, launchd registration, or port exists.
Stable and preview Make targets must resolve `lineage-stable-service` or
`lineage-preview-service` from the matching attested runtime. Stop if either
published channel falls back to `node scripts/managed-service.mjs`; that
checkout controller is dev-only.

Use foreground packaged start only with an explicit profile:

```bash
lineage-stable start --profile "$LINEAGE_PROD_PROFILE" --open
```

Never recreate `start-local-prod` or an unprofiled background service.
