/**
 * Feature Toggle Cache (TALLY-SETTINGS-UX Phase 3 / A.3 PR1)
 *
 * Module-level in-memory cache of `feature_toggles/{toggleKey}.is_enabled`.
 *
 * Per ruling R.6:
 *   - TTL: 60_000 ms (60s)
 *   - cache-then-fetch: read cache; on miss/expired, fetch Firestore doc,
 *     return data.is_enabled (default false if doc missing or field absent)
 *
 * Public API:
 *   - isFeatureEnabled(toggleKey): Promise<boolean>
 *   - clearFeatureToggleCache(): void
 *
 * No consumer in PR 1 (consumer is featureToggles router in PR 2).
 */
import admin from "firebase-admin";

interface CacheEntry {
  value: boolean;
  fetchedAt: number;
}

const TTL_MS = 60_000;
const cache: Map<string, CacheEntry> = new Map();

const db = () => admin.firestore();
const now = () => Date.now();

export async function isFeatureEnabled(toggleKey: string): Promise<boolean> {
  const cached = cache.get(toggleKey);
  if (cached && now() - cached.fetchedAt < TTL_MS) {
    return cached.value;
  }
  let value = false;
  try {
    const snap = await db().collection("feature_toggles").doc(toggleKey).get();
    if (snap.exists) {
      const data = snap.data() || {};
      value = data.is_enabled === true;
    }
  } catch (err: any) {
    console.error(
      `featureToggleCache: fetch failed for "${toggleKey}":`,
      err.message
    );
    // On Firestore error, return default false. Do NOT cache the failure.
    return false;
  }
  cache.set(toggleKey, { value, fetchedAt: now() });
  return value;
}

export function clearFeatureToggleCache(): void {
  cache.clear();
}
