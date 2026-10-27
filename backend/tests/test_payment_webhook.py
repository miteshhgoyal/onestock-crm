import asyncio
import csv
import io
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import HTTPException
from starlette.datastructures import UploadFile

from server import (
    enrich_stored_vip_membership_dates,
    enrich_vip_membership_contacts,
    export_50_cr_club_membership_dates,
    extract_admin_records,
    fetch_vip_market_records,
    filter_verified_vip_records,
    normalize_payment_event,
    normalize_vip_market_record,
    update_50_cr_club_member_profile,
)
from models import ClubMemberProfileUpdate


def test_normalize_payment_event_extracts_user_and_payment_summary():
    event = normalize_payment_event({
        "event_id": "evt_123",
        "type": "payment.succeeded",
        "data": {
            "user": {
                "id": "user_456",
                "first_name": "Riya",
                "last_name": "Shah",
                "phone_number": "+919876543210",
                "email": "riya@example.com",
                "occupation": "Analyst",
                "address": {"line1": "12 Example Road", "postal_code": "110001", "country": "India"},
            },
            "payment": {
                "payment_id": "pay_789",
                "order_id": "ord_456",
                "status": "paid",
                "amount": "5000",
                "currency": "INR",
                "product_name": "Academy annual membership",
                "payment_method": "upi",
                "card_number": "sensitive-test-value",
            },
        },
    })

    assert event["provider_event_id"] == "evt_123"
    assert event["event_type"] == "payment.succeeded"
    assert event["user"]["name"] == "Riya Shah"
    assert event["user"]["phone"] == "+919876543210"
    assert event["user"]["external_id"] == "user_456"
    assert event["user"]["occupation"] == "Analyst"
    assert event["user"]["postal_code"] == "110001"
    assert event["payment"]["payment_id"] == "pay_789"
    assert event["payment"]["product"] == "Academy annual membership"
    assert event["payment"]["method"] == "upi"
    assert event["payment"] == {
        "status": "paid",
        "amount": 5000.0,
        "currency": "INR",
        "payment_id": "pay_789",
        "order_id": "ord_456",
        "product": "Academy annual membership",
        "method": "upi",
        "paid_at": None,
    }
    assert "card_number" not in event["payment"]


def test_normalize_payment_event_extracts_flat_key_value_payload():
    event = normalize_payment_event({
        "event_id": "evt_flat_123",
        "event_type": "Successful Purchase",
        "customer_id": "customer_456",
        "customer_name": "Sam Example",
        "number": "+919876543210",
        "customer_email": "sam@example.com",
        "payment_status": "successful",
        "payment_amount": "7500",
        "currency": "INR",
        "payment_id": "pay_flat_789",
        "product_type": "50 Cr Club",
    })

    assert event["event_type"] == "Successful Purchase"
    assert event["user"]["external_id"] == "customer_456"
    assert event["user"]["name"] == "Sam Example"
    assert event["user"]["phone"] == "+919876543210"
    assert event["user"]["email"] == "sam@example.com"
    assert event["payment"]["status"] == "successful"
    assert event["payment"]["amount"] == 7500.0
    assert event["payment"]["product"] == "50 Cr Club"


def test_extract_admin_records_supports_nested_collection_envelopes():
    records = [{"id": "purchase_1"}, {"id": "purchase_2"}]
    assert extract_admin_records({"data": {"purchases": records}}, "purchases") == records
    assert extract_admin_records({"items": records}, "purchases") == records
    assert extract_admin_records({"results": {"memberships": records}}, "memberships") == records


def test_fetch_vip_market_records_follows_pagination():
    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            pass

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self):
            self.pages = []

        async def get(self, url, headers, params):
            self.pages.append(params["page"])
            return FakeResponse({
                "memberships": [{"id": f"member_{params['page']}_1"}],
                "pagination": {"pages": 3},
            })

    client = FakeClient()
    records, error = asyncio.run(fetch_vip_market_records(client, "memberships"))

    assert error is None
    assert client.pages == [1, 2, 3]
    assert [record["id"] for record in records] == ["member_1_1", "member_2_1", "member_3_1"]

    recent_client = FakeClient()
    recent_records, recent_error = asyncio.run(
        fetch_vip_market_records(recent_client, "memberships", max_pages=1),
    )
    assert recent_error is None
    assert recent_client.pages == [1]
    assert len(recent_records) == 1


