# Comprehensive Run Guide: Local Development & Server Deployment
**Project:** Onestock Academy CRM (`crm_onestock`)  
**Stack:** FastAPI (Python 3.11) + React 19 / CRACO + MongoDB (Local or Atlas) + Multi-Backend Storage (Cloudinary / Cloudflare R2 / Local)

---

## Table of Contents
1. [Overview & Features](#1-overview--features)
2. [Prerequisites](#2-prerequisites)
3. [Cloud Storage Setup (Cloudinary, Cloudflare R2, Local Disk)](#3-cloud-storage-setup)
   - [Option A: Cloudinary Setup (Recommended for Media & Easy Setup)](#option-a-cloudinary-setup-recommended)
   - [Option B: Cloudflare R2 Setup (Recommended for Enterprise / Zero Egress Fees)](#option-b-cloudflare-r2-setup-s3-compatible)
   - [Option C: Local Filesystem Storage (No 3rd-party accounts needed)](#option-c-local-filesystem-storage)
4. [Running the Application Locally](#4-running-the-application-locally)
   - [Step 1: Database Setup (Local Mongo or Atlas)](#step-1-database-setup)
   - [Step 2: Backend Setup & Launch](#step-2-backend-setup--launch)
   - [Step 3: Frontend Setup & Launch](#step-3-frontend-setup--launch)
   - [Step 4: Seed Demo Data (Optional)](#step-4-seed-demo-data-optional)
   - [Step 5: Logging In](#step-5-logging-in)
5. [Running the Application on a Production Server (Ubuntu VPS)](#5-running-the-application-on-a-production-server-ubuntu-vps)
   - [Phase 1: Server Prep & Dependencies](#phase-1-server-prep--dependencies)
   - [Phase 2: Backend Configuration & Systemd Service](#phase-2-backend-configuration--systemd-service)
   - [Phase 3: Frontend Production Build](#phase-3-frontend-production-build)
   - [Phase 4: Nginx Reverse Proxy Setup](#phase-4-nginx-reverse-proxy-setup)
   - [Phase 5: Free SSL / HTTPS (Let's Encrypt)](#phase-5-free-ssl--https-lets-encrypt)
6. [Docker Compose Deployment (Optional)](#6-docker-compose-deployment-optional)
7. [Troubleshooting & Common Questions](#7-troubleshooting--common-questions)

---

## 1. Overview & Features

`crm_onestock` is a full-featured CRM designed for sales and telecalling teams. Key capabilities include:
- **Lead Pipeline:** Intake via manual forms, CSV import, and webhooks; automated and manual assignment; stage tracking (`new_lead`, `assigned`, `contacted`, `follow_up`, `interested`, `converted`, `lost`).
- **Role Hierarchy & RBAC:** Admin, Sub-admin, Team Leader, Telecaller with scoped visibility.
- **Telecaller Workspace:** Focused speed-dialer split-pane, task queues, follow-up calendar, and call outcome logging.
- **Telephony Integration:** Tata Smartflo click-to-call, agent extension routing, and call duration webhook capture.
- **VIP 50 Cr Club:** Purchase tracking, membership dates matching, automated conversion review, and relationship manager assignments.
- **Reporting & Live Status:** Live team status board (15s auto-refresh), telecaller performance metrics, conversion reports, and CSV exports in Indian Standard Time (`Asia/Kolkata`).
- **Flexible Document Storage:** Integrated storage module supporting **Cloudinary**, **Cloudflare R2**, or **Local Disk** with automatic MIME detection and cleanup.

---

## 2. Prerequisites

| Tool | Recommended Version | Purpose | Verify Command |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v20.x` (LTS) | Frontend runtime | `node -v` |
| **Yarn** | `1.22.x` (Classic) | Frontend package manager | `yarn -v` |
| **Python** | `3.11.x` (3.10 – 3.12 supported) | Backend runtime | `python --version` |
| **MongoDB** | `6.0` or `7.0` (Local or Atlas) | Database | `mongosh --version` |
| **Git** | `2.x+` | Source control | `git --version` |

---

## 3. Cloud Storage Setup

The CRM includes a unified storage driver in [`backend/storage.py`](file:///backend/storage.py) that works interchangeably across **Cloudinary**, **Cloudflare R2**, and **Local Filesystem**. Configure your choice via `STORAGE_TYPE` in `backend/.env`.

---

### Option A: Cloudinary Setup (Recommended)
Cloudinary provides free cloud storage (25 GB storage, global CDN, and automated asset delivery).

#### Step 1: Create a Free Cloudinary Account
1. Go to [cloudinary.com](https://cloudinary.com/) and click **Sign Up Free**.
2. Complete registration and log in to your Cloudinary Console.

#### Step 2: Retrieve API Credentials
1. From the Cloudinary Dashboard home, look at the **Product Environment** section at the top.
2. Note your **Cloud Name** (e.g. `dxyza1234`).
3. Click the gear icon (**Settings**) in the bottom left -> **Product Environment Settings** -> **API Keys**.
4. You will see:
   - **Cloud Name** (e.g. `dxyza1234`)
   - **API Key** (e.g. `123456789012345`)
   - **API Secret** (Click "Show" to reveal)

#### Step 3: Add to `backend/.env`
Open `backend/.env` and configure:
```ini
STORAGE_TYPE="cloudinary"
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"

# Or alternatively, paste the single CLOUDINARY_URL provided in dashboard:
# CLOUDINARY_URL="cloudinary://<api_key>:<api_secret>@<cloud_name>"
```

#### How it works:
- When telecallers or managers upload KYC documents, PDFs, or images under `/documents`, they are securely stored in Cloudinary.
- Images are served with CDN optimization; PDFs and raw documents are safely streamed back upon download.
- When a document is deleted from the CRM, it is automatically removed from your Cloudinary storage.

---

### Option B: Cloudflare R2 Setup (S3-Compatible)
Cloudflare R2 provides S3-compatible cloud object storage with **10 GB free** and **$0 egress fees** (bandwidth is completely free).

#### Step 1: Create a Cloudflare Account & Enable R2
1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. On the left sidebar, click **R2**.
3. If this is your first time, click **Enable R2** (requires payment method on file, but free tier is 10 GB with zero bandwidth charges).

#### Step 2: Create a Bucket
1. Click **Create bucket**.
2. Bucket Name: `crm-documents` (or your preferred name).
3. Location: Choose **Automatic** or select **Asia Pacific (APAC)** for lower latency.
4. Click **Create Bucket**.

#### Step 3: Generate R2 API Tokens (S3 Credentials)
1. On the R2 Overview page, look at the right sidebar and click **Manage R2 API Tokens**.
2. Click **Create API token**.
3. Permissions: Select **Object Read & Write**.
4. Specify bucket: You can apply to all buckets or choose `crm-documents`.
5. Click **Create API Token**.
6. Cloudflare will display:
   - **Access Key ID** (e.g. `a1b2c3d4e5f6...`)
   - **Secret Access Key** (e.g. `f1e2d3c4b5a6...`)
   - **Endpoint** (format: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`)
   - Note down your **Account ID** (visible in the URL or token page).

#### Step 4: Add to `backend/.env`
Open `backend/.env` and configure:
```ini
STORAGE_TYPE="r2"
R2_ACCOUNT_ID="your_cloudflare_account_id"
R2_ACCESS_KEY_ID="your_r2_access_key_id"
R2_SECRET_ACCESS_KEY="your_r2_secret_access_key"
R2_BUCKET_NAME="crm-documents"
```

---

### Option C: Local Filesystem Storage
If you do not want to use any cloud service, files can be stored directly on the local machine's hard drive:
```ini
STORAGE_TYPE="local"
LOCAL_STORAGE_DIR=""
```
- On local machines, files default to `backend/uploads/documents/`.
- On Linux VPS servers, set `LOCAL_STORAGE_DIR="/var/data/crm_uploads"`.

---

## 4. Running the Application Locally

Follow these steps to run the complete CRM locally on your computer.

### Step 1: Database Setup
You can use either **MongoDB Atlas** (Cloud) or a **Local MongoDB instance**:

- **Option 1: MongoDB Atlas (Recommended):**
  1. Create a free cluster at [cloud.mongodb.com](https://cloud.mongodb.com/).
  2. Create a DB user (e.g. `crm_user`) and password.
  3. Add your current IP address to the Atlas Network IP Whitelist.
  4. Copy your connection string: `mongodb+srv://crm_user:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority`.

- **Option 2: Local MongoDB:**
  - If you have MongoDB installed locally or running in Docker (`docker run -d -p 27017:27017 mongo:7`), use:
  `mongodb://127.0.0.1:27017`

---

### Step 2: Backend Setup & Launch

Open a terminal in the project directory:

```bash
# 1. Navigate to backend directory
cd backend

# 2. Create Python virtual environment
python -m venv venv

# 3. Activate virtual environment
# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1
# On macOS / Linux:
source venv/bin/activate

# 4. Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# 5. Create .env configuration
cp .env.example .env
```

Open `backend/.env` in your text editor and fill in your values:
```ini
MONGO_URL="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
DB_NAME="crm_onestock"
JWT_SECRET="e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8"
ADMIN_EMAIL="admin@onestockacademy.com"
ADMIN_PASSWORD="adminpassword123"
CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"

# Set your chosen storage:
STORAGE_TYPE="cloudinary"
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"
```

Start the FastAPI development server:
```bash
uvicorn server:app --reload --port 8000
```

Verify backend is healthy:
- Open your browser to: `http://localhost:8000/health` -> should return `{"status": "healthy", "database": "connected"}`.
- Interactive API documentation (Swagger): `http://localhost:8000/docs`.

---

### Step 3: Frontend Setup & Launch

Open a **second terminal** window:

```bash
# 1. Navigate to frontend directory
cd frontend

# 2. Create .env configuration
cp .env.example .env
```

Verify `frontend/.env` contains:
```ini
REACT_APP_BACKEND_URL="http://localhost:8000"
```

Install packages and run:
```bash
# 3. Install frontend dependencies
yarn install

# 4. Start React development server
yarn start
```

Your browser will automatically open to `http://localhost:3000`.

---

### Step 4: Seed Demo Data (Optional)

If you want ready-to-test teams, telecallers, and leads:
In your backend terminal (with venv active):
```bash
python seed_demo.py
python seed_leads.py
```
This populates:
- 2 Teams: **Alpha Team** and **Beta Team**
- Team leaders: `leader1@crm.com`, `leader2@crm.com` (password: `pass123`)
- Telecallers: `caller1@crm.com`, `caller2@crm.com`, `caller3@crm.com` (password: `pass123`)
- Subadmin: `subadmin@crm.com` (password: `pass123`)
- Sample leads distributed across pipeline stages

---

### Step 5: Logging In

Navigate to `http://localhost:3000/login`:
- **Master Admin:**
  - Email: value of `ADMIN_EMAIL` in `backend/.env` (e.g. `admin@onestockacademy.com`)
  - Password: value of `ADMIN_PASSWORD` in `backend/.env` (e.g. `adminpassword123`)
- **Demo Users (if seeded):**
  - Team Leader: `leader1@crm.com` / `pass123`
  - Telecaller: `caller1@crm.com` / `pass123`

---

## 5. Running the Application on a Production Server (Ubuntu VPS)

Follow this guide to deploy to an Ubuntu 22.04 or 24.04 LTS server.

### Phase 1: Server Prep & Dependencies
Log in via SSH as `root`:
```bash
# Update system
apt update && apt upgrade -y

# Install tools, Python, Nginx, Certbot
apt install -y ufw curl git build-essential python3-dev python3-venv \
               python3-pip nginx certbot python3-certbot-nginx

# Create 2GB swapfile (prevents RAM out-of-memory during React build)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Configure firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# Create dedicated deployer user
useradd -m -s /bin/bash deployer
usermod -aG sudo deployer
echo "deployer ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/deployer

# Install Node.js 20 LTS & Yarn
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g yarn
```

---

### Phase 2: Backend Configuration & Systemd Service
Switch to `deployer` user:
```bash
su - deployer

# Clone repo
git clone <your-git-repo-url> /home/deployer/crm_onestock
cd /home/deployer/crm_onestock/backend

# Create virtual environment & install requirements
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Create .env
cp .env.example .env
nano .env # Enter your MongoDB Atlas URI, JWT_SECRET, Cloudinary or R2 keys, ADMIN_EMAIL, ADMIN_PASSWORD
```

Create systemd service file:
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

Start and enable backend:
```bash
sudo touch /var/log/crm-backend.log /var/log/crm-backend-error.log
sudo chown deployer:deployer /var/log/crm-backend*.log
sudo systemctl daemon-reload
sudo systemctl enable crm-backend
sudo systemctl start crm-backend
sudo systemctl status crm-backend
```

---

### Phase 3: Frontend Production Build
```bash
cd /home/deployer/crm_onestock/frontend

# Install dependencies
yarn install --frozen-lockfile

# Build frontend with relative API path
REACT_APP_BACKEND_URL="" yarn build

# Move build to Nginx directory
sudo mkdir -p /var/www/crm_onestock
sudo cp -r build/* /var/www/crm_onestock/
sudo chown -R www-data:www-data /var/www/crm_onestock
```

---

### Phase 4: Nginx Reverse Proxy Setup
Create `/etc/nginx/sites-available/crm_onestock`:
```bash
sudo nano /etc/nginx/sites-available/crm_onestock
```

Paste the server configuration (replace `crm.yourdomain.com` with your domain):
```nginx
server {
    listen 80;
    server_name crm.yourdomain.com;

    client_max_body_size 50M;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    # 1. Static React SPA
    root /var/www/crm_onestock;
    index index.html;

    location / {
        # Client-side routing fallback for React Router
        try_files $uri $uri/ /index.html;
    }

    # Static file caching
    location ~* \.(?:css|js|jpg|jpeg|gif|png|ico|cur|gz|svg|svgz|mp4|ogg|ogv|webm|htc|woff2|woff)$ {
        expires 1M;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    # 2. Reverse Proxy to FastAPI Backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # 3. Direct Health Check
    location /health {
        proxy_pass http://127.0.0.1:8000/health;
        proxy_set_header Host $host;
        access_log off;
    }
}
```

Enable site and test Nginx:
```bash
sudo ln -sf /etc/nginx/sites-available/crm_onestock /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

### Phase 5: Free SSL / HTTPS (Let's Encrypt)
Once your domain's DNS points to your server IP:
```bash
sudo certbot --nginx -d crm.yourdomain.com --non-interactive --agree-tos --email admin@yourdomain.com --redirect
```
Certbot will configure SSL and auto-renewal. Test renewal with:
```bash
sudo certbot renew --dry-run
```

---

## 6. Docker Compose Deployment (Optional)

If you prefer deploying with Docker:

1. Create `backend/.env` with your configuration.
2. Build and launch containers:
```bash
docker compose up -d --build
```
3. The app is accessible at `http://localhost:80` (or your VPS port 80).

---

## 7. Troubleshooting & Common Questions

### Q: "Health check fails with 503 Database Unavailable"
- Ensure your MongoDB Atlas cluster has your current IP (or VPS IP) whitelisted in Atlas -> Network Access.
- Verify your password in `MONGO_URL` has special characters URL-encoded (e.g. `@` -> `%40`).

### Q: "Uploaded documents fail with 404 or Cloudinary error"
- If using `STORAGE_TYPE="cloudinary"`, check your terminal logs. If `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, or `CLOUDINARY_API_SECRET` are not set, it will log a warning.
- If using `STORAGE_TYPE="r2"`, confirm your `R2_BUCKET_NAME` exists and your API token has **Object Read & Write** permissions.
- You can always set `STORAGE_TYPE="local"` for instant zero-configuration disk storage.

### Q: "Frontend shows blank screen or 404 on refresh on VPS"
- Make sure `try_files $uri $uri/ /index.html;` is present in your Nginx config. This directs all React client-side routes (like `/leads`, `/workspace`) to React's `index.html`.

### Q: "How do I update the application after git push?"
Run these commands on your VPS:
```bash
cd /home/deployer/crm_onestock
git pull origin main

# Update backend
cd backend
source venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart crm-backend

# Update frontend
cd ../frontend
yarn install --frozen-lockfile
REACT_APP_BACKEND_URL="" yarn build
sudo cp -r build/* /var/www/crm_onestock/
sudo systemctl reload nginx
```
