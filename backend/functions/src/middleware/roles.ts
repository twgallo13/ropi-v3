/**
 * Role-check middleware. Phase 1 implementation:
 *   - Reads role from Firebase Auth custom claim `role`
 *   - Falls back to `users/{uid}.role` in Firestore
 *   - If neither is set, the request is PERMITTED (deferred enforcement)
 *     so existing test accounts continue to work while roles roll out.
 * Known roles (Section 4): map_analyst, head_buyer, operations_operator,
 *                          buyer, completion_specialist, admin, owner,
 *                          product_ops
 */
import { Response, NextFunction } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest } from "./auth";

export function requireRole(allowed: string[]) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Admins and owners always allowed.
    const allowedWithAdmin = Array.from(new Set([...allowed, "admin", "owner"]));

    // 1. Custom claims
    const claimRole = (req.user as any)?.role;
    if (claimRole && allowedWithAdmin.includes(claimRole)) {
      return next();
    }

    // 2. Firestore users/{uid}.role
    try {
      const userDoc = await admin.firestore().collection("users").doc(uid).get();
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
    } catch (err) {
      // fall through to permissive mode on read failures
    }

    // 3. Phase 1 fallback — no role data present, permit.
    next();
  };
}
