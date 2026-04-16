# ROPI AOSS V3 — Builder Specification Reference
**For: Homer (AI Builder, GitHub Codespaces)**
**Maintained by: Lisa (Build Supervisor)**
**Source of truth: ROPI AOSS V3 Master Blueprint (Notion)**
**Last updated: Build Phase Day 1**

---

## CRITICAL RULE — READ FIRST

> **You are building a specific system with 101 locked architectural decisions.
> When this file does not answer your question, STOP and ask Lisa.
> Do not guess. Do not invent. Do not use "reasonable defaults."
> Every collection name, field name, and behavior in this file is locked.
> Deviating from it creates debt that costs more to fix than it saved to invent.**

This rule comes from Blueprint Section 19.1 (Build Rules) and Section 19.3 (Stop-and-Ask Triggers).

---

## STOP-AND-ASK TRIGGERS

Stop immediately and bring the question to Lisa if:

1. Two sections appear to conflict
2. A collection, field, or workflow step is not defined in this file or the brief
3. You are about to create a collection not in the list below
4. You are about to hardcode a value that feels like it should be configurable
5. A queue routing or state transition is unclear
6. A permission boundary is unclear
7. Any pricing, MAP, or export behavior would require a guess
8. You are tempted to use a "simpler" approach than the one specified

**The acceptable response to ambiguity is: stop and ask. Not: build a reasonable approximation.**

---

## PART 1 — INFRASTRUCTURE

### Firebase Projects (TALLY-102 — locked)

| Environment | Project ID | NODE_ENV value |
|---|---|---|
| Development | `ropi-aoss-dev` | `development` |
| Staging | `ropi-aoss-staging-v3` | `staging` |
| Production | `ropi-aoss-prod` | `production` |

All three projects: Blaze plan, Firestore in `nam5` multi-region, Native mode.

### Tech Stack (Section 17.0 — locked, no substitutions)

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React + Vite (PWA) | Firebase Hosting |
| Backend | Express (Node.js) | **Google Cloud Run — NOT Firebase Functions** |
| Database | Firebase Firestore | **Only database — no PostgreSQL, no other DB** |
| Auth | Firebase Auth | Email/Password provider |
| Storage | Firebase Storage | Launch images, import files |
| Search | Firestore composite indexes | Phase 1 only. Algolia optional in Phase 2. |
| AI | Anthropic API | Model: `claude-sonnet-4-20250514` |
| Email | SendGrid | |
| Secrets | Google Cloud Secret Manager | Never commit secrets to repo |

### Environment Variables

These are the only environment variables the backend uses.
Do not add new ones without Lisa's approval.

```
NODE_ENV
FIREBASE_PROJECT_ID
FIREBASE_AUTH_DOMAIN
FIREBASE_STORAGE_BUCKET
ANTHROPIC_API_KEY
SENDGRID_API_KEY
CLOUD_RUN_SERVICE_URL
```

Business logic thresholds (margins, windows, durations) live in the
`admin_settings` Firestore collection — NOT in environment variables.

### Environment Validation (mandatory)

The app must refuse to start if misconfigured. The mapping is:

```javascript
const VALID_ENVIRONMENTS = {
  development: 'ropi-aoss-dev',
  staging:     'ropi-aoss-staging-v3',
  production:  'ropi-aoss-prod'
};
```

If `NODE_ENV` is not one of the three keys, throw and exit.
If `FIREBASE_PROJECT_ID` doesn't match the expected value, throw and exit.

### Health Check Endpoint

```
GET /api/v1/health
```

Required response shape:
```json
{
  "status": "ok",
  "environment": "development",
  "project": "ropi-aoss-dev",
  "timestamp": "2026-04-16T00:00:00.000Z"
}
```

No auth required. HTTP 200.

### Deployment Sequence (Section 17.4 — always in this order)

1. Deploy Firestore security rules
2. Deploy composite indexes — wait for READY status
3. Run seed scripts (idempotent upserts)
4. Deploy backend (Cloud Run)
5. Deploy frontend (Firebase Hosting)
6. Verify health check responds

**Never deploy frontend before backend.**

---

## PART 2 — FIRESTORE SCHEMA

