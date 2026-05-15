import { Router, Request, Response } from "express";
import admin from "firebase-admin";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { parse } from "csv-parse/sync";
import { executeSmartRules } from "../services/smartRules";
import { mpnToDocId } from "../services/mpnUtils";
import { mapFullProductRow, FULL_PRODUCT_ROW_MAP } from "../services/ricsParser";
import { parseImportDate } from "../services/parseImportDate";
import { buildSearchTokens } from "../services/searchTokens";
import {
  buildBrandCanonicalizer,
  buildDepartmentCanonicalizer,
  buildSiteOwnerCanonicalizer,
  buildBrandDefaultSiteOwnerMap,
  type Canonicalizer,
} from "../lib/registryAuthority";
import {
  respondAsync,
  runInBackground,
  finishImportJob,
  updateProgress,
} from "../services/importJobRunner";
import {
  computeCompletion,
  stampCompletionOnProduct,
} from "../services/completionCompute";
// TALLY-3.8-DEFECT-3 — pricing-domain initialization on import.
// Mirrors importWeeklyOperations.ts:14–L20 import set.
import {
  resolvePricing,
  writePricingSnapshot,
  PricingInputs,
} from "../services/pricingResolution";
import { getMapState } from "../services/mapState";
import { getAdminSettings } from "../services/adminSettings";
// TALLY-144-2E — ownership-at-import (Strategy C). Resolve buyer from the
// same hierarchy used by cadence evaluation and stamp ownership visibility
// fields onto cadence_assignments/{productId}. Additive — does NOT trigger
// runCadenceEvaluation and does NOT touch product root or buyer_assignments.
import {
  loadAllBuyerPortfolios,
  resolveBuyerForProduct,
} from "../lib/portfolioFilter";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const db = admin.firestore;

// TALLY-078 — Required columns for Full Product Import
// TALLY-145 — Inventory contract cleanup:
//   * "Distro Ctr" is the new canonical distribution-center inventory header.
//   * "Total Inventory" is the CSV-sourced total (backend never recomputes).
//   * "WHS inv" is no longer required — it is accepted as a legacy alias only,
//     handled at row read time. Distro Ctr wins when both are present.
const REQUIRED_COLUMNS = [
  "MPN", "SKU", "Brand", "Name", "RO Status",
  "Web Regular Price", "Web Sale Price", "Retail Price", "Retail Sale Price",
  "Store Inv", "Warehouse Inv", "Distro Ctr", "Total Inventory",
  "Website", "Media Status",
];

