/**
 * TALLY-D3-D — inject Tier 1 + Tier 4 fixtures for D3-E smoke (b) verification.
 * Required env: GCP_SA_KEY_DEV (raw SA JSON).
 */

import admin from "firebase-admin";

const sa = JSON.parse(process.env.GCP_SA_KEY_DEV || "{}");
if (!sa.project_id) {
  console.error("ERROR: GCP_SA_KEY_DEV not set");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const COMMIT = process.argv.includes("--commit");
const T1_MPN = "CK9246 101";
const T4_SYNTHETIC_MPN = "D3D-T4-FIXTURE-001";
const T4_SYNTHETIC_BASE = {
  mpn: T4_SYNTHETIC_MPN,
  name: "TALLY-D3-D Tier 4 Smoke Fixture (synthetic)",
  sku: "D3D-T4-FIXTURE-001",
  department: "Clothing",
  department_key: "clothing",
  gender: "Girls",
  brand: "Jordan",
  brand_key: "jordan",
  site_owner: "mltd",
  product_is_active: true,
  completion_state: "incomplete",
  is_fixture: true,
  fixture_tally: "TALLY-D3-D",
  import_batch_id: "TALLY-D3-D-FIXTURE",
};

async function ensureT4Synthetic(commit: boolean) {
  const ref = db.collection("products").doc(T4_SYNTHETIC_MPN);
  const doc = await ref.get();
  if (doc.exists) {
    return { doc, created: false, exists_before: true, dry_run_would_create: false };
  }
  if (!commit) {
    return { doc: null, created: false, exists_before: false, dry_run_would_create: true };
  }
  // Create synthetic root doc
  await ref.set({
    ...T4_SYNTHETIC_BASE,
    first_received_at: FieldValue.serverTimestamp(),
    last_received_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  // Seed canonical attribute_values
  for (const [field_name, value] of Object.entries({
    mpn: T4_SYNTHETIC_MPN,
    sku: T4_SYNTHETIC_BASE.sku,
    product_name: T4_SYNTHETIC_BASE.name,
    brand: T4_SYNTHETIC_BASE.brand,
    department: T4_SYNTHETIC_BASE.department,
    gender: T4_SYNTHETIC_BASE.gender,
    site_owner: T4_SYNTHETIC_BASE.site_owner,
  })) {
    await ref.collection("attribute_values").doc(field_name).set({
      field_name,
      value,
      origin_type: "Smoke Fixture",
      origin_detail: "TALLY-D3-D-PATCH-3 synthetic Tier 4 inject",
      origin_rule: "TALLY-D3-D",
      verification_state: "Rule-Verified",
      written_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
  }
  const newDoc = await ref.get();
  return { doc: newDoc, created: true, exists_before: false, dry_run_would_create: false };
}

async function main() {
  console.log(`MODE: ${COMMIT ? "COMMIT" : "DRY-RUN"}`);
  console.log(`Project: ${sa.project_id}`);

  // === T1 ===
  console.log(`\n=== T1 fixture: ${T1_MPN} ===`);
  const t1Ref = db.collection("products").doc(T1_MPN);
  const t1Doc = await t1Ref.get();
  if (!t1Doc.exists) {
    console.error(`HALT: T1 fixture MPN "${T1_MPN}" not found`);
    process.exit(2);
  }
  const t1Data = t1Doc.data() || {};
  const t1Before = {
    root_is_fast_fashion: t1Data.is_fast_fashion ?? null,
    nested_attributes_is_fast_fashion: t1Data.attributes?.is_fast_fashion ?? null,
    department_key: t1Data.department_key ?? null,
    gender: t1Data.gender ?? null,
    brand_key: t1Data.brand_key ?? null,
  };
  const t1AvDoc = await t1Ref.collection("attribute_values").doc("is_fast_fashion").get();
  const t1AvBefore = t1AvDoc.exists ? t1AvDoc.data() : { exists: false };
  console.log("  BEFORE root:", JSON.stringify(t1Before));
  console.log("  BEFORE attribute_values/is_fast_fashion:", JSON.stringify(t1AvBefore));
  console.log("  AFTER:  root.is_fast_fashion=true, attributes.is_fast_fashion=true, attribute_values/is_fast_fashion {value:true, origin:Smoke Fixture}");

  // === T4 (synthetic) ===
  console.log(`\n=== T4 fixture (synthetic): ${T4_SYNTHETIC_MPN} ===`);
  const t4Result = await ensureT4Synthetic(COMMIT);
  if (t4Result.dry_run_would_create) {
    console.log(`  DRY-RUN would create synthetic product:`);
    console.log(`    ${JSON.stringify(T4_SYNTHETIC_BASE, null, 2)}`);
    console.log(`  Engine math: Alex/Heather/Richard/Mike/Shiekh all excluded; Alana matches via sites=[mltd] (tier3=1).`);
  } else if (t4Result.exists_before) {
    console.log(`  Synthetic already exists; would re-affirm site_owner='mltd'.`);
  } else if (t4Result.created) {
    console.log(`  ✓ Created synthetic ${T4_SYNTHETIC_MPN}`);
  }

  if (!COMMIT) {
    console.log("\n=== DRY-RUN ONLY — no writes performed. Re-run with --commit to apply. ===");
    process.exit(0);
  }

  console.log("\n=== COMMITTING ===");

  // T1 commit
  await t1Ref.update({
    is_fast_fashion: true,
    "attributes.is_fast_fashion": true,
    updated_at: FieldValue.serverTimestamp(),
  });
  await t1Ref.collection("attribute_values").doc("is_fast_fashion").set({
    field_name: "is_fast_fashion",
    value: true,
    origin_type: "Smoke Fixture",
    origin_detail: "TALLY-D3-D Tier 1 fixture inject",
    origin_rule: "TALLY-D3-D",
    verification_state: "Rule-Verified",
    written_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection("audit_log").add({
    event_type: "fixture_injected",
    acting_user_id: "system:tally-d3-d",
    product_mpn: T1_MPN,
    field_key: "is_fast_fashion",
    before: { ...t1Before, attribute_values: t1AvBefore },
    after: { is_fast_fashion: true, "attributes.is_fast_fashion": true },
    tier: "T1",
    tally: "TALLY-D3-D",
    reason: "Smoke (b) Tier 1 fixture for Shiekh portfolio resolution test",
    created_at: FieldValue.serverTimestamp(),
  });
  console.log(`  ✓ T1: ${T1_MPN} updated (is_fast_fashion=true, root + nested + attribute_values)`);

  // T4 commit (after ensureT4Synthetic already created the doc + attribute_values if it was new)
  // Re-affirm site_owner=mltd on the synthetic doc (idempotent) and audit the fixture inject event
  const t4Ref = db.collection("products").doc(T4_SYNTHETIC_MPN);
  await t4Ref.set({ site_owner: "mltd", updated_at: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("audit_log").add({
    event_type: "fixture_injected",
    acting_user_id: "system:tally-d3-d",
    product_mpn: T4_SYNTHETIC_MPN,
    field_key: "site_owner",
    before: t4Result.exists_before ? { existing: "synthetic already present" } : { created: true },
    after: { site_owner: "mltd", synthetic: true, shape: T4_SYNTHETIC_BASE },
    tier: "T4",
    tally: "TALLY-D3-D",
    reason: "Smoke (b) Tier 4 synthetic fixture for Alana portfolio resolution test (no real product satisfies selection rule against live 114-doc corpus)",
    created_at: FieldValue.serverTimestamp(),
  });
  console.log(`  ✓ T4: synthetic ${T4_SYNTHETIC_MPN} ensured with site_owner='mltd'`);

  console.log("\n=== COMPLETE — 2 fixtures injected ===");
  console.log(`  T1 MPN for D3-E smoke verify: ${T1_MPN} (expect resolves to Shiekh)`);
  console.log(`  T4 MPN for D3-E smoke verify: ${T4_SYNTHETIC_MPN} (expect resolves to Alana via sites=[mltd])`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
