from pathlib import Path
"""Tests for the new desktop/phone call_mode + agent_extension self-service feature.

- Places AT MOST TWO live Smartflo calls total (1 desktop-mode, 1 phone-mode)
  to the seeded fake number 9810012301.
- Desktop-mode call to Tata may legitimately reject extension '1024' with 502;
  what matters is agent_number sent + audit row content.
"""
import time
import asyncio
from types import SimpleNamespace
import pytest
import requests
import httpx
from dotenv import dotenv_values
from pymongo import MongoClient
from bson import ObjectId

from conftest import API, CREDS, client_for  # noqa: E402
import server
from server import call_attempt_connected, select_agent_number


backend_env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")
mongo = MongoClient(backend_env.get("MONGO_URL"))
db = mongo[backend_env.get("DB_NAME")]

SOFTPHONE_URL = "https://chromewebstore.google.com/detail/smartflo-softphone/dbhcchccbhpnohpmcallfdfcfnogdfpo"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _session(email, password):
    data = _login(email, password)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {data['access_token']}", "Content-Type": "application/json"})
    s.user = data["user"]
    return s


@pytest.fixture(scope="module")
def owner():
    return _session("butbrucewill@gmail.com", "admin123")


@pytest.fixture(scope="module")
def subadmin():
    return _session(*CREDS["subadmin"])


@pytest.fixture(scope="module")
def leader():
    return _session(*CREDS["leader1"])


@pytest.fixture(scope="module")
def caller():
    return _session(*CREDS["caller1"])


@pytest.fixture(scope="module")
def caller2():
    return _session(*CREDS["caller2"])


# ---------- PATCH /api/calls/preferences ----------

