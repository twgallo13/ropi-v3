/**
 * Internal Jobs Router — TALLY-DEPLOY-BACKFILL Phase 2
 *
 * Routes invoked exclusively by Cloud Scheduler via OIDC. Mounted at
 * /api/v1/internal/jobs and gated by requireSchedulerOIDC ONLY (no
 * requireAuth, no requireRole — those are for human-facing routes).
 *
 *   POST /promote-scheduled        → wraps promoteScheduledItems()
 *   POST /daily-staleness-sweep    → wraps refreshStalenessFlagsDaily() (Option B)
 *   POST /neglected-inventory      → wraps computeNeglectedInventory()
 *   POST /weekly-snapshots         → wraps writeWeeklySnapshots()
 *
 * Each route stamps scheduler provenance so audit/forensics can distinguish
 * scheduler runs from human-triggered admin runs of the same logic.
 */
import { Router, Request, Response } from "express";
import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireSchedulerOIDC } from "../middleware/requireSchedulerOIDC";
import { promoteScheduledItems } from "../services/scheduledPromotion";
import { refreshStalenessFlagsDaily } from "../services/stalenessRefresh";
import {
  computeNeglectedInventory,
  writeWeeklySnapshots,
} from "../services/executiveProjections";

const router = Router();
const db = () => admin.firestore();
const ts = () => FieldValue.serverTimestamp();

// All routes below require a valid scheduler-invoker OIDC token.
router.use(requireSchedulerOIDC);

/** Compact wrapper that records a scheduler run and standardizes errors. */
async function runJob(
  res: Response,
  jobName: string,
  fn: () => Promise<Record<string, unknown>>
): Promise<void> {
  const startedAtMs = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAtMs;
    await db()
      .collection("executive_projections")
      .doc("scheduler_runs")
      .set(
        {
          [jobName]: {
            last_run_at: ts(),
            duration_ms: durationMs,
            ok: true,
            summary: result,
          },
        },
        { merge: true }
      );
    res.status(200).json({ ok: true, job: jobName, duration_ms: durationMs, ...result });
  } catch (err: any) {
    const durationMs = Date.now() - startedAtMs;
    console.error(`internal/jobs/${jobName} failed:`, err?.message || err);
    try {
      await db()
        .collection("executive_projections")
        .doc("scheduler_runs")
        .set(
          {
            [jobName]: {
              last_run_at: ts(),
              duration_ms: durationMs,
              ok: false,
              error: String(err?.message || err),
            },
          },
          { merge: true }
        );
    } catch (provErr: any) {
      console.error(`internal/jobs/${jobName} provenance write failed:`, provErr?.message || provErr);
    }
    res.status(500).json({ ok: false, job: jobName, error: "Job failed." });
  }
}

// ── 1. Export Promotion (cron 55 5 * * * America/Los_Angeles) ──
router.post("/promote-scheduled", async (_req: Request, res: Response) => {
  await runJob(res, "promote_scheduled", async () => {
    const result = await promoteScheduledItems();
    await db().collection("audit_log").add({
      event_type: "scheduled_promotion_automated",
      triggered_by: "scheduler",
      promoted: result.promoted,
      skipped: result.skipped,
      errors: result.errors,
      created_at: ts(),
    });
    return {
      promoted: result.promoted,
      skipped: result.skipped,
      error_count: result.errors.length,
    };
  });
});

// ── 2. Daily Staleness Sweep (cron 0 6 * * * America/Los_Angeles) — Option B ──
router.post("/daily-staleness-sweep", async (_req: Request, res: Response) => {
  await runJob(res, "daily_staleness_sweep", async () => {
    const result = await refreshStalenessFlagsDaily();
    return {
      products_swept: result.products_swept,
      products_updated: result.products_updated,
      neglect_doc_written: result.neglect_doc_written,
      sweep_duration_ms: result.duration_ms,
      started_at: result.started_at,
      finished_at: result.finished_at,
    };
  });
});

// ── 3. Neglected Inventory (cron 0 2 * * * America/Los_Angeles) ──
router.post("/neglected-inventory", async (_req: Request, res: Response) => {
  await runJob(res, "neglected_inventory", async () => {
    const result = await computeNeglectedInventory();
    // Stamp computed_by:"scheduler" provenance on the projection doc.
    await db()
      .collection("executive_projections")
      .doc("neglected_inventory")
      .set(
        {
          computed_by: "scheduler",
          computed_by_stamped_at: ts(),
        },
        { merge: true }
      );
    return { total_count: result.total_count };
  });
});

// ── 4. Weekly Snapshots (cron 0 3 * * MON America/Los_Angeles) ──
router.post("/weekly-snapshots", async (_req: Request, res: Response) => {
  await runJob(res, "weekly_snapshots", async () => {
    const result = await writeWeeklySnapshots();
    // Provenance stamp distinct from the snapshot rows themselves.
    await db()
      .collection("executive_projections")
      .doc("weekly_snapshots_provenance")
      .set(
        {
          last_snapshot_run_at: ts(),
          last_snapshot_run_by: "scheduler",
          last_snapshot_written_count: result.written,
        },
        { merge: true }
      );
    return { written: result.written };
  });
});

export default router;
