from pathlib import Path
"""Backend API tests for Small Team CRM."""
import io
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

from conftest import API, CREDS, CRON_SECRET, INTAKE_KEY, client_for

backend_env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")


def mongo_db():
    return MongoClient(MONGO_URL)[DB_NAME]


def rand_phone():
    return "97" + str(uuid.uuid4().int)[:8]


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    """Cleanup only when explicitly asked (xdist workers finish at different times, so an
    automatic per-worker cleanup would delete rows another worker is still using)."""
    yield
    if os.environ.get("CRM_TEST_CLEANUP") != "1":
        return
    db = mongo_db()
    db.leads.delete_many({"name": {"$regex": "^TEST_"}})
    db.users.delete_many({"email": {"$regex": "^test_"}})
    db.teams.delete_many({"name": {"$regex": "^TEST_"}})


# ---------------------------------------------------------------- auth
class TestAuth:
    def test_login_all_roles(self):
        for key, (email, password) in CREDS.items():
            r = requests.post(f"{API}/auth/login", json={"email": email, "password": password},
                              timeout=30)
            assert r.status_code == 200, f"{key}: {r.status_code} {r.text[:200]}"
            data = r.json()
            assert data["user"]["email"] == email
            assert isinstance(data["access_token"], str) and len(data["access_token"]) > 20
            assert "password_hash" not in data["user"]
            assert "_id" not in data["user"] and "id" in data["user"]

    def test_login_sets_httponly_cookies(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": CREDS["admin"][0], "password": CREDS["admin"][1]},
                          timeout=30)
        assert r.status_code == 200
        raw = r.headers.get("set-cookie", "") or ""
        assert "access_token" in raw and "refresh_token" in raw, raw
        assert raw.lower().count("httponly") >= 2, raw

    def test_bcrypt_hash_format(self):
        db = mongo_db()
        user = db.users.find_one({"email": CREDS["admin"][0]})
        assert user is not None
        assert user["password_hash"].startswith("$2b$"), user["password_hash"][:10]

    def test_wrong_password_401(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": CREDS["admin"][0], "password": "wrong-pass"}, timeout=30)
        assert r.status_code == 401
        assert "detail" in r.json()
        # successful login must clear the failed-attempt counter
        r2 = requests.post(f"{API}/auth/login",
                           json={"email": CREDS["admin"][0], "password": CREDS["admin"][1]},
                           timeout=30)
        assert r2.status_code == 200

    def test_unauthenticated_401(self, anon):
        for path in ("/auth/me", "/leads", "/users", "/reports/dashboard"):
            assert anon.get(f"{API}{path}").status_code == 401, path

    def test_invalid_token_401(self):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer garbage.token.x"},
                         timeout=30)
        assert r.status_code == 401

    def test_me_returns_profile(self, admin):
        r = admin.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_brute_force_lockout(self):
        email = f"test_lock_{uuid.uuid4().hex[:6]}@crm.com"
        codes = []
        for _ in range(15):
            r = requests.post(f"{API}/auth/login", json={"email": email, "password": "bad"},
                              timeout=30)
            codes.append(r.status_code)
        # NOTE: identifier is "<client-ip>:<email>"; behind the k8s ingress the client IP rotates
        # across proxy pods, so the counter is partitioned and the lock needs >5 attempts.
        assert 429 in codes, f"no lockout after 15 failed attempts: {codes}"
        assert codes[:5] == [401] * 5, codes
        assert codes[5] == 429, f"lock did not engage on the 6th attempt: {codes}"


