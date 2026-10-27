from pathlib import Path
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values(Path(__file__).resolve().parent.parent.parent / "frontend" / ".env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

backend_env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")
INTAKE_KEY = backend_env.get("INTAKE_API_KEY")
CRON_SECRET = backend_env.get("WEBHOOK_CRON_SECRET")

CREDS = {
    "admin": ("admin@crm.com", "admin123"),
    "subadmin": ("qa.subadmin@crmtest.com", "pass123"),
    "leader1": ("qa.leader@crmtest.com", "pass123"),
    "leader2": ("qa.leader2@crmtest.com", "pass123"),
    "caller1": ("qa.caller@crmtest.com", "pass123"),
    "caller2": ("qa.caller2@crmtest.com", "pass123"),
    "caller3": ("qa.caller3@crmtest.com", "pass123"),
}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login failed for {email}: {r.status_code} {r.text[:300]}")
    data = r.json()
    return data["access_token"], data["user"]


def client_for(key):
    email, password = CREDS[key]
    token, user = _login(email, password)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    s.user = user
    return s


@pytest.fixture(scope="session")
def admin():
    return client_for("admin")


@pytest.fixture(scope="session")
def subadmin():
    return client_for("subadmin")


@pytest.fixture(scope="session")
def leader1():
    return client_for("leader1")


@pytest.fixture(scope="session")
def caller1():
    return client_for("caller1")


@pytest.fixture(scope="session")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
