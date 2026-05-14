# TALLY-144-2A — Smart Rule Action Target Validator

## Tally
- Parent: TALLY-144 — Cleanup Sprint
- Phase: Phase 2 — Rule Field Normalization & Hard Deletes
- Tally: TALLY-144-2A

## Mode
BACKEND VALIDATION PATCH ONLY. No Firestore writes, no migrations, no cadence-rule changes, no engine changes, no frontend, no deploy, no ownership-at-import, no `site_key`.

## PO locked rulings honored
1. Strategy C approved for TALLY-144 Phase 2.
2. 2A patches Smart Rule action target validation first.
3. 2A only closes the validation gap for future writes.
4. 2A must not write Firestore data — confirmed.
5. 2A must not migrate existing rules — confirmed.
6. Cadence Rules clean / out of scope — confirmed untouched.
7. `site_owner` is canonical, no `site_key` introduced — confirmed.

## Frink P0 finding addressed
`adminSmartRules.validateRuleBody` rejects legacy display-string fields in `condition.field` but not in `action.target_field`. This let 10 active "Taxonomy:" smart_rules silently write display strings to `attribute_values/department`. 2A closes the validator hole; data backfill is deferred to 2B (rule migration) and 2C (attribute_values backfill).

## Files inspected
- [backend/functions/src/routes/adminSmartRules.ts](../../backend/functions/src/routes/adminSmartRules.ts)
- [backend/functions/src/lib/ruleFieldValidation.ts](../../backend/functions/src/lib/ruleFieldValidation.ts)
- [backend/functions/src/services/smartRules.ts](../../backend/functions/src/services/smartRules.ts)
- [backend/functions/src/routes/cadenceRules.ts](../../backend/functions/src/routes/cadenceRules.ts) — for parity reference only, not modified
- [backend/functions/src/index.ts](../../backend/functions/src/index.ts) — router mount confirmation
- No existing tests around smart rule validation found in `backend/functions/`.

## Files changed
- [backend/functions/src/routes/adminSmartRules.ts](../../backend/functions/src/routes/adminSmartRules.ts) — 6-line addition inside `validateRuleBody` actions loop. No other files modified.

## Validation behavior implemented
Inside `validateRuleBody`'s `for (const a of body.actions)` loop, after the existing presence check on `a.target_field`, a call to the existing `rejectLegacyRuleField(a.target_field, "action.target_field")` helper now hard-rejects:

| Rejected legacy `action.target_field` | Required canonical replacement |
|---|---|
| `"brand"` | `"brand_key"` |
| `"department"` | `"department_key"` |

Behavior:
- POST `/api/v1/admin/smart-rules` returns HTTP 400 with body `{"error":"action.target_field \"brand\" is not canonical; use \"brand_key\""}` (or `department` → `department_key`) when any action carries a legacy target field.
- PUT `/api/v1/admin/smart-rules/:rule_id` returns the same 400 (PUT also funnels through `validateRuleBody`).
- Existing `condition.field` validation is unchanged.
- All other action `target_field` values (`brand_key`, `department_key`, `site_owner`, `category`, `class`, `gender`, `age_group`, dotted paths, source-input fields) pass through untouched.
- Smart-rule execution semantics in [smartRules.ts](../../backend/functions/src/services/smartRules.ts) are unchanged. The registry-backed `writeRuleAction` guard is unchanged.
- No fallback / compatibility shim added (per PO rule).

### Before
```ts
for (const a of body.actions) {
  if (!a.target_field) return "action.target_field required";
  if (a.value === undefined) return "action.value required";
}
```

### After
```ts
for (const a of body.actions) {
  if (!a.target_field) return "action.target_field required";
  // TALLY-144-2A: hard-reject legacy display-string action target fields.
  // Closes the validator gap that allowed Smart Rules to silently write
  // display strings (e.g. "Footwear") to attribute_values/department.
  // Canonical replacements: brand → brand_key, department → department_key.
  const legacyAction = rejectLegacyRuleField(a.target_field, "action.target_field");
  if (legacyAction) return legacyAction;
  if (a.value === undefined) return "action.value required";
}
```

## Build result
```
$ npm --prefix backend/functions run build
> ropi-v3-api@3.0.0 build
> tsc
(exit 0, clean)
```

## Static grep validation
```
$ grep -n "rejectLegacyRuleField\|action.target_field\|target_field" backend/functions/src/routes/adminSmartRules.ts
17: import { rejectLegacyRuleField } from "../lib/ruleFieldValidation";
58:   const legacy = rejectLegacyRuleField(c.field, "condition.field");
68:   if (!a.target_field) return "action.target_field required";
73:   const legacyAction = rejectLegacyRuleField(a.target_field, "action.target_field");
95:   target_field: a.target_field,
```

```
$ git diff main --stat
 backend/functions/src/routes/adminSmartRules.ts | 6 ++++++
 1 file changed, 6 insertions(+)
```

`git diff main` returns empty for:
- `backend/functions/src/routes/cadenceRules.ts`
- `backend/functions/src/services/smartRules.ts`
- `backend/functions/src/lib/ruleFieldValidation.ts`
- `frontend/`

## Confirmations
- **No Firestore writes.** Patch is pure synchronous validation; only an extra string-comparison branch was added. No Firestore client calls, no batch ops, no triggers added.
- **No migrations.** No script under `scripts/` was created or modified. The 10 active legacy rules continue to exist in `smart_rules` exactly as before; they will fail the validator only on the next save (PUT) attempt and will continue to execute as-is until 2B migrates them.
- **Cadence rules untouched.** `git diff main -- backend/functions/src/routes/cadenceRules.ts` and `backend/functions/src/services/cadenceEngine.ts` are empty.
- **`site_owner` remains canonical / no `site_key` introduced.** No occurrence of `site_key` added anywhere in the diff.
- **No frontend changes.** `git diff main -- frontend/` is empty.
- **No engine semantics changed.** `smartRules.ts` is unmodified; `writeRuleAction`'s registry-key guard remains the second line of defense (and continues to allow `department` writes until 2F retires the legacy registry doc — out of 2A scope).

## Runtime validation
Per dispatch, no live API call made. Static inspection only.

## Anomalies
None. Route shape, action schema (`action.target_field`), and existing helper signature all matched the Frink pre-audit report. Helper was reused as-is; no helper change required.

## Next steps (out of 2A scope, separate dispatches)
- **TALLY-144-2B** — Migrate the 10 active "Taxonomy:" smart_rules to canonical `action.target_field = "department_key"` with canonical key values (dry-run gated).
- **TALLY-144-2C** — Backfill `attribute_values/department_key` from product-root `department_key`; quarantine stale `attribute_values/department` docs (dry-run gated).
- **TALLY-144-2D** — Hard-delete endpoints + cascade to `cadence_assignments` by `matched_rule_id` + UI rename + post-delete toast.
- **TALLY-144-2E** — Ownership-at-import in `importFullProduct.ts`.
- **TALLY-144-2F** — Optional removal of legacy `attribute_registry/brand` and `attribute_registry/department` docs once 2A+2B+2C have landed.