### Naming Convention

**All collection names are `snake_case`. No exceptions.**
`site_registry` ✅ — `siteRegistry` ❌ — `SiteRegistry` ❌

### Top-Level Collections (Section 17.0 — complete and locked)

These are the ONLY top-level collections that exist.
Do not create any collection not on this list without Lisa's explicit approval.

| Collection | Document ID | Notes |
|---|---|---|
| `products` | MPN (string) | Core product records |
| `attribute_registry` | `field_key` value | **NEVER `attribute_metadata`** |
| `site_registry` | site `id` value (e.g. `"shiekh"`) | |
| `smart_rules` | rule `id` value | |
| `prompt_templates` | template id | |
| `import_batches` | auto-generated | |
| `export_jobs` | auto-generated | |
| `launch_records` | auto-generated | |
| `map_terms` | auto-generated | |
| `buyer_actions` | auto-generated | |
| `metric_snapshots` | auto-generated | |
| `push_lists` | auto-generated | |
| `users` | Firebase Auth UID | Extends Firebase Auth |
| `admin_settings` | setting key string | One document per setting |
| `audit_log` | auto-generated | Append-only, never delete |

### Product Subcollections

Every `products/{mpn}` document has these subcollections:

**MPN sanitization:** Forward slashes in MPN values are replaced with `__` for Firestore document ID storage. The original MPN is preserved in `products/{docId}.mpn`. Use `mpnToDocId()` and `docIdToMpn()` from `services/mpnUtils.ts` everywhere an MPN touches a Firestore document ID.

```
products/{mpn}/attribute_values      ← EAV: one doc per attribute
products/{mpn}/pricing_snapshots     ← latest + history
products/{mpn}/site_targets          ← one doc per site
products/{mpn}/site_content          ← one doc per site
products/{mpn}/content_versions      ← append-only
products/{mpn}/comments              ← @mention threads
products/{mpn}/domain_states         ← one doc per domain
products/{mpn}/flags                 ← one doc per flag type
```

### Composite Indexes (Section 17.0 — all 9 required)

All 9 must be in `firebase/firestore.indexes.json`.
Deploy with `firebase deploy --only firestore:indexes`.
Wait for all 9 to reach READY status before proceeding.

```
products:      completion_state + site_owner + first_received_at
products:      cadence_assignment_state + site_owner
products:      pricing_domain_state + product_is_active
products:      linked_launch_id + completion_state
products:      first_received_at + updated_at
import_batches: family + status + created_at
buyer_actions:  buyer_user_id + created_at
audit_log:      product_mpn + created_at
audit_log:      acting_user_id + created_at
```

---

## PART 3 — SEED DATA

### Seed Script Rules

- Collection: `scripts/seed/`
- All scripts use Firebase Admin SDK
- All writes: `set({ merge: true })` — idempotent upserts only
- Target: `ropi-aoss-dev` only unless Lisa explicitly authorizes staging/prod
- Log every document written
- Log final summary count
- Exit code 1 on any write failure — never swallow errors

### Seed 1 — `attribute_registry` (67 documents) — TALLY-083

Document ID = `field_key` value (snake_case, immutable after creation).

Required fields on every attribute document:

```javascript
{
  field_key: "mpn",                    // snake_case — immutable
  display_label: "MPN",                // human-readable label
  field_type: "text",                  // text | dropdown | toggle | number | date
  destination_tab: "core_information", // see tab values below — MANDATORY
  required_for_completion: true,       // bool
  include_in_ai_prompt: false,         // bool
  include_in_cadence_targeting: false, // bool
  active: true,                        // bool
  export_enabled: true,                // bool
  dropdown_options: [],                // array, populated for dropdown types
  created_at: serverTimestamp()
}
```

**Valid `destination_tab` values — exactly four, no others:**

