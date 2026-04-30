/**
 * A.4 Q6 — read-only diagnostic for users.departments + site_scope shape
 *
 * Tally: A.4 Q6
 * Purpose: Sample up to 5 docs from ropi-aoss-dev `users` collection and
 *          report the actual shape of `departments` and `site_scope` fields.
 *
 * READ-ONLY. No Firestore writes. No file writes. Stdout only.
 *
 * Auth pattern (mirrors scripts/download-real-csv.js env var + JSON.parse,
 * Firestore init mirrors scripts/diagnostic-registry.js):
 *   - env var: GCP_SA_KEY_DEV (raw JSON string of service account key)
 *   - admin.credential.cert(JSON.parse(...))
 *   - projectId: ropi-aoss-dev
 *
 * Redactions: email, display_name, temp_password values are never printed.
 */

const admin = require("firebase-admin");

const REDACTED_FIELDS = new Set(["email", "display_name", "temp_password"]);

function describeValue(v) {
  if (v === undefined) return { type: "undefined", isArray: false };
  if (v === null) return { type: "null", isArray: false };
  const t = typeof v;
  const isArr = Array.isArray(v);
  const out = { type: t, isArray: isArr };
  if (isArr) out.length = v.length;
  return out;
}

function previewValue(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (Array.isArray(v)) return v.slice(0, 3);
  return v;
}

async function main() {
  const raw = process.env.GCP_SA_KEY_DEV;
  if (!raw) {
    console.error("GCP_SA_KEY_DEV is not set");
    process.exit(1);
  }
  const key = JSON.parse(raw);
  admin.initializeApp({
    credential: admin.credential.cert(key),
    projectId: "ropi-aoss-dev",
  });
  const db = admin.firestore();

  console.log("=== A.4 Q6 diagnostic ===");
  console.log("project: ropi-aoss-dev");
  console.log("collection: users");
  console.log("limit: 5");
  console.log("auth env var: GCP_SA_KEY_DEV");
  console.log("");

  const snap = await db.collection("users").limit(5).get();
  console.log("doc_count:", snap.size);
  console.log("");

  if (snap.size === 0) {
    console.log("STOP: 0 user docs returned (unexpected for dev).");
    return;
  }

  let i = 0;
  snap.forEach((doc) => {
    i++;
    const data = doc.data() || {};
    const allKeys = Object.keys(data).sort();
    const redactedKeysPresent = allKeys.filter((k) => REDACTED_FIELDS.has(k));

    const departments = data.departments;
    const siteScope = data.site_scope;

    const summary = {
      index: i,
      uid: doc.id,
      has_departments: "departments" in data,
      departments_type: describeValue(departments),
      departments_value: previewValue(departments),
      has_site_scope: "site_scope" in data,
      site_scope_type: describeValue(siteScope),
      site_scope_value: previewValue(siteScope),
      all_keys_present: allKeys,
      redacted_fields_present: redactedKeysPresent.map(
        (k) => `${k}=<redacted>`
      ),
    };

    console.log(`--- doc ${i} ---`);
    console.log(JSON.stringify(summary, null, 2));
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  });
