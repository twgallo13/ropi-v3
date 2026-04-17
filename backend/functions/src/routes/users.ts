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

export default router;
