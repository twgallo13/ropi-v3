/**
 * Track 3 D11 — View As middleware.
 *
 * Reads `X-View-As-Uid` header. Behavior:
 *   - Header absent: req.effectiveUserId = req.user.uid. Default.
 *   - Header set + caller role in {head_buyer, admin, owner} + safe method:
 *       req.effectiveUserId = <header value>.
 *   - Header set + caller not privileged: 403.
 *   - Header set + write method: 403 (read-only audit).
 *   - Header set + target user not found: 400.
 *
 * Always sets req.actingUserId = req.user.uid for downstream audit logging.
 * Place AFTER requireAuth, BEFORE requireRole + handler.
 */
import { Response, NextFunction } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest } from "./auth";

const VIEW_AS_PRIVILEGED_ROLES = ["head_buyer", "admin", "owner"];
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
  if (!viewAsHeader) {
    req.effectiveUserId = actingUid;
    next();
    return;
  }

  // Header set — validate.
  if (!SAFE_METHODS.has(req.method)) {
    res.status(403).json({
      error: "X-View-As-Uid is read-only; cannot be set on write methods",
    });
    return;
  }

  // Resolve caller role (claim first, Firestore fallback).
  let role = (req.user as any)?.role as string | undefined;
  if (!role) {
    const userDoc = await admin.firestore().collection("users").doc(actingUid).get();
    role = userDoc.data()?.role;
  }
  if (!role || !VIEW_AS_PRIVILEGED_ROLES.includes(role)) {
    res.status(403).json({
      error: "Insufficient privileges to use X-View-As-Uid",
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
