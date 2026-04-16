"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const mpnUtils_1 = require("../services/mpnUtils");
const router = (0, express_1.Router)();
const db = firebase_admin_1.default.firestore;
/** Cache required field keys from attribute_registry (refreshed per request group). */
async function getRequiredFieldKeys(firestore) {
    const snap = await firestore
        .collection("attribute_registry")
        .where("required_for_completion", "==", true)
        .get();
    return snap.docs.map((d) => ({
        field_key: d.id,
        display_label: d.data().display_label || d.id,
    }));
}
/** Compute completion progress for a single product. */
async function computeCompletionProgress(firestore, docId, requiredFields) {
    const avSnap = await firestore
        .collection("products")
        .doc(docId)
        .collection("attribute_values")
        .get();
    const attrMap = new Map();
    avSnap.docs.forEach((d) => {
        if (d.id !== "source_inputs") {
            attrMap.set(d.id, d.data());
        }
    });
    let completed = 0;
    const blockers = [];
    for (const rf of requiredFields) {
        const attr = attrMap.get(rf.field_key);
        if (attr && attr.value !== undefined && attr.value !== null && attr.value !== "") {
            if (attr.verification_state === "Human-Verified") {
                completed++;
            }
            else {
                blockers.push(`${rf.display_label} must be Human-Verified`);
            }
        }
        else {
            blockers.push(`${rf.display_label} is required`);
        }
    }
    const total_required = requiredFields.length;
    const pct = total_required > 0 ? Math.round((completed / total_required) * 100) : 100;
    return { total_required, completed, pct, blockers };
}
/** Compute high-priority launch fields. */
function computeLaunchPriority(productData, launchWindowDays) {
    // Check linked_launch_date on the product
    const launchDate = productData.linked_launch_date;
    if (!launchDate) {
        return { is_high_priority: false, launch_days_remaining: null };
    }
    let launchMs;
    if (launchDate.toDate) {
        launchMs = launchDate.toDate().getTime();
    }
    else if (launchDate instanceof Date) {
        launchMs = launchDate.getTime();
    }
    else {
        launchMs = new Date(launchDate).getTime();
    }
    const now = Date.now();
    const daysRemaining = Math.ceil((launchMs - now) / (1000 * 60 * 60 * 24));
    if (daysRemaining <= launchWindowDays && daysRemaining >= 0) {
        return { is_high_priority: true, launch_days_remaining: daysRemaining };
    }
    return { is_high_priority: false, launch_days_remaining: null };
}
/** Get the launch_priority_window_days from admin_settings. */
async function getLaunchWindowDays(firestore) {
    const doc = await firestore
        .collection("admin_settings")
        .doc("launch_priority_window_days")
        .get();
    return doc.exists ? doc.data().value : 7;
}
/** Build the site_owner value — first site_target's site_id. */
async function getSiteOwner(firestore, docId) {
    const snap = await firestore
        .collection("products")
        .doc(docId)
        .collection("site_targets")
        .limit(1)
        .get();
    if (snap.empty)
        return null;
    return snap.docs[0].data().site_id || snap.docs[0].id;
}
// ────────────────────────────────────────────────
//  GET /api/v1/products
// ────────────────────────────────────────────────
router.get("/", auth_1.requireAuth, async (req, res) => {
    try {
        const firestore = firebase_admin_1.default.firestore();
        const { completion_state, site_owner, brand, department, image_status, sort = "priority", limit: limitStr = "50", cursor, } = req.query;
        const limitNum = Math.min(Math.max(parseInt(limitStr || "50", 10) || 50, 1), 100);
        // Start with base query
        let query = firestore.collection("products");
        // Apply Firestore-level filters where possible
        if (completion_state) {
            query = query.where("completion_state", "==", completion_state);
        }
        // We need first_received_at for default ordering
        query = query.orderBy("first_received_at", "asc");
        // Cursor-based pagination
        if (cursor) {
            const cursorDoc = await firestore.collection("products").doc(cursor).get();
            if (cursorDoc.exists) {
                query = query.startAfter(cursorDoc);
            }
        }
        // Fetch more than needed to allow in-memory filtering
        // For 63 products this is fine; for scale we'd need composite indexes
        const fetchLimit = limitNum * 3 + 50;
        const snap = await query.limit(fetchLimit).get();
        // Load required fields, launch window, and site targets in parallel
        const [requiredFields, launchWindowDays] = await Promise.all([
            getRequiredFieldKeys(firestore),
            getLaunchWindowDays(firestore),
        ]);
        // Build response items with in-memory filtering
        const items = [];
        for (const doc of snap.docs) {
            const data = doc.data();
            const docId = doc.id;
            // Get site_owner for this product
            const productSiteOwner = await getSiteOwner(firestore, docId);
            // In-memory filters
            if (site_owner && productSiteOwner !== site_owner)
                continue;
            if (brand && (data.brand || "").toLowerCase() !== brand.toLowerCase())
                continue;
            if (department) {
                // Check department from attribute_values
                const deptAttr = await firestore
                    .collection("products").doc(docId)
                    .collection("attribute_values").doc("department").get();
                const deptVal = deptAttr.exists ? deptAttr.data()?.value : null;
                if (!deptVal || deptVal.toLowerCase() !== department.toLowerCase())
                    continue;
            }
            if (image_status) {
                const imgAttr = await firestore
                    .collection("products").doc(docId)
                    .collection("attribute_values").doc("image_status").get();
                const imgVal = imgAttr.exists ? imgAttr.data()?.value : null;
                if (!imgVal || imgVal.toUpperCase() !== image_status.toUpperCase())
                    continue;
            }
            // Compute completion progress
            const completion_progress = await computeCompletionProgress(firestore, docId, requiredFields);
            // Compute launch priority
            const { is_high_priority, launch_days_remaining } = computeLaunchPriority(data, launchWindowDays);
            // Get image_status value
            const imgSnap = await firestore
                .collection("products").doc(docId)
                .collection("attribute_values").doc("image_status").get();
            const imageStatusVal = imgSnap.exists ? imgSnap.data()?.value || "NO" : "NO";
            // Get department from attribute_values
            const deptSnap = await firestore
                .collection("products").doc(docId)
                .collection("attribute_values").doc("department").get();
            const deptVal = deptSnap.exists ? deptSnap.data()?.value || "" : "";
            // Get class from attribute_values
            const classSnap = await firestore
                .collection("products").doc(docId)
                .collection("attribute_values").doc("class").get();
            const classVal = classSnap.exists ? classSnap.data()?.value || "" : "";
            items.push({
                mpn: data.mpn || (0, mpnUtils_1.docIdToMpn)(docId),
                doc_id: docId,
                name: data.name || "",
                brand: data.brand || "",
                department: deptVal,
                class: classVal,
                site_owner: productSiteOwner || "",
                completion_state: data.completion_state || "incomplete",
                image_status: imageStatusVal,
                pricing_domain_state: data.pricing_domain_state || "pending",
                first_received_at: data.first_received_at?.toDate?.()?.toISOString() || null,
                updated_at: data.updated_at?.toDate?.()?.toISOString() || null,
                is_high_priority,
                launch_days_remaining,
                completion_progress,
            });
        }
        // Sort logic
        if (sort === "priority") {
            items.sort((a, b) => {
                // High priority first
                if (a.is_high_priority && !b.is_high_priority)
                    return -1;
                if (!a.is_high_priority && b.is_high_priority)
                    return 1;
                // Within high priority: sort by launch_days_remaining ASC
                if (a.is_high_priority && b.is_high_priority) {
                    return (a.launch_days_remaining ?? 999) - (b.launch_days_remaining ?? 999);
                }
                // Others: sort by first_received_at ASC
                const aTime = a.first_received_at ? new Date(a.first_received_at).getTime() : Infinity;
                const bTime = b.first_received_at ? new Date(b.first_received_at).getTime() : Infinity;
                return aTime - bTime;
            });
        }
        else if (sort === "first_received") {
            items.sort((a, b) => {
                const aTime = a.first_received_at ? new Date(a.first_received_at).getTime() : Infinity;
                const bTime = b.first_received_at ? new Date(b.first_received_at).getTime() : Infinity;
                return aTime - bTime;
            });
        }
        else if (sort === "last_modified") {
            items.sort((a, b) => {
                const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                return bTime - aTime;
            });
        }
        else if (sort === "completion_pct") {
            items.sort((a, b) => a.completion_progress.pct - b.completion_progress.pct);
        }
        // Apply limit and build next_cursor
        const page = items.slice(0, limitNum);
        const next_cursor = items.length > limitNum ? page[page.length - 1]?.doc_id : null;
        res.status(200).json({
            items: page,
            total: items.length,
            next_cursor,
        });
    }
    catch (err) {
        console.error("GET /products error:", err);
        res.status(500).json({ error: "Failed to fetch products." });
    }
});
// ────────────────────────────────────────────────
//  GET /api/v1/products/:mpn
// ────────────────────────────────────────────────
router.get("/:mpn", auth_1.requireAuth, async (req, res) => {
    try {
        const firestore = firebase_admin_1.default.firestore();
        const { mpn } = req.params;
        const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
        // Fetch product document
        const productRef = firestore.collection("products").doc(docId);
        const productSnap = await productRef.get();
        if (!productSnap.exists) {
            res.status(404).json({ error: `Product with MPN "${mpn}" not found.` });
            return;
        }
        const data = productSnap.data();
        // Fetch subcollections in parallel
        const [avSnap, stSnap, requiredFields, launchWindowDays] = await Promise.all([
            productRef.collection("attribute_values").get(),
            productRef.collection("site_targets").get(),
            getRequiredFieldKeys(firestore),
            getLaunchWindowDays(firestore),
        ]);
        // Build attribute_values map
        const attribute_values = {};
        const source_inputs = {};
        avSnap.docs.forEach((d) => {
            if (d.id === "source_inputs") {
                const siData = d.data();
                Object.assign(source_inputs, siData);
                // Convert timestamps
                for (const key of Object.keys(source_inputs)) {
                    if (source_inputs[key]?.toDate) {
                        source_inputs[key] = source_inputs[key].toDate().toISOString();
                    }
                }
            }
            else {
                const attrData = d.data();
                attribute_values[d.id] = {
                    value: attrData.value,
                    origin_type: attrData.origin_type || null,
                    origin_detail: attrData.origin_detail || null,
                    verification_state: attrData.verification_state || null,
                    written_at: attrData.written_at?.toDate?.()?.toISOString() || null,
                };
            }
        });
        // Build site_targets array
        const site_targets = stSnap.docs.map((d) => ({
            site_id: d.data().site_id || d.id,
            domain: d.data().domain || "",
            active: d.data().active ?? true,
        }));
        // Compute completion progress
        const completion_progress = await computeCompletionProgress(firestore, docId, requiredFields);
        // Compute launch priority
        const { is_high_priority, launch_days_remaining } = computeLaunchPriority(data, launchWindowDays);
        // Serialize timestamps
        const serializeTs = (ts) => ts?.toDate?.()?.toISOString() || null;
        res.status(200).json({
            mpn: data.mpn || (0, mpnUtils_1.docIdToMpn)(docId),
            doc_id: docId,
            name: data.name || "",
            brand: data.brand || "",
            sku: data.sku || "",
            status: data.status || "",
            scom: data.scom ?? 0,
            scom_sale: data.scom_sale ?? 0,
            rics_retail: data.rics_retail ?? 0,
            rics_offer: data.rics_offer ?? 0,
            inventory_store: data.inventory_store ?? 0,
            inventory_warehouse: data.inventory_warehouse ?? 0,
            inventory_whs: data.inventory_whs ?? 0,
            completion_state: data.completion_state || "incomplete",
            pricing_domain_state: data.pricing_domain_state || "pending",
            product_is_active: data.product_is_active ?? true,
            site_owner: site_targets.length > 0 ? site_targets[0].site_id : "",
            import_batch_id: data.import_batch_id || null,
            first_received_at: serializeTs(data.first_received_at),
            updated_at: serializeTs(data.updated_at),
            is_high_priority,
            launch_days_remaining,
            completion_progress,
            attribute_values,
            site_targets,
            source_inputs,
        });
    }
    catch (err) {
        console.error("GET /products/:mpn error:", err);
        res.status(500).json({ error: "Failed to fetch product." });
    }
});
// ────────────────────────────────────────────────
//  POST /api/v1/products/:mpn/complete
// ────────────────────────────────────────────────
router.post("/:mpn/complete", auth_1.requireAuth, async (req, res) => {
    try {
        const firestore = firebase_admin_1.default.firestore();
        const { mpn } = req.params;
        const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
        // Verify product exists
        const productRef = firestore.collection("products").doc(docId);
        const productSnap = await productRef.get();
        if (!productSnap.exists) {
            res.status(404).json({ error: `Product with MPN "${mpn}" not found.` });
            return;
        }
        // Compute completion progress — server-side enforcement
        const requiredFields = await getRequiredFieldKeys(firestore);
        // For completion gate: check that all required fields have Human-Verified value
        const avSnap = await productRef.collection("attribute_values").get();
        const attrMap = new Map();
        avSnap.docs.forEach((d) => {
            if (d.id !== "source_inputs") {
                attrMap.set(d.id, d.data());
            }
        });
        const blockers = [];
        for (const rf of requiredFields) {
            const attr = attrMap.get(rf.field_key);
            if (!attr || attr.value === undefined || attr.value === null || attr.value === "") {
                blockers.push(`${rf.display_label} is required`);
            }
            else if (attr.verification_state !== "Human-Verified") {
                blockers.push(`${rf.display_label} must be Human-Verified`);
            }
        }
        if (blockers.length > 0) {
            res.status(400).json({
                error: "Product cannot be completed",
                blockers,
            });
            return;
        }
        // All required fields are Human-Verified → mark complete
        await productRef.set({
            completion_state: "complete",
            completed_at: db.FieldValue.serverTimestamp(),
            completed_by: req.user?.uid || "unknown",
        }, { merge: true });
        res.status(200).json({
            mpn,
            doc_id: docId,
            completion_state: "complete",
            completed_at: new Date().toISOString(),
            completed_by: req.user?.uid || "unknown",
        });
    }
    catch (err) {
        console.error("POST /products/:mpn/complete error:", err);
        res.status(500).json({ error: "Failed to complete product." });
    }
});
// ────────────────────────────────────────────────
//  POST /api/v1/products/:mpn/attributes/:field_key
//  Save a single attribute with full provenance (TALLY-044)
// ────────────────────────────────────────────────
router.post("/:mpn/attributes/:field_key", auth_1.requireAuth, async (req, res) => {
    try {
        const firestore = firebase_admin_1.default.firestore();
        const { mpn, field_key: fieldKey } = req.params;
        const { value, action } = req.body;
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }
        // 1. Validate field_key exists in attribute_registry and is active
        const regDoc = await firestore.collection("attribute_registry").doc(fieldKey).get();
        if (!regDoc.exists || !regDoc.data().active) {
            res.status(400).json({ error: `Field "${fieldKey}" not found in attribute registry` });
            return;
        }
        const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
        // Verify product exists
        const productRef = firestore.collection("products").doc(docId);
        const productSnap = await productRef.get();
        if (!productSnap.exists) {
            res.status(404).json({ error: `Product with MPN "${mpn}" not found.` });
            return;
        }
        // Determine the final value to write
        let finalValue = value;
        if (action === "verify") {
            // Verify action: keep existing value, just stamp Human-Verified
            const existingDoc = await productRef.collection("attribute_values").doc(fieldKey).get();
            if (!existingDoc.exists || existingDoc.data().value === undefined) {
                res.status(400).json({ error: `Cannot verify field "${fieldKey}" — no existing value` });
                return;
            }
            finalValue = value !== undefined ? value : existingDoc.data().value;
        }
        else {
            if (value === undefined) {
                res.status(400).json({ error: "value is required in request body" });
                return;
            }
        }
        // 3. Write to attribute_values with full provenance stamp (TALLY-044)
        await productRef
            .collection("attribute_values")
            .doc(fieldKey)
            .set({
            value: finalValue,
            origin_type: "Human",
            origin_detail: `User: ${userId}`,
            verification_state: "Human-Verified",
            written_at: db.FieldValue.serverTimestamp(),
        }, { merge: true });
        // 4. If field_key is the name field — also update the top-level product document
        if (fieldKey === "name" || fieldKey === "product_name") {
            await productRef.set({
                name: finalValue,
                updated_at: db.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        // 5. Write audit_log entry
        await firestore.collection("audit_log").add({
            product_mpn: mpn,
            event_type: action === "verify" ? "field_verified" : "field_edited",
            field_key: fieldKey,
            new_value: finalValue,
            acting_user_id: userId,
            origin_type: "Human",
            created_at: db.FieldValue.serverTimestamp(),
        });
        // 6. Return updated completion_progress
        const requiredFields = await getRequiredFieldKeys(firestore);
        const completion_progress = await computeCompletionProgress(firestore, docId, requiredFields);
        res.status(200).json({
            field_key: fieldKey,
            value: finalValue,
            verification_state: "Human-Verified",
            completion_progress,
        });
    }
    catch (err) {
        console.error("POST /products/:mpn/attributes/:field_key error:", err);
        res.status(500).json({ error: "Failed to save field." });
    }
});
exports.default = router;
//# sourceMappingURL=products.js.map