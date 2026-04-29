/**
 * Guided Tours — Admin CRUD (TALLY-SETTINGS-UX Phase 3 / A.3)
 *
 *   GET    /api/v1/admin/guided-tours              → list all tours
 *   GET    /api/v1/admin/guided-tours/:tour_id     → fetch single
 *   POST   /api/v1/admin/guided-tours              → create
 *   PUT    /api/v1/admin/guided-tours/:tour_id     → update (tour_id immutable)
 *   DELETE /api/v1/admin/guided-tours/:tour_id     → soft-delete (is_active=false)
 *
 * Mirror of A.2 site-registry canonical CRUD pattern.
 *
 * Doc shape (canonical):
 *   {
 *     tour_id: string (slug, doc-id),
 *     hub: "import_hub" | "completion_queue" | "cadence_review" | "launch_admin" | "export_center",
 *     title: string,
 *     is_active: boolean,
 *     steps: TourStep[]
 *   }
 *
 * TourStep:
 *   {
 *     target_selector: string,
 *     title: string,
 *     position?: "top" | "bottom" | "left" | "right",
 *     content: string
 *   }
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

const guidedToursRouter = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

const HUB_VALUES = [
  "import_hub",
  "completion_queue",
  "cadence_review",
  "launch_admin",
  "export_center",
] as const;
type Hub = (typeof HUB_VALUES)[number];

const POSITION_VALUES = ["top", "bottom", "left", "right"] as const;

interface TourStep {
  target_selector: string;
  title: string;
  position?: (typeof POSITION_VALUES)[number];
  content: string;
}

// ────────────────────────────────────────────────
// Audit helper — D.10 canonical shape with {before, after}
// ────────────────────────────────────────────────
async function writeGuidedTourAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: { before: any; after: any } & Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "guided_tours",
      entity_id: entityId,
      actor_uid: actorUid,
      details,
      timestamp: ts(),
    });
  } catch (err: any) {
    console.error("audit_log write failed:", err.message);
  }
}

// ────────────────────────────────────────────────
// Validation helpers
// ────────────────────────────────────────────────
function validateHub(hub: any): hub is Hub {
  return typeof hub === "string" && (HUB_VALUES as readonly string[]).includes(hub);
}

function validateSteps(steps: any): { ok: true; value: TourStep[] } | { ok: false; error: string } {
  if (!Array.isArray(steps)) {
    return { ok: false, error: "steps must be an array" };
  }
  const cleaned: TourStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s || typeof s !== "object") {
      return { ok: false, error: `steps[${i}] must be an object` };
    }
    if (typeof s.target_selector !== "string" || s.target_selector.trim() === "") {
      return { ok: false, error: `steps[${i}].target_selector required (non-empty string)` };
    }
    if (typeof s.title !== "string" || s.title.trim() === "") {
      return { ok: false, error: `steps[${i}].title required (non-empty string)` };
    }
    if (typeof s.content !== "string" || s.content.trim() === "") {
      return { ok: false, error: `steps[${i}].content required (non-empty string)` };
    }
    if (
      s.position !== undefined &&
      !(POSITION_VALUES as readonly string[]).includes(s.position)
    ) {
      return {
        ok: false,
        error: `steps[${i}].position must be one of ${POSITION_VALUES.join(", ")}`,
      };
    }
    const step: TourStep = {
      target_selector: s.target_selector.trim(),
      title: s.title.trim(),
      content: s.content.trim(),
    };
    if (s.position !== undefined) step.position = s.position;
    cleaned.push(step);
  }
  return { ok: true, value: cleaned };
}

// ────────────────────────────────────────────────
// GET /api/v1/admin/guided-tours — list all
// ────────────────────────────────────────────────
guidedToursRouter.get(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const snap = await db().collection("guided_tours").get();
      const tours = snap.docs
        .map((d) => {
          const data = d.data() || {};
          return {
            tour_id: data.tour_id || d.id,
            hub: data.hub,
            title: data.title,
            is_active: data.is_active === true,
            steps: Array.isArray(data.steps) ? data.steps : [],
          };
        })
        .sort((a, b) => String(a.tour_id).localeCompare(String(b.tour_id)));
      res.json({ tours });
    } catch (err: any) {
      console.error("GET /admin/guided-tours error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// GET /api/v1/admin/guided-tours/:tour_id — fetch single
// ────────────────────────────────────────────────
guidedToursRouter.get(
  "/:tour_id",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const ref = db().collection("guided_tours").doc(req.params.tour_id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: `tour "${req.params.tour_id}" not found` });
        return;
      }
      res.json({ tour: snap.data() });
    } catch (err: any) {
      console.error("GET /admin/guided-tours/:tour_id error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// POST /api/v1/admin/guided-tours — create new tour
// ────────────────────────────────────────────────
guidedToursRouter.post(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const { tour_id, hub, title, steps } = body;

      if (typeof tour_id !== "string" || tour_id.trim() === "") {
        res.status(400).json({ error: "tour_id is required (non-empty string)" });
        return;
      }
      if (!validateHub(hub)) {
        res
          .status(400)
          .json({ error: `hub must be one of ${HUB_VALUES.join(", ")}` });
        return;
      }
      if (typeof title !== "string" || title.trim() === "") {
        res.status(400).json({ error: "title is required (non-empty string)" });
        return;
      }
      const stepsRes = validateSteps(steps);
      if (!stepsRes.ok) {
        res.status(400).json({ error: stepsRes.error });
        return;
      }

      const key = tour_id.trim();
      const ref = db().collection("guided_tours").doc(key);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "tour_id already exists" });
        return;
      }

      const payload: Record<string, any> = {
        tour_id: key,
        hub,
        title: title.trim(),
        is_active: typeof body.is_active === "boolean" ? body.is_active : true,
        steps: stepsRes.value,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      await writeGuidedTourAudit("guided_tours_created", key, req.user!.uid, {
        before: null,
        after: {
          tour_id: key,
          hub,
          title: payload.title,
          is_active: payload.is_active,
          steps_count: stepsRes.value.length,
        },
      });

      const refetched = (await ref.get()).data();
      res.status(201).json({ tour: refetched });
    } catch (err: any) {
      console.error("POST /admin/guided-tours error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// PUT /api/v1/admin/guided-tours/:tour_id — update (tour_id immutable)
// ────────────────────────────────────────────────
guidedToursRouter.put(
  "/:tour_id",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = req.params.tour_id;

      if (body.tour_id !== undefined && body.tour_id !== pathKey) {
        res.status(400).json({ error: "tour_id is immutable" });
        return;
      }

      if (body.hub !== undefined && !validateHub(body.hub)) {
        res
          .status(400)
          .json({ error: `hub must be one of ${HUB_VALUES.join(", ")}` });
        return;
      }
      if (body.title !== undefined) {
        if (typeof body.title !== "string" || body.title.trim() === "") {
          res.status(400).json({ error: "title must be a non-empty string" });
          return;
        }
      }
      let validatedSteps: TourStep[] | undefined;
      if (body.steps !== undefined) {
        const stepsRes = validateSteps(body.steps);
        if (!stepsRes.ok) {
          res.status(400).json({ error: stepsRes.error });
          return;
        }
        validatedSteps = stepsRes.value;
      }

      const ref = db().collection("guided_tours").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `tour "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      const patch: Record<string, any> = {};
      if (body.hub !== undefined) patch.hub = body.hub;
      if (body.title !== undefined) patch.title = body.title.trim();
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      if (validatedSteps !== undefined) patch.steps = validatedSteps;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      const afterSnap = await ref.get();
      const afterData = afterSnap.data() || {};

      await writeGuidedTourAudit("guided_tours_updated", pathKey, req.user!.uid, {
        before: {
          hub: beforeData.hub,
          title: beforeData.title,
          is_active: beforeData.is_active,
          steps_count: Array.isArray(beforeData.steps) ? beforeData.steps.length : 0,
        },
        after: {
          hub: afterData.hub,
          title: afterData.title,
          is_active: afterData.is_active,
          steps_count: Array.isArray(afterData.steps) ? afterData.steps.length : 0,
        },
        patch_keys: Object.keys(patch),
      });

      res.status(200).json({ tour: afterData });
    } catch (err: any) {
      console.error("PUT /admin/guided-tours/:tour_id error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// DELETE /api/v1/admin/guided-tours/:tour_id — soft deactivation
// ────────────────────────────────────────────────
guidedToursRouter.delete(
  "/:tour_id",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.tour_id;
      const ref = db().collection("guided_tours").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `tour "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      await ref.set(
        {
          is_active: false,
          updated_at: ts(),
          updated_by: req.user!.uid,
        },
        { merge: true }
      );

      const afterSnap = await ref.get();
      const afterData = afterSnap.data() || {};

      await writeGuidedTourAudit("guided_tours_deleted", pathKey, req.user!.uid, {
        before: { is_active: beforeData.is_active },
        after: { is_active: afterData.is_active },
        tour_id: pathKey,
      });

      res.status(200).json({ tour: afterData });
    } catch (err: any) {
      console.error("DELETE /admin/guided-tours/:tour_id error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default guidedToursRouter;
