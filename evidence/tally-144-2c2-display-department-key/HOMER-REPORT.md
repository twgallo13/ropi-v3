# TALLY-144-2C.2 — Display Canonical Department Key (Homer Report)

**Branch:** `tally-144-2c2-display-department-key`
**Base:** `bbc83ee3a892a4fc2c1d85ed8c77a1bb20d003b0` (TALLY-144-2C: backfill department_key attribute values)
**Mode:** Backend / frontend display patch only. No Firestore writes. No deploy. No legacy data deletion. Importers / smart_rules / cadence_rules / cadence_assignments / ownership-at-import untouched.
**Project (read-only probes):** `ropi-aoss-dev`

---

## 1. Problem (PO ruling 2026-05-15)

After TALLY-144-2C, every product has a canonical `attribute_values/department_key` doc (value = `footwear` | `clothing` | `accessories`) and a quarantined legacy `attribute_values/department` doc (value = display string e.g. `"Footwear"`). The product UI was rendering the legacy quarantined doc and not the canonical one because:

1. The detail serializer (`backend/functions/src/routes/products.ts`) included **all** attribute_values docs in the wire payload, including quarantined ones, and stripped the `quarantined` flag — so the frontend had no way to filter.
2. The attribute registry GET handler (`backend/functions/src/routes/attributeRegistry.ts`) for non-admin callers filtered out **all** entries with `is_editable === false`, which included the canonical `attribute_registry/department_key` registry doc — preventing it from ever rendering.
3. Quick Edit pre-populated the Department field by reading `attribute_values.department` (the legacy quarantined doc), routed through `displayToDeptKey` to canonicalize.

PO-locked outcome: the product UI must show only the canonical `department_key` value (label "Department"); the legacy quarantined doc must be hidden; **legacy registry/data docs must NOT be deleted or mutated**; ownership-at-import is out of scope.

## 2. Files Inspected (read-only)

- `backend/functions/src/routes/products.ts` (L688–L910) — detail handler, attribute_values serializer, root response shape, save handler.
- `backend/functions/src/routes/attributeRegistry.ts` (L1–L130) — registry GET filter chain.
- `frontend/src/pages/ProductDetailPage.tsx` (L320–L680) — registry-driven render path; verified read-only badge branch (`entry.is_editable === false`) is already present and renders display-only entries correctly.
- `frontend/src/components/QuickEditPanel.tsx` (L1–L450) — full read; identified Department read at L162 via `readAttrValue(detail, "department")` and save path via `saveField(mpn, "department", value)`.
- `frontend/src/lib/api.ts` (L90–L170) — `ProductListItem` / `ProductDetail` interfaces.
- `frontend/src/lib/registryAliases.ts` — `displayToBrandKey` / `displayToDeptKey` helpers (untouched).
- `backend/functions/src/routes/products.ts` save handler (L913–L1200) — confirmed `fieldKey === "department"` save path canonicalizes via `loadDepartmentRegistry` + mirrors to `root.department` AND `root.department_key`. Save semantics intentionally **not** changed in this dispatch (out of scope per "do not modify attribute_values data" — only the legacy doc that user already explicitly edits).

Live registry probe (`ropi-aoss-dev`, read-only):

- `attribute_registry/department`: `active:true`, `destination_tab:"core_information"`, `is_editable:true`, `enum_source:"department_registry"`, `display_label:"Department"`.
- `attribute_registry/department_key`: `active:true`, `destination_tab:"core_information"`, `is_editable:false`, `enum_source:"department_registry"`, `display_label:"Department"`.
- `is_editable: false` registry entries (n=6): `department_key`, `image_status`, `is_visible`, `media_count`, `media_status`, `product_is_active`. Of these, only `department_key` is in scope of the dispatch's allowlist; the other five remain hidden from non-admin (no behavior change).

## 3. Files Changed (4 files, +41/-2)

| File | Change |
|---|---|
| `backend/functions/src/routes/products.ts` | (a) Detail attribute_values serializer skips docs where `quarantined === true`; surviving docs gain `quarantined: false` for FE transparency. (b) Detail JSON response now includes `brand_key` and `department_key` from the root product doc. |
| `backend/functions/src/routes/attributeRegistry.ts` | Registry GET filter adds `SUPERSEDED_FIELD_KEYS = {"department"}` (suppressed for non-admin) and `READONLY_DISPLAYABLE_KEYS = {"department_key"}` (allowed through the non-admin `is_editable === false` filter). Admin mode is unaffected. |
| `frontend/src/lib/api.ts` | `ProductListItem` interface adds optional `brand_key?: string` and `department_key?: string`. |
| `frontend/src/components/QuickEditPanel.tsx` | Department field pre-populates from `detail.department_key` first; falls back to legacy `displayToDeptKey(readAttrValue(detail, "department"), …)` for products whose root canonical key is not yet populated. |

