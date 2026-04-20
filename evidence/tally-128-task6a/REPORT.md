# TALLY-128 Task 6 Subtask 6a — Investigation Report

**Status:** Investigation complete (read-only)
**Project:** `ropi-aoss-dev`
**Time-box target:** ~30min · **Actual:** ~25min
**Outcome:** **INV-A — Historical artifact.** Detection is not currently firing.

---

## Step 1 — Code trace

Source: [backend/functions/src/routes/siteVerificationReview.ts L43-58, L137-151](backend/functions/src/routes/siteVerificationReview.ts).

| Question | Finding |
|---|---|
| Registry keyed by? | `Map<string, RegistryEntry>` keyed by `data.site_key` (fallback `doc.id`). |
| Filter at load? | **No `is_active` filter** — `loadRegistry()` loads ALL site_registry docs (active + inactive). |
| Comparison? | `registry.get(targetKey)` where `targetKey = t.site_id || stDoc.id`. **Case-sensitive** Map.get(). No normalization on either side. |
| Cache layer? | **None.** Registry loaded fresh per `/review` call. No stale-cache vector possible. |
| Trigger? | GET `/api/v1/site-verification/review` — iterates every product × every site_targets subcollection doc with `active != false`. |
| Orphan condition | `if (!reg)` — i.e., the lookup key is genuinely absent from the Map. Inactive-but-registered keys hit the next branch (`if (!reg.is_active) continue;`) and are silently skipped — they should NOT produce orphan events under the current code. |

## Step 2 — Historical time buckets

File: [evidence/tally-128-task6a/investigation.log](evidence/tally-128-task6a/investigation.log)

| Bucket | Count |
|---|---:|
| All-time | **5,875** ✅ matches Task 1 diagnostic |
| Last 24h | **0** |
| Last 7d  | 5,875 |
| Last 30d | 5,875 |
| Since Round 5 (`2026-04-17T00:00:00Z`) | 5,875 |
| Since Task 5 (`2026-04-20T22:32:49Z`) | **0** |

**Time range of all 5,875 events:** `2026-04-19T16:34:27.337Z` → `2026-04-19T21:53:16.227Z`
**Daily distribution:** **2026-04-19: 5,875** — every single event fired in a single ~5h window on one day.

### `orphaned_site_key` value distribution (all 5,875)
| Key | Count | Currently active in registry? |
|---|---:|---|
| shiekh | 2,570 | ✅ yes |
| karmaloop | 1,840 | ✅ yes |
| mltd | 1,155 | ✅ yes |
| plndr | 235 | ❌ inactive but registered |
| shiekhshoes | 40 | ❌ inactive but registered |
| fbrk | 25 | ❌ inactive but registered |
| trendswap | 10 | ❌ inactive but registered |

Note: all 310 inactive-key events ALSO contradict the current code path (inactive-but-registered should silent-skip, not orphan-log) — meaning at write time on 4/19, those keys were genuinely absent from the registry Map, not just inactive.

### Last-24h `orphaned_site_key` distribution
**0 events.**

## Step 3 — Post-Task-5 signal

| Window | Count |
|---|---:|
| Since Task 5 execute (`2026-04-20T22:32:49Z`) | **0** |
| All `audit_log` events since post-4/19-burst (`2026-04-19T22:00:00Z`) | 34 |

The 34 events in the post-burst window include 2 `site_verification.reverified`, 2 `site_verification_mark_live`, 1 `site_verification_flag`, 22 `field_edited`, etc. The reviewer-mutation events strongly imply human reviewers were exercising the Site Verification queue (which hits `/review`) — yet zero orphan events fired during that window.

## Step 4 — Outcome classification

### **INV-A — Historical artifact.**

All 5,875 events fired in a single 5-hour window on 2026-04-19 and have not recurred. The system has been exercised since (34 unrelated audit events including reviewer mutations), and Task 5 has now executed cleanly with zero subsequent orphan events. The detection has not produced a single false positive in the ~25h since the 4/19 burst.

### Root-cause hypothesis (sufficient for classification, not exhaustive)

A transient state on 2026-04-19 produced the burst. The most plausible explanation, without deep-diving (per dev-mode rule):

The `loadRegistry()` call returned a non-canonical Map on 4/19 — either because the registry collection was mid-migration during a deploy, the read raced with a writer, or `data.site_key` field values were transiently divergent from doc IDs at that moment. Active-key lookups failed against whatever was in the Map; *all* site_target keys looked unrecognized; the orphan branch fired for every doc encountered. The TALLY-123 commit history (4 sequential deploys: ee3f647 → d11fd1c → ad12c77 → 615cb09) is consistent with at least one such transient window.

**The detection logic itself is not malfunctioning under current registry state** — both Task 5's pre-execute scan (Outcome 2A, 1,175 docs) and the post-execute spot-checks demonstrated that `targetKey` values cleanly match `site_registry` doc IDs. The TALLY-122 desuffix migration is stable; the TALLY-125 Round 5 cleanup is stable; the Task 5 cleanup is stable.

## Recommendation for Subtask 6b

**Proceed as planned.** Detection removal is independently valuable (the audit-log noise it produces is purely informational and never gates Product Specialist queue rows — it's a pure logging side-effect with no downstream consumer). No follow-up bug-fix tally needed (the trigger condition was transient, not a code defect demonstrable against current state).

## Incidental data-quality anomalies — LOGGED, NOT FIXED

- **310 of 5,875 historical events name inactive-but-registered keys** (plndr, shiekhshoes, fbrk, trendswap). Under the current code these would silent-skip (Step 1 trace). Their presence in the orphan log confirms 4/19 was a Map-population anomaly, not a key-mismatch anomaly. No action.
- **22 stale-key site_targets docs remain on gap products** (plndr×16, shiekhshoes×3, fbrk×2, trendswap×1) — already logged in Task 5 Gate as preserved per R2-Q2. If `/review` is ever called against these gap products under the current code, they would silent-skip (inactive registry entries exist), not orphan-log. So gap-bucket preservation does not re-arm the detection. No action.
- The earliest orphan event is `2026-04-19T16:34:27.337Z`; deploy `615cb09` per repo memory is the TALLY-123 final commit. Whether the burst correlates with that deploy timestamp is investigable but not required for classification.

## Hard-rule compliance
- ✅ Read-only — zero writes.
- ✅ Time-box: ~25min (under 30min target).
- ✅ Did NOT proceed to Subtask 6b. No detection code changed.
- ✅ Zero `not_verified` literal in any script.
- ✅ Did not deep-dive individual MPN orphan event histories beyond classification needs.
- ✅ Did not investigate orphan events on Task 5 gap-bucket products.

## Awaiting

Lisa + PO review of INV-A classification before Subtask 6b is dispatched separately.
