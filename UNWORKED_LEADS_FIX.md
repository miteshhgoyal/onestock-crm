# Fix: Unworked Leads Queue, Form Synchronization & Realtime Sync

This document details the root causes, architecture, changes, and verification for the Unworked Leads queue bug and real-time synchronization on `crm.onestockacademy.com` (`/workspace`, "CRM Call Desk").

---

## 1. Root Cause Analysis

The bug where saving a lead (e.g. marking "Not connected" on an assigned lead) caused the lead to stay in the Unworked list with an unchanged badge and static counters was caused by six compounding defects across the frontend and backend:

1. **Frontend TanStack React Query Cache Staleness (`frontend/src/pages/Workspace.js` - `load`)**:
   `Workspace.js` invoked `queryClient.fetchQuery` with `staleTime: 30_000`. When `LeadPanel.js` saved changes and called `onChanged?.()`, neither `LeadPanel` nor `Workspace` invalidated the `["workspace-queue"]` query cache. Because the 30-second stale time had not elapsed, `fetchQuery` immediately served the cached array from memory without initiating a network request to `/leads`.

2. **Incomplete Backend Unworked Filter Logic (`backend/server.py` - `build_lead_query`)**:
   Under `bucket in ("untouched", "club_unworked")`, the backend executed only `query["status"] = "assigned"`.
   - It omitted leads in `new_lead` status.
   - Crucially, it did not check whether a call outcome was already logged in `call_attempts`. Any lead whose status was still "assigned" remained in the Unworked bucket even after multiple calls and outcomes were recorded.

3. **Backend Post-Call Status Validation Rejection (`backend/server.py` - `save_manual_call_outcome` & `update_call_outcome`)**:
   The manual call outcome endpoint strictly restricted `payload.status` to `{"interested", "not_interested", "follow_up", "converted", "lost"}`. If a client submitted `status="not_connected"` or `status="not_picked_up"`, the backend threw HTTP `400: Invalid post-call lead status`.

4. **Conflicting & Desynchronized Form Fields (`frontend/src/components/LeadPanel.js` - `saveLeadChanges`)**:
   The form presented three separate controls: "Call outcome", "Lead status after call" (defaulting to "Keep current status"), and "Status".
   - When a user selected Call Outcome = "Not connected" while leaving "Lead status after call" as "Keep current status", `LeadPanel` only dispatched a `calls/manual` request with `call_outcome: "not_connected"` and no status update, leaving the lead in "Assigned".
   - If the user additionally changed the "Status" dropdown to "Not connected", two separate requests (`POST /calls/manual` then `PATCH /leads`) were dispatched, but the cached queue on `Workspace.js` masked the update.

5. **Locally Derived Queue Metrics Drift (`frontend/src/pages/Workspace.js` - `summaryMetrics`)**:````
   DUE / OPEN / DONE counters were computed directly via `items.filter(...)`. Because `items` never updated due to cache staleness, the counters remained frozen.
``
6. **Absence of Real-Time Event Dispatch**:````
   The application possessed no WebSocket or SSE event mechanism for leads (Team Chat used polling). Multi-tab or multi-user state synchronization was non-existent.

---

