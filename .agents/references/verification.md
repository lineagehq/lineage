# Verification by changed surface

Use focused checks while iterating. Run `npm run ci` before handoff for
meaningful implementation changes, including executable validation changes.
For file-only documentation changes, validate content and local references;
for skill changes, also verify routing, safety coverage, and plugin packaging.

A passing full gate satisfies its constituent checks. Rerun affected checks
only after subsequent edits, failures, or unresolved risk. `package.json` is
the source of truth for current CI composition.

| Changed surface | Focused check (already included in CI) |
| --- | --- |
| Public content and package boundary | `npm run public:readiness` |
| Installability and managed lifecycle | `npm run package:smoke` |
| Channel/profile isolation and negative cases | `npm run runtime:oracle` |
| Stable package/profile transition | `npm run stable-upgrade:smoke` |
| Browser workflows | `npm run e2e` |
| Plugin guidance, version lock, checksum, artifact, temporary install | `npm run plugin:smoke` |

`npm run plugin:codex-smoke` is additional to CI. Use it for changes to Codex
registration, activation, reinstall, or cleanup, and before a real-profile
plugin install. It uses a temporary `HOME` and `CODEX_HOME`; never substitute
the user's real configuration during verification.

Run authorized local checks, fix failures caused by the requested change, and
rerun affected checks without repeated approval. Keep unrelated failures out
of scope. Use the provided isolated runners for runtime tests and respect their
identity gates. Do not assume every test is side-effect free: the E2E runner
uses a temporary profile/database and a checkout asset root. Static checks
need no Lineage profile.