@pytest.mark.parametrize("role_key", ["owner", "subadmin", "leader", "caller"])
def test_preferences_patch_all_roles(role_key, owner, subadmin, leader, caller):
    """Every role can PATCH their own call_mode via /calls/preferences."""
    s = {"owner": owner, "subadmin": subadmin, "leader": leader, "caller": caller}[role_key]
    r = s.patch(f"{API}/calls/preferences", json={"call_mode": "desktop"}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("call_mode") == "desktop"
    # Flip back
    r2 = s.patch(f"{API}/calls/preferences", json={"call_mode": "phone"}, timeout=30)
    assert r2.status_code == 200
    assert r2.json().get("call_mode") == "phone"


def test_multiple_agent_dids_rotate_round_robin():
    user = {"agent_number": "9812345678, 9812345679, 9812345680", "next_agent_number_index": 0}
    assert select_agent_number(user) == "9812345678"
    user["next_agent_number_index"] = 1
    assert select_agent_number(user) == "9812345679"
    user["next_agent_number_index"] = 2
    assert select_agent_number(user) == "9812345680"
    user["next_agent_number_index"] = 3
    assert select_agent_number(user) == "9812345678"


def test_explicit_not_connected_outcome_overrides_successful_request_status():
    not_answered_call = {
        "call_outcome": "not_connected",
        "connected": False,
        "status_code": 200,
    }
    assert call_attempt_connected(not_answered_call) is False
    assert call_attempt_connected({"status_code": 200}) is True
    assert call_attempt_connected({"status_code": 503}) is False
    assert call_attempt_connected({
        "manual_call_outcome": "not_connected",
        "call_outcome": "connected",
        "connected": True,
        "status_code": 200,
    }) is False


def test_lead_call_filters_use_manual_outcome_and_selected_attempt(monkeypatch):
    lead_one = ObjectId()
    lead_two = ObjectId()
    lead_three = ObjectId()
    rows = [
        {"lead_id": lead_one, "call_number": 1, "manual_call_outcome": "not_connected",
         "call_outcome": "connected", "connected": True, "status_code": 200,
         "manual_outcome_updated_at": 1, "created_at": 1},
        {"lead_id": lead_one, "call_number": 2, "manual_call_outcome": "connected",
         "call_outcome": "connected", "connected": True, "status_code": 200,
         "manual_outcome_updated_at": 2, "created_at": 2},
        {"lead_id": lead_two, "call_number": 1, "manual_call_outcome": "connected",
         "call_outcome": "not_connected", "connected": False, "status_code": 200,
         "manual_outcome_updated_at": 1, "created_at": 1},
        {"lead_id": lead_three, "call_number": 1, "manual_call_outcome": "connected",
         "call_outcome": "connected", "connected": True, "status_code": 200,
         "manual_outcome_updated_at": 1, "created_at": 1},
        {"lead_id": lead_three, "call_number": 2, "manual_call_outcome": "connected",
         "call_outcome": "connected", "connected": True, "status_code": 200,
         "manual_outcome_updated_at": 2, "created_at": 2},
        {"lead_id": lead_three, "call_number": 3, "manual_call_outcome": "not_connected",
         "call_outcome": "not_connected", "connected": False, "status_code": 503,
         "manual_outcome_updated_at": 3, "created_at": 3},
    ]

    class FakeCursor:
        def __init__(self, call_rows):
            self.call_rows = call_rows

        async def to_list(self, _limit):
            return self.call_rows

    class FakeAttempts:
        def find(self, query, _projection):
            call_number = query.get("call_number")
            call_rows = [row for row in rows if call_number is None or row["call_number"] == call_number]
            return FakeCursor(call_rows)

        def aggregate(self, _pipeline):
            attempts_by_lead = {}
            for row in rows:
                attempts_by_lead[row["lead_id"]] = attempts_by_lead.get(row["lead_id"], 0) + 1
            return FakeCursor([
                {"_id": lead_id, "attempt_count": attempt_count}
                for lead_id, attempt_count in attempts_by_lead.items()
                if attempt_count == _pipeline[-1]["$match"]["attempt_count"]
            ])

    async def empty_scope(_user):
        return {}

    monkeypatch.setattr(server, "db", SimpleNamespace(call_attempts=FakeAttempts()))
    monkeypatch.setattr(server, "lead_scope", empty_scope)
    monkeypatch.setattr(server, "call_attempt_scope", empty_scope)

    async def query(outcome=None, call_number=None):
        result = await server.build_lead_query(
            {"role": "admin"}, call_outcome=outcome, call_number=call_number,
        )
        return set(result.get("_id", {}).get("$in", []))

    assert asyncio.run(query("connected")) == {lead_one, lead_two}
    assert asyncio.run(query("not_connected")) == {lead_three}
    assert asyncio.run(query("not_connected", 1)) == set()
    assert asyncio.run(query("connected", 1)) == {lead_two}
    assert asyncio.run(query("connected", 2)) == {lead_one}
    assert asyncio.run(query(call_number=1)) == {lead_two}
    assert asyncio.run(query(call_number=2)) == {lead_one}
    assert asyncio.run(query(call_number=3)) == {lead_three}


def test_manual_outcomes_update_connected_report_counts(owner, caller):
    suffix = str(int(time.time() * 1000))[-6:]
    created = owner.post(f"{API}/leads", json={
        "name": f"Call outcome report test {suffix}",
        "phone": f"9876{suffix}",
        "source": "manual",
    }, timeout=30)
    assert created.status_code in (200, 201), created.text
    lead_id = created.json()["id"]
    try:
        assigned = owner.post(f"{API}/leads/assign", json={
            "lead_ids": [lead_id], "assignee_id": caller.user["id"],
        }, timeout=30)
        assert assigned.status_code == 200, assigned.text

        today = time.strftime("%Y-%m-%d")
        before_report = owner.get(
            f"{API}/reports/performance?period=custom&from_date={today}&to_date={today}",
            timeout=30,
        ).json()
        before_row = next(item for item in before_report["telecallers"] if item["id"] == caller.user["id"])
        original_status = caller.get(f"{API}/leads/{lead_id}", timeout=30).json()["status"]
        before = caller.get(f"{API}/reports/my-performance?period=today", timeout=30).json()
        not_connected = caller.post(f"{API}/leads/{lead_id}/calls/manual", json={
            "call_outcome": "not_connected", "call_number": 1,
        }, timeout=30)
        assert not_connected.status_code == 200, not_connected.text
        assert not_connected.json()["status"] == original_status
        after_not_connected = caller.get(f"{API}/reports/my-performance?period=today", timeout=30).json()
        assert after_not_connected["not_connected_calls"] == before["not_connected_calls"] + 1

        connected = caller.post(f"{API}/leads/{lead_id}/calls/manual", json={
            "call_outcome": "connected", "call_number": 2, "status": "interested",
        }, timeout=30)
        assert connected.status_code == 200, connected.text
        after_connected = caller.get(f"{API}/reports/my-performance?period=today", timeout=30).json()
        assert after_connected["connected_calls"] == before["connected_calls"] + 1

        repeated_connected = caller.post(f"{API}/leads/{lead_id}/calls/manual", json={
            "call_outcome": "connected", "call_number": 4, "status": "interested",
        }, timeout=30)
        assert repeated_connected.status_code == 200, repeated_connected.text
        db.leads.update_one({"_id": ObjectId(lead_id)}, {"$set": {
            "status": "converted", "updated_at": server.utcnow(),
        }})

        db.call_attempts.insert_one({
            "user_id": ObjectId(caller.user["id"]),
            "lead_id": ObjectId(lead_id),
            "created_at": server.utcnow(),
            "call_number": 3,
            "connected": True,
            "manual_call_outcome": "not_connected",
            "call_outcome": "connected",
        })

        connected_filter = owner.get(f"{API}/leads?call_outcome=connected", timeout=30)
        assert connected_filter.status_code == 200, connected_filter.text
        assert lead_id in {lead["id"] for lead in connected_filter.json()["items"]}
        not_connected_filter = owner.get(f"{API}/leads?call_outcome=not_connected", timeout=30)
        assert not_connected_filter.status_code == 200, not_connected_filter.text
        assert lead_id not in {lead["id"] for lead in not_connected_filter.json()["items"]}
        call_one_not_connected = owner.get(
            f"{API}/leads?call_number=1&call_outcome=not_connected", timeout=30,
        )
        assert call_one_not_connected.status_code == 200, call_one_not_connected.text
        assert lead_id not in {lead["id"] for lead in call_one_not_connected.json()["items"]}
        call_one_connected = owner.get(
            f"{API}/leads?call_number=1&call_outcome=connected", timeout=30,
        )
        assert call_one_connected.status_code == 200, call_one_connected.text
        assert lead_id not in {lead["id"] for lead in call_one_connected.json()["items"]}
        call_two_connected = owner.get(
            f"{API}/leads?call_number=2&call_outcome=connected", timeout=30,
        )
        assert call_two_connected.status_code == 200, call_two_connected.text
        assert lead_id not in {lead["id"] for lead in call_two_connected.json()["items"]}
        call_three_not_connected = owner.get(
            f"{API}/leads?call_number=3&call_outcome=not_connected", timeout=30,
        )
        assert call_three_not_connected.status_code == 200, call_three_not_connected.text
        assert lead_id in {lead["id"] for lead in call_three_not_connected.json()["items"]}

        custom = owner.get(
            f"{API}/reports/performance?period=custom&from_date={today}&to_date={today}",
            timeout=30,
        )
        assert custom.status_code == 200, custom.text
        row = next(item for item in custom.json()["telecallers"] if item["id"] == caller.user["id"])
        assert row["calls_period"] == before_row["calls_period"] + 4
        assert row["connected"] == before_row["connected"] + 2
        assert row["connected_leads"] == before_row.get("connected_leads", 0) + 1
        assert row["connected_calls_period"] == before_row.get("connected_calls_period", 0) + 2
        assert row["converted_period"] == before_row.get("converted_period", 0) + 1
        expected_period_rate = round(
            row["converted_period"] / row["connected_calls_period"] * 100, 1,
        ) if row["connected_calls_period"] else 0.0
        assert row["conversion_rate_period"] == expected_period_rate
        assert row["not_connected"] == before_row["not_connected"] + 2
        my_performance = owner.get(
            f"{API}/reports/my-performance?period=custom&from_date={today}&to_date={today}",
            timeout=30,
        ).json()
        assert my_performance["calls_dialed"] == row["calls_period"]
        assert my_performance["connected_calls"] == row["connected"]
        assert my_performance["not_connected_calls"] == row["not_connected"]
        assert row["total_actions"] == before_row["total_actions"] + 3
        assert row["leads_acted"] == before_row["leads_acted"] + 1
        assert row["status_changes"] >= 1
        assert row["status_actions"]["interested"] >= 1
        assert row["call_attempts"]["1"]["not_connected"] >= 1
        assert row["call_attempts"]["2"]["connected"] >= 1
        assert row["call_attempts"]["2"]["statuses"]["interested"] >= 1

        caller_report = owner.get(
            f"{API}/reports/telecallers/{caller.user['id']}?period=custom&from_date={today}&to_date={today}",
            timeout=30,
        )
        assert caller_report.status_code == 200, caller_report.text
        call_two = next(call for call in caller_report.json()["calls"] if call.get("call_number") == 2)
        assert call_two["post_call_status"] == "interested"
        assert call_two["contact_name"] == f"Call outcome report test {suffix}"

        performance = owner.get(
            f"{API}/reports/telecaller-performance?period=custom&from_date={today}&to_date={today}&telecaller_id={caller.user['id']}",
            timeout=30,
        )
        assert performance.status_code == 200, performance.text
        perf_row = performance.json()["telecallers"][0]
        expected_rate = round(perf_row["conversions"] / perf_row["connected_calls"] * 100, 1) if perf_row["connected_calls"] else 0.0
        assert perf_row["conversion_rate"] == expected_rate
        perf_row = performance.json()["telecallers"][0]
        assert perf_row["call_attempts"]["1"]["not_connected"] >= 1
        assert perf_row["call_attempts"]["2"]["connected"] >= 1
        assert perf_row["status_actions"]["interested"] >= 1

        dashboard = caller.get(
            f"{API}/reports/dashboard?period=custom&from_date={today}&to_date={today}",
            timeout=30,
        )
        assert dashboard.status_code == 200, dashboard.text
        totals = dashboard.json()["totals"]
        assert totals["calls_period"] >= 2
        assert totals["connected_period"] >= 1
        assert totals["not_connected_period"] >= 1
        expected_dashboard_rate = round(
            totals["converted"] / totals["connected_calls"] * 100, 1,
        ) if totals["connected_calls"] else 0.0
        assert totals["conversion_rate"] == expected_dashboard_rate
    finally:
        db.call_attempts.delete_many({"lead_id": ObjectId(lead_id)})
        owner.delete(f"{API}/leads/{lead_id}", timeout=30)


def test_smartflo_timeout_is_recorded_as_call_attempt(monkeypatch):
    class FakeAttempts:
        def __init__(self):
            self.document = None
            self.update = None

        async def insert_one(self, document):
            self.document = document
            return SimpleNamespace(inserted_id="attempt-id")

        async def update_one(self, query, update):
            self.update = update

    class FakeHttpClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            raise httpx.TimeoutException("timeout")

    attempts = FakeAttempts()
    monkeypatch.setattr(server, "db", SimpleNamespace(call_attempts=attempts))
    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **kwargs: FakeHttpClient())
    monkeypatch.setattr(server, "SMARTFLO_API_TOKEN", "test-token")

    with pytest.raises(server.HTTPException) as error:
        asyncio.run(server.click_to_call(
            {"destination_number": "9810012301", "call_mode": "desktop"},
            {"id": "6aab918e0921e97e7e762ac5", "name": "Test Caller", "call_mode": "desktop", "agent_extension": "1024"},
        ))

    assert error.value.status_code == 504
    assert attempts.document["provider_response"] == {"state": "initiated"}
    assert attempts.update["$set"]["status_code"] == 504


