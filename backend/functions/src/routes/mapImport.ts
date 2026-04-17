/**
 * MAP Policy Import — Step 2.1 Part 1.
 *   POST /upload                        — parse headers only, return raw headers
 *   POST /:batch_id/map-columns         — save column mapping, optionally save template
 *   POST /:batch_id/commit              — write map_policies + update product MAP fields
 *
 * Section 14.4 — MAP Policy pipeline. No invented behavior.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { parse } from "csv-parse/sync";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { mpnToDocId } from "../services/mpnUtils";
import { queueForPricingExport } from "../services/pricingExportQueue";
import { extractHeaders } from "../services/csvUtils";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const ts = () => admin.firestore.FieldValue.serverTimestamp();

// ── POST /upload ──
router.post(
  "/upload",
  requireAuth,
  requireRole(["map_analyst"]),
  upload.single("file"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded. Please attach a CSV file." });
        return;
      }

      const csvContent = file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as string[][];

      if (records.length < 1) {
        res.status(400).json({ error: "CSV file is empty." });
        return;
      }

      const rawHeaders = extractHeaders(records).map((h) => h.trim().replace(/^\uFEFF/, ""));
      const rowCount = Math.max(records.length - 1, 0);

      const batchId = uuidv4();
      const filename = file.originalname || "map-policy.csv";
      const filePath = `imports/map-policy/${batchId}/${filename}`;

      const bucket = admin.storage().bucket();
      await bucket.file(filePath).save(file.buffer, {
        contentType: "text/csv",
        metadata: { batch_id: batchId },
      });

      const firestore = admin.firestore();
      await firestore.collection("import_batches").doc(batchId).set({
        batch_id: batchId,
        family: "map_policy",
        status: "pending_mapping",
        file_path: filePath,
        raw_headers: rawHeaders,
        row_count: rowCount,
        committed_rows: 0,
        failed_rows: 0,
        errors: [],
        warnings: [],
        created_by: req.user?.uid || "system",
        created_at: ts(),
        completed_at: null,
      });

      res.status(200).json({
        batch_id: batchId,
        raw_headers: rawHeaders,
        row_count: rowCount,
      });
    } catch (err: any) {
      console.error("MAP upload error:", err);
      res.status(500).json({ error: "An unexpected error occurred during file upload." });
    }
  }
);

// ── POST /:batch_id/map-columns ──
router.post(
  "/:batch_id/map-columns",
  requireAuth,
  requireRole(["map_analyst"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { batch_id } = req.params;
      const { column_mapping, save_template, template_name } = req.body || {};
      const firestore = admin.firestore();

      if (
        !column_mapping ||
        !column_mapping.mpn ||
        !column_mapping.brand ||
        !column_mapping.map_price
      ) {
        res.status(400).json({
          error:
            "column_mapping.mpn, column_mapping.brand, and column_mapping.map_price are required",
        });
        return;
      }

      const batchRef = firestore.collection("import_batches").doc(batch_id);
      const batchSnap = await batchRef.get();
      if (!batchSnap.exists) {
        res.status(404).json({ error: `Batch ${batch_id} not found.` });
        return;
      }
      const batchData = batchSnap.data()!;
      if (batchData.family !== "map_policy") {
        res.status(400).json({ error: `Batch ${batch_id} is not a MAP Policy batch.` });
        return;
      }
      if (batchData.status !== "pending_mapping") {
        res.status(409).json({
          error: `Batch ${batch_id} is in status "${batchData.status}" and cannot accept column mapping.`,
        });
        return;
      }

      await batchRef.update({
        status: "ready_to_commit",
        column_mapping,
        column_mapping_saved_at: ts(),
      });

      let templateId: string | null = null;
      if (save_template && template_name) {
        const templateRef = await firestore.collection("map_import_templates").add({
          template_name,
          brand: column_mapping.brand_literal || null,
          column_mapping,
          created_by: req.user?.uid || "system",
          created_at: ts(),
        });
        templateId = templateRef.id;
      }

      res.status(200).json({
        batch_id,
        status: "ready_to_commit",
        template_id: templateId,
      });
    } catch (err: any) {
      console.error("MAP map-columns error:", err);
      res.status(500).json({ error: "An unexpected error occurred." });
    }
  }
);

// ── POST /:batch_id/commit ──
router.post(
  "/:batch_id/commit",
  requireAuth,
  requireRole(["map_analyst"]),
  async (req: AuthenticatedRequest, res: Response) => {
    const { batch_id } = req.params;
    const firestore = admin.firestore();
    const userId = req.user?.uid || "system";

    try {
      const batchRef = firestore.collection("import_batches").doc(batch_id);
      const batchSnap = await batchRef.get();
      if (!batchSnap.exists) {
        res.status(404).json({ error: `Batch ${batch_id} not found.` });
        return;
      }
      const batchData = batchSnap.data()!;
      if (batchData.family !== "map_policy") {
        res.status(400).json({ error: `Batch ${batch_id} is not a MAP Policy batch.` });
        return;
      }
      if (batchData.status === "processing") {
        res.status(409).json({ error: `Batch ${batch_id} is already being processed.` });
        return;
      }
      if (batchData.status === "complete") {
        res.status(409).json({ error: `Batch ${batch_id} has already been committed.` });
        return;
      }
      if (batchData.status !== "ready_to_commit") {
        res.status(409).json({
          error: `Batch ${batch_id} must be in "ready_to_commit" status (current: "${batchData.status}"). Submit column mapping first.`,
        });
        return;
      }

      const mapping = batchData.column_mapping || {};

      await batchRef.update({ status: "processing" });

      const bucket = admin.storage().bucket();
      const [fileBuffer] = await bucket.file(batchData.file_path).download();
      const csvContent = fileBuffer.toString("utf-8");

      // Parse CSV with headers as-is (no canonicalization — user mapped manually)
      const records = parse(csvContent, {
        columns: (header: string[]) =>
          header.map((h: string) => h.trim().replace(/^\uFEFF/, "")),
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      }) as Record<string, string>[];

      const getField = (row: Record<string, string>, col: string | null | undefined) => {
        if (!col) return "";
        return (row[col] ?? "").toString().trim();
      };

      const errors: Array<{ row: number; mpn: string; error: string }> = [];
      let committedRows = 0;
      let failedRows = 0;
      const committedMpns: string[] = [];

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const rowNum = i + 2; // +1 header, +1 one-indexed

        const mpn = getField(row, mapping.mpn);
        if (!mpn) {
          failedRows++;
          errors.push({ row: rowNum, mpn: "", error: "MPN is required — this row has no product identifier" });
          continue;
        }

        const brand = getField(row, mapping.brand);
        const mapPriceRaw = getField(row, mapping.map_price);
        const mapPrice = parseFloat(mapPriceRaw);
        if (!mapPriceRaw || isNaN(mapPrice) || mapPrice <= 0) {
          failedRows++;
          errors.push({
            row: rowNum,
            mpn,
            error: `MAP price must be a positive number (got "${mapPriceRaw}")`,
          });
          continue;
        }

        const startDate = mapping.start_date ? getField(row, mapping.start_date) : null;
        const endDate = mapping.end_date ? getField(row, mapping.end_date) : null;
        const promoPriceRaw = mapping.promo_price
          ? getField(row, mapping.promo_price)
          : "";
        const promoPrice =
          promoPriceRaw && !isNaN(parseFloat(promoPriceRaw))
            ? parseFloat(promoPriceRaw)
            : null;

        const normStart = startDate && startDate !== "" ? startDate : null;
        const normEnd = endDate && endDate !== "" ? endDate : null;
        const isAlwaysOn = !normStart && !normEnd;

        const docId = mpnToDocId(mpn);
        const productRef = firestore.collection("products").doc(docId);
        const productSnap = await productRef.get();
        if (!productSnap.exists) {
          failedRows++;
          errors.push({
            row: rowNum,
            mpn,
            error: `MPN ${mpn} not found in catalog — check MPN format or verify the product exists`,
          });
          continue;
        }

        try {
          // Write map_policies document (one per MPN per batch — supports multiple terms per MPN)
          await firestore
            .collection("map_policies")
            .doc(`${docId}_${batch_id}_${i}`)
            .set({
              mpn,
              brand,
              map_price: mapPrice,
              promo_price: promoPrice,
              start_date: normStart,
              end_date: normEnd,
              is_always_on: isAlwaysOn,
              source_batch_id: batch_id,
              created_at: ts(),
              updated_at: ts(),
            });

          // Update product with latest MAP state
          await productRef.set(
            {
              is_map_protected: true,
              map_price: mapPrice,
              map_promo_price: promoPrice,
              map_start_date: normStart,
              map_end_date: normEnd,
              map_is_always_on: isAlwaysOn,
              map_last_updated_at: ts(),
              map_source_batch_id: batch_id,
              // Clear any prior removal proposal now that this MPN is back in the file
              map_removal_proposed: false,
              map_removal_proposed_at: null,
              map_removal_source_batch: null,
            },
            { merge: true }
          );

          await queueForPricingExport(mpn, "map_change", userId, normStart);

          await firestore.collection("audit_log").add({
            product_mpn: mpn,
            event_type: "map_policy_imported",
            map_price: mapPrice,
            promo_price: promoPrice,
            start_date: normStart,
            end_date: normEnd,
            is_always_on: isAlwaysOn,
            source_batch_id: batch_id,
            acting_user_id: userId,
            created_at: ts(),
          });

          committedRows++;
          committedMpns.push(mpn);
        } catch (rowErr: any) {
          failedRows++;
          errors.push({
            row: rowNum,
            mpn,
            error:
              "An unexpected error occurred while processing this row. Please verify the data and try again.",
          });
          console.error(`MAP commit row ${rowNum} (MPN: ${mpn}) error:`, rowErr);
        }
      }

      // MAP REMOVAL REVIEW — any currently-protected MPN absent from this import
      let removalProposed = 0;
      const previouslyMapped = await firestore
        .collection("products")
        .where("is_map_protected", "==", true)
        .get();
      const committedSet = new Set(committedMpns);
      for (const doc of previouslyMapped.docs) {
        const d = doc.data();
        if (!committedSet.has(d.mpn)) {
          await doc.ref.set(
            {
              map_removal_proposed: true,
              map_removal_proposed_at: ts(),
              map_removal_source_batch: batch_id,
            },
            { merge: true }
          );
          removalProposed++;
        }
      }

      const finalStatus = failedRows === records.length ? "failed" : "complete";
      await batchRef.update({
        status: finalStatus,
        committed_rows: committedRows,
        failed_rows: failedRows,
        errors,
        completed_at: ts(),
        summary: { removal_proposed: removalProposed },
      });

      res.status(200).json({
        batch_id,
        status: finalStatus,
        total_rows: records.length,
        committed_rows: committedRows,
        failed_rows: failedRows,
        removal_proposed: removalProposed,
        errors,
      });
    } catch (err: any) {
      console.error("MAP commit error:", err);
      try {
        await admin.firestore().collection("import_batches").doc(batch_id).update({
          status: "failed",
          errors: [{ error: "An unexpected error occurred during commit processing." }],
          completed_at: ts(),
        });
      } catch (_) {
        // best effort
      }
      res.status(500).json({
        error: "An unexpected error occurred during batch commit. Please try again.",
      });
    }
  }
);

// ── GET /templates — list saved templates ──
router.get(
  "/templates",
  requireAuth,
  requireRole(["map_analyst"]),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const snap = await admin
        .firestore()
        .collection("map_import_templates")
        .orderBy("created_at", "desc")
        .limit(50)
        .get();
      res.json({
        templates: snap.docs.map((d) => ({
          id: d.id,
          template_name: d.data().template_name,
          brand: d.data().brand || null,
          column_mapping: d.data().column_mapping,
        })),
      });
    } catch (err: any) {
      console.error("MAP templates error:", err);
      res.status(500).json({ error: "Failed to load templates." });
    }
  }
);

export default router;
