#!/usr/bin/env node
/**
 * TALLY-122 — Phase 5 Pass 1, Task 1
 * Site Registry Migration: 8 bare-slug docs → canonical {slug}_com IDs.
 *
 *   • Preserves all existing operational fields (platform, ai_content_strategy,
 *     features, feed_config, status, vertical, locale, currency, timezone,
 *     created_at, updated_at, etc.).
 *   • Adds Phase 4.4 §3.1 canonical fields: site_key, display_name, domain,
 *     is_active, priority, badge_color, notes.
 *   • PO active set (per TALLY-122 brief): shiekh_com, mltd_com, karmaloop_com.
 *     All others is_active: false.
 *   • Sangre Mia is schema-incomplete in source — gets shiekh placeholders for
 *     missing operational fields and a review_required flag.
 *   • Idempotent: skips if {slug}_com already exists; deletes the old bare-slug
 *     doc only after the new doc is verified present.
 *   • Audit-logged via audit_log collection.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/phase5-pass1-registry-migration.js [--dry-run]
 */
"use strict";

const admin = require("firebase-admin");

const KEY_ENV = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!KEY_ENV) {
  console.error("❌  GCP_SA_KEY_DEV not set");
  process.exit(1);
}
const DRY_RUN = process.argv.includes("--dry-run");

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(KEY_ENV)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

// Phase 4.4 §3.1 canonical metadata, keyed by old bare slug.
// PO ruling (TALLY-122): only shiekh / mltd / karmaloop are active.
const CANONICAL = {
  shiekh:      { new_id: "shiekh_com",      display_name: "Shiekh",         domain: "shiekh.com",         is_active: true,  priority: 10 },
  karmaloop:   { new_id: "karmaloop_com",   display_name: "Karmaloop",      domain: "karmaloop.com",      is_active: true,  priority: 20 },
  mltd:        { new_id: "mltd_com",        display_name: "MLTD",           domain: "mltd.com",           is_active: true,  priority: 30 },
  sangremia:   { new_id: "sangremia_com",   display_name: "Sangre Mia",     domain: "sangremia.com",      is_active: false, priority: 40, notes: "Placeholder operational fields copied from shiekh; PO review required before activation." },
  shiekhshoes: { new_id: "shiekhshoes_com", display_name: "Shiekh Shoes",   domain: "shiekhshoes.com",    is_active: false, priority: 90 },
  fbrk:        { new_id: "fbrkclothing_com", display_name: "FBRK Clothing", domain: "fbrkclothing.com",   is_active: false, priority: 91 },
  plndr:       { new_id: "plndr_com",       display_name: "PLNDR",          domain: "plndr.com",          is_active: false, priority: 92 },
  trendswap:   { new_id: "trendswap_com",   display_name: "TrendSwap",      domain: "trendswap.com",      is_active: false, priority: 93 },
};

// Operational fields that must be preserved verbatim from the source doc.
const OPERATIONAL_FIELDS = [
  "platform", "status", "ai_content_strategy", "locale", "currency",
  "timezone", "vertical", "features", "feed_config",
  "created_at", "updated_at",
];

async function writeAudit(action, entityId, details) {
  if (DRY_RUN) return;
  await db.collection("audit_log").add({
    action,
    entity_type: "site_registry",
    entity_id: entityId,
    actor_uid: "system:tally-122",
    details,
    timestamp: ts(),
  });
}

async function loadShiekhPlaceholders() {
  const shiekhSnap = await db.collection("site_registry").doc("shiekh").get();
  if (!shiekhSnap.exists) {
    // Maybe already migrated.
    const newShiekhSnap = await db.collection("site_registry").doc("shiekh_com").get();
    if (newShiekhSnap.exists) return newShiekhSnap.data();
    throw new Error("Cannot derive sangremia placeholders: neither shiekh nor shiekh_com exists.");
  }
  return shiekhSnap.data();
}

