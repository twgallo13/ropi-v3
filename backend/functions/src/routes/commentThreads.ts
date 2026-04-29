/**
 * Comment Threads — TALLY-SETTINGS-UX Phase 3 / A.3 PR2.
 *
 * Admin/team-notes CRUD for the `comment_threads` collection. Unlike the
 * other PR 2 collections, doc-id is auto-generated (admin/team notes are
 * not human-keyed). `is_archived` is independent from `is_resolved` per
 * Frink non-blocking accept #2.
 *
 *   GET    /api/v1/admin/comment-threads
 *   GET    /api/v1/admin/comment-threads/:thread_id
 *   POST   /api/v1/admin/comment-threads          → 201 (auto-id on doc ref)
 *   PUT    /api/v1/admin/comment-threads/:thread_id
 *   DELETE /api/v1/admin/comment-threads/:thread_id  (soft archive: is_archived=true)
 *
 * Mirrors the A.2 siteRegistry.ts canonical CRUD pattern.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

async function writeCommentThreadAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "comment_threads",
      entity_id: entityId,
      actor_uid: actorUid,
      details,
      timestamp: ts(),
    });
  } catch (err: any) {
    console.error("audit_log write failed:", err.message);
  }
}

router.get(
  "/",
  requireAuth,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const snap = await db().collection("comment_threads").get();
      const threads = snap.docs.map((d) => d.data());
      res.json({ threads });
    } catch (err: any) {
      console.error("GET /admin/comment-threads error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/:thread_id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.thread_id;
      const snap = await db().collection("comment_threads").doc(pathKey).get();
      if (!snap.exists) {
        res.status(404).json({ error: `thread "${pathKey}" not found` });
        return;
      }
      res.json({ thread: snap.data() });
    } catch (err: any) {
      console.error("GET /admin/comment-threads/:id error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const { entity_type, entity_id, title, body_md } = body;

      if (typeof entity_type !== "string" || entity_type.trim() === "") {
        res.status(400).json({ error: "entity_type is required (non-empty string)" });
        return;
      }
      if (typeof entity_id !== "string" || entity_id.trim() === "") {
        res.status(400).json({ error: "entity_id is required (non-empty string)" });
        return;
      }
      if (typeof title !== "string" || title.trim() === "") {
        res.status(400).json({ error: "title is required (non-empty string)" });
        return;
      }
      if (typeof body_md !== "string") {
        res.status(400).json({ error: "body_md is required (string)" });
        return;
      }

      // Auto-id doc ref — comment_threads are not human-keyed.
      const ref = db().collection("comment_threads").doc();
      const threadId = ref.id;

      const payload: Record<string, any> = {
        thread_id: threadId,
        entity_type: entity_type.trim(),
        entity_id: entity_id.trim(),
        title: title.trim(),
        body_md,
        is_resolved: typeof body.is_resolved === "boolean" ? body.is_resolved : false,
        is_archived: typeof body.is_archived === "boolean" ? body.is_archived : false,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      await writeCommentThreadAudit("comment_thread_created", threadId, req.user!.uid, {
        before: null,
        after: payload,
      });

      const refetched = (await ref.get()).data();
      res.status(201).json({ thread: refetched });
    } catch (err: any) {
      console.error("POST /admin/comment-threads error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.put(
  "/:thread_id",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = req.params.thread_id;

      if (body.thread_id !== undefined && body.thread_id !== pathKey) {
        res.status(400).json({ error: "thread_id is immutable" });
        return;
      }
      if (body.entity_type !== undefined) {
        if (typeof body.entity_type !== "string" || body.entity_type.trim() === "") {
          res.status(400).json({ error: "entity_type must be a non-empty string" });
          return;
        }
      }
      if (body.entity_id !== undefined) {
        if (typeof body.entity_id !== "string" || body.entity_id.trim() === "") {
          res.status(400).json({ error: "entity_id must be a non-empty string" });
          return;
        }
      }
      if (body.title !== undefined) {
        if (typeof body.title !== "string" || body.title.trim() === "") {
          res.status(400).json({ error: "title must be a non-empty string" });
          return;
        }
      }
      if (body.body_md !== undefined && typeof body.body_md !== "string") {
        res.status(400).json({ error: "body_md must be a string" });
        return;
      }

      const ref = db().collection("comment_threads").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `thread "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      const patch: Record<string, any> = {};
      if (body.entity_type !== undefined) patch.entity_type = body.entity_type.trim();
      if (body.entity_id !== undefined) patch.entity_id = body.entity_id.trim();
      if (body.title !== undefined) patch.title = body.title.trim();
      if (body.body_md !== undefined) patch.body_md = body.body_md;
      if (typeof body.is_resolved === "boolean") patch.is_resolved = body.is_resolved;
      if (typeof body.is_archived === "boolean") patch.is_archived = body.is_archived;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      const refetched = (await ref.get()).data();
      await writeCommentThreadAudit("comment_thread_updated", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
        patch_keys: Object.keys(patch),
      });

      res.status(200).json({ thread: refetched });
    } catch (err: any) {
      console.error("PUT /admin/comment-threads/:id error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.delete(
  "/:thread_id",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.thread_id;
      const ref = db().collection("comment_threads").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `thread "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      // Soft archive — is_archived independent from is_resolved.
      await ref.set(
        {
          is_archived: true,
          updated_at: ts(),
          updated_by: req.user!.uid,
        },
        { merge: true }
      );

      const refetched = (await ref.get()).data();
      await writeCommentThreadAudit("comment_thread_deleted", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
      });

      res.status(200).json({ thread: refetched });
    } catch (err: any) {
      console.error("DELETE /admin/comment-threads/:id error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
