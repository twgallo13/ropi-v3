/**
 * backfill-search-tokens.js
 *
 * Stamps `search_tokens` on every product document so the new
 * database-side search path can find them. Reads top-level fields
 * (mpn, name, brand, sku, department) and writes the token array
 * with `merge: true`.
 *
 * Dry-run by default; pass `--apply` to commit. Pass `--brand=ADIDAS`
 * to scope to one brand for testing.
 *
 * Usage:
 *   node backfill-search-tokens.js              # dry run, all products
 *   node backfill-search-tokens.js --apply      # write all
 *   node backfill-search-tokens.js --brand=ADIDAS --apply
 */

const admin = require("firebase-admin");
const { initApp } = require("./utils");

initApp();
const db = admin.firestore();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const brandArg = args.find((a) => a.startsWith("--brand="));
const TARGET_BRAND = brandArg ? brandArg.split("=")[1] : null;

function buildSearchTokens(product) {
  const tokens = new Set();
  const addTokens = (value) => {
    if (!value) return;
    const lower = String(value).toLowerCase().trim();
    if (!lower) return;
    tokens.add(lower);
    lower.split(/[\s\-_/.]+/).forEach((word) => {
      if (word.length >= 2) tokens.add(word);
    });
    for (let i = 2; i <= Math.min(lower.length, 20); i++) {
      tokens.add(lower.slice(0, i));
    }
  };
  addTokens(product.mpn);
  addTokens(product.name);
  addTokens(product.brand);
  addTokens(product.sku);
  addTokens(product.department);
  return Array.from(tokens);
}

(async () => {
  console.log(
    `\n📋  backfill-search-tokens (${APPLY ? "APPLY" : "DRY-RUN"})${
      TARGET_BRAND ? ` brand=${TARGET_BRAND}` : ""
    }\n`
  );

  let q = db.collection("products");
  if (TARGET_BRAND) q = q.where("brand", "==", TARGET_BRAND);
  const snap = await q.get();
  console.log(`Found ${snap.size} products in scope.\n`);

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;
  let updated = 0;
  let sampleShown = 0;

  for (const doc of snap.docs) {
    const p = doc.data();
    const tokens = buildSearchTokens({
      mpn: p.mpn || doc.id,
      name: p.name,
      brand: p.brand,
      sku: p.sku,
      department: p.department,
    });

    if (sampleShown < 3) {
      console.log(`  Sample: ${doc.id} → ${tokens.length} tokens`);
      console.log(`    first few: ${tokens.slice(0, 8).join(", ")}`);
      sampleShown++;
    }

    if (APPLY) {
      batch.set(doc.ref, { search_tokens: tokens }, { merge: true });
      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`  Committed ${updated + batchCount}/${snap.size}`);
        batch = db.batch();
        batchCount = 0;
      }
    }
    updated++;
  }
  if (APPLY && batchCount > 0) {
    await batch.commit();
    console.log(`  Committed final ${batchCount}`);
  }

  console.log(
    `\n${APPLY ? "✅" : "⚠️ "}  Processed ${updated} products${
      APPLY ? "" : " (DRY-RUN — re-run with --apply)"
    }.\n`
  );
  process.exit(0);
})().catch((e) => {
  console.error("backfill-search-tokens failed:", e);
  process.exit(1);
});
