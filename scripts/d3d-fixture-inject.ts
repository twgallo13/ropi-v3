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
const T4_GENDERS = new Set(["Girls", "Kids"]);
const T4_DEPTS = new Set(["clothing", "accessories"]);
const MIKE_BRANDS = new Set(["new_era", "pro_standard"]);

async function findT4Candidate() {
  const snap = await db.collection("products").limit(500).get();
  const dist: Record<string, number> = {};
  const candidates: any[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const gender = String(data.gender ?? "");
    const dept = String(data.department_key ?? "");
    const brand = String(data.brand_key ?? "");
    const key = `${gender || "(empty)"}/${dept || "(empty)"}`;
    dist[key] = (dist[key] || 0) + 1;
    if (T4_GENDERS.has(gender) && T4_DEPTS.has(dept) && !MIKE_BRANDS.has(brand)) {
      candidates.push(d);
    }
  }
  if (candidates.length > 0) {
    return {
      doc: candidates[0],
      fallback: false,
      total_candidates: candidates.length,
      alternates: candidates.slice(1, 5).map((c) => ({
        mpn: c.id,
        gender: c.data().gender,
        dept: c.data().department_key,
        brand: c.data().brand_key,
      })),
    };
  }
  return { doc: null, fallback: true, gender_dept_distribution: dist, total_scanned: snap.size };
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

  // === T4 ===
  console.log(`\n=== T4 fixture: dynamic select ===`);
  const t4Pick = await findT4Candidate();
  if (!t4Pick.doc) {
    console.log("  Gender/dept distribution:", JSON.stringify(t4Pick.gender_dept_distribution, null, 2));
    console.log(`  Total scanned: ${t4Pick.total_scanned}`);
    console.error("HALT: no T4 candidate found using gender+dept+brand triple (need gender in [Girls,Kids], dept in [clothing,accessories], brand_key not in [new_era,pro_standard])");
    process.exit(3);
  }
  const t4Mpn = t4Pick.doc.id;
  const t4Data = t4Pick.doc.data() || {};
  const t4Before = {
    site_owner: t4Data.site_owner ?? null,
    department_key: t4Data.department_key ?? null,
    gender: t4Data.gender ?? null,
    brand_key: t4Data.brand_key ?? null,
  };
  console.log(`  Selected: ${t4Mpn} (fallback=${t4Pick.fallback}, total_candidates=${t4Pick.total_candidates})`);
  if (t4Pick.alternates && t4Pick.alternates.length > 0) {
    console.log("  Alternates:", JSON.stringify(t4Pick.alternates));
  }
  console.log("  BEFORE root:", JSON.stringify(t4Before));
  console.log("  AFTER:  root.site_owner='mltd', attribute_values/site_owner {value:'mltd', origin:Smoke Fixture}");

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

  // T4 commit
  const t4Ref = db.collection("products").doc(t4Mpn);
  await t4Ref.update({
    site_owner: "mltd",
    updated_at: FieldValue.serverTimestamp(),
  });
  await t4Ref.collection("attribute_values").doc("site_owner").set({
    field_name: "site_owner",
    value: "mltd",
    origin_type: "Smoke Fixture",
    origin_detail: "TALLY-D3-D Tier 4 fixture inject",
    origin_rule: "TALLY-D3-D",
    verification_state: "Rule-Verified",
    written_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection("audit_log").add({
    event_type: "fixture_injected",
    acting_user_id: "system:tally-d3-d",
    product_mpn: t4Mpn,
    field_key: "site_owner",
    before: t4Before,
    after: { site_owner: "mltd" },
    tier: "T4",
    tally: "TALLY-D3-D",
    reason: `Smoke (b) Tier 4 fixture for Alana portfolio resolution test (selected MPN: ${t4Mpn}, dept_key: ${t4Before.department_key})`,
    created_at: FieldValue.serverTimestamp(),
  });
  console.log(`  ✓ T4: ${t4Mpn} updated (site_owner='mltd')`);

  console.log("\n=== COMPLETE — 2 fixtures injected ===");
  console.log(`  T1 MPN for D3-E smoke verify: ${T1_MPN} (expect resolves to Shiekh)`);
  console.log(`  T4 MPN for D3-E smoke verify: ${t4Mpn} (expect resolves to Alana, unless brand triggered Mike warning above)`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