async function migrateOne(oldId, meta, shiekhPlaceholders) {
  const oldRef = db.collection("site_registry").doc(oldId);
  const newRef = db.collection("site_registry").doc(meta.new_id);

  const [oldSnap, newSnap] = await Promise.all([oldRef.get(), newRef.get()]);

  // Idempotency branch: new already exists.
  if (newSnap.exists) {
    if (oldSnap.exists && oldId !== meta.new_id) {
      console.log(`  · ${oldId} → ${meta.new_id}: new doc exists; deleting stale old doc`);
      if (!DRY_RUN) await oldRef.delete();
      await writeAudit("site_registry.stale_old_doc_deleted", meta.new_id, { old_id: oldId });
      return { id: oldId, action: "old_deleted_only" };
    }
    console.log(`  · ${oldId} → ${meta.new_id}: already migrated, skipping`);
    return { id: oldId, action: "skipped" };
  }

  if (!oldSnap.exists) {
    console.log(`  ! ${oldId}: source doc missing, cannot migrate`);
    return { id: oldId, action: "source_missing" };
  }

  const src = oldSnap.data() || {};
  const payload = {
    site_key: meta.new_id,
    display_name: meta.display_name,
    domain: meta.domain,
    is_active: meta.is_active,
    priority: meta.priority,
    badge_color: null,
  };
  if (meta.notes) payload.notes = meta.notes;

  // Preserve operational fields from source.
  for (const field of OPERATIONAL_FIELDS) {
    if (src[field] !== undefined) payload[field] = src[field];
  }

  // Sangre Mia placeholder fill: copy missing operational fields from shiekh.
  let placeholderFields = [];
  if (oldId === "sangremia") {
    for (const field of OPERATIONAL_FIELDS) {
      if (payload[field] === undefined && shiekhPlaceholders[field] !== undefined) {
        payload[field] = shiekhPlaceholders[field];
        placeholderFields.push(field);
      }
    }
    payload.review_required = true;
    payload.review_reason =
      "Schema-incomplete in pre-Pass-1 state. Operational placeholder fields copied from shiekh: " +
      placeholderFields.join(", ") +
      ". PO review required before activation.";
  }

  if (DRY_RUN) {
    console.log(`  · ${oldId} → ${meta.new_id}: WOULD CREATE`, JSON.stringify(payload, null, 2));
    return { id: oldId, action: "would_create" };
  }

  await newRef.set(payload);

  // Verify before deleting old.
  const verifySnap = await newRef.get();
  if (!verifySnap.exists) {
    console.error(`  ✗ ${oldId}: new doc write did not persist; aborting old-doc delete`);
    return { id: oldId, action: "write_unverified" };
  }
  if (oldId !== meta.new_id) {
    await oldRef.delete();
  }

  await writeAudit("site_registry.migrated", meta.new_id, {
    old_id: oldId,
    new_id: meta.new_id,
    is_active: meta.is_active,
    priority: meta.priority,
    placeholder_fields: placeholderFields,
  });

  console.log(`  ✓ ${oldId} → ${meta.new_id}  (active=${meta.is_active}, priority=${meta.priority})`);
  return { id: oldId, action: "migrated" };
}

async function main() {
  console.log(`\n→ Phase 5 Pass 1, Task 1 — Site Registry Migration${DRY_RUN ? "  [DRY RUN]" : ""}`);
  const shiekhPlaceholders = await loadShiekhPlaceholders();

  const results = [];
  for (const [oldId, meta] of Object.entries(CANONICAL)) {
    try {
      const r = await migrateOne(oldId, meta, shiekhPlaceholders);
      results.push(r);
    } catch (err) {
      console.error(`  ✗ ${oldId}: ${err.message}`);
      results.push({ id: oldId, action: "error", error: err.message });
    }
  }

  // Final state dump.
  console.log("\n→ Final site_registry state:");
  const finalSnap = await db.collection("site_registry").get();
  const summary = finalSnap.docs
    .map((d) => ({ id: d.id, is_active: d.get("is_active"), priority: d.get("priority"), display_name: d.get("display_name") }))
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  console.table(summary);

  console.log("\n→ Migration summary:");
  console.table(results);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error("FATAL:", err); process.exit(1); });
