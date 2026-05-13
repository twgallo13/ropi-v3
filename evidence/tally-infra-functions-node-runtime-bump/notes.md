# TALLY-INFRA-FUNCTIONS-NODE-RUNTIME-BUMP

## Trigger
First controlled smart deploy on `main` (commit `bafdde2`) emitted Firebase
warning:

```text
Runtime Node.js 20 was deprecated on 2026-04-30 and will be decommissioned
on 2026-10-30, after which you will not be able to deploy without upgrading.
```

## Runtime selected
- **Old:** `"node": "20"` (firebase-tools status `deprecated` as of 2026-04-30)
- **New:** `"node": "24"` (firebase-tools status `GA`, deprecation 2028-04-30,
  decommission 2028-10-31)

## Why Node 24 (not 22)
Per dispatch: "Prefer the latest supported LTS." firebase-tools `15.15.0`
explicitly lists both `nodejs22` and `nodejs24` as `status: "GA"`. Node 24
gives the longer pre-deprecation runway (~2 years vs ~1 year). Local dev
runtime is `v24.14.0`, so build environment matches the target runtime.

## Support verification (no guessing)
Inspected the firebase-tools runtime support table via a portable,
package-relative lookup (works on any environment with `firebase-tools`
installed in any reachable `node_modules`):

```js
const path = require("path");
const firebaseToolsPkg = require.resolve("firebase-tools/package.json");
const runtimesFile = path.join(
  path.dirname(firebaseToolsPkg),
  "lib/deploy/functions/runtimes/supported/types.js"
);
// then: read runtimesFile and inspect the RUNTIMES table
```

The resolved `runtimesFile` was inspected to confirm:

- `nodejs22` → `status: "GA"`
- `nodejs24` → `status: "GA"`
- `nodejs24` selected because it is the latest Firebase-supported GA Node
  runtime in the current toolchain (firebase-tools `15.15.0`).

Relevant entries from the resolved file:

```js
nodejs20: { status: "GA",   deprecationDate: "2026-04-30", decommissionDate: "2026-10-30" },
nodejs22: { status: "GA",   deprecationDate: "2027-04-30", decommissionDate: "2028-10-31" },
nodejs24: { status: "GA",   deprecationDate: "2028-04-30", decommissionDate: "2028-10-31" },
```

Tooling versions:
- firebase-tools CLI: `15.15.0`
- firebase-functions: `^7.2.5` (no runtime constraint conflict)
- firebase-admin: `^12.0.0`
- Local node: `v24.14.0`

## Files changed
- `backend/functions/package.json` — `engines.node` `"20"` → `"24"` (1 line).

No lockfile changes (`backend/functions/package-lock.json` not touched).
No `.nvmrc` present in `backend/functions/`. No function source code or
`firebase.json` changes.

## Validation
1. `npm --prefix backend/functions run build` → ✅ success (`tsc` clean exit).
2. `firebase deploy --only functions --project ropi-aoss-dev --dry-run` →
   ✅ "Dry run complete!" — Firebase validated the config with the new runtime
   without mutating Cloud Run / Cloud Functions state.

## Confirmations
- ❌ No `firebase deploy` (real) executed.
- ❌ No `gcloud run deploy` executed.
- ❌ No Firestore writes.
- ❌ No staging/prod scripts touched.
- ❌ No function source code touched.
- ❌ No frontend code touched.
- ❌ No lockfile modified.

## Post-merge expectation
After merge, the next manual `bash scripts/deploy-dev.sh` will detect
`backend/functions/package.json` as changed (vs marker
`bafdde246fe6b278d2dbaa3d927940de7b9196fa`) and trigger the smart functions
deploy, which will redeploy both Cloud Functions on the Node.js 24 runtime.
