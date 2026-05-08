/* eslint-disable */
// Frink Archaeology #3 — read-only probe against ropi-aoss-dev
// §C: enumerate attribute_registry export-flagged docs + sample 3 products per
// §D: shape sanity (field_type / dropdown_source / depends_on / multi-select storage)
const admin = require("firebase-admin");
const key = JSON.parse(process.env.GCP_SA_KEY_DEV);
admin.initializeApp({ credential: admin.credential.cert(key), projectId: "ropi-aoss-dev" });
const db = admin.firestore();

const ALLOWED_FT = new Set([
  "text", "textarea", "dropdown", "multi_select",
  "number", "toggle", "boolean", "date",
]);
const ALLOWED_DS = new Set([
  "site_registry", "brand_registry", "department_registry",
]);

(async () => {
  const reg = await db.collection("attribute_registry").get();

  // §C1 — list all attrs flagged for export, BOTH possible field names
  const exportFlagged = [];
  const allRows = [];
  reg.docs.forEach((d) => {
    const x = d.data();
    const row = {
      id: d.id,
      field_key: x.field_key || d.id,
      field_type: x.field_type ?? null,
      destination_tab: x.destination_tab ?? null,
      active: x.active ?? null,
      display_order: x.display_order ?? null,
      tab_group_order: x.tab_group_order ?? null,
      export_enabled: x.export_enabled ?? null,
      include_in_export: x.include_in_export ?? null,  // PO's terminology check
      dropdown_source: x.dropdown_source ?? null,
      depends_on: x.depends_on ?? null,
      required_for_completion: x.required_for_completion ?? null,
      is_editable: x.is_editable ?? null,
    };
    allRows.push(row);
    if (row.export_enabled === true || row.include_in_export === true) {
      exportFlagged.push(row);
    }
  });

  console.log("=== §C1 attribute_registry totals ===");
  console.log("total docs:", reg.size);
  console.log("export_enabled === true:", allRows.filter(r => r.export_enabled === true).length);
  console.log("include_in_export === true:", allRows.filter(r => r.include_in_export === true).length);
  console.log("export_enabled missing/null:", allRows.filter(r => r.export_enabled === null).length);
  console.log("active === true:", allRows.filter(r => r.active === true).length);
  console.log();

  console.log("=== §C1 ALL attributes with export flag = true (any field) ===");
  exportFlagged.sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99));
  exportFlagged.forEach((r) => {
    console.log(JSON.stringify(r));
  });
  console.log();

  // §D1 — shape conformance
  console.log("=== §D1 shape drift in attribute_registry ===");
  const driftFt = allRows.filter(r => r.field_type !== null && !ALLOWED_FT.has(r.field_type));
  const driftDs = allRows.filter(r => r.dropdown_source !== null && !ALLOWED_DS.has(r.dropdown_source));
  const driftDep = allRows.filter(r => {
    if (r.depends_on === null || r.depends_on === undefined) return false;
    if (typeof r.depends_on !== "object") return true;
    const keys = Object.keys(r.depends_on);
    if (keys.length !== 2) return true;
    return !("field" in r.depends_on) || !("value" in r.depends_on);
  });
  console.log("field_type drift:", driftFt.length, driftFt.map(r => `${r.id}=${r.field_type}`).join(", "));
  console.log("dropdown_source drift:", driftDs.length, driftDs.map(r => `${r.id}=${r.dropdown_source}`).join(", "));
  console.log("depends_on shape drift:", driftDep.length, driftDep.map(r => `${r.id}=${JSON.stringify(r.depends_on)}`).join(", "));
  console.log();

  // §C2 — pick 3 export-flagged active attrs and sample 3 product docs each
  const sampleAttrs = exportFlagged.filter(r => r.active === true).slice(0, 3);
  console.log("=== §C2 sample attrs chosen ===");
  console.log(sampleAttrs.map(r => r.id).join(", "));
  console.log();

  // Fetch a small set of product doc IDs (random-ish)
  const prodSnap = await db.collection("products").limit(50).get();
  const prodDocs = prodSnap.docs;
  console.log(`(sampling from first ${prodDocs.length} products by natural order)`);
  console.log();

  // For each attr, walk products until we have 3 with the field present
  for (const attr of sampleAttrs) {
    const fk = attr.id;
    console.log(`--- attr: ${fk} (field_type=${attr.field_type}, active=${attr.active}) ---`);
    let found = 0;
    let inspected = 0;
    for (const p of prodDocs) {
      if (found >= 3) break;
      inspected++;
      const pdata = p.data();
      const topLevel = pdata[fk];
      // attribute_values is per-product subcollection where each attr is one doc
      // with field `value`
      let attrValDoc = null;
      try {
        const av = await p.ref.collection("attribute_values").doc(fk).get();
        attrValDoc = av.exists ? av.data() : null;
      } catch (e) { attrValDoc = { __err: e.message }; }

      const hasTop = topLevel !== undefined && topLevel !== null && topLevel !== "";
      const hasSub = attrValDoc !== null && attrValDoc.value !== undefined && attrValDoc.value !== null && attrValDoc.value !== "";
      if (!hasTop && !hasSub) continue;

      found++;
      console.log(JSON.stringify({
        product_doc_id: p.id,
        mpn: pdata.mpn || null,
        topLevel_value: hasTop ? topLevel : "(absent/empty)",
        subcoll_attribute_values_doc: attrValDoc,
        location: hasTop && hasSub ? "BOTH" : hasTop ? "TOP_LEVEL_ONLY" : "SUBCOLLECTION_ONLY",
      }));
    }
    console.log(`(inspected ${inspected} products; ${found} with value)`);
    console.log();
  }

  // §D2 — for any multi_select / dropdown attr, sample storage shape on products
  console.log("=== §D2 multi_select / dropdown storage shape on products ===");
  const ms = allRows.filter(r => r.field_type === "multi_select").slice(0, 3);
  const ds = allRows.filter(r => r.field_type === "dropdown").slice(0, 3);
  for (const attr of [...ms, ...ds]) {
    const fk = attr.id;
    let found = 0;
    for (const p of prodDocs) {
      if (found >= 2) break;
      const pdata = p.data();
      let avDoc = null;
      try {
        const av = await p.ref.collection("attribute_values").doc(fk).get();
        avDoc = av.exists ? av.data() : null;
      } catch (e) { /* ignore */ }
      const top = pdata[fk];
      const sub = avDoc?.value;
      if ((top === undefined || top === null || top === "") && (sub === undefined || sub === null || sub === "")) continue;
      found++;
      console.log(JSON.stringify({
        attr: fk, type: attr.field_type,
        product: p.id,
        topLevel_typeof: typeof top, topLevel_isArray: Array.isArray(top), topLevel_value: top,
        subcoll_value_typeof: typeof sub, subcoll_value_isArray: Array.isArray(sub), subcoll_value: sub,
      }));
    }
  }

  process.exit(0);
})().catch(e => { console.error("PROBE FAIL:", e); process.exit(1); });
