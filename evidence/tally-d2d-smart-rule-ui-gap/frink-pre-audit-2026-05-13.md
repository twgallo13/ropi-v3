# Frink Pre-Audit — TALLY-D2D-SMART-RULE-UI-GAP

**Mode:** Reconnaissance only. No code written. No files modified. No deploys. No Firestore writes.

---

## 1. Tally ID
TALLY-D2D-SMART-RULE-UI-GAP

## 2. Repo / main HEAD
- Repo: `twgallo13/ropi-v3`
- Branch: `main`
- HEAD: `899caad9b3afa786819fc5d22c8dd49481f865d0`
- Subject: `TALLY-INFRA: bump Firebase Functions Node runtime (#131)`
- Commit time: `2026-05-12T22:49:14-07:00`

## 3. Files inspected (all tracked at HEAD)
- [backend/functions/src/lib/ruleFieldValidation.ts](backend/functions/src/lib/ruleFieldValidation.ts)
- [backend/functions/src/routes/adminSmartRules.ts](backend/functions/src/routes/adminSmartRules.ts)
- [backend/functions/src/routes/attributeRegistry.ts](backend/functions/src/routes/attributeRegistry.ts)
- [backend/functions/src/services/smartRules.ts](backend/functions/src/services/smartRules.ts)
- [frontend/src/pages/SmartRuleBuilderPage.tsx](frontend/src/pages/SmartRuleBuilderPage.tsx) — 520 lines
- [frontend/src/pages/SmartRulesAdminPage.tsx](frontend/src/pages/SmartRulesAdminPage.tsx)
- [frontend/src/pages/CadenceRulesAdminPage.tsx](frontend/src/pages/CadenceRulesAdminPage.tsx) — 777 lines (reference pattern)
- [frontend/src/lib/api.ts](frontend/src/lib/api.ts) — registry/rule API contracts

## 4. Backend contract (authoritative ground truth)

