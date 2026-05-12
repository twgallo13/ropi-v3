# TALLY-D3-E-CADENCE-RESIDUE-FORWARD-FIX — implementation notes

## Summary
Adds a Firestore `onDocumentDeleted` trigger on `products/{productId}` that
deletes the sibling `cadence_assignments/{productId}` document (canonical
join key: cadence_assignments doc id === product doc id). Prevents future
cadence-assignment ghosts regardless of delete source.

## Files changed
- `backend/functions/src/functions/onProductDeletedCleanupCadenceAssignment.ts` (new)
- `backend/functions/src/index.ts` (export added)

## Trigger
- Source path: `products/{productId}`
- Target delete: `cadence_assignments/{productId}` (no-op if absent)
- Audit: inline write to `audit_log` with
  `actor_user_id="system:product-delete-trigger"`,
  `event_type="product_delete_cadence_assignment_cleanup"`,
  `product_id`, `cadence_assignment_deleted` (bool), `created_at` (server ts).
- Failure semantics: delete failure rethrows (Cloud Functions retry);
  audit failure log-and-swallow (must not mask cleanup success).

## Build
`npm --prefix backend/functions run build` → `tsc` clean.
Compiled artifact: `backend/functions/lib/functions/onProductDeletedCleanupCadenceAssignment.js`.

## Deploys
1. `bash scripts/deploy-dev.sh` — succeeded.
   - Cloud Run revision: `ropi-aoss-api-00207-szp`
   - Firebase rules/indexes/storage/hosting released to `ropi-aoss-dev`.
2. `firebase deploy --only functions --project ropi-aoss-dev` — first attempt
   FAILED with first-time 2nd gen Eventarc Service Agent permission
   propagation error (CLI-advised retry). RETRIED ONCE, succeeded.
   - `onProductDeletedCleanupCadenceAssignment(us-central1)` Successful create
   - `onAttributeRegistryWrite(us-central1)` Successful create (acceptable
     side-effect: TALLY-3.8-C trigger had not previously been deployed to dev;
     it is exported from main and was created by this deploy.)
   - See `deploy-functions.log` (retry log).

## Verification
`firebase functions:list --project ropi-aoss-dev` shows both functions live in
`us-central1` on `nodejs20`. See `functions-list.log`:
- `onAttributeRegistryWrite` v2 google.cloud.firestore.document.v1.written
- `onProductDeletedCleanupCadenceAssignment` v2 google.cloud.firestore.document.v1.deleted

## Smoke
SKIPPED. Reason: PO did not supply a disposable product id, and the dev
catalog is actively rebuilding (per Frink pre-audit §7.1 — dev catalog wiping
286→50→25 products in 45 min on 2026-05-12). Per dispatch §10, runtime smoke
is skipped unless PO supplies an explicit disposable product id.

## Confirmations
- No broad cleanup re-run.
- No product or cadence Firestore writes (only function deployment metadata).
- No cadence engine code changes.
- `scripts/deploy-dev.sh` unchanged.
- No CI auto-deploy: future function deploys require explicit
  `firebase deploy --only functions --project ropi-aoss-dev`.

## Anomalies
- First functions-deploy attempt failed on first-time 2nd gen Eventarc Service
  Agent propagation; retry succeeded as the Firebase CLI advised.
- Side-effect: `onAttributeRegistryWrite` (TALLY-3.8-C) was created in dev for
  the first time during this deploy. Pre-existing in source but not previously
  live. Acceptable per Lisa's retry authorization.
