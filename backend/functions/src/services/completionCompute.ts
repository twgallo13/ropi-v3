/**
 * services/completionCompute.ts
 *
 * Pre-computation pattern reference for TALLY-P1 + future
 * domain-compute services (Pillar 2 of TALLY-PRODUCT-LIST-UX).
 *
 * Module structure:
 * - services/<domain>Compute.ts
 * - Exports: compute<Domain>() + stamp<Domain>OnProduct()
 * - Pure helpers (no Firestore) + impure convenience wrappers
 * - Stamp is non-transactional (PO Ruling N 2026-04-23)
 * - Stamp called by HTTP route handlers only, never services
 *   (PO Ruling 2026-04-23 architectural rule)
 * - Field naming per-domain, not forced <domain>_ prefix
 * - warning_count / warning semantics defined per-domain
 */

import admin from "firebase-admin";
import { mpnToDocId, docIdToMpn } from "./mpnUtils";
import { checkHighPriorityFlag } from "./launchHighPriority";
import { getWeekKey } from "./executiveProjections";

// ────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────

export interface RequiredField {
  field_key: string;
  display_label: string;
  depends_on?: { field: string; value: string } | null;
}

export interface AttributeValueLike {
  id: string;
  value: unknown;
  verification_state?: string | null;
  origin_type?: string | null;
}

/** Backward-compatible payload shape returned to the existing UI. */
export interface CompletionProgress {
  total_required: number;
  completed: number;
  pct: number;
  blockers: string[];
}

/** Extended pure-inner result (carries every field downstream callers need). */
export interface CompletionInner {
  percent: number;
  present: string[];
  missing: string[];
  blockers: string[];
  /** field_keys of attribute_values that are AI-origin and not Human-Verified. */
  ai_blockers: string[];
}

/** The 6-field stamp payload (TALLY-P1 + TALLY-3.8-C — Blueprint 11.4-R01). */
export interface CompletionResult {
  completion_percent: number;
  blocker_count: number;
  ai_blocker_count: number;
  next_action_hint: string;
  // Server timestamp sentinel — Firestore stamps the actual time on write.
  completion_last_computed_at: admin.firestore.FieldValue;
  completion_state: "complete" | "incomplete";
}

/** Optional user/system context for auto-pilot stamp side-effects and audit logging. */
export interface StampContext {
  uid?: string;
  displayName?: string;
  productData?: { department?: string; category?: string | null };
}

// ────────────────────────────────────────────────
//  Pure helpers (no Firestore)
// ────────────────────────────────────────────────

/**
 * Pure: extract the required-field list from an attribute_registry snapshot.
 *
 * NOTE on signature deviation from dispatch (returns RequiredField[] not
 * string[]): callers need the display_label to build human-readable blocker
 * messages and the next_action_hint. Returning the richer shape keeps the
 * pure boundary while preserving label fidelity.
 */
export function getRequiredFieldKeysPure(
  attributeRegistrySnap: { docs: Array<{ id: string; data: () => any }> }
): RequiredField[] {
  return attributeRegistrySnap.docs.map((d) => ({
    field_key: d.id,
    display_label: d.data().display_label || d.id,
    depends_on: (d.data().depends_on as { field: string; value: string }) ?? null,
  }));
}

/**
 * Pure: compute completion progress from required fields + attribute_values.
 *
 * Inputs are plain objects (no Firestore): callers convert their snapshots
 * to AttributeValueLike[] before invoking this.
 */
