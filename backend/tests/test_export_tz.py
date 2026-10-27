from pathlib import Path
"""Iteration 2 tests: CSV export (filters/scope/timestamps) + Asia/Kolkata 'due today' buckets."""
import csv
import io
import os
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

from conftest import API, CREDS, client_for

backend_env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")
IST = ZoneInfo("Asia/Kolkata")

HEADER = ["Name", "Phone", "Email", "Company", "City", "Source", "Status", "Assigned To",
          "Next Follow-up", "Last Action", "Call Notes", "Reassigned", "Escalated", "Created At"]


def rand_phone():
    return "97" + str(uuid.uuid4().int)[:8]


def parse_csv(text):
    rows = list(csv.reader(io.StringIO(text)))
    return rows[0], rows[1:]


def export(session, params=""):
    return session.get(f"{API}/leads/export{params}")


# ---------------------------------------------------------------- CSV export
class TestExportCsv:
    def test_export_headers_and_columns(self, admin):
        r = export(admin)
        assert r.status_code == 200, r.text[:300]
        assert "text/csv" in r.headers.get("content-type", ""), r.headers.get("content-type")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd and "filename=" in cd and ".csv" in cd, cd
        header, rows = parse_csv(r.text)
        assert header == HEADER, header
        assert rows, "export returned no data rows"
        assert all(len(row) == 14 for row in rows)

    @pytest.mark.parametrize("params", ["?status=converted", "?bucket=today", "?bucket=escalated",
                                        "?source=whatsapp", "?bucket=unassigned"])
    def test_export_matches_list_filters(self, admin, params):
        listed = admin.get(f"{API}/leads{params}&limit=1&page=1")
        assert listed.status_code == 200, listed.text[:200]
        total = listed.json()["total"]
        r = export(admin, params)
        assert r.status_code == 200, r.text[:200]
        _, rows = parse_csv(r.text)
        assert len(rows) == total, f"{params}: csv rows={len(rows)} list total={total}"

    def test_export_matches_search_query(self, admin):
        name = f"TEST_EXP {uuid.uuid4().hex[:6]}"
        created = admin.post(f"{API}/leads", json={"name": name, "phone": rand_phone()})
        assert created.status_code == 200, created.text[:200]
        frag = name.split(" ")[1][:4]
        total = admin.get(f"{API}/leads?q={frag}&limit=1").json()["total"]
        _, rows = parse_csv(export(admin, f"?q={frag}").text)
        assert len(rows) == total, (len(rows), total)
        assert any(row[0] == name for row in rows), [r[0] for r in rows]

    def test_export_scope_team_leader(self, leader1, admin):
        r = export(leader1)
        assert r.status_code == 200, r.text[:200]
        _, rows = parse_csv(r.text)
        total = leader1.get(f"{API}/leads?limit=1").json()["total"]
        assert len(rows) == total, (len(rows), total)
        admin_rows = parse_csv(export(admin).text)[1]
        assert len(rows) < len(admin_rows), "leader export is not scoped to their team"
        # every exported phone must be visible to the leader through the list API
        visible = {i["phone"] for i in leader1.get(f"{API}/leads?limit=500").json()["items"]}
        assert {row[1] for row in rows}.issubset(visible)

    def test_export_forbidden_for_telecaller(self, caller1):
        r = export(caller1)
        assert r.status_code == 403, f"{r.status_code} {r.text[:200]}"

    def test_export_unauthenticated(self, anon):
        assert export(anon).status_code == 401

    def test_export_timestamps_in_ist(self, admin):
        name = f"TEST_TZ {uuid.uuid4().hex[:6]}"
        lead = admin.post(f"{API}/leads", json={"name": name, "phone": rand_phone()}).json()
        api_created = admin.get(f"{API}/leads/{lead['id']}").json()["created_at"]
        created_dt = datetime.fromisoformat(api_created)
        if created_dt.tzinfo is None:
            created_dt = created_dt.replace(tzinfo=timezone.utc)
        expected = created_dt.astimezone(IST).strftime("%Y-%m-%d %H:%M")
        _, rows = parse_csv(export(admin, f"?q={name.split(' ')[1][:4]}").text)
        row = next(r for r in rows if r[0] == name)
        assert row[13] == expected, f"csv Created At={row[13]} expected IST={expected}"
        # sanity: IST rendering must differ from UTC rendering by 5h30m
        utc_render = created_dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
        assert row[13] != utc_render or created_dt.utcoffset() == timedelta(hours=5, minutes=30)


