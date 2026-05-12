/**
 * Weekly Operations Import — TALLY-001
 * POST /api/v1/imports/weekly-operations/upload
 * POST /api/v1/imports/weekly-operations/:batch_id/commit
 *
 * Same pattern as Full Product Import but for the weekly pricing/inventory refresh.
 */
import { Router, Request, Response } from "express";
import admin from "firebase-admin";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { parse } from "csv-parse/sync";
import { mpnToDocId } from "../services/mpnUtils";
import { getAdminSettings } from "../services/adminSettings";
import {
  resolvePricing,
  writePricingSnapshot,
  type PricingInputs,
} from "../services/pricingResolution";
import { getMapState } from "../services/mapState";
import { runPostImportCalculations } from "../services/postImportCalculation";
import { runCadenceEvaluation } from "../services/cadenceEngine";
import { checkHighPriorityFlag } from "../services/launchHighPriority";
import { writeWeeklySnapshots } from "../services/executiveProjections";
import { computeBuyerPerformanceMatrix } from "../services/buyerPerformanceMatrix";
import {
  computeCompletion,
  stampCompletionOnProduct,
} from "../services/completionCompute";
import { generateWeeklyAdvisories } from "../services/aiWeeklyAdvisory";
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
const db = admin.firestore;

// TALLY-001 — Required columns for Weekly Operations Import
// TALLY-145 — Header contract harmonization with Full Product Import:
//   * Canonical pricing vocabulary is "Web Regular Price", "Web Sale Price",
//     "Retail Price", "Retail Sale Price". Legacy headers ("Web Price",
//     "Store Price", "Store Sale Price") are accepted as aliases during
//     transition. Web Sale Price is the same header on both sides.
//   * Canonical distribution-center inventory header is "Distro Ctr".
//     "WHS inv" remains accepted as a legacy alias only.
//   * Each header group passes validation if EITHER the canonical name OR
//     any listed alias is present (case-insensitive).
//   * Internal Firestore field keys (scom, scom_sale, rics_retail, rics_offer,
//     inventory_whs) are NOT renamed — PO ruling 2026-05-12.
const REQUIRED_HEADER_GROUPS: Array<{ canonical: string; aliases?: string[] }> = [
  { canonical: "MPN" },
  { canonical: "Week Ending Date" },
  { canonical: "Retail Price", aliases: ["Store Price"] },
  { canonical: "Retail Sale Price", aliases: ["Store Sale Price"] },
  { canonical: "Web Regular Price", aliases: ["Web Price"] },
  { canonical: "Web Sale Price" },
  { canonical: "Store Inv" },
  { canonical: "Warehouse Inv" },
  { canonical: "Distro Ctr", aliases: ["WHS inv"] },
];

// Flat list of every header name (canonical + alias) the importer recognises,
// used by the case-insensitive header normaliser below.
const REQUIRED_COLUMNS_WEEKLY: string[] = REQUIRED_HEADER_GROUPS.flatMap(
  (g) => [g.canonical, ...(g.aliases ?? [])]
);

