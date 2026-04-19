/**
 * Site Verification staleness helpers — Phase 4.4 §4.4 / §4.4.1.
 *
 * Single source of truth for stale derivation across all site_verification
 * consumers. Replaces the hardcoded `const STALE_DAYS = 14` constant.
 */
import admin from "firebase-admin";

const SYSTEM_CONFIG_DOC = "system_config/site_verification";
const FALLBACK_THRESHOLD_DAYS = 14;
const SECONDS_PER_DAY = 86400;

/**
 * Per-request cache for `getStalenessThresholdDays()`. Express attaches one
 * instance per request via `attachStalenessCache(req)`; consumers that don't
 * have a request object (e.g. background tasks) just read uncached.
 */
export interface StalenessCache {
  thresholdDays?: number;
  inflight?: Promise<number>;
}

/**
 * Derive whether a verification entry is stale at read time.
 *
 *   • Returns false if `lastVerifiedAt` is null/undefined (can't be stale if
 *     never verified).
 *   • Returns true  if (now - lastVerifiedAt) > (thresholdDays * 86400s).
 *   • Returns false otherwise.
 *
 * Uses server time, not client-provided time.
 */
export function deriveStaleness(
  lastVerifiedAt: FirebaseFirestore.Timestamp | null | undefined,
  thresholdDays: number,
): boolean {
  if (!lastVerifiedAt || typeof lastVerifiedAt.toDate !== "function") {
    return false;
  }
  const lastMs = lastVerifiedAt.toDate().getTime();
  if (!Number.isFinite(lastMs) || lastMs <= 0) return false;
  const ageSeconds = (Date.now() - lastMs) / 1000;
  return ageSeconds > thresholdDays * SECONDS_PER_DAY;
}

/**
 * Read the configured staleness threshold from
 * `system_config/site_verification`. Falls back to 14 if the doc is missing
 * or malformed.
 *
 * Pass an optional `cache` object (typically `req` or a `{}` you scope to a
 * single request) to avoid repeated Firestore reads when processing batches
 * of queue rows. Per spec §4.4.1: per-request, NOT module-level.
 */
export async function getStalenessThresholdDays(
  cache?: StalenessCache,
): Promise<number> {
  if (cache?.thresholdDays !== undefined) return cache.thresholdDays;
  if (cache?.inflight) return cache.inflight;

  const fetchOnce = (async (): Promise<number> => {
    try {
      const snap = await admin.firestore().doc(SYSTEM_CONFIG_DOC).get();
      const raw = snap.exists ? snap.get("staleness_threshold_days") : undefined;
      const parsed = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_THRESHOLD_DAYS;
      if (cache) cache.thresholdDays = parsed;
      return parsed;
    } catch (err) {
      console.warn(
        `getStalenessThresholdDays: read of ${SYSTEM_CONFIG_DOC} failed, falling back to ${FALLBACK_THRESHOLD_DAYS}:`,
        err,
      );
      if (cache) cache.thresholdDays = FALLBACK_THRESHOLD_DAYS;
      return FALLBACK_THRESHOLD_DAYS;
    }
  })();

  if (cache) cache.inflight = fetchOnce;
  return fetchOnce;
}

/**
 * Convenience: returns the verification_state to render given the stored
 * state and last_verified_at. Centralises the "stale overrides verified_live"
 * derivation logic so callers don't reinvent it.
 */
export function deriveVerificationState(
  storedState: string | undefined | null,
  lastVerifiedAt: FirebaseFirestore.Timestamp | null | undefined,
  thresholdDays: number,
): string {
  const state = storedState || "unverified";
  if (state === "verified_live" && deriveStaleness(lastVerifiedAt, thresholdDays)) {
    return "stale";
  }
  return state;
}
