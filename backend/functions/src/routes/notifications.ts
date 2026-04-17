/**
 * Notifications — Step 2.5 Part 5.
 *   GET    /                              — list unread notifications for current user
 *   PATCH  /:notification_id/read         — mark single notification read
 *   POST   /read-all                      — mark all notifications for current user read
 *
 * Section 15.2 — @mention and Loss-Leader alerts cannot be disabled.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

const ALWAYS_ON: Set<string> = new Set(["mention", "loss_leader"]);

// ── GET / ──
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { include_read } = req.query as Record<string, string | undefined>;

    let q: FirebaseFirestore.Query = db()
      .collection("notifications")
      .where("uid", "==", uid);
    if (include_read !== "true") {
      q = q.where("read", "==", false);
    }

    const snap = await q.orderBy("created_at", "desc").limit(100).get();
    const items = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        notification_id: d.id,
        type: data.type || "unknown",
        product_mpn: data.product_mpn || null,
        message: data.message || "",
        read: !!data.read,
        created_at: data.created_at?.toDate?.()?.toISOString?.() || null,
        source_comment_id: data.source_comment_id || null,
      };
    });

    const unread_count = items.filter((i) => !i.read).length;
    res.json({ items, unread_count, total: items.length });
  } catch (err: any) {
    console.error("GET /notifications error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /:notification_id/read ──
router.patch(
  "/:notification_id/read",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      const { notification_id } = req.params;
      const ref = db().collection("notifications").doc(notification_id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Notification not found" });
        return;
      }
      if (snap.data()?.uid !== uid) {
        res.status(403).json({ error: "Cannot modify another user's notification" });
        return;
      }
      await ref.set({ read: true, read_at: ts() }, { merge: true });
      res.json({ notification_id, read: true });
    } catch (err: any) {
      console.error("PATCH /notifications/:id/read error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── POST /read-all ──
router.post(
  "/read-all",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const snap = await db()
        .collection("notifications")
        .where("uid", "==", uid)
        .where("read", "==", false)
        .limit(500)
        .get();
      const batch = db().batch();
      snap.docs.forEach((d) => batch.set(d.ref, { read: true, read_at: ts() }, { merge: true }));
      await batch.commit();
      res.json({ marked: snap.size });
    } catch (err: any) {
      console.error("POST /notifications/read-all error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── GET /me/notification-preferences ──
router.get(
  "/me/preferences",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const ref = db().collection("users").doc(uid).collection("settings").doc("notifications");
      const snap = await ref.get();
      const defaults = {
        mention: true, // always-on
        pricing_discrepancy: true,
        high_priority_launch: true,
        loss_leader: true, // always-on
        map_conflict: true,
        export_complete: false,
      };
      const existing = snap.exists ? (snap.data() as any) : {};
      res.json({
        preferences: { ...defaults, ...existing },
        always_on: Array.from(ALWAYS_ON),
      });
    } catch (err: any) {
      console.error("GET notification-preferences error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── PUT /me/notification-preferences ──
router.put(
  "/me/preferences",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const body = req.body || {};
      const merged: any = {};
      for (const key of [
        "pricing_discrepancy",
        "high_priority_launch",
        "map_conflict",
        "export_complete",
      ]) {
        if (typeof body[key] === "boolean") merged[key] = body[key];
      }
      // Force always-on types to true regardless of input.
      merged.mention = true;
      merged.loss_leader = true;
      merged.updated_at = ts();

      await db()
        .collection("users")
        .doc(uid)
        .collection("settings")
        .doc("notifications")
        .set(merged, { merge: true });

      res.json({ preferences: merged, always_on: Array.from(ALWAYS_ON) });
    } catch (err: any) {
      console.error("PUT notification-preferences error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
