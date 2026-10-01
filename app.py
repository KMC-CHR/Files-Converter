import os
import io
import gc
import requests
import cv2
import numpy as np
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

# Auto-download lightweight LapSRN AI Model (1.1 MB) for local CPU inference
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'LapSRN_x2.pb')
MODEL_URL = "https://raw.githubusercontent.com/fannymonori/TF-LapSRN/master/export/LapSRN_x2.pb"

sr = None

def init_local_ai():
    global sr
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
            sr = cv2.dnn_superres.DnnSuperResImpl_create()
            sr.readModel(MODEL_PATH)
            sr.setModel("lapsrn", 2)
            print("SUCCESS: OpenCV Local CPU AI Super-Resolution Model Loaded!")
        except Exception as err:
            print(f"WARNING: Failed to initialize OpenCV SuperRes model: {err}")
            sr = None

init_local_ai()


def normalize_image(img):
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

    res_map = {'720p': 1280, '1080p': 1920, '1440p': 2560, '2160p': 3840}
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
                background.paste(img, mask=img.size, fill=0)
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
    Executes Local LapSRN AI Super Resolution natively on CPU using OpenCV DNN.
    Accepts arbitrary image dimensions without shape errors or RAM crashes.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    try:
        input_bytes = file.read()
        pil_img = Image.open(io.BytesIO(input_bytes))
        pil_img = normalize_image(pil_img)

        # Execute 100% Local AI Model if loaded
        if sr is not None:
            # Convert PIL RGB -> OpenCV BGR
            cv_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            
            # Run local CPU super resolution pass
            upscaled_cv = sr.upsample(cv_img)
            
            # Convert OpenCV BGR -> PIL RGB
            upscaled_rgb = cv2.cvtColor(upscaled_cv, cv2.COLOR_BGR2RGB)
            output_img = Image.fromarray(upscaled_rgb)

            del cv_img, upscaled_cv, upscaled_rgb
            gc.collect()

        # Multi-Pass Fallback
        else:
            target_w, target_h = pil_img.width * 2, pil_img.height * 2
            scaled = pil_img.resize((target_w, target_h), Image.Resampling.LANCZOS)
            output_img = scaled.filter(ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=2))

        output_io = io.BytesIO()
        output_img.save(output_io, format='PNG', optimize=True)
        output_io.seek(0)

        del input_bytes, pil_img
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