"""Iteration 8 — Daily Targets, Live Status, My Performance, CSV Exports, Call Duration."""
import time
from datetime import datetime, timezone, timedelta
import zoneinfo

import pytest
import requests

from conftest import API, client_for
from models import CAPITAL_RANGES, INCOME_BRACKETS


IST = zoneinfo.ZoneInfo("Asia/Kolkata")
QA_CALLER_ID = "6aacf5fd6b9507b9da1ea0f0"


def test_profile_choices_include_zero_income_and_capital():
    assert "0" in INCOME_BRACKETS
    assert "0" in CAPITAL_RANGES


# ---------------- Daily Targets on user CRUD ----------------

def test_create_user_with_targets_and_cleanup(admin):
    payload = {
        "name": "TEST Targets User",
        "email": "test_targets_user@crmtest.com",
        "password": "pass123456",
        "role": "telecaller",
        "daily_call_target": 50,
        "daily_conversion_target": 4,
    }
    r = admin.post(f"{API}/users", json=payload)
    assert r.status_code == 200, r.text
    created = r.json()
    uid = created["id"]
    try:
        assert created["daily_call_target"] == 50
        assert created["daily_conversion_target"] == 4

        # verify persistence via GET /users
        lst = admin.get(f"{API}/users").json()
        row = next((u for u in lst if u["id"] == uid), None)
        assert row is not None
        assert row["daily_call_target"] == 50
        assert row["daily_conversion_target"] == 4

        # Update — including negative → clamp to 0
        upd = admin.patch(f"{API}/users/{uid}",
                          json={"daily_call_target": -5, "daily_conversion_target": 9})
        assert upd.status_code == 200, upd.text
        u = upd.json()
        assert u["daily_call_target"] == 0
        assert u["daily_conversion_target"] == 9
    finally:
        admin.delete(f"{API}/users/{uid}")


def test_telecaller_cannot_manage_users(caller1):
    r = caller1.post(f"{API}/users", json={
        "name": "x", "email": "x@x.com", "password": "pass1234",
        "role": "telecaller", "daily_call_target": 10,
    })
    assert r.status_code in (401, 403)


# ---------------- Performance with targets ----------------

def _find_qa_caller_row(rows):
    return next((r for r in rows if r["id"] == QA_CALLER_ID), None)


def test_performance_today_target_calls(admin):
    r = admin.get(f"{API}/reports/telecaller-performance?period=today")
    assert r.status_code == 200
    row = _find_qa_caller_row(r.json()["telecallers"])
    assert row is not None, "QA caller missing from performance list"
    for k in ("total_talk_time", "daily_call_target", "daily_conversion_target",
              "target_calls", "target_conversions"):
        assert k in row, f"missing {k}"
    # QA caller has daily_call_target=80
    assert row["daily_call_target"] == 80
    assert row["daily_conversion_target"] == 3
    assert row["target_calls"] == 80  # today = 1 day
    assert row["target_conversions"] == 3
    assert isinstance(row["total_talk_time"], int)


def test_performance_week_target_calls(admin):
    r = admin.get(f"{API}/reports/telecaller-performance?period=week")
    assert r.status_code == 200
    row = _find_qa_caller_row(r.json()["telecallers"])
    assert row is not None
    # week = Monday IST 00:00 to now (mid-week). compute expected days.
    now_ist = datetime.now(IST)
    # Monday=0..Sunday=6
    days = now_ist.weekday() + 1
    assert row["target_calls"] == 80 * days, f"expected {80*days}, got {row['target_calls']}"


# ---------------- Live Status ----------------

