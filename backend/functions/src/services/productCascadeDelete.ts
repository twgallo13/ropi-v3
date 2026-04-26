// TALLY-PRODUCT-LIST-UX Phase 4A — shared cascade-delete helper.
//
// Extracted from backend/functions/src/routes/products.ts L1280-1340
// (Step 4.2 Amendment B). Used by both:
//   - Single-mpn DELETE /api/v1/products/:mpn (existing wire shape preserved)
//   - Bulk POST /api/v1/products/bulk-delete (Phase 4A new)
//
// Behavior contract:
//   - Reads the product doc by docId. If missing, returns ok:false (no throw)
//     so bulk callers can record the no-op without failing the whole batch.
//   - Cascade-deletes the 7 subcollections (per-product audit_log subcol is
//     distinct from the top-level audit_log collection where the
//     product_deleted event lands).
//   - Writes the audit_log event BEFORE deleting the product doc, so the
//     forensic trail lands even if the doc-delete itself fails.
//   - Audit field convention preserved verbatim from the original
//     single-delete handler: acting_user + acting_role (NOT acting_user_id).
//   - bulk_operation_id is only written when the param is provided —
//     omitted entirely from single-delete entries (no `null` write).

import admin from "firebase-admin";

export const PRODUCT_SUBCOLLECTIONS = [
  "attribute_values",
  "pricing_snapshots",
  "site_targets",
  "comments",
  "site_verification",
  "content_versions",
  "audit_log",
] as const;

export interface CascadeDeleteResult {
  ok: boolean;
  mpn: string;
  subcollections_purged: string[];
  subcollection_counts: Record<string, number>;
}

export async function cascadeDeleteProduct(
  docId: string,
  actingUser: string,
  actingRole: string,
  bulkOperationId?: string
): Promise<CascadeDeleteResult> {
  const firestore = admin.firestore();
  const productRef = firestore.collection("products").doc(docId);

  // Step 1 — read doc; clean no-op if missing (bulk callers may ask for
  // already-deleted docs).
  const snap = await productRef.get();
  if (!snap.exists) {
    console.warn(
      `[product-delete] doc not found, no-op: docId=${docId}` +
        (bulkOperationId ? ` bulk=${bulkOperationId}` : "")
    );
    return { ok: false, mpn: "", subcollections_purged: [], subcollection_counts: {} };
  }

  // Step 2 — extract canonical mpn from doc data.
  const data = snap.data() || {};
  const mpn: string = typeof data.mpn === "string" ? data.mpn : "";

  // Step 3 — cascade-delete subcollections in 400-doc batches (Firestore
  // batch limit is 500; 400 leaves headroom).
  const subcollection_counts: Record<string, number> = {};
  for (const subcol of PRODUCT_SUBCOLLECTIONS) {
    const subSnap = await productRef.collection(subcol).get();
    if (subSnap.empty) {
      subcollection_counts[subcol] = 0;
      continue;
    }
    for (let i = 0; i < subSnap.docs.length; i += 400) {
      const chunk = subSnap.docs.slice(i, i + 400);
      const batch = firestore.batch();
      chunk.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    subcollection_counts[subcol] = subSnap.size;
    console.log(`[product-delete] purged ${subSnap.size} from ${docId}/${subcol}`);
  }

  // Step 4 — write audit_log event to top-level audit_log collection.
  // Field convention: acting_user + acting_role (matches the original
  // single-delete handler verbatim — see Phase 4A dispatch).
  const auditEntry: Record<string, any> = {
    event_type: "product_deleted",
    product_mpn: mpn,
    product_doc_id: docId,
    acting_user: actingUser,
    acting_role: actingRole,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    note: "Hard delete — all subcollections purged",
  };
  if (bulkOperationId !== undefined) {
    auditEntry.bulk_operation_id = bulkOperationId;
  }
  await firestore.collection("audit_log").add(auditEntry);

  // Step 5 — delete the product doc itself.
  await productRef.delete();

  return {
    ok: true,
    mpn,
    subcollections_purged: [...PRODUCT_SUBCOLLECTIONS],
    subcollection_counts,
  };
}
