/**
 * A.4 audit-emission diagnostic — VQA-period verification
 *
 * Tally: A.4 (post-Matt-VQA verification)
 * Purpose: Read-only verification that all 6 user-mutation audit event types
 *          fired during Matt VQA pass with correct shape per spec §4.2.
 *
 * READ-ONLY. No Firestore writes. No file writes. Stdout only.
 *
 * Auth pattern (mirrors scripts/a4-q6-diagnostic.js):
 *   - env var: GCP_SA_KEY_DEV (raw JSON string of service account key)
 *   - admin.credential.cert(JSON.parse(...))
 *   - projectId: ropi-aoss-dev
 *
 * Redactions: never print field values that look like emails, names, or
 * temp passwords. Print keys + types only when sampling docs.
 *
 * STOP triggers honored:
 *   - Any temp_password field detected in any audit doc → print P0 banner
 *     with offending event_type + doc id (no payload values), continue
 *     iterating remaining types so Lisa sees full footprint.
 *   - 0 audit docs in window → print STOP notice with cutoff timestamp.
 *   - Auth failure → print error verbatim, exit 1, no retry.
 */

const admin = require("firebase-admin");

const EVENT_TYPES = [
  "user_created",
  "user_role_changed",
  "user_profile_updated",
  "user_disabled",
  "user_reenabled",
  "user_password_reset",
];

// Per spec §4.2 — required keys spread to top-level (per spec §4.1 helper).
const REQUIRED_BASE = ["event_type", "target_user_id", "acting_user_id", "created_at"];

const EXPECTED_EXTRA = {
  user_created: ["role", "departments_count", "site_scope_count"],
  user_role_changed: ["old_role", "new_role"],
  user_profile_updated: ["fields_changed"],
  user_disabled: [],
  user_reenabled: [],
  user_password_reset: [],
};

const REDACT_KEYS = new Set([
  "email",
  "display_name",
  "displayName",
  "name",
  "temp_password",
  "tempPassword",
]);

function describe(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (v && typeof v === "object") {
    if (typeof v.toDate === "function" && v._seconds !== undefined) return "Timestamp";
    return "object";
  }
  return typeof v;
}

function isLikelyUid(s) {
  return typeof s === "string" && s.length >= 20 && s.length <= 40;
}

function isFirestoreTimestamp(v) {
  return (
    v &&
    typeof v === "object" &&
    typeof v.toDate === "function" &&
    typeof v._seconds === "number"
  );
}

/**
 * Recursively scan an object for any key matching `temp_password` /
 * `tempPassword` (case-insensitive). Returns array of dot-paths.
 */
function findTempPasswordPaths(obj, prefix = "") {
  const hits = [];
  if (!obj || typeof obj !== "object") return hits;
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    if (lower === "temp_password" || lower === "temppassword") {
      hits.push(prefix ? `${prefix}.${k}` : k);
    }
    if (v && typeof v === "object" && !Array.isArray(v) && !isFirestoreTimestamp(v)) {
      hits.push(...findTempPasswordPaths(v, prefix ? `${prefix}.${k}` : k));
    }
  }
  return hits;
}

function shapeSample(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (REDACT_KEYS.has(k)) {
      out[k] = `<redacted:${describe(v)}>`;
    } else if (Array.isArray(v)) {
      out[k] = `array[${v.length}]`;
    } else if (isFirestoreTimestamp(v)) {
      out[k] = "Timestamp";
    } else if (v && typeof v === "object") {
      out[k] = "object";
    } else {
      out[k] = describe(v);
    }
  }
  return out;
}

