/**
 * TALLY-149-LIVESNAPSHOT — read-only live probe of Phase 3.13 baseline state.
 * Captures: cadence_rules (all), users (buyer/head_buyer/owner roles),
 * cadence_assignments aggregates by state and reason, attribute_registry
 * boolean+toggle, brand_registry default_site_owner.
 * Output: evidence/tally-149/live-snapshot-<timestamp>.json
 * No writes. Paged + field-projected per Frink standing rule.
 */
import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

const saKey = process.env.GCP_SA_KEY_DEV;
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath && !saKey) {
  throw new Error("Need GOOGLE_APPLICATION_CREDENTIALS or GCP_SA_KEY_DEV env var");
}
if (saKey) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(saKey)),
    projectId: "ropi-aoss-dev",
  });
} else {
  admin.initializeApp({ projectId: "ropi-aoss-dev" });
}
const db = admin.firestore();
const FieldPath = admin.firestore.FieldPath;

const out: any = {
  meta: {
    tally: "TALLY-149-LIVESNAPSHOT",
    project: "ropi-aoss-dev",
    probed_at: new Date().toISOString(),
  },
};

// §A — cadence_rules (small collection, single .get())
async function probeCadenceRules() {
  const snap = await db.collection("cadence_rules")
    .select("rule_name", "version", "is_active", "owner_buyer_id", "owner_site_owner",
            "priority", "target_filters", "trigger_conditions", "markdown_steps")
    .get();
  const rules: any[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as any;
    const filters = d.target_filters || [];
    rules.push({
      rule_id: doc.id,
      rule_name: d.rule_name,
      version: d.version,
      is_active: d.is_active,
      owner_buyer_id: d.owner_buyer_id,
      owner_site_owner: d.owner_site_owner ?? null,
      has_priority_field: "priority" in d,
      priority_value: d.priority ?? null,
      target_filters: filters,
      trigger_conditions_count: (d.trigger_conditions || []).length,
      markdown_steps_count: (d.markdown_steps || []).length,
      legacy_field_form: filters.some((f: any) =>
        f.field === "department" || f.field === "brand"),
    });
  }
  out.cadence_rules = {
    total: rules.length,
    active: rules.filter(r => r.is_active).length,
    inactive: rules.filter(r => !r.is_active).length,
    with_priority_field: rules.filter(r => r.has_priority_field).length,
    in_legacy_field_form: rules.filter(r => r.legacy_field_form).length,
    rules,
  };
}

// §B — users with portfolios (single in-query, small collection)
async function probeUserPortfolios() {
  const snap = await db.collection("users")
    .where("role", "in", ["buyer", "head_buyer", "owner"])
    .get();
  const users: any[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as any;
    users.push({
      uid: doc.id,
      display_name: d.display_name ?? null,
      email: d.email ?? null,
      role: d.role,
      portfolio_brands: d.portfolio_brands || [],
      portfolio_depts: d.portfolio_depts || [],
      portfolio_sites: d.portfolio_sites || [],
      portfolio_age_groups: d.portfolio_age_groups || [],
      portfolio_gender: d.portfolio_gender || [],
      portfolio_exclusions: d.portfolio_exclusions || {},
      has_portfolio_attributes: "portfolio_attributes" in d,
    });
  }
  out.users_portfolios = {
    total: users.length,
    by_role: {
      buyer: users.filter(u => u.role === "buyer").length,
      head_buyer: users.filter(u => u.role === "head_buyer").length,
      owner: users.filter(u => u.role === "owner").length,
    },
    users,
  };
}

// §C — cadence_assignments aggregate (paged + projected, page size 1000)
async function probeCadenceAssignments() {
  const states: Record<string, number> = {};
  const reasonsForUnassigned: Record<string, number> = {};
  const assignedByUser: Record<string, number> = {};
  let totalCount = 0;
  let inQueueCount = 0;
  const PAGE_SIZE = 1000;
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let q = db.collection("cadence_assignments")
      .select("cadence_state", "unassigned_reason", "assigned_user_id", "in_cadence_review_queue")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const d = doc.data() as any;
      const state = d.cadence_state ?? "null";
      states[state] = (states[state] || 0) + 1;
      totalCount++;
      if (state === "unassigned") {
        const reason = d.unassigned_reason ?? "null";
        reasonsForUnassigned[reason] = (reasonsForUnassigned[reason] || 0) + 1;
      }
      if (state === "assigned" && d.assigned_user_id) {
        assignedByUser[d.assigned_user_id] = (assignedByUser[d.assigned_user_id] || 0) + 1;
      }
      if (d.in_cadence_review_queue === true) inQueueCount++;
    }
    if (snap.size < PAGE_SIZE) break;
    lastDoc = snap.docs[snap.size - 1];
  }
  out.cadence_assignments = {
    total: totalCount,
    by_state: states,
    unassigned_by_reason: reasonsForUnassigned,
    assigned_by_user_count: assignedByUser,
    in_review_queue_count: inQueueCount,
  };
}

