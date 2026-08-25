# TASK L — Live data integrity

Firestore reads only, against `ropi-aoss-dev` @ the state of this run. Baseline: **81 products · 96 attribute_registry · 76 cadence_assignments · 14 users · 14 cadence_rules · 35 smart_rules · 42 brand_registry · 8 site_registry · 5 department_registry · 9 launch_records · 114 import_batches · 92 buyer_actions**.

---

## L1 — Orphan references

| Check | Count | First 5 offending doc ids |
|---|---|---|
| `products.brand_key` not in `brand_registry` | **0** | — |
| `products.department_key` / `department` matches no registry doc | **0** | — |
| `products.site_owner` not in `site_registry` | **0** | — |
| `cadence_assignments.assigned_user_id` matches no `users` doc | **0** | — |
| `cadence_assignments.primary_user_id` matches no `users` doc | **0** | — |
| `cadence_assignments.support_user_ids` entry matches no `users` doc | **0** | — |
| `cadence_rules.owner_buyer_id` matches no `users` doc | **0** | — |
| `cadence_assignments` with no matching `products` doc | **0** | — |
| **`launch_records.mpn` matches no product** | **9 of 9 — every launch record** | `011cf1c6-92cb-4f38-ac90-07dfd8f0f288` (mpn `123465987`, `mpn_is_placeholder: false`) · `2f57b750-8c6e-46cb-9265-b20a9e989272` (mpn `IV2868 328`, placeholder `false`) · `3fe7c1be-1449-48e3-8e33-11ef0e8b1062` (mpn `cesar-123`, placeholder **`true`**) · `6944ba08-73c7-42b1-81f7-b7ed8e42cd1d` (mpn `LISA-GATE-TEST-001`, placeholder `false`) · `a5f09ba9-2931-4194-aa42-9570d974e61a` (mpn `SHIEKH-ACCEPTANCE-001`, placeholder `false`) |
| **`products` with a `brand` but NO `brand_key`** | **8** | `433373011` (FISLL) · `610-33930BLK` (Rebel Minds) · `FRR0010B-BLK` (FIRST ROW) · `IND26110-SSMJ-BRN` (INDIVIDUALIST) · `IND26110-SSMJ-NVY` (INDIVIDUALIST) |

**The registry FKs are clean.** Every populated `brand_key`, `department_key` and `site_owner` resolves, and every user reference in the cadence layer resolves. That is a genuinely good result and worth stating.

**Two real orphan classes:**

1. **All 9 `launch_records` point at MPNs that do not exist as products.** Only 1 of the 9 is flagged `mpn_is_placeholder: true`; the other 8 claim to reference a real product and do not. `services/launchHighPriority.ts` (`checkHighPriorityFlag(mpn)`) is called on product completion and looks launches up by MPN — it will never match. This is also why P4-3's "MPN auto-create idea" exists.

2. **8 products carry a display brand with no key** — the four brands that failed the import canonicalizer (`routes/importFullProduct.ts:343-344` sets `identity.brand_key = ""` on no match): `INDIVIDUALIST` (5 products), `FISLL` (1), `Rebel Minds` (1), `FIRST ROW` (1). None is a `brand_registry` entry. These 8 are invisible to the Product List brand filter, to every `brand_key` index, to `evaluateFilter` in the cadence engine, and to buyer brand portfolios — while displaying a brand name in every table.

---

## L2 — Field-value drift

| Check | Result |
|---|---|
| root `brand` ≠ `brand_registry.display_name` for `brand_key` | **0 of 68** — every populated key resolves and matches |
| root `department` ≠ `department_key`'s display | **0 of 76** — `{Footwear→footwear, Clothing→clothing, Accessories→accessories}` all consistent |
| root `department_key` vs `attribute_values/department_key` | **0 of 76** drift |
| root `site_owner` vs `attribute_values/site_owner` | **5 of 81** — the D3SMOKE fixtures hold `"TRUE"` in the attribute with an empty root |

### Casing / format variants of the same value

