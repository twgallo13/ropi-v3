/**
 * Launch Calendar Routes — Step 2.4 (Section 9.13 / 10.8).
 *
 * Owner: Cesar (Content Manager). Cesar and Admin create/edit/publish.
 * Any authenticated user can view and comment.
 * The public calendar endpoint is unauthenticated.
 *
 * Endpoints:
 *   GET    /api/v1/launches                      — authenticated list
 *   GET    /api/v1/launches/public               — UNAUTHENTICATED public cards
 *   GET    /api/v1/launches/upcoming             — upcoming window (auth)
 *   GET    /api/v1/launches/:launch_id           — detail + checklist + comments
 *   POST   /api/v1/launches                      — create (Cesar/Admin)
 *   PATCH  /api/v1/launches/:launch_id           — edit (Cesar/Admin)
 *   POST   /api/v1/launches/:launch_id/images    — upload image (multipart)
 *   POST   /api/v1/launches/:launch_id/publish   — server-side readiness gate
 *   POST   /api/v1/launches/:launch_id/token-status
 *   POST   /api/v1/launches/:launch_id/comments  — any authenticated
 *   DELETE /api/v1/launches/:launch_id           — archive (soft delete)
 *   POST   /api/v1/launches/subscribe            — public, @shiekh.com only
 *   DELETE /api/v1/launches/unsubscribe          — public
 */
import { Router, Response, Request } from "express";
import admin from "firebase-admin";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { checkHighPriorityFlag } from "../services/launchHighPriority";
import {
  notifyNewLaunch,
  notifyDateChanged,
  notifyNewComment,
} from "../services/launchNotifier";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Cesar — Content Manager — or Admin may create/edit/publish launches.
const LAUNCH_EDITOR_ROLES = ["content_manager", "launch_lead", "admin"];

// Public-safe fields exposed on /public endpoint.
const PUBLIC_FIELDS = [
  "launch_id",
  "product_name",
  "brand",
  "launch_date",
  "gender",
  "category",
  "class",
  "primary_color",
  "sales_channel",
  "drawing_fcfs",
  "image_1_url",
  "image_2_url",
  "image_3_url",
  "teaser_text",
  "is_high_priority",
  "date_change_badge_expires_at",
  "previous_launch_date",
];

function pickPublic(data: any): any {
  const out: Record<string, any> = {};
  for (const k of PUBLIC_FIELDS) {
    if (data[k] !== undefined) out[k] = data[k];
  }
  if (out.date_change_badge_expires_at?.toDate) {
    out.date_change_badge_expires_at = out.date_change_badge_expires_at
      .toDate()
      .toISOString();
  }
  return out;
}

function computeReadiness(launch: any): {
  ok: boolean;
  missing: string[];
  checks: Record<string, boolean>;
} {
  const checks = {
    launch_date: !!launch.launch_date,
    sales_channel: !!launch.sales_channel,
    drawing_fcfs: !!launch.drawing_fcfs,
    token_status_set: launch.token_status === "Set",
    image_1_uploaded: !!launch.image_1_url,
    mpn_confirmed: launch.mpn_is_placeholder !== true,
  };
  const missing: string[] = [];
  if (!checks.launch_date) missing.push("launch_date");
  if (!checks.sales_channel) missing.push("sales_channel");
  if (!checks.drawing_fcfs) missing.push("drawing_fcfs");
  if (!checks.token_status_set) missing.push("token_status");
  if (!checks.image_1_uploaded) missing.push("image_1_url");
  if (!checks.mpn_confirmed) missing.push("mpn_confirmed");
  return { ok: missing.length === 0, missing, checks };
}

async function writeAudit(
  action: string,
  launchId: string,
  actorUid: string,
  details: Record<string, any> = {}
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "launch_record",
      entity_id: launchId,
      actor_uid: actorUid,
      details,
      timestamp: ts(),
    });
  } catch (err: any) {
    console.error("audit_log write failed:", err.message);
  }
}

