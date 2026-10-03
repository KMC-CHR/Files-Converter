import os
import requests
import cv2
from PIL import Image

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


def normalize_image(img):
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        return img.convert("RGBA")
    elif img.mode != "RGB":
        return img.convert("RGB")
    return img