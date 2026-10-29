import calendar
import csv
import io
import tempfile
import zipfile
import logging
import math
import os
import asyncio
import hmac
import hashlib
import json
import re
import httpx
from datetime import datetime, time as datetime_time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import List, Optional
from zoneinfo import ZoneInfo
from urllib.parse import quote

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from bson import ObjectId, json_util  # noqa: E402
from pymongo import UpdateOne  # noqa: E402
from fastapi import (APIRouter, BackgroundTasks, Depends, FastAPI, File, Form, Header,  # noqa: E402
                     HTTPException, Query, Request, Response, UploadFile)
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402
from starlette.responses import StreamingResponse, FileResponse  # noqa: E402
from starlette.background import BackgroundTask  # noqa: E402

from auth import (create_access_token, create_refresh_token, decode_token,  # noqa: E402
                  extract_token, hash_password, oid, require_perm,
                  set_auth_cookies, verify_password, ROLE_RANK, has_perm)
from models import (Activity, AssignRequest, AutoAssignRequest, BulkLeadDeleteRequest, CallOutcomeUpdate, CallPreferences, ClubBrokerListUpdate, ClubPurchaseStatusUpdate, Course, CourseCreate, CourseUpdate, IntakeLead,  # noqa: E402
                    LEAD_SOURCES, LEAD_STATUSES, Lead, LeadCreate, LeadUpdate, LeadSourceCreate, PaymentClubLeadCreate,
                    PaymentClubBulkLeadCreate, PaymentClubPurchaseAssign, ClubMemberProfileUpdate,
                    LoginRequest, ManualCallOutcomeUpdate, Note, NoteCreate, PublicUser, ROLES, Team,
                    TeamCreate, User, UserCreate, UserUpdate, CrmActivity, Document,
                    CrmActivityCreate, CrmActivityUpdate, ConversionApproval, ChatMessage,
                    ChatMessageCreate, CAPITAL_RANGES, INCOME_BRACKETS, MARKETS, OCCUPATIONS, TRADER_TYPES,
                    TRADING_EXPERIENCE, utcnow)
from storage import delete_object, get_object, init_storage, put_object  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("crm")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Onestock Academy CRM")
api = APIRouter(prefix="/api")

ESCALATION_HOURS = 12
TEAM_TZ = ZoneInfo(os.environ.get("TEAM_TIMEZONE", "Asia/Kolkata"))
SESSION_WORK_START = datetime_time(9, 0)
SESSION_WORK_END = datetime_time(22, 0)
SMARTFLO_API_TOKEN = os.environ.get("SMARTFLO_API_TOKEN")
SMARTFLO_CALLER_ID = os.environ.get("SMARTFLO_CALLER_ID")
SMARTFLO_WEBHOOK_SECRET = os.environ.get("SMARTFLO_WEBHOOK_SECRET")
PAYMENT_WEBHOOK_TOKEN = os.environ.get("PAYMENT_WEBHOOK_TOKEN")
ADMIN_PANEL_KEY = os.environ.get("ADMIN_PANEL_KEY")
VIP_MARKET_ADMIN_URL = os.environ.get(
    "VIP_MARKET_ADMIN_URL", "",
).rstrip("/")
VIP_MARKET_TIMEOUT_SECONDS = float(os.environ.get("VIP_MARKET_TIMEOUT_SECONDS", "600"))
ONLINE_WINDOW = timedelta(minutes=5)
ON_CALL_WINDOW = timedelta(minutes=2)
IDLE_AFTER = timedelta(minutes=2)
STATUS_TEXT = {"online": "Online", "on_call": "On Call", "idle": "Idle", "offline": "Offline"}
SMARTFLO_BASE_URL = os.environ.get("SMARTFLO_BASE_URL", "https://api-smartflo.tatateleservices.com")
CALL_MODES = ("desktop", "phone")
SOFTPHONE_EXTENSION_URL = "https://chromewebstore.google.com/detail/smartflo-softphone/dbhcchccbhpnohpmcallfdfcfnogdfpo"
MAX_DOCUMENT_SIZE = 15 * 1024 * 1024
DOCUMENT_TYPES = {"application/pdf", "text/plain", "image/png", "image/jpeg",
                  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


def local_day_bounds():
    """Start/end of *today* in the team's timezone, expressed in UTC."""
    now_local = datetime.now(TEAM_TZ)
    start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    end = now_local.replace(hour=23, minute=59, second=59, microsecond=999999)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def local_period_bounds(period: str):
    now_local = datetime.now(TEAM_TZ)
    start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "week":
        start -= timedelta(days=start.weekday())
    elif period == "month":
        start = start.replace(day=1)
    end = now_local + timedelta(microseconds=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def perf_bounds(period: str, from_date: Optional[str] = None, to_date: Optional[str] = None):
    if period == "custom" and (from_date or to_date):
        try:
            start = (datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=TEAM_TZ)
                     if from_date else datetime.now(TEAM_TZ).replace(hour=0, minute=0, second=0, microsecond=0))
            end = ((datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=TEAM_TZ)
                   if to_date else datetime.now(TEAM_TZ) + timedelta(microseconds=1))
        except ValueError:
            raise HTTPException(status_code=400, detail="Dates must use YYYY-MM-DD format")
        return start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    if period == "today":
        return local_day_bounds()
    if period in ("week", "month"):
        return local_period_bounds(period)
    return local_day_bounds()


def aware(value):
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def session_workday_start(value):
    local_value = aware(value).astimezone(TEAM_TZ)
    start = datetime.combine(local_value.date(), SESSION_WORK_START, tzinfo=TEAM_TZ)
    return start.astimezone(timezone.utc)


def session_workday_end(value):
    local_value = aware(value).astimezone(TEAM_TZ)
    end = datetime.combine(local_value.date(), SESSION_WORK_END, tzinfo=TEAM_TZ)
    return end.astimezone(timezone.utc)


def next_ist_midnight(value):
    local = aware(value).astimezone(TEAM_TZ)
    nxt = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return nxt.astimezone(timezone.utc)


def session_seconds_in_work_window(session_start, session_end, range_start, range_end) -> float:
    start = max(aware(session_start), aware(range_start))
    end = min(aware(session_end), aware(range_end))
    if end <= start:
        return 0

    total_seconds = 0
    cursor = start
    while cursor < end:
        local_cursor = cursor.astimezone(TEAM_TZ)
        local_midnight = local_cursor.replace(hour=0, minute=0, second=0, microsecond=0)
        work_start = local_midnight.replace(hour=SESSION_WORK_START.hour).astimezone(timezone.utc)
        work_end = local_midnight.replace(hour=SESSION_WORK_END.hour).astimezone(timezone.utc)
        overlap_start = max(cursor, work_start)
        overlap_end = min(end, work_end)
        if overlap_end > overlap_start:
            total_seconds += (overlap_end - overlap_start).total_seconds()
        cursor = min(end, next_ist_midnight(cursor))
    return total_seconds


async def active_session_for(user_id, now=None):
    now = aware(now or utcnow())
    session = await db.sessions.find_one(
        {"user_id": user_id, "logout_at": None}, sort=[("login_at", -1)],
    )
    if not session:
        return None
    login_at = aware(session.get("login_at"))
    if not login_at:
        return session
    logout_at = session_workday_end(login_at)
    if now >= logout_at:
        await db.sessions.update_one(
            {"_id": session["_id"], "logout_at": None},
            {"$set": {"logout_at": logout_at}},
        )
        return None
    return session


async def close_expired_sessions(now=None):
    now = aware(now or utcnow())
    sessions = await db.sessions.find({"logout_at": None}).to_list(10000)
    for session in sessions:
        login_at = aware(session.get("login_at"))
        if not login_at:
            continue
        logout_at = session_workday_end(login_at)
        if now >= logout_at:
            await db.sessions.update_one(
                {"_id": session["_id"], "logout_at": None},
                {"$set": {"logout_at": logout_at}},
            )


async def session_auto_logout_loop():
    while True:
        try:
            await close_expired_sessions()
        except Exception:
            logger.exception("Failed to auto-logout expired sessions")
        await asyncio.sleep(30)


def trend_bounds(period: str, from_date: Optional[str] = None, to_date: Optional[str] = None):
    """Like perf_bounds, but for the trend chart the window spans the FULL period
    (7 days for week, whole month for month) so the axis is stable even mid-period."""
    start, end = perf_bounds(period, from_date, to_date)
    if period == "week":
        end = start + timedelta(days=7)
    elif period == "month":
        local_start = aware(start).astimezone(TEAM_TZ)
        nxt = (local_start.replace(year=local_start.year + 1, month=1, day=1)
               if local_start.month == 12
               else local_start.replace(month=local_start.month + 1, day=1))
        end = nxt.astimezone(timezone.utc)
    return start, end


def days_in_range(start, end):
    count, cur = 0, start
    while cur < end:
        count += 1
        cur = next_ist_midnight(cur)
    return max(count, 1)


def iso_to_local(value):
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value).astimezone(TEAM_TZ).strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        return value



async def start_session(user_doc: dict):
    now = utcnow()
    await db.sessions.update_many({"user_id": user_doc["_id"], "logout_at": None},
                                  {"$set": {"logout_at": now}})
    await db.sessions.insert_one({
        "user_id": user_doc["_id"], "user_name": user_doc.get("name"),
        "role": user_doc.get("role"), "login_at": now, "last_seen_at": now, "logout_at": None,
    })


async def user_live_status(user_id, now, last_call_at=None, last_activity_at=None) -> str:
    session = await db.sessions.find_one({"user_id": user_id, "logout_at": None},
                                         sort=[("login_at", -1)])
    if not session:
        return "offline"
    last_seen = aware(session.get("last_seen_at")) or aware(session.get("login_at"))
    if not last_seen or (now - last_seen) > ONLINE_WINDOW:
        return "offline"
    if last_call_at and (now - last_call_at) <= ON_CALL_WINDOW:
        return "on_call"
    if (now - last_seen) <= IDLE_AFTER:
        return "online"
    return "idle"


# ------------------------------------------------------------------ helpers
def clean_phone(phone: str) -> str:
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) == 10:
        return f"91{digits}"
    if len(digits) == 11 and digits.startswith("0"):
        return f"91{digits[1:]}"
    return digits


def clean_uploaded_phone(phone: str) -> str:
    value = str(phone or "").strip().replace(",", "")
    if re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)", value):
        significand = re.split(r"[eE]", value, maxsplit=1)[0]
        significant_digits = len(re.sub(r"\D", "", significand).lstrip("0"))
        if significant_digits < 10:
            return ""
        try:
            number = Decimal(value)
            if number.is_finite() and number == number.to_integral_value():
                value = format(number.quantize(Decimal("1")), "f")
        except InvalidOperation:
            return ""
    return clean_phone(value)


def phone_match_query(phone: str) -> dict:
    query = {"phone": phone}
    if len(phone) == 12 and phone.startswith("91"):
        query = {"$or": [{"phone": phone}, {"phone": phone[2:]}]}
    return query


def iso(value):
    if not isinstance(value, datetime):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def serialize(doc: dict) -> dict:
    out = {}
    for k, v in doc.items():
        key = "id" if k == "_id" else k
        if isinstance(v, ObjectId):
            out[key] = str(v)
        elif isinstance(v, datetime):
            out[key] = iso(v)
        elif isinstance(v, list):
            out[key] = [serialize(i) if isinstance(i, dict) else iso(i) for i in v]
        else:
            out[key] = v
    return out


async def current_user(request: Request) -> dict:
    token = extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    user = await db.users.find_one({"_id": oid(payload["sub"])})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if not await active_session_for(user["_id"]):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    user["id"] = str(user["_id"])
    user.pop("password_hash", None)
    return user


async def team_member_ids(user: dict) -> List[ObjectId]:
    ids = [ObjectId(user["id"])]
    if user.get("team_id"):
        members = await db.users.find({"team_id": user["team_id"], "removed": {"$ne": True}}, {"_id": 1}).to_list(200)
        ids += [m["_id"] for m in members]
    return list({str(i): i for i in ids}.values())


async def lead_scope(user: dict) -> dict:
    """Compile the caller's visibility into a Mongo predicate."""
    role = user["role"]
    if role in ("admin", "subadmin"):
        return {}
    if role == "team_leader":
        ids = await team_member_ids(user)
        return {"$or": [{"assigned_to": {"$in": ids}}, {"team_id": user.get("team_id")}]}
    return {"assigned_to": ObjectId(user["id"])}


async def log_activity(action: str, actor: Optional[dict], lead: Optional[dict] = None,
                       detail: Optional[str] = None, status_from: Optional[str] = None,
                       status_to: Optional[str] = None):
    doc = Activity(
        lead_id=str(lead["_id"]) if lead else None,
        lead_name=lead.get("name") if lead else None,
        actor_id=actor["id"] if actor else None,
        actor_name=actor["name"] if actor else "system",
        action=action,
        detail=detail,
        status_from=status_from,
        status_to=status_to,
    ).to_mongo()
    doc["lead_id"] = ObjectId(doc["lead_id"]) if doc["lead_id"] else None
    doc["actor_id"] = ObjectId(doc["actor_id"]) if doc["actor_id"] else None
    doc["created_at"] = utcnow()
    await db.activities.insert_one(doc)


async def next_telecaller(exclude: Optional[ObjectId] = None) -> Optional[dict]:
    callers = await db.users.find({"role": "telecaller", "active": True}).sort("_id", 1).to_list(200)
    if exclude:
        callers = [c for c in callers if c["_id"] != exclude] or callers
    if not callers:
        return None
    state = await db.settings.find_one_and_update(
        {"_id": "round_robin"}, {"$inc": {"index": 1}},
        upsert=True, return_document=True,
    )
    idx = (state or {}).get("index", 0)
    return callers[idx % len(callers)]


async def apply_assignment(lead: dict, assignee: dict, actor: Optional[dict], reason: str):
    now = utcnow()
    update = {
        "assigned_to": assignee["_id"],
        "assigned_to_name": assignee["name"],
        "team_id": assignee.get("team_id"),
        "assigned_at": now,
        "last_action_at": now,
        "updated_at": now,
        "escalated": False,
    }
    if lead.get("status") in ("new_lead", None):
        update["status"] = "assigned"
    inc = {"reassign_count": 1} if lead.get("assigned_to") else {}
    ops = {"$set": update}
    if inc:
        ops["$inc"] = inc
    await db.leads.update_one({"_id": lead["_id"]}, ops)
    await log_activity(reason, actor, lead, f"Assigned to {assignee['name']}")
    if update.get("status") and update["status"] != lead.get("status"):
        await log_activity("status_changed", actor, lead,
                           f"{lead.get('status') or 'none'} -> {update['status']}",
                           status_from=lead.get("status"), status_to=update["status"])


