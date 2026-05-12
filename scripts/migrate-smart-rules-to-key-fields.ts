#!/usr/bin/env -S npx tsx
/**
 * TALLY-146A — Migrate ACTIVE smart_rules legacy display-string fields to
 * canonical _key fields.
 *
 * Walks all smart_rules with is_active === true and converts each
 * conditions[] entry whose field is the canonical-schema legacy display
 * name into the _key form. Inactive rules are skipped (PO ruling #2).
 *
 * Field swaps (PO ruling #5):
 *   - field === "department" → field = "department_key",
 *     value resolved via department_registry (key | display_name | alias)
 *   - field === "brand" → field = "brand_key",
 *     value resolved via brand_registry (brand_key | display_name | alias)
 *
 * Out of scope (per PO):
 *   - Inactive rules (skipped silently per ruling #2)
 *   - `category` (kept as exact display match, ruling #4)
 *   - Legacy-SCHEMA rules (those using `source_field`/`target_value`/
 *     `condition_logic`/scalar `action`) — TALLY-146A canonical-schema only
 *   - `gender`, `age_group`, `class`, `site_owner`, `season` etc.
 *
 * Behavior:
 *   - Idempotent: a rule already on `*_key` form is silently unchanged.
 *   - Per PO ruling #6, every modified rule receives a version bump:
 *       new_version = (current_version || 0) + 1
 *   - actions[] are NOT touched (smart_rules write attribute_values; no
 *     legacy display-string field appears as a target_field per the probe).
 *   - If a value cannot be resolved against active registry entries, the
 *     filter is LEFT UNCHANGED and a warning is logged. The script does
 *     NOT fail closed, but Lisa MUST review warnings before declaring done.
 *   - Emits one audit_log entry per migrated rule
 *     (event_type = "smart_rule_migrated_146a").
 *
 * Usage:
 *   npx tsx scripts/migrate-smart-rules-to-key-fields.ts --dry-run
 *   npx tsx scripts/migrate-smart-rules-to-key-fields.ts
 *
 * Auth: GCP_SA_KEY_DEV env var (inherited from environment).
 * Project: ropi-aoss-dev.
 */
import * as admin from "firebase-admin";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MODE = DRY_RUN ? "DRY-RUN" : "LIVE";

const SA_KEY_JSON = process.env.GCP_SA_KEY_DEV;
if (!SA_KEY_JSON) {
  console.error("GCP_SA_KEY_DEV env var not set");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(SA_KEY_JSON)),
    projectId: "ropi-aoss-dev",
  });
}

const db = admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