| Field | Variants | Where |
|---|---|---|
| `attribute_values/category` | `"Running"` (9) · **`"running"`** (1) | products |
| `attribute_values/fit` | `"True To Size"` (8) · **`"True to Size"`** (1) | products |
| `attribute_values/product_name` | `"Air Force 1 '07 LV8"` · **`"Air Force 1 '07 Lv8"`** | products |
| `metric_snapshots.dimension` (`dimension_type == "department"`) | `"Footwear"` (22) · **`"FOOTWEAR"`** (8) · `"Clothing"` (16) · `"Accessories"` (16) · **`"Unknown"`** (22) | 84 docs |
| `operator_throughput.department` | `"Clothing"` (5) · `"Footwear"` (3) · **`"FOOTWEAR"`** (1) · **`"Unknown"`** (432) | 441 docs |
| `buyer_actions.pricing_domain_state_after` | `"Export Ready"` (78) · **`"export_ready"`** (1) · `"Buyer Denied"` (9) · **`"buyer_denied"`** (1) · `"Scheduled"` (3) | 92 docs |

**No `Footwear`/`FOOTWEAR` variant exists in root product fields** — the products themselves are clean. The variants live entirely in **derived** collections (`metric_snapshots`, `operator_throughput`) written by report jobs, and in `buyer_actions`.

The `buyer_actions` snake_case pair is **live residue from `scripts/migrate-pricing-current-to-export-ready.js:26`** (Task C, C10). `services/scheduledPromotion.ts:26` queries `.where("pricing_domain_state_after","==","Scheduled")` with exact matching, so any snake_case row is permanently invisible to it.

### The largest drift: two completion fields that disagree

| Field | Values | Where written |
|---|---|---|
| `completion_state` (root) | **`{incomplete: 81}`** | `services/completionCompute.ts:336` — derived |
| `status` (root **and** `attribute_values/status`) | **`{Complete: 61, Incomplete: 15}`** | import, from the RO Status CSV column |