def test_preferences_invalid_mode_400(owner):
    r = owner.patch(f"{API}/calls/preferences", json={"call_mode": "fax"}, timeout=30)
    assert r.status_code == 400
    assert "desktop" in r.text.lower() and "phone" in r.text.lower()


def test_preferences_unauth_401():
    r = requests.patch(f"{API}/calls/preferences", json={"call_mode": "desktop"}, timeout=30)
    assert r.status_code == 401


def test_preferences_only_affects_caller(caller, caller2, owner):
    # Snapshot caller2 state
    r0 = owner.get(f"{API}/users", timeout=30)
    users = r0.json()
    c2 = next(u for u in users if u["id"] == caller2.user["id"])
    before_mode = c2.get("call_mode")
    before_ext = c2.get("agent_extension")
    # caller modifies own prefs
    r = caller.patch(f"{API}/calls/preferences",
                     json={"call_mode": "desktop", "agent_extension": "9999"}, timeout=30)
    assert r.status_code == 200
    assert r.json().get("call_mode") == "desktop"
    assert r.json().get("agent_extension") == "9999"
    # caller2 unchanged
    r1 = owner.get(f"{API}/users", timeout=30)
    c2_after = next(u for u in r1.json() if u["id"] == caller2.user["id"])
    assert c2_after.get("call_mode") == before_mode
    assert c2_after.get("agent_extension") == before_ext
    # cleanup caller back to phone
    caller.patch(f"{API}/calls/preferences", json={"call_mode": "phone", "agent_extension": ""}, timeout=30)