# ---------------------------------------------------------------- RBAC telecaller
class TestRBACTelecaller:
    def test_only_own_leads(self, caller1):
        r = caller1.get(f"{API}/leads?limit=200")
        assert r.status_code == 200
        items = r.json()["items"]
        uid = caller1.user["id"]
        assert items, "telecaller has no assigned leads (seed issue)"
        assert all(i["assigned_to"] == uid for i in items), \
            [i["assigned_to"] for i in items if i["assigned_to"] != uid]

    @pytest.mark.parametrize("path", ["/users", "/activities", "/reports/performance", "/teams"])
    def test_forbidden_reads(self, caller1, path):
        assert caller1.get(f"{API}{path}").status_code == 403, path

    def test_cannot_assign(self, caller1):
        r = caller1.post(f"{API}/leads/assign",
                         json={"lead_ids": [], "assignee_id": caller1.user["id"]})
        assert r.status_code == 403
        r2 = caller1.post(f"{API}/leads/auto-assign", json={"limit": 1})
        assert r2.status_code == 403

    def test_cannot_create_lead_or_user(self, caller1):
        r = caller1.post(f"{API}/leads", json={"name": "TEST_x", "phone": rand_phone()})
        assert r.status_code == 403
        r2 = caller1.post(f"{API}/users", json={"name": "TEST_u", "email": "test_u@crm.com",
                                               "password": "pass123", "role": "telecaller"})
        assert r2.status_code == 403

    def test_can_add_note_and_status_on_own_lead(self, caller1):
        lead = caller1.get(f"{API}/leads?limit=1").json()["items"][0]
        follow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        r = caller1.post(f"{API}/leads/{lead['id']}/notes",
                         json={"text": "TEST_note from pytest", "status": "contacted",
                               "next_follow_up_at": follow})
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["status"] == "contacted"
        assert any(n["text"] == "TEST_note from pytest" for n in body["notes"])
        got = caller1.get(f"{API}/leads/{lead['id']}").json()
        assert got["status"] == "contacted"
        assert got["next_follow_up_at"] is not None
        assert got["escalated"] is False

    def test_cannot_see_others_lead(self, caller1, admin):
        others = [i for i in admin.get(f"{API}/leads?limit=200").json()["items"]
                  if i["assigned_to"] != caller1.user["id"]]
        assert others, "no lead owned by someone else to test with"
        r = caller1.get(f"{API}/leads/{others[0]['id']}")
        assert r.status_code == 404


# ---------------------------------------------------------------- RBAC team leader
class TestRBACTeamLeader:
    def test_scoped_leads(self, leader1):
        r = leader1.get(f"{API}/leads?limit=200")
        assert r.status_code == 200
        team_id = leader1.user.get("team_id")
        members = {u["id"] for u in leader1.get(f"{API}/users").json()}
        for lead in r.json()["items"]:
            assert lead.get("team_id") == team_id or lead.get("assigned_to") in members, lead

    def test_reassign_within_team(self, leader1, admin):
        caller2 = client_for("caller2")
        lead = leader1.get(f"{API}/leads?limit=1").json()["items"][0]
        r = leader1.post(f"{API}/leads/assign",
                         json={"lead_ids": [lead["id"]], "assignee_id": caller2.user["id"]})
        assert r.status_code == 200, r.text[:300]
        assert r.json()["assigned"] == 1
        after = admin.get(f"{API}/leads/{lead['id']}").json()
        assert after["assigned_to"] == caller2.user["id"]
        assert after["assigned_to_name"] == caller2.user["name"]

    def test_cannot_assign_outside_team(self, leader1):
        caller3 = client_for("caller3")
        lead = leader1.get(f"{API}/leads?limit=1").json()["items"][0]
        r = leader1.post(f"{API}/leads/assign",
                         json={"lead_ids": [lead["id"]], "assignee_id": caller3.user["id"]})
        assert r.status_code == 403, r.text[:300]

    def test_cannot_create_user_or_autoassign(self, leader1):
        r = leader1.post(f"{API}/users", json={"name": "TEST_tl", "email": "test_tl@crm.com",
                                              "password": "pass123", "role": "telecaller"})
        assert r.status_code == 403
        assert leader1.post(f"{API}/leads/auto-assign", json={"limit": 1}).status_code == 403

    def test_team_scoped_reports_and_users(self, leader1, admin):
        perf = leader1.get(f"{API}/reports/performance")
        assert perf.status_code == 200
        body = perf.json()
        assert len(body["teams"]) <= 1, body["teams"]
        admin_perf = admin.get(f"{API}/reports/performance").json()
        assert len(body["telecallers"]) <= len(admin_perf["telecallers"])
        users = leader1.get(f"{API}/users").json()
        assert users and all(u.get("team_id") == leader1.user.get("team_id") or
                             u["id"] == leader1.user["id"] for u in users)
        dash = leader1.get(f"{API}/reports/dashboard").json()
        admin_dash = admin.get(f"{API}/reports/dashboard").json()
        assert dash["totals"]["total"] < admin_dash["totals"]["total"], (dash, admin_dash)


