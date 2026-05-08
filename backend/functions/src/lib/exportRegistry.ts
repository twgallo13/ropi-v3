/**
 * Issue #3 — Shared export-eligible registry helpers.
 *
 * Centralizes attribute_registry filtering + value serialization for CSV
 * exports. Used by services/exportSerializer.ts (daily export) and
 * routes/products.ts (product-list export).
 *
 * Filter contract (PO ratified E2):
 *   active === true AND export_enabled !== false
 *
 * Sort order (PO ratified E6):
 *   display_order ascending (registry intent)
 *
 * Multi-select serialization (PO ratified E4):
 *   Array → comma-join. Scalar → String cast. Null/undefined → empty string.
 */
import * as admin from "firebase-admin";

export interface ExportableAttr {
  field_key: string;
  field_type: string;
  display_order: number;
}

export async function loadExportableAttrs(): Promise<ExportableAttr[]> {
  const snap = await admin.firestore().collection("attribute_registry").get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((d) => d.active === true && d.export_enabled !== false)
    .map((d) => ({
      field_key: d.field_key || d.id,
      field_type: d.field_type || "text",
      display_order:
        typeof d.display_order === "number" ? d.display_order : 999,
    }))
    .sort((a, b) => a.display_order - b.display_order);
}

export function serializeAttrValue(value: any, _fieldType: string): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
