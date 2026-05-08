/**
 * Track 3 D11 (PO-modified 2026-05-07) — View As middleware.
 *
 * Reads X-View-As-Uid header. Behavior:
 *
 *   No header / header equals own uid:
 *     req.effectiveUserId = req.user.uid (default).
 *
 *   Header set, target != self:
 *     1. Method must be safe (GET, HEAD). Otherwise 403 (read-only audit).
 *     2. Target user must exist. Otherwise 400.
 *     3. req.effectiveUserId = <header value>.
 *
 * Always sets req.actingUserId = req.user.uid for downstream audit.
 *
 * Note: The FE strips X-View-As-Uid from write requests for privileged users
 * who retain action authority. The BE-side write block is defense in depth
 * — it ensures any header sent on a write is rejected, regardless of role.
 *
 * Place AFTER requireAuth, BEFORE requireRole + handler.
 */
import { Response, NextFunction } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest } from "./auth";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

export async function viewAs(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const actingUid = req.user?.uid;
  if (!actingUid) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  req.actingUserId = actingUid;

  const viewAsHeader = req.header("X-View-As-Uid");

  // No header, or header equals self — default to own uid.
  if (!viewAsHeader || viewAsHeader === actingUid) {
    req.effectiveUserId = actingUid;
    next();
    return;
  }

  // Header set, target != self.

  // Safe-method gate (read-only enforcement at BE).
  if (!SAFE_METHODS.has(req.method)) {
    res.status(403).json({
      error: "X-View-As-Uid is read-only; cannot be set on write methods",
    });
    return;
  }

  // Validate target user exists.
  const targetDoc = await admin.firestore().collection("users").doc(viewAsHeader).get();
  if (!targetDoc.exists) {
    res.status(400).json({ error: "X-View-As-Uid: target user not found" });
    return;
  }

  req.effectiveUserId = viewAsHeader;
  next();
}