// ────────────────────────────────────────────────
//  POST /api/v1/imports/full-product/upload
// ────────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded. Please attach a CSV file." });
      return;
    }

    // Parse the CSV to get headers and rows
    const csvContent = file.buffer.toString("utf-8");
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) {
      res.status(400).json({ error: "CSV file is empty or has no data rows." });
      return;
    }

    // Parse full CSV to get accurate row count and detect duplicate columns
    const records = parse(csvContent, {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as string[][];

    const headerRow = records[0];
    const warnings: string[] = [];

    // TALLY-080 Rule 2 — Duplicate column detection (case-insensitive, BOM-safe)
    //
    // TALLY-PHASE-3.9 Track 1A (documentary, supersedes the prior
    // TALLY-SHIPPING-OVERRIDE-CLEANUP PR 1.3 note):
    // PO Ruling 2026-05-04 reclassifies "Override Standard Shipping" and
    // "Override Expedited Shipping" as RO-sourced. Both headers are now
    // present in FULL_PRODUCT_ROW_MAP (services/ricsParser.ts) and
    // canonicalize to standard_shipping_override / expedited_shipping_override.
    // The import path writes them through the canonical attribute loop AND
    // mirrors them to the root product doc so reviewActiveOverrides.ts can
    // see them. Editorial protection now relies on the standard
    // Human-Verified skip in that loop (saveField in products.ts Block 4d
    // stamps that state on user edits).
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
    const presentLower = new Set(Object.keys(columnMap).map((k) => k.toLowerCase()));
    const missingColumns = REQUIRED_COLUMNS.filter((c) => !presentLower.has(c.toLowerCase()));

    if (missingColumns.length > 0) {
      res.status(400).json({
        error: "CSV is missing required columns.",
        missing_columns: missingColumns,
        message: `The following required columns are missing: ${missingColumns.join(", ")}. Please ensure your CSV includes all required columns and try again.`,
      });
      return;
    }

    const rowCount = records.length - 1; // exclude header
    const batchId = uuidv4();
    const filename = file.originalname || "upload.csv";
    const filePath = `imports/full-product/${batchId}/${filename}`;

    // Store file in Firebase Storage
    const bucket = admin.storage().bucket();
    const storageFile = bucket.file(filePath);
    await storageFile.save(file.buffer, {
      contentType: "text/csv",
      metadata: { batch_id: batchId },
    });

    // Create import_batches document
    const firestore = admin.firestore();
    await firestore.collection("import_batches").doc(batchId).set({
      batch_id: batchId,
      family: "full_product",
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
    console.error("Upload error:", err);
    res.status(500).json({ error: "An unexpected error occurred during file upload. Please try again." });
  }
});

// ────────────────────────────────────────────────
//  POST /api/v1/imports/full-product/:batch_id/commit
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
    if (batchData.status === "processing") {
      res.status(409).json({ error: `Batch ${batch_id} is already being processed.` });
      return;
    }
    if (batchData.status === "complete") {
      res.status(409).json({ error: `Batch ${batch_id} has already been committed.` });
      return;
    }
    if (batchData.status !== "pending") {
      res.status(409).json({ error: `Batch ${batch_id} has status "${batchData.status}" and cannot be committed.` });
      return;
    }

    // Step 2 — Set status to processing and respond immediately so the
    // client can show a progress card while the heavy work runs in the
    // background. The remainder of this handler runs detached.
    await batchRef.update({
      status: "processing",
      progress_pct: 0,
      processing_started_at: db.FieldValue.serverTimestamp(),
    });
    const __userId = (req as any).user?.uid || batchData.uploaded_by || null;
    respondAsync(res, batch_id);

    runInBackground(batch_id, "full_product", async () => {

    // Step 3 — Retrieve the file from Firebase Storage
    const bucket = admin.storage().bucket();
    const [fileBuffer] = await bucket.file(batchData.file_path).download();
    const csvContent = fileBuffer.toString("utf-8");

    // Step 4 — Parse all data rows (case-insensitive, BOM-safe headers)
    const CANONICAL_FP: Record<string, string> = {};
    REQUIRED_COLUMNS.forEach((c) => { CANONICAL_FP[c.toLowerCase()] = c; });
    // Also include optional columns accessed by the commit handler
    ["RICS Color", "RICS Short Description", "RICS Long Desc", "RICS Category", "RICS Brand"].forEach((c) => { CANONICAL_FP[c.toLowerCase()] = c; });
    // Import Intelligence Layer — accept every column in the full row map
    Object.keys(FULL_PRODUCT_ROW_MAP).forEach((c) => { CANONICAL_FP[c.toLowerCase()] = c; });

    const records = parse(csvContent, {
      columns: (header: string[]) =>
        header.map((h: string) => {
          const clean = h.trim().replace(/^\uFEFF/, "");
          return CANONICAL_FP[clean.toLowerCase()] || clean;
        }),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, string>[];

    // Load site_registry for Website field validation (TALLY-079)
    const sitesSnap = await firestore.collection("site_registry").get();
    // Map domain → doc ID for matching CSV website values to registry entries
    const domainToSiteId = new Map<string, string>();
    sitesSnap.docs.forEach((d) => {
      const domain = (d.data().domain || "").toLowerCase();
      if (domain) domainToSiteId.set(domain, d.id);
    });

    // Issue #1 — build canonicalizers once per import batch.
    // Replaces per-row loadBrandRegistry/matchBrand + getActiveDepartmentKeys checks.
    const canonicalizeBrand: Canonicalizer = await buildBrandCanonicalizer();
    const canonicalizeDepartment: Canonicalizer = await buildDepartmentCanonicalizer();
    const canonicalizeSiteOwner: Canonicalizer = await buildSiteOwnerCanonicalizer();
    const brandDefaultSiteOwnerMap = await buildBrandDefaultSiteOwnerMap(admin.firestore());

    // Orphan tracking for import summary.
    const orphanBrands = new Set<string>();
    const orphanDepartments = new Set<string>();
    const orphanSiteOwners = new Set<string>();

    // Counters
    let committedRows = 0;
    let failedRows = 0;
    let pricingIncomplete = 0;
    let pricingDiscrepancy = 0;
    let uuidNamesCleaned = 0;
    let noImageProducts = 0;
    let totalRulesFired = 0;
    const errors: Array<{ row: number; mpn: string; error: string }> = [];
    const batchWarnings: string[] = [...(batchData.warnings || [])];
    const committedMpns: string[] = [];

    // Step 5 — Process each row
    for (let i = 0; i < records.length; i++) {
      // Background progress signal — throttled inside updateProgress.
      if (i % 25 === 0) {
        await updateProgress(batch_id, (i / records.length) * 100, {
          committed: committedRows,
          failed: failedRows,
        });
      }
      const row = records[i];
      const rowNum = i + 2; // 1-indexed, +1 for header
      const mpn = (row.MPN || "").trim();

      // ── Step A — Row Validation ──
      if (!mpn) {
        failedRows++;
        errors.push({
          row: rowNum,
          mpn: "",
          error: "MPN is required — this row has no product identifier",
        });
        continue;
      }

      // Validate numeric price fields
      const priceFields = [
        "Web Regular Price",
        "Web Sale Price",
        "Retail Price",
        "Retail Sale Price",
      ];
      let rowValid = true;
      for (const pf of priceFields) {
        const val = (row[pf] || "").trim();
        if (val !== "" && isNaN(Number(val))) {
          failedRows++;
          errors.push({
            row: rowNum,
            mpn,
            error: `Field [${pf}] contains non-numeric value [${val}] — expected a number`,
          });
          rowValid = false;
          break;
        }
      }
      if (!rowValid) continue;

      try {
        // ── Step B — Field Routing ──

        // Identity → canonical product document
        const identity: Record<string, any> = {
          mpn,
          sku: (row.SKU || "").trim(),
          brand: (row.Brand || "").trim(),
          name: (row.Name || "").trim(),
          status: (row["RO Status"] || "").trim(),
          last_received_at: parseImportDate(row["Last Received"]) ?? db.FieldValue.serverTimestamp(),
          updated_at: db.FieldValue.serverTimestamp(),
        };

        // Issue #1 — resolve brand against active brand_registry (key → display_name → alias).
        // Saves canonical display to identity.brand and canonical key to identity.brand_key.
        // Orphan rows get raw display + empty key (no slug-derived fallback).
        const rawBrand = identity.brand;
        const brandMatch = canonicalizeBrand(rawBrand);
        if (rawBrand && !brandMatch) {
          orphanBrands.add(rawBrand);
          console.warn(`[import] orphan brand: "${rawBrand}" did not match any active brand_registry entry`);
        }
        identity.brand = brandMatch?.display ?? (rawBrand || "");
        identity.brand_key = brandMatch?.key ?? "";

        // Source inputs → source_inputs subcollection
        const sourceInputs: Record<string, any> = {
          rics_color: (row["RICS Color"] || "").trim(),
          rics_short_description: (row["RICS Short Description"] || "").trim(),
          rics_long_description: (row["RICS Long Desc"] || "").trim(),
          rics_category: (row["RICS Category"] || "").trim(),
          rics_brand: (row["RICS Brand"] || "").trim(),
        };

        // Pricing inputs
        const scom = parseFloat(row["Web Regular Price"]) || 0;
        const scomSale = parseFloat(row["Web Sale Price"]) || 0;
        const ricsRetail = parseFloat(row["Retail Price"]) || 0;
        const ricsOffer = parseFloat(row["Retail Sale Price"]) || 0;

        const pricing = {
          scom,
          scom_sale: scomSale,
          rics_retail: ricsRetail,
          rics_offer: ricsOffer,
        };

        // Inventory inputs
        // TALLY-145 — "Distro Ctr" is the canonical distribution-center inventory
        // header. "WHS inv" remains accepted as a legacy alias only; when both
        // are present Distro Ctr wins. inventory_whs is mirrored to the resolved
        // value so legacy readers do not see stale data, but it is not the
        // canonical future field. "Total Inventory" is read directly from the
        // CSV — backend never recomputes it (PO ruling 2026-05-12).
        const distroCtrRaw = (row["Distro Ctr"] ?? "").toString().trim();
        const whsInvLegacyRaw = (row["WHS inv"] ?? "").toString().trim();
        const distributionCenterInventory =
          distroCtrRaw !== ""
            ? (parseInt(distroCtrRaw) || 0)
            : (parseInt(whsInvLegacyRaw) || 0);
        const inventory = {
          inventory_store: parseInt(row["Store Inv"]) || 0,
          inventory_warehouse: parseInt(row["Warehouse Inv"]) || 0,
          distribution_center_inventory: distributionCenterInventory,
          inventory_whs: distributionCenterInventory,
          total_inventory: parseInt(row["Total Inventory"]) || 0,
        };

        // Media Status
        const mediaStatus = (row["Media Status"] || "").trim();

        // Website field parsing (TALLY-079)
        const websiteRaw = (row.Website || "").trim();
        const siteList = websiteRaw
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s !== "");

        // ── Step C — Write Product to Firestore ──
        const docId = mpnToDocId(mpn);
        const productRef = firestore.collection("products").doc(docId);

        // Check if product exists for first_received_at logic
        const existingSnap = await productRef.get();
        const isNewProduct = !existingSnap.exists;
        const firstReceivedAt = existingSnap.exists
          ? existingSnap.data()!.first_received_at
          : (parseImportDate(row["First Received"]) ?? db.FieldValue.serverTimestamp());

        await productRef.set(
          {
            ...identity,
            ...pricing,
            ...inventory,
            media_status: mediaStatus,
            first_received_at: firstReceivedAt,
            completion_state: "incomplete",
            product_is_active: true,
            import_batch_id: batch_id,
          },
          { merge: true }
        );

        // Correction 1 (Step 2.5) — log product creation for history
        if (isNewProduct) {
          await firestore.collection("audit_log").add({
            product_mpn: mpn,
            event_type: "product_created",
            acting_user_id: `import:${batch_id}`,
            origin_type: "RO-Import",
            source_type: "import",
            batch_id,
            created_at: db.FieldValue.serverTimestamp(),
          });
        }

        // Write source inputs to subcollection
        await productRef
          .collection("attribute_values")
          .doc("source_inputs")
          .set(sourceInputs, { merge: true });

        // Write site_targets
        for (const site of siteList) {
          const siteId = domainToSiteId.get(site);
          if (siteId) {
            await productRef
              .collection("site_targets")
              .doc(siteId)
              .set(
                {
                  site_id: siteId,
                  domain: site,
                  active: true,
                  updated_at: db.FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
          } else {
            batchWarnings.push(
              `Row ${rowNum} (MPN: ${mpn}): Site "${site}" not found in Site Registry. Field imported but not linked to an active site target.`
            );
          }
        }

        // Issue #1 — resolve canonical site_owner for product root.
        // The CSV Website column contains domain strings; canonicalizeSiteOwner
        // maps domain → site_registry key (doc.id). Write to product root so
        // .where("site_owner") queries in the product list route work correctly.
        const rawSiteOwnerDomain = siteList[0] ?? null;
        const siteMatch = canonicalizeSiteOwner(rawSiteOwnerDomain);
        if (rawSiteOwnerDomain && !siteMatch) {
          orphanSiteOwners.add(rawSiteOwnerDomain);
          console.warn(`[import] orphan site_owner: "${rawSiteOwnerDomain}" did not match any active site_registry entry`);
        }

        // TALLY-D2C: brand-default site_owner overrides CSV-derived domain.
        // brandDefaultSiteOwnerMap is loaded once per batch at startup.
        // Brand default wins; falls through to CSV-derived value for brands
        // without a default_site_owner (preserves prior behavior as fallback).
        const brandDefaultSiteOwner = brandDefaultSiteOwnerMap.get(identity.brand_key) ?? null;
        const effectiveSiteOwnerKey = brandDefaultSiteOwner ?? siteMatch?.key ?? "";

        await productRef.set(
          { site_owner: effectiveSiteOwnerKey },
          { merge: true }
        );
        // TALLY-148: write canonical site_key to attribute_values["site_owner"]
        // so QuickEditPanel can pre-populate the site_owner dropdown.
        // Only write when a canonical match exists; never overwrite Human-Verified.
        if (effectiveSiteOwnerKey) {
          const siteOwnerAttrRef = productRef
            .collection("attribute_values")
            .doc("site_owner");
          const existingSiteOwnerAttr = await siteOwnerAttrRef.get();
          if (
            !existingSiteOwnerAttr.exists ||
            existingSiteOwnerAttr.data()?.verification_state !== "Human-Verified"
          ) {
            await siteOwnerAttrRef.set(
              {
                field_name: "site_owner",
                value: effectiveSiteOwnerKey,
                origin_type: "Import",
                origin_rule: "Full Product Import",
                origin_detail: `Import Batch ${batch_id}`,
                verification_state: "Rule-Verified",
                updated_at: db.FieldValue.serverTimestamp(),
                written_at: db.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        }
        // TALLY-103: MPN and SKU arrive pre-verified (Human-Verified)
        const importAttributes: Record<string, any> = {
          mpn,
          sku: identity.sku,
          brand: identity.brand,
          product_name: identity.name,
          status: identity.status,
        };
        const autoVerifiedKeys = new Set(["mpn", "sku"]);
        for (const [key, value] of Object.entries(importAttributes)) {
          if (value !== undefined && value !== "") {
            // Check if existing attribute was AI-Generated + Human-Verified (Step 2.3 — needs_ai_review)
            const existingAttrDoc = await productRef
              .collection("attribute_values")
              .doc(key)
              .get();
            const existingAttr = existingAttrDoc.exists
              ? existingAttrDoc.data()
              : null;

            const newVerificationState = autoVerifiedKeys.has(key)
              ? "Human-Verified"
              : "Rule-Verified";

            await productRef
              .collection("attribute_values")
              .doc(key)
              .set(
                {
                  value,
                  origin_type: "RO-Import",
                  origin_detail: `Import Batch ${batch_id}`,
                  verification_state: newVerificationState,
                  written_at: db.FieldValue.serverTimestamp(),
                },
                { merge: true }
              );

            // Correction 1 (Step 2.5) — audit_log with old → new value for history tab
            const oldValue = existingAttr?.value ?? null;
            if (oldValue !== value) {
              await firestore.collection("audit_log").add({
                product_mpn: mpn,
                event_type: existingAttr ? "field_edited" : "field_created",
                field_key: key,
                old_value: oldValue,
                old_verification_state: existingAttr?.verification_state ?? null,
                new_value: value,
                new_verification_state: newVerificationState,
                acting_user_id: `import:${batch_id}`,
                origin_type: "RO-Import",
                source_type: "import",
                batch_id,
                created_at: db.FieldValue.serverTimestamp(),
              });
            }

            // If the field being overwritten was AI-Generated + Human-Verified, flag for re-review
            if (
              existingAttr?.origin_type === "AI-Generated" &&
              existingAttr?.verification_state === "Human-Verified"
            ) {
              await productRef.set(
                {
                  needs_ai_review: true,
                  ai_review_reason: `${key} was overwritten by import — please re-review AI content`,
                },
                { merge: true }
              );
            }

            // Also check include_in_ai_prompt — if true and product has approved content, flag
            const registryDoc = await firestore
              .collection("attribute_registry")
              .doc(key)
              .get();
            if (registryDoc.exists && registryDoc.data()?.include_in_ai_prompt) {
              const approvedSnap = await productRef
                .collection("content_versions")
                .where("approval_state", "==", "approved")
                .limit(1)
                .get();
              if (!approvedSnap.empty) {
                await productRef.set(
                  {
                    needs_ai_review: true,
                    ai_review_reason: `${key} (AI prompt input) was updated by import — please re-review AI content`,
                  },
                  { merge: true }
                );
              }
            }
          }
        }

        // ── Step C.5 — Full Column Mapping + RICS Intelligence ──
        // Applies the complete 50-column mapping from the RO export, runs
        // the rules-based RICS Category parser, normalizes color / name,
        // and stamps top-level taxonomy fields for query performance.
        // Human-Verified attributes are never overwritten.
        try {
          const mapped = mapFullProductRow(row);

          // Issue #1 — inject brand_key + department_key using canonicalizers
          // (replaces TALLY-PRODUCT-LIST-UX Phase 0.5 active-key-Set checks).
          // brand is already resolved on identity from the per-row block above.
          if (mapped.top_level.brand !== undefined) {
            mapped.top_level.brand = identity.brand;
            mapped.top_level.brand_key = identity.brand_key;
          }
          const deptRaw = mapped.top_level.department ? String(mapped.top_level.department) : "";
          const deptMatch = canonicalizeDepartment(deptRaw);
          if (deptRaw && !deptMatch) {
            orphanDepartments.add(deptRaw.trim());
            console.warn(`[import] orphan department: "${deptRaw}" did not match any active department_registry entry`);
          }
          mapped.top_level.department = deptMatch?.display ?? (deptRaw ? deptRaw.trim() : "");
          mapped.top_level.department_key = deptMatch?.key ?? "";

          // Stamp top-level fields on the product document (query perf)
          if (Object.keys(mapped.top_level).length > 0) {
            await productRef.set(mapped.top_level, { merge: true });
          }

          // Track 2 — mirror age_group onto product top-level for cadence portfolio matching
          // Source of truth: attribute_values.age_group (set in Step C.6 above)
          // Consumer: cadenceEngine.resolveBuyerForProduct (top-level read, fail-closed)
          const ageGroupForMirror =
            mapped.attributes?.age_group ||
            mapped.attributes?.age_group_detail ||
            "";
          if (ageGroupForMirror) {
            await productRef.set(
              { age_group: ageGroupForMirror },
              { merge: true }
            );
          }

          // Stamp search_tokens for database-side text search.
          // This is what makes search work with pagination — Firestore has
          // no LIKE/CONTAINS, so we precompute the token set instead of
          // filtering in Node.
          await productRef.set(
            {
              search_tokens: buildSearchTokens({
                mpn: identity.mpn,
                name: mapped.attributes.name || identity.name,
                brand: identity.brand,
                sku: identity.sku,
                department: mapped.attributes.department,
              }),
            },
            { merge: true }
          );

          // Flag products whose name was derived from RICS Short Desc so
          // the post-import AI enrichment pass can find them.
          if (mapped.name_source === "rics_short_desc") {
            await productRef.set(
              { name_source: "rics_short_desc", needs_ai_name: true },
              { merge: true }
            );
          } else if (mapped.name_source === "csv_name") {
            await productRef.set({ name_source: "csv_name" }, { merge: true });
          }

          // Flag products whose descriptive_color is still blank after
          // normalization so the AI enrichment pass can fill it.
          if (!mapped.attributes.descriptive_color || mapped.attributes.descriptive_color === "") {
            await productRef.set({ needs_ai_color: true }, { merge: true });
          }

          // Write each attribute into attribute_values, skipping those
          // already Human-Verified.
          const skipCanonical = new Set([
            "mpn", // already written above with its own provenance
            "sku",
            "brand",      // written via importAttributes loop with canonical display
            "department", // TALLY-146: canonical display + department_key written to
                          // top_level via canonicalizeDepartment; raw CSV value must
                          // not overwrite attribute_values["department"] via this loop
            "site_owner", // TALLY-146: canonical key written to root.site_owner via
                          // canonicalizeSiteOwner; raw CSV domain (e.g. "Shiekh.com")
                          // must not overwrite attribute_values["site_owner"]
            "name",
            "status",
            "ro_status",
            // These are in source_inputs already
            "rics_color",
            "rics_short_desc",
            "rics_long_desc",
            "rics_category",
            // Receiving timestamps handled on top-level doc
            "last_received_at",
            "first_received_at",
          ]);

          for (const [attrKey, attrValueIn] of Object.entries(mapped.attributes)) {
            if (skipCanonical.has(attrKey)) continue;
            if (attrValueIn === undefined || attrValueIn === null || attrValueIn === "") continue;

            // Track 1A-FU: import path treats $0 / numeric-0 in the shipping
            // override columns as "no override intended." CSV cells like
            // "$0", "N/A", "—" coerce to numeric 0 upstream via coerceValue;
            // this guard converts those to null so the canonical write
            // produces null in BOTH the root doc and the attribute_values
            // mirror. saveField/manual-edit path (routes/products.ts Block 4d
            // L1159-1193) is intentionally unaffected — buyer-set $0 there
            // remains a valid deliberate override.
            let attrValue: any = attrValueIn;
            if (
              (attrKey === "standard_shipping_override" ||
                attrKey === "expedited_shipping_override") &&
              attrValue === 0
            ) {
              attrValue = null;
            }

            const attrRef = productRef.collection("attribute_values").doc(attrKey);
            const existing = await attrRef.get();
            if (
              existing.exists &&
              existing.data()?.verification_state === "Human-Verified"
            ) {
              continue; // never overwrite Human-Verified
            }

            await attrRef.set(
              {
                value: attrValue,
                origin_type: "Import",
                origin_detail: `Import Batch ${batch_id}`,
                verification_state: "Rule-Verified",
                written_at: db.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );

            // TALLY-PHASE-3.9 Track 1A — root mirror for shipping override fields.
            // PO Ruling 2026-05-04: shipping overrides are RO-sourced. Mirror to
            // root so reviewActiveOverrides.ts (queries products WHERE field != null)
            // sees imported values. Null semantics mirror Block 4d in products.ts:
            // null if empty/non-finite; 0 is a valid value. The empty-value guard
            // above means attrValue is non-empty here, but the defensive
            // null/undefined/"" handling is kept for parity with Block 4d.
            if (
              attrKey === "standard_shipping_override" ||
              attrKey === "expedited_shipping_override"
            ) {
              let numericValue: number | null;
              if (attrValue === null || attrValue === undefined || attrValue === "") {
                numericValue = null;
              } else if (typeof attrValue === "number") {
                numericValue = attrValue;
              } else {
                const parsed = Number(attrValue);
                numericValue = Number.isFinite(parsed) ? parsed : null;
              }
              await productRef.set({ [attrKey]: numericValue }, { merge: true });

              // PO Call D1 — audit_log emission for governance-tracked override
              // fields specifically. Mirrors the importAttributes loop pattern.
              const oldValue = existing.exists ? (existing.data()?.value ?? null) : null;
              const oldVerificationState = existing.exists
                ? (existing.data()?.verification_state ?? null)
                : null;
              if (oldValue !== attrValue) {
                await firestore.collection("audit_log").add({
                  product_mpn: mpn,
                  event_type: existing.exists ? "field_edited" : "field_created",
                  field_key: attrKey,
                  old_value: oldValue,
                  old_verification_state: oldVerificationState,
                  new_value: numericValue,
                  new_verification_state: "Rule-Verified",
                  acting_user_id: `import:${batch_id}`,
                  origin_type: "Import",
                  source_type: "import",
                  batch_id,
                  created_at: db.FieldValue.serverTimestamp(),
                });
              }
            }
          }

          // C.6 writes product_name to attribute_values, preferring the
          // UUID-resolved mapped.attributes.name from resolveProductName().
          // Falls back to identity.name when no resolution was applied.
          // Overwrites the earlier importAttributes loop write at ~L439
          // which writes raw identity.name unconditionally.

          // ── Step C.6 — Mirror Required Identity Fields into attribute_values ──
          // Ensures every newly-imported product has the canonical identity
          // attributes materialized in attribute_values so the completion-%
          // calculation can see them. Per spec we never overwrite a value
          // that has already been Human-Verified.
          //
          // Field mapping aligned to attribute_registry required keys:
          //   product_name  ← mapped.attributes.name (UUID-resolved) || identity.name
          //   brand         ← identity.brand
          //   sku           ← identity.sku
          //   department / gender / age_group / class / category /
          //   primary_color / descriptive_color / material_fabric /
          //   tax_class     ← mapped.attributes (taxonomy + colors)
          //   website       ← first parsed site from the Website column
          //   is_in_stock   ← top-level product_is_active flag
          const ageGroupValue =
            mapped.attributes.age_group ||
            mapped.attributes.age_group_detail ||
            "";
          const websiteValue = siteList[0] || websiteRaw || "";
          const fieldsToWriteAsAttributes: Record<string, any> = {
            product_name: mapped.attributes.name || identity.name,
            brand: identity.brand,
            sku: identity.sku,
            // TALLY-144-2C.1 — write canonical attribute_values/department_key
            // (value = root department_key, e.g. "footwear" / "clothing" /
            // "accessories") instead of the legacy attribute_values/department
            // (display string). The C.6 mirror loop was the sole remaining
            // writer of the leaked legacy doc per TALLY-144-2C recon.
            // The supporting registry doc attribute_registry/department_key
            // was seeded by TALLY-144-2C.0 (PR #136). Root product.department
            // and root product.department_key are still set upstream via
            // productRef.set(mapped.top_level, { merge: true }) — only the
            // attribute_values mirror entry is migrated here. Empty values
            // (no canonical match) are skipped by the loop's null/empty
            // guard below; legacy attribute_values/department docs are NOT
            // backfilled or quarantined by this patch (handled by
            // TALLY-144-2C / PR #135).
            department_key: mapped.top_level.department_key,
            gender: mapped.attributes.gender,
            age_group: ageGroupValue,
            class: mapped.attributes.class,
            category: mapped.attributes.category,
            primary_color: mapped.attributes.primary_color,
            descriptive_color: mapped.attributes.descriptive_color,
            material_fabric: mapped.attributes.material_fabric,
            tax_class: mapped.attributes.tax_class,
            website: websiteValue,
            is_in_stock: true, // imports default to active
          };

          for (const [fieldKey, value] of Object.entries(
            fieldsToWriteAsAttributes
          )) {
            if (value === undefined || value === null || value === "") continue;

            const attrRef = productRef.collection("attribute_values").doc(fieldKey);
            const existingDoc = await attrRef.get();
            if (
              existingDoc.exists &&
              existingDoc.data()?.verification_state === "Human-Verified"
            ) {
              continue; // never overwrite Human-Verified
            }

            await attrRef.set(
              {
                field_name: fieldKey,
                value: typeof value === "boolean" ? value : String(value),
                origin_type: "Import",
                origin_rule: "Full Product Import",
                origin_detail: `Import Batch ${batch_id}`,
                verification_state: "Rule-Verified",
                updated_at: db.FieldValue.serverTimestamp(),
                written_at: db.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        } catch (mapErr: any) {
          console.error(
            `Row ${rowNum} (MPN: ${mpn}) mapping error:`,
            mapErr?.message || mapErr
          );
          batchWarnings.push(
            `Row ${rowNum} (MPN: ${mpn}): Full-column mapping failed — ${mapErr?.message || "unknown error"}`
          );
        }

        // ── Step D — Fire Smart Rules (Section 19.10) ──
        const ruleResult = await executeSmartRules(docId, batch_id);
        totalRulesFired += ruleResult.rules_fired;
        if (ruleResult.uuid_names_cleaned) uuidNamesCleaned++;
        if (ruleResult.image_status_set === "NO") noImageProducts++;

        // ── Step E — Pricing State Flags (TALLY-080) ──
        const allZero =
          scom === 0 && scomSale === 0 && ricsRetail === 0 && ricsOffer === 0;
        const saleWithoutRegular = scomSale > 0 && scom === 0;

        if (saleWithoutRegular) {
          await productRef.set(
            { pricing_domain_state: "Pricing Discrepancy" },
            { merge: true }
          );
          pricingDiscrepancy++;
        } else if (allZero) {
          await productRef.set(
            { pricing_domain_state: "Pricing Incomplete" },
            { merge: true }
          );
          pricingIncomplete++;
        }

        committedRows++;
        committedMpns.push(mpn);
      } catch (rowErr: any) {
        failedRows++;
        errors.push({
          row: rowNum,
          mpn,
          error: "An unexpected error occurred while processing this row. Please verify the data and try again.",
        });
        console.error(`Row ${rowNum} (MPN: ${mpn}) error:`, rowErr);
      }
    }

    // TALLY-P1 — stamp 5-field completion projection for every committed
    // MPN. Sequential, non-transactional, best-effort. Stamping happens at
    // the HTTP handler boundary (per PO Ruling 2026-04-23 architectural
    // rule), after the full row loop — every product write, smart-rules
    // execution, and pricing-state flag has been applied.
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

    // TALLY-3.8-DEFECT-3 — stamp pricing projection (pricing_domain_state +
    // is_loss_leader, is_map_constrained, map_conflict_active triple,
    // is_store_sale_web_full, is_web_sale_store_full, gm_pct × 2). Mirrors
    // importWeeklyOperations.ts:320–L328 caller pattern, post-loop per
    // PO Ruling 2026-04-23 architectural rule. Chunked parallelization via
    // Promise.all (CHUNK_SIZE=25) to stay within Cloud Run task timeout.
    if (committedMpns.length > 0) {
      const adminSettings = await getAdminSettings();
      const CHUNK_SIZE = 25;

      for (let i = 0; i < committedMpns.length; i += CHUNK_SIZE) {
        const chunk = committedMpns.slice(i, i + CHUNK_SIZE);

        await Promise.all(
          chunk.map(async (mpn) => {
            try {
              const productRef = firestore
                .collection("products")
                .doc(mpnToDocId(mpn));
              const psnap = await productRef.get();
              const p = psnap.data() || {};
              const pricingInputs: PricingInputs = {
                rics_retail: Number(p.rics_retail) || 0,
                rics_offer: Number(p.rics_offer) || 0,
                scom: Number(p.scom) || 0,
                scom_sale: Number(p.scom_sale) || 0,
                actual_cost: p.actual_cost ?? null,
              };
              const mapState = await getMapState(mpn);
              const result = await resolvePricing(
                mpn,
                pricingInputs,
                mapState,
                adminSettings
              );
              const batchId = `import_${batch_id}_${mpnToDocId(mpn)}`;
              await writePricingSnapshot(mpn, batchId, result);
              if (result.status === "Pricing Current") {
                await productRef.set(
                  {
                    loss_leader_payload: null,
                    loss_leader_flagged_at: null,
                    discrepancy_reasons: null,
                    discrepancy_flagged_at: null,
                  },
                  { merge: true }
                );
              }
            } catch (perr: any) {
              console.warn("pricing_resolution_failed", {
                mpn,
                err: perr?.message,
              });
            }
          })
        );
      }
    }

    // TALLY-144-2E — Ownership at Import (Strategy C).
    // Resolve buyer ownership for every committed MPN using the same buyer
    // hierarchy and resolver used by live cadence evaluation, and upsert
    // ownership visibility fields onto cadence_assignments/{productId}.
    //
    // Scope rules (PO/Lisa-ratified):
    //   - Writes ONLY to cadence_assignments/{productId} (sibling doc).
    //   - DOES NOT write product root ownership fields.
    //   - DOES NOT create or write buyer_assignments collection.
    //   - DOES NOT trigger runCadenceEvaluation; cadence stays driven by the
    //     weekly importer (importWeeklyOperations).
    //   - Merge-only. NEVER overwrites cadence workflow fields:
    //       cadence_state, in_cadence_review_queue, manual_assignment,
    //       matched_rule_id, conflict_rule_ids, last_evaluated_at.
    //
    // Resolver source: lib/portfolioFilter.resolveBuyerForProduct, which
    // mirrors cadenceEngine.resolveBuyerForProduct (Frink pre-audit
    // confirmed cadenceEngine resolver was module-private; portfolioFilter
    // already exposes the same exclusions+AND-match predicate, so the
    // resolver was lifted there additively without refactoring cadenceEngine).
    if (committedMpns.length > 0) {
      try {
        const buyers = await loadAllBuyerPortfolios();
        const CHUNK_SIZE = 25;
        for (let i = 0; i < committedMpns.length; i += CHUNK_SIZE) {
          const chunk = committedMpns.slice(i, i + CHUNK_SIZE);
          await Promise.all(
            chunk.map(async (mpn) => {
              try {
                const docId = mpnToDocId(mpn);
                const psnap = await firestore
                  .collection("products")
                  .doc(docId)
                  .get();
                if (!psnap.exists) return;
                const product = psnap.data() || {};
                const resolution = resolveBuyerForProduct(product, buyers);
                const ownershipUpdate: Record<string, any> = {
                  mpn,
                  ownership_source: "import",
                  ownership_updated_at: db.FieldValue.serverTimestamp(),
                  ownership_import_batch_id: batch_id,
                };
                if (resolution.result === "matched") {
                  ownershipUpdate.primary_user_id = resolution.primary_user_id;
                  ownershipUpdate.assigned_user_id = resolution.primary_user_id;
                  ownershipUpdate.support_user_ids = resolution.support_user_ids;
                } else {
                  ownershipUpdate.primary_user_id = null;
                  ownershipUpdate.assigned_user_id = null;
                  ownershipUpdate.support_user_ids = [];
                }
                await firestore
                  .collection("cadence_assignments")
                  .doc(docId)
                  .set(ownershipUpdate, { merge: true });
              } catch (oerr: any) {
                console.warn("ownership_stamp_failed", {
                  mpn,
                  err: oerr?.message,
                });
              }
            })
          );
        }
      } catch (oerrBatch: any) {
        console.error(
          "ownership_stamp_batch_failed:",
          oerrBatch?.message
        );
      }
    }

    // Step 6 — Update batch record with final counts
    const finalStatus = failedRows === records.length ? "failed" : "complete";
    await batchRef.update({
      status: finalStatus,
      committed_rows: committedRows,
      failed_rows: failedRows,
      smart_rules_fired: totalRulesFired,
      warnings: batchWarnings,
      errors,
      completed_at: db.FieldValue.serverTimestamp(),
      summary: {
        uuid_names_cleaned: uuidNamesCleaned,
        no_image_products: noImageProducts,
        pricing_incomplete: pricingIncomplete,
        pricing_discrepancy: pricingDiscrepancy,
        orphans: {
          brands: Array.from(orphanBrands).sort(),
          departments: Array.from(orphanDepartments).sort(),
          site_owners: Array.from(orphanSiteOwners).sort(),
        },
      },
    });

    // Part 4 — async progress notification (replaces the now-detached res.json)
    await finishImportJob(
      batch_id,
      __userId,
      "full_product",
      `Full product import complete — ${committedRows.toLocaleString()} committed, ${failedRows.toLocaleString()} failed`
    );
    });
  } catch (err: any) {
    console.error("Commit error:", err);
    // Attempt to mark batch as failed
    try {
      await firestore.collection("import_batches").doc(batch_id).update({
        status: "failed",
        errors: [{ error: "An unexpected error occurred during commit processing." }],
        completed_at: db.FieldValue.serverTimestamp(),
      });
    } catch (_) {
      // swallow — best effort
    }
    if (!res.headersSent) {
      res.status(500).json({ error: "An unexpected error occurred during batch commit. Please try again." });
    }
  }
});

export default router;
