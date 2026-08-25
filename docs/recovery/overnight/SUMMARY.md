# OVERNIGHT AUDIT — SUMMARY

Repo `twgallo13/ropi-v3` @ `2698e48` · Firestore `ropi-aoss-dev` (reads only) · READ-ONLY, no Notion, no writes outside `docs/recovery/overnight/`.
**All 15 tasks complete (B, A, C, D, E, G, H, I, J, K, L, M, N, O, F).**

**Tallies mapped: 29 of 29 · ? converted: 25 (23 CONFIRMED, 1 NOT FOUND, 1 N/A-external) · Contradictions: 12 · Sequencing violations: 17**
**Out-of-surface consumers: ~163 across 18 of 29 tallies (P1-2, P1-4, P1-5, P2-1a, P2-1b, P2-2, P2-3a, P2-3b, P2-5, P2-6, P2-7, P3-1, P3-2, P3-3, P4-2, P4-3, P5-2, P5-3) · UX defects: 16 Blocks work / 20 Misleads / 13 Cosmetic (49) · Open routes: 13 · Stuck states: 11 · Orphan refs: 17 · Silent failures: 20 classes over 250 log-and-continue catches · Hardcoded-should-be-settings: 32 · Blockers: 2 · Self-check: 5/5 re-verified, 0 corrections**

**E1** Smart rules write `attribute_values` only (`smartRules.ts:252`); target must be a registry **doc id** or it is silently skipped (`:244-249`); one hardcoded root write for `rule_uuid_name_cleanup`.
**E2** `depends_on` is **strict string equality only** — no operator field (`completionCompute.ts:30`, `:129-135`). Cannot express INCLUDES. All 5 live uses are non-required, so it has zero effect today.
**E3** 12 of 14 cadence rules filter `department_key`, 3 `site_owner`, 1 `brand_key`, 0 `department`. **All values lowercase** — Appendix B's `Clothing` example is not confirmed.
**E4** The three site descriptions **do not exist** in any form. Nearest: `content_versions` (per-site generated content) and `site_registry.ai_content_strategy`, which is seeded and read by nothing.
**E5** Export emits brand←root · department←**quarantined `attribute_values/department` (25/81)** · class/category/sub_category←`attribute_values` (**sub_category always empty**) · website←dynamic registry column · site info←`site_targets.domain` joined by `"|"`.
**E6** `orders`/`payments`/`sessions` indexes: **UNREFERENCED** — 5 entries, no code, no live collections, camelCase fields, no `__comment__` tags.
**E7** **No runtime reference** to staging/prod — only `deploy-prod.sh:6` and `deploy-staging.sh:5`. Staging is `ropi-aoss-staging-v3`.
**E8** AI Describe takes the site **from the request body**, unvalidated (`aiContent.ts:25`, `:34-36`) — no registry, active, or ownership check.
**E9** `POST /name/:mpn` uses only the **short** RICS description (`aiEnrichment.ts:102`); the long one is loaded and unused. 5 live smart rules substring-match both; `aiDescribe.ts:16-17` excludes them under the **wrong spelling**.

**Worst three contradictions:** (C1) `docs/scheduled-jobs.md` documents 4 scheduler jobs; `internalJobs.ts` implements 3 — `/neglected-inventory` does not exist. (C10) `migrate-pricing-current-to-export-ready.js:26` writes `"export_ready"` while every writer and `exportEligibility.ts:28` use `"Export Ready"` — 2 snake_case rows are live in `buyer_actions`. (C5) Two of six "known" K2 values don't exist: no MAP tolerance anywhere; removal-review defer is **7** days (`mapReview.ts:430`), not 90.

**Worst sequencing:** (D1) P1-2's acceptance criterion is unreachable until a Phase 2 tally makes completion satisfiable. (D16) P1-1 is safe via `index.ts` mounts, unsafe via router-level middleware inside the frozen `importFullProduct.ts`. (D9) P2-2/P2-3a/P2-5 edit adjacent branches of one `if/else if` at `products.ts:1165-1226`.

