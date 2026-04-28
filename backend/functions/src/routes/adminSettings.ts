/**
 * adminSettings routes — Step 4.2 Tabs 2/3/4
 *   GET  /api/v1/admin/settings          — all admin_settings docs
 *   PUT  /api/v1/admin/settings/:key     — upsert a single setting
 *   POST /api/v1/admin/smtp/test         — send test email to current user
 *
 * NOTE: POST /api/v1/admin/ai/test was REMOVED in TALLY-SETTINGS-UX
 * Phase 3 / A.1 — the AI ping endpoint now lives at
 * POST /api/v1/admin/ai/test (mounted via routes/aiPlane.ts) and uses
 * the new XOR provider_key / workflow_key contract.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { sendEmail } from "../services/emailService";

const router = Router();
const db = () => admin.firestore();

router.get(
  "/settings",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const snap = await db().collection("admin_settings").get();
      const settings = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          key: d.id,
          value: data.value ?? null,
          type: data.type || (typeof data.value === "number" ? "number" : "string"),
          category: data.category || "general",
          label: data.label || d.id,
          description: data.description || null,
          deprecated: data.deprecated || false,
          updated_at: data.updated_at?.toDate?.().toISOString() || null,
        };
      });
      settings.sort((a, b) =>
        (a.category + a.key).localeCompare(b.category + b.key)
      );
      res.json({ settings });
    } catch (err: any) {
      console.error("GET /admin/settings error:", err);
      res.status(500).json({ error: err.message || "Failed to load settings" });
    }
  }
);

router.put(
  "/settings/:key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { key } = req.params;
      const { value, type, category, label } = req.body || {};
      if (value === undefined) {
        res.status(400).json({ error: "value is required" });
        return;
      }
      const update: Record<string, any> = {
        value,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: req.user?.uid || null,
      };
      if (type !== undefined) update.type = type;
      if (category !== undefined) update.category = category;
      if (label !== undefined) update.label = label;
      await db().collection("admin_settings").doc(key).set(update, {
        merge: true,
      });
      res.json({ ok: true, key, value });
    } catch (err: any) {
      console.error("PUT /admin/settings/:key error:", err);
      res.status(500).json({ error: err.message || "Failed to save setting" });
    }
  }
);

router.post(
  "/smtp/test",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const recipient = req.user?.email;
      if (!recipient) {
        res
          .status(400)
          .json({ ok: false, error: "No email on current user token" });
        return;
      }
      await sendEmail({
        to: recipient,
        subject: "ROPI SMTP Test",
        html: "<p>Your ROPI email configuration is working correctly.</p>",
      });
      res.json({ ok: true, message: `Test email sent to ${recipient}` });
    } catch (err: any) {
      console.error("POST /admin/smtp/test error:", err);
      res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  }
);

// POST /api/v1/admin/ai/test was removed in TALLY-SETTINGS-UX Phase 3 /
// A.1. The replacement lives at routes/aiPlane.ts and supports XOR
// provider_key / workflow_key bodies.

export default router;
