/**
 * Queue Stats Route — GET /api/v1/queue/stats
 * Returns KPIs for the Completion Queue page:
 *   total_incomplete, completed_today, my_edits_today,
 *   team_edits_today, leaderboard[], brands_added_today[]
 *
 * Audit log schema uses:
 *   event_type: "field_edited" | "product_created" | etc.
 *   acting_user_id, product_mpn, field_key, source_type, created_at
 * Completion events live in operator_throughput:
 *   operator_uid, operator_name, mpn, department, outcome, completed_at
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";

const router = Router();

router.get("/stats", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = admin.firestore();
    const uid = req.user?.uid || "";

    // Today boundary (UTC midnight)
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayTs = admin.firestore.Timestamp.fromDate(todayStart);

    // 1. Total incomplete products
    const incompleteSnap = await db
      .collection("products")
      .where("completion_state", "==", "incomplete")
      .count()
      .get();
    const total_incomplete = incompleteSnap.data().count;

    // 2. Completions today (from operator_throughput)
    const completionsSnap = await db
      .collection("operator_throughput")
      .where("completed_at", ">=", todayTs)
      .get();

    const completed_today = completionsSnap.size;
    let my_completions_today = 0;
    const leaderMap = new Map<string, { name: string; count: number }>();

    completionsSnap.forEach((doc) => {
      const d = doc.data();
      if (d.operator_uid === uid) my_completions_today++;
      const key = d.operator_uid || "unknown";
      const existing = leaderMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        leaderMap.set(key, { name: d.operator_name || key, count: 1 });
      }
    });

    const leaderboard = Array.from(leaderMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 3. Edits today (from audit_log, field_edited only)
    const editsSnap = await db
      .collection("audit_log")
      .where("event_type", "==", "field_edited")
      .where("created_at", ">=", todayTs)
      .get();

    let my_edits_today = 0;
    let team_edits_today = editsSnap.size;
    const brandSet = new Set<string>();

    editsSnap.forEach((doc) => {
      const d = doc.data();
      if (d.acting_user_id === uid) my_edits_today++;
      if (d.product_mpn) brandSet.add(d.product_mpn);
    });

    // 4. Brands added today (from product_created events)
    const brandsSnap = await db
      .collection("audit_log")
      .where("event_type", "==", "product_created")
      .where("created_at", ">=", todayTs)
      .get();

    const brands_added_today: string[] = [];
    brandsSnap.forEach((doc) => {
      const d = doc.data();
      if (d.product_mpn) brands_added_today.push(d.product_mpn);
    });

    res.json({
      total_incomplete,
      completed_today,
      my_completions_today,
      my_edits_today,
      team_edits_today,
      leaderboard,
      brands_added_today,
      products_edited_today: brandSet.size,
    });
  } catch (err: any) {
    console.error("GET /queue/stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
