# Hermetic manual install dogfood

Use this runbook to exercise the public first-user journey without modifying an
existing Lineage runtime, profile, database, service, npm prefix, cache, or
Codex home. Use synthetic demo data only. Never place credentials, customer
content, private media, or a live SQLite database in the dogfood root.

Run one channel at a time. The primary public journey is `stable`; stop it and
finish its evidence before beginning a separate checkout-only `dev` journey.

## Prepare isolated roots

Create one owner-only temporary root:

```bash
DOGFOOD_ROOT="$(mktemp -d /tmp/lineage-manual-dogfood.XXXXXX)"
chmod 700 "$DOGFOOD_ROOT"

DOGFOOD_HOME="$DOGFOOD_ROOT/home"
DOGFOOD_NPM_PREFIX="$DOGFOOD_ROOT/npm-global"
DOGFOOD_NPM_CACHE="$DOGFOOD_ROOT/npm-cache"
DOGFOOD_RUNTIME_ROOT="$DOGFOOD_ROOT/runtimes"
DOGFOOD_PROFILE_ROOT="$DOGFOOD_ROOT/profiles"
DOGFOOD_SERVICE_ROOT="$DOGFOOD_ROOT/services"
DOGFOOD_CODEX_HOME="$DOGFOOD_ROOT/codex-home"
DOGFOOD_BASE_PATH="$PATH"
DOGFOOD_PROFILE="manual-stable"
DOGFOOD_PORT="5297"
DOGFOOD_ORIGIN="http://127.0.0.1:$DOGFOOD_PORT"

mkdir -p \
  "$DOGFOOD_HOME" \
  "$DOGFOOD_NPM_PREFIX" \
  "$DOGFOOD_NPM_CACHE" \
  "$DOGFOOD_RUNTIME_ROOT" \
  "$DOGFOOD_PROFILE_ROOT" \
  "$DOGFOOD_SERVICE_ROOT" \
  "$DOGFOOD_CODEX_HOME"
```

Keep isolation scoped to each child process instead of exporting it over the
maintainer's normal shell:

```bash
run_lineage_dogfood() {
  env \
    HOME="$DOGFOOD_HOME" \
    CODEX_HOME="$DOGFOOD_CODEX_HOME" \
    LINEAGE_RUNTIME_ROOT="$DOGFOOD_RUNTIME_ROOT" \
    LINEAGE_PROFILE_ROOT="$DOGFOOD_PROFILE_ROOT" \
    LINEAGE_SERVICE_ROOT="$DOGFOOD_SERVICE_ROOT" \
    npm_config_cache="$DOGFOOD_NPM_CACHE" \
    npm_config_prefix="$DOGFOOD_NPM_PREFIX" \
    PATH="$DOGFOOD_NPM_PREFIX/bin:$DOGFOOD_RUNTIME_ROOT/bin:$DOGFOOD_BASE_PATH" \
    "$@"
}
```

Confirm the chosen port is unused before profile initialization:

```bash
lsof -nP -iTCP:"$DOGFOOD_PORT" -sTCP:LISTEN
```

Choose another port if that prints a listener. The service origin becomes part
of the immutable profile identity.

## Install the published stable channel

Record the prerequisites and registry selection:

```bash
run_lineage_dogfood node --version
run_lineage_dogfood npm --version
run_lineage_dogfood npx --version
run_lineage_dogfood codex --version
run_lineage_dogfood npm view @mean-weasel/lineage dist-tags version engines --json
```

Install the same global bootstrap and isolated stable runtime documented in the
public first run:

```bash
run_lineage_dogfood npm install --global @mean-weasel/lineage@latest
run_lineage_dogfood lineage-channel install stable \
  --root "$DOGFOOD_RUNTIME_ROOT" \
  --shim-dir "$DOGFOOD_RUNTIME_ROOT/bin" \
  --json
run_lineage_dogfood lineage-stable runtime doctor --json
```

Require `stable`, `package`, `verified: true`, and code/receipt paths beneath
`$DOGFOOD_RUNTIME_ROOT`. Stop if the launcher resolves into a checkout or any
normal user data root.

## Initialize and gate the fresh profile

Fresh-profile bootstrap exception: profile doctor and `db info` cannot pass
before the profile exists. Runtime doctor is therefore the only pre-init
identity check. Initialize atomically, then immediately complete the full gate:

```bash
run_lineage_dogfood lineage-stable profile init \
  --profile "$DOGFOOD_PROFILE" \
  --service-origin "$DOGFOOD_ORIGIN" \
  --confirm-write \
  --json

run_lineage_dogfood lineage-stable runtime doctor --json
run_lineage_dogfood lineage-stable profile doctor \
  --profile "$DOGFOOD_PROFILE" \
  --json
run_lineage_dogfood lineage-stable db info \
  --profile "$DOGFOOD_PROFILE" \
  --json
```

