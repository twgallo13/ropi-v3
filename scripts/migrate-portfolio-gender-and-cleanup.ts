#!/usr/bin/env -S npx tsx
/**
 * Phase 3.12 Track 1C — User portfolio gender rename + registry-integrity cleanup.
 *
 * Per dispatch TALLY-PHASE-3.12-TRACK-1C:
 *   Decision Y (Case-fold): Auto-correct existing portfolio data via case-fold
 *     lookup against active registry IDs (e.g. "Footwear" → "footwear").
 *   Decision Z (Rename):    gender_scope → portfolio_gender on every user doc.
 *
 * For each user doc:
 *   1. Rename gender_scope → portfolio_gender:
 *      - If gender_scope is null → set portfolio_gender: [], delete gender_scope.
 *      - If gender_scope is array → copy through normalize() to portfolio_gender,
 *        delete gender_scope.
 *      - If portfolio_gender already set with a different value → SKIP doc, warn.
 *   2. Case-fold + active-only normalize on each portfolio_* array:
 *      - Exact match against active registry set → keep as-is.
 *      - Case-insensitive match against active set → replace with canonical.
 *      - No match (or matches an inactive ID) → drop, log.
 *   3. Same normalize on portfolio_exclusions[dimension] arrays.
 *
 * Authority sources (Track 1C — is_active === true filter):
 *   brand        → brand_registry where is_active==true (doc.id)
 *   department   → department_registry where is_active==true (doc.id)
 *   site         → site_registry where is_active==true (doc.id)
 *   class        → attribute_registry/class.dropdown_options
 *   age_group    → attribute_registry/age_group.dropdown_options
 *   gender       → attribute_registry/gender.dropdown_options
 *
 * Audit log emitted per migrated doc:
 *   event_type: "phase-3.12-track-1c-portfolio-cleanup"
 *   target_user_id: <doc.id>
 *   actor: "system-migration"
 *   before: { fields touched, pre values }
 *   after:  { fields touched, post values }
 *   changes: [{ field, action, from, to }]
 *
 * Idempotent: re-running on a fully-cleaned doc is a no-op.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/migrate-portfolio-gender-and-cleanup.ts --dry-run
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/migrate-portfolio-gender-and-cleanup.ts
 *
 * Pattern reference: scripts/migrate-user-portfolio-fields.ts (Track 1A).
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
} else if (fs.existsSync("/tmp/gcp-sa-key.json")) {
  saJson = fs.readFileSync("/tmp/gcp-sa-key.json", "utf8");
} else if (fs.existsSync("/tmp/sa-dev.json")) {
  saJson = fs.readFileSync("/tmp/sa-dev.json", "utf8");
} else {
  console.error("❌  No SA credentials. Set GCP_SA_KEY_DEV or place /tmp/gcp-sa-key.json.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(saJson)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const BATCH_LIMIT = 500;

interface RegistrySets {
  brand: Set<string>;
  department: Set<string>;
  site: Set<string>;
  class: Set<string>;
  age_group: Set<string>;
  gender: Set<string>;
}

interface CaseFoldMaps {
  brand: Map<string, string>;
  department: Map<string, string>;
  site: Map<string, string>;
  class: Map<string, string>;
  age_group: Map<string, string>;
  gender: Map<string, string>;
}

type Dimension = keyof RegistrySets;

interface ChangeRec {
  field: string;             // e.g. "portfolio_depts" or "portfolio_exclusions.site"
  action: "rename" | "casefold" | "drop_inactive" | "drop_unknown" | "init";
  from?: unknown;
  to?: unknown;
  detail?: string;
}

interface DocPlan {
  docId: string;
  email: string | null;
  changes: ChangeRec[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
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
  rename_gender_scope: number;
  casefold_total: number;
  drop_inactive_total: number;
  drop_unknown_total: number;
  written: number;
  audit_emitted: number;
}

async function loadRegistries(): Promise<{ sets: RegistrySets; lower: CaseFoldMaps }> {
  const [brandSnap, deptSnap, siteSnap, classDoc, ageDoc, genderDoc] = await Promise.all([
    db.collection("brand_registry").where("is_active", "==", true).get(),
    db.collection("department_registry").where("is_active", "==", true).get(),
    db.collection("site_registry").where("is_active", "==", true).get(),
    db.collection("attribute_registry").doc("class").get(),
    db.collection("attribute_registry").doc("age_group").get(),
    db.collection("attribute_registry").doc("gender").get(),
  ]);

  const sets: RegistrySets = {
    brand: new Set(brandSnap.docs.map((d) => d.id)),
    department: new Set(deptSnap.docs.map((d) => d.id)),
    site: new Set(siteSnap.docs.map((d) => d.id)),
    class: new Set(((classDoc.data() || {}).dropdown_options || []) as string[]),
    age_group: new Set(((ageDoc.data() || {}).dropdown_options || []) as string[]),
    gender: new Set(((genderDoc.data() || {}).dropdown_options || []) as string[]),
  };

  function buildLower(s: Set<string>): Map<string, string> {
    const m = new Map<string, string>();
    s.forEach((v) => m.set(v.toLowerCase(), v));
    return m;
  }

  const lower: CaseFoldMaps = {
    brand: buildLower(sets.brand),
    department: buildLower(sets.department),
    site: buildLower(sets.site),
    class: buildLower(sets.class),
    age_group: buildLower(sets.age_group),
    gender: buildLower(sets.gender),
  };
  return { sets, lower };
}

/**
 * Normalize an array of values against the active registry set for a dimension.
 * Returns the normalized array + per-element change records for audit.
 */
