/**
 * TALLY-165 — MAP Policy consolidation shell.
 *
 * Combines the previously-standalone MAP Conflict Review and MAP Removal
 * Review pages under a single navigation entry (`/map-policy`) with two
 * tabs: "MAP Conflict" and "MAP Removal".
 *
 * The existing page components are rendered verbatim inside each tab to
 * preserve their data fetching, permission gating, action handlers, and
 * UI behavior exactly as they were prior to consolidation. No business
 * logic was duplicated or rewritten — this file is a routing/UI shell only.
 *
 * Tab selection is driven by `?tab=conflict|removal` so deep links from the
 * Dashboard KPI tile and the legacy `/map-conflict-review` /
 * `/map-removal-review` redirects land on the correct tab.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import MapConflictReviewPage from "./MapConflictReviewPage";
import MapRemovalReviewPage from "./MapRemovalReviewPage";

type MapPolicyTabId = "conflict" | "removal";

export default function MapPolicyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: MapPolicyTabId =
    tabParam === "removal" ? "removal" : "conflict";

  const setActive = useCallback(
    (next: MapPolicyTabId) => {
      const sp = new URLSearchParams(searchParams);
      sp.set("tab", next);
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">MAP Policy</h1>
        <p className="text-sm text-gray-500 mt-1">
          Review and act on MAP conflicts and MAP removals from a single
          workspace.
        </p>
      </div>

      <div className="border-b border-gray-200 mb-4">
        <nav className="-mb-px flex gap-6" aria-label="MAP Policy tabs">
          <button
            type="button"
            onClick={() => setActive("conflict")}
            className={
              "py-2 px-1 border-b-2 text-sm font-medium transition-colors " +
              (activeTab === "conflict"
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300")
            }
            aria-current={activeTab === "conflict" ? "page" : undefined}
          >
            MAP Conflict
          </button>
          <button
            type="button"
            onClick={() => setActive("removal")}
            className={
              "py-2 px-1 border-b-2 text-sm font-medium transition-colors " +
              (activeTab === "removal"
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300")
            }
            aria-current={activeTab === "removal" ? "page" : undefined}
          >
            MAP Removal
          </button>
        </nav>
      </div>

      {activeTab === "conflict" ? (
        <MapConflictReviewPage />
      ) : (
        <MapRemovalReviewPage />
      )}
    </div>
  );
}
