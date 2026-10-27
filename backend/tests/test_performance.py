"""Telecaller Performance Dashboard - iteration 7 tests."""
import asyncio
from datetime import datetime, timezone
import time
from zoneinfo import ZoneInfo

import pytest
import requests

from conftest import API, CREDS, client_for
from models import LeadProfile
from server import (
    EFFICIENCY_DEFAULTS,
    build_lead_query,
    clean_uploaded_phone,
    find_verified_purchase_match,
    normalize_vip_market_record,
    prepare_50_cr_club_conversion,
    club_source_lead_updates,
    score_member_efficiency,
    session_seconds_in_work_window,
)


SMARTFLO_SECRET = "whk_smartflo_5c1e9a7b3d264f80"
TEAM_TZ = ZoneInfo("Asia/Kolkata")


def test_logged_in_hours_only_count_between_nine_am_and_ten_pm_ist():
    day = datetime(2026, 10, 8, tzinfo=TEAM_TZ)
    start = datetime(2026, 10, 8, 4, tzinfo=TEAM_TZ).astimezone(timezone.utc)
    end = datetime(2026, 10, 8, 23, tzinfo=TEAM_TZ).astimezone(timezone.utc)

    assert session_seconds_in_work_window(start, end, start, end) == 13 * 3600
    assert session_seconds_in_work_window(
        datetime(2026, 10, 8, 20, tzinfo=TEAM_TZ).astimezone(timezone.utc),
        datetime(2026, 10, 9, 8, tzinfo=TEAM_TZ).astimezone(timezone.utc),
        start,
        datetime(2026, 10, 9, 8, tzinfo=TEAM_TZ).astimezone(timezone.utc),
    ) == 2 * 3600
    assert session_seconds_in_work_window(
        start,
        end,
        day.replace(hour=8).astimezone(timezone.utc),
        day.replace(hour=14).astimezone(timezone.utc),
    ) == 5 * 3600


# -------------------------- sessions / auth ---------------------------

def test_login_creates_session_and_heartbeat_ok(admin):
    r = admin.post(f"{API}/sessions/heartbeat")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True
    assert "server_time" in data


def test_heartbeat_requires_auth():
    r = requests.post(f"{API}/sessions/heartbeat")
    assert r.status_code == 401


# ------------------------ telecaller performance -----------------------

def test_efficiency_scoring_uses_measured_factors_and_keeps_missing_as_na():
    assert sum(EFFICIENCY_DEFAULTS["weights"].values()) == 100
    row = {
        "logged_in_hours": 4, "session_count": 1,
        "login_times": ["2026-10-17T03:30:00+00:00"],
        "calls_dialed": 20, "connected_calls": 10, "connection_rate": 50,
        "conversion_rate": 50, "connected_leads": 2, "leads_contacted": 2, "leads_assigned_period": 4,
        "interested_leads_period": 2, "calls_with_duration": 2,
        "average_call_duration": 120, "conversions": 1,
        "target_calls": 40, "target_conversions": 2, "period_days": 1,
        "has_activity": True,
    }
    result = score_member_efficiency(row, EFFICIENCY_DEFAULTS)
    factors = {factor["key"]: factor for factor in result["efficiency_factors"]}

    assert len(factors) == 15
    assert result["efficiency_score"] is not None
    assert result["efficiency_valid_weight"] == 80
    assert factors["login_punctuality"]["achievement"] == 100
    assert factors["calls_dialed"]["achievement"] == 50
    assert factors["lead_conversion_rate"]["achievement"] == 100
    assert factors["follow_up_completion"]["achievement"] is None
    assert factors["break_compliance"]["achievement"] is None
    assert factors["crm_data_accuracy"]["achievement"] is None
    assert factors["productive_time"]["achievement"] is None

    no_connected_leads = score_member_efficiency({
        "conversion_rate": 0, "connected_leads": 0, "leads_contacted": 4,
        "period_days": 1, "has_activity": True,
    }, EFFICIENCY_DEFAULTS)
    conversion_factor = next(factor for factor in no_connected_leads["efficiency_factors"] if factor["key"] == "lead_conversion_rate")
    assert conversion_factor["achievement"] is None

    empty = score_member_efficiency({}, EFFICIENCY_DEFAULTS)
    assert empty["efficiency_score"] is None
    assert all(factor["achievement"] is None for factor in empty["efficiency_factors"])

    default_goal = score_member_efficiency({"period_days": 1, "has_activity": True, "conversions": 1}, EFFICIENCY_DEFAULTS)
    conversion_factor = next(factor for factor in default_goal["efficiency_factors"] if factor["key"] == "target_achievement")
    assert conversion_factor["actual"] == pytest.approx(round(100 / 3, 2))
    assert conversion_factor["achievement"] == pytest.approx(round(100 / 3, 1))


