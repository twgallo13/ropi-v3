/**
 * Export Routes — Step 1.7
 * POST /daily/trigger       — Run eligibility gate + serialize + upload
 * POST /notify-buyer         — Notify buyer of blocked product
 * POST /promote-scheduled    — Manual trigger for scheduled promotion job
 * GET  /jobs                 — List past export jobs
 * GET  /pending              — Preview eligible + blocked products
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import {
  getExportEligibleProducts,
} from "../services/exportEligibility";
import { serializeProduct, ExportRow } from "../services/exportSerializer";
import { promoteScheduledItems } from "../services/scheduledPromotion";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

// ── GET /api/v1/exports/pending — Preview eligible + blocked ──
router.get("/pending", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { eligible, blocked } = await getExportEligibleProducts();

    const pending = eligible.map((doc) => {
      const p = doc.data();
      return {
        mpn: p.mpn || doc.id,
        name: p.name || "",
        brand: p.brand || "",
        pricing_domain_state: p.pricing_domain_state,
        rics_offer: p.rics_offer || 0,
        scom: p.scom || 0,
      };
    });

    res.json({ pending, blocked, pending_count: pending.length, blocked_count: blocked.length });
  } catch (err: any) {
    console.error("GET /exports/pending error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/v1/exports/daily/trigger — Full export ──
router.post("/daily/trigger", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.uid;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // 1. Create export_jobs document
  let jobRef: FirebaseFirestore.DocumentReference;
  try {
    jobRef = await db().collection("export_jobs").add({
      status: "processing",
      triggered_by: userId,
      triggered_at: ts(),
      eligible_count: 0,
      blocked_count: 0,
      serialized_count: 0,
      failed_count: 0,
      blocked_products: [],
      errors: [],
    });
  } catch (err: any) {
    console.error("POST /exports/daily/trigger — failed to create job:", err);
    res.status(500).json({ error: err.message });
    return;
  }

  try {

    // 2. Run eligibility gate
    const { eligible, blocked } = await getExportEligibleProducts();

    // 3. Serialize each eligible product
    const rows: ExportRow[] = [];
    const errors: Array<{ mpn: string; error: string }> = [];

    for (const product of eligible) {
      try {
        const mpn = product.data().mpn || product.id;
        const row = await serializeProduct(mpn);
        rows.push(row);

        // Mark product as exported
        await db()
          .collection("products")
          .doc(product.id)
          .set(
            {
              pricing_domain_state: "exported",
              last_exported_at: ts(),
              export_job_id: jobRef.id,
            },
            { merge: true }
          );
      } catch (err: any) {
        errors.push({
          mpn: product.data().mpn || product.id,
          error: err.message,
        });
      }
    }

    // 4. Write export payload to Firebase Storage
    const dateStr = new Date().toISOString().split("T")[0];
    const timestamp = Date.now();
    const filename = `exports/daily/${dateStr}_${timestamp}_export.json`;
    const bucket = admin.storage().bucket();
    const file = bucket.file(filename);
    await file.save(JSON.stringify(rows, null, 2), {
      contentType: "application/json",
    });

    // Make file publicly readable and build download URL
    await file.makePublic();
    const bucketName = bucket.name;
    const downloadUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(filename)}`;

    // 5. Update export_jobs document
    const finalStatus =
      errors.length > 0 ? "complete_with_errors" : "complete";
    await jobRef.update({
      status: finalStatus,
      completed_at: ts(),
      eligible_count: eligible.length,
      blocked_count: blocked.length,
      serialized_count: rows.length,
      failed_count: errors.length,
      blocked_products: blocked,
      errors,
      output_file: filename,
      download_url: downloadUrl,
    });

    // 6. Write audit_log entry
    await db().collection("audit_log").add({
      event_type: "daily_export_triggered",
      triggered_by: userId,
      job_id: jobRef.id,
      serialized_count: rows.length,
      blocked_count: blocked.length,
      created_at: ts(),
    });

    res.status(200).json({
      job_id: jobRef.id,
      status: finalStatus,
      serialized: rows.length,
      blocked: blocked.length,
      blocked_products: blocked,
      errors,
      output_file: filename,
      download_url: downloadUrl,
    });
  } catch (err: any) {
    console.error("POST /exports/daily/trigger error:", err);
    // Mark job as failed so the Export Center shows the failure
    try {
      await jobRef.update({
        status: "failed",
        completed_at: ts(),
        error_message: err.message,
      });
    } catch (updateErr: any) {
      console.error("Failed to update job status to failed:", updateErr);
    }
    res.status(500).json({ error: err.message, job_id: jobRef.id, status: "failed" });
  }
});

// ── POST /api/v1/exports/notify-buyer ──
router.post("/notify-buyer", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { mpn } = req.body;
    if (!mpn) {
      res.status(400).json({ error: "mpn is required" });
      return;
    }

    // Look up the product
    const docId = mpn.replace(/\//g, "__");
    const doc = await db().collection("products").doc(docId).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const product = doc.data()!;
    const siteOwner = product.site_owner || null;
    const department = product.department || null;

    // Find buyer assigned to this site_owner + department
    // In Phase 1, write to a general notifications collection
    const notifRef = await db().collection("notifications").add({
      type: "buyer_discrepancy_alert",
      mpn,
      product_name: product.name || "",
      site_owner: siteOwner,
      department,
      notified_by: userId,
      read: false,
      created_at: ts(),
    });

    // Write audit_log entry
    await db().collection("audit_log").add({
      event_type: "buyer_notified_of_discrepancy",
      product_mpn: mpn,
      notified_by: userId,
      site_owner: siteOwner,
      created_at: ts(),
    });

    res.json({
      status: "success",
      notification_id: notifRef.id,
      mpn,
      site_owner: siteOwner,
    });
  } catch (err: any) {
    console.error("POST /exports/notify-buyer error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/v1/exports/promote-scheduled — Manual trigger ──
router.post("/promote-scheduled", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const result = await promoteScheduledItems();

    await db().collection("audit_log").add({
      event_type: "scheduled_promotion_manual",
      triggered_by: userId,
      promoted: result.promoted,
      skipped: result.skipped,
      errors: result.errors,
      created_at: ts(),
    });

    res.json(result);
  } catch (err: any) {
    console.error("POST /exports/promote-scheduled error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/v1/exports/jobs — List past export jobs ──
router.get("/jobs", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await db()
      .collection("export_jobs")
      .orderBy("triggered_at", "desc")
      .limit(50)
      .get();

    const jobs = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        status: d.status,
        triggered_by: d.triggered_by,
        triggered_at: d.triggered_at?.toDate?.()?.toISOString() || null,
        completed_at: d.completed_at?.toDate?.()?.toISOString() || null,
        serialized_count: d.serialized_count || 0,
        blocked_count: d.blocked_count || 0,
        failed_count: d.failed_count || 0,
        output_file: d.output_file || null,
        download_url: d.download_url || null,
      };
    });

    res.json({ jobs });
  } catch (err: any) {
    console.error("GET /exports/jobs error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
