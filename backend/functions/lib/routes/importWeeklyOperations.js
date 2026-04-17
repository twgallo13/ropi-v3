"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Weekly Operations Import — TALLY-001
 * POST /api/v1/imports/weekly-operations/upload
 * POST /api/v1/imports/weekly-operations/:batch_id/commit
 *
 * Same pattern as Full Product Import but for the weekly pricing/inventory refresh.
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const multer_1 = __importDefault(require("multer"));
const uuid_1 = require("uuid");
const sync_1 = require("csv-parse/sync");
const mpnUtils_1 = require("../services/mpnUtils");
const adminSettings_1 = require("../services/adminSettings");
const pricingResolution_1 = require("../services/pricingResolution");
const mapState_1 = require("../services/mapState");
const postImportCalculation_1 = require("../services/postImportCalculation");
const cadenceEngine_1 = require("../services/cadenceEngine");
const launchHighPriority_1 = require("../services/launchHighPriority");
const executiveProjections_1 = require("../services/executiveProjections");
const buyerPerformanceMatrix_1 = require("../services/buyerPerformanceMatrix");
const aiWeeklyAdvisory_1 = require("../services/aiWeeklyAdvisory");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
});
const db = firebase_admin_1.default.firestore;
// TALLY-001 — Required columns for Weekly Operations Import
const REQUIRED_COLUMNS_WEEKLY = [
    "MPN",
    "Week Ending Date",
    "Store Price", // → ricsRetail
    "Store Sale Price", // → ricsOffer
    "Web Price", // → scom
    "Web Sale Price", // → scomSale
    "Store Inv", // → inventory_store
    "Warehouse Inv", // → inventory_warehouse
    "WHS inv", // → inventory_whs
];
// Step 2.1 — MAP state is now read from each product via getMapState(mpn)
// (populated by the MAP Policy Import). The Phase 1 default has been removed.
// ────────────────────────────────────────────────
//  POST /upload
// ────────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req, res) => {
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
        const records = (0, sync_1.parse)(csvContent, {
            columns: false,
            skip_empty_lines: true,
            relax_column_count: true,
        });
        const headerRow = records[0];
        const warnings = [];
        // Duplicate column detection (case-insensitive, BOM-safe)
        const columnMap = {};
        headerRow.forEach((col, idx) => {
            const trimmed = col.trim().replace(/^\uFEFF/, "");
            if (trimmed in columnMap) {
                warnings.push(`Column '${trimmed}' appears twice (columns ${columnMap[trimmed] + 1} and ${idx + 1}). Column ${idx + 1} was used. Please verify.`);
            }
            columnMap[trimmed] = idx;
        });
        // Validate required columns (case-insensitive)
        const presentLower = new Set(Object.keys(columnMap).map((k) => k.toLowerCase()));
        const missingColumns = REQUIRED_COLUMNS_WEEKLY.filter((c) => !presentLower.has(c.toLowerCase()));
        if (missingColumns.length > 0) {
            res.status(400).json({
                error: "CSV is missing required columns.",
                missing_columns: missingColumns,
                message: `The following required columns are missing: ${missingColumns.join(", ")}. Please ensure your CSV includes all required columns and try again.`,
            });
            return;
        }
        const rowCount = records.length - 1;
        const batchId = (0, uuid_1.v4)();
        const filename = file.originalname || "upload.csv";
        const filePath = `imports/weekly-operations/${batchId}/${filename}`;
        // Store file in Firebase Storage
        const bucket = firebase_admin_1.default.storage().bucket();
        const storageFile = bucket.file(filePath);
        await storageFile.save(file.buffer, {
            contentType: "text/csv",
            metadata: { batch_id: batchId },
        });
        // Create import_batches document with family: "weekly_operations"
        const firestore = firebase_admin_1.default.firestore();
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
            created_by: req.user?.uid || "system",
            created_at: db.FieldValue.serverTimestamp(),
            completed_at: null,
        });
        res.status(200).json({
            batch_id: batchId,
            column_map: columnMap,
            row_count: rowCount,
            warnings,
        });
    }
    catch (err) {
        console.error("Weekly Operations upload error:", err);
        res.status(500).json({
            error: "An unexpected error occurred during file upload. Please try again.",
        });
    }
});
// ────────────────────────────────────────────────
//  POST /:batch_id/commit
// ────────────────────────────────────────────────
router.post("/:batch_id/commit", async (req, res) => {
    const { batch_id } = req.params;
    const firestore = firebase_admin_1.default.firestore();
    try {
        // Step 1 — Fetch batch record and validate status
        const batchRef = firestore.collection("import_batches").doc(batch_id);
        const batchSnap = await batchRef.get();
        if (!batchSnap.exists) {
            res.status(404).json({ error: `Batch ${batch_id} not found.` });
            return;
        }
        const batchData = batchSnap.data();
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
        // Step 2 — Set status to processing
        await batchRef.update({ status: "processing" });
        // Step 3 — Retrieve the file from Firebase Storage
        const bucket = firebase_admin_1.default.storage().bucket();
        const [fileBuffer] = await bucket.file(batchData.file_path).download();
        const csvContent = fileBuffer.toString("utf-8");
        // Step 4 — Parse all data rows (case-insensitive, BOM-safe headers)
        const CANONICAL_WEEKLY = {};
        REQUIRED_COLUMNS_WEEKLY.forEach((c) => { CANONICAL_WEEKLY[c.toLowerCase()] = c; });
        const records = (0, sync_1.parse)(csvContent, {
            columns: (header) => header.map((h) => {
                const clean = h.trim().replace(/^\uFEFF/, "");
                return CANONICAL_WEEKLY[clean.toLowerCase()] || clean;
            }),
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true,
        });
        // Load admin settings for pricing resolution
        const adminSettings = await (0, adminSettings_1.getAdminSettings)();
        // Counters
        let committedRows = 0;
        let failedRows = 0;
        let pricingCurrent = 0;
        let pricingDiscrepancy = 0;
        let pricingPending = 0;
        let lossLeaderReview = 0;
        const errors = [];
        const committedMpns = [];
        // Step 5 — Process each row
        for (let i = 0; i < records.length; i++) {
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
            const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
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
                const existingProduct = productSnap.data();
                // Parse pricing and inventory fields
                const ricsRetail = parseFloat(row["Store Price"]) || 0;
                const ricsOffer = parseFloat(row["Store Sale Price"]) || 0;
                const scom = parseFloat(row["Web Price"]) || 0;
                const scomSale = parseFloat(row["Web Sale Price"]) || 0;
                const inventoryStore = parseInt(row["Store Inv"]) || 0;
                const inventoryWarehouse = parseInt(row["Warehouse Inv"]) || 0;
                const inventoryWhs = parseInt(row["WHS inv"]) || 0;
                // Update pricing fields on product document (merge)
                await firestore.collection("products").doc(docId).set({
                    rics_retail: ricsRetail,
                    rics_offer: ricsOffer,
                    scom,
                    scom_sale: scomSale,
                    inventory_store: inventoryStore,
                    inventory_warehouse: inventoryWarehouse,
                    inventory_whs: inventoryWhs,
                    last_weekly_import_at: db.FieldValue.serverTimestamp(),
                    updated_at: db.FieldValue.serverTimestamp(),
                }, { merge: true });
                // Immediately fire Pricing Resolution for this product
                const pricingInputs = {
                    rics_retail: ricsRetail,
                    rics_offer: ricsOffer,
                    scom,
                    scom_sale: scomSale,
                    actual_cost: existingProduct.actual_cost || null,
                };
                const pricingResult = await (0, pricingResolution_1.resolvePricing)(mpn, pricingInputs, await (0, mapState_1.getMapState)(mpn), adminSettings);
                // Write pricing snapshot
                await (0, pricingResolution_1.writePricingSnapshot)(mpn, batch_id, pricingResult);
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
            }
            catch (rowErr) {
                failedRows++;
                errors.push({
                    row: rowNum,
                    mpn,
                    error: "An unexpected error occurred while processing this row. Please verify the data and try again.",
                });
                console.error(`Weekly Ops Row ${rowNum} (MPN: ${mpn}) error:`, rowErr);
            }
        }
        // Step 6 — Fire Post-Import Calculation Job for all committed MPNs
        let metricsResult = { calculated: 0, skipped: 0 };
        if (committedMpns.length > 0) {
            metricsResult = await (0, postImportCalculation_1.runPostImportCalculations)(batch_id, committedMpns, adminSettings);
        }
        // Step 6b — Step 2.2 — Run cadence evaluation after post-import calcs
        let cadenceResult = { evaluated: 0, assigned: 0, unassigned: 0, conflicts: 0, skipped_mid_cadence: 0 };
        if (committedMpns.length > 0) {
            try {
                cadenceResult = await (0, cadenceEngine_1.runCadenceEvaluation)(committedMpns);
            }
            catch (ce) {
                console.error("runCadenceEvaluation failed:", ce.message);
            }
        }
        // Step 6b.1 — Step 3.2 — Weekly metric snapshots for executive dashboard
        try {
            await (0, executiveProjections_1.writeWeeklySnapshots)();
        }
        catch (snapErr) {
            console.error("writeWeeklySnapshots failed:", snapErr.message);
        }
        // Step 6b.2 — Step 3.3 — Buyer performance matrix (depends on fresh snapshots)
        try {
            await (0, buyerPerformanceMatrix_1.computeBuyerPerformanceMatrix)();
        }
        catch (bpErr) {
            console.error("computeBuyerPerformanceMatrix failed:", bpErr.message);
        }
        // Step 6b.3 — Step 3.4 — AI Weekly Advisory (fire-and-forget; don't block response)
        try {
            (0, aiWeeklyAdvisory_1.generateWeeklyAdvisories)(batch_id).catch((advErr) => console.error("generateWeeklyAdvisories (fire-and-forget) failed:", advErr?.message || advErr));
        }
        catch (_err) {
            /* silent — fire-and-forget must never throw */
        }
        // Step 6c — Step 2.4 — Re-evaluate launch High Priority flags for committed MPNs
        if (committedMpns.length > 0) {
            for (const mpn of committedMpns) {
                try {
                    await (0, launchHighPriority_1.checkHighPriorityFlag)(mpn);
                }
                catch (hpErr) {
                    console.error(`checkHighPriorityFlag failed for ${mpn}:`, hpErr.message);
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
        res.status(200).json({
            batch_id,
            status: finalStatus,
            total_rows: records.length,
            committed_rows: committedRows,
            failed_rows: failedRows,
            pricing_current: pricingCurrent,
            pricing_discrepancy: pricingDiscrepancy,
            pricing_pending: pricingPending,
            loss_leader_review: lossLeaderReview,
            metrics_calculated: metricsResult.calculated,
            errors,
        });
    }
    catch (err) {
        console.error("Weekly Operations commit error:", err);
        try {
            await firestore
                .collection("import_batches")
                .doc(batch_id)
                .update({
                status: "failed",
                errors: [
                    {
                        error: "An unexpected error occurred during commit processing.",
                    },
                ],
                completed_at: db.FieldValue.serverTimestamp(),
            });
        }
        catch (_) {
            // swallow — best effort
        }
        res.status(500).json({
            error: "An unexpected error occurred during batch commit. Please try again.",
        });
    }
});
exports.default = router;
//# sourceMappingURL=importWeeklyOperations.js.map