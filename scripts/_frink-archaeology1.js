/**
 * Frink Archaeology #1 — Import Normalization Audit live probe
 * ropi-aoss-dev
 * Mode: read-only
 */
const admin = require("firebase-admin");
const key = JSON.parse(process.env.GCP_SA_KEY_DEV);
admin.initializeApp({ credential: admin.credential.cert(key), projectId: "ropi-aoss-dev" });
const db = admin.firestore();

const PROBE_TS = new Date().toISOString();
console.log("Probe timestamp:", PROBE_TS);

async function main() {
  // ── §B4: List inactive entries ──────────────────────────────────────────
  console.log("\n=== §B4: Inactive registry entries ===");

  const brandSnap = await db.collection("brand_registry").where("is_active", "==", false).get();
  console.log(`\nbrand_registry — inactive count: ${brandSnap.size}`);
  brandSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`  key=${d.id} display_name=${data.display_name} aliases=${JSON.stringify(data.aliases || [])}`);
  });

  const deptSnap = await db.collection("department_registry").where("is_active", "==", false).get();
  console.log(`\ndepartment_registry — inactive count: ${deptSnap.size}`);
  deptSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`  key=${d.id} display_name=${data.display_name} aliases=${JSON.stringify(data.aliases || [])}`);
  });

  const siteSnap = await db.collection("site_registry").where("is_active", "==", false).get();
  console.log(`\nsite_registry — inactive count: ${siteSnap.size}`);
  siteSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`  key=${d.id} display_name=${data.display_name || d.id}`);
  });

  // ── §B4 also: all active registries (for reference) ──────────────────
  const activeBrandSnap = await db.collection("brand_registry").where("is_active", "==", true).get();
  console.log(`\nbrand_registry — active count: ${activeBrandSnap.size}`);
  activeBrandSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`  key=${d.id} display_name=${data.display_name} aliases=${JSON.stringify(data.aliases || [])}`);
  });

  const activeDeptSnap = await db.collection("department_registry").where("is_active", "==", true).get();
  console.log(`\ndepartment_registry — active count: ${activeDeptSnap.size}`);
  activeDeptSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`  key=${d.id} display_name=${data.display_name} aliases=${JSON.stringify(data.aliases || [])}`);
  });

  const activeSiteSnap = await db.collection("site_registry").where("is_active", "==", true).get();
  console.log(`\nsite_registry — active count: ${activeSiteSnap.size}`);
  activeSiteSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`  key=${d.id} display_name=${data.display_name || d.id} domain=${data.domain || ""}`);
  });

  // ── §B1: Find "NEW ERA CAPS" products ──────────────────────────────────
  console.log("\n=== §B1: Products with brand containing 'new era caps' (case-insensitive) ===");

  // First, find all attribute_values where brand = "NEW ERA CAPS"
  // We need to look for products whose top-level brand = "NEW ERA CAPS" (raw) OR brand_key = "new era"
  // Strategy: query top-level brand field
  const newEraTopLevel = await db.collection("products").where("brand", "==", "NEW ERA CAPS").limit(5).get();
  console.log(`Products with brand == "NEW ERA CAPS" (top-level): ${newEraTopLevel.size}`);
  for (const doc of newEraTopLevel.docs.slice(0, 3)) {
    const d = doc.data();
    console.log(`  docId=${doc.id} mpn=${d.mpn} brand=${d.brand} brand_key=${d.brand_key}`);
    // Also fetch attribute_values.brand
    const attrRef = await db.collection("products").doc(doc.id).collection("attribute_values").doc("brand").get();
    console.log(`  attribute_values.brand value=${attrRef.exists ? attrRef.data()?.value : "(no doc)"}`);
    // Look up brand_registry entry by brand_key
    if (d.brand_key) {
      const brSnap = await db.collection("brand_registry").doc(d.brand_key).get();
      if (brSnap.exists) {
        const brData = brSnap.data();
        console.log(`  brand_registry[${d.brand_key}]: display_name=${brData?.display_name} is_active=${brData?.is_active} aliases=${JSON.stringify(brData?.aliases || [])}`);
      } else {
        console.log(`  brand_registry[${d.brand_key}]: NOT FOUND`);
      }
    }
  }

  // Also try brand_key = "new era"
  const newEraByKey = await db.collection("products").where("brand_key", "==", "new era").limit(5).get();
  console.log(`\nProducts with brand_key == "new era" (top-level): ${newEraByKey.size}`);
  for (const doc of newEraByKey.docs.slice(0, 3)) {
    const d = doc.data();
    console.log(`  docId=${doc.id} mpn=${d.mpn} brand=${d.brand} brand_key=${d.brand_key}`);
    const attrRef = await db.collection("products").doc(doc.id).collection("attribute_values").doc("brand").get();
    console.log(`  attribute_values.brand value=${attrRef.exists ? attrRef.data()?.value : "(no doc)"} state=${attrRef.exists ? attrRef.data()?.verification_state : "-"}`);
  }

  // ── §B2: Department inactive sample ────────────────────────────────────
  // We'll check for products that have a department_key NOT in active keys
  console.log("\n=== §B2: Sample inactive department/site_owner products ===");

  // Collect all active department keys
  const activeDeptKeys = new Set(activeDeptSnap.docs.map(d => d.id));
  const activeSiteKeys = new Set(activeSiteSnap.docs.map(d => d.id));
  const activeBrandKeys = new Set(activeBrandSnap.docs.map(d => d.id));

  console.log("Active dept keys:", [...activeDeptKeys].join(", "));
  console.log("Active site keys:", [...activeSiteKeys].join(", "));

  // ── §B3: Count products with non-matching keys ─────────────────────────
  console.log("\n=== §B3: Counts — non-matching keys ===");

  // We need to scan all products. Use batching.
  let brandKeyNullCount = 0;
  let brandKeyInactiveCount = 0;
  let brandKeyOrphanCount = 0;
  let deptKeyNullCount = 0;
  let deptKeyInactiveCount = 0;
  let deptKeyOrphanCount = 0;
  let siteOwnerInactiveCount = 0;
  let siteOwnerOrphanCount = 0;
  let totalProducts = 0;

  // Collect all inactive brand/dept/site keys
  const inactiveBrandKeys = new Set(brandSnap.docs.map(d => d.id));
  const inactiveDeptKeys = new Set(deptSnap.docs.map(d => d.id));
  const inactiveSiteKeys = new Set(siteSnap.docs.map(d => d.id));
  const allBrandKeys = new Set([...activeBrandKeys, ...inactiveBrandKeys]);
  const allDeptKeys = new Set([...activeDeptKeys, ...inactiveDeptKeys]);
  const allSiteKeys = new Set([...activeSiteKeys, ...inactiveSiteKeys]);

  let lastDoc = null;
  const PAGE_SIZE = 500;

  while (true) {
    let q = db.collection("products").orderBy("__name__").limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    lastDoc = snap.docs[snap.docs.length - 1];

    for (const doc of snap.docs) {
      const d = doc.data();
      totalProducts++;

      // brand_key checks
      const bk = d.brand_key || null;
      if (!bk) {
        brandKeyNullCount++;
      } else if (inactiveBrandKeys.has(bk)) {
        brandKeyInactiveCount++;
      } else if (!activeBrandKeys.has(bk)) {
        brandKeyOrphanCount++;
      }

      // department_key checks
      const dk = d.department_key || null;
      if (!dk) {
        deptKeyNullCount++;
      } else if (inactiveDeptKeys.has(dk)) {
        deptKeyInactiveCount++;
      } else if (!activeDeptKeys.has(dk)) {
        deptKeyOrphanCount++;
      }

      // site_owner checks (top-level)
      const so = d.site_owner || null;
      if (so) {
        if (inactiveSiteKeys.has(so)) {
          siteOwnerInactiveCount++;
        } else if (!activeSiteKeys.has(so)) {
          siteOwnerOrphanCount++;
        }
      }
    }

    if (snap.size < PAGE_SIZE) break;
  }

  console.log(`Total products scanned: ${totalProducts}`);
  console.log(`\nbrand_key stats:`);
  console.log(`  null/blank: ${brandKeyNullCount}`);
  console.log(`  matches INACTIVE brand_registry: ${brandKeyInactiveCount}`);
  console.log(`  orphaned (no registry match at all): ${brandKeyOrphanCount}`);
  console.log(`\ndepartment_key stats:`);
  console.log(`  null/blank: ${deptKeyNullCount}`);
  console.log(`  matches INACTIVE department_registry: ${deptKeyInactiveCount}`);
  console.log(`  orphaned (no registry match at all): ${deptKeyOrphanCount}`);
  console.log(`\nsite_owner stats:`);
  console.log(`  matches INACTIVE site_registry: ${siteOwnerInactiveCount}`);
  console.log(`  orphaned (no registry match at all): ${siteOwnerOrphanCount}`);

  // ── Sample inactive brand_key products ──────────────────────────────────
  if (inactiveBrandKeys.size > 0) {
    const firstInactiveBrand = [...inactiveBrandKeys][0];
    const sampleBrandInactive = await db.collection("products").where("brand_key", "==", firstInactiveBrand).limit(3).get();
    console.log(`\nSample products with brand_key == inactive "${firstInactiveBrand}": ${sampleBrandInactive.size}`);
    for (const doc of sampleBrandInactive.docs) {
      const d = doc.data();
      console.log(`  docId=${doc.id} mpn=${d.mpn} brand=${d.brand} brand_key=${d.brand_key}`);
    }
  }

  // ── Sample orphaned brand products ────────────────────────────────────
  if (brandKeyOrphanCount > 0) {
    console.log("\nSampling orphaned brand_key products...");
    let orphanSample = [];
    let ld2 = null;
    while (orphanSample.length < 3) {
      let q2 = db.collection("products").orderBy("__name__").limit(200);
      if (ld2) q2 = q2.startAfter(ld2);
      const s2 = await q2.get();
      if (s2.empty) break;
      ld2 = s2.docs[s2.docs.length - 1];
      for (const doc of s2.docs) {
        const d = doc.data();
        const bk = d.brand_key || null;
        if (bk && !allBrandKeys.has(bk)) {
          orphanSample.push({ id: doc.id, mpn: d.mpn, brand: d.brand, brand_key: d.brand_key });
          if (orphanSample.length >= 3) break;
        }
      }
      if (s2.size < 200) break;
    }
    orphanSample.forEach(p => console.log(`  docId=${p.id} mpn=${p.mpn} brand=${p.brand} brand_key=${p.brand_key}`));
  }

  // ── §B2: Find products with inactive department ─────────────────────────
  if (inactiveDeptKeys.size > 0) {
    const firstInactiveDept = [...inactiveDeptKeys][0];
    const sampleDeptInactive = await db.collection("products").where("department_key", "==", firstInactiveDept).limit(3).get();
    console.log(`\nSample products with department_key == inactive "${firstInactiveDept}": ${sampleDeptInactive.size}`);
    for (const doc of sampleDeptInactive.docs) {
      const d = doc.data();
      console.log(`  docId=${doc.id} mpn=${d.mpn} department=${d.department} department_key=${d.department_key}`);
    }
  }

  // ── §B2: Find products with inactive site_owner ─────────────────────────
  if (inactiveSiteKeys.size > 0) {
    const firstInactiveSite = [...inactiveSiteKeys][0];
    const sampleSiteInactive = await db.collection("products").where("site_owner", "==", firstInactiveSite).limit(3).get();
    console.log(`\nSample products with site_owner == inactive "${firstInactiveSite}": ${sampleSiteInactive.size}`);
    for (const doc of sampleSiteInactive.docs) {
      const d = doc.data();
      console.log(`  docId=${doc.id} mpn=${d.mpn} site_owner=${d.site_owner}`);
    }
  }

  // ── Additional: check attribute_values.brand for "NEW ERA CAPS" ─────────────
  console.log("\n=== §B1 Additional: Products with attribute_values.brand = 'NEW ERA CAPS' ===");
  // We can't do a collection group query easily, so let's check a sample of new era key products
  // and look at their attribute_values.brand
  const newEraKeyProducts = await db.collection("products").where("brand_key", "==", "new era").limit(10).get();
  console.log(`Products with brand_key='new era': ${newEraKeyProducts.size}`);
  let attrValueMismatch = 0;
  for (const doc of newEraKeyProducts.docs) {
    const d = doc.data();
    const avSnap = await db.collection("products").doc(doc.id).collection("attribute_values").doc("brand").get();
    const avValue = avSnap.exists ? avSnap.data()?.value : "(no doc)";
    const isAlias = avValue && avValue.toLowerCase() !== (d.brand || "").toLowerCase();
    if (isAlias) attrValueMismatch++;
    console.log(`  mpn=${d.mpn} product.brand=${d.brand} attribute_values.brand.value=${avValue} mismatch=${isAlias}`);
  }
  console.log(`  top_level.brand vs attribute_values.brand mismatch count (in sample): ${attrValueMismatch}`);

  console.log("\n=== PROBE COMPLETE ===");
}

main().catch(err => { console.error("PROBE ERROR:", err); process.exit(1); });