Require the runtime fingerprint, profile ID/environment/fingerprint, database
identity, and service origin to agree. Database and media paths must remain
beneath `$DOGFOOD_PROFILE_ROOT`. Offline database information should report
`process.role: command` and no live service object.

Repeat `profile init` once as a negative check. It must refuse to overwrite the
existing profile and print reuse or profile doctor guidance.

## Exercise foreground startup and the app

Start the exact public foreground command:

```bash
run_lineage_dogfood lineage-stable start --profile "$DOGFOOD_PROFILE"
```

Open `$DOGFOOD_ORIGIN` in a browser. Record:

1. Runtime Settings show the exact stable package, profile, database, media
   root, and service origin from the gate.
2. **Load demo lineage** produces 10 nodes and 9 edges.
3. **Load rich image demo** produces 14 nodes, 13 edges, and 14 PNG previews.
4. No preview is broken and no stale empty-lineage message remains.
5. Browser console errors and terminal warnings are copied verbatim.
6. A screenshot contains only synthetic demo content and temporary paths.

Stop with Ctrl-C and confirm the port closes.

## Exercise managed lifecycle and CLI handoff

```bash
run_lineage_dogfood lineage-stable-service start \
  --channel stable \
  --profile "$DOGFOOD_PROFILE" \
  --json
run_lineage_dogfood lineage-stable-service status \
  --channel stable \
  --profile "$DOGFOOD_PROFILE" \
  --json
```

Require the managed receipt and `/api/runtime` to agree on the service instance,
code fingerprint, profile/database fingerprints, and origin. Repeat `start` and
require the same healthy instance. Confirm both demo workspaces survived the
foreground restart.

Use the rich-demo root returned by the app:

```bash
run_lineage_dogfood lineage-stable next \
  --profile "$DOGFOOD_PROFILE" \
  --project demo-project \
  --root "<rich-root-id>" \
  --json
run_lineage_dogfood lineage-stable brief \
  --profile "$DOGFOOD_PROFILE" \
  --project demo-project \
  --root "<rich-root-id>" \
  --json
```

Generated handoff commands must retain `lineage-stable` and the selected
temporary profile.

## Exercise the optional Codex plugin

Install and doctor only the temporary Codex home:

```bash
run_lineage_dogfood npx --yes \
  @mean-weasel/lineage-plugin-installer@latest \
  install \
  --channel latest \
  --codex-home "$DOGFOOD_CODEX_HOME" \
  --json
run_lineage_dogfood npx --yes \
  @mean-weasel/lineage-plugin-installer@latest \
  doctor \
  --channel latest \
  --codex-home "$DOGFOOD_CODEX_HOME" \
  --json
run_lineage_dogfood codex plugin list --json
```

Require `lineage-codex-plugin@lineage` at the exact installed Lineage version,
installed and enabled. Repeat installation once to prove safe reinstall, then
remove only the temporary registration:

```bash
run_lineage_dogfood codex plugin remove \
  lineage-codex-plugin@lineage \
  --json
run_lineage_dogfood codex plugin marketplace remove lineage --json
```

Do not restart a normal Codex desktop session against this temporary home.

## Stop, recheck, and clean up

```bash
run_lineage_dogfood lineage-stable-service stop \
  --channel stable \
  --profile "$DOGFOOD_PROFILE" \
  --json
run_lineage_dogfood lineage-stable profile doctor \
  --profile "$DOGFOOD_PROFILE" \
  --json
run_lineage_dogfood lineage-stable db info \
  --profile "$DOGFOOD_PROFILE" \
  --json
```

The origin must be unreachable after stop, while the offline profile and
database checks still pass. Preserve the root for inspection on any failure.
After a clean pass and sanitized report, remove only the validated target:

```bash
case "$DOGFOOD_ROOT" in
  /tmp/lineage-manual-dogfood.*)
    rm -rf -- "$DOGFOOD_ROOT"
    ;;
  *)
    echo "Refusing unexpected cleanup target: $DOGFOOD_ROOT"
    exit 1
    ;;
esac
```

## Separate source-development journey

Create a second temporary root with a different profile, service origin, npm
cache, and Codex home. Do not reuse the stable profile or database:

