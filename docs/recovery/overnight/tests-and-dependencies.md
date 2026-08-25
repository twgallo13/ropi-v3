# TASK N — Tests and dependencies

Repo @ `2698e48`. Tests run from `backend/functions/` after `npm run build`, per the run instructions in each test file's header.

---

## N1 — Coverage map

**97 non-test source files in `backend/functions/src`. 4 have a sibling test file. Coverage: 4.1%.**

| Directory | Files | Tested | Untested |
|---|---|---|---|
| `src/` (index.ts) | 1 | 0 | **1** |
| `src/functions/` | 2 | 0 | **2** |
| `src/lib/` | 10 | 2 | **8** |
| `src/middleware/` | 4 | 1 | **3** |
| `src/routes/` | 47 | 0 | **47** |
| `src/services/` | 32 | 1 | **31** |
| `src/types/` | 1 | 0 | **1** |
| **Total** | **97** | **4** | **93** |

**Zero of the 47 routers has a test. Zero of the 202 route handlers is covered.**

### Test run results

All five suites were compiled with `npm run build` and run individually.

| Test file | Tests the | Result |
|---|---|---|
| `lib/brandRegistry.test.ts` | `lib/brandRegistry.ts` | **33 passed, 0 failed** |
| `lib/departmentRegistry.test.ts` | **`routes/departmentRegistry.ts`** — note the mismatched location (see below) | **38 passed, 0 failed** |
| `lib/parseAdditionalImageUrls.test.ts` | `lib/parseAdditionalImageUrls.ts` | **10 passed, 0 failed** |
| `middleware/requireSchedulerOIDC.test.ts` | `middleware/requireSchedulerOIDC.ts` | **18 passed, 0 failed** |
| `services/completionCompute.test.ts` | `services/completionCompute.ts` | **30 passed, 4 FAILED** |

**Total: 129 passed, 4 failed.**

The 4 failures in `completionCompute.test.js`:
`2b all-AI ai_blockers cnt` · `2c all-AI hint prefix` · `4a mixed ai_blockers cnt` · `4c mixed hint = AI first`