# ---------- GET /api/calls/diagnostics ----------

def test_diagnostics_phone_mode(owner):
    owner.patch(f"{API}/users/{owner.user['id']}",
                json={"call_mode": "phone", "agent_number": "9812345678"}, timeout=30)
    r = owner.get(f"{API}/calls/diagnostics", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["call_mode"] == "phone"
    assert d["agent_number_sent_as"] == "919812345678"
    assert d["rings_on"] == "mobile phone 9812345678"
    assert d["softphone_extension_url"] == SOFTPHONE_URL


def test_diagnostics_desktop_with_extension_ready(owner):
    owner.patch(f"{API}/users/{owner.user['id']}",
                json={"call_mode": "desktop", "agent_extension": "1024"}, timeout=30)
    r = owner.get(f"{API}/calls/diagnostics", timeout=30)
    d = r.json()
    assert d["call_mode"] == "desktop"
    assert d["ready"] is True, f"problems={d.get('problems')}"
    assert d["rings_on"] == "Smartflo softphone on this computer (extension 1024)"
    assert d["softphone_extension_url"] == SOFTPHONE_URL


def test_diagnostics_desktop_without_extension_not_ready(owner):
    owner.patch(f"{API}/users/{owner.user['id']}",
                json={"call_mode": "desktop", "agent_extension": ""}, timeout=30)
    r = owner.get(f"{API}/calls/diagnostics", timeout=30)
    d = r.json()
    assert d["ready"] is False
    assert any("extension" in p.lower() for p in d["problems"]), d["problems"]
    # restore to phone
    owner.patch(f"{API}/users/{owner.user['id']}",
                json={"call_mode": "phone", "agent_extension": "", "agent_number": "9812345678"}, timeout=30)


# ---------- click-to-call guards ----------

def test_desktop_no_extension_returns_400(caller):
    # Ensure clean state: desktop mode, no extension
    caller.patch(f"{API}/calls/preferences",
                 json={"call_mode": "desktop", "agent_extension": ""}, timeout=30)
    r = caller.post(f"{API}/calls/click-to-call",
                    json={"destination_number": "9810012301"}, timeout=30)
    assert r.status_code == 400, r.text
    body = r.text.lower()
    assert "extension" in body
    assert "smartflo" in body
    # reset
    caller.patch(f"{API}/calls/preferences", json={"call_mode": "phone"}, timeout=30)


# ---------- LIVE calls: at most ONE desktop + ONE phone ----------

def test_live_desktop_call_sends_extension_as_agent(owner):
    """Set desktop+ext=1024, dial. Tata may reject with 502 - that's OK.
    Assert agent_number in audit == '1024' and call_mode == 'desktop'."""
    pytest.skip("iter6: budget reserved for the two per-request override live calls")
    owner.patch(f"{API}/users/{owner.user['id']}",
                json={"call_mode": "desktop", "agent_extension": "1024"}, timeout=30)
    before = db.call_attempts.count_documents({})
    r = owner.post(f"{API}/calls/click-to-call",
                   json={"destination_number": "9810012301"}, timeout=45)
    assert r.status_code in (200, 502), r.text
    time.sleep(0.5)
    assert db.call_attempts.count_documents({}) > before
    doc = db.call_attempts.find_one(sort=[("created_at", -1)])
    assert doc["agent_number"] == "1024", f"expected raw extension '1024', got {doc['agent_number']}"
    assert doc.get("call_mode") == "desktop"
    assert doc["destination_number"] == "919810012301"


def test_live_phone_call_normalises_and_persists(owner):
    """Regression: phone mode still normalises to 91-prefix."""
    pytest.skip("iter6: budget reserved for the two per-request override live calls")
    owner.patch(f"{API}/users/{owner.user['id']}",
                json={"call_mode": "phone", "agent_number": "9812345678"}, timeout=30)
    before = db.call_attempts.count_documents({})
    r = owner.post(f"{API}/calls/click-to-call",
                   json={"destination_number": "9810012301"}, timeout=45)
    assert r.status_code in (200, 502), r.text
    time.sleep(0.5)
    assert db.call_attempts.count_documents({}) > before
    doc = db.call_attempts.find_one(sort=[("created_at", -1)])
    assert doc["agent_number"] == "919812345678"
    assert doc.get("call_mode") == "phone"


def test_nonnumeric_extension_rejected_at_dial(owner):
    """Iteration 6 fix: '1024a' now returns 400 digits-only and does NOT hit Tata."""
    owner.patch(f"{API}/calls/preferences",
                json={"call_mode": "desktop", "agent_extension": "1024a"}, timeout=30)
    before = db.call_attempts.count_documents({})
    r = owner.post(f"{API}/calls/click-to-call",
                   json={"destination_number": "9810012301"}, timeout=30)
    assert r.status_code == 400, r.text
    body = r.text.lower()
    assert "digits only" in body or "digits" in body
    # no audit row written
    assert db.call_attempts.count_documents({}) == before
    # cleanup
    owner.patch(f"{API}/calls/preferences",
                json={"call_mode": "phone", "agent_extension": ""}, timeout=30)


def test_per_request_override_phone_when_stored_desktop(owner):
    """Stored=desktop+ext=1024; per-request call_mode='phone' must dial phone (91-prefix mobile)."""
    owner.patch(f"{API}/users/{owner.user['id']}",
                json={"call_mode": "desktop", "agent_extension": "1024",
                      "agent_number": "9812345678"}, timeout=30)
    before = db.call_attempts.count_documents({})
    r = owner.post(f"{API}/calls/click-to-call",
                   json={"destination_number": "9810012301", "call_mode": "phone"}, timeout=45)
    assert r.status_code in (200, 502), r.text
    time.sleep(0.5)
    assert db.call_attempts.count_documents({}) > before
    doc = db.call_attempts.find_one(sort=[("created_at", -1)])
    assert doc.get("call_mode") == "phone", doc
    assert doc["agent_number"] == "919812345678", doc


def test_per_request_override_desktop_when_stored_phone(owner):
    """Stored=phone; per-request call_mode='desktop' must dial extension as agent."""
    owner.patch(f"{API}/users/{owner.user['id']}",
                json={"call_mode": "phone", "agent_extension": "1024",
                      "agent_number": "9812345678"}, timeout=30)
    before = db.call_attempts.count_documents({})
    r = owner.post(f"{API}/calls/click-to-call",
                   json={"destination_number": "9810012301", "call_mode": "desktop"}, timeout=45)
    assert r.status_code in (200, 502), r.text
    time.sleep(0.5)
    assert db.call_attempts.count_documents({}) > before
    doc = db.call_attempts.find_one(sort=[("created_at", -1)])
    assert doc.get("call_mode") == "desktop", doc
    assert doc["agent_number"] == "1024", doc


# ---------- Admin management of other users ----------

def test_admin_patches_telecaller_call_fields(subadmin, caller):
    r = subadmin.patch(f"{API}/users/{caller.user['id']}",
                       json={"agent_extension": "2048", "call_mode": "desktop"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("agent_extension") == "2048"
    assert body.get("call_mode") == "desktop"
    # Cleanup
    subadmin.patch(f"{API}/users/{caller.user['id']}",
                   json={"agent_extension": "", "call_mode": "phone"}, timeout=30)


def test_admin_patch_invalid_call_mode(subadmin, caller):
    r = subadmin.patch(f"{API}/users/{caller.user['id']}",
                       json={"call_mode": "bogus"}, timeout=30)
    assert r.status_code == 400


def test_users_list_returns_new_fields(owner):
    r = owner.get(f"{API}/users", timeout=30)
    assert r.status_code == 200
    users = r.json()
    assert users, "no users returned"
    for u in users:
        assert "call_mode" in u
        assert "agent_extension" in u


# ---------- final cleanup ----------

def teardown_module(module):
    try:
        # Reset owner back to phone mode with known agent_number
        s = _session("butbrucewill@gmail.com", "admin123")
        s.patch(f"{API}/users/{s.user['id']}",
                json={"call_mode": "phone", "agent_extension": "", "agent_number": "9812345678"}, timeout=30)
        # Trim call_attempts written during this run
        from datetime import datetime, timedelta, timezone
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
        db.call_attempts.delete_many({"created_at": {"$gte": cutoff}})
    except Exception:
        pass
