"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeBuyerPerformanceMatrix = computeBuyerPerformanceMatrix;
/**
 * Buyer Performance Matrix — Step 3.3
 *
 * Pre-computes the per-buyer KPI scorecard and writes it to
 * `buyer_performance/{buyer_uid}`. Designed to replace any live-join
 * rollup at query time (Section 11.8 — manager dashboard must load in
 * under 2 seconds for 5 buyers).
 *
 * Three corrections applied from the start:
 *   C1 — Use mpnToDocId() for every product lookup (never a custom regex).
 *   C2 — Chunk the cadence_assignments `in` query in batches of 10.
 *   C3 — Read catalog STR% from metric_snapshots (never re-stream the
 *        full catalog; writeWeeklySnapshots has already stored this).
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const mpnUtils_1 = require("./mpnUtils");
const db = () => firebase_admin_1.default.firestore();
async function getAdminSetting(key) {
    try {
        const snap = await db().collection("admin_settings").doc(key).get();
        if (snap.exists) {
            const v = snap.data()?.value;
            if (v !== undefined)
                return v;
        }
    }
    catch (_e) {
        /* fall through */
    }
    return null;
}
function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}
function round1(n) {
    return Math.round(n * 10) / 10;
}
/**
 * Compute buyer performance matrix — writes one doc per buyer into
 * `buyer_performance/{buyer_uid}`.
 */