| Value | Contains |
|---|---|
| `core_information` | MPN, Brand, Name, Department, Class, Category, Primary Color, Secondary Color, Gender, Age Group, Size Type, Style ID, Tax Class, Site Owner, Product Is Active, imageStatus |
| `product_attributes` | Material, Pattern, Fit, Silhouette, Closure Type, Heel Height, Toe Shape, Sole Type, Sports Team, League, Season, Country of Origin, Care Instructions, Descriptive Color, Width, Weight, Height, Length, and remaining product-specific attributes |
| `descriptions_seo` | Name (display), Short Description, Long Description, Meta Name, Meta Description, Keywords, Alt Text |
| `launch_media` | Launch Date, Launch Type, Token Status, Launch Image 1, Launch Image 2, Launch Image 3, Teaser Text, Launch Notes, Is Launch Only |
| `system` | Source metadata fields only — hidden from operators, never in AI prompt, never exported |

**System / source metadata fields** (destination_tab = `system`,
include_in_ai_prompt = false, export_enabled = false):
`rics_short_description`, `rics_long_desc`, `rics_brand`, `rics_category`, `rics_color`

**Required for completion (required_for_completion = true):**
Age Group, Gender, Department, Class, Category, Fit, Style ID,
Product Is Active, MPN, SKU, Brand, Name, Meta Name, Meta Description

### Seed 2 — `site_registry` (7 documents) — TALLY-079

Document ID = `id` field value. Exactly 7 documents. No more, no less.

```javascript
{ id: "shiekh",      domain: "shiekh.com",        display_name: "Shiekh",
  ai_content_strategy: "use_shiekh_default",       // ← default tone, NOT require_custom
  default_tone_profile: "standard_retail",
  active: true, sort_order: 1 }

{ id: "karmaloop",   domain: "karmaloop.com",      display_name: "Karmaloop",
  ai_content_strategy: "require_custom_description",
  default_tone_profile: "streetwear",
  active: true, sort_order: 2 }

{ id: "mltd",        domain: "mltd.com",           display_name: "MLTD",
  ai_content_strategy: "require_custom_description",
  default_tone_profile: "contemporary",
  active: true, sort_order: 3 }

{ id: "plndr",       domain: "plndr.com",          display_name: "Plndr",
  ai_content_strategy: "use_shiekh_default",
  default_tone_profile: "standard_retail",
  active: true, sort_order: 4 }

{ id: "shiekhshoes", domain: "shiekhshoes.com",    display_name: "Shiekh Shoes",
  ai_content_strategy: "use_shiekh_default",
  default_tone_profile: "standard_retail",
  active: true, sort_order: 5 }

{ id: "trendswap",   domain: "trendswap.com",      display_name: "Trendswap",
  ai_content_strategy: "use_shiekh_default",
  default_tone_profile: "standard_retail",
  active: true, sort_order: 6 }

{ id: "fbrk",        domain: "fbrkclothing.com",   display_name: "FBRK Clothing",
  ai_content_strategy: "use_shiekh_default",
  default_tone_profile: "standard_retail",
  active: true, sort_order: 7 }
```

Add `created_at: serverTimestamp()` to each document.

### Seed 3 — `smart_rules` (3 documents) — TALLY-081, TALLY-082

Document ID = `id` field value.
**3 documents** implement 2 rule concepts. Seed all 3 — do not reduce to 2.

```javascript
{
  id: "rule_uuid_name_cleanup",
  rule_name: "UUID Name Cleanup",
  conditions: [{ source_field: "name", operator: "matches", target_value: "UUID_PATTERN" }],
  condition_logic: "AND",
  action: { target_attribute: "name", output_value: "" },
  always_overwrite: true,
  priority: 1,
  is_active: true,
  tally_ref: "TALLY-082",
  created_at: serverTimestamp()
}

{
  id: "rule_media_no_images",
  rule_name: "Media Presence - No Images",
  conditions: [{ source_field: "media_status", operator: "is empty", target_value: "" }],
  condition_logic: "AND",
  action: { target_attribute: "image_status", output_value: "NO" },
  always_overwrite: true,
  priority: 2,
  is_active: true,
  tally_ref: "TALLY-081",
  created_at: serverTimestamp()
}

{
  id: "rule_media_has_images",
  rule_name: "Media Presence - Has Images",
  conditions: [{ source_field: "media_status", operator: "is not empty", target_value: "" }],
  condition_logic: "AND",
  action: { target_attribute: "image_status", output_value: "YES" },
  always_overwrite: true,
  priority: 2,
  is_active: true,
  tally_ref: "TALLY-081",
  created_at: serverTimestamp()
}
```