// ────────────────────────────────────────────────
// GET /api/v1/launches/public  — UNAUTHENTICATED
// Must come BEFORE GET /:launch_id to avoid route collision.
// ────────────────────────────────────────────────
router.get("/public", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const retentionDoc = await db()
      .collection("admin_settings")
      .doc("launch_past_retention_days")
      .get();
    const retentionDays = retentionDoc.exists
      ? (retentionDoc.data()?.value as number) || 90
      : 90;

    const snap = await db()
      .collection("launch_records")
      .where("launch_status", "==", "published")
      .get();

    const upcoming: any[] = [];
    const past: any[] = [];
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - retentionDays);

    for (const d of snap.docs) {
      const data = d.data();
      const launchDateMs = new Date(data.launch_date).getTime();
      const publicRow = pickPublic({ ...data, launch_id: d.id });

      if (launchDateMs >= now.getTime()) {
        upcoming.push(publicRow);
      } else if (launchDateMs >= cutoff.getTime()) {
        past.push(publicRow);
      }
    }

    upcoming.sort(
      (a, b) =>
        new Date(a.launch_date).getTime() -
        new Date(b.launch_date).getTime()
    );
    past.sort(
      (a, b) =>
        new Date(b.launch_date).getTime() -
        new Date(a.launch_date).getTime()
    );

    res.json({
      upcoming,
      past,
      retention_days: retentionDays,
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("GET /launches/public error:", err);
    res.status(500).json({ error: "Failed to load public launches." });
  }
});

// ────────────────────────────────────────────────
// POST /api/v1/launches/subscribe — PUBLIC, @shiekh.com only
// ────────────────────────────────────────────────
router.post("/subscribe", async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "email is required" });
      return;
    }
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@shiekh\.com$/.test(clean)) {
      res
        .status(400)
        .json({ error: "email must be a valid @shiekh.com address" });
      return;
    }

    await db().collection("launch_subscribers").doc(clean).set(
      {
        email: clean,
        subscribed_at: ts(),
        notification_preferences: {
          new_launch: true,
          date_changed: true,
          new_comment: true,
        },
      },
      { merge: true }
    );

    res.json({ email: clean, subscribed: true });
  } catch (err: any) {
    console.error("POST /launches/subscribe error:", err);
    res.status(500).json({ error: "Failed to subscribe." });
  }
});

// ────────────────────────────────────────────────
// DELETE /api/v1/launches/unsubscribe — PUBLIC
// ────────────────────────────────────────────────
router.delete("/unsubscribe", async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).json({ error: "email is required" });
      return;
    }
    const clean = email.trim().toLowerCase();
    await db().collection("launch_subscribers").doc(clean).delete();
    res.json({ email: clean, unsubscribed: true });
  } catch (err: any) {
    console.error("DELETE /launches/unsubscribe error:", err);
    res.status(500).json({ error: "Failed to unsubscribe." });
  }
});

// ────────────────────────────────────────────────
// GET /api/v1/launches — authenticated list
// ────────────────────────────────────────────────
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status, date_from, date_to } = req.query as Record<
        string,
        string | undefined
      >;

      let query: admin.firestore.Query = db().collection("launch_records");
      if (status) query = query.where("launch_status", "==", status);

      const snap = await query.get();
      let records = snap.docs.map((d) => ({ launch_id: d.id, ...d.data() }));

      if (date_from) {
        records = records.filter((r: any) => r.launch_date >= date_from);
      }
      if (date_to) {
        records = records.filter((r: any) => r.launch_date <= date_to);
      }

      records.sort((a: any, b: any) =>
        (a.launch_date || "").localeCompare(b.launch_date || "")
      );

      res.json({ records, count: records.length });
    } catch (err: any) {
      console.error("GET /launches error:", err);
      res.status(500).json({ error: "Failed to load launches." });
    }
  }
);

