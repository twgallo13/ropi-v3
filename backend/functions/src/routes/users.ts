/**
 * Users — lightweight roster used for @mention autocomplete (Step 2.5 Correction 2)
 * and other places where we need the list of users in the system.
 *   GET /api/v1/users — list active users
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";

const router = Router();

function initials(name: string): string {
  return (name || "U")
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

router.get("/", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await admin.firestore().collection("users").get();
    const users = snap.docs.map((d) => {
      const data = d.data() || {};
      const display_name = data.display_name || data.name || data.email || d.id;
      return {
        uid: d.id,
        display_name,
        email: data.email || null,
        role: data.role || null,
        avatar_initials: initials(display_name),
        active: data.active !== false,
      };
    });
    res.json({ users });
  } catch (err: any) {
    console.error("GET /users error:", err);
    res.status(500).json({ error: "Failed to load users." });
  }
});

// ── GET /me/advisory-preferences ──
router.get(
  "/me/advisory-preferences",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const doc = await admin.firestore().collection("users").doc(uid).get();
      const prefs = doc.data()?.advisory_preferences || {
        focus_area: "balanced",
        format_preference: "prose",
      };
      res.json({ advisory_preferences: prefs });
    } catch (err: any) {
      console.error("GET /users/me/advisory-preferences error:", err);
      res.status(500).json({ error: "Failed to load preferences." });
    }
  }
);

// ── PUT /me/advisory-preferences ──
const ALLOWED_FOCUS = new Set([
  "balanced",
  "margin_health",
  "inventory_clearance",
]);
const ALLOWED_FORMAT = new Set(["prose", "bullet_points"]);

router.put(
  "/me/advisory-preferences",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const body = req.body || {};
      const update: any = {};
      if (body.focus_area !== undefined) {
        if (!ALLOWED_FOCUS.has(body.focus_area)) {
          res.status(400).json({ error: "Invalid focus_area" });
          return;
        }
        update.focus_area = body.focus_area;
      }
      if (body.format_preference !== undefined) {
        if (!ALLOWED_FORMAT.has(body.format_preference)) {
          res.status(400).json({ error: "Invalid format_preference" });
          return;
        }
        update.format_preference = body.format_preference;
      }
      if (Object.keys(update).length === 0) {
        res.status(400).json({ error: "No valid fields provided" });
        return;
      }
      const ref = admin.firestore().collection("users").doc(uid);
      const doc = await ref.get();
      const existing = doc.data()?.advisory_preferences || {
        focus_area: "balanced",
        format_preference: "prose",
      };
      const merged = { ...existing, ...update };
      await ref.set({ advisory_preferences: merged }, { merge: true });
      res.json({ advisory_preferences: merged });
    } catch (err: any) {
      console.error("PUT /users/me/advisory-preferences error:", err);
      res.status(500).json({ error: "Failed to update preferences." });
    }
  }
);

export default router;
