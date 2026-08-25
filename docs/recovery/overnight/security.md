# TASK H — Security sweep

Repo @ `2698e48`; live reads against `ropi-aoss-dev`. Route inventory built by parsing all 47 mounted routers in `backend/functions/src/routes/` against the mount table in [index.ts:78-176](backend/functions/src/index.ts#L78-L176), resolving router-level middleware (`router.use(mw)`) as well as per-handler middleware.

**202 route handlers. 13 have no gate.**

---

## H1 — Route gate inventory

### Gate summary

| Gate | Handlers |
|---|---|
| `requireAuth + requireRole([...])` | 150 |
| `requireAuth` only | 36 |
| `requireSchedulerOIDC` (router-level) | 3 |
| **NONE** | **13** |
| **Total** | **202** |

**Critical modifier:** [`roles.ts:30`](backend/functions/src/middleware/roles.ts#L30) — `const allowedWithAdmin = Array.from(new Set([...allowed, "admin", "owner"]))`. **Every `requireRole` gate silently admits `admin` and `owner`.** No route in the system is unreachable by those two roles. Live, that is **6 of 14 users** (5 `admin` + 1 `owner`).

### The 13 routes with gate NONE

| Method | Path | file:line | Marked public? |
|---|---|---|---|
| POST | `/api/v1/imports/full-product/upload` | [importFullProduct.ts:67](backend/functions/src/routes/importFullProduct.ts#L67) | **No** |
| POST | `/api/v1/imports/full-product/:batch_id/commit` | [importFullProduct.ts:175](backend/functions/src/routes/importFullProduct.ts#L175) | **No** |
| POST | `/api/v1/imports/weekly-operations/upload` | [importWeeklyOperations.ts:100](backend/functions/src/routes/importWeeklyOperations.ts#L100) | **No** |
| POST | `/api/v1/imports/weekly-operations/:batch_id/commit` | [importWeeklyOperations.ts:209](backend/functions/src/routes/importWeeklyOperations.ts#L209) | **No** |
| POST | `/api/v1/imports/sales/upload` | [importSales.ts:130](backend/functions/src/routes/importSales.ts#L130) | **No** |
| POST | `/api/v1/imports/sales/:batch_id/commit` | [importSales.ts:255](backend/functions/src/routes/importSales.ts#L255) | **No** |
| GET | `/api/v1/imports/sales/status` | [importSales.ts:471](backend/functions/src/routes/importSales.ts#L471) | **No** |
| POST | `/api/v1/ai-enrich/name/:mpn` | [aiEnrichment.ts:166](backend/functions/src/routes/aiEnrichment.ts#L166) | **No** |
| POST | `/api/v1/ai-enrich/color/:mpn` | [aiEnrichment.ts:180](backend/functions/src/routes/aiEnrichment.ts#L180) | **No** |
| POST | `/api/v1/ai-enrich/run-pending` | [aiEnrichment.ts:194](backend/functions/src/routes/aiEnrichment.ts#L194) | **No** |
| GET | `/api/v1/launches/public` | [launches.ts:128](backend/functions/src/routes/launches.ts#L128) | **Yes** — `:125` "UNAUTHENTICATED" |
| POST | `/api/v1/launches/subscribe` | [launches.ts:187](backend/functions/src/routes/launches.ts#L187) | **Yes** — `:185` "PUBLIC, @shiekh.com only" |
| DELETE | `/api/v1/launches/unsubscribe` | [launches.ts:225](backend/functions/src/routes/launches.ts#L225) | **Yes** — `:223` "PUBLIC" |

Two more handlers sit outside any router and are also ungated by design: `GET /api/v1/health` ([index.ts:68](backend/functions/src/index.ts#L68)) and `GET /` ([index.ts:179](backend/functions/src/index.ts#L179)).

### Gate distribution by router

| Router | Mount | Handlers | Gates used |
|---|---|---|---|
| `importFullProduct.ts` | `/api/v1/imports/full-product` | 2 | **NONE ×2** |
| `importWeeklyOperations.ts` | `/api/v1/imports/weekly-operations` | 2 | **NONE ×2** |
| `importSales.ts` | `/api/v1/imports/sales` | 3 | **NONE ×3** |
| `aiEnrichment.ts` | `/api/v1/ai-enrich` | 3 | **NONE ×3** |
| `importsStatus.ts` | `/api/v1/imports` | 3 | `requireAuth` ×3 |
| `products.ts` | `/api/v1/products` | 11 | `requireAuth` ×7 · `requireRole([admin,owner])` ×3 · `requireRole([admin,owner,buyer,head_buyer])` ×1 |
| `aiContent.ts` | `/api/v1/products` | 8 | `requireRole([admin,completion_specialist,operations_operator])` ×8 |
| `attributeRegistry.ts` | `/api/v1/attribute_registry` | 4 | `requireAuth` ×1 · `requireRole([admin,owner])` ×3 |
| `buyerReview.ts` | `/api/v1/buyer-review` | 2 | `requireRole` + `viewAs` ×1 · `requireRole(reviewRoles)` ×1 |
| `buyerActions.ts` | `/api/v1/buyer-actions` | 6 | **`requireAuth` only ×6** |
| `exports.ts` | `/api/v1/exports` | 4 | `requireRole([head_buyer])` ×4 |
| `pricingExport.ts` | `/api/v1/exports/pricing` | 3 | `requireAuth` ×2 · `requireRole([operations_operator])` ×1 |
| `mapImport.ts` | `/api/v1/imports/map-policy` | 4 | `requireRole([map_analyst])` ×4 |
| `mapReview.ts` | `/api/v1/map-review` | 4 | `requireRole(viewerRoles/resolverRoles)` ×4 (2 with `viewAs`) |
| `cadenceRules.ts` | `/api/v1/cadence-rules` | 5 | `requireRole(rolesAllowed)` ×5 |
| `cadenceReview.ts` | `/api/v1` | 3 | `requireRole(buyerRoles)` ×3 |
| `promptTemplates.ts` | `/api/v1/admin/prompt-templates` | 5 | `requireRole([admin])` ×5 |
| `launches.ts` | `/api/v1/launches` | 13 | **NONE ×3** · `requireAuth` ×4 · `requireRole(LAUNCH_EDITOR_ROLES)` ×6 |
| `adminSmartRules.ts` | `/api/v1/admin/smart-rules` | 6 | `requireRole(rolesAllowed)` ×6 |
| `users.ts` | `/api/v1/users` | 3 | `requireAuth` ×3 |
| `pricingDiscrepancy.ts` | `/api/v1/pricing/discrepancy` | 2 | `requireRole(viewRoles)` + `viewAs` ×1 · `requireRole(resolveRoles)` ×1 |
| `siteVerificationImport.ts` | `/api/v1/imports/site-verification` | 2 | `requireRole(operatorRoles)` ×2 |
| `siteVerificationReview.ts` | `/api/v1/site-verification` | 4 | `requireRole(viewRoles)` ×4 |
| `siteRegistry.ts` | `/api/v1/site-registry` | 4 | `requireAuth` ×1 · `requireRole([admin,owner])` ×3 |
| `brandRegistry.ts` | `/api/v1/brand-registry` | 5 | `requireAuth` ×2 · `requireRole([admin,owner])` ×3 |
| `departmentRegistry.ts` | `/api/v1/department-registry` | 5 | `requireAuth` ×2 · `requireRole([admin,owner])` ×3 |
| `notifications.ts` | `/api/v1/notifications` | 5 | `requireAuth` ×5 |
| `dashboard.ts` | `/api/v1/dashboard` | 1 | `requireAuth` ×1 |
| `executive.ts` | `/api/v1/executive` | 8 | `requireRole([head_buyer])` ×2 · `requireRole([buyer,head_buyer])` ×3 · `requireRole([admin])` ×2 · `requireRole([admin,head_buyer])` ×1 |
| `advisory.ts` | `/api/v1/advisory` | 3 | `requireAuth` ×3 |
| `tours.ts` | `/api/v1/tours` | 1 | `requireAuth` ×1 |
| `adminUsers.ts` | `/api/v1/admin/users` | 7 | `requireRole([admin,owner])` ×7 |
| `aiPlane.ts` | `/api/v1/admin/ai` | 9 | `requireRole([admin,owner])` ×9 |
| `guidedTours.ts` | `/api/v1/admin/guided-tours` | 5 | `requireRole([admin,owner])` ×4 · `requireAuth` ×1 |
| `rolePermissions.ts` | `/api/v1/admin/role-permissions` | 1 | `requireRole([admin,owner])` ×1 |
| `commentThreads.ts` · `exportProfiles.ts` · `featureToggles.ts` · `importTemplates.ts` · `launchSettings.ts` · `searchSettings.ts` · `sopPanels.ts` | `/api/v1/admin/*` | 5 each (35) | `requireAuth` ×2 (GET list, GET one) · `requireRole([admin,owner])` ×3 (POST/PUT/DELETE) — **identical shape in all 7** |
| `adminCadence.ts` | `/api/v1/admin/cadence` | 1 | `requireRole([admin])` ×1 |
| `adminSettings.ts` | `/api/v1/admin` | 3 | `requireRole([admin,owner])` ×3 |
| `queueStats.ts` | `/api/v1/queue` | 1 | `requireAuth` ×1 |
| `internalJobs.ts` | `/api/v1/internal/jobs` | 3 | **`requireSchedulerOIDC` (router-level, [:30](backend/functions/src/routes/internalJobs.ts#L30))** ×3 |
| `reviewActiveOverrides.ts` | `/api/v1/review/active-overrides` | 1 | `requireRole(reviewRoles)` ×1 |

---

## H2 — Public by design vs by accident

| Route | Verdict | Evidence |
|---|---|---|
| `GET /api/v1/launches/public` | **By design** | Comment [:125](backend/functions/src/routes/launches.ts#L125) "GET /api/v1/launches/public — UNAUTHENTICATED"; router doc header [:20](backend/functions/src/routes/launches.ts#L20); a `PUBLIC_FIELDS` allowlist at [:47-51](backend/functions/src/routes/launches.ts#L47-L51) restricts the payload; `App.tsx:139-140` mounts the page outside `RequireAuth` |
| `POST /api/v1/launches/subscribe` | **By design** | Comment [:185](backend/functions/src/routes/launches.ts#L185) "PUBLIC, @shiekh.com only"; enforced by regex at [:195](backend/functions/src/routes/launches.ts#L195) |
| `DELETE /api/v1/launches/unsubscribe` | **By design** | Comment [:223](backend/functions/src/routes/launches.ts#L223) "PUBLIC" |
| `POST /api/v1/imports/full-product/upload` | **By accident** | No comment, no marker. The sibling import families (`mapImport`, `siteVerificationImport`) are both role-gated |
| `POST /api/v1/imports/full-product/:batch_id/commit` | **By accident** | Same. This is the route that writes to `products` en masse |
| `POST /api/v1/imports/weekly-operations/upload` | **By accident** | Same |
| `POST /api/v1/imports/weekly-operations/:batch_id/commit` | **By accident** | Same |
| `POST /api/v1/imports/sales/upload` | **By accident** | Same. **Live operator surface** — `salesUpload` ([api.ts:730](frontend/src/lib/api.ts#L730)) → `SalesImportCard`, rendered at [ImportHubPage.tsx:320-322](frontend/src/pages/ImportHubPage.tsx#L320-L322) |
| `POST /api/v1/imports/sales/:batch_id/commit` | **By accident** | Same. Live — `salesCommit` ([api.ts:743](frontend/src/lib/api.ts#L743)) |
| `GET /api/v1/imports/sales/status` | **By accident** | Same. Live — `fetchSalesStatus` ([api.ts:753](frontend/src/lib/api.ts#L753)) |
| `POST /api/v1/ai-enrich/name/:mpn` | **By accident** | No marker. Writes root `products.name` + `attribute_values/name` and spends AI credit per call |
| `POST /api/v1/ai-enrich/color/:mpn` | **By accident** | Same |
| **`POST /api/v1/ai-enrich/run-pending`** | **By accident — and the worst of the set** | Reads `req.body?.limit`, capped at 100 ([:196](backend/functions/src/routes/aiEnrichment.ts#L196)), then makes **up to 200 paid AI calls** in one request ([:198-209](backend/functions/src/routes/aiEnrichment.ts#L198-L209) — two queries of `limit` each). **No frontend caller** — `grep -rn "ai-enrich" frontend/src` returns nothing for all three `ai-enrich` routes. An unauthenticated cost amplifier |

**Reachability.** These are not merely un-gated in code — they are internet-reachable. `docs/scheduled-jobs.md` ("Service account and IAM" → "Pre-existing caveat") states: *"`allUsers` also holds `roles/run.invoker` on `ropi-aoss-api` from before this work."* So the Cloud Run service accepts unauthenticated invocations and Express middleware is the only gate.

---

## H3 — Firestore rules coverage

`firebase/firestore.rules` is **30 lines in total**:

```
rules_version = '2';                                     // :1
service cloud.firestore {                                // :2
  match /databases/{database}/documents {                // :3
    function isSignedIn()  { return request.auth != null; }        // :6-8
    function isOwner(uid)  { return request.auth.uid == uid; }     // :10-12
    function hasRole(role) { return isSignedIn() && get(...users/$(request.auth.uid)).data.role == role; }  // :14-17
    match /users/{uid} {                                 // :20
      allow read:  if isOwner(uid) || hasRole('admin');   // :21
      allow write: if isOwner(uid);                       // :22
    }
    match /{document=**} { allow read, write: if false; } // :26-28
  }
}
```

**Collections with an explicit rule: 1** — `users/{uid}`.
**Collections falling to the deny-all default: all 34 others** — `_meta`, `admin_settings`, `ai_provider_registry`, `ai_workflow_routing`, `attribute_registry`, `audit_log`, `brand_registry`, `buyer_actions`, `buyer_performance`, `cadence_assignments`, `cadence_rules`, `department_registry`, `executive_projections`, `export_jobs`, `guided_tours`, `import_batches`, `launch_comments`, `launch_records`, `launch_subscribers`, `map_import_templates`, `map_policies`, `metric_snapshots`, `notifications`, `operator_throughput`, `pricing_export_jobs`, `pricing_export_queue`, `products`, `prompt_templates`, `sales_snapshots`, `site_registry`, `smart_rules`, `sop_panels`, `system_config`, `weekly_advisory_reports`.

**Does any rule grant client write access beyond `users/{uid}`? No — but `users/{uid}` itself is the problem.**

### H3-CRITICAL — `allow write: if isOwner(uid)` is unrestricted by field, and the backend trusts that field

`:22` lets any authenticated user write **any field** of their own `users/{uid}` document, including `role`.

`requireRole` resolves in this order ([roles.ts:33-45](backend/functions/src/middleware/roles.ts#L33-L45)):
1. Firebase custom claim `role`
2. **`users/{uid}.role` read from Firestore** ← the field the user can write
3. deny

So a user **without** a custom claim can set `users/{uid}.role = "admin"` from the browser SDK and, via the `:30` auto-append, gain access to **every route in the system** — including `DELETE /api/v1/products/:mpn`, `POST /api/v1/products/bulk-delete`, all registry mutations, and all `admin_settings` writes.

The same rule also permits self-editing `portfolio_brands`, `portfolio_depts`, `portfolio_sites`, `portfolio_exclusions` — bypassing the registry validation in [adminUsers.ts:88-136](backend/functions/src/routes/adminUsers.ts#L88-L136) entirely, which changes cadence buyer resolution.

Note `hasRole()` at `:14-17` reads the same self-writable field, so `:21`'s admin-read grant is self-grantable too.

**This is the highest-severity finding in the audit.**

---

## H4 — Secrets and config

### Every `process.env.*` read in `backend/functions/src`

| Env var | file:line | Required at startup? | Failure mode |
|---|---|---|---|
| `FIREBASE_STORAGE_BUCKET` | [index.ts:59](backend/functions/src/index.ts#L59) | **Yes** — passed to `admin.initializeApp()` at module load | `undefined` → Storage ops fail later, not at boot |
| `NODE_ENV` | [index.ts:71](backend/functions/src/index.ts#L71) | No — lazy, health response only | falls back to `"development"` |
| `FIREBASE_PROJECT_ID` | [index.ts:72](backend/functions/src/index.ts#L72) | No — lazy, health response only | **falls back to the hardcoded `"ropi-aoss-dev"`** |
| `PORT` | [index.ts:191](backend/functions/src/index.ts#L191) | No | falls back to `8080` |
| `SCHEDULER_OIDC_AUDIENCE` | [requireSchedulerOIDC.ts:39](backend/functions/src/middleware/requireSchedulerOIDC.ts#L39) | No — read per request | **fails closed**, 401 `SCHEDULER_OIDC_REJECTED`, log label `env_misconfigured` |
| `SCHEDULER_OIDC_INVOKER_EMAIL` | [requireSchedulerOIDC.ts:50](backend/functions/src/middleware/requireSchedulerOIDC.ts#L50) | No — per request | fails closed, same |
| `SENDGRID_API_KEY` | [emailService.ts:50](backend/functions/src/services/emailService.ts#L50) | No — lazy | **throws** (`:51-55`) |
| `SENDGRID_API_KEY` | [launchNotifier.ts:56](backend/functions/src/services/launchNotifier.ts#L56) | No — lazy | **silently skips** (`:57-63`) — opposite behaviour, same var |
| `SENDGRID_NEW_LAUNCH_TEMPLATE_ID` | [launchNotifier.ts:20](backend/functions/src/services/launchNotifier.ts#L20) | No — module-load const | `""` → silent skip at `:64-67` |
| `SENDGRID_DATE_CHANGED_TEMPLATE_ID` | [launchNotifier.ts:22](backend/functions/src/services/launchNotifier.ts#L22) | No | same |
| `SENDGRID_NEW_COMMENT_TEMPLATE_ID` | [launchNotifier.ts:24](backend/functions/src/services/launchNotifier.ts#L24) | No | same |
| `LAUNCH_NOTIFIER_FROM` | [launchNotifier.ts:25](backend/functions/src/services/launchNotifier.ts#L25) | No | falls back to hardcoded `"launches@shiekh.com"` |
| `SMTP_PASSWORD` | [emailService.ts:77](backend/functions/src/services/emailService.ts#L77) | No — lazy | nodemailer auth fails |
| **`process.env[<dynamic>]`** | [aiConfig.ts:44](backend/functions/src/lib/aiConfig.ts#L44) | No — lazy | **throws** with the var *name* in the message (`:46-48`) |

The dynamic read at `aiConfig.ts:44` resolves `api_key_env_var_name` from the `ai_provider_registry` doc, defaulting to `ANTHROPIC_API_KEY` ([:21](backend/functions/src/lib/aiConfig.ts#L21), [:228](backend/functions/src/lib/aiConfig.ts#L228)). **An admin can set that field to any string via `POST/PUT /api/v1/admin/ai/providers`** ([aiPlane.ts:145](backend/functions/src/routes/aiPlane.ts#L145), [:258-259](backend/functions/src/routes/aiPlane.ts#L258-L259)) — an arbitrary-env-var-name read. It only ever produces a *presence* check plus an error message containing the name, never the value, so it is an enumeration primitive rather than an exfiltration one. Live, `ai_provider_registry/asdfasfer` (a leftover test doc) sets it to `"test_ai_key"`.

Frontend env (all `VITE_*`, compiled into the bundle and therefore public by design): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` ([firebase.ts:5-10](frontend/src/firebase.ts#L5-L10)), `VITE_API_BASE_URL` ([api.ts:3](frontend/src/lib/api.ts#L3)).

### Is any secret logged, returned in a response, or written to Firestore?

**No — this is handled correctly, and deliberately.**
- `grep -rn -iE "console\.(log|warn|error).*\b(apiKey|api_key|password|secret|token)\b"` over `backend/functions/src` returns 2 hits, both benign (`"POST /admin/users/:uid/reset-password error:"`, `"POST /launches/:id/token-status error:"` — route labels, not values).
- Firestore stores only the **env var name**, never a key: `ai_provider_registry.api_key_env_var_name` with `api_key_source: "env_var"` ([aiPlane.ts:159-172](backend/functions/src/routes/aiPlane.ts#L159-L172)).
- `emailService.ts:5-7` documents the rule explicitly: *"SMTP password is sensitive — loaded from the SMTP_PASSWORD env var only, never from Firestore."*
- `SmtpSettingsPage.tsx:223-224` tells the operator the password lives in a Cloud Run env var and is not editable in the UI.

**One committed credential-shaped literal**, outside `backend/`: [scripts/test-tally107.js:23](scripts/test-tally107.js#L23) hardcodes a Firebase Web API key, and `:22` a Cloud Run service URL. Firebase Web API keys identify a project rather than a caller, so this is low severity — but it is a committed key and belongs in the inventory.

---

## H5 — Input validation on writes

### Uploads (all 6 multer configs)

| Router | Storage | Size limit | **MIME / extension filter** |
|---|---|---|---|
| `importFullProduct.ts:47` | memory | 50 MB | **NONE** |
| `importWeeklyOperations.ts:39-42` | memory | 50 MB | **NONE** |
| `importSales.ts:32-35` | memory | 50 MB | **NONE** |
| `mapImport.ts:26-29` | memory | 50 MB | **NONE** |
| `siteVerificationImport.ts:26-29` | memory | 50 MB | **NONE** |
| `launches.ts:39-42` | memory | 10 MB | **NONE** |

**No `fileFilter` anywhere.** Any file type is accepted; CSV parsing then fails at `csv-parse` with a 500 rather than a 400. Combined with `memoryStorage` and a 50 MB cap on three **ungated** routes, an unauthenticated caller can force repeated 50 MB heap allocations.

JSON body limits: [index.ts:64-65](backend/functions/src/index.ts#L64-L65) — `express.json({limit: '50mb'})` and `express.urlencoded({limit: '50mb', extended: true})` applied globally.

### Commit routes

| Route | Body validation |
|---|---|
| `POST /imports/full-product/:batch_id/commit` | `batch_id` from path; batch existence + status checked ([:180-190](backend/functions/src/routes/importFullProduct.ts#L180-L190)). **No body schema** |
| `POST /imports/weekly-operations/:batch_id/commit` | same shape |
| `POST /imports/sales/:batch_id/commit` | same shape |
| `POST /imports/map-policy/:batch_id/map-columns` | **Validated** — `column_mapping.mpn` and `.map_price` required ([mapImport.ts:194](backend/functions/src/routes/mapImport.ts#L194)) |
| `POST /imports/map-policy/:batch_id/commit` | batch status checked |
| `POST /imports/site-verification/:batch_id/commit` | batch status checked |

### Admin POST/PUT — validation density per router

Measured as `res.status(400)` responses and explicit `typeof`/`Array.isArray` checks:

| Router | 400s | type checks | Assessment |
|---|---|---|---|
| `attributeRegistry.ts` | 17 | 7 | **Strong** — enum allowlists at `:30-45` |
| `aiPlane.ts` | 17 | 8 | **Strong** |
| `exportProfiles.ts` | 12 | 5 | Good |
| `sopPanels.ts` | 10 | 4 | Good |
| `commentThreads.ts` · `importTemplates.ts` · `launchSettings.ts` · `searchSettings.ts` | 9 | 4–6 | Good |
| `brandRegistry.ts` · `featureToggles.ts` | 8 | 4–5 | Good |
| `launches.ts` | 7 | 3 | Adequate — field allowlists at `:51`/`:373`/`:468`, but `brand` and `product_name` are unvalidated free text |
| `adminUsers.ts` · `departmentRegistry.ts` · `siteRegistry.ts` · `guidedTours.ts` | 6 | 3–7 | Adequate |
| `adminSmartRules.ts` | 3 | 3 | Thin — relies on `rejectLegacyRuleField` |
| `cadenceRules.ts` | 2 | 3 | Thin |
| **`promptTemplates.ts`** | **1** | **0** | **NONE beyond a presence check** — `POST`/`PUT` write `match_department`, `match_brand`, `match_site_owner`, `match_gender` and the prompt body with **no type or enum validation** ([:52-113](backend/functions/src/routes/promptTemplates.ts#L52)) |
| **`adminSettings.ts`** | **1** | **0** | **NONE beyond `value !== undefined`** — see below |

**`PUT /api/v1/admin/settings/:key` is the weakest admin write in the system.** [adminSettings.ts:52-81](backend/functions/src/routes/adminSettings.ts#L52-L81): the only check is `if (value === undefined)` at `:60`. There is **no key allowlist**, so an admin can create arbitrary `admin_settings` documents, and **no type check**, so `gross_margin_safe_threshold` can be set to a string or an object — which `getAdminSettings` ([adminSettings.ts:47-54](backend/functions/src/services/adminSettings.ts#L47-L54)) will return verbatim into pricing arithmetic, since it only checks `data.value !== undefined`.

---

## H6 — Frontend trust

| # | Finding | Evidence |
|---|---|---|
| **H6-1** | **`AuthContext.tsx:31-34` invents a role.** With no `role` custom claim, the FE sets `role = "product_ops"`; the `catch` at `:33-35` does the same. It never reads `users/{uid}.role` — the fallback the backend uses. FE and BE can disagree in both directions. | [AuthContext.tsx:30-35](frontend/src/contexts/AuthContext.tsx#L30-L35) |
| **H6-2** | **`roles.ts:30` is an unconditional admin/owner bypass**, and it is invisible in the Permissions matrix. Live: 6 of 14 users bypass every gate. | [roles.ts:30](backend/functions/src/middleware/roles.ts#L30) |
| **H6-3** | **`roleGates.ts` is a hardcoded FE mirror of 4 BE gates**, pinning BE `file:line` in comments. Nothing keeps the two in sync. | [roleGates.ts:27-50](frontend/src/lib/roleGates.ts#L27-L50) |
| **H6-4** | **Only 1 of 69 `App.tsx` routes is role-gated** (`/admin/component-demo`, `:225-231`). Every admin page relies on the backend to 403 — including `/executive`, which 403s for 7 of 14 live users. | [App.tsx:138-235](frontend/src/App.tsx#L138-L235) |
| **H6-5** | **The Sidebar shows every entry to every role** — no role filtering in `Sidebar.tsx`'s nav tree. | [Sidebar.tsx:25-138](frontend/src/components/Sidebar.tsx#L25-L138) |
| **H6-6** | **The Permissions page renders a hand-maintained list**, not the gates. `rolePermissions.ts:5` says "codegen DROPPED". | [rolePermissions.ts:5](backend/functions/src/lib/rolePermissions.ts#L5), [PermissionsPage.tsx:37](frontend/src/pages/PermissionsPage.tsx#L37) |

| **H6-7** | **`isAdminGlobal` exists in 3 routers and is computed from the EFFECTIVE user, not the caller.** `["head_buyer","admin"].includes(role)` where `role` comes from `users/{effectiveUserId}` — and `effectiveUserId` is settable by an HTTP header. See H6-8. | [buyerReview.ts:46](backend/functions/src/routes/buyerReview.ts#L46), [mapReview.ts](backend/functions/src/routes/mapReview.ts), [pricingDiscrepancy.ts](backend/functions/src/routes/pricingDiscrepancy.ts) |
| **H6-8** | **`X-View-As-Uid` lets any authorised caller read as any other user, with no role check.** [viewAs.ts:28-69](backend/functions/src/middleware/viewAs.ts#L28-L69) validates exactly two things: the method is GET/HEAD (`:53`) and the target user exists (`:61`). **There is no check that the caller is entitled to impersonate.** Mounted on 4 routes: `GET /buyer-review` ([:30](backend/functions/src/routes/buyerReview.ts#L30)), `GET /pricing/discrepancy` ([:34](backend/functions/src/routes/pricingDiscrepancy.ts#L34)), `GET /map-review/conflicts` ([:32](backend/functions/src/routes/mapReview.ts#L32)), `GET /map-review/removals` ([:257](backend/functions/src/routes/mapReview.ts#L257)). A `buyer` passes `requireRole(["buyer","head_buyer","admin","owner"])` on their own role, then sets the header to a `head_buyer`'s uid — and `buyerReview.ts:38-46` loads **that** user, computes `isAdminGlobal` from **their** role, and returns the **admin-global unfiltered sweep** (`:74-80`). The middleware's own header comment says the FE strips the header for privileged users and calls the BE block "defense in depth" — but the BE block only covers *writes*, never *who may impersonate*. | as cited |

### H6-CRITICAL — read-scope escalation via `X-View-As-Uid`

This is the second privilege issue after H3-CRITICAL, and unlike that one it needs no Firestore write — just a header on a GET. It does not grant write access (`:53` blocks non-safe methods) but it does grant **any buyer the full cross-portfolio read** of the Buyer Cockpit, MAP conflict/removal queues and pricing-discrepancy queue, plus every other user's portfolio scope.

---

## H7 — CORS and headers

[index.ts:63](backend/functions/src/index.ts#L63):
```ts
app.use(cors({ origin: true }));
```

**`origin: true` reflects the request's `Origin` header and sets `Access-Control-Allow-Origin` to it — every origin is allowed.** It is not the literal `*`, but it is functionally broader: with `*`, browsers refuse to send credentials; with a reflected origin, they will. No `credentials`, `methods`, `allowedHeaders`, or `maxAge` options are set, and there is **no allowlist**.

**No security headers are set at all.** There is no `helmet`, and no manual `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, or `Referrer-Policy` (`grep -rn "helmet\|Content-Security-Policy\|X-Frame-Options"` over `backend/functions/src` → no matches). **No rate limiting** either — `admin_settings/api_rate_limits` exists live (`{global_rpm: 1000, per_user_rpm: 100, per_ip_rpm: 200, burst_limit: 50}`) but **nothing reads it**.

The practical exposure: an ungated route (H1) + reflected CORS (H7) + no rate limit means `POST /api/v1/ai-enrich/run-pending` can be driven from any web page in any browser, with up to 200 paid AI calls per request.

---

## Summary

| Item | Result |
|---|---|
| Total route handlers | **202** |
| Handlers with gate NONE | **13** (10 accidental, 3 by design) |
| Ungated **and** without any frontend caller | **3** — all three `ai-enrich` routes (`grep -rn "ai-enrich" frontend/src` → no matches). The 7 import routes are all live operator surfaces |
| Collections with an explicit Firestore rule | **1 of 35** (`users/{uid}`) |
| Client-writable Firestore paths | **1** — `users/{uid}`, **unrestricted by field** |
| Distinct `process.env` reads | **13 static + 1 dynamic** |
| Secrets logged / returned / stored in Firestore | **0** (correct by design) |
| Committed credential-shaped literals | **1** (`scripts/test-tally107.js:23`) |
| Upload MIME filters | **0 of 6** |
| Admin write routes with no meaningful validation | **2** (`adminSettings.ts`, `promptTemplates.ts`) |
| Routes accepting `X-View-As-Uid` with no impersonation check | **4** |
| CORS | **reflect-any-origin** |
| Security headers | **none** |
| Rate limiting | **none** (a settings doc exists and is unread) |

### The four that matter most

0. **H6-CRITICAL — read-scope escalation via `X-View-As-Uid`.** Any authorised caller can read as any other user on 4 routes; the middleware checks only that the method is safe and the target exists, never that the caller may impersonate. A buyer gets the admin-global unfiltered sweep by setting one header.

1. **H3-CRITICAL — privilege escalation via `firestore.rules:22`.** Any authenticated user can write their own `users/{uid}.role`, and `roles.ts:40-45` reads exactly that field when no custom claim is present. Combined with the `roles.ts:30` auto-append, self-assigning `role: "admin"` grants total API access.
2. **H1/H2 — 10 accidentally-public routes on an `allUsers`-invokable Cloud Run service.** Seven of them write to `products` in bulk; three spend AI credit. `POST /api/v1/ai-enrich/run-pending` is unauthenticated, uncalled by the product, and fans out to up to 200 paid model calls per request.
3. **H7 + H5 — reflected CORS, no rate limiting, no MIME filtering, 50 MB memory-buffered uploads.** Each is individually tolerable; together on an ungated route they compose into a resource-exhaustion and cost-amplification path reachable from any browser.
