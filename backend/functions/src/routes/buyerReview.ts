import { Router, Response } from "express";
import admin from "firebase-admin";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { viewAs } from "../middleware/viewAs";
import { apply99Rounding } from "../services/pricingUtils";
import { getAdminSettings } from "../services/adminSettings";
import { mpnToDocId } from "../services/mpnUtils";
import {
  buildBuyerPortfolio,
  productMatchesBuyerPortfolio,
} from "../lib/portfolioFilter";

const router = Router();
const db = () => admin.firestore();

const reviewRoles = ["buyer", "head_buyer", "admin"];

// ── GET /api/v1/buyer-review ──
// Track 3 — Cockpit aggregator. Returns cadence + MAP + Pricing + KPIs
// filtered by effective user's portfolio (or admin-global for
// head_buyer/admin/owner). Replaces the legacy markdown-queue handler.
router.get(
  "/",
  requireAuth,
  viewAs,
  requireRole(["buyer", "head_buyer", "admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const effectiveUid = req.effectiveUserId || req.user!.uid;
      const actingUid = req.actingUserId || req.user!.uid;

      // Load effective user.
      const userSnap = await db().collection("users").doc(effectiveUid).get();
      if (!userSnap.exists) {
        res.status(404).json({ error: "Effective user not found" });
        return;
      }
      const userData = userSnap.data()!;
      const role = userData.role || "buyer";
      // TALLY-D2B (Option B): owner routes through portfolio-filtered path, not admin-global.
      const isAdminGlobal = ["head_buyer", "admin"].includes(role);

      // Build portfolio for buyer-role (used for MAP + Pricing + High-GM% KPI).
      const portfolio = isAdminGlobal
        ? null
        : buildBuyerPortfolio(effectiveUid, userData);

      // ── Build users map ONCE (reused for primary_display_name + viewableUsers) ──
      const allUsersSnap = await db().collection("users").get();
      const usersMap = new Map<
        string,
        { display_name: string; role: string }
      >();
      for (const u of allUsersSnap.docs) {
        const ud = u.data();
        usersMap.set(u.id, {
          display_name: ud.display_name || ud.email || "Unknown",
          role: ud.role || "unknown",
        });
      }

      // ── Cadence section (TALLY-D2B: primary/support two-query union) ──
      const cadence: any[] = [];
      let agedOver45d = 0;
      const now = Date.now();
      const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;

      let assignmentDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      if (isAdminGlobal) {
        // Admin path: full sweep, no user filter.
        const snap = await db()
          .collection("cadence_assignments")
          .where("in_cadence_review_queue", "==", true)
          .get();
        assignmentDocs = snap.docs;
      } else {
        // Portfolio path: union of primary_user_id + support_user_ids queries.
        const [primarySnap, supportSnap] = await Promise.all([
          db()
            .collection("cadence_assignments")
            .where("primary_user_id", "==", effectiveUid)
            .where("in_cadence_review_queue", "==", true)
            .get(),
          db()
            .collection("cadence_assignments")
            .where("support_user_ids", "array-contains", effectiveUid)
            .where("in_cadence_review_queue", "==", true)
            .get(),
        ]);
        // Dedup by document ID (defensive — should be no overlap per resolver semantics).
        const seen = new Set<string>();
        for (const d of [...primarySnap.docs, ...supportSnap.docs]) {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            assignmentDocs.push(d);
          }
        }
      }

      for (const d of assignmentDocs) {
        const a = d.data();
        if (a.cadence_state !== "assigned" || !a.recommendation) continue;

        const pSnap = await db()
          .collection("products")
          .doc(mpnToDocId(a.mpn))
          .get();
        if (!pSnap.exists) continue;
        const p = pSnap.data() as any;

        const queueEnteredAt =
          a.buyer_queue_entered_at?.toDate?.()?.getTime?.() ?? null;
        const daysInQueue =
          queueEnteredAt != null
            ? Math.floor((now - queueEnteredAt) / (24 * 60 * 60 * 1000))
            : 0;

        // D2 — Aged>45d KPI: anchor on buyer_queue_entered_at
        if (queueEnteredAt != null && now - queueEnteredAt > FORTY_FIVE_DAYS_MS) {
          agedOver45d += 1;
        }

        cadence.push({
          mpn: a.mpn,
          name: p.name || "",
          brand: p.brand || "",
          department: p.department || "",
          class: p.class || "",
          site_owner: p.site_owner || "",
          rics_retail: p.rics_retail ?? 0,
          rics_offer: p.rics_offer ?? 0,
          scom: p.scom ?? 0,
          scom_sale: p.scom_sale ?? 0,
          is_map_protected: !!p.is_map_protected,
          map_price: p.map_price ?? null,
          map_conflict_active: !!p.map_conflict_active,
          str_pct: p.str_pct ?? null,
          wos: p.wos ?? null,
          store_gm_pct: p.store_gm_pct ?? null,
          web_gm_pct: p.web_gm_pct ?? null,
          inventory_total:
            (p.inventory_store ?? 0) +
            (p.inventory_warehouse ?? 0) +
            (p.inventory_whs ?? 0),
          is_slow_moving: !!p.is_slow_moving,
          recommendation: a.recommendation,
          current_step: a.current_step,
          days_in_queue: daysInQueue,
          // TALLY-D2B — Phase 3.13 Primary/Support tier fields
          primary_user_id: a.primary_user_id ?? null,
          support_user_ids: a.support_user_ids ?? [],
          is_primary: a.primary_user_id === effectiveUid,
          primary_display_name: a.primary_user_id
            ? (usersMap.get(a.primary_user_id)?.display_name ?? null)
            : null,
        });
      }

      // ── MAP section (D3: portfolio filter) ──
      const mapSnap = await db()
        .collection("products")
        .where("map_conflict_active", "==", true)
        .get();
      const map: any[] = [];
      for (const d of mapSnap.docs) {
        const p = d.data() as any;
        if (p.map_conflict_held) continue;
        if (portfolio && !productMatchesBuyerPortfolio(p, portfolio)) continue;
        map.push({
          mpn: p.mpn || d.id,
          name: p.name || "",
          brand: p.brand || "",
          map_price: p.map_price || 0,
          map_promo_price: p.map_promo_price || null,
          scom: p.scom || 0,
          scom_sale: p.scom_sale || 0,
          rics_offer: p.rics_offer || 0,
          map_conflict_reason: p.map_conflict_reason || null,
          map_conflict_flagged_at:
            p.map_conflict_flagged_at?.toDate?.()?.toISOString() || null,
          map_conflict_held: !!p.map_conflict_held,
        });
      }

      // ── Pricing Discrepancy section (D3: portfolio filter) ──
      const pricingSnap = await db()
        .collection("products")
        .where("pricing_domain_state", "==", "Pricing Discrepancy")
        .get();
      const pricing: any[] = [];
      for (const d of pricingSnap.docs) {
        const p = d.data() as any;
        if (portfolio && !productMatchesBuyerPortfolio(p, portfolio)) continue;
        pricing.push({
          mpn: p.mpn || d.id,
          name: p.name || "",
          brand: p.brand || "",
          discrepancy_reasons: p.discrepancy_reasons || [],
          discrepancy_flagged_at:
            p.discrepancy_flagged_at?.toDate?.()?.toISOString() || null,
          web_gm_pct: p.web_gm_pct ?? null,
          store_gm_pct: p.store_gm_pct ?? null,
          rics_retail: p.rics_retail ?? 0,
          rics_offer: p.rics_offer ?? 0,
          scom: p.scom ?? 0,
          scom_sale: p.scom_sale ?? 0,
        });
      }

      // ── KPI: High GM% (web_gm_pct > 60), portfolio-scoped ──
      const highGmSnap = await db()
        .collection("products")
        .where("web_gm_pct", ">", 60)
        .get();
      let highGmPct = 0;
      for (const d of highGmSnap.docs) {
        const p = d.data() as any;
        if (portfolio && !productMatchesBuyerPortfolio(p, portfolio)) continue;
        highGmPct += 1;
      }

      // ── KPI: daily_approval_goal = ceil(cadence.length / 5) ──
      const dailyApprovalGoal = Math.ceil(cadence.length / 5);

      // PO-modified D5 — fetch acting user's role separately when viewing-as-other.
      let actingRole = role;
      if (effectiveUid !== actingUid) {
        const actingSnap = await db().collection("users").doc(actingUid).get();
        const actingData = actingSnap.exists ? actingSnap.data()! : {};
        actingRole = actingData.role || "buyer";
      }

      // can_write: true when not viewing-as, OR when actor has privileged role.
      const PRIVILEGED_ACTOR_ROLES = ["head_buyer", "admin", "owner"];
      const canWrite =
        effectiveUid === actingUid ||
        PRIVILEGED_ACTOR_ROLES.includes(actingRole);

      // viewable_users: minimal user list for the FE View As dropdown.
      // TALLY-D2B — reuse usersMap built above (single users full-scan per request).
      const viewableUsers = Array.from(usersMap.entries()).map(([uid, u]) => ({
        uid,
        display_name: u.display_name,
        role: u.role,
      }));

      res.json({
        cadence,
        map,
        pricing,
        kpis: {
          aged_over_45d: agedOver45d,
          high_gm_pct: highGmPct,
          daily_approval_goal: dailyApprovalGoal,
          map_violations: map.length,
          pricing_discrepancies: pricing.length,
        },
        meta: {
          effective_user_id: effectiveUid,
          acting_user_id: actingUid,
          is_view_as: effectiveUid !== actingUid,
          role,
          acting_role: actingRole,
          can_write: canWrite,
          viewable_users: viewableUsers,
        },
      });
    } catch (err: any) {
      console.error("[buyer-review aggregator] error:", err);
      res.status(500).json({ error: err.message || "Internal error" });
    }
  }
);

// ── GET /api/v1/buyer-review/price-projection/:mpn ──
router.get(
  "/price-projection/:mpn",
  requireAuth,
  requireRole(reviewRoles),
  async (req: AuthenticatedRequest, res: Response) => {
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

    const isMapProtected =
      d.is_map_protected === true ||
      (d.map_state?.is_active === true && (d.map_state?.map_price || 0) > 0);
    const mapFloor = d.map_price ?? d.map_state?.map_price ?? null;

    res.json({
      mpn,
      cost: Math.round(cost * 1000) / 1000,
      cost_is_estimated: costIsEstimated,
      current_gm_pct: Math.round(currentGm * 100) / 100,
      steps,
      below_cost_threshold: Math.round(cost * 1000) / 1000,
      map_floor: isMapProtected ? mapFloor : null,
    });
  } catch (err: any) {
    console.error("GET /buyer-review/price-projection error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
