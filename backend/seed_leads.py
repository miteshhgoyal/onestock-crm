"""Adds demo leads (with profile answers) when the leads collection is empty."""
import asyncio
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
IST = ZoneInfo("Asia/Kolkata")

NAMES = [
    ("Aarav Mehta", "9810012301", "Mumbai"), ("Priya Nair", "9810012302", "Pune"),
    ("Rohit Verma", "9810012303", "Delhi"), ("Kavya Reddy", "9810012304", "Hyderabad"),
    ("Imran Sheikh", "9810012305", "Bengaluru"), ("Divya Pillai", "9810012306", "Kochi"),
    ("Arjun Singh", "9810012307", "Jaipur"), ("Neha Kulkarni", "9810012308", "Nagpur"),
    ("Lakshmi Menon", "9810012309", "Chennai"), ("Ishita Shah", "9810012310", "Ahmedabad"),
    ("Tarun Chopra", "9810012311", "Chandigarh"), ("Sana Qureshi", "9810012312", "Lucknow"),
    ("Vikram Rao", "9810012313", "Vizag"), ("Meera Joshi", "9810012314", "Indore"),
]
SOURCES = ["manual", "csv", "website_form", "facebook_ads", "google_ads", "whatsapp"]
OCCUPATIONS = ["businessman", "job", "self_employed", "student", "retired", "homemaker"]
INCOMES = ["below_3l", "3l_5l", "5l_10l", "10l_25l", "25l_50l", "above_50l"]
EXPERIENCE = ["less_1y", "1_3y", "3_5y", "above_5y"]
MARKETS = ["equity", "futures_options", "commodity", "currency", "crypto", "mutual_funds", "ipo"]
STATUSES = ["new_lead", "assigned", "contacted", "follow_up", "interested", "converted"]


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    existing = await db.leads.count_documents({})
    if existing:
        print(f"Leads already present ({existing}); nothing to do")
        client.close()
        return

    callers = await db.users.find({"role": "telecaller", "active": True}).to_list(20)
    now = datetime.now(timezone.utc)
    random.seed(11)
    docs = []

    for index, (name, phone, city) in enumerate(NAMES):
        is_trader = index % 3 != 0
        caller = callers[index % len(callers)] if callers else None
        status = STATUSES[index % len(STATUSES)]
        assigned = caller is not None and status != "new_lead"
        # Spread follow-ups across today (IST), overdue and upcoming.
        if index % 4 == 0:
            follow_up = datetime.now(IST).replace(hour=11, minute=30, second=0,
                                                  microsecond=0).astimezone(timezone.utc)
        elif index % 4 == 1:
            follow_up = now - timedelta(hours=6)
        elif index % 4 == 2:
            follow_up = now + timedelta(days=1, hours=2)
        else:
            follow_up = None

        docs.append({
            "name": name, "phone": phone, "city": city,
            "email": f"{name.split()[0].lower()}@example.com",
            "company": None, "course_id": None, "course_name": None,
            "source": SOURCES[index % len(SOURCES)], "status": status,
            "conversion_status": "approved" if status == "converted" else "none",
            "ticket_size": 25000 if status == "converted" else None,
            "occupation": OCCUPATIONS[index % len(OCCUPATIONS)],
            "annual_income": INCOMES[index % len(INCOMES)],
            "trader_type": "trader" if is_trader else "non_trader",
            "trading_experience": EXPERIENCE[index % len(EXPERIENCE)] if is_trader else None,
            "trading_capital": float(random.choice([50000, 100000, 250000, 500000])) if is_trader else None,
            "markets_traded": random.sample(MARKETS, 2) if is_trader else [],
            "markets_interested": random.sample(MARKETS, 2),
            "tags": [], "notes": [],
            "assigned_to": caller["_id"] if assigned else None,
            "assigned_to_name": caller["name"] if assigned else None,
            "team_id": caller.get("team_id") if assigned else None,
            "assigned_at": now - timedelta(hours=index) if assigned else None,
            "last_action_at": now - timedelta(hours=index),
            "next_follow_up_at": follow_up,
            "escalated": False, "reassign_count": 0, "created_by": None,
            "created_at": now - timedelta(days=index % 7), "updated_at": now - timedelta(hours=index),
        })

    await db.leads.insert_many(docs)
    print(f"Seeded {len(docs)} demo leads")
    client.close()


asyncio.run(main())
