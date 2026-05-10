/**
 * TALLY-D3-B — portfolio encode for 4 admin users per PO ruling 2026-05-10.
 * Run modes:
 *   npx tsx scripts/d3b-encode-portfolios.ts          → dry-run (default)
 *   npx tsx scripts/d3b-encode-portfolios.ts --commit → writes + audit_log
 * Required env: GCP_SA_KEY_DEV (raw SA JSON, same pattern as TALLY-D2D probe).
 */

import admin from "firebase-admin";

const sa = JSON.parse(process.env.GCP_SA_KEY_DEV || "{}");
if (!sa.project_id) {
  console.error("ERROR: GCP_SA_KEY_DEV not set");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const COMMIT = process.argv.includes("--commit");

const TARGETS: Array<{
  uid: string;
  name: string;
  role: string;
  portfolio: Record<string, unknown>;
}> = [
  {
    uid: "uhD2yj4LK5XDgU2IUjmpYtbGmYd2",
    name: "Alex",
    role: "buyer",
    portfolio: {
      portfolio_brands: [],
      portfolio_depts: ["footwear"],
      portfolio_sites: [],
      portfolio_age_groups: [],
      portfolio_gender: ["Mens", "Boys", "Girls", "Kids"],
      portfolio_attributes: {},
      portfolio_exclusions: null,
    },
  },
  {
    uid: "luIV6eMbZZRWYv7mJqg3F7UJ8Hl1",
    name: "Heather",
    role: "buyer",
    portfolio: {
      portfolio_brands: [],
      portfolio_depts: ["footwear", "clothing", "accessories"],
      portfolio_sites: [],
      portfolio_age_groups: [],
      portfolio_gender: ["Womens"],
      portfolio_attributes: {},
      portfolio_exclusions: {
        age_group: ["Kids", "Toddler", "Grade-School", "Pre-School", "Infant"],
      },
    },
  },
  {
    uid: "njIY4yyVSIUhchVe78g7BVN0Bx72",
    name: "Mike",
    role: "head_buyer",
    portfolio: {
      portfolio_brands: ["new_era", "pro_standard"],
      portfolio_depts: [],
      portfolio_sites: [],
      portfolio_age_groups: [],
      portfolio_gender: [],
      portfolio_attributes: {},
      portfolio_exclusions: null,
    },
  },
  {
    uid: "JIevp8ZsEySXxL7NJelrS9LevZJ3",
    name: "Shiekh",
    role: "owner",
    portfolio: {
      portfolio_brands: [],
      portfolio_depts: ["footwear"],
      portfolio_sites: [],
      portfolio_age_groups: [],
      portfolio_gender: ["Womens"],
      portfolio_attributes: { is_fast_fashion: true },
      portfolio_exclusions: null,
    },
  },
];

function extractBefore(data: any): Record<string, unknown> {
  const keys = [
    "portfolio_brands",
    "portfolio_depts",
    "portfolio_sites",
    "portfolio_age_groups",
    "portfolio_gender",
    "portfolio_attributes",
    "portfolio_exclusions",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = data?.[k] ?? null;
  return out;
}

async function preflightGenderRegistry(): Promise<void> {
  // Warn if any portfolio_gender token is not in attribute_registry/gender.dropdown_options.
  // Per PO ruling, write proceeds regardless.
  try {
    const reg = await db.collection("attribute_registry").doc("gender").get();
    const opts = (reg.data()?.dropdown_options || []) as string[];
    const optSet = new Set(opts.map((s) => s.toLowerCase()));
    for (const t of TARGETS) {
      const gender = (t.portfolio.portfolio_gender || []) as string[];
      for (const g of gender) {
        if (!optSet.has(g.toLowerCase())) {
          console.warn(
            `WARNING: ${t.name} portfolio_gender contains "${g}" which is not in attribute_registry/gender.dropdown_options (${opts.join(", ")}). Engine matches by exact string — this token will not match any product. Proceeding per PO ruling.`
          );
        }
      }
    }
  } catch (e: any) {
    console.warn("preflight gender registry check failed (non-fatal):", e.message);
  }
}

async function main() {
  console.log(`MODE: ${COMMIT ? "COMMIT" : "DRY-RUN"}`);
  console.log(`Project: ${sa.project_id}`);
  console.log("");

  await preflightGenderRegistry();

  const summary: Array<{
    uid: string;
    name: string;
    status: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }> = [];

  for (const t of TARGETS) {
    const ref = db.collection("users").doc(t.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      console.error(`ERROR: user ${t.name} (uid ${t.uid}) not found — halting`);
      process.exit(2);
    }
    const data = snap.data();
    if (data?.role !== t.role) {
      console.error(
        `ERROR: user ${t.name} role mismatch — expected "${t.role}", got "${data?.role}". Halting.`
      );
      process.exit(3);
    }
    const before = extractBefore(data);
    const after = { ...t.portfolio };
    summary.push({ uid: t.uid, name: t.name, status: COMMIT ? "will-write" : "dry-run", before, after });
  }

  // Print full diff table before any writes.
  console.log("=== DIFF SUMMARY ===");
  for (const s of summary) {
    console.log(`\n${s.name} (uid ${s.uid})`);
    console.log("  BEFORE:", JSON.stringify(s.before));
    console.log("  AFTER: ", JSON.stringify(s.after));
  }

  if (!COMMIT) {
    console.log("\n=== DRY-RUN ONLY — no writes performed. Re-run with --commit to apply. ===");
    process.exit(0);
  }

  console.log("\n=== COMMITTING WRITES ===");
  for (const s of summary) {
    const ref = db.collection("users").doc(s.uid);
    await ref.set(
      {
        ...s.after,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await db.collection("audit_log").add({
      event_type: "portfolio_encoded",
      acting_user_id: "system:tally-d3-b",
      affected_user_id: s.uid,
      affected_user_name: s.name,
      before: s.before,
      after: s.after,
      tally: "TALLY-D3-B",
      reason: "TALLY-D3-B — portfolio overwrite per PO ruling 2026-05-10",
      created_at: FieldValue.serverTimestamp(),
    });
    console.log(`  ✓ ${s.name} — portfolio + audit_log written`);
  }

  console.log("\n=== COMPLETE — 4 users encoded ===");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
