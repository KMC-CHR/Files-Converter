import io
import os
import re
import requests
import cv2
from fastapi import HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB per image upload
MAX_IMAGE_PIXEL_COUNT = 25_000_000  # 25 megapixels cap against decompression bombs
ALLOWED_IMAGE_FORMATS = ("PNG", "JPEG", "WEBP", "GIF", "BMP", "TIFF", "HEIF")

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXEL_COUNT

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'LapSRN_x2.pb')
MODEL_URL = "https://raw.githubusercontent.com/fannymonori/TF-LapSRN/master/export/LapSRN_x2.pb"

_sr = None


def init_local_ai():
    global _sr
    if not os.path.exists(MODEL_PATH):
        print("INFO: Local LapSRN AI model not found. Auto-downloading (1.1 MB)...")
        try:
            res = requests.get(MODEL_URL, timeout=30)
            if res.status_code == 200:
                with open(MODEL_PATH, 'wb') as f:
                    f.write(res.content)
                print("SUCCESS: Local LapSRN model downloaded.")
        except Exception as e:
            print(f"WARNING: Could not download LapSRN model: {e}")

    if os.path.exists(MODEL_PATH):
        try:
            _sr = cv2.dnn_superres.DnnSuperResImpl_create()
            _sr.readModel(MODEL_PATH)
            _sr.setModel("lapsrn", 2)
            print("SUCCESS: OpenCV Local CPU AI Super-Resolution Model Loaded!")
        except Exception as err:
            print(f"WARNING: Failed to initialize OpenCV SuperRes model: {err}")
            _sr = None


def get_super_res():
    return _sr


async def read_bounded_upload(file: UploadFile, max_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    chunks = []
    total_bytes = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds the {max_bytes // (1024 * 1024)} MB upload limit",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def open_validated_image(image_bytes: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(image_bytes), formats=ALLOWED_IMAGE_FORMATS)
        img.load()
        return img
    except Image.DecompressionBombError:
        raise HTTPException(status_code=413, detail="Image dimensions exceed safety limit")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="Unsupported or corrupted image file")


def safe_download_filename(original_filename: str, prefix: str, extension: str) -> str:
    base_name = os.path.splitext(os.path.basename(original_filename))[0]
    cleaned_name = re.sub(r"[^A-Za-z0-9._-]", "_", base_name).strip("._")
    if not cleaned_name:
        cleaned_name = "image"
    return f"{prefix}{cleaned_name}.{extension}"


def normalize_image(img):
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        return img.convert("RGBA")
    elif img.mode != "RGB":
        return img.convert("RGB")
    return img