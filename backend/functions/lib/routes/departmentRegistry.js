"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shapeDepartmentEntry = shapeDepartmentEntry;
exports.compareDepartmentEntries = compareDepartmentEntries;
exports.filterDepartmentEntries = filterDepartmentEntries;
exports.resolveAllowedDepartmentValues = resolveAllowedDepartmentValues;
exports.isDepartmentValueAllowed = isDepartmentValueAllowed;
exports.loadDepartmentRegistry = loadDepartmentRegistry;
/**
 * Department Registry — TALLY-DEPARTMENT-REGISTRY canonical endpoint.
 *
 *   GET /api/v1/department-registry                  → all entries
 *   GET /api/v1/department-registry?activeOnly=true  → is_active === true only
 *   GET /api/v1/department-registry/:key             → single entry by key
 *
 * Response shape:
 *   { departments: [{ key, display_name, aliases, is_active, priority, po_confirmed }] }
 *   { department:   { key, display_name, aliases, is_active, priority, po_confirmed } }
 *
 * Sorted by priority ascending, then key.
 *
 * Mirrors backend/functions/src/routes/siteRegistry.ts (Phase 4.4 §3.1).
 *
 * PO Ruling A (2026-04-23): department_registry mirrors brand_registry +
 * site_registry pattern exactly. PO Ruling G (soft deactivation) +
 * Ruling H (no hard-delete) apply: this tally exposes READS only.
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const COLLECTION = "department_registry";
/** Shape a Firestore doc payload into a DepartmentRegistryEntry. Pure. */
function shapeDepartmentEntry(data, fallbackId) {
    const d = data || {};
    return {
        key: typeof d.key === "string" && d.key ? d.key : fallbackId,
        display_name: typeof d.display_name === "string" && d.display_name
            ? d.display_name
            : fallbackId,
        aliases: Array.isArray(d.aliases) ? d.aliases : [],
        is_active: d.is_active === true,
        priority: typeof d.priority === "number" ? d.priority : 999,
        po_confirmed: !!d.po_confirmed,
    };
}
function normalize(s) {
    return (s || "").trim().toLowerCase();
}
/** Sort comparator: priority asc, then key asc. Pure. */
function compareDepartmentEntries(a, b) {
    if (a.priority !== b.priority)
        return a.priority - b.priority;
    return a.key.localeCompare(b.key);
}
/** Filter entries by activeOnly flag. Pure. */
function filterDepartmentEntries(entries, activeOnly) {
    return entries.filter((e) => (activeOnly ? e.is_active : true));
}
/**
 * Build a lowercase Set of all values that count as a match for an ACTIVE
 * registry entry: key, display_name, and each alias. Used by validation.
 * Inactive entries (PO Ruling G — soft deactivation) are excluded; their
 * values reject NEW writes but do not retroactively invalidate existing
 * product attribute_values.
 */
function resolveAllowedDepartmentValues(entries) {
    const out = new Set();
    for (const e of entries) {
        if (!e.is_active)
            continue;
        const k = normalize(e.key);
        if (k)
            out.add(k);
        const dn = normalize(e.display_name);
        if (dn)
            out.add(dn);
        for (const a of e.aliases) {
            const na = normalize(a);
            if (na)
                out.add(na);
        }
    }
    return out;
}
/**
 * Validate a candidate value against the active-entries allowlist.
 * Case-insensitive, whitespace-trimmed. Pure.
 */
function isDepartmentValueAllowed(value, entries) {
    if (value === null || value === undefined)
        return false;
    const v = normalize(String(value));
    if (!v)
        return false;
    return resolveAllowedDepartmentValues(entries).has(v);
}
/** Load all department_registry docs from Firestore. */
async function loadDepartmentRegistry() {
    const snap = await firebase_admin_1.default.firestore().collection(COLLECTION).get();
    return snap.docs.map((d) => shapeDepartmentEntry(d.data(), d.id));
}
const router = (0, express_1.Router)();
router.get("/", auth_1.requireAuth, async (req, res) => {
    try {
        const activeOnly = String(req.query.activeOnly || "").toLowerCase() === "true";
        const entries = await loadDepartmentRegistry();
        const departments = filterDepartmentEntries(entries, activeOnly).sort(compareDepartmentEntries);
        res.json({ departments });
    }
    catch (err) {
        console.error("GET /department-registry error:", err);
        res.status(500).json({ error: err.message });
    }
});
router.get("/:key", auth_1.requireAuth, async (req, res) => {
    try {
        const key = normalize(req.params.key);
        if (!key) {
            res.status(400).json({ error: "key is required" });
            return;
        }
        const ref = firebase_admin_1.default.firestore().collection(COLLECTION).doc(key);
        const snap = await ref.get();
        if (!snap.exists) {
            res
                .status(404)
                .json({ error: `Department "${req.params.key}" not found` });
            return;
        }
        res.json({ department: shapeDepartmentEntry(snap.data(), snap.id) });
    }
    catch (err) {
        console.error("GET /department-registry/:key error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=departmentRegistry.js.map