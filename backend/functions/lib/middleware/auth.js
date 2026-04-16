"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
/**
 * Firebase Auth middleware — verifies the ID token from the Authorization header.
 * Attaches decoded token to req.user on success.
 */
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid Authorization header. Expected: Bearer <token>" });
        return;
    }
    const idToken = authHeader.split("Bearer ")[1];
    try {
        const decoded = await firebase_admin_1.default.auth().verifyIdToken(idToken);
        req.user = decoded;
        next();
    }
    catch (err) {
        console.error("Auth verification failed:", err.message);
        res.status(401).json({ error: "Invalid or expired authentication token." });
    }
}
//# sourceMappingURL=auth.js.map