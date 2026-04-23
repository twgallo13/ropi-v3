"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyStaleness = classifyStaleness;
exports.refreshStalenessFlagsDaily = refreshStalenessFlagsDaily;
/**
 * stalenessRefresh — TALLY-DEPLOY-BACKFILL Phase 2, Option B (PO ruling 2026-04-23).
 *
 * Daily job for the "Lifecycle daily refresh" (Blueprint §9.16).
 *
 * Behavior — explicitly Option B (staleness-flag sweep only):
 *   a) Call computeNeglectedInventory() to refresh the neglect projection.
 *   b) Sweep products and update *only* the cadence-age and staleness-
 *      indicator fields. NO rule re-evaluation. NO state transitions.
 *      NO write-amplification.
 *   c) Stamp admin_settings/system_health.last_staleness_refresh_at.
 *   d) Return a structured summary.
 *
 * NEVER calls runCadenceEvaluation(). Heavy cadence work stays on the Weekly
 * Operations Import per PO ruling.
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const executiveProjections_1 = require("./executiveProjections");
const db = () => firebase_admin_1.default.firestore();
const MS_PER_DAY = 86400000;
/** Threshold defaults; overridable per-product loop with admin_settings reads if needed. */
const FRESH_DAYS = 14; // <14 days since last touch → fresh
const AGING_DAYS = 30; // 14..29 → aging
const STALE_DAYS = 60; // 30..59 → stale, ≥60 → neglected
function classifyStaleness(daysSinceTouch) {
    if (daysSinceTouch < FRESH_DAYS)
        return "fresh";
    if (daysSinceTouch < AGING_DAYS)
        return "aging";
    if (daysSinceTouch < STALE_DAYS)
        return "stale";
    return "neglected";
}
function toMillis(v) {
    if (!v)
        return null;
    if (typeof v.toMillis === "function")
        return v.toMillis();
    if (v instanceof Date)
        return v.getTime();
    return null;
}
/**
 * Daily staleness sweep. Read-mostly: only writes a product when at least one
 * of (cadence_age_days, staleness_indicator) actually changed, to avoid
 * write-amplification on a 100k-product catalog.
 */
async function refreshStalenessFlagsDaily() {
    const startedAtMs = Date.now();
    const startedAtIso = new Date(startedAtMs).toISOString();
    // (a) Refresh the neglect projection. Hard-failure here is reported in the
    // result; we still continue with the sweep so partial recovery is possible.
    let neglectWritten = false;
    try {
        await (0, executiveProjections_1.computeNeglectedInventory)();
        neglectWritten = true;
    }
    catch (err) {
        console.error("refreshStalenessFlagsDaily: computeNeglectedInventory failed:", err?.message || err);
    }
    // (b) Stream-and-batch sweep. No cadence rule reads, no state transitions.
    let swept = 0;
    let updated = 0;
    const BATCH_LIMIT = 400; // Firestore hard limit is 500 ops; leave headroom.
    let batch = db().batch();
    let batchOps = 0;
    await new Promise((resolve, reject) => {
        const stream = db()
            .collection("products")
            .where("completion_state", "==", "complete")
            .stream();
        stream.on("data", async (doc) => {
            try {
                swept++;
                const p = doc.data();
                const firstReceivedMs = toMillis(p.first_received_at);
                if (firstReceivedMs == null)
                    return;
                const lastTouchMs = toMillis(p.last_modified_at) ?? firstReceivedMs;
                const now = Date.now();
                const cadenceAgeDays = Math.floor((now - firstReceivedMs) / MS_PER_DAY);
                const daysSinceTouch = Math.floor((now - lastTouchMs) / MS_PER_DAY);
                const indicator = classifyStaleness(daysSinceTouch);
                const prevAge = typeof p.cadence_age_days === "number" ? p.cadence_age_days : null;
                const prevInd = typeof p.staleness_indicator === "string" ? p.staleness_indicator : null;
                if (prevAge === cadenceAgeDays && prevInd === indicator)
                    return;
                batch.set(doc.ref, {
                    cadence_age_days: cadenceAgeDays,
                    staleness_indicator: indicator,
                    staleness_refreshed_at: firestore_1.FieldValue.serverTimestamp(),
                }, { merge: true });
                batchOps++;
                updated++;
                if (batchOps >= BATCH_LIMIT) {
                    // Pause the stream while we flush, then resume.
                    stream.pause();
                    const toCommit = batch;
                    batch = db().batch();
                    batchOps = 0;
                    toCommit
                        .commit()
                        .then(() => stream.resume())
                        .catch((commitErr) => {
                        stream.emit("error", commitErr);
                    });
                }
            }
            catch (innerErr) {
                // Per-product failure must not abort the sweep.
                console.error("refreshStalenessFlagsDaily: per-product error:", innerErr?.message || innerErr);
            }
        });
        stream.on("end", () => resolve());
        stream.on("error", (err) => reject(err));
    });
    if (batchOps > 0) {
        await batch.commit();
    }
    // (c) Stamp system_health under admin_settings.
    await db()
        .collection("admin_settings")
        .doc("system_health")
        .set({
        last_staleness_refresh_at: firestore_1.FieldValue.serverTimestamp(),
        last_staleness_refresh_summary: {
            products_swept: swept,
            products_updated: updated,
            neglect_doc_written: neglectWritten,
            started_at: startedAtIso,
        },
    }, { merge: true });
    const finishedAtMs = Date.now();
    return {
        products_swept: swept,
        products_updated: updated,
        neglect_doc_written: neglectWritten,
        duration_ms: finishedAtMs - startedAtMs,
        started_at: startedAtIso,
        finished_at: new Date(finishedAtMs).toISOString(),
    };
}
//# sourceMappingURL=stalenessRefresh.js.map