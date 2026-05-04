/**
 * Scheduled Item Promotion — Step 1.7 Part 5
 * Promotes scheduled items to export_ready when effective_date <= today.
 * Runs daily at 5:55 AM via Cloud Scheduler (before the 6:00 AM export).
 */
import admin from "firebase-admin";
import { mpnToDocId } from "./mpnUtils";
import { apply99Rounding } from "./pricingUtils";

const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

export interface PromotionResult {
  promoted: number;
  skipped: number;
  errors: Array<{ mpn: string; error: string }>;
}

export async function promoteScheduledItems(): Promise<PromotionResult> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all buyer_actions where pricing_domain_state_after = 'Scheduled'
  const snap = await db()
    .collection("buyer_actions")
    .where("pricing_domain_state_after", "==", "Scheduled")
    .get();

  let promoted = 0;
  let skipped = 0;
  const errors: Array<{ mpn: string; error: string }> = [];

  for (const doc of snap.docs) {
    const action = doc.data();
    if (!action.effective_date) {
      skipped++;
      continue;
    }

    const effectiveDate = new Date(action.effective_date);
    effectiveDate.setHours(0, 0, 0, 0);

    if (effectiveDate <= today) {
      try {
        const docId = mpnToDocId(action.mpn);
        const exportPrice = apply99Rounding(action.new_rics_offer);

        await db()
          .collection("products")
          .doc(docId)
          .set(
            {
              pricing_domain_state: "Export Ready",
              rics_offer: action.new_rics_offer,
              export_rics_offer: exportPrice,
              promoted_from_scheduled_at: ts(),
            },
            { merge: true }
          );

        // Update buyer_action record
        await doc.ref.update({
          pricing_domain_state_after: "Export Ready",
          promoted_at: ts(),
        });

        await db().collection("audit_log").add({
          event_type: "scheduled_item_promoted",
          product_mpn: action.mpn,
          export_price: exportPrice,
          original_effective_date: action.effective_date,
          created_at: ts(),
        });

        promoted++;
      } catch (err: any) {
        errors.push({ mpn: action.mpn, error: err.message });
      }
    } else {
      skipped++;
    }
  }

  return { promoted, skipped, errors };
}
