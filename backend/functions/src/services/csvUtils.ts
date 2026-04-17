/**
 * CSV parsing utilities shared across import routes.
 */

/**
 * Safely extract a flat string[] of column headers from csv-parse output.
 * Handles both array-of-arrays (columns: false) and array-of-objects (columns: true).
 */
export function extractHeaders(parsed: unknown[]): string[] {
  if (!parsed || parsed.length === 0) return [];
  const first = parsed[0];
  if (Array.isArray(first)) {
    // csv-parse returned array-of-arrays — first row is the header row
    return (first as unknown[]).flat().map(String);
  }
  // csv-parse returned array-of-objects — keys are the headers
  return Object.keys(first as Record<string, unknown>).map(String);
}