**61 of 81 products are simultaneously `status: "Complete"` and `completion_state: "incomplete"`.** Both are emitted on the product-detail wire — `status` at [products.ts:910](backend/functions/src/routes/products.ts#L910), `completion_state` at `:918`. `status` is not an `attribute_registry` doc, so it never renders in the editor, but it is on the API contract and in the data.

---

## L3 — Required-but-empty

**For each `required_for_completion == true` attribute, the count of products with `completion_state == "complete"` that have it empty:**

| Attribute | Count |
|---|---|
| all 14 required attributes | **0** |

**This is vacuously zero: there are 0 products with `completion_state == "complete"`.** The check cannot fail because the state it filters on is unreachable.

The meaningful inverse — coverage of each required attribute across all 81 products:

| Required attribute | active | `attribute_values` docs | Missing on |
|---|---|---|---|
| `brand` · `is_in_stock` · `product_name` · `sku` | true | 81 | 0 |
| `category` · `class` · `department_key` · `gender` | true | 76 | 5 (the D3SMOKE fixtures) |
| `age_group` | true | 71 | 10 |
| `website` | true | 67 | 14 |
| **`department`** | **false** | **25** | **56 — and unfillable, the doc is hidden from the editor** |
| **`sub_category`** | true | **0** | **81** |
| **`ai_seo_title`** | true | **0** | **81** |
| **`ai_seo_meta`** | true | **0** | **81** |

Verified by replaying `computeCompletionProgressPure` (`services/completionCompute.ts:104-180`) against live data — computed percentages match the stored `completion_percent` exactly (`1005177` 79, `1005394` 71, `101405-CHRM` 79).

---

## L4 — Duplicate identities

| Check | Count | Detail |
|---|---|---|
| Two `users` docs with the same email | **0** | — |
| **Two `brand_registry` docs with the same `display_name`** | **1 pair** | **`"Jordan"`** — `brand_registry/jordan` (`is_active: true`) and `brand_registry/brand_jordan` (`is_active: false`). The "Jordan pattern" named in the brief, confirmed |
| Two `launch_subscribers` for one email with different prefs | **0** | Only 1 subscriber exists live: `theo@shiekh.com`, all three prefs `true` |

Adjacent duplicate-identity issue not covered by the three checks: **`brand_registry/"field grade"` has a doc id containing a space while its `brand_key` is `field_grade`.** `lib/brandRegistry.ts:49` keys its Map by `brand_key`; `lib/registryAuthority.ts:32` keys by **doc id**. The two key sets differ, which breaks buyer-portfolio validation for that brand (see `deep-map-brand.md` DEFECT B3-3).

---

## L5 — Stale test residue

| Collection | Hits | Doc ids |
|---|---|---|
| `products` | **6 of 81** | `D3SMOKE-ALLZERO-1777944544180`, `D3SMOKE-DISPAR-1777944544180`, `D3SMOKE-NORMAL1-…`, `D3SMOKE-NORMAL2-…`, `D3SMOKE-NORMAL3-…` (all 5 carry `attribute_values/site_owner = "TRUE"` and `website = "true"`, and no department at all) · `JP25623SK-BLK` (matched on the word "wash" in its name — **false positive**, a real product) |
| `users` | **1 of 14** | `step22-verify-bot` (`step22-bot@ropi.dev`, **role `admin`**) |
| `cadence_rules` | **3 of 14** | `2821a4b5-…` ("Alex — Boys' Footwear 45-Day Zero Sales **(TEST CHANGE)**", disabled) · `oBHN3Xm85fSfNGM7tmh5` ("**test**", disabled) · `jsakAzUhKLHBW8paTSRU` (carries a `fixture_tally` marker and a stray `assigned_user_id` on the rule doc — **enabled**) |
| `smart_rules` | **1 of 35** | `rule_acceptance_test_delete_me_mo2i4fkj` ("**ACCEPTANCE TEST — delete me**", disabled, still stores the blocked legacy field `department`) |
| `launch_records` | **7 of 9** | `6944ba08-…` ("Lisa Gate Test") · `a5f09ba9-…` ("Acceptance Test Launch") · `c16b94f8-…` ("High Priority Stamp Test") · `dc328b78-…` ("test launch") · `ff11aefd-…` ("test") · `011cf1c6-…` ("The O", mpn `123465987`) · `e65b2c9f-…` ("Alana Greens") |
| `ai_provider_registry` | **1 of 4** | `asdfasfer` (`display_name: "test"`, model `test1`, `api_key_env_var_name: "test_ai_key"`, inactive) |
| `import_batches` | **22 of 114** | `02bae095-…`, `0d4d69e8-…`, `0f9d1b1e-…`, `10e69e22-…`, `23938837-…` (+17 more) |
| `export_jobs` | **5 of 24** | `5pZYrvBCualLImArirzl`, `M4KYERECT5elGIogNahB`, `PB9IJ3RLepkyRD0uAKWM`, `TtLZdYIB0oGtQg2fxw9P`, `cTq59JTLD3FHIP5sc1n1` |
| `map_import_templates` | **1 of 2** | `0nb4ytUjBmhx4T3g7uai` |
| `brand_registry` | **1 of 42** | `smoke_rise` — **false positive**, "Smoke Rise" is a real brand |

**Total: 46 residue docs (44 excluding the 2 false positives), across 9 collections.**

Two that matter beyond tidiness:
- **`users/step22-verify-bot` holds `role: "admin"`**, and per `middleware/roles.ts:30` admins bypass every gate. A test bot with total API access.
- **7 of the 9 `launch_records` are test data**, which is also why all 9 have orphan MPNs (L1).

---

## L6 — Schema drift

### `products` — 78 distinct top-level fields across 81 docs
Present on **100%**: `completion_state`, `completion_percent`, `completion_last_computed_at`, `blocker_count`, `ai_blocker_count`, `next_action_hint` — i.e. only the 6 completion-stamp fields are universal.
Fields on **<10%** of docs (5): `export_job_id` (6) · `last_exported_at` (6) · **`cadence_hold` (3)** · `export_rics_offer` (1) · **`site_verification` (1)**.

`cadence_hold: 3` exactly matches the 3 `cadence_assignments` with `last_buyer_action: "hold"` — the three held products. Since nothing reads the flag, those 3 docs are the entire footprint of the Hold feature.

### `attribute_registry` — **40 distinct top-level fields across 96 docs**

This is the worst schema drift in the database. There are **seven pairs of competing field names for the same concept**, and in each pair only the first is read by code:

| Concept | Field code reads | Docs | Competing field | Docs |
|---|---|---|---|---|
| Label | **`display_label`** | 96 | `label` | 40 |
| | | | `display_name` | 9 |
| Active flag | **`active`** (`routes/attributeRegistry.ts:98`, `lib/exportRegistry.ts:29`) | 96 | `is_active` | 8 |
| | | | `status` | 39 |
| Type | **`field_type`** | 96 | `data_type` | 40 |
| Group | **`display_group`** | 96 | `group` | 40 |
| Required | **`required_for_completion`** (`services/completionCompute.ts:214`) | 77 | `is_required` | 43 |
| | | | `required` | 8 |
| Options | **`dropdown_options`** | 85 | `allowed_values` | 40 |
| Order | **`display_order`** (`lib/exportRegistry.ts:33`) | 96 | `sort_order` | 40 |
| Enum source | `enum_source` | 4 | `dropdown_source` | 14 |

Other partial fields: `export_enabled` (76), `include_in_ai_prompt` (76), `include_in_cadence_targeting` (73), `is_searchable`/`is_filterable`/`is_ai_generated`/`default_value` (40 each), `tab_group_order` (31), `depends_on` (24), **`is_editable` (20)**, `severity`/`why_it_matters` (12), **`field_key` (11)**, `category`/`ai_prompt` (8), `created_by` (1).

**Consequences:** 8 docs carry an `is_active` the code ignores; 43 carry an `is_required` the completion engine ignores; 40 carry `allowed_values` the editor ignores. Any operator or script reading the "wrong" field of a pair gets a different answer.

### `users` — 24 distinct fields across 14 docs
Universal (14): `role`, `email`, `portfolio_brands`, `portfolio_depts`, `portfolio_age_groups`, `portfolio_sites`, `portfolio_exclusions`.
Partial: `uid` (13 — **1 user has no `uid` field**), `requires_review` (13), `display_name` (13), `created_at` (12), `advisory_preferences` (11), `portfolio_gender` (10), `updated_by`/`updated_at` (7), **`portfolio_attributes` (5)**, `disabled`/`disabled_at`/`disabled_by` (2).
<10%: `created_by`, `password_reset_at`, `password_reset_by`, `reenabled_at`, `reenabled_by` (1 each).
Note `portfolio_gender` is on 10 of 14 while the other five `portfolio_*` fields are on all 14 — the Track-1C gender migration is incomplete.

### `cadence_rules` — 16 distinct fields across 14 docs
Universal (14): `rule_name`, `is_active`, `owner_buyer_id`, `trigger_conditions`, `markdown_steps`, `created_by`, `created_at`, `version`, `updated_at`, `target_filters`.
Partial: `priority` (12 — **2 rules have no priority**, and `services/cadenceEngine.ts` sorts by target-filter count rather than priority, so this is currently inert), `rule_id` (11 — **3 rules lack the id field that duplicates their doc id**), `owner_site_owner` (7).
<10%: `updated_by` (1), **`assigned_user_id` (1)** and **`fixture_tally` (1)** — both on `jsakAzUhKLHBW8paTSRU`, a shape no other rule has.

---

## Summary

| Check | Result |
|---|---|
| **L1** orphan references | **17 total** — 9 `launch_records` with non-existent MPNs, 8 products with a brand but no `brand_key`. **All registry and user FKs are clean (0 orphans).** |
| **L2** field-value drift | root fields clean (0 brand drift, 0 department drift); **6 casing/format variant classes**, all in derived collections or `buyer_actions`; **61 products simultaneously `Complete` and `incomplete`** |
| **L3** required-but-empty on complete products | **0 — vacuously**, because 0 products are complete. 4 of 14 required attributes have ≥56 products missing them; 3 have all 81 |
| **L4** duplicate identities | **1** — `brand_registry` "Jordan" ×2. 0 duplicate user emails, 0 duplicate subscribers |
| **L5** stale test residue | **44 docs across 9 collections** (excluding 2 false positives), including an **admin-role test bot** and 7 of 9 launch records |
| **L6** schema drift | `products` 78 fields / `attribute_registry` **40 fields with 7 competing name pairs** / `users` 24 / `cadence_rules` 16 |

### The three worst

1. **`attribute_registry` carries seven pairs of competing field names** — `label`/`display_label`, `is_active`/`active`/`status`, `data_type`/`field_type`, `group`/`display_group`, `is_required`/`required_for_completion`/`required`, `allowed_values`/`dropdown_options`, `sort_order`/`display_order`. 40 of 96 docs carry a full shadow schema that no code reads. This is the data-side twin of P2-1b's "one script of record" problem, and it means any registry audit that reads the wrong field gets a plausible wrong answer.
2. **All 9 `launch_records` reference MPNs that do not exist**, and only 1 admits to being a placeholder. `checkHighPriorityFlag` can never match a launch to a product.
3. **61 products hold two contradictory completion answers** (`status: "Complete"` vs `completion_state: "incomplete"`), both on the API contract. Combined with L3 — where `complete` is unreachable — the RO Status field is the only completion signal in the data that ever says "done".
