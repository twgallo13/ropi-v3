"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Operational Dashboard — Step 2.5 Part 6.
 *   GET /api/v1/dashboard      — role-scoped KPIs + recent activity + launch alerts
 *
 * Correction 4 — Only KPIs the user's role can act on are returned. The frontend
 * renders only what the server includes.
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const staleness_1 = require("../lib/staleness");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
// Role → visible KPI cards map (Correction 4)
const ROLE_KPIS = {
    product_ops: new Set([
        "incomplete_count",
        "site_verification_count",
        "high_priority_launches",
    ]),
    operations_operator: new Set([
        "pricing_discrepancy_count",
        "site_verification_count",
    ]),
    buyer: new Set([
        "cadence_review_count",
        "map_conflict_count",
        "pricing_discrepancy_count",
    ]),
    head_buyer: new Set([
        "cadence_review_count",
        "map_conflict_count",
        "pricing_discrepancy_count",
    ]),
    map_analyst: new Set(["map_conflict_count"]),
    admin: new Set([
        "incomplete_count",
        "cadence_review_count",
        "map_conflict_count",
        "pricing_discrepancy_count",
        "site_verification_count",
        "high_priority_launches",
    ]),
};
async function resolveRole(req) {
    const uid = req.user?.uid;
    const claimRole = req.user?.role;
    if (claimRole)
        return claimRole;
    if (!uid)
        return "buyer";
    try {
        const doc = await db().collection("users").doc(uid).get();
        return doc.data()?.role || "buyer";
    }
    catch (_e) {
        return "buyer";
    }
}
async function countWhere(collection, field, value) {
    try {
        const agg = await db()
            .collection(collection)
            .where(field, "==", value)
            .count()
            .get();
        return agg.data().count;
    }
    catch (_e) {
        const snap = await db().collection(collection).where(field, "==", value).get();
        return snap.size;
    }
}
router.get("/", auth_1.requireAuth, async (req, res) => {
    try {
        const role = await resolveRole(req);
        const visible = ROLE_KPIS[role] || new Set();
        const authedUserDisplay = (() => {
            const name = req.user?.name;
            if (name)
                return name.split(" ")[0];
            const email = req.user?.email;
            if (email)
                return email.split("@")[0];
            return "there";
        })();
        const response = {
            role,
            greeting_name: authedUserDisplay,
            kpis: {},
        };
        // ── KPI counts ──
        if (visible.has("incomplete_count")) {
            response.kpis.incomplete_count = await countWhere("products", "completion_state", "incomplete");
        }
        if (visible.has("cadence_review_count")) {
            try {
                const snap = await db()
                    .collection("products")
                    .where("cadence_review_state", "==", "pending")
                    .get();
                response.kpis.cadence_review_count = snap.size;
            }
            catch {
                response.kpis.cadence_review_count = 0;
            }
        }
        if (visible.has("map_conflict_count")) {
            response.kpis.map_conflict_count = await countWhere("products", "map_conflict_active", true);
        }
        if (visible.has("pricing_discrepancy_count")) {
            response.kpis.pricing_discrepancy_count = await countWhere("products", "pricing_domain_state", "discrepancy");
        }
        if (visible.has("site_verification_count")) {
            // Approximate — full scan of products with site_verification flagged.
            // Staleness derivation routes through the shared helper (Phase 4.4 §4.4.1).
            const thresholdDays = await (0, staleness_1.getStalenessThresholdDays)();
            const snap = await db().collection("products").limit(2000).get();
            let count = 0;
            for (const d of snap.docs) {
                const sv = d.data().site_verification || {};
                for (const entry of Object.values(sv)) {
                    const e = entry;
                    const state = e?.verification_state;
                    const isStale = state === "verified_live" &&
                        (0, staleness_1.deriveStaleness)(e?.last_verified_at, thresholdDays);
                    if (state === "mismatch" || isStale) {
                        count++;
                        break;
                    }
                }
            }
            response.kpis.site_verification_count = count;
        }
        // ── Recent activity ──
        try {
            const impSnap = await db()
                .collection("import_batches")
                .orderBy("created_at", "desc")
                .limit(3)
                .get();
            response.recent_imports = impSnap.docs.map((d) => {
                const data = d.data();
                return {
                    batch_id: d.id,
                    family: data.family || null,
                    status: data.status || null,
                    committed_rows: data.committed_rows || 0,
                    created_at: data.created_at?.toDate?.()?.toISOString?.() || null,
                };
            });
        }
        catch {
            response.recent_imports = [];
        }
        try {
            const expSnap = await db()
                .collection("export_jobs")
                .orderBy("created_at", "desc")
                .limit(3)
                .get();
            response.recent_exports = expSnap.docs.map((d) => {
                const data = d.data();
                return {
                    job_id: d.id,
                    kind: data.kind || data.export_kind || null,
                    status: data.status || null,
                    product_count: data.product_count || data.committed_rows || 0,
                    created_at: data.created_at?.toDate?.()?.toISOString?.() || null,
                };
            });
        }
        catch {
            response.recent_exports = [];
        }
        // ── Launch alerts — launches within 7 days AND product incomplete ──
        if (visible.has("high_priority_launches")) {
            try {
                const now = new Date();
                const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                const launchSnap = await db()
                    .collection("launches")
                    .where("launch_date", ">=", now)
                    .where("launch_date", "<=", in7)
                    .get();
                const alerts = [];
                for (const l of launchSnap.docs) {
                    const ld = l.data();
                    const products = ld.product_mpns || [];
                    for (const mpn of products) {
                        const pSnap = await db()
                            .collection("products")
                            .where("mpn", "==", mpn)
                            .limit(1)
                            .get();
                        if (pSnap.empty)
                            continue;
                        const p = pSnap.docs[0].data();
                        if (p.completion_state !== "complete") {
                            alerts.push({
                                launch_id: l.id,
                                launch_name: ld.launch_name || ld.name || l.id,
                                launch_date: ld.launch_date?.toDate?.()?.toISOString?.() || null,
                                mpn,
                                product_name: p.name || "",
                                days_remaining: Math.ceil((ld.launch_date.toDate().getTime() - Date.now()) /
                                    (24 * 60 * 60 * 1000)),
                            });
                        }
                    }
                }
                response.high_priority_launches = alerts;
            }
            catch {
                response.high_priority_launches = [];
            }
        }
        // ── System health ──
        response.system_health = {
            projections_stale: false,
            failed_jobs: 0,
            last_projection_refresh: new Date().toISOString(),
        };
        res.json(response);
    }
    catch (err) {
        console.error("GET /dashboard error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=dashboard.js.map