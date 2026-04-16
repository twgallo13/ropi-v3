"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.promoteScheduledItems = promoteScheduledItems;
/**
 * Scheduled Item Promotion — Step 1.7 Part 5
 * Promotes scheduled items to export_ready when effective_date <= today.
 * Runs daily at 5:55 AM via Cloud Scheduler (before the 6:00 AM export).
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const mpnUtils_1 = require("./mpnUtils");
const pricingUtils_1 = require("./pricingUtils");
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
async function promoteScheduledItems() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Find all buyer_actions where pricing_domain_state_after = 'scheduled'
    const snap = await db()
        .collection("buyer_actions")
        .where("pricing_domain_state_after", "==", "scheduled")
        .get();
    let promoted = 0;
    let skipped = 0;
    const errors = [];
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
                const docId = (0, mpnUtils_1.mpnToDocId)(action.mpn);
                const exportPrice = (0, pricingUtils_1.apply99Rounding)(action.new_rics_offer);
                await db()
                    .collection("products")
                    .doc(docId)
                    .set({
                    pricing_domain_state: "export_ready",
                    rics_offer: action.new_rics_offer,
                    export_rics_offer: exportPrice,
                    promoted_from_scheduled_at: ts(),
                }, { merge: true });
                // Update buyer_action record
                await doc.ref.update({
                    pricing_domain_state_after: "export_ready",
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
            }
            catch (err) {
                errors.push({ mpn: action.mpn, error: err.message });
            }
        }
        else {
            skipped++;
        }
    }
    return { promoted, skipped, errors };
}
//# sourceMappingURL=scheduledPromotion.js.map