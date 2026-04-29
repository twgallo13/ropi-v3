#!/usr/bin/env node
/**
 * Migration: admin_tours → guided_tours (TALLY-SETTINGS-UX Phase 3 / A.3 PR1)
 *
 * Per ruling R.5:
 *   - Idempotent: skip-if-exists check before each set
 *   - Full-payload set() (NOT field-selective merge) — preserves is_active: boolean
 *   - Per-doc log: migrated | skipped | failed
 *   - After all docs migrated, deletes originals from admin_tours
 *
 * Run:
 *   npm run migrate:admin-tours-to-guided-tours
 *   (uses npx tsx — scripts/ has no native TS infra; this is the
 *    only TS migration in scripts/ as of A.3 PR1)
 */
import * as admin from "firebase-admin";

interface RunResult {
  migrated: string[];
  skipped: string[];
  failed: { id: string; error: string }[];
  deleted: string[];
}

async function run(): Promise<RunResult> {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();
  const SRC = "admin_tours";
  const DST = "guided_tours";

  const result: RunResult = { migrated: [], skipped: [], failed: [], deleted: [] };

  console.log(`\n🔄  Migrating ${SRC} → ${DST} …\n`);

  const srcSnap = await db.collection(SRC).get();
  if (srcSnap.empty) {
    console.log(`  ℹ️   ${SRC} is empty — nothing to migrate.`);
    return result;
  }

  for (const doc of srcSnap.docs) {
    const id = doc.id;
    const data = doc.data() || {};
    const dstRef = db.collection(DST).doc(id);
    try {
      const dstSnap = await dstRef.get();
      if (dstSnap.exists) {
        console.log(`  ⏭️   ${id}  (skipped — already exists in ${DST})`);
        result.skipped.push(id);
        continue;
      }
      // Full-payload set — preserves is_active: boolean (per R.5).
      await dstRef.set(data);
      console.log(`  ✅  ${id}  (migrated)`);
      result.migrated.push(id);
    } catch (err: any) {
      console.error(`  ❌  ${id}  (failed: ${err.message})`);
      result.failed.push({ id, error: err.message });
    }
  }

  // After all migrated, delete originals from admin_tours.
  if (result.failed.length > 0) {
    console.log(
      `\n⚠️   ${result.failed.length} failures — skipping cleanup of ${SRC}. Re-run after fixing.`
    );
  } else {
    console.log(`\n🧹  Cleaning up ${SRC} (deleting ${srcSnap.size} originals) …`);
    for (const doc of srcSnap.docs) {
      try {
        await db.collection(SRC).doc(doc.id).delete();
        result.deleted.push(doc.id);
        console.log(`  🗑️   ${doc.id}  (deleted from ${SRC})`);
      } catch (err: any) {
        console.error(`  ❌  ${doc.id}  (delete failed: ${err.message})`);
      }
    }
  }

  console.log(
    `\n✅  Done — migrated=${result.migrated.length}, skipped=${result.skipped.length}, failed=${result.failed.length}, deleted=${result.deleted.length}\n`
  );
  return result;
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌  Migration failed:", e);
    process.exit(1);
  });