# ---------------------------------------------------------------- RBAC subadmin
class TestRBACSubadmin:
    created = []

    def test_create_telecaller_and_leader(self, subadmin):
        for role in ("telecaller", "team_leader"):
            email = f"test_{role}_{uuid.uuid4().hex[:6]}@crm.com"
            r = subadmin.post(f"{API}/users", json={"name": f"TEST_{role}", "email": email,
                                                   "password": "pass123", "role": role})
            assert r.status_code == 200, r.text[:300]
            body = r.json()
            assert body["role"] == role and body["email"] == email
            assert "password_hash" not in body
            self.created.append(body["id"])
            listed = subadmin.get(f"{API}/users").json()
            assert any(u["id"] == body["id"] for u in listed)

    @pytest.mark.parametrize("role", ["admin", "subadmin"])
    def test_cannot_create_role_at_or_above_own(self, subadmin, role):
        r = subadmin.post(f"{API}/users",
                          json={"name": f"TEST_{role}", "email": f"test_bad_{role}@crm.com",
                                "password": "pass123", "role": role})
        assert r.status_code == 403, r.text[:300]

    def test_duplicate_email_rejected(self, subadmin):
        r = subadmin.post(f"{API}/users", json={"name": "TEST_dup", "email": CREDS["caller1"][0],
                                                "password": "pass123", "role": "telecaller"})
        assert r.status_code == 400

    def test_invalid_role_rejected(self, subadmin):
        r = subadmin.post(f"{API}/users", json={"name": "TEST_bad", "email": "test_bad@crm.com",
                                                "password": "pass123", "role": "wizard"})
        assert r.status_code in (400, 403), r.status_code