def test_club_sheet_phone_normalization_handles_precise_and_rejects_rounded_scientific_values():
    assert clean_uploaded_phone("9.810012301E+09") == "919810012301"
    assert clean_uploaded_phone("8.88E+09") == ""
    assert clean_uploaded_phone("9810012301") == "919810012301"


def test_club_purchase_match_requires_verified_exact_contact():
    lead = {"email": "Member@Example.com", "phone": "+1 (415) 555-0123"}
    purchases = [
        {"source_record_type": "purchases", "verified": False,
         "user": {"email": lead["email"], "phone": lead["phone"]}},
        {"source_record_type": "memberships", "verified": True,
         "user": {"email": lead["email"], "phone": lead["phone"]}},
        {"source_record_type": "purchases", "verified": True,
         "user": {"email": "other@example.com", "phone": "+91 99999 00000"}},
        {"_id": "verified-purchase", "source_record_type": "purchases", "verified": True,
         "payment": {"amount": 50000},
         "user": {"email": "member@example.com", "phone": "4155550123"}},
    ]

    assert find_verified_purchase_match(lead, purchases) == purchases[-1]
    conflicting_purchase = [{
        "source_record_type": "purchases", "verified": True,
        "user": {"email": "member@example.com", "phone": "+91 99999 00000"},
    }]
    assert find_verified_purchase_match(lead, conflicting_purchase) is None


def test_club_profile_preserves_seller_and_broker_details():
    profile = LeadProfile.model_validate({
        "club_seller_type": "seller",
        "club_seller_name": "Amit Sharma",
        "new_broker_name": "Angel One",
        "current_broker_name": "Zerodha",
        "deposit_made": True,
        "deposit_amount": 25000,
        "trading_mode": "both",
    })

    assert profile.club_seller_type == "seller"
    assert profile.club_seller_name == "Amit Sharma"
    assert profile.new_broker_name == "Angel One"
    assert profile.current_broker_name == "Zerodha"
    assert profile.deposit_made is True
    assert profile.deposit_amount == 25000
    assert profile.trading_mode == "both"


def test_normalize_vip_market_record_reads_nested_seller_source():
    record = {
        "verified": True,
        "user": {"name": "Amit Verma", "phone": "+919999999999"},
        "source": {"type": "seller", "ref": "Anjali"},
        "broker": {"new": "Angel One", "current": "Zerodha"},
        "membership": {"joining_date": "2026-10-01", "expiry_date": "2027-10-01"},
        "broker_unique_id": "ACC-98765",
        "deposit": {"made": True, "amount": "25000"},
        "trading": {"mode": "both"},
    }
    normalized = normalize_vip_market_record(record, "purchases")
    assert normalized["club"]["seller_type"] == "seller"
    assert normalized["club"]["seller_name"] == "Anjali"
    assert normalized["club"]["new_broker_name"] == "Angel One"
    assert normalized["club"]["current_broker_name"] == "Zerodha"
    assert normalized["club"]["deposit_made"] is True
    assert normalized["club"]["deposit_amount"] == 25000
    assert normalized["club"]["trading_mode"] == "both"
    assert normalized["club"]["joined_at"] == "2026-10-01"
    assert normalized["club"]["expires_at"] == "2027-10-01"
    assert normalized["club"]["broker_unique_id"] == "ACC-98765"
    source_updates = club_source_lead_updates(normalized)
    assert source_updates["club_joined_at"] == "2026-10-01"
    assert source_updates["club_expires_at"] == "2027-10-01"
    assert source_updates["broker_unique_id"] == "ACC-98765"


@pytest.mark.parametrize("attribution,expected_type,expected_name", [
    ({"affiliate": "Anjali"}, "seller", "Anjali"),
    ({"claim_ref": "Osama"}, "seller", "Osama"),
    ({"ref": "Gaurav"}, "seller", "Gaurav"),
    ({"utm_source": "direct"}, "direct", None),
    ({"source": {"type": "direct"}}, "direct", None),
    ({"source": {"type": "seller"}}, "direct", None),
    ({}, "direct", None),
])
def test_normalize_vip_market_seller_ref_aliases(attribution, expected_type, expected_name):
    normalized = normalize_vip_market_record({"verified": True, **attribution}, "purchases")
    assert normalized["club"]["seller_type"] == expected_type
    assert normalized["club"]["seller_name"] == expected_name


