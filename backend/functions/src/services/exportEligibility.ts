/**
 * Export Eligibility Gate — Step 1.7 Part 1
 * 6 conditions evaluated in order. Every condition must pass before a product
 * can be serialized for daily export.
 */
import admin from "firebase-admin";

const db = () => admin.firestore();

export interface BlockedProduct {
  mpn: string;
  reasons: string[];
}

export interface EligibilityResult {
  eligible: FirebaseFirestore.QueryDocumentSnapshot[];
  blocked: BlockedProduct[];
}

/**
 * Runs the eligibility gate against all products in 'export_ready' state.
 * Returns eligible docs and a list of blocked products with reasons.
 */
export async function getExportEligibleProducts(): Promise<EligibilityResult> {
  // Condition 1 — Base: pricing_domain_state = 'Export Ready'
  const snap = await db()
    .collection("products")
    .where("pricing_domain_state", "==", "Export Ready")
    .get();

  const eligible: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const blocked: BlockedProduct[] = [];

  for (const doc of snap.docs) {
    const p = doc.data();
    const mpn = p.mpn || doc.id;
    const reasons: string[] = [];

    // Condition 2 — product_is_active must be TRUE
    if (!p.product_is_active) {
      reasons.push("Product is inactive");
    }

    // Condition 2b — SKU is required for export
    if (!p.sku || String(p.sku).trim() === "") {
      reasons.push("SKU is required for export");
    }

    // Condition 3 — name must not be blank
    if (!p.name || p.name.trim() === "") {
      reasons.push("Product name is blank — operator must enter name before export");
    }

    // Condition 4 — defense-in-depth: must not be in discrepancy
    if (p.pricing_domain_state === "Pricing Discrepancy") {
      reasons.push("Pricing Discrepancy — must be resolved before export");
    }

    // Condition 5 — must not be in scheduled hold
    if (p.pricing_domain_state === "Scheduled") {
      reasons.push("Scheduled — awaiting effective date");
    }

    // Condition 6 — Loss-Leader review pending: buyer reason must be submitted
    if (p.pricing_domain_state === "Loss-Leader Review Pending") {
      if (!p.loss_leader_reason) {
        reasons.push("Loss-Leader: buyer reason not submitted");
      }
    }

    if (reasons.length === 0) {
      eligible.push(doc);
    } else {
      blocked.push({ mpn, reasons });
    }
  }

  return { eligible, blocked };
}
