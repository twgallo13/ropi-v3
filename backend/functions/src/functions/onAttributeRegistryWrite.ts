/**
 * functions/onAttributeRegistryWrite.ts
 *
 * Firestore-triggered Cloud Function (TALLY-3.8-C — Auto-Pilot Completion).
 *
 * When an attribute_registry document changes its required_for_completion
 * value, recompute completion for every product so completion_state stays
 * consistent without requiring a manual backfill.
 *
 * Deployed via: firebase deploy --only functions
 * Region: us-central1 (default)
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import admin from "firebase-admin";
import { docIdToMpn } from "../services/mpnUtils";
import {
  computeCompletion,
  stampCompletionOnProduct,
} from "../services/completionCompute";

/** Fan-out batch size — keeps individual Promise.all calls manageable. */
const BATCH_SIZE = 25;

export const onAttributeRegistryWrite = onDocumentWritten(
  "attribute_registry/{fieldId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Only trigger fan-out when required_for_completion actually changes.
    const wasRequired = before?.required_for_completion === true;
    const isRequired = after?.required_for_completion === true;
    if (wasRequired === isRequired) return;

    const fieldId = event.params.fieldId;
    console.log(
      `onAttributeRegistryWrite: required_for_completion changed for "${fieldId}" ` +
        `(${wasRequired} → ${isRequired}). Recomputing all products.`
    );

    const firestore = admin.firestore();

    // List all product document references (IDs only, no data fetch).
    const docRefs = await firestore.collection("products").listDocuments();
    if (docRefs.length === 0) return;

    console.log(`Recomputing completion for ${docRefs.length} products…`);

    // Fan-out in batches to avoid Promise.all memory spikes.
    for (let i = 0; i < docRefs.length; i += BATCH_SIZE) {
      const slice = docRefs.slice(i, i + BATCH_SIZE);
      await Promise.all(
        slice.map(async (docRef) => {
          try {
            const mpn = docIdToMpn(docRef.id);
            const result = await computeCompletion(mpn);
            await stampCompletionOnProduct(docRef, result);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`recompute failed for ${docRef.id}:`, msg);
          }
        })
      );
    }

    console.log("onAttributeRegistryWrite: fan-out complete.");
  }
);
