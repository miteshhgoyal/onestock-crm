# Onestock Academy CRM — PRD

## Original problem statement
Web-based CRM for a 20–25 person calling team (Onestock Academy) to capture leads from multiple
sources, assign them across a role hierarchy, track follow-ups and monitor team performance.
Roles: Admin, Sub-admin, Team leader, Telecaller. Stack: React + FastAPI + MongoDB.

## User decisions (locked)
- Sub-admin can create/edit telecallers and team leaders (never admin/sub-admin).
- "No action" for the 12-hour rule = no status update AND no call note logged.
- Auth: JWT email + password (admin seeded from env).
- Lead intake v1: manual + CSV + public webhook endpoint (website form / ads / WhatsApp post here).
- No WhatsApp/email sending in v1 — capture only.

## Architecture
- `backend/server.py` — all API routes under `/api`; `auth.py` — JWT, bcrypt, PERMISSIONS + ROLE_RANK;
  `models.py` — BaseDocument/PyObjectId Pydantic models; `seed_demo.py` — demo users/teams/leads.
- Visibility is compiled into a Mongo predicate per role (`lead_scope`): admin/sub-admin = all,
  team leader = own team, telecaller = own assigned leads only.
- Frontend: React Router + AuthContext (Bearer token in localStorage + httpOnly cookies),
  role-guarded routes, dark Swiss/brutalist theme (Cabinet Grotesk + Satoshi + IBM Plex Mono).
- Escalation runs via platform cron `.emergent/crons.yml` → `POST /api/cron/escalate-leads` every 30 min.

## Implemented (June 2026)
- Branding: Onestock Academy wordmark + candlestick logo mark (`components/LogoMark.js`), teal brand
  accent token (`--brand: 173 100% 44%`) on primary buttons, active nav, focus rings and report bars.
- Team timezone: `TEAM_TZ` (Asia/Kolkata, `TEAM_TIMEZONE` env) drives the "due today" bucket and the
  dashboard due-today counter via `local_day_bounds()`; CSV timestamps rendered in IST.
- CSV export: `GET /api/leads/export` reuses `build_lead_query()` so the download matches the exact
  on-screen filters; managers only (admin/sub-admin/team leader, team-scoped), 14 columns, 5000-row cap.
- Follow-up calendar blocks past dates; toasts moved bottom-right; chart wrappers use fixed heights.- JWT auth, 4 roles, brute-force lockout, admin seeding, demo seed script.
- Users & teams management with role-grant ceiling (cannot create a role at/above your own).
- Leads: manual create, CSV import, public webhook intake, duplicate detection by phone (last 10 digits).
- Pipeline stages: new_lead → assigned → contacted → follow_up → interested / not_interested → converted / lost.
- Manual bulk assignment, auto round-robin assignment, team-leader reassignment within own team.
- Telecaller workspace: Due today / Overdue / All queues, call notes, status update, follow-up scheduler.
- 12-hour escalation: assigned + no note + no action → flagged escalated and reassigned to another telecaller.
- Dashboards (KPIs, leads by stage, leads by source), reports (telecaller + team performance), activity log.
- Branding: Onestock Academy (sidebar, login, page title, API title).

## Backlog
- Calling modes (Sept 2026): every user has `call_mode` — `desktop` rings the **Smartflo Softphone
  Chrome extension** on the PC via their Smartflo `agent_extension` (no mobile involved), `phone`
  keeps the legacy mobile-first click-to-call as a fallback. Self-service via
  `PATCH /api/calls/preferences`; admins can also set it per user. Tata has no embeddable WebRTC SDK
  for custom CRMs, so a fully in-app dialer would require switching provider (Twilio/Plivo/Exotel)
  plus a new India-approved caller ID and KYC/DLT — deliberately not done.
- Fixed (June 2026) Tata Smartflo click-to-call: `backend/.env` had been saved with Python code as the
  values (`SMARTFLO_API_TOKEN = os.environ.get("eyJ...")`), so the backend sent
  `Authorization: Bearer os.environ.get("…")` and Tata replied "Deleted or blacklisted token provided".
  `.env` is now plain `KEY="value"`. Added `smartflo_number()` (normalises to 91XXXXXXXXXX),
  `GET /api/calls/diagnostics`, a pre-dial 400 when the user has no agent number, Tata's own error
  message surfaced as 502, and `call_attempts` auditing (including transport failures).
  NOTE: the per-user `agent_number` must be the telecaller's own phone registered as a Smartflo
  agent — never the company DID/caller ID.
- P1: document uploads now live in Emergent Object Storage (`backend/storage.py`,
  path `onestock-academy-crm/documents/<user_id>/<uuid>.<ext>`); pre-migration files still download
  from the read-only legacy folder. Delete is a DB soft-delete because object storage has no delete
  API — a retention/cleanup job for `is_deleted` blobs is still open.
- P1: local-timezone "due today" bucket (currently UTC day); lead delete/archive endpoint.
- P1: saved filter views + CSV export of filtered leads.
- P2: WhatsApp/email sending, ads API real-time connectors, per-user notification preferences.
- P2: call recording / dialer integration, target vs achieved leaderboard.