# ------------------------------------------------------------------ auth
@api.post("/auth/login")
async def login(payload: LoginRequest, response: Response, request: Request):
    email = payload.email.lower()
    ident = email
    now_naive = utcnow().replace(tzinfo=None)
    attempt = await db.login_attempts.find_one({"identifier": ident})
    if attempt:
        locked_until = attempt.get("locked_until")
        if attempt.get("count", 0) >= 5 and locked_until and locked_until > now_naive:
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
        if locked_until and locked_until <= now_naive:
            await db.login_attempts.delete_one({"identifier": ident})

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        await db.login_attempts.update_one(
            {"identifier": ident},
            {"$inc": {"count": 1},
             "$set": {"locked_until": now_naive + timedelta(minutes=15)}},
            upsert=True,
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account disabled")
    if datetime.now(TEAM_TZ).time() >= SESSION_WORK_END:
        raise HTTPException(status_code=403, detail="The workday ended at 10:00 PM IST")

    await db.login_attempts.delete_one({"identifier": ident})
    uid = str(user["_id"])
    await start_session(user)
    access = create_access_token(uid, email)
    set_auth_cookies(response, access, create_refresh_token(uid))
    user.pop("password_hash", None)
    return {"user": serialize(user), "access_token": access}


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = extract_token(request)
    if token:
        try:
            payload = decode_token(token)
            await db.sessions.update_many({"user_id": oid(payload["sub"]), "logout_at": None},
                                          {"$set": {"logout_at": utcnow()}})
        except HTTPException:
            pass
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@api.post("/sessions/heartbeat")
async def session_heartbeat(user: dict = Depends(current_user)):
    now = utcnow()
    result = await db.sessions.update_one(
        {"user_id": ObjectId(user["id"]), "logout_at": None},
        {"$set": {"last_seen_at": now}})
    if result.matched_count == 0:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    return {"ok": True, "server_time": iso(now)}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return serialize(user)


@api.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    payload = decode_token(token, "refresh")
    user = await db.users.find_one({"_id": oid(payload["sub"])})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if not await active_session_for(user["_id"]):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    access = create_access_token(str(user["_id"]), user["email"])
    set_auth_cookies(response, access, create_refresh_token(str(user["_id"])))
    return {"access_token": access}


# ------------------------------------------------------------------ users & teams
@api.get("/users")
async def list_users(role: Optional[str] = None, user: dict = Depends(current_user)):
    if user["role"] == "telecaller":
        raise HTTPException(status_code=403, detail="Not permitted")
    query = {"removed": {"$ne": True}}
    if user["role"] == "team_leader":
        query["_id"] = {"$in": await team_member_ids(user)}
    if role:
        query["role"] = role
    docs = await db.users.find(query, {"password_hash": 0}).sort("name", 1).to_list(300)
    return [serialize(d) for d in docs]


@api.post("/users")
async def create_user(payload: UserCreate, user: dict = Depends(current_user)):
    require_perm(user, "user:manage")
    if payload.is_50_cr_club_rm and (user["role"] != "admin" or payload.role != "telecaller"):
        raise HTTPException(status_code=403, detail="Only an admin can designate an active telecaller as a 50 Cr Club RM")
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    if ROLE_RANK[payload.role] >= ROLE_RANK[user["role"]]:
        raise HTTPException(status_code=403, detail="Cannot create a role at or above your own")
    if await db.users.find_one({"email": payload.email.lower()}):
        raise HTTPException(status_code=400, detail="Email already exists")
    doc = User(
        name=payload.name, email=payload.email.lower(), role=payload.role,
        password_hash=hash_password(payload.password),
        agent_number=payload.agent_number,
        agent_extension=payload.agent_extension,
        call_mode=payload.call_mode if payload.call_mode in CALL_MODES else "phone",
        daily_call_target=max(0, payload.daily_call_target or 0),
        daily_conversion_target=max(0, payload.daily_conversion_target or 0),
        is_50_cr_club_rm=payload.is_50_cr_club_rm,
    ).to_mongo()
    doc["team_id"] = ObjectId(payload.team_id) if payload.team_id else None
    doc["created_at"] = utcnow()
    res = await db.users.insert_one(doc)
    await log_activity("user_created", user, None, f"{payload.name} ({payload.role})")
    created = await db.users.find_one({"_id": res.inserted_id}, {"password_hash": 0})
    return serialize(created)


@api.patch("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, user: dict = Depends(current_user)):
    require_perm(user, "user:manage")
    target = await db.users.find_one({"_id": oid(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if ROLE_RANK[target["role"]] >= ROLE_RANK[user["role"]] and str(target["_id"]) != user["id"]:
        raise HTTPException(status_code=403, detail="Cannot modify this user")
    updates = {}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.email is not None:
        email = payload.email.lower()
        duplicate = await db.users.find_one({"email": email, "_id": {"$ne": target["_id"]}})
        if duplicate:
            raise HTTPException(status_code=400, detail="Email already exists")
        updates["email"] = email
    if payload.active is not None:
        updates["active"] = payload.active
    if payload.role is not None:
        same_admin_profile = str(target["_id"]) == user["id"] and target["role"] == "admin" and payload.role == "admin"
        if payload.role not in ROLES or (ROLE_RANK[payload.role] >= ROLE_RANK[user["role"]] and not same_admin_profile):
            raise HTTPException(status_code=403, detail="Cannot grant this role")
        updates["role"] = payload.role
        if payload.role != "telecaller":
            updates["is_50_cr_club_rm"] = False
    if payload.is_50_cr_club_rm is not None:
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can assign 50 Cr Club RMs")
        if payload.is_50_cr_club_rm and (payload.role or target["role"]) != "telecaller":
            raise HTTPException(status_code=400, detail="Only telecallers can be assigned as 50 Cr Club RMs")
        updates["is_50_cr_club_rm"] = payload.is_50_cr_club_rm
    if payload.team_id is not None:
        updates["team_id"] = ObjectId(payload.team_id) if payload.team_id else None
    if payload.agent_number is not None:
        updates["agent_number"] = payload.agent_number.strip()
    if payload.agent_extension is not None:
        updates["agent_extension"] = payload.agent_extension.strip()
    if payload.call_mode is not None:
        if payload.call_mode not in CALL_MODES:
            raise HTTPException(status_code=400, detail="call_mode must be 'desktop' or 'phone'")
        updates["call_mode"] = payload.call_mode
    if payload.daily_call_target is not None:
        updates["daily_call_target"] = max(0, payload.daily_call_target)
    if payload.daily_conversion_target is not None:
        updates["daily_conversion_target"] = max(0, payload.daily_conversion_target)
    if payload.password:
        updates["password_hash"] = hash_password(payload.password)
    if updates:
        await db.users.update_one({"_id": target["_id"]}, {"$set": updates})
        await log_activity("user_updated", user, None, target["name"])
    doc = await db.users.find_one({"_id": target["_id"]}, {"password_hash": 0})
    return serialize(doc)


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(current_user)):
    require_perm(user, "user:manage")
    target = await db.users.find_one({"_id": oid(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["role"] == "admin":
        raise HTTPException(status_code=403, detail="Cannot delete an admin")
    await db.users.update_one({"_id": target["_id"]}, {"$set": {"active": False, "removed": True, "team_id": None}})
    await db.teams.update_many({"leader_id": target["_id"]}, {"$set": {"leader_id": None}})
    await db.leads.update_many(
        {"assigned_to": target["_id"]},
        {"$set": {"assigned_to": None, "assigned_to_name": None, "assigned_at": None}},
    )
    await db.activities.update_many({"actor_id": target["_id"]}, {"$unset": {"actor_name": ""}})
    await db.call_attempts.update_many({"user_id": target["_id"]}, {"$unset": {"user_name": ""}})
    await db.call_attempts.update_many({"outcome_updated_by": target["_id"]}, {"$unset": {"outcome_updated_by_name": ""}})
    await db.crm_activities.update_many({"owner_id": target["_id"]}, {"$unset": {"owner_name": ""}})
    await db.documents.update_many({"owner_id": str(target["_id"])}, {"$unset": {"owner_name": ""}})
    await db.chat_messages.update_many({"sender_id": target["_id"]}, {"$unset": {"sender_name": ""}})
    await db.activities.update_many(
        {"action": {"$in": ["user_created", "user_updated", "lead_assigned", "lead_reassigned"]},
         "detail": {"$in": [target["name"], f"{target['name']} ({target['role']})",
                             f"Assigned to {target['name']}"]}},
        {"$unset": {"detail": ""}},
    )
    await log_activity("user_disabled", user, None, "User removed")
    return {"ok": True}


@api.get("/teams")
async def list_teams(user: dict = Depends(current_user)):
    if user["role"] == "telecaller":
        raise HTTPException(status_code=403, detail="Not permitted")
    query = {} if user["role"] in ("admin", "subadmin") else {"_id": oid(user["team_id"])} if user.get("team_id") else {"_id": None}
    teams = await db.teams.find(query).sort("name", 1).to_list(100)
    out = []
    for t in teams:
        members = await db.users.find({"team_id": t["_id"], "active": True},
                                      {"password_hash": 0}).to_list(100)
        item = serialize(t)
        item["members"] = [serialize(m) for m in members]
        out.append(item)
    return out


@api.post("/teams")
async def create_team(payload: TeamCreate, user: dict = Depends(current_user)):
    require_perm(user, "team:manage")
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Team name is required")
    member_ids = list(dict.fromkeys(payload.member_ids + ([payload.leader_id] if payload.leader_id else [])))
    members = await db.users.find({"_id": {"$in": [oid(member_id) for member_id in member_ids]}, "role": {"$in": ["team_leader", "telecaller"]}, "active": True}).to_list(200)
    if len(members) != len(member_ids):
        raise HTTPException(status_code=400, detail="Team members must be active team leaders or telecallers")
    doc = Team(name=payload.name.strip()).to_mongo()
    doc["leader_id"] = ObjectId(payload.leader_id) if payload.leader_id else None
    doc["created_at"] = utcnow()
    res = await db.teams.insert_one(doc)
    if payload.leader_id:
        await db.users.update_one({"_id": ObjectId(payload.leader_id)},
                                  {"$set": {"team_id": res.inserted_id}})
    if member_ids:
        await db.users.update_many({"_id": {"$in": [oid(member_id) for member_id in member_ids]}},
                                   {"$set": {"team_id": res.inserted_id}})
    await log_activity("team_created", user, None, payload.name)
    return serialize(await db.teams.find_one({"_id": res.inserted_id}))


@api.patch("/teams/{team_id}")
async def update_team(team_id: str, payload: TeamCreate, user: dict = Depends(current_user)):
    require_perm(user, "team:manage")
    team = await db.teams.find_one({"_id": oid(team_id)})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Team name is required")
    member_ids = list(dict.fromkeys(payload.member_ids + ([payload.leader_id] if payload.leader_id else [])))
    members = await db.users.find({"_id": {"$in": [oid(member_id) for member_id in member_ids]}, "role": {"$in": ["team_leader", "telecaller"]}, "active": True}).to_list(200)
    if len(members) != len(member_ids):
        raise HTTPException(status_code=400, detail="Team members must be active team leaders or telecallers")
    updates = {"name": payload.name.strip(),
               "leader_id": ObjectId(payload.leader_id) if payload.leader_id else None}
    await db.teams.update_one({"_id": oid(team_id)}, {"$set": updates})
    await db.users.update_many({"team_id": oid(team_id)}, {"$set": {"team_id": None}})
    if member_ids:
        await db.users.update_many({"_id": {"$in": [oid(member_id) for member_id in member_ids]}},
                                   {"$set": {"team_id": oid(team_id)}})
    return serialize(await db.teams.find_one({"_id": oid(team_id)}))


# ------------------------------------------------------------------ courses
@api.get("/courses")
async def list_courses(include_inactive: bool = False, user: dict = Depends(current_user)):
    query = {} if include_inactive and user["role"] in ("admin", "subadmin") else {"active": True}
    docs = await db.courses.find(query).sort("name", 1).to_list(500)
    return [serialize(doc) for doc in docs]


@api.post("/courses")
async def create_course(payload: CourseCreate, user: dict = Depends(current_user)):
    require_perm(user, "user:manage")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Course name is required")
    if await db.courses.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}}):
        raise HTTPException(status_code=409, detail="Course already exists")
    doc = Course(name=name).to_mongo()
    doc["created_at"] = utcnow()
    result = await db.courses.insert_one(doc)
    return serialize(await db.courses.find_one({"_id": result.inserted_id}))


@api.patch("/courses/{course_id}")
async def update_course(course_id: str, payload: CourseUpdate, user: dict = Depends(current_user)):
    require_perm(user, "user:manage")
    course = await db.courses.find_one({"_id": oid(course_id)})
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    updates = payload.model_dump(exclude_none=True)
    if "name" in updates:
        updates["name"] = updates["name"].strip()
        if not updates["name"]:
            raise HTTPException(status_code=400, detail="Course name is required")
        duplicate = await db.courses.find_one({"_id": {"$ne": course["_id"]}, "name": {"$regex": f"^{updates['name']}$", "$options": "i"}})
        if duplicate:
            raise HTTPException(status_code=409, detail="Course already exists")
    if updates:
        await db.courses.update_one({"_id": course["_id"]}, {"$set": updates})
    return serialize(await db.courses.find_one({"_id": course["_id"]}))


# ------------------------------------------------------------------ leads
def normalize_tags(tags) -> list[str]:
    return list(dict.fromkeys(tag.strip().lower() for tag in (tags or []) if tag and tag.strip()))


def call_attempt_connected(call: dict) -> Optional[bool]:
    outcome = call.get("manual_call_outcome") or call.get("call_outcome")
    if outcome == "connected":
        return True
    if outcome in ("not_connected", "busy", "declined", "no_answer"):
        return False
    if call.get("connected") is not None:
        return bool(call["connected"])
    try:
        status_code = int(call.get("status_code") or 0)
    except (TypeError, ValueError):
        return None
    if 200 <= status_code < 300:
        return True
    if status_code >= 400:
        return False
    return None


def call_attempt_connection_state_expr():
    outcome = {"$ifNull": ["$manual_call_outcome", "$call_outcome"]}
    status_code = {"$ifNull": ["$status_code", 0]}
    return {"$switch": {
        "branches": [
            {"case": {"$eq": [outcome, "connected"]}, "then": True},
            {"case": {"$in": [outcome, ["not_connected", "busy", "declined", "no_answer"]]}, "then": False},
            {"case": {"$eq": ["$connected", True]}, "then": True},
            {"case": {"$eq": ["$connected", False]}, "then": False},
            {"case": {"$and": [{"$gte": [status_code, 200]}, {"$lt": [status_code, 300]}]}, "then": True},
            {"case": {"$gte": [status_code, 400]}, "then": False},
        ],
        "default": None,
    }}


async def count_connected_leads(scope=None, user_ids=None, start=None, end=None):
    call_query = {
        "lead_id": {"$ne": None},
        "$expr": {"$eq": [call_attempt_connection_state_expr(), True]},
    }
    if user_ids is not None:
        call_query["user_id"] = {"$in": user_ids}
    if start is not None or end is not None:
        call_query["created_at"] = {
            **({"$gte": start} if start is not None else {}),
            **({"$lt": end} if end is not None else {}),
        }
    pipeline = [
        {"$match": call_query},
        {"$group": {"_id": "$lead_id"}},
        {"$lookup": {"from": db.leads.name, "localField": "_id", "foreignField": "_id", "as": "lead"}},
        {"$unwind": "$lead"},
        {"$replaceRoot": {"newRoot": "$lead"}},
    ]
    if scope:
        pipeline.append({"$match": scope})
    pipeline.append({"$count": "count"})
    rows = await db.call_attempts.aggregate(pipeline).to_list(1)
    return rows[0]["count"] if rows else 0


async def count_connected_calls(user_ids=None, start=None, end=None):
    call_query = {
        "$expr": {"$eq": [call_attempt_connection_state_expr(), True]},
    }
    if user_ids is not None:
        call_query["user_id"] = {"$in": user_ids}
    if start is not None or end is not None:
        call_query["created_at"] = {
            **({"$gte": start} if start is not None else {}),
            **({"$lt": end} if end is not None else {}),
        }
    return await db.call_attempts.count_documents(call_query)


async def connected_lead_counts_by_user(member_ids, start=None, end=None):
    if not member_ids:
        return {}
    call_query = {
        "user_id": {"$in": member_ids},
        "$expr": {"$eq": [call_attempt_connection_state_expr(), True]},
    }
    if start is not None or end is not None:
        call_query["created_at"] = {
            **({"$gte": start} if start is not None else {}),
            **({"$lt": end} if end is not None else {}),
        }
    rows = await db.call_attempts.aggregate([
        {"$match": call_query},
        {"$group": {"_id": {"user_id": "$user_id", "lead_id": "$lead_id"}}},
        {"$lookup": {"from": db.leads.name, "localField": "_id.lead_id", "foreignField": "_id", "as": "lead"}},
        {"$unwind": "$lead"},
        {"$match": {"$expr": {"$eq": ["$_id.user_id", "$lead.assigned_to"]}}},
        {"$group": {"_id": "$_id.user_id", "count": {"$sum": 1}}},
    ]).to_list(200)
    return {str(row["_id"]): row["count"] for row in rows if row.get("_id")}


async def connected_call_counts_by_user(member_ids, start=None, end=None):
    if not member_ids:
        return {}
    call_query = {
        "user_id": {"$in": member_ids},
        "lead_id": {"$ne": None},
        "$expr": {"$eq": [call_attempt_connection_state_expr(), True]},
    }
    if start is not None or end is not None:
        call_query["created_at"] = {
            **({"$gte": start} if start is not None else {}),
            **({"$lt": end} if end is not None else {}),
        }
    rows = await db.call_attempts.aggregate([
        {"$match": call_query},
        {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
    ]).to_list(200)
    return {str(row["_id"]): row["count"] for row in rows if row.get("_id")}


async def connected_lead_counts_by_team():
    rows = await db.call_attempts.aggregate([
        {"$match": {
            "lead_id": {"$ne": None},
            "$expr": {"$eq": [call_attempt_connection_state_expr(), True]},
        }},
        {"$group": {"_id": "$lead_id"}},
        {"$lookup": {"from": db.leads.name, "localField": "_id", "foreignField": "_id", "as": "lead"}},
        {"$unwind": "$lead"},
        {"$match": {"lead.team_id": {"$ne": None}}},
        {"$group": {"_id": "$lead.team_id", "count": {"$sum": 1}}},
    ]).to_list(200)
    return {str(row["_id"]): row["count"] for row in rows if row.get("_id")}


async def connected_call_counts_by_team():
    rows = await db.call_attempts.aggregate([
        {"$match": {
            "lead_id": {"$ne": None},
            "$expr": {"$eq": [call_attempt_connection_state_expr(), True]},
        }},
        {"$lookup": {"from": db.leads.name, "localField": "lead_id", "foreignField": "_id", "as": "lead"}},
        {"$unwind": "$lead"},
        {"$match": {"lead.team_id": {"$ne": None}}},
        {"$group": {"_id": "$lead.team_id", "count": {"$sum": 1}}},
    ]).to_list(200)
    return {str(row["_id"]): row["count"] for row in rows if row.get("_id")}


async def build_lead_query(user: dict, status=None, source=None, assigned_to=None,
                           team_id=None, q=None, bucket=None, tags=None,
                           call_outcome=None, course_id=None, occupation=None,
                           annual_income=None, income_max=None, trader_type=None,
                           market=None, capital_min=None, capital_max=None, state=None,
                           call_number=None, club_seller_type=None, deposit_status=None,
                           deposit_min=None, deposit_max=None, broker_account_status=None,
                           trading_mode=None, new_broker_name=None, current_broker_name=None,
                           club_seller_name=None, broker_name=None, broker_unique_id=None,
                           club_joined_from=None, club_joined_to=None,
                           club_expires_from=None, club_expires_to=None,
                           club_expiry_status=None, exclude_club=False) -> dict:
    query = dict(await lead_scope(user))
    if status:
        query["status"] = status
    if source:
        query["source"] = source
    if state:
        query["state"] = state
    if course_id:
        query["course_id"] = ObjectId(course_id)
    if assigned_to:
        if assigned_to != "none" and not ObjectId.is_valid(assigned_to):
            raise HTTPException(status_code=400, detail="Invalid assigned telecaller")
        query["assigned_to"] = ObjectId(assigned_to) if assigned_to != "none" else None
    tag_values = [tag.strip().lower() for tag in (tags or "").split(",") if tag.strip()]
    if tag_values:
        query["tags"] = {"$all": tag_values}
    if exclude_club:
        query.setdefault("$and", []).append({"tags": {"$nin": ["50-cr-club"]}})
    if team_id:
        query["team_id"] = ObjectId(team_id)
    if club_seller_type == "seller":
        query["club_seller_type"] = "seller"
        query["club_seller_name"] = {"$nin": [None, ""]}
    elif club_seller_type == "direct":
        query.setdefault("$and", []).append({"$or": [
            {"club_seller_type": "direct"},
            {"club_seller_name": {"$in": [None, ""]}},
        ]})
    if club_seller_name:
        query["club_seller_name"] = {"$regex": re.escape(club_seller_name), "$options": "i"}
    if deposit_status == "made":
        query["deposit_made"] = True
    elif deposit_status == "not_made":
        query["deposit_made"] = False
    elif deposit_status == "not_recorded":
        query.setdefault("$and", []).append({"$or": [
            {"deposit_made": None}, {"deposit_made": {"$exists": False}},
        ]})
    if deposit_min is not None or deposit_max is not None:
        deposit_query = {}
        if deposit_min is not None:
            deposit_query["$gte"] = deposit_min
        if deposit_max is not None:
            deposit_query["$lte"] = deposit_max
        query["deposit_amount"] = deposit_query
    if broker_account_status == "not_recorded":
        query.setdefault("$and", []).append({"$or": [
            {"broker_account_status": None}, {"broker_account_status": {"$exists": False}},
        ]})
    elif broker_account_status:
        query["broker_account_status"] = broker_account_status
    if trading_mode:
        query["trading_mode"] = trading_mode
    if new_broker_name:
        query["new_broker_name"] = {"$regex": re.escape(new_broker_name), "$options": "i"}
    if current_broker_name:
        query["current_broker_name"] = {"$regex": re.escape(current_broker_name), "$options": "i"}
    if broker_name:
        query["broker_name"] = {"$regex": re.escape(broker_name), "$options": "i"}
    if broker_unique_id:
        query["broker_unique_id"] = {"$regex": broker_unique_id, "$options": "i"}
    for field, start, end in (
        ("club_joined_at", club_joined_from, club_joined_to),
        ("club_expires_at", club_expires_from, club_expires_to),
    ):
        date_bounds = {}
        if start:
            date_bounds["$gte"] = start
        if end:
            date_bounds["$lt"] = f"{end}T24"
        if date_bounds:
            query.setdefault("$and", []).append({field: date_bounds})
    if club_expiry_status:
        expiry_filter = {"club_expires_at": {"$lt": utcnow().date().isoformat()}}
        if club_expiry_status == "expired_unpaid":
            expiry_filter["deposit_made"] = False
        query.setdefault("$and", []).append(expiry_filter)
    if q:
        query.setdefault("$and", []).append({"$or": [{"name": {"$regex": q, "$options": "i"}},
                                  {"phone": {"$regex": q}},
                                  {"email": {"$regex": q, "$options": "i"}},
                                  {"broker_name": {"$regex": q, "$options": "i"}},
                                  {"broker_unique_id": {"$regex": q, "$options": "i"}},
                                  {"club_joined_at": {"$regex": q, "$options": "i"}},
                                  {"club_expires_at": {"$regex": q, "$options": "i"}}]})
    call_lead_sets = []
    if call_outcome:
        if call_outcome in ("connected", "not_connected"):
            outcome_query = {
                **await call_attempt_scope(user),
                "lead_id": {"$ne": None},
                "$or": [
                    {"manual_call_outcome": {"$in": ["connected", "not_connected"]}},
                    {"outcome_updated_at": {"$ne": None}, "manual_call_outcome": {"$exists": False}},
                ],
            }
            if call_number:
                outcome_query["call_number"] = call_number
            call_rows = await db.call_attempts.find(
                outcome_query,
                {"lead_id": 1, "manual_call_outcome": 1, "call_outcome": 1,
                 "connected": 1, "outcome_updated_at": 1, "manual_outcome_updated_at": 1,
                 "created_at": 1, "call_number": 1},
            ).to_list(5000)
            call_rows.sort(key=lambda row: row.get("manual_outcome_updated_at")
                           or row.get("outcome_updated_at") or row.get("created_at") or datetime.min.replace(tzinfo=timezone.utc),
                           reverse=True)
            latest_by_lead = {}
            for row in call_rows:
                if row.get("lead_id"):
                    latest_by_lead.setdefault(row["lead_id"], row)
            expected_connected = call_outcome == "connected"
            call_lead_sets.append({row["lead_id"] for row in latest_by_lead.values()
                                   if row.get("lead_id") and call_attempt_connected(row) is expected_connected})
        elif call_outcome == "not_picked_up":
            call_query = {"$or": [
                {"call_outcome": {"$in": ["not_connected", "busy"]}},
                {"provider_response.message": {"$regex": "not picked|no answer|unanswered|missed|busy", "$options": "i"}},
            ]}
            call_rows = await db.call_attempts.find(
                {**call_query, **await call_attempt_scope(user)}, {"lead_id": 1}
            ).to_list(5000)
            call_lead_sets.append({row["lead_id"] for row in call_rows if row.get("lead_id")})
        else:
            call_rows = await db.call_attempts.find(
                {"call_outcome": call_outcome, **await call_attempt_scope(user)}, {"lead_id": 1}
            ).to_list(5000)
            call_lead_sets.append({row["lead_id"] for row in call_rows if row.get("lead_id")})
    if call_number:
        call_rows = await db.call_attempts.aggregate([
            {"$match": {"lead_id": {"$ne": None}, **await call_attempt_scope(user)}},
            {"$group": {"_id": "$lead_id", "attempt_count": {"$sum": 1}}},
            {"$match": {"attempt_count": call_number}},
        ]).to_list(5000)
        call_lead_sets.append({row["_id"] for row in call_rows if row.get("_id")})
    now = utcnow()
    if occupation:
        query["occupation"] = occupation
    if annual_income:
        query["annual_income"] = annual_income
    if income_max and income_max in INCOME_BRACKETS:
        if income_max == "above_1cr":
            query["annual_income"] = "above_1cr"
            income_max = None
    if income_max and income_max in INCOME_BRACKETS:
        # "yearly income less than X" = this bracket and everything below it.
        ceiling = INCOME_BRACKETS.index(income_max)
        query["annual_income"] = {"$in": list(INCOME_BRACKETS[:ceiling + 1])}
    if trader_type:
        query["trader_type"] = trader_type
    if market:
        query.setdefault("$and", []).append({"$or": [{"markets_interested": market}, {"markets_traded": market}]})
    if capital_min is not None or capital_max is not None:
        capital_query = {}
        if capital_min is not None:
            capital_query["$gte"] = capital_min
        if capital_max is not None:
            capital_query["$lt"] = capital_max
        query["trading_capital"] = capital_query
    if bucket == "today":
        start, end = local_day_bounds()
        query["next_follow_up_at"] = {"$gte": start, "$lte": end}
    elif bucket == "overdue":
        query["next_follow_up_at"] = {"$lt": now}
        query["status"] = {"$nin": ["converted", "lost", "not_interested"]}
    elif bucket == "unassigned":
        query["assigned_to"] = None
    elif bucket == "escalated":
        query["escalated"] = True
    elif bucket == "actionless":
        # Assigned but not worked (no notes / no action) for 24h — review-only, no auto reassign.
        query["assigned_to"] = {"$ne": None}
        query["status"] = {"$nin": ["converted", "lost", "not_interested"]}
        query["notes"] = {"$size": 0}
        query["last_action_at"] = {"$lt": now - timedelta(hours=24)}
    elif bucket in ("untouched", "club_unworked"):
        query.setdefault("$and", []).append({"assigned_to": {"$ne": None}})
        query["status"] = "assigned"
        if bucket == "club_unworked":
            query["tags"] = {"$all": ["50-cr-club"]}
    elif bucket == "inactive":
        query["last_action_at"] = {"$lt": now - timedelta(days=3)}
        query["status"] = {"$nin": ["converted", "lost"]}
    if call_lead_sets:
        matching_ids = set.intersection(*call_lead_sets)
        query.setdefault("_id", {})["$in"] = list(matching_ids)
    return query


@api.get("/leads")
async def list_leads(
    status: Optional[str] = None,
    source: Optional[str] = None,
    assigned_to: Optional[str] = None,
    team_id: Optional[str] = None,
    q: Optional[str] = None,
    tags: Optional[str] = None,
    call_outcome: Optional[str] = None,
    course_id: Optional[str] = None,
    occupation: Optional[str] = None,
    annual_income: Optional[str] = None,
    income_max: Optional[str] = Query(None, description="yearly income less than this bracket"),
    trader_type: Optional[str] = None,
    market: Optional[str] = None,
    capital_min: Optional[float] = Query(None, ge=0),
    capital_max: Optional[float] = Query(None, gt=0),
    state: Optional[str] = None,
    call_number: Optional[int] = Query(None, ge=1, le=4),
    bucket: Optional[str] = Query(None, description="today|overdue|unassigned|escalated|actionless|inactive"),
    club_seller_type: Optional[str] = Query(None, pattern="^(direct|seller)$"),
    deposit_status: Optional[str] = Query(None, pattern="^(made|not_made|not_recorded)$"),
    deposit_min: Optional[float] = Query(None, ge=0),
    deposit_max: Optional[float] = Query(None, ge=0),
    broker_account_status: Optional[str] = Query(None, pattern="^(opened|in_progress|not_opened|not_required|not_recorded)$"),
    trading_mode: Optional[str] = Query(None, pattern="^(self|group|both)$"),
    new_broker_name: Optional[str] = None,
    current_broker_name: Optional[str] = None,
    broker_name: Optional[str] = None,
    broker_unique_id: Optional[str] = None,
    club_joined_from: Optional[str] = None,
    club_joined_to: Optional[str] = None,
    club_expires_from: Optional[str] = None,
    club_expires_to: Optional[str] = None,
    club_expiry_status: Optional[str] = Query(None, pattern="^(expired|expired_unpaid)$"),
    exclude_club: Optional[bool] = None,
    club_seller_name: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    user: dict = Depends(current_user),
):
    requested_tags = [tag.strip().lower() for tag in (tags or "").split(",") if tag.strip()]
    if exclude_club is None:
        exclude_club = "50-cr-club" not in requested_tags
    query = await build_lead_query(user, status, source, assigned_to, team_id, q, bucket, tags,
                                    call_outcome, course_id, occupation, annual_income,
                                    income_max, trader_type, market, capital_min, capital_max, state, call_number,
                                    club_seller_type, deposit_status, deposit_min, deposit_max,
                                    broker_account_status, trading_mode, new_broker_name, current_broker_name,
                                    club_seller_name, broker_name, broker_unique_id,
                                    club_joined_from, club_joined_to, club_expires_from, club_expires_to,
                                    club_expiry_status, exclude_club)
    is_club_lead_list = "50-cr-club" in requested_tags
    if is_club_lead_list and (assigned_to or club_expiry_status):
        event_scope = {
            "source_record_type": "purchases",
            "verified": True,
            "lead_id": {"$ne": None},
        }
        assignment_event_lead_ids = set()
        assigned_event_lead_ids = set()
        if assigned_to:
            assigned_events = await db.payment_club_events.find(
                {**event_scope, "assigned_to_id": {"$ne": None}},
                {"lead_id": 1, "assigned_to_id": 1},
            ).to_list(20000)
            assigned_event_lead_ids = {event["lead_id"] for event in assigned_events if event.get("lead_id")}
            if assigned_to != "none":
                assignment_event_lead_ids = {
                    event["lead_id"] for event in assigned_events
                    if event.get("lead_id") and str(event.get("assigned_to_id")) == assigned_to
                }

            query.pop("assigned_to", None)
            if assigned_to == "none":
                assignment_condition = {
                    "assigned_to": None,
                    "_id": {"$nin": list(assigned_event_lead_ids)},
                }
            else:
                assignment_condition = {"$or": [
                    {"assigned_to": oid(assigned_to), "_id": {"$nin": list(assigned_event_lead_ids)}},
                    {"_id": {"$in": list(assignment_event_lead_ids)}},
                ]}
            query.setdefault("$and", []).append(assignment_condition)

        if club_expiry_status:
            today = utcnow().date().isoformat()
            expiry_event_query = {**event_scope, "$or": [
                {"club.expires_at": {"$lt": today}},
                {"member_profile.expires_at": {"$lt": today}},
            ]}
            if club_expiry_status == "expired_unpaid":
                expiry_event_query["$and"] = [
                    {"club.deposit_made": {"$ne": True}},
                    {"member_profile.deposit_made": {"$ne": True}},
                ]
            expiry_event_lead_ids = {
                event["lead_id"] for event in await db.payment_club_events.find(
                    expiry_event_query, {"lead_id": 1},
                ).to_list(20000) if event.get("lead_id")
            }

            query["$and"] = [condition for condition in query.get("$and", []) if not (
                condition.get("club_expires_at", {}).get("$lt") == today
            )]
            if not query["$and"]:
                query.pop("$and")
            lead_expiry_filter = {"club_expires_at": {"$lt": today}}
            if club_expiry_status == "expired_unpaid":
                lead_expiry_filter["deposit_made"] = {"$ne": True}
            query.setdefault("$and", []).append({"$or": [
                lead_expiry_filter,
                {"_id": {"$in": list(expiry_event_lead_ids)}},
            ]})
    total, docs = await asyncio.gather(
        db.leads.count_documents(query),
        db.leads.find(query).sort("updated_at", -1)
        .skip(max(page - 1, 0) * limit).limit(limit).to_list(limit),
    )
    assignee_stats = []
    if "50-cr-club" in requested_tags:
        grouped_stats = await db.leads.aggregate([
            {"$match": query},
            {"$group": {
                "_id": "$assigned_to",
                "name": {"$first": "$assigned_to_name"},
                "total": {"$sum": 1},
                "account_opened": {"$sum": {"$cond": [{"$eq": ["$broker_account_status", "opened"]}, 1, 0]}},
                "deposit_made": {"$sum": {"$cond": [{"$eq": ["$deposit_made", True]}, 1, 0]}},
            }},
        ]).to_list(500)
        assignee_stats = [{
            "id": str(row["_id"]) if row.get("_id") else None,
            "name": row.get("name") or ("Unassigned" if not row.get("_id") else "Unknown assignee"),
            "total": row.get("total", 0),
            "account_opened": row.get("account_opened", 0),
            "deposit_made": row.get("deposit_made", 0),
        } for row in grouped_stats]
    if "50-cr-club" in requested_tags and docs:
        lead_ids = [lead["_id"] for lead in docs]
        source_events = await db.payment_club_events.find({
            "source_record_type": "purchases", "verified": True,
            "lead_id": {"$in": lead_ids},
        }).sort([("payment.paid_at", -1), ("received_at", -1)]).to_list(10000)
        source_events = await enrich_stored_vip_membership_dates(source_events)
        source_by_lead = {}
        assigned_source_by_lead = {}
        for event in source_events:
            lead_key = str(event["lead_id"])
            source_by_lead.setdefault(lead_key, event)
            if event.get("assigned_to_id"):
                assigned_source_by_lead.setdefault(lead_key, event)
        for lead in docs:
            lead_key = str(lead["_id"])
            source = source_by_lead.get(lead_key)
            if source:
                lead.update({key: value for key, value in club_source_lead_updates(source).items()
                             if value is not None and (key in {"club_joined_at", "club_expires_at"}
                                                       or lead.get(key) is None)})
            assigned_source = assigned_source_by_lead.get(lead_key)
            if assigned_source:
                lead["assigned_to_name"] = assigned_source.get("assigned_to_name") or lead.get("assigned_to_name")
                lead["assigned_to_id"] = str(assigned_source["assigned_to_id"])
    return {"total": total, "page": page, "items": [serialize(d) for d in docs],
            "assignee_stats": assignee_stats}


@api.get("/leads/50-cr-club/export")
async def export_50_cr_club_leads(assigned_to: Optional[str] = None,
                                  user: dict = Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can export 50 Cr Club leads")
    if assigned_to not in (None, "none") and not ObjectId.is_valid(assigned_to):
        raise HTTPException(status_code=400, detail="Invalid RM selection")
    query = await build_lead_query(user, tags="50-cr-club", exclude_club=False)
    leads = await db.leads.find(query).sort("updated_at", -1).to_list(20000)
    event_by_lead = {}
    if leads:
        lead_ids = [lead["_id"] for lead in leads]
        assigned_events = await db.payment_club_events.find({
            "source_record_type": "purchases",
            "verified": True,
            "lead_id": {"$in": lead_ids},
            "assigned_to_id": {"$ne": None},
        }).sort([("payment.paid_at", -1), ("received_at", -1)]).to_list(20000)
        for event in assigned_events:
            event_by_lead.setdefault(str(event["lead_id"]), event)
    if assigned_to == "none":
        leads = [
            lead for lead in leads
            if not lead.get("assigned_to")
            and not event_by_lead.get(str(lead["_id"]), {}).get("assigned_to_id")
        ]
    elif assigned_to:
        leads = [
            lead for lead in leads
            if str(lead.get("assigned_to") or "") == assigned_to
            or str(lead["_id"]) in event_by_lead
            and str(event_by_lead[str(lead["_id"])].get("assigned_to_id")) == assigned_to
        ]

    async def csv_rows():
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow([
            "Name", "Phone", "Email", "Joined", "Expires", "Seller type", "Seller name",
            "Broker", "Broker ID", "Current broker", "New broker", "Account status",
            "Deposit made", "Deposit amount", "Trading mode", "Expected group profit",
            "Membership enabled", "Lead status", "Assigned RM", "Assigned RM ID",
        ])
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)
        for lead in leads:
            club_event = event_by_lead.get(str(lead["_id"])) or {}
            assignee_id = lead.get("assigned_to") or club_event.get("assigned_to_id")
            assignee_name = lead.get("assigned_to_name") or club_event.get("assigned_to_name")
            writer.writerow([
                lead.get("name"), lead.get("phone"), lead.get("email"),
                lead.get("club_joined_at"), lead.get("club_expires_at"),
                lead.get("club_seller_type"), lead.get("club_seller_name"),
                lead.get("broker_name"), lead.get("broker_unique_id"),
                lead.get("current_broker_name"), lead.get("new_broker_name"),
                lead.get("broker_account_status"), lead.get("deposit_made"),
                lead.get("deposit_amount"), lead.get("trading_mode"),
                lead.get("expected_group_profit"), lead.get("membership_enabled"),
                lead.get("status"), assignee_name, assignee_id,
            ])
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    suffix = assigned_to if assigned_to and assigned_to != "none" else "all-rms"
    return StreamingResponse(
        csv_rows(), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="50-cr-club-leads-{suffix}.csv"'},
    )


@api.get("/leads/duplicates")
async def list_duplicate_leads(user: dict = Depends(current_user)):
    scope = await lead_scope(user)
    groups = []
    for field, label in (("phone", "Phone"), ("email", "Email")):
        pipeline = [
            {"$match": {**scope, field: {"$nin": [None, ""]}}},
            {"$group": {"_id": f"${field}", "count": {"$sum": 1}, "leads": {"$push": "$$ROOT"}}},
            {"$match": {"count": {"$gt": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 200},
        ]
        for group in await db.leads.aggregate(pipeline).to_list(200):
            groups.append({
                "key": f"{field}:{group['_id']}",
                "reason": label,
                "value": group["_id"],
                "leads": [serialize(lead) for lead in group["leads"]],
            })
    groups.sort(key=lambda group: len(group["leads"]), reverse=True)
    return {"groups": groups[:200], "total": len(groups)}


@api.get("/leads/export")
async def export_leads(
    status: Optional[str] = None,
    source: Optional[str] = None,
    assigned_to: Optional[str] = None,
    team_id: Optional[str] = None,
    q: Optional[str] = None,
    tags: Optional[str] = None,
    call_outcome: Optional[str] = None,
    course_id: Optional[str] = None,
    occupation: Optional[str] = None,
    annual_income: Optional[str] = None,
    income_max: Optional[str] = None,
    trader_type: Optional[str] = None,
    market: Optional[str] = None,
    capital_min: Optional[float] = Query(None, ge=0),
    capital_max: Optional[float] = Query(None, gt=0),
    state: Optional[str] = None,
    call_number: Optional[int] = Query(None, ge=1, le=4),
    bucket: Optional[str] = None,
    user: dict = Depends(current_user),
):
    if not (has_perm(user["role"], "report:read") or has_perm(user["role"], "report:read_team")):
        raise HTTPException(status_code=403, detail="Not permitted")
    query = await build_lead_query(user, status, source, assigned_to, team_id, q, bucket, tags,
                                    call_outcome, course_id, occupation, annual_income,
                                    income_max, trader_type, market, capital_min, capital_max, state, call_number)
    leads = await db.leads.find(query).sort("updated_at", -1).to_list(5000)

    def local(value):
        return value.replace(tzinfo=timezone.utc).astimezone(TEAM_TZ).strftime(
            "%Y-%m-%d %H:%M") if isinstance(value, datetime) else ""

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Name", "Phone", "Email", "Company", "City", "State / Union territory", "Course", "Source", "Status",
                     "Occupation", "Annual Income", "Trader", "Trading Experience",
                     "Trading Capital", "Markets Traded", "Interested Markets",
                     "Assigned To", "Next Follow-up", "Last Action", "Call Notes",
                     "Reassigned", "Escalated", "Created At"])
    for lead in leads:
        writer.writerow([
            lead.get("name", ""), lead.get("phone", ""), lead.get("email") or "",
            lead.get("company") or "", lead.get("city") or "", lead.get("state") or "", lead.get("course_name") or "", lead.get("source", ""),
            lead.get("status", ""),
            lead.get("occupation") or "", lead.get("annual_income") or "",
            lead.get("trader_type") or "", lead.get("trading_experience") or "",
            lead.get("trading_capital") if lead.get("trading_capital") is not None else "",
            ", ".join(lead.get("markets_traded") or []),
            ", ".join(lead.get("markets_interested") or []),
            lead.get("assigned_to_name") or "Unassigned",
            local(lead.get("next_follow_up_at")), local(lead.get("last_action_at")),
            len(lead.get("notes") or []), lead.get("reassign_count", 0),
            "yes" if lead.get("escalated") else "no", local(lead.get("created_at")),
        ])
    buffer.seek(0)
    await log_activity("leads_exported", user, None, f"{len(leads)} rows")
    stamp = datetime.now(TEAM_TZ).strftime("%Y%m%d-%H%M")
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="leads-{stamp}.csv"'},
    )


PROFILE_CHOICES = {
    "occupation": OCCUPATIONS,
    "annual_income": INCOME_BRACKETS,
    "trader_type": TRADER_TYPES,
    "trading_experience": TRADING_EXPERIENCE,
    "trading_capital_range": CAPITAL_RANGES,
}


def validate_profile(values: dict) -> None:
    """Keep the profile answers to the fixed option lists."""
    for field, allowed in PROFILE_CHOICES.items():
        value = values.get(field)
        if value not in (None, "") and value not in allowed:
            raise HTTPException(status_code=400,
                                detail=f"{field} must be one of: {', '.join(allowed)}")
    for field in ("markets_traded", "markets_interested"):
        if field in values and values[field] is None:
            values[field] = []
        markets = values.get(field)
        if markets:
            unknown = [m for m in markets if m not in MARKETS]
            if unknown:
                raise HTTPException(status_code=400,
                                    detail=f"{field} has unknown markets: {', '.join(unknown)}")
    if values.get("trader_type") == "non_trader":
        # A non-trader has no trading history to record.
        values["trading_experience"] = None
        values["trading_capital"] = None
        values["trading_capital_range"] = None
        values["markets_traded"] = []
    if values.get("trading_capital") is not None and values["trading_capital"] < 0:
        raise HTTPException(status_code=400, detail="trading_capital cannot be negative")


@api.post("/leads")
async def create_lead(payload: LeadCreate, user: dict = Depends(current_user)):
    if not (has_perm(user["role"], "lead:create") or has_perm(user["role"], "lead:create_own")):
        raise HTTPException(status_code=403, detail="Not permitted")
    phone = clean_phone(payload.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Valid phone number required")
    if payload.status and payload.status not in LEAD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if await db.leads.find_one(phone_match_query(phone)):
        raise HTTPException(status_code=409, detail="Duplicate lead: phone already exists")
    values = payload.model_dump()
    validate_profile(values)
    if not values.get("course_id"):
        values["course_id"] = None
    if values.get("course_id"):
        course = await db.courses.find_one({"_id": oid(values["course_id"]), "active": True})
        if not course:
            raise HTTPException(status_code=400, detail="Invalid or inactive course")
        values["course_id"] = str(course["_id"])
        values["course_name"] = course["name"]
    lead = Lead(**values)
    doc = lead.to_mongo()
    if payload.status:
        doc["status"] = payload.status
    doc["tags"] = normalize_tags(doc.get("tags"))
    doc.update({"phone": phone, "created_by": ObjectId(user["id"]), "assigned_to": None,
                "team_id": None, "created_at": utcnow(), "updated_at": utcnow(),
                "last_action_at": utcnow(), "notes": []})
    if user["role"] == "telecaller":
        # A telecaller can only work their own leads, so keep what they add.
        doc.update({"assigned_to": ObjectId(user["id"]), "assigned_to_name": user["name"],
                    "team_id": ObjectId(user["team_id"]) if user.get("team_id") else None,
                    "assigned_at": utcnow(), "status": "assigned"})
    res = await db.leads.insert_one(doc)
    created = await db.leads.find_one({"_id": res.inserted_id})
    await log_activity("lead_created", user, created, f"source: {payload.source}")
    return serialize(created)


def normalize_payment_event(payload: dict) -> dict:
    def pick(source, *keys):
        if not isinstance(source, dict):
            return None
        normalized = {}
        for key, value in source.items():
            normalized[str(key).lower().replace("-", "_").replace(" ", "_")] = value
            normalized[str(key).lower().replace("-", "_").replace(" ", "_").rsplit(".", 1)[-1]] = value
        for key in keys:
            value = normalized.get(key.lower())
            if value not in (None, ""):
                return value
        return None

    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    data_object = data.get("object") if isinstance(data.get("object"), dict) else {}
    candidate_user = (payload.get("user") or payload.get("customer") or payload.get("user_details")
                      or payload.get("customer_details") or data.get("user") or data.get("customer")
                      or data.get("subscriber") or data.get("user_details")
                      or data.get("customer_details") or data_object.get("user")
                      or data_object.get("customer_details") or data_object or data)
    if not isinstance(candidate_user, dict):
        candidate_user = {}
    payment = payload.get("payment") or data.get("payment") or data_object.get("payment") or data_object or data
    if not isinstance(payment, dict):
        payment = {}
    address = candidate_user.get("address")
    if not isinstance(address, dict):
        address = {}

    def clean_text(value, maximum=240):
        if value is None or isinstance(value, (dict, list)):
            return None
        value = str(value).strip()
        return value[:maximum] if value else None

    full_name = clean_text(pick(candidate_user, "name", "full_name", "user_name", "customer_name"), 160)
    if not full_name:
        parts = [clean_text(pick(candidate_user, "first_name", "user_first_name", "customer_first_name"), 80),
                 clean_text(pick(candidate_user, "last_name", "user_last_name", "customer_last_name"), 80)]
        full_name = " ".join(part for part in parts if part) or None
    amount = pick(payment, "amount", "payment_amount", "total_amount", "amount_paid")
    try:
        amount = float(amount) if amount is not None else None
    except (TypeError, ValueError):
        amount = None

    return {
        "provider_event_id": clean_text(pick(payload, "event_id", "id")
                         or pick(data, "event_id", "id")
                         or pick(payment, "payment_id", "transaction_id"), 200),
        "event_type": clean_text(pick(payload, "event", "type", "event_type")
                      or pick(data, "event", "type", "event_type"), 120),
        "user": {
            "external_id": clean_text(pick(candidate_user, "id", "user_id", "customer_id", "sub_id"), 200),
            "name": full_name,
            "phone": clean_text(pick(candidate_user, "phone", "phone_number", "mobile", "mobile_number",
                                     "user_phone", "customer_phone", "customer_mobile", "contact_number", "number"), 40),
            "email": clean_text(pick(candidate_user, "email", "email_address", "user_email", "customer_email"), 254),
            "company": clean_text(pick(candidate_user, "company", "company_name", "user_company"), 160),
            "city": clean_text(pick(candidate_user, "city", "user_city", "customer_city"), 120),
            "state": clean_text(pick(candidate_user, "state", "user_state", "customer_state"), 100),
            "address": clean_text(address.get("line1") or address.get("address_line1")
                                  or candidate_user.get("address_line1"), 240),
            "postal_code": clean_text(address.get("postal_code") or address.get("zip")
                                       or candidate_user.get("postal_code") or candidate_user.get("zip"), 32),
            "country": clean_text(address.get("country") or candidate_user.get("country"), 100),
            "occupation": clean_text(pick(candidate_user, "occupation", "job_title"), 120),
        },
        "payment": {
            "status": clean_text(pick(payment, "payment_status", "status")
                                  or pick(payload, "payment_status"), 80),
            "amount": amount,
            "currency": clean_text(pick(payment, "currency") or pick(payload, "currency"), 12),
            "payment_id": clean_text(pick(payment, "payment_id", "transaction_id", "id"), 200),
            "order_id": clean_text(pick(payment, "order_id", "order_reference"), 200),
            "product": clean_text(pick(payment, "product_name", "product_type", "plan_name", "item_name", "description"), 200),
            "method": clean_text(pick(payment, "payment_method", "method"), 80),
            "paid_at": clean_text(pick(payment, "paid_at", "payment_date", "created_at"), 80),
        },
        "received_at": utcnow(),
        "lead_id": None,
        "lead_created_at": None,
    }


def extract_admin_records(payload: dict | list, collection_name: str) -> list:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in (collection_name, "items", "results", "records"):
        records = payload.get(key)
        if isinstance(records, list):
            return [item for item in records if isinstance(item, dict)]
        if isinstance(records, dict):
            nested_records = extract_admin_records(records, collection_name)
            if nested_records:
                return nested_records
    for key in ("data", "result", "payload", "response"):
        nested = payload.get(key)
        if isinstance(nested, (dict, list)):
            records = extract_admin_records(nested, collection_name)
            if records or isinstance(nested, list):
                return records
    return []


def normalize_vip_market_record(record: dict, record_type: str) -> dict:
    def normalize_key(key):
        return re.sub(r"(?<!^)(?=[A-Z])", "_", str(key)).lower().replace("-", "_").replace(" ", "_")

    def pick(sources, *keys):
        key_set = {normalize_key(key) for key in keys}
        for source in sources:
            if not isinstance(source, dict):
                continue

            def walk(node):
                if isinstance(node, dict):
                    for key, value in node.items():
                        normalized = normalize_key(key)
                        if normalized in key_set and value not in (None, ""):
                            return value
                        nested_value = walk(value)
                        if nested_value not in (None, ""):
                            return nested_value
                elif isinstance(node, list):
                    for item in node:
                        value = walk(item)
                        if value not in (None, ""):
                            return value
                return None

            found = walk(source)
            if found not in (None, ""):
                return found

        return None

    def parse_bool(value):
        if isinstance(value, bool):
            return value
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return bool(value)
        return str(value).strip().lower() in {"true", "1", "yes", "y", "enabled", "paid"}

    def parse_float(value):
        if value in (None, ""):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    member = record.get("member") or record.get("user") or record.get("customer") or record.get("buyer") or {}
    purchase = record.get("purchase") or record.get("payment") or record.get("order") or {}
    membership = record.get("membership") or record.get("plan") or {}
    user_sources = [member, record]
    detail_sources = [purchase, membership, record]
    full_name = pick(user_sources, "name", "full_name", "member_name", "customer_name", "buyer_name")
    if not full_name:
        first_name = pick(user_sources, "first_name", "given_name", "buyer_first_name")
        last_name = pick(user_sources, "last_name", "family_name", "surname", "buyer_last_name")
        full_name = " ".join(str(part).strip() for part in (first_name, last_name) if part) or None
    external_id = pick([record], "id", "_id", f"{record_type}_id", "record_id", "payment_id", "order_id")
    if external_id in (None, ""):
        encoded = json.dumps(record, sort_keys=True, default=str, separators=(",", ":"))
        external_id = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    amount = pick(detail_sources, "amount", "total_amount", "amount_paid", "paid_amount", "price", "total")
    try:
        amount = float(amount) if amount is not None else None
    except (TypeError, ValueError):
        amount = None
    address = pick(user_sources, "address")
    address_line = address.get("line1") or address.get("address_line1") if isinstance(address, dict) else address
    status = pick(detail_sources, "payment_status", "membership_status", "status", "state")
    verified_value = pick([record], "payment_verified", "is_verified", "verified")
    if isinstance(verified_value, bool):
        verified = verified_value
    elif verified_value is not None:
        verified = str(verified_value).strip().lower() in {"true", "1", "yes", "verified"}
    else:
        verified = str(status or "").strip().lower() in {"paid", "success", "successful", "completed", "verified"}
    contact_identifier = pick(user_sources, "contact_identifier", "contact")
    email = pick(user_sources, "email", "email_address", "buyer_email")
    phone = pick(user_sources, "phone", "phone_number", "mobile", "mobile_number", "contact_number", "buyer_phone")
    if contact_identifier and not email and "@" in str(contact_identifier):
        email = contact_identifier
    elif contact_identifier and not phone and not email:
        contact_digits = re.sub(r"\D", "", str(contact_identifier))
        if len(contact_digits) >= 10:
            phone = contact_identifier
    product = pick(detail_sources, "product_name", "product", "plan_name", "membership_name", "offering", "name", "title")
    source_data = record.get("source") if isinstance(record.get("source"), dict) else {}
    affiliate_data = record.get("affiliate") if isinstance(record.get("affiliate"), dict) else {}
    broker_data = record.get("broker") if isinstance(record.get("broker"), dict) else {}
    club_data = record.get("club") if isinstance(record.get("club"), dict) else {}
    membership_data = record.get("membership") if isinstance(record.get("membership"), dict) else {}
    deposit_data = record.get("deposit") if isinstance(record.get("deposit"), dict) else {}
    trading_data = record.get("trading") if isinstance(record.get("trading"), dict) else {}
    seller_ref_value = pick([source_data], "seller_name", "seller_ref", "seller_ref_name", "seller_or_ref",
                            "ref_name", "ref", "seller", "affiliate_name", "referrer_name", "name")
    seller_ref_value = seller_ref_value or pick(
        [affiliate_data], "seller_name", "name", "ref", "code", "username", "affiliate_name",
    )
    affiliate_value = record.get("affiliate")
    if seller_ref_value is None and isinstance(affiliate_value, str):
        seller_ref_value = affiliate_value
    seller_ref_value = seller_ref_value or pick(
        [record], "seller_name", "seller_ref", "seller_ref_name", "seller_or_ref", "ref_name",
        "claim_ref", "ref", "affiliate_name", "referrer_name", "referred_by_name",
        "source_name", "source_person", "partner_name", "agent_name",
    )
    seller_type_raw = pick([source_data], "type", "seller_type", "source_type") or pick(
        [record], "seller_type", "source_type", "channel_type", "lead_source_type",
        "referral_type", "affiliate_type", "direct_or_seller",
    )
    if seller_type_raw is None:
        seller_type_raw = pick([record], "utm_source")
    if seller_type_raw is None and seller_ref_value not in (None, ""):
        seller_type_raw = seller_ref_value
    source_value = str(seller_type_raw or "").strip().lower() if seller_type_raw is not None else ""
    seller_type = None
    if source_value in {"seller", "referral", "affiliate", "partner", "agent", "dealer"}:
        seller_type = "seller"
    elif source_value in {"direct", "self", "organic", "direct_source", "manual", "none", "no_referral"}:
        seller_type = "direct"
    elif source_value:
        seller_type = "seller" if "seller" in source_value or "affiliate" in source_value or "ref" in source_value else "direct" if "direct" in source_value else None
    if source_value in {"direct", "self", "organic", "direct_source", "manual", "none", "no_referral"}:
        seller_type = "direct"
    elif not seller_ref_value or seller_type is None:
        seller_type = "seller" if seller_ref_value else "direct"
    seller_name = seller_ref_value if seller_type == "seller" else None
    new_broker = pick([broker_data], "new", "new_broker", "new_broker_name") or pick(
        [record], "new_broker_name", "new_broker", "broker_name_new", "broker_new",
    )
    current_broker = pick([broker_data], "current", "current_broker", "current_broker_name") or pick(
        [record], "current_broker_name", "current_broker", "existing_broker", "broker_name_current",
    )
    broker_name = pick([broker_data], "name", "broker_name", "broker") or pick(
        [record], "broker_name", "broker", "broker_used",
    )
    broker_unique_id = pick([broker_data], "unique_id", "broker_unique_id", "client_id", "account_id") or pick(
        [record], "broker_unique_id", "broker_client_id", "broker_account_id", "client_id",
    )
    deposit_made = parse_bool(pick([deposit_data], "made", "deposit_made", "paid"))
    if deposit_made is None:
        deposit_made = parse_bool(pick([record], "deposit_made", "has_deposit", "deposit_made_flag", "deposit_paid", "made_deposit"))
    deposit_amount = parse_float(pick([deposit_data], "amount", "deposit_amount", "value"))
    if deposit_amount is None:
        deposit_amount = parse_float(pick([record], "deposit_amount", "deposit_amt", "deposit_value", "broker_deposit_amount"))
    trading_mode_raw = pick([trading_data], "mode", "trading_mode", "type") or pick(
        [record], "trading_mode", "trade_mode", "trading_style", "self_or_group",
    )
    trading_mode = None
    if trading_mode_raw is not None:
        mode_value = str(trading_mode_raw).strip().lower()
        if mode_value in {"self", "solo"}:
            trading_mode = "self"
        elif mode_value in {"group", "team"}:
            trading_mode = "group"
        elif mode_value in {"both", "self_and_group", "self_group", "self+group"}:
            trading_mode = "both"
    event_id = f"vip-market:{record_type}:{external_id}"
    return {
        "provider_event_id": event_id,
        "event_type": f"vip_market.{record_type}",
        "source_record_type": record_type,
        "source_record_id": str(external_id),
        "verified": verified,
        "user": {
            "external_id": str(pick(user_sources, "id", "user_id", "member_id", "customer_id", "telegram_user_id") or external_id),
            "name": str(full_name).strip()[:160] if full_name else None,
            "phone": str(phone or "").strip()[:40] or None,
            "email": str(email or "").strip()[:254] or None,
            "company": str(pick(user_sources, "company", "company_name") or "").strip()[:160] or None,
            "city": str(pick(user_sources, "city") or "").strip()[:120] or None,
            "state": str(pick(user_sources, "state", "province") or "").strip()[:100] or None,
            "address": str(address_line or "").strip()[:240] or None,
            "postal_code": str(pick(user_sources, "postal_code", "zip", "zip_code") or "").strip()[:32] or None,
            "country": str(pick(user_sources, "country") or "").strip()[:100] or None,
            "occupation": str(pick(user_sources, "occupation", "job_title") or "").strip()[:120] or None,
        },
        "payment": {
            "status": str(status).strip()[:80] if status is not None else None,
            "amount": amount,
            "currency": str(pick(detail_sources, "currency") or "").strip()[:12] or None,
            "payment_id": str(pick(detail_sources, "payment_id", "transaction_id") or "").strip()[:200] or None,
            "order_id": str(pick(detail_sources, "order_id", "order_reference") or "").strip()[:200] or None,
            "product": str(product).strip()[:200] if product is not None else record_type.title(),
            "method": str(pick(detail_sources, "payment_method", "method") or "").strip()[:80] or None,
            "paid_at": str(pick(detail_sources, "paid_at", "payment_date", "purchased_at", "created_at", "received_at") or "").strip()[:80] or None,
        },
        "club": {
            "offering": str(pick([record], "offering") or "").strip()[:200] or None,
            "event": str(pick([record], "event") or "").strip()[:200] or None,
            "claimed_market": str(pick([record], "claimed_market", "market") or "").strip()[:120] or None,
            "affiliate": str(pick([record], "affiliate_name", "affiliate") or "").strip()[:160] or None,
            "transaction_id": str(pick([record], "transaction_id") or "").strip()[:200] or None,
            "verification_reason": str(pick([record], "verification_reason") or "").strip()[:240] or None,
            "joined_at": str(pick([club_data, membership_data, record], "joined_at", "joining_date", "joined", "join_date", "joined_on", "membership_start_date", "start_date", "starts_at", "activated_at") or "").strip()[:80] or None,
            "expires_at": str(pick([club_data, membership_data, record], "expires_at", "expired_at", "expiry_at", "expiry", "expiry_date", "expires_on", "expiration_date", "valid_until", "membership_end_date", "end_date") or "").strip()[:80] or None,
            "used_at": str(pick([record], "used_at") or "").strip()[:80] or None,
            "broker_name": str(broker_name or "").strip()[:120] or None,
            "broker_unique_id": str(broker_unique_id or "").strip()[:160] or None,
            "seller_type": seller_type,
            "seller_name": str(seller_name or "").strip()[:160] or None,
            "new_broker_name": str(new_broker or "").strip()[:120] or None,
            "current_broker_name": str(current_broker or "").strip()[:120] or None,
            "deposit_made": deposit_made,
            "deposit_amount": deposit_amount,
            "trading_mode": trading_mode,
        },
        "received_at": utcnow(),
        "lead_id": None,
        "lead_created_at": None,
    }


def filter_verified_vip_records(records: list, record_type: str) -> list:
    return [record for record in records
            if normalize_vip_market_record(record, record_type).get("verified") is True]


def enrich_vip_membership_contacts(memberships: list, purchases: list) -> None:
    purchases_by_contact = {}
    memberships_by_contact = {}
    for purchase in purchases:
        contact = purchase.get("user") or {}
        email = str(contact.get("email") or "").strip().lower()
        phone = re.sub(r"\D", "", str(contact.get("phone") or ""))
        if email:
            purchases_by_contact.setdefault(("email", email), contact)
        if len(phone) >= 10:
            purchases_by_contact.setdefault(("phone", phone[-10:]), contact)

    for membership in memberships:
        user = membership.get("user") or {}
        email = str(user.get("email") or "").strip().lower()
        phone = re.sub(r"\D", "", str(user.get("phone") or ""))
        purchase = (purchases_by_contact.get(("email", email)) if email else None)
        purchase = purchase or (purchases_by_contact.get(("phone", phone[-10:])) if len(phone) >= 10 else None)
        if not user.get("name") and purchase and purchase.get("name"):
            user["name"] = purchase["name"]
            user["email"] = user.get("email") or purchase.get("email")
            user["phone"] = user.get("phone") or purchase.get("phone")
        if email:
            memberships_by_contact.setdefault(("email", email), membership)
        if len(phone) >= 10:
            memberships_by_contact.setdefault(("phone", phone[-10:]), membership)

    for purchase in purchases:
        contact = purchase.get("user") or {}
        email = str(contact.get("email") or "").strip().lower()
        phone = re.sub(r"\D", "", str(contact.get("phone") or ""))
        membership = (memberships_by_contact.get(("email", email)) if email else None)
        membership = membership or (memberships_by_contact.get(("phone", phone[-10:])) if len(phone) >= 10 else None)
        if not membership:
            continue
        membership_club = membership.get("club") or {}
        purchase_club = purchase.setdefault("club", {})
        for field in ("joined_at", "expires_at"):
            if membership_club.get(field):
                purchase_club[field] = membership_club[field]


async def enrich_stored_vip_membership_dates(purchases: Optional[list] = None) -> list:
    memberships = await db.payment_club_events.find({"source_record_type": "memberships"}).sort(
        [("club.expires_at", -1), ("club.joined_at", -1), ("received_at", -1)],
    ).to_list(10000)
    if purchases is None:
        purchases = await db.payment_club_events.find({
            "source_record_type": "purchases", "verified": True,
        }).to_list(10000)
    enrich_vip_membership_contacts(memberships, purchases)
    event_updates = []
    lead_date_updates = []
    for purchase in purchases:
        club = purchase.get("club") or {}
        date_updates = {}
        for field in ("joined_at", "expires_at"):
            if club.get(field):
                date_updates[f"club.{field}"] = club[field]
                date_updates[f"member_profile.{field}"] = club[field]
        if not date_updates:
            continue
        # Only persist when the stored dates actually changed so repeated polling stays a no-op.
        stored_mp = purchase.get("member_profile") or {}
        changed = any(stored_mp.get(field) != club[field]
                      for field in ("joined_at", "expires_at") if club.get(field))
        purchase.setdefault("member_profile", {}).update({
            field: club[field] for field in ("joined_at", "expires_at") if club.get(field)
        })
        if not changed:
            continue
        event_updates.append(UpdateOne({"_id": purchase["_id"]}, {"$set": date_updates}))
        if purchase.get("lead_id"):
            lead_fields = {key: value for key, value in {
                "club_joined_at": club.get("joined_at"),
                "club_expires_at": club.get("expires_at"),
            }.items() if value}
            if lead_fields:
                lead_date_updates.append(UpdateOne({"_id": purchase["lead_id"]}, {"$set": lead_fields}))
    # Batch all writes into a single round-trip each (was one update_one per purchase -> 524 timeouts in prod).
    if event_updates:
        await db.payment_club_events.bulk_write(event_updates, ordered=False)
    if lead_date_updates:
        await db.leads.bulk_write(lead_date_updates, ordered=False)
    return purchases


async def fetch_vip_market_records(client_http: httpx.AsyncClient, record_type: str,
                                   max_pages: Optional[int] = None) -> tuple[list, Optional[str]]:
    async def fetch_page(page: int):
        response = await client_http.get(
            f"{VIP_MARKET_ADMIN_URL}/{record_type}",
            headers={"X-Admin-Key": ADMIN_PANEL_KEY},
            params={"page": page, "per_page": 50},
        )
        response.raise_for_status()
        return response.json()

    try:
        first_page = await fetch_page(1)
        records = extract_admin_records(first_page, record_type)
        pagination = first_page.get("pagination", {}) if isinstance(first_page, dict) else {}
        total_pages = max(1, int(pagination.get("pages", 1))) if isinstance(pagination, dict) else 1
        if max_pages is not None:
            total_pages = min(total_pages, max_pages)
        for start_page in range(2, total_pages + 1, 5):
            page_numbers = range(start_page, min(start_page + 5, total_pages + 1))
            page_payloads = await asyncio.gather(*(fetch_page(page) for page in page_numbers))
            for payload in page_payloads:
                records.extend(extract_admin_records(payload, record_type))
    except httpx.HTTPStatusError as exc:
        return [], f"Source returned HTTP {exc.response.status_code}"
    except httpx.TimeoutException:
        return [], "Source request timed out"
    except (httpx.RequestError, ValueError):
        return [], "Source is unavailable or returned invalid data"
    return records, None


async def sync_vip_market_records(client_http: httpx.AsyncClient, record_type: str,
                                  verified_only: bool = False,
                                  max_pages: Optional[int] = None) -> tuple[list, Optional[str]]:
    records, error = await fetch_vip_market_records(client_http, record_type, max_pages)
    if error:
        return [], error
    if verified_only:
        records = filter_verified_vip_records(records, record_type)

    events = [normalize_vip_market_record(record, record_type) for record in records]
    if not events:
        return [], None
    operations = [
        UpdateOne(
            {"provider_event_id": event["provider_event_id"]},
            {
                "$set": {key: value for key, value in event.items()
                         if key not in {"provider_event_id", "lead_id", "lead_created_at", "received_at"}},
                "$setOnInsert": {
                    "provider_event_id": event["provider_event_id"],
                    "received_at": event["received_at"],
                    "lead_id": None,
                    "lead_created_at": None,
                },
            },
            upsert=True,
        )
        for event in events
    ]
    await db.payment_club_events.bulk_write(operations, ordered=False)
    event_ids = [event["provider_event_id"] for event in events]
    stored_records = await db.payment_club_events.find(
        {"provider_event_id": {"$in": event_ids}},
    ).to_list(len(event_ids))
    stored_by_id = {event["provider_event_id"]: event for event in stored_records}
    return [serialize(stored_by_id[event_id]) for event_id in event_ids if event_id in stored_by_id], None


_vip_market_source_sync_lock = asyncio.Lock()


async def refresh_50_cr_club_source_data(recent_only: bool = False) -> None:
    if not ADMIN_PANEL_KEY or _vip_market_source_sync_lock.locked():
        return
    async with _vip_market_source_sync_lock:
        started_at = asyncio.get_running_loop().time()
        settings_query = {"_id": "50_cr_club_source_sync"}
        await db.settings.update_one(
            settings_query,
            {"$set": {"last_attempt_at": utcnow(), "errors": {}}},
            upsert=True,
        )
        max_pages = 1 if recent_only else None
        errors = {}
        purchases = ([], None)
        memberships = ([], None)
        try:
            async with httpx.AsyncClient(timeout=VIP_MARKET_TIMEOUT_SECONDS) as client_http:
                purchases = await sync_vip_market_records(client_http, "purchases", max_pages=max_pages)
                memberships = await sync_vip_market_records(client_http, "memberships", max_pages=max_pages)
            if purchases[1]:
                errors["purchases"] = purchases[1]
            if memberships[1]:
                errors["memberships"] = memberships[1]
        except Exception:
            logger.exception("50 Cr Club VIP Market background sync failed")
            errors["provider"] = "Source sync failed unexpectedly"

        sync_update = {"errors": errors}
        if not errors:
            sync_update["last_success_at"] = utcnow()
        await db.settings.update_one(settings_query, {"$set": sync_update}, upsert=True)
        logger.info(
            "50 Cr Club VIP Market sync finished in %.1fs (recent_only=%s, purchases=%d, memberships=%d, errors=%s)",
            asyncio.get_running_loop().time() - started_at,
            recent_only,
            len(purchases[0]),
            len(memberships[0]),
            errors,
        )


def find_verified_purchase_match(lead: dict, purchases: list) -> Optional[dict]:
    lead_email = str(lead.get("email") or "").strip().lower()
    lead_phone = re.sub(r"\D", "", str(lead.get("phone") or ""))
    lead_phone = lead_phone[-10:] if len(lead_phone) >= 10 else ""
    if not lead_email and not lead_phone:
        return None
    for purchase in purchases:
        if purchase.get("source_record_type") != "purchases" or purchase.get("verified") is not True:
            continue
        contact = purchase.get("user") or {}
        purchase_email = str(contact.get("email") or "").strip().lower()
        purchase_phone = re.sub(r"\D", "", str(contact.get("phone") or ""))
        purchase_phone = purchase_phone[-10:] if len(purchase_phone) >= 10 else ""
        email_matches = bool(lead_email and purchase_email and lead_email == purchase_email)
        phone_matches = bool(lead_phone and purchase_phone and lead_phone == purchase_phone)
        email_conflicts = bool(lead_email and purchase_email and not email_matches)
        phone_conflicts = bool(lead_phone and purchase_phone and not phone_matches)
        if (email_matches or phone_matches) and not (email_conflicts or phone_conflicts):
            return purchase
    return None


async def resolve_verified_purchase_for_conversion(lead: dict) -> tuple[Optional[dict], bool]:
    source_checked = False
    sync_state = await db.settings.find_one({"_id": "50_cr_club_purchase_sync"})
    last_success = aware(sync_state.get("last_success_at")) if sync_state else None
    if last_success and utcnow() - last_success < timedelta(minutes=5):
        source_checked = True
    elif ADMIN_PANEL_KEY:
        async with httpx.AsyncClient(timeout=20.0) as client_http:
            _, sync_error = await sync_vip_market_records(client_http, "purchases")
        source_checked = sync_error is None
        if source_checked:
            async with httpx.AsyncClient(timeout=20.0) as client_http:
                await sync_vip_market_records(client_http, "memberships")
            await db.settings.update_one(
                {"_id": "50_cr_club_purchase_sync"},
                {"$set": {"last_success_at": utcnow()}},
                upsert=True,
            )
    purchases = await db.payment_club_events.find({
        "source_record_type": "purchases", "verified": True,
    }).sort([("payment.paid_at", -1), ("received_at", -1)]).to_list(10000)
    purchases = await enrich_stored_vip_membership_dates(purchases)
    return find_verified_purchase_match(lead, purchases), source_checked


def build_club_member_profile_snapshot(lead: Optional[dict], member_profile: Optional[dict] = None) -> dict:
    snapshot = {
        "broker_name": lead.get("broker_name") if lead else None,
        "broker_unique_id": lead.get("broker_unique_id") if lead else None,
        "broker_account_status": lead.get("broker_account_status") if lead else None,
        "new_broker_name": lead.get("new_broker_name") if lead else None,
        "current_broker_name": lead.get("current_broker_name") if lead else None,
        "club_seller_type": lead.get("club_seller_type") if lead else None,
        "club_seller_name": lead.get("club_seller_name") if lead else None,
        "deposit_made": lead.get("deposit_made") if lead else None,
        "deposit_amount": lead.get("deposit_amount") if lead else None,
        "trading_mode": lead.get("trading_mode") if lead else None,
        "expected_group_profit": lead.get("expected_group_profit") if lead else None,
        "product_in_use": lead.get("product_in_use") if lead else None,
        "membership_enabled": lead.get("membership_enabled") if lead else None,
        "follow_up_routine": lead.get("follow_up_routine") if lead else None,
        "next_follow_up_at": lead.get("club_next_follow_up_at") if lead else None,
        "joined_at": lead.get("club_joined_at") if lead else None,
        "expires_at": lead.get("club_expires_at") if lead else None,
    }
    if member_profile:
        for key, value in (member_profile or {}).items():
            if value is not None:
                snapshot[key] = value
    return snapshot


def club_source_lead_updates(event: dict) -> dict:
    club = event.get("club") or {}
    return {
        key: value for key, value in {
            "broker_name": club.get("broker_name"),
            "broker_unique_id": club.get("broker_unique_id"),
            "club_joined_at": club.get("joined_at"),
            "club_expires_at": club.get("expires_at"),
            "club_seller_type": club.get("seller_type"),
            "club_seller_name": club.get("seller_name"),
            "new_broker_name": club.get("new_broker_name"),
            "current_broker_name": club.get("current_broker_name"),
            "deposit_made": club.get("deposit_made"),
            "deposit_amount": club.get("deposit_amount"),
            "trading_mode": club.get("trading_mode"),
        }.items() if value is not None
    }


async def prepare_50_cr_club_conversion(lead: dict, user: dict, now: datetime) -> tuple[dict, Optional[dict]]:
    if user.get("role") != "telecaller" or not user.get("is_50_cr_club_rm", False):
        return {}, None
    purchase, source_checked = await resolve_verified_purchase_for_conversion(lead)
    if not purchase:
        return ({"conversion_source": "direct"} if source_checked else {}), None
    payment = purchase.get("payment") or {}
    updates = {
        "conversion_status": "approved",
        "conversion_source": "50_cr_club",
        "conversion_approved_at": now,
        "conversion_approved_by": None,
        "conversion_auto_approved": True,
        "conversion_approval_reason": "verified_50_cr_club_payment",
    }
    amount = payment.get("amount")
    if isinstance(amount, (int, float)) and math.isfinite(amount) and amount > 0:
        updates["ticket_size"] = amount
    return updates, purchase


async def link_verified_purchase_to_conversion(lead: dict, purchase: Optional[dict], user: dict,
                                               now: datetime) -> None:
    if not purchase:
        return
    club = purchase.get("club") or {}
    lead_updates = {
        "tags": "50-cr-club",
        "club_seller_type": club.get("seller_type") or lead.get("club_seller_type"),
        "club_seller_name": club.get("seller_name") or lead.get("club_seller_name"),
        "broker_name": club.get("broker_name") or lead.get("broker_name"),
        "broker_unique_id": club.get("broker_unique_id") or lead.get("broker_unique_id"),
        "club_joined_at": club.get("joined_at") or lead.get("club_joined_at"),
        "club_expires_at": club.get("expires_at") or lead.get("club_expires_at"),
        "new_broker_name": club.get("new_broker_name") or lead.get("new_broker_name"),
        "current_broker_name": club.get("current_broker_name") or lead.get("current_broker_name"),
        "deposit_made": club.get("deposit_made") if club.get("deposit_made") is not None else lead.get("deposit_made"),
        "deposit_amount": club.get("deposit_amount") if club.get("deposit_amount") is not None else lead.get("deposit_amount"),
        "trading_mode": club.get("trading_mode") or lead.get("trading_mode"),
    }
    lead_updates = {key: value for key, value in lead_updates.items() if value is not None}
    event_updates = {"lead_id": lead["_id"], "lead_created_at": purchase.get("lead_created_at") or now}
    if purchase.get("lead_id") and purchase["lead_id"] != lead["_id"]:
        event_updates["previous_lead_id"] = purchase["lead_id"]
    await db.payment_club_events.update_one({"_id": purchase["_id"]}, {"$set": event_updates})
    if lead_updates:
        await db.leads.update_one({"_id": lead["_id"]}, {"$addToSet": {"tags": "50-cr-club"}, "$set": lead_updates})
    else:
        await db.leads.update_one({"_id": lead["_id"]}, {"$addToSet": {"tags": "50-cr-club"}})
    await log_activity(
        "conversion_auto_approved", user, lead,
        f"Verified 50 Cr Club payment matched ({purchase.get('provider_event_id') or purchase['_id']})",
    )


@api.post("/payments/webhooks/50-cr-club")
async def receive_50_cr_club_payment(request: Request):
    if not PAYMENT_WEBHOOK_TOKEN:
        raise HTTPException(status_code=503, detail="Payment webhook is not configured")
    provided = request.headers.get("X-Webhook-Token", "")
    if not hmac.compare_digest(provided, PAYMENT_WEBHOOK_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid webhook token")
    try:
        content_type = request.headers.get("content-type", "").lower()
        if "application/json" in content_type:
            payload = await request.json()
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            payload = {key: value for key, value in (await request.form()).items()
                       if isinstance(value, str)}
        else:
            raise HTTPException(status_code=415, detail="Expected JSON or key-value form data")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payment webhook payload")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object")
    event = normalize_payment_event(payload)
    provider_event_id = event.get("provider_event_id")
    if provider_event_id:
        existing = await db.payment_club_events.find_one({"provider_event_id": provider_event_id})
        if existing:
            return {"ok": True, "event_id": str(existing["_id"]), "duplicate": True}
    result = await db.payment_club_events.insert_one(event)
    return {"ok": True, "event_id": str(result.inserted_id), "duplicate": False}


@api.get("/payments/50-cr-club/brokers")
async def get_50_cr_club_brokers(user: dict = Depends(current_user)):
    settings = await db.settings.find_one({"_id": "50_cr_club_brokers"}) or {}
    return {"brokers": settings.get("brokers", [])}


@api.put("/payments/50-cr-club/brokers")
async def update_50_cr_club_brokers(payload: ClubBrokerListUpdate, user: dict = Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can manage broker choices")
    brokers = []
    seen = set()
    for value in payload.brokers:
        broker = " ".join(value.split())
        key = broker.casefold()
        if broker and key not in seen:
            if len(broker) > 120:
                raise HTTPException(status_code=400, detail="Broker names must be 120 characters or less")
            brokers.append(broker)
            seen.add(key)
    await db.settings.update_one(
        {"_id": "50_cr_club_brokers"},
        {"$set": {"brokers": brokers, "updated_at": utcnow(), "updated_by": user["id"]}},
        upsert=True,
    )
    return {"brokers": brokers}


@api.get("/payments/50-cr-club/source-data")
async def get_50_cr_club_source_data(background_tasks: BackgroundTasks,
                                    recent_only: bool = Query(False), report_only: bool = Query(False),
                                    user: dict = Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not permitted")
    errors = {}
    sync_status = await db.settings.find_one({"_id": "50_cr_club_source_sync"}) or {}
    errors.update(sync_status.get("errors") or {})
    if ADMIN_PANEL_KEY and not report_only:
        background_tasks.add_task(refresh_50_cr_club_source_data, recent_only)
    elif not ADMIN_PANEL_KEY and not report_only:
        errors["configuration"] = "ADMIN_PANEL_KEY is not configured on the backend"
    purchase_query = {"source_record_type": "purchases", "verified": True}
    stored_purchases = await db.payment_club_events.find(purchase_query).sort(
        [("payment.paid_at", -1), ("received_at", -1)],
    ).to_list(10000)
    stored_purchases = await enrich_stored_vip_membership_dates(stored_purchases)
    purchase_records = [serialize(record) for record in stored_purchases]
    stored_memberships = await db.payment_club_events.find({"source_record_type": "memberships"}).sort(
        [("club.joined_at", -1), ("received_at", -1)],
    ).to_list(10000)
    membership_records = [serialize(record) for record in stored_memberships]
    enrich_vip_membership_contacts(membership_records, purchase_records)
    purchase_ids = [record["_id"] for record in stored_purchases]
    linked_lead_ids = [oid(record["lead_id"]) for record in purchase_records if record.get("lead_id")]
    linked_leads = await db.leads.find({"_id": {"$in": linked_lead_ids}}).to_list(len(linked_lead_ids)) if linked_lead_ids else []
    linked_leads_by_id = {str(lead["_id"]): lead for lead in linked_leads}
    call_counts = {}
    last_calls = {}
    if purchase_ids:
        calls = await db.call_attempts.find({"payment_club_event_id": {"$in": purchase_ids}}).sort("created_at", -1).to_list(50000)
        for call in calls:
            event_id = str(call["payment_club_event_id"])
            call_counts[event_id] = call_counts.get(event_id, 0) + 1
            last_calls.setdefault(event_id, call)
    for record in purchase_records:
        record["call_count"] = call_counts.get(record.get("id"), 0)
        last_call = last_calls.get(record.get("id"))
        record["last_dialed_at"] = last_call.get("created_at") if last_call else None
        record["last_dialed_by"] = last_call.get("user_name") if last_call else None
        linked_lead = linked_leads_by_id.get(record.get("lead_id"))
        assigned_id = record.get("assigned_to_id") or (linked_lead.get("assigned_to") if linked_lead else None)
        record["assigned_to_name"] = record.get("assigned_to_name") or (linked_lead.get("assigned_to_name") if linked_lead else None)
        record["assigned_to_id"] = str(assigned_id) if assigned_id else None
        record["club_status"] = record.get("club_status") or ("assigned" if assigned_id else "unassigned")
        record["crm_lead"] = serialize(linked_lead) if linked_lead else None
        if linked_lead:
            record["member_profile"] = build_club_member_profile_snapshot(
                linked_lead,
                record.get("member_profile") or {},
            )
        else:
            record["member_profile"] = {
                "broker_name": record.get("club", {}).get("broker_name"),
                "broker_unique_id": record.get("club", {}).get("broker_unique_id"),
                "joined_at": record.get("club", {}).get("joined_at"),
                "expires_at": record.get("club", {}).get("expires_at"),
                "club_seller_type": record.get("club", {}).get("seller_type"),
                "club_seller_name": record.get("club", {}).get("seller_name"),
                "new_broker_name": record.get("club", {}).get("new_broker_name"),
                "current_broker_name": record.get("club", {}).get("current_broker_name"),
                "deposit_made": record.get("club", {}).get("deposit_made"),
                "deposit_amount": record.get("club", {}).get("deposit_amount"),
                "trading_mode": record.get("club", {}).get("trading_mode"),
                **(record.get("member_profile") or {}),
            }
    telecaller_ids = [member["_id"] for member in await db.users.find(
        {"role": "telecaller", "removed": {"$ne": True}}, {"_id": 1},
    ).to_list(500)]
    club_leads = await db.leads.find({
        "tags": "50-cr-club",
        "status": "converted",
        "conversion_status": {"$in": ["pending", "approved"]},
        "assigned_to": {"$in": telecaller_ids},
    }).to_list(10000) if telecaller_ids else []
    club_lead_ids = [lead["_id"] for lead in club_leads]
    if club_lead_ids:
        source_events = await db.payment_club_events.find({
            "source_record_type": "purchases", "verified": True,
            "lead_id": {"$in": club_lead_ids},
        }).sort([("payment.paid_at", -1), ("received_at", -1)]).to_list(10000)
        source_by_lead = {}
        for event in source_events:
            source_by_lead.setdefault(str(event["lead_id"]), event)
        for lead in club_leads:
            source = source_by_lead.get(str(lead["_id"]))
            if source:
                lead.update({key: value for key, value in club_source_lead_updates(source).items()
                             if value is not None and lead.get(key) is None})
    club_call_counts = {}
    if club_lead_ids:
        call_rows = await db.call_attempts.aggregate([
            {"$match": {"lead_id": {"$in": club_lead_ids}}},
            {"$group": {"_id": "$lead_id", "count": {"$sum": 1}}},
        ]).to_list(len(club_lead_ids))
        club_call_counts = {str(row["_id"]): row["count"] for row in call_rows}
    for lead in club_leads:
        lead["assigned_to_id"] = str(lead.get("assigned_to")) if lead.get("assigned_to") else None
        lead["club_call_count"] = club_call_counts.get(str(lead["_id"]), 0)
    return {
        "configured": bool(ADMIN_PANEL_KEY),
        "memberships": membership_records,
        "purchases": purchase_records,
        "club_leads": [serialize(lead) for lead in club_leads],
        "verified_count": await db.payment_club_events.count_documents({
            "source_record_type": "purchases", "verified": True,
        }),
        "errors": errors,
    }


@api.get("/payments/50-cr-club/users")
async def list_50_cr_club_users(limit: int = Query(200, ge=1, le=500),
                                user: dict = Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not permitted")
    events = await db.payment_club_events.find({"source_record_type": {"$exists": False}}).sort("received_at", -1).to_list(limit)
    return {
        "items": [serialize(event) for event in events],
        "webhook_configured": bool(PAYMENT_WEBHOOK_TOKEN),
    }


@api.get("/payments/50-cr-club/my-leads")
async def list_my_50_cr_club_leads(background_tasks: BackgroundTasks,
                                   club_status: Optional[str] = Query(None, pattern="^(unworked|contacted|follow_up|enrolled|not_interested|lost)$"),
                                   page: int = Query(1, ge=1),
                                   limit: int = Query(5000, ge=1, le=5000),
                                   user: dict = Depends(current_user)):
    if user["role"] != "telecaller":
        raise HTTPException(status_code=403, detail="Telecaller access only")
    if not user.get("is_50_cr_club_rm", False):
        raise HTTPException(status_code=403, detail="Only assigned 50 Cr Club RMs can access this page")
    if ADMIN_PANEL_KEY:
        background_tasks.add_task(refresh_50_cr_club_source_data, True)
    assigned_leads = await db.leads.find(
        {"assigned_to": ObjectId(user["id"]), "tags": "50-cr-club"},
        {"name": 1, "phone": 1, "email": 1, "status": 1, "assigned_to_name": 1},
    ).to_list(5000)
    leads_by_id = {str(lead["_id"]): lead for lead in assigned_leads}
    lead_ids = [lead["_id"] for lead in assigned_leads]
    assignment_scope = [{"assigned_to_id": ObjectId(user["id"])}]
    if lead_ids:
        assignment_scope.extend([
            {"lead_id": {"$in": lead_ids}, "assigned_to_id": {"$exists": False}},
            {"lead_id": {"$in": lead_ids}, "assigned_to_id": None},
        ])
    event_query = {
        "source_record_type": "purchases",
        "$and": [
            {"verified": True},
            {"$or": assignment_scope},
        ],
    }
    if club_status:
        event_query["$and"].append({"$or": [
            {"club_status": club_status},
            {"club_status": {"$exists": False}} if club_status == "unworked" else {"_id": None},
        ]})
    total = await db.payment_club_events.count_documents(event_query)
    events = await db.payment_club_events.find(event_query).sort(
        [("payment.paid_at", -1), ("received_at", -1)],
    ).skip((page - 1) * limit).limit(limit).to_list(limit)
    events = await enrich_stored_vip_membership_dates(events)
    event_ids = [event["_id"] for event in events]
    event_lead_ids = list({event["lead_id"] for event in events if event.get("lead_id")})
    call_counts, latest_calls = {}, {}
    event_ids_by_lead = {}
    for event in events:
        if event.get("lead_id"):
            event_ids_by_lead.setdefault(str(event["lead_id"]), []).append(str(event["_id"]))
    call_pipeline = [{"$match": {
        "user_id": ObjectId(user["id"]),
        "$or": [
            {"payment_club_event_id": {"$in": event_ids}},
            {"lead_id": {"$in": event_lead_ids}} if event_lead_ids else {"_id": None},
        ],
    }}, {"$group": {
        "_id": {"$cond": [
            {"$ifNull": ["$payment_club_event_id", False]},
            {"$concat": ["event:", {"$toString": "$payment_club_event_id"}]},
            {"$concat": ["lead:", {"$toString": "$lead_id"}]},
        ]},
        "count": {"$sum": 1},
        "last_dialed_at": {"$max": "$created_at"},
    }}]
    call_stats = await db.call_attempts.aggregate(call_pipeline).to_list(len(event_ids) + len(event_lead_ids)) if event_ids else []
    for stat in call_stats:
        key = stat["_id"]
        if key.startswith("event:"):
            linked_event_ids = [key[6:]]
        else:
            linked_event_ids = event_ids_by_lead.get(key[5:], [])
        for event_id in linked_event_ids:
            call_counts[event_id] = call_counts.get(event_id, 0) + stat["count"]
            latest = latest_calls.get(event_id)
            if latest is None or stat["last_dialed_at"] > latest:
                latest_calls[event_id] = stat["last_dialed_at"]

    items = []
    for event in events:
        lead = leads_by_id.get(str(event.get("lead_id")))
        item = serialize(event)
        item["crm_lead"] = serialize(lead) if lead else None
        source_profile = {
            "club_seller_type": item.get("club", {}).get("seller_type"),
            "club_seller_name": item.get("club", {}).get("seller_name"),
            "broker_name": item.get("club", {}).get("broker_name"),
            "broker_unique_id": item.get("club", {}).get("broker_unique_id"),
            "joined_at": item.get("club", {}).get("joined_at"),
            "expires_at": item.get("club", {}).get("expires_at"),
            "new_broker_name": item.get("club", {}).get("new_broker_name"),
            "current_broker_name": item.get("club", {}).get("current_broker_name"),
            "deposit_made": item.get("club", {}).get("deposit_made"),
            "deposit_amount": item.get("club", {}).get("deposit_amount"),
            "trading_mode": item.get("club", {}).get("trading_mode"),
            **(item.get("member_profile") or {}),
        }
        item["member_profile"] = build_club_member_profile_snapshot(lead, source_profile)
        item["assigned_to_id"] = str(event.get("assigned_to_id") or user["id"])
        item["assigned_to_name"] = event.get("assigned_to_name") or user.get("name")
        item["club_status"] = event.get("club_status") or "unworked"
        item["call_count"] = call_counts.get(str(event["_id"]), 0)
        item["last_dialed_at"] = latest_calls.get(str(event["_id"]))
        items.append(item)
    return {"items": items, "total": total, "page": page, "limit": limit}


def build_club_monthly_revenue_report(events: list, current_month: Optional[str] = None) -> dict:
    dated_events = []
    for event in events:
        payment = event.get("payment") or {}
        raw_date = payment.get("paid_at") or event.get("received_at")
        if isinstance(raw_date, datetime):
            paid_date = raw_date
        else:
            try:
                paid_date = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                continue
        if paid_date.tzinfo is None:
            paid_date = paid_date.replace(tzinfo=timezone.utc)
        paid_date = paid_date.astimezone(TEAM_TZ)
        payment_month = paid_date.strftime("%Y-%m")
        contact = event.get("user") or {}
        lead_id = event.get("lead_id")
        client_keys = []
        if lead_id:
            client_keys.append(f"lead:{lead_id}")
        if contact.get("external_id"):
            client_keys.append(f"external:{contact['external_id']}")
        if contact.get("email"):
            client_keys.append(f"email:{str(contact['email']).strip().casefold()}")
        normalized_phone = re.sub(r"\D", "", str(contact.get("phone") or ""))
        if len(normalized_phone) >= 10:
            normalized_phone = normalized_phone[-10:]
        if normalized_phone:
            client_keys.append(f"phone:{normalized_phone}")
        if not client_keys:
            client_keys.append(f"event:{event.get('_id')}")
        amount = payment.get("amount")
        try:
            amount = float(amount) if amount is not None else 0.0
        except (TypeError, ValueError):
            amount = 0.0
        currency = str(payment.get("currency") or "INR").upper()
        dated_events.append((paid_date, event, client_keys, payment_month, amount, currency))

    parents = {}

    def find_client_root(key):
        parents.setdefault(key, key)
        if parents[key] != key:
            parents[key] = find_client_root(parents[key])
        return parents[key]

    for _, _, client_keys, _, _, _ in dated_events:
        for key in client_keys:
            find_client_root(key)
        for key in client_keys[1:]:
            root = find_client_root(client_keys[0])
            other_root = find_client_root(key)
            if root != other_root:
                parents[other_root] = root

    dated_events = [
        (paid_date, event, find_client_root(client_keys[0]), payment_month, amount, currency)
        for paid_date, event, client_keys, payment_month, amount, currency in dated_events
    ]

    dated_events.sort(key=lambda row: (row[0], str(row[1].get("_id", ""))))
    first_payment_by_client = {}
    monthly_totals = {}
    payment_rows = []
    for paid_date, event, identity, payment_month, amount, currency in dated_events:
        first_payment = first_payment_by_client.setdefault(identity, paid_date)
        month_number = (paid_date.year - first_payment.year) * 12 + paid_date.month - first_payment.month
        anniversary = (
            min(first_payment.day, calendar.monthrange(paid_date.year, paid_date.month)[1]),
            first_payment.hour,
            first_payment.minute,
            first_payment.second,
            first_payment.microsecond,
        )
        if (paid_date.day, paid_date.hour, paid_date.minute, paid_date.second, paid_date.microsecond) < anniversary:
            month_number -= 1
        month_number = max(1, month_number + 1)
        month_key = (payment_month, currency)
        summary = monthly_totals.setdefault(month_key, {"revenue": 0.0, "payments": 0, "clients": set()})
        summary["revenue"] += amount
        summary["payments"] += 1
        summary["clients"].add(identity)
        payment = event.get("payment") or {}
        contact = event.get("user") or {}
        payment_rows.append({
            "id": str(event.get("_id", "")),
            "client": contact.get("name") or "Name not provided",
            "phone": contact.get("phone"),
            "paid_at": paid_date.isoformat(),
            "month": payment_month,
            "membership_month": month_number,
            "amount": amount,
            "currency": currency,
            "payment_id": payment.get("payment_id"),
        })

    if current_month is None:
        current_month = datetime.now(TEAM_TZ).strftime("%Y-%m")
    month_currencies = sorted({currency for _, currency in monthly_totals}) or ["INR"]
    earliest_month = min((month for month, _ in monthly_totals), default=current_month)
    year, month = map(int, earliest_month.split("-"))
    end_year, end_month = map(int, current_month.split("-"))
    monthly = []
    while (year, month) <= (end_year, end_month):
        month_key = f"{year:04d}-{month:02d}"
        for currency in month_currencies:
            summary = monthly_totals.get((month_key, currency), {})
            monthly.append({
                "month": month_key,
                "currency": currency,
                "revenue": round(summary.get("revenue", 0.0), 2),
                "payments": summary.get("payments", 0),
                "clients": len(summary.get("clients", set())),
            })
        month += 1
        if month == 13:
            year += 1
            month = 1
    payment_rows.sort(key=lambda row: (row["paid_at"], row["id"]), reverse=True)
    return {"monthly": monthly, "payments": payment_rows}


@api.get("/payments/50-cr-club/my-revenue-report")
async def get_my_50_cr_club_revenue_report(background_tasks: BackgroundTasks,
                                           user: dict = Depends(current_user)):
    if user["role"] != "telecaller" or not user.get("is_50_cr_club_rm", False):
        raise HTTPException(status_code=403, detail="Only 50 Cr Club RMs can access this report")
    if ADMIN_PANEL_KEY:
        background_tasks.add_task(refresh_50_cr_club_source_data, True)

    rm_id = ObjectId(user["id"])
    assigned_leads = await db.leads.find(
        {"assigned_to": rm_id, "tags": "50-cr-club"}, {"_id": 1},
    ).to_list(5000)
    lead_ids = [lead["_id"] for lead in assigned_leads]
    assignment_scope = [{"assigned_to_id": rm_id}]
    if lead_ids:
        assignment_scope.append({
            "lead_id": {"$in": lead_ids},
            "$or": [{"assigned_to_id": {"$exists": False}}, {"assigned_to_id": None}],
        })
    assigned_events = await db.payment_club_events.find({
        "source_record_type": "purchases",
        "verified": True,
        "$or": assignment_scope,
    }).to_list(10000)

    def client_keys(record: dict) -> set:
        contact = record.get("user") or {}
        keys = set()
        if record.get("lead_id"):
            keys.add(f"lead:{record['lead_id']}")
        if contact.get("external_id"):
            keys.add(f"external:{contact['external_id']}")
        if contact.get("email"):
            keys.add(f"email:{str(contact['email']).strip().lower()}")
        phone = re.sub(r"\D", "", str(contact.get("phone") or ""))
        if len(phone) >= 10:
            phone = phone[-10:]
        if phone:
            keys.add(f"phone:{phone}")
        return keys

    assigned_client_keys = set().union(*(client_keys(event) for event in assigned_events)) if assigned_events else set()
    if assigned_client_keys:
        all_events = await db.payment_club_events.find({
            "source_record_type": "purchases", "verified": True,
        }).sort([("payment.paid_at", 1), ("received_at", 1)]).to_list(10000)
        report_events = [event for event in all_events if client_keys(event) & assigned_client_keys]
    else:
        report_events = []
    report = build_club_monthly_revenue_report(report_events)
    sync_status = await db.settings.find_one({"_id": "50_cr_club_source_sync"}) or {}
    return {
        **report,
        "last_synced_at": sync_status.get("last_success_at"),
        "sync_errors": sync_status.get("errors") or {},
        "auto_refresh_enabled": bool(ADMIN_PANEL_KEY),
    }


@api.post("/payments/50-cr-club/purchases/upload-sheet")
async def upload_50_cr_club_sheet(
    file: UploadFile = File(...),
    team_id: str = Form(...),
    assignee_id: str = Form(...),
    user: dict = Depends(current_user),
):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can upload Club sheets")
    if not ObjectId.is_valid(team_id) or not ObjectId.is_valid(assignee_id):
        raise HTTPException(status_code=400, detail="Select a team and 50 Cr Club RM")
    team = await db.teams.find_one({"_id": oid(team_id)})
    assignee = await db.users.find_one({
        "_id": oid(assignee_id), "role": "telecaller", "active": True,
        "is_50_cr_club_rm": True, "team_id": team["_id"] if team else None,
    })
    if not team or not assignee:
        raise HTTPException(status_code=400, detail="Select an active 50 Cr Club RM from the selected team")

    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a CSV sheet")
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV file must be 10 MB or smaller")
    try:
        decoded = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(decoded))
        headers = {re.sub(r"[^a-z0-9]", "", (header or "").lower()): header for header in reader.fieldnames or []}
    except (UnicodeDecodeError, csv.Error):
        raise HTTPException(status_code=400, detail="Could not read the CSV. Save it as UTF-8 and try again.")

    aliases = {
        "name": ("name", "username", "fullname", "membername", "clientname", "customername", "displayname"),
        "phone": ("phone", "userphone", "mobile", "mobilenumber", "contact", "contactnumber", "number"),
        "email": ("email", "useremail", "emailaddress"),
    }
    columns = {
        key: next((headers[alias] for alias in options if alias in headers), None)
        for key, options in aliases.items()
    }
    if not columns["phone"] and not columns["email"]:
        raise HTTPException(status_code=400, detail="CSV needs a Phone or Email column")

    rows = list(reader)
    if len(rows) > 5000:
        raise HTTPException(status_code=413, detail="Upload no more than 5,000 rows at a time")
    valid_rows = []
    row_errors = []
    seen_contacts = set()
    skipped = 0
    for row_number, row in enumerate(rows, start=2):
        if not any(str(value or "").strip() for value in row.values()):
            continue
        name = str(row.get(columns["name"]) or "").strip() if columns["name"] else ""
        raw_phone = str(row.get(columns["phone"]) or "").strip() if columns["phone"] else ""
        phone = clean_uploaded_phone(raw_phone) if raw_phone else ""
        email = str(row.get(columns["email"]) or "").strip().lower() if columns["email"] else ""
        valid_phone = bool(phone and 10 <= len(phone) <= 15)
        if not valid_phone and not email and not name:
            skipped += 1
            if len(row_errors) < 20:
                phone_error = "phone appears rounded in scientific notation; export full digits as text" if "e" in raw_phone.lower() else "phone must contain 10–15 digits"
                row_errors.append(f"Row {row_number}: {phone_error}, email, or name is required")
            continue
        contact_key = email if email else phone
        if contact_key in seen_contacts:
            skipped += 1
            continue
        seen_contacts.add(contact_key)
        valid_rows.append({
            "name": name[:160],
            "phone": phone if valid_phone else None,
            "email": email or None,
            "row_number": row_number,
            "raw_phone": raw_phone,
        })
    if not valid_rows:
        return {"assigned": 0, "matched": 0, "unmatched": 0, "skipped": skipped, "row_errors": row_errors}

    if not ADMIN_PANEL_KEY:
        raise HTTPException(status_code=503, detail="VIP Market source is not configured; verified data was not refreshed")
    async with httpx.AsyncClient(timeout=20.0) as client_http:
        purchase_sync = await sync_vip_market_records(client_http, "purchases")
        membership_sync = await sync_vip_market_records(client_http, "memberships")
    sync_error = purchase_sync[1] or membership_sync[1]
    if sync_error:
        raise HTTPException(status_code=503, detail=f"Could not refresh verified VIP Market data: {sync_error}")

    provider_records = await db.payment_club_events.find(
        {"source_record_type": "purchases", "verified": True},
        {"user.phone": 1, "user.email": 1, "payment.paid_at": 1, "received_at": 1, "club_status": 1,
         "club.joined_at": 1, "club.expires_at": 1, "lead_id": 1},
    ).sort([("payment.paid_at", -1), ("received_at", -1)]).to_list(10000)
    provider_records = await enrich_stored_vip_membership_dates(provider_records)
    provider_by_phone = {}
    provider_by_email = {}
    for record in provider_records:
        source_user = record.get("user") or {}
        normalized_phone = clean_uploaded_phone(source_user.get("phone", ""))
        if normalized_phone and normalized_phone not in provider_by_phone:
            provider_by_phone[normalized_phone] = record
        normalized_email = str(source_user.get("email") or "").strip().lower()
        if normalized_email and normalized_email not in provider_by_email:
            provider_by_email[normalized_email] = record

    now = utcnow()
    assignment = {
        "assigned_to_id": assignee["_id"],
        "assigned_to_name": assignee["name"],
        "team_id": team["_id"],
        "assignment_source": "50_cr_club",
        "club_assigned_at": now,
        "club_assigned_by": user["id"],
    }
    assigned = 0
    matched = 0
    unmatched = 0
    for row in valid_rows:
        phone_match = provider_by_phone.get(row["phone"]) if row["phone"] else None
        email_match = provider_by_email.get(row["email"]) if row["email"] else None
        if phone_match and email_match and phone_match["_id"] != email_match["_id"]:
            unmatched += 1
            if len(row_errors) < 20:
                row_errors.append(f"Row {row['row_number']}: phone and email match different verified purchases")
            continue
        existing_record = phone_match or email_match
        if existing_record:
            matched += 1
            status = existing_record.get("club_status")
            await db.payment_club_events.update_one(
                {"_id": existing_record["_id"], "verified": True},
                {"$set": {
                    **assignment,
                    "club_status": status if status in {"unworked", "contacted", "follow_up", "enrolled", "not_interested", "lost"} else "unworked",
                }},
            )
            assigned += 1
            continue
        unmatched += 1
        if len(row_errors) < 20:
            row_errors.append(f"Row {row['row_number']}: no verified Club purchase matched this phone or email")
    return {
        "assigned": assigned, "matched": matched, "unmatched": unmatched,
        "skipped": skipped, "row_errors": row_errors,
        "assignee_name": assignee.get("name") if assignee else None,
    }


@api.post("/payments/50-cr-club/purchases/match-sheet")
async def match_50_cr_club_sheet(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    """Match CSV contacts to verified Club purchases (read-only). Returns the matched event IDs
    so the admin can then assign them with a separate step. Uses already-synced verified data
    (kept fresh by the webhook + a background refresh) so it never blocks on the source."""
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can match Club sheets")
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a CSV sheet")
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV file must be 10 MB or smaller")
    try:
        decoded = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(decoded))
        headers = {re.sub(r"[^a-z0-9]", "", (header or "").lower()): header for header in reader.fieldnames or []}
    except (UnicodeDecodeError, csv.Error):
        raise HTTPException(status_code=400, detail="Could not read the CSV. Save it as UTF-8 and try again.")
    aliases = {
        "name": ("name", "username", "fullname", "membername", "clientname", "customername", "displayname"),
        "phone": ("phone", "userphone", "mobile", "mobilenumber", "contact", "contactnumber", "number"),
        "email": ("email", "useremail", "emailaddress"),
    }
    columns = {key: next((headers[alias] for alias in options if alias in headers), None)
               for key, options in aliases.items()}
    if not columns["phone"] and not columns["email"]:
        raise HTTPException(status_code=400, detail="CSV needs a Phone or Email column")
    rows = list(reader)
    if len(rows) > 5000:
        raise HTTPException(status_code=413, detail="Upload no more than 5,000 rows at a time")
    valid_rows, row_errors, seen_contacts, skipped = [], [], set(), 0
    for row_number, row in enumerate(rows, start=2):
        if not any(str(value or "").strip() for value in row.values()):
            continue
        name = str(row.get(columns["name"]) or "").strip() if columns["name"] else ""
        raw_phone = str(row.get(columns["phone"]) or "").strip() if columns["phone"] else ""
        phone = clean_uploaded_phone(raw_phone) if raw_phone else ""
        email = str(row.get(columns["email"]) or "").strip().lower() if columns["email"] else ""
        valid_phone = bool(phone and 10 <= len(phone) <= 15)
        if not valid_phone and not email and not name:
            skipped += 1
            if len(row_errors) < 20:
                phone_error = "phone appears rounded in scientific notation; export full digits as text" if "e" in raw_phone.lower() else "phone must contain 10–15 digits"
                row_errors.append(f"Row {row_number}: {phone_error}, email, or name is required")
            continue
        contact_key = email if email else phone
        if contact_key in seen_contacts:
            skipped += 1
            continue
        seen_contacts.add(contact_key)
        valid_rows.append({"name": name[:160], "phone": phone if valid_phone else None,
                           "email": email or None, "row_number": row_number})
    if not valid_rows:
        return {"matched": 0, "unmatched": 0, "skipped": skipped, "row_errors": row_errors, "matched_event_ids": []}
    if ADMIN_PANEL_KEY:
        background_tasks.add_task(refresh_50_cr_club_source_data, False)
    provider_records = await db.payment_club_events.find(
        {"source_record_type": "purchases", "verified": True},
        {"user.phone": 1, "user.email": 1},
    ).to_list(20000)
    provider_by_phone, provider_by_email = {}, {}
    for record in provider_records:
        source_user = record.get("user") or {}
        normalized_phone = clean_uploaded_phone(source_user.get("phone", ""))
        if normalized_phone and normalized_phone not in provider_by_phone:
            provider_by_phone[normalized_phone] = record
        normalized_email = str(source_user.get("email") or "").strip().lower()
        if normalized_email and normalized_email not in provider_by_email:
            provider_by_email[normalized_email] = record
    matched_event_ids, seen_event = [], set()
    matched = unmatched = 0
    for row in valid_rows:
        phone_match = provider_by_phone.get(row["phone"]) if row["phone"] else None
        email_match = provider_by_email.get(row["email"]) if row["email"] else None
        if phone_match and email_match and phone_match["_id"] != email_match["_id"]:
            unmatched += 1
            if len(row_errors) < 20:
                row_errors.append(f"Row {row['row_number']}: phone and email match different verified purchases")
            continue
        existing_record = phone_match or email_match
        if existing_record:
            matched += 1
            event_id = str(existing_record["_id"])
            if event_id not in seen_event:
                seen_event.add(event_id)
                matched_event_ids.append(event_id)
            continue
        unmatched += 1
        if len(row_errors) < 20:
            row_errors.append(f"Row {row['row_number']}: no verified Club purchase matched this phone or email")
    return {"matched": matched, "unmatched": unmatched, "skipped": skipped,
            "row_errors": row_errors, "matched_event_ids": matched_event_ids}


@api.post("/payments/50-cr-club/purchases/export-membership-dates")
async def export_50_cr_club_membership_dates(
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can export Club membership dates")
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a CSV sheet")
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV file must be 10 MB or smaller")
    try:
        reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
        source_headers = reader.fieldnames or []
        headers = {re.sub(r"[^a-z0-9]", "", (header or "").lower()): header for header in source_headers}
        rows = list(reader)
    except (UnicodeDecodeError, csv.Error):
        raise HTTPException(status_code=400, detail="Could not read the CSV. Save it as UTF-8 and try again.")
    if len(rows) > 5000:
        raise HTTPException(status_code=413, detail="Upload no more than 5,000 rows at a time")

    aliases = {
        "name": ("name", "username", "fullname", "membername", "clientname", "customername", "displayname"),
        "phone": ("phone", "userphone", "mobile", "mobilenumber", "contact", "contactnumber", "number"),
        "email": ("email", "useremail", "emailaddress"),
    }
    columns = {
        key: next((headers[alias] for alias in options if alias in headers), None)
        for key, options in aliases.items()
    }
    if not any(columns.values()):
        raise HTTPException(status_code=400, detail="CSV needs a Name, Phone, or Email column")
    if not ADMIN_PANEL_KEY:
        raise HTTPException(status_code=503, detail="VIP Market source is not configured")

    async with httpx.AsyncClient(timeout=20.0) as client_http:
        purchase_sync = await sync_vip_market_records(client_http, "purchases")
        membership_sync = await sync_vip_market_records(client_http, "memberships")
    sync_error = purchase_sync[1] or membership_sync[1]
    if sync_error:
        raise HTTPException(status_code=503, detail=f"Could not refresh VIP Market membership data: {sync_error}")

    purchases = await db.payment_club_events.find({
        "source_record_type": "purchases", "verified": True,
    }).sort([("payment.paid_at", -1), ("received_at", -1)]).to_list(10000)
    purchases = await enrich_stored_vip_membership_dates(purchases)
    purchases_by_phone = {}
    purchases_by_email = {}
    purchases_by_name = {}
    for purchase in purchases:
        contact = purchase.get("user") or {}
        phone = clean_uploaded_phone(contact.get("phone", ""))
        email = str(contact.get("email") or "").strip().casefold()
        name = re.sub(r"\s+", " ", str(contact.get("name") or "").strip()).casefold()
        if phone:
            purchases_by_phone.setdefault(phone, []).append(purchase)
        if email:
            purchases_by_email.setdefault(email, []).append(purchase)
        if name:
            purchases_by_name.setdefault(name, []).append(purchase)

    output_headers = list(source_headers)
    output_names = ["Club Joined Date", "Club Expiry Date", "Club Match Status"]
    for output_name in output_names:
        if output_name not in output_headers:
            output_headers.append(output_name)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=output_headers, extrasaction="ignore")
    writer.writeheader()

    for row in rows:
        phone = clean_uploaded_phone(row.get(columns["phone"], "")) if columns["phone"] else ""
        email = str(row.get(columns["email"]) or "").strip().casefold() if columns["email"] else ""
        name = re.sub(r"\s+", " ", str(row.get(columns["name"]) or "").strip()).casefold() if columns["name"] else ""
        candidates = {}
        if phone:
            candidates.update({str(record["_id"]): record for record in purchases_by_phone.get(phone, [])})
        if email:
            candidates.update({str(record["_id"]): record for record in purchases_by_email.get(email, [])})

        matched = None
        match_status = "No verified Club match"
        if len(candidates) == 1:
            matched = next(iter(candidates.values()))
            match_status = "Matched by phone/email"
        elif len(candidates) > 1:
            match_status = "Ambiguous phone/email match"
        elif not phone and not email and name:
            name_matches = purchases_by_name.get(name, [])
            if len(name_matches) == 1:
                matched = name_matches[0]
                match_status = "Matched by unique name"
            elif len(name_matches) > 1:
                match_status = "Ambiguous name match"

        club = (matched or {}).get("club") or {}
        row["Club Joined Date"] = club.get("joined_at") or ""
        row["Club Expiry Date"] = club.get("expires_at") or ""
        row["Club Match Status"] = match_status
        writer.writerow(row)

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=50-cr-club-membership-dates.csv"},
    )


@api.post("/payments/50-cr-club/purchases/assign")
async def assign_50_cr_club_purchases(payload: PaymentClubPurchaseAssign, user: dict = Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can assign Club purchases")
    if any(not ObjectId.is_valid(event_id) for event_id in payload.event_ids):
        raise HTTPException(status_code=400, detail="One or more purchase IDs are invalid")
    team = await db.teams.find_one({"_id": oid(payload.team_id)})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    assignee = await db.users.find_one({
        "_id": oid(payload.assignee_id), "role": "telecaller", "active": True,
        "team_id": team["_id"], "is_50_cr_club_rm": True,
    })
    if not assignee:
        raise HTTPException(status_code=400, detail="Select an active 50 Cr Club RM from the selected team")
    event_ids = list(dict.fromkeys(oid(event_id) for event_id in payload.event_ids))
    events = await db.payment_club_events.find({
        "_id": {"$in": event_ids}, "source_record_type": "purchases", "verified": True,
    }).to_list(len(event_ids))
    now = utcnow()
    valid_club_statuses = {"unworked", "contacted", "follow_up", "enrolled", "not_interested", "lost"}
    operations = []
    results = []
    for event in events:
        current_status = event.get("club_status")
        operations.append(UpdateOne({"_id": event["_id"]}, {"$set": {
            "assigned_to_id": assignee["_id"],
            "assigned_to_name": assignee.get("name"),
            "team_id": team["_id"],
            "assignment_source": "50_cr_club",
            "club_status": current_status if current_status in valid_club_statuses else "unworked",
            "club_assigned_at": now,
            "club_assigned_by": user["id"],
        }}))
        results.append(str(event["_id"]))
    # Single batched write (was one update_one per event -> 524 timeouts on large CSV assigns).
    if operations:
        await db.payment_club_events.bulk_write(operations, ordered=False)
    return {"assigned": len(results), "event_ids": results, "requested": len(event_ids)}


@api.patch("/payments/50-cr-club/purchases/{event_id}/status")
async def update_50_cr_club_purchase_status(event_id: str, payload: ClubPurchaseStatusUpdate,
                                            user: dict = Depends(current_user)):
    if not ObjectId.is_valid(event_id):
        raise HTTPException(status_code=404, detail="Verified 50 Cr Club purchase not found")
    event = await db.payment_club_events.find_one({
        "_id": oid(event_id), "source_record_type": "purchases", "verified": True,
    })
    if not event:
        raise HTTPException(status_code=404, detail="Verified 50 Cr Club purchase not found")
    if user["role"] == "telecaller":
        assigned_to_id = event.get("assigned_to_id")
        if not assigned_to_id and event.get("lead_id"):
            lead = await db.leads.find_one({"_id": event["lead_id"]}, {"assigned_to": 1})
            assigned_to_id = lead.get("assigned_to") if lead else None
        if not user.get("is_50_cr_club_rm", False) or str(assigned_to_id) != user["id"]:
            raise HTTPException(status_code=403, detail="This Club purchase is not assigned to you")
    elif user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not permitted")
    await db.payment_club_events.update_one({"_id": event["_id"]}, {"$set": {
        "club_status": payload.status,
        "club_status_updated_at": utcnow(),
        "club_status_updated_by": user["id"],
        "club_status_updated_by_name": user.get("name"),
    }})
    return serialize(await db.payment_club_events.find_one({"_id": event["_id"]}))


@api.patch("/payments/50-cr-club/purchases/{event_id}/member-profile")
async def update_50_cr_club_member_profile(event_id: str, payload: ClubMemberProfileUpdate,
                                           user: dict = Depends(current_user)):
    if not ObjectId.is_valid(event_id):
        raise HTTPException(status_code=404, detail="Verified 50 Cr Club purchase not found")
    event = await db.payment_club_events.find_one({
        "_id": oid(event_id), "source_record_type": "purchases", "verified": True,
    })
    if not event:
        raise HTTPException(status_code=404, detail="Verified 50 Cr Club purchase not found")
    if user["role"] == "telecaller":
        if not user.get("is_50_cr_club_rm", False):
            raise HTTPException(status_code=403, detail="Only assigned 50 Cr Club RMs can update member details")
        lead = await db.leads.find_one({"_id": event.get("lead_id")}) if event.get("lead_id") else None
        is_assigned = (
            str(event.get("assigned_to_id")) == user["id"]
            if event.get("assigned_to_id") else bool(lead and str(lead.get("assigned_to")) == user["id"])
        )
        if not is_assigned:
            raise HTTPException(status_code=403, detail="This Club member is not assigned to you")
    elif user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not permitted")

    changes = {f"member_profile.{key}": value for key, value in payload.model_dump(exclude_unset=True).items()}
    if changes:
        changes["member_profile.updated_at"] = utcnow()
        changes["member_profile.updated_by"] = user["id"]
        changes["member_profile.updated_by_name"] = user.get("name")
        await db.payment_club_events.update_one({"_id": event["_id"]}, {"$set": changes})
        if event.get("lead_id"):
            lead_changes = {}
            for key, value in payload.model_dump(exclude_unset=True).items():
                lead_key = "club_next_follow_up_at" if key == "next_follow_up_at" else key
                lead_changes[lead_key] = value
            lead_changes["updated_at"] = utcnow()
            await db.leads.update_one({"_id": event["lead_id"]}, {"$set": lead_changes})
    return serialize(await db.payment_club_events.find_one({"_id": event["_id"]}))


@api.get("/payments/50-cr-club/purchases/{event_id}/calls")
async def list_50_cr_club_purchase_calls(event_id: str, user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "telecaller"):
        raise HTTPException(status_code=403, detail="Not permitted")
    event = await db.payment_club_events.find_one({
        "_id": oid(event_id), "source_record_type": "purchases", "verified": True,
    })
    if not event:
        raise HTTPException(status_code=404, detail="Verified 50 Cr Club purchase not found")
    lead = await db.leads.find_one({"_id": event.get("lead_id")}) if event.get("lead_id") else None
    if user["role"] == "telecaller" and (
        not user.get("is_50_cr_club_rm", False)
        or (str(event.get("assigned_to_id")) != user["id"] if event.get("assigned_to_id")
            else (not lead or str(lead.get("assigned_to")) != user["id"]))
    ):
        raise HTTPException(status_code=403, detail="This Club member is not assigned to you")
    call_query = {"$or": [{"payment_club_event_id": event["_id"]}]}
    if event.get("lead_id"):
        call_query["$or"].append({"lead_id": event["lead_id"]})
    if user["role"] == "telecaller":
        call_query["user_id"] = ObjectId(user["id"])
    calls = await db.call_attempts.find(call_query).sort("created_at", -1).limit(100).to_list(100)
    return [{
        "id": str(call["_id"]),
        "created_at": call.get("created_at"),
        "user_name": call.get("user_name"),
        "call_mode": call.get("call_mode"),
        "status_code": call.get("status_code"),
        "provider_call_id": call.get("provider_call_id"),
        "connected": call.get("connected"),
        "duration": call.get("duration"),
        "disposition": call.get("disposition"),
        "error": (call.get("provider_response") or {}).get("error"),
    } for call in calls]


@api.post("/payments/50-cr-club/users/{event_id}/lead")
async def create_lead_from_50_cr_club(event_id: str, payload: PaymentClubLeadCreate,
                                      user: dict = Depends(current_user)):
    raise HTTPException(status_code=410, detail="Club purchases are assigned as Club records, not created as CRM leads")


@api.post("/payments/50-cr-club/purchases/bulk-leads")
async def bulk_create_50_cr_club_leads(payload: PaymentClubBulkLeadCreate,
                                       user: dict = Depends(current_user)):
    raise HTTPException(status_code=410, detail="Use the Club purchase assignment workflow; it does not create CRM leads")


@api.get("/documents")
async def list_documents(user: dict = Depends(current_user)):
    query = {"is_deleted": {"$ne": True}}
    if user["role"] == "telecaller":
        query["$or"] = [{"owner_id": ObjectId(user["id"])}, {"owner_id": None}]
    docs = await db.documents.find(query).sort("created_at", -1).to_list(500)
    return [serialize(doc) for doc in docs]


@api.post("/documents")
async def upload_document(file: UploadFile = File(...), user: dict = Depends(current_user)):
    content_type = file.content_type or "application/octet-stream"
    if content_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported document type")
    data = await file.read()
    if len(data) > MAX_DOCUMENT_SIZE:
        raise HTTPException(status_code=413, detail="Document must be 15 MB or smaller")
    name = Path(file.filename or "document").name
    stored_name = f"{ObjectId()}-{name}"
    storage_path = f"onestock-academy-crm/documents/{user['id']}/{stored_name}"
    await asyncio.to_thread(put_object, storage_path, data, content_type)
    doc = Document(name=name, stored_name=stored_name, content_type=content_type,
                   size=len(data), owner_id=user["id"], owner_name=user["name"]).to_mongo()
    doc.update({"storage_path": storage_path, "is_deleted": False})
    result = await db.documents.insert_one(doc)
    return serialize(await db.documents.find_one({"_id": result.inserted_id}))


@api.get("/documents/{document_id}/download")
async def download_document(document_id: str, user: dict = Depends(current_user)):
    doc = await db.documents.find_one({"_id": oid(document_id), "is_deleted": {"$ne": True}})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("storage_path"):
        data, content_type = await asyncio.to_thread(get_object, doc["storage_path"])
    else:
        legacy_path = ROOT_DIR / "uploads" / "documents" / doc.get("stored_name", "")
        if not legacy_path.is_file():
            raise HTTPException(status_code=404, detail="Document file not found")
        data, content_type = legacy_path.read_bytes(), doc.get("content_type", "application/octet-stream")
    return Response(content=data, media_type=content_type,
                    headers={"Content-Disposition": f'attachment; filename="{quote(doc["name"])}"'})


@api.delete("/documents/{document_id}")
async def delete_document(document_id: str, user: dict = Depends(current_user)):
    doc = await db.documents.find_one({"_id": oid(document_id), "is_deleted": {"$ne": True}})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if user["role"] not in ("admin", "subadmin") and str(doc.get("owner_id")) != user["id"]:
        raise HTTPException(status_code=403, detail="You can only delete your own documents")
    await db.documents.update_one({"_id": doc["_id"]}, {"$set": {"is_deleted": True, "deleted_at": utcnow()}})
    if doc.get("storage_path"):
        try:
            await asyncio.to_thread(delete_object, doc["storage_path"])
        except Exception as exc:
            logger.warning("Failed to delete physical file from storage (%s): %s", doc["storage_path"], exc)
    return {"ok": True}


@api.get("/leads/{lead_id}")
async def get_lead(lead_id: str, user: dict = Depends(current_user)):
    query = {"_id": oid(lead_id), **await lead_scope(user)}
    lead = await db.leads.find_one(query)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    acts = await db.activities.find({"lead_id": lead["_id"]}).sort("created_at", -1).to_list(50)
    calls = await db.call_attempts.find({"lead_id": lead["_id"]}).sort("created_at", -1).to_list(100)
    out = serialize(lead)
    out["activities"] = [serialize(a) for a in acts]
    out["calls"] = [
        {**serialize_call_attempt(call, lead), "call_number": call.get("call_number") or len(calls) - index}
        for index, call in enumerate(calls)
    ]
    return out


@api.patch("/leads/{lead_id}/calls/{call_id}")
async def update_call_outcome(lead_id: str, call_id: str, payload: CallOutcomeUpdate,
                              user: dict = Depends(current_user)):
    lead = await db.leads.find_one({"_id": oid(lead_id), **await lead_scope(user)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not (has_perm(user["role"], "lead:update") or has_perm(user["role"], "lead:update_own")):
        raise HTTPException(status_code=403, detail="Not permitted")
    if payload.call_outcome not in {"connected", "not_connected"}:
        raise HTTPException(status_code=400, detail="Invalid call outcome")
    post_call_statuses = {"interested", "not_interested", "follow_up", "converted", "lost"}
    if payload.status and payload.status not in post_call_statuses:
        raise HTTPException(status_code=400, detail="Invalid post-call lead status")
    if user["role"] == "telecaller" and payload.call_outcome == "connected" and not payload.status:
        raise HTTPException(status_code=400, detail="A post-call lead status is required")
    call = await db.call_attempts.find_one({"_id": oid(call_id), "lead_id": lead["_id"]})
    if not call:
        raise HTTPException(status_code=404, detail="Call attempt not found")
    await db.call_attempts.update_one({"_id": call["_id"]}, {"$set": {
        "call_outcome": payload.call_outcome,
        "manual_call_outcome": payload.call_outcome,
        "manual_outcome_updated_at": utcnow(),
        "post_call_status": payload.status,
        "outcome_updated_at": utcnow(),
        "outcome_updated_by": ObjectId(user["id"]),
        "outcome_updated_by_name": user["name"],
    }})
    lead_updates = {"updated_at": utcnow(), "last_action_at": utcnow(), "escalated": False}
    if payload.status:
        lead_updates["status"] = payload.status
        if payload.status == "converted" and user["role"] == "telecaller":
            lead_updates.update({"conversion_status": "pending", "conversion_requested_at": utcnow(),
                                 "conversion_approved_at": None, "conversion_approved_by": None,
                                 "ticket_size": None})
    if "next_follow_up_at" in payload.model_fields_set:
        lead_updates["next_follow_up_at"] = payload.next_follow_up_at
    previous_status = lead.get("status")
    matched_purchase = None
    if payload.status == "converted" and previous_status != "converted":
        conversion_updates, matched_purchase = await prepare_50_cr_club_conversion(lead, user, utcnow())
        lead_updates.update(conversion_updates)
    await db.leads.update_one({"_id": lead["_id"]}, {"$set": lead_updates})
    await link_verified_purchase_to_conversion(lead, matched_purchase, user, utcnow())
    await log_activity("call_outcome_recorded", user, lead,
                       f"Call {call.get('call_number', '?')}: {payload.call_outcome}" +
                       (f" -> {payload.status}" if payload.status else ""))
    if payload.status and payload.status != previous_status:
        await log_activity("status_changed", user, lead,
                           f"{previous_status or 'none'} -> {payload.status}",
                           status_from=previous_status, status_to=payload.status)
    return {"ok": True, "call_outcome": payload.call_outcome,
            "status": lead_updates.get("status", lead.get("status"))}


@api.post("/leads/{lead_id}/calls/manual")
async def save_manual_call_outcome(lead_id: str, payload: ManualCallOutcomeUpdate,
                                   user: dict = Depends(current_user)):
    lead = await db.leads.find_one({"_id": oid(lead_id), **await lead_scope(user)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not (has_perm(user["role"], "lead:update") or has_perm(user["role"], "lead:update_own")):
        raise HTTPException(status_code=403, detail="Not permitted")
    if payload.call_outcome not in {"connected", "not_connected"}:
        raise HTTPException(status_code=400, detail="Invalid call outcome")
    post_call_statuses = {"interested", "not_interested", "follow_up", "converted", "lost"}
    if payload.status and payload.status not in post_call_statuses:
        raise HTTPException(status_code=400, detail="Invalid post-call lead status")
    if user["role"] == "telecaller" and payload.call_outcome == "connected" and not payload.status:
        raise HTTPException(status_code=400, detail="A post-call lead status is required")

    now = utcnow()
    call = await db.call_attempts.find_one(
        {"lead_id": lead["_id"], "call_number": payload.call_number},
        sort=[("created_at", -1)],
    )
    call_updates = {
        "call_outcome": payload.call_outcome,
        "manual_call_outcome": payload.call_outcome,
        "manual_outcome_updated_at": now,
        "post_call_status": payload.status,
        "connected": payload.call_outcome == "connected",
        "manual": True,
        "outcome_updated_at": now,
        "outcome_updated_by": ObjectId(user["id"]),
        "outcome_updated_by_name": user["name"],
    }
    if call:
        await db.call_attempts.update_one({"_id": call["_id"]}, {"$set": call_updates})
    else:
        call_updates.update({
            "user_id": ObjectId(user["id"]),
            "user_name": user["name"],
            "lead_id": lead["_id"],
            "call_number": payload.call_number,
            "destination_number": lead.get("phone"),
            "status_code": 0,
            "connected": payload.call_outcome == "connected",
            "duration": 0,
            "created_at": now,
        })
        call_result = await db.call_attempts.insert_one(call_updates)
        call = {**call_updates, "_id": call_result.inserted_id}

    lead_updates = {"updated_at": now, "last_action_at": now, "escalated": False}
    if payload.status:
        lead_updates["status"] = payload.status
        if payload.status == "converted" and user["role"] == "telecaller":
            lead_updates.update({"conversion_status": "pending", "conversion_requested_at": now,
                                 "conversion_approved_at": None, "conversion_approved_by": None,
                                 "ticket_size": None})
    if "next_follow_up_at" in payload.model_fields_set:
        lead_updates["next_follow_up_at"] = payload.next_follow_up_at
    previous_status = lead.get("status")
    matched_purchase = None
    if payload.status == "converted" and previous_status != "converted":
        conversion_updates, matched_purchase = await prepare_50_cr_club_conversion(lead, user, now)
        lead_updates.update(conversion_updates)
    await db.leads.update_one({"_id": lead["_id"]}, {"$set": lead_updates})
    await link_verified_purchase_to_conversion(lead, matched_purchase, user, now)
    await log_activity("call_outcome_recorded", user, lead,
                       f"Call {payload.call_number}: {payload.call_outcome}" +
                       (f" -> {payload.status}" if payload.status else ""))
    if payload.status and payload.status != previous_status:
        await log_activity("status_changed", user, lead,
                           f"{previous_status or 'none'} -> {payload.status}",
                           status_from=previous_status, status_to=payload.status)
    return {"ok": True, "call_number": payload.call_number,
            "call_outcome": payload.call_outcome,
            "status": lead_updates.get("status", lead.get("status"))}


@api.post("/leads/bulk-delete")
async def bulk_delete_leads(payload: BulkLeadDeleteRequest, user: dict = Depends(current_user)):
    require_perm(user, "lead:delete")
    lead_ids = list(dict.fromkeys(payload.lead_ids))
    leads = []
    for lead_id in lead_ids:
        lead = await db.leads.find_one({"_id": oid(lead_id)})
        if lead:
            leads.append(lead)
    for lead in leads:
        await log_activity("lead_deleted", user, lead, "Lead removed during duplicate cleanup")
    if leads:
        await db.leads.delete_many({"_id": {"$in": [lead["_id"] for lead in leads]}})
    return {"deleted": len(leads), "ids": [str(lead["_id"]) for lead in leads]}


@api.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, user: dict = Depends(current_user)):
    require_perm(user, "lead:delete")
    lead = await db.leads.find_one({"_id": oid(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    await log_activity("lead_deleted", user, lead, "Lead removed")
    await db.leads.delete_one({"_id": lead["_id"]})
    return {"deleted": True, "id": lead_id}


@api.patch("/leads/{lead_id}")
async def update_lead(lead_id: str, payload: LeadUpdate, user: dict = Depends(current_user)):
    lead = await db.leads.find_one({"_id": oid(lead_id), **await lead_scope(user)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not (has_perm(user["role"], "lead:update") or has_perm(user["role"], "lead:update_own")):
        raise HTTPException(status_code=403, detail="Not permitted")
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if "trading_capital" in payload.model_fields_set and payload.trading_capital is None:
        updates["trading_capital"] = None
    for field in ("broker_name", "broker_unique_id", "broker_account_status", "expected_group_profit", "product_in_use",
                  "membership_enabled", "follow_up_routine", "club_next_follow_up_at"):
        if field in payload.model_fields_set and getattr(payload, field) is None:
            updates[field] = None
    validate_profile(updates)
    if "course_id" in payload.model_fields_set and payload.course_id is None:
        updates["course_id"] = None
    if "next_follow_up_at" in payload.model_fields_set and payload.next_follow_up_at is None:
        updates["next_follow_up_at"] = None
    if "tags" in updates:
        updates["tags"] = normalize_tags(updates["tags"])
    if "status" in updates and updates["status"] not in LEAD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if "course_id" in updates:
        if updates["course_id"] is None:
            updates["course_name"] = None
        else:
            course = await db.courses.find_one({"_id": oid(updates["course_id"]), "active": True})
            if not course:
                raise HTTPException(status_code=400, detail="Invalid or inactive course")
            updates["course_id"] = course["_id"]
            updates["course_name"] = course["name"]
    if updates.get("status") == "converted" and user["role"] == "telecaller":
        updates["conversion_status"] = "pending"
        updates["conversion_requested_at"] = utcnow()
        updates["conversion_approved_at"] = None
        updates["conversion_approved_by"] = None
        updates["ticket_size"] = None
    previous_status = lead.get("status")
    matched_purchase = None
    if updates.get("status") == "converted" and previous_status != "converted":
        conversion_updates, matched_purchase = await prepare_50_cr_club_conversion(lead, user, utcnow())
        updates.update(conversion_updates)
    if updates:
        updates["updated_at"] = utcnow()
        updates["last_action_at"] = utcnow()
        updates["escalated"] = False
        await db.leads.update_one({"_id": lead["_id"]}, {"$set": updates})
        await link_verified_purchase_to_conversion(lead, matched_purchase, user, utcnow())
        detail = f"status -> {updates['status']}" if "status" in updates else "details updated"
        await log_activity("lead_updated", user, lead, detail)
        if "status" in updates and updates["status"] != previous_status:
            await log_activity("status_changed", user, lead,
                               f"{previous_status or 'none'} -> {updates['status']}",
                               status_from=previous_status, status_to=updates["status"])
    return serialize(await db.leads.find_one({"_id": lead["_id"]}))


@api.post("/leads/{lead_id}/conversion/approve")
async def approve_conversion(lead_id: str, payload: ConversionApproval,
                              user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "subadmin", "team_leader"):
        raise HTTPException(status_code=403, detail="Only a team leader or manager can approve conversions")
    lead = await db.leads.find_one({"_id": oid(lead_id), **await lead_scope(user)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("status") != "converted" or lead.get("conversion_status") != "pending":
        raise HTTPException(status_code=400, detail="This lead has no pending conversion")
    now = utcnow()
    await db.leads.update_one({"_id": lead["_id"]}, {"$set": {
        "conversion_status": "approved", "ticket_size": payload.ticket_size,
        "conversion_approved_at": now, "conversion_approved_by": ObjectId(user["id"]),
        "updated_at": now, "last_action_at": now,
    }})
    detail = f"Ticket size: {payload.ticket_size:g}" if payload.ticket_size is not None else "Approved without ticket size"
    await log_activity("conversion_approved", user, lead, detail)
    return serialize(await db.leads.find_one({"_id": lead["_id"]}))


@api.post("/leads/{lead_id}/notes")
async def add_note(lead_id: str, payload: NoteCreate, user: dict = Depends(current_user)):
    lead = await db.leads.find_one({"_id": oid(lead_id), **await lead_scope(user)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    note = Note(text=payload.text, author_id=user["id"], author_name=user["name"]).model_dump()
    now = utcnow()
    setter = {"updated_at": now, "last_action_at": now, "escalated": False}
    previous_status = lead.get("status")
    if payload.status:
        if payload.status not in LEAD_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        setter["status"] = payload.status
    if payload.next_follow_up_at:
        setter["next_follow_up_at"] = payload.next_follow_up_at
    await db.leads.update_one({"_id": lead["_id"]},
                              {"$push": {"notes": note}, "$set": setter})
    await log_activity("call_note_added", user, lead, payload.text[:120])
    if payload.status and payload.status != previous_status:
        await log_activity("status_changed", user, lead,
                           f"{previous_status or 'none'} -> {payload.status}",
                           status_from=previous_status, status_to=payload.status)
    return serialize(await db.leads.find_one({"_id": lead["_id"]}))


def smartflo_number(value: str) -> str:
    """Smartflo expects bare digits; normalize an Indian mobile to 91XXXXXXXXXX."""
    digits = "".join(ch for ch in str(value or "") if ch.isdigit()).lstrip("0")
    return f"91{digits}" if len(digits) == 10 else digits


def split_agent_numbers(value: Optional[str]) -> List[str]:
    if value is None:
        return []
    parts = []
    for item in str(value).replace(";", ",").replace("\n", ",").split(","):
        cleaned = item.strip()
        if cleaned:
            parts.append(cleaned)
    return parts


def select_agent_number(user: dict) -> Optional[str]:
    numbers = split_agent_numbers(user.get("agent_number"))
    if not numbers:
        return None
    if len(numbers) == 1:
        return numbers[0]
    index = int(user.get("next_agent_number_index") or 0) % len(numbers)
    return numbers[index]


@api.get("/calls/diagnostics")
async def call_diagnostics(user: dict = Depends(current_user)):
    problems = []
    if not SMARTFLO_API_TOKEN:
        problems.append("SMARTFLO_API_TOKEN is missing from backend/.env")
    if not SMARTFLO_CALLER_ID:
        problems.append("SMARTFLO_CALLER_ID is missing from backend/.env")
    call_mode = user.get("call_mode") or "phone"
    agent_numbers = split_agent_numbers(user.get("agent_number"))
    agent_number = agent_numbers[0] if agent_numbers else None
    agent_extension = user.get("agent_extension")
    if call_mode == "desktop":
        if not agent_extension:
            problems.append("No Smartflo extension set for this user")
        rings_on = f"Smartflo softphone on this computer (extension {agent_extension})" if agent_extension else None
    else:
        if not agent_number:
            problems.append("This user has no Smartflo agent number set (Users page > Agent #)")
        rings_on = f"mobile phone {agent_number}" if agent_number else None
    return {
        "token_configured": bool(SMARTFLO_API_TOKEN), "caller_id": SMARTFLO_CALLER_ID,
        "call_mode": call_mode, "agent_number": agent_number, "agent_numbers": agent_numbers,
        "agent_extension": agent_extension, "agent_number_sent_as": smartflo_number(agent_number) if agent_number else None,
        "rings_on": rings_on, "softphone_extension_url": SOFTPHONE_EXTENSION_URL,
        "base_url": SMARTFLO_BASE_URL, "ready": not problems, "problems": problems,
    }


@api.patch("/calls/preferences")
async def update_call_preferences(payload: CallPreferences, user: dict = Depends(current_user)):
    updates = {}
    if payload.call_mode is not None:
        if payload.call_mode not in CALL_MODES:
            raise HTTPException(status_code=400, detail="call_mode must be 'desktop' or 'phone'")
        updates["call_mode"] = payload.call_mode
    if payload.agent_extension is not None:
        updates["agent_extension"] = payload.agent_extension.strip()
    if payload.agent_number is not None:
        updates["agent_number"] = payload.agent_number.strip()
    if updates:
        await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": updates})
    return serialize(await db.users.find_one({"_id": ObjectId(user["id"])}, {"password_hash": 0}))


@api.post("/calls/click-to-call")
async def click_to_call(payload: dict, user: dict = Depends(current_user)):
    destination_number = smartflo_number(payload.get("destination_number", ""))
    lead_id = payload.get("lead_id")
    club_event = None
    club_event_id = payload.get("payment_club_event_id")
    if club_event_id:
        if user["role"] not in ("admin", "telecaller"):
            raise HTTPException(status_code=403, detail="Not permitted")
        club_event = await db.payment_club_events.find_one({
            "_id": oid(club_event_id), "source_record_type": "purchases", "verified": True,
        })
        if not club_event:
            raise HTTPException(status_code=404, detail="Verified 50 Cr Club purchase not found")
        if user["role"] == "telecaller":
            club_lead = await db.leads.find_one({"_id": club_event.get("lead_id")}) if club_event.get("lead_id") else None
            if (not user.get("is_50_cr_club_rm", False)
                    or (str(club_event.get("assigned_to_id")) != user["id"] if club_event.get("assigned_to_id")
                        else (not club_lead or str(club_lead.get("assigned_to")) != user["id"]))):
                raise HTTPException(status_code=403, detail="This Club member is not assigned to you")
        club_phone = smartflo_number((club_event.get("user") or {}).get("phone", ""))
        if destination_number != club_phone:
            raise HTTPException(status_code=400, detail="Call number does not match this 50 Cr Club purchase")
        if lead_id:
            raise HTTPException(status_code=400, detail="Club calls are tracked against the purchase, not a CRM lead")
    call_mode = payload.get("call_mode") or user.get("call_mode") or "phone"
    if call_mode not in CALL_MODES:
        call_mode = "phone"
    if len(destination_number) < 10:
        raise HTTPException(status_code=400, detail="A valid destination number is required")
    if not SMARTFLO_API_TOKEN:
        raise HTTPException(status_code=500, detail="SMARTFLO_API_TOKEN is not configured correctly on the server")
    if call_mode == "desktop":
        extension = str(user.get("agent_extension") or "").strip()
        if not extension:
            raise HTTPException(status_code=400, detail="Desktop calling needs your Smartflo extension. Add it under Call settings or ask an admin.")
        if not extension.isdigit():
            raise HTTPException(status_code=400, detail="Your Smartflo extension must be digits only (e.g. 1024)")
        agent_identifier = extension
        agent_number = extension
    else:
        agent_number = select_agent_number(user)
        if not agent_number:
            raise HTTPException(status_code=400, detail="No Smartflo agent number set for your account. An admin can add it on the Users page.")
        agent_identifier = smartflo_number(agent_number)
        numbers = split_agent_numbers(user.get("agent_number"))
        if len(numbers) > 1:
            current = int(user.get("next_agent_number_index") or 0) % len(numbers)
            next_index = (current + 1) % len(numbers)
            await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"next_agent_number_index": next_index}})
    body = {"agent_number": agent_identifier, "destination_number": destination_number,
            "caller_id": SMARTFLO_CALLER_ID, "async": 1, "get_call_id": 1}
    if lead_id:
        body["custom_identifier"] = str(lead_id)
    call_number = await db.call_attempts.count_documents({"lead_id": ObjectId(lead_id)}) + 1 if lead_id else None
    attempt = {"user_id": ObjectId(user["id"]), "user_name": user["name"],
        "lead_id": ObjectId(lead_id) if lead_id else None, "call_mode": call_mode,
        "call_number": call_number, "agent_number": agent_identifier,
        "destination_number": destination_number, "caller_id": SMARTFLO_CALLER_ID,
        "status_code": None, "provider_call_id": None, "connected": None,
        "duration": None, "provider_response": {"state": "initiated"}, "created_at": utcnow()}
    if club_event:
        attempt["payment_club_event_id"] = club_event["_id"]
    attempt_result = await db.call_attempts.insert_one(attempt)
    try:
        async with httpx.AsyncClient(timeout=20) as client_http:
            response = await client_http.post(
                f"{SMARTFLO_BASE_URL}/v1/click_to_call",
                headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": f"Bearer {SMARTFLO_API_TOKEN}"},
                json=body,
            )
    except httpx.TimeoutException:
        await db.call_attempts.update_one({"_id": attempt_result.inserted_id}, {"$set": {
            "status_code": 504, "provider_response": {"error": "Smartflo request timed out"}}})
        raise HTTPException(status_code=504, detail="Smartflo did not respond in time")
    except httpx.RequestError as exc:
        await db.call_attempts.update_one({"_id": attempt_result.inserted_id}, {"$set": {
            "status_code": 502, "provider_response": {"error": f"Smartflo request failed: {exc.__class__.__name__}"}}})
        raise HTTPException(status_code=502, detail=f"Could not reach Smartflo: {exc.__class__.__name__}")
    try:
        data = response.json()
    except ValueError:
        data = {"raw": response.text[:400]}
    provider_call_id = str(data.get("call_id") or data.get("ref_id") or data.get("uuid") or data.get("id")
                           or (data.get("data") or {}).get("call_id")
                           or (data.get("data") or {}).get("ref_id") or "") or None
    await db.call_attempts.update_one({"_id": attempt_result.inserted_id}, {"$set": {
        "status_code": response.status_code, "provider_call_id": provider_call_id,
        "provider_response": data}})
    if response.status_code >= 400 or data.get("success") is False:
        if response.status_code == 404:
            detail = "Smartflo endpoint returned Not Found. Check the Smartflo base URL and API access."
        elif response.status_code == 422 and data.get("message") == "Agent is Offline":
            detail = "Smartflo softphone is offline. Sign in to the Smartflo extension, allow microphone access, and keep it open before calling."
        elif 500 <= response.status_code < 600 and (
            not data.get("message") or "origin web server" in response.text.lower()
        ):
            detail = "Smartflo is temporarily unavailable. Please wait a moment and try again."
        else:
            detail = f"Smartflo: {data.get('message') or response.text[:200] or 'call failed to initiate'}"
        raise HTTPException(status_code=502, detail=detail)
    if lead_id:
        lead = await db.leads.find_one({"_id": oid(lead_id), **await lead_scope(user)})
        if lead:
            await log_activity("call_initiated", user, lead, f"{call_mode.title()} call to {destination_number}")
    return data


@api.post("/leads/assign")
async def assign_leads(payload: AssignRequest, user: dict = Depends(current_user)):
    if not (has_perm(user["role"], "lead:assign") or has_perm(user["role"], "lead:assign_team")):
        raise HTTPException(status_code=403, detail="Not permitted")
    assignee = await db.users.find_one({"_id": oid(payload.assignee_id), "active": True})
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignee not found")
    if user["role"] == "team_leader":
        allowed = {str(i) for i in await team_member_ids(user)}
        if str(assignee["_id"]) not in allowed:
            raise HTTPException(status_code=403, detail="Assignee is not in your team")
    scope = await lead_scope(user)
    count = 0
    for lid in payload.lead_ids:
        lead = await db.leads.find_one({"_id": oid(lid), **scope})
        if not lead:
            continue
        await apply_assignment(lead, assignee, user, "lead_assigned")
        count += 1
    return {"assigned": count}


@api.post("/leads/unassign")
async def unassign_leads(payload: BulkLeadDeleteRequest, user: dict = Depends(current_user)):
    if not (has_perm(user["role"], "lead:assign") or has_perm(user["role"], "lead:assign_team")):
        raise HTTPException(status_code=403, detail="Not permitted")
    scope = await lead_scope(user)
    count = 0
    for lid in payload.lead_ids:
        lead = await db.leads.find_one({"_id": oid(lid), **scope})
        if not lead:
            continue
        now = utcnow()
        new_status = "new_lead" if lead.get("status") == "assigned" else lead.get("status")
        await db.leads.update_one({"_id": lead["_id"]}, {"$set": {
            "assigned_to": None, "assigned_to_name": None, "assigned_at": None,
            "status": new_status, "escalated": False, "updated_at": now, "last_action_at": now,
        }})
        await log_activity("lead_unassigned", user, lead, "Assignment cleared")
        count += 1
    return {"unassigned": count}


@api.post("/leads/auto-assign")
async def auto_assign(payload: AutoAssignRequest, user: dict = Depends(current_user)):
    require_perm(user, "lead:assign")
    if payload.lead_ids:
        leads = [await db.leads.find_one({"_id": oid(i)}) for i in payload.lead_ids]
        leads = [lead for lead in leads if lead]
    else:
        leads = await db.leads.find({"assigned_to": None}).limit(payload.limit).to_list(payload.limit)
    assigned = 0
    for lead in leads:
        caller = await next_telecaller()
        if not caller:
            raise HTTPException(status_code=400, detail="No active telecallers available")
        await apply_assignment(lead, caller, user, "lead_auto_assigned")
        assigned += 1
    return {"assigned": assigned}


@api.post("/leads/import")
async def import_leads(file: UploadFile = File(...), source: Optional[str] = Form(None), user: dict = Depends(current_user)):
    require_perm(user, "lead:import")
    custom_sources = (await db.settings.find_one({"_id": "lead_sources"}) or {}).get("sources", [])
    valid_sources = set(LEAD_SOURCES) | {item["value"] for item in custom_sources}
    if source and source not in valid_sources:
        raise HTTPException(status_code=400, detail="Invalid lead source")
    raw = (await file.read()).decode("utf-8-sig", errors="ignore")
    rows = list(csv.reader(io.StringIO(raw)))
    phone_headers = {"phone", "mobile", "phone number", "mobile number", "number", "contact", "contact number"}
    headers = [(value or "").strip().lower() for value in (rows[0] if rows else [])]
    phone_column = next((index for index, header in enumerate(headers) if header in phone_headers), None)
    if phone_column is not None:
        entries = [
            ({(headers[index] if index < len(headers) else ""): value.strip() for index, value in enumerate(row)}, phone_column)
            for row in rows[1:]
        ]
    else:
        entries = [({"phone": row[0].strip()} if row else {}, 0) for row in rows]
    created, duplicates, invalid = 0, 0, 0
    for low, phone_column in entries:
        phone_value = low.get(headers[phone_column]) if headers and phone_column < len(headers) else low.get("phone")
        phone = clean_phone(phone_value or low.get("phone") or low.get("mobile") or low.get("phone number") or "")
        name = low.get("name") or low.get("full name") or ""
        if not phone:
            invalid += 1
            continue
        if await db.leads.find_one(phone_match_query(phone)):
            duplicates += 1
            continue
        row_source = source or low.get("source") or "csv"
        doc = Lead(name=name or f"Lead {phone}", phone=phone, email=low.get("email") or None,
                   company=low.get("company") or None, city=low.get("city") or None,
               source=row_source if row_source in valid_sources else "csv").to_mongo()
        doc.update({"created_by": ObjectId(user["id"]), "assigned_to": None, "team_id": None,
                    "created_at": utcnow(), "updated_at": utcnow(), "last_action_at": utcnow()})
        await db.leads.insert_one(doc)
        created += 1
    await log_activity("leads_imported", user, None,
                       f"{created} created, {duplicates} duplicates, {invalid} invalid")
    return {"created": created, "duplicates": duplicates, "invalid": invalid}


@api.get("/lead-sources")
async def list_lead_sources(user: dict = Depends(current_user)):
    custom_sources = (await db.settings.find_one({"_id": "lead_sources"}) or {}).get("sources", [])
    builtins = [{"value": value, "label": value.replace("_", " ").title()} for value in LEAD_SOURCES]
    return builtins + custom_sources


@api.post("/lead-sources")
async def create_lead_source(payload: LeadSourceCreate, user: dict = Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create lead sources")
    name = " ".join(payload.name.split())
    value = "custom_" + "_".join(part for part in name.lower().split() if part.isalnum())
    if value == "custom_":
        raise HTTPException(status_code=400, detail="Source name must contain letters or numbers")
    existing = await db.settings.find_one({"_id": "lead_sources"}) or {}
    sources = existing.get("sources", [])
    if value in LEAD_SOURCES or any(item["value"] == value or item["label"].lower() == name.lower() for item in sources):
        raise HTTPException(status_code=409, detail="Source already exists")
    source = {"value": value, "label": name}
    await db.settings.update_one({"_id": "lead_sources"}, {"$push": {"sources": source}}, upsert=True)
    return source


@api.post("/intake/lead")
async def intake_lead(payload: IntakeLead, x_intake_key: Optional[str] = Header(None)):
    if x_intake_key != os.environ.get("INTAKE_API_KEY"):
        raise HTTPException(status_code=401, detail="Invalid intake key")
    phone = clean_phone(payload.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Valid phone required")
    existing = await db.leads.find_one(phone_match_query(phone))
    if existing:
        return {"status": "duplicate", "lead_id": str(existing["_id"])}
    source = payload.source if payload.source in LEAD_SOURCES else "other"
    doc = Lead(**{**payload.model_dump(), "phone": phone, "source": source}).to_mongo()
    doc.update({"created_by": None, "assigned_to": None, "team_id": None,
                "created_at": utcnow(), "updated_at": utcnow(), "last_action_at": utcnow()})
    res = await db.leads.insert_one(doc)
    lead = await db.leads.find_one({"_id": res.inserted_id})
    await log_activity("lead_captured", None, lead, f"source: {source}")
    return {"status": "created", "lead_id": str(res.inserted_id)}


# ------------------------------------------------------------------ escalation
async def run_escalation() -> dict:
    cutoff = utcnow() - timedelta(hours=ESCALATION_HOURS)
    stale = await db.leads.find({
        "status": "assigned",
        "assigned_to": {"$ne": None},
        "assigned_at": {"$lt": cutoff},
        "notes": {"$size": 0},
        "$or": [{"last_action_at": None}, {"last_action_at": {"$lt": cutoff}}],
    }).to_list(500)
    reassigned = 0
    for lead in stale:
        caller = await next_telecaller(exclude=lead.get("assigned_to"))
        if not caller:
            break
        await db.leads.update_one({"_id": lead["_id"]}, {"$set": {"escalated": True}})
        await log_activity("lead_escalated", None, lead,
                           f"No action for {ESCALATION_HOURS}h - reassigned")
        await apply_assignment(lead, caller, None, "lead_reassigned")
        await db.leads.update_one({"_id": lead["_id"]}, {"$set": {"escalated": True}})
        reassigned += 1
    return {"checked": len(stale), "reassigned": reassigned}


@api.post("/escalation/run")
async def escalation_run(user: dict = Depends(current_user)):
    require_perm(user, "escalation:run")
    return await run_escalation()


@api.post("/cron/escalate-leads")
async def cron_escalate(request: Request, background: BackgroundTasks):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer ") or header[7:] != secret:
        raise HTTPException(status_code=401, detail="Unauthorized")
    background.add_task(run_escalation)
    return {"accepted": True}


# ------------------------------------------------------------------ reports
@api.get("/reports/dashboard")
async def dashboard(period: str = "today", from_date: Optional[str] = None,
                    to_date: Optional[str] = None, user: dict = Depends(current_user)):
    scope = await lead_scope(user)
    now = utcnow()
    day_start, day_end = local_day_bounds()
    week_start, _ = local_period_bounds("week")
    month_start, _ = local_period_bounds("month")
    period_start, period_end = perf_bounds(period, from_date, to_date)

    async def count(extra):
        return await db.leads.count_documents({**scope, **extra})

    by_status = await db.leads.aggregate([
        {"$match": scope}, {"$group": {"_id": "$status", "count": {"$sum": 1}}}
    ]).to_list(50)
    by_source = await db.leads.aggregate([
        {"$match": scope}, {"$group": {"_id": "$source", "count": {"$sum": 1}}}
    ]).to_list(50)

    total = await count({})
    converted = await count({"status": "converted"})
    connected_leads = await count_connected_leads(scope=scope)
    conversion_call_users = None
    if user["role"] == "team_leader":
        conversion_call_users = await team_member_ids(user)
    elif user["role"] == "telecaller":
        conversion_call_users = [ObjectId(user["id"])]
    connected_calls = await count_connected_calls(user_ids=conversion_call_users)
    call_query = {"created_at": {"$gte": period_start, "$lt": period_end}}
    if user["role"] == "team_leader":
        call_query["user_id"] = {"$in": await team_member_ids(user)}
    elif user["role"] == "telecaller":
        call_query["user_id"] = ObjectId(user["id"])
    calls_period = await db.call_attempts.count_documents(call_query)
    connection_state = call_attempt_connection_state_expr()
    connected_period = await db.call_attempts.count_documents({**call_query, "$expr": {"$eq": [connection_state, True]}})
    not_connected_period = await db.call_attempts.count_documents({**call_query, "$expr": {"$eq": [connection_state, False]}})
    today_call_query = {**call_query, "created_at": {"$gte": day_start, "$lt": day_end},
                        "status_code": {"$gte": 200, "$lt": 300}}
    calls_today = await db.call_attempts.count_documents(today_call_query)
    action_user_query = {"role": "telecaller", "removed": {"$ne": True}}
    if user["role"] == "team_leader":
        action_user_query["team_id"] = user.get("team_id")
    elif user["role"] == "telecaller":
        action_user_query["_id"] = ObjectId(user["id"])
    action_users = await db.users.find(action_user_query, {"_id": 1}).to_list(200)
    action_user_ids = [member["_id"] for member in action_users]
    total_actions_today = await db.activities.count_documents({
        "actor_id": {"$in": action_user_ids}, "created_at": {"$gte": day_start, "$lt": day_end},
    }) if action_user_ids else 0
    revenue_scope = {**scope, "conversion_status": "approved"}
    async def revenue_between(start, end):
        row = await db.leads.aggregate([
            {"$match": {**revenue_scope, "conversion_approved_at": {"$gte": start, "$lt": end}}},
            {"$group": {"_id": None, "amount": {"$sum": {"$ifNull": ["$ticket_size", 0]}}}},
        ]).to_list(1)
        return round(row[0]["amount"], 2) if row else 0

    async def revenue_since(start):
        return await revenue_between(start, day_end if start == day_start else now)
    pending_conversions = await count({"status": "converted", "conversion_status": "pending"})
    revenue_period = await revenue_between(period_start, period_end)
    return {
        "totals": {
            "total": total,
            "converted": converted,
            "conversion_rate": round(converted / connected_calls * 100, 1) if connected_calls else 0.0,
            "connected_leads": connected_leads,
            "connected_calls": connected_calls,
            "unassigned": await count({"assigned_to": None}),
            "escalated": await count({"escalated": True}),
            "actionless_24h": await count({"assigned_to": {"$ne": None}, "notes": {"$size": 0},
                                           "status": {"$nin": ["converted", "lost", "not_interested"]},
                                           "last_action_at": {"$lt": now - timedelta(hours=24)}}),
            "due_today": await count({"next_follow_up_at": {"$gte": day_start, "$lte": day_end}}),
            "overdue": await count({"next_follow_up_at": {"$lt": now},
                                    "status": {"$nin": ["converted", "lost", "not_interested"]}}),
            "new_today": await count({"created_at": {"$gte": day_start}}),
            "new_leads_period": await count({"created_at": {"$gte": period_start, "$lt": period_end}}),
            "calls_today": calls_today,
            "total_actions_today": total_actions_today,
            "calls_period": calls_period,
            "connected_period": connected_period,
            "not_connected_period": not_connected_period,
            "revenue_period": revenue_period,
            "revenue_today": await revenue_since(day_start),
            "revenue_week": await revenue_since(week_start),
            "revenue_month": await revenue_since(month_start),
            "pending_conversions": pending_conversions,
        },
        "by_status": [{"status": s["_id"], "count": s["count"]} for s in by_status],
        "by_source": [{"source": s["_id"] or "other", "count": s["count"]} for s in by_source],
    }


async def report_action_stats(member_ids: list, start, end) -> dict:
    stats = {}
    if not member_ids:
        return stats
    rows = await db.activities.aggregate([
        {"$match": {"actor_id": {"$in": member_ids}, "created_at": {"$gte": start, "$lt": end}}},
        {"$project": {
            "actor_id": 1, "action": 1,
            "status_to": {"$ifNull": ["$status_to", {"$arrayElemAt": [
                {"$split": [{"$ifNull": ["$detail", ""]}, " -> "]}, 1,
            ]}]},
        }},
        {"$group": {"_id": {"actor_id": "$actor_id", "action": "$action", "status_to": "$status_to"},
                     "count": {"$sum": 1}}},
    ]).to_list(10000)
    for row in rows:
        member_id = str(row["_id"]["actor_id"])
        action = row["_id"].get("action")
        entry = stats.setdefault(member_id, {"total_actions": 0, "status_changes": 0, "status_actions": {}})
        entry["total_actions"] += row["count"]
        if action == "status_changed":
            entry["status_changes"] += row["count"]
            status = row["_id"].get("status_to")
            if status:
                entry["status_actions"][status] = entry["status_actions"].get(status, 0) + row["count"]
    acted_rows = await db.activities.aggregate([
        {"$match": {"actor_id": {"$in": member_ids}, "lead_id": {"$ne": None},
                    "created_at": {"$gte": start, "$lt": end}}},
        {"$group": {"_id": {"actor_id": "$actor_id", "lead_id": "$lead_id"}}},
        {"$group": {"_id": "$_id.actor_id", "leads_acted": {"$sum": 1}}},
    ]).to_list(200)
    for row in acted_rows:
        entry = stats.setdefault(str(row["_id"]), {"total_actions": 0, "status_changes": 0, "status_actions": {}})
        entry["leads_acted"] = row["leads_acted"]
    return stats


async def report_call_attempt_stats(member_ids: list, start, end) -> dict:
    stats = {}
    if not member_ids:
        return stats
    rows = await db.call_attempts.aggregate([
        {"$match": {"user_id": {"$in": member_ids}, "created_at": {"$gte": start, "$lt": end}}},
        {"$group": {
            "_id": {"user_id": "$user_id", "call_number": {"$ifNull": ["$call_number", 0]}},
            "dialed": {"$sum": 1},
            "post_call_statuses": {"$push": "$post_call_status"},
            "connected": {"$sum": {"$cond": [{"$eq": [call_attempt_connection_state_expr(), True]}, 1, 0]}},
            "not_connected": {"$sum": {"$cond": [{"$eq": [call_attempt_connection_state_expr(), False]}, 1, 0]}},
        }},
    ]).to_list(10000)
    for row in rows:
        member_id = str(row["_id"]["user_id"])
        call_number = str(row["_id"].get("call_number", 0))
        status_counts = {}
        for status in row.get("post_call_statuses", []):
            if status:
                status_counts[status] = status_counts.get(status, 0) + 1
        stats.setdefault(member_id, {})[call_number] = {
            "dialed": row["dialed"], "connected": row["connected"],
            "not_connected": row["not_connected"],
            "statuses": status_counts,
        }
    return stats


@api.get("/reports/performance")
async def performance(period: str = "today", from_date: Optional[str] = None,
                      to_date: Optional[str] = None, user: dict = Depends(current_user)):
    if not (has_perm(user["role"], "report:read") or has_perm(user["role"], "report:read_team") or user["role"] == "telecaller"):
        raise HTTPException(status_code=403, detail="Not permitted")
    scope = await lead_scope(user)
    now = utcnow()
    period_start, period_end = perf_bounds(period, from_date, to_date)
    day_start, day_end = local_day_bounds()
    week_start, _ = local_period_bounds("week")
    month_start, _ = local_period_bounds("month")
    member_query = {"role": "telecaller", "removed": {"$ne": True}}
    if user["role"] == "team_leader":
        member_query["team_id"] = user.get("team_id")
    elif user["role"] == "telecaller":
        member_query["_id"] = ObjectId(user["id"])
    members = await db.users.find(member_query, {"name": 1, "active": 1}).to_list(200)
    member_ids = [member["_id"] for member in members]
    rows = await db.leads.aggregate([
        {"$match": {**scope, "assigned_to": {"$in": member_ids}}},
        {"$group": {
            "_id": "$assigned_to",
            "name": {"$first": "$assigned_to_name"},
            "total": {"$sum": 1},
            "converted": {"$sum": {"$cond": [{"$eq": ["$status", "converted"]}, 1, 0]}},
            "lost": {"$sum": {"$cond": [{"$eq": ["$status", "lost"]}, 1, 0]}},
            "interested": {"$sum": {"$cond": [{"$eq": ["$status", "interested"]}, 1, 0]}},
            "notes": {"$sum": {"$size": {"$ifNull": ["$notes", []]}}},
            "escalated": {"$sum": {"$cond": ["$escalated", 1, 0]}},
            "reassigned": {"$sum": "$reassign_count"},
            "not_connected": {"$sum": {"$cond": [{"$in": ["$status", ["new_lead", "assigned"]]}, 1, 0]}},
            "overdue": {"$sum": {"$cond": [{"$and": [
                {"$ne": ["$next_follow_up_at", None]},
                {"$lt": ["$next_follow_up_at", now]},
            ]}, 1, 0]}},
        }},
        {"$sort": {"total": -1}},
    ]).to_list(100)
    connected_leads_by_user = await connected_lead_counts_by_user(member_ids)
    connected_calls_by_user = await connected_call_counts_by_user(member_ids)
    action_stats = await report_action_stats(member_ids, period_start, period_end)
    attempt_stats = await report_call_attempt_stats(member_ids, period_start, period_end)
    assigned_rows = await db.leads.aggregate([
        {"$match": {"assigned_to": {"$in": member_ids}, "$or": [
            {"assigned_at": {"$gte": period_start, "$lt": period_end}},
            {"assigned_at": {"$in": [None]}, "created_at": {"$gte": period_start, "$lt": period_end}},
        ]}},
        {"$group": {"_id": "$assigned_to", "count": {"$sum": 1}}},
    ]).to_list(200)
    leads_by_period = {str(row["_id"]): row["count"] for row in assigned_rows if row.get("_id")}
    connected_leads_by_period = await connected_lead_counts_by_user(member_ids, period_start, period_end)
    connected_calls_by_period = await connected_call_counts_by_user(member_ids, period_start, period_end)
    converted_rows = await db.leads.aggregate([
        {"$match": {"assigned_to": {"$in": member_ids}, "status": "converted",
                    "updated_at": {"$gte": period_start, "$lt": period_end}}},
        {"$group": {"_id": "$assigned_to", "count": {"$sum": 1}}},
    ]).to_list(200)
    converted_by_period = {str(row["_id"]): row["count"] for row in converted_rows if row.get("_id")}
    call_rows = await db.call_attempts.aggregate([
        {"$match": {"user_id": {"$in": member_ids},
                    "created_at": {"$gte": period_start, "$lt": period_end}}},
        {"$group": {
            "_id": "$user_id",
            "calls": {"$sum": 1},
            "connected": {"$sum": {"$cond": [{"$eq": [call_attempt_connection_state_expr(), True]}, 1, 0]}},
            "not_connected": {"$sum": {"$cond": [{"$eq": [call_attempt_connection_state_expr(), False]}, 1, 0]}},
        }},
    ]).to_list(200)
    calls_by_period = {str(row["_id"]): row for row in call_rows if row.get("_id")}
    revenue_rows = await db.leads.aggregate([
        {"$match": {"assigned_to": {"$in": member_ids}, "conversion_status": "approved",
                    "conversion_approved_at": {"$gte": period_start, "$lt": period_end}}},
        {"$group": {"_id": "$assigned_to", "amount": {"$sum": {"$ifNull": ["$ticket_size", 0]}}}},
    ]).to_list(200)
    revenue_by_period = {str(row["_id"]): round(row["amount"], 2) for row in revenue_rows if row.get("_id")}
    revenue_summary_start = min(day_start, week_start, month_start)
    revenue_summary_rows = await db.leads.aggregate([
        {"$match": {"assigned_to": {"$in": member_ids}, "conversion_status": "approved",
                    "conversion_approved_at": {"$gte": revenue_summary_start, "$lt": now}}},
        {"$group": {
            "_id": "$assigned_to",
            **{
                f"{label}": {"$sum": {"$cond": [
                    {"$gte": ["$conversion_approved_at", start]},
                    {"$ifNull": ["$ticket_size", 0]},
                    0,
                ]}}
                for label, start in (("today", day_start), ("week", week_start), ("month", month_start))
            },
        }},
    ]).to_list(200)
    revenue_by_member = {str(row["_id"]): row for row in revenue_summary_rows if row.get("_id")}
    calls_today = await db.activities.aggregate([
        {"$match": {"action": "call_note_added", "created_at": {"$gte": day_start, "$lt": day_end}}},
        {"$group": {"_id": "$actor_id", "count": {"$sum": 1}}},
    ]).to_list(200)
    calls_by_member = {str(r["_id"]): r["count"] for r in calls_today if r.get("_id")}
    direct_calls = await db.call_attempts.aggregate([
        {"$match": {"created_at": {"$gte": day_start, "$lt": day_end}, "status_code": {"$gte": 200, "$lt": 300}}},
        {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
    ]).to_list(200)
    for row in direct_calls:
        if row.get("_id"):
            member_id = str(row["_id"])
            calls_by_member[member_id] = calls_by_member.get(member_id, 0) + row["count"]
    lead_rows = {str(r["_id"]): r for r in rows}
    telecallers = []
    for member in members:
        member_id = str(member["_id"])
        r = lead_rows.get(member_id, {})
        call_stats = calls_by_period.get(member_id, {})
        total = r.get("total", 0)
        period_leads = leads_by_period.get(member_id, 0)
        period_converted = converted_by_period.get(member_id, 0)
        action_summary = action_stats.get(member_id, {})
        member_attempts = attempt_stats.get(member_id, {})
        revenue_summary = revenue_by_member.get(member_id, {})
        telecallers.append({
            "id": member_id, "name": member.get("name") or "Unknown", "active": member.get("active", True),
            "total": total, "converted": r.get("converted", 0), "lost": r.get("lost", 0),
            "interested": r.get("interested", 0), "connected": call_stats.get("connected", 0),
            "not_connected": call_stats.get("not_connected", 0),
            "leads_acted": action_summary.get("leads_acted", 0),
            "total_actions": action_summary.get("total_actions", 0),
            "status_changes": action_summary.get("status_changes", 0),
            "status_actions": action_summary.get("status_actions", {}),
            "converted_actions": action_summary.get("status_actions", {}).get("converted", 0),
            "call_attempts": {str(number): member_attempts.get(str(number), {
                "dialed": 0, "connected": 0, "not_connected": 0,
            }) for number in range(1, 5)},
            "leads_period": period_leads, "converted_period": period_converted,
            "calls_period": call_stats.get("calls", 0),
            "revenue_period": revenue_by_period.get(member_id, 0),
            "calls_today": calls_by_member.get(member_id, 0),
            "notes": r.get("notes", 0), "escalated": r.get("escalated", 0),
            "reassigned": r.get("reassigned", 0), "overdue": r.get("overdue", 0),
            "conversion_rate": round(r.get("converted", 0) / connected_calls_by_user.get(member_id, 0) * 100, 1)
                if connected_calls_by_user.get(member_id, 0) else 0.0,
            "connected_leads": connected_leads_by_user.get(member_id, 0),
            "conversion_rate_period": round(period_converted / connected_calls_by_period.get(member_id, 0) * 100, 1)
                if connected_calls_by_period.get(member_id, 0) else 0.0,
            "connected_leads_period": connected_leads_by_period.get(member_id, 0),
            "connected_calls_period": connected_calls_by_period.get(member_id, 0),
            "revenue_today": round(revenue_summary.get("today", 0), 2),
            "revenue_week": round(revenue_summary.get("week", 0), 2),
            "revenue_month": round(revenue_summary.get("month", 0), 2),
        })

    team_connected_leads = await connected_lead_counts_by_team()
    team_connected_calls = await connected_call_counts_by_team()
    team_rows = await db.leads.aggregate([
        {"$match": {**scope, "team_id": {"$ne": None}}},
        {"$group": {"_id": "$team_id", "total": {"$sum": 1},
                    "converted": {"$sum": {"$cond": [{"$eq": ["$status", "converted"]}, 1, 0]}}}},
    ]).to_list(50)
    team_ids = [row["_id"] for row in team_rows]
    team_docs = await db.teams.find({"_id": {"$in": team_ids}}).to_list(len(team_ids)) if team_ids else []
    team_names = {str(team["_id"]): team.get("name", "Unassigned") for team in team_docs}
    teams = []
    for t in team_rows:
        teams.append({
            "id": str(t["_id"]), "name": team_names.get(str(t["_id"]), "Unassigned"),
            "total": t["total"], "converted": t["converted"],
            "conversion_rate": round(t["converted"] / team_connected_calls.get(str(t["_id"]), 0) * 100, 1)
                if team_connected_calls.get(str(t["_id"]), 0) else 0.0,
            "connected_leads": team_connected_leads.get(str(t["_id"]), 0),
            "connected_calls": team_connected_calls.get(str(t["_id"]), 0),
        })
    return {"telecallers": telecallers, "teams": teams}


@api.get("/reports/conversions")
async def conversion_report(status: str = "pending", user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "subadmin", "team_leader"):
        raise HTTPException(status_code=403, detail="Not permitted")
    query = {**await lead_scope(user), "status": "converted"}
    if status in ("pending", "approved", "rejected"):
        query["conversion_status"] = status
    leads = await db.leads.find(query).sort("conversion_requested_at", -1).to_list(500)
    return [serialize(lead) for lead in leads]


@api.get("/reports/telecallers/{telecaller_id}")
async def telecaller_report(telecaller_id: str, period: str = "month",
                            from_date: Optional[str] = None, to_date: Optional[str] = None,
                            user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "subadmin", "team_leader", "telecaller"):
        raise HTTPException(status_code=403, detail="Not permitted")
    if user["role"] == "telecaller" and telecaller_id != user["id"]:
        raise HTTPException(status_code=403, detail="You can only view your own report")
    member = await db.users.find_one({"_id": oid(telecaller_id), "role": "telecaller",
                                      "removed": {"$ne": True}},
                                     {"password_hash": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Telecaller not found")
    if user["role"] == "team_leader" and str(member.get("team_id")) != str(user.get("team_id")):
        raise HTTPException(status_code=403, detail="Telecaller is not in your team")
    period_start, period_end = perf_bounds(period, from_date, to_date)
    lead_scope_query = {"assigned_to": member["_id"]}
    all_leads = await db.leads.find(lead_scope_query).to_list(5000)
    by_status = {}
    for lead in all_leads:
        by_status[lead.get("status", "new_lead")] = by_status.get(lead.get("status", "new_lead"), 0) + 1
    calls = await db.call_attempts.find({"user_id": member["_id"],
                                         "created_at": {"$gte": period_start, "$lt": period_end}}).sort("created_at", -1).to_list(500)
    call_lead_ids = list({call["lead_id"] for call in calls if call.get("lead_id")})
    call_leads = await db.leads.find({"_id": {"$in": call_lead_ids}}).to_list(len(call_lead_ids)) if call_lead_ids else []
    call_leads_by_id = {lead["_id"]: lead for lead in call_leads}
    notes = await db.activities.find({"actor_id": member["_id"], "created_at": {"$gte": period_start, "$lt": period_end}}).sort("created_at", -1).to_list(500)
    manual_calls = [activity for activity in notes if activity.get("action") == "call_note_added"]
    revenue_row = await db.leads.aggregate([
        {"$match": {**lead_scope_query, "conversion_status": "approved",
                     "conversion_approved_at": {"$gte": period_start, "$lt": period_end}}},
        {"$group": {"_id": None, "amount": {"$sum": {"$ifNull": ["$ticket_size", 0]}}}},
    ]).to_list(1)
    approved_revenue = round(revenue_row[0]["amount"], 2) if revenue_row else 0
    converted_period = await db.leads.count_documents({**lead_scope_query, "status": "converted",
        "updated_at": {"$gte": period_start, "$lt": period_end}})
    member_id = str(member["_id"])
    action_summary = (await report_action_stats([member["_id"]], period_start, period_end)).get(member_id, {})
    attempt_summary = (await report_call_attempt_stats([member["_id"]], period_start, period_end)).get(member_id, {})
    return {
        "member": serialize(member), "period": period,
        "period_start": iso(period_start), "period_end": iso(period_end),
        "totals": {"leads": len(all_leads), "converted": by_status.get("converted", 0),
                    "converted_period": converted_period, "notes": len(notes),
                    "calls": len(calls) + len(manual_calls), "approved_revenue": approved_revenue,
                    "total_actions": action_summary.get("total_actions", 0),
                    "status_changes": action_summary.get("status_changes", 0),
                    "converted_actions": action_summary.get("status_actions", {}).get("converted", 0)},
        "status_actions": action_summary.get("status_actions", {}),
        "call_attempts": {str(number): attempt_summary.get(str(number), {
            "dialed": 0, "connected": 0, "not_connected": 0,
        }) for number in range(1, 5)},
        "by_status": by_status,
        "calls": [*([serialize_call_attempt(call, call_leads_by_id.get(call.get("lead_id"))) for call in calls]), *[
            {"id": str(activity["_id"]), "subject": activity.get("detail") or "Call note",
             "created_at": iso(activity.get("created_at")), "status_code": "Manual note"}
            for activity in manual_calls
        ]],
        "activities": [serialize(activity) for activity in notes],
    }


def serialize_call_attempt(call: dict, lead: Optional[dict] = None) -> dict:
    succeeded = 200 <= call.get("status_code", 0) < 300
    created_at = iso(call.get("created_at"))
    return {
        "id": str(call["_id"]),
        "kind": "call",
        "subject": f"Call to {call.get('destination_number') or 'unknown number'}",
        "description": "Smartflo call attempt",
        "status": "completed" if succeeded else "failed",
        "call_type": "outbound",
        "call_status": "completed" if succeeded else "failed",
        "outcome": "Connected" if succeeded else "Failed to connect",
        "completed_at": created_at,
        "created_at": created_at,
        "contact_name": (lead or {}).get("name") or "Unknown contact",
        "related_lead_id": str(call["lead_id"]) if call.get("lead_id") else None,
        "owner_id": str(call["user_id"]) if call.get("user_id") else None,
        "owner_name": call.get("user_name"),
        "call_mode": call.get("call_mode"),
        "status_code": call.get("status_code"),
        "duration": call.get("duration"),
        "connected": call.get("connected"),
        "call_number": call.get("call_number"),
        "call_outcome": call.get("call_outcome"),
        "post_call_status": call.get("post_call_status"),
        "outcome_updated_by_name": call.get("outcome_updated_by_name"),
    }


async def call_attempt_scope(user: dict) -> dict:
    if user["role"] in ("admin", "subadmin"):
        return {}
    if user["role"] == "team_leader":
        return {"user_id": {"$in": await team_member_ids(user)}}
    return {"user_id": ObjectId(user["id"])}


@api.get("/crm-activities")
async def crm_activities(kind: Optional[str] = None, lead_id: Optional[str] = None,
                         from_date: Optional[str] = None, to_date: Optional[str] = None,
                         call_status: Optional[str] = None, user_id: Optional[str] = None,
                         user: dict = Depends(current_user)):
    created_range = None
    if from_date or to_date:
        try:
            start = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=TEAM_TZ) if from_date else None
            end = (datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=TEAM_TZ) if to_date else None
        except ValueError:
            raise HTTPException(status_code=400, detail="Dates must use YYYY-MM-DD format")
        created_range = {}
        if start:
            created_range["$gte"] = start.astimezone(timezone.utc)
        if end:
            created_range["$lt"] = end.astimezone(timezone.utc)
    lead_filter = None
    if lead_id:
        lead = await db.leads.find_one({"_id": oid(lead_id)})
        lead_filter = {"related_lead_id": oid(lead_id)}
        if lead and lead.get("name"):
            lead_filter = {"$or": [lead_filter, {"contact_name": lead["name"]}]}
    if kind == "call":
        attempt_query = await call_attempt_scope(user)
        if created_range:
            attempt_query["created_at"] = created_range
        if user_id:
            requested_user = oid(user_id)
            if user["role"] == "telecaller" and requested_user != ObjectId(user["id"]):
                raise HTTPException(status_code=403, detail="You can only view your own calls")
            if user["role"] == "team_leader" and requested_user not in await team_member_ids(user):
                raise HTTPException(status_code=403, detail="Caller is not in your team")
            attempt_query["user_id"] = requested_user
        if call_status == "connected":
            attempt_query["status_code"] = {"$gte": 200, "$lt": 300}
        elif call_status in ("failed", "not_connected"):
            attempt_query["$or"] = [
                {"status_code": {"$lt": 200}},
                {"status_code": {"$gte": 300}},
                {"status_code": {"$exists": False}},
            ]
        attempts = await db.call_attempts.find(attempt_query).sort("created_at", -1).to_list(5000)
        lead_ids = {call["lead_id"] for call in attempts if call.get("lead_id")}
        leads = await db.leads.find({"_id": {"$in": list(lead_ids)}}).to_list(500) if lead_ids else []
        lead_by_id = {lead["_id"]: lead for lead in leads}
        calls = [serialize_call_attempt(call, lead_by_id.get(call.get("lead_id"))) for call in attempts]
        manual_query = {"kind": "call"}
        if created_range:
            manual_query["created_at"] = created_range
        if lead_filter:
            manual_query.update(lead_filter)
        if user["role"] == "team_leader":
            manual_query["owner_id"] = {"$in": await team_member_ids(user)}
        elif user["role"] == "telecaller":
            manual_query["owner_id"] = ObjectId(user["id"])
        if user_id:
            requested_user = oid(user_id)
            if user["role"] == "telecaller" and requested_user != ObjectId(user["id"]):
                raise HTTPException(status_code=403, detail="You can only view your own calls")
            if user["role"] == "team_leader" and requested_user not in await team_member_ids(user):
                raise HTTPException(status_code=403, detail="Caller is not in your team")
            manual_query["owner_id"] = requested_user
        if call_status:
            manual_query["call_status"] = "completed" if call_status == "connected" else {"$ne": "completed"}
        manual = await db.crm_activities.find(manual_query).sort("created_at", -1).to_list(500)
        return sorted([serialize(activity) for activity in manual] + calls,
                      key=lambda item: item.get("created_at") or "", reverse=True)

    query = {"kind": kind} if kind else {}
    if lead_filter:
        query.update(lead_filter)
    docs = await db.crm_activities.find(query).sort("created_at", -1).to_list(500)
    return [serialize(doc) for doc in docs]


@api.post("/crm-activities")
async def create_crm_activity(payload: CrmActivityCreate, user: dict = Depends(current_user)):
    now = utcnow()
    activity = CrmActivity(**payload.model_dump(), owner_id=user["id"], owner_name=user["name"],
                           created_by=user["id"], created_at=now, updated_at=now)
    doc = activity.to_mongo()
    for field in ("owner_id", "created_by", "related_lead_id"):
        if doc.get(field):
            doc[field] = ObjectId(doc[field])
    result = await db.crm_activities.insert_one(doc)
    return serialize(await db.crm_activities.find_one({"_id": result.inserted_id}))


@api.patch("/crm-activities/{activity_id}")
async def update_crm_activity(activity_id: str, payload: CrmActivityUpdate,
                               user: dict = Depends(current_user)):
    activity = await db.crm_activities.find_one({"_id": oid(activity_id)})
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    updates = payload.model_dump(exclude_none=True)
    if updates.get("status") == "completed" and "completed_at" not in updates:
        updates["completed_at"] = utcnow()
    updates["updated_at"] = utcnow()
    await db.crm_activities.update_one({"_id": activity["_id"]}, {"$set": updates})
    return serialize(await db.crm_activities.find_one({"_id": activity["_id"]}))


@api.delete("/crm-activities/{activity_id}")
async def delete_crm_activity(activity_id: str, user: dict = Depends(current_user)):
    result = await db.crm_activities.delete_one({"_id": oid(activity_id)})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Activity not found")
    return {"deleted": True, "id": activity_id}


@api.get("/activities")
async def activities(lead_id: Optional[str] = None, limit: int = 100,
                     user: dict = Depends(current_user)):
    if user["role"] == "telecaller":
        raise HTTPException(status_code=403, detail="Not permitted")
    query = {}
    if lead_id:
        query["lead_id"] = oid(lead_id)
    if user["role"] == "team_leader":
        ids = [d["_id"] for d in await db.leads.find(await lead_scope(user), {"_id": 1}).to_list(1000)]
        query["lead_id"] = {"$in": ids}
    docs = await db.activities.find(query).sort("created_at", -1).to_list(limit)
    return [serialize(d) for d in docs]


@api.get("/team-chat")
async def team_chat(limit: int = 200, user: dict = Depends(current_user)):
    query = {}
    if user["role"] == "team_leader":
        query["team_id"] = oid(user["team_id"]) if user.get("team_id") else None
    elif user["role"] == "telecaller":
        query["$or"] = [{"team_id": oid(user["team_id"])} if user.get("team_id") else {"team_id": None},
                        {"team_id": None}]
    docs = await db.chat_messages.find(query).sort("created_at", -1).limit(min(limit, 500)).to_list(min(limit, 500))
    return [serialize(doc) for doc in reversed(docs)]


@api.post("/team-chat")
async def send_team_chat(payload: ChatMessageCreate, user: dict = Depends(current_user)):
    message = ChatMessage(text=payload.text.strip(), sender_id=user["id"], sender_name=user["name"],
                          sender_role=user["role"], team_id=user.get("team_id"), created_at=utcnow()).to_mongo()
    message["sender_id"] = ObjectId(user["id"])
    message["team_id"] = ObjectId(user["team_id"]) if user.get("team_id") else None
    result = await db.chat_messages.insert_one(message)
    return serialize(await db.chat_messages.find_one({"_id": result.inserted_id}))


@api.get("/meta")
async def meta(user: dict = Depends(current_user)):
    return {"statuses": list(LEAD_STATUSES), "sources": list(LEAD_SOURCES), "roles": list(ROLES),
            "escalation_hours": ESCALATION_HOURS}


@api.api_route("/calls/smartflo-webhook", methods=["GET", "POST"])
async def smartflo_webhook(request: Request):
    """Tata Smartflo call-status callback -> records true connected status + duration."""
    provided = request.query_params.get("secret") or request.headers.get("X-Webhook-Secret")
    if SMARTFLO_WEBHOOK_SECRET and provided != SMARTFLO_WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")
    if request.method == "GET":
        # Provider handshake / URL verification only — never mutate on GET.
        return {"ok": True, "handshake": True}
    payload = {}
    if request.method == "POST":
        try:
            if "application/json" in request.headers.get("content-type", ""):
                payload = await request.json()
            else:
                payload = dict(await request.form())
        except Exception:
            payload = {}
    data = {**dict(request.query_params), **(payload if isinstance(payload, dict) else {})}
    call_id = (data.get("call_id") or data.get("ref_id") or data.get("reference_id")
               or data.get("unique_id") or data.get("call_uuid") or data.get("uuid")
               or data.get("callid") or data.get("id") or data.get("CallSid"))
    destination = data.get("destination_number") or data.get("customer_number") or data.get("called_number")

    def first_int(*keys):
        for key in keys:
            value = data.get(key)
            try:
                if value not in (None, ""):
                    return int(float(value))
            except (ValueError, TypeError):
                continue
        return None

    duration = first_int("call_duration", "duration", "conversation_duration", "billsec", "answered_seconds")
    status_str = str(data.get("status") or data.get("call_status") or data.get("hangup_cause")
                     or data.get("disposition") or "").lower()
    connected = duration > 0 if duration is not None else None
    if any(w in status_str for w in ("miss", "noanswer", "no answer", "no-answer", "no_answer",
                                     "busy", "fail", "cancel", "reject", "notanswer",
                                     "not_connected", "not connected", "unanswered")):
        connected = False
    elif connected is None and any(w in status_str for w in ("answer", "complete", "connected", "success")):
        connected = True

    match = None
    if call_id:
        match = await db.call_attempts.find_one({"provider_call_id": str(call_id)})
    if not match and destination:
        match = await db.call_attempts.find_one(
            {"destination_number": smartflo_number(destination)}, sort=[("created_at", -1)])
    if not match:
        return {"ok": True, "matched": False}
    updates = {"duration": duration, "disposition": status_str or None,
               "webhook_at": utcnow(), "webhook_payload": data}
    if connected is not None:
        updates["connected"] = connected
        updates["call_outcome"] = "connected" if connected else "not_connected"
    await db.call_attempts.update_one({"_id": match["_id"]}, {"$set": updates})
    return {"ok": True, "matched": True, "connected": connected, "duration": duration}


async def perf_scope_members(user: dict, telecaller_id: Optional[str]):
    query = {"role": "telecaller", "removed": {"$ne": True}}
    if user["role"] == "team_leader":
        query["team_id"] = oid(user["team_id"]) if user.get("team_id") else None
    if telecaller_id:
        query["_id"] = oid(telecaller_id)
    return await db.users.find(query, {"password_hash": 0}).sort("name", 1).to_list(200)


EFFICIENCY_FACTORS = [
    ("login_punctuality", "Login punctuality", 5),
    ("total_login_hours", "Total login hours", 8),
    ("logout_compliance", "Logout compliance", 5),
    ("calls_dialed", "Calls dialed", 10),
    ("connected_calls", "Connected calls", 7),
    ("connection_rate", "Call connection rate", 8),
    ("lead_conversion_rate", "Lead conversion rate", 10),
    ("interested_leads", "Interested leads", 5),
    ("follow_up_completion", "Follow-up completion", 7),
    ("lead_handling_efficiency", "Lead handling efficiency", 7),
    ("average_call_duration", "Average call duration", 5),
    ("break_compliance", "Break time compliance", 4),
    ("target_achievement", "Target achievement", 10),
    ("crm_data_accuracy", "CRM data accuracy", 4),
    ("productive_time", "Productive time", 5),
]
EFFICIENCY_DEFAULTS = {
    "weights": {key: weight for key, _, weight in EFFICIENCY_FACTORS},
    "targets": {
        "login_punctuality": 100, "total_login_hours": 8, "logout_compliance": 100,
        "calls_dialed": 80, "connected_calls": 35, "connection_rate": 40,
        "lead_conversion_rate": 10, "interested_leads": 8, "follow_up_completion": 80,
        "lead_handling_efficiency": 75, "average_call_duration": 180,
        "break_compliance": 100, "target_achievement": 100,
        "crm_data_accuracy": 98, "productive_time": 70,
    },
    "thresholds": {"green": 85, "yellow": 70},
    "allow_overachievement": False,
    "shift_start_time": "09:00",
    "shift_hours": 8,
    "break_limit_minutes": 60,
    "daily_conversion_target": 3,
}


async def get_efficiency_settings():
    saved = await db.settings.find_one({"_id": "telecaller_efficiency"})
    settings = {**EFFICIENCY_DEFAULTS, **(saved or {})}
    settings["weights"] = {**EFFICIENCY_DEFAULTS["weights"], **settings.get("weights", {})}
    settings["targets"] = {**EFFICIENCY_DEFAULTS["targets"], **settings.get("targets", {})}
    settings["thresholds"] = {**EFFICIENCY_DEFAULTS["thresholds"], **settings.get("thresholds", {})}
    settings.pop("_id", None)
    return settings

def score_member_efficiency(row: dict, settings: dict) -> dict:
    target_calls = row.get("target_calls") or settings["targets"]["calls_dialed"] * row.get("period_days", 1)
    target_conversions = row.get("target_conversions") or settings["daily_conversion_target"] * row.get("period_days", 1)
    login_punctuality = None
    if row.get("login_times"):
        shift_start = datetime.strptime(settings["shift_start_time"], "%H:%M").time()
        on_time = 0
        for login_value in row["login_times"]:
            login_at = aware(datetime.fromisoformat(login_value.replace("Z", "+00:00"))).astimezone(TEAM_TZ)
            scheduled_start = datetime.combine(login_at.date(), shift_start, tzinfo=TEAM_TZ)
            on_time += login_at <= scheduled_start
        login_punctuality = on_time / len(row["login_times"]) * 100
    metrics = {
        "login_punctuality": (login_punctuality, settings["targets"]["login_punctuality"], "%", login_punctuality is not None),
        "total_login_hours": (row.get("logged_in_hours"), settings["targets"]["total_login_hours"] * row.get("period_days", 1), "hours", row.get("session_count", 0) > 0),
        "logout_compliance": (
            row.get("logged_in_hours", 0) / (settings["shift_hours"] * row.get("period_days", 1)) * 100,
            settings["targets"]["logout_compliance"], "%", row.get("session_count", 0) > 0,
        ),
        "calls_dialed": (row.get("calls_dialed"), target_calls, "calls", row.get("has_activity", False)),
        "connected_calls": (row.get("connected_calls"), settings["targets"]["connected_calls"] * row.get("period_days", 1), "calls", row.get("has_activity", False)),
        "connection_rate": (row.get("connection_rate"), settings["targets"]["connection_rate"], "%", row.get("calls_dialed", 0) > 0),
        "lead_conversion_rate": (row.get("conversion_rate"), settings["targets"]["lead_conversion_rate"], "%", row.get("connected_calls", 0) > 0),
        "interested_leads": (row.get("interested_leads_period"), settings["targets"]["interested_leads"] * row.get("period_days", 1), "leads", row.get("has_activity", False)),
        "lead_handling_efficiency": (
            row.get("leads_contacted", 0) / row["leads_assigned_period"] * 100 if row.get("leads_assigned_period") else None,
            settings["targets"]["lead_handling_efficiency"], "%", row.get("leads_assigned_period", 0) > 0,
        ),
        "average_call_duration": (row.get("average_call_duration"), settings["targets"]["average_call_duration"], "seconds", row.get("calls_with_duration", 0) > 0),
        "target_achievement": (
            row.get("conversions", 0) / target_conversions * 100 if target_conversions else None,
            settings["targets"]["target_achievement"], "%", row.get("has_activity", False) and target_conversions > 0,
        ),
    }
    factors = []
    weighted_total = 0.0
    valid_weight = 0.0
    for key, label, _ in EFFICIENCY_FACTORS:
        weight = float(settings["weights"].get(key, 0))
        actual, target, unit, available = metrics.get(key, (None, None, "", False))
        achieved = None
        if available and actual is not None and target and target > 0:
            achieved = max(0.0, actual / target * 100)
            if not settings.get("allow_overachievement", False):
                achieved = min(100.0, achieved)
            weighted_total += achieved * weight
            valid_weight += weight
        factors.append({
            "key": key, "label": label, "weight": weight,
            "actual": round(actual, 2) if actual is not None else None,
            "target": round(target, 2) if target is not None else None,
            "unit": unit, "achievement": round(achieved, 1) if achieved is not None else None,
        })
    row["efficiency_score"] = round(weighted_total / valid_weight, 1) if valid_weight else None
    row["efficiency_valid_weight"] = round(valid_weight, 1)
    row["efficiency_factors"] = factors
    return row


async def build_member_performance(member: dict, start, end, now) -> dict:
    mid = member["_id"]
    call_q = {"user_id": mid, "created_at": {"$gte": start, "$lt": end}}
    calls_dialed = await db.call_attempts.count_documents(call_q)
    connection_state = call_attempt_connection_state_expr()
    connected_calls = await db.call_attempts.count_documents({
        **call_q, "$expr": {"$eq": [connection_state, True]},
    })
    not_connected_calls = await db.call_attempts.count_documents({
        **call_q, "$expr": {"$eq": [connection_state, False]},
    })
    call_leads = await db.call_attempts.distinct("lead_id", {**call_q, "lead_id": {"$ne": None}})
    note_acts = await db.activities.find(
        {"actor_id": mid, "action": "call_note_added", "created_at": {"$gte": start, "$lt": end}}
    ).to_list(5000)
    note_lead_ids = {a["lead_id"] for a in note_acts if a.get("lead_id")}
    leads_contacted = len({str(x) for x in call_leads} | {str(x) for x in note_lead_ids})
    follow_ups_completed = len(note_acts)
    conversions = await db.leads.count_documents(
        {"assigned_to": mid, "status": "converted", "updated_at": {"$gte": start, "$lt": end}})
    interested_leads_period = await db.leads.count_documents(
        {"assigned_to": mid, "status": "interested", "updated_at": {"$gte": start, "$lt": end}})
    assigned_period = await db.leads.count_documents({
        "assigned_to": mid,
        "$or": [
            {"assigned_at": {"$gte": start, "$lt": end}},
            {"assigned_at": {"$in": [None]}, "created_at": {"$gte": start, "$lt": end}},
        ],
    })
    follow_ups_pending = await db.leads.count_documents(
        {"assigned_to": mid, "next_follow_up_at": {"$ne": None},
         "status": {"$nin": ["converted", "lost", "not_interested"]}})
    overdue_follow_ups = await db.leads.count_documents(
        {"assigned_to": mid, "next_follow_up_at": {"$lt": now},
         "status": {"$nin": ["converted", "lost", "not_interested"]}})

    sessions = await db.sessions.find({
        "user_id": mid, "login_at": {"$lt": end},
        "$or": [{"logout_at": None}, {"logout_at": {"$gt": start}}],
    }).sort("login_at", 1).to_list(1000)
    logged_seconds, first_login, last_logout = 0, None, None
    login_times_by_day = {}
    for s in sessions:
        li = aware(s.get("login_at"))
        lo = aware(s.get("logout_at")) or aware(s.get("last_seen_at")) or now
        logged_seconds += session_seconds_in_work_window(li, lo, start, end)
        local_login = li.astimezone(TEAM_TZ)
        day_key = local_login.strftime("%Y-%m-%d")
        reported_login = min(max(li, session_workday_start(li)), session_workday_end(li))
        if day_key not in login_times_by_day or reported_login < login_times_by_day[day_key]:
            login_times_by_day[day_key] = reported_login
        if first_login is None or reported_login < first_login:
            first_login = reported_login
        cand = aware(s.get("logout_at")) or aware(s.get("last_seen_at"))
        if cand:
            cand = min(cand, session_workday_end(li))
        if cand and (last_logout is None or cand > last_logout):
            last_logout = cand

    last_call_doc = await db.call_attempts.find_one({"user_id": mid}, sort=[("created_at", -1)])
    last_call, last_call_at = None, None
    if last_call_doc:
        last_call_at = aware(last_call_doc.get("created_at"))
        lead = await db.leads.find_one({"_id": last_call_doc["lead_id"]}) if last_call_doc.get("lead_id") else None
        connected = last_call_doc.get("connected")
        if connected is True:
            status_label = "Connected"
        elif connected is False:
            status_label = "Not connected"
        elif 200 <= last_call_doc.get("status_code", 0) < 300:
            status_label = "Dialed"
        else:
            status_label = "Failed"
        last_call = {
            "contact_name": (lead or {}).get("name") or last_call_doc.get("destination_number") or "Unknown",
            "number": last_call_doc.get("destination_number"),
            "time": iso(last_call_at), "status": status_label,
            "duration": last_call_doc.get("duration"),
        }

    last_act_doc = await db.activities.find_one({"actor_id": mid}, sort=[("created_at", -1)])
    last_activity_at = aware(last_act_doc.get("created_at")) if last_act_doc else None
    status = await user_live_status(mid, now, last_call_at, last_activity_at)
    total_leads = await db.leads.count_documents({"assigned_to": mid})
    revenue_row = await db.leads.aggregate([
        {"$match": {"assigned_to": mid, "conversion_status": "approved",
                    "conversion_approved_at": {"$gte": start, "$lt": end}}},
        {"$group": {"_id": None, "amount": {"$sum": {"$ifNull": ["$ticket_size", 0]}}}},
    ]).to_list(1)
    approved_revenue = round(revenue_row[0]["amount"], 2) if revenue_row else 0
    talk_agg = await db.call_attempts.aggregate([
        {"$match": {**call_q, "duration": {"$gt": 0}}},
        {"$group": {"_id": None, "seconds": {"$sum": "$duration"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    total_talk_time = int(talk_agg[0]["seconds"]) if talk_agg else 0
    calls_with_duration = int(talk_agg[0]["count"]) if talk_agg else 0
    num_days = days_in_range(start, end)
    daily_call_target = int(member.get("daily_call_target") or 0)
    daily_conversion_target = int(member.get("daily_conversion_target") or 0)
    action_summary = (await report_action_stats([mid], start, end)).get(str(mid), {})
    attempt_summary = (await report_call_attempt_stats([mid], start, end)).get(str(mid), {})
    connected_leads = (await connected_lead_counts_by_user([mid], start, end)).get(str(mid), 0)

    return {
        "id": str(mid), "name": member.get("name") or "Unknown", "email": member.get("email"),
        "active": member.get("active", True), "status": status,
        "login_time": iso(first_login), "logout_time": iso(last_logout),
        "login_times": [iso(login) for login in login_times_by_day.values()],
        "logged_in_hours": round(logged_seconds / 3600, 2),
        "session_count": len(sessions),
        "calls_dialed": calls_dialed, "connected_calls": connected_calls,
        "not_connected_calls": not_connected_calls, "approved_revenue": approved_revenue,
        "total_actions": action_summary.get("total_actions", 0),
        "status_changes": action_summary.get("status_changes", 0),
        "status_actions": action_summary.get("status_actions", {}),
        "converted_actions": action_summary.get("status_actions", {}).get("converted", 0),
        "call_attempts": {str(number): attempt_summary.get(str(number), {
            "dialed": 0, "connected": 0, "not_connected": 0,
        }) for number in range(1, 5)},
        "connection_rate": round(connected_calls / calls_dialed * 100, 1) if calls_dialed else 0.0,
        "conversions": conversions,
        "conversion_rate": round(conversions / connected_calls * 100, 1) if connected_calls else 0.0,
        "connected_leads": connected_leads,
        "leads_contacted": leads_contacted,
        "leads_assigned_period": assigned_period,
        "interested_leads_period": interested_leads_period,
        "follow_ups_completed": follow_ups_completed,
        "follow_ups_pending": follow_ups_pending,
        "overdue_follow_ups": overdue_follow_ups,
        "total_leads": total_leads, "last_call": last_call,
        "total_talk_time": total_talk_time,
        "calls_with_duration": calls_with_duration,
        "average_call_duration": round(total_talk_time / calls_with_duration, 1) if calls_with_duration else None,
        "daily_call_target": daily_call_target,
        "daily_conversion_target": daily_conversion_target,
        "target_calls": daily_call_target * num_days,
        "target_conversions": daily_conversion_target * num_days,
        "period_days": num_days,
        "has_activity": bool(sessions or calls_dialed or action_summary.get("total_actions") or assigned_period),
    }


@api.get("/reports/telecaller-performance")
async def telecaller_performance(period: str = "today", from_date: Optional[str] = None,
                                 to_date: Optional[str] = None, telecaller_id: Optional[str] = None,
                                 user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "subadmin", "team_leader"):
        raise HTTPException(status_code=403, detail="Not permitted")
    start, end = perf_bounds(period, from_date, to_date)
    now = utcnow()
    members = await perf_scope_members(user, telecaller_id)
    settings = await get_efficiency_settings()
    telecallers = [score_member_efficiency(await build_member_performance(m, start, end, now), settings) for m in members]
    return {"period": period, "from": iso(start), "to": iso(end), "settings": settings, "telecallers": telecallers}


@api.get("/reports/telecaller-performance/settings")
async def telecaller_performance_settings(user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "subadmin", "team_leader"):
        raise HTTPException(status_code=403, detail="Not permitted")
    return await get_efficiency_settings()


@api.put("/reports/telecaller-performance/settings")
async def update_telecaller_performance_settings(payload: dict, user: dict = Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can change efficiency settings")
    current = await get_efficiency_settings()
    factor_keys = {key for key, _, _ in EFFICIENCY_FACTORS}
    try:
        weights = {key: float(payload.get("weights", {}).get(key, current["weights"][key])) for key in factor_keys}
        targets = {key: float(payload.get("targets", {}).get(key, current["targets"][key])) for key in factor_keys}
        shift_hours = float(payload.get("shift_hours", current["shift_hours"]))
        break_limit_minutes = float(payload.get("break_limit_minutes", current["break_limit_minutes"]))
        daily_conversion_target = float(payload.get("daily_conversion_target", current["daily_conversion_target"]))
        thresholds = {
            "green": float(payload.get("thresholds", {}).get("green", current["thresholds"]["green"])),
            "yellow": float(payload.get("thresholds", {}).get("yellow", current["thresholds"]["yellow"])),
        }
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Weights, targets, and thresholds must be numeric")
    numeric_values = [*weights.values(), *targets.values(), *thresholds.values(), shift_hours,
                      break_limit_minutes, daily_conversion_target]
    if any(not math.isfinite(value) for value in numeric_values):
        raise HTTPException(status_code=400, detail="Settings must contain finite numeric values")
    if any(value < 0 for value in weights.values()) or abs(sum(weights.values()) - 100) > 0.01:
        raise HTTPException(status_code=400, detail="Factor weights must be non-negative and total 100")
    if any(value <= 0 for value in targets.values()):
        raise HTTPException(status_code=400, detail="Factor targets must be greater than zero")
    shift_start_time = payload.get("shift_start_time", current["shift_start_time"])
    if not isinstance(shift_start_time, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", shift_start_time):
        raise HTTPException(status_code=400, detail="Shift start must use 24-hour HH:MM format")
    if shift_hours <= 0 or break_limit_minutes < 0 or daily_conversion_target < 0:
        raise HTTPException(status_code=400, detail="Shift hours must be positive; break and conversion targets non-negative")
    if not (0 <= thresholds["yellow"] < thresholds["green"] <= 100):
        raise HTTPException(status_code=400, detail="Thresholds must satisfy 0 <= yellow < green <= 100")
    allow_overachievement = payload.get("allow_overachievement", current["allow_overachievement"])
    if not isinstance(allow_overachievement, bool):
        raise HTTPException(status_code=400, detail="allow_overachievement must be a boolean")
    settings = {
        "weights": weights, "targets": targets, "thresholds": thresholds,
        "allow_overachievement": allow_overachievement,
        "shift_start_time": shift_start_time, "shift_hours": shift_hours,
        "break_limit_minutes": break_limit_minutes, "daily_conversion_target": daily_conversion_target,
    }
    await db.settings.replace_one({"_id": "telecaller_efficiency"},
                                  {"_id": "telecaller_efficiency", **settings}, upsert=True)
    return settings


@api.get("/reports/telecaller-performance/trend")
async def telecaller_performance_trend(period: str = "week", from_date: Optional[str] = None,
                                       to_date: Optional[str] = None, telecaller_id: Optional[str] = None,
                                       user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "subadmin", "team_leader"):
        raise HTTPException(status_code=403, detail="Not permitted")
    start, end = trend_bounds(period, from_date, to_date)
    members = await perf_scope_members(user, telecaller_id)
    ids = [m["_id"] for m in members]
    settings = await get_efficiency_settings()

    buckets = {}
    cursor = start
    while cursor < end:
        key = aware(cursor).astimezone(TEAM_TZ).strftime("%Y-%m-%d")
        buckets[key] = {"date": key, "calls": 0, "connected": 0, "not_connected": 0,
            "conversions": 0, "status_changes": 0, "logged_in_hours": 0.0,
            "session_members": set(), "first_logins": {}}
        cursor = next_ist_midnight(cursor)

    if ids:
        for c in await db.call_attempts.find(
            {"user_id": {"$in": ids}, "created_at": {"$gte": start, "$lt": end}},
            {"created_at": 1, "connected": 1, "call_outcome": 1}).to_list(50000):
            key = aware(c["created_at"]).astimezone(TEAM_TZ).strftime("%Y-%m-%d")
            if key in buckets:
                buckets[key]["calls"] += 1
                connected = c.get("connected")
                if connected is None:
                    connected = c.get("call_outcome") == "connected"
                if connected is True:
                    buckets[key]["connected"] += 1
                elif connected is False or c.get("call_outcome") in ("not_connected", "declined", "busy"):
                    buckets[key]["not_connected"] += 1
        for activity in await db.activities.find(
            {"actor_id": {"$in": ids}, "action": "status_changed",
             "created_at": {"$gte": start, "$lt": end}},
            {"created_at": 1}).to_list(50000):
            key = aware(activity["created_at"]).astimezone(TEAM_TZ).strftime("%Y-%m-%d")
            if key in buckets:
                buckets[key]["status_changes"] += 1
        for lead in await db.leads.find(
            {"assigned_to": {"$in": ids}, "status": "converted", "updated_at": {"$gte": start, "$lt": end}},
            {"updated_at": 1}).to_list(50000):
            key = aware(lead["updated_at"]).astimezone(TEAM_TZ).strftime("%Y-%m-%d")
            if key in buckets:
                buckets[key]["conversions"] += 1
        for s in await db.sessions.find(
            {"user_id": {"$in": ids}, "login_at": {"$lt": end},
             "$or": [{"logout_at": None}, {"logout_at": {"$gt": start}}]}).to_list(20000):
            login_at = aware(s.get("login_at"))
            seg_start = max(login_at, session_workday_start(login_at), start)
            seg_end = min(
                aware(s.get("logout_at")) or aware(s.get("last_seen_at")) or utcnow(),
                session_workday_end(login_at), end,
            )
            cur = seg_start
            while cur < seg_end:
                day_end = min(seg_end, next_ist_midnight(cur))
                key = aware(cur).astimezone(TEAM_TZ).strftime("%Y-%m-%d")
                if key in buckets:
                    member_key = str(s["user_id"])
                    buckets[key]["session_members"].add(member_key)
                    buckets[key]["logged_in_hours"] += session_seconds_in_work_window(
                        seg_start, seg_end, cur, day_end,
                    ) / 3600
                    login_local = max(login_at, session_workday_start(login_at)).astimezone(TEAM_TZ)
                    if login_local.strftime("%Y-%m-%d") == key:
                        previous = buckets[key]["first_logins"].get(member_key)
                        if previous is None or login_local < previous:
                            buckets[key]["first_logins"][member_key] = login_local
                cur = day_end
    daily_call_target = sum(int(m.get("daily_call_target") or settings["targets"]["calls_dialed"]) for m in members)
    daily_conversion_target = sum(
        int(m.get("daily_conversion_target") or settings["daily_conversion_target"]) for m in members
    )
    series = []
    for bucket in buckets.values():
        active_count = len(bucket["session_members"])
        has_activity = bool(active_count or bucket["calls"] or bucket["conversions"] or bucket["status_changes"])
        target_calls = daily_call_target
        target_connected = settings["targets"]["connected_calls"] * len(members)
        target_hours = settings["targets"]["total_login_hours"] * active_count
        first_logins = bucket["first_logins"]
        on_time = sum(
            login.time() <= datetime.strptime(settings["shift_start_time"], "%H:%M").time()
            for login in first_logins.values()
        )
        punctuality = on_time / len(first_logins) * 100 if first_logins else None
        trend_metrics = [
            ("login_punctuality", punctuality, settings["targets"]["login_punctuality"], bool(first_logins)),
            ("total_login_hours", bucket["logged_in_hours"], target_hours, active_count > 0),
            ("logout_compliance", bucket["logged_in_hours"] / (settings["shift_hours"] * active_count) * 100 if active_count else None,
             settings["targets"]["logout_compliance"], active_count > 0),
            ("calls_dialed", bucket["calls"], target_calls, has_activity),
            ("connected_calls", bucket["connected"], target_connected, has_activity and target_connected > 0),
            ("connection_rate", bucket["connected"] / bucket["calls"] * 100 if bucket["calls"] else None,
             settings["targets"]["connection_rate"], bucket["calls"] > 0),
            ("target_achievement", bucket["conversions"] / daily_conversion_target * 100 if daily_conversion_target else None,
             settings["targets"]["target_achievement"], has_activity and daily_conversion_target > 0),
        ]
        weighted_total = valid_weight = 0.0
        for key, actual, target, available in trend_metrics:
            weight = settings["weights"][key]
            if available and actual is not None and target and target > 0:
                achievement = max(0.0, actual / target * 100)
                if not settings["allow_overachievement"]:
                    achievement = min(100.0, achievement)
                weighted_total += achievement * weight
                valid_weight += weight
        series.append({
            "date": bucket["date"], "calls": bucket["calls"], "connected": bucket["connected"],
            "not_connected": bucket["not_connected"], "conversions": bucket["conversions"],
            "status_changes": bucket["status_changes"], "logged_in_hours": round(bucket["logged_in_hours"], 2),
            "efficiency_score": round(weighted_total / valid_weight, 1) if valid_weight else None,
            "efficiency_valid_weight": round(valid_weight, 1),
        })
    return {"period": period, "settings": settings, "series": series}


@api.get("/reports/telecaller-performance/{telecaller_id}/timeline")
async def telecaller_timeline(telecaller_id: str, period: str = "today", from_date: Optional[str] = None,
                              to_date: Optional[str] = None, user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "subadmin", "team_leader"):
        raise HTTPException(status_code=403, detail="Not permitted")
    member = await db.users.find_one({"_id": oid(telecaller_id), "role": "telecaller",
                                      "removed": {"$ne": True}}, {"password_hash": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Telecaller not found")
    if user["role"] == "team_leader" and str(member.get("team_id")) != str(user.get("team_id")):
        raise HTTPException(status_code=403, detail="Telecaller is not in your team")
    start, end = perf_bounds(period, from_date, to_date)
    mid = member["_id"]
    events = []

    for s in await db.sessions.find({"user_id": mid, "login_at": {"$gte": start, "$lt": end}}).to_list(500):
        login_at = aware(s.get("login_at"))
        reported_login = min(max(login_at, session_workday_start(login_at)), session_workday_end(login_at))
        events.append({"type": "login", "title": "Logged in", "detail": None,
                       "time": iso(reported_login), "status": "online"})
        logout_at = aware(s.get("logout_at"))
        if logout_at or utcnow() >= session_workday_end(login_at):
            events.append({"type": "logout", "title": "Logged out", "detail": None,
                           "time": iso(min(logout_at or session_workday_end(login_at), session_workday_end(login_at))),
                           "status": "offline"})

    calls = await db.call_attempts.find(
        {"user_id": mid, "created_at": {"$gte": start, "$lt": end}}).sort("created_at", -1).to_list(500)
    lead_ids = [c["lead_id"] for c in calls if c.get("lead_id")]
    leads = await db.leads.find({"_id": {"$in": lead_ids}}).to_list(500) if lead_ids else []
    lead_map = {l["_id"]: l for l in leads}
    for c in calls:
        lead = lead_map.get(c.get("lead_id"))
        connected = c.get("connected")
        status = "connected" if connected is True else ("not_connected" if connected is False else "dialed")
        duration = c.get("duration")
        detail = f"{lead.get('name')} · " if lead else ""
        detail += c.get("destination_number") or ""
        if duration is not None:
            detail += f" · {duration}s"
        events.append({"type": "call", "title": "Call " + status.replace("_", " "),
                       "detail": detail.strip(" ·"), "time": iso(aware(c.get("created_at"))),
                       "status": status})

    for a in await db.activities.find(
        {"actor_id": mid, "created_at": {"$gte": start, "$lt": end}}).sort("created_at", -1).to_list(500):
        events.append({"type": a.get("action"), "title": (a.get("action") or "activity").replace("_", " "),
                       "detail": (f"{a.get('lead_name')} · " if a.get("lead_name") else "") + (a.get("detail") or ""),
                       "time": iso(aware(a.get("created_at"))), "status": None})

    events.sort(key=lambda e: e.get("time") or "", reverse=True)
    return {"member": serialize(member), "period": period, "from": iso(start), "to": iso(end),
            "events": events[:300]}


@api.get("/reports/live-status")
async def live_status(user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "subadmin", "team_leader"):
        raise HTTPException(status_code=403, detail="Not permitted")
    now = utcnow()
    day_start, day_end = local_day_bounds()
    members = await perf_scope_members(user, None)
    out = []
    for m in members:
        mid = m["_id"]
        last_call_doc = await db.call_attempts.find_one({"user_id": mid}, sort=[("created_at", -1)])
        last_call_at = aware(last_call_doc.get("created_at")) if last_call_doc else None
        status = await user_live_status(mid, now, last_call_at)
        calls_today = await db.call_attempts.count_documents(
            {"user_id": mid, "created_at": {"$gte": day_start, "$lt": day_end}})
        connected_today = await db.call_attempts.count_documents(
            {"user_id": mid, "created_at": {"$gte": day_start, "$lt": day_end}, "connected": True})
        last_call = None
        if last_call_doc:
            lead = await db.leads.find_one({"_id": last_call_doc["lead_id"]}) if last_call_doc.get("lead_id") else None
            last_call = {
                "contact_name": (lead or {}).get("name") or last_call_doc.get("destination_number") or "Unknown",
                "time": iso(last_call_at), "duration": last_call_doc.get("duration"),
            }
        session = await db.sessions.find_one({"user_id": mid, "logout_at": None}, sort=[("login_at", -1)])
        out.append({
            "id": str(mid), "name": m.get("name") or "Unknown", "status": status,
            "calls_today": calls_today, "connected_today": connected_today,
            "last_call": last_call, "online_since": iso(aware(session.get("login_at"))) if session else None,
        })
    rank = {"on_call": 0, "online": 1, "idle": 2, "offline": 3}
    out.sort(key=lambda x: (rank.get(x["status"], 9), x["name"]))
    return {"telecallers": out, "server_time": iso(now)}


@api.get("/reports/my-performance")
async def my_performance(period: str = "today", from_date: Optional[str] = None,
                         to_date: Optional[str] = None, user: dict = Depends(current_user)):
    start, end = perf_bounds(period, from_date, to_date)
    member = await db.users.find_one({"_id": ObjectId(user["id"])}, {"password_hash": 0})
    return await build_member_performance(member, start, end, utcnow())


@api.get("/reports/telecaller-performance/export")
async def export_performance(period: str = "today", from_date: Optional[str] = None,
                             to_date: Optional[str] = None, telecaller_id: Optional[str] = None,
                             user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "subadmin", "team_leader"):
        raise HTTPException(status_code=403, detail="Not permitted")
    start, end = perf_bounds(period, from_date, to_date)
    now = utcnow()
    members = await perf_scope_members(user, telecaller_id)
    settings = await get_efficiency_settings()
    rows = [score_member_efficiency(await build_member_performance(m, start, end, now), settings) for m in members]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Telecaller", "Email", "Status", "First login", "Last logout", "Logged-in hours",
                     "Overall efficiency %", "Measured weight %",
                     "Calls dialed", "Connected", "Not connected", "Total actions", "Status changes",
                     "Converted actions", *[f"Call {number} {metric}" for number in range(1, 5)
                                               for metric in ("dialed", "connected", "not connected")],
                     "Connection rate %", "Talk time (min)",
                     "Conversions", "Conversion rate %", "Leads contacted",
                     "Follow-ups completed", "Follow-ups pending", "Overdue follow-ups",
                     "Call target", "Conversion target", "Last call",
                     *([f"{factor['label']} achievement %" for factor in rows[0]["efficiency_factors"]] if rows else [])])
    for r in rows:
        lc = r.get("last_call") or {}
        last_call = f"{lc.get('contact_name', '')} ({lc.get('status', '')}) {iso_to_local(lc.get('time'))}".strip() if lc else ""
        writer.writerow([
            r["name"], r.get("email") or "", STATUS_TEXT.get(r["status"], r["status"]),
            iso_to_local(r["login_time"]), iso_to_local(r["logout_time"]), r["logged_in_hours"],
            r["efficiency_score"] if r["efficiency_score"] is not None else "N/A", r["efficiency_valid_weight"],
                        r["calls_dialed"], r["connected_calls"], r["not_connected_calls"],
                        r["total_actions"], r["status_changes"], r["converted_actions"],
                        *[r["call_attempts"][str(number)][metric.replace(" ", "_")]
                            for number in range(1, 5) for metric in ("dialed", "connected", "not connected")],
                        r["connection_rate"],
            round((r["total_talk_time"] or 0) / 60, 1), r["conversions"], r["conversion_rate"],
            r["leads_contacted"], r["follow_ups_completed"], r["follow_ups_pending"],
            r["overdue_follow_ups"], r["target_calls"], r["target_conversions"], last_call,
            *[factor["achievement"] if factor["achievement"] is not None else "N/A"
                for factor in r["efficiency_factors"]],
        ])
    buffer.seek(0)
    stamp = datetime.now(TEAM_TZ).strftime("%Y%m%d-%H%M")
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="telecaller-performance-{stamp}.csv"'})


@api.get("/reports/telecaller-performance/{telecaller_id}/timeline/export")
async def export_timeline(telecaller_id: str, period: str = "today", from_date: Optional[str] = None,
                          to_date: Optional[str] = None, user: dict = Depends(current_user)):
    data = await telecaller_timeline(telecaller_id, period, from_date, to_date, user)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Time (IST)", "Type", "Title", "Detail", "Status"])
    for ev in data["events"]:
        writer.writerow([iso_to_local(ev.get("time")), ev.get("type"), ev.get("title"),
                         ev.get("detail") or "", ev.get("status") or ""])
    buffer.seek(0)
    name = (data.get("member") or {}).get("name", "telecaller").replace(" ", "-").lower()
    stamp = datetime.now(TEAM_TZ).strftime("%Y%m%d-%H%M")
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="timeline-{name}-{stamp}.csv"'})


SYSTEM_DATABASES = {"admin", "local", "config"}


async def exportable_database_names():
    names = await client.list_database_names()
    return sorted(name for name in names if name not in SYSTEM_DATABASES)


async def exportable_collection_names(database):
    names = await database.list_collection_names()
    return sorted(name for name in names if not name.startswith("system."))


@api.get("/admin/export-database/preview")
async def export_database_preview(user: dict = Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    databases = {}
    collections = {}
    total = 0
    collection_count = 0
    for database_name in await exportable_database_names():
        target = client[database_name]
        per_db = {}
        for collection_name in await exportable_collection_names(target):
            count = await target[collection_name].count_documents({})
            per_db[collection_name] = count
            collections[f"{database_name}/{collection_name}"] = count
            total += count
            collection_count += 1
        databases[database_name] = per_db
    return {"primary_db": db.name, "databases": databases, "collections": collections,
            "database_count": len(databases), "collection_count": collection_count,
            "total_documents": total}


@api.get("/admin/export-database")
async def export_database(user: dict = Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    database_names = await exportable_database_names()
    handle = tempfile.NamedTemporaryFile(prefix="crm_export_", suffix=".zip", delete=False)
    tmp_path = handle.name
    handle.close()
    db_counts = {}
    indexes = {}
    total = 0
    collection_count = 0
    try:
        with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
            for database_name in database_names:
                target = client[database_name]
                db_counts[database_name] = {}
                indexes[database_name] = {}
                for collection_name in await exportable_collection_names(target):
                    count = 0
                    # Stream each collection into <db>/<collection>.json, one compact Extended-JSON
                    # doc per line, flushed in batches (fast + memory-safe for very large collections).
                    with archive.open(f"{database_name}/{collection_name}.json", "w") as entry:
                        entry.write(b"[")
                        first = True
                        buffer = []
                        cursor = target[collection_name].find({}, batch_size=2000)
                        async for doc in cursor:
                            buffer.append(("," if not first else "") + "\n" + json_util.dumps(doc))
                            first = False
                            count += 1
                            if len(buffer) >= 2000:
                                entry.write("".join(buffer).encode("utf-8"))
                                buffer = []
                        if buffer:
                            entry.write("".join(buffer).encode("utf-8"))
                        entry.write(b"\n]\n")
                    db_counts[database_name][collection_name] = count
                    total += count
                    collection_count += 1
                    try:
                        indexes[database_name][collection_name] = await target[collection_name].index_information()
                    except Exception:
                        indexes[database_name][collection_name] = {}
            manifest = {
                "primary_db": db.name,
                "exported_at": iso(utcnow()),
                "exported_by": user.get("email"),
                "databases": db_counts,
                "database_count": len(database_names),
                "collection_count": collection_count,
                "total_documents": total,
            }
            archive.writestr("_manifest.json", json_util.dumps(manifest, indent=2))
            archive.writestr("_indexes.json", json_util.dumps(indexes, indent=2))
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise
    await log_activity("admin_db_export", user,
                       detail=f"Admin exported full database ({len(database_names)} database(s), "
                              f"{collection_count} collections, {total} documents)")
    stamp = datetime.now(TEAM_TZ).strftime("%Y%m%d_%H%M%S")
    filename = f"crm_export_{db.name}_{stamp}.zip"
    return FileResponse(tmp_path, media_type="application/zip", filename=filename,
                        background=BackgroundTask(os.remove, tmp_path))


app.include_router(api)


@app.get("/health")
@api.get("/health")
async def health():
    """Production health check for Nginx, load balancers, and monitoring."""
    try:
        await client.admin.command("ping")
        db_status = "connected"
    except Exception as exc:
        logger.error("Health check DB ping failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database unavailable")
    return {"status": "healthy", "database": db_status}


cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
if not cors_origins:
    cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await asyncio.to_thread(init_storage)
        logger.info("Object storage initialized")
    except Exception as exc:
        logger.warning("Object storage unavailable at startup: %s", exc)
    await db.users.create_index("email", unique=True)
    await db.leads.create_index("phone", unique=True)
    await db.leads.create_index("course_id")
    await db.courses.create_index("name")
    await db.leads.create_index([("assigned_to", 1), ("status", 1)])
    await db.leads.create_index([("updated_at", -1)])
    await db.leads.create_index([("assigned_to", 1), ("conversion_status", 1), ("conversion_approved_at", 1)])
    await db.activities.create_index([("created_at", -1)])
    await db.activities.create_index([("actor_id", 1), ("created_at", -1)])
    await db.call_attempts.create_index([("user_id", 1), ("created_at", -1)])
    await db.call_attempts.create_index([("user_id", 1), ("payment_club_event_id", 1)])
    await db.call_attempts.create_index([("user_id", 1), ("lead_id", 1)])
    await db.call_attempts.create_index([("lead_id", 1), ("created_at", -1)])
    await db.call_attempts.create_index([("payment_club_event_id", 1), ("created_at", -1)])
    await db.payment_club_events.create_index([
        ("source_record_type", 1), ("verified", 1), ("assigned_to_id", 1),
        ("payment.paid_at", -1), ("received_at", -1),
    ])
    await db.payment_club_events.create_index([
        ("source_record_type", 1), ("verified", 1), ("lead_id", 1),
        ("assigned_to_id", 1), ("payment.paid_at", -1), ("received_at", -1),
    ])
    await db.call_attempts.create_index("provider_call_id")
    await db.sessions.create_index([("user_id", 1), ("login_at", -1)])
    await db.sessions.create_index([("logout_at", 1)])
    await db.crm_activities.create_index([("kind", 1), ("created_at", -1)])
    await db.crm_activities.create_index([("owner_id", 1), ("kind", 1), ("created_at", -1)])
    await db.login_attempts.create_index("identifier")

    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        doc = User(name="System Admin", email=admin_email, role="admin",
                   password_hash=hash_password(admin_password)).to_mongo()
        doc["created_at"] = utcnow()
        await db.users.insert_one(doc)
        logger.info("Seeded admin %s", admin_email)
    elif not verify_password(admin_password, existing.get("password_hash", "")):
        await db.users.update_one({"_id": existing["_id"]},
                                  {"$set": {"password_hash": hash_password(admin_password)}})


@app.on_event("shutdown")
async def shutdown():
    client.close()
