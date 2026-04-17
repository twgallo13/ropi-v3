/**
 * adminSettings routes — Step 4.2 Tabs 2/3/4
 *   GET  /api/v1/admin/settings          — all admin_settings docs
 *   PUT  /api/v1/admin/settings/:key     — upsert a single setting
 *   POST /api/v1/admin/smtp/test         — send test email to current user
 *   POST /api/v1/admin/ai/test           — minimal ping of active AI provider
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { sendEmail, getAdminSetting } from "../services/emailService";

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

router.post(
  "/ai/test",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const provider =
        (await getAdminSetting<string>("active_ai_provider", "anthropic")) ||
        "anthropic";
      const model =
        (await getAdminSetting<string>("active_ai_model", "claude-sonnet-4-5")) ||
        "claude-sonnet-4-5";

      if (provider !== "anthropic") {
        res.json({
          ok: false,
          provider,
          model,
          error: `Provider '${provider}' test not implemented`,
        });
        return;
      }

      const apiKey = process.env.ANTHROPIC_API_KEY || "";
      if (!apiKey) {
        res.json({
          ok: false,
          provider,
          model,
          error: "ANTHROPIC_API_KEY env var not configured",
        });
        return;
      }

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        res.json({
          ok: false,
          provider,
          model,
          error: `HTTP ${r.status}: ${text.slice(0, 200)}`,
        });
        return;
      }
      res.json({ ok: true, provider, model });
    } catch (err: any) {
      console.error("POST /admin/ai/test error:", err);
      res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  }
);

export default router;
