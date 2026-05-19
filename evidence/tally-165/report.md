# TALLY-165 — Buyer workflow nav consolidation + MAP Policy tab page

**Tally ID:** TALLY-165
**Scope:** Frontend-only. No backend, schema, or permission changes.
**Dispatch summary:** Clean up duplicate/stale Buyer workflow navigation,
rename Buyer Review → Buyer Cockpit, route Cadence Review and Pricing
Discrepancy into Buyer Cockpit, and combine MAP Conflict + MAP Removal into
a single MAP Policy page with tabs.

---

## Verified

1. **Sidebar duplicate cleanup + rename** — [frontend/src/components/Sidebar.tsx](frontend/src/components/Sidebar.tsx)
   - Inventory Workspace group: removed standalone "Cadence Review" entry;
     "Buyer Review" renamed to **Buyer Cockpit** at `/buyer-review`.
   - Product Operations group: removed "MAP Conflict", "MAP Removal", and
     "Pricing Discrepancy" entries; added single **MAP Policy** entry at
     `/map-policy`.
   - TALLY-165 comments document the consolidation in-source.

2. **Buyer Cockpit page reads `?tab=` for deep links** —
   [frontend/src/pages/BuyerReviewPage.tsx](frontend/src/pages/BuyerReviewPage.tsx)
   - Added `useSearchParams` import.
   - Initial `activeTab` honors `?tab=cadence|map|pricing` (default
     `cadence`). New `handleTabChange` callback keeps the URL in sync via
     `setSearchParams({ tab }, { replace: true })`.
   - Tab strip already labels: "Cadence Review" / "MAP Conflicts" /
     "Pricing Discrepancies"; H1 already reads "Buyer Cockpit". No copy
     change needed.

3. **MAP Policy consolidation shell created** —
   [frontend/src/pages/MapPolicyPage.tsx](frontend/src/pages/MapPolicyPage.tsx)
   (new file)
   - H1 "MAP Policy"; tab strip "MAP Conflict" / "MAP Removal" driven by
     `?tab=conflict|removal` (default `conflict`).
   - Renders existing `<MapConflictReviewPage />` and
     `<MapRemovalReviewPage />` verbatim inside each tab panel to preserve
     all data fetching, action handlers, and permission behavior.

4. **Routes + legacy redirects** — [frontend/src/App.tsx](frontend/src/App.tsx)
   - Added: `<Route path="/map-policy" element={<MapPolicyPage />} />`.
   - Legacy `/map-conflict-review` and `/map-removal-review` now
     `<Navigate>` to `/map-policy?tab=conflict|removal` (preserves
     bookmarks + Dashboard KPI tile deep links).
   - `/pricing-discrepancy` now `<Navigate>` to
     `/buyer-review?tab=pricing`; `/pricing-discrepancy-legacy` retains
     the original `PricingDiscrepancyPage` as a fallback.
   - `/cadence-review` redirect (pre-existing) → `/buyer-review` (cadence
     is the default tab).
   - Removed unused direct imports of `MapConflictReviewPage` /
     `MapRemovalReviewPage` from `App.tsx` (they are now imported by
     `MapPolicyPage`); kept `PricingDiscrepancyPage` for the
     `/pricing-discrepancy-legacy` fallback.

5. **Dashboard KPI tiles route to consolidated destinations** —
   [frontend/src/pages/DashboardPage.tsx](frontend/src/pages/DashboardPage.tsx)
   - `cadence_review_count.route` → `/buyer-review?tab=cadence`
   - `map_conflict_count.route` → `/map-policy?tab=conflict`
   - `pricing_discrepancy_count.route` → `/buyer-review?tab=pricing`

6. **Command bar (⌘K) updated** —
   [frontend/src/components/CommandBar.tsx](frontend/src/components/CommandBar.tsx)
   - "Buyer Cockpit" (`/buyer-review`).
   - "Cadence Review (Buyer Cockpit)" (`/buyer-review?tab=cadence`).
   - "MAP Policy" (`/map-policy`); plus "MAP Conflict (MAP Policy)" and
     "MAP Removal (MAP Policy)" deep links.
   - "Pricing Discrepancy (Buyer Cockpit)" (`/buyer-review?tab=pricing`).

7. **Permissions preserved** — all routes remain wrapped by
   `<RequireAuth />` + `<Layout />` in `App.tsx`; the new `MapPolicyPage`
   composes existing page components, which retain their original
   permission gating. No backend/role changes.