// ────────────────────────────────────────────────
// GET /api/v1/launches/upcoming — authenticated
// ────────────────────────────────────────────────
router.get(
  "/upcoming",
  requireAuth,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const windowDoc = await db()
        .collection("admin_settings")
        .doc("launch_priority_window_days")
        .get();
      const windowDays = windowDoc.exists
        ? (windowDoc.data()?.value as number) || 7
        : 7;

      const today = new Date();
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() + windowDays);
      const cutoffStr = cutoff.toISOString().substring(0, 10);

      const snap = await db().collection("launch_records").get();
      const records = snap.docs
        .map((d) => ({ launch_id: d.id, ...d.data() }))
        .filter(
          (r: any) =>
            r.launch_status !== "archived" && r.launch_date <= cutoffStr
        )
        .sort((a: any, b: any) =>
          (a.launch_date || "").localeCompare(b.launch_date || "")
        );

      res.json({
        records,
        window_days: windowDays,
        count: records.length,
      });
    } catch (err: any) {
      console.error("GET /launches/upcoming error:", err);
      res.status(500).json({ error: "Failed to load upcoming launches." });
    }
  }
);

// ────────────────────────────────────────────────
// GET /api/v1/launches/:launch_id — detail + checklist + comments
// ────────────────────────────────────────────────
router.get(
  "/:launch_id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { launch_id } = req.params;
      const doc = await db().collection("launch_records").doc(launch_id).get();
      if (!doc.exists) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }
      const launch = { launch_id: doc.id, ...doc.data() };
      const readiness = computeReadiness(launch);

      const commentsSnap = await db()
        .collection("launch_comments")
        .where("launch_id", "==", launch_id)
        .get();
      const comments = commentsSnap.docs
        .map((d) => ({ comment_id: d.id, ...d.data() }))
        .sort(
          (a: any, b: any) =>
            (a.created_at?.toMillis?.() || 0) -
            (b.created_at?.toMillis?.() || 0)
        );

      res.json({ launch, readiness, comments });
    } catch (err: any) {
      console.error("GET /launches/:id error:", err);
      res.status(500).json({ error: "Failed to load launch." });
    }
  }
);

// ────────────────────────────────────────────────
// POST /api/v1/launches — create (Cesar / Admin)
// ────────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  requireRole(LAUNCH_EDITOR_ROLES),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const required = [
        "mpn",
        "product_name",
        "brand",
        "launch_date",
        "sales_channel",
        "drawing_fcfs",
      ];
      for (const k of required) {
        if (!body[k]) {
          res.status(400).json({ error: `${k} is required` });
          return;
        }
      }

      const launchId = uuidv4();
      const record = {
        launch_id: launchId,
        mpn: body.mpn,
        mpn_is_placeholder: body.mpn_is_placeholder === true,
        product_name: body.product_name,
        brand: body.brand,
        launch_date: body.launch_date, // ISO "YYYY-MM-DD"
        sales_channel: body.sales_channel,
        drawing_fcfs: body.drawing_fcfs,
        token_status: body.token_status || "Not Set",
        launch_status: "draft",
        is_high_priority: false,

        gender: body.gender ?? null,
        category: body.category ?? null,
        class: body.class ?? null,
        primary_color: body.primary_color ?? null,
        teaser_text: body.teaser_text ?? null,

        image_1_url: null,
        image_2_url: null,
        image_3_url: null,

        previous_launch_date: null,
        date_changed_at: null,
        date_change_badge_expires_at: null,
        date_change_log: [],

        linked_product_mpn: body.linked_product_mpn ?? null,
        is_launch_only: body.linked_product_mpn ? false : true,

        internal_comments_count: 0,
        created_by: req.user?.uid || "system",
        created_at: ts(),
        updated_at: ts(),
        published_at: null,
        archived_at: null,
      };

      await db().collection("launch_records").doc(launchId).set(record);

      // Re-evaluate High Priority after create
      await checkHighPriorityFlag(body.mpn);

      await writeAudit("launch_created", launchId, req.user?.uid || "system", {
        mpn: body.mpn,
      });

      const saved = await db().collection("launch_records").doc(launchId).get();
      res
        .status(201)
        .json({ launch: { launch_id: launchId, ...saved.data() } });
    } catch (err: any) {
      console.error("POST /launches error:", err);
      res.status(500).json({ error: "Failed to create launch." });
    }
  }
);

