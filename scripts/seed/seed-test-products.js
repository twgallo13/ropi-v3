#!/usr/bin/env node
/**
 * Seed test products for Step 1.5 verification.
 * Creates 5 products with different pricing scenarios.
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

async function main() {
  const app = initApp();
  const db = admin.firestore(app);
  const FieldValue = admin.firestore.FieldValue;

  const products = [
    {
      mpn: "39652001", sku: "SKU-001", brand: "PUMA", name: "PUMA RS-X3",
      status: "Active",
      scom: 89.99, scom_sale: 74.99, rics_retail: 89.99, rics_offer: 74.99,
      inventory_store: 25, inventory_warehouse: 100, inventory_whs: 50,
    },
    {
      mpn: "39652002", sku: "SKU-002", brand: "NIKE", name: "Nike Air Max Zero",
      status: "Active",
      scom: 0, scom_sale: 0, rics_retail: 0, rics_offer: 0,
      inventory_store: 0, inventory_warehouse: 0, inventory_whs: 0,
    },
    {
      mpn: "39652003", sku: "SKU-003", brand: "ADIDAS", name: "Adidas UltraBoost Discrepancy",
      status: "Active",
      scom: 119.99, scom_sale: 129.99, rics_retail: 119.99, rics_offer: 139.99,
      inventory_store: 10, inventory_warehouse: 40, inventory_whs: 20,
    },
    {
      mpn: "39652004", sku: "SKU-004", brand: "NEW BALANCE", name: "NB 550 Below Cost",
      status: "Active",
      scom: 199.99, scom_sale: 35.00, rics_retail: 199.99, rics_offer: 35.00,
      inventory_store: 5, inventory_warehouse: 20, inventory_whs: 10,
    },
    {
      mpn: "39652005", sku: "SKU-005", brand: "REEBOK", name: "Reebok Classic Normal",
      status: "Active",
      scom: 89.99, scom_sale: 74.99, rics_retail: 89.99, rics_offer: 74.99,
      inventory_store: 15, inventory_warehouse: 60, inventory_whs: 30,
    },
  ];

  console.log(`\n🌱  Seeding ${products.length} test products for Step 1.5 …`);

  for (const p of products) {
    const docId = p.mpn.replace(/\//g, "__");
    await db.collection("products").doc(docId).set({
      mpn: p.mpn,
      sku: p.sku,
      brand: p.brand,
      name: p.name,
      status: p.status,
      scom: p.scom,
      scom_sale: p.scom_sale,
      rics_retail: p.rics_retail,
      rics_offer: p.rics_offer,
      inventory_store: p.inventory_store,
      inventory_warehouse: p.inventory_warehouse,
      inventory_whs: p.inventory_whs,
      completion_state: "incomplete",
      product_is_active: true,
      media_status: "",
      first_received_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  ✔ ${p.mpn} — ${p.name}`);
  }

  console.log(`\n✅  Seeded ${products.length} test products.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
