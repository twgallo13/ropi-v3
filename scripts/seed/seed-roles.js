#!/usr/bin/env node
/**
 * Seed script: roles collection
 * Idempotent — safe to run multiple times (uses set-with-merge).
 *
 * Usage:  node scripts/seed/seed-roles.js
 */

"use strict";

const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "roles";

const ROLES = [
  {
    id: "superadmin",
    name: "Super Admin",
    description: "Full platform access across all sites",
    permissions: [
      "sites:read", "sites:write", "sites:delete",
      "users:read", "users:write", "users:delete",
      "orders:read", "orders:write", "orders:cancel",
      "products:read", "products:write", "products:delete",
      "config:read", "config:write",
      "analytics:read",
      "ai:manage",
    ],
    isSystem: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "admin",
    name: "Admin",
    description: "Site-level administrative access",
    permissions: [
      "sites:read",
      "users:read", "users:write",
      "orders:read", "orders:write", "orders:cancel",
      "products:read", "products:write",
      "config:read",
      "analytics:read",
    ],
    isSystem: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "editor",
    name: "Editor",
    description: "Content and product management",
    permissions: [
      "sites:read",
      "products:read", "products:write",
      "orders:read",
      "analytics:read",
    ],
    isSystem: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "viewer",
    name: "Viewer",
    description: "Read-only access to dashboards and reports",
    permissions: [
      "sites:read",
      "orders:read",
      "products:read",
      "analytics:read",
    ],
    isSystem: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
];

async function main() {
  const app = initApp();
  const db = admin.firestore(app);
  console.log(`\n🌱  Seeding "${COLLECTION}" collection …`);

  let created = 0;
  let updated = 0;

  for (const role of ROLES) {
    const { id, ...data } = role;
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();

    if (snap.exists) {
      const { createdAt, ...updateData } = data;
      await ref.set({ ...updateData, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      updated++;
      console.log(`   ✏️  Updated existing doc: ${COLLECTION}/${id}`);
    } else {
      await ref.set(data);
      created++;
      console.log(`   ✅  Created doc: ${COLLECTION}/${id}`);
    }
  }

  console.log(`\n   Summary → created: ${created}, updated: ${updated}, total: ${ROLES.length}`);
  console.log(`   ✔  "${COLLECTION}" seed complete.\n`);
}

main().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
