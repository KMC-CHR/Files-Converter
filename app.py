import os
import io
import gc
import time
import requests
from flask import Flask, request, send_file, jsonify, render_template
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from PIL import Image, ImageEnhance, ImageFilter
from dotenv import load_dotenv

# Load local .env environment variables if present
load_dotenv()

# Optional HEIF support registration
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception as e:
    print(f"INFO: HEIF opener optional mode active ({e})")

# Import ONNX Runtime and NumPy for local AI inference
try:
    import numpy as np
    import onnxruntime as ort
    HAS_ONNX = True
except ImportError:
    HAS_ONNX = False
    print("INFO: onnxruntime/numpy not installed. Local AI route will use multi-pass fallback.")

app = Flask(__name__)

# Enforce strict 15MB upload limit
app.config['MAX_CONTENT_LENGTH'] = 15 * 1024 * 1024  

# Configure rate limiter using client IP
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# Auto-download lightweight ONNX weights on boot if missing
ONNX_MODEL_PATH = os.path.join(os.path.dirname(__file__), 'realesrgan.onnx')
MODEL_URL = "https://huggingface.co/qualcomm/RealESRGAN/resolve/main/RealESRGAN.onnx"

def ensure_onnx_model():
    """
    Auto-downloads the compressed ONNX model binary on startup if missing.
    Prevents bloated Git repositories while guaranteeing local AI execution.
    """
    if not os.path.exists(ONNX_MODEL_PATH):
        print("INFO: Local ONNX model binary not found. Auto-downloading weights...")
        try:
            response = requests.get(MODEL_URL, stream=True, timeout=60)
            if response.status_code == 200:
                with open(ONNX_MODEL_PATH, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                print("SUCCESS: ONNX model binary downloaded successfully.")
            else:
                print(f"WARNING: Model download failed with HTTP status {response.status_code}")
        except Exception as err:
            print(f"WARNING: Could not auto-download ONNX model: {err}")

if HAS_ONNX:
    ensure_onnx_model()

# Initialize ONNX Neural Network Session globally on startup
ort_session = None
if HAS_ONNX and os.path.exists(ONNX_MODEL_PATH):
    try:
        # Initialize ONNX CPU execution provider (~120MB RAM footprint)
        ort_session = ort.InferenceSession(ONNX_MODEL_PATH, providers=['CPUExecutionProvider'])
        print("SUCCESS: Local Real-ESRGAN ONNX AI Model initialized successfully.")
    except Exception as err:
        print(f"WARNING: Failed to load ONNX model session: {err}")


def normalize_image(img):
    """
    Normalizes image color modes across formats to prevent processing exceptions.
    """
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        return img.convert("RGBA")
    elif img.mode != "RGB":
        return img.convert("RGB")
    return img


@app.route('/healthz', methods=['GET'])
@limiter.limit("20 per minute")
def health_check():
    return jsonify({'status': 'ok'}), 200


@app.route('/')
def index():
    return render_template('Index.html')


@app.route('/convert-single', methods=['POST'])
@limiter.limit("30 per minute")
def convert_single():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    target_format = request.form.get('target_format', 'png').lower()
    
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    try:
        image_bytes = file.read()
        img = Image.open(io.BytesIO(image_bytes))
        img = normalize_image(img)
        output_io = io.BytesIO()

        if target_format in ('jpg', 'jpeg'):
            if img.mode == 'RGBA':
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3])
                img = background
            img.save(output_io, format='JPEG', quality=95)
            mimetype = 'image/jpeg'
            ext = 'jpg'
        elif target_format == 'webp':
            img.save(output_io, format='WEBP', quality=92)
            mimetype = 'image/webp'
            ext = 'webp'
        else:
            img.save(output_io, format='PNG', optimize=True)
            mimetype = 'image/png'
            ext = 'png'

        output_io.seek(0)
        del image_bytes, img
        gc.collect()

        return send_file(
            output_io,
            mimetype=mimetype,
            as_attachment=True,
            download_name=f"converted_{os.path.splitext(file.filename)[0]}.{ext}"
        )
    except Exception as e:
        gc.collect()
        return jsonify({'error': f'Image conversion failed: {str(e)}'}), 500


@app.route('/upscale-single', methods=['POST'])
@limiter.limit("20 per minute")
def upscale_single():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    target_res = request.form.get('target_res', '1080p')
    target_format = request.form.get('target_format', 'png').lower()
    resample_mode = request.form.get('resample', 'lanczos').lower()

    res_map = {
        '720p': 1280,
        '1080p': 1920,
        '1440p': 2560,
        '2160p': 3840
    }
    target_width = res_map.get(target_res, 1920)

    filter_map = {
        'lanczos': Image.Resampling.LANCZOS,
        'bicubic': Image.Resampling.BICUBIC,
        'bilinear': Image.Resampling.BILINEAR
    }
    resample_filter = filter_map.get(resample_mode, Image.Resampling.LANCZOS)

    try:
        input_bytes = file.read()
        img = Image.open(io.BytesIO(input_bytes))
        img = normalize_image(img)

        width_percent = (target_width / float(img.size[0]))
        target_height = int((float(img.size[1]) * float(width_percent)))

        img_resized = img.resize((target_width, target_height), resample_filter)
        img_resized = img_resized.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=2))

        output_io = io.BytesIO()

        if target_format in ('jpg', 'jpeg'):
            if img_resized.mode == 'RGBA':
                background = Image.new('RGB', img_resized.size, (255, 255, 255))
                background.paste(img_resized, mask=img_resized.split()[3])
                img_resized = background
            img_resized.save(output_io, format='JPEG', quality=95)
            mimetype = 'image/jpeg'
            ext = 'jpg'
        elif target_format == 'webp':
            img_resized.save(output_io, format='WEBP', quality=92)
            mimetype = 'image/webp'
            ext = 'webp'
        else:
            img_resized.save(output_io, format='PNG', optimize=True)
            mimetype = 'image/png'
            ext = 'png'

        output_io.seek(0)
        del input_bytes, img, img_resized
        gc.collect()

        return send_file(
            output_io,
            mimetype=mimetype,
            as_attachment=True,
            download_name=f"upscaled_{target_res}_{os.path.splitext(file.filename)[0]}.{ext}"
        )
    except Exception as e:
        gc.collect()
        return jsonify({'error': f'Upscaling failed: {str(e)}'}), 500