// TALLY-145 — Read a numeric cell, preferring the canonical header. Falls
// through to legacy aliases in order. Returns 0 when no candidate has a
// non-empty value (matches the prior parseFloat||0 / parseInt||0 semantics).
function readNumberWithAliases(
  row: Record<string, string>,
  canonicalHeader: string,
  aliases: string[] = [],
  parser: (s: string) => number = parseFloat,
): number {
  for (const h of [canonicalHeader, ...aliases]) {
    const raw = row[h];
    if (raw !== undefined && String(raw).trim() !== "") {
      const n = parser(String(raw));
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

// Step 2.1 — MAP state is now read from each product via getMapState(mpn)
// (populated by the MAP Policy Import). The Phase 1 default has been removed.

// ────────────────────────────────────────────────
//  POST /upload
// ────────────────────────────────────────────────
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
      const lines = csvContent.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length < 2) {
        res.status(400).json({ error: "CSV file is empty or has no data rows." });
        return;
      }

      // Parse CSV to validate
      const records = parse(csvContent, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as string[][];

      const headerRow = records[0];
      const warnings: string[] = [];

      // Duplicate column detection (case-insensitive, BOM-safe)
      const columnMap: Record<string, number> = {};
      headerRow.forEach((col, idx) => {
        const trimmed = col.trim().replace(/^\uFEFF/, "");
        if (trimmed in columnMap) {
          warnings.push(
            `Column '${trimmed}' appears twice (columns ${columnMap[trimmed] + 1} and ${idx + 1}). Column ${idx + 1} was used. Please verify.`
          );
        }
        columnMap[trimmed] = idx;
      });

      // Validate required columns (case-insensitive)
      // TALLY-145 — Each header group passes if EITHER the canonical name OR
      // any registered alias is present. Reported missing column is the
      // canonical name (this is what we tell uploaders to use going forward).
      const presentLower = new Set(Object.keys(columnMap).map((k) => k.toLowerCase()));
      const missingColumns = REQUIRED_HEADER_GROUPS
        .filter((g) => {
          const candidates = [g.canonical, ...(g.aliases ?? [])];
          return !candidates.some((c) => presentLower.has(c.toLowerCase()));
        })
        .map((g) => g.canonical);

      if (missingColumns.length > 0) {
        res.status(400).json({
          error: "CSV is missing required columns.",
          missing_columns: missingColumns,
          message: `The following required columns are missing: ${missingColumns.join(", ")}. Please ensure your CSV includes all required columns and try again.`,
        });
        return;
      }

      const rowCount = records.length - 1;
      const batchId = uuidv4();
      const filename = file.originalname || "upload.csv";
      const filePath = `imports/weekly-operations/${batchId}/${filename}`;

      // Store file in Firebase Storage
      const bucket = admin.storage().bucket();
      const storageFile = bucket.file(filePath);
      await storageFile.save(file.buffer, {
        contentType: "text/csv",
        metadata: { batch_id: batchId },
      });

      // Create import_batches document with family: "weekly_operations"
      const firestore = admin.firestore();
      await firestore.collection("import_batches").doc(batchId).set({
        batch_id: batchId,
        family: "weekly_operations",
        status: "pending",
        file_path: filePath,
        row_count: rowCount,
        committed_rows: 0,
        failed_rows: 0,
        warnings,
        errors: [],
        created_by: (req as any).user?.uid || "system",
        created_at: db.FieldValue.serverTimestamp(),
        completed_at: null,
      });

      res.status(200).json({
        batch_id: batchId,
        column_map: columnMap,
        row_count: rowCount,
        warnings,
      });
    } catch (err: any) {
      console.error("Weekly Operations upload error:", err);
      res.status(500).json({
        error: "An unexpected error occurred during file upload. Please try again.",
      });
    }
  }
);

