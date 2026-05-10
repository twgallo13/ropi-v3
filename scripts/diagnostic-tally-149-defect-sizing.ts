/**
 * TALLY-149-DEFECTSIZE — sizes F4 (rule conflict ghost) and F5 (manual
 * assign inert) defects in cadence_assignments. Read-only, paged, projected.
 */
import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

const saKey = process.env.GCP_SA_KEY_DEV;
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath && !saKey) throw new Error("Need credentials");
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
    tally: "TALLY-149-DEFECTSIZE",
    project: "ropi-aoss-dev",
    probed_at: new Date().toISOString(),
  },
  f4_rule_conflict_ghosts: { count: 0, samples: [] as any[] },
  f5_manual_assign_total: { count: 0, samples: [] as any[] },
  f5_manual_assign_no_user: { count: 0, samples: [] as any[] },
  f5_manual_assign_no_recommendation: { count: 0, samples: [] as any[] },
  baseline: { total_assigned: 0, total_in_queue: 0 },
};

const PAGE_SIZE = 1000;
const SAMPLE_LIMIT = 10;

async function pageThroughAssigned() {
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let q = db.collection("cadence_assignments")
      .where("cadence_state", "==", "assigned")
      .select("mpn", "cadence_state", "conflict", "conflict_rule_ids",
              "in_cadence_review_queue", "recommendation",
              "assigned_user_id", "manual_assignment",
              "manual_assigned_by", "manual_assigned_at", "matched_rule_id")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const d = doc.data() as any;
      out.baseline.total_assigned++;
      if (d.in_cadence_review_queue === true) out.baseline.total_in_queue++;

      if (d.conflict === true && d.assigned_user_id == null) {
        out.f4_rule_conflict_ghosts.count++;
        if (out.f4_rule_conflict_ghosts.samples.length < SAMPLE_LIMIT) {
          out.f4_rule_conflict_ghosts.samples.push({
            doc_id: doc.id,
            mpn: d.mpn,
            conflict_rule_ids: d.conflict_rule_ids || [],
          });
        }
      }

      if (d.manual_assignment === true) {
        out.f5_manual_assign_total.count++;
        if (out.f5_manual_assign_total.samples.length < SAMPLE_LIMIT) {
          out.f5_manual_assign_total.samples.push({
            doc_id: doc.id,
            mpn: d.mpn,
            manual_assigned_by: d.manual_assigned_by ?? null,
            manual_assigned_at: d.manual_assigned_at ?? null,
            has_assigned_user_id: d.assigned_user_id != null,
            has_recommendation: d.recommendation != null,
            in_review_queue: d.in_cadence_review_queue === true,
            matched_rule_id: d.matched_rule_id ?? null,
          });
        }
        if (d.assigned_user_id == null) {
          out.f5_manual_assign_no_user.count++;
          if (out.f5_manual_assign_no_user.samples.length < SAMPLE_LIMIT) {
            out.f5_manual_assign_no_user.samples.push({ doc_id: doc.id, mpn: d.mpn });
          }
        }
        if (d.recommendation == null) {
          out.f5_manual_assign_no_recommendation.count++;
          if (out.f5_manual_assign_no_recommendation.samples.length < SAMPLE_LIMIT) {
            out.f5_manual_assign_no_recommendation.samples.push({ doc_id: doc.id, mpn: d.mpn });
          }
        }
      }
    }
    if (snap.size < PAGE_SIZE) break;
    lastDoc = snap.docs[snap.size - 1];
  }
}

async function main() {
  console.log("[TALLY-149-DEFECTSIZE] sizing F4 + F5 against ropi-aoss-dev");
  await pageThroughAssigned();
  console.log(`  Total assigned: ${out.baseline.total_assigned}`);
  console.log(`  Total in_review_queue: ${out.baseline.total_in_queue}`);
  console.log(`  F4 rule conflict ghosts: ${out.f4_rule_conflict_ghosts.count}`);
  console.log(`  F5 manual assign total: ${out.f5_manual_assign_total.count}`);
  console.log(`  F5 manual no assigned_user_id: ${out.f5_manual_assign_no_user.count}`);
  console.log(`  F5 manual no recommendation: ${out.f5_manual_assign_no_recommendation.count}`);

  const outDir = path.resolve("evidence/tally-149");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `defect-sizing-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[TALLY-149-DEFECTSIZE] wrote ${outPath}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