- Telecaller Performance Dashboard (June 2026): admin/subadmin/team_leader-only page at `/performance`
  (`frontend/src/pages/TelecallerPerformance.js`, nav item "Performance"). Driven by REAL CRM data.
  - Session tracking: `db.sessions` rows opened on `POST /api/auth/login` (`start_session`), kept alive
    by `POST /api/sessions/heartbeat` (frontend pings every 60s + on tab focus, from `AuthContext`),
    closed on `POST /api/auth/logout`. Used for login/logout time + logged-in hours.
  - Live status (`user_live_status`): Offline (no open session / last_seen > 5m), On Call (call in last 2m),
    Online (heartbeat within 2m), Idle (heartbeat 2–5m old).
  - Endpoints: `GET /api/reports/telecaller-performance` (per-caller metrics), `.../trend` (daily series;
    week=full 7 days, month=full month via `trend_bounds`), `.../{id}/timeline` (activity feed). Period
    filters today/week/month/custom (IST). team_leader scoped to own team; telecaller gets 403.
  - Metrics: calls_dialed, connected_calls + connection_rate, conversions + conversion_rate,
    leads_contacted, follow_ups_completed (logged notes) / pending (+overdue), last_call
    (name/time/status/duration), logged_in_hours.
  - Smartflo webhook `GET|POST /api/calls/smartflo-webhook?secret=<SMARTFLO_WEBHOOK_SECRET>` captures TRUE
    connected status + duration; matches by `provider_call_id` (stored on click-to-call) or destination.
    GET is a non-mutating handshake. **User must add this webhook URL in the Tata Smartflo dashboard**
    for real connected/duration to populate; until then connected_calls stays 0.
- P2 (open): "inbuilt WhatsApp section" requested — needs Meta WhatsApp Business Cloud API credentials
  (phone number ID + permanent token); not yet built. Current LeadPanel WhatsApp button still opens wa.me.

- Performance dashboard enhancements (June 2026):
  - **Live Status Board** (`/live-status`, managers, nav "Live Board", `pages/LiveStatusBoard.js`) —
    auto-refreshing every 15s via `GET /api/reports/live-status`; status count tiles + per-telecaller
    cards (status, calls today, connected today, online-since, last call w/ duration).
  - **Performance CSV export**: `GET /api/reports/telecaller-performance/export` (whole table) and
    `GET /api/reports/telecaller-performance/{id}/timeline/export` (per-caller timeline). Buttons on the
    Performance page + inside the timeline drawer.
  - **Daily Targets**: `daily_call_target` + `daily_conversion_target` on user (set on Users create/edit
    dialogs). Performance API returns scaled `target_calls`/`target_conversions` (daily × IST days in
    range) and the page shows target-vs-achieved progress bars.
  - **Telecaller worklog**: `GET /api/reports/my-performance` powers a strip on the telecaller dashboard
    (login time, logged-in hours, calls dialed, connected, talk time today).
  - **Call duration** now surfaced: `serialize_call_attempt` includes `duration`+`connected`; shown in
    lead call history, performance "Talk" column, and timeline events. Real duration requires the
    Smartflo webhook to be configured (see test_credentials.md).
- P2 (open): "inbuilt WhatsApp section" — needs Meta WhatsApp Business Cloud API credentials; not built.
- Assignment / escalation changes (June 2026):
  - **Auto 12h escalation STOPPED** — `.emergent/crons.yml` escalate-leads set `enabled:false`; Dashboard
    "Run 12h escalation" button removed. No leads are auto-reassigned anymore.
  - **Actionless-24h review** for admin/subadmin: Leads bucket `actionless` (assigned, no notes, status active,
    last_action_at > 24h) + Dashboard KPI `actionless_24h`. Review-only.
  - **Team leader self-assign**: leader appears in Leads assignee lists as "<name> (me)".
  - **Deselect + Unassign** on Leads: "Deselect all" clears selection; "Unassign" via `POST /api/leads/unassign`
    (resets 'assigned'->'new_lead', keeps team_id so leaders retain visibility).

- Prod fix (Oct 2026): `50-cr-club/source-data` returned Cloudflare 524 in production. Cause:
  `enrich_stored_vip_membership_dates` did one `update_one` per verified purchase in a sequential
  loop (~3,700 docs) on every (polled) request — fine on local Mongo, >120s on remote prod DB.
  Fixed by batching into a single `bulk_write` + a change-guard so steady-state polling writes nothing.
- Prod fix (Oct 2026): backend boot NameError — `Form` used in `import_leads` but missing from the
  FastAPI import. Added `Form` to the import line.

- 50 Cr Club match/assign (Oct 2026): split the single "Match & assign" CSV action into two buttons.
  - **Match** → `POST /payments/50-cr-club/purchases/match-sheet` (read-only; uses already-synced
    verified data, triggers a background refresh, no blocking external sync) returns matched event IDs.
  - **Assign** → existing `POST /payments/50-cr-club/purchases/assign` with the matched IDs; now
    **batched** (single `bulk_write`, was per-event sequential update_one -> 524) and id cap raised 200->5000.
  - Old `upload-sheet` endpoint kept but no longer used by the UI.

## Test credentials
See `/app/memory/test_credentials.md`.