**Five worst UX defects:** no product can reach 100% (3 of 14 required fields unfillable; **0 of 81 complete**, ceiling 79%) · 61 products are simultaneously `status:"Complete"` and `completion_state:"incomplete"` · **no required-field indicator exists anywhere** (`api.ts:334` types it, `AttributeField` has no prop) · Completion Queue Brand/Department filters are free-text matched against lowercase keys · Hold does not hold and the SMTP test proves nothing about production email.

**Stuck/unreachable states (J):** `incomplete` (all 81, predicate unsatisfiable) · `Pricing Current` (**64 products, no automated exit** — P1-2's whole purpose) · cadence `excluded` (**no exit path exists**) · launch `published` (no unpublish) · 2 `export_jobs` stuck in `processing` with no sweeper · unreachable: `complete`, `Pricing Incomplete`, `Scheduled`, `Pricing Pending`, archived launches, 3 of 4 content-version states.

**Orphan refs (L1): 17** — all 9 `launch_records` point at non-existent MPNs (only 1 admits to being a placeholder); 8 products carry a `brand` with no `brand_key`. **All registry and user FKs are clean (0 orphans).**

**Security:** 202 handlers, **13 ungated** (10 accidental) on an `allUsers`-invokable Cloud Run service. Two privilege paths: **`firestore.rules:22`** lets any user write their own `users/{uid}.role`, which `roles.ts:40-45` then trusts; **`X-View-As-Uid`** (`viewAs.ts:28-69`) lets any authorised caller read as any other user on 4 routes with no impersonation check. `roles.ts:30` silently admits `admin`/`owner` to every gate (6 of 14 live users). CORS reflects any origin; no security headers; no rate limiting.

**Also:** 3 wrong-collection-name bugs (`attributes`, `launches`, `buyer_assignments`) · 131 of 152 scripts unreferenced · 2 feature-flag systems with 0 consumers · **no alerting of any kind**, and all four scheduler jobs last ran **2026-04-23**, stamped `ok:true` · audit log has 3 actor names and 3 timestamp names across 39,669 docs, 3,953 with no actor · **0 of 202 route handlers tested**, no CI, all 5 suites exit 0 on failure (one fails 4 assertions) · `attribute_registry` carries **7 pairs of competing field names** across 40 distinct fields.

**Blockers hit (2, neither stopped the run):** `docs/recovery/RECOVERY-ANCHOR.md` and `docs/recovery/PRE-BUILD-PROTOCOL.md` do not exist — `docs/` contains only `scheduled-jobs.md` and this audit file. Task A used the self-contained §3 template; Task C covered Appendix B only.

**Self-check (5/5 re-verified from scratch, 0 corrections):** ① `SEARCH_TOKEN_FIELDS` lacks `department_key` and `120029-CHRMWHTNVY` has no `footwear` token — re-verified. ② `getRequiredFieldKeys` has no `active` filter, returns 14 docs of which `department` is inactive, and 0 products are complete — re-verified. ③ `products.ts:921` builds detail `site_owner` from `site_targets[0]` while `:209` filters on root — re-verified. ④ `dashboard.ts:201` queries `collection("launches")`, live 0 docs vs `launch_records` 9 — re-verified. ⑤ `internalJobs.ts` has 3 `router.post` and 0 matches for `neglected-inventory`, which the runbook documents — re-verified.

**Could not verify:** the two missing `docs/recovery/` files (do not exist) · whether the 4 Cloud Scheduler jobs are still provisioned in GCP (requires `gcloud`, out of scope for a read-only Firestore run) · whether `/admin/ai-automation/completion-rules` renders as a dead link (depends on `AdminNavCard`'s `status:"coming"` handling, a runtime question) · RetailOps' tolerance for extra CSV columns (external system, marked N/A per the brief) · live staging/prod state (dev only, per the brief).

**Repo state at end: HEAD `2698e48340b0f309bafdf9a5a4ced0645b8f160c`, working tree clean except `docs/recovery/overnight/` (untracked).**
