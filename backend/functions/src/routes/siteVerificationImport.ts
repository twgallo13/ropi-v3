/**
 * Site Verification — Step 2.5 Part 3.
 *   POST /upload                — parse CSV headers, stash in storage
 *   POST /:batch_id/commit      — apply site_verification updates to products
 *
 * Flexible column mapping via the same pattern as MAP Policy. Required columns
 * are MPN, Site, Product URL, Verification Date. Image URL is optional.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { parse } from "csv-parse/sync";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { mpnToDocId } from "../services/mpnUtils";
import { extractHeaders } from "../services/csvUtils";
import {
  respondAsync,
  runInBackground,
  finishImportJob,
  updateProgress,
} from "../services/importJobRunner";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const ts = () => admin.firestore.FieldValue.serverTimestamp();

const operatorRoles = ["operations_operator", "product_ops"];

// ── POST /upload ──
router.post(
  "/upload",
  requireAuth,
  requireRole(operatorRoles),
  upload.single("file"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded." });
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
      const dataRows = records.slice(1);

      const batchId = uuidv4();
      const firestore = admin.firestore();

      // Stash rows directly in the batch doc (these files are small)
      await firestore.collection("import_batches").doc(batchId).set({
        batch_id: batchId,
        family: "site_verification",
        status: "pending_mapping",
        raw_headers: rawHeaders,
        row_count: dataRows.length,
        raw_rows: dataRows.slice(0, 5000).map((r) => JSON.stringify(r)), // serialise to avoid Firestore nested-array ban
        committed_rows: 0,
        failed_rows: 0,
        errors: [],
        warnings: [],
        created_by: req.user?.uid || "system",
        created_at: ts(),
      });

      res.json({ batch_id: batchId, raw_headers: rawHeaders, row_count: dataRows.length });
    } catch (err: any) {
      console.error("Site verification upload error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── POST /:batch_id/commit ──
router.post(
  "/:batch_id/commit",
  requireAuth,
  requireRole(operatorRoles),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { batch_id } = req.params;
      const {
        column_mapping,
        global_site,
        global_verification_date,
      } = req.body || {};
      if (
        !column_mapping ||
        !column_mapping.mpn ||
        !column_mapping.product_url
      ) {
        res.status(400).json({
          error:
            "column_mapping.mpn and column_mapping.product_url are required",
        });
        return;
      }
      // Either per-row site column OR a global_site must be supplied.
      if (!column_mapping.site && !global_site) {
        res.status(400).json({
          error:
            "Either column_mapping.site or global_site is required",
        });
        return;
      }

      const firestore = admin.firestore();
      const batchRef = firestore.collection("import_batches").doc(batch_id);
      const batchSnap = await batchRef.get();
      if (!batchSnap.exists) {
        res.status(404).json({ error: `Batch ${batch_id} not found.` });
        return;
      }
      const batch = batchSnap.data()!;
      if (batch.family !== "site_verification") {
        res.status(400).json({ error: "Not a site_verification batch." });
        return;
      }

      const rawHeaders: string[] = batch.raw_headers || [];
      const rawRows: string[][] = (batch.raw_rows || []).map(
        (r: unknown) => (typeof r === "string" ? JSON.parse(r) : r) as string[]
      );
      const headerIndex: Record<string, number> = {};
      rawHeaders.forEach((h, i) => (headerIndex[h] = i));

      function cell(row: string[], header: string | undefined): string {
        if (!header) return "";
        const idx = headerIndex[header];
        return idx === undefined ? "" : (row[idx] || "").trim();
      }

      // Mark processing and respond immediately — the rest runs in the background.
      await batchRef.update({
        status: "processing",
        progress_pct: 0,
        processing_started_at: ts(),
      });
      const __userId = req.user?.uid || null;
      respondAsync(res, batch_id);

      runInBackground(batch_id, "site_verification", async () => {
        let committed = 0;
        const warnings: string[] = [];
        const errors: string[] = [];

        for (let i = 0; i < rawRows.length; i++) {
          if (i % 25 === 0) {
            await updateProgress(batch_id, (i / rawRows.length) * 100, {
              committed,
              failed: errors.length,
            });
          }
          const row = rawRows[i];
        const mpn = cell(row, column_mapping.mpn);
        const site =
          (column_mapping.site ? cell(row, column_mapping.site) : "") ||
          (typeof global_site === "string" ? global_site.trim() : "");
        const productUrl = cell(row, column_mapping.product_url);
        const imageUrl = column_mapping.image_url
          ? cell(row, column_mapping.image_url)
          : "";
        const additionalImageUrl = column_mapping.additional_image_url
          ? cell(row, column_mapping.additional_image_url)
          : "";
        const verificationDate =
          (column_mapping.verification_date
            ? cell(row, column_mapping.verification_date)
            : "") ||
          (typeof global_verification_date === "string"
            ? global_verification_date.trim()
            : "") ||
          new Date().toISOString().split("T")[0];

        if (!mpn) {
          errors.push(`Row ${i + 2}: missing MPN`);
          continue;
        }
        if (!site) {
          errors.push(`Row ${i + 2} (MPN ${mpn}): missing Site`);
          continue;
        }

        const docId = mpnToDocId(mpn);
        const productRef = firestore.collection("products").doc(docId);
        const prodSnap = await productRef.get();
        if (!prodSnap.exists) {
          warnings.push(`Row ${i + 2}: MPN ${mpn} not found in products — skipped`);
          continue;
        }

        const siteKey = site.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        const hasProductUrl = !!productUrl;
        const hasImageUrl = !!imageUrl;

        let verification_state = "verified_live";
        let mismatch_reason: string | null = null;
        if (hasProductUrl && !hasImageUrl) {
          verification_state = "mismatch";
          mismatch_reason = "image_missing";
        } else if (!hasProductUrl) {
          verification_state = "mismatch";
          mismatch_reason = "url_missing";
        }

        await productRef.set(
          {
            site_verification: {
              [siteKey]: {
                verification_state,
                product_url: hasProductUrl ? productUrl : null,
                image_url: hasImageUrl ? imageUrl : null,
                additional_image_url: additionalImageUrl || null,
                last_verified_at: ts(),
                verification_date: verificationDate,
                mismatch_reason,
              },
            },
          },
          { merge: true }
        );

        committed++;
      }

      await batchRef.update({
        status: "complete",
        committed_rows: committed,
        failed_rows: errors.length,
        errors,
        warnings,
        completed_at: ts(),
        column_mapping,
        global_site: global_site || null,
        global_verification_date: global_verification_date || null,
      });

      await firestore.collection("audit_log").add({
        event_type: "site_verification_import_committed",
        batch_id,
        committed_rows: committed,
        failed_rows: errors.length,
        acting_user_id: req.user?.uid || "system",
        source_type: "import",
        created_at: ts(),
      });

      await finishImportJob(
        batch_id,
        __userId,
        "site_verification",
        `Site Verification import complete — ${committed.toLocaleString()} committed, ${errors.length.toLocaleString()} failed`
      );
      });
    } catch (err: any) {
      console.error("Site verification commit error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  }
);

export default router;
