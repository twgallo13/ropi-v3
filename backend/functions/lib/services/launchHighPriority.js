"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkHighPriorityFlag = checkHighPriorityFlag;
/**
 * launchHighPriority — Step 2.4, Correction 1.
 *
 * Stamps is_high_priority + launch_days_remaining + upcoming_launch_date
 * directly onto products/{docId} so the Completion Queue can sort using
 * native Firestore orderBy instead of a per-request dynamic join.
 *
 * Wired in from:
 *  - POST /api/v1/launches (create)
 *  - PATCH /api/v1/launches/:id (date change)
 *  - Weekly Operations Import commit (after runCadenceEvaluation)
 *  - Product Mark Complete action (to clear the flag)
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const mpnUtils_1 = require("./mpnUtils");
const db = () => firebase_admin_1.default.firestore();
async function getLaunchWindowDays() {
    const doc = await db()
        .collection("admin_settings")
        .doc("launch_priority_window_days")
        .get();
    if (!doc.exists)
        return 7;
    const val = doc.data()?.value;
    return typeof val === "number" ? val : 7;
}
/**
 * Recompute is_high_priority for a given MPN and stamp it on both the
 * product document and any matching launch_records.
 */
async function checkHighPriorityFlag(mpn) {
    if (!mpn)
        return;
    const launchWindowDays = await getLaunchWindowDays();
    const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
    const productRef = db().collection("products").doc(docId);
    const productDoc = await productRef.get();
    if (!productDoc.exists)
        return;
    // Correction 2: use completion_state (not completion_status)
    const isIncomplete = productDoc.data()?.completion_state !== "complete";
    const launchSnap = await db()
        .collection("launch_records")
        .where("mpn", "==", mpn)
        .get();
    let isHighPriority = false;
    let daysUntilLaunch = null;
    let upcomingLaunchDate = null;
    for (const doc of launchSnap.docs) {
        const data = doc.data();
        if (data.launch_status === "archived")
            continue;
        const launchDate = new Date(data.launch_date);
        if (Number.isNaN(launchDate.getTime()))
            continue;
        const daysUntil = Math.ceil((launchDate.getTime() - Date.now()) / 86400000);
        const launchIsHighPriority = daysUntil >= 0 && daysUntil <= launchWindowDays && isIncomplete;
        // Stamp is_high_priority on the launch_record itself
        await doc.ref.update({ is_high_priority: launchIsHighPriority });
        // Track the soonest qualifying launch for the product-level stamp
        if (launchIsHighPriority) {
            if (daysUntilLaunch === null || daysUntil < daysUntilLaunch) {
                isHighPriority = true;
                daysUntilLaunch = daysUntil;
                upcomingLaunchDate = data.launch_date;
            }
        }
    }
    await productRef.set({
        is_high_priority: isHighPriority,
        launch_days_remaining: daysUntilLaunch,
        upcoming_launch_date: upcomingLaunchDate,
    }, { merge: true });
}
//# sourceMappingURL=launchHighPriority.js.map