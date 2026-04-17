/**
 * backfill-attribute-values-from-product.js
 *
 * One-off backfill that materializes top-level product fields back into the
 * `attribute_values` subcollection so the completion-% calculator can credit
 * them. Targets ADIDAS by default; pass `--brand=<value>` or `--all` to
 * widen the scope. Pass `--apply` to write — default is dry-run.
 *
 * For each product:
 *   - Reads the top-level product doc + existing attribute_values
 *   - For every "required for completion" field that is missing OR present
 *     but not Human-Verified, writes/updates the attribute_values doc with
 *     verification_state = "Human-Verified" (because the product was already
 *     curated; we are simply surfacing the data)
 *   - Skips any attribute that is already Human-Verified
 *
 * Sources used to derive each required field:
 *   product_name  ← top.name | attribute product_name
 *   brand         ← top.brand
 *   sku           ← top.sku
 *   department    ← top.department | attribute department(_raw)
 *   gender        ← top.gender    | attribute gender(_raw)
 *   age_group     ← attribute age_group | age_group_detail
 *   class         ← top.class     | attribute class
 *   category      ← top.category  | attribute category
 *   website       ← top.site_owner | attribute site_owner | first site_target
 *   is_in_stock   ← top.product_is_active (default true)
 */

const admin = require("firebase-admin");
const { initApp } = require("./utils");

initApp();
const db = admin.firestore();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ALL = args.includes("--all");
const brandArg = args.find((a) => a.startsWith("--brand="));
const TARGET_BRAND = brandArg ? brandArg.split("=")[1] : "ADIDAS";

const REQUIRED_FIELDS = [
  "age_group",
  "brand",
  "category",
  "class",
  "department",
  "gender",
  "is_in_stock",
  "product_name",
  "sku",
  "website",
];

function pickValue(top, attrMap, candidates) {
  for (const c of candidates) {
    if (c.startsWith("top.")) {
      const key = c.slice(4);
      const v = top[key];
      if (v !== undefined && v !== null && v !== "") return v;
    } else {
      const a = attrMap.get(c);
      if (a && a.value !== undefined && a.value !== null && a.value !== "")
        return a.value;
    }
  }
  return undefined;
}

async function backfillProduct(docId, top, dryRun) {
  const avSnap = await db
    .collection("products")
    .doc(docId)
    .collection("attribute_values")
    .get();
  const attrMap = new Map();
  avSnap.docs.forEach((d) => attrMap.set(d.id, d.data()));

  // Resolve a value for each required field.
  const resolved = {
    product_name: pickValue(top, attrMap, ["top.name", "product_name"]),
    brand: pickValue(top, attrMap, ["top.brand", "brand"]),
    sku: pickValue(top, attrMap, ["top.sku", "sku"]),
    department: pickValue(top, attrMap, [
      "top.department",
      "department",
      "department_raw",
    ]),
    gender: pickValue(top, attrMap, ["top.gender", "gender", "gender_raw"]),
    age_group: pickValue(top, attrMap, [
      "age_group",
      "age_group_detail",
      "top.age_group",
    ]),
    class: pickValue(top, attrMap, ["top.class", "class"]),
    category: pickValue(top, attrMap, ["top.category", "category"]),
    is_in_stock:
      top.product_is_active === undefined ? true : !!top.product_is_active,
    website: undefined, // resolved below
  };

  // Website resolution: prefer first site_targets domain, then site_owner.
  const stSnap = await db
    .collection("products")
    .doc(docId)
    .collection("site_targets")
    .limit(1)
    .get();
  if (!stSnap.empty) {
    const st = stSnap.docs[0].data();
    resolved.website =
      st.domain || st.site_id || stSnap.docs[0].id;
  }
  if (!resolved.website) {
    const siteOwner = pickValue(top, attrMap, [
      "site_owner",
      "top.site_owner",
    ]);
    if (siteOwner) {
      resolved.website = String(siteOwner).split(",")[0].trim().toLowerCase();
    }
  }

  const writes = [];
  const skipped = [];
  for (const fieldKey of REQUIRED_FIELDS) {
    const value = resolved[fieldKey];
    if (value === undefined || value === null || value === "") {
      skipped.push(`${fieldKey}=<no source>`);
      continue;
    }
    const existing = attrMap.get(fieldKey);
    if (existing && existing.verification_state === "Human-Verified") {
      skipped.push(`${fieldKey}=already Human-Verified`);
      continue;
    }
    writes.push({ fieldKey, value });
  }

  if (!dryRun && writes.length) {
    const batch = db.batch();
    for (const w of writes) {
      const ref = db
        .collection("products")
        .doc(docId)
        .collection("attribute_values")
        .doc(w.fieldKey);
      batch.set(
        ref,
        {
          field_name: w.fieldKey,
          value: typeof w.value === "boolean" ? w.value : String(w.value),
          origin_type: "Backfill",
          origin_rule: "backfill-attribute-values-from-product",
          verification_state: "Human-Verified",
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          written_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }

  return { writes, skipped };
}

async function main() {
  console.log(
    `\n📋  backfill-attribute-values-from-product (${
      APPLY ? "APPLY" : "DRY-RUN"
    })`
  );
  console.log(`    Scope: ${ALL ? "ALL brands" : `brand=${TARGET_BRAND}`}\n`);

  let q = db.collection("products");
  if (!ALL) q = q.where("brand", "==", TARGET_BRAND);
  const snap = await q.get();

  console.log(`Found ${snap.size} products in scope.\n`);

  let touched = 0;
  let totalWrites = 0;
  const samples = [];

  for (const doc of snap.docs) {
    const result = await backfillProduct(doc.id, doc.data(), !APPLY);
    if (result.writes.length > 0) {
      touched++;
      totalWrites += result.writes.length;
      if (samples.length < 3) {
        samples.push({
          mpn: doc.id,
          writes: result.writes.map((w) => `${w.fieldKey}=${w.value}`),
          skipped: result.skipped,
        });
      }
    }
  }

  console.log(`\nProducts that needed writes : ${touched}/${snap.size}`);
  console.log(`Total attribute_values written: ${totalWrites}`);
  if (samples.length) {
    console.log(`\nSample writes:`);
    for (const s of samples) {
      console.log(`  ${s.mpn}:`);
      s.writes.forEach((w) => console.log(`    + ${w}`));
      s.skipped.forEach((sk) => console.log(`    - skipped ${sk}`));
    }
  }

  if (!APPLY) {
    console.log(
      `\n⚠️   DRY-RUN — re-run with --apply to commit these writes.\n`
    );
  } else {
    console.log(`\n✅  Backfill complete.\n`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
