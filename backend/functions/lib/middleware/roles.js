"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = requireRole;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
function requireRole(allowed) {
    return async (req, res, next) => {
        const uid = req.user?.uid;
        if (!uid) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }
        // Admins and owners always allowed.
        const allowedWithAdmin = Array.from(new Set([...allowed, "admin", "owner"]));
        // 1. Custom claims
        const claimRole = req.user?.role;
        if (claimRole && allowedWithAdmin.includes(claimRole)) {
            return next();
        }
        // 2. Firestore users/{uid}.role
        try {
            const userDoc = await firebase_admin_1.default.firestore().collection("users").doc(uid).get();
            if (userDoc.exists) {
                const userRole = userDoc.data()?.role;
                if (userRole && allowedWithAdmin.includes(userRole)) {
                    return next();
                }
                if (userRole) {
                    res.status(403).json({
                        error: `Role "${userRole}" not permitted. Required: ${allowed.join(" or ")}`,
                    });
                    return;
                }
            }
        }
        catch (err) {
            // fall through to permissive mode on read failures
        }
        // 3. No role data present — deny access.
        res.status(403).json({
            error: `No role assigned. Required: ${allowed.join(" or ")}`,
        });
        return;
    };
}
//# sourceMappingURL=roles.js.map