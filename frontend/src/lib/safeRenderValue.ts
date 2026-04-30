/**
 * Safe scalar render helper for admin tables/forms.
 *
 * Replaces ad-hoc String(unknown) coercion that produces "[object Object]"
 * when the value is unexpectedly an object.
 *
 * Returns:
 *   - "—" for null/undefined
 *   - The value itself for strings
 *   - String() coercion for numbers/booleans
 *   - "[malformed: <json>]" for objects (with console.warn)
 *   - "[malformed: unserializable]" for circular/unserializable objects
 *   - String() coercion as fallback for other types
 */
export function safeRenderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    console.warn("safeRenderValue: malformed value", v);
    try {
      return `[malformed: ${JSON.stringify(v)}]`;
    } catch {
      return "[malformed: unserializable]";
    }
  }
  return String(v);
}

export default safeRenderValue;
