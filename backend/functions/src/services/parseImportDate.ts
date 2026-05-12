import { Timestamp } from "firebase-admin/firestore";

/**
 * Parse a CSV-sourced date string into a Firestore Timestamp.
 * Returns null if input is blank/missing/unparseable — caller falls back to serverTimestamp().
 * Handles M/D/YYYY (US ERP standard), ISO 8601, and most native Date-parsable formats.
 */
export function parseImportDate(value: unknown): Timestamp | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;

  return Timestamp.fromDate(d);
}
