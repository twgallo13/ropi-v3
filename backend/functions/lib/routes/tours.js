"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Guided Tours — Step 3.5
 *   GET /api/v1/tours/:hub   — fetch active tour for a hub
 *
 * Reads from `admin_tours` collection. Seeded via scripts/seed/seed-tours.js.
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
router.get("/:hub", auth_1.requireAuth, async (req, res) => {
    try {
        const hub = req.params.hub;
        const snap = await db()
            .collection("admin_tours")
            .where("hub", "==", hub)
            .where("is_active", "==", true)
            .limit(1)
            .get();
        if (snap.empty) {
            res.json({ tour: null });
            return;
        }
        const doc = snap.docs[0];
        res.json({ tour: { tour_id: doc.id, ...doc.data() } });
    }
    catch (err) {
        console.error("GET /tours/:hub error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=tours.js.map