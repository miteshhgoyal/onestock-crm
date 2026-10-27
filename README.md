# Onestock Academy CRM

Production-ready web CRM built for Onestock Academy's 20–25 person calling and sales team.

## Tech Stack
- **Backend:** FastAPI (Python 3.11), Motor, PyMongo, Pydantic v2, PyJWT, Bcrypt
- **Frontend:** React 19, CRACO, Tailwind CSS, Radix UI (Shadcn/UI), TanStack React Query
- **Database:** MongoDB (Local or MongoDB Atlas)
- **Storage:** Multi-backend storage module supporting **Cloudinary**, **Cloudflare R2** (S3-compatible), or **Local Filesystem**
- **Telephony:** Tata Smartflo click-to-call integration with desktop softphone extension support

---

## Documentation Quick Links
- 📘 **[RUN_GUIDE.md](RUN_GUIDE.md)** — **Step-by-step instructions on how to run locally and on a production Linux VPS**, including complete Cloudinary and Cloudflare R2 setup walkthroughs.
- 📙 **[DEPLOYMENT_MIGRATION_GUIDE.md](DEPLOYMENT_MIGRATION_GUIDE.md)** — End-to-end technical audit, MongoDB to Atlas data migration runbook, Nginx reverse proxy configurations, and systemd service files.
- ⚙️ **[backend/.env.example](backend/.env.example)** — Backend environment variables template.
- ⚙️ **[frontend/.env.example](frontend/.env.example)** — Frontend build environment variables template.

---

## Quickstart (Local Development)

### 1. Backend
```bash
cd backend
python -m venv venv

# Windows:
.\venv\Scripts\Activate.ps1
# Linux / macOS:
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
# Fill in MONGO_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD in .env
uvicorn server:app --reload --port 8000
```
Health check: `http://localhost:8000/health`  
Interactive Swagger docs: `http://localhost:8000/docs`

### 2. Frontend
```bash
cd frontend
cp .env.example .env
yarn install
yarn start
```
The CRM will open at `http://localhost:3000`.

---

## Storage Configuration
Set `STORAGE_TYPE` in `backend/.env`:
- `STORAGE_TYPE="cloudinary"` — for Cloudinary cloud media storage (requires `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`)
- `STORAGE_TYPE="r2"` — for Cloudflare R2 object storage (requires `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`)
- `STORAGE_TYPE="local"` — for storing files directly on local disk
