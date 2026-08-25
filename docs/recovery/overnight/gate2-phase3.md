# TASK A — Gate 2 maps: Phase 3 (People)

Template per §3 TASK A. Repo @ `2698e48`; live reads against `ropi-aoss-dev`.

## Phase 3 baseline: the role and identity model

- **`requireRole(allowed)` auto-appends `admin` and `owner` to every list** — [roles.ts:30](backend/functions/src/middleware/roles.ts#L30): `const allowedWithAdmin = Array.from(new Set([...allowed, "admin", "owner"]))`. There is **no route in the system that an `admin` or `owner` cannot reach.** This is the "auto-pass" column in Task O2.
- Role resolution order: Firebase custom claim `role` ([roles.ts:33-36](backend/functions/src/middleware/roles.ts#L33-L36)) → `users/{uid}.role` ([:40-45](backend/functions/src/middleware/roles.ts#L40-L45)) → **deny 403** ([:58-61](backend/functions/src/middleware/roles.ts#L58-L61)).
- **10 canonical roles** ([rolePermissions.ts:16-29](backend/functions/src/lib/rolePermissions.ts#L16-L29)): `admin`, `owner`, `buyer`, `head_buyer`, `map_analyst`, `operations_operator`, `product_ops`, `completion_specialist` (direct `requireRole` callers) + `content_manager`, `launch_lead` (reachable only via `LAUNCH_EDITOR_ROLES` in `launches.ts:45`).
- **Live `users` — 14 docs.** Role histogram: `admin` 4 (`theo@shiekhshoes.org`, `homer@shiekhshoes.org`, `theo+13@shiekh.com`, `theo@shiekh.com`) + `step22-verify-bot` (also `admin`) · `buyer` 4 · `product_ops` 2 · `owner` 1 · `head_buyer` 1 · `map_analyst` 1. **5 of 14 users are `admin`, and admins auto-pass every gate.**
- **Live `users` — 3 of the 10 canonical roles have no holder**: `operations_operator`, `completion_specialist`, `content_manager`, `launch_lead` (4, in fact). `operations_operator` is the sole allowed role on `POST /api/v1/exports/pricing/trigger` ([pricingExport.ts:50](backend/functions/src/routes/pricingExport.ts#L50)) — reachable today only because admin/owner auto-pass.

---

## P3-1 — Buyer positions + assignments
Edit surface (from Build Plan): new collections + admin page
Fields/collections/endpoints/states this tally writes or renames: new collections; supersedes the `portfolio_*` model on `users`.
Blast radius:
  Backend readers/writers — the `portfolio_*` field family, by file (reference counts from `grep -rn "portfolio_"`):
  | Consumer | file:line | Reads/Writes | What breaks |
  |---|---|---|---|
  | Admin users CRUD + validator | [adminUsers.ts](backend/functions/src/routes/adminUsers.ts) — **78 references**; validation at [:88-91](backend/functions/src/routes/adminUsers.ts#L88-L91), dimension map at [:133-136](backend/functions/src/routes/adminUsers.ts#L133-L136), legacy hard-cut at [:31](backend/functions/src/routes/adminUsers.ts#L31)/[:171](backend/functions/src/routes/adminUsers.ts#L171), normalization at [:280](backend/functions/src/routes/adminUsers.ts#L280) | reads/**writes** `portfolio_brands`, `portfolio_depts`, `portfolio_sites`, `portfolio_age_groups`, `portfolio_gender`, `portfolio_attributes`, `portfolio_exclusions` | admin user editor 500s; portfolios unvalidated |
  | **Cadence engine** | [cadenceEngine.ts:70-96](backend/functions/src/services/cadenceEngine.ts#L70-L96) (`buildBuyerPortfolio`), [:98-130](backend/functions/src/services/cadenceEngine.ts#L98-L130) (exclusion + match), [:557](backend/functions/src/services/cadenceEngine.ts#L557) (role filter) — **36 references** | reads all 7 fields | **buyer resolution fails → every product becomes `no_buyer_match` → Unassigned.** Silent |
  | Portfolio filter lib | [portfolioFilter.ts](backend/functions/src/lib/portfolioFilter.ts) — **35 references**; [:37-38](backend/functions/src/lib/portfolioFilter.ts#L37-L38), [:51-60](backend/functions/src/lib/portfolioFilter.ts#L51-L60) | reads | same on the filter path |
  | Shared types | [types/cadence.ts:15-38](backend/functions/src/types/cadence.ts#L15-L38) — 7 references | type contract | compile error (loud) |
  Frontend readers/renderers: [UserManagementPage.tsx](frontend/src/pages/UserManagementPage.tsx) — 40 references · [api.ts](frontend/src/lib/api.ts) — 21 · [UserPortfolioEditor.tsx](frontend/src/components/admin/UserPortfolioEditor.tsx) — 15 · [PortfolioExclusionsEditor.tsx](frontend/src/components/admin/PortfolioExclusionsEditor.tsx) — 1.
  Scripts (seed/migration): [migrate-user-portfolio-fields.ts](scripts/migrate-user-portfolio-fields.ts) — 68 references (the `departments` → `portfolio_depts` migration) · [d3b-encode-portfolios.ts](scripts/d3b-encode-portfolios.ts) — 46 · [migrate-portfolio-gender-and-cleanup.ts](scripts/migrate-portfolio-gender-and-cleanup.ts) — 41 · [seed-team-users.js](scripts/seed-team-users.js).
  Composite indexes: NONE reference any `portfolio_*` field. `cadenceEngine.ts:557` queries `users.where("role","in",[...])`, served by an automatic single-field index.
  Security rules: **`users/{uid}` is the only collection with rules** — [firestore.rules:20-23](firebase/firestore.rules#L20-L23): `allow read: if isOwner(uid) || hasRole('admin')`, `allow write: if isOwner(uid)`. **This is the one place in the whole ruleset where a client can write**, and it means **a user can write their own `portfolio_*` fields directly from the browser, bypassing `adminUsers.ts` validation entirely.** See **FINDING A-P3-1-a**.
  Downstream consumers: cadence buyer resolution · buyer performance matrix · AI weekly advisory (per-buyer scoping) · the Buyer Cockpit queue.
  Live Firestore: **`portfolio_depts`** — 5 users have values (`["footwear"]` ×3, `["footwear","clothing","accessories"]`, `["clothing","accessories"]`), 5 have `[]`, **4 have `null`** (`anahi@`, `vanessabautista@`, `theo@shiekh.com`, `mykhailo@`). **`portfolio_exclusions.department` is absent on all 14 users** — the exclusion dimension has never been used.
Build Plan "?" markers on this tally: **"every consumer of `portfolio_*` (`lib/portfolioFilter.ts`, `services/cadenceEngine.ts`, `scripts/seed-team-cadence-rules.js`)" → CONFIRMED with corrections.**
  - The three named files are real consumers, **except `scripts/seed-team-cadence-rules.js`, which contains no `portfolio_` reference at all** (`grep -rn "portfolio_" scripts/seed-team-cadence-rules.js` → no matches). It seeds `cadence_rules` with `owner_buyer_id`, which is P3-2's field, not P3-1's. Carried to Task C.
  - **Six consumers the marker does not name**, all material: `routes/adminUsers.ts` (**78 references — the largest consumer by far**), `types/cadence.ts`, `frontend/src/pages/UserManagementPage.tsx`, `frontend/src/lib/api.ts`, `frontend/src/components/admin/UserPortfolioEditor.tsx`, `frontend/src/components/admin/PortfolioExclusionsEditor.tsx`, plus 4 scripts.
Edit-surface check: **SCOPE RISK — severe. The declared surface is "new collections + admin page"; the existing model has 11 consumer files and a live security rule that lets users self-edit.** Nothing in the declared surface touches `cadenceEngine.ts`, `portfolioFilter.ts`, `types/cadence.ts`, or `firestore.rules`. A new position/assignment model that leaves `portfolio_*` in place means two competing sources of buyer truth.

**[FINDING A-P3-1-a] `firestore.rules:22` lets any authenticated user write their own `users/{uid}` document, including `role`.**
`allow write: if isOwner(uid)` is unconditional on field. A user can set `users/{uid}.role = "admin"` from the browser SDK. `requireRole` reads the custom claim first ([roles.ts:33](backend/functions/src/middleware/roles.ts#L33)) but **falls back to exactly this Firestore field** ([:40-45](backend/functions/src/middleware/roles.ts#L40-L45)). For any user without a custom claim, self-writing `role: "admin"` grants admin on every backend route. Carried to Task H3 and H6 as the highest-severity security finding in this audit.

---

## P3-2 — Buyer routing rules (IFTTT, priority ladder)
Edit surface (from Build Plan): new rules surface reusing Smart Rule builder patterns; routing layer replacing UID lookups
Fields/collections/endpoints/states this tally writes or renames: `cadence_rules.owner_buyer_id`, `cadence_assignments.{assigned_user_id, primary_user_id, support_user_ids, candidate_user_ids}`.
Blast radius:
  Backend readers/writers:
  | Field | Consumer | file:line | Reads/Writes |
  |---|---|---|---|
  | `owner_buyer_id` | Cadence rules list — **scopes a buyer to their own rules** | [cadenceRules.ts:58](backend/functions/src/routes/cadenceRules.ts#L58) | reads (`.where("owner_buyer_id","==",uid)`) |
  | | Cadence rules create / update — **defaults to the caller's uid** | [cadenceRules.ts:93](backend/functions/src/routes/cadenceRules.ts#L93), [:167](backend/functions/src/routes/cadenceRules.ts#L167) | writes |
  | | Cadence rule type | [cadenceEngine.ts:62](backend/functions/src/services/cadenceEngine.ts#L62) | type |
  | | AI weekly advisory — per-buyer rule scope | [aiWeeklyAdvisory.ts:111](backend/functions/src/services/aiWeeklyAdvisory.ts#L111) | reads |
  | | Buyer performance matrix — per-buyer rule scope | [buyerPerformanceMatrix.ts:155](backend/functions/src/services/buyerPerformanceMatrix.ts#L155) | reads |
  | `assigned_user_id` | Import — ownership stamp | [importFullProduct.ts:1061](backend/functions/src/routes/importFullProduct.ts#L1061), [:1065](backend/functions/src/routes/importFullProduct.ts#L1065) | writes |
  | | Cadence engine | [cadenceEngine.ts:322](backend/functions/src/services/cadenceEngine.ts#L322), [:358](backend/functions/src/services/cadenceEngine.ts#L358), [:522](backend/functions/src/services/cadenceEngine.ts#L522) | writes |
  | `primary_user_id` / `support_user_ids` | 37 / 36 references across `cadenceEngine.ts`, `cadenceReview.ts`, `buyerReview.ts`, `products.ts` (bulk assign-support), `adminCadence.ts` | reads/writes |
  | `candidate_user_ids` | 4 references, `cadenceEngine.ts:325`/`:361` | writes |
  Frontend readers/renderers: [CadenceRulesAdminPage.tsx:66](frontend/src/pages/CadenceRulesAdminPage.tsx#L66), [:564](frontend/src/pages/CadenceRulesAdminPage.tsx#L564), [:730](frontend/src/pages/CadenceRulesAdminPage.tsx#L730) · [api.ts:1036](frontend/src/lib/api.ts#L1036) · the Buyer Cockpit surfaces (`CockpitDrawer`, `CockpitCadenceSection`).
  Scripts: [seed-team-cadence-rules.js:93](scripts/seed-team-cadence-rules.js#L93) (`owner_buyer_id: rule.owner`) · [d3c-cadence-cleanup.ts:3](scripts/d3c-cadence-cleanup.ts#L3), [:27](scripts/d3c-cadence-cleanup.ts#L27) (**hard-deletes rules whose `owner_buyer_id == "step22-verify-bot"`**) · [d3e-signal-augment.ts:109](scripts/d3e-signal-augment.ts#L109), [:166](scripts/d3e-signal-augment.ts#L166) (**hardcodes `owner_buyer_id: "uhD2yj4LK5XDgU2IUjmpYtbGmYd2"`**) · [step22-verify.js:67](scripts/step22-verify.js#L67) (**writes `owner_buyer_id: "step22-verify-bot"`**) · [tally-d3-e-cadence-residue-cleanup.js:108-111](scripts/tally-d3-e-cadence-residue-cleanup.js#L108-L111).
  Composite indexes: NONE reference `owner_buyer_id`, `assigned_user_id`, `primary_user_id` or `support_user_ids`. `cadenceRules.ts:58`, `aiWeeklyAdvisory.ts:111` and `buyerPerformanceMatrix.ts:155` are single-field equality queries served automatically.
  Security rules: NONE for `cadence_rules` or `cadence_assignments` (deny-all).
  Downstream consumers: cadence rule ownership scoping · buyer queue routing · advisory and performance per-buyer scoping · product ownership stamp at import.
  Live Firestore: **`cadence_rules` — 14 docs, all with `owner_buyer_id`.** Distinct owner uids: `uhD2yj4LK5XDgU2IUjmpYtbGmYd2` (4), `H745g994Q5cT28uX1upzPReHjGh1` (3), `luIV6eMbZZRWYv7mJqg3F7UJ8Hl1` (3), `v8w9ogiVBUdBHpOSNhAzhqsIkvB3` (1), `njIY4yyVSIUhchVe78g7BVN0Bx72` (1), `4hf2oKvc0igp2Sn0Mc06JjTBKXF2` (1), `6gMinTuk8LNFUxYp8yB20H6LNw83` (1). **All 7 resolve to real `users` docs** — no orphans (verified against the 14-user list; see `data-integrity.md` L1).
  One rule (`jsakAzUhKLHBW8paTSRU`) also carries a stray `assigned_user_id` field on the **rule** document and a `fixture_tally` marker — a shape no other rule has.
Build Plan "?" markers on this tally: **"every consumer of `cadence_rules.owner_buyer_id`, `assigned_user_id`, `primary_user_id`, `support_user_ids`" → CONFIRMED, full inventory above.** Counts: `owner_buyer_id` 18 references · `assigned_user_id` 8 · `primary_user_id` 37 · `support_user_ids` 36 · (`candidate_user_ids` 4, not named in the marker but part of the same resolution output).
Edit-surface check: **SCOPE RISK — "routing layer replacing UID lookups" touches at least 8 files not in a declared surface**: `routes/cadenceRules.ts` (the ownership scope query — a buyer's *entire rule list* is filtered by it), `services/cadenceEngine.ts`, `services/aiWeeklyAdvisory.ts`, `services/buyerPerformanceMatrix.ts`, `routes/importFullProduct.ts:1061`, `routes/cadenceReview.ts`, `routes/buyerReview.ts`, `routes/products.ts` (bulk assign-support). Note also that the **frozen-item list in Appendix B names buyer routing (`portfolio_*`, `owner_buyer_id`) as frozen**, so any Phase 1 tally touching these is a sequencing violation — see `sequencing.md`.

---

## P3-3 — One user record (facets, prefs, profile, roles)
Edit surface (from Build Plan): `users` model; `launch_subscribers` (3 touchpoints: `launches.ts:202`/`:233`, `launchNotifier.ts:39`); `AuthContext.tsx:31-33` role fallback; `lib/rolePermissions.ts`
Fields/collections/endpoints/states this tally writes or renames: `users` document shape; `launch_subscribers` collection; role strings.
Blast radius:
  Backend readers/writers:
  - **`launch_subscribers` — the 3 touchpoints are CONFIRMED and complete.** [launches.ts:202](backend/functions/src/routes/launches.ts#L202) (`POST /subscribe` → `.doc(clean).set(...)`, doc id **is the email**), [launches.ts:233](backend/functions/src/routes/launches.ts#L233) (`DELETE /unsubscribe` → `.doc(clean).delete()`), [launchNotifier.ts:39](backend/functions/src/services/launchNotifier.ts#L39) (`getSubscribers` → full collection scan, filters on `notification_preferences[key] !== false`, i.e. **default-true**). `grep -rn launch_subscribers` across backend + frontend returns exactly these three. **Both mutating routes are ungated** (see H1/H2) and `/subscribe` is restricted only by the regex `/^[^\s@]+@shiekh\.com$/` at [launches.ts:195](backend/functions/src/routes/launches.ts#L195).
  - **Role strings**: `requireRole([...])` appears on **~150 of the 202 route handlers** (full table in `security.md` H1). The named-role literals are concentrated in `lib/rolePermissions.ts:16-29` and in per-router constants — `LAUNCH_EDITOR_ROLES` ([launches.ts:45](backend/functions/src/routes/launches.ts#L45)), `rolesAllowed` (`adminSmartRules.ts`, `cadenceRules.ts`), `viewRoles` (`siteVerificationReview.ts`, `pricingDiscrepancy.ts`), `reviewRoles` (`buyerReview.ts`, `reviewActiveOverrides.ts`), `resolverRoles`/`viewerRoles` (`mapReview.ts`), `buyerRoles` (`cadenceReview.ts`), `operatorRoles` (`siteVerificationImport.ts`).
  - `users` readers: `roles.ts:40`, `cadenceEngine.ts:557`, `buyerPerformanceMatrix.ts:123-126`, `pricingResolution.ts:316-318` (head-buyer notification fan-out), `adminUsers.ts`, `users.ts`, `notifications.ts`.
  Frontend readers/renderers: **[AuthContext.tsx:30-35](frontend/src/contexts/AuthContext.tsx#L30-L35)** — the declared fallback; [roleGates.ts:27-50](frontend/src/lib/roleGates.ts#L27-L50) (a **hardcoded FE mirror** of 4 BE gates); [RoleGate.tsx](frontend/src/components/admin/RoleGate.tsx); [Sidebar.tsx](frontend/src/components/Sidebar.tsx); [PermissionsPage.tsx](frontend/src/pages/PermissionsPage.tsx); [UserManagementPage.tsx](frontend/src/pages/UserManagementPage.tsx); [NotificationSettingsPage.tsx](frontend/src/pages/NotificationSettingsPage.tsx).
  Scripts: [seed-team-users.js](scripts/seed-team-users.js), [migrate-user-portfolio-fields.ts](scripts/migrate-user-portfolio-fields.ts), [scripts/seed/fix-theo-org.js](scripts/seed/fix-theo-org.js), [scripts/seed/migrate-advisory-preferences.js](scripts/seed/migrate-advisory-preferences.js).
  Composite indexes: NONE on `users` or `launch_subscribers`.
  Security rules: **`users/{uid}` — the only ruled collection** ([firestore.rules:20-23](firebase/firestore.rules#L20-L23)). See FINDING A-P3-1-a. `launch_subscribers` falls to deny-all.
  Downstream consumers: every `requireRole` gate · the sidebar's visible nav · the Permissions matrix page · cadence buyer resolution · launch notification fan-out · advisory preferences.
  Live Firestore: `users` **14 docs**; `launch_subscribers` exists as a live collection.
Build Plan "?" markers on this tally: **"every consumer of role strings; every requireRole gate" → CONFIRMED.** The complete 202-row route × gate table is in `security.md` (Task H1); the role × route matrix is in `contracts-and-roles.md` (Task O2). Two structural facts that shape this tally:
  1. **`admin` and `owner` are appended to every `requireRole` list** ([roles.ts:30](backend/functions/src/middleware/roles.ts#L30)), so "every gate" is really "every gate, plus an unconditional admin/owner bypass".
  2. **`lib/rolePermissions.ts` is hand-maintained, not generated** — its own header says so at `:5` ("codegen DROPPED — see D.3 Frink correction"). It is a *description* of the gates, not their source, so it can drift from `requireRole` calls silently. Carried to Task O2.
Edit-surface check: **SCOPE RISK — 2 items outside the declared surface, one of them security-relevant.**
  1. **`firebase/firestore.rules:20-23`** is not in the surface, yet it is the only place the `users` document is writable by a client, and it is what makes `AuthContext`'s role model exploitable (FINDING A-P3-1-a). A "one user record" tally that does not touch the rules leaves that open.
  2. **`frontend/src/lib/roleGates.ts`** is a second, hardcoded copy of four backend gates (with the BE file:line pinned in comments at `:8`, `:12`, `:16`, `:20`). It is not in the surface and will silently drift.

**[FINDING A-P3-3-a] `AuthContext.tsx:31-34` invents a role for any user without a custom claim.**
```ts
// Dev fallback: if no role claim is set, default to product_ops so ops features are testable.
setRole(claimRole || "product_ops");
```
and the `catch` at `:33-35` does the same. The frontend therefore renders `product_ops` UI for a user the backend may reject with 403. It never reads `users/{uid}.role`, which is the fallback the *backend* uses ([roles.ts:40-45](backend/functions/src/middleware/roles.ts#L40-L45)) — so FE and BE can disagree about the same user in both directions. Severity: **Misleads**. Carried to Task G9 and H6.

---

## Phase 3 summary

| Tally | ? markers | Converted | Out-of-surface consumers |
|---|---|---|---|
| P3-1 | 1 | 1 CONFIRMED (with 1 correction + 6 unnamed consumers) | **11 files + `firestore.rules`** |
| P3-2 | 1 | 1 CONFIRMED | **8** |
| P3-3 | 1 | 1 CONFIRMED | **2** (`firestore.rules`, `roleGates.ts`) |
| **Total** | **3** | **3 CONFIRMED** | **~21** |

Contradiction found for Task C: Appendix B P3-1 names `scripts/seed-team-cadence-rules.js` as a `portfolio_*` consumer; that file contains no `portfolio_` reference.