def test_club_lead_filters_are_applied_before_pagination(monkeypatch):
    async def empty_scope(_user):
        return {}

    monkeypatch.setattr("server.lead_scope", empty_scope)
    query = asyncio.run(build_lead_query(
        {"role": "admin"},
        tags="50-cr-club",
        club_seller_type="seller",
        deposit_status="made",
        deposit_min=10000,
        deposit_max=50000,
        broker_account_status="opened",
        trading_mode="both",
        new_broker_name="Angel One",
        current_broker_name="Zerodha",
        broker_name="Zerodha",
        broker_unique_id="ACC-98765",
        q="2026-10-01",
        exclude_club=True,
    ))

    assert query["tags"] == {"$all": ["50-cr-club"]}
    assert query["club_seller_type"] == "seller"
    assert query["club_seller_name"] == {"$nin": [None, ""]}
    assert query["deposit_made"] is True
    assert query["deposit_amount"] == {"$gte": 10000, "$lte": 50000}
    assert query["broker_account_status"] == "opened"
    assert query["trading_mode"] == "both"
    assert query["new_broker_name"]["$regex"] == "Angel\\ One"
    assert query["current_broker_name"]["$regex"] == "Zerodha"
    assert query["broker_name"]["$regex"] == "Zerodha"
    assert query["broker_unique_id"]["$regex"] == "ACC-98765"
    search_fields = query["$and"][-1]["$or"]
    assert {"club_joined_at": {"$regex": "2026-10-01", "$options": "i"}} in search_fields
    assert {"tags": {"$nin": ["50-cr-club"]}} in query["$and"]


def test_club_unworked_bucket_only_selects_assigned_club_leads(monkeypatch):
    async def empty_scope(_user):
        return {}

    monkeypatch.setattr("server.lead_scope", empty_scope)
    query = asyncio.run(build_lead_query({"role": "telecaller"}, bucket="club_unworked"))
    assert query["status"] == "assigned"
    assert query["tags"] == {"$all": ["50-cr-club"]}


def test_club_conversion_auto_approval_only_after_verified_source_result(monkeypatch):
    verified_purchase = {"_id": "verified-purchase", "payment": {"amount": 50000}}

    async def matched(_lead):
        return verified_purchase, False

    async def direct(_lead):
        return None, True

    async def unavailable(_lead):
        return None, False

    actor = {"role": "telecaller", "is_50_cr_club_rm": True}
    now = datetime(2026, 10, 17, tzinfo=timezone.utc)
    monkeypatch.setattr("server.resolve_verified_purchase_for_conversion", matched)
    updates, purchase = asyncio.run(prepare_50_cr_club_conversion({"_id": "lead"}, actor, now))
    assert updates["conversion_status"] == "approved"
    assert updates["conversion_source"] == "50_cr_club"
    assert updates["conversion_auto_approved"] is True
    assert updates["ticket_size"] == 50000
    assert purchase == verified_purchase

    monkeypatch.setattr("server.resolve_verified_purchase_for_conversion", direct)
    updates, purchase = asyncio.run(prepare_50_cr_club_conversion({"_id": "lead"}, actor, now))
    assert updates == {"conversion_source": "direct"}
    assert purchase is None

    monkeypatch.setattr("server.resolve_verified_purchase_for_conversion", unavailable)
    updates, purchase = asyncio.run(prepare_50_cr_club_conversion({"_id": "lead"}, actor, now))
    assert updates == {}
    assert purchase is None


def test_performance_admin_today(admin):
    r = admin.get(f"{API}/reports/telecaller-performance?period=today")
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ("period", "from", "to", "telecallers"):
        assert k in data
    assert data["period"] == "today"
    assert isinstance(data["telecallers"], list)
    if data["telecallers"]:
        t = data["telecallers"][0]
        for k in ("id", "name", "status", "logged_in_hours", "calls_dialed",
                 "connected_calls", "connection_rate", "conversions",
                  "conversion_rate", "connected_leads", "leads_contacted", "follow_ups_completed",
                 "follow_ups_pending", "last_call"):
            assert k in t, f"missing {k}"
        expected_rate = round(t["conversions"] / t["connected_calls"] * 100, 1) if t["connected_calls"] else 0.0
        assert t["conversion_rate"] == expected_rate


def test_performance_team_leader_access(leader1):
    r = leader1.get(f"{API}/reports/telecaller-performance?period=today")
    assert r.status_code == 200


