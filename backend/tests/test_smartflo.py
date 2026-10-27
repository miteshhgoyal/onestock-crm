from pathlib import Path
"""Tata Smartflo click-to-call integration tests.

Real third-party API - keep successful invocations to a minimum (1-2 max).
We rely on validation/guard-rail paths for most coverage, and place ONE
success call to prove the token+header pipeline actually works.
"""
import os
import time
from datetime import datetime, timezone

import pytest
import requests
from bson import ObjectId
from dotenv import dotenv_values
from pymongo import MongoClient

from conftest import API, CREDS  # noqa: E402


backend_env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")
MONGO_URL = backend_env.get("MONGO_URL")
DB_NAME = backend_env.get("DB_NAME")
SMARTFLO_CALLER_ID = backend_env.get("SMARTFLO_CALLER_ID")
SMARTFLO_WEBHOOK_SECRET = backend_env.get("SMARTFLO_WEBHOOK_SECRET")

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    return r.json()


@pytest.fixture(scope="module")
def owner_admin():
    """Owner admin butbrucewill@gmail.com. Ensures agent_number is 9812345678."""
    data = _login("butbrucewill@gmail.com", "admin123")
    token = data["access_token"]
    user = data["user"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    s.user = user
    # Make sure agent_number is set to 9812345678
    r = s.patch(f"{API}/users/{user['id']}", json={"agent_number": "9812345678"}, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def legacy_admin():
    data = _login("admin@crm.com", "admin123")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {data['access_token']}", "Content-Type": "application/json"})
    s.user = data["user"]
    return s


@pytest.fixture(scope="module")
def caller1_client(owner_admin):
    """Telecaller qa.caller@crmtest.com with agent_number cleared."""
    data = _login(*CREDS["caller1"])
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {data['access_token']}", "Content-Type": "application/json"})
    s.user = data["user"]
    # Clear agent_number as admin
    r = owner_admin.patch(f"{API}/users/{s.user['id']}", json={"agent_number": ""}, timeout=30)
    assert r.status_code == 200, r.text
    return s


# ---------- .env / regression checks ----------

def test_env_file_has_no_python_code():
    with open(Path(__file__).resolve().parent.parent / ".env") as f:
        content = f.read()
    assert "os.environ.get" not in content, ".env contains Python code - the exact bug the fix addresses"
    assert backend_env.get("SMARTFLO_API_TOKEN"), "SMARTFLO_API_TOKEN missing"
    token = backend_env.get("SMARTFLO_API_TOKEN")
    assert not token.startswith("os.environ")
    # JWT-shaped
    assert token.count(".") == 2, "SMARTFLO_API_TOKEN doesn't look like a JWT"


def test_admin_email_updated():
    assert backend_env.get("ADMIN_EMAIL") == "butbrucewill@gmail.com"


# ---------- diagnostics ----------

def test_diagnostics_healthy_for_owner_admin(owner_admin):
    r = owner_admin.get(f"{API}/calls/diagnostics", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["token_configured"] is True
    assert data["caller_id"] == SMARTFLO_CALLER_ID
    assert data["agent_number"] == "9812345678"
    assert data["agent_number_sent_as"] == "919812345678"
    assert data["ready"] is True, f"problems: {data.get('problems')}"
    # ensure no lingering "contains Python code" issue
    for prob in data.get("problems", []):
        assert "Python code" not in prob


def test_diagnostics_detects_agent_equals_did(owner_admin):
    uid = owner_admin.user["id"]
    try:
        r = owner_admin.patch(f"{API}/users/{uid}", json={"agent_number": SMARTFLO_CALLER_ID}, timeout=30)
        assert r.status_code == 200
        r = owner_admin.get(f"{API}/calls/diagnostics", timeout=30)
        data = r.json()
        assert data["ready"] is False
        assert any("Agent number equals the caller ID" in p for p in data["problems"]), data["problems"]
    finally:
        owner_admin.patch(f"{API}/users/{uid}", json={"agent_number": "9812345678"}, timeout=30)


def test_diagnostics_unauth_401():
    r = requests.get(f"{API}/calls/diagnostics", timeout=30)
    assert r.status_code == 401


# ---------- click-to-call: validation paths (no real dial) ----------

def test_click_to_call_unauth_401():
    r = requests.post(f"{API}/calls/click-to-call", json={"destination_number": "9810012301"}, timeout=30)
    assert r.status_code == 401


def test_click_to_call_short_number_400(owner_admin):
    r = owner_admin.post(f"{API}/calls/click-to-call", json={"destination_number": "123"}, timeout=30)
    assert r.status_code == 400
    assert "valid destination number" in r.text.lower()


def test_click_to_call_empty_number_400(owner_admin):
    r = owner_admin.post(f"{API}/calls/click-to-call", json={"destination_number": ""}, timeout=30)
    assert r.status_code == 400


def test_click_to_call_no_agent_number_returns_400_with_hint(caller1_client):
    r = caller1_client.post(f"{API}/calls/click-to-call", json={"destination_number": "9810012301"}, timeout=30)
    assert r.status_code == 400, r.text
    msg = r.text.lower()
    assert "agent number" in msg or "users page" in msg


# ---------- click-to-call: LIVE success (only ONE) ----------

@pytest.fixture(scope="module")
def live_call_result(owner_admin):
    """Single live Smartflo call - fixture so we can inspect audit trail + activity."""
    # pick a lead visible to admin
    lr = owner_admin.get(f"{API}/leads", timeout=30)
    assert lr.status_code == 200
    leads = lr.json().get("items") or lr.json()
    lead_id = None
    if isinstance(leads, list) and leads:
        lead_id = leads[0].get("id") or leads[0].get("_id")
    payload = {"destination_number": "+91 98100 12301"}
    if lead_id:
        payload["lead_id"] = lead_id
    r = owner_admin.post(f"{API}/calls/click-to-call", json=payload, timeout=45)
    return {"resp": r, "lead_id": lead_id, "sent": payload}


def test_click_to_call_success_response(live_call_result):
    r = live_call_result["resp"]
    assert r.status_code == 200, f"live smartflo call failed: {r.status_code} {r.text[:400]}"
    data = r.json()
    assert data.get("success") is True, f"unexpected body: {data}"
    call_id = data.get("call_id") or data.get("ref_id")
    assert call_id, f"no call_id/ref_id in response: {data}"


def test_click_to_call_normalises_number_and_persists_audit(live_call_result):
    time.sleep(0.5)
    doc = db.call_attempts.find_one(sort=[("created_at", -1)])
    assert doc is not None, "no call_attempts document written"
    assert doc["agent_number"] == "919812345678"
    assert doc["destination_number"] == "919810012301"  # normalised from '+91 98100 12301'
    assert doc["status_code"] == 200
    assert isinstance(doc.get("provider_response"), dict)
    assert doc["caller_id"] == SMARTFLO_CALLER_ID


def test_click_to_call_writes_lead_activity(owner_admin, live_call_result):
    lead_id = live_call_result["lead_id"]
    if not lead_id:
        pytest.skip("no lead available")
    r = owner_admin.get(f"{API}/leads/{lead_id}", timeout=30)
    assert r.status_code == 200
    lead = r.json()
    # Activity may be nested in lead['activities'] or fetched separately
    activities = lead.get("activities")
    if activities is None:
        # fallback to /activities?lead_id=
        ar = owner_admin.get(f"{API}/activities", params={"lead_id": lead_id}, timeout=30)
        activities = ar.json() if ar.status_code == 200 else []
    found = False
    for a in activities or []:
        if a.get("type") == "call_initiated" or "call_initiated" in str(a.get("action", "")):
            found = True
            break
    assert found, f"call_initiated activity not found for lead {lead_id}"


def test_smartflo_callback_updates_dashboard_outcome(caller1_client):
    call_id = f"dashboard-status-test-{int(time.time() * 1000)}"
    before_response = caller1_client.get(f"{API}/reports/dashboard?period=month", timeout=30)
    assert before_response.status_code == 200, before_response.text
    before = before_response.json()["totals"]
    result = db.call_attempts.insert_one({
        "user_id": ObjectId(caller1_client.user["id"]),
        "provider_call_id": call_id,
        "destination_number": "919810012301",
        "status_code": 200,
        "connected": False,
        "call_outcome": "not_connected",
        "duration": 0,
        "created_at": datetime.now(timezone.utc),
    })
    try:
        callback = requests.post(
            f"{API}/calls/smartflo-webhook",
            params={"secret": SMARTFLO_WEBHOOK_SECRET} if SMARTFLO_WEBHOOK_SECRET else None,
            json={"ref_id": call_id, "call_status": "answered", "call_duration": "32"},
            timeout=30,
        )
        assert callback.status_code == 200, callback.text
        assert callback.json().get("matched") is True

        stored_call = db.call_attempts.find_one({"_id": result.inserted_id})
        assert stored_call["connected"] is True
        assert stored_call["call_outcome"] == "connected"

        after_response = caller1_client.get(f"{API}/reports/dashboard?period=month", timeout=30)
        assert after_response.status_code == 200, after_response.text
        after = after_response.json()["totals"]
        assert after["connected_period"] == before["connected_period"] + 1
    finally:
        db.call_attempts.delete_one({"_id": result.inserted_id})


# ---------- owner + legacy admin login ----------

def test_owner_admin_is_admin_role():
    data = _login("butbrucewill@gmail.com", "admin123")
    assert data["user"]["role"] == "admin"


def test_legacy_admin_still_logs_in(legacy_admin):
    assert legacy_admin.user["role"] == "admin"


@pytest.mark.parametrize("key", ["subadmin", "leader1", "leader2", "caller1", "caller2", "caller3"])
def test_seeded_demo_users_login(key):
    email, pw = CREDS[key]
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"{email} login failed: {r.text[:200]}"


# ---------- cleanup ----------

def teardown_module(module):
    # Clean call_attempts written during this run (approx: last 30 min)
    try:
        from datetime import datetime, timedelta, timezone
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
        db.call_attempts.delete_many({"created_at": {"$gte": cutoff}})
    except Exception:
        pass
