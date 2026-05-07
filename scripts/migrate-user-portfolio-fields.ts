#!/usr/bin/env -S npx tsx
/**
 * Phase 3.12 Track 1A — User Portfolio schema migration.
 *
 * Renames legacy user fields to portfolio_* and initializes new portfolio_*
 * fields on every doc in the `users` collection.
 *
 * Renames:
 *   departments  → portfolio_depts
 *   site_scope   → portfolio_sites
 *
 * Net-new (initialized empty if absent):
 *   portfolio_brands       : []
 *   portfolio_age_groups   : []
 *   portfolio_exclusions   : {}
 *
 * Untouched (Track 1A scope):
 *   gender_scope (Track 2 engine design)
 *
 * Strategy per doc (single batched write):
 *   - If `departments` exists AND `portfolio_depts` exists with DIFFERENT
 *     value: surface warning, SKIP doc (data divergence).
 *   - Else if `departments` exists: copy to portfolio_depts; FieldValue.delete
 *     the old `departments`.
 *   - Else if neither exists: initialize portfolio_depts: [].
 *   - Same logic for site_scope → portfolio_sites.
 *   - Always init portfolio_brands/age_groups/exclusions if absent.
 *
 * Audit log emitted per migrated doc:
 *   event_type: "phase-3.12-track-1a-portfolio-rename"
 *   target_user_id: <doc.id>
 *   actor: "system-migration"
 *   before: { fields touched, pre values }
 *   after:  { fields touched, post values }
 *
 * Idempotent: re-running on a fully-migrated doc is a no-op (no fields to
 * touch → no write, no audit).
 *
 * Usage:
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/migrate-user-portfolio-fields.ts --dry-run
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/migrate-user-portfolio-fields.ts
 *
 * Pattern reference: scripts/backfill-cadence-rename.ts (Phase 3.10 Track 3,
 * PR #87, SHA f89d941).
 */
import * as admin from "firebase-admin";
import * as fs from "fs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MODE = DRY_RUN ? "DRY-RUN" : "LIVE";

