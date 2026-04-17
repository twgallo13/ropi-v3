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

// ── Available target fields the UI can map columns onto ──
export const MAP_TARGET_FIELDS = [
  { key: "mpn",         label: "MPN (required)" },
  { key: "brand",       label: "Brand" },
  { key: "map_price",   label: "MAP Price (required)" },
  { key: "promo_price", label: "Promo Price (optional)" },
  { key: "start_date",  label: "Start Date (optional)" },
  { key: "end_date",    label: "End Date (optional)" },
] as const;

// Auto-mapping table — lower-cased CSV header → canonical target key.
const AUTO_MAP: Record<string, string> = {
  "mpn":          "mpn",
  "sku":          "mpn",
  "brand":        "brand",
  "map price":    "map_price",
  "map":          "map_price",
  "promo pri":    "promo_price",
  "promo price":  "promo_price",
  "start date":   "start_date",
  "end date":     "end_date",
};

function buildSuggestedMapping(rawHeaders: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of rawHeaders) {
    const key = header.trim().toLowerCase();
    const target = AUTO_MAP[key];
    if (target && !out[target]) out[target] = header;
  }
  return out;
}

/**
 * Parse a MAP-import date cell. Accepts:
 *   - Excel serial date (e.g. "45992") — days since 1900-01-01 with the Excel leap-year quirk
 *   - M/D/YYYY, MM/DD/YYYY, M/D/YY
 *   - empty / null → null (not an error)
 */
function parseMapDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v) return null;

  // Excel serial — pure integer in the 40000-60000 range covers 2009-2064.
  if (/^\d+$/.test(v)) {
    const serial = parseInt(v, 10);
    if (serial > 40000 && serial < 60000) {
      const ms = (serial - 25569) * 86400000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
  }

  // M/D/YYYY or MM/DD/YYYY (two-digit year supported).
  const parts = v.split("/");
  if (parts.length === 3) {
    const [mm, dd, yy] = parts;
    const m = parseInt(mm, 10);
    const d = parseInt(dd, 10);
    let y = parseInt(yy, 10);
    if (!isNaN(m) && !isNaN(d) && !isNaN(y)) {
      if (y < 100) y += 2000;
      const date = new Date(Date.UTC(y, m - 1, d));
      if (!isNaN(date.getTime())) return date.toISOString().split("T")[0];
    }
  }

  // ISO YYYY-MM-DD passes through.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  return null;
}

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
        suggested_mapping: buildSuggestedMapping(rawHeaders),
        target_fields: MAP_TARGET_FIELDS,
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
        !column_mapping.map_price
      ) {
        res.status(400).json({
          error:
            "column_mapping.mpn and column_mapping.map_price are required (brand / promo / dates are optional)",
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

      await batchRef.update({
        status: "processing",
        progress_pct: 0,
        processing_started_at: ts(),
      });
      respondAsync(res, batch_id);

      runInBackground(batch_id, "map_policy", async () => {

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
      let skippedRows = 0;
      const committedMpns: string[] = [];

      // Pre-validate all rows and stage write payloads.
      // We do existence checks via getAll() in chunks (much faster than serial .get()),
      // then issue every write through a single BulkWriter (parallel + auto-batched).
      type Staged = {
        rowNum: number;
        mpn: string;
        docId: string;
        brand: string | null;
        mapPrice: number;
        promoPrice: number | null;
        startDate: string | null;
        endDate: string | null;
        isPromoRow: boolean;
      };
      const staged: Staged[] = [];

      for (let i = 0; i < records.length; i++) {
        if (i % 50 === 0) {
          await updateProgress(batch_id, (i / records.length) * 100, {
            committed: committedRows,
            failed: failedRows,
            skipped: skippedRows,
          });
        }
        const row = records[i];
        const rowNum = i + 2;

        const mpn = getField(row, mapping.mpn);
        if (!mpn) {
          // No identifier — silent skip; promo-only rows commonly have empty MPN
          skippedRows++;
          continue;
        }

        const brandRaw = mapping.brand ? getField(row, mapping.brand) : "";
        const brand = brandRaw || null;

        const mapPriceRaw = getField(row, mapping.map_price);
        const mapPrice = parseFloat(mapPriceRaw);
        if (!mapPriceRaw || isNaN(mapPrice) || mapPrice <= 0) {
          // No usable base MAP price — skip silently (often a promo-only follow-up row)
          skippedRows++;
          continue;
        }

        const promoPriceRaw = mapping.promo_price ? getField(row, mapping.promo_price) : "";
        const promoParsed = promoPriceRaw ? parseFloat(promoPriceRaw) : NaN;
        const promoPrice = !isNaN(promoParsed) && promoParsed > 0 ? promoParsed : null;

        const startDate = parseMapDate(
          mapping.start_date ? getField(row, mapping.start_date) : null
        );
        const endDate = parseMapDate(
          mapping.end_date ? getField(row, mapping.end_date) : null
        );

        const isPromoRow = promoPrice !== null && (startDate !== null || endDate !== null);

        staged.push({
          rowNum,
          mpn,
          docId: mpnToDocId(mpn),
          brand,
          mapPrice,
          promoPrice,
          startDate,
          endDate,
          isPromoRow,
        });
      }

      // Batched product existence check via getAll() in chunks of 300.
      const productData = new Map<string, FirebaseFirestore.DocumentData | null>();
      const GET_CHUNK = 300;
      for (let i = 0; i < staged.length; i += GET_CHUNK) {
        const slice = staged.slice(i, i + GET_CHUNK);
        const refs = slice.map((s) => firestore.collection("products").doc(s.docId));
        const snaps = await firestore.getAll(...refs);
        snaps.forEach((snap, idx) => {
          productData.set(slice[idx].docId, snap.exists ? snap.data() ?? null : null);
        });
      }

      // BulkWriter — auto-batches and parallelises all writes; ~1000s of writes/sec.
      const writer = firestore.bulkWriter();
      writer.onWriteError((err) => {
        // Retry transient errors up to 5 times; surface anything else once.
        if (err.failedAttempts < 5) return true;
        console.error("BulkWriter give-up:", err.message);
        return false;
      });

      // Aggregate per-MPN before product stamping so a base + promo row pair
      // doesn't race on products/{docId}. The product doc reflects the most
      // informative state: prefer the promo row (has promo_price + window) over
      // the base row when both exist.
      type ProductStamp = {
        docId: string;
        mpn: string;
        brand: string | null;
        mapPrice: number;
        promoPrice: number | null;
        promoStart: string | null;
        promoEnd: string | null;
      };
      const productStamps = new Map<string, ProductStamp>();
      for (const s of staged) {
        const productInfo = productData.get(s.docId);
        if (!productInfo) continue; // counted as MPN-not-found below
        const existing = productStamps.get(s.docId);
        if (!existing) {
          productStamps.set(s.docId, {
            docId: s.docId,
            mpn: s.mpn,
            brand: s.brand,
            mapPrice: s.mapPrice,
            promoPrice: s.isPromoRow ? s.promoPrice : null,
            promoStart: s.isPromoRow ? s.startDate : null,
            promoEnd: s.isPromoRow ? s.endDate : null,
          });
        } else {
          // Always keep the latest non-null brand and the latest base map_price.
          if (!existing.brand && s.brand) existing.brand = s.brand;
          if (!s.isPromoRow) existing.mapPrice = s.mapPrice;
          // Prefer the promo row's window/price if we don't already have one,
          // or if this row's start_date is later (newest active promo wins).
          if (s.isPromoRow) {
            if (
              existing.promoPrice === null ||
              (s.startDate && existing.promoStart && s.startDate > existing.promoStart)
            ) {
              existing.promoPrice = s.promoPrice;
              existing.promoStart = s.startDate;
              existing.promoEnd = s.endDate;
            }
          }
        }
      }

      for (const s of staged) {
        const productInfo = productData.get(s.docId);
        if (!productInfo) {
          failedRows++;
          errors.push({
            row: s.rowNum,
            mpn: s.mpn,
            error: `MPN ${s.mpn} not found in catalog — check MPN format or verify the product exists`,
          });
          continue;
        }

        // 1. map_policies/{docId_base}  or  map_policies/{docId_promo_<startDate|open>}
        //    Same MPN can have one base row + multiple promo windows.
        const docSuffix = s.isPromoRow
          ? `promo_${s.startDate || "open"}`
          : "base";
        const mapPolicyDocId = `${s.docId}_${docSuffix}`;
        writer.set(
          firestore.collection("map_policies").doc(mapPolicyDocId),
          {
            mpn: s.mpn,
            brand: s.brand,
            map_price: s.mapPrice,
            promo_price: s.promoPrice,
            start_date: s.startDate,
            end_date: s.endDate,
            is_promo_row: s.isPromoRow,
            import_batch_id: batch_id,
            // Back-compat fields used by existing readers:
            source_batch_id: batch_id,
            is_always_on: !s.startDate && !s.endDate,
            created_at: ts(),
            updated_at: ts(),
          },
          { merge: true }
        );

        // 4. audit_log entry per row
        writer.create(firestore.collection("audit_log").doc(), {
          product_mpn: s.mpn,
          event_type: "map_policy_imported",
          map_price: s.mapPrice,
          promo_price: s.promoPrice,
          start_date: s.startDate,
          end_date: s.endDate,
          is_promo_row: s.isPromoRow,
          source_batch_id: batch_id,
          acting_user_id: userId,
          created_at: ts(),
        });

        committedRows++;
        committedMpns.push(s.mpn);
      }

      // 2 + 3. Product stamps + pricing_export_queue \u2014 one write per MPN, deterministic.
      for (const stamp of productStamps.values()) {
        const productInfo = productData.get(stamp.docId)!;
        const productRef = firestore.collection("products").doc(stamp.docId);
        writer.set(
          productRef,
          {
            is_map_protected: true,
            map_price: stamp.mapPrice,
            map_promo_price: stamp.promoPrice,
            map_promo_start: stamp.promoStart,
            map_promo_end: stamp.promoEnd,
            map_brand: stamp.brand,
            map_last_updated_at: ts(),
            map_source_batch_id: batch_id,
            map_removal_proposed: false,
            map_removal_proposed_at: null,
            map_removal_source_batch: null,
          },
          { merge: true }
        );
        writer.set(
          firestore.collection("pricing_export_queue").doc(stamp.docId),
          {
            mpn: productInfo.mpn || stamp.mpn,
            sku: productInfo.sku || null,
            rics_retail: productInfo.rics_retail || 0,
            rics_offer: productInfo.rics_offer || 0,
            scom: productInfo.scom || 0,
            scom_sale: productInfo.scom_sale || null,
            effective_date: stamp.promoStart,
            queued_at: ts(),
            queued_by: userId,
            queued_reason: "map_change",
            exported_at: null,
            export_job_id: null,
          },
          { merge: true }
        );
      }

      await writer.close();

      // MAP REMOVAL REVIEW — any currently-protected MPN absent from this import.
      // Use a second BulkWriter for the marking writes.
      let removalProposed = 0;
      const previouslyMapped = await firestore
        .collection("products")
        .where("is_map_protected", "==", true)
        .get();
      const committedSet = new Set(committedMpns);
      const removalWriter = firestore.bulkWriter();
      for (const doc of previouslyMapped.docs) {
        const d = doc.data();
        if (!committedSet.has(d.mpn)) {
          removalWriter.set(
            doc.ref,
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
      await removalWriter.close();

      // Cap errors persisted on the batch doc to 50 entries (1MB Firestore doc limit).
      // Spill the full list to a subcollection in chunks of 200 if there were more.
      const totalErrors = errors.length;
      const errorsForDoc = errors.slice(0, 50);
      const errorsTruncated = errors.length > 50;
      if (errorsTruncated) {
        const errorWriter = firestore.bulkWriter();
        const ERR_CHUNK = 200;
        for (let i = 0; i < errors.length; i += ERR_CHUNK) {
          errorWriter.set(
            batchRef.collection("errors").doc(`chunk_${String(i / ERR_CHUNK).padStart(4, "0")}`),
            { errors: errors.slice(i, i + ERR_CHUNK), start_index: i }
          );
        }
        await errorWriter.close();
      }

      const finalStatus = committedRows === 0 ? "failed" : "complete";
      await batchRef.update({
        status: finalStatus,
        committed_rows: committedRows,
        failed_rows: failedRows,
        skipped_rows: skippedRows,
        errors: errorsForDoc,
        errors_total: totalErrors,
        errors_truncated: errorsTruncated,
        completed_at: ts(),
        summary: { removal_proposed: removalProposed },
      });

      await finishImportJob(
        batch_id,
        userId === "system" ? null : userId,
        "map_policy",
        `MAP Policy import complete — ${committedRows.toLocaleString()} committed, ${skippedRows.toLocaleString()} skipped`
      );
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
      if (!res.headersSent) {
        res.status(500).json({
          error: "An unexpected error occurred during batch commit. Please try again.",
        });
      }
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