// ────────────────────────────────────────────────
//  POST /:batch_id/commit
// ────────────────────────────────────────────────
router.post("/:batch_id/commit", async (req: Request, res: Response) => {
  const { batch_id } = req.params;
  const firestore = admin.firestore();

  try {
    // Step 1 — Fetch batch record and validate status
    const batchRef = firestore.collection("import_batches").doc(batch_id);
    const batchSnap = await batchRef.get();

    if (!batchSnap.exists) {
      res.status(404).json({ error: `Batch ${batch_id} not found.` });
      return;
    }

    const batchData = batchSnap.data()!;
    if (batchData.family !== "weekly_operations") {
      res.status(400).json({
        error: `Batch ${batch_id} is not a Weekly Operations batch (family: ${batchData.family}).`,
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

    // Step 2 — Set status to processing and respond immediately. The rest
    // of the handler runs detached in the background.
    await batchRef.update({
      status: "processing",
      progress_pct: 0,
      processing_started_at: db.FieldValue.serverTimestamp(),
    });
    const __userId = (req as any).user?.uid || batchData.uploaded_by || null;
    respondAsync(res, batch_id);

    runInBackground(batch_id, "weekly_operations", async () => {

    // Step 3 — Retrieve the file from Firebase Storage
    const bucket = admin.storage().bucket();
    const [fileBuffer] = await bucket.file(batchData.file_path).download();
    const csvContent = fileBuffer.toString("utf-8");

    // Step 4 — Parse all data rows (case-insensitive, BOM-safe headers)
    const CANONICAL_WEEKLY: Record<string, string> = {};
    REQUIRED_COLUMNS_WEEKLY.forEach((c) => { CANONICAL_WEEKLY[c.toLowerCase()] = c; });

    const records = parse(csvContent, {
      columns: (header: string[]) =>
        header.map((h: string) => {
          const clean = h.trim().replace(/^\uFEFF/, "");
          return CANONICAL_WEEKLY[clean.toLowerCase()] || clean;
        }),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, string>[];

    // Load admin settings for pricing resolution
    const adminSettings = await getAdminSettings();

    // Counters
    let committedRows = 0;
    let failedRows = 0;
    let pricingCurrent = 0;
    let pricingDiscrepancy = 0;
    let pricingPending = 0;
    let lossLeaderReview = 0;
    const errors: Array<{ row: number; mpn: string; error: string }> = [];
    const committedMpns: string[] = [];

    // Step 5 — Process each row
    for (let i = 0; i < records.length; i++) {
      if (i % 25 === 0) {
        await updateProgress(batch_id, (i / records.length) * 100, {
          committed: committedRows,
          failed: failedRows,
        });
      }
      const row = records[i];
      const rowNum = i + 2;
      const mpn = (row.MPN || "").trim();

      if (!mpn) {
        failedRows++;
        errors.push({
          row: rowNum,
          mpn: "",
          error: "MPN is required — this row has no product identifier",
        });
        continue;
      }

      // Look up product by MPN — if not found, add to failed rows
      const docId = mpnToDocId(mpn);
      const productSnap = await firestore.collection("products").doc(docId).get();
      if (!productSnap.exists) {
        failedRows++;
        errors.push({
          row: rowNum,
          mpn,
          error: `MPN ${mpn} not found in catalog — verify the product exists before running a Weekly Operations import`,
        });
        continue;
      }

      try {
        const existingProduct = productSnap.data()!;

        // Parse pricing and inventory fields
        // TALLY-145 — Prefer canonical headers, fall back to legacy aliases.
        // Internal Firestore field keys are unchanged (scom, scom_sale,
        // rics_retail, rics_offer, inventory_whs).
        const ricsRetail = readNumberWithAliases(row, "Retail Price", ["Store Price"], parseFloat);
        const ricsOffer = readNumberWithAliases(row, "Retail Sale Price", ["Store Sale Price"], parseFloat);
        const scom = readNumberWithAliases(row, "Web Regular Price", ["Web Price"], parseFloat);
        const scomSale = readNumberWithAliases(row, "Web Sale Price", [], parseFloat);
        const inventoryStore = readNumberWithAliases(row, "Store Inv", [], parseInt);
        const inventoryWarehouse = readNumberWithAliases(row, "Warehouse Inv", [], parseInt);
        // Distro Ctr is canonical for distribution-center inventory; WHS inv is
        // legacy alias only. Distro Ctr wins when both are present. The same
        // resolved value is mirrored to inventory_whs for legacy readers.
        const distributionCenterInventory = readNumberWithAliases(
          row, "Distro Ctr", ["WHS inv"], parseInt
        );
        const inventoryWhs = distributionCenterInventory;
        // Optional CSV-sourced total. Only written when the column is present
        // and non-empty; backend never recomputes (PO ruling 2026-05-12).
        const totalInventoryRaw = (row["Total Inventory"] ?? "").toString().trim();
        const totalInventoryUpdate: { total_inventory?: number } =
          totalInventoryRaw !== ""
            ? { total_inventory: parseInt(totalInventoryRaw) || 0 }
            : {};

        // Update pricing fields on product document (merge)
        await firestore.collection("products").doc(docId).set(
          {
            rics_retail: ricsRetail,
            rics_offer: ricsOffer,
            scom,
            scom_sale: scomSale,
            inventory_store: inventoryStore,
            inventory_warehouse: inventoryWarehouse,
            inventory_whs: inventoryWhs,
            distribution_center_inventory: distributionCenterInventory,
            ...totalInventoryUpdate,
            last_weekly_import_at: db.FieldValue.serverTimestamp(),
            updated_at: db.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // Immediately fire Pricing Resolution for this product
        const pricingInputs: PricingInputs = {
          rics_retail: ricsRetail,
          rics_offer: ricsOffer,
          scom,
          scom_sale: scomSale,
          actual_cost: existingProduct.actual_cost || null,
        };

        const pricingResult = await resolvePricing(
          mpn,
          pricingInputs,
          await getMapState(mpn),
          adminSettings
        );

        // Write pricing snapshot
        await writePricingSnapshot(mpn, batch_id, pricingResult);

        // Track routing outcomes
        switch (pricingResult.status) {
          case "Pricing Current":
            pricingCurrent++;
            break;
          case "Pricing Discrepancy":
            pricingDiscrepancy++;
            break;
          case "Pricing Pending":
            pricingPending++;
            break;
          case "Loss-Leader Review Pending":
            lossLeaderReview++;
            break;
        }

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
        console.error(`Weekly Ops Row ${rowNum} (MPN: ${mpn}) error:`, rowErr);
      }
    }

    // Step 6 — Fire Post-Import Calculation Job for all committed MPNs
    let metricsResult = { calculated: 0, skipped: 0 };
    if (committedMpns.length > 0) {
      metricsResult = await runPostImportCalculations(
        batch_id,
        committedMpns,
        adminSettings
      );
    }

    // Step 6b — Step 2.2 — Run cadence evaluation after post-import calcs
    let cadenceResult = { evaluated: 0, assigned: 0, unassigned: 0, conflicts: 0, skipped_mid_cadence: 0 };
    if (committedMpns.length > 0) {
      try {
        cadenceResult = await runCadenceEvaluation(committedMpns);
      } catch (ce: any) {
        console.error("runCadenceEvaluation failed:", ce.message);
      }
    }

    // Step 6b.1 — Step 3.2 — Weekly metric snapshots for executive dashboard
    try {
      await writeWeeklySnapshots();
    } catch (snapErr: any) {
      console.error("writeWeeklySnapshots failed:", snapErr.message);
    }

    // Step 6b.2 — Step 3.3 — Buyer performance matrix (depends on fresh snapshots)
    try {
      await computeBuyerPerformanceMatrix();
    } catch (bpErr: any) {
      console.error("computeBuyerPerformanceMatrix failed:", bpErr.message);
    }

    // Step 6b.3 — Step 3.4 — AI Weekly Advisory (fire-and-forget; don't block response)
    try {
      generateWeeklyAdvisories(batch_id).catch((advErr: any) =>
        console.error(
          "generateWeeklyAdvisories (fire-and-forget) failed:",
          advErr?.message || advErr
        )
      );
    } catch (_err) {
      /* silent — fire-and-forget must never throw */
    }

    // Step 6c — Step 2.4 — Re-evaluate launch High Priority flags for committed MPNs
    if (committedMpns.length > 0) {
      for (const mpn of committedMpns) {
        try {
          await checkHighPriorityFlag(mpn);
        } catch (hpErr: any) {
          console.error(`checkHighPriorityFlag failed for ${mpn}:`, hpErr.message);
        }
      }
    }

    // Step 6d — TALLY-P1 — stamp 5-field completion projection for every
    // committed MPN. Sequential, non-transactional, best-effort. Stamping
    // happens at the HTTP handler boundary (per PO Ruling 2026-04-23
    // architectural rule), after all internal writes — pricing snapshot,
    // post-import calculations, cadence, high-priority — have completed.
    if (committedMpns.length > 0) {
      for (const mpn of committedMpns) {
        try {
          const productRef = firestore
            .collection("products")
            .doc(mpnToDocId(mpn));
          const result = await computeCompletion(mpn);
          await stampCompletionOnProduct(productRef, result);
        } catch (stampErr: any) {
          console.warn("completion_stamp_failed", {
            mpn,
            err: stampErr?.message,
          });
        }
      }
    }

    // Step 7 — Update batch record with final counts
    const finalStatus = failedRows === records.length ? "failed" : "complete";
    await batchRef.update({
      status: finalStatus,
      committed_rows: committedRows,
      failed_rows: failedRows,
      errors,
      completed_at: db.FieldValue.serverTimestamp(),
      summary: {
        pricing_current: pricingCurrent,
        pricing_discrepancy: pricingDiscrepancy,
        pricing_pending: pricingPending,
        loss_leader_review: lossLeaderReview,
        metrics_calculated: metricsResult.calculated,
        metrics_skipped: metricsResult.skipped,
        cadence_evaluated: cadenceResult.evaluated,
        cadence_assigned: cadenceResult.assigned,
        cadence_unassigned: cadenceResult.unassigned,
        cadence_conflicts: cadenceResult.conflicts,
      },
    });

    await finishImportJob(
      batch_id,
      __userId,
      "weekly_operations",
      `Weekly Operations import complete — ${committedRows.toLocaleString()} committed, ${failedRows.toLocaleString()} failed`
    );
    });
  } catch (err: any) {
    console.error("Weekly Operations commit error:", err);
    try {
      await firestore
        .collection("import_batches")
        .doc(batch_id)
        .update({
          status: "failed",
          errors: [
            {
              error:
                "An unexpected error occurred during commit processing.",
            },
          ],
          completed_at: db.FieldValue.serverTimestamp(),
        });
    } catch (_) {
      // swallow — best effort
    }
    if (!res.headersSent) {
      res.status(500).json({
        error:
          "An unexpected error occurred during batch commit. Please try again.",
      });
    }
  }
});

export default router;