export function computeCompletionProgressPure(
  required: RequiredField[],
  attributeValues: AttributeValueLike[]
): CompletionInner {
  const attrMap = new Map<string, AttributeValueLike>();
  for (const av of attributeValues) {
    if (av.id !== "source_inputs") attrMap.set(av.id, av);
  }

  const present: string[] = [];
  const missing: string[] = [];
  const blockers: string[] = [];
  let completed = 0;
  let effectiveTotal = 0; // fields whose depends_on predicates are met

  for (const rf of required) {
    // depends_on gate: skip field if its predicate is not met
    if (rf.depends_on) {
      const depAttr = attrMap.get(rf.depends_on.field);
      const depValue = depAttr ? String(depAttr.value ?? "") : "";
      if (depValue !== rf.depends_on.value) {
        continue; // predicate not met — field not required in this context
      }
    }
    effectiveTotal++;
    const attr = attrMap.get(rf.field_key);
    const hasValue =
      attr &&
      attr.value !== undefined &&
      attr.value !== null &&
      attr.value !== "";

    if (hasValue) {
      const isVerified =
        attr!.verification_state === "Human-Verified" ||
        attr!.verification_state === "Rule-Verified";
      if (isVerified) {
        completed++;
        present.push(rf.field_key);
      } else {
        missing.push(rf.field_key);
        blockers.push(`${rf.display_label} must be verified`);
      }
    } else {
      missing.push(rf.field_key);
      blockers.push(`${rf.display_label} is required`);
    }
  }

  // ai_blockers per PO Ruling N1 2026-04-23: count of attribute_values where
  // origin_type === "AI" AND verification_state !== "Human-Verified".
  // This is a separate scan from required-field gating — an AI-origin field
  // can be "AI blocker" even if it isn't on the required list.
  const ai_blockers: string[] = [];
  for (const av of attributeValues) {
    if (av.id === "source_inputs") continue;
    if (av.origin_type === "AI" && av.verification_state !== "Human-Verified") {
      ai_blockers.push(av.id);
    }
  }

  const total = effectiveTotal;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 100;

  return { percent, present, missing, blockers, ai_blockers };
}

/**
 * Pure: build the next_action_hint string per dispatch prioritization.
 *   1. AI blockers present → "Approve AI content: <field>"
 *   2. Else missing required → "Fill <field>"
 *   3. Else → ""
 */
export function buildNextActionHintPure(
  inner: CompletionInner,
  required: RequiredField[]
): string {
  if (inner.ai_blockers.length > 0) {
    return `Approve AI content: ${inner.ai_blockers[0]}`;
  }
  if (inner.missing.length > 0) {
    const firstKey = inner.missing[0];
    const rf = required.find((r) => r.field_key === firstKey);
    const label = rf ? rf.display_label : firstKey;
    return `Fill ${label}`;
  }
  return "";
}

// ────────────────────────────────────────────────
//  Impure convenience wrappers (read Firestore)
// ────────────────────────────────────────────────

/** Convenience: load required fields from attribute_registry. */
export async function getRequiredFieldKeys(
  firestore: admin.firestore.Firestore
): Promise<RequiredField[]> {
  const snap = await firestore
    .collection("attribute_registry")
    .where("required_for_completion", "==", true)
    .get();
  return getRequiredFieldKeysPure(snap);
}

/**
 * Convenience: legacy 3-arg signature preserved for in-file products.ts call
 * sites (list + detail handlers fetch requiredFields once and pass it per row).
 *
 * Returns the back-compat CompletionProgress payload (kept additive per PO
 * Ruling N4 2026-04-23 — frontend completion_progress consumers unchanged).
 */
export async function computeCompletionProgress(
  firestore: admin.firestore.Firestore,
  docId: string,
  requiredFields: RequiredField[]
): Promise<CompletionProgress> {
  const avSnap = await firestore
    .collection("products")
    .doc(docId)
    .collection("attribute_values")
    .get();

  const avList: AttributeValueLike[] = avSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      value: data.value,
      verification_state: data.verification_state ?? null,
      origin_type: data.origin_type ?? null,
    };
  });

  const inner = computeCompletionProgressPure(requiredFields, avList);
  return {
    total_required: requiredFields.length,
    completed: inner.present.length,
    pct: inner.percent,
    blockers: inner.blockers,
  };
}

/**
 * Compute the 5-field projection for a product. Loads attribute_registry +
 * attribute_values, runs pure compute, returns the stamp payload.
 *
 * Called by HTTP route handlers only (per PO Ruling 2026-04-23 architectural
 * rule). Services do their work; callers at HTTP boundary stamp.
 */