## 2. Changed Files
````
| File | What it was before | What it is now |
|---|---|---|
| [`backend/models.py`](file:///d:/crm_onestock_own/backend/models.py) | Only defined `LEAD_STATUSES`. No shared definition of worked/unworked. `Lead` model lacked `last_call_outcome`. | Defined `UNWORKED_STATUSES = ("new_lead", "assigned")` and shared helper functions `is_lead_worked()` / `is_lead_unworked()`. Added `last_call_outcome: Optional[str] = None` to `Lead`. |
| [`backend/auth.py`](file:///d:/crm_onestock_own/backend/auth.py) | `extract_token` only read `Authorization: Bearer` header and `access_token` cookie. | Added fallback to `request.query_params.get("token")`, enabling browser native `EventSource` connections for SSE. |
| [`backend/server.py`](file:///d:/crm_onestock_own/backend/server.py) | - `untouched` filter only checked `status == "assigned"`.<br>- `save_manual_call_outcome` rejected `not_connected` / `not_picked_up` with 400.<br>- No realtime broadcasting or SSE endpoint. | - `untouched` filter uses `UNWORKED_STATUSES`, checks `last_call_outcome == None`, and excludes any `lead_id` with logged call outcomes in `call_attempts`.<br>- `save_manual_call_outcome` accepts all valid `LEAD_STATUSES`, sets `last_call_outcome`, and broadcasts `lead:updated`.<br>- Added `RealtimeBroadcaster` class and SSE endpoint `GET /api/realtime/stream` scoped to assigned agent, admins/subadmins, and team leader.<br>- Broadcasts `lead:updated` on lead update, note addition, call outcome logging, assignment, and conversion approval. |
| [`frontend/src/lib/constants.js`](file:///d:/crm_onestock_own/frontend/src/lib/constants.js) | Only defined `STATUSES` and `STATUS_META`. | Added `UNWORKED_STATUSES = ["new_lead", "assigned"]` and shared helpers `isLeadWorked(lead)` and `isLeadUnworked(lead)` aligned with backend logic. |
| [`frontend/src/lib/realtime.js`](file:///d:/crm_onestock_own/frontend/src/lib/realtime.js) *(New)* | File did not exist. | Created SSE client integration `useRealtimeEvent(eventName, handler)` with automatic reconnect and `generateOriginId()` for idempotent event handling. |
| [`frontend/src/components/LeadPanel.js`](file:///d:/crm_onestock_own/frontend/src/components/LeadPanel.js) | - Form fields (Call outcome, Lead status after call, Status) were conflicting.<br>- No optimistic state dispatch to parent.<br>- Overwrote notes on save error.<br>- No realtime origin headers. | - Form selects automatically synchronize (e.g. selecting "Not connected" in Call outcome automatically sets Status to "Not connected").<br>- Optimistically updates local lead state and dispatches `onOptimisticUpdate` to `Workspace`.<br>- Sends `X-Realtime-Origin-Id` header for deduplication.<br>- Preserves user's typed call note in input on failure (`savedNote` rollback). |
| [`frontend/src/pages/Workspace.js`](file:///d:/crm_onestock_own/frontend/src/pages/Workspace.js) | - Stale cache (`staleTime: 30_000`) prevented UI updates.<br>- No optimistic removal or counter updates.<br>- No auto-advance upon saving.<br>- No realtime updates across tabs. | - `matchesBucket()` evaluates lead membership across all tabs (`untouched`, `today`, `overdue`, `all`).<br>- Optimistically removes worked leads from Unworked list, decrements `totalCount`, and updates DUE/OPEN/DONE counters instantly.<br>- Auto-advances to the next lead in the queue (or displays clean empty state if queue is finished).<br>- Auto-backfills next page if queue gets low (`< 20` remaining).<br>- Listens to `useRealtimeEvent("lead:updated")` with `recentOriginIds` idempotency filter to update other tabs live. |
| [`backend/tests/test_unworked_leads.py`](file:///d:/crm_onestock_own/backend/tests/test_unworked_leads.py) *(New)* | File did not exist. | Added 5 test suites verifying worked/unworked rules, call outcome overrides, model validation, broadcaster scoping, and untouched query logic. |
| [`frontend/src/lib/workedLeads.test.js`](file:///d:/crm_onestock_own/frontend/src/lib/workedLeads.test.js) *(New)* | File did not exist. | Added Jest unit tests verifying frontend `isLeadWorked` and `isLeadUnworked` for all required lead statuses. |

---

## 3. New Behavior (Before vs After)

- **List Removal on Save**:
  - *Before*: Clicking "Save lead" with status "Not connected" kept the lead in the Unworked list indefinitely.
  - *After*: As soon as "Save lead" is clicked, the lead is immediately removed from the Unworked queue with zero delay and no page refresh.

- **Status Badges & Details Everywhere**:
  - *Before*: Badge remained "Assigned" in both sidebar and active lead header.
  - *After*: Status badge updates instantly across the queue, lead header, and status flow diagram to "Not connected" (or any chosen status).

- **Counters (DUE / OPEN / DONE)**:
  - *Before*: Counters remained static.
  - *After*: The OPEN, DONE, and DUE counters re-derive instantly from the optimistically updated items array.

- **Queue Auto-Advance & Position Indicator**:
  - *Before*: Lead remained selected. Position indicator did not progress.
  - *After*: The workspace automatically advances to the next lead in the list ("Next call" behavior). The position counter (e.g., `1 / 99`) remains exact. If the final lead in the queue is worked, a clean empty state ("Nothing in this queue. Nice work.") is displayed.

- **Status History & Activity**:
  - *Before*: History only refreshed on a hard reload or delayed poll.
  - *After*: Status changes and call outcome logs are optimistically appended to the status flow and activity history, then reconciled with server records.

- **Error Rollback & Note Preservation**:
  - *Before*: If an API failed, the user's notes and state could be lost or desynchronized.
  - *After*: If a server error occurs, the optimistic queue and lead state roll back, an error toast is surfaced, and any typed call note in the textarea is retained.

- **Real-Time Multi-Tab / Multi-User Sync**:
  - *Before*: Actions in Tab A were invisible in Tab B without a manual page refresh.
  - *After*: Working a lead in Tab A immediately updates Tab B in real time via Server-Sent Events (SSE). If Tab B had the same lead active, Tab B notifies the user and advances to the next lead.

---

## 4. Realtime Architecture & Design

- **Mechanism**: Server-Sent Events (SSE) via FastAPI `StreamingResponse` on `GET /api/realtime/stream`.
- **Authentication**: JWT token passed in query parameter `?token=<jwt>` or `Authorization: Bearer <jwt>`.
- **Event Name**: `lead:updated`
- **Payload Structure**:
  ```json
  {
    "type": "lead:updated",
    "lead": {
      "id": "6ab0d1665495bb7a52292c45",
      "name": "Huney Khaneja",
      "status": "not_connected",
      "last_call_outcome": "not_connected",
      "assigned_to": "6a87ee5e86662ab4c55b27c4",
      "updated_at": "2026-10-31T07:10:00Z"
    },
    "origin_id": "origin_1698736200_abc123",
    "timestamp": "2026-10-31T07:10:00Z"
  }
  ```
- **Scoping (Zero Data Leaks)**:
  Events are dispatched through `RealtimeBroadcaster.broadcast_lead_event()` strictly to:
  1. The assigned telecaller (`lead["assigned_to"]`).
  2. All users with role `admin` or `subadmin`.
  3. The team leader of the lead's team (`lead["team_id"]`).
  Other telecallers never receive lead data outside their scope.
- **Idempotency & Duplicate Prevention**:
  Each client-initiated mutation generates a unique `originId` (via `generateOriginId()`), sent in the `X-Realtime-Origin-Id` HTTP header. The backend echoes this `origin_id` in the broadcast payload. The originating tab records its active `originId` in a `recentOriginIds` ref and ignores its own echoed event, preventing duplicate state applications or list flickering.

---

## 5. Verification

### Automated Test Runs
1. **Backend Tests**:
   - Command: `$env:PYTHONPATH="backend"; pytest backend/tests/test_unworked_leads.py`
   - Output: `5 passed in 5.17s`
   - Validated:
     - `is_lead_worked` / `is_lead_unworked` status matrix
     - `assigned` leads with `last_call_outcome` counting as worked
     - Model validation accepting `not_connected` in post-call status
     - `RealtimeBroadcaster` delivery, scoping, and leakage prevention
     - `build_lead_query` untouched bucket logic

2. **Frontend Tests**:
   - Command: `cd frontend; npm test -- src/lib/workedLeads.test.js --watchAll=false`
   - Output: `PASS src/lib/workedLeads.test.js (4 passed, 4 total)`
   - Validated:
     - Statuses `new_lead` and `assigned` without call outcome are unworked
     - `not_connected` and `not_picked_up` count as worked
     - `follow_up`, `interested`, `not_interested`, `converted`, `lost` count as worked
     - `assigned` with call outcome counts as worked

3. **Frontend Production Build**:
   - Command: `cd frontend; npm run build`
   - Output: Compiled with exit code 0 (`craco build` succeeded, asset bundles generated).

### Manual Verification Matrix
| Scenario | Action | Expected & Verified Outcome |
|---|---|---|
| 1. Not connected | Unworked queue -> select lead -> change Status to "Not connected" -> Save lead | Lead leaves Unworked queue immediately; OPEN counter decrements; auto-advances to next lead. |
| 2. Not picked up | Unworked queue -> select lead -> change Status to "Not picked up" -> Save lead | Lead leaves Unworked queue immediately; badge updates everywhere. |
| 3. Follow-up (with date) | Unworked queue -> select lead -> Status "Follow-up" + date -> Save lead | Lead leaves Unworked queue; appears in "Due today" if date is today; timer updates. |
| 4. Interested / Not Interested | Unworked queue -> select lead -> Status "Interested" / "Not Interested" -> Save lead | Lead leaves Unworked queue; DONE counter increments for Not Interested. |
| 5. Converted / Lost | Unworked queue -> select lead -> Status "Converted" / "Lost" -> Save lead | Lead leaves Unworked queue; OPEN decrements, DONE increments. |
| 6. Assigned with Call Outcome | Status remains "Assigned", but Call Outcome set to "Not connected" -> Save lead | Lead recognized as worked via `last_call_outcome`; leaves Unworked queue. |
| 7. Multi-Tab Realtime | Tab A and Tab B both open to Unworked queue. Tab A marks lead "Not connected" and saves. | Tab A auto-advances. Tab B removes the lead instantly via SSE without a page reload. |
| 8. Network Failure Rollback | Network disconnected during save. | Error toast shown; optimistic list changes roll back; user's typed call note remains in textarea. |

### Known Limitations & Follow-ups
- Browser background tab throttling: Modern browsers may reduce timer frequencies in background tabs; however, SSE connections remain open and process events as soon as the tab receives priority.
- Large team broadcast scaling: For deployments with hundreds of concurrent team leaders, Redis Pub/Sub can be swapped in place of the in-memory `RealtimeBroadcaster` using the exact same interface.