```bash
DEV_DOGFOOD_ROOT="$(mktemp -d /tmp/lineage-manual-dev-dogfood.XXXXXX)"
chmod 700 "$DEV_DOGFOOD_ROOT"

DEV_DOGFOOD_HOME="$DEV_DOGFOOD_ROOT/home"
DEV_DOGFOOD_NPM_CACHE="$DEV_DOGFOOD_ROOT/npm-cache"
DEV_DOGFOOD_RUNTIME_ROOT="$DEV_DOGFOOD_ROOT/runtimes"
DEV_DOGFOOD_PROFILE_ROOT="$DEV_DOGFOOD_ROOT/profiles"
DEV_DOGFOOD_SERVICE_ROOT="$DEV_DOGFOOD_ROOT/services"
DEV_DOGFOOD_CODEX_HOME="$DEV_DOGFOOD_ROOT/codex-home"
DEV_DOGFOOD_BASE_PATH="$PATH"
DEV_DOGFOOD_PROFILE="manual-development"
DEV_DOGFOOD_PORT="5298"
DEV_DOGFOOD_ORIGIN="http://127.0.0.1:$DEV_DOGFOOD_PORT"

mkdir -p \
  "$DEV_DOGFOOD_HOME" \
  "$DEV_DOGFOOD_NPM_CACHE" \
  "$DEV_DOGFOOD_RUNTIME_ROOT" \
  "$DEV_DOGFOOD_PROFILE_ROOT" \
  "$DEV_DOGFOOD_SERVICE_ROOT" \
  "$DEV_DOGFOOD_CODEX_HOME"

run_lineage_dev_dogfood() {
  env \
    HOME="$DEV_DOGFOOD_HOME" \
    CODEX_HOME="$DEV_DOGFOOD_CODEX_HOME" \
    LINEAGE_RUNTIME_ROOT="$DEV_DOGFOOD_RUNTIME_ROOT" \
    LINEAGE_PROFILE_ROOT="$DEV_DOGFOOD_PROFILE_ROOT" \
    LINEAGE_SERVICE_ROOT="$DEV_DOGFOOD_SERVICE_ROOT" \
    npm_config_cache="$DEV_DOGFOOD_NPM_CACHE" \
    PATH="$DEV_DOGFOOD_HOME/.local/bin:$DEV_DOGFOOD_BASE_PATH" \
    "$@"
}
```

Confirm that `$DEV_DOGFOOD_PORT` is unused, choosing a different port if
necessary. Then perform every source command through the wrapper:

```bash
run_lineage_dev_dogfood git clone \
  https://github.com/lineagehq/lineage.git \
  "$DEV_DOGFOOD_ROOT/lineage"
cd "$DEV_DOGFOOD_ROOT/lineage"
run_lineage_dev_dogfood npm ci
run_lineage_dev_dogfood npm run lineage:dev -- runtime doctor --json
run_lineage_dev_dogfood npm run lineage:dev -- profile init \
  --profile "$DEV_DOGFOOD_PROFILE" \
  --service-origin "$DEV_DOGFOOD_ORIGIN" \
  --confirm-write \
  --json
run_lineage_dev_dogfood npm run lineage:dev -- runtime doctor --json
run_lineage_dev_dogfood npm run lineage:dev -- profile doctor \
  --profile "$DEV_DOGFOOD_PROFILE" \
  --json
run_lineage_dev_dogfood npm run lineage:dev -- db info \
  --profile "$DEV_DOGFOOD_PROFILE" \
  --json
run_lineage_dev_dogfood npm run dev -- --profile "$DEV_DOGFOOD_PROFILE"
```

Repeat the synthetic demo, restart, Settings, and CLI checks. Then stop the
foreground process and prove the bundled managed-development path:

```bash
run_lineage_dev_dogfood make install-dev
run_lineage_dev_dogfood npm run lineage:dev -- runtime doctor --json
run_lineage_dev_dogfood make start-dev-bg \
  LINEAGE_DEV_PROFILE="$DEV_DOGFOOD_PROFILE"
run_lineage_dev_dogfood make status-dev \
  LINEAGE_DEV_PROFILE="$DEV_DOGFOOD_PROFILE"
run_lineage_dev_dogfood make stop-dev \
  LINEAGE_DEV_PROFILE="$DEV_DOGFOOD_PROFILE"
```

The final evidence must identify `dev`, `checkout`, and the fresh clone's
canonical root and fingerprint. It must not match or open the stable database.
Preserve the temporary root on failure. After a clean pass, remove only the
guarded development target:

```bash
case "$DEV_DOGFOOD_ROOT" in
  /tmp/lineage-manual-dev-dogfood.*)
    rm -rf -- "$DEV_DOGFOOD_ROOT"
    ;;
  *)
    echo "Refusing unexpected cleanup target: $DEV_DOGFOOD_ROOT"
    exit 1
    ;;
esac
```
