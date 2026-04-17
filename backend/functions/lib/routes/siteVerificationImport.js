"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Site Verification — Step 2.5 Part 3.
 *   POST /upload                — parse CSV headers, stash in storage
 *   POST /:batch_id/commit      — apply site_verification updates to products
 *
 * Flexible column mapping via the same pattern as MAP Policy. Required columns
 * are MPN, Site, Product URL, Verification Date. Image URL is optional.
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const multer_1 = __importDefault(require("multer"));
const uuid_1 = require("uuid");
const sync_1 = require("csv-parse/sync");
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const mpnUtils_1 = require("../services/mpnUtils");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
});
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
const operatorRoles = ["operations_operator", "product_ops"];
// ── POST /upload ──
router.post("/upload", auth_1.requireAuth, (0, roles_1.requireRole)(operatorRoles), upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            res.status(400).json({ error: "No file uploaded." });
            return;
        }
        const csvContent = file.buffer.toString("utf-8");
        const records = (0, sync_1.parse)(csvContent, {
            columns: false,
            skip_empty_lines: true,
            relax_column_count: true,
        });
        if (records.length < 1) {
            res.status(400).json({ error: "CSV file is empty." });
            return;
        }
        const rawHeaders = records[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
        const dataRows = records.slice(1);
        const batchId = (0, uuid_1.v4)();
        const firestore = firebase_admin_1.default.firestore();
        // Stash rows directly in the batch doc (these files are small)
        await firestore.collection("import_batches").doc(batchId).set({
            batch_id: batchId,
            family: "site_verification",
            status: "pending_mapping",
            raw_headers: rawHeaders,
            row_count: dataRows.length,
            raw_rows: dataRows.slice(0, 5000), // cap defensively
            committed_rows: 0,
            failed_rows: 0,
            errors: [],
            warnings: [],
            created_by: req.user?.uid || "system",
            created_at: ts(),
        });
        res.json({ batch_id: batchId, raw_headers: rawHeaders, row_count: dataRows.length });
    }
    catch (err) {
        console.error("Site verification upload error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── POST /:batch_id/commit ──
router.post("/:batch_id/commit", auth_1.requireAuth, (0, roles_1.requireRole)(operatorRoles), async (req, res) => {
    try {
        const { batch_id } = req.params;
        const { column_mapping } = req.body || {};
        if (!column_mapping ||
            !column_mapping.mpn ||
            !column_mapping.site ||
            !column_mapping.product_url) {
            res.status(400).json({
                error: "column_mapping.mpn, column_mapping.site, and column_mapping.product_url are required",
            });
            return;
        }
        const firestore = firebase_admin_1.default.firestore();
        const batchRef = firestore.collection("import_batches").doc(batch_id);
        const batchSnap = await batchRef.get();
        if (!batchSnap.exists) {
            res.status(404).json({ error: `Batch ${batch_id} not found.` });
            return;
        }
        const batch = batchSnap.data();
        if (batch.family !== "site_verification") {
            res.status(400).json({ error: "Not a site_verification batch." });
            return;
        }
        const rawHeaders = batch.raw_headers || [];
        const rawRows = batch.raw_rows || [];
        const headerIndex = {};
        rawHeaders.forEach((h, i) => (headerIndex[h] = i));
        function cell(row, header) {
            if (!header)
                return "";
            const idx = headerIndex[header];
            return idx === undefined ? "" : (row[idx] || "").trim();
        }
        let committed = 0;
        const warnings = [];
        const errors = [];
        for (let i = 0; i < rawRows.length; i++) {
            const row = rawRows[i];
            const mpn = cell(row, column_mapping.mpn);
            const site = cell(row, column_mapping.site);
            const productUrl = cell(row, column_mapping.product_url);
            const imageUrl = column_mapping.image_url
                ? cell(row, column_mapping.image_url)
                : "";
            if (!mpn) {
                errors.push(`Row ${i + 2}: missing MPN`);
                continue;
            }
            if (!site) {
                errors.push(`Row ${i + 2} (MPN ${mpn}): missing Site`);
                continue;
            }
            const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
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
            let mismatch_reason = null;
            if (hasProductUrl && !hasImageUrl) {
                verification_state = "mismatch";
                mismatch_reason = "image_missing";
            }
            else if (!hasProductUrl) {
                verification_state = "mismatch";
                mismatch_reason = "url_missing";
            }
            await productRef.set({
                site_verification: {
                    [siteKey]: {
                        verification_state,
                        product_url: hasProductUrl ? productUrl : null,
                        image_url: hasImageUrl ? imageUrl : null,
                        last_verified_at: ts(),
                        mismatch_reason,
                    },
                },
            }, { merge: true });
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
        res.json({ batch_id, committed, failed: errors.length, warnings, errors });
    }
    catch (err) {
        console.error("Site verification commit error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=siteVerificationImport.js.map