// ────────────────────────────────────────────────
// PATCH /api/v1/launches/:launch_id — edit (Cesar / Admin)
// ────────────────────────────────────────────────
router.patch(
  "/:launch_id",
  requireAuth,
  requireRole(LAUNCH_EDITOR_ROLES),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { launch_id } = req.params;
      const ref = db().collection("launch_records").doc(launch_id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }
      const current = snap.data() as any;

      const editable: Record<string, any> = {};
      const allowed = [
        "mpn",
        "mpn_is_placeholder",
        "product_name",
        "brand",
        "launch_date",
        "sales_channel",
        "drawing_fcfs",
        "token_status",
        "gender",
        "category",
        "class",
        "primary_color",
        "teaser_text",
        "linked_product_mpn",
      ];
      for (const k of allowed) {
        if (k in req.body) editable[k] = req.body[k];
      }

      // Track launch_date change
      let dateChanged = false;
      const oldDate: string = current.launch_date;
      const newDate: string | undefined = editable.launch_date;
      if (newDate && newDate !== oldDate) {
        dateChanged = true;
        const expires = admin.firestore.Timestamp.fromMillis(
          Date.now() + 72 * 3600 * 1000
        );
        const entry = {
          old_date: oldDate,
          new_date: newDate,
          changed_by: req.user?.uid || "system",
          changed_at: admin.firestore.Timestamp.now(),
          reason: req.body?.reason ?? null,
        };
        editable.previous_launch_date = oldDate;
        editable.date_changed_at = ts();
        editable.date_change_badge_expires_at = expires;
        editable.date_change_log = [
          ...(Array.isArray(current.date_change_log)
            ? current.date_change_log
            : []),
          entry,
        ];
      }

      if (editable.linked_product_mpn !== undefined) {
        editable.is_launch_only = !editable.linked_product_mpn;
      }

      editable.updated_at = ts();
      await ref.update(editable);

      // Recompute high priority for the (possibly new) MPN
      const mpnToCheck = editable.mpn || current.mpn;
      if (mpnToCheck) await checkHighPriorityFlag(mpnToCheck);

      // SMTP notify on Published date change (throttled)
      if (dateChanged && current.launch_status === "published") {
        const refreshed = await ref.get();
        const launch = { launch_id, ...refreshed.data() };
        await notifyDateChanged(launch, oldDate);
        await writeAudit(
          "launch_date_changed",
          launch_id,
          req.user?.uid || "system",
          { old_date: oldDate, new_date: newDate }
        );
      }

      const out = await ref.get();
      res.json({ launch: { launch_id, ...out.data() } });
    } catch (err: any) {
      console.error("PATCH /launches/:id error:", err);
      res.status(500).json({ error: "Failed to update launch." });
    }
  }
);

