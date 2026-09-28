import os
import io
import gc
from flask import Flask, request, send_file, jsonify, render_template
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from PIL import Image, ImageEnhance, ImageFilter

# Optional HEIF support registration
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception as e:
    print(f"INFO: HEIF opener optional mode active ({e})")

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 15 * 1024 * 1024  # 15MB file size limit

# In-memory IP rate limiter setup
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

def normalize_image(img):
    """
    Normalizes image channels to prevent RGB/RGBA/CMYK processing crashes.
    """
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        return img.convert("RGBA")
    elif img.mode != "RGB":
        return img.convert("RGB")
    return img


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

        # Calculate height keeping original aspect ratio
        width_percent = (target_width / float(img.size[0]))
        target_height = int((float(img.size[1]) * float(width_percent)))

        # Resample image
        img_resized = img.resize((target_width, target_height), resample_filter)
        
        # Apply edge sharpness pass
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
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    try:
        input_bytes = file.read()
        img = Image.open(io.BytesIO(input_bytes))
        img = normalize_image(img)
        orig_w, orig_h = img.size

        # 1. Skip median filtering so fine lines aren't smudged away
        # Direct 4x Lanczos Resampling
        target_w, target_h = orig_w * 4, orig_h * 4
        scaled = img.resize((target_w, target_h), Image.Resampling.LANCZOS)

        # 2. Targeted Edge Sharpening (Preserves contrast along thin lines)
        sharpened = scaled.filter(ImageFilter.UnsharpMask(radius=1.5, percent=180, threshold=1))

        output_io = io.BytesIO()
        sharpened.save(output_io, format='PNG', optimize=True)
        output_io.seek(0)

        del input_bytes, img, scaled, sharpened
        gc.collect()

        return send_file(
            output_io,
            mimetype='image/png',
            as_attachment=True,
            download_name=f"crisp_4x_{os.path.splitext(file.filename)[0]}.png"
        )
    except Exception as e:
        gc.collect()
        return jsonify({'error': f'Server processing error: {str(e)}'}), 500

if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', 5000))
    app.run(host=host, port=port, debug=False)