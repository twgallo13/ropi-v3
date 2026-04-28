import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

/**
 * TALLY-SETTINGS-UX Phase 3 / B.0 — RoleGate
 *
 * Wrapper packaging the TALLY-134 admin/owner role gate verbatim.
 *
 * Behavior:
 *   - loading === true                   → render null (no flicker before redirect decision)
 *   - role !== "admin" && role !== "owner" → <Navigate to="/dashboard" replace />
 *   - else                               → render children
 *
 * Out of scope for B.0: the 4 existing inline RoleGate patterns are NOT migrated.
 */
export interface RoleGateProps {
  children: React.ReactNode;
}

export function RoleGate({ children }: RoleGateProps) {
  const { loading, role } = useAuth();
  if (loading) return null;
  if (role !== "admin" && role !== "owner") {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export default RoleGate;
