"""Test document upload/download/delete against Emergent Object Storage."""
import hashlib
import os
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

from conftest import API, client_for  # noqa

LEGACY_DIR = (Path(__file__).resolve().parent.parent / "uploads" / "documents")


def _owner_admin():
    """Login as the owner admin (butbrucewill@gmail.com)."""
    r = requests.post(f"{API}/auth/login",
                      json={"email": "butbrucewill@gmail.com", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {data['access_token']}"})
    s.user = data["user"]
    return s


@pytest.fixture(scope="module")
def owner():
    return _owner_admin()


@pytest.fixture(scope="module")
def caller():
    return client_for("caller1")


# ---------- upload / download round-trip ----------

def _count_pod_files():
    if not LEGACY_DIR.is_dir():
        return 0
    return sum(1 for p in LEGACY_DIR.iterdir() if p.is_file())


def test_upload_text_goes_to_object_storage_not_disk(owner):
    before = _count_pod_files()
    content = b"hello object storage - test doc\n"
    files = {"file": ("hello.txt", content, "text/plain")}
    r = owner.post(f"{API}/documents", files=files, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("is_deleted") is False
    sp = body.get("storage_path")
    assert isinstance(sp, str) and sp.startswith(f"onestock-academy-crm/documents/{owner.user['id']}/"), body
    assert body.get("size") == len(content)
    assert body.get("name") == "hello.txt"
    after = _count_pod_files()
    assert after == before, f"pod disk grew from {before} to {after}"
    # keep id for round trip
    pytest.text_doc_id = body["id"]
    pytest.text_doc_bytes = content


def test_download_text_roundtrip(owner):
    doc_id = pytest.text_doc_id
    r = owner.get(f"{API}/documents/{doc_id}/download", timeout=60)
    assert r.status_code == 200
    assert r.content == pytest.text_doc_bytes
    assert r.headers.get("content-type", "").startswith("text/plain")
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd and "hello.txt" in cd, cd


def test_upload_binary_png_and_download_roundtrip(owner):
    # 1x1 transparent PNG
    png = bytes.fromhex(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
        "0000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
    )
    files = {"file": ("pixel.png", png, "image/png")}
    r = owner.post(f"{API}/documents", files=files, timeout=60)
    assert r.status_code == 200, r.text
    doc_id = r.json()["id"]
    r = owner.get(f"{API}/documents/{doc_id}/download", timeout=60)
    assert r.status_code == 200
    assert hashlib.sha256(r.content).hexdigest() == hashlib.sha256(png).hexdigest()
    assert r.headers.get("content-type", "").startswith("image/png")
    disposition = r.headers.get("content-disposition", "")
    assert 'filename="pixel.png"' in disposition or "filename*=UTF-8''pixel.png" in disposition
    pytest.png_doc_id = doc_id


# ---------- validation ----------

def test_unsupported_content_type_400(owner):
    files = {"file": ("evil.exe", b"MZ\x90\x00", "application/x-msdownload")}
    r = owner.post(f"{API}/documents", files=files, timeout=30)
    assert r.status_code == 400
    assert "Unsupported document type" in r.text


def test_oversize_413(owner):
    big = b"a" * (15 * 1024 * 1024 + 10)
    files = {"file": ("big.txt", big, "text/plain")}
    r = owner.post(f"{API}/documents", files=files, timeout=120)
    assert r.status_code == 413


def test_unauth_endpoints_401():
    r = requests.get(f"{API}/documents", timeout=15)
    assert r.status_code == 401
    r = requests.post(f"{API}/documents",
                      files={"file": ("x.txt", b"x", "text/plain")}, timeout=15)
    assert r.status_code == 401
    r = requests.get(f"{API}/documents/000000000000000000000000/download", timeout=15)
    assert r.status_code == 401
    r = requests.delete(f"{API}/documents/000000000000000000000000", timeout=15)
    assert r.status_code == 401


# ---------- soft delete ----------

def test_soft_delete_flow(owner):
    # upload a doc to delete
    r = owner.post(f"{API}/documents",
                   files={"file": ("todel.txt", b"bye", "text/plain")}, timeout=30)
    assert r.status_code == 200
    doc_id = r.json()["id"]

    # delete
    r = owner.delete(f"{API}/documents/{doc_id}", timeout=30)
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    # no longer in list
    r = owner.get(f"{API}/documents", timeout=30)
    assert r.status_code == 200
    assert not any(d["id"] == doc_id for d in r.json())

    # download 404
    r = owner.get(f"{API}/documents/{doc_id}/download", timeout=30)
    assert r.status_code == 404

    # DB record still exists with is_deleted true + deleted_at
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")

    async def _check():
        c = AsyncIOMotorClient(env["MONGO_URL"])
        d = await c[env["DB_NAME"]].documents.find_one({"_id": __import__("bson").ObjectId(doc_id)})
        return d
    d = asyncio.run(_check())
    assert d is not None
    assert d.get("is_deleted") is True
    assert d.get("deleted_at") is not None


# ---------- role permissions on delete ----------

def test_telecaller_cannot_delete_others_doc(caller, owner):
    # Owner uploads a doc
    r = owner.post(f"{API}/documents",
                   files={"file": ("owned.txt", b"owned", "text/plain")}, timeout=30)
    assert r.status_code == 200
    doc_id = r.json()["id"]

    # Caller tries to delete
    r = caller.delete(f"{API}/documents/{doc_id}", timeout=30)
    assert r.status_code == 403


def test_telecaller_can_delete_own_doc(caller):
    # Drop the JSON content-type header on multipart upload
    headers = {"Authorization": caller.headers["Authorization"]}
    r = requests.post(f"{API}/documents", headers=headers,
                      files={"file": ("mine.txt", b"mine", "text/plain")}, timeout=30)
    assert r.status_code == 200, r.text
    doc_id = r.json()["id"]
    r = caller.delete(f"{API}/documents/{doc_id}", timeout=30)
    assert r.status_code == 200


# ---------- legacy fallback ----------

def test_legacy_document_still_downloads(owner):
    # Find pre-migration doc in DB (storage_path is null and stored_name file exists on disk)
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")

    async def _find():
        c = AsyncIOMotorClient(env["MONGO_URL"])
        cur = c[env["DB_NAME"]].documents.find(
            {"$and": [{"storage_path": None}, {"is_deleted": {"$ne": True}}]})
        return await cur.to_list(20)

    docs = asyncio.run(_find())
    legacy = None
    for d in docs:
        p = LEGACY_DIR / d.get("stored_name", "")
        if p.is_file():
            legacy = d
            break
    assert legacy is not None, "No legacy document found on disk to test fallback"
    doc_id = str(legacy["_id"])
    r = owner.get(f"{API}/documents/{doc_id}/download", timeout=30)
    assert r.status_code == 200
    assert len(r.content) > 0
    cd = r.headers.get("content-disposition", "")
    # FastAPI FileResponse RFC5987-encodes special chars, so accept either form.
    from urllib.parse import quote
    assert legacy["name"] in cd or quote(legacy["name"]) in cd, cd


# ---------- storage init resilience ----------

def test_startup_log_shows_object_storage_initialized():
    log = Path("/var/log/supervisor/backend.err.log")
    assert log.is_file()
    text = log.read_text(errors="ignore")
    assert "Object storage initialized" in text


# ---------- smartflo regression (quick) ----------

def test_smartflo_diagnostics(owner):
    r = owner.get(f"{API}/calls/diagnostics", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token_configured"] is True
    assert body["ready"] is True
    assert body["agent_number_sent_as"] == "919812345678"
    assert body["problems"] == []


def test_smartflo_click_to_call_short_dest_400(owner):
    r = owner.post(f"{API}/calls/click-to-call", json={"destination_number": "123"}, timeout=30)
    assert r.status_code == 400


def test_smartflo_click_to_call_no_agent_400(caller):
    # caller1 has no agent number
    r = caller.post(f"{API}/calls/click-to-call",
                    json={"destination_number": "9810012301"}, timeout=30)
    assert r.status_code == 400
    assert "agent" in r.text.lower()


# ---------- cleanup ----------

def teardown_module(module):
    """Soft-delete any TEST-created docs (except we already do so in flow)."""
    # Nothing hard to clean; soft-deleted docs remain in DB by design.
    pass
