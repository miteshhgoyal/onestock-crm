"""Storage client supporting Cloudinary, Cloudflare R2 (S3-compatible), and Local filesystem."""
import io
import logging
import mimetypes
import os
from pathlib import Path
from typing import Optional, Tuple

import requests

logger = logging.getLogger("crm.storage")

# Image extensions helper
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"}

def is_image_path(path: str) -> bool:
    ext = Path(path).suffix.lower()
    return ext in IMAGE_EXTENSIONS


# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------
STORAGE_TYPE = os.environ.get("STORAGE_TYPE", "local").strip().lower()

# Local storage configuration
_default_local_dir = Path(__file__).resolve().parent / "uploads" / "documents"
LOCAL_STORAGE_DIR = Path(os.environ.get("LOCAL_STORAGE_DIR", str(_default_local_dir)))

# Cloudinary configuration
CLOUDINARY_CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "").strip()
CLOUDINARY_API_KEY = os.environ.get("CLOUDINARY_API_KEY", "").strip()
CLOUDINARY_API_SECRET = os.environ.get("CLOUDINARY_API_SECRET", "").strip()
CLOUDINARY_URL = os.environ.get("CLOUDINARY_URL", "").strip()

# Cloudflare R2 configuration (S3-compatible)
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "").strip()
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "").strip()
R2_ENDPOINT_URL = os.environ.get("R2_ENDPOINT_URL", "").strip()

# Global clients cache
_cloudinary_configured = False
_r2_client = None


# ----------------------------------------------------------------------
# Subsystem Initializers
# ----------------------------------------------------------------------
def init_cloudinary():
    """Configure Cloudinary SDK from environment variables."""
    global _cloudinary_configured
    try:
        import cloudinary
        import cloudinary.uploader
        import cloudinary.api
        import cloudinary.utils
    except ImportError:
        logger.error("Cloudinary package is not installed. Run: pip install cloudinary")
        raise RuntimeError("Cloudinary package not installed. Add cloudinary to requirements.txt.")

    if CLOUDINARY_URL:
        cloudinary.config(cloudinary_url=CLOUDINARY_URL)
        _cloudinary_configured = True
        logger.info("Cloudinary storage initialized via CLOUDINARY_URL")
        return True

    if CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET:
        cloudinary.config(
            cloud_name=CLOUDINARY_CLOUD_NAME,
            api_key=CLOUDINARY_API_KEY,
            api_secret=CLOUDINARY_API_SECRET,
            secure=True,
        )
        _cloudinary_configured = True
        logger.info("Cloudinary storage initialized for cloud: %s", CLOUDINARY_CLOUD_NAME)
        return True

    logger.warning(
        "STORAGE_TYPE is 'cloudinary' but credentials are missing in .env! "
        "Required: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (or CLOUDINARY_URL). "
        "Falling back to local storage temporarily."
    )
    return False


def get_r2_client():
    """Initialize and return a Boto3 S3 client configured for Cloudflare R2."""
    global _r2_client
    if _r2_client is not None:
        return _r2_client

    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        logger.error("boto3 is not installed. Run: pip install boto3")
        raise RuntimeError("boto3 package not installed. Add boto3 to requirements.txt.")

    if not (R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME):
        logger.warning(
            "STORAGE_TYPE is 'r2' but credentials are missing in .env! "
            "Required: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_ACCOUNT_ID. "
            "Falling back to local storage temporarily."
        )
        return None

    endpoint = R2_ENDPOINT_URL
    if not endpoint:
        if not R2_ACCOUNT_ID:
            logger.warning("R2_ACCOUNT_ID is missing and no R2_ENDPOINT_URL provided.")
            return None
        endpoint = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

    _r2_client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    logger.info("Cloudflare R2 client initialized for bucket '%s' at endpoint '%s'", R2_BUCKET_NAME, endpoint)
    return _r2_client


def init_storage(force: bool = False):
    """Entry point called at application boot to initialize storage."""
    active_type = STORAGE_TYPE

    if active_type == "cloudinary":
        ok = init_cloudinary()
        if ok:
            return "cloudinary"
        logger.warning("Cloudinary initialization failed; local fallback enabled.")
        LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        return "local_fallback"

    elif active_type in ("r2", "s3"):
        client = get_r2_client()
        if client:
            return "r2"
        logger.warning("Cloudflare R2 initialization failed; local fallback enabled.")
        LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        return "local_fallback"

    else:
        LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("Local filesystem storage initialized at: %s", LOCAL_STORAGE_DIR)
        return "local"


# ----------------------------------------------------------------------
# Local Storage Operations
# ----------------------------------------------------------------------
def _local_put(path: str, data: bytes, content_type: str) -> dict:
    target_path = LOCAL_STORAGE_DIR / path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(data)
    return {"path": path, "size": len(data), "content_type": content_type, "storage": "local"}


def _local_get(path: str) -> Tuple[bytes, str]:
    target_path = LOCAL_STORAGE_DIR / path
    if not target_path.exists() or not target_path.is_file():
        raise FileNotFoundError(f"Stored document not found on disk: {path}")
    data = target_path.read_bytes()
    guessed_type, _ = mimetypes.guess_type(path)
    content_type = guessed_type or "application/octet-stream"
    return data, content_type


def _local_delete(path: str) -> dict:
    target_path = LOCAL_STORAGE_DIR / path
    if target_path.exists() and target_path.is_file():
        target_path.unlink()
        return {"path": path, "deleted": True, "storage": "local"}
    return {"path": path, "deleted": False, "storage": "local"}


