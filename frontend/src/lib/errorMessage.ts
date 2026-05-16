/**
 * TALLY-155 — Error-message contract helper.
 *
 * Centralizes the dispatch-binding rule for surfacing backend error envelopes
 * in cockpit toast + inline UI. Removes alert("Action failed. See console.")
 * popups across the cockpit.
 *
 * Rule (per dispatch §8):
 *   Render best available backend detail:
 *     error_message
 *     else error
 *     else message
 *     else "Action failed."
 *   Prefix with `error_code + " — "` when available.
 */

export function extractErrorMessage(err: unknown): string {
  if (err === null || err === undefined) return "Action failed.";
  if (typeof err === "string" && err.trim().length > 0) return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const detail =
      pickString(e.error_message) ??
      pickString(e.error) ??
      pickString(e.message) ??
      "Action failed.";
    const code = pickString(e.error_code);
    return code ? `${code} — ${detail}` : detail;
  }
  return "Action failed.";
}

export function extractErrorCode(err: unknown): string | null {
  if (err !== null && typeof err === "object") {
    const e = err as Record<string, unknown>;
    return pickString(e.error_code);
  }
  return null;
}

function pickString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Persistent toast trigger set — these codes require a dismiss-required
 * toast per dispatch binding (INELIGIBLE_STATE, MAP_CONFLICT_BLOCKED).
 */
export const PERSISTENT_ERROR_CODES = new Set<string>([
  "INELIGIBLE_STATE",
  "MAP_CONFLICT_BLOCKED",
]);

export function isPersistentErrorCode(code: string | null | undefined): boolean {
  return code !== null && code !== undefined && PERSISTENT_ERROR_CODES.has(code);
}
