import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { mpnToDocId } from "../services/mpnUtils";
import { generateContent, getActiveAdapter } from "../services/aiDescribe";

const router = Router();
const db = admin.firestore;

// POST /api/v1/products/:mpn/ai-describe
// Correction 2: accepts site_owners: string[] and runs all in parallel
router.post(
  "/:mpn/ai-describe",
  requireAuth,
  requireRole(["admin", "completion_specialist", "operations_operator"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mpn = decodeURIComponent(req.params.mpn);
      const { site_owners, observations_note } = req.body;

      if (!site_owners || !Array.isArray(site_owners) || site_owners.length === 0) {
        res.status(400).json({ error: "site_owners array is required" });
        return;
      }

      const userId = req.user?.uid || "unknown";

      const results = await Promise.all(
        site_owners.map((siteOwner: string) =>
          generateContent(mpn, siteOwner, userId, observations_note)
        )
      );

      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

// GET /api/v1/products/:mpn/content-versions?site_owner=shiekh
router.get(
  "/:mpn/content-versions",
  requireAuth,
  requireRole(["admin", "completion_specialist", "operations_operator"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mpn = decodeURIComponent(req.params.mpn);
      const siteOwner = req.query.site_owner as string;
      const docId = mpnToDocId(mpn);

      let query: admin.firestore.Query = db()
        .collection("products")
        .doc(docId)
        .collection("content_versions");

      if (siteOwner) {
        query = query.where("site_owner", "==", siteOwner);
      }

      const snap = await query.get();
      const versions = snap.docs
        .map((d) => ({
          version_id: d.id,
          ...d.data(),
        }))
        .sort((a: any, b: any) => {
          const aTime = a.generated_at?._seconds || 0;
          const bTime = b.generated_at?._seconds || 0;
          return bTime - aTime;
        });

      res.json({ versions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

// POST /api/v1/products/:mpn/content-versions/:version_id/approve
// Correction 3: check requires_review before self-approving
router.post(
  "/:mpn/content-versions/:version_id/approve",
  requireAuth,
  requireRole(["admin", "completion_specialist", "operations_operator"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mpn = decodeURIComponent(req.params.mpn);
      const { version_id } = req.params;
      const docId = mpnToDocId(mpn);
      const userId = req.user?.uid || "unknown";

      const versionRef = db()
        .collection("products")
        .doc(docId)
        .collection("content_versions")
        .doc(version_id);

      const versionDoc = await versionRef.get();
      if (!versionDoc.exists) {
        res.status(404).json({ error: "Version not found" });
        return;
      }

      const versionData = versionDoc.data()!;
      if (versionData.approval_state === "approved") {
        res.status(400).json({ error: "Version already approved" });
        return;
      }

      // Correction 3: Check requires_review flag on user
      const userDoc = await db().collection("users").doc(userId).get();
      const requiresReview = userDoc.exists
        ? userDoc.data()?.requires_review === true
        : false;

      if (requiresReview) {
        await versionRef.update({
          approval_state: "review_pending",
          review_requested_by: userId,
          review_requested_at: db.FieldValue.serverTimestamp(),
        });

        await db().collection("audit_log").add({
          product_mpn: mpn,
          event_type: "ai_content_review_requested",
          site_owner: versionData.site_owner,
          version_id,
          requested_by: userId,
          created_at: db.FieldValue.serverTimestamp(),
        });

        res.json({
          status: "review_pending",
          message: "Content submitted for review approval",
        });
        return;
      }

      // Standard approval flow
      await versionRef.update({
        approval_state: "approved",
        approved_by: userId,
        approved_at: db.FieldValue.serverTimestamp(),
      });

      // Write approved content to attribute_values
      const parsed = versionData.parsed_output || {};
      const productRef = db().collection("products").doc(docId);

      const contentFieldMap: Record<string, string> = {
        description: "ai_generated_description",
        meta_name: "ai_seo_title",
        meta_description: "ai_seo_meta",
        keywords: "keywords",
      };

      for (const [outputKey, attrKey] of Object.entries(contentFieldMap)) {
        if (parsed[outputKey]) {
          await productRef.collection("attribute_values").doc(attrKey).set(
            {
              value: parsed[outputKey],
              origin_type: "AI-Generated",
              verification_state: "Human-Verified",
              origin_detail: `AI Describe — ${versionData.template_name} — approved by ${userId}`,
              written_at: db.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      // Write audit_log
      await db().collection("audit_log").add({
        product_mpn: mpn,
        event_type: "ai_content_approved",
        site_owner: versionData.site_owner,
        version_id,
        template_name: versionData.template_name,
        approved_by: userId,
        created_at: db.FieldValue.serverTimestamp(),
      });

      // Clear needs_ai_review if present
      await productRef.update({
        needs_ai_review: admin.firestore.FieldValue.delete(),
        ai_review_reason: admin.firestore.FieldValue.delete(),
      });

      res.json({ status: "approved", message: "Content approved and written" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

// POST /api/v1/products/:mpn/content-versions/:version_id/reject
router.post(
  "/:mpn/content-versions/:version_id/reject",
  requireAuth,
  requireRole(["admin", "completion_specialist", "operations_operator"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mpn = decodeURIComponent(req.params.mpn);
      const { version_id } = req.params;
      const docId = mpnToDocId(mpn);
      const userId = req.user?.uid || "unknown";

      const versionRef = db()
        .collection("products")
        .doc(docId)
        .collection("content_versions")
        .doc(version_id);

      const versionDoc = await versionRef.get();
      if (!versionDoc.exists) {
        res.status(404).json({ error: "Version not found" });
        return;
      }

      await versionRef.update({
        approval_state: "rejected",
        rejected_by: userId,
        rejected_at: db.FieldValue.serverTimestamp(),
        rejection_reason: req.body.reason || null,
      });

      const versionData = versionDoc.data()!;
      await db().collection("audit_log").add({
        product_mpn: mpn,
        event_type: "ai_content_rejected",
        site_owner: versionData.site_owner,
        version_id,
        rejected_by: userId,
        reason: req.body.reason || null,
        created_at: db.FieldValue.serverTimestamp(),
      });

      res.json({ status: "rejected", message: "Content rejected" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

// POST /api/v1/products/:mpn/content-versions/:version_id/edit
router.post(
  "/:mpn/content-versions/:version_id/edit",
  requireAuth,
  requireRole(["admin", "completion_specialist", "operations_operator"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mpn = decodeURIComponent(req.params.mpn);
      const { version_id } = req.params;
      const docId = mpnToDocId(mpn);
      const userId = req.user?.uid || "unknown";

      const versionRef = db()
        .collection("products")
        .doc(docId)
        .collection("content_versions")
        .doc(version_id);

      const versionDoc = await versionRef.get();
      if (!versionDoc.exists) {
        res.status(404).json({ error: "Version not found" });
        return;
      }

      const { description, meta_name, meta_description, keywords } = req.body;
      const existingParsed = versionDoc.data()!.parsed_output || {};

      const updatedParsed = {
        ...existingParsed,
        ...(description !== undefined && { description }),
        ...(meta_name !== undefined && { meta_name }),
        ...(meta_description !== undefined && { meta_description }),
        ...(keywords !== undefined && { keywords }),
      };

      await versionRef.update({
        parsed_output: updatedParsed,
        operator_edited: true,
        edited_by: userId,
        edited_at: db.FieldValue.serverTimestamp(),
      });

      res.json({ status: "edited", parsed_output: updatedParsed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

// POST /api/v1/products/:mpn/content-versions/:version_id/restore
router.post(
  "/:mpn/content-versions/:version_id/restore",
  requireAuth,
  requireRole(["admin", "completion_specialist", "operations_operator"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mpn = decodeURIComponent(req.params.mpn);
      const { version_id } = req.params;
      const docId = mpnToDocId(mpn);
      const userId = req.user?.uid || "unknown";

      const sourceRef = db()
        .collection("products")
        .doc(docId)
        .collection("content_versions")
        .doc(version_id);

      const sourceDoc = await sourceRef.get();
      if (!sourceDoc.exists) {
        res.status(404).json({ error: "Version not found" });
        return;
      }

      const sourceData = sourceDoc.data()!;

      // Count existing versions for this site
      const existingVersions = await db()
        .collection("products")
        .doc(docId)
        .collection("content_versions")
        .where("site_owner", "==", sourceData.site_owner)
        .get();

      // Create a new version with restored content
      const newVersionRef = await db()
        .collection("products")
        .doc(docId)
        .collection("content_versions")
        .add({
          site_owner: sourceData.site_owner,
          template_id: sourceData.template_id,
          template_name: sourceData.template_name,
          tone_profile: sourceData.tone_profile,
          generated_at: db.FieldValue.serverTimestamp(),
          generated_by: userId,
          inputs_used: sourceData.inputs_used,
          raw_output: sourceData.raw_output,
          parsed_output: sourceData.parsed_output,
          banned_words_found: sourceData.banned_words_found || [],
          approval_state: "pending",
          approved_by: null,
          approved_at: null,
          version_number: existingVersions.size + 1,
          restored_from_version: version_id,
          restored_from_version_number: sourceData.version_number,
        });

      res.json({
        status: "restored",
        new_version_id: newVersionRef.id,
        version_number: existingVersions.size + 1,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

// POST /api/v1/products/:mpn/ai-assistant
router.post(
  "/:mpn/ai-assistant",
  requireAuth,
  requireRole(["admin", "completion_specialist", "operations_operator"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const mpn = decodeURIComponent(req.params.mpn);
      const { message, image_data } = req.body;
      const docId = mpnToDocId(mpn);

      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      const productDoc = await db()
        .collection("products")
        .doc(docId)
        .get();
      const product = productDoc.data();

      if (!product) {
        res.status(404).json({ error: "Product not found" });
        return;
      }

      // Build user message
      const userMessage = image_data
        ? `[Image attached] ${message}`
        : message;

      const systemPrompt = `You are a product specialist assistant helping a retail operator complete product information for ${product.name || "this product"} by ${product.brand || "unknown brand"}. 
Provide vocabulary, terminology, and visual analysis support. 
IMPORTANT: You are providing suggestions only. Never instruct the user to update any field directly — always phrase suggestions as observations the user can choose to apply.`;

      const adapter = await getActiveAdapter();
      const responseText = await adapter.complete(userMessage, systemPrompt, image_data || undefined);

      // Return assistant response — do NOT write to any product fields
      res.json({ response: responseText });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

export default router;