### Seed 4 — `admin_settings` (21 documents) — multiple Tally items

Document ID = the key string. One document per setting key.
Structure for every document:

```javascript
{
  key: "setting_key_name",
  value: <value>,
  type: "number" | "boolean" | "string" | "array",
  updated_at: serverTimestamp()
}
```

**Complete list — 21 documents:**

| key | value | type | Tally ref |
|---|---|---|---|
| `gross_margin_safe_threshold` | 10 | number | TALLY-017 |
| `estimated_cost_multiplier` | 0.50 | number | TALLY-019 |
| `below_cost_acknowledgment_required` | true | boolean | TALLY-099 |
| `below_cost_reason_min_chars` | 20 | number | TALLY-099 |
| `master_veto_window` | 2 | number | TALLY-099 |
| `export_price_rounding_enabled` | true | boolean | TALLY-101 |
| `export_price_rounding_mode` | `"floor_minus_one_cent"` | string | TALLY-101 |
| `data_freshness_staleness_threshold_days` | 3 | number | TALLY-060 |
| `slow_moving_str_threshold` | 15 | number | TALLY-087 |
| `slow_moving_wos_threshold` | 12 | number | TALLY-087 |
| `str_calculation_window_days` | 30 | number | TALLY-019 |
| `wos_trailing_average_days` | 30 | number | TALLY-019 |
| `launch_priority_window_days` | 7 | number | TALLY-063 |
| `launch_protection_window_days` | 14 | number | TALLY-074 |
| `past_launch_retention_days` | 90 | number | TALLY-059 |
| `date_change_badge_duration_hours` | 72 | number | TALLY-056 |
| `neglect_age_threshold_days` | 60 | number | TALLY-091 |
| `neglect_attention_threshold_days` | 14 | number | TALLY-091 |
| `throughput_widget_windows` | `["day","week"]` | array | TALLY-040 |
| `export_schedule_time` | `"06:00"` | string | Section 17.5 |
| `scheduled_promotion_time` | `"05:55"` | string | Section 17.5 |

---

## PART 4 — API ROUTES

### Route Naming Convention

All routes: `/api/v1/...`
No other prefixes. No versioning shortcuts.

### Phase 1 Routes (Sections 19.2–19.9)

These are the only routes that exist in Phase 1.
Do not build routes not on this list without Lisa's approval.

```
GET  /api/v1/health

POST /api/v1/imports/full-product/upload
POST /api/v1/imports/full-product/:batch_id/commit

GET  /api/v1/products
GET  /api/v1/products/:mpn
POST /api/v1/products/:mpn/complete

GET  /api/v1/buyer-review
POST /api/v1/buyer-actions/markdown

POST /api/v1/exports/daily/trigger
```

---

## PART 5 — KEY BUSINESS RULES

These rules are locked. Do not interpret, simplify, or work around them.

### Pricing Rules

- `map_price` is the MAP floor — never `store_regular` (TALLY-005)
- `.99 rounding` applies at export time, not at buyer approval time (TALLY-101)
- Algorithm: `Math.floor(price) - 0.01` — always rounds DOWN, never up
- `ricsOffer > ricsRetail` → Pricing Discrepancy → absolute export blocker (TALLY-017)
- `ricsOffer < cost` → Loss-Leader Review → NOT a blocker, requires buyer acknowledgment (TALLY-099)
- Below-cost items route to Loss-Leader Review, NOT Pricing Discrepancy (TALLY-090)

### Smart Rules

- Default behavior: fill-if-empty only
- `always_overwrite: true` can overwrite `System-Applied` values
- `always_overwrite: true` can NEVER overwrite `Human-Verified` values
- Human-Verified is the absolute ceiling — no automated rule exceeds it (TALLY-044)

### Import Rules

- Four import families only (TALLY-078):
  1. Full Product Import
  2. Weekly Operations Import
  3. Site Verification Import
  4. MAP Policy Import
