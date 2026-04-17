/**
 * Sales Import (web + store) — POST /api/v1/imports/sales
 *
 * Accepts CSV exported from RetailOps:
 *   Row 1: "Report made M/D/YYYY,,,"  ← extract report_date
 *   Row 2: headers (SKU.Mpn, Web Sales 7 Days, Web Sales 30 Days, Last sold date)
 *          OR (SKU.Mpn, Store Sales 7 Days, Store Sales 30 Days, Last sold date)
 *   Row 3+: data
 *
 * Writes:
 *   - sales_snapshots/{docId} (one per MPN per report_date per import_type)
 *   - products/{docId} merge of web_sales_xx / store_sales_xx + last_*_sale_date
 *   - import_batches/{batch_id} family="sales"
 *
 * After commit: recomputes STR% / WOS / weekly_sales_rate via postImportCalculation.recomputeSalesMetrics
 */
import { Router, Request, Response } from "express";
import admin from "firebase-admin";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { parse } from "csv-parse/sync";
import { mpnToDocId } from "../services/mpnUtils";
import { recomputeSalesMetrics } from "../services/postImportCalculation";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const dbNS = admin.firestore;

type ImportType = "web" | "store" | "unknown";

function detectImportType(headers: string[]): ImportType {
  const h = headers.map((s) => (s || "").toLowerCase());
  if (h.some((x) => x.includes("web sales"))) return "web";
  if (h.some((x) => x.includes("store sales"))) return "store";
  return "unknown";
}

function parseReportDate(metadataRow: string): string | null {
  // "Report made 4/17/2026,,," or "Report made 4/17/2026"
  const m = metadataRow.match(/Report made\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseLastSoldDate(raw: string): { date: string | null; past: boolean } {
  const v = (raw || "").trim();
  if (!v) return { date: null, past: false };
  if (v.toUpperCase() === "PAST") return { date: null, past: true };
  // Accepts "M/D/YYYY HH:MM:SS AM/PM" or ISO. Strip time.
  // Try splitting on space first.
  const datePart = v.split(/[ T]/)[0];
  // Try M/D/YYYY → YYYY-MM-DD
  const us = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, mm, dd, yyyy] = us;
    return { date: `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`, past: false };
  }
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return { date: datePart, past: false };
  }
  // Fallback — let JS Date attempt
  const d = new Date(v);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return { date: `${yyyy}-${mm}-${dd}`, past: false };
  }
  return { date: null, past: false };
}

function findColLoose(headers: string[], needle: string): number {
  const n = needle.toLowerCase();
  return headers.findIndex((h) => (h || "").toLowerCase().includes(n));
}

