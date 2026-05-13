# TALLY-D2D-SMART-RULE-UI-GAP — Implementation Evidence

**Mode:** Frontend only. No deploy. No Firestore writes. No backend changes.

## 1. Tally
TALLY-D2D-SMART-RULE-UI-GAP

## 2. Branch / base
- Branch: `tally-d2d-smart-rule-ui-gap`
- Base: `main` @ `899caad9b3afa786819fc5d22c8dd49481f865d0`

## 3. Files changed
- `frontend/src/pages/SmartRuleBuilderPage.tsx` — +332 / -29 lines

No other files modified.

## 4. PO locked rulings — implementation map
1. **Strategy B (Registry-Native Dropdowns)** — implemented.
2. **Replicate CadenceRulesAdminPage** — same pattern: `fetchBrandRegistry()` / `fetchDepartmentRegistry()`, dropdowns keyed by `brand_key` / `key` and labeled by `display_name`.
3. **Brand/Department dropdowns, not free text** — `renderConditionValueInput` and `renderActionValueInput` now render `<select>` for `brand_key` / `department_key` fields.
4. **Action target canonicalization** — `actionFieldOptions` strips legacy `brand`/`department` and injects canonical `brand_key`/`department_key`. Save validation rejects legacy `target_field`.
5. **Hide legacy field options** — both `conditionFieldOptions` and `actionFieldOptions` filter out registry entries with `field_key === "brand"` or `"department"` and inject canonical `{brand_key, "Brand"}`, `{department_key, "Department"}`.
6. **Legacy fallback** — on edit-load, legacy `field`/`target_field` is auto-mapped to canonical, the value is cleared, and the row carries `_legacyOriginalField` / `_legacyOriginalValue` markers that drive an amber banner + per-row "Legacy: was field=… value=…" notice. Save is blocked while any row has legacy markers.
7. **Mandatory helper text** — string constant `REGISTRY_HELPER_TEXT = "Uses registry keys for accurate routing."` rendered under every condition/action row whose field is `brand_key` or `department_key`.

## 5. Registry helpers used
- `fetchBrandRegistry(true)` → `BrandRegistryEntry[]` (active-only).
- `fetchDepartmentRegistry(true)` → `DepartmentRegistryEntry[]` (active-only).
- Loaded in parallel with `fetchAttributeRegistry()` via `Promise.all`.
- Dropdown shape: `value = brand_key` / `key`, `label = display_name`. Identical to the proven CadenceRulesAdminPage pattern.

## 6. Condition behavior
- Field menu: registry entries minus legacy `brand`/`department`, plus canonical `{brand_key,"Brand"}` and `{department_key,"Department"}`, plus `SOURCE_INPUT_FIELDS`.
- Value input:
  - `field === "brand_key"` → registry-driven Brand `<select>`.
  - `field === "department_key"` → registry-driven Department `<select>`.
  - All other fields: existing behavior preserved (taxonomy dropdowns, boolean, free text).
- Helper text rendered under brand_key / department_key rows.

## 7. Action behavior
- Field menu: same canonical-only list (no legacy `brand`/`department`).
- Value input: same registry-driven dropdowns for `brand_key` / `department_key` targets; existing typed-input fallback for everything else.
- Save validation forbids `target_field === "brand"` or `"department"`.

## 8. Legacy fallback behavior
On loading an existing rule:
- Conditions/actions with legacy `field` or `target_field` ("brand"/"department") are normalized to canonical in state, value is cleared, and the row records `_legacyOriginalField`/`_legacyOriginalValue`.
- Conditions/actions whose field is already canonical but whose value is not present in the loaded registries are also flagged the same way (e.g. value `"Nike"` in a `brand_key` condition).
- An amber banner appears at the top of the page: "⚠ This rule uses a legacy field. Choose a registry-backed value before saving."
- A per-row line shows the original legacy `field` + `value` so the operator can see what was migrated.
- `save()` returns an inline error and blocks the request when any row still has legacy markers, when the legacy field literal slipped back in, or when a `brand_key`/`department_key` row has empty value or a value not in the corresponding registry.
- Markers are cleared automatically once the operator selects a non-empty registry-backed value.

## 9. Helper text confirmation
`REGISTRY_HELPER_TEXT = "Uses registry keys for accurate routing."` rendered for both condition rows and action rows whose field is `brand_key` or `department_key` (see lines 727 and 778 in the patched file).

## 10. Payload examples

### Before (legacy / current bug)
```json
{
  "conditions": [{ "field": "brand", "operator": "equals", "value": "Nike" }],
  "actions":    [{ "target_field": "department", "value": "Footwear" }]
}
```
→ backend 400: `condition.field "brand" is not canonical; use "brand_key"`.

### After (Strategy B)
```json
{
  "conditions": [{ "field": "brand_key",      "operator": "equals", "value": "nike" }],
  "actions":    [{ "target_field": "department_key", "value": "footwear" }]
}
```
→ backend accepts; engine's `resolveField` ([backend/functions/src/services/smartRules.ts L175-L188](../../backend/functions/src/services/smartRules.ts#L175-L188)) reads `product.brand_key` directly.

## 11. Build result
```
> ropi-v3-frontend@1.0.0 build
> tsc -b && vite build
✓ 902 modules transformed.
✓ built in 5.61s
```
TypeScript: clean. Vite: clean. Pre-existing chunk-size and dynamic-import warnings unrelated to this change.

## 12. Grep / static validation
```
── grep 1: condition.field literal "brand" / "department" in frontend ──
(none)

── grep 2: target_field literal "brand" / "department" in frontend ──
(none)

── grep 3: source_field literal in frontend ──
(none)
```
No payload-emitting code references the legacy literals. The strings `"brand"` and `"department"` appear only in:
- The `LEGACY_FIELD_MAP` mapping table (used to detect + reject legacy on load/save).
- Save-validation error messages.
- Comments and the legacy-row warning text (UI copy only).

## 13. Confirmations
- ✅ No backend strictness loosened. `backend/functions/src/lib/ruleFieldValidation.ts` and `backend/functions/src/routes/adminSmartRules.ts` untouched.
- ✅ No smart rule engine changes. `backend/functions/src/services/smartRules.ts` untouched.
- ✅ No Firestore writes. Read-only registry fetches via existing API endpoints.
- ✅ No deploy executed.
- ✅ No migration of existing `smart_rules` documents — the legacy fallback is purely UI-side and operator-driven.
- ✅ CadenceRulesAdminPage untouched (used as reference only).
- ✅ Import normalization untouched.

## 14. Anomalies
None.

## 15. Build environment
- Node: per `frontend/package.json` engines (Vite 5).
- Frontend build script: `npm run build` from `frontend/`.

## 16. Status
`ready-for-review`
