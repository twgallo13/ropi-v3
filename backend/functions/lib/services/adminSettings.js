"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdminSettings = getAdminSettings;
/**
 * Admin Settings helper
 * Reads pricing / calculation settings from admin_settings collection.
 * Falls back to SPEC.md-defined defaults when documents don't exist yet.
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const DEFAULTS = {
    gross_margin_safe_threshold: 10,
    estimated_cost_multiplier: 0.50,
    below_cost_acknowledgment_required: true,
    below_cost_reason_min_chars: 20,
    master_veto_window: 2,
    export_price_rounding_enabled: true,
    export_price_rounding_mode: "floor_minus_one_cent",
    slow_moving_str_threshold: 15,
    slow_moving_wos_threshold: 12,
    str_calculation_window_days: 30,
    wos_trailing_average_days: 30,
};
/**
 * Read all pricing-related admin_settings. Each setting is a separate doc
 * with { key, value, type }. Falls back to hardcoded defaults from SPEC.md.
 */
async function getAdminSettings() {
    const firestore = firebase_admin_1.default.firestore();
    const keys = Object.keys(DEFAULTS);
    const result = { ...DEFAULTS };
    const snaps = await Promise.all(keys.map((k) => firestore.collection("admin_settings").doc(k).get()));
    for (let i = 0; i < keys.length; i++) {
        if (snaps[i].exists) {
            const data = snaps[i].data();
            if (data && data.value !== undefined) {
                result[keys[i]] = data.value;
            }
        }
    }
    return result;
}
//# sourceMappingURL=adminSettings.js.map