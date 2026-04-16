import { Router, Request, Response } from "express";
import admin from "firebase-admin";
import { apply99Rounding } from "../services/pricingUtils";
import { getAdminSettings } from "../services/adminSettings";
import { mpnToDocId } from "../services/mpnUtils";

const router = Router();
const db = () => admin.firestore();

// ── Phase 1 recommendation builder ──
function buildPhase1Recommendation(product: any) {
  const PCT = 0.15;
  const ricsRetail = product.rics_retail || 0;
  const newRicsOffer = ricsRetail * (1 - PCT);
  return {
    type: "markdown_pct" as const,
    pct: 15,
    new_rics_offer: Math.round(newRicsOffer * 100) / 100,
    export_price: apply99Rounding(newRicsOffer),
    rule_name: "Phase 1 Default — 15% Markdown",
    rule_id: null,
  };
}

// ── GET /api/v1/buyer-review ──
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      department,
      brand,
      site_owner,
      map_status,
      sort = "aging",
      limit: limitStr = "50",
      cursor,
    } = req.query as Record<string, string>;

    const limitNum = Math.min(parseInt(limitStr, 10) || 50, 100);
    let query: admin.firestore.Query = db()
      .collection("products")
      .where("pricing_domain_state", "==", "Pricing Current")
      .where("completion_state", "==", "complete");

    if (department) query = query.where("department", "==", department);
    if (brand) query = query.where("brand", "==", brand);
    if (site_owner) query = query.where("site_owner", "==", site_owner);

    // Sort
    let orderField = "pricing_resolved_at";
    let orderDir: "asc" | "desc" = "asc";
    switch (sort) {
      case "str_asc":
        orderField = "str_pct";
        orderDir = "asc";
        break;
      case "wos_desc":
        orderField = "wos";
        orderDir = "desc";
        break;
      case "gm_asc":
        orderField = "store_gm_pct";
        orderDir = "asc";
        break;
      default: // "aging"
        orderField = "pricing_resolved_at";
        orderDir = "asc";
        break;
    }

    query = query.orderBy(orderField, orderDir).limit(limitNum + 1);

    if (cursor) {
      const cursorDoc = await db().collection("products").doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snap = await query.get();
    const docs = snap.docs.slice(0, limitNum);
    const hasMore = snap.docs.length > limitNum;

    const now = Date.now();
    const items = docs.map((doc) => {
      const d = doc.data();
      const resolvedAt = d.pricing_resolved_at?.toDate?.();
      const daysInQueue = resolvedAt
        ? Math.floor((now - resolvedAt.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      const inventoryTotal =
        (d.inventory_store || 0) +
        (d.inventory_warehouse || 0) +
        (d.inventory_whs || 0);

      const isMapProtected = d.map_state?.is_active === true && (d.map_state?.map_price || 0) > 0;

      // Phase 1 filter: map_status
      if (map_status === "protected" && !isMapProtected) return null;
      if (map_status === "not_protected" && isMapProtected) return null;

      return {
        mpn: d.mpn || doc.id,
        name: d.name || "",
        brand: d.brand || "",
        department: d.department || "",
        class: d.class || "",
        site_owner: d.site_owner || "",

        rics_retail: d.rics_retail || 0,
        rics_offer: d.rics_offer || 0,
        scom: d.scom || 0,
        scom_sale: d.scom_sale || 0,
        is_map_protected: isMapProtected,
        map_floor: isMapProtected ? d.map_state.map_price : null,

        str_pct: d.str_pct ?? 0,
        wos: d.wos ?? null,
        store_gm_pct: d.store_gm_pct != null ? Math.round(d.store_gm_pct * 100) / 100 : null,
        web_gm_pct: d.web_gm_pct != null ? Math.round(d.web_gm_pct * 100) / 100 : null,
        inventory_total: inventoryTotal,
        is_slow_moving: d.is_slow_moving ?? false,

        recommendation: buildPhase1Recommendation(d),

        site_targets: [
          {
            site_id: d.site_owner || "shiekh",
            domain: `${d.site_owner || "shiekh"}.com`,
            verification_state: "not_verified",
            product_link: null,
            image_link: null,
          },
        ],

        is_loss_leader: d.is_loss_leader ?? false,
        days_in_queue: daysInQueue,
        pricing_domain_state: d.pricing_domain_state,
      };
    }).filter(Boolean);

    res.json({
      items,
      total: items.length,
      next_cursor: hasMore ? docs[docs.length - 1].id : null,
    });
  } catch (err: any) {
    console.error("GET /buyer-review error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/v1/buyer-review/price-projection/:mpn ──
router.get("/price-projection/:mpn", async (req: Request, res: Response) => {
  try {
    const { mpn } = req.params;
    const docId = mpnToDocId(mpn);
    const doc = await db().collection("products").doc(docId).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const d = doc.data()!;
    const ricsRetail = d.rics_retail || 0;
    const settings = await getAdminSettings();
    const cost =
      d.actual_cost && d.actual_cost > 0
        ? d.actual_cost
        : ricsRetail * settings.estimated_cost_multiplier;
    const costIsEstimated = !(d.actual_cost && d.actual_cost > 0);

    const currentGm = ricsRetail > 0 ? ((ricsRetail - cost) / ricsRetail) * 100 : 0;

    const markdowns = [0, 0.15, 0.30, 0.45];
    const labels = ["Current", "15% Markdown", "30% Markdown", "45% Markdown"];

    const steps = markdowns.map((pct, i) => {
      const ricsOffer = Math.round(ricsRetail * (1 - pct) * 100) / 100;
      const exportPrice = pct === 0 ? ricsOffer : apply99Rounding(ricsOffer);
      const gmPct =
        ricsOffer > 0
          ? Math.round(((ricsOffer - cost) / ricsOffer) * 10000) / 100
          : 0;
      return {
        step: i,
        label: labels[i],
        rics_offer: ricsOffer,
        export_price: exportPrice,
        gm_pct: gmPct,
        is_below_cost: ricsOffer < cost,
      };
    });

    const isMapProtected = d.map_state?.is_active === true && (d.map_state?.map_price || 0) > 0;

    res.json({
      mpn,
      cost: Math.round(cost * 1000) / 1000,
      cost_is_estimated: costIsEstimated,
      current_gm_pct: Math.round(currentGm * 100) / 100,
      steps,
      below_cost_threshold: Math.round(cost * 1000) / 1000,
      map_floor: isMapProtected ? d.map_state.map_price : null,
    });
  } catch (err: any) {
    console.error("GET /buyer-review/price-projection error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
