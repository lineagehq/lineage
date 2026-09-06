# Cloning and legacy migration

## Create non-production test data

Never copy a live SQLite file directly. Define a new preview/development target
profile, pin it to the verified target code, and use:

```bash
lineage-preview profile clone --source-db /path/to/source.sqlite --target-profile "$LINEAGE_PREVIEW_PROFILE" --confirm-write --json
```

A stable database may be the intentional read-only clone source. The target
must be a new non-production profile; never operate preview/dev against the
source stable database.

Clone must target a nonexistent non-production database and produce a new
profile identity and receipt. Bind a legacy database in place only as an
intentional migration with `profile bind --profile <profile> --confirm-write`.

When that legacy database references media in a checkout, keep the database and
source checkout read-only and stage only its referenced files into the target
profile's nonexistent asset root:

```bash
lineage-stable profile clone-assets --source-asset-root /path/to/legacy/checkout --target-profile "$LINEAGE_PROD_PROFILE" --confirm-write --json
```

Require a no-clobber receipt, matching file hashes, owner-only permissions, and
an explicitly reviewed missing-reference count before binding or service
cutover. Never copy the whole checkout scratch tree or reuse it as production's
asset root.