# ---------------------------------------------------------------- IST due-today bucket
class TestIndiaTimezoneBuckets:
    """(a) 00:30 IST today and (b) 23:30 IST today must be in bucket=today;
    (c) 00:30 IST tomorrow and (d) 23:30 IST yesterday must not."""

    @pytest.fixture(scope="class")
    def ist_leads(self, admin):
        today = datetime.now(IST).date()
        cases = {
            "a_today_0030": datetime.combine(today, datetime.min.time(), IST) + timedelta(minutes=30),
            "b_today_2330": datetime.combine(today, datetime.min.time(), IST) + timedelta(hours=23, minutes=30),
            "c_tomorrow_0030": datetime.combine(today + timedelta(days=1), datetime.min.time(), IST) + timedelta(minutes=30),
            "d_yesterday_2330": datetime.combine(today - timedelta(days=1), datetime.min.time(), IST) + timedelta(hours=23, minutes=30),
        }
        created = {}
        for key, when in cases.items():
            name = f"TEST_IST {key} {uuid.uuid4().hex[:5]}"
            lead = admin.post(f"{API}/leads", json={"name": name, "phone": rand_phone()})
            assert lead.status_code == 200, lead.text[:200]
            lid = lead.json()["id"]
            patched = admin.patch(f"{API}/leads/{lid}",
                                  json={"next_follow_up_at": when.isoformat()})
            assert patched.status_code == 200, patched.text[:200]
            created[key] = {"id": lid, "name": name, "when": when}
        yield created
        db = MongoClient(MONGO_URL)[DB_NAME]
        for meta in created.values():
            db.leads.delete_one({"name": meta["name"]})

    def test_bucket_today_ist_boundaries(self, admin, ist_leads):
        ids = {i["id"] for i in admin.get(f"{API}/leads?bucket=today&limit=500").json()["items"]}
        assert ist_leads["a_today_0030"]["id"] in ids, "00:30 IST today missing from bucket=today"
        assert ist_leads["b_today_2330"]["id"] in ids, "23:30 IST today missing from bucket=today"
        assert ist_leads["c_tomorrow_0030"]["id"] not in ids, "00:30 IST tomorrow leaked into today"
        assert ist_leads["d_yesterday_2330"]["id"] not in ids, "23:30 IST yesterday leaked into today"

    def test_dashboard_due_today_uses_same_bounds(self, admin, ist_leads):
        bucket_total = admin.get(f"{API}/leads?bucket=today&limit=1").json()["total"]
        due_today = admin.get(f"{API}/reports/dashboard").json()["totals"]["due_today"]
        assert due_today == bucket_total, (due_today, bucket_total)

    def test_export_bucket_today_matches(self, admin, ist_leads):
        total = admin.get(f"{API}/leads?bucket=today&limit=1").json()["total"]
        _, rows = parse_csv(export(admin, "?bucket=today").text)
        assert len(rows) == total, (len(rows), total)
        names = {r[0] for r in rows}
        assert ist_leads["b_today_2330"]["name"] in names


