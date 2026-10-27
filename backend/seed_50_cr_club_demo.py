import asyncio
import os
import sys

import httpx
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(__file__))
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

BASE_URL = os.environ.get("CRM_BASE_URL", "http://localhost:8000")
WEBHOOK_TOKEN = os.environ.get("PAYMENT_WEBHOOK_TOKEN")

EVENTS = [
    {
        "event_id": "evt_demo_001",
        "type": "payment.succeeded",
        "data": {
            "user": {
                "id": "demo_user_001",
                "first_name": "Riya",
                "last_name": "Shah",
                "phone_number": "+919876543210",
                "email": "riya.shah@example.com",
                "occupation": "Analyst",
                "address": {"line1": "12 Market Road", "city": "Mumbai", "state": "Maharashtra", "postal_code": "400001", "country": "India"},
            },
            "payment": {
                "payment_id": "pay_demo_001",
                "order_id": "ord_demo_001",
                "status": "paid",
                "amount": "5000",
                "currency": "INR",
                "product_name": "50 Cr Club",
                "payment_method": "upi",
            },
        },
    },
    {
        "event_id": "evt_demo_002",
        "type": "payment.succeeded",
        "data": {
            "user": {
                "id": "demo_user_002",
                "first_name": "Aman",
                "last_name": "Verma",
                "phone_number": "+919900112233",
                "email": "aman.verma@example.com",
                "company": "TCS",
                "city": "Delhi",
                "state": "Delhi",
            },
            "payment": {
                "payment_id": "pay_demo_002",
                "order_id": "ord_demo_002",
                "status": "paid",
                "amount": "7500",
                "currency": "INR",
                "product_name": "50 Cr Club",
                "payment_method": "card",
            },
        },
    },
]


async def main():
    if not WEBHOOK_TOKEN:
        raise SystemExit("PAYMENT_WEBHOOK_TOKEN is missing")

    async with httpx.AsyncClient(timeout=30.0) as client:
        for event in EVENTS:
            response = await client.post(
                f"{BASE_URL}/api/payments/webhooks/50-cr-club",
                json=event,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Token": WEBHOOK_TOKEN,
                },
            )
            print(f"{event['event_id']}: {response.status_code} {response.text[:200]}")


if __name__ == "__main__":
    asyncio.run(main())
