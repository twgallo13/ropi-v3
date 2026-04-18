// services/importJobRunner.ts
//
// Helpers that turn each commit handler into an async background job:
//
//   1. respondAsync(res, batch_id)
//        - returns HTTP 202 immediately so the UI can show a progress card
//          while the heavy work continues in the background.
//
//   2. updateProgress(batchId, pct, counters)
//        - throttled write of progress_pct + running counters to
//          import_batches/{batchId}; safe to call from inside row loops.
//
//   3. finishImportJob(batchId, userId, importType, message)
//        - writes a notification row for the bell + leaves the batch doc
//          in its existing status (the route already wrote it).
//
//   4. failImportJob(batchId, errorMessage)
//        - flips the batch to status: 'failed' with an error_message and
//          fires a failure notification.
//
import admin from "firebase-admin";
import type { Response } from "express";

const ts = () => admin.firestore.FieldValue.serverTimestamp();

export function respondAsync(res: Response, batchId: string): void {
  res.status(202).json({
    ok: true,
    batch_id: batchId,
    status: "processing",
    message: "Import is processing in the background. You can navigate away.",
  });
}

// Sentinel error thrown by updateProgress / isCancelled when the batch has
// been cancelled by an operator. runInBackground catches this and exits
// silently, leaving the cancelled status doc in place.
export class ImportCancelledError extends Error {
  constructor(public batchId: string) {
    super(`Import ${batchId} was cancelled`);
    this.name = "ImportCancelledError";
  }
}

// Lightweight check — read the doc and throw if the operator cancelled.
// Call this between chunks of expensive work (Firestore reads are cheap).
export async function isCancelled(batchId: string): Promise<boolean> {
  try {
    const snap = await admin.firestore().collection("import_batches").doc(batchId).get();
    return snap.exists && snap.data()?.status === "cancelled";
  } catch {
    return false;
  }
}

// Fire-and-forget the heavy commit body. Errors are caught and the batch
// is marked failed so the UI's progress card surfaces the message.
export function runInBackground(
  batchId: string,
  importType: string,
  body: () => Promise<void>
): void {
  setImmediate(async () => {
    try {
      await body();
    } catch (err: any) {
      if (err instanceof ImportCancelledError) {
        console.log(`[${importType}] background commit cancelled for ${batchId}`);
        return;
      }
      console.error(`[${importType}] background commit error for ${batchId}:`, err);
      try {
        await admin
          .firestore()
          .collection("import_batches")
          .doc(batchId)
          .set(
            {
              status: "failed",
              error_message: err?.message || String(err),
              completed_at: ts(),
            },
            { merge: true }
          );
      } catch (_) {
        /* best effort */
      }
    }
  });
}

// Throttled progress writer — at most one Firestore write per 1500ms per batch.
// Also enforces cancellation: every call reads the current status doc and
// throws ImportCancelledError if the operator cancelled the job. Throws bubble
// up to runInBackground which exits silently.
const lastWriteAt = new Map<string, number>();
export async function updateProgress(
  batchId: string,
  pct: number,
  counters?: { committed?: number; failed?: number; skipped?: number }
): Promise<void> {
  // Cancellation check — bail before writing more progress.
  if (await isCancelled(batchId)) {
    throw new ImportCancelledError(batchId);
  }
  const now = Date.now();
  const last = lastWriteAt.get(batchId) || 0;
  if (now - last < 1500) return;
  lastWriteAt.set(batchId, now);
  const payload: Record<string, any> = {
    progress_pct: Math.max(0, Math.min(100, Math.round(pct))),
  };
  if (counters?.committed !== undefined) payload.committed_rows = counters.committed;
  if (counters?.failed !== undefined) payload.failed_rows = counters.failed;
  if (counters?.skipped !== undefined) payload.skipped_rows = counters.skipped;
  try {
    await admin.firestore().collection("import_batches").doc(batchId).set(payload, { merge: true });
  } catch (_) {
    /* best effort */
  }
}

export async function finishImportJob(
  batchId: string,
  userId: string | null,
  importType: string,
  message: string
): Promise<void> {
  try {
    await admin.firestore().collection("import_batches").doc(batchId).set(
      { progress_pct: 100 },
      { merge: true }
    );
    if (!userId) return;
    await admin.firestore().collection("notifications").add({
      uid: userId,
      type: "import_complete",
      product_mpn: null,
      message,
      read: false,
      batch_id: batchId,
      import_type: importType,
      created_at: ts(),
    });
  } catch (err) {
    console.error("finishImportJob notification failed:", err);
  }
}

export async function failImportJob(
  batchId: string,
  userId: string | null,
  importType: string,
  errorMessage: string
): Promise<void> {
  try {
    await admin.firestore().collection("import_batches").doc(batchId).set(
      {
        status: "failed",
        error_message: errorMessage,
        completed_at: ts(),
      },
      { merge: true }
    );
    if (!userId) return;
    await admin.firestore().collection("notifications").add({
      uid: userId,
      type: "import_failed",
      product_mpn: null,
      message: `${importType} import failed: ${errorMessage}`,
      read: false,
      batch_id: batchId,
      import_type: importType,
      created_at: ts(),
    });
  } catch (err) {
    console.error("failImportJob write failed:", err);
  }
}
