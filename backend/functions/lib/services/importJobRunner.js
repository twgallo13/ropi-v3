"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.respondAsync = respondAsync;
exports.runInBackground = runInBackground;
exports.updateProgress = updateProgress;
exports.finishImportJob = finishImportJob;
exports.failImportJob = failImportJob;
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
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
function respondAsync(res, batchId) {
    res.status(202).json({
        ok: true,
        batch_id: batchId,
        status: "processing",
        message: "Import is processing in the background. You can navigate away.",
    });
}
// Fire-and-forget the heavy commit body. Errors are caught and the batch
// is marked failed so the UI's progress card surfaces the message.
function runInBackground(batchId, importType, body) {
    setImmediate(async () => {
        try {
            await body();
        }
        catch (err) {
            console.error(`[${importType}] background commit failed for ${batchId}:`, err);
            try {
                await firebase_admin_1.default
                    .firestore()
                    .collection("import_batches")
                    .doc(batchId)
                    .set({
                    status: "failed",
                    error_message: err?.message || String(err),
                    completed_at: ts(),
                }, { merge: true });
            }
            catch (_) {
                /* best effort */
            }
        }
    });
}
// Throttled progress writer — at most one Firestore write per 1500ms per batch.
const lastWriteAt = new Map();
async function updateProgress(batchId, pct, counters) {
    const now = Date.now();
    const last = lastWriteAt.get(batchId) || 0;
    if (now - last < 1500)
        return;
    lastWriteAt.set(batchId, now);
    const payload = {
        progress_pct: Math.max(0, Math.min(100, Math.round(pct))),
    };
    if (counters?.committed !== undefined)
        payload.committed_rows = counters.committed;
    if (counters?.failed !== undefined)
        payload.failed_rows = counters.failed;
    if (counters?.skipped !== undefined)
        payload.skipped_rows = counters.skipped;
    try {
        await firebase_admin_1.default.firestore().collection("import_batches").doc(batchId).set(payload, { merge: true });
    }
    catch (_) {
        /* best effort */
    }
}
async function finishImportJob(batchId, userId, importType, message) {
    try {
        await firebase_admin_1.default.firestore().collection("import_batches").doc(batchId).set({ progress_pct: 100 }, { merge: true });
        if (!userId)
            return;
        await firebase_admin_1.default.firestore().collection("notifications").add({
            uid: userId,
            type: "import_complete",
            product_mpn: null,
            message,
            read: false,
            batch_id: batchId,
            import_type: importType,
            created_at: ts(),
        });
    }
    catch (err) {
        console.error("finishImportJob notification failed:", err);
    }
}
async function failImportJob(batchId, userId, importType, errorMessage) {
    try {
        await firebase_admin_1.default.firestore().collection("import_batches").doc(batchId).set({
            status: "failed",
            error_message: errorMessage,
            completed_at: ts(),
        }, { merge: true });
        if (!userId)
            return;
        await firebase_admin_1.default.firestore().collection("notifications").add({
            uid: userId,
            type: "import_failed",
            product_mpn: null,
            message: `${importType} import failed: ${errorMessage}`,
            read: false,
            batch_id: batchId,
            import_type: importType,
            created_at: ts(),
        });
    }
    catch (err) {
        console.error("failImportJob write failed:", err);
    }
}
//# sourceMappingURL=importJobRunner.js.map