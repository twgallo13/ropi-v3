/**
 * TALLY-D2B-SMOKE — validate Phase 3.13 cockpit query patterns against live dev.
 * Three buyer perspectives via direct Firestore queries (bypasses FE/auth layer).
 * Read-only. Output: evidence/tally-d2b/smoke-<ts>.json
 */
import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

const saKey = process.env.GCP_SA_KEY_DEV;
if (!saKey) throw new Error("GCP_SA_KEY_DEV env var required");
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(saKey)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

// UIDs from TALLY-D2A.5 smoke (c)
const USERS = {
  alex:    { uid: "uhD2yj4LK5XDgU2IUjmpYtbGmYd2", role: "buyer",      label: "Alex" },
  heather: { uid: "luIV6eMbZZRWYv7mJqg3F7UJ8Hl1", role: "buyer",      label: "Heather" },
  mike:    { uid: "njIY4yyVSIUhchVe78g7BVN0Bx72", role: "head_buyer", label: "Mike" },
  shiekh:  { uid: "JIevp8ZsEySXxL7NJelrS9LevZJ3", role: "owner",      label: "Shiekh" },
};

async function queryPortfolioPath(uid: string) {
  const [primary, support] = await Promise.all([
    db.collection("cadence_assignments")
      .where("primary_user_id", "==", uid)
      .where("in_cadence_review_queue", "==", true).get(),
    db.collection("cadence_assignments")
      .where("support_user_ids", "array-contains", uid)
      .where("in_cadence_review_queue", "==", true).get(),
  ]);
  // Dedup by doc id (defensive; primary/support should be mutually exclusive)
  const seen = new Set<string>();
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const d of [...primary.docs, ...support.docs]) {
    if (!seen.has(d.id)) { seen.add(d.id); docs.push(d); }
  }
  return {
    primary_count: primary.size,
    support_count: support.size,
    union_unique: docs.length,
    sample_assigned: docs
      .filter(d => d.data().cadence_state === "assigned" && d.data().recommendation)
      .slice(0, 3)
      .map(d => ({
        mpn: d.data().mpn,
        primary_user_id: d.data().primary_user_id ?? null,
        support_user_ids: d.data().support_user_ids ?? [],
      })),
  };
}

async function queryAdminPath() {
  const snap = await db.collection("cadence_assignments")
    .where("in_cadence_review_queue", "==", true).get();
  const stateBreakdown: Record<string, number> = {};
  let withPrimaryUserId = 0;
  for (const d of snap.docs) {
    const a = d.data();
    stateBreakdown[a.cadence_state || "null"] = (stateBreakdown[a.cadence_state || "null"] || 0) + 1;
    if (a.primary_user_id) withPrimaryUserId++;
  }
  return {
    total_in_queue: snap.size,
    by_state: stateBreakdown,
    with_primary_user_id: withPrimaryUserId,
    without_primary_user_id: snap.size - withPrimaryUserId,
  };
}

async function main() {
  const out: any = {
    meta: {
      tally: "TALLY-D2B-SMOKE",
      probed_at: new Date().toISOString(),
      cloud_run_rev: "ropi-aoss-api-00200-zdq",
      merge_sha: "3c7c7fc",
    },
  };

  console.log("[TALLY-D2B-SMOKE] querying Alex (buyer, has known D2A assignment)...");
  out.alex = await queryPortfolioPath(USERS.alex.uid);
  console.log(`  Alex: primary=${out.alex.primary_count}, support=${out.alex.support_count}`);

  console.log("[TALLY-D2B-SMOKE] querying Heather (buyer)...");
  out.heather = await queryPortfolioPath(USERS.heather.uid);
  console.log(`  Heather: primary=${out.heather.primary_count}, support=${out.heather.support_count}`);

  console.log("[TALLY-D2B-SMOKE] querying Shiekh (owner, post-Option B)...");
  out.shiekh = await queryPortfolioPath(USERS.shiekh.uid);
  console.log(`  Shiekh: primary=${out.shiekh.primary_count}, support=${out.shiekh.support_count}`);

  console.log("[TALLY-D2B-SMOKE] querying admin path (Mike's view, full sweep)...");
  out.admin_path = await queryAdminPath();
  console.log(`  Admin: total_in_queue=${out.admin_path.total_in_queue}, with_primary=${out.admin_path.with_primary_user_id}, without=${out.admin_path.without_primary_user_id}`);

  const outDir = path.resolve("evidence/tally-d2b");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `smoke-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[TALLY-D2B-SMOKE] wrote ${outPath}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
