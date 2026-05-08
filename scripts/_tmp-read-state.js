// Tally-3.8-defect-1 one-shot read script (NOT committed). Reads pricing-related fields.
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: "ropi-aoss-dev" });

const FIELDS = [
  "rics_retail",
  "rics_offer",
  "scom",
  "scom_sale",
  "pricing_domain_state",
  "is_loss_leader",
  "is_web_sale_store_full",
  "is_store_sale_web_full",
  "loss_leader_payload",
  "loss_leader_flagged_at",
  "discrepancy_reasons",
  "discrepancy_flagged_at",
];

(async () => {
  const mpns = process.argv.slice(2);
  if (!mpns.length) {
    console.error("usage: read-state.js <mpn> [<mpn> ...]");
    process.exit(1);
  }
  const fs = admin.firestore();
  for (const mpn of mpns) {
    const docId = mpn.replace(/\//g, "__");
    const snap = await fs.collection("products").doc(docId).get();
    if (!snap.exists) {
      console.log(JSON.stringify({ mpn, exists: false }, null, 2));
      continue;
    }
    const d = snap.data();
    const out = { mpn, docId };
    for (const f of FIELDS) out[f] = d[f] === undefined ? null : d[f];
    console.log(JSON.stringify(out, null, 2));
  }
  process.exit(0);
})();