No registry or product Firestore writes performed by Homer. No legacy docs deleted. No importer / smart_rules / cadence_rules / cadence_assignments / ownership-at-import code touched.

## 4. Serializer Behavior (backend/functions/src/routes/products.ts)

Before:

```js
attribute_values[d.id] = { value, origin_type, origin_detail, verification_state, written_at };
```

After (TALLY-144-2C.2):

```js
if (attrData.quarantined === true) return;
attribute_values[d.id] = { value, origin_type, origin_detail, verification_state, written_at, quarantined: false };
```

Effect: legacy `attribute_values/department` (quarantined by 2C) is no longer present in the wire payload. Canonical `attribute_values/department_key` (not quarantined) passes through.

Also: detail JSON now exposes:

```js
brand_key: data.brand_key || "",
department_key: data.department_key || "",
```

## 5. Registry Filter Behavior (backend/functions/src/routes/attributeRegistry.ts)

Before (non-admin):

```ts
if (!includeInactive && data.active !== true) return false;
if (!adminMode && data.destination_tab === "system") return false;
if (!adminMode && data.is_editable === false) return false; // hid department_key
return true;
```

After (non-admin):

```ts
const SUPERSEDED_FIELD_KEYS = new Set<string>(["department"]);
const READONLY_DISPLAYABLE_KEYS = new Set<string>(["department_key"]);
…
if (!adminMode && SUPERSEDED_FIELD_KEYS.has(d.id)) return false;        // hides legacy "department"
if (!adminMode && data.is_editable === false && !READONLY_DISPLAYABLE_KEYS.has(d.id)) return false;
return true;
```

Effect: non-admin now sees `department_key` (read-only) in the registry response and **does not** see legacy `department`. Admin mode is unchanged. The other five `is_editable: false` registry docs remain hidden for non-admin (unchanged behavior).

## 6. Product Detail Render Behavior (frontend/src/pages/ProductDetailPage.tsx)

No code change needed. The page is fully registry-driven:

- Registry GET no longer returns `department` for non-admin → row not rendered.
- Registry GET now returns `department_key` for non-admin → row rendered. Because `is_editable === false`, the existing read-only badge branch (~L650) renders the value as a display-only chip with `entry.display_label` ("Department") and the raw value (`footwear` | `clothing` | `accessories`). Per dispatch C this fallback is acceptable; future polish (Title-Case via dropdown_options lookup) is out of scope for 2C.2.

## 7. Quick Edit Behavior (frontend/src/components/QuickEditPanel.tsx)

- **Read pre-population** — now sources Department from `detail.department_key` when present, with the legacy display-string + alias-walk fallback retained for products whose root.department_key has not been populated yet.
- **Save path** — unchanged. Quick Edit still POSTs to `/products/:mpn/attributes/department`, which the backend save handler already canonicalizes (matches `department_registry`, mirrors display name to `root.department` AND canonical key to `root.department_key`). Updating the save field key would change write semantics and was therefore deliberately left out of scope per the dispatch's "do not modify attribute_values data" guard. Save will continue to maintain `root.department_key` correctly; the legacy `attribute_values.department` will continue to be re-written on user save (and remains hidden in the wire payload only when quarantined).

Documented as expected: Quick Edit display now matches what users see on the Product Detail page.

## 8. Build Results

| Build | Command | Result |
|---|---|---|
| Backend | `npm --prefix backend/functions run build` | ✅ tsc clean, 0 errors |
| Frontend | `npm --prefix frontend run build` | ✅ tsc -b clean, vite build 902 modules transformed in 6.15s, 0 errors |

(Vite chunk-size + dynamic-import warnings are pre-existing repo state, unrelated to this patch.)

## 9. Validation / Confirmations

- ✅ No Firestore writes performed by Homer in this dispatch (read-only probe of `attribute_registry` only, used to enumerate `is_editable: false` blast radius).
- ✅ No legacy docs deleted or deactivated. `attribute_registry/department` and `attribute_values/{mpn}/department` (quarantined) remain on disk.
- ✅ No importer code touched (`importFullProduct.ts`, `importWeeklyOperations.ts`, etc.).
- ✅ No `adminSmartRules.ts` / `cadenceEngine.ts` / cadence_assignments / cadence_rules code touched.
- ✅ No ownership-at-import code touched.
- ✅ No deploy. Cloud Run revision unchanged.
- ✅ Branch is feature-only; no pushes to `main`.

## 10. Status

`ready-for-review`

## 11. Anomalies

None.

## 12. Next Step Requested

TALLY-144-2E — Ownership at Import.