All four are in the **`ai_blockers` counting and next-action-hint prioritisation** area — precisely the behaviour changed by TALLY-164, which added `AI_DESCRIBE_OWNED_FIELDS` ([completionCompute.ts:119-125](backend/functions/src/services/completionCompute.ts#L119-L125)) to exclude `ai_seo_title`/`ai_seo_meta` from `ai_blockers` ([:170](backend/functions/src/services/completionCompute.ts#L170)). **The tests assert the pre-TALLY-164 behaviour.** Confirmed as the "superseded behaviour" case Appendix B / §3 N2 names.

### Three structural findings

**N1-1 — `lib/departmentRegistry.test.ts` has no sibling source file.** It lives in `src/lib/` but tests `src/routes/departmentRegistry.ts` (its own header says so at `:2`). Any coverage tool keyed on file adjacency will report `routes/departmentRegistry.ts` as untested and `lib/departmentRegistry.ts` as a missing source.

**N1-2 — Every test harness exits 0 regardless of failures.** `node lib/services/completionCompute.test.js` prints `Results: 30 passed, 4 failed` and exits **0**. Wiring these into a `test` script as-is would report green on a failing suite. This is the blocker for P1-5.

**N1-3 — There is no test runner and no CI.** No `test` script in `backend/functions/package.json:8-14`, `scripts/package.json`, or `scripts/seed/package.json`; no root `package.json`. `.github/` contains three agent markdown files and **no workflow**. The five suites are only ever run by hand, using the command in each file's header comment.

---

## N2 — What the tests actually assert

| Test file | What it protects (one line) | Superseded? |
|---|---|---|
| `services/completionCompute.test.ts` | The pure completion algorithm: required-key extraction incl. `depends_on` gating, percent/blocker computation, `ai_blockers` counting, hint prioritisation, the 6-field stamp payload (called once, `merge: true`, correct keys and values), auto-promote at 100% and auto-demote below, reactivity to a newly-added required field, and the `is_fast_fashion` conditional-required case | **YES — 4 of 34 assertions.** `2b`, `2c`, `4a`, `4c` assert pre-TALLY-164 `ai_blockers`/hint behaviour |
| `lib/brandRegistry.test.ts` | `normalizeBrand`, `loadBrandRegistry` shape, `matchBrand` (exact key → alias walk → null, case- and whitespace-insensitive, aliases not colliding across brands), and **`deriveSiteTargetKeys`** — tolerant Active-Websites → site_targets derivation, incl. mixed bare/domain input, case normalisation, inactive-site skipping, dedupe, and null/empty handling | **PARTIALLY — 17 of 33 assertions protect dead code.** `deriveSiteTargetKeys` and `buildActiveRegistryView` have **no production caller** (`deep-map-site.md` DEFECT B2-4) |
| `lib/departmentRegistry.test.ts` | The pure helpers of `routes/departmentRegistry.ts`: `shapeDepartmentEntry` defaults, `filterDepartmentEntries` active-only, `compareDepartmentEntries` (priority asc then key), `resolveAllowedDepartmentValues` (key + display_name + aliases, active-only), `isDepartmentValueAllowed` rejection of unknown/empty/null/whitespace, per-write-not-retroactive semantics, and the `enum_source`-over-`dropdown_options` precedence contract | No |
| `lib/parseAdditionalImageUrls.test.ts` | Comma-separated URL parsing: null/undefined/empty → `[]`, single, multi, trailing comma, internal double commas, surrounding whitespace, whitespace-only, leading comma | No |
| `middleware/requireSchedulerOIDC.test.ts` | The OIDC gate's four rejection paths (invalid signature, wrong audience, wrong email, `email_verified: false`) — each asserting 401 + `SCHEDULER_OIDC_REJECTED` + `next()` not called — plus the valid-token accept path | No |

**Also flagged by §3 N2: `scripts/test-tally107.js`.** Confirmed superseded — its header (`:3-5`) documents `pricing_domain_state = export_ready` (snake_case), while every live writer and `services/exportEligibility.ts:28` use `"Export Ready"`. It also hardcodes a Firebase Web API key (`:23`) and a Cloud Run URL (`:22`), and it is one of the 131 unreferenced scripts. It asserts a value the system cannot see.

**What no test covers, that matters most:**
- **Every route gate.** 202 handlers, 0 tested. The 13 ungated routes (H1) would be caught by a single gate-inventory test.
- **The pricing state machine.** 14 writers of `pricing_domain_state` across 8 files, 0 tests.
- **The cadence engine.** `matchesTargetFilters` / `evaluateFilter` / `resolveBuyerForProduct` — all pure and trivially testable, all untested. `cadenceEngine.ts` is 700+ lines.
- **Smart rules.** `writeRuleAction`'s registry gate, Human-Verified ceiling and fill-if-empty logic — the exact place where a `brand_key` rule silently no-ops.
- **`exportSerializer.ts`** — including the `attrs["department"]` quarantine leak.

---

## N3 — Frontend

**Zero frontend tests. Confirmed:** no `*.test.tsx` / `*.test.ts` / `*.spec.*` under `frontend/src`; no `test` script in `frontend/package.json:5-9` (only `dev`, `build`, `preview`); no vitest, jest, testing-library or playwright in `dependencies` or `devDependencies`.

### The five components whose breakage would be most visible to operators

Ranked by blast radius across the live surfaces, as first-smoke-test candidates:

| # | Component | Why it is the highest-value first test |
|---|---|---|
| **1** | **[AttributeField.tsx](frontend/src/components/AttributeField.tsx)** | The single control every product edit flows through. It resolves 3 registry sources, runs the alias-walk (`displayToBrandKey`/`displayToDeptKey`), derives `effectiveType` from a 6-value union **overridden by option presence** (`:170-176`), and implements the 3-part failure contract (fetch-fail / empty / orphaned-value). It is also where G2 (no `is_editable`), G5 (no required indicator) and G12-3 (`width` rendering as `"5 (inactive)"`) all live. Pure props-in, DOM-out — trivially testable |
| **2** | **[ProductListPage.tsx](frontend/src/pages/ProductListPage.tsx)** | The default operator surface. Owns URL-param ↔ filter-state sync (`:60-81`), the wire-name translation `brand_key` → `?brand=` (`:219-222`) that G-NEW-1/2 shows the Completion Queue getting wrong, registry-backed dropdowns with an inactive-value fallback (`:543-641`), and server-side sort/pagination |
| **3** | **[QuickEditPanel.tsx](frontend/src/components/QuickEditPanel.tsx)** | The bulk-edit path. Contains the `department` → `department_key` save-key rewrite (`:234`) that G-NEW-6 shows leaving `search_tokens` stale, and the brand display↔key round-trip (`:161`, `:316-336`) that B3-8 shows flipping the stored value form |
| **4** | **[CockpitDrawer.tsx](frontend/src/components/cockpit/CockpitDrawer.tsx)** | The buyer's primary action surface — keyboard-driven (`j`/`k`/`a`/`d`/`h`), calls three mutating endpoints, and is where the broken Hold action (I9-1) is invoked |
| **5** | **[lib/api.ts](frontend/src/lib/api.ts)** | Not a component, but 133 route paths and every request/response type in one 3,600-line file with no test. A contract test here would catch the whole class of O1 mismatches |

`roleGates.ts` is a close sixth — 4 pure functions duplicating backend gates, with the BE `file:line` pinned in comments and nothing keeping them in sync.

---

## N4 — Dependencies

### `npm audit` — read-only, not fixed

| | backend/functions | frontend |
|---|---|---|
| critical | **3** | **1** |
| high | **8** | **6** |
| moderate | **18** | **14** |
| low | **1** | **1** |
| **total** | **30** | **22** |

**Critical / high packages, backend (11):** `form-data` *(critical)* · `request` *(critical)* · `websocket-driver` *(critical)* · `@grpc/grpc-js` *(high — malformed request crashes the server, CVSS 7.5, GHSA-5375-pq7m-f5r2)* · `axios` *(high)* · `brace-expansion` *(high)* · `fast-xml-builder` *(high)* · `js-yaml` *(high)* · **`multer` *(high)*** · **`nodemailer` *(high)*** · `protobufjs` *(high)*.

**Critical / high, frontend (7):** `websocket-driver` *(critical)* · `@grpc/grpc-js`, `nanoid`, `postcss`, `protobufjs`, `undici`, **`vite`** *(all high)*.

Two worth naming, because they sit on paths this audit already flagged:
- **`multer` (high)** is the upload middleware on all 6 upload routes — **three of which are ungated** (H1) and **none of which has a MIME filter** (H5).
- **`@grpc/grpc-js` (high, CVSS 7.5)** is the Firestore transport, present in both workspaces.
- `request` and `form-data` (both critical) arrive transitively via `@sendgrid/client`, on the email path.

Also: **`@anthropic-ai/sdk` is flagged moderate** (GHSA-p7fg-763f-g4gf, insecure default file permissions in the local-filesystem memory tool, affects `>=0.79.0 <0.91.1`; pinned at `^0.90.0`). The finding does not apply here — the repo never uses that tool — but the version is in range.

### Packages ≥2 majors behind

| Workspace | Package | Current | Latest | Majors behind |
|---|---|---|---|---|
| backend | `firebase-admin` | 12.7.0 | 14.3.0 | **2** |
| backend | `google-auth-library` | 9.15.1 | 11.0.2 | **2** |
| backend | `typescript` | 5.9.3 | 7.0.2 | **2** |
| backend | `eslint` | 8.57.1 | 10.9.1 | **2** |
| frontend | **`vite`** | 5.4.21 | 8.2.2 | **3** |
| frontend | `firebase` | 10.14.1 | 12.18.0 | **2** |
| frontend | `@vitejs/plugin-react` | 4.7.0 | 6.1.0 | **2** |
| frontend | `typescript` | 5.9.3 | 7.0.2 | **2** |

`vite` at 3 majors behind is also one of the high-severity advisories.

### Declared but unused

`depcheck` is not available in this environment; done by grepping every `import`/`require` specifier in each workspace's `src/`.

| Workspace | Package | Version | Note |
|---|---|---|---|
| backend | **`@anthropic-ai/sdk`** | `^0.90.0` | **Never imported.** `lib/aiConfig.ts:44-90` calls the Anthropic HTTP API through raw `fetch`, not the SDK. Carrying a moderate advisory for a dependency the code does not use |
| backend | `nodemailer-sendgrid` | `^1.0.3` | Never imported. `emailService.ts` uses `@sendgrid/mail` and plain `nodemailer` |
| frontend | `@tiptap/core` | `3.22.4` | Never imported directly — but a required peer of `@tiptap/react`, which **is** used by `RichTextEditor.tsx`. **Not removable** |
| frontend | `@tiptap/pm` | `3.22.4` | Same — required peer. **Not removable** |

So **2 genuinely removable backend dependencies**, both carrying advisories.

Separately, `json2csv` is pinned at `^6.0.0-alpha.2` — an **alpha release in production**. It *is* used ([exportSerializer.ts:7](backend/functions/src/services/exportSerializer.ts#L7), [pricingExport.ts:8](backend/functions/src/routes/pricingExport.ts#L8)); `products.ts:411` documents the pin deliberately ("json2csv is alpha-pinned in package.json and stays unused" — that comment is now stale: it is used by two other files).

---

## Summary

| Item | Result |
|---|---|
| Backend source files | **97** |
| …with a test | **4 (4.1%)** |
| Routers tested | **0 of 47** · route handlers tested: **0 of 202** |
| Test suites | **5** — 129 passed, **4 failed** |
| Suites asserting superseded behaviour | **2** (`completionCompute.test.ts` ×4 assertions; `brandRegistry.test.ts` ×17 protecting dead code) + `scripts/test-tally107.js` |
| Test harnesses that exit non-zero on failure | **0 of 5** |
| CI workflows | **0** |
| Frontend tests | **0** |
| npm vulnerabilities | backend **30** (3 crit / 8 high) · frontend **22** (1 crit / 6 high) |
| Packages ≥2 majors behind | **8** (`vite` is 3) |
| Unused declared dependencies | **2 removable** (`@anthropic-ai/sdk`, `nodemailer-sendgrid`) |

### The three worst

1. **0 of 202 route handlers is tested, and there is no CI.** Every finding in Tasks H, I and J — 13 ungated routes, 3 wrong-collection names, 8 dead actions — is the kind a single inventory test would have caught and pinned.
2. **All five suites exit 0 on failure, and one currently fails 4 assertions.** P1-5's "wire up a test script" is therefore not a one-line change: wiring it up as-is produces a green build on a red suite.
3. **17 of `brandRegistry.test.ts`'s 33 assertions protect code with no production caller.** The single best-covered lib in the repo is half-covering dead code, which makes the 4.1% coverage figure optimistic.