let saJson: string;
const envKey = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (envKey) {
  saJson = envKey;
} else if (fs.existsSync("/tmp/sa-dev.json")) {
  saJson = fs.readFileSync("/tmp/sa-dev.json", "utf8");
} else {
  console.error("❌  No SA credentials. Set GCP_SA_KEY_DEV or place /tmp/sa-dev.json.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(saJson)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const BATCH_LIMIT = 500;

interface DocPlan {
  docId: string;
  email: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  // Update map applied to Firestore (FieldValue.delete sentinels included).
  update: Record<string, unknown>;
}

interface DocWarning {
  docId: string;
  email: string | null;
  reason: string;
  details: Record<string, unknown>;
}

interface Summary {
  scanned: number;
  to_migrate: number;
  no_op: number;
  warnings: number;
  init_portfolio_depts: number;
  init_portfolio_sites: number;
  init_portfolio_brands: number;
  init_portfolio_age_groups: number;
  init_portfolio_exclusions: number;
  rename_departments: number;
  rename_site_scope: number;
  written: number;
  audit_emitted: number;
}

function arraysEqualShallow(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n🛠   Phase 3.12 Track 1A — user portfolio field migration — mode: ${MODE}`);
  console.log(`    Started: ${startedAt}`);
  console.log(`    Project: ropi-aoss-dev\n`);

  const summary: Summary = {
    scanned: 0,
    to_migrate: 0,
    no_op: 0,
    warnings: 0,
    init_portfolio_depts: 0,
    init_portfolio_sites: 0,
    init_portfolio_brands: 0,
    init_portfolio_age_groups: 0,
    init_portfolio_exclusions: 0,
    rename_departments: 0,
    rename_site_scope: 0,
    written: 0,
    audit_emitted: 0,
  };

  const snap = await db.collection("users").get();
  console.log(`    Docs fetched: ${snap.size}`);

  const plans: DocPlan[] = [];
  const warnings: DocWarning[] = [];

  for (const doc of snap.docs) {
    summary.scanned++;
    const data = doc.data() || {};
    const email = (data.email as string) || null;

    const hasDeps = "departments" in data;
    const hasSiteScope = "site_scope" in data;
    const hasPortDepts = "portfolio_depts" in data;
    const hasPortSites = "portfolio_sites" in data;
    const hasPortBrands = "portfolio_brands" in data;
    const hasPortAge = "portfolio_age_groups" in data;
    const hasPortExcl = "portfolio_exclusions" in data;

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const update: Record<string, unknown> = {};

    // ── portfolio_depts ────────────────────────────────────────────────
    if (hasDeps && hasPortDepts) {
      const oldVal = data.departments;
      const newVal = data.portfolio_depts;
      if (!arraysEqualShallow(oldVal, newVal)) {
        warnings.push({
          docId: doc.id,
          email,
          reason: "departments AND portfolio_depts both populated with DIFFERENT values",
          details: { departments: oldVal, portfolio_depts: newVal },
        });
        summary.warnings++;
        continue; // skip doc entirely
      }
      // Same value → drop the legacy field, keep the new one.
      before.departments = oldVal;
      update.departments = admin.firestore.FieldValue.delete();
      after.departments = "<deleted>";
      summary.rename_departments++;
    } else if (hasDeps) {
      const oldVal = data.departments;
      before.departments = oldVal;
      update.portfolio_depts = oldVal;
      update.departments = admin.firestore.FieldValue.delete();
      after.portfolio_depts = oldVal;
      after.departments = "<deleted>";
      summary.rename_departments++;
    } else if (!hasPortDepts) {
      before.portfolio_depts = "<absent>";
      update.portfolio_depts = [];
      after.portfolio_depts = [];
      summary.init_portfolio_depts++;
    }

    // ── portfolio_sites ────────────────────────────────────────────────
    if (hasSiteScope && hasPortSites) {
      const oldVal = data.site_scope;
      const newVal = data.portfolio_sites;
      if (!arraysEqualShallow(oldVal, newVal)) {
        warnings.push({
          docId: doc.id,
          email,
          reason: "site_scope AND portfolio_sites both populated with DIFFERENT values",
          details: { site_scope: oldVal, portfolio_sites: newVal },
        });
        summary.warnings++;
        continue;
      }
      before.site_scope = oldVal;
      update.site_scope = admin.firestore.FieldValue.delete();
      after.site_scope = "<deleted>";
      summary.rename_site_scope++;
    } else if (hasSiteScope) {
      const oldVal = data.site_scope;
      before.site_scope = oldVal;
      update.portfolio_sites = oldVal;
      update.site_scope = admin.firestore.FieldValue.delete();
      after.portfolio_sites = oldVal;
      after.site_scope = "<deleted>";
      summary.rename_site_scope++;
    } else if (!hasPortSites) {
      before.portfolio_sites = "<absent>";
      update.portfolio_sites = [];
      after.portfolio_sites = [];
      summary.init_portfolio_sites++;
    }

    // ── portfolio_brands ───────────────────────────────────────────────
    if (!hasPortBrands) {
      before.portfolio_brands = "<absent>";
      update.portfolio_brands = [];
      after.portfolio_brands = [];
      summary.init_portfolio_brands++;
    }

    // ── portfolio_age_groups ───────────────────────────────────────────
    if (!hasPortAge) {
      before.portfolio_age_groups = "<absent>";
      update.portfolio_age_groups = [];
      after.portfolio_age_groups = [];
      summary.init_portfolio_age_groups++;
    }

    // ── portfolio_exclusions ───────────────────────────────────────────
    if (!hasPortExcl) {
      before.portfolio_exclusions = "<absent>";
      update.portfolio_exclusions = {};
      after.portfolio_exclusions = {};
      summary.init_portfolio_exclusions++;
    }

    if (Object.keys(update).length === 0) {
      summary.no_op++;
      continue;
    }
    plans.push({ docId: doc.id, email, before, after, update });
    summary.to_migrate++;
  }

  console.log(`\n    Scanned:           ${summary.scanned}`);
  console.log(`    Plans (to write):  ${summary.to_migrate}`);
  console.log(`    No-op (idempotent):${summary.no_op}`);
  console.log(`    Warnings:          ${summary.warnings}`);
  console.log(`    Rename departments → portfolio_depts: ${summary.rename_departments}`);
  console.log(`    Rename site_scope  → portfolio_sites: ${summary.rename_site_scope}`);
  console.log(`    Init portfolio_depts (empty):         ${summary.init_portfolio_depts}`);
  console.log(`    Init portfolio_sites (empty):         ${summary.init_portfolio_sites}`);
  console.log(`    Init portfolio_brands (empty):        ${summary.init_portfolio_brands}`);
  console.log(`    Init portfolio_age_groups (empty):    ${summary.init_portfolio_age_groups}`);
  console.log(`    Init portfolio_exclusions (empty map):${summary.init_portfolio_exclusions}\n`);

  if (warnings.length > 0) {
    console.log("⚠️  Warnings (docs SKIPPED, no write):");
    for (const w of warnings) {
      console.log(`    [${w.docId}] (${w.email ?? "no-email"}): ${w.reason}`);
      console.log(`      details: ${JSON.stringify(w.details)}`);
    }
    console.log("");
  }

  if (DRY_RUN) {
    console.log("--- DRY-RUN: planned writes ---");
    for (const p of plans) {
      const summarized: Record<string, unknown> = {};
      for (const k of Object.keys(p.update)) {
        const v = p.update[k];
        // FieldValue.delete sentinel doesn't serialize cleanly.
        if (v && typeof v === "object" && (v as { _methodName?: string })._methodName) {
          summarized[k] = `<FieldValue.${(v as { _methodName: string })._methodName}>`;
        } else {
          summarized[k] = v;
        }
      }
      console.log(`  [${p.docId}] (${p.email ?? "no-email"})  update=${JSON.stringify(summarized)}`);
    }
    console.log("\n🔎  Dry-run complete — no writes performed.");
    return;
  }

  if (plans.length === 0) {
    console.log("✅  Nothing to migrate.");
    return;
  }

  // ── LIVE: batched writes (29 docs fits in a single batch) ────────────
  let cursor = 0;
  while (cursor < plans.length) {
    const chunk = plans.slice(cursor, cursor + BATCH_LIMIT);
    const batch = db.batch();
    for (const p of chunk) {
      const ref = db.collection("users").doc(p.docId);
      batch.set(ref, p.update, { merge: true });
    }
    await batch.commit();
    summary.written += chunk.length;
    console.log(`    Batch committed: docs ${cursor + 1}–${cursor + chunk.length}`);
    cursor += BATCH_LIMIT;
  }

  // ── Audit log emission (separate batch loop, 500 cap) ────────────────
  let acursor = 0;
  while (acursor < plans.length) {
    const chunk = plans.slice(acursor, acursor + BATCH_LIMIT);
    const auditBatch = db.batch();
    for (const p of chunk) {
      const auditRef = db.collection("audit_log").doc();
      auditBatch.set(auditRef, {
        event_type: "phase-3.12-track-1a-portfolio-rename",
        target_user_id: p.docId,
        target_user_email: p.email,
        actor: "system-migration",
        before: p.before,
        after: p.after,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await auditBatch.commit();
    summary.audit_emitted += chunk.length;
    acursor += BATCH_LIMIT;
  }

  console.log(`\n✅  Migration complete.`);
  console.log(`    Written:        ${summary.written}`);
  console.log(`    Audit emitted:  ${summary.audit_emitted}`);
  console.log(`    Warnings:       ${summary.warnings}`);
  console.log(`    No-op:          ${summary.no_op}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