def test_normalize_vip_market_membership_for_lead_creation():
    event = normalize_vip_market_record({
        "id": "membership_123",
        "member": {
            "id": "member_456",
            "fullName": "Mira Shah",
            "email": "mira@example.com",
            "phoneNumber": "+919876543210",
            "city": "Mumbai",
        },
        "membership": {"name": "Gold", "status": "active"},
    }, "memberships")

    assert event["provider_event_id"] == "vip-market:memberships:membership_123"
    assert event["source_record_type"] == "memberships"
    assert event["user"]["external_id"] == "member_456"
    assert event["user"]["name"] == "Mira Shah"
    assert event["user"]["phone"] == "+919876543210"
    assert event["user"]["email"] == "mira@example.com"
    assert event["payment"]["status"] == "active"
    assert event["payment"]["product"] == "Gold"


def test_normalize_purchase_buyer_and_enrich_membership_name():
    purchase = normalize_vip_market_record({
        "id": "purchase_123",
        "buyer_name": "Mira Shah",
        "buyer_email": "mira@example.com",
        "buyer_phone": "+919876543210",
        "offering": "50 Cr Club",
        "payment_verified": True,
        "received_at": "2026-10-08T07:53:20.381721+00:00",
    }, "purchases")
    membership = normalize_vip_market_record({
        "id": "membership_123",
        "contact_identifier": "mira@example.com",
        "status": "Joined",
    }, "memberships")

    enrich_vip_membership_contacts([membership], [purchase])

    assert purchase["user"]["name"] == "Mira Shah"
    assert purchase["user"]["phone"] == "+919876543210"
    assert purchase["user"]["email"] == "mira@example.com"
    assert purchase["verified"] is True
    assert purchase["payment"]["paid_at"] == "2026-10-08T07:53:20.381721+00:00"
    assert membership["user"]["name"] == "Mira Shah"
    assert membership["user"]["email"] == "mira@example.com"


def test_refreshed_membership_dates_update_linked_verified_purchase_and_crm_lead(monkeypatch):
    lead_id = ObjectId()
    purchase = {
        "_id": ObjectId(), "lead_id": lead_id,
        "user": {"email": "mira@example.com", "phone": "+919876543210"},
        "club": {"joined_at": "2025-10-26", "expires_at": "2026-10-26"},
        "member_profile": {"expires_at": "2026-10-26"},
    }
    membership = {
        "user": {"email": "mira@example.com", "phone": "+919876543210"},
        "club": {"joined_at": "2025-10-26", "expires_at": "2027-10-26"},
    }

    class Cursor:
        def sort(self, _ordering):
            return self

        async def to_list(self, _limit):
            return [membership]

    class Events:
        update = None

        def find(self, _query):
            return Cursor()

        async def update_one(self, query, update):
            self.update = (query, update)

    class Leads:
        operations = []

        async def bulk_write(self, operations, ordered=False):
            self.operations = operations

    events = Events()
    leads = Leads()
    monkeypatch.setattr("server.db", SimpleNamespace(payment_club_events=events, leads=leads))

    result = asyncio.run(enrich_stored_vip_membership_dates([purchase]))

    assert result[0]["club"]["expires_at"] == "2027-10-26"
    assert result[0]["member_profile"]["expires_at"] == "2027-10-26"
    assert events.update[1]["$set"]["club.expires_at"] == "2027-10-26"
    assert leads.operations[0]._filter == {"_id": lead_id}
    assert leads.operations[0]._doc["$set"]["club_expires_at"] == "2027-10-26"