function normalizeArray(
  fieldName: string,
  dimension: Dimension,
  arr: unknown,
  sets: RegistrySets,
  lower: CaseFoldMaps,
  changes: ChangeRec[]
): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  const allowed = sets[dimension];
  const lookupLower = lower[dimension];
  for (const v of arr) {
    if (typeof v !== "string") {
      changes.push({ field: fieldName, action: "drop_unknown", from: v, detail: "non-string" });
      continue;
    }
    if (allowed.has(v)) {
      out.push(v);
      continue;
    }
    const canonical = lookupLower.get(v.toLowerCase());
    if (canonical) {
      changes.push({ field: fieldName, action: "casefold", from: v, to: canonical });
      out.push(canonical);
      continue;
    }
    // Not in active set — could be inactive or unknown.
    // Cheap discrimination: check if the lowercase version is in *any* known
    // registry-form pattern. For now, label as drop_inactive vs drop_unknown
    // based on whether it looks like a plausible registry id (lowercase + valid chars).
    const looksLikeKey = /^[a-z0-9_]+$/.test(v);
    changes.push({
      field: fieldName,
      action: looksLikeKey ? "drop_inactive" : "drop_unknown",
      from: v,
      detail: looksLikeKey
        ? `not in active ${dimension}_registry`
        : `not in ${dimension} options (case-fold also missed)`,
    });
  }
  // Dedupe (case-fold may map two inputs to one canonical).
  return Array.from(new Set(out));
}