function normalize(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

interface DeptEntry {
  key: string;
  display_name: string;
  aliases: string[];
}
interface BrandEntry {
  brand_key: string;
  display_name: string;
  aliases: string[];
}

async function loadDeptRegistry(): Promise<DeptEntry[]> {
  const snap = await db
    .collection("department_registry")
    .where("is_active", "==", true)
    .get();
  return snap.docs.map((d) => ({
    key: String(d.data().key || d.id),
    display_name: String(d.data().display_name || ""),
    aliases: (d.data().aliases || []) as string[],
  }));
}

async function loadBrandRegistry(): Promise<BrandEntry[]> {
  const snap = await db
    .collection("brand_registry")
    .where("is_active", "==", true)
    .get();
  return snap.docs.map((d) => ({
    brand_key: String(d.data().brand_key || d.id),
    display_name: String(d.data().display_name || ""),
    aliases: (d.data().aliases || []) as string[],
  }));
}

function findDept(value: any, registry: DeptEntry[]): DeptEntry | null {
  const norm = normalize(value);
  if (!norm) return null;
  return (
    registry.find((d) => {
      if (normalize(d.key) === norm) return true;
      if (normalize(d.display_name) === norm) return true;
      for (const a of d.aliases) if (normalize(a) === norm) return true;
      return false;
    }) || null
  );
}

function findBrand(value: any, registry: BrandEntry[]): BrandEntry | null {
  const norm = normalize(value);
  if (!norm) return null;
  return (
    registry.find((b) => {
      if (normalize(b.brand_key) === norm) return true;
      if (normalize(b.display_name) === norm) return true;
      for (const a of b.aliases) if (normalize(a) === norm) return true;
      return false;
    }) || null
  );
}

interface MigrationStats {
  total_scanned: number;
  inactive_skipped: number;
  active_scanned: number;
  active_unchanged: number;
  active_modified: number;
  filter_swaps_department: number;
  filter_swaps_brand: number;
  warnings: string[];
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log("===================================================");
  console.log(`TALLY-146A — smart_rules field normalization — ${MODE}`);
  console.log(`Project:  ropi-aoss-dev`);
  console.log(`Started:  ${startedAt}`);
  console.log(`Scope:    active rules only; brand→brand_key, department→department_key`);
  console.log("===================================================\n");

  const [depts, brands] = await Promise.all([
    loadDeptRegistry(),
    loadBrandRegistry(),
  ]);
  console.log(`Loaded active registry: ${depts.length} departments, ${brands.length} brands\n`);

  const stats: MigrationStats = {
    total_scanned: 0,
    inactive_skipped: 0,
    active_scanned: 0,
    active_unchanged: 0,
    active_modified: 0,
    filter_swaps_department: 0,
    filter_swaps_brand: 0,
    warnings: [],
  };

  const rulesSnap = await db.collection("smart_rules").get();
  stats.total_scanned = rulesSnap.size;
  console.log(`Found ${rulesSnap.size} smart_rules total\n`);

  for (const ruleDoc of rulesSnap.docs) {
    const rule = ruleDoc.data();
    const ruleId = ruleDoc.id;

    if (rule.is_active !== true) {
      stats.inactive_skipped++;
      continue;
    }
    stats.active_scanned++;

    const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
    const newConditions: any[] = [];
    let changed = false;
    const perRuleSwaps: Array<{
      idx: number;
      from_field: string;
      to_field: string;
      from_value: any;
      to_value: any;
    }> = [];

    conditions.forEach((c: any, idx: number) => {
      const field = c && c.field;
      const value = c && c.value;

      if (field === "department") {
        const matched = findDept(value, depts);
        if (matched) {
          const swapped = { ...c, field: "department_key", value: matched.key };
          newConditions.push(swapped);
          changed = true;
          stats.filter_swaps_department++;
          perRuleSwaps.push({
            idx,
            from_field: "department",
            to_field: "department_key",
            from_value: value,
            to_value: matched.key,
          });
          console.log(
            `  [${ruleId}][cond ${idx}] department:"${value}" → department_key:"${matched.key}"`
          );
        } else {
          const w = `Rule ${ruleId} cond[${idx}]: department value "${value}" not found in active department_registry; LEFT UNCHANGED`;
          stats.warnings.push(w);
          console.warn(`  ⚠ ${w}`);
          newConditions.push(c);
        }
      } else if (field === "brand") {
        const matched = findBrand(value, brands);
        if (matched) {
          const swapped = { ...c, field: "brand_key", value: matched.brand_key };
          newConditions.push(swapped);
          changed = true;
          stats.filter_swaps_brand++;
          perRuleSwaps.push({
            idx,
            from_field: "brand",
            to_field: "brand_key",
            from_value: value,
            to_value: matched.brand_key,
          });
          console.log(
            `  [${ruleId}][cond ${idx}] brand:"${value}" → brand_key:"${matched.brand_key}"`
          );
        } else {
          const w = `Rule ${ruleId} cond[${idx}]: brand value "${value}" not found in active brand_registry; LEFT UNCHANGED`;
          stats.warnings.push(w);
          console.warn(`  ⚠ ${w}`);
          newConditions.push(c);
        }
      } else {
        // out of TALLY-146A scope — leave untouched
        newConditions.push(c);
      }
    });

    if (!changed) {
      stats.active_unchanged++;
      continue;
    }

    const oldVersion = Number(rule.version || 0);
    const newVersion = oldVersion + 1; // PO ruling #6

    if (DRY_RUN) {
      console.log(
        `  [${ruleId}] would write: ${perRuleSwaps.length} swap(s); version ${oldVersion} → ${newVersion}`
      );
      stats.active_modified++;
      continue;
    }

    // LIVE write
    try {
      await ruleDoc.ref.set(
        {
          conditions: newConditions,
          version: newVersion,
          updated_at: ts(),
          updated_by: "system_migration_146a",
        },
        { merge: true }
      );
      await db.collection("audit_log").add({
        event_type: "smart_rule_migrated_146a",
        rule_id: ruleId,
        rule_name: rule.rule_name || null,
        old_version: oldVersion,
        new_version: newVersion,
        before: conditions,
        after: newConditions,
        swaps: perRuleSwaps,
        reason: "TALLY-146A — normalize legacy display-string fields to _key",
        acting_user_id: "system_migration_146a",
        created_at: ts(),
      });
      stats.active_modified++;
      console.log(
        `  [${ruleId}] ✓ wrote ${perRuleSwaps.length} swap(s); version ${oldVersion} → ${newVersion}`
      );
    } catch (err: any) {
      const w = `Rule ${ruleId}: write FAILED — ${err.message || err}`;
      stats.warnings.push(w);
      console.error(`  ✗ ${w}`);
    }
  }

  console.log("\n===================================================");
  console.log(`SUMMARY (${MODE})`);
  console.log("===================================================");
  console.log(`Total smart_rules scanned:        ${stats.total_scanned}`);
  console.log(`Inactive (skipped):               ${stats.inactive_skipped}`);
  console.log(`Active scanned:                   ${stats.active_scanned}`);
  console.log(`Active unchanged (already canon): ${stats.active_unchanged}`);
  console.log(`Active modified:                  ${stats.active_modified}`);
  console.log(`Department field swaps:           ${stats.filter_swaps_department}`);
  console.log(`Brand field swaps:                ${stats.filter_swaps_brand}`);
  console.log(`Warnings:                         ${stats.warnings.length}`);
  if (stats.warnings.length > 0) {
    console.log("\n⚠ Warnings:");
    for (const w of stats.warnings) console.log(`  - ${w}`);
  }
  console.log(`\nFinished: ${new Date().toISOString()}`);
  if (DRY_RUN) {
    console.log("\nNo writes performed (--dry-run). Re-run without flag to apply.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("MIGRATION FAILED:", err);
    process.exit(1);
  });
