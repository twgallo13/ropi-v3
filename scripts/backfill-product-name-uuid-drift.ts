#!/usr/bin/env -S npx tsx
/**
 * Phase 3.10 Track 1 — Fix product_name UUID drift.
 *
 * For each product in `products` collection where attribute_values/product_name.value
 * is a UUID (RICS internal UUID, not a human-readable name):
 *   1. Reads root.name (the resolved human-readable name set during import
 *      via mapped.top_level / search_tokens).
 *   2. If root.name is empty/missing → SKIP (emit warning).
 *   3. Otherwise: updates attribute_values/product_name doc:
 *        value: root.name
 *        origin_type: "Backfill"
 *        verification_state: "Rule-Verified"
 *        last_updated_at: serverTimestamp
 *   4. Emits audit_log entry with event_type="track-1-product-name-uuid-backfill".
 *
 * UUID detection: attribute_values/product_name.value matches
 *   /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
 * OR the value equals the product doc.id (defensive check).
 *
 * Idempotent: re-runs are no-ops for already-backfilled products because
 * the resolved name is not UUID-shaped.
 *
 * Never touches Human-Verified entries (verification_state === "Human-Verified").
 *
 * Usage:
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/backfill-product-name-uuid-drift.ts --dry-run
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/backfill-product-name-uuid-drift.ts
 *
 * If GCP_SA_KEY_DEV is unset, falls back to /tmp/sa-dev.json.
 */
import * as admin from "firebase-admin";
import * as fs from "fs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MODE = DRY_RUN ? "DRY-RUN" : "LIVE";

let saJson: string;
const envKey = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (envKey) {
  saJson = envKey;
} else if (fs.existsSync("/tmp/sa-dev.json")) {
  saJson = fs.readFileSync("/tmp/sa-dev.json", "utf8");
} else {
  console.error("❌  No SA credentials. Set GCP_SA_KEY_DEV or place /tmp/sa-dev.json.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(saJson)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const BATCH_LIMIT = 500;

interface DriftedProduct {
  doc_id: string;
  mpn: string;
  root_name: string;
  drifted_value: string;
  skip_reason?: string;
}

function isUuidDrifted(value: unknown, docId: string): boolean {
  if (typeof value !== "string") return false;
  return UUID_REGEX.test(value) || value === docId;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n🛠   Phase 3.10 Track 1 product_name UUID drift backfill — mode: ${MODE}`);
  console.log(`    Started: ${startedAt}`);
  console.log(`    Project: ropi-aoss-dev\n`);

  // --- Scan all products ---
  const productsSnap = await db.collection("products").get();
  console.log(`    Scanned ${productsSnap.size} products.\n`);

  const planned: DriftedProduct[] = [];
  const skipped: Array<{ doc_id: string; reason: string }> = [];

  for (const productDoc of productsSnap.docs) {
    const docId = productDoc.id;
    const rootData = productDoc.data();

    // Read attribute_values/product_name sub-doc
    const attrRef = productDoc.ref.collection("attribute_values").doc("product_name");
    const attrSnap = await attrRef.get();

    if (!attrSnap.exists) {
      // No product_name attr yet — not a UUID-drift case; skip silently
      continue;
    }

    const attrData = attrSnap.data()!;
    const currentValue = attrData.value;

    // Skip Human-Verified entries unconditionally
    if (attrData.verification_state === "Human-Verified") {
      continue;
    }

    if (!isUuidDrifted(currentValue, docId)) {
      // Not a UUID-drift product; skip silently
      continue;
    }

    // We have a drifted product. Get root.name as the corrected value.
    const rootName: string = (rootData.name || "").trim();
    if (!rootName) {
      const reason = `root.name empty/missing on doc ${docId}`;
      console.warn(`    ⚠️   SKIP: ${reason}`);
      skipped.push({ doc_id: docId, reason });
      continue;
    }

    planned.push({
      doc_id: docId,
      mpn: rootData.mpn || docId,
      root_name: rootName,
      drifted_value: currentValue as string,
    });
  }

  console.log(`    Plan summary:`);
  console.log(`      Total drifted (UUID) product_name values: ${planned.length}`);
  console.log(`      Skipped (root.name empty): ${skipped.length}`);

  if (planned.length === 0) {
    console.log(`\n✅  No UUID-drifted product_name values found. Nothing to do.\n`);
    process.exit(0);
  }

  console.log(`\n    [${MODE}] First 10 planned operations:`);
  planned.slice(0, 10).forEach((p) => {
    console.log(
      `      doc=${p.doc_id} mpn=${p.mpn} drifted="${p.drifted_value}" → "${p.root_name}"`
    );
  });
  if (planned.length > 10) {
    console.log(`      ... (${planned.length - 10} more)`);
  }

  if (DRY_RUN) {
    console.log(`\n✅  Dry-run complete. Re-run without --dry-run to apply.\n`);
    process.exit(0);
  }

  // --- Live writes ---
  console.log(`\n    Applying ${planned.length} writes in batches of ${BATCH_LIMIT}...`);

  let committed = 0;
  let i = 0;

  while (i < planned.length) {
    const chunk = planned.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();

    for (const p of chunk) {
      // Update attribute_values/product_name
      const attrRef = db
        .collection("products")
        .doc(p.doc_id)
        .collection("attribute_values")
        .doc("product_name");
      batch.set(
        attrRef,
        {
          value: p.root_name,
          origin_type: "Backfill",
          verification_state: "Rule-Verified",
          last_updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Emit audit_log entry
      const auditRef = db.collection("audit_log").doc();
      batch.set(auditRef, {
        event_type: "track-1-product-name-uuid-backfill",
        product_id: p.doc_id,
        field_key: "product_name",
        before: p.drifted_value,
        after: p.root_name,
        actor: "system-backfill",
        acting_user_id: "backfill:track-1-product-name-uuid-drift",
        origin_type: "Backfill",
        source_type: "backfill",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    committed += chunk.length;
    i += BATCH_LIMIT;
    console.log(`      committed ${committed}/${planned.length}`);
  }

  console.log(`\n✅  LIVE backfill complete. Applied ${committed} attribute_values writes + ${committed} audit_log entries.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌  Fatal error:", err);
  process.exit(1);
});