8. **Build green** — `npm run build` from `frontend/`:
   ```
   ✓ 909 modules transformed.
   dist/assets/index-CWcTnRcU.css     44.84 kB
   dist/assets/index-DnfTneNS.js   1,626.93 kB
   ✓ built in 6.05s
   ```

9. **Deployed to ropi-aoss-dev** — `bash scripts/deploy-dev.sh`:
   - Hosting: <https://ropi-aoss-dev.web.app>
   - Hosting bundle: `dist/assets/index-DnfTneNS.js`
   - Cloud Run revision: `ropi-aoss-api-00237-f8r` (no backend changes
     this Tally; revision rolled as part of the standard deploy script).
   - Firestore rules / indexes / storage rules: unchanged content,
     re-released as part of the standard script.

---

## Blocker

None.

---

## Evidence (file + line ranges)

| Concern | File | Lines |
| --- | --- | --- |
| Sidebar nav tree (Buyer Cockpit, MAP Policy consolidation) | [frontend/src/components/Sidebar.tsx](frontend/src/components/Sidebar.tsx) | search `TALLY-165` |
| Buyer Cockpit `?tab=` wiring | [frontend/src/pages/BuyerReviewPage.tsx](frontend/src/pages/BuyerReviewPage.tsx) | search `TALLY-165` |
| MAP Policy shell (new file) | [frontend/src/pages/MapPolicyPage.tsx](frontend/src/pages/MapPolicyPage.tsx) | whole file |
| Routes + legacy redirects + import cleanup | [frontend/src/App.tsx](frontend/src/App.tsx) | search `TALLY-165` |
| Dashboard KPI routes | [frontend/src/pages/DashboardPage.tsx](frontend/src/pages/DashboardPage.tsx) | `KPI_DEFS` (≈L8–L20) |
| Command bar nav commands | [frontend/src/components/CommandBar.tsx](frontend/src/components/CommandBar.tsx) | search `TALLY-165` |

### PO smoke-test checklist (dev: <https://ropi-aoss-dev.web.app>)
- Sidebar Inventory Workspace shows: Completion Queue, **Buyer Cockpit**,
  Cadence Unassigned, Channel Disparity. No standalone "Cadence Review",
  no "Buyer Review" label.
- Sidebar Product Operations shows: Import Hub, Export Center, Launch
  Admin, **MAP Policy**, Site Verification, Review Active Overrides.
  No standalone "MAP Conflict", "MAP Removal", or "Pricing Discrepancy".
- `/map-policy` loads with two tabs ("MAP Conflict" / "MAP Removal").
  `/map-conflict-review` redirects to `/map-policy?tab=conflict`;
  `/map-removal-review` redirects to `/map-policy?tab=removal`.
- `/buyer-review` loads as **Buyer Cockpit** with three tabs (Cadence
  Review, MAP Conflicts, Pricing Discrepancies).
  `/cadence-review` redirects to `/buyer-review`;
  `/pricing-discrepancy` redirects to `/buyer-review?tab=pricing`.
- Dashboard KPI tiles (Cadence Review, MAP Conflict, Pricing
  Discrepancy) deep-link into the correct consolidated tab.
- ⌘K command bar shows Buyer Cockpit / MAP Policy and their tab deep
  links.

---

## Anomalies

- `frontend/src/components/Layout.tsx` `HUB_MAP` still references
  `/cadence-review` for telemetry hub naming. Since `/cadence-review` is
  preserved as a redirect to `/buyer-review`, the user will momentarily
  traverse the legacy path before landing on Buyer Cockpit; the redirect
  is `replace`, so back-button behavior is preserved. Telemetry impact is
  cosmetic (hub name resolution) and out of TALLY-165 scope. **Follow-up
  Tally candidate**, not fixed here.
- Vite build warning: `useWorkState.ts` is both dynamically and
  statically imported. Pre-existing and unrelated to TALLY-165.
- Vite build warning: bundle > 500 kB. Pre-existing, unrelated to
  TALLY-165.

---

## Status

`ready-for-po-test`

Next step requested from Lisa: PO VQA on
<https://ropi-aoss-dev.web.app> against the smoke-test checklist above.
On pass, request merge dispatch (no commit/push performed in this
dispatch per Homer rules).