// §D — attribute_registry boolean + toggle (F7 amendment: in-query both types)
async function probeAttributeRegistry() {
  const snap = await db.collection("attribute_registry")
    .where("field_type", "in", ["boolean", "toggle"])
    .select("field_key", "field_type", "active", "display_label",
            "destination_tab", "display_group", "depends_on", "include_in_cadence")
    .get();
  const fields: any[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as any;
    fields.push({
      field_id: doc.id,
      field_key: d.field_key,
      field_type: d.field_type,
      active: d.active,
      display_label: d.display_label ?? null,
      destination_tab: d.destination_tab ?? null,
      display_group: d.display_group ?? null,
      depends_on: d.depends_on ?? null,
      include_in_cadence: d.include_in_cadence ?? null,
    });
  }
  out.attribute_registry_toggles = {
    total: fields.length,
    by_type: {
      boolean: fields.filter(f => f.field_type === "boolean").length,
      toggle: fields.filter(f => f.field_type === "toggle").length,
    },
    is_fast_fashion_present: fields.some(f => f.field_key === "is_fast_fashion"),
    fields,
  };
}

// §E — brand_registry default_site_owner + Jordan duplicate check (F11)
async function probeBrandRegistry() {
  const snap = await db.collection("brand_registry")
    .where("is_active", "==", true)
    .select("brand_key", "display_name", "default_site_owner",
            "is_active", "po_confirmed", "aliases")
    .get();
  const brands: any[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as any;
    brands.push({
      doc_id: doc.id,
      brand_key: d.brand_key ?? null,
      display_name: d.display_name ?? null,
      default_site_owner: d.default_site_owner ?? null,
      po_confirmed: d.po_confirmed ?? null,
      aliases: d.aliases || [],
    });
  }
  const new_era = brands.find(b => b.brand_key === "new_era" || b.doc_id === "new_era") ?? null;
  const pro_standard = brands.find(b => b.brand_key === "pro_standard" || b.doc_id === "pro_standard") ?? null;
  const jordan_dups = brands.filter(b =>
    b.display_name === "Jordan" || b.brand_key === "jordan" || b.brand_key === "brand_jordan" || b.doc_id === "brand_jordan");
  out.brand_registry = {
    total_active: brands.length,
    with_default_site_owner: brands.filter(b => b.default_site_owner).length,
    without_default_site_owner: brands.filter(b => !b.default_site_owner).length,
    new_era,
    pro_standard,
    jordan_duplicate_check: jordan_dups,
    jordan_duplicate_present: jordan_dups.length > 1,
    by_default_site_owner: brands.reduce((acc: Record<string, number>, b) => {
      const k = b.default_site_owner ?? "(null)";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  };
}

async function main() {
  console.log("[TALLY-149-LIVESNAPSHOT] starting probes against ropi-aoss-dev");
  await probeCadenceRules();
  console.log(`  §A cadence_rules: ${out.cadence_rules.total} total (${out.cadence_rules.active} active)`);
  await probeUserPortfolios();
  console.log(`  §B users: ${out.users_portfolios.total} portfolio-bearing`);
  await probeCadenceAssignments();
  console.log(`  §C cadence_assignments: ${out.cadence_assignments.total} total`);
  await probeAttributeRegistry();
  console.log(`  §D attribute_registry toggles: ${out.attribute_registry_toggles.total}`);
  await probeBrandRegistry();
  console.log(`  §E brand_registry: ${out.brand_registry.total_active} active`);

  const outDir = path.resolve("evidence/tally-149");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `live-snapshot-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[TALLY-149-LIVESNAPSHOT] wrote ${outPath}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
