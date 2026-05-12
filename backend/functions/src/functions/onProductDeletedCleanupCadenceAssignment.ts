/**
 * functions/onProductDeletedCleanupCadenceAssignment.ts
 *
 * Firestore-triggered Cloud Function (TALLY-D3-E-CADENCE-RESIDUE-FORWARD-FIX).
 *
 * When a product document is deleted, delete the sibling cadence_assignments
 * document keyed by the same doc id. Prevents future cadence-assignment
 * ghosts regardless of delete source (UI single delete, bulk delete, manual
 * backend delete, or future scripts).
 *
 * Join key: cadence_assignments doc id === product doc id (canonical, per
 * cadenceEngine writeAssignment / writeUnassigned / writeConflictAssignment).
 * MPN matching is intentionally NOT used.
 *
 * Behavior:
 *   - If sibling cadence_assignments doc does not exist: log + audit no-op,
 *     return success.
 *   - If sibling cadence_assignments doc exists: delete it, log + audit
 *     success.
 *   - On delete failure: log error and rethrow so Cloud Functions retries.
 *
 * Audit emission: one summary entry per trigger execution (inline write,
 * matches existing audit_log pattern in this repo — no helper).
 *
 * Deployed via: firebase deploy --only functions --project ropi-aoss-dev
 * Region: us-central1 (default; matches existing onAttributeRegistryWrite).
 */

import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import admin from "firebase-admin";

export const onProductDeletedCleanupCadenceAssignment = onDocumentDeleted(
  "products/{productId}",
  async (event) => {
    const productId = event.params.productId;
    const firestore = admin.firestore();
    const ref = firestore.collection("cadence_assignments").doc(productId);

    let cadenceAssignmentExisted = false;
    try {
      const snap = await ref.get();
      cadenceAssignmentExisted = snap.exists;

      if (!snap.exists) {
        console.log(
          `onProductDeletedCleanupCadenceAssignment: product "${productId}" deleted; ` +
            `no sibling cadence_assignments doc — no-op success.`
        );
      } else {
        await ref.delete();
        console.log(
          `onProductDeletedCleanupCadenceAssignment: product "${productId}" deleted; ` +
            `sibling cadence_assignments/${productId} deleted.`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `onProductDeletedCleanupCadenceAssignment: failed to delete ` +
          `cadence_assignments/${productId}: ${msg}`
      );
      throw err;
    }

    // Inline audit_log write — matches the inline pattern used elsewhere in
    // this repo (see scripts/tally-d3-e-cadence-residue-cleanup.js). Audit
    // failure must NOT mask the cleanup success, so log-and-swallow here.
    try {
      await firestore.collection("audit_log").add({
        actor_user_id: "system:product-delete-trigger",
        event_type: "product_delete_cadence_assignment_cleanup",
        product_id: productId,
        cadence_assignment_deleted: cadenceAssignmentExisted,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (auditErr: unknown) {
      const msg = auditErr instanceof Error ? auditErr.message : String(auditErr);
      console.error(
        `onProductDeletedCleanupCadenceAssignment: audit_log write failed for ` +
          `product "${productId}": ${msg}`
      );
    }
  }
);
