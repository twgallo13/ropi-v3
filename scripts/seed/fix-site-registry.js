/**
 * fix-site-registry.js
 *
 * Item 4 — Updates site owner dropdown values on the website
 * attribute and ensures site_registry has all four sites.
 */
"use strict";

const admin = require("firebase-admin");
const { initApp } = require("./utils");

initApp();
const db = admin.firestore();

const SITES = [
  { id: "shiekh", name: "Shiekh", domain: "shiekh.com" },
  { id: "karmaloop", name: "Karmaloop", domain: "karmaloop.com" },
  { id: "mltd", name: "MLTD", domain: "mltd.com" },
  { id: "sangremia", name: "Sangre Mia", domain: "sangremia.com" },
];

async function main() {
  console.log("🌐  Updating site owner dropdown + site_registry...");

  // Update website attribute dropdown_options
  await db.collection("attribute_registry").doc("website").set(
    { dropdown_options: ["Shiekh", "Karmaloop", "MLTD", "Sangre Mia"] },
    { merge: true }
  );
  console.log("  Updated website dropdown_options");

  // Upsert site_registry
  for (const site of SITES) {
    await db.collection("site_registry").doc(site.id).set(site, { merge: true });
    console.log(`  Upserted site_registry: ${site.id}`);
  }

  console.log("✅  Done");
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