def test_performance_forbidden_for_telecaller(caller1):
    r = caller1.get(f"{API}/reports/telecaller-performance?period=today")
    assert r.status_code == 403


def test_performance_periods(admin):
    for p in ("today", "week", "month"):
        r = admin.get(f"{API}/reports/telecaller-performance?period={p}")
        assert r.status_code == 200, f"{p}: {r.text}"


def test_performance_custom_dates(admin):
    r = admin.get(f"{API}/reports/telecaller-performance?period=custom&from_date=2026-01-01&to_date=2026-01-07")
    assert r.status_code == 200


def test_performance_custom_bad_date(admin):
    r = admin.get(f"{API}/reports/telecaller-performance?period=custom&from_date=not-a-date")
    assert r.status_code == 400


def test_live_status_online_after_login(admin):
    """After caller logs in and heartbeats, their status should be online."""
    caller = client_for("caller1")
    caller.post(f"{API}/sessions/heartbeat")
    time.sleep(1)
    r = admin.get(f"{API}/reports/telecaller-performance",
                  params={"period": "today", "telecaller_id": caller.user["id"]})
    assert r.status_code == 200
    rows = r.json()["telecallers"]
    assert len(rows) == 1
    assert rows[0]["status"] in ("online", "on_call")


def test_live_status_offline_after_logout(admin):
    caller = client_for("caller1")
    # logout
    lo = requests.post(f"{API}/auth/logout",
                       headers={"Authorization": caller.headers["Authorization"]})
    assert lo.status_code == 200
    r = admin.get(f"{API}/reports/telecaller-performance",
                  params={"period": "today", "telecaller_id": caller.user["id"]})
    assert r.status_code == 200
    assert r.json()["telecallers"][0]["status"] == "offline"


# ------------------------------ trend ---------------------------------

def test_performance_trend_week(admin):
    r = admin.get(f"{API}/reports/telecaller-performance/trend?period=week")
    assert r.status_code == 200
    data = r.json()
    assert "series" in data
    assert len(data["series"]) == 7
    for b in data["series"]:
        for k in ("date", "calls", "connected", "not_connected", "conversions", "status_changes", "logged_in_hours"):
            assert k in b


# ------------------------------ timeline ------------------------------

def test_timeline_admin(admin):
    perf = admin.get(f"{API}/reports/telecaller-performance?period=today").json()
    if not perf["telecallers"]:
        pytest.skip("No telecallers to test timeline")
    tid = perf["telecallers"][0]["id"]
    r = admin.get(f"{API}/reports/telecaller-performance/{tid}/timeline?period=today")
    assert r.status_code == 200
    data = r.json()
    assert "member" in data and "events" in data
    times = [e.get("time") for e in data["events"] if e.get("time")]
    assert times == sorted(times, reverse=True)


def test_timeline_forbidden_for_telecaller(caller1):
    caller = client_for("caller1")
    r = caller.get(f"{API}/reports/telecaller-performance/{caller.user['id']}/timeline?period=today")
    assert r.status_code == 403


def test_timeline_leader_cross_team_forbidden(leader1, admin):
    """Team leader cannot open a timeline for a telecaller outside their team."""
    perf = admin.get(f"{API}/reports/telecaller-performance?period=today").json()
    leader_team = leader1.user.get("team_id")
    other = None
    for t in perf["telecallers"]:
        u = admin.get(f"{API}/reports/telecaller-performance/{t['id']}/timeline?period=today")
        if u.status_code != 200:
            continue
        member = u.json()["member"]
        if str(member.get("team_id")) != str(leader_team):
            other = t["id"]
            break
    if not other:
        pytest.skip("No cross-team telecaller found")
    r = leader1.get(f"{API}/reports/telecaller-performance/{other}/timeline?period=today")
    assert r.status_code == 403


# ------------------------------ smartflo webhook -----------------------

def test_webhook_wrong_secret():
    r = requests.post(f"{API}/calls/smartflo-webhook?secret=wrong",
                      json={"call_id": "x", "call_status": "answered"})
    assert r.status_code == 401


def test_webhook_missing_secret():
    r = requests.post(f"{API}/calls/smartflo-webhook",
                      json={"call_id": "x", "call_status": "answered"})
    assert r.status_code == 401


def test_webhook_unknown_call_returns_unmatched():
    r = requests.post(
        f"{API}/calls/smartflo-webhook?secret={SMARTFLO_SECRET}",
        json={"call_id": "unknown-id-xyz-123", "call_status": "answered", "call_duration": "47"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True
    assert data.get("matched") is False