function arraysEqualShallow(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n🛠   Phase 3.12 Track 1C — gender rename + registry-integrity cleanup — mode: ${MODE}`);
  console.log(`    Started: ${startedAt}`);
  console.log(`    Project: ropi-aoss-dev\n`);

  const { sets, lower } = await loadRegistries();
  console.log(`    Active registries loaded:`);
  console.log(`      brand:      ${sets.brand.size}`);
  console.log(`      department: ${sets.department.size}`);
  console.log(`      site:       ${sets.site.size}`);
  console.log(`      class:      ${sets.class.size}`);
  console.log(`      age_group:  ${sets.age_group.size}`);
  console.log(`      gender:     ${sets.gender.size}\n`);

  const summary: Summary = {
    scanned: 0,
    to_migrate: 0,
    no_op: 0,
    warnings: 0,
    rename_gender_scope: 0,
    casefold_total: 0,
    drop_inactive_total: 0,
    drop_unknown_total: 0,
    written: 0,
    audit_emitted: 0,
  };

  const snap = await db.collection("users").get();
  console.log(`    Docs fetched: ${snap.size}\n`);

  const plans: DocPlan[] = [];
  const warnings: DocWarning[] = [];

  for (const doc of snap.docs) {
    summary.scanned++;
    const data = doc.data() || {};
    const email = (data.email as string) || null;

    const changes: ChangeRec[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const update: Record<string, unknown> = {};

    // ── Decision Z: gender_scope → portfolio_gender ─────────────────────
    const hasGS = "gender_scope" in data;
    const hasPG = "portfolio_gender" in data;
    let renamedGenderValueSource: unknown = undefined;
    if (hasGS && hasPG) {
      const gs = data.gender_scope;
      const pg = data.portfolio_gender;
      const gsArr = Array.isArray(gs) ? gs : [];
      const pgArr = Array.isArray(pg) ? pg : [];
      if (!arraysEqualShallow([...gsArr].sort(), [...pgArr].sort())) {
        warnings.push({
          docId: doc.id,
          email,
          reason: "gender_scope AND portfolio_gender both populated with DIFFERENT values",
          details: { gender_scope: gs, portfolio_gender: pg },
        });
        summary.warnings++;
        continue;
      }
      // Same value (or both null/empty) → drop legacy field, keep new.
      before.gender_scope = gs;
      update.gender_scope = admin.firestore.FieldValue.delete();
      after.gender_scope = "<deleted>";
      changes.push({ field: "gender_scope", action: "rename", from: gs, to: "<merged into existing portfolio_gender>" });
      summary.rename_gender_scope++;
      renamedGenderValueSource = pg;
    } else if (hasGS) {
      const gs = data.gender_scope;
      before.gender_scope = gs;
      update.gender_scope = admin.firestore.FieldValue.delete();
      after.gender_scope = "<deleted>";
      // gender_scope value (after normalize) becomes portfolio_gender below.
      renamedGenderValueSource = gs;
      changes.push({ field: "gender_scope", action: "rename", from: gs, to: "portfolio_gender" });
      summary.rename_gender_scope++;
    }

    // ── Decision Y: case-fold + active-only on each portfolio_* array ────
    const dimensionMap: Array<{ field: string; dim: Dimension }> = [
      { field: "portfolio_brands", dim: "brand" },
      { field: "portfolio_depts", dim: "department" },
      { field: "portfolio_sites", dim: "site" },
      { field: "portfolio_age_groups", dim: "age_group" },
    ];
    for (const { field, dim } of dimensionMap) {
      if (!(field in data)) continue;
      const original = data[field];
      if (!Array.isArray(original)) continue;
      const preChanges = changes.length;
      const normalized = normalizeArray(field, dim, original, sets, lower, changes);
      const fieldChanges = changes.length - preChanges;
      if (fieldChanges > 0 || !arraysEqualShallow(original as unknown[], normalized)) {
        before[field] = original;
        update[field] = normalized;
        after[field] = normalized;
      }
    }

    // ── portfolio_gender: from rename source OR from existing field ──────
    if (renamedGenderValueSource !== undefined) {
      const gv = renamedGenderValueSource;
      const normalized = Array.isArray(gv)
        ? normalizeArray("portfolio_gender", "gender", gv, sets, lower, changes)
        : [];
      // Always set portfolio_gender from rename (treat null gender_scope as []).
      before.portfolio_gender = data.portfolio_gender ?? "<absent>";
      update.portfolio_gender = normalized;
      after.portfolio_gender = normalized;
    } else if ("portfolio_gender" in data) {
      // Already-set portfolio_gender → re-normalize to catch case-fold drift.
      const original = data.portfolio_gender;
      if (Array.isArray(original)) {
        const preChanges = changes.length;
        const normalized = normalizeArray("portfolio_gender", "gender", original, sets, lower, changes);
        const fieldChanges = changes.length - preChanges;
        if (fieldChanges > 0 || !arraysEqualShallow(original as unknown[], normalized)) {
          before.portfolio_gender = original;
          update.portfolio_gender = normalized;
          after.portfolio_gender = normalized;
        }
      }
    }

    // ── portfolio_exclusions: normalize per dimension ────────────────────
    const excl = data.portfolio_exclusions;
    if (excl && typeof excl === "object" && !Array.isArray(excl)) {
      const exclMap = excl as Record<string, unknown>;
      const newExcl: Record<string, string[]> = {};
      let exclChanged = false;
      for (const [dim, arr] of Object.entries(exclMap)) {
        if (!(["brand", "department", "site", "class", "age_group", "gender"] as const).includes(dim as Dimension)) {
          changes.push({
            field: `portfolio_exclusions.${dim}`,
            action: "drop_unknown",
            from: arr,
            detail: "unknown exclusion dimension",
          });
          exclChanged = true;
          continue;
        }
        const dimension = dim as Dimension;
        const preChanges = changes.length;
        const normalized = normalizeArray(
          `portfolio_exclusions.${dim}`,
          dimension,
          arr,
          sets,
          lower,
          changes
        );
        const fieldChanges = changes.length - preChanges;
        if (
          fieldChanges > 0 ||
          !arraysEqualShallow(Array.isArray(arr) ? arr : [], normalized)
        ) {
          exclChanged = true;
        }
        if (normalized.length > 0) newExcl[dim] = normalized;
      }
      if (exclChanged) {
        before.portfolio_exclusions = excl;
        update.portfolio_exclusions = newExcl;
        after.portfolio_exclusions = newExcl;
      }
    }

    // Tally summary deltas
    for (const c of changes) {
      if (c.action === "casefold") summary.casefold_total++;
      else if (c.action === "drop_inactive") summary.drop_inactive_total++;
      else if (c.action === "drop_unknown") summary.drop_unknown_total++;
    }

    if (Object.keys(update).length === 0) {
      summary.no_op++;
      continue;
    }
    plans.push({ docId: doc.id, email, changes, before, after, update });
    summary.to_migrate++;
  }

  console.log(`    Scanned:                ${summary.scanned}`);
  console.log(`    Plans (to write):       ${summary.to_migrate}`);
  console.log(`    No-op (idempotent):     ${summary.no_op}`);
  console.log(`    Warnings (skipped):     ${summary.warnings}`);
  console.log(`    Rename gender_scope:    ${summary.rename_gender_scope}`);
  console.log(`    Casefold corrections:   ${summary.casefold_total}`);
  console.log(`    Drop (inactive):        ${summary.drop_inactive_total}`);
  console.log(`    Drop (unknown):         ${summary.drop_unknown_total}\n`);

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
      console.log(`\n  [${p.docId}] (${p.email ?? "no-email"})`);
      for (const c of p.changes) {
        const fromS = c.from === undefined ? "" : ` from=${JSON.stringify(c.from)}`;
        const toS = c.to === undefined ? "" : ` to=${JSON.stringify(c.to)}`;
        const detS = c.detail ? ` (${c.detail})` : "";
        console.log(`     - ${c.action.padEnd(15)} ${c.field}${fromS}${toS}${detS}`);
      }
    }
    console.log("\n🔎  Dry-run complete — no writes performed.");
    return;
  }

  if (plans.length === 0) {
    console.log("✅  Nothing to migrate.");
    return;
  }

  // ── LIVE: batched writes ─────────────────────────────────────────────
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

  // ── Audit log emission ───────────────────────────────────────────────
  let acursor = 0;
  while (acursor < plans.length) {
    const chunk = plans.slice(acursor, acursor + BATCH_LIMIT);
    const auditBatch = db.batch();
    for (const p of chunk) {
      const auditRef = db.collection("audit_log").doc();
      auditBatch.set(auditRef, {
        event_type: "phase-3.12-track-1c-portfolio-cleanup",
        target_user_id: p.docId,
        target_user_email: p.email,
        actor: "system-migration",
        before: p.before,
        after: p.after,
        changes: p.changes,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await auditBatch.commit();
    summary.audit_emitted += chunk.length;
    acursor += BATCH_LIMIT;
  }

  console.log(`\n✅  Migration complete.`);
  console.log(`    Written:       ${summary.written}`);
  console.log(`    Audit emitted: ${summary.audit_emitted}`);
  console.log(`    Warnings:      ${summary.warnings}`);
  console.log(`    No-op:         ${summary.no_op}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