# ---------------------------------------------------------------- leads CRUD
class TestLeads:
    def test_create_and_duplicate(self, admin):
        phone = rand_phone()
        payload = {"name": "TEST_Lead One", "phone": phone, "email": "test_lead1@x.com",
                   "source": "manual", "city": "Pune"}
        r = admin.post(f"{API}/leads", json=payload)
        assert r.status_code == 200, r.text[:300]
        lead = r.json()
        assert lead["name"] == payload["name"]
        assert lead["phone"] == "91" + phone[-10:]
        assert lead["status"] == "new_lead"
        assert lead["assigned_to"] is None
        got = admin.get(f"{API}/leads/{lead['id']}")
        assert got.status_code == 200
        assert got.json()["email"] == payload["email"]
        assert any(a["action"] == "lead_created" for a in got.json()["activities"])
        dup = admin.post(f"{API}/leads", json={"name": "TEST_Lead Dup", "phone": phone})
        assert dup.status_code == 409, dup.status_code

    def test_duplicate_by_last_10_digits(self, admin):
        phone = rand_phone()
        assert admin.post(f"{API}/leads", json={"name": "TEST_norm", "phone": phone}).status_code == 200
        dup = admin.post(f"{API}/leads", json={"name": "TEST_norm2", "phone": "+91" + phone})
        assert dup.status_code == 409

    def test_invalid_phone_400(self, admin):
        r = admin.post(f"{API}/leads", json={"name": "TEST_bad", "phone": "abcd"})
        assert r.status_code == 400

    def test_patch_status_and_invalid_status(self, admin):
        lead = admin.post(f"{API}/leads", json={"name": "TEST_patch", "phone": rand_phone()}).json()
        r = admin.patch(f"{API}/leads/{lead['id']}", json={"status": "interested",
                                                           "city": "Delhi"})
        assert r.status_code == 200, r.text[:200]
        assert r.json()["status"] == "interested"
        assert admin.get(f"{API}/leads/{lead['id']}").json()["city"] == "Delhi"
        bad = admin.patch(f"{API}/leads/{lead['id']}", json={"status": "nope"})
        assert bad.status_code == 400

    def test_manual_assign_and_filters(self, admin):
        lead = admin.post(f"{API}/leads", json={"name": "TEST_assign", "phone": rand_phone(),
                                                "source": "website_form"}).json()
        callers = [u for u in admin.get(f"{API}/users?role=telecaller").json() if u["active"]]
        assert callers
        r = admin.post(f"{API}/leads/assign", json={"lead_ids": [lead["id"]],
                                                    "assignee_id": callers[0]["id"]})
        assert r.status_code == 200 and r.json()["assigned"] == 1
        after = admin.get(f"{API}/leads/{lead['id']}").json()
        assert after["status"] == "assigned"
        assert after["assigned_to"] == callers[0]["id"]
        assert after["assigned_at"] is not None
        # filters
        by_source = admin.get(f"{API}/leads?source=website_form&limit=200").json()
        assert all(i["source"] == "website_form" for i in by_source["items"])
        by_assignee = admin.get(f"{API}/leads?assigned_to={callers[0]['id']}&limit=200").json()
        assert any(i["id"] == lead["id"] for i in by_assignee["items"])
        search = admin.get(f"{API}/leads?q=TEST_assign").json()
        assert any(i["id"] == lead["id"] for i in search["items"])
        unassigned = admin.get(f"{API}/leads?bucket=unassigned&limit=200").json()
        assert all(i["assigned_to"] is None for i in unassigned["items"])

    def test_assign_invalid_assignee(self, admin):
        lead = admin.post(f"{API}/leads", json={"name": "TEST_badassign",
                                                "phone": rand_phone()}).json()
        r = admin.post(f"{API}/leads/assign",
                       json={"lead_ids": [lead["id"]], "assignee_id": "507f1f77bcf86cd799439011"})
        assert r.status_code == 404

    def test_buckets_and_pagination(self, admin):
        for bucket in ("today", "overdue", "escalated", "inactive", "unassigned"):
            r = admin.get(f"{API}/leads?bucket={bucket}&limit=200")
            assert r.status_code == 200, f"{bucket}: {r.text[:200]}"
            assert isinstance(r.json()["items"], list)
        page = admin.get(f"{API}/leads?page=1&limit=2").json()
        assert len(page["items"]) <= 2 and page["total"] >= len(page["items"])

    def test_meta(self, admin):
        m = admin.get(f"{API}/meta").json()
        assert "new_lead" in m["statuses"] and m["escalation_hours"] == 12