**Validator:** [backend/functions/src/lib/ruleFieldValidation.ts](backend/functions/src/lib/ruleFieldValidation.ts#L19-L41)

```
LEGACY_RULE_FIELD_REPLACEMENTS = {
  brand:      → brand_key
  department: → department_key
}
```

`rejectLegacyRuleField(field, context)` returns a 400 message when `field` is exactly `"brand"` or `"department"`. Any other string passes.

**Smart rules POST/PUT applies the validator at `condition.field` only:**
[backend/functions/src/routes/adminSmartRules.ts L55-L63](backend/functions/src/routes/adminSmartRules.ts#L55-L63):
```
for (const c of body.conditions) {
  if (!c.field) return "condition.field required";
  const legacy = rejectLegacyRuleField(c.field, "condition.field");
  if (legacy) return legacy;
  ...
}
```

**Action target_field is NOT validated** by `rejectLegacyRuleField`. Confirmed in same file L65-L68 — only checks `target_field` exists and `value !== undefined`. So `action.target_field: "brand"` is currently accepted at the API; only conditions are blocked.

**Cadence rules apply the same validator at `target_filters[].field`:** [backend/functions/src/routes/cadenceRules.ts L29](backend/functions/src/routes/cadenceRules.ts#L29).

**Engine field resolution:** [backend/functions/src/services/smartRules.ts L175-L188](backend/functions/src/services/smartRules.ts#L175-L188) — resolves `c.field` against `productData[field]` first, then `attributeValues`, then `sourceInputs`. So `field: "brand_key"` reads `product.brand_key` (canonical slug e.g. `"nike"`); `field: "brand"` would read `product.brand` (display string).

**Registry GET shape:** [backend/functions/src/routes/attributeRegistry.ts L97](backend/functions/src/routes/attributeRegistry.ts#L97) — `field_key: d.id`. The Firestore doc IDs are the field_keys returned to FE. Live registry contains docs `attribute_registry/brand` and `attribute_registry/department` (confirmed by [scripts/tally-product-editor-registry-dropdowns-attribute-registry-seed.js L60-L73](scripts/tally-product-editor-registry-dropdowns-attribute-registry-seed.js#L60-L73) — explicitly seeds these two doc IDs with `dropdown_source: brand_registry` / `department_registry`).

## 5. Frontend Smart Rules Builder location
- List view: [frontend/src/pages/SmartRulesAdminPage.tsx](frontend/src/pages/SmartRulesAdminPage.tsx) (read-only browse + soft delete; no rule body composition).
- Builder/editor: [frontend/src/pages/SmartRuleBuilderPage.tsx](frontend/src/pages/SmartRuleBuilderPage.tsx) (handles both `new` and `:ruleId` edit).
- API client: [frontend/src/lib/api.ts L1736-L1937](frontend/src/lib/api.ts#L1736-L1937) — `SmartRule`, `createSmartRule`, `updateSmartRule`, `testSmartRule`, etc.

## 6. Payload assembly findings (Smart Rules Builder)

[frontend/src/pages/SmartRuleBuilderPage.tsx L97-L107](frontend/src/pages/SmartRuleBuilderPage.tsx#L97-L107) — condition field options:
```
conditionFieldOptions = [
  ...registry.map(r => ({ field_key: r.field_key, display_label: r.display_label })),
  ...SOURCE_INPUT_FIELDS,
]
```

Field dropdown emits the registry entry's `field_key` directly as `condition.field`:
[L355-L366](frontend/src/pages/SmartRuleBuilderPage.tsx#L355-L366):
```
<select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value })}>
  ...registry options keyed by f.field_key...
</select>
```

Save flow ([L222-L257](frontend/src/pages/SmartRuleBuilderPage.tsx#L222-L257)) builds `cleanedConds` with `field: c.field` verbatim and POSTs/PUTs without canonicalization.

**Conclusion:** When a user picks "brand" or "department" from the field dropdown, the request payload contains `condition.field: "brand"` (or `"department"`) — backend rejects with 400 per validator.

Action `target_field` ([L114-L118](frontend/src/pages/SmartRuleBuilderPage.tsx#L114-L118)) uses the same registry, but backend currently accepts legacy values there.

## 7. Dropdown / value mapping findings (condition.value)

[L120-L142](frontend/src/pages/SmartRuleBuilderPage.tsx#L120-L142) — `renderConditionValueInput`:
- For taxonomy fields with `dropdown_options[]` populated, renders a `<select>` of those exact strings.
- For boolean, renders true/false.
- For everything else (including `dropdown_source: "brand_registry"` cases where `dropdown_options` is empty), falls through to a free-text input.

Per [tally-product-editor-registry-dropdowns-attribute-registry-seed.js L60-L73](scripts/tally-product-editor-registry-dropdowns-attribute-registry-seed.js#L60-L73), `attribute_registry/brand` and `attribute_registry/department` use `dropdown_source` (not `dropdown_options`). The Smart Rules Builder does NOT consume `dropdown_source` — so brand/department values are entered as free text today. If a user types `"Nike"` (display) but engine resolves `brand_key` → `"nike"` (canonical), the equality check fails silently. This is a **second gap** distinct from the validator-rejection gap.

## 8. Legacy field/value findings (frontend)
Targeted greps across `frontend/`:
- `field:\s*["'](brand|department)["']` — **0 matches**. No hard-coded legacy field literals in payload assembly.
- `brand_key|department_key` — used canonically in [ProductListPage.tsx](frontend/src/pages/ProductListPage.tsx) and [CadenceRulesAdminPage.tsx](frontend/src/pages/CadenceRulesAdminPage.tsx).
- The legacy emission is **registry-data-driven**, not source-code-hardcoded. The bug is that the Builder treats `attribute_registry/{brand,department}` doc IDs as authoritative rule field names.

No hard-coded `"Nike"` / `"Footwear"` / `"Jordan"` literals in submitted-value paths in the Smart Rules Builder.

## 9. Existing helpers / registry reuse opportunities
- [frontend/src/lib/api.ts L2155-L2168](frontend/src/lib/api.ts#L2155-L2168): `fetchBrandRegistry()` returns `{brand_key, display_name, aliases, ...}` with canonical keys. Already used by CadenceRulesAdminPage.
- [frontend/src/lib/api.ts L2125-L2136](frontend/src/lib/api.ts#L2125-L2136): `fetchDepartmentRegistry()` — same pattern.
- [frontend/src/pages/CadenceRulesAdminPage.tsx L25-L26, L69, L120](frontend/src/pages/CadenceRulesAdminPage.tsx) — established pattern: cadence target_filters use `field: "department_key"` / `"brand_key"` and source value dropdowns from `brandRegistry` / `departmentRegistry`. **CadenceRulesAdminPage is the proven reference implementation** for the same problem.

No backend canonicalizer (`buildBrandCanonicalizer` in [backend/functions/src/lib/registryAuthority.ts](backend/functions/src/lib/registryAuthority.ts)) is exposed to FE — but it isn't needed; FE has direct registry access.

## 10. Recommended implementation strategy

**Strategy B — registry-native dropdowns in Smart Rules Builder, mirroring CadenceRulesAdminPage.** Recommended.

Rationale:
- The codebase already has the proven pattern in [CadenceRulesAdminPage.tsx](frontend/src/pages/CadenceRulesAdminPage.tsx) using the same backend validator. SmartRuleBuilderPage was simply not updated when TALLY-146A/146B tightened the contract.
- FE has direct access to `fetchBrandRegistry()` and `fetchDepartmentRegistry()` returning canonical `brand_key` / `department_key` values plus display names. No backend changes required.
- Strategy A (submit-time mapper) would fix the field-name 400 but leaves the value-mismatch silent bug unsolved (free-text `"Nike"` against canonical `"nike"`). Strategy B fixes both gaps simultaneously and matches the established codebase convention.
- Strategy C (full refactor) — out of scope.
- Strategy D (loosen backend) — explicitly avoid; the strictness was intentional (TALLY-146B PO ruling).

Strategy A is a viable fallback only if Lisa/PO want to ship the smallest possible patch and accept that brand/department equality conditions will continue to silently mis-match against canonical product data.

## 11. Minimal Homer patch scope (if Strategy B)

Edit only [frontend/src/pages/SmartRuleBuilderPage.tsx](frontend/src/pages/SmartRuleBuilderPage.tsx):

1. Import `fetchBrandRegistry`, `fetchDepartmentRegistry`, `BrandRegistryEntry`, `DepartmentRegistryEntry` from `../lib/api` (mirror CadenceRulesAdminPage L7-L18).
2. Load both registries alongside `fetchAttributeRegistry()` in the existing `useEffect` (L72-L93).
3. Override `conditionFieldOptions` (L97-L107) to substitute `brand_key`/`department_key` for the registry entries whose `field_key === "brand"` or `"department"`. Keep display label unchanged. Preferred: filter out the legacy `brand`/`department` registry entries entirely from the field menu and inject canonical synthetic entries `{field_key:"brand_key", display_label:"Brand"}` and `{field_key:"department_key", display_label:"Department"}`.
4. Extend `renderConditionValueInput` (L119-L162) — for `c.field === "brand_key"`, render a `<select>` populated from `brandRegistry.filter(b => b.is_active).map(b => ({value: b.brand_key, label: b.display_name}))`. Same for `"department_key"` from `departmentRegistry`.
5. (Optional, recommended) Apply the same substitution to `actionFieldOptions` (L109-L113) so action.target_field also writes `brand_key`/`department_key`. Note: backend currently accepts `target_field: "brand"` — confirm with PO whether actions should be canonicalized too. See open question §14.
6. Edit-load reverse-mapping: when an existing rule loads with legacy `field: "brand"` (pre-existing rules created before the validator change), normalize to `brand_key` in state so the Builder can render it. **CAVEAT:** the dispatch states "TALLY-146A cleaned out of active rule data" — so live `smart_rules` should not contain legacy field strings anymore. Confirm before relying on this; if any survived migration, they need either silent normalization on load or explicit "rule needs migration" UI.

**Out of scope for the patch (must not touch):**
- `attribute_registry/brand` and `/department` Firestore docs (used by Product Editor for editing the display string field — renaming would break the editor).
- Backend validator, smart rule engine, or routes.
- Any other rule-builder fields beyond brand/department.
- SmartRulesAdminPage.tsx (read-only list, unaffected).
- CadenceRulesAdminPage.tsx (already correct).

## 12. Test / build recommendations
- `npm --prefix frontend run build` (Vite + tsc) — must pass.
- Manual smoke (dev only):
  1. Open `/admin/smart-rules/new`, pick "Brand" from condition field dropdown → confirm value dropdown lists canonical brand display names.
  2. Save → confirm POST body has `condition.field: "brand_key"` and `condition.value: "nike"` (lowercase canonical).
  3. Repeat for Department.
  4. Edit an existing non-brand/department rule → confirm no regression in field/value rendering.
  5. Run dry-run on a brand-conditioned rule against a real MPN → confirm match.
- No backend tests required (no backend changes).

## 13. Stop conditions
Halt and re-escalate to Lisa if any of the following occur during implementation:
- Live `smart_rules` collection contains rules with `field: "brand"` or `"department"` (TALLY-146A migration left residue) — needs PO ruling on whether to migrate, deactivate, or fail-load.
- `fetchBrandRegistry()` or `fetchDepartmentRegistry()` returns empty in dev — registry seeding gap, not a FE bug.
- Action `target_field` canonicalization is contested by PO (some FE writes may rely on action target_field being the editor-facing field name).
- Builder must support fields beyond brand/department (none identified, but if scope expands, replan).
- Any need to write Firestore, deploy, or modify backend.
- Any user-visible rename of "Brand" / "Department" labels.

## 14. Open PO rulings needed before Homer dispatch
1. **Action target_field canonicalization.** Backend accepts `action.target_field: "brand"`. Should the Builder also force action target to `brand_key` for symmetry with conditions, or preserve the current asymmetry (so an action that "sets brand" writes the display string field that the Product Editor consumes)? Recommendation: preserve actions writing to `brand` / `department` (the editor-facing fields) until an explicit downstream canonicalization story exists. Conditions only need to read canonical.
2. **Pre-existing legacy rules.** Confirm TALLY-146A migration eliminated all `field: "brand"|"department"` from `smart_rules` docs. If any survived, decide: silent normalize on load, surface a "needs migration" banner, or block editing.
3. **Should the legacy `brand` / `department` registry entries remain selectable** in the Smart Rules Builder field dropdown at all (the proposed patch removes them), or should they appear disabled/with a warning?

---

## Verdict

**Conditional pass** for proceeding to a Homer dispatch under Strategy B, contingent on:
- PO ruling on §14.1 (action target_field).
- Confirmation of §14.2 (no legacy field residue in live `smart_rules`).
- Lisa drafting a dispatch that explicitly limits scope to [SmartRuleBuilderPage.tsx](frontend/src/pages/SmartRuleBuilderPage.tsx) only.

Backend contract is sound; frontend gap is clear, narrow, and has an established in-codebase pattern to copy. No drift introduced. No Blueprint conflict. Smallest safe path is registry-native dropdowns mirroring CadenceRulesAdminPage.

**Frink stops here. No code dispatch issued. Awaiting Lisa.**