# ----------------------------------------------------------------------
# Cloudinary Storage Operations
# ----------------------------------------------------------------------
def _cloudinary_put(path: str, data: bytes, content_type: str) -> dict:
    import cloudinary.uploader

    # Determine resource_type: "image" for images, "raw" for docs/PDFs/CSVs
    resource_type = "image" if is_image_path(path) else "raw"

    file_obj = io.BytesIO(data)
    # Use path directly as public_id so lookup is deterministic
    result = cloudinary.uploader.upload(
        file_obj,
        public_id=path,
        resource_type=resource_type,
        overwrite=True,
        unique_filename=False,
        use_filename=True,
    )
    return {
        "path": path,
        "url": result.get("secure_url"),
        "public_id": result.get("public_id"),
        "resource_type": resource_type,
        "size": len(data),
        "content_type": content_type,
        "storage": "cloudinary",
    }


def _cloudinary_get(path: str) -> Tuple[bytes, str]:
    import cloudinary.utils

    guessed_type, _ = mimetypes.guess_type(path)
    content_type = guessed_type or "application/octet-stream"

    # Try expected resource_type first
    primary_type = "image" if is_image_path(path) else "raw"
    fallback_type = "raw" if primary_type == "image" else "image"

    for r_type in (primary_type, fallback_type):
        url, _ = cloudinary.utils.cloudinary_url(
            path,
            resource_type=r_type,
            secure=True,
            sign_url=True,
        )
        try:
            resp = requests.get(url, timeout=60)
            if resp.status_code == 200:
                header_type = resp.headers.get("Content-Type")
                return resp.content, header_type or content_type
        except Exception as exc:
            logger.warning("Error fetching from Cloudinary URL (%s): %s", url, exc)

    raise FileNotFoundError(f"Document not found on Cloudinary: {path}")


def _cloudinary_delete(path: str) -> dict:
    import cloudinary.uploader

    primary_type = "image" if is_image_path(path) else "raw"
    fallback_type = "raw" if primary_type == "image" else "image"

    res = cloudinary.uploader.destroy(path, resource_type=primary_type)
    if res.get("result") != "ok":
        res = cloudinary.uploader.destroy(path, resource_type=fallback_type)
    return {"path": path, "result": res.get("result"), "storage": "cloudinary"}


# ----------------------------------------------------------------------
# Cloudflare R2 Storage Operations
# ----------------------------------------------------------------------
def _r2_put(path: str, data: bytes, content_type: str) -> dict:
    client = get_r2_client()
    if not client:
        raise RuntimeError("R2 client not initialized. Check R2 credentials.")
    client.put_object(
        Bucket=R2_BUCKET_NAME,
        Key=path,
        Body=data,
        ContentType=content_type,
    )
    return {
        "path": path,
        "bucket": R2_BUCKET_NAME,
        "size": len(data),
        "content_type": content_type,
        "storage": "r2",
    }


def _r2_get(path: str) -> Tuple[bytes, str]:
    client = get_r2_client()
    if not client:
        raise RuntimeError("R2 client not initialized. Check R2 credentials.")
    try:
        obj = client.get_object(Bucket=R2_BUCKET_NAME, Key=path)
        data = obj["Body"].read()
        content_type = obj.get("ContentType") or mimetypes.guess_type(path)[0] or "application/octet-stream"
        return data, content_type
    except Exception as exc:
        raise FileNotFoundError(f"Document not found in Cloudflare R2: {path} ({exc})")


def _r2_delete(path: str) -> dict:
    client = get_r2_client()
    if not client:
        raise RuntimeError("R2 client not initialized. Check R2 credentials.")
    client.delete_object(Bucket=R2_BUCKET_NAME, Key=path)
    return {"path": path, "deleted": True, "storage": "r2"}


# ----------------------------------------------------------------------
# Public Unified Storage API
# ----------------------------------------------------------------------
def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Write object to active storage provider."""
    if STORAGE_TYPE == "cloudinary":
        if _cloudinary_configured or init_cloudinary():
            return _cloudinary_put(path, data, content_type)
        logger.warning("Cloudinary unavailable; putting object in local storage: %s", path)
        return _local_put(path, data, content_type)

    elif STORAGE_TYPE in ("r2", "s3"):
        if get_r2_client() is not None:
            return _r2_put(path, data, content_type)
        logger.warning("R2 unavailable; putting object in local storage: %s", path)
        return _local_put(path, data, content_type)

    else:
        return _local_put(path, data, content_type)


def get_object(path: str) -> Tuple[bytes, str]:
    """Retrieve object bytes and content_type from active storage provider."""
    if STORAGE_TYPE == "cloudinary":
        if _cloudinary_configured or init_cloudinary():
            return _cloudinary_get(path)
        return _local_get(path)

    elif STORAGE_TYPE in ("r2", "s3"):
        if get_r2_client() is not None:
            return _r2_get(path)
        return _local_get(path)

    else:
        return _local_get(path)


def delete_object(path: str) -> dict:
    """Delete object from active storage provider."""
    if STORAGE_TYPE == "cloudinary":
        if _cloudinary_configured or init_cloudinary():
            return _cloudinary_delete(path)
        return _local_delete(path)

    elif STORAGE_TYPE in ("r2", "s3"):
        if get_r2_client() is not None:
            return _r2_delete(path)
        return _local_delete(path)

    else:
        return _local_delete(path)