# ---------------------------------------------------------------- CSV import
class TestCsvImport:
    def test_import_preserves_country_codes(self, admin):
        indian_phone = rand_phone()
        international_phone = rand_phone()
        csv_body = (
            "name,phone\n"
            f"TEST_India code,+91{indian_phone}\n"
            f"TEST_Foreign code,+44{international_phone}\n"
        )
        files = {"file": ("country-codes.csv", io.BytesIO(csv_body.encode()), "text/csv")}
        response = requests.post(f"{API}/leads/import", files=files,
                                 headers={"Authorization": admin.headers["Authorization"]}, timeout=60)
        assert response.status_code == 200, response.text[:300]
        assert response.json() == {"created": 2, "duplicates": 0, "invalid": 0}
        indian = admin.get(f"{API}/leads?q=TEST_India code").json()["items"]
        foreign = admin.get(f"{API}/leads?q=TEST_Foreign code").json()["items"]
        assert indian and indian[0]["phone"] == "91" + indian_phone[-10:]
        assert foreign and foreign[0]["phone"] == "44" + international_phone

    def test_import_phone_only_csv_and_update_details(self, admin):
        phone = rand_phone()
        files = {"file": ("numbers.csv", io.BytesIO(f"phone\n{phone}\n".encode()), "text/csv")}
        response = requests.post(f"{API}/leads/import", files=files,
                                 headers={"Authorization": admin.headers["Authorization"]}, timeout=60)
        assert response.status_code == 200, response.text[:300]
        assert response.json() == {"created": 1, "duplicates": 0, "invalid": 0}
        lead = admin.get(f"{API}/leads?q={phone}").json()["items"][0]
        assert lead["name"] == f"Lead {phone}"
        updated = admin.patch(f"{API}/leads/{lead['id']}", json={
            "name": "TEST_Number only lead", "email": "number-only@example.com", "company": "TEST Co", "city": "Pune"
        })
        assert updated.status_code == 200, updated.text[:300]
        saved = admin.get(f"{API}/leads/{lead['id']}").json()
        assert (saved["name"], saved["email"], saved["company"], saved["city"]) == (
            "TEST_Number only lead", "number-only@example.com", "TEST Co", "Pune"
        )

    def test_import_counts(self, admin):
        new_phone = rand_phone()
        csv_body = (
            "name,phone,email,source\n"
            f"TEST_CSV New,{new_phone},test_csv@x.com,csv\n"
            "TEST_CSV Dup,9810012301,dup@x.com,csv\n"
            "TEST_CSV NoPhone,,nophone@x.com,csv\n"
        )
        files = {"file": ("leads.csv", io.BytesIO(csv_body.encode()), "text/csv")}
        r = requests.post(f"{API}/leads/import", files=files,
                          headers={"Authorization": admin.headers["Authorization"]}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body == {"created": 1, "duplicates": 1, "invalid": 1}, body
        found = admin.get(f"{API}/leads?q=TEST_CSV New").json()["items"]
        assert found and found[0]["phone"] == "91" + new_phone[-10:]
        assert found[0]["source"] == "csv"

    def test_import_forbidden_for_telecaller(self, caller1):
        files = {"file": ("x.csv", io.BytesIO(b"name,phone\nTEST_x,9999999999\n"), "text/csv")}
        r = requests.post(f"{API}/leads/import", files=files,
                          headers={"Authorization": caller1.headers["Authorization"]}, timeout=30)
        assert r.status_code == 403


# ---------------------------------------------------------------- public intake
class TestIntake:
    def test_intake_creates_lead(self, admin):
        phone = rand_phone()
        r = requests.post(f"{API}/intake/lead", json={"name": "TEST_Intake", "phone": phone,
                                                      "source": "website_form"},
                          headers={"X-Intake-Key": INTAKE_KEY}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["status"] == "created"
        lead_id = r.json()["lead_id"]
        got = admin.get(f"{API}/leads/{lead_id}").json()
        assert got["source"] == "website_form" and got["assigned_to"] is None
        # duplicate
        dup = requests.post(f"{API}/intake/lead", json={"name": "TEST_Intake2", "phone": phone},
                            headers={"X-Intake-Key": INTAKE_KEY}, timeout=30)
        assert dup.status_code == 200 and dup.json()["status"] == "duplicate"
        assert dup.json()["lead_id"] == lead_id

    def test_intake_bad_key(self):
        for headers in ({"X-Intake-Key": "wrong"}, {}):
            r = requests.post(f"{API}/intake/lead",
                              json={"name": "TEST_bad", "phone": rand_phone()},
                              headers=headers, timeout=30)
            assert r.status_code == 401, (headers, r.status_code)

    def test_intake_invalid_phone(self):
        r = requests.post(f"{API}/intake/lead", json={"name": "TEST_np", "phone": "xyz"},
                          headers={"X-Intake-Key": INTAKE_KEY}, timeout=30)
        assert r.status_code == 400


# ---------------------------------------------------------------- auto assign
class TestAutoAssign:
    def test_round_robin_distribution(self, admin):
        ids = []
        for i in range(6):
            lead = admin.post(f"{API}/leads", json={"name": f"TEST_RR {i}",
                                                    "phone": rand_phone()}).json()
            ids.append(lead["id"])
        r = admin.post(f"{API}/leads/auto-assign", json={"lead_ids": ids})
        assert r.status_code == 200, r.text[:300]
        assert r.json()["assigned"] == 6
        assignees = []
        for lid in ids:
            lead = admin.get(f"{API}/leads/{lid}").json()
            assert lead["status"] == "assigned", lead["status"]
            assert lead["assigned_to"] is not None
            assignees.append(lead["assigned_to"])
        assert len(set(assignees)) > 1, f"round robin gave all leads to one caller: {assignees}"


# ---------------------------------------------------------------- escalation
class TestEscalation:
    def test_escalation_reassigns_stale_lead(self, admin):
        db = mongo_db()
        callers = [u for u in admin.get(f"{API}/users?role=telecaller").json() if u["active"]]
        assert len(callers) >= 2
        phone = rand_phone()
        lead = admin.post(f"{API}/leads", json={"name": "TEST_Stale", "phone": phone}).json()
        admin.post(f"{API}/leads/assign", json={"lead_ids": [lead["id"]],
                                                "assignee_id": callers[0]["id"]})
        old = datetime.utcnow() - timedelta(hours=13)
        db.leads.update_one({"phone": phone[-10:]},
                            {"$set": {"assigned_at": old, "last_action_at": old,
                                      "status": "assigned", "escalated": False}})
        r = admin.post(f"{API}/escalation/run")
        assert r.status_code == 200, r.text[:300]
        assert r.json()["reassigned"] >= 1, r.json()
        after = admin.get(f"{API}/leads/{lead['id']}").json()
        assert after["escalated"] is True, after
        assert after["assigned_to"] != callers[0]["id"], "not reassigned to a different telecaller"
        assert after["reassign_count"] >= 1
        acts = admin.get(f"{API}/activities?lead_id={lead['id']}").json()
        actions = [a["action"] for a in acts]
        assert "lead_escalated" in actions and "lead_reassigned" in actions, actions
        esc = admin.get(f"{API}/leads?bucket=escalated&limit=200").json()["items"]
        assert any(i["id"] == lead["id"] for i in esc)

    def test_recent_lead_not_escalated(self, admin):
        callers = [u for u in admin.get(f"{API}/users?role=telecaller").json() if u["active"]]
        lead = admin.post(f"{API}/leads", json={"name": "TEST_Fresh",
                                                "phone": rand_phone()}).json()
        admin.post(f"{API}/leads/assign", json={"lead_ids": [lead["id"]],
                                                "assignee_id": callers[0]["id"]})
        admin.post(f"{API}/escalation/run")
        after = admin.get(f"{API}/leads/{lead['id']}").json()
        assert after["escalated"] is False
        assert after["assigned_to"] == callers[0]["id"]

    def test_lead_with_call_note_is_not_escalated(self, admin):
        """Spec: 'no status update AND no call note = no action'. A lead where the telecaller
        logged a call note (but left the status on 'assigned') must NOT be escalated."""
        db = mongo_db()
        caller = client_for("caller1")
        phone = rand_phone()
        lead = admin.post(f"{API}/leads", json={"name": "TEST_Noted", "phone": phone}).json()
        admin.post(f"{API}/leads/assign", json={"lead_ids": [lead["id"]],
                                                "assignee_id": caller.user["id"]})
        old = datetime.utcnow() - timedelta(hours=13)
        db.leads.update_one({"phone": phone[-10:]},
                            {"$set": {"assigned_at": old, "status": "assigned"}})
        r = caller.post(f"{API}/leads/{lead['id']}/notes", json={"text": "TEST_called, no answer"})
        assert r.status_code == 200, r.text[:200]
        admin.post(f"{API}/escalation/run")
        after = admin.get(f"{API}/leads/{lead['id']}").json()
        assert after["escalated"] is False, "lead with a fresh call note was escalated"
        assert after["assigned_to"] == caller.user["id"], "lead with a call note was reassigned"

    def test_escalation_forbidden_for_leader_and_caller(self, leader1, caller1):
        assert leader1.post(f"{API}/escalation/run").status_code == 403
        assert caller1.post(f"{API}/escalation/run").status_code == 403

    def test_cron_endpoint(self):
        r = requests.post(f"{API}/cron/escalate-leads", timeout=30)
        assert r.status_code == 401
        r2 = requests.post(f"{API}/cron/escalate-leads",
                           headers={"Authorization": "Bearer wrong"}, timeout=30)
        assert r2.status_code == 401
        r3 = requests.post(f"{API}/cron/escalate-leads",
                           headers={"Authorization": f"Bearer {CRON_SECRET}"}, timeout=30)
        assert r3.status_code == 200 and r3.json() == {"accepted": True}


# ---------------------------------------------------------------- reports & activities
class TestReports:
    def test_dashboard(self, admin):
        r = admin.get(f"{API}/reports/dashboard")
        assert r.status_code == 200
        body = r.json()
        t = body["totals"]
        for key in ("total", "converted", "conversion_rate", "unassigned", "escalated",
                    "due_today", "overdue", "new_today"):
            assert key in t, key
        assert t["total"] > 0
        assert sum(s["count"] for s in body["by_status"]) == t["total"]
        assert sum(s["count"] for s in body["by_source"]) == t["total"]

    def test_performance(self, admin):
        r = admin.get(f"{API}/reports/performance")
        assert r.status_code == 200
        body = r.json()
        assert body["telecallers"], body
        row = body["telecallers"][0]
        for key in ("id", "name", "total", "converted", "notes", "escalated", "reassigned",
                    "overdue", "conversion_rate"):
            assert key in row, key
        assert isinstance(body["teams"], list) and body["teams"]

    def test_activities_list(self, admin):
        r = admin.get(f"{API}/activities?limit=200")
        assert r.status_code == 200
        acts = r.json()
        assert acts
        assert all("_id" not in a and "id" in a for a in acts)
        actions = {a["action"] for a in acts}
        for expected in ("lead_created", "lead_assigned", "call_note_added"):
            assert expected in actions, f"{expected} missing from {sorted(actions)}"

    def test_teams_crud(self, admin):
        name = f"TEST_Team {uuid.uuid4().hex[:5]}"
        r = admin.post(f"{API}/teams", json={"name": name})
        assert r.status_code == 200, r.text[:200]
        team = r.json()
        assert team["name"] == name
        teams = admin.get(f"{API}/teams").json()
        found = [t for t in teams if t["id"] == team["id"]]
        assert found and "members" in found[0]
        upd = admin.patch(f"{API}/teams/{team['id']}", json={"name": name + " R"})
        assert upd.status_code == 200 and upd.json()["name"] == name + " R"

    def test_user_toggle_and_team_assign(self, admin):
        email = f"test_toggle_{uuid.uuid4().hex[:6]}@crm.com"
        u = admin.post(f"{API}/users", json={"name": "TEST_Toggle", "email": email,
                                             "password": "pass123", "role": "telecaller"}).json()
        r = admin.patch(f"{API}/users/{u['id']}", json={"active": False})
        assert r.status_code == 200 and r.json()["active"] is False
        # disabled user cannot log in
        login = requests.post(f"{API}/auth/login", json={"email": email, "password": "pass123"},
                              timeout=30)
        assert login.status_code in (401, 403), login.status_code
        teams = admin.get(f"{API}/teams").json()
        r2 = admin.patch(f"{API}/users/{u['id']}", json={"active": True,
                                                          "team_id": teams[0]["id"]})
        assert r2.status_code == 200 and r2.json()["team_id"] == teams[0]["id"]

    def test_subadmin_cannot_modify_admin(self, subadmin, admin):
        admins = [u for u in admin.get(f"{API}/users?role=admin").json()]
        assert admins
        r = subadmin.patch(f"{API}/users/{admins[0]['id']}", json={"name": "TEST_hack"})
        assert r.status_code == 403
