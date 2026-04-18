const admin = require('firebase-admin');
const { initApp } = require('./utils');
initApp();
const db = admin.firestore();

const PURGE_FIELDS = [
  // Compliance (never used)
  'hs_tariff_code', 'hazardous_material', 'shipping_class',
  'return_policy', 'warranty',
  // Flags (never used)
  'on_sale', 'new_arrival',
  // Inventory remnants
  'max_order_quantity',
  // Other dead fields
  'currency',
  // Pricing duplicates (these live in the header, not attributes)
  'web_regular_price', 'web_sale_price', 'scom', 'scom_sale',
  'retail_price', 'sale_price', 'cost_price', 'msrp', 'price_tier',
  // Release (lives in Launch & Media header, not attributes)
  'release_date', 'release_type',
  // Site owner duplicate — keep 'website', delete 'site_owner' if both exist
  'site_owner',
];

(async () => {
  // Step 1 — audit material_fabric duplicates first
  const matSnap = await db.collection('attribute_registry').get();
  const matFields = matSnap.docs.filter(d =>
    d.id.includes('material') || (d.data().display_label || '').toLowerCase().includes('material'));
  console.log('Material fields found:');
  matFields.forEach(d => console.log(' -', d.id, '|', d.data().display_label, '|', d.data().field_type));

  // Step 2 — delete registry entries
  for (const field of PURGE_FIELDS) {
    const ref = db.collection('attribute_registry').doc(field);
    const doc = await ref.get();
    if (doc.exists) {
      await ref.delete();
      console.log(`✅ Registry deleted: ${field}`);
    } else {
      console.log(`ℹ️  Not found: ${field}`);
    }
  }

  // Step 3 — BulkWriter delete from all product attribute_values
  const productsSnap = await db.collection('products').get();
  console.log(`\nCleaning ${productsSnap.size} products...`);
  const writer = db.bulkWriter();
  for (const productDoc of productsSnap.docs) {
    for (const field of PURGE_FIELDS) {
      writer.delete(productDoc.ref.collection('attribute_values').doc(field));
    }
  }
  await writer.close();
  console.log('Purge complete.');
  process.exit(0);
})();
