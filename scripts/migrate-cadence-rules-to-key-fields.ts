#!/usr/bin/env -S npx tsx
/**
 * TALLY-138 — Migrate legacy cadence_rules to _key field convention.
 *
 * Walks all cadence_rules.target_filters and converts:
 *   - field="department" → field="department_key", value resolved via department_registry
 *   - field="brand" → field="brand_key", value resolved via brand_registry
 *   - field="site_owner" → field unchanged, value lowercased
 *   - field="gender" → field unchanged, value display-case-normalized via casefold
 *                     against attribute_registry/gender.dropdown_options
 *   - field="season" → REMOVE entire filter (no source-of-truth, per PO R3)
 *   - other fields → unchanged
 *
 * Idempotent. Safe to re-run. Does NOT bump rule version.
 *
 * Run:
 *   npx tsx scripts/migrate-cadence-rules-to-key-fields.ts
 *
 * Auth: GCP_SA_KEY_DEV env var (inherited from environment).
 */
import * as admin from "firebase-admin";

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
  return String(s || "").trim().toLowerCase();
}

interface DeptEntry {
  key: string;
  display_name: string;
  aliases: string[];
  is_active: boolean;
}
interface BrandEntry {
  brand_key: string;
  display_name: string;
  aliases: string[];
  is_active: boolean;
}

async function loadDeptRegistry(): Promise<DeptEntry[]> {
  const snap = await db.collection("department_registry").get();
  return snap.docs.map((d) => ({
    key: d.id,
    display_name: (d.data().display_name || "") as string,
    aliases: ((d.data().aliases || []) as string[]),
    is_active: d.data().is_active === true,
  }));
}

async function loadBrandRegistry(): Promise<BrandEntry[]> {
  const snap = await db.collection("brand_registry").get();
  return snap.docs.map((d) => ({
    brand_key: (d.data().brand_key || d.id) as string,
    display_name: (d.data().display_name || "") as string,
    aliases: ((d.data().aliases || []) as string[]),
    is_active: d.data().is_active === true,
  }));
}

async function loadGenderOptions(): Promise<string[]> {
  const doc = await db.collection("attribute_registry").doc("gender").get();
  return ((doc.data() || {}).dropdown_options || []) as string[];
}

function findDept(value: any, registry: DeptEntry[]): DeptEntry | null {
  const norm = normalize(value);
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
  return (
    registry.find((b) => {
      if (normalize(b.brand_key) === norm) return true;
      if (normalize(b.display_name) === norm) return true;
      for (const a of b.aliases) if (normalize(a) === norm) return true;
      return false;
    }) || null
  );
}

function casefoldGender(value: any, options: string[]): string | null {
  const norm = normalize(value);
  return options.find((o) => normalize(o) === norm) || null;
}

async function main() {
  const [depts, brands, genderOpts] = await Promise.all([
    loadDeptRegistry(),
    loadBrandRegistry(),
    loadGenderOptions(),
  ]);

  console.log(
    `Loaded: ${depts.length} departments, ${brands.length} brands, ${genderOpts.length} gender options`
  );

  const rulesSnap = await db.collection("cadence_rules").get();
  console.log(`Found ${rulesSnap.size} cadence_rules total`);

  let modified = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const ruleDoc of rulesSnap.docs) {
    const rule = ruleDoc.data();
    const ruleId = ruleDoc.id;
    const filters = (rule.target_filters || []) as any[];

    const newFilters: any[] = [];
    let changed = false;

    for (const f of filters) {
      const field = f.field;
      const value = f.value;

      if (field === "department") {
        const matched = findDept(value, depts);
        if (matched) {
          newFilters.push({ ...f, field: "department_key", value: matched.key });
          changed = true;
          console.log(`  [${ruleId}] department:"${value}" → department_key:"${matched.key}"`);
        } else {
          warnings.push(`Rule ${ruleId}: department value "${value}" not found in registry; left unchanged`);
          newFilters.push(f);
        }
      } else if (field === "brand") {
        const matched = findBrand(value, brands);
        if (matched) {
          newFilters.push({ ...f, field: "brand_key", value: matched.brand_key });
          changed = true;
          console.log(`  [${ruleId}] brand:"${value}" → brand_key:"${matched.brand_key}"`);
        } else {
          warnings.push(`Rule ${ruleId}: brand value "${value}" not found in registry; left unchanged`);
          newFilters.push(f);
        }
      } else if (field === "site_owner") {
        const lc = normalize(value);
        if (lc !== value) {
          newFilters.push({ ...f, value: lc });
          changed = true;
          console.log(`  [${ruleId}] site_owner:"${value}" → "${lc}"`);
        } else {
          newFilters.push(f);
        }
      } else if (field === "gender") {
        const canonical = casefoldGender(value, genderOpts);
        if (canonical && canonical !== value) {
          newFilters.push({ ...f, value: canonical });
          changed = true;
          console.log(`  [${ruleId}] gender:"${value}" → "${canonical}"`);
        } else if (!canonical) {
          warnings.push(`Rule ${ruleId}: gender value "${value}" not found in registry options; left unchanged`);
          newFilters.push(f);
        } else {
          newFilters.push(f);
        }
      } else if (field === "season") {
        // R3 — remove season filters entirely
        changed = true;
        console.log(`  [${ruleId}] season:"${value}" → REMOVED (no source-of-truth, R3)`);
      } else {
        newFilters.push(f);
      }
    }

    if (changed) {
      await ruleDoc.ref.set(
        { target_filters: newFilters, updated_at: ts() },
        { merge: true }
      );
      await db.collection("audit_log").add({
        event_type: "cadence_rule_migrated",
        rule_id: ruleId,
        rule_name: rule.rule_name,
        before: filters,
        after: newFilters,
        reason: "TALLY-138 — harmonize legacy field names + case",
        acting_user_id: "system",
        created_at: ts(),
      });
      modified++;
    } else {
      skipped++;
    }
  }

  console.log(`\n✓ Migration complete: ${modified} modified, ${skipped} unchanged`);
  if (warnings.length > 0) {
    console.log(`\n⚠ ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  ${w}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