// ────────────────────────────────────────────────
// POST /api/v1/launches/:launch_id/images — multipart upload
// ────────────────────────────────────────────────
router.post(
  "/:launch_id/images",
  requireAuth,
  requireRole(LAUNCH_EDITOR_ROLES),
  upload.single("file"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { launch_id } = req.params;
      const slot = parseInt(
        (req.body?.slot || req.query?.slot || "1") as string,
        10
      );
      if (![1, 2, 3].includes(slot)) {
        res.status(400).json({ error: "slot must be 1, 2, or 3" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const ref = db().collection("launch_records").doc(launch_id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }

      const ext =
        req.file.mimetype === "image/png"
          ? "png"
          : req.file.mimetype === "image/webp"
          ? "webp"
          : "jpg";
      const path = `launches/${launch_id}/image_${slot}.${ext}`;
      const bucket = admin.storage().bucket();
      await bucket.file(path).save(req.file.buffer, {
        contentType: req.file.mimetype,
        metadata: { launch_id, slot: String(slot) },
      });
      await bucket.file(path).makePublic().catch(() => {
        /* non-fatal */
      });
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${path}`;

      const field = `image_${slot}_url`;
      await ref.update({ [field]: publicUrl, updated_at: ts() });

      res.json({ launch_id, slot, url: publicUrl });
    } catch (err: any) {
      console.error("POST /launches/:id/images error:", err);
      res.status(500).json({ error: "Failed to upload image." });
    }
  }
);

// ────────────────────────────────────────────────
// POST /api/v1/launches/:launch_id/publish — readiness gate
// ────────────────────────────────────────────────
router.post(
  "/:launch_id/publish",
  requireAuth,
  requireRole(LAUNCH_EDITOR_ROLES),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { launch_id } = req.params;
      const ref = db().collection("launch_records").doc(launch_id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }
      const launch = { launch_id, ...snap.data() };
      const readiness = computeReadiness(launch);
      if (!readiness.ok) {
        res.status(400).json({
          blocked: true,
          missing: readiness.missing,
          checks: readiness.checks,
        });
        return;
      }

      await ref.update({
        launch_status: "published",
        published_at: ts(),
        updated_at: ts(),
      });

      const refreshed = await ref.get();
      const published = { launch_id, ...refreshed.data() };

      await writeAudit(
        "launch_published",
        launch_id,
        req.user?.uid || "system",
        { mpn: (published as any).mpn }
      );
      await notifyNewLaunch(published);

      res.json({ launch: published, published: true });
    } catch (err: any) {
      console.error("POST /launches/:id/publish error:", err);
      res.status(500).json({ error: "Failed to publish launch." });
    }
  }
);

// ────────────────────────────────────────────────
// POST /api/v1/launches/:launch_id/token-status
// ────────────────────────────────────────────────
router.post(
  "/:launch_id/token-status",
  requireAuth,
  requireRole(LAUNCH_EDITOR_ROLES),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { launch_id } = req.params;
      const { token_status } = req.body as { token_status?: string };
      if (!["Set", "Not Set"].includes(token_status || "")) {
        res
          .status(400)
          .json({ error: "token_status must be 'Set' or 'Not Set'" });
        return;
      }
      const ref = db().collection("launch_records").doc(launch_id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }
      await ref.update({ token_status, updated_at: ts() });
      res.json({ launch_id, token_status });
    } catch (err: any) {
      console.error("POST /launches/:id/token-status error:", err);
      res.status(500).json({ error: "Failed to update token status." });
    }
  }
);

// ────────────────────────────────────────────────
// POST /api/v1/launches/:launch_id/comments — any authenticated
// ────────────────────────────────────────────────
router.post(
  "/:launch_id/comments",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { launch_id } = req.params;
      const { comment_text } = req.body as { comment_text?: string };
      if (!comment_text || typeof comment_text !== "string") {
        res.status(400).json({ error: "comment_text is required" });
        return;
      }

      const ref = db().collection("launch_records").doc(launch_id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }

      const authorUid = req.user?.uid || "system";
      const authorName =
        (req.user as any)?.name ||
        (req.user as any)?.email ||
        authorUid;

      const commentRef = db().collection("launch_comments").doc();
      await commentRef.set({
        launch_id,
        comment_text,
        author_uid: authorUid,
        author_name: authorName,
        created_at: ts(),
      });

      await ref.update({
        internal_comments_count: admin.firestore.FieldValue.increment(1),
        updated_at: ts(),
      });

      const launch = { launch_id, ...snap.data() };
      await notifyNewComment(launch, comment_text, authorName);

      res.status(201).json({
        comment_id: commentRef.id,
        launch_id,
        comment_text,
        author_name: authorName,
      });
    } catch (err: any) {
      console.error("POST /launches/:id/comments error:", err);
      res.status(500).json({ error: "Failed to post comment." });
    }
  }
);

// ────────────────────────────────────────────────
// DELETE /api/v1/launches/:launch_id — archive (soft delete)
// ────────────────────────────────────────────────
router.delete(
  "/:launch_id",
  requireAuth,
  requireRole(LAUNCH_EDITOR_ROLES),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { launch_id } = req.params;
      const ref = db().collection("launch_records").doc(launch_id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Launch not found" });
        return;
      }
      await ref.update({
        launch_status: "archived",
        archived_at: ts(),
        updated_at: ts(),
      });

      const mpn = snap.data()?.mpn;
      if (mpn) await checkHighPriorityFlag(mpn);

      await writeAudit(
        "launch_archived",
        launch_id,
        req.user?.uid || "system",
        { mpn }
      );

      res.json({ launch_id, archived: true });
    } catch (err: any) {
      console.error("DELETE /launches/:id error:", err);
      res.status(500).json({ error: "Failed to archive launch." });
    }
  }
);

export default router;