async function computeBuyerPerformanceMatrix() {
    // ── Admin settings ──
    const reviewWindowDays = (await getAdminSetting("buyer_performance_review_window_days")) ?? 30;
    const weights = {
        margin_health: (await getAdminSetting("buyer_kpi_weight_margin")) ?? 33,
        inventory_velocity: (await getAdminSetting("buyer_kpi_weight_velocity")) ?? 33,
        attention: (await getAdminSetting("buyer_kpi_weight_attention")) ?? 34,
    };
    const gmTargets = (await getAdminSetting("category_gm_targets")) ?? {
        Footwear: 40,
        Clothing: 45,
        Accessories: 50,
        "Home & Tech": 45,
    };
    // ── C3: catalog STR% per department from metric_snapshots (not products.stream) ──
    const catalogStrByDept = {};
    const strSnap = await db()
        .collection("metric_snapshots")
        .where("metric_key", "==", "avg_str_pct")
        .where("dimension_type", "==", "department")
        .orderBy("snapshot_date", "desc")
        .limit(500)
        .get();
    strSnap.forEach((doc) => {
        const d = doc.data();
        const dept = d.dimension;
        if (catalogStrByDept[dept] === undefined) {
            catalogStrByDept[dept] = typeof d.value === "number" ? d.value : 0;
        }
    });
    // ── Load buyers ──
    const buyersSnap = await db()
        .collection("users")
        .where("role", "in", ["buyer", "head_buyer"])
        .get();
    const actionCutoff = new Date();
    actionCutoff.setDate(actionCutoff.getDate() - reviewWindowDays);
    let written = 0;
    for (const buyerDoc of buyersSnap.docs) {
        const buyer = buyerDoc.data() || {};
        const buyerUid = buyerDoc.id;
        const buyerName = buyer.display_name || buyer.email || buyerUid;
        // ── Build assignedMpns set ──
        const assignedMpns = new Set();
        // A) Explicit buyer_assignments
        const assignmentsSnap = await db()
            .collection("buyer_assignments")
            .where("buyer_uid", "==", buyerUid)
            .get();
        assignmentsSnap.forEach((d) => {
            const mpn = d.data()?.mpn;
            if (mpn)
                assignedMpns.add(mpn);
        });
        // B) Inferred via active cadence_rules owned by this buyer
        const buyerRulesSnap = await db()
            .collection("cadence_rules")
            .where("owner_buyer_id", "==", buyerUid)
            .where("is_active", "==", true)
            .get();
        const ruleIds = buyerRulesSnap.docs.map((r) => r.id);
        // C2: chunked parallel `in` queries over cadence_assignments
        if (ruleIds.length > 0) {
            const ruleIdChunks = chunkArray(ruleIds, 10);
            const cadenceSnapshots = await Promise.all(ruleIdChunks.map((chunk) => db()
                .collection("cadence_assignments")
                .where("matched_rule_id", "in", chunk)
                .get()));
            for (const snap of cadenceSnapshots) {
                snap.forEach((d) => {
                    const mpn = d.data()?.mpn;
                    if (mpn)
                        assignedMpns.add(mpn);
                });
            }
        }
        // C) Inferred via products.buyer_id == buyerUid (direct assignment)
        try {
            const directSnap = await db()
                .collection("products")
                .where("buyer_id", "==", buyerUid)
                .select("mpn")
                .get();
            directSnap.forEach((d) => {
                const mpn = d.data()?.mpn;
                if (mpn)
                    assignedMpns.add(mpn);
            });
        }
        catch (_e) {
            /* buyer_id may not be populated everywhere — non-fatal */
        }
        if (assignedMpns.size === 0)
            continue;
        // ── Load assigned complete products (C1: canonical mpnToDocId) ──
        const products = [];
        const refs = Array.from(assignedMpns).map((mpn) => db().collection("products").doc((0, mpnUtils_1.mpnToDocId)(mpn)));
        // getAll in chunks of 100 (safe)
        const refChunks = chunkArray(refs, 100);
        for (const chunk of refChunks) {
            const docs = await db().getAll(...chunk);
            docs.forEach((d) => {
                if (d.exists) {
                    const data = d.data();
                    if (data.completion_state === "complete")
                        products.push(data);
                }
            });
        }
        if (products.length === 0)
            continue;
        // ── Recent buyer actions ──
        // Align with actual audit_log field names: acting_user_id + product_mpn,
        // and the real event_types emitted by buyerActions.ts / cadence routes.
        const recentActionMpns = new Set();
        try {
            const actionsSnap = await db()
                .collection("audit_log")
                .where("acting_user_id", "==", buyerUid)
                .where("created_at", ">=", actionCutoff)
                .get();
            actionsSnap.forEach((d) => {
                const data = d.data() || {};
                const mpn = data.product_mpn || data.mpn;
                if (mpn)
                    recentActionMpns.add(mpn);
            });
        }
        catch (_e) {
            /* composite index missing — continue with empty set */
        }
        // ── Per-department breakdown ──
        const deptMap = {};
        for (const p of products) {
            const dept = p.department || "Unknown";
            if (!deptMap[dept]) {
                deptMap[dept] = { gmTotal: 0, strTotal: 0, count: 0, actionCount: 0 };
            }
            const gm = typeof p.store_gm_pct === "number"
                ? p.store_gm_pct
                : typeof p.web_gm_pct === "number"
                    ? p.web_gm_pct
                    : 0;
            deptMap[dept].gmTotal += gm;
            deptMap[dept].strTotal += typeof p.str_pct === "number" ? p.str_pct : 0;
            deptMap[dept].count += 1;
            if (p.mpn && recentActionMpns.has(p.mpn))
                deptMap[dept].actionCount += 1;
        }
        const categoryBreakdown = Object.entries(deptMap).map(([dept, data]) => {
            const avgGm = data.count > 0 ? data.gmTotal / data.count : 0;
            const avgStr = data.count > 0 ? data.strTotal / data.count : 0;
            const gmTarget = gmTargets[dept] ?? 40;
            const catalogStr = catalogStrByDept[dept] ?? 0;
            return {
                department: dept,
                product_count: data.count,
                avg_gm_pct: round1(avgGm),
                gm_target: gmTarget,
                gm_vs_target: round1(avgGm - gmTarget),
                avg_str_pct: round1(avgStr),
                catalog_str_pct: round1(catalogStr),
                str_vs_catalog: round1(avgStr - catalogStr),
                recent_action_count: data.actionCount,
                attention_score: data.count > 0
                    ? Math.round((data.actionCount / data.count) * 100)
                    : 0,
            };
        });
        // ── Aggregate scores ──
        const totalProducts = products.length;
        const overallAvgGm = products.reduce((s, p) => s +
            (typeof p.store_gm_pct === "number"
                ? p.store_gm_pct
                : typeof p.web_gm_pct === "number"
                    ? p.web_gm_pct
                    : 0), 0) / totalProducts;
        const overallAvgStr = products.reduce((s, p) => s + (typeof p.str_pct === "number" ? p.str_pct : 0), 0) / totalProducts;
        // Recent-action rate among buyer's assigned products
        let matchedActionCount = 0;
        for (const p of products) {
            if (p.mpn && recentActionMpns.has(p.mpn))
                matchedActionCount++;
        }
        const overallAttention = totalProducts > 0 ? (matchedActionCount / totalProducts) * 100 : 0;
        // Blended catalog STR% over buyer's actual departments (weighted by buyer's product count in dept)
        const buyerDepts = Object.keys(deptMap);
        const weightedCatalogStrNum = buyerDepts.reduce((s, d) => s + (catalogStrByDept[d] ?? 0) * deptMap[d].count, 0);
        const catalogAvgStr = totalProducts > 0 ? weightedCatalogStrNum / totalProducts : 0;
        // Blended GM target over buyer's actual departments (weighted)
        const blendedGmTargetNum = buyerDepts.reduce((s, d) => s + (gmTargets[d] ?? 40) * deptMap[d].count, 0);
        const blendedGmTarget = totalProducts > 0 ? blendedGmTargetNum / totalProducts : 40;
        // Normalize KPIs to 0–100
        const marginHealthScore = Math.min(100, Math.max(0, (overallAvgGm / Math.max(blendedGmTarget, 1)) * 100));
        const velocityScore = catalogAvgStr > 0
            ? Math.min(100, Math.max(0, (overallAvgStr / catalogAvgStr) * 100))
            : 50;
        const attentionScore = Math.min(100, Math.max(0, overallAttention));
        const compositeScore = (marginHealthScore * weights.margin_health) / 100 +
            (velocityScore * weights.inventory_velocity) / 100 +
            (attentionScore * weights.attention) / 100;
        const compositeColor = compositeScore >= 90 ? "green" : compositeScore >= 75 ? "amber" : "red";
        const payload = {
            buyer_uid: buyerUid,
            buyer_name: buyerName,
            computed_at: firestore_1.FieldValue.serverTimestamp(),
            review_window_days: reviewWindowDays,
            margin_health_score: Math.round(marginHealthScore),
            inventory_velocity_score: Math.round(velocityScore),
            attention_score: Math.round(attentionScore),
            composite_score: Math.round(compositeScore),
            composite_color: compositeColor,
            products_assigned: totalProducts,
            products_with_recent_action: matchedActionCount,
            avg_gm_pct: round1(overallAvgGm),
            avg_str_pct: round1(overallAvgStr),
            catalog_avg_str_pct: round1(catalogAvgStr),
            category_breakdown: categoryBreakdown,
        };
        await db().collection("buyer_performance").doc(buyerUid).set(payload);
        written++;
    }
    return { buyers_written: written };
}
//# sourceMappingURL=buyerPerformanceMatrix.js.map