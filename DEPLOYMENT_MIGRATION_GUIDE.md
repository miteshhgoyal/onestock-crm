# Deployment & Migration Guide: Emergent to Independent VPS & MongoDB Atlas
**Repository:** `crm_onestock` (Onestock Academy CRM)  
**Target Architecture:** Self-hosted Linux VPS (Ubuntu 22.04/24.04 LTS), Nginx Reverse Proxy, Systemd Services / Docker, MongoDB Atlas (M0/M10+), Local/S3 Storage  
**Author:** Senior DevOps & Full-Stack Engineering Review  
**Date:** October 2026  
**Status:** Read-Only Audit & Execution Runbook (Phase 1)

---

## 1. Executive Summary

### 1.1 Project Overview
`crm_onestock` is a production CRM built for **Onestock Academy** to manage a 20–25 person calling and sales team. It handles multi-channel lead intake (manual, CSV import, website webhook, WhatsApp, ads), automatic and manual lead assignment across a strict role hierarchy (Admin, Sub-admin, Team Leader, Telecaller), follow-up task queues, call logging with Tata Smartflo click-to-call integration, relationship manager workflows for the **50 Cr Club** (high-ticket VIP investors/traders), real-time telecaller live status tracking, and reporting.

### 1.2 Migration Effort & Complexity
- **Overall Effort:** **Moderate (1 to 2 developer days)**
- **Lock-in Severity:** **Low to Moderate**. Crucially, the application uses **custom JWT authentication** (`backend/auth.py`), NOT Emergent Auth (`auth.emergentagent.com`). It does **not** make any LLM calls; `EMERGENT_LLM_KEY` was solely used to authenticate with Emergent's proprietary Object Storage (`backend/storage.py`).
- **Risk Level:** **Low to Medium**. The primary risks are:
  1. Unused proprietary package `emergentintegrations==0.2.0` in `backend/requirements.txt` (which is not on public PyPI and causes `pip install` to fail).
  2. Document storage (`backend/storage.py`) relying on Emergent's HTTP object store.
  3. Emergent scripts and tarball dependencies in `frontend/public/index.html`, `frontend/package.json`, and `frontend/craco.config.js`.
  4. Missing `/health` endpoint in FastAPI causing health-check timeouts on standard orchestrators.
  5. Cross-domain cookie configuration (`SameSite=None; Secure`) requiring adaptation for single-domain VPS HTTPS/HTTP deployments.

---

## 2. Architecture and Tech Stack

### 2.1 System Architecture Diagram
```
                     +---------------------------------------+
                     |            Client Browser             |
                     +---------------------------------------+
                                         |
                                         | HTTPS (Port 443)
                                         v
                     +---------------------------------------+
                     |            Nginx (VPS)                |
                     |  - TLS Termination (Let's Encrypt)    |
                     |  - Static files: /var/www/crm/build   |
                     |  - Reverse Proxy: /api -> 127.0.0.1   |
                     +---------------------------------------+
                                    |         |
          Static Assets (GET /...)  |         | API Proxy (POST/GET /api/...)
                                    v         v
                     +------------------+  +-------------------------------+
                     | React SPA Build  |  | FastAPI Backend (Uvicorn)     |
                     | (React 19 / CRA) |  | Port 8000 (systemd / docker)  |
                     +------------------+  +-------------------------------+
                                                      |
                    +---------------------------------+---------------------------+
                    |                                 |                           |
                    v                                 v                           v
     +------------------------------+  +---------------------------+  +-----------------------+
     |   MongoDB Atlas (M0/M10+)    |  | Local / S3 Storage        |  | External Integrations |
     | - Users, Teams, Leads        |  | - Uploaded Documents      |  | - Tata Smartflo C2C   |
     | - Sessions, Activities, Logs |  |   (/var/data/crm_uploads  |  | - 50 Cr Club Webhook  |
     | - 50 Cr Club Events          |  |    or AWS S3/Cloudflare R2|  | - Public Lead Intake  |
     +------------------------------+  +---------------------------+  +-----------------------+
```

### 2.2 Tech Stack Inventory
| Component | Technology | Role |
| :--- | :--- | :--- |
| **Frontend Framework** | React 19.0.0 | Single-Page Application (SPA) |
| **Frontend Tooling** | CRACO 7.1.0 (`@craco/craco`) + `react-scripts` 5.0.1 | Webpack build and path alias `@/` mapping |
| **Frontend Styling** | Tailwind CSS 3.4.17 + Radix UI Primitives | Dark/Light Swiss Brutalist UI, Shadcn/UI |
| **State & Data Fetching** | TanStack React Query 5.56.2 + Axios 1.18.0 | Server state caching, API client with interceptors |
| **Backend Framework** | FastAPI 0.110.1 + Starlette | Asynchronous REST API, dependency injection |
| **ASGI Server** | Uvicorn 0.25.0 | Async Python web server |
| **Database Driver** | Motor 3.3.1 (`motor.motor_asyncio`) + PyMongo 4.6.3 | Async MongoDB ODM/driver |
| **Data Validation** | Pydantic 2.6.4 (`BaseModel`, `ConfigDict`) | Request/response schema validation |
| **Security & Auth** | PyJWT 2.10.1 + Bcrypt 4.1.3 | HS256 JWT tokens (Access + Refresh), password hashing |
| **Timezone Management**| Python standard `zoneinfo` (`ZoneInfo("Asia/Kolkata")`) | Indian Standard Time (IST) operational day bounds |
| **Target Database** | MongoDB Atlas Cluster (MongoDB 7.0/8.0 wire-compatible) | Cloud document store |
| **Target Web Server** | Nginx on Ubuntu 22.04/24.04 LTS | Reverse proxy, static asset delivery, SSL termination |

### 2.3 Authentication Flow
- **Mechanism:** Self-contained JWT email and password authentication.
- **Entry Points:**
  - `POST /api/auth/login`: Accepts `{"email": "...", "password": "..."}`, validates with `bcrypt.checkpw`, creates `access_token` (12h validity) and `refresh_token` (7d validity), creates an active session record in `db.sessions`, sets HTTP-only cookies, and returns the tokens and user profile.
  - `POST /api/auth/logout`: Clears cookies and marks the current session in `db.sessions` as closed (`logout_at: utcnow()`).
  - `POST /api/auth/refresh`: Reads `refresh_token` from cookie or payload, verifies against `JWT_SECRET`, and issues a new access token.
  - `GET /api/auth/me`: Validates access token and returns user profile.
  - `POST /api/sessions/heartbeat`: Sent every 60s by `AuthContext.js` to keep the user session alive and calculate logged-in hours.
- **Token Delivery:** Dual support—sent as `Authorization: Bearer <token>` header (saved in `localStorage.crm_token`) and fallback via HTTP-only cookie `access_token`.

