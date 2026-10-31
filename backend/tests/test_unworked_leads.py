import pytest
import asyncio
from datetime import datetime, timezone
from bson import ObjectId

from models import (
    UNWORKED_STATUSES,
    LEAD_STATUSES,
    is_lead_worked,
    is_lead_unworked,
    ManualCallOutcomeUpdate,
)
from server import RealtimeBroadcaster, build_lead_query, db


# 1. Tests for the "Worked" / "Unworked" definition rule
def test_worked_definition_statuses():
    # Unworked statuses: new_lead, assigned (with no call outcome)
    assert is_lead_unworked({"status": "new_lead"}) is True
    assert is_lead_worked({"status": "new_lead"}) is False

    assert is_lead_unworked({"status": "assigned"}) is True
    assert is_lead_worked({"status": "assigned"}) is False

    # Statuses that must count as WORKED:
    worked_statuses = [
        "not_connected",
        "not_picked_up",
        "follow_up",
        "interested",
        "not_interested",
        "converted",
        "lost",
        "contacted",
    ]
    for status in worked_statuses:
        lead = {"status": status}
        assert is_lead_worked(lead) is True, f"Expected {status} to be worked"
        assert is_lead_unworked(lead) is False, f"Expected {status} not to be unworked"


def test_worked_definition_with_call_outcome():
    # If status is left as "assigned", but a call outcome is saved, it counts as WORKED!
    assigned_with_outcome = {"status": "assigned", "last_call_outcome": "not_connected"}
    assert is_lead_worked(assigned_with_outcome) is True
    assert is_lead_unworked(assigned_with_outcome) is False

    assigned_with_call_list = {
        "status": "assigned",
        "calls": [{"call_number": 1, "call_outcome": "not_connected"}],
    }
    assert is_lead_worked(assigned_with_call_list) is True
    assert is_lead_unworked(assigned_with_call_list) is False

    assigned_with_no_outcome = {
        "status": "assigned",
        "calls": [{"call_number": 1, "call_outcome": None}],
    }
    assert is_lead_worked(assigned_with_no_outcome) is False
    assert is_lead_unworked(assigned_with_no_outcome) is True


def test_manual_call_outcome_model_allows_not_connected():
    # Validates that not_connected and not_picked_up are accepted in post-call update
    payload = ManualCallOutcomeUpdate(
        call_outcome="not_connected",
        call_number=1,
        status="not_connected",
    )
    assert payload.call_outcome == "not_connected"
    assert payload.status == "not_connected"


# 2. Tests for RealtimeBroadcaster scoping and delivery
def test_realtime_broadcaster_scoping():
    async def _run():
        broadcaster = RealtimeBroadcaster()

        telecaller_1_id = str(ObjectId())
        telecaller_2_id = str(ObjectId())
        admin_id = str(ObjectId())

        q_caller_1 = await broadcaster.connect(telecaller_1_id, "telecaller")
        q_caller_2 = await broadcaster.connect(telecaller_2_id, "telecaller")
        q_admin = await broadcaster.connect(admin_id, "admin")

        lead_doc = {
            "_id": ObjectId(),
            "name": "Test Lead",
            "status": "not_connected",
            "assigned_to": ObjectId(telecaller_1_id),
        }

        await broadcaster.broadcast_lead_event(
            "lead:updated",
            lead_doc,
            origin_id="test_origin_123",
        )

        # Telecaller 1 (assigned) should receive the event
        assert not q_caller_1.empty()
        msg_1 = q_caller_1.get_nowait()
        assert "lead:updated" in msg_1
        assert "not_connected" in msg_1
        assert "test_origin_123" in msg_1

        # Admin should receive the event
        assert not q_admin.empty()
        msg_admin = q_admin.get_nowait()
        assert "lead:updated" in msg_admin

        # Telecaller 2 (NOT assigned) MUST NOT receive the event (No data leak!)
        assert q_caller_2.empty()

        # Disconnect cleanup
        await broadcaster.disconnect(telecaller_1_id, q_caller_1)
        await broadcaster.disconnect(telecaller_2_id, q_caller_2)
        await broadcaster.disconnect(admin_id, q_admin)

    asyncio.run(_run())


# 3. Test build_lead_query for untouched bucket
def test_untouched_lead_query():
    async def _run():
        user = {"id": str(ObjectId()), "role": "telecaller", "name": "Caller"}
        query = await build_lead_query(user, bucket="untouched")

        # Untouched query must require assigned_to not None
        assert {"assigned_to": {"$ne": None}} in query.get("$and", [])
        # Must restrict status to UNWORKED_STATUSES (new_lead, assigned)
        assert query.get("status") == {"$in": list(UNWORKED_STATUSES)}
        # Must exclude leads with last_call_outcome
        assert {"$or": [{"last_call_outcome": None}, {"last_call_outcome": {"$exists": False}}]} in query.get("$and", [])

    asyncio.run(_run())