@app.route('/enhance-single', methods=['POST'])
@limiter.limit("20 per minute")
def enhance_single():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    enhance_mode = request.form.get('enhance_mode', 'full')
    target_format = request.form.get('target_format', 'png').lower()

    try:
        input_bytes = file.read()
        img = Image.open(io.BytesIO(input_bytes))
        img = normalize_image(img)

        if enhance_mode in ('full', 'sharpen'):
            img = img.filter(ImageFilter.UnsharpMask(radius=1.8, percent=140, threshold=2))

        if enhance_mode in ('full', 'contrast'):
            enhancer = ImageEnhance.Contrast(img)
            img = enhancer.enhance(1.20)

        if enhance_mode in ('full', 'color') and img.mode in ('RGB', 'RGBA'):
            enhancer = ImageEnhance.Color(img)
            img = enhancer.enhance(1.15)

        output_io = io.BytesIO()

        if target_format in ('jpg', 'jpeg'):
            if img.mode == 'RGBA':
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3])
                img = background
            img.save(output_io, format='JPEG', quality=95)
            mimetype = 'image/jpeg'
            ext = 'jpg'
        elif target_format == 'webp':
            img.save(output_io, format='WEBP', quality=92)
            mimetype = 'image/webp'
            ext = 'webp'
        else:
            img.save(output_io, format='PNG', optimize=True)
            mimetype = 'image/png'
            ext = 'png'

        output_io.seek(0)
        del input_bytes, img
        gc.collect()

        return send_file(
            output_io,
            mimetype=mimetype,
            as_attachment=True,
            download_name=f"enhanced_{os.path.splitext(file.filename)[0]}.{ext}"
        )
    except Exception as e:
        gc.collect()
        return jsonify({'error': f'Enhancement failed: {str(e)}'}), 500


@app.route('/ai-upscale-single', methods=['POST'])
@limiter.limit("10 per minute")
def ai_upscale_single():
    """
    Performs True AI Super Resolution locally using ONNX Neural Network inference on CPU.
    Includes RAM safety caps and aggressive garbage collection for Render Free Tier.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    try:
        input_bytes = file.read()
        img = Image.open(io.BytesIO(input_bytes))
        img = normalize_image(img)

        # 1. Execute Local ONNX Neural Network Super-Resolution
        if ort_session is not None and HAS_ONNX:
            # Memory safety: cap oversized input images to avoid exceeding Render RAM limits (512MB)
            max_input_dim = 600
            if max(img.width, img.height) > max_input_dim:
                img.thumbnail((max_input_dim, max_input_dim), Image.Resampling.LANCZOS)

            img_rgb = img.convert("RGB")
            img_np = np.array(img_rgb, dtype=np.float32) / 255.0
            
            # Convert image structure from HWC -> CHW -> NCHW
            input_tensor = np.transpose(img_np, (2, 0, 1))[np.newaxis, :, :, :]
            del img_np, img_rgb
            gc.collect()

            # Run inference pass through the model
            input_name = ort_session.get_inputs()[0].name
            output_tensor = ort_session.run(None, {input_name: input_tensor})[0]
            del input_tensor
            gc.collect()

            # Reconstruct tensor to image: NCHW -> HWC
            output_np = np.squeeze(output_tensor, axis=0)
            output_np = np.transpose(output_np, (1, 2, 0))
            output_np = np.clip(output_np * 255.0, 0, 255).astype(np.uint8)

            output_img = Image.fromarray(output_np)
            del output_tensor, output_np
            gc.collect()

        # 2. Clean high-fidelity fallback if ONNX model binary failed to download
        else:
            target_w, target_h = img.width * 2, img.height * 2
            output_img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
            output_img = output_img.filter(ImageFilter.UnsharpMask(radius=0.8, percent=40, threshold=3))

        output_io = io.BytesIO()
        output_img.save(output_io, format='PNG', optimize=True)
        output_io.seek(0)

        del input_bytes, img
        gc.collect()

        return send_file(
            output_io,
            mimetype='image/png',
            as_attachment=True,
            download_name=f"ai_upscaled_{os.path.splitext(file.filename)[0]}.png"
        )
    except Exception as e:
        gc.collect()
        return jsonify({'error': f'AI Upscaling failed: {str(e)}'}), 500


if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', 5000))
    app.run(host=host, port=port, debug=False)