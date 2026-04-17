import { Router, Request, Response } from "express";
import admin from "firebase-admin";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { parse } from "csv-parse/sync";
import { executeSmartRules } from "../services/smartRules";
import { mpnToDocId } from "../services/mpnUtils";
import { mapFullProductRow, FULL_PRODUCT_ROW_MAP } from "../services/ricsParser";
import { buildSearchTokens } from "../services/searchTokens";
import {
  respondAsync,
  runInBackground,
  finishImportJob,
  updateProgress,
} from "../services/importJobRunner";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const db = admin.firestore;

// TALLY-078 — Required columns for Full Product Import
const REQUIRED_COLUMNS = [
  "MPN", "SKU", "Brand", "Name", "RO Status",
  "Web Regular Price", "Web Sale Price", "Retail Price", "Retail Sale Price",
  "Store Inv", "Warehouse Inv", "WHS inv",
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
          last_received_at: db.FieldValue.serverTimestamp(),
          updated_at: db.FieldValue.serverTimestamp(),
        };

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
        const inventory = {
          inventory_store: parseInt(row["Store Inv"]) || 0,
          inventory_warehouse: parseInt(row["Warehouse Inv"]) || 0,
          inventory_whs: parseInt(row["WHS inv"]) || 0,
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
          : db.FieldValue.serverTimestamp();

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

        // Write attribute values with provenance for import fields (TALLY-044)
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
              : "System-Applied";

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

          // Stamp top-level fields on the product document (query perf)
          if (Object.keys(mapped.top_level).length > 0) {
            await productRef.set(mapped.top_level, { merge: true });
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
            "brand",
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

          for (const [attrKey, attrValue] of Object.entries(mapped.attributes)) {
            if (skipCanonical.has(attrKey)) continue;
            if (attrValue === undefined || attrValue === null || attrValue === "") continue;

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
                verification_state: "System-Applied",
                written_at: db.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }

          // Rename "product_name" that the earlier block wrote — it duplicates "name".
          // No-op: we leave the existing product_name attribute untouched.

          // ── Step C.6 — Mirror Required Identity Fields into attribute_values ──
          // Ensures every newly-imported product has the canonical identity
          // attributes materialized in attribute_values so the completion-%
          // calculation can see them. Per spec we never overwrite a value
          // that has already been Human-Verified.
          //
          // Field mapping aligned to attribute_registry required keys:
          //   product_name  ← identity.name
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
            product_name: identity.name,
            brand: identity.brand,
            sku: identity.sku,
            department: mapped.attributes.department,
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
                verification_state: "System-Applied",
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
            { pricing_domain_state: "discrepancy" },
            { merge: true }
          );
          pricingDiscrepancy++;
        } else if (allZero) {
          await productRef.set(
            { pricing_domain_state: "pricing_incomplete" },
            { merge: true }
          );
          pricingIncomplete++;
        }

        committedRows++;
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
