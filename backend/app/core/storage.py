"""Image uploads for the banner engine: validate, resize, store.

Two backends behind one function so the admin upload endpoint never cares
where the bytes land:

* ``local`` (default) — writes under ``settings.media_root`` and serves the
  files from ``GET /api/media/…``; zero infrastructure, right for dev.
* ``s3`` — any S3-compatible object store (AWS / MinIO / R2) via boto3;
  install the ``s3`` extra and set the ``S3_*`` settings.

Every upload is type- and size-validated, orientation-corrected, and saved
twice: a desktop variant capped at ``media_desktop_max_width`` and a much
narrower mobile one — both WebP, both content-unique names so they can be
cached immutably.
"""

import io
import uuid
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings
from app.core.exceptions import AppError

# Declared content types we accept; the file must also actually decode.
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _field_error(message: str, field: str) -> AppError:
    """A 400 the frontend attaches to the offending input (same details
    shape FastAPI uses for its own 422s)."""
    return AppError(message, details=[{"field": field, "message": message}])


def save_banner_image(file: UploadFile) -> tuple[str, str]:
    """Store one upload and return ``(desktop_url, mobile_url)``.

    Raises a 400 with a field-level message for anything that is not a
    decodable JPEG/PNG/WebP within the size budget.
    """
    declared = (file.content_type or "").split(";")[0].strip().lower()
    if declared not in ALLOWED_TYPES:
        raise _field_error(
            "Upload a JPEG, PNG or WebP image"
            + (f" (got {declared})" if declared else ""),
            "image",
        )

    max_bytes = settings.media_max_upload_mb * 1024 * 1024
    data = file.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise _field_error(
            f"Image is larger than {settings.media_max_upload_mb} MB", "image"
        )

    try:
        img = Image.open(io.BytesIO(data))
        img.load()  # decode now: a truncated/corrupt file fails here, not later
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise _field_error("That file is not a readable image", "image") from None

    img = ImageOps.exif_transpose(img)  # phones store rotation as EXIF
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")  # palette, grayscale, CMYK …

    stem = f"banner_{uuid.uuid4().hex[:12]}"
    return (
        _store(f"{stem}_desktop.webp", _variant(img, settings.media_desktop_max_width)),
        _store(f"{stem}_mobile.webp", _variant(img, settings.media_mobile_max_width)),
    )


def _variant(img: Image.Image, max_width: int) -> bytes:
    width, height = img.size
    if width > max_width:
        img = img.resize(
            (max_width, max(1, round(height * max_width / width))), Image.LANCZOS
        )
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=82, method=4)
    return buf.getvalue()


def _store(name: str, data: bytes) -> str:
    if settings.storage_backend == "s3":
        return _store_s3(name, data)
    target_dir = Path(settings.media_root) / "banners"
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / name).write_bytes(data)
    return f"/api/media/banners/{name}"


def _store_s3(name: str, data: bytes) -> str:
    try:
        import boto3
    except ImportError:
        raise AppError(
            'The "s3" storage backend needs the s3 extra: pip install ".[s3]"'
        ) from None
    if not settings.s3_bucket:
        raise AppError("S3_BUCKET is required when STORAGE_BACKEND=s3")
    if not settings.s3_public_base_url:
        raise AppError("S3_PUBLIC_BASE_URL is required when STORAGE_BACKEND=s3")

    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url or None,
        region_name=settings.s3_region or None,
        aws_access_key_id=settings.s3_access_key or None,
        aws_secret_access_key=settings.s3_secret_key or None,
    )
    key = f"banners/{name}"
    client.put_object(
        Bucket=settings.s3_bucket,
        Key=key,
        Body=data,
        ContentType="image/webp",
        CacheControl="public, max-age=31536000, immutable",
    )
    return f"{settings.s3_public_base_url.rstrip('/')}/{key}"
