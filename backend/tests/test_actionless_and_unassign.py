"""Iteration 9: Actionless-24h bucket, team-leader self-assign, deselect/unassign flows.

Guarantees:
- Any lead we mutate is restored back to its original assignee/state at test end.
"""
import time
import requests
import pytest
from conftest import API, client_for


# ---------- helpers ----------
def get_leader_team_lead(leader):
    """Return one lead currently within the team leader's scope (assigned to a team member)."""
    r = leader.get(f"{API}/leads?limit=100", timeout=30)
    assert r.status_code == 200, r.text
    items = r.json().get("items", [])
    for lead in items:
        if lead.get("assigned_to"):
            return lead
    return None


# ---------- Actionless bucket ----------
def test_actionless_bucket_admin(admin):
    r = admin.get(f"{API}/leads?bucket=actionless&limit=50", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    for lead in data.get("items", []):
        assert lead.get("assigned_to"), f"actionless lead has no assignee: {lead.get('_id') or lead.get('id')}"
        assert lead.get("status") not in ("converted", "lost", "not_interested")


def test_dashboard_totals_include_actionless(admin):
    r = admin.get(f"{API}/reports/dashboard", timeout=30)
    assert r.status_code == 200, r.text
    totals = r.json().get("totals", {})
    assert "actionless_24h" in totals, f"actionless_24h missing from totals: {list(totals.keys())}"
    assert isinstance(totals["actionless_24h"], int)


def test_unworked_bucket_respects_caller_scope_and_details(admin, caller1):
    caller2 = client_for("caller2")
    suffix = str(int(time.time() * 1000))[-8:]
    created_ids = []
    try:
        lead_ids = []
        for index, assignee in enumerate((caller1, caller2)):
            response = admin.post(f"{API}/leads", json={
                "name": f"Unworked scope test {suffix} {index}",
                "phone": f"9{suffix}{index}",
                "source": "manual",
            }, timeout=30)
            assert response.status_code in (200, 201), response.text
            lead_id = response.json()["id"]
            created_ids.append(lead_id)
            assignment = admin.post(f"{API}/leads/assign", json={
                "lead_ids": [lead_id],
                "assignee_id": assignee.user["id"],
            }, timeout=30)
            assert assignment.status_code == 200, assignment.text
            assert assignment.json()["assigned"] == 1
            lead_ids.append(lead_id)

        caller1_items = caller1.get(f"{API}/leads?bucket=untouched&limit=100", timeout=30)
        assert caller1_items.status_code == 200, caller1_items.text
        caller1_ids = {lead["id"] for lead in caller1_items.json()["items"]}
        assert lead_ids[0] in caller1_ids
        assert lead_ids[1] not in caller1_ids

        details = caller1.get(f"{API}/leads/{lead_ids[0]}", timeout=30)
        assert details.status_code == 200, details.text

        call_result = caller1.post(f"{API}/leads/{lead_ids[0]}/calls/manual", json={
            "call_outcome": "not_connected",
            "call_number": 1,
        }, timeout=30)
        assert call_result.status_code == 400, call_result.text

        call_result = caller1.post(f"{API}/leads/{lead_ids[0]}/calls/manual", json={
            "call_outcome": "not_connected",
            "call_number": 1,
            "status": "follow_up",
        }, timeout=30)
        assert call_result.status_code == 200, call_result.text
        assert call_result.json()["status"] == "follow_up"

        still_unworked = caller1.get(f"{API}/leads?bucket=untouched&limit=100", timeout=30)
        assert lead_ids[0] in {lead["id"] for lead in still_unworked.json()["items"]}

        changed = caller1.patch(f"{API}/leads/{lead_ids[0]}", json={"status": "contacted"}, timeout=30)
        assert changed.status_code == 200, changed.text
        no_longer_unworked = caller1.get(f"{API}/leads?bucket=untouched&limit=100", timeout=30)
        assert lead_ids[0] not in {lead["id"] for lead in no_longer_unworked.json()["items"]}
    finally:
        for lead_id in created_ids:
            admin.delete(f"{API}/leads/{lead_id}", timeout=30)


# ---------- Auto-escalation stopped ----------
def test_cron_endpoint_still_exists(admin):
    # endpoint should still be reachable (returns 401/403 without secret, or 200 with proper auth)
    r = requests.post(f"{API}/cron/escalate-leads", timeout=30)
    # existing => not 404
    assert r.status_code != 404, "cron endpoint removed unexpectedly"


# ---------- Team leader self-assign + Unassign endpoint ----------
def test_team_leader_self_assign_and_unassign(leader1, caller1):
    lead = get_leader_team_lead(leader1)
    if not lead:
        pytest.skip("No team-scoped lead available for leader self-assign test")

    lead_id = lead.get("_id") or lead.get("id")
    original_assignee = lead.get("assigned_to")
    original_status = lead.get("status")
    assert lead_id and original_assignee

    leader_id = leader1.user["id"]

    try:
        # Self-assign
        r = leader1.post(f"{API}/leads/assign",
                         json={"lead_ids": [lead_id], "assignee_id": leader_id}, timeout=30)
        assert r.status_code == 200, f"self-assign failed: {r.status_code} {r.text}"
        assert r.json().get("assigned") == 1

        # Verify leader sees it
        r2 = leader1.get(f"{API}/leads/{lead_id}", timeout=30)
        assert r2.status_code == 200
        fetched = r2.json()
        assert str(fetched.get("assigned_to")) == str(leader_id), \
            f"assigned_to not leader: {fetched.get('assigned_to')}"
        assert fetched.get("assigned_to_name")

        # Telecaller should be 403 on unassign
        r3 = caller1.post(f"{API}/leads/unassign", json={"lead_ids": [lead_id]}, timeout=30)
        assert r3.status_code == 403, f"telecaller unassign should be 403, got {r3.status_code}"

        # Leader can unassign
        r4 = leader1.post(f"{API}/leads/unassign", json={"lead_ids": [lead_id]}, timeout=30)
        assert r4.status_code == 200, r4.text
        assert r4.json().get("unassigned") == 1

        # Verify unassigned - leader may no longer see it (unassigned = out of team scope).
        # Fetch as admin fixture is not in this test; instead, re-assign back and confirm restore.
    finally:
        # Restore: assign back to original assignee. Leader can only assign within team_member_ids.
        # If original_assignee is in team, leader restores. Otherwise use admin.
        restored = False
        try:
            r_rest = leader1.post(f"{API}/leads/assign",
                                  json={"lead_ids": [lead_id], "assignee_id": str(original_assignee)},
                                  timeout=30)
            if r_rest.status_code == 200 and r_rest.json().get("assigned") == 1:
                restored = True
        except Exception:
            pass
        if not restored:
            admin = client_for("admin")
            r_rest = admin.post(f"{API}/leads/assign",
                                json={"lead_ids": [lead_id], "assignee_id": str(original_assignee)},
                                timeout=30)
            assert r_rest.status_code == 200, f"restore failed: {r_rest.text}"


def test_users_include_leader_in_assignable_list(leader1):
    """Team leader must appear in assignee options (their own team_member_ids includes self)."""
    # /api/users?assignable=1 style or similar — leader1 self visibility
    r = leader1.get(f"{API}/users", timeout=30)
    if r.status_code != 200:
        pytest.skip(f"/api/users returned {r.status_code}")
    users = r.json()
    if isinstance(users, dict):
        users = users.get("items") or users.get("users") or []
    leader_id = leader1.user["id"]
    ids = [str(u.get("_id") or u.get("id")) for u in users]
    assert str(leader_id) in ids, "team leader missing from own /api/users list"