async function main() {
  const raw = process.env.GCP_SA_KEY_DEV;
  if (!raw) {
    console.error("GCP_SA_KEY_DEV is not set");
    process.exit(1);
  }
  let key;
  try {
    key = JSON.parse(raw);
  } catch (e) {
    console.error("GCP_SA_KEY_DEV is not valid JSON:", e.message);
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(key),
    projectId: "ropi-aoss-dev",
  });
  const db = admin.firestore();

  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  console.log("=== A.4 audit-emission diagnostic ===");
  console.log("project:        ropi-aoss-dev");
  console.log("collection:     audit_log");
  console.log("auth env var:   GCP_SA_KEY_DEV");
  console.log("now (UTC):      " + now.toISOString());
  console.log("cutoff (UTC):   " + cutoff.toISOString());
  console.log("lookback hours: 24");
  console.log("event_types:    " + EVENT_TYPES.join(", "));
  console.log("");

  // Use 6 simple equality queries (no composite index required) and filter
  // by created_at client-side. Each fetches all docs of that event_type;
  // audit_log volume on dev is low, this is acceptable for a diagnostic.
  const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff);
  const byType = Object.fromEntries(EVENT_TYPES.map((t) => [t, []]));
  let totalInWindow = 0;
  let totalRawFetched = 0;

  for (const t of EVENT_TYPES) {
    let qs;
    try {
      qs = await db.collection("audit_log").where("event_type", "==", t).get();
    } catch (e) {
      console.error("STOP: audit_log query failed for event_type=" + t + ":", e.message);
      process.exit(1);
    }
    totalRawFetched += qs.size;
    qs.forEach((doc) => {
      const data = doc.data() || {};
      const ca = data.created_at;
      if (
        ca &&
        typeof ca === "object" &&
        typeof ca.toDate === "function" &&
        ca.toDate() >= cutoff
      ) {
        byType[t].push({ id: doc.id, data });
        totalInWindow++;
      }
    });
    // Sort newest first for stable sampling
    byType[t].sort((a, b) => {
      const ad = a.data.created_at && a.data.created_at.toDate ? a.data.created_at.toDate().getTime() : 0;
      const bd = b.data.created_at && b.data.created_at.toDate ? b.data.created_at.toDate().getTime() : 0;
      return bd - ad;
    });
  }

  console.log("query_strategy:        per-event-type equality (no composite index)");
  console.log("total_raw_fetched:     " + totalRawFetched);
  console.log("total_docs_in_window:  " + totalInWindow);
  console.log("");

  if (totalInWindow === 0) {
    console.log("STOP: 0 audit docs returned within the 24h window.");
    console.log(
      "Likely causes: (a) Matt VQA not yet executed; (b) audit emission silently failing in handlers (P0)."
    );
    return;
  }

  // P0 leak detection (global pass first; report immediately, but continue to
  // also produce per-type sections so Lisa sees full footprint).
  const leakReports = [];
  for (const t of EVENT_TYPES) {
    for (const { id, data } of byType[t]) {
      const paths = findTempPasswordPaths(data);
      if (paths.length > 0) {
        leakReports.push({ id, event_type: t, paths });
      }
    }
  }
  if (leakReports.length > 0) {
    console.log("############################################################");
    console.log("# P0 SECURITY: temp_password key detected in audit_log docs #");
    console.log("############################################################");
    leakReports.forEach((r) => {
      console.log(
        "  doc_id=" +
          r.id +
          "  event_type=" +
          r.event_type +
          "  key_paths=" +
          r.paths.join(",")
      );
    });
    console.log("(values are NOT printed; refer to doc by id for forensic review)");
    console.log("");
  }

  const verdicts = {};

  for (const eventType of EVENT_TYPES) {
    const docs = byType[eventType];
    console.log("------------------------------------------------------------");
    console.log("event_type: " + eventType);
    console.log("count:      " + docs.length);

    if (docs.length === 0) {
      verdicts[eventType] = "FAIL (0 docs in window)";
      console.log("verdict:    FAIL — no docs of this type in window");
      console.log("");
      continue;
    }

    const expectedExtra = EXPECTED_EXTRA[eventType];
    let allPass = true;
    const checkLog = [];

    docs.forEach(({ id, data }) => {
      const docCheck = { id, fails: [] };

      // Required base fields
      for (const k of REQUIRED_BASE) {
        if (!(k in data)) docCheck.fails.push(`missing_required:${k}`);
      }
      if ("target_user_id" in data && !isLikelyUid(data.target_user_id)) {
        docCheck.fails.push(
          `target_user_id_shape:len=${(data.target_user_id || "").length}`
        );
      }
      if ("acting_user_id" in data && (typeof data.acting_user_id !== "string" || data.acting_user_id.length === 0)) {
        docCheck.fails.push("acting_user_id_not_nonempty_string");
      }
      if ("created_at" in data && !isFirestoreTimestamp(data.created_at)) {
        docCheck.fails.push("created_at_not_Timestamp");
      }

      // temp_password forbidden anywhere (already reported globally too)
      const leaks = findTempPasswordPaths(data);
      if (leaks.length > 0) {
        docCheck.fails.push("temp_password_present:" + leaks.join(","));
      }

      // Per-event extra fields (top-level after spread per spec §4.1 helper).
      for (const k of expectedExtra) {
        if (!(k in data)) docCheck.fails.push(`missing_extra:${k}`);
      }

      if (docCheck.fails.length > 0) allPass = false;
      checkLog.push(docCheck);
    });

    // Sample (first doc) — keys + types only, redacted
    const sample = shapeSample(docs[0].data);
    console.log("sample_shape (first doc, keys+types only, sensitive values redacted):");
    Object.entries(sample)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, v]) => {
        console.log("  " + k + ": " + v);
      });

    const failingDocs = checkLog.filter((c) => c.fails.length > 0);
    if (failingDocs.length === 0) {
      verdicts[eventType] = "PASS";
      console.log("verdict:    PASS (" + docs.length + "/" + docs.length + " docs)");
    } else {
      verdicts[eventType] = `FAIL (${failingDocs.length}/${docs.length} docs)`;
      console.log(
        "verdict:    FAIL (" + failingDocs.length + "/" + docs.length + " docs failed checks)"
      );
      failingDocs.slice(0, 5).forEach((c) => {
        console.log("  doc_id=" + c.id + "  fails=[" + c.fails.join(", ") + "]");
      });
      if (failingDocs.length > 5) {
        console.log("  ... and " + (failingDocs.length - 5) + " more");
      }
    }
    console.log("");
  }

  console.log("============================================================");
  console.log("FINAL VERDICTS");
  console.log("============================================================");
  EVENT_TYPES.forEach((t) => {
    console.log("  " + t.padEnd(25) + " : " + verdicts[t]);
  });
  const overallPass = EVENT_TYPES.every((t) => verdicts[t] === "PASS") && leakReports.length === 0;
  console.log("");
  console.log("OVERALL: " + (overallPass ? "PASS" : "FAIL"));
  if (leakReports.length > 0) {
    console.log("(includes P0 temp_password leak — see banner above)");
  }
}

main().catch((e) => {
  console.error("STOP: unhandled error:", e && e.stack ? e.stack : e);
  process.exit(1);
});