def test_membership_date_export_uses_verified_matches_without_modifying_input_records(monkeypatch):
    verified = [
        {"_id": ObjectId(), "verified": True, "user": {"name": "Mira Shah", "phone": "919876543210", "email": "mira@example.com"},
         "club": {"joined_at": "2025-10-26", "expires_at": "2027-10-26"}},
        {"_id": ObjectId(), "verified": True, "user": {"name": "Ravi Kumar", "phone": "919811112222", "email": "ravi@example.com"},
         "club": {"joined_at": "2025-05-01", "expires_at": "2026-12-31"}},
    ]

    class Cursor:
        def sort(self, _ordering):
            return self

        async def to_list(self, _limit):
            return verified

    class Events:
        def find(self, query):
            assert query == {"source_record_type": "purchases", "verified": True}
            return Cursor()

    class AsyncClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    async def sync_ok(_client, _record_type):
        return [], None

    async def enrich(_purchases):
        return _purchases

    monkeypatch.setattr("server.db", SimpleNamespace(payment_club_events=Events()))
    monkeypatch.setattr("server.ADMIN_PANEL_KEY", "test-key")
    monkeypatch.setattr("server.httpx.AsyncClient", AsyncClient)
    monkeypatch.setattr("server.sync_vip_market_records", sync_ok)
    monkeypatch.setattr("server.enrich_stored_vip_membership_dates", enrich)

    upload = UploadFile(
        filename="contacts.csv",
        file=io.BytesIO(b"UserName,Phone,Email\nMira Shah,919876543210,mira@example.com\nRavi Kumar,,\nNobody,9000000000,\n"),
    )
    response = asyncio.run(export_50_cr_club_membership_dates(upload, {"role": "admin"}))
    body = asyncio.run(response.body_iterator.__anext__())
    csv_text = body.decode("utf-8") if isinstance(body, bytes) else body
    rows = list(csv.DictReader(io.StringIO(csv_text)))

    assert rows[0]["Club Joined Date"] == "2025-10-26"
    assert rows[0]["Club Expiry Date"] == "2027-10-26"
    assert rows[0]["Club Match Status"] == "Matched by phone/email"
    assert rows[1]["Club Match Status"] == "Matched by unique name"
    assert rows[2]["Club Match Status"] == "No verified Club match"
    assert all(record["verified"] is True for record in verified)


def test_verified_filter_respects_explicit_provider_flag():
    records = [
        {"id": "paid_but_unverified", "status": "Paid", "payment_verified": False},
        {"id": "verified_purchase", "status": "Paid", "payment_verified": True},
    ]

    assert [record["id"] for record in filter_verified_vip_records(records, "purchases")] == ["verified_purchase"]


def test_telecaller_can_update_owned_club_member_profile(monkeypatch):
    class FakeCollection:
        def __init__(self, document):
            self.document = document

        async def find_one(self, query):
            if query.get("_id") != self.document["_id"]:
                return None
            if query.get("source_record_type") and query["source_record_type"] != self.document.get("source_record_type"):
                return None
            if query.get("verified") is not None and query["verified"] != self.document.get("verified"):
                return None
            return self.document

        async def update_one(self, query, update):
            for path, value in update["$set"].items():
                target = self.document
                parts = path.split(".")
                for part in parts[:-1]:
                    target = target.setdefault(part, {})
                target[parts[-1]] = value

    event_id = ObjectId()
    caller_id = ObjectId()
    event = {
        "_id": event_id,
        "source_record_type": "purchases",
        "verified": True,
        "lead_id": ObjectId(),
    }
    fake_db = SimpleNamespace(
        payment_club_events=FakeCollection(event),
        leads=FakeCollection({"_id": event["lead_id"], "assigned_to": caller_id}),
    )
    monkeypatch.setattr("server.db", fake_db)

    updated = asyncio.run(update_50_cr_club_member_profile(
        str(event_id),
        ClubMemberProfileUpdate(broker_name="Zerodha", membership_enabled=True),
        {"role": "telecaller", "id": str(caller_id), "name": "Caller"},
    ))

    assert updated["member_profile"]["broker_name"] == "Zerodha"
    assert updated["member_profile"]["membership_enabled"] is True
    assert updated["member_profile"]["updated_by"] == str(caller_id)


def test_telecaller_cannot_update_another_callers_club_member(monkeypatch):
    class FakeCollection:
        def __init__(self, document):
            self.document = document

        async def find_one(self, query):
            return self.document if query.get("_id") == self.document["_id"] else None

    event_id = ObjectId()
    event = {"_id": event_id, "source_record_type": "purchases", "verified": True, "lead_id": ObjectId()}
    fake_db = SimpleNamespace(
        payment_club_events=FakeCollection(event),
        leads=FakeCollection({"_id": event["lead_id"], "assigned_to": ObjectId()}),
    )
    monkeypatch.setattr("server.db", fake_db)

    with pytest.raises(HTTPException) as error:
        asyncio.run(update_50_cr_club_member_profile(
            str(event_id), ClubMemberProfileUpdate(membership_enabled=False),
            {"role": "telecaller", "id": str(ObjectId()), "name": "Other caller"},
        ))

    assert error.value.status_code == 403