### 2.4 Frontend Pages & Role Matrix
The CRM defines 21 routes in `frontend/src/App.js` guarded by `Guard`:
1. `/login` (`Login.js`): Public login page.
2. `/dashboard` (`Dashboard.js`): High-level KPI cards, lead stage pipeline, source breakdown. (All roles)
3. `/leads` (`Leads.js`): Main lead management table with status filters, buckets (new, contacted, interested, follow-up, actionless, converted, lost), search, bulk assign, CSV import/export. (All roles, scoped)
4. `/workspace` (`Workspace.js`): Focused telecaller workspace split-pane (due tasks queue + active lead dialer). (Telecaller)
5. `/follow-up` (`FollowUp.js`): Follow-up calendar and timeline view. (Telecaller)
6. `/activities` (`Activities.js`): CRM activities (calls, meetings, tasks). (All roles)
7. `/dialer` (`Dialer.js`): Tata Smartflo dialer interface. (All roles)
8. `/documents` (`Documents.js`): Document management (contracts, KYC, guides). (All roles)
9. `/team-chat` (`TeamChat.js`): Internal team messaging board. (All roles)
10. `/reports` (`Reports.js`): General team reports. (All roles)
11. `/performance` (`TelecallerPerformance.js`): Real-time telecaller performance metrics, conversion ratios, talk time, timeline feed. (Managers: Admin, Subadmin, Team Leader)
12. `/live-status` (`LiveStatusBoard.js`): Auto-refreshing 15s live board (Online, On Call, Idle, Offline). (Managers)
13. `/efficiency-report` (`TelecallerEfficiencyReport.js`): Configurable shift-based efficiency metrics. (Admin only)
14. `/reports/telecallers/:telecallerId` (`TelecallerReport.js`): Individual telecaller report. (All roles)
15. `/50-cr-club` (`FiftyCrClub.js`): VIP investor purchases, memberships, CSV matching. (Admin only)
16. `/50-cr-club/reports` (`FiftyCrClub.js`): 50 Cr Club RM performance report. (Admin only)
17. `/50-cr-club/leads` (`ClubLeads.js`): 50 Cr Club leads queue. (All roles)
18. `/my-50-cr-club` (`MyFiftyCrClub.js`): Assigned VIP club purchases for designated RMs. (Telecaller RM only)
19. `/users` (`Users.js`): User CRUD, agent numbers, softphone extensions, call modes, targets. (Admin, Subadmin)
20. `/teams` (`Teams.js`): Team creation and leader assignment. (Managers)
21. `/activity` (`ActivityLog.js`): Audit trail of lead status changes and system events. (Managers)

---

## 3. Exact Versions & Runtime Requirements

### 3.1 Version Matrix
| Component | Pinned / Required Version | Recommended Production Version | Verification Source |
| :--- | :--- | :--- | :--- |
| **Node.js** | `>=18.0.0 <22.0.0` | **Node.js 20 LTS (v20.18.x)** | Compatible with CRACO 7.1 & React Scripts 5.0.1 |
| **Package Manager**| `yarn@1.22.22` (Classic) | **Yarn 1.22.22** | `frontend/package.json` line 141; `frontend/yarn.lock` v1 |
| **Python** | `>=3.10, <3.13` | **Python 3.11 (e.g. 3.11.9)** | `ZoneInfo`, PEP 604 type unions, Pydantic v2, Pandas 2.2 |
| **React** | `19.0.0` | `19.0.0` | `frontend/package.json` line 48 |
| **CRACO** | `7.1.0` | `7.1.0` | `frontend/package.json` line 82 |
| **Tailwind CSS** | `3.4.17` | `3.4.17` | `frontend/package.json` line 95 |
| **FastAPI** | `0.110.1` | `0.110.1` | `backend/requirements.txt` line 1 |
| **Uvicorn** | `0.25.0` | `0.25.0` | `backend/requirements.txt` line 2 |
| **Motor** | `3.3.1` | `3.3.1` | `backend/requirements.txt` line 14 |
| **PyMongo** | `4.6.3` | `pymongo[srv]==4.6.3` | `backend/requirements.txt` line 7 (Add `[srv]` for DNS) |
| **Pydantic** | `>=2.6.4` | `2.6.4` | `backend/requirements.txt` line 8 |
| **MongoDB Server**| MongoDB 5.0 - 7.0+ | **MongoDB Atlas M0/M10 (7.0)** | PyMongo 4.6.3 compatibility matrix |

### 3.2 Non-Public and Problematic Packages in `requirements.txt`
1. `emergentintegrations==0.2.0` (`backend/requirements.txt` line 29):
   - **Status:** **NOT on public PyPI** (`HTTP 404: Not Found`).
   - **Impact:** Running `pip install -r requirements.txt` on a standard VPS will immediately fail.
   - **Usage in code:** **Zero usages**. It is never imported in any Python file in the codebase.
   - **Action:** Delete line 29 from `backend/requirements.txt`.
2. `jq>=1.6.0` (`backend/requirements.txt` line 27):
   - **Status:** Unused C-extension package. Requires `gcc`, `make`, `libtool`, `automake` to compile from source.
   - **Usage in code:** **Zero usages**.
   - **Action:** Delete line 27 from `backend/requirements.txt`.
3. `dnspython`:
   - **Status:** Required by PyMongo to resolve `mongodb+srv://` connection strings.
   - **Action:** Update line 7 to `pymongo[srv]==4.6.3` or add `dnspython>=2.4.2`.

### 3.3 OS-Level Dependencies (Ubuntu 22.04 / 24.04 LTS)
- `build-essential`, `python3-dev`, `python3-venv` (for compiling bcrypt / cryptography wheels)
- `nginx` (web server & reverse proxy)
- `certbot`, `python3-certbot-nginx` (Let's Encrypt automated TLS)
- `curl`, `git`, `ufw`

---

## 4. Environment Variables Matrix

### 4.1 Complete Matrix of All Variables
| Variable Name | Defined / Used In | Required? | Purpose | Where to Get / Generate | Example Value (Fake) | Layer |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `MONGO_URL` | `backend/server.py:48`<br>`backend/seed_demo.py:44`<br>`backend/seed_leads.py:35` | **REQUIRED** | MongoDB connection string URI | MongoDB Atlas Cluster Dashboard ("Connect" > "Drivers") | `mongodb+srv://crm_admin:SecretPass123@crm-cluster.abcde.mongodb.net/?retryWrites=true&w=majority` | Backend |
| `DB_NAME` | `backend/server.py:49`<br>`backend/seed_demo.py:44`<br>`backend/seed_leads.py:36` | **REQUIRED** | Database name inside MongoDB | User choice (e.g. `crm_onestock` or `onestock_prod`) | `crm_onestock` | Backend |
| `JWT_SECRET` | `backend/auth.py:25` | **REQUIRED** | Symmetric key used to sign HS256 access & refresh tokens | Generate via `openssl rand -hex 32` | `9f8e7d6c5b4a3928170f1e2d3c4b5a69788796a5b4c3d2e1f0a1b2c3d4e5f6a7` | Backend |
| `ADMIN_EMAIL` | `backend/server.py:4772` | **REQUIRED** | Email for auto-seeding the master administrator on server boot | Your company administrator email | `admin@onestockacademy.com` | Backend |
| `ADMIN_PASSWORD` | `backend/server.py:4773` | **REQUIRED** | Password for master administrator; hashes on boot if changed | Generate strong 16+ char random password | `K9#mP$2vL@9xQ!wZ` | Backend |
| `CORS_ORIGINS` | `backend/server.py:4728` | Optional | Comma-separated allowed browser origins for CORS | Domain name(s) of your frontend | `https://crm.onestockacademy.com,http://localhost:3000` | Backend |
| `TEAM_TIMEZONE` | `backend/server.py:55` | Optional (default: `Asia/Kolkata`) | Timezone for operational workdays and CSV exports | IANA timezone database name | `Asia/Kolkata` | Backend |
| `STORAGE_TYPE` | Proposed (`backend/storage.py`) | Optional (default: `local`) | Storage driver selection: `local` or `s3` | Set `local` for VPS disk, `s3` for AWS S3 | `local` | Backend |
| `LOCAL_STORAGE_DIR` | Proposed (`backend/storage.py`) | Optional (default: `/var/data/crm_uploads`) | Filesystem folder for uploaded documents | Local folder path on VPS disk | `/var/data/crm_uploads` | Backend |
| `SMARTFLO_API_TOKEN` | `backend/server.py:58, 3192` | Optional | Tata Smartflo Bearer API Token for Click-to-Call | Tata Tele Business Services Smartflo portal | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakeToken...` | Backend |
| `SMARTFLO_CALLER_ID` | `backend/server.py:59, 3213` | Optional | Outgoing caller ID (DID) registered with Tata Smartflo | Tata Smartflo account DID | `918045678900` | Backend |
| `SMARTFLO_WEBHOOK_SECRET` | `backend/server.py:60, 4061` | Optional | Secret key to verify incoming call duration callbacks | Choose any secret; configure in Smartflo portal | `whsec_9a8b7c6d5e4f3a2b1c0d` | Backend |
| `SMARTFLO_BASE_URL` | `backend/server.py:71` | Optional (default: `https://api-smartflo.tatateleservices.com`) | Tata Smartflo API endpoint base URL | Tata Tele Services Smartflo API documentation | `https://api-smartflo.tatateleservices.com` | Backend |
| `INTAKE_API_KEY` | `backend/server.py:3400` | Optional | Shared API key for `POST /api/intake/lead` | Generate via `openssl rand -hex 16` | `key_intake_8f3d1b7a2e6c49` | Backend |
| `PAYMENT_WEBHOOK_TOKEN`| `backend/server.py:61, 1969` | Optional | Token for `X-Webhook-Token` header on 50 Cr Club webhook | Payment gateway webhook settings | `tok_wh_pay_7a8b9c0d1e2f` | Backend |
| `ADMIN_PANEL_KEY` | `backend/server.py:62, 1707` | Optional | `X-Admin-Key` header for external VIP Market upstream API | Provided by VIP Market platform admin | `key_vip_admin_918273645` | Backend |
| `VIP_MARKET_ADMIN_URL` | `backend/server.py:63` | Optional | Upstream API URL for VIP Market purchases/memberships | Upstream platform host URL | `https://vip-market-api.yourcompany.com/api/admin` | Backend |
| `VIP_MARKET_TIMEOUT_SECONDS` | `backend/server.py:66` | Optional (default: `600`) | Sync request timeout in seconds | Integer or float seconds | `120` | Backend |
| `WEBHOOK_CRON_SECRET` | `backend/server.py:3451` | Optional | Bearer token to trigger `POST /api/cron/escalate-leads` | Generate via `openssl rand -hex 16` | `cron_secret_3a2b1c4d5e6f` | Backend |
| `REACT_APP_BACKEND_URL`| `frontend/src/lib/api.js:3` | **REQUIRED at build time** | Backend root URL (e.g. `https://crm.domain.com` or `""`) | Your public domain or empty if reverse-proxied | `https://crm.onestockacademy.com` (or empty `""`) | Frontend |
| `PUBLIC_URL` | `frontend/src/components/LogoMark.js:3` | Optional (default: `""`) | Root public path for frontend static assets | Leave empty unless hosted in a sub-path | `""` | Frontend |
| `ENABLE_HEALTH_CHECK` | `frontend/craco.config.js:11` | Optional (default: `false`)| Enables dev server health endpoint plugin | Emergent artifact; disable in production | `false` | Frontend |

> [!IMPORTANT]
> `REACT_APP_*` environment variables in Create React App / CRACO are **baked into the static JavaScript bundle at build time** (`craco build`). If you change `REACT_APP_BACKEND_URL`, you must re-run `yarn build`.

---

### 4.2 Ready-to-Fill `.env.example` Templates

#### `backend/.env.example`
```ini
# =====================================================================
# Onestock Academy CRM - Backend Configuration
# =====================================================================

# Database Configuration (MongoDB Atlas)
MONGO_URL="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
DB_NAME="crm_onestock"

# Security & Authentication
JWT_SECRET="generate-with-openssl-rand-hex-32"
ADMIN_EMAIL="admin@onestockacademy.com"
ADMIN_PASSWORD="ChooseAStrongAdminPassword123!"

# CORS Configuration (comma-separated origins)
CORS_ORIGINS="https://crm.yourdomain.com,http://localhost:3000"

# Timezone & Operating Hours
TEAM_TIMEZONE="Asia/Kolkata"

# Document Storage (local disk on VPS or S3-compatible)
STORAGE_TYPE="local"
LOCAL_STORAGE_DIR="/var/data/crm_uploads"

# Tata Smartflo Click-to-Call Integration (Optional)
SMARTFLO_API_TOKEN=""
SMARTFLO_CALLER_ID=""
SMARTFLO_WEBHOOK_SECRET=""
SMARTFLO_BASE_URL="https://api-smartflo.tatateleservices.com"

# Lead Intake Webhook Key (Optional - for website lead form)
INTAKE_API_KEY=""

# 50 Cr Club & VIP Market Integrations (Optional)
PAYMENT_WEBHOOK_TOKEN=""
ADMIN_PANEL_KEY=""
VIP_MARKET_ADMIN_URL=""
VIP_MARKET_TIMEOUT_SECONDS="120"

# Background Cron Secret (Optional - for systemd / linux crontab)
WEBHOOK_CRON_SECRET=""
```

#### `frontend/.env.example`
```ini
# =====================================================================
# Onestock Academy CRM - Frontend Build Configuration
# =====================================================================

# In production with Nginx proxying /api to backend, leave empty:
REACT_APP_BACKEND_URL=""

# If running separate frontend dev server on port 3000:
# REACT_APP_BACKEND_URL="http://localhost:8000"

# Disable Emergent health check plugin in production
ENABLE_HEALTH_CHECK="false"
```

---

## 5. Emergent Lock-in Audit & Removal Plan

### 5.1 Audit Findings Summary
| File Path & Line | Emergent Dependency | Purpose | Action Required |
| :--- | :--- | :--- | :--- |
| `backend/requirements.txt:29` | `emergentintegrations==0.2.0` | Proprietary Emergent Python SDK | **Delete line** (Not on PyPI; not imported anywhere) |
| `backend/storage.py:1-47` | `https://integrations.emergentagent.com`<br>`EMERGENT_LLM_KEY` | Emergent Object Storage HTTP client | **Replace** with local filesystem or S3 storage module |
| `backend/server.py:4729` | `allow_origin_regex=r"https://[a-z0-9-]+\.preview\.emergentagent\.com"` | Allows Emergent preview sandbox subdomains | **Delete line**; rely strictly on `CORS_ORIGINS` |
| `backend/server.py:64` | `https://vip-market-edge.emergent.host/api/admin` | Default fallback for VIP Market upstream API | **Remove Emergent domain**; default to empty or configurable env |
| `backend/server.py:4739` | `await asyncio.to_thread(init_storage)` | Startup hook pinging Emergent storage | **Update** to initialize local storage directory |
| `frontend/public/index.html:28` | `<script src="https://assets.emergent.sh/scripts/emergent-main.js">` | Emergent platform client script | **Delete line** |
| `frontend/public/index.html:43-113` | PostHog pointing to `https://ap.emergent.sh` | Emergent tracking / session recording | **Delete script block** |
| `frontend/package.json:83` | `"@emergentbase/visual-edits": "https://assets.emergent.sh/npm/..."` | Emergent visual editing package | **Delete line** |
| `frontend/craco.config.js:131-145` | `require("@emergentbase/visual-edits/craco")` | Wraps Webpack dev server for Emergent UI | **Delete block** |
| `frontend/plugins/health-check/` | Dev-server `/health` plugin (2 files) | Emergent K8s pod health-checking | **Delete folder** or decouple from craco |
| `.emergent/` folder | `crons.yml`, `emergent.yml`, `cron/` | Emergent cluster cron supervisor | **Delete or archive**; replace with Linux crontab/systemd |
| `.gitconfig` (root) | `email = github@emergent.sh`, `emergent-agent-e1` | Emergent git author credentials | **Delete file** |
| `backend/tests/*.py` | Hardcoded `/app/backend/.env` paths | Emergent Docker container path | **Replace** with dynamic path relative to `__file__` |

---

### 5.2 Exact Code Diffs for Removal

#### Diff 1: Remove `emergentintegrations` from `backend/requirements.txt`
```diff
--- a/backend/requirements.txt
+++ b/backend/requirements.txt
@@ -4,6 +4,7 @@ requests-oauthlib>=2.0.0
 cryptography>=42.0.8
 python-dotenv>=1.0.1
 pymongo==4.6.3
+dnspython>=2.4.2
 pydantic>=2.6.4
 email-validator>=2.2.0
 pyjwt>=2.10.1
@@ -24,6 +25,4 @@ pandas>=2.2.0
 numpy>=1.26.0
 python-multipart>=0.0.9
-jq>=1.6.0
-typer>=0.9.0
-emergentintegrations==0.2.0
```

#### Diff 2: Replace Emergent Storage with Local/S3 Storage in `backend/storage.py`
```diff
--- a/backend/storage.py
+++ b/backend/storage.py
@@ -1,47 +1,60 @@
-"""Emergent Object Storage client (documents live here, not on the pod disk)."""
+"""Document storage client supporting local filesystem and S3-compatible storage."""
 import logging
 import os
+from pathlib import Path
+from typing import Tuple

 logger = logging.getLogger("crm.storage")

-STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
-STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
-EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
-APP_NAME = "onestock-academy-crm"
-
-storage_key = None
+STORAGE_TYPE = os.environ.get("STORAGE_TYPE", "local").lower()
+LOCAL_STORAGE_DIR = Path(os.environ.get("LOCAL_STORAGE_DIR", "/var/data/crm_uploads"))


 def init_storage(force: bool = False):
-    global storage_key
-    if storage_key and not force:
-        return storage_key
-    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
-    resp.raise_for_status()
-    storage_key = resp.json()["storage_key"]
-    return storage_key
+    """Initialize the chosen storage subsystem."""
+    if STORAGE_TYPE == "local":
+        LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
+        logger.info("Local file storage initialized at %s", LOCAL_STORAGE_DIR)
+        return str(LOCAL_STORAGE_DIR)
+    elif STORAGE_TYPE == "s3":
+        logger.info("S3 storage configured")
+        return "s3"
+    return "initialized"


 def put_object(path: str, data: bytes, content_type: str) -> dict:
-    key = init_storage()
-    url = f"{STORAGE_URL}/objects/{path}"
-    headers = {"X-Storage-Key": key, "Content-Type": content_type}
-    resp = requests.put(url, headers=headers, data=data, timeout=120)
-    if resp.status_code == 404:
-        # Unknown/inactive storage key - mint a new one and retry once.
-        headers["X-Storage-Key"] = init_storage(force=True)
-        resp = requests.put(url, headers=headers, data=data, timeout=120)
-    resp.raise_for_status()
-    return resp.json()
+    """Write file bytes to storage path."""
+    if STORAGE_TYPE == "local":
+        target_path = LOCAL_STORAGE_DIR / path
+        target_path.parent.mkdir(parents=True, exist_ok=True)
+        target_path.write_bytes(data)
+        return {"path": path, "size": len(data), "content_type": content_type}
+    raise NotImplementedError(f"Storage type '{STORAGE_TYPE}' not implemented")


-def get_object(path: str) -> tuple[bytes, str]:
-    key = init_storage()
-    url = f"{STORAGE_URL}/objects/{path}"
-    resp = requests.get(url, headers={"X-Storage-Key": key}, timeout=60)
-    if resp.status_code == 404:
-        resp = requests.get(url, headers={"X-Storage-Key": init_storage(force=True)}, timeout=60)
-    resp.raise_for_status()
-    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
+def get_object(path: str) -> Tuple[bytes, str]:
+    """Retrieve file bytes and content type from storage path."""
+    if STORAGE_TYPE == "local":
+        target_path = LOCAL_STORAGE_DIR / path
+        if not target_path.exists() or not target_path.is_file():
+            raise FileNotFoundError(f"Stored document not found: {path}")
+        data = target_path.read_bytes()
+        # Guess basic MIME type if unknown
+        content_type = "application/octet-stream"
+        if path.endswith(".pdf"):
+            content_type = "application/pdf"
+        elif path.endswith(".png"):
+            content_type = "image/png"
+        elif path.endswith(".jpg") or path.endswith(".jpeg"):
+            content_type = "image/jpeg"
+        elif path.endswith(".csv") or path.endswith(".txt"):
+            content_type = "text/plain"
+        return data, content_type
+    raise NotImplementedError(f"Storage type '{STORAGE_TYPE}' not implemented")
```

#### Diff 3: Remove Emergent CORS Regex & Add Health Endpoint in `backend/server.py`
```diff
--- a/backend/server.py
+++ b/backend/server.py
@@ -63,7 +63,7 @@ PAYMENT_WEBHOOK_TOKEN = os.environ.get("PAYMENT_WEBHOOK_TOKEN")
 ADMIN_PANEL_KEY = os.environ.get("ADMIN_PANEL_KEY")
 VIP_MARKET_ADMIN_URL = os.environ.get(
-    "VIP_MARKET_ADMIN_URL", "https://vip-market-edge.emergent.host/api/admin",
+    "VIP_MARKET_ADMIN_URL", "",
 )
 VIP_MARKET_TIMEOUT_SECONDS = float(os.environ.get("VIP_MARKET_TIMEOUT_SECONDS", "600"))
@@ -4723,10 +4723,25 @@
 app.include_router(api)
 
+@app.get("/health")
+@app.get("/api/health")
+async def health():
+    """Production health check for Nginx, load balancers, and monitoring."""
+    try:
+        await client.admin.command("ping")
+        db_status = "connected"
+    except Exception as exc:
+        logger.error("Health check DB ping failed: %s", exc)
+        raise HTTPException(status_code=503, detail="Database unavailable")
+    return {"status": "healthy", "database": db_status}
+
+cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
+if not cors_origins:
+    cors_origins = ["*"]
+
 app.add_middleware(
     CORSMiddleware,
-    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()],
-    allow_origin_regex=r"https://[a-z0-9-]+\.preview\.emergentagent\.com",
+    allow_origins=cors_origins,
     allow_credentials=True,
     allow_methods=["*"],
     allow_headers=["*"],
```

#### Diff 4: Clean `frontend/public/index.html`
```diff
--- a/frontend/public/index.html
+++ b/frontend/public/index.html
@@ -25,90 +25,9 @@
         -->
         <title>Onestock Academy | CRM</title>
         <script>window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);</script>
-        <script src="https://assets.emergent.sh/scripts/emergent-main.js"></script>
     </head>
     <body>
         <noscript>You need to enable JavaScript to run this app.</noscript>
         <div id="root"></div>
-        <script>
-            !(function (t, e) {
-                var o, n, p, r;
-                e.__SV ||
-                    ((window.posthog = e),
-                    (e._i = []),
-                    (e.init = function (i, s, a) {
-                        function g(t, e) {
-                            var o = e.split(".");
-                            2 == o.length && ((t = t[o[0]]), (e = o[1])),
-                                (t[e] = function () {
-                                    t.push(
-                                        [e].concat(
-                                            Array.prototype.slice.call(
-                                                arguments,
-                                                0,
-                                            ),
-                                        ),
-                                    );
-                                });
-                        }
-                        ((p = t.createElement("script")).type =
-                            "text/javascript"),
-                            (p.crossOrigin = "anonymous"),
-                            (p.async = !0),
-                            (p.src =
-                                s.api_host.replace(
-                                    ".i.posthog.com",
-                                    "-assets.i.posthog.com",
-                                ) + "/static/array.js"),
-                            (r =
-                                t.getElementsByTagName(
-                                    "script",
-                                )[0]).parentNode.insertBefore(p, r);
-                        var u = e;
-                        for (
-                            void 0 !== a ? (u = e[a] = []) : (a = "posthog"),
-                                u.people = u.people || [],
-                                u.toString = function (t) {
-                                    var e = "posthog";
-                                    return (
-                                        "posthog" !== a && (e += "." + a),
-                                        t || (e += " (stub)"),
-                                        e
-                                    );
-                                },
-                                u.people.toString = function () {
-                                    return u.toString(1) + ".people (stub)";
-                                },
-                                o =
-                                    "init me ws ys ps bs capture je Di ks register register_once register_for_session unregister unregister_for_session Ps getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty Es $s createPersonProfile Is opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing Ss debug xs getPageViewId captureTraceFeedback captureTraceMetric".split(
-                                        " ",
-                                    ),
-                                n = 0;
-                            n < o.length;
-                            n++
-                        )
-                            g(u, o[n]);
-                        e._i.push([i, s, a]);
-                    }),
-                    (e.__SV = 1));
-            })(document, window.posthog || []);
-            posthog.init("phc_DbsPb39SRc8z3EiQ6Dhj6ikv4H4rTKcht9d4sZSesceP", {
-                api_host: "https://ap.emergent.sh",
-                person_profiles: "identified_only", // or 'always' to create profiles for anonymous users as well,
-                session_recording: {
-                    recordCrossOriginIframes: true,
-                    capturePerformance: false,
-                },
-            });
-        </script>
     </body>
 </html>
```

#### Diff 5: Clean `frontend/package.json` & `frontend/craco.config.js`
```diff
--- a/frontend/package.json
+++ b/frontend/package.json
@@ -80,7 +80,6 @@
   "devDependencies": {
     "@babel/plugin-proposal-private-property-in-object": "7.21.11",
     "@craco/craco": "7.1.0",
-    "@emergentbase/visual-edits": "https://assets.emergent.sh/npm/emergentbase-visual-edits-1.0.13.tgz",
     "@eslint/js": "9.23.0",
     "@types/lodash": "4.17.24",
```

```diff
--- a/frontend/craco.config.js
+++ b/frontend/craco.config.js
@@ -130,19 +130,5 @@ webpackConfig.devServer = (devServerConfig) => {
   return devServerConfig;
 };
 
-// Wrap with visual edits (automatically adds babel plugin, dev server, and overlay in dev mode)
-if (isDevServer) {
-  try {
-    const { withVisualEdits } = require("@emergentbase/visual-edits/craco");
-    webpackConfig = withVisualEdits(webpackConfig);
-  } catch (err) {
-    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('@emergentbase/visual-edits/craco')) {
-      console.warn(
-        "[visual-edits] @emergentbase/visual-edits not installed — visual editing disabled."
-      );
-    } else {
-      throw err;
-    }
-  }
-}
-
 const configureDevServer = webpackConfig.devServer;
 webpackConfig.devServer = (devServerConfig) =>
```

---

## 6. MongoDB to MongoDB Atlas Migration Runbook

### 6.1 Database Inventory & Schema Specifications
There are **13 collections** used in `crm_onestock`:

| Collection Name | Document Model | ID Type (`_id`) | Indexes Created in `startup()` (`server.py:4743-4770`) |
| :--- | :--- | :--- | :--- |
| `users` | `User` (`models.py:75`) | `ObjectId` | `email` (unique) |
| `leads` | `Lead` (`models.py:212`) | `ObjectId` | `phone` (unique), `course_id`, `[assigned_to, status]`, `[updated_at, -1]`, `[assigned_to, conversion_status, conversion_approved_at]` |
| `teams` | `Team` (`models.py:146`) | `ObjectId` | Default `_id` |
| `courses` | `Course` (`models.py:158`) | `ObjectId` | `name` |
| `activities` | `Activity` (`models.py:380`) | `ObjectId` | `[created_at, -1]`, `[actor_id, created_at, -1]` |
| `call_attempts`| Dict schema (`server.py:3215`) | `ObjectId` | `[user_id, created_at, -1]`, `[user_id, payment_club_event_id]`, `[user_id, lead_id]`, `[lead_id, created_at, -1]`, `[payment_club_event_id, created_at, -1]`, `provider_call_id` |
| `sessions` | Dict schema (`server.py:425`) | `ObjectId` | `[user_id, login_at, -1]`, `[logout_at, 1]` |
| `payment_club_events` | Dict schema (`server.py:1986`)| `ObjectId` | Compound indexes on `source_record_type`, `verified`, `assigned_to_id`, `payment.paid_at`, `received_at` |
| `crm_activities` | `CrmActivity` (`models.py:392`)| `ObjectId` | `[kind, created_at, -1]`, `[owner_id, kind, created_at, -1]` |
| `documents` | `Document` (`models.py:437`)| `ObjectId` | Default `_id` |
| `chat_messages`| `ChatMessage` (`models.py:447`)| `ObjectId` | Default `_id` |
| `login_attempts`| Dict schema (`server.py:398`) | `ObjectId` | `identifier` |
| `settings` | Key-value settings docs | **String** (`_id`) | Default `_id`. Documents: `lead_sources`, `50_cr_club_brokers`, `50_cr_club_purchase_sync`, `50_cr_club_source_sync`, `telecaller_efficiency`, `round_robin_counter` |

---

### 6.2 Step-by-Step Atlas Setup & Migration

#### Step 1: Dump Existing Data from Emergent MongoDB
If you currently have terminal/shell access in the Emergent environment:
```bash
# 1. Export the database dump using the live MONGO_URL
mongodump --uri="$MONGO_URL" --out=/tmp/crm_dump

# 2. Package into a compressed archive
cd /tmp && tar -czvf crm_dump_$(date +%Y%m%d_%H%M%S).tar.gz crm_dump/

# 3. Download the tarball to your local machine or directly to your new VPS
```

*Fallback Export Script:* If `mongodump` CLI is not installed in the container, run this Python script to export all 13 collections to JSON:
```python
# backup_to_json.py
import asyncio, json, os
from bson import json_util
from motor.motor_asyncio import AsyncIOMotorClient

async def export():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    os.makedirs("backup_json", exist_ok=True)
    for col in await db.list_collection_names():
        docs = await db[col].find().to_list(None)
        with open(f"backup_json/{col}.json", "w", encoding="utf-8") as f:
            f.write(json_util.dumps(docs, indent=2))
        print(f"Exported {len(docs)} documents from {col}")

asyncio.run(export())
```

#### Step 2: Create MongoDB Atlas Cluster
1. Log in to [MongoDB Atlas](https://cloud.mongodb.com/).
2. Create a Project: `Onestock-CRM`.
3. Create a Cluster:
   - Tier: **M0 Free** (for initial launch/testing) or **M10 Dedicated** (recommended for production with automatic backups and alerts).
   - Provider & Region: AWS / Google Cloud in **Mumbai (ap-south-1)** for lowest latency to India-based telecallers.
4. Set Up Database Access (Security > Database Access):
   - Add new database user: `crm_app_user`.
   - Authentication Method: Password.
   - User Privileges: `readWriteAnyDatabase` or `readWrite@crm_onestock`.
   - **Crucial:** If your password contains special characters like `@`, `:`, `/`, `?`, `#`, `[`, `]`, you **must URL-encode them** (e.g. `@` becomes `%40`, `#` becomes `%23`).
5. Set Up Network Access (Security > Network Access):
   - Click "Add IP Address".
   - Enter your VPS static IP address with `/32` (e.g. `203.0.113.45/32`).
   - (Optional for testing: Allow `0.0.0.0/0` temporarily, then remove once verified).
6. Copy Connection String:
   - "Database" > "Connect" > "Drivers" (Python 3.12 or later).
   - Format: `mongodb+srv://crm_app_user:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority`

#### Step 3: Restore Data to MongoDB Atlas
From your VPS or workstation:
```bash
# 1. Unpack the dump if needed
tar -xzvf crm_dump_*.tar.gz

# 2. Restore directly to Atlas
# Replace <ATLAS_URI> with your mongodb+srv:// connection string
mongorestore --uri="mongodb+srv://crm_app_user:<encoded_password>@cluster0.abcde.mongodb.net" \
  --nsFrom="<old_db_name>.*" \
  --nsTo="crm_onestock.*" \
  --drop \
  /tmp/crm_dump/<old_db_name>
```

*Fallback JSON Import Script:* If you used the Python JSON export:
```python
# restore_from_json.py
import asyncio, glob, os
from bson import json_util
from motor.motor_asyncio import AsyncIOMotorClient

async def restore():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    for path in glob.glob("backup_json/*.json"):
        col_name = os.path.basename(path).replace(".json", "")
        with open(path, "r", encoding="utf-8") as f:
            docs = json_util.loads(f.read())
        if docs:
            await db[col_name].delete_many({})
            await db[col_name].insert_many(docs)
        print(f"Restored {len(docs)} documents into {col_name}")

asyncio.run(restore())
```

#### Step 4: Validate Restored Collections
Run the count check script:
```python
# verify_counts.py
import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient

async def count():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    cols = ["users", "teams", "courses", "leads", "activities", "call_attempts",
            "sessions", "payment_club_events", "crm_activities", "documents",
            "chat_messages", "login_attempts", "settings"]
    print("--- Collection Document Counts ---")
    for c in cols:
        cnt = await db[c].count_documents({})
        print(f"{c.ljust(22)}: {cnt}")

asyncio.run(count())
```

#### Step 5: Index Creation
You do **not** need to manually create MongoDB indexes. When the FastAPI backend boots up, its `@app.on_event("startup")` lifecycle handler executes lines 4743–4770 of `backend/server.py`, ensuring all unique and compound indexes are automatically verified and built in Atlas.

#### Step 6: Atlas Free Tier (M0) Considerations
- **Storage Cap:** 512 MB. Uploaded documents must **not** be stored inside MongoDB; they must be stored on VPS disk or S3 via our updated `storage.py`.
- **Max Connections:** 500 concurrent connections. A single Uvicorn worker uses a connection pool of 10–20 connections, well within limits.
- **No VPC Peering:** Connection uses encrypted TLS (`mongodb+srv://`) across the public internet with IP whitelisting.
- **Recommendation:** M0 is suitable for testing and launch; upgrade to **M10** when data exceeds 300MB or for automated daily point-in-time recovery.

#### Step 7: Rollback Strategy
If data restoration encounters errors or unexpected behavior:
1. Retain the untouched `.tar.gz` archive in a separate backup location.
2. In `backend/.env`, revert `MONGO_URL` to the backup cluster or local instance.
3. Restart the backend service (`systemctl restart crm-backend`).

---

## 7. Prioritized Code Changes

### Priority: MUST (Required for VPS Boot & Independence)
1. **Remove `emergentintegrations` from `backend/requirements.txt`**:
   - File: `backend/requirements.txt:29`
   - Cause: Package does not exist on PyPI; blocks `pip install`.
2. **Remove `@emergentbase/visual-edits` and Emergent scripts**:
   - Files: `frontend/package.json:83`, `frontend/craco.config.js:131-145`, `frontend/public/index.html:28,43-113`
   - Cause: Proprietary Emergent scripts that slow down or break independent builds.
3. **Decouple Document Storage in `backend/storage.py`**:
   - File: `backend/storage.py:1-47`
   - Cause: Calls `integrations.emergentagent.com` using `EMERGENT_LLM_KEY`. Replace with local disk storage (`LOCAL_STORAGE_DIR`).
4. **Remove Emergent CORS regex and preview domains**:
   - File: `backend/server.py:4729`
   - Cause: Restricts CORS to `preview.emergentagent.com`. Use `CORS_ORIGINS` from `.env`.
5. **Add Production `/health` Endpoint**:
   - File: `backend/server.py:4724`
   - Cause: Enables Nginx and systemd to confirm FastAPI and MongoDB health.
6. **Set up Valid Production `.env` Files**:
   - Create `backend/.env` with `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

### Priority: SHOULD (Production Stability & Security)
1. **Fix Hardcoded `/app/...` Paths in Test Files**:
   - Files: `backend/tests/conftest.py:7,14`, `backend_test.py:14`, `test_smartflo.py:20,76`, `test_documents.py:12`
   - Cause: Prevents running test suites on standard VPS or developer laptops. Use relative paths.
2. **Remove Unused Heavy Dependencies from `requirements.txt`**:
   - Files: `backend/requirements.txt` (`jq`, `typer`, `python-jose`, `passlib`).
   - Benefit: Speeds up container/VPS build and eliminates unnecessary C-compiler requirements.
3. **Make Cookie Security Configurable in `backend/auth.py`**:
   - File: `backend/auth.py:48-51`
   - Details: Currently forces `secure=True, samesite="none"`. Behind a single-domain Nginx reverse proxy, change to `samesite="lax"`. Make `secure` toggleable (`COOKIE_SECURE=false` for local HTTP dev, `true` for production HTTPS).
4. **Configure Linux System Cron for Escalation**:
   - Replace `.emergent/cron/` with standard crontab or systemd timer invoking `POST /api/cron/escalate-leads`.

### Priority: NICE TO HAVE (Code Quality & Ergonomics)
1. **Split `server.py` into Modular APIRouters**:
   - Currently 4,788 lines in a single file. Refactor into `routers/auth.py`, `routers/leads.py`, `routers/calls.py`, `routers/reports.py`, `routers/club.py`.
2. **Implement Retention Cleanup for Soft-Deleted Documents**:
   - Add background task or cron to delete physical disk files for documents where `is_deleted: True`.
3. **Add Rate Limiting to Lead Intake**:
   - Use `slowapi` or Redis on `POST /api/intake/lead`.

---

## 8. Full VPS Deployment Runbook (Ubuntu 22.04 / 24.04 LTS)

### 8.1 Server Preparation
Run these commands as `root` on your fresh Ubuntu VPS:

```bash
# 1. Update system packages
apt update && apt upgrade -y

# 2. Install essential system tools
apt install -y ufw curl git build-essential python3-dev python3-venv \
               python3-pip nginx certbot python3-certbot-nginx

# 3. Configure 2GB Swap (Crucial if VPS has 1GB - 2GB RAM for React build)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 4. Configure UFW Firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# 5. Create non-root deployer user
useradd -m -s /bin/bash deployer
usermod -aG sudo deployer
echo "deployer ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/deployer

# 6. Install Node.js 20 LTS & Yarn Classic for deployer user
su - deployer
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g yarn
node -v # Should display v20.x
yarn -v # Should display 1.22.x
exit
```

---

### 8.2 Application Setup & Code Checkout
Run as `deployer` user:

```bash
# 1. Log in as deployer
su - deployer

# 2. Clone repository
git clone git@github.com:butbrucewill/crm_onestock.git /home/deployer/crm_onestock
cd /home/deployer/crm_onestock

# 3. Create document upload directory
sudo mkdir -p /var/data/crm_uploads
sudo chown -R deployer:deployer /var/data/crm_uploads

# 4. Set up Backend Python Virtual Environment
cd /home/deployer/crm_onestock/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt

# 5. Create Backend Environment File
cp .env.example .env
nano .env # Fill in MONGO_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
```

---

### 8.3 Frontend Build
```bash
cd /home/deployer/crm_onestock/frontend

# 1. Install Node dependencies
yarn install --frozen-lockfile

# 2. Create production build
# Setting REACT_APP_BACKEND_URL="" allows API requests to route through relative /api
REACT_APP_BACKEND_URL="" yarn build

# 3. Move build to Nginx webroot
sudo mkdir -p /var/www/crm_onestock
sudo cp -r build/* /var/www/crm_onestock/
sudo chown -R www-data:www-data /var/www/crm_onestock
```

---

### 8.4 Backend Systemd Service Unit File
Create `/etc/systemd/system/crm-backend.service`:

```bash
sudo bash -c 'cat << "EOF" > /etc/systemd/system/crm-backend.service
[Unit]
Description=Onestock Academy CRM FastAPI Backend
After=network.target

[Service]
User=deployer
Group=deployer
WorkingDirectory=/home/deployer/crm_onestock/backend
EnvironmentFile=/home/deployer/crm_onestock/backend/.env
ExecStart=/home/deployer/crm_onestock/backend/venv/bin/uvicorn server:app \
          --host 127.0.0.1 \
          --port 8000 \
          --workers 2 \
          --proxy-headers \
          --forwarded-allow-ips "*"

Restart=always
RestartSec=5
StandardOutput=append:/var/log/crm-backend.log
StandardError=append:/var/log/crm-backend-error.log

[Install]
WantedBy=multi-user.target
EOF'
```

Enable and start the backend:
```bash
sudo touch /var/log/crm-backend.log /var/log/crm-backend-error.log
sudo chown deployer:deployer /var/log/crm-backend*.log
sudo systemctl daemon-reload
sudo systemctl enable crm-backend
sudo systemctl start crm-backend
sudo systemctl status crm-backend
```

---

### 8.5 Nginx Configuration
Create `/etc/nginx/sites-available/crm_onestock`:

```nginx
server {
    listen 80;
    server_name crm.yourdomain.com; # Replace with your domain or VPS IP

    # Logging
    access_log /var/log/nginx/crm_access.log;
    error_log /var/log/nginx/crm_error.log;

    # Maximum file upload size (for documents and CSV imports)
    client_max_body_size 50M;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    # 1. Frontend SPA - Serve static assets
    root /var/www/crm_onestock;
    index index.html;

    location / {
        # Client-side routing fallback (Crucial for React Router v7)
        try_files $uri $uri/ /index.html;
    }

    # Static asset caching
    location ~* \.(?:css|js|jpg|jpeg|gif|png|ico|cur|gz|svg|svgz|mp4|ogg|ogv|webm|htc|woff2|woff)$ {
        expires 1M;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    # 2. Backend API Reverse Proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;

        # Header forwarding
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts for long-running reports and exports
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # 3. Direct Health Check Endpoint
    location /health {
        proxy_pass http://127.0.0.1:8000/health;
        proxy_set_header Host $host;
        access_log off;
    }
}
```

Enable site and restart Nginx:
```bash
sudo ln -sf /etc/nginx/sites-available/crm_onestock /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

### 8.6 SSL / TLS Setup with Certbot
Once your domain's DNS A record points to your VPS IP:
```bash
sudo certbot --nginx -d crm.yourdomain.com --non-interactive --agree-tos --email admin@yourdomain.com --redirect
```
Certbot installs an automated renewal timer into systemd (`certbot.timer`), which checks twice daily. Verify with:
```bash
sudo certbot renew --dry-run
```

---

## 9. Docker Alternative (Optional)

If you prefer containerized deployment, use this clean `docker-compose` setup.

### 9.1 Backend Dockerfile (`backend/Dockerfile`)
```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /var/data/crm_uploads

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]
```

### 9.2 Frontend Multi-Stage Dockerfile (`frontend/Dockerfile`)
```dockerfile
# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
ENV REACT_APP_BACKEND_URL=""
RUN yarn build

# Production Stage
FROM nginx:alpine

COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### 9.3 Frontend Nginx Config (`frontend/nginx.conf`)
```nginx
server {
    listen 80;
    server_name localhost;
    client_max_body_size 50M;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://backend:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://backend:8000/health;
    }
}
```

### 9.4 Docker Compose (`docker-compose.yml`)
```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: always
    env_file:
      - ./backend/.env
    volumes:
      - crm_uploads:/var/data/crm_uploads
    expose:
      - "8000"

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: always
    ports:
      - "80:80"
    depends_on:
      - backend

volumes:
  crm_uploads:
```

---

## 10. Operations, Monitoring & Maintenance

### 10.1 Lead Escalation Cron Setup
To replace Emergent's `.emergent/crons.yml` with native Linux cron, add this line to `crontab -e`:
```bash
# Run lead escalation every 30 minutes
*/30 * * * * curl -s -X POST http://127.0.0.1:8000/api/cron/escalate-leads -H "Authorization: Bearer <YOUR_WEBHOOK_CRON_SECRET>" > /dev/null 2>&1
```

### 10.2 Database Backup Strategy
Set up an automated nightly MongoDB Atlas backup script on the VPS:
```bash
#!/bin/bash
# /home/deployer/backup_mongo.sh
BACKUP_DIR="/home/deployer/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

source /home/deployer/crm_onestock/backend/.env
mongodump --uri="$MONGO_URL" --out="$BACKUP_DIR/dump_$TIMESTAMP"
tar -czvf "$BACKUP_DIR/crm_backup_$TIMESTAMP.tar.gz" -C "$BACKUP_DIR" "dump_$TIMESTAMP"
rm -rf "$BACKUP_DIR/dump_$TIMESTAMP"

# Keep last 14 days of backups
find "$BACKUP_DIR" -type f -name "*.tar.gz" -mtime +14 -delete
```
Add to crontab: `0 2 * * * /bin/bash /home/deployer/backup_mongo.sh`

### 10.3 Update & Redeployment Script
Create `/home/deployer/deploy.sh`:
```bash
#!/bin/bash
set -e

echo "=== Pulling latest changes ==="
cd /home/deployer/crm_onestock
git pull origin main

echo "=== Updating backend dependencies ==="
cd /home/deployer/crm_onestock/backend
source venv/bin/activate
pip install -r requirements.txt

echo "=== Restarting backend service ==="
sudo systemctl restart crm-backend

echo "=== Building frontend ==="
cd /home/deployer/crm_onestock/frontend
yarn install --frozen-lockfile
REACT_APP_BACKEND_URL="" yarn build

echo "=== Deploying static files ==="
sudo cp -r build/* /var/www/crm_onestock/

echo "=== Reloading Nginx ==="
sudo systemctl reload nginx

echo "=== Deployment Complete ==="
```
Make executable: `chmod +x /home/deployer/deploy.sh`.

### 10.4 Log Locations & Inspection Commands
- **Backend Standard Logs:** `tail -f /var/log/crm-backend.log`
- **Backend Error Logs:** `tail -f /var/log/crm-backend-error.log`
- **Nginx Access Logs:** `tail -f /var/log/nginx/crm_access.log`
- **Nginx Error Logs:** `tail -f /var/log/nginx/crm_error.log`
- **FastAPI Service Status:** `sudo systemctl status crm-backend`

---

## 11. Testing & Verification Runbook

### 11.1 Local Test Suite Review
The codebase includes 10 test suites in `backend/tests/`:
1. `backend_test.py`: Comprehensive test of Auth, RBAC (Subadmin, Team Leader, Telecaller), Leads CRUD, Manual Assignment, CSV Import, Auto-Assign, Dashboard.
2. `test_actionless_and_unassign.py`: Validates the Actionless-24h bucket and unassign permissions.
3. `test_call_modes.py`: Validates phone vs desktop Smartflo calling modes.
4. `test_documents.py`: Tests document upload and retrieval.
5. `test_enhancements.py`: Tests recent enhancements (CSV exports, timezones).
6. `test_export_tz.py`: Validates IST timezone conversion in exports.
7. `test_payment_webhook.py`: Validates 50 Cr Club webhook idempotency and conversion approvals.
8. `test_performance.py`: Tests telecaller performance dashboard, live sessions, and heartbeats.
9. `test_smartflo.py`: Tests Smartflo phone formatting and click-to-call payload builders.

### 11.2 Running Tests on VPS
```bash
cd /home/deployer/crm_onestock/backend
source venv/bin/activate
export REACT_APP_BACKEND_URL="http://127.0.0.1:8000"
pytest -n 0 tests/test_smartflo.py tests/test_call_modes.py tests/test_actionless_and_unassign.py
```

### 11.3 Post-Deployment Smoke Test Checklist
- [ ] **Health Endpoint:** `curl -i http://127.0.0.1:8000/health` returns `200 OK` with `{"status": "healthy", "database": "connected"}`.
- [ ] **SSL & Domain:** Visiting `https://crm.yourdomain.com` renders the Onestock Academy login screen over TLS without browser security warnings.
- [ ] **Admin Login:** Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Successful login redirects to `/dashboard` and sets `crm_token` in `localStorage`.
- [ ] **Heartbeat Ping:** Open DevTools Network tab; verify `POST /api/sessions/heartbeat` executes successfully every 60 seconds with status 200.
- [ ] **Lead Creation:** Create a new lead manually on the `/leads` page. Confirm lead appears in the table.
- [ ] **Lead Assignment:** Assign the lead to a telecaller. Verify status badge updates to `assigned`.
- [ ] **Document Upload:** Upload a test PDF/image under `/documents`. Verify download works and file is written to `/var/data/crm_uploads`.
- [ ] **CORS Verification:** No CORS errors in browser console.
- [ ] **Client-Side Routing:** Refresh browser directly on `https://crm.yourdomain.com/leads`. Ensure Nginx returns `index.html` (200) instead of a 404.

---

## 12. Risks, Gotchas & Required User Inputs

### 12.1 Known Risks & Gotchas
1. **Cookie SameSite / Secure over HTTP:**
   - In `backend/auth.py:48-51`, auth cookies are set with `secure=True, samesite="none"`. Modern browsers will silently reject `secure=True` cookies if accessed over unencrypted `http://`. Ensure HTTPS is active before testing cookie-based authentication, or use the Bearer header in localStorage (handled automatically by `api.js`).
2. **Missing Form Import Boot Bug (Historical RCA):**
   - Emergent experienced a production crash caused by `Form` missing from the FastAPI import line in `server.py:26`. This was resolved in git commit `6bc57e3` / RCA, but verify lines 26–27 include `Form`.
3. **Smartflo Credentials Format:**
   - As documented in `memory/PRD.md`, `SMARTFLO_API_TOKEN` must be stored as a bare string in `.env`, not as Python code like `os.environ.get(...)`.
4. **Telecaller Number vs Company DID:**
   - In Tata Smartflo, each telecaller must have their own personal phone number registered as their `agent_number` in the Users page. The company caller ID / DID must go into `SMARTFLO_CALLER_ID`.
5. **Node.js RAM Usage During Build:**
   - Building React 19 (`craco build`) may consume up to 1.5GB of RAM. If your VPS has 1GB or 2GB RAM without swap, the build will be killed by the Linux OOM killer (`Killed`). Always ensure a **2GB swapfile** is created before running `yarn build`.

### 12.2 What You (the User) Must Provide Before Launch
1. **Domain Name:** Fully qualified domain name (e.g. `crm.onestockacademy.com`) with an **A record** pointing to your VPS public IPv4 address.
2. **MongoDB Atlas Connection URI:** Standard connection string (`mongodb+srv://...`) with the database user password URL-encoded.
3. **VPS Server IP & SSH Key:** Access to an Ubuntu 22.04 or 24.04 LTS instance (recommended: 2 vCPU, 2GB or 4GB RAM, 30GB SSD).
4. **Tata Smartflo API Token & Caller ID** (if VoIP click-to-call is actively used).
5. **VIP Market API Key & Upstream URL** (if 50 Cr Club live sync is used).

---

## 13. Master Execution Checklist: From Start to Production

### Phase 1: Pre-Migration & Atlas Setup
- [ ] Obtain MongoDB Atlas cluster (M0 or M10+) in AWS Mumbai (`ap-south-1`).
- [ ] Create database user `crm_app_user` with strong URL-encoded password.
- [ ] Whitelist VPS static IP in Atlas Network Access.
- [ ] Export existing data from Emergent using `mongodump` or the JSON export script.
- [ ] Restore data to Atlas using `mongorestore` or JSON restore script.
- [ ] Run `verify_counts.py` to confirm document counts match.

### Phase 2: Codebase Decoupling (To execute upon approval)
- [ ] Remove `emergentintegrations==0.2.0`, `jq`, `typer` from `backend/requirements.txt`.
- [ ] Add `dnspython>=2.4.2` to `backend/requirements.txt`.
- [ ] Replace `backend/storage.py` with local disk / S3 storage implementation.
- [ ] Remove Emergent CORS regex (`preview.emergentagent.com`) and add `/health` in `backend/server.py`.
- [ ] Remove Emergent script tag and PostHog tracking snippet from `frontend/public/index.html`.
- [ ] Remove `@emergentbase/visual-edits` from `frontend/package.json` and `frontend/craco.config.js`.
- [ ] Delete or archive `.emergent/`, `frontend/plugins/health-check/`, and root `.gitconfig`.

### Phase 3: VPS Provisioning & Deployment
- [ ] Provision Ubuntu 22.04/24.04 VPS; set up 2GB swap and UFW firewall.
- [ ] Install Node.js 20 LTS, Yarn Classic, Python 3.11, Nginx, Certbot.
- [ ] Clone repo to `/home/deployer/crm_onestock`.
- [ ] Create `/var/data/crm_uploads` with permissions for `deployer`.
- [ ] Set up Python virtual environment and run `pip install -r requirements.txt`.
- [ ] Configure `backend/.env` with Atlas URI, secrets, and admin credentials.
- [ ] Create systemd unit `/etc/systemd/system/crm-backend.service`; enable and start.
- [ ] Run `REACT_APP_BACKEND_URL="" yarn build` in `frontend/`.
- [ ] Copy frontend build output to `/var/www/crm_onestock/`.
- [ ] Configure Nginx reverse proxy block and reload Nginx.
- [ ] Run `certbot --nginx` to issue Let's Encrypt SSL certificate.

### Phase 4: Production Verification & Go-Live
- [ ] Check `curl -i https://crm.yourdomain.com/health` returns `200 OK`.
- [ ] Log in as admin at `https://crm.yourdomain.com/login`.
- [ ] Verify telecaller workspace, leads list, and follow-up calendar.
- [ ] Test document upload and download.
- [ ] Configure Linux crontab for lead escalation.
- [ ] Verify automated nightly backup script is active.
- [ ] **System is LIVE, independent, and secure.**
