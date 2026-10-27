import asyncio
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

from auth import hash_password
from models import Lead, Team, User, utcnow

USERS = [
    ("Priya Nair", "subadmin@crm.com", "subadmin", None),
    ("Rahul Menon", "leader1@crm.com", "team_leader", "Alpha Team"),
    ("Sneha Rao", "leader2@crm.com", "team_leader", "Beta Team"),
    ("Amit Kumar", "caller1@crm.com", "telecaller", "Alpha Team"),
    ("Neha Sharma", "caller2@crm.com", "telecaller", "Alpha Team"),
    ("Vikram Iyer", "caller3@crm.com", "telecaller", "Beta Team"),
]

LEADS = [
    ("Arjun Desai", "9810012301", "website_form", "new_lead"),
    ("Meera Joshi", "9810012302", "facebook_ads", "new_lead"),
    ("Sanjay Gupta", "9810012303", "google_ads", "new_lead"),
    ("Kavya Reddy", "9810012304", "whatsapp", "contacted"),
    ("Rohit Verma", "9810012305", "csv", "follow_up"),
    ("Divya Pillai", "9810012306", "manual", "interested"),
    ("Karan Malhotra", "9810012307", "website_form", "converted"),
    ("Ananya Bose", "9810012308", "other", "not_interested"),
    ("Farhan Ali", "9810012309", "csv", "lost"),
    ("Ishita Shah", "9810012310", "manual", "assigned"),
    ("Tarun Chopra", "9810012311", "facebook_ads", "assigned"),
    ("Lakshmi Menon", "9810012312", "whatsapp", "follow_up"),
]


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    teams = {}
    for name in ("Alpha Team", "Beta Team"):
        existing = await db.teams.find_one({"name": name})
        if existing:
            teams[name] = existing["_id"]
        else:
            doc = Team(name=name).to_mongo()
            doc["created_at"] = utcnow()
            teams[name] = (await db.teams.insert_one(doc)).inserted_id

    user_ids = {}
    for name, email, role, team in USERS:
        existing = await db.users.find_one({"email": email})
        team_id = teams.get(team) if team else None
        if existing:
            await db.users.update_one({"_id": existing["_id"]}, {"$set": {
                "password_hash": hash_password("pass123"), "role": role,
                "team_id": team_id, "active": True, "name": name}})
            user_ids[email] = existing["_id"]
            continue
        doc = User(name=name, email=email, role=role,
                   password_hash=hash_password("pass123")).to_mongo()
        doc["team_id"] = team_id
        doc["created_at"] = utcnow()
        user_ids[email] = (await db.users.insert_one(doc)).inserted_id

    for name, leader_email in (("Alpha Team", "leader1@crm.com"), ("Beta Team", "leader2@crm.com")):
        await db.teams.update_one({"_id": teams[name]},
                                 {"$set": {"leader_id": user_ids[leader_email]}})

    callers = [("caller1@crm.com", "Amit Kumar", "Alpha Team"),
               ("caller2@crm.com", "Neha Sharma", "Alpha Team"),
               ("caller3@crm.com", "Vikram Iyer", "Beta Team")]
    now = utcnow()
    for i, (lname, phone, source, status) in enumerate(LEADS):
        if await db.leads.find_one({"phone": phone}):
            continue
        doc = Lead(name=lname, phone=phone, source=source, status=status,
                   email=f"{lname.split()[0].lower()}@example.com", city="Mumbai").to_mongo()
        doc.update({"created_by": None, "created_at": now - timedelta(days=i % 5),
                    "updated_at": now - timedelta(hours=i), "last_action_at": now - timedelta(hours=i)})
        if status != "new_lead":
            email, cname, team = callers[i % 3]
            doc["assigned_to"] = user_ids[email]
            doc["assigned_to_name"] = cname
            doc["team_id"] = teams[team]
            doc["assigned_at"] = now - timedelta(hours=13 if status == "assigned" else 2)
            if status in ("follow_up", "interested", "contacted"):
                doc["notes"] = [{"text": "Spoke to the lead, wants a callback.",
                                 "author_id": str(user_ids[email]), "author_name": cname,
                                 "created_at": now - timedelta(hours=2)}]
                doc["next_follow_up_at"] = now + timedelta(hours=(i % 5) - 2)
        await db.leads.insert_one(doc)

    print("Seeded", await db.users.count_documents({}), "users and",
          await db.leads.count_documents({}), "leads")


asyncio.run(main())
