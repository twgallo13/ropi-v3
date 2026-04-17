#!/usr/bin/env node
/**
 * Migration: users.advisory_preferences — Step 3.4
 * Adds default advisory_preferences to every users/{uid} doc that doesn't
 * already have one. Non-destructive; uses merge set.
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

async function main() {
  const app = initApp();
  const db = admin.firestore(app);

  const snap = await db.collection("users").get();
  let added = 0, skipped = 0;
  console.log(`\n🌱  Migrating ${snap.size} users…`);
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (data.advisory_preferences && data.advisory_preferences.focus_area) {
      skipped++;
      continue;
    }
    await doc.ref.set(
      {
        advisory_preferences: {
          focus_area: "balanced",
          format_preference: "prose",
        },
      },
      { merge: true }
    );
    added++;
    console.log(`  ✅  ${data.email || doc.id} — defaults applied`);
  }
  console.log(`\n✅  Done — ${added} added, ${skipped} already had prefs\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌  Migration failed:", err);
  process.exit(1);
});
