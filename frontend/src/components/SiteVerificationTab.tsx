import { useState } from "react";
import type { SiteVerificationMap } from "../lib/api";
import {
  siteVerificationMarkLive,
  siteVerificationFlag,
  siteVerificationReverify,
} from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import SiteVerificationCard from "./SiteVerificationCard";

interface Props {
  mpn: string;
  primarySiteKey: string | null;
  siteVerification: SiteVerificationMap;
  onRefetch: () => void;
}

const ACTION_ROLES = ["product_ops", "admin", "owner"];

export default function SiteVerificationTab({
  mpn,
  primarySiteKey,
  siteVerification,
  onRefetch,
}: Props) {
  const { role } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const canAct = !!role && ACTION_ROLES.includes(role);
  const entries = Object.values(siteVerification);
  const hasAnyVerified = entries.some(
    (e) => e.verification_state !== "unverified"
  );

  async function handleMarkLive(siteKey: string) {
    setError(null);
    try {
      await siteVerificationMarkLive(mpn, siteKey);
      onRefetch();
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to mark live");
    }
  }

  async function handleFlag(siteKey: string, reason: string) {
    setError(null);
    try {
      await siteVerificationFlag(mpn, siteKey, reason);
      onRefetch();
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to flag");
    }
  }

  async function handleReverify(siteKey: string) {
    setError(null);
    try {
      await siteVerificationReverify(mpn, siteKey);
      onRefetch();
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to reverify");
    }
  }

  // Empty state — all sites unverified
  if (!hasAnyVerified) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-gray-500 italic">
          No site verification data yet.
        </p>
        <p className="text-xs text-gray-400 mt-1">
          {entries.length} site{entries.length !== 1 ? "s" : ""} registered —
          all unverified.
        </p>
        {/* Still show compact pills so the user sees which sites exist */}
        <div className="mt-4 max-w-md mx-auto flex flex-col gap-1">
          {entries.map((e) => (
            <SiteVerificationCard
              key={e.site_key}
              entry={e}
              isPrimary={e.site_key === primarySiteKey}
              canAct={false}
              onMarkLive={handleMarkLive}
              onFlag={handleFlag}
              onReverify={handleReverify}
            />
          ))}
        </div>
      </div>
    );
  }

  // Determine layout: dominant if exactly one non-unverified entry
  const verifiedEntries = entries.filter(
    (e) => e.verification_state !== "unverified"
  );
  const unverifiedEntries = entries.filter(
    (e) => e.verification_state === "unverified"
  );
  const isDominant = verifiedEntries.length === 1;

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      {isDominant ? (
        /* Dominant single-site layout: full-width card */
        <div className="flex flex-col gap-3">
          <SiteVerificationCard
            entry={verifiedEntries[0]}
            isPrimary={verifiedEntries[0].site_key === primarySiteKey}
            canAct={canAct}
            onMarkLive={handleMarkLive}
            onFlag={handleFlag}
            onReverify={handleReverify}
          />
          {/* Unverified sites as compact pills below */}
          {unverifiedEntries.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-gray-400 mt-1">Other sites</p>
              {unverifiedEntries.map((e) => (
                <SiteVerificationCard
                  key={e.site_key}
                  entry={e}
                  isPrimary={e.site_key === primarySiteKey}
                  canAct={false}
                  onMarkLive={handleMarkLive}
                  onFlag={handleFlag}
                  onReverify={handleReverify}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Multi-site grid layout */
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {verifiedEntries.map((e) => (
              <SiteVerificationCard
                key={e.site_key}
                entry={e}
                isPrimary={e.site_key === primarySiteKey}
                canAct={canAct}
                onMarkLive={handleMarkLive}
                onFlag={handleFlag}
                onReverify={handleReverify}
              />
            ))}
          </div>
          {/* Unverified sites as compact pills below the grid */}
          {unverifiedEntries.length > 0 && (
            <div className="flex flex-col gap-1 mt-3">
              <p className="text-xs text-gray-400">Other sites</p>
              {unverifiedEntries.map((e) => (
                <SiteVerificationCard
                  key={e.site_key}
                  entry={e}
                  isPrimary={e.site_key === primarySiteKey}
                  canAct={false}
                  onMarkLive={handleMarkLive}
                  onFlag={handleFlag}
                  onReverify={handleReverify}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
