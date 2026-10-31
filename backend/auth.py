import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from bson import ObjectId
from fastapi import HTTPException, Request

JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response, access_token: str, refresh_token: str) -> None:
    response.set_cookie("access_token", access_token, httponly=True, secure=True,
                        samesite="none", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh_token, httponly=True, secure=True,
                        samesite="none", max_age=604800, path="/")


def extract_token(request: Request) -> Optional[str]:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    if request.cookies.get("access_token"):
        return request.cookies.get("access_token")
    return request.query_params.get("token")


def decode_token(token: str, expected_type: str = "access") -> dict:
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != expected_type:
        raise HTTPException(status_code=401, detail="Invalid token type")
    return payload


# ---- permissions (RBAC + relationship scope) ----

PERMISSIONS = {
    "admin": {
        "user:manage", "team:manage", "lead:read_all", "lead:create", "lead:update",
        "lead:assign", "lead:delete", "lead:import", "report:read", "activity:read",
        "escalation:run",
    },
    "subadmin": {
        "user:manage", "team:manage", "lead:read_all", "lead:create", "lead:update",
        "lead:assign", "lead:delete", "lead:import", "report:read", "activity:read", "escalation:run",
    },
    "team_leader": {
        "lead:read_team", "lead:update", "lead:assign_team", "report:read_team",
        "activity:read", "user:read_team", "lead:create_own",
    },
    "telecaller": {"lead:read_own", "lead:update_own", "lead:create_own"},
}

ROLE_RANK = {"admin": 3, "subadmin": 2, "team_leader": 1, "telecaller": 0}


def has_perm(role: str, action: str) -> bool:
    return action in PERMISSIONS.get(role, set())


def require_perm(user: dict, action: str) -> None:
    if not has_perm(user["role"], action):
        raise HTTPException(status_code=403, detail="Not permitted")


def oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=404, detail="Not found")
