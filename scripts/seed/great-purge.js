const admin = require('firebase-admin');
const { initApp } = require('./utils');
initApp();
const db = admin.firestore();

const PURGE_FIELDS = [
  // Dead inventory
  'stock_quantity', 'warehouse_location', 'reorder_point',
  'inventory_status', 'max_order_quantity',
  // Dead physical
  'size_system', 'width', 'colorway', 'technology', 'collaboration',
  // Dead pricing
  'price_tier', 'msrp', 'retail_price', 'sale_price', 'cost_price',
  // Dead flags
  'on_sale', 'new_arrival',
  // Duplicate weight — keep 'weight' (Package Dimensions), purge 'weight_oz' (Inventory)
  'weight_oz',
];

(async () => {
  // 1. Delete from attribute_registry
  for (const field of PURGE_FIELDS) {
    const ref = db.collection('attribute_registry').doc(field);
    const doc = await ref.get();
    if (doc.exists) {
      await ref.delete();
      console.log(`✅ Registry deleted: ${field}`);
    } else {
      console.log(`ℹ️  Registry not found: ${field}`);
    }
  }

  // 2. Delete from all product attribute_values — use BulkWriter for speed
  const productsSnap = await db.collection('products').get();
  console.log(`\nScanning ${productsSnap.size} products...`);
  const writer = db.bulkWriter();

  for (const productDoc of productsSnap.docs) {
    for (const field of PURGE_FIELDS) {
      const avRef = productDoc.ref.collection('attribute_values').doc(field);
      writer.delete(avRef);
    }
  }
  await writer.close();

  // Count what actually existed (BulkWriter deletes non-existent docs silently)
  console.log(`Purge complete.`);
  process.exit(0);
})();
