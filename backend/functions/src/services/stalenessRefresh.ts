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
import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { computeNeglectedInventory } from "./executiveProjections";

const db = () => admin.firestore();

const MS_PER_DAY = 86_400_000;

/** Bucket label assigned to product.staleness_indicator. Order matters for thresholds. */
export type StalenessIndicator = "fresh" | "aging" | "stale" | "neglected";

/** Threshold defaults; overridable per-product loop with admin_settings reads if needed. */
const FRESH_DAYS = 14;       // <14 days since last touch → fresh
const AGING_DAYS = 30;       // 14..29 → aging
const STALE_DAYS = 60;       // 30..59 → stale, ≥60 → neglected

export function classifyStaleness(daysSinceTouch: number): StalenessIndicator {
  if (daysSinceTouch < FRESH_DAYS) return "fresh";
  if (daysSinceTouch < AGING_DAYS) return "aging";
  if (daysSinceTouch < STALE_DAYS) return "stale";
  return "neglected";
}

function toMillis(v: any): number | null {
  if (!v) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
}

export interface StalenessRefreshResult {
  products_swept: number;
  products_updated: number;
  neglect_doc_written: boolean;
  duration_ms: number;
  started_at: string;
  finished_at: string;
}

/**
 * Daily staleness sweep. Read-mostly: only writes a product when at least one
 * of (cadence_age_days, staleness_indicator) actually changed, to avoid
 * write-amplification on a 100k-product catalog.
 */
export async function refreshStalenessFlagsDaily(): Promise<StalenessRefreshResult> {
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();

  // (a) Refresh the neglect projection. Hard-failure here is reported in the
  // result; we still continue with the sweep so partial recovery is possible.
  let neglectWritten = false;
  try {
    await computeNeglectedInventory();
    neglectWritten = true;
  } catch (err: any) {
    console.error("refreshStalenessFlagsDaily: computeNeglectedInventory failed:", err?.message || err);
  }

  // (b) Stream-and-batch sweep. No cadence rule reads, no state transitions.
  let swept = 0;
  let updated = 0;
  const BATCH_LIMIT = 400; // Firestore hard limit is 500 ops; leave headroom.
  let batch = db().batch();
  let batchOps = 0;

  await new Promise<void>((resolve, reject) => {
    const stream = db()
      .collection("products")
      .where("completion_state", "==", "complete")
      .stream();

    stream.on("data", async (doc: any) => {
      try {
        swept++;
        const p = doc.data();

        const firstReceivedMs = toMillis(p.first_received_at);
        if (firstReceivedMs == null) return;

        const lastTouchMs = toMillis(p.last_modified_at) ?? firstReceivedMs;
        const now = Date.now();

        const cadenceAgeDays = Math.floor((now - firstReceivedMs) / MS_PER_DAY);
        const daysSinceTouch = Math.floor((now - lastTouchMs) / MS_PER_DAY);
        const indicator = classifyStaleness(daysSinceTouch);

        const prevAge = typeof p.cadence_age_days === "number" ? p.cadence_age_days : null;
        const prevInd = typeof p.staleness_indicator === "string" ? p.staleness_indicator : null;

        if (prevAge === cadenceAgeDays && prevInd === indicator) return;

        batch.set(
          doc.ref,
          {
            cadence_age_days: cadenceAgeDays,
            staleness_indicator: indicator,
            staleness_refreshed_at: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
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
            .catch((commitErr: Error) => {
              stream.emit("error", commitErr);
            });
        }
      } catch (innerErr: any) {
        // Per-product failure must not abort the sweep.
        console.error("refreshStalenessFlagsDaily: per-product error:", innerErr?.message || innerErr);
      }
    });
    stream.on("end", () => resolve());
    stream.on("error", (err: Error) => reject(err));
  });

  if (batchOps > 0) {
    await batch.commit();
  }

  // (c) Stamp system_health under admin_settings.
  await db()
    .collection("admin_settings")
    .doc("system_health")
    .set(
      {
        last_staleness_refresh_at: FieldValue.serverTimestamp(),
        last_staleness_refresh_summary: {
          products_swept: swept,
          products_updated: updated,
          neglect_doc_written: neglectWritten,
          started_at: startedAtIso,
        },
      },
      { merge: true }
    );

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