// ─────────────────────────────────────────────────────────────
//  POST /upload  — parse, detect type, save file, create batch
// ─────────────────────────────────────────────────────────────
router.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded. Please attach a CSV file." });
        return;
      }

      const csvContent = file.buffer.toString("utf-8");
      // Use csv-parse with no header binding so we can grab row 1 metadata + row 2 headers separately
      const rows = parse(csvContent, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      }) as string[][];

      if (rows.length < 3) {
        res.status(400).json({
          error: "CSV is too short — expected metadata row, header row, and at least one data row.",
        });
        return;
      }

      const metadataRow = (rows[0] || []).join(",");
      const reportDate = parseReportDate(metadataRow);
      if (!reportDate) {
        res.status(400).json({
          error: "Could not parse report date from row 1. Expected: 'Report made M/D/YYYY'",
          row_1_preview: metadataRow.slice(0, 120),
        });
        return;
      }

      const headerRow = (rows[1] || []).map((h) => (h || "").replace(/^\uFEFF/, "").trim());
      const importType = detectImportType(headerRow);
      if (importType === "unknown") {
        res.status(400).json({
          error:
            "Could not auto-detect file type. Headers must contain 'Web Sales' or 'Store Sales'.",
          headers: headerRow,
        });
        return;
      }

      const mpnIdx = findColLoose(headerRow, "sku.mpn");
      const sales7Idx = findColLoose(headerRow, importType === "web" ? "web sales 7" : "store sales 7");
      const sales30Idx = findColLoose(headerRow, importType === "web" ? "web sales 30" : "store sales 30");
      const lastSoldIdx = findColLoose(headerRow, "last sold date");

      const missing: string[] = [];
      if (mpnIdx < 0) missing.push("SKU.Mpn");
      if (sales7Idx < 0) missing.push(importType === "web" ? "Web Sales 7 Days" : "Store Sales 7 Days");
      if (sales30Idx < 0) missing.push(importType === "web" ? "Web Sales 30 Days" : "Store Sales 30 Days");
      if (lastSoldIdx < 0) missing.push("Last sold date");
      if (missing.length > 0) {
        res.status(400).json({
          error: "Missing required columns.",
          missing_columns: missing,
          headers: headerRow,
        });
        return;
      }

      const dataRows = rows.slice(2);
      const rowCount = dataRows.length;

      const batchId = uuidv4();
      const filename = file.originalname || "sales-upload.csv";
      const filePath = `imports/sales/${batchId}/${filename}`;

      const bucket = admin.storage().bucket();
      await bucket.file(filePath).save(file.buffer, {
        contentType: "text/csv",
        metadata: { batch_id: batchId, import_type: importType, report_date: reportDate },
      });

      const firestore = admin.firestore();
      await firestore.collection("import_batches").doc(batchId).set({
        batch_id: batchId,
        family: "sales",
        import_type: importType,
        report_date: reportDate,
        status: "pending",
        file_path: filePath,
        row_count: rowCount,
        committed_rows: 0,
        failed_rows: 0,
        skipped_rows: 0,
        warnings: [],
        errors: [],
        created_by: (req as any).user?.uid || "system",
        created_at: dbNS.FieldValue.serverTimestamp(),
        completed_at: null,
        column_indexes: {
          mpn: mpnIdx,
          sales_7d: sales7Idx,
          sales_30d: sales30Idx,
          last_sold_date: lastSoldIdx,
        },
      });

      res.status(200).json({
        batch_id: batchId,
        import_type: importType,
        report_date: reportDate,
        row_count: rowCount,
        headers: headerRow,
      });
    } catch (err: any) {
      console.error("Sales upload error:", err);
      res.status(500).json({
        error: "An unexpected error occurred during file upload. Please try again.",
        detail: err?.message || String(err),
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────
//  POST /:batch_id/commit
// ─────────────────────────────────────────────────────────────
router.post("/:batch_id/commit", async (req: Request, res: Response) => {
  const { batch_id } = req.params;
  const firestore = admin.firestore();

  try {
    const batchRef = firestore.collection("import_batches").doc(batch_id);
    const batchSnap = await batchRef.get();
    if (!batchSnap.exists) {
      res.status(404).json({ error: `Batch ${batch_id} not found.` });
      return;
    }
    const batchData = batchSnap.data()!;
    if (batchData.family !== "sales") {
      res.status(400).json({
        error: `Batch ${batch_id} is not a Sales Import batch (family: ${batchData.family}).`,
      });
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
    if (batchData.status !== "pending") {
      res.status(409).json({
        error: `Batch ${batch_id} has status "${batchData.status}" and cannot be committed.`,
      });
      return;
    }

    await batchRef.update({ status: "processing" });

    const importType: "web" | "store" = batchData.import_type;
    const reportDate: string = batchData.report_date;
    const colIdx = batchData.column_indexes as {
      mpn: number;
      sales_7d: number;
      sales_30d: number;
      last_sold_date: number;
    };

    const bucket = admin.storage().bucket();
    const [fileBuffer] = await bucket.file(batchData.file_path).download();
    const csvContent = fileBuffer.toString("utf-8");
    const rows = parse(csvContent, {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as string[][];

    const dataRows = rows.slice(2);

    let committedRows = 0;
    let skippedRows = 0;
    let failedRows = 0;
    const errors: Array<{ row: number; mpn: string; error: string }> = [];
    const touchedMpns: string[] = [];
    const productNotFoundMpns: string[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i] || [];
      const rowNum = i + 3;
      const mpn = (r[colIdx.mpn] || "").trim();

      if (!mpn) {
        skippedRows++;
        continue;
      }

      try {
        const sales7 = parseInt(r[colIdx.sales_7d], 10) || 0;
        const sales30 = parseInt(r[colIdx.sales_30d], 10) || 0;
        const lastSoldRaw = r[colIdx.last_sold_date] || "";
        const { date: lastSaleDate, past: lastSalePast } = parseLastSoldDate(lastSoldRaw);

        const docId = mpnToDocId(mpn);

        // Snapshot — overwrite per MPN per report_date per import_type
        const snapshotId = `${docId}_${reportDate}_${importType}`;
        await firestore.collection("sales_snapshots").doc(snapshotId).set(
          {
            mpn,
            report_date: reportDate,
            import_type: importType,
            web_sales_7d: importType === "web" ? sales7 : 0,
            web_sales_30d: importType === "web" ? sales30 : 0,
            store_sales_7d: importType === "store" ? sales7 : 0,
            store_sales_30d: importType === "store" ? sales30 : 0,
            last_sale_date: lastSaleDate,
            last_sale_date_past: lastSalePast,
            imported_at: dbNS.FieldValue.serverTimestamp(),
          },
          { merge: false }
        );

        // Stamp on product document (only if exists)
        const productRef = firestore.collection("products").doc(docId);
        const productSnap = await productRef.get();
        if (!productSnap.exists) {
          productNotFoundMpns.push(mpn);
          // Snapshot still written — but product stamp + recompute skipped
          committedRows++;
          continue;
        }

        const stamp: Record<string, unknown> = {
          last_sales_import_at: dbNS.FieldValue.serverTimestamp(),
          updated_at: dbNS.FieldValue.serverTimestamp(),
        };
        if (importType === "web") {
          stamp.web_sales_7d = sales7;
          stamp.web_sales_30d = sales30;
          stamp.last_web_sale_date = lastSaleDate;
          stamp.last_web_sale_past = lastSalePast;
          stamp.last_web_sales_report_date = reportDate;
        } else {
          stamp.store_sales_7d = sales7;
          stamp.store_sales_30d = sales30;
          stamp.last_store_sale_date = lastSaleDate;
          stamp.last_store_sale_past = lastSalePast;
          stamp.last_store_sales_report_date = reportDate;
        }
        await productRef.set(stamp, { merge: true });

        touchedMpns.push(mpn);
        committedRows++;
      } catch (rowErr: any) {
        failedRows++;
        errors.push({
          row: rowNum,
          mpn,
          error: rowErr?.message || "Unexpected error processing row.",
        });
        console.error(`Sales Row ${rowNum} (MPN: ${mpn}) error:`, rowErr);
      }
    }

    // Recompute STR% / WOS / weekly_sales_rate for touched products
    let metricsResult = { calculated: 0, skipped: 0 };
    if (touchedMpns.length > 0) {
      try {
        metricsResult = await recomputeSalesMetrics(touchedMpns);
      } catch (mErr: any) {
        console.error("recomputeSalesMetrics failed:", mErr?.message || mErr);
      }
    }

    const finalStatus = committedRows === 0 ? "failed" : "complete";
    await batchRef.update({
      status: finalStatus,
      committed_rows: committedRows,
      failed_rows: failedRows,
      skipped_rows: skippedRows,
      product_not_found_count: productNotFoundMpns.length,
      errors,
      completed_at: dbNS.FieldValue.serverTimestamp(),
      summary: {
        metrics_calculated: metricsResult.calculated,
        metrics_skipped: metricsResult.skipped,
        product_not_found: productNotFoundMpns.length,
      },
    });

    res.status(200).json({
      batch_id,
      status: finalStatus,
      import_type: importType,
      report_date: reportDate,
      total_rows: dataRows.length,
      committed_rows: committedRows,
      skipped_rows: skippedRows,
      failed_rows: failedRows,
      product_not_found_count: productNotFoundMpns.length,
      metrics_calculated: metricsResult.calculated,
      errors,
    });
  } catch (err: any) {
    console.error("Sales commit error:", err);
    try {
      await admin
        .firestore()
        .collection("import_batches")
        .doc(batch_id)
        .update({
          status: "failed",
          errors: [{ error: err?.message || "Unexpected error during commit." }],
          completed_at: dbNS.FieldValue.serverTimestamp(),
        });
    } catch {
      /* best effort */
    }
    res.status(500).json({
      error: "An unexpected error occurred during batch commit. Please try again.",
      detail: err?.message || String(err),
    });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /status — last web + last store import summary
// ─────────────────────────────────────────────────────────────
router.get("/status", async (_req: Request, res: Response) => {
  try {
    const firestore = admin.firestore();
    const fetchLast = async (importType: "web" | "store") => {
      const snap = await firestore
        .collection("import_batches")
        .where("family", "==", "sales")
        .where("import_type", "==", importType)
        .where("status", "==", "complete")
        .orderBy("completed_at", "desc")
        .limit(1)
        .get();
      if (snap.empty) return null;
      const d = snap.docs[0].data();
      return {
        batch_id: d.batch_id,
        report_date: d.report_date,
        committed_rows: d.committed_rows || 0,
        skipped_rows: d.skipped_rows || 0,
        failed_rows: d.failed_rows || 0,
        completed_at: d.completed_at?.toDate ? d.completed_at.toDate().toISOString() : null,
      };
    };

    const [web, store] = await Promise.all([fetchLast("web"), fetchLast("store")]);
    res.status(200).json({ last_web: web, last_store: store });
  } catch (err: any) {
    console.error("Sales status error:", err);
    // Most likely an index-not-yet-built error; degrade gracefully.
    res.status(200).json({
      last_web: null,
      last_store: null,
      warning: err?.message || "Could not fetch sales import status.",
    });
  }
});

export default router;
