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
import admin from "firebase-admin";
import { mpnToDocId } from "./mpnUtils";

const db = () => admin.firestore();

async function getLaunchWindowDays(): Promise<number> {
  const doc = await db()
    .collection("admin_settings")
    .doc("launch_priority_window_days")
    .get();
  if (!doc.exists) return 7;
  const val = doc.data()?.value;
  return typeof val === "number" ? val : 7;
}

/**
 * Recompute is_high_priority for a given MPN and stamp it on both the
 * product document and any matching launch_records.
 */
export async function checkHighPriorityFlag(mpn: string): Promise<void> {
  if (!mpn) return;

  const launchWindowDays = await getLaunchWindowDays();
  const docId = mpnToDocId(mpn);
  const productRef = db().collection("products").doc(docId);
  const productDoc = await productRef.get();
  if (!productDoc.exists) return;

  // Correction 2: use completion_state (not completion_status)
  const isIncomplete = productDoc.data()?.completion_state !== "complete";

  const launchSnap = await db()
    .collection("launch_records")
    .where("mpn", "==", mpn)
    .get();

  let isHighPriority = false;
  let daysUntilLaunch: number | null = null;
  let upcomingLaunchDate: string | null = null;

  for (const doc of launchSnap.docs) {
    const data = doc.data();
    if (data.launch_status === "archived") continue;

    const launchDate = new Date(data.launch_date);
    if (Number.isNaN(launchDate.getTime())) continue;

    const daysUntil = Math.ceil(
      (launchDate.getTime() - Date.now()) / 86400000
    );

    const launchIsHighPriority =
      daysUntil >= 0 && daysUntil <= launchWindowDays && isIncomplete;

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

  await productRef.set(
    {
      is_high_priority: isHighPriority,
      launch_days_remaining: daysUntilLaunch,
      upcoming_launch_date: upcomingLaunchDate,
    },
    { merge: true }
  );
}
