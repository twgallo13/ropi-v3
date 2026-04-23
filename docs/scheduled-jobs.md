# Scheduled Jobs Runbook

**Project:** `ropi-aoss-dev`
**Region:** `us-central1`
**Time zone:** `America/Los_Angeles` (LA)
**Auth pattern:** Cloud Scheduler → OIDC bearer token → `requireSchedulerOIDC` middleware → internal route
**Tally:** TALLY-DEPLOY-BACKFILL

---

## What this covers

The four scheduled background jobs that keep the ROPI AOSS V3 dev/staging/prod
backend's projections, audit trail, and lifecycle state up to date. Every job is
implemented as a POST route under `/api/v1/internal/jobs/*` on the
`ropi-aoss-api` Cloud Run service, gated by OIDC verification, and triggered by
a Cloud Scheduler HTTP job that mints a Google-issued OIDC token signed for
the dedicated `scheduler-invoker` service account.

No human user can call these routes. They are not exposed to the frontend and
no `requireAuth`/`requireRole` middleware sits in front of them — the OIDC
gate is the sole authorization mechanism.

---

## The four jobs

| Job (Cloud Scheduler ID) | Cron (LA) | Human-readable | Target route | What it does |
|---|---|---|---|---|
| `promote-scheduled-daily` | `55 5 * * *` | Every day 05:55 LA | `POST /api/v1/internal/jobs/promote-scheduled` | Promotes scheduled items whose `scheduled_for` time has passed into the active queue. Writes `audit_log` entry `event_type=scheduled_promotion_automated` with `triggered_by:"scheduler"`. |
| `daily-staleness-sweep` | `0 6 * * *` | Every day 06:00 LA | `POST /api/v1/internal/jobs/daily-staleness-sweep` | **Option B** (PO ruling 2026-04-23). Refreshes `cadence_age_days` and `staleness_indicator` on `complete` products, recomputes the neglected-inventory exec projection, stamps `admin_settings/system_health.last_staleness_refresh_at`. **Does NOT call `runCadenceEvaluation()`** — heavy cadence work stays on Weekly Operations Import. |
| `neglected-inventory-nightly` | `0 2 * * *` | Every day 02:00 LA | `POST /api/v1/internal/jobs/neglected-inventory` | Recomputes the `executive_projections/neglected_inventory` doc, then stamps `computed_by:"scheduler"` + `computed_by_stamped_at`. |
| `weekly-snapshots` | `0 3 * * MON` | Mondays 03:00 LA | `POST /api/v1/internal/jobs/weekly-snapshots` | Writes the weekly `metric_snapshots` rows, then stamps `executive_projections/weekly_snapshots_provenance` with `last_snapshot_run_at`, `last_snapshot_run_by:"scheduler"`, `last_snapshot_written_count`. |

> **Known interaction:** `daily-staleness-sweep` (06:00 LA) re-runs
> `computeNeglectedInventory()` as part of Option B and overwrites the
> `neglected_inventory` doc. This unsets the `computed_by:"scheduler"` stamp
> placed by the 02:00 LA job. The truthful "who last computed" record lives in
> `executive_projections/scheduler_runs.{neglected_inventory,daily_staleness_sweep}`,
> which is the field consumers should read.

---

## Provenance: where each job leaves a trail

Every job updates `executive_projections/scheduler_runs.<job_key>` with:

```json
{
  "last_run_at": "<server timestamp>",
  "duration_ms": <int>,
  "ok": true | false,
  "summary": { ... } | null,
  "error": "<message>" | null
}
```

Job-specific extras:

| Job key | Additional Firestore writes |
|---|---|
| `promote_scheduled` | `audit_log` doc with `event_type=scheduled_promotion_automated`, `triggered_by:"scheduler"` |
| `daily_staleness_sweep` | `admin_settings/system_health.{last_staleness_refresh_at,last_staleness_refresh_summary}`; per-product `cadence_age_days`, `staleness_indicator`, `staleness_refreshed_at` (only when changed); `executive_projections/neglected_inventory` (overwritten via `computeNeglectedInventory()`) |
| `neglected_inventory` | `executive_projections/neglected_inventory.{computed_by:"scheduler",computed_by_stamped_at}` |
| `weekly_snapshots` | New `metric_snapshots` rows; `executive_projections/weekly_snapshots_provenance` |

---

## Service account and IAM

**Dedicated invoker SA:** `scheduler-invoker@ropi-aoss-dev.iam.gserviceaccount.com`

It has *only* the IAM bindings it needs:

| Binding | Resource | Purpose |
|---|---|---|
| `roles/run.invoker` | Cloud Run service `ropi-aoss-api` | Allows the OIDC-bearing request to reach the service |
| `roles/iam.serviceAccountTokenCreator` (granted **to** the Cloud Scheduler service agent `service-<project_number>@gcp-sa-cloudscheduler.iam.gserviceaccount.com` **on** this SA) | This SA itself | Allows Cloud Scheduler to mint OIDC tokens on this SA's behalf |

