# TASK O — Frontend/backend contract and roles matrix

Repo @ `2698e48`; live reads against `ropi-aoss-dev`.

---

## O1 — API contract

**133 distinct paths called from `frontend/src/lib/api.ts`. All 133 resolve to a mounted backend handler — 0 broken paths** (Task I2). The mismatches below are in the **shapes**, not the routes.

| # | Mismatch | FE expects | BE returns | Evidence |
|---|---|---|---|---|
| **O1-1** | **`site_owner` means two different things on one payload.** The FE reads `detail.site_owner` as the product's site; the BE fills it from `site_targets[0].site_id` and puts the actual root `site_owner` under a **different name**, `primary_site_key` | `ProductDetail.site_owner` ([api.ts:102](frontend/src/lib/api.ts#L102)) | `site_owner: site_targets.length > 0 ? site_targets[0].site_id : ""` ([products.ts:921](backend/functions/src/routes/products.ts#L921)); `primary_site_key: data.site_owner` ([:922](backend/functions/src/routes/products.ts#L922)) | **Live: diverges on 17 of 81 products** |
| **O1-2** | **`status` is on the wire and typed, but rendered nowhere** — and it contradicts `completion_state` | `ProductDetail.status: string` ([api.ts:96](frontend/src/lib/api.ts#L96) area) | `status: data.status \|\| ""` ([products.ts:910](backend/functions/src/routes/products.ts#L910)) next to `completion_state` ([:918](backend/functions/src/routes/products.ts#L918)) | Live: `{Complete: 61, Incomplete: 15}` vs `{incomplete: 81}` |
| **O1-3** | **`required_for_completion` is returned and typed but never consumed** | `AttributeRegistryEntry.required_for_completion: boolean` ([api.ts:334](frontend/src/lib/api.ts#L334)) | returned by `GET /attribute_registry` | `ProductDetailPage.tsx:826-840` never passes it to `AttributeField`, which has no `required` prop ([AttributeField.tsx:23-36](frontend/src/components/AttributeField.tsx#L23-L36)). **This is G5-1** |
| **O1-4** | **`is_editable` is optional on the FE type, unset on 76 of 96 BE docs** | `is_editable?: boolean` ([api.ts:343](frontend/src/lib/api.ts#L343)) | live: `false` ×5, `true` ×15, **`undefined` ×76** | Only `ProductDetailPage.tsx:814` checks it, with strict `=== false`. **This is G2** |
| **O1-5** | **The import `Family` union covers 2 of the 5 live import families** | `uploadImport(family: "full-product" \| "weekly-operations", …)` ([api.ts:662](frontend/src/lib/api.ts#L662)) | 5 import routers are mounted | The other 3 have bespoke `api.ts` functions (`salesUpload`, MAP, site-verification) rather than the generic one — a contract split, not a break |
| **O1-6** | **`import_batches.summary.orphans` is returned and never read** | no FE type or reference | written at [importFullProduct.ts:1104-1108](backend/functions/src/routes/importFullProduct.ts#L1104-L1108) | `grep -rn "orphans" frontend/src` → **no matches**. **This is M3-14** |
| **O1-7** | **`launchNotifier` return values are discarded by their only callers** | n/a | `{sent: boolean, reason?: string}` | `launches.ts:526`, `:645`, `:730` are bare `await`s. **This is M3-1** |
| **O1-8** | **`fallback_model_key` / `fallback_provider_key` are stored and returned but never read** | typed on the AI routing entry | `null` on all 9 live `ai_workflow_routing` docs | `grep` finds no reader in `lib/aiConfig.ts` — the only fallback is the hardcoded `SEEDED_DEFAULT` |
| **O1-9** | **`GET /admin/ai/workflows` has no FE caller at all** | — | 3 handlers ([aiPlane.ts:350](backend/functions/src/routes/aiPlane.ts#L350), [:374](backend/functions/src/routes/aiPlane.ts#L374), [:401](backend/functions/src/routes/aiPlane.ts#L401)) | The P1-4 gap |
| **O1-10** | **`POST /buyer-actions/custom-price` and `/step-override` have no FE wrapper**, despite complete services behind them | — | [buyerActions.ts:242](backend/functions/src/routes/buyerActions.ts#L242), [:296](backend/functions/src/routes/buyerActions.ts#L296) | Task I1 |
| **O1-11** | **`GET /` on 7 admin collection routers returns a list the page can render, but 5 of the 6 collections are empty live** | `ExportProfileEntry[]` etc. | `{[]}` | Contract is honest; the data is absent (Task P5-1) |
| **O1-12** | **`X-View-As-Uid` is a request header with no type-level contract** | set by FE cockpit "View As" bar ([ViewAsBar.tsx](frontend/src/components/cockpit/ViewAsBar.tsx)) | consumed by [viewAs.ts:41](backend/functions/src/middleware/viewAs.ts#L41) | The middleware comment (`:16-18`) says the **FE** is responsible for stripping it on writes for privileged users — a contract enforced on the client |

**12 contract mismatches, 0 broken paths.** The dominant pattern is not "the FE reads a field the BE never returns" — it is **"the BE returns a field the FE never reads"** (O1-2, O1-3, O1-6, O1-8) or **"the same name means two things"** (O1-1).

---

## O2 — Roles matrix

### The two structural facts that shape every cell

1. **`requireRole` auto-appends `admin` and `owner`** — [roles.ts:30](backend/functions/src/middleware/roles.ts#L30): `[...allowed, "admin", "owner"]`. **Every gated route is reachable by `admin` and `owner`.** That is the **auto-pass** column.
2. **Named role constants** resolve as follows (extracted from all 47 routers):

| Constant | File | Members |
|---|---|---|
| `rolesAllowed` | adminSmartRules.ts | `admin` |
| `rolesAllowed` | cadenceRules.ts | `buyer`, `head_buyer`, `admin` |
| `EXEC_ROLES` | cadenceRules.ts | `admin`, `owner`, `head_buyer` |
| `reviewRoles` | buyerReview.ts, reviewActiveOverrides.ts | `buyer`, `head_buyer`, `admin` |
| `PRIVILEGED_ACTOR_ROLES` | buyerReview.ts | `head_buyer`, `admin`, `owner` |
| `buyerRoles` | cadenceReview.ts | `buyer`, `head_buyer`, `admin` |
| `viewerRoles` | mapReview.ts | `buyer`, `map_analyst`, `head_buyer` |
| `resolverRoles` | mapReview.ts | `map_analyst`, `head_buyer` |
| `viewRoles` | pricingDiscrepancy.ts | `buyer`, `operations_operator`, `head_buyer` |
| `resolveRoles` | pricingDiscrepancy.ts | `buyer`, `head_buyer` |
| `viewRoles` | siteVerificationReview.ts | `operations_operator`, `product_ops`, `buyer`, `head_buyer` |
| `operatorRoles` | siteVerificationImport.ts | `operations_operator`, `product_ops` |
| `LAUNCH_EDITOR_ROLES` | launches.ts | `content_manager`, `launch_lead`, `admin` |
| `ALLOWED_ROLES` | adminUsers.ts | all 10 |

### Matrix — route group × role

**A** = allowed by the declared list · **auto** = reachable only via the `roles.ts:30` admin/owner append · **—** = denied · **open** = no gate at all.

| Route group | admin | owner | head_buyer | buyer | map_analyst | operations_operator | product_ops | completion_specialist | content_manager | launch_lead |
|---|---|---|---|---|---|---|---|---|---|---|
| `GET /products`, `/products/:mpn`, history, comments, export.csv (`requireAuth`) | A | A | A | A | A | A | A | A | A | A |
| `POST /products/:mpn/attributes/:key` (`requireAuth`) | A | A | A | A | A | A | A | A | A | A |
| `DELETE /products/:mpn`, `/products/bulk-delete`, `/bulk/assign-support` | A | A | — | — | — | — | — | — | — | — |
| `POST /products/bulk/markdown` | A | A | A | A | — | — | — | — | — | — |
| AI content ×8 (`/ai-describe`, `/content-versions/*`, `/ai-assistant`) | A | auto | — | — | — | **A** | — | **A** | — | — |
| `GET /buyer-review` (+ `viewAs`) | A | A | A | A | — | — | — | — | — | — |
| `GET /buyer-review/price-projection/:mpn` | A | auto | A | A | — | — | — | — | — | — |
| `POST /buyer-actions/*` ×6 (`requireAuth` only) | A | A | A | A | **A** | **A** | **A** | **A** | **A** | **A** |
| `/cadence-rules/*` ×5 | A | auto | A | A | — | — | — | — | — | — |
| `/cadence-assignments/*` ×3 | A | auto | A | A | — | — | — | — | — | — |
| `/map-review/conflicts`, `/removals` (+ `viewAs`) | auto | auto | A | A | A | — | — | — | — | — |
| `/map-review/*/resolve` ×2 | auto | auto | A | — | A | — | — | — | — | — |
| `/imports/map-policy/*` ×4 | auto | auto | — | — | A | — | — | — | — | — |
| `/imports/site-verification/*` ×2 | auto | auto | — | — | — | A | A | — | — | — |
| `/site-verification/*` ×4 | auto | auto | A | A | — | A | A | — | — | — |
| `/pricing/discrepancy` GET (+ `viewAs`) | auto | auto | A | A | — | A | — | — | — | — |
| `/pricing/discrepancy/:mpn/resolve` | auto | auto | A | A | — | — | — | — | — | — |
| `/exports/*` ×4 | auto | auto | A | — | — | — | — | — | — | — |
| `/exports/pricing/queue`, `/jobs` (`requireAuth`) | A | A | A | A | A | A | A | A | A | A |
| `POST /exports/pricing/trigger` | auto | auto | — | — | — | **A** | — | — | — | — |
| `/executive/health`, `/throughput` | auto | auto | A | — | — | — | — | — | — | — |
| `/executive/channel-disparity`, `/buyer-performance*` | auto | auto | A | A | — | — | — | — | — | — |
| `/executive/jobs/weekly-snapshots`, `/buyer-performance` | A | auto | — | — | — | — | — | — | — | — |
| `/executive/jobs/weekly-advisory` | A | auto | A | — | — | — | — | — | — | — |
| `/launches/` GET, `/upcoming`, `/:id`, `/:id/comments` (`requireAuth`) | A | A | A | A | A | A | A | A | A | A |
| `/launches/` POST, PATCH, publish, images, token-status, DELETE ×6 | A | auto | — | — | — | — | — | — | **A** | **A** |
| `/launches/public`, `/subscribe`, `/unsubscribe` | **open** | **open** | **open** | **open** | **open** | **open** | **open** | **open** | **open** | **open** |
| `/review/active-overrides` | A | auto | A | A | — | — | — | — | — | — |
| `/admin/smart-rules/*` ×6 | A | auto | — | — | — | — | — | — | — | — |
| `/admin/prompt-templates/*` ×5 | A | auto | — | — | — | — | — | — | — | — |
| `/admin/users/*` ×7, `/admin/ai/*` ×9, `/admin/settings*` ×3, `/admin/role-permissions` | A | A | — | — | — | — | — | — | — | — |
| `/admin/cadence/run-evaluation` | A | auto | — | — | — | — | — | — | — | — |
| Registry POST/PUT/DELETE (attribute, brand, department, site) ×12 | A | A | — | — | — | — | — | — | — | — |
| Registry GET ×7 (`requireAuth`) | A | A | A | A | A | A | A | A | A | A |
| 7 admin collections — GET ×14 (`requireAuth`) | A | A | A | A | A | A | A | A | A | A |
| 7 admin collections — POST/PUT/DELETE ×21 | A | A | — | — | — | — | — | — | — | — |
| `/admin/guided-tours` ×5, `/tours/:hub` | A | A | GET only | GET only | GET only | GET only | GET only | GET only | GET only | GET only |
| `/notifications/*` ×5, `/users/*` ×3, `/dashboard`, `/queue/stats`, `/advisory/*` ×3, `/imports/status*` ×3 (`requireAuth`) | A | A | A | A | A | A | A | A | A | A |
| 7 import/enrich routes (full-product, weekly-ops, sales, ai-enrich) | **open** | **open** | **open** | **open** | **open** | **open** | **open** | **open** | **open** | **open** |
| `/internal/jobs/*` ×3 | — | — | — | — | — | — | — | — | — | — (OIDC only) |

### Routes a role can reach in nav but is denied by the API

**`Sidebar.tsx` performs no role filtering** — every entry in its nav tree ([:25-138](frontend/src/components/Sidebar.tsx#L25-L138)) renders for every logged-in user, and **only 1 of 69 `App.tsx` routes is `RoleGate`-wrapped** (`/admin/component-demo`, `:225-231`). So the answer is: **nearly every nav item, for nearly every non-admin role.**

The ones that matter, with live user counts:

| Nav entry | Route | API gate | Roles that see it and get 403 | Live users affected |
|---|---|---|---|---|
| **Executive Dashboard** | `/executive` | `head_buyer` | buyer, map_analyst, product_ops, operations_operator, completion_specialist, content_manager, launch_lead | **7 of 14** (4 buyer, 2 product_ops, 1 map_analyst) |
| Buyer Performance | `/buyer-performance` | `buyer`, `head_buyer` | map_analyst, product_ops, + 4 more | **3 of 14** |
| MAP Policy | `/map-policy` | `buyer`, `map_analyst`, `head_buyer` | product_ops, operations_operator, completion_specialist, content_manager, launch_lead | **2 of 14** (product_ops) |
| Export Center | `/export-center` | `head_buyer` (4 routes) | buyer, map_analyst, product_ops, + 4 | **7 of 14** |
| Launch Admin | `/launch-admin` | list is `requireAuth`; **all 6 mutations** are `LAUNCH_EDITOR_ROLES` | buyer, head_buyer, map_analyst, product_ops, operations_operator, completion_specialist | **8 of 14** can open it and edit nothing |
| All 6 Admin pillars + 20 admin pages | `/admin/*` | `admin`/`owner` on every mutation | all 8 non-admin roles | **8 of 14** |
| Site Verification | `/site-verification` | `operations_operator`, `product_ops`, `buyer`, `head_buyer` | map_analyst, completion_specialist, content_manager, launch_lead | **1 of 14** (map_analyst) |

### Comparison with what the Permissions page displays

[PermissionsPage.tsx:37](frontend/src/pages/PermissionsPage.tsx#L37) reads `GET /api/v1/admin/role-permissions`, which serves [rolePermissions.ts:16-29](backend/functions/src/lib/rolePermissions.ts#L16-L29) — a **hand-maintained** list (its own header at `:5` says "codegen DROPPED"). It renders **10 rows of `{role, source, representative_ref}`** and nothing else.

**Three things the page cannot show:**
1. **No route column.** It lists roles, not what they can reach — so it cannot be compared to the matrix above.
2. **No admin/owner bypass column.** The single most important fact about the authorisation model (`roles.ts:30`) is invisible on the page whose job is to explain the authorisation model.
3. **It can drift silently.** `representative_ref` values are handwritten line pointers (e.g. `"cadenceRules.ts:18"`, `"mapReview.ts:19"`, `"aiContent.ts:21"`) that nothing verifies. Spot-checking `adminUsers.ts:30` — the cited ref for both `admin` and `owner` — that line is `const LEGACY_PORTFOLIO_FIELDS = [...]`, **not a `requireRole` call**. At least one of the 10 references is already stale.

### Two authorisation findings that the matrix cannot express

- **`POST /buyer-actions/*` ×6 are `requireAuth` only.** Markdown, hold, save-for-season, postpone-review, custom-price and step-override are reachable by **all 10 roles**, including `completion_specialist` and `launch_lead`. `frontend/src/lib/roleGates.ts:40-50` restricts them to 4 roles **client-side only**, with the BE reality documented honestly in its own comments (`:17`, `:21`).
- **`X-View-As-Uid` (O1-12 / H6-8)** makes 4 GET routes read as **another user**, with no impersonation check ([viewAs.ts:28-69](backend/functions/src/middleware/viewAs.ts#L28-L69)). On `GET /buyer-review` the effective user's role drives `isAdminGlobal` ([buyerReview.ts:38-46](backend/functions/src/routes/buyerReview.ts#L38-L46)), so a `buyer` can obtain the **admin-global unfiltered sweep** (`:74-80`) by naming a `head_buyer`. The matrix row says "buyer: A"; it cannot express that the buyer chooses their own scope.

---

## O3 — Registry-driven vs hardcoded UI

| Surface | Source | Verdict |
|---|---|---|
| Product List — Brand filter | `fetchBrandRegistry(true)` → `{value: brand_key, label: display_name}` | **Registry** ✓ with a 3-part failure contract |
| Product List — Department filter | `fetchDepartmentRegistry(true)` | **Registry** ✓ |
| Product List — Site filter | `fetchSiteRegistry(true)` | **Registry** ✓ |
| **Completion Queue — Brand filter** | **free-text `<input>`** ([CompletionQueuePage.tsx:290-295](frontend/src/pages/CompletionQueuePage.tsx#L290-L295)) | **HARDCODED (none)** — G-NEW-1 |
| **Completion Queue — Department filter** | **free-text `<input>`** ([:297-303](frontend/src/pages/CompletionQueuePage.tsx#L297-L303)) | **HARDCODED (none)** — G-NEW-2 |
| Completion Queue — Site filter | `fetchSiteRegistry(true)` ([:256-285](frontend/src/pages/CompletionQueuePage.tsx#L256-L285)) | **Registry** ✓ — the same page gets one of three right |
| Product Detail — all attribute dropdowns | `attribute_registry.dropdown_options`, or `dropdown_source` → one of 3 registries ([AttributeField.tsx:82-95](frontend/src/components/AttributeField.tsx#L82-L95)) | **Registry** ✓ |
| **Product Detail — Website field** | `attribute_registry/website.dropdown_options` — a **hardcoded literal list of 7 domains, 4 of them inactive sites** | **HARDCODED** — G3-1 |
| Quick Edit — Brand / Department / Site | 3 registries | **Registry** ✓ |
| Smart Rule Builder — condition/action fields | `attribute_registry`, **plus 2 injected literals** (`brand_key`, `department_key`) at [SmartRuleBuilderPage.tsx:186-189](frontend/src/pages/SmartRuleBuilderPage.tsx#L186-L189) | **Mixed** — and `brand_key` has no registry doc, so rules on it silently no-op (G-NEW-7) |
| Smart Rule Builder — operator list | hardcoded ([adminSmartRules.ts:24](backend/functions/src/routes/adminSmartRules.ts#L24) mirrored client-side) | **HARDCODED** (reasonable) |
| Smart Rule Builder — RICS source fields | hardcoded `SOURCE_INPUT_FIELDS` ([:52-53](frontend/src/pages/SmartRuleBuilderPage.tsx#L52-L53)) | **HARDCODED** — and uses the `rics_*_description` spellings that `aiDescribe.ts:16-17` does *not* exclude (E9) |
| Cadence Rules Admin — filter fields | hardcoded allowlist ([CadenceRulesAdminPage.tsx:25-30](frontend/src/pages/CadenceRulesAdminPage.tsx#L25-L30)); **values** from 3 registries | **Mixed** |
| Brand Registry Admin — `default_site_owner` | `fetchSiteRegistry` ([:361](frontend/src/pages/BrandRegistryAdminPage.tsx#L361)) | **Registry** ✓ — but the group order is a hardcoded comment (`:115`) |
| Attribute Registry Admin — enum-source select | hardcoded 3 options ([:55-57](frontend/src/pages/AttributeRegistryAdminPage.tsx#L55-L57)) mirroring `ALLOWED_DROPDOWN_SOURCES` | **HARDCODED, duplicated** |
| **User Management — role list** | `GET /admin/users/role-options` → `adminUsers.ts ALLOWED_ROLES` (all 10) | **Registry-ish** ✓ — server-sourced, though the array itself is a code constant |
| **Permissions page — role list** | `GET /admin/role-permissions` → `lib/rolePermissions.ts` | **HARDCODED**, hand-maintained, no route column |
| User Portfolio Editor — brand/dept/site options | 3 registries ([UserPortfolioEditor.tsx:82](frontend/src/components/admin/UserPortfolioEditor.tsx#L82)) | **Registry** ✓ — but submits `brand_key` while the validator checks doc ids (G-NEW-9) |
| Portfolio Exclusions Editor — dimensions | hardcoded 6 ([PortfolioExclusionsEditor.tsx:5](frontend/src/components/admin/PortfolioExclusionsEditor.tsx#L5)) mirroring `EXCLUSION_DIMENSIONS` | **HARDCODED, duplicated** |
| AI Content Review — site tabs | `fetchSiteRegistry(true)` ([:67-77](frontend/src/pages/AIContentReviewPage.tsx#L67-L77)) | **Registry** ✓ |
| `SiteBadge` colours | `site_registry.badge_color` ([SiteBadge.tsx:7](frontend/src/components/SiteBadge.tsx#L7)) | **Registry** ✓ |
| Import Hub — site dropdown | `fetchSiteRegistry(true)` ([ImportHubPage.tsx:722](frontend/src/pages/ImportHubPage.tsx#L722)) | **Registry** ✓ |
| Import Hub — MAP target fields | `GET /imports/map-policy/templates` → `MAP_TARGET_FIELDS` ([mapImport.ts:33](backend/functions/src/routes/mapImport.ts#L33)) | **HARDCODED** (server-sourced) |
| Sidebar nav tree | fully hardcoded ([Sidebar.tsx:25-138](frontend/src/components/Sidebar.tsx#L25-L138)) | **HARDCODED**, and **not role-filtered** |
| Product List / Cockpit — status filter values | hardcoded `completion_state` and `pricing_domain_state` literals | **HARDCODED** — 9 pricing states in code, no registry |
| Guided Tours / SOP Panels — hub list | hardcoded 5, **duplicated** in `guidedTours.ts:38` and `sopPanels.ts:24` | **HARDCODED, duplicated** |
| Launch Admin — Brand | **free-text `<input>`** ([LaunchAdminListPage.tsx:267-268](frontend/src/pages/LaunchAdminListPage.tsx#L267-L268)) | **HARDCODED (none)** — G-NEW-12 |

**Tally: 12 registry-driven · 12 hardcoded · 3 mixed.**

The pattern is consistent and instructive: **the registry-driven surfaces are the newer ones** (Product List Phase 0.5/1, Quick Edit, AttributeField's 3-source extension, AI Content Review's TALLY-124 tabs), and the hardcoded ones are either **older surfaces that were never migrated** (Completion Queue Brand/Department, Launch Admin Brand) or **lists that live in code by design** (operators, roles, tabs). The two that are genuinely wrong rather than merely old are `website`'s frozen option list (which includes inactive sites) and the Completion Queue's two free-text filters (which cannot match).

---

## Summary

| Item | Result |
|---|---|
| `api.ts` paths | **133** — **0 broken** |
| Contract mismatches | **12** — mostly "BE returns a field the FE never reads" or "one name, two meanings" |
| Canonical roles | **10** |
| Roles with a live holder | **6** (`admin` 5, `buyer` 4, `product_ops` 2, `owner` 1, `head_buyer` 1, `map_analyst` 1) |
| Roles with **no** live holder | **4** — `operations_operator`, `completion_specialist`, `content_manager`, `launch_lead` |
| Routes reachable by `admin`/`owner` | **all 202** (via `roles.ts:30`) |
| Routes gated `requireAuth` only (all 10 roles) | **36** — including **all 6 `POST /buyer-actions/*`** |
| Routes with no gate | **13** |
| Routes accepting `X-View-As-Uid` with no impersonation check | **4** |
| Nav entries visible to roles the API denies | **effectively all of them** — `Sidebar.tsx` does no role filtering; 1 of 69 routes is `RoleGate`-wrapped |
| Registry-driven UI lists | **12** · hardcoded **12** · mixed **3** |

### The three worst

1. **The Permissions page cannot describe the authorisation model.** It shows 10 roles and no routes, omits the `admin`/`owner` universal bypass entirely, and at least one of its 10 hand-written `representative_ref` line pointers (`adminUsers.ts:30`) already points at the wrong line.
2. **All 6 `POST /buyer-actions/*` routes are `requireAuth` only** — every role, including `launch_lead` and `completion_specialist`, can post a markdown, a hold, or a custom price. The restriction exists only in `frontend/src/lib/roleGates.ts`, which says so plainly in its own comments.
3. **`X-View-As-Uid` lets the caller choose their own read scope** on 4 routes, and on `GET /buyer-review` that choice determines whether they get the portfolio-filtered path or the admin-global sweep.
