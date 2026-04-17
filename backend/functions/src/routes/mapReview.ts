/**
 * MAP Review — Step 2.1 Parts 4 & 5.
 *   GET  /conflicts                     — list map_conflict_active products
 *   POST /conflict/:mpn/resolve         — accept_map | request_buyer_map | flag_for_contact
 *   GET  /removals                      — list map_removal_proposed products
 *   POST /removal/:mpn/resolve          — approve_removal | keep_map | defer
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { mpnToDocId } from "../services/mpnUtils";
import { queueForPricingExport } from "../services/pricingExportQueue";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

const resolverRoles = ["map_analyst", "head_buyer"];

// ── GET /conflicts ──
router.get(
  "/conflicts",
  requireAuth,
  requireRole(resolverRoles),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const snap = await db()
        .collection("products")
        .where("map_conflict_active", "==", true)
        .get();

      const items = snap.docs.map((doc) => {
        const p = doc.data();
        return {
          mpn: p.mpn || doc.id,
          name: p.name || "",
          brand: p.brand || "",
          map_price: p.map_price || 0,
          map_promo_price: p.map_promo_price || null,
          scom: p.scom || 0,
          scom_sale: p.scom_sale || 0,
          rics_offer: p.rics_offer || 0,
          map_conflict_reason: p.map_conflict_reason || null,
          map_conflict_flagged_at: p.map_conflict_flagged_at?.toDate?.()?.toISOString() || null,
          map_conflict_held: !!p.map_conflict_held,
        };
      });

      // Filter out held products — they are excluded until hold is lifted
      const visible = items.filter((i) => !i.map_conflict_held);

      res.json({ items: visible, total: visible.length });
    } catch (err: any) {
      console.error("GET /map-review/conflicts error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── POST /conflict/:mpn/resolve ──
router.post(
  "/conflict/:mpn/resolve",
  requireAuth,
  requireRole(resolverRoles),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mpn } = req.params;
      const { action, note, web_discount_cap } = req.body || {};
      const userId = req.user?.uid || "system";
      const docId = mpnToDocId(mpn);
      const productRef = db().collection("products").doc(docId);
      const snap = await productRef.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Product not found" });
        return;
      }
      const p = snap.data()!;
      if (!p.map_conflict_active) {
        res.status(400).json({ error: "Product is not in an active MAP conflict state" });
        return;
      }

      const validActions = ["accept_map", "request_buyer_map", "flag_for_contact"];
      if (!validActions.includes(action)) {
        res.status(400).json({ error: `action must be one of ${validActions.join(", ")}` });
        return;
      }

      if (action === "accept_map") {
        const mapPrice = Number(p.map_price) || 0;
        if (mapPrice <= 0) {
          res.status(400).json({ error: "Cannot accept MAP — map_price is not set" });
          return;
        }
        await productRef.set(
          {
            scom: mapPrice,
            scom_sale: mapPrice,
            map_conflict_active: false,
            map_conflict_reason: null,
            map_conflict_resolution: "accept_map",
            map_conflict_resolved_at: ts(),
            map_conflict_resolved_by: userId,
            updated_at: ts(),
          },
          { merge: true }
        );
        // Mirror scom / scom_sale to attribute_values so the Product Editor matches
        const provenance = {
          origin_type: "Human",
          origin_detail: `MAP conflict resolve (accept_map) — User: ${userId}`,
          verification_state: "Human-Verified",
          written_at: ts(),
        };
        await productRef.collection("attribute_values").doc("scom").set(
          { value: mapPrice, ...provenance },
          { merge: true }
        );
        await productRef.collection("attribute_values").doc("scom_sale").set(
          { value: mapPrice, ...provenance },
          { merge: true }
        );

        await queueForPricingExport(mpn, "map_change", userId, null);

        await db().collection("audit_log").add({
          product_mpn: mpn,
          event_type: "map_conflict_resolved_accept_map",
          map_price: mapPrice,
          note: note || null,
          acting_user_id: userId,
          created_at: ts(),
        });
        res.json({ status: "success", mpn, action, new_scom: mapPrice });
        return;
      }

      if (action === "request_buyer_map") {
        const mapPrice = Number(p.map_price) || 0;
        const cap = web_discount_cap ? String(web_discount_cap) : null;
        await productRef.set(
          {
            scom: mapPrice, // visible sticker price stays at MAP
            map_conflict_active: false,
            map_conflict_reason: null,
            map_conflict_resolution: "request_buyer_map",
            map_conflict_resolved_at: ts(),
            map_conflict_resolved_by: userId,
            map_requires_buyer_cap: true,
            updated_at: ts(),
          },
          { merge: true }
        );
        if (cap) {
          await productRef.collection("attribute_values").doc("web_discount_cap").set(
            {
              value: cap,
              origin_type: "Human",
              origin_detail: `MAP conflict resolve (request_buyer_map) — User: ${userId}`,
              verification_state: "Human-Verified",
              written_at: ts(),
            },
            { merge: true }
          );
        }
        await queueForPricingExport(mpn, "map_change", userId, null);
        await db().collection("audit_log").add({
          product_mpn: mpn,
          event_type: "map_conflict_resolved_buyer_map",
          web_discount_cap: cap,
          note: note || null,
          acting_user_id: userId,
          created_at: ts(),
        });
        res.json({ status: "success", mpn, action });
        return;
      }

      if (action === "flag_for_contact") {
        await productRef.set(
          {
            map_conflict_held: true,
            map_conflict_held_by: userId,
            map_conflict_held_at: ts(),
            // note: not clearing map_conflict_active — the conflict still exists,
            //       but held products are excluded from the visible queue
            updated_at: ts(),
          },
          { merge: true }
        );
        // Notification for MAP Analyst (Mykahiolo)
        const analystsSnap = await db()
          .collection("users")
          .where("role", "==", "map_analyst")
          .get();
        for (const analyst of analystsSnap.docs) {
          await db()
            .collection("users")
            .doc(analyst.id)
            .collection("notifications")
            .add({
              type: "map_conflict_held_for_vendor_contact",
              product_mpn: mpn,
              flagged_by: userId,
              note: note || null,
              read: false,
              created_at: ts(),
            });
        }
        await db().collection("audit_log").add({
          product_mpn: mpn,
          event_type: "map_conflict_held_for_vendor_contact",
          note: note || null,
          acting_user_id: userId,
          created_at: ts(),
        });
        res.json({ status: "success", mpn, action });
        return;
      }
    } catch (err: any) {
      console.error("POST /map-review/conflict/:mpn/resolve error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── GET /removals ──
router.get(
  "/removals",
  requireAuth,
  requireRole(resolverRoles),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const snap = await db()
        .collection("products")
        .where("map_removal_proposed", "==", true)
        .get();
      const items = snap.docs
        .map((doc) => {
          const p = doc.data();
          const invStore = Number(p.inventory_store) || 0;
          const invWarehouse = Number(p.inventory_warehouse) || 0;
          const invWhs = Number(p.inventory_whs) || 0;
          return {
            mpn: p.mpn || doc.id,
            name: p.name || "",
            brand: p.brand || "",
            map_price: p.map_price || 0,
            map_removal_proposed_at:
              p.map_removal_proposed_at?.toDate?.()?.toISOString() || null,
            map_removal_source_batch: p.map_removal_source_batch || null,
            map_removal_review_after: p.map_removal_review_after || null,
            rics_retail: Number(p.rics_retail) || 0,
            rics_offer: Number(p.rics_offer) || 0,
            scom: Number(p.scom) || 0,
            scom_sale: Number(p.scom_sale) || 0,
            inventory_total: invStore + invWarehouse + invWhs,
            str_pct: p.str_pct ?? null,
            wos: p.wos ?? null,
            store_gm_pct: p.store_gm_pct ?? null,
            web_gm_pct: p.web_gm_pct ?? null,
          };
        })
        .filter(
          (i) =>
            !i.map_removal_review_after ||
            String(i.map_removal_review_after) <= today
        );
      res.json({ items, total: items.length });
    } catch (err: any) {
      console.error("GET /map-review/removals error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── POST /removal/:mpn/resolve ──
router.post(
  "/removal/:mpn/resolve",
  requireAuth,
  requireRole(resolverRoles),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mpn } = req.params;
      const { action, defer_days, note, new_scom, new_scom_sale, new_rics_offer, web_discount_cap } = req.body || {};
      const userId = req.user?.uid || "system";
      const docId = mpnToDocId(mpn);
      const productRef = db().collection("products").doc(docId);
      const snap = await productRef.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Product not found" });
        return;
      }
      const p = snap.data()!;
      if (!p.map_removal_proposed) {
        res.status(400).json({ error: "Product is not in MAP-removal-proposed state" });
        return;
      }

      if (action === "approve_removal") {
        const updates: Record<string, any> = {
          is_map_protected: false,
          map_price: null,
          map_promo_price: null,
          map_start_date: null,
          map_end_date: null,
          map_is_always_on: null,
          map_removal_proposed: false,
          map_removal_proposed_at: null,
          map_removal_source_batch: null,
          map_removal_review_after: null,
          map_conflict_active: false,
          map_conflict_reason: null,
          map_removed_at: ts(),
          map_removed_by: userId,
          // TALLY-113 — buyer decision is final: post-removal pricing goes straight to export_ready
          pricing_domain_state: "export_ready",
          updated_at: ts(),
        };
        // Apply optional buyer-set prices
        if (new_scom != null && new_scom !== "") {
          const v = Number(new_scom);
          if (!isNaN(v)) updates.scom = v;
        }
        if (new_scom_sale != null && new_scom_sale !== "") {
          const v = Number(new_scom_sale);
          if (!isNaN(v)) updates.scom_sale = v;
        }
        if (new_rics_offer != null && new_rics_offer !== "") {
          const v = Number(new_rics_offer);
          if (!isNaN(v)) updates.rics_offer = v;
        }
        await productRef.set(updates, { merge: true });

        // Mirror web_discount_cap as an attribute if provided (NO / 5 / 10 … / Final Sale)
        if (web_discount_cap != null && web_discount_cap !== "") {
          await productRef
            .collection("attributes")
            .doc("web_discount_cap")
            .set(
              {
                value: String(web_discount_cap),
                source: "Human-Verified",
                verified_by: userId,
                verified_at: ts(),
              },
              { merge: true }
            );
        }

        await queueForPricingExport(mpn, "map_removal", userId, null);
        await db().collection("audit_log").add({
          product_mpn: mpn,
          event_type: "map_removed",
          note: note || null,
          new_scom: updates.scom ?? null,
          new_scom_sale: updates.scom_sale ?? null,
          new_rics_offer: updates.rics_offer ?? null,
          web_discount_cap: web_discount_cap || null,
          acting_user_id: userId,
          created_at: ts(),
        });
        res.json({ status: "success", mpn, action });
        return;
      }

      if (action === "keep_map") {
        await productRef.set(
          {
            map_removal_proposed: false,
            map_removal_proposed_at: null,
            map_removal_source_batch: null,
            map_removal_review_after: null,
            updated_at: ts(),
          },
          { merge: true }
        );
        await db().collection("audit_log").add({
          product_mpn: mpn,
          event_type: "map_removal_rejected",
          note: note || null,
          acting_user_id: userId,
          created_at: ts(),
        });
        res.json({ status: "success", mpn, action });
        return;
      }

      if (action === "defer") {
        const days = Number(defer_days) || 7;
        const reviewAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
        await productRef.set(
          {
            map_removal_review_after: reviewAfter,
            updated_at: ts(),
          },
          { merge: true }
        );
        await db().collection("audit_log").add({
          product_mpn: mpn,
          event_type: "map_removal_deferred",
          defer_days: days,
          review_after: reviewAfter,
          note: note || null,
          acting_user_id: userId,
          created_at: ts(),
        });
        res.json({ status: "success", mpn, action, review_after: reviewAfter });
        return;
      }

      res.status(400).json({
        error: "action must be one of approve_removal, keep_map, defer",
      });
    } catch (err: any) {
      console.error("POST /map-review/removal/:mpn/resolve error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