# ---------------------------------------------------------------- iteration_1 fix regression
class TestIteration1Fixes:
    def test_lead_with_call_note_is_not_escalated(self, admin):
        db = MongoClient(MONGO_URL)[DB_NAME]
        caller = client_for("caller1")
        phone = rand_phone()
        lead = admin.post(f"{API}/leads", json={"name": "TEST_Noted2", "phone": phone}).json()
        admin.post(f"{API}/leads/assign", json={"lead_ids": [lead["id"]],
                                                "assignee_id": caller.user["id"]})
        old = datetime.utcnow() - timedelta(hours=13)
        db.leads.update_one({"phone": phone[-10:]},
                            {"$set": {"assigned_at": old, "status": "assigned"}})
        assert caller.post(f"{API}/leads/{lead['id']}/notes",
                           json={"text": "TEST_called, no answer"}).status_code == 200
        admin.post(f"{API}/escalation/run")
        after = admin.get(f"{API}/leads/{lead['id']}").json()
        assert after["escalated"] is False, "lead with a fresh call note was escalated"
        assert after["assigned_to"] == caller.user["id"], "lead with a call note was reassigned"
        db.leads.delete_one({"phone": phone[-10:]})

    def test_brute_force_lockout_by_email(self):
        email = f"test_lock2_{uuid.uuid4().hex[:6]}@crm.com"
        codes = [requests.post(f"{API}/auth/login", json={"email": email, "password": "bad"},
                               timeout=30).status_code for _ in range(7)]
        assert codes[:5] == [401] * 5, codes
        assert codes[5] == 429 and codes[6] == 429, codes

    def test_delete_user_requires_user_manage(self, subadmin, admin):
        email = f"test_del_{uuid.uuid4().hex[:6]}@crm.com"
        u = subadmin.post(f"{API}/users", json={"name": "TEST_Del", "email": email,
                                                "password": "pass123", "role": "telecaller"})
        assert u.status_code == 200, u.text[:200]
        uid = u.json()["id"]
        r = subadmin.delete(f"{API}/users/{uid}")
        assert r.status_code in (200, 204), f"subadmin has user:manage but got {r.status_code}"
        # Soft-deleted users stay stored but are omitted from the users list.
        listed = admin.get(f"{API}/users").json()
        assert all(x["id"] != uid for x in listed), listed
        performance = admin.get(f"{API}/reports/performance").json()
        assert all(x["id"] != uid for x in performance["telecallers"]), performance
        assert admin.get(f"{API}/reports/telecallers/{uid}").status_code == 404
        stored = MongoClient(MONGO_URL)[DB_NAME].users.find_one({"email": email})
        assert stored and stored.get("removed") is True and stored.get("active") is False
        login = requests.post(f"{API}/auth/login", json={"email": email, "password": "pass123"},
                              timeout=30)
        assert login.status_code in (401, 403), login.status_code
        MongoClient(MONGO_URL)[DB_NAME].users.delete_one({"email": email})

    def test_delete_user_forbidden_for_leader(self, leader1, admin):
        target = [u for u in admin.get(f"{API}/users?role=telecaller").json()][0]
        assert leader1.delete(f"{API}/users/{target['id']}").status_code == 403

    def test_cors_explicit_origin_with_credentials(self):
        """The preview edge (cloudflare/ingress) rewrites CORS headers to '*', so the app-level
        config is asserted against the local uvicorn origin."""
        origin = (os.environ.get("REACT_APP_BACKEND_URL") or
                  dotenv_values(Path(__file__).resolve().parent.parent.parent / "frontend" / ".env").get("REACT_APP_BACKEND_URL")).rstrip("/")
        local = "http://localhost:8001/api/auth/login"
        r = requests.options(local, timeout=30, headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        assert r.status_code in (200, 204), r.status_code
        assert r.headers.get("access-control-allow-origin") == origin, dict(r.headers)
        assert r.headers.get("access-control-allow-credentials") == "true", dict(r.headers)
        bad = requests.options(local, timeout=30, headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
        })
        assert bad.headers.get("access-control-allow-origin") != "https://evil.example.com", \
            dict(bad.headers)