export async function computeCompletion(mpn: string): Promise<CompletionResult> {
  const firestore = admin.firestore();
  const docId = mpnToDocId(mpn);

  const [registrySnap, avSnap] = await Promise.all([
    firestore
      .collection("attribute_registry")
      .where("required_for_completion", "==", true)
      .get(),
    firestore
      .collection("products")
      .doc(docId)
      .collection("attribute_values")
      .get(),
  ]);

  const required = getRequiredFieldKeysPure(registrySnap);
  const avList: AttributeValueLike[] = avSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      value: data.value,
      verification_state: data.verification_state ?? null,
      origin_type: data.origin_type ?? null,
    };
  });

  const inner = computeCompletionProgressPure(required, avList);
  const next_action_hint = buildNextActionHintPure(inner, required);

  const completion_state: "complete" | "incomplete" =
    inner.percent === 100 && inner.missing.length === 0 ? "complete" : "incomplete";

  return {
    completion_percent: inner.percent,
    blocker_count: inner.missing.length,
    ai_blocker_count: inner.ai_blockers.length,
    next_action_hint,
    completion_last_computed_at:
      admin.firestore.FieldValue.serverTimestamp(),
    completion_state,
  };
}

/**
 * Stamp completion fields onto products/{docId}.
 *
 * Reads current state first for transition detection (auto-pilot pattern).
 * On transition, writes an audit_log entry. On incomplete→complete promotion,
 * also fires operator_throughput and checkHighPriorityFlag (fire-and-forget).
 *
 * Best-effort, non-transactional (PO Ruling N 2026-04-23 — NO tx parameter).
 * Uses set with merge:true so the write is purely additive.
 */
export async function stampCompletionOnProduct(
  productRef: admin.firestore.DocumentReference,
  computeResult: CompletionResult,
  opts?: { context?: StampContext }
): Promise<void> {
  // Read current state for transition detection.
  const currentSnap = await productRef.get();
  const oldState: string | null = currentSnap.exists
    ? (currentSnap.data()?.completion_state ?? null)
    : null;
  const newState = computeResult.completion_state;

  await productRef.set(
    {
      completion_percent: computeResult.completion_percent,
      blocker_count: computeResult.blocker_count,
      ai_blocker_count: computeResult.ai_blocker_count,
      next_action_hint: computeResult.next_action_hint,
      completion_last_computed_at: computeResult.completion_last_computed_at,
      completion_state: newState,
    },
    { merge: true }
  );

  // Audit log on state transition.
  if (oldState !== null && oldState !== newState) {
    productRef.firestore
      .collection("audit_log")
      .add({
        entity_type: "product",
        entity_id: productRef.id,
        event_type: "completion_state.changed",
        old_value: oldState,
        new_value: newState,
        changed_by: opts?.context?.uid ?? "system",
        changed_at: admin.firestore.FieldValue.serverTimestamp(),
      })
      .catch((e: Error) =>
        console.warn("audit_log write failed", { err: e.message })
      );
  }

  // Side-effects on incomplete → complete promotion.
  if (oldState !== "complete" && newState === "complete") {
    const mpn = docIdToMpn(productRef.id);
    checkHighPriorityFlag(mpn).catch((e: Error) =>
      console.error("checkHighPriorityFlag failed:", e.message)
    );
    productRef.firestore
      .collection("operator_throughput")
      .add({
        operator_uid: opts?.context?.uid ?? "system",
        operator_name: opts?.context?.displayName ?? "system",
        mpn,
        department: opts?.context?.productData?.department ?? "Unknown",
        category: opts?.context?.productData?.category ?? null,
        outcome: "complete",
        completed_at: admin.firestore.FieldValue.serverTimestamp(),
        week_key: getWeekKey(new Date()),
      })
      .catch((e: Error) =>
        console.error("operator_throughput write failed:", e.message)
      );
  }
}