- UUID-format Name fields → import as blank, preserve raw in source record (TALLY-082)
- `$0` all-fields products → `Pricing Incomplete` flag, NOT Discrepancy (TALLY-080)
- `salePrice > $0` but `regularPrice = $0` → Pricing Discrepancy (TALLY-080)

### Export Rules

- Export eligibility: 6 conditions from Section 12.5
- Pricing Discrepancy = absolute export blocker (TALLY-025)
- Scheduled Hold = conditional export blocker until effective date (TALLY-014)
- All exported prices end in `.99` (TALLY-101)

### Field Provenance States (TALLY-043, TALLY-044)

Every attribute value carries a provenance record:

| Origin Type | Verification State | Meaning |
|---|---|---|
| `RO-Import` | `System-Applied` | Came from import — specialist must verify |
| `Smart Rule` | `System-Applied` | Smart Rule filled it — specialist must verify |
| `Human` | `Human-Verified` | Human confirmed or edited — locked from all future rule writes |
| `Observation` | n/a | Specialist's contextual note — feeds AI only |

### RBAC — Named Users (TALLY-070)

| Person | Role | Primary Scope |
|---|---|---|
| Theo | Admin | System settings, Smart Rules, Attribute Registry |
| Joey | Operations Operator | All imports, daily exports |
| Cesar | Content Manager / Launch Lead | Launch Calendar |
| Mykahiolo | MAP Analyst | MAP Policy Imports, MAP queues |
| Anahi | Product Ops | Product completion |
| Vanessa | Product Ops | Product completion |
| Mike | Head Buyer + Hats Buyer | Global pricing oversight + Hats |
| Alex | Buyer | Footwear (excl. Women's) |
| Heather | Buyer | Women's Apparel + Women's Footwear |
| Richard | Buyer | Men's Apparel + Accessories (Shiekh + Karmaloop) |
| Alana | Buyer | Men's Apparel (MLTD) |

---

## PART 6 — REPO STRUCTURE

```
ropi-v3/
  backend/
    src/
      routes/          ← one file per route group
      middleware/      ← auth, validation, error handling
      services/        ← business logic, Firestore operations
      config/
        env.js         ← environment validation — runs at startup
    package.json
  frontend/
    src/
    public/
    vite.config.js
    package.json
  firebase/
    firestore.rules
    firestore.indexes.json
    .firebaserc
    firebase.json
    SCHEMA.md          ← documents all collection paths and subcollections
  scripts/
    seed/
      seed-attribute-registry.js
      seed-site-registry.js
      seed-smart-rules.js
      seed-admin-settings.js
      run-all-seeds.js
    migrations/        ← empty for now
  .github/
    workflows/
  SPEC.md              ← this file
  README.md
  .gitignore
```

---

## PART 7 — WHAT NOT TO BUILD

The following do not exist in Phase 1. Do not scaffold, stub, or anticipate them:

- Algolia / Typesense search integration
- AI Describe generation endpoints
- Cadence rule engine
- MAP import pipeline
- Launch Calendar
- Executive Dashboard
- Buyer Performance Matrix
- PWA service worker
- Real-time presence (Firestore listeners for presence)
- `roles` collection (does not exist — RBAC is Firebase Auth custom claims)
- `contentStrategies` collection (does not exist — strategy lives on `site_registry` documents)
- Any collection not listed in Part 2

---

## PART 8 — STOP-AND-ASK QUICK REFERENCE

| If you're about to... | Stop because... |
|---|---|
| Create a collection not in Part 2 | Not in blueprint |
| Use `camelCase` for a collection name | Must be `snake_case` |
| Use `attribute_metadata` | Must be `attribute_registry` |
| Deploy to Firebase Functions | Must be Cloud Run |
| Hardcode a threshold or setting | Must be in `admin_settings` |
| Add an env variable not in Part 1 | Not in blueprint |
| Build a Phase 2 feature | Out of scope for current step |
| Guess on a queue routing decision | Stop-and-Ask trigger |
| Guess on a pricing or MAP behavior | Stop-and-Ask trigger |

---

*This file is maintained by Lisa (Build Supervisor) and updated at each phase milestone.
When in doubt: stop and ask. The blueprint exists so you don't have to guess.*
