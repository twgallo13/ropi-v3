# TASK K — Settings and hardcoding

Repo @ `2698e48`; live reads against `ropi-aoss-dev`.

---

## K1 — `admin_settings` inventory

**Live: 57 documents. 25 have a code reader. 32 do not.**

Doc shape: `{value, type?, category?, label?, description?, deprecated?, updated_at, updated_by}` ([adminSettings.ts:28-39](backend/functions/src/routes/adminSettings.ts#L28-L39)).
Read paths: `getAdminSettings()` (bulk, 10 fixed keys — [services/adminSettings.ts:38-56](backend/functions/src/services/adminSettings.ts#L38-L56)), `getAdminSetting<T>(key, fallback)` (generic — [emailService.ts:15-27](backend/functions/src/services/emailService.ts#L15-L27)), a second private `getAdminSetting` in [buyerPerformanceMatrix.ts:23](backend/functions/src/services/buyerPerformanceMatrix.ts#L23), and direct `.doc(key).get()` calls.
UI: **[SystemVariablesPage.tsx](frontend/src/pages/SystemVariablesPage.tsx)** (`/admin/infrastructure/system-variables`) edits any key via `GET /api/v1/admin/settings` + `PUT /api/v1/admin/settings/:key`. **[SmtpSettingsPage.tsx](frontend/src/pages/SmtpSettingsPage.tsx)** (`/admin/infrastructure/smtp`) edits the SMTP subset. **[PricingGuardrailsPage.tsx](frontend/src/pages/PricingGuardrailsPage.tsx)** (`/admin/infrastructure/pricing-guardrails`) edits the pricing subset.

### Keys WITH a code reader (25)

| Key | Read at | Default in code | UI | Seeded | Live value |
|---|---|---|---|---|---|
| `gross_margin_safe_threshold` | [adminSettings.ts:22](backend/functions/src/services/adminSettings.ts#L22) | `10` | Pricing Guardrails | ✓ | `10` |
| `estimated_cost_multiplier` | :23 | `0.50` | Pricing Guardrails | ✓ | `0.5` |
| `below_cost_acknowledgment_required` | :24 | `true` | Pricing Guardrails | ✓ | `true` |
| `below_cost_reason_min_chars` | :25 | `20` | Pricing Guardrails | ✓ | `20` |
| `export_price_rounding_enabled` | :26 | `true` | Pricing Guardrails | ✓ | `true` |
| `export_price_rounding_mode` | :27 | `"floor_minus_one_cent"` | Pricing Guardrails | ✓ | `"floor_minus_one_cent"` |
| `slow_moving_str_threshold` | :28 | `15` | Pricing Guardrails | ✓ | `15` |
| `slow_moving_wos_threshold` | :29 | `12` | Pricing Guardrails | ✓ | `12` |
| `str_calculation_window_days` | :30 | `30` | Pricing Guardrails | ✓ | `30` |
| `wos_trailing_average_days` | :31 | `30` | Pricing Guardrails | ✓ | `30` |
| `export_site_separator` | [exportSerializer.ts:63-67](backend/functions/src/services/exportSerializer.ts#L63-L67) | `","` | System Variables | ✓ | **`"\|"`** |
| `launch_priority_window_days` | [products.ts:88-90](backend/functions/src/routes/products.ts#L88-L90) (×3 call sites) | `7` | System Variables | ✓ | `7` |
| `launch_past_retention_days` | [launches.ts:131-135](backend/functions/src/routes/launches.ts#L131-L135) | `90` | System Variables | ✓ | `90` |
| `smtp_throttle_hours` | `launchNotifier.ts` | `24` | SMTP | ✓ | `24` |
| `email_provider` | [emailService.ts:47](backend/functions/src/services/emailService.ts#L47) | `"sendgrid"` | SMTP | ✓ | **`"custom_smtp"`** |
| `smtp_from_address` | [emailService.ts:38-41](backend/functions/src/services/emailService.ts#L38-L41) | **`"theo@shiekhshoes.org"`** | SMTP | ✓ | `"theo@shiekhshoes.org"` |
| `smtp_from_name` | [emailService.ts:43](backend/functions/src/services/emailService.ts#L43) | `"ROPI Operations"` | SMTP | ✓ | `"ROPI Operations"` |
| `smtp_host` | [emailService.ts:74](backend/functions/src/services/emailService.ts#L74) | none | SMTP | ✓ | `"smtp.gmail.com"` |
| `smtp_port` | [emailService.ts:75](backend/functions/src/services/emailService.ts#L75) | `587` | SMTP | ✓ | **`465`** |
| `smtp_username` | [emailService.ts:76](backend/functions/src/services/emailService.ts#L76) | none | SMTP | ✓ | `"theo@shiekhshoes.org"` |
| `buyer_performance_review_window_days` | [buyerPerformanceMatrix.ts:88](backend/functions/src/services/buyerPerformanceMatrix.ts#L88) | `30` | System Variables | ✓ | `30` |
| `buyer_kpi_weight_margin` | :91 | `33` | System Variables | ✓ | `33` |
| `buyer_kpi_weight_velocity` | :93 | `33` | System Variables | ✓ | `33` |
| `buyer_kpi_weight_attention` | :95 | `34` | System Variables | ✓ | `34` |
| `category_gm_targets` | :98-103 | `{Footwear:40, Clothing:45, Accessories:50, "Home & Tech":45}` | System Variables | ✓ | **identical to the code default** |
| `neglected_age_threshold_days` | [executiveProjections.ts:186](backend/functions/src/services/executiveProjections.ts#L186) | `60` | System Variables | ✓ | `60` |
| `neglected_attention_threshold_days` | :188 | `14` | System Variables | ✓ | `14` |
| `system_health` | `internalJobs.ts` (written, not read as config) | — | — | ✓ | object |

### Keys with NO code reader (32) — decorative

`active_ai_model` · `active_ai_provider` · **`active_model`** · `ai_content_moderation` · `ai_enrichment_schedule` · **`ai_model_config`** · `ai_prompt_templates` · `analytics_config` · `analytics_export` · `api_rate_limits` · `auth_config` · `bulk_import_config` · `data_mapping_defaults` · `feature_flags` · `feed_affiliate` · `feed_facebook_catalog` · `feed_google_shopping` · `gm_target_pct` · `maintenance_mode` · `master_veto_window` · `notification_email` · `notification_in_app` · `notification_slack` · `notify_launch_enabled` · `notify_map_conflict_enabled` · `notify_pricing_discrepancy_enabled` · `notify_weekly_advisory_enabled` · `platform_info` · `role_definitions` · `system_health` (read only as a write target) · plus 2 more.

Three of these are actively misleading:
- **`ai_model_config`** = `{default_model: "gpt-4o", fallback_model: "gpt-4o-mini", max_tokens_per_request: 4096, default_temperature: 0.7, rate_limit_rpm: 60}` — **OpenAI models**, in a system whose only working adapter is Anthropic ([aiConfig.ts:97-118](backend/functions/src/lib/aiConfig.ts#L97-L118) — the OpenAI and Gemini adapters throw).
- **`role_definitions`** = `{superadmin, admin, editor, viewer}` with `permissions` arrays like `"products:*"` — **a completely different role model** from the 10 canonical roles in [rolePermissions.ts:16-29](backend/functions/src/lib/rolePermissions.ts#L16-L29). Nothing reads it; an admin editing it would change nothing.
- **`active_model`** = `"claude-sonnet-4-5-20250929"` vs **`active_ai_model`** = `"claude-sonnet-4-6"` — two competing model keys, **neither read**. The real routing lives in `ai_workflow_routing` (9 docs, all `claude-sonnet-4-6`).

Also: `notification_email.recipients = ["admin@ropi.io"]` and `platform_info.support_email = "support@ropi.io"` reference a **`ropi.io`** domain unrelated to `shiekh.com`. The four `notify_*_enabled` booleans are all `true` and all unread — notification behaviour is unconditional.

---

## K2 — Hardcoded values that should be settings

| # | Value | file:line | Which admin surface would own it |
|---|---|---|---|
| **K2-1** | `DEFAULT_MODEL_KEY = "claude-opus-4-7"` | [aiConfig.ts:20](backend/functions/src/lib/aiConfig.ts#L20) | **AI Provider Registry / Workflow Routing** (P1-4). Valid model, but not changeable from any UI |
| K2-2 | `DEFAULT_PROVIDER_KEY = "anthropic"`, `DEFAULT_API_KEY_ENV_VAR = "ANTHROPIC_API_KEY"` | [aiConfig.ts:19](backend/functions/src/lib/aiConfig.ts#L19), [:21](backend/functions/src/lib/aiConfig.ts#L21) | AI Provider Registry |
| **K2-3** | `/^[^\s@]+@shiekh\.com$/` — the launch-subscribe domain allowlist | [launches.ts:195](backend/functions/src/routes/launches.ts#L195) | **Launch Settings**. Note `admin_settings/auth_config.allowed_domains = ["ropi.io","shiekh.com"]` already exists **and is unread** — the setting is there, the code ignores it |
| **K2-4** | 3 SendGrid template ids (env, defaulting to `""`) | [launchNotifier.ts:19-24](backend/functions/src/services/launchNotifier.ts#L19-L24) | Launch Settings / SMTP |
| K2-5 | `FROM_EMAIL = "launches@shiekh.com"` | [launchNotifier.ts:25](backend/functions/src/services/launchNotifier.ts#L25) | SMTP — and it **conflicts** with `admin_settings/smtp_from_address` (K3-1) |
| K2-6 | `"theo@shiekhshoes.org"` as the system from-address default | [emailService.ts:40-41](backend/functions/src/services/emailService.ts#L40-L41) | SMTP. **A named individual's address as a code-level default** |
| **K2-7** | `gmTargets` fallback `{Footwear:40, Clothing:45, Accessories:50, "Home & Tech":45}` — **display-keyed** | [buyerPerformanceMatrix.ts:98-103](backend/functions/src/services/buyerPerformanceMatrix.ts#L98-L103) | System Variables (`category_gm_targets` exists, identical). The active `Beauty` department has **no entry in either**, so it silently falls to `?? 40` |
| K2-8 | `?? 40` GM-target fallback ×2, `?? 0` catalog-STR fallback ×2 | [buyerPerformanceMatrix.ts:259-260](backend/functions/src/services/buyerPerformanceMatrix.ts#L259-L260), [:309](backend/functions/src/services/buyerPerformanceMatrix.ts#L309), [:317](backend/functions/src/services/buyerPerformanceMatrix.ts#L317) | System Variables |
| K2-9 | KPI weights `?? 33 / 33 / 34` | [buyerPerformanceMatrix.ts:91-95](backend/functions/src/services/buyerPerformanceMatrix.ts#L91-L95) | System Variables (settings exist; these are the fallbacks) |
| **K2-10** | Staleness bands `FRESH_DAYS=14`, `AGING_DAYS=30`, `STALE_DAYS=60` | [stalenessRefresh.ts:29-31](backend/functions/src/services/stalenessRefresh.ts#L29-L31) | System Variables. **Not settings at all** — and they overlap `neglected_age_threshold_days`(60) / `neglected_attention_threshold_days`(14), which **are** settings (K3-2) |
| K2-11 | `FALLBACK_THRESHOLD_DAYS = 14` (site-verification staleness) | [staleness.ts:10](backend/functions/src/lib/staleness.ts#L10) | System Variables. Reads `system_config/site_verification.staleness_threshold_days` — a **different collection** from `admin_settings` (K3-3) |
| **K2-12** | `FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000` — the buyer-queue aging threshold | [buyerReview.ts:71](backend/functions/src/routes/buyerReview.ts#L71) | System Variables. The cadence rules are all named "45-Day Zero Sales", so 45 is a **business constant duplicated between rule data and code** |
| K2-13 | `defer_days` default `7` for MAP removal review | [mapReview.ts:430](backend/functions/src/routes/mapReview.ts#L430) | MAP Policy settings |
| K2-14 | `in7 = Date.now() + 7 days` — dashboard launch-alert window | [dashboard.ts:200](backend/functions/src/routes/dashboard.ts#L200) | System Variables. **Duplicates `launch_priority_window_days`(7)**, which is a real setting read at `products.ts:88` (K3-4) |
| K2-15 | `EXPORT_ROW_CAP = 5000`, `EXPORT_PAGE_SIZE = 100`, `SELECTION_CAP = 250` | [products.ts:418-419](backend/functions/src/routes/products.ts#L418-L419), [:491](backend/functions/src/routes/products.ts#L491) | Export Profiles |
| K2-16 | `BULK_BATCH_MAX = 100` | [products.ts:1842](backend/functions/src/routes/products.ts#L1842) | System Variables |
| K2-17 | `WEB_DISCOUNT_CAP_ENUM = ["NO","5","10","15","20","25","30"]` | [exportSerializer.ts:185](backend/functions/src/services/exportSerializer.ts#L185) | Attribute Registry — `attribute_registry` already models enums; this one is in code |
| K2-18 | `EXPORT_COLUMNS` (15) and `fields` (24) hardcoded column lists | [products.ts:421-453](backend/functions/src/routes/products.ts#L421), [exportSerializer.ts:101-126](backend/functions/src/services/exportSerializer.ts#L101-L126) | Export Profiles (`export_profiles` collection exists, **empty and unread**) |
| K2-19 | `REQUIRED_COLUMNS` (15 CSV headers) | [importFullProduct.ts:57-62](backend/functions/src/routes/importFullProduct.ts#L57-L62) | Import Mapping Templates (`import_templates` exists, **empty and unread**) |
| K2-20 | `LAUNCH_EDITOR_ROLES = ["content_manager","launch_lead","admin"]` | [launches.ts:45](backend/functions/src/routes/launches.ts#L45) | Permissions. **Role lists are hardcoded in 9 routers** (`rolesAllowed`, `viewRoles`, `reviewRoles`, `resolverRoles`, `viewerRoles`, `buyerRoles`, `operatorRoles`, `EXEC_ROLES`, `PRIVILEGED_ACTOR_ROLES`) |
| K2-21 | `EXEC_ROLES`, `PRIVILEGED_ACTOR_ROLES` | [cadenceRules.ts:52](backend/functions/src/routes/cadenceRules.ts#L52), [buyerReview.ts:256](backend/functions/src/routes/buyerReview.ts#L256) | Permissions |
| K2-22 | `EXCLUSION_DIMENSIONS`, `PORTFOLIO_FIELDS`, `LEGACY_PORTFOLIO_FIELDS` | [adminUsers.ts:23-32](backend/functions/src/routes/adminUsers.ts#L23-L32) | User Management |
| K2-23 | `ALLOWED_TABS`, `ALLOWED_FIELD_TYPES`, `ALLOWED_DROPDOWN_SOURCES`, `ALLOWED_SEVERITIES` | [attributeRegistry.ts:10-45](backend/functions/src/routes/attributeRegistry.ts#L10-L45) | Attribute Registry (arguably correct as code) |
| K2-24 | `HUB_VALUES` / `ALLOWED_HUBS` — the 5 hub names, duplicated | [guidedTours.ts:38](backend/functions/src/routes/guidedTours.ts#L38), [sopPanels.ts:24](backend/functions/src/routes/sopPanels.ts#L24) | Experience settings |
| K2-25 | `TTL_MS = 60_000` feature-toggle cache | [featureToggleCache.ts:24](backend/functions/src/lib/featureToggleCache.ts#L24) | — (moot; never called) |
| K2-26 | `CHUNK_SIZE = 25` ×2, `BATCH_SIZE = 25`, `GET_CHUNK = 300`, `ERR_CHUNK = 200`, `BATCH_LIMIT = 400` | [importFullProduct.ts:965](backend/functions/src/routes/importFullProduct.ts#L965)/[:1039](backend/functions/src/routes/importFullProduct.ts#L1039), [onAttributeRegistryWrite.ts:23](backend/functions/src/functions/onAttributeRegistryWrite.ts#L23), [mapImport.ts:392](backend/functions/src/routes/mapImport.ts#L392)/[:590](backend/functions/src/routes/mapImport.ts#L590), [stalenessRefresh.ts:78](backend/functions/src/services/stalenessRefresh.ts#L78) | Infrastructure tuning — genuinely fine as code |
| K2-27 | `?? 999` rule-priority default, ×4 | [smartRules.ts:328-329](backend/functions/src/services/smartRules.ts#L328-L329), [adminSmartRules.ts:123-124](backend/functions/src/routes/adminSmartRules.ts#L123-L124) | Smart Rules |
| **K2-28** | **`"nike"`** — brand literal in MPN normalization | [ricsParser.ts:141-143](backend/functions/src/services/ricsParser.ts#L141-L143) | Brand Registry. A single brand's business rule hardcoded in a parser |
| K2-29 | `"Clothing"` / `"Accessories"` / `"Footwear"` — department literals in RICS taxonomy inference | [ricsParser.ts:51](backend/functions/src/services/ricsParser.ts#L51), [:61](backend/functions/src/services/ricsParser.ts#L61), [:80](backend/functions/src/services/ricsParser.ts#L80) | Department Registry |
| K2-30 | `AI_DESCRIBE_OWNED_FIELDS = {ai_seo_title, ai_seo_meta}` | [completionCompute.ts:125](backend/functions/src/services/completionCompute.ts#L125) | Attribute Registry (should be a registry flag) |
| K2-31 | `SUPERSEDED_FIELD_KEYS = {"department"}`, `SUPPRESSED_DYNAMIC_KEYS = {"department_key"}` | [attributeRegistry.ts:93](backend/functions/src/routes/attributeRegistry.ts#L93), [products.ts:593](backend/functions/src/routes/products.ts#L593) | Attribute Registry |
| K2-32 | `"ropi-aoss-dev"` fallback project id | [index.ts:72](backend/functions/src/index.ts#L72) | — (deploy config) |

**Total: 32 hardcoded values that would be better as settings.**

Two of Appendix B's six "known" K2 values **do not exist** (Task C, C5): there is no MAP price tolerance anywhere (`grep -riE "toleran"` finds only `deriveSiteTargetKeys`'s "tolerant matcher" comments), and the removal-review window is **7 days** (`mapReview.ts:430`), not 90.

---

## K3 — Duplicate config sources

| # | Setting | Source A | Source B | Which wins |
|---|---|---|---|---|
| **K3-1** | Email from-address | `admin_settings/smtp_from_address` = `"theo@shiekhshoes.org"`, read at [emailService.ts:38](backend/functions/src/services/emailService.ts#L38) | `process.env.LAUNCH_NOTIFIER_FROM` \|\| `"launches@shiekh.com"`, [launchNotifier.ts:25](backend/functions/src/services/launchNotifier.ts#L25) | **B, for all real email.** A wins only for the SMTP test button |
| **K3-2** | Email provider | `admin_settings/email_provider` = `"custom_smtp"` | hardcoded SendGrid in `launchNotifier.ts:81` | **B, for all real email** |
| **K3-3** | Staleness thresholds | `admin_settings/neglected_age_threshold_days` (60) + `neglected_attention_threshold_days` (14), read at [executiveProjections.ts:186-188](backend/functions/src/services/executiveProjections.ts#L186-L188) | `FRESH_DAYS=14` / `AGING_DAYS=30` / `STALE_DAYS=60` hardcoded at [stalenessRefresh.ts:29-31](backend/functions/src/services/stalenessRefresh.ts#L29-L31) | **Both, on different fields** — the settings drive `neglected_inventory`, the constants drive `staleness_indicator`. Same numbers, two sources; changing the setting desynchronises them |
| **K3-4** | Site-verification staleness | `system_config/site_verification.staleness_threshold_days`, read at [staleness.ts:64](backend/functions/src/lib/staleness.ts#L64) | `FALLBACK_THRESHOLD_DAYS = 14` at [:10](backend/functions/src/lib/staleness.ts#L10) | A, with B as fallback. **But it lives in `system_config`, not `admin_settings`** — a third settings collection with 1 doc, invisible to System Variables |
| **K3-5** | Launch window | `admin_settings/launch_priority_window_days` = 7, read at [products.ts:88](backend/functions/src/routes/products.ts#L88) | inline `7 * 24 * 60 * 60 * 1000` at [dashboard.ts:200](backend/functions/src/routes/dashboard.ts#L200) | **Both, on different surfaces.** Changing the setting silently desynchronises the dashboard tile |
| **K3-6** | GM targets | `admin_settings/category_gm_targets` | identical hardcoded fallback at [buyerPerformanceMatrix.ts:98-103](backend/functions/src/services/buyerPerformanceMatrix.ts#L98-L103) | A. Values are currently identical, so the duplication is invisible until one changes |
| **K3-7** | AI model | `ai_workflow_routing/{key}.model_key` (9 docs, all `claude-sonnet-4-6`) | `admin_settings/active_ai_model` (`"claude-sonnet-4-6"`) **and** `admin_settings/active_model` (`"claude-sonnet-4-5-20250929"`) **and** `admin_settings/ai_model_config.default_model` (`"gpt-4o"`) **and** `aiConfig.ts:20` (`"claude-opus-4-7"`) | **`ai_workflow_routing` wins;** `aiConfig.ts:20` is the miss-path fallback. **The three `admin_settings` keys are all dead** — four competing sources of truth, three unread |
| **K3-8** | Allowed email domains | `admin_settings/auth_config.allowed_domains = ["ropi.io","shiekh.com"]` — **unread** | regex `/@shiekh\.com$/` at [launches.ts:195](backend/functions/src/routes/launches.ts#L195) | **B.** The setting exists and is ignored |
| **K3-9** | Feature flags | `feature_toggles` collection + `isFeatureEnabled()` — **never called** | `admin_settings/feature_flags` (7 flags) — **never read** | **Neither.** Two flag systems, zero consumers |
| **K3-10** | Role model | `lib/rolePermissions.ts` CANONICAL_ROLES (10) | `admin_settings/role_definitions` (`superadmin`/`admin`/`editor`/`viewer`) — **unread** | A. B is fiction |
| **K3-11** | Rate limits | `admin_settings/api_rate_limits` — **unread** | no implementation | **Neither** — no rate limiting exists |

**11 duplicate config sources. In 6 of them (K3-1, K3-2, K3-7, K3-8, K3-9, K3-10) the `admin_settings` value is the one that loses** — an admin editing it changes nothing.

---

## K4 — Env vars and which environment sets each

| Env var | Read at | Set by |
|---|---|---|
| `FIREBASE_STORAGE_BUCKET` | [index.ts:59](backend/functions/src/index.ts#L59) | Cloud Run env (deploy scripts) |
| `FIREBASE_PROJECT_ID` | [index.ts:72](backend/functions/src/index.ts#L72) | Cloud Run env; **falls back to hardcoded `"ropi-aoss-dev"`** |
| `NODE_ENV` | [index.ts:71](backend/functions/src/index.ts#L71) | Cloud Run env |
| `PORT` | [index.ts:191](backend/functions/src/index.ts#L191) | Cloud Run (injected) |
| `SCHEDULER_OIDC_AUDIENCE` | [requireSchedulerOIDC.ts:39](backend/functions/src/middleware/requireSchedulerOIDC.ts#L39) | **Documented** in `docs/scheduled-jobs.md` → dev value is the Cloud Run URL |
| `SCHEDULER_OIDC_INVOKER_EMAIL` | [requireSchedulerOIDC.ts:50](backend/functions/src/middleware/requireSchedulerOIDC.ts#L50) | **Documented** → `scheduler-invoker@ropi-aoss-dev.iam.gserviceaccount.com` |
| `SENDGRID_API_KEY` | [emailService.ts:50](backend/functions/src/services/emailService.ts#L50), [launchNotifier.ts:56](backend/functions/src/services/launchNotifier.ts#L56) | **Not set by any deploy script in the repo** |
| `SENDGRID_NEW_LAUNCH_TEMPLATE_ID` | [launchNotifier.ts:20](backend/functions/src/services/launchNotifier.ts#L20) | **Not set by any deploy script** |
| `SENDGRID_DATE_CHANGED_TEMPLATE_ID` | [:22](backend/functions/src/services/launchNotifier.ts#L22) | **Not set by any deploy script** |
| `SENDGRID_NEW_COMMENT_TEMPLATE_ID` | [:24](backend/functions/src/services/launchNotifier.ts#L24) | **Not set by any deploy script** |
| `LAUNCH_NOTIFIER_FROM` | [:25](backend/functions/src/services/launchNotifier.ts#L25) | **Not set by any deploy script** |
| `SMTP_PASSWORD` | [emailService.ts:77](backend/functions/src/services/emailService.ts#L77) | Cloud Run env, per `SmtpSettingsPage.tsx:223-224` |
| `ANTHROPIC_API_KEY` (via dynamic lookup) | [aiConfig.ts:44](backend/functions/src/lib/aiConfig.ts#L44) | Cloud Run env; name comes from `ai_provider_registry.api_key_env_var_name` |
| `VITE_FIREBASE_*` (6) + `VITE_API_BASE_URL` | [firebase.ts:5-10](frontend/src/firebase.ts#L5-L10), [api.ts:3](frontend/src/lib/api.ts#L3) | Build-time; **compiled into the bundle, public by design** |

**`grep -rn "SENDGRID\|LAUNCH_NOTIFIER" scripts/*.sh` returns nothing** — none of the three deploy scripts sets any SendGrid variable. Combined with `launchNotifier.ts`'s silent-skip behaviour ([:57-63](backend/functions/src/services/launchNotifier.ts#L57-L63)), the most likely live state is: **launch emails are silently not being sent, and nothing reports it.**

Also relevant to K4: this audit environment holds `GCP_SA_KEY_DEV`, `GCP_SA_KEY_STAGING` and `GCP_SA_KEY_PROD` simultaneously, while every script hardcodes `projectId: "ropi-aoss-dev"` and reads only `GCP_SA_KEY_DEV`. Dev-only by convention, not by guard (relevant to P1-0).

---

## Summary

| Item | Count |
|---|---|
| `admin_settings` docs live | **57** |
| …with a code reader | **25** |
| …**decorative (no reader)** | **32** |
| Hardcoded values that should be settings (K2) | **32** |
| Duplicate config sources (K3) | **11** — in **6**, the `admin_settings` value loses |
| Distinct settings collections | **3** (`admin_settings`, `system_config`, `feature_toggles`) |
| Env vars read at runtime | **13 static + 1 dynamic**, plus 7 `VITE_*` |
| Env vars read but set by **no** deploy script | **5** (all SendGrid/launch-notifier) |