def test_live_status_manager_returns_shape(admin):
    r = admin.get(f"{API}/reports/live-status")
    assert r.status_code == 200
    data = r.json()
    assert "telecallers" in data and "server_time" in data
    if data["telecallers"]:
        t = data["telecallers"][0]
        for k in ("id", "name", "status", "calls_today", "connected_today",
                 "last_call", "online_since"):
            assert k in t, f"missing {k}"
        assert t["status"] in ("online", "on_call", "idle", "offline")
        # sort order
        rank = {"on_call": 0, "online": 1, "idle": 2, "offline": 3}
        ranks = [rank[t["status"]] for t in data["telecallers"]]
        assert ranks == sorted(ranks)


def test_live_status_forbidden_for_telecaller(caller1):
    r = caller1.get(f"{API}/reports/live-status")
    assert r.status_code == 403


def test_live_status_caller_online_after_heartbeat(admin):
    caller = client_for("caller1")
    hb = caller.post(f"{API}/sessions/heartbeat")
    assert hb.status_code == 200
    time.sleep(1)
    data = admin.get(f"{API}/reports/live-status").json()
    row = next((t for t in data["telecallers"] if t["id"] == caller.user["id"]), None)
    assert row is not None
    assert row["status"] in ("online", "on_call")


# ---------------- my-performance ----------------

def test_my_performance_telecaller(caller1):
    r = caller1.get(f"{API}/reports/my-performance?period=today")
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ("login_time", "logged_in_hours", "calls_dialed",
              "connected_calls", "total_talk_time"):
        assert k in data, f"missing {k}"
    assert data["id"] == caller1.user["id"]


def test_my_performance_manager_returns_own(admin):
    r = admin.get(f"{API}/reports/my-performance?period=today")
    assert r.status_code == 200
    assert r.json()["id"] == admin.user["id"]


# ---------------- Export CSV: performance ----------------

def test_export_performance_csv(admin):
    r = admin.get(f"{API}/reports/telecaller-performance/export?period=week")
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    header = r.text.splitlines()[0]
    for col in ("Telecaller", "Total actions", "Status changes", "Call 1 dialed",
                "Talk time (min)", "Call target", "Conversion target"):
        assert col in header, f"missing column {col} in {header}"


def test_export_performance_forbidden_for_telecaller(caller1):
    r = caller1.get(f"{API}/reports/telecaller-performance/export?period=today")
    assert r.status_code == 403


# ---------------- Export CSV: timeline ----------------

def test_export_timeline_csv(admin):
    r = admin.get(f"{API}/reports/telecaller-performance/{QA_CALLER_ID}/timeline/export?period=today")
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    header = r.text.splitlines()[0]
    for col in ("Time (IST)", "Type", "Title", "Detail", "Status"):
        assert col in header


def test_export_timeline_leader_cross_team_forbidden(leader1, admin):
    # Find a telecaller outside leader's team.
    perf = admin.get(f"{API}/reports/telecaller-performance?period=today").json()
    leader_team = leader1.user.get("team_id")
    other = None
    for t in perf["telecallers"]:
        tl = admin.get(f"{API}/reports/telecaller-performance/{t['id']}/timeline?period=today")
        if tl.status_code != 200:
            continue
        if str(tl.json()["member"].get("team_id")) != str(leader_team):
            other = t["id"]
            break
    if not other:
        pytest.skip("No cross-team telecaller found")
    r = leader1.get(f"{API}/reports/telecaller-performance/{other}/timeline/export?period=today")
    assert r.status_code == 403


# ---------------- Call records include duration ----------------

def test_lead_calls_include_duration_and_connected(admin):
    leads = admin.get(f"{API}/leads?limit=200").json()
    items = leads.get("items", leads) if isinstance(leads, dict) else leads
    checked = 0
    for lead in items:
        lid = lead["id"]
        detail = admin.get(f"{API}/leads/{lid}").json()
        calls = detail.get("calls") or []
        for c in calls:
            assert "duration" in c, f"call missing duration key: {c}"
            assert "connected" in c, f"call missing connected key: {c}"
            checked += 1
            if checked >= 3:
                return
    if checked == 0:
        pytest.skip("No call_attempts to verify duration shape (still passes schema check)")
