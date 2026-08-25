# TASK A — Gate 2 maps: Phase 4 (Launch)

Template per §3 TASK A. Repo @ `2698e48`; live reads against `ropi-aoss-dev`.

---

## P4-1 — Calendar reachable logged-in
Edit surface (from Build Plan): `App.tsx` route placement (:140), `Sidebar.tsx`
Fields/collections/endpoints/states this tally writes or renames: none — routing only.
Blast radius:
  Backend readers/writers: [launches.ts:128-182](backend/functions/src/routes/launches.ts#L128) — `GET /api/v1/launches/public`, gate **NONE**, marked intentionally public by the comment at `:125` ("UNAUTHENTICATED"). It reads `admin_settings/launch_past_retention_days` at `:131-135`.
  Frontend readers/renderers: **[App.tsx:140](frontend/src/App.tsx#L140)** — `<Route path="/launches" element={<PublicLaunchCalendarPage />} />`, placed **outside** the `<Route element={<RequireAuth />}>` wrapper that opens at `:141` and **outside** `<Route element={<Layout />}>` at `:142`. So `/launches` today renders with **no sidebar, no top bar, and no auth**. The comment at `:139` states this explicitly. [PublicLaunchCalendarPage.tsx](frontend/src/pages/PublicLaunchCalendarPage.tsx) is the component.
  **[Sidebar.tsx](frontend/src/components/Sidebar.tsx) has no `/launches` entry.** Its Product Operations group ([:44-57](frontend/src/components/Sidebar.tsx#L44-L57)) lists Import Hub, Export Center, **Launch Admin (`/launch-admin`)**, MAP Policy, Site Verification, Review Active Overrides — the *admin* launch surface, not the calendar.
  Scripts: [scripts/acceptance-launch-calendar.js](scripts/acceptance-launch-calendar.js) + its `.json` output.
  Composite indexes: `launch_records` indexes back the `/public` query; see `security.md` for the full list.
  Security rules: NONE (`launch_records` falls to deny-all; served only via the API).
  Downstream consumers: the public calendar page only.
  Live Firestore: **`launch_records` — 9 docs.**
Build Plan "?" markers on this tally: none.
Edit-surface check: **clean, with one structural caveat worth stating.** The two declared files are exactly the right ones. But moving `/launches` inside `RequireAuth`+`Layout` to make it reachable logged-in would make it **unreachable logged-out**, which is the current stated purpose (the backend route is deliberately public). Making it reachable *both* ways means either two routes to one component or a route outside `RequireAuth` but inside `Layout` — and `Layout` renders `Sidebar`, which calls `useAuth()`. That is a real design fork inside a 2-file surface, not a scope risk.

---

## P4-2 — One email system + base URL setting
Edit surface (from Build Plan): `launchNotifier.ts` (SendGrid :19-25, :51-100) → `emailService.ts`; `admin_settings` key
Fields/collections/endpoints/states this tally writes or renames: no product fields; consolidates two email paths and adds an `admin_settings` base-URL key.
Blast radius:
  Backend readers/writers — **there are two entirely separate email implementations, and they behave oppositely on failure:**
  | | `services/launchNotifier.ts` | `services/emailService.ts` |
  |---|---|---|
  | Transport | raw `fetch` to `https://api.sendgrid.com/v3/mail/send` ([:81](backend/functions/src/services/launchNotifier.ts#L81)) | `@sendgrid/mail` SDK ([:56-64](backend/functions/src/services/emailService.ts#L56-L64)) **or** `nodemailer` SMTP |
  | Provider choice | hardcoded SendGrid | `admin_settings/email_provider` ([:47](backend/functions/src/services/emailService.ts#L47), default `"sendgrid"`) |
  | From address | `process.env.LAUNCH_NOTIFIER_FROM` \|\| hardcoded `"launches@shiekh.com"` ([:25](backend/functions/src/services/launchNotifier.ts#L25)) | `admin_settings/smtp_from_address` \|\| hardcoded `"theo@shiekhshoes.org"` ([:38-41](backend/functions/src/services/emailService.ts#L38-L41)) |
  | Templates | 3 SendGrid dynamic template ids from env ([:19-24](backend/functions/src/services/launchNotifier.ts#L19-L24)) | inline `html` string from the caller |
  | Missing API key | **logs and returns `{sent:false}` — silent** ([:57-63](backend/functions/src/services/launchNotifier.ts#L57-L63)) | **throws** ([:51-55](backend/functions/src/services/emailService.ts#L51-L55)) |
  | HTTP error | `console.error` + `{sent:false}` ([:89-93](backend/functions/src/services/launchNotifier.ts#L89-L93)) | throws with the SendGrid message ([:65-69](backend/functions/src/services/emailService.ts#L65-L69)) |
  Frontend readers/renderers: [SmtpSettingsPage.tsx](frontend/src/pages/SmtpSettingsPage.tsx) at `/admin/infrastructure/smtp` — edits the `smtp_*` and `email_provider` settings and calls the test route. Nothing in the frontend configures `launchNotifier`'s env-var settings.
  Scripts: [scripts/seed/seed-smtp-settings.js](scripts/seed/seed-smtp-settings.js).
  Composite indexes: NONE.
  Security rules: NONE (`launch_subscribers` deny-all).
  Downstream consumers: launch subscribers (external humans) and the SMTP test button.
  Live Firestore: `admin_settings/email_provider = "custom_smtp"`, `smtp_from_address = "theo@shiekhshoes.org"`, `smtp_from_name = "ROPI Operations"`, `smtp_host = "smtp.gmail.com"`, `smtp_port = 465`, `smtp_username = "theo@shiekhshoes.org"`, `smtp_throttle_hours = 24`. **`launch_subscribers` — 1 doc**, `theo@shiekh.com`, all three preferences `true`.
Build Plan "?" markers on this tally:
  **"every caller of launchNotifier" → CONFIRMED: exactly 3, all in `routes/launches.ts`.**
  [launches.ts:526](backend/functions/src/routes/launches.ts#L526) `notifyDateChanged(launch, oldDate)` · [:645](backend/functions/src/routes/launches.ts#L645) `notifyNewLaunch(published)` · [:730](backend/functions/src/routes/launches.ts#L730) `notifyNewComment(launch, comment_text, authorName)`. Imported at `:31-34`. No other file imports the module.
  **"every emailService caller" → CONFIRMED: exactly 1.**
  [adminSettings.ts:96](backend/functions/src/routes/adminSettings.ts#L96), inside `POST /api/v1/admin/smtp/test` (`:83`, `requireAuth + requireRole(["admin","owner"])`). Imported at `:16`. **`emailService.sendEmail` is used by nothing except the SMTP test button** — so the module the tally consolidates *onto* currently has zero production traffic, and the module it consolidates *from* carries all of it. See **FINDING A-P4-2-a**.
Edit-surface check: **SCOPE RISK — 3 items outside the declared surface.**
  1. **`routes/launches.ts:526`/`:645`/`:730`** — the three call sites. `launchNotifier`'s three exports take domain objects (`launch`, `oldDate`, `comment_text`, `authorName`) and build dynamic-template payloads; `emailService.sendEmail` takes `{to, subject, html}`. Consolidating means writing the subject/HTML somewhere, and the natural home is the call sites.
  2. **`admin_settings` key management** — the "base URL setting" needs a read path. The only generic reader is `emailService.getAdminSetting` ([:15-27](backend/functions/src/services/emailService.ts#L15-L27)), which is exported from `emailService.ts` (in surface) — but the *seed* is `scripts/seed/seed-admin-settings.js` (not in surface), and the *editor* is `SmtpSettingsPage.tsx` / `SystemVariablesPage.tsx` (not in surface).
  3. **`services/pricingResolution.ts:315-330`** sends **in-app** notifications to head buyers on loss-leader routing, and `routes/exports.ts:207-216` writes `notifications` docs. Those are a third notification path that neither email module covers; a "one email system" tally should record that in-app notification is separate and stays separate.

**[FINDING A-P4-2-a] The two email paths disagree on failure semantics, and the production one fails silently.**
All real outbound email flows through `launchNotifier`, which returns `{sent: false, reason}` and logs to stdout when `SENDGRID_API_KEY` is unset ([:57-63](backend/functions/src/services/launchNotifier.ts#L57-L63)), when a template id is unset (`:64-67`), or when SendGrid returns non-2xx (`:89-93`). **The three callers in `launches.ts` ignore the return value entirely** — `:526`, `:645`, `:730` are bare `await`s. So a launch can be published, the subscriber list read, and zero emails sent, with no signal to the operator, no `audit_log` entry, and no notification. Meanwhile `emailService` — used only by the test button — throws loudly. The system's only *working* feedback path is the one nothing uses. Carried to Task M3 and M4.

**[FINDING A-P4-2-b] Live config points at `custom_smtp` while the production sender is hardcoded to SendGrid.**
`admin_settings/email_provider = "custom_smtp"` with `smtp_host = "smtp.gmail.com"`, `smtp_port = 465`. That setting is read **only** by `emailService.ts:47` — i.e. only by the test button. `launchNotifier.ts` never reads it and always calls SendGrid. An admin who configures and successfully tests SMTP has changed nothing about how launch emails are actually sent.

---

## P4-3 — Launch admin completeness (+ MPN auto-create idea)
Edit surface (from Build Plan): `routes/launches.ts` create :363; `LaunchAdminDetailPage`
Fields/collections/endpoints/states this tally writes or renames: `launch_records` document shape.
Blast radius:
  Backend readers/writers — the `launches.ts` router, 12 handlers:
  | Method | Path | file:line | Gate |
  |---|---|---|---|
  | GET | `/api/v1/launches/public` | [:128](backend/functions/src/routes/launches.ts#L128) | **NONE** (intentional) |
  | POST | `/api/v1/launches/subscribe` | [:187](backend/functions/src/routes/launches.ts#L187) | **NONE** (intentional) |
  | DELETE | `/api/v1/launches/unsubscribe` | [:225](backend/functions/src/routes/launches.ts#L225) | **NONE** (intentional) |
  | GET | `/api/v1/launches/` | [:244](backend/functions/src/routes/launches.ts#L244) | `requireAuth` |
  | GET | `/api/v1/launches/upcoming` | [:282](backend/functions/src/routes/launches.ts#L282) | `requireAuth` |
  | GET | `/api/v1/launches/:launch_id` | [:326](backend/functions/src/routes/launches.ts#L326) | `requireAuth` |
  | **POST** | **`/api/v1/launches/`** | **[:363](backend/functions/src/routes/launches.ts#L363)** | `requireAuth + requireRole(LAUNCH_EDITOR_ROLES)` |
  | PATCH | `/api/v1/launches/:launch_id` | [:448](backend/functions/src/routes/launches.ts#L448) | same |
  | POST | `/api/v1/launches/:launch_id/images` | [:547](backend/functions/src/routes/launches.ts#L547) | same + multer |
  | POST | `/api/v1/launches/:launch_id/publish` | [:606](backend/functions/src/routes/launches.ts#L606) | same |
  | POST | `/api/v1/launches/:launch_id/token-status` | [:658](backend/functions/src/routes/launches.ts#L658) | same |
  | POST | `/api/v1/launches/:launch_id/comments` | [:690](backend/functions/src/routes/launches.ts#L690) | `requireAuth` |
  | DELETE | `/api/v1/launches/:launch_id` | [:748](backend/functions/src/routes/launches.ts#L748) | same as editors |
  Field allowlists appear three times: [:51](backend/functions/src/routes/launches.ts#L51), [:373](backend/functions/src/routes/launches.ts#L373), [:468](backend/functions/src/routes/launches.ts#L468).
  Services: [launchHighPriority.ts](backend/functions/src/services/launchHighPriority.ts) — `checkHighPriorityFlag(mpn)`, called fire-and-forget from [completionCompute.ts:362-364](backend/functions/src/services/completionCompute.ts#L362-L364) on incomplete→complete promotion. [launchNotifier.ts](backend/functions/src/services/launchNotifier.ts) — the 3 triggers.
  Frontend readers/renderers: [LaunchAdminListPage.tsx](frontend/src/pages/LaunchAdminListPage.tsx) (list + the create form; the brand field at `:267-268` is a free-text `<input>`) · **[LaunchAdminDetailPage.tsx](frontend/src/pages/LaunchAdminDetailPage.tsx)** (the declared surface) · [PublicLaunchCalendarPage.tsx](frontend/src/pages/PublicLaunchCalendarPage.tsx).
  Scripts: [scripts/acceptance-launch-calendar.js](scripts/acceptance-launch-calendar.js).
  Composite indexes: `launch_records` composite entries exist in `firebase/firestore.indexes.json`.
  Security rules: NONE.
  Downstream consumers: the public calendar · launch notification emails · `checkHighPriorityFlag` on product completion.
  Live Firestore: **`launch_records` — 9 docs. `launch_comments` — 2 docs. `launch_subscribers` — 1 doc.**
  Live field set on `launch_records` (union across the 9 docs): `launch_id`, `mpn`, **`mpn_is_placeholder`**, `product_name`, `brand`, `sales_channel`, **`drawing_fcfs`**, `is_high_priority`, `gender`, `category`, `class`, `primary_color`, `image_1_url`, `image_2_url`, `image_3_url`, `linked_product_mpn`, **`is_launch_only`**, `created_by`, `archived_at`, `created_at`, `token_status`, `teaser_text`, `internal_comments_count`, **`launch_status`**, `published_at`, `date_change_log`, `previous_launch_date`, `updated_at`, `date_changed_at`, `launch_date`, `date_change_badge_expires_at`.
Build Plan "?" markers on this tally: **"placeholder checkbox consumers" → CONFIRMED. There are two distinct placeholder-ish booleans, and they have different consumer counts.**
  - **`mpn_is_placeholder`** — present on live docs. This is the "MPN auto-create" hook the tally names. Consumers: written in `launches.ts` (create/patch allowlists at `:51`/`:373`/`:468`); read by `LaunchAdminListPage.tsx` and `LaunchAdminDetailPage.tsx` for display. **No backend logic branches on it** — `grep -rn mpn_is_placeholder backend/functions/src` shows it only inside the field allowlists, never in a conditional. So today it is a label the operator sets and nothing acts on.
  - **`is_launch_only`** — same shape: allowlisted, stored, displayed, never branched on in the backend.
  Both are therefore "placeholder checkboxes" in the literal sense: they persist and render, and drive no behaviour.
Edit-surface check: **SCOPE RISK — 4 items outside the declared surface.**
  1. **The field allowlist is in three places** ([:51](backend/functions/src/routes/launches.ts#L51), [:373](backend/functions/src/routes/launches.ts#L373), [:468](backend/functions/src/routes/launches.ts#L468)); the surface names only the create path at `:363`. Adding a field to create without adding it to the PATCH allowlist at `:468` makes it un-editable after creation.
  2. **`LaunchAdminListPage.tsx` holds the create form** (`:208`, `:267-268`), not `LaunchAdminDetailPage.tsx`. The surface names the detail page only.
  3. **MPN auto-create** would need to write a `products` doc, which means `services/mpnUtils.ts` (`mpnToDocId`) and the product creation path — neither in surface.
  4. **`services/launchHighPriority.ts`** reads `launch_records` on every product completion; a shape change touches it.

**[FINDING A-P4-3-a] `launch_records` has no `status` field; the live field is `launch_status`, and it is `undefined` on all 9 docs.**
Reading `status` across the 9 live docs gives `undefined` ×9. The key present in the document is `launch_status`. Task J4's stated workflow ("`launch_records` status + readiness + publish + archive") therefore has no `status` field to track — the state is carried by `launch_status`, `published_at`, `archived_at`, `token_status` and `date_change_badge_expires_at` in combination. Full state enumeration in `workflows.md` (J4).

---

## Phase 4 summary

| Tally | ? markers | Converted | Out-of-surface consumers |
|---|---|---|---|
| P4-1 | 0 | — | 0 (design fork noted) |
| P4-2 | 2 | 2 CONFIRMED | **3** |
| P4-3 | 1 | 1 CONFIRMED | **4** |
| **Total** | **3** | **3 CONFIRMED** | **7** |