**Pre-existing caveat:** `allUsers` also holds `roles/run.invoker` on
`ropi-aoss-api` from before this work. The OIDC middleware
(`requireSchedulerOIDC`) is the sole security gate for `/api/v1/internal/jobs/*`.
PO acknowledged this trade-off when greenlighting Phase 2.

---

## Required environment variables (on `ropi-aoss-api`)

The deployed Cloud Run revision **must** have both:

| Var | Value (dev) | Used by |
|---|---|---|
| `SCHEDULER_OIDC_AUDIENCE` | `https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app` (the Cloud Run service URL) | `requireSchedulerOIDC` audience claim re-check |
| `SCHEDULER_OIDC_INVOKER_EMAIL` | `scheduler-invoker@ropi-aoss-dev.iam.gserviceaccount.com` | `requireSchedulerOIDC` email claim check |

If either is missing, the middleware fails closed with HTTP 401 +
`{"code":"SCHEDULER_OIDC_REJECTED"}` and the server log shows the stable
outcome label `env_misconfigured`. Cloud Scheduler will report retries until
the next deploy fixes it.

> **If the Cloud Run service URL ever changes** (e.g., service rename,
> region migration), all four scheduler jobs' `--oidc-token-audience` AND the
> `SCHEDULER_OIDC_AUDIENCE` env var on the Cloud Run service must be updated
> to the new URL in lockstep. Otherwise every scheduled hit will 401 with
> the `audience` outcome label.

---

## Common gcloud operations

All commands below assume `--project=ropi-aoss-dev --location=us-central1`.

```bash
# List all four jobs and their state
gcloud scheduler jobs list \
  --project=ropi-aoss-dev --location=us-central1 \
  --format="table(name.basename(),schedule,timeZone,state,httpTarget.uri.basename())"

# Inspect one job in full
gcloud scheduler jobs describe daily-staleness-sweep \
  --project=ropi-aoss-dev --location=us-central1

# Pause / resume
gcloud scheduler jobs pause  daily-staleness-sweep --project=ropi-aoss-dev --location=us-central1
gcloud scheduler jobs resume daily-staleness-sweep --project=ropi-aoss-dev --location=us-central1

# Manually fire a job (for verification or backfill)
gcloud scheduler jobs run daily-staleness-sweep --project=ropi-aoss-dev --location=us-central1
```

After a manual run, verify in two places:

1. **Cloud Run logs** — the request should appear with user agent
   `Google-Cloud-Scheduler` and HTTP status `200`:

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="ropi-aoss-api" AND httpRequest.requestUrl:"/api/v1/internal/jobs/"' \
     --project=ropi-aoss-dev --limit=10 --freshness=15m \
     --format="value(timestamp,httpRequest.status,httpRequest.userAgent,httpRequest.requestUrl)"
   ```

2. **Firestore provenance** — `executive_projections/scheduler_runs.<job_key>`
   should have `ok:true` and a fresh `last_run_at`. See the table above for
   the job-specific extras to spot-check.

---

## Failure modes and what they mean

| Symptom | Likely cause | Fix |
|---|---|---|
| Scheduler logs the run as 401 (`SCHEDULER_OIDC_REJECTED`, label `env_misconfigured`) | Either env var missing on the running revision | Re-deploy with `--update-env-vars=...` (or `gcloud run services update --update-env-vars=...`) |
| Scheduler logs 401 (label `audience`) | `SCHEDULER_OIDC_AUDIENCE` env doesn't match the scheduler job's `--oidc-token-audience` | Make both equal to the current Cloud Run service URL |
| Scheduler logs 401 (label `email`) | Scheduler job is using a different SA than `SCHEDULER_OIDC_INVOKER_EMAIL` | Match them, or rotate the SA + update both ends |
| Scheduler logs 401 (label `signature_or_audience`) | Token signature failed Google JWKS verification (often a different `aud`/issuer) | Check `--oidc-token-audience` and `--oidc-service-account-email` on the job |
| Scheduler attempts succeed (200) but `scheduler_runs.<job>.ok=false` | Service-side error inside the wrapped function | Inspect `scheduler_runs.<job>.error` and Cloud Run logs at the recorded `last_run_at` |
| `gcloud scheduler jobs run` returns success but no traffic at the service | Cloud Scheduler service agent missing `roles/iam.serviceAccountTokenCreator` on `scheduler-invoker` | `gcloud iam service-accounts add-iam-policy-binding scheduler-invoker@ropi-aoss-dev.iam.gserviceaccount.com --member="serviceAccount:service-<project_number>@gcp-sa-cloudscheduler.iam.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator" --project=ropi-aoss-dev` |

---

## Forward work

A future tally — provisional name **TALLY-SCHEDULED-JOBS-ADMIN** — is expected
to surface job state, last-run results, and one-click manual-trigger from
`/admin/scheduled-jobs` in the frontend, backed by `scheduler_runs` and a
read-only Cloud Scheduler list endpoint. Until that ships, this runbook + the
gcloud commands above are the operator interface.
