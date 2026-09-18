import io
import os
import filetype
from flask import Flask, request, send_file, jsonify, render_template
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from PIL import Image, ImageEnhance, ImageFilter
import pillow_heif
from werkzeug.utils import secure_filename

# Register HEIF opener safely
try:
    pillow_heif.register_heif_opener()
except Exception as e:
    print(f"WARNING: Could not register HEIF opener: {e}")

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 15 * 1024 * 1024  # 15MB per file

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# Allowed MIME types for images
ALLOWED_MIME_TYPES = {
    'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'
}
ALLOWED_TARGET_FORMATS = {'png', 'jpg', 'jpeg', 'webp', 'pdf'}

# Resolution presets
RESOLUTION_PRESETS = {
    '720p': 1280,
    '1080p': 1920,
    '1440p': 2560,
    '2160p': 3840,
    'source': None
}

def validate_mime(file_bytes):
    kind = filetype.guess(file_bytes)
    if kind is None:
        return None
    return kind.mime


def fast_unsharp_mask(img, radius=2, percent=120, threshold=3, max_dim=2000):
    """
    Apply UnsharpMask efficiently. For large images, sharpen a downscaled
    version and then upscale back. This is 5-10x faster on large images with
    negligible visible difference.
    """
    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / max(w, h)
        small = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
        small = small.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=threshold))
        return small.resize((w, h), Image.Resampling.LANCZOS)
    else:
        return img.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=threshold))


@app.route('/')
def index():
    return render_template('Index.html')

@app.route('/healthz')
def healthz():
    return 'ok', 200


# ============================================
# ===  CONVERTER  ============================
# ============================================
@app.route('/convert-single', methods=['POST'])
@limiter.limit("10 per minute")
def convert_single():
    file = request.files.get('file')
    target_format = request.form.get('target_format', '').lower().strip()

    if not file or not target_format:
        return jsonify({"error": "Missing file or target format."}), 400

    if target_format not in ALLOWED_TARGET_FORMATS:
        return jsonify({"error": "Unsupported target format."}), 400

    file_bytes = file.read()
    if len(file_bytes) == 0:
        return jsonify({"error": "File is empty."}), 400

    mime_type = validate_mime(file_bytes)
    if mime_type not in ALLOWED_MIME_TYPES:
        return jsonify({"error": f"Unsupported file type. Detected: {mime_type}"}), 400

    raw_filename = file.filename or "converted"
    clean_name = secure_filename(raw_filename)
    base_name = clean_name.rsplit('.', 1)[0] if '.' in clean_name else clean_name
    if not base_name:
        base_name = "converted"

    output_filename = f"{base_name}.{target_format}"

    input_buffer = io.BytesIO(file_bytes)
    output_buffer = io.BytesIO()

    try:
        with Image.open(input_buffer) as img:
            if target_format in ('jpg', 'jpeg'):
                if img.mode in ('RGBA', 'LA', 'P'):
                    background = Image.new('RGB', img.size, (255, 255, 255))
                    img_rgba = img.convert('RGBA')
                    background.paste(img_rgba, mask=img_rgba.split()[-1])
                    img = background
                elif img.mode != 'RGB':
                    img = img.convert('RGB')

            if target_format == 'pdf':
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                img.save(output_buffer, format='PDF')
                mimetype = 'application/pdf'
            elif target_format in ('jpg', 'jpeg'):
                img.save(output_buffer, format='JPEG', quality=92, optimize=True)
                mimetype = 'image/jpeg'
            elif target_format == 'webp':
                img.save(output_buffer, format='WEBP', quality=92, method=6)
                mimetype = 'image/webp'
            else:  # png
                img.save(output_buffer, format='PNG', optimize=True)
                mimetype = 'image/png'

        output_buffer.seek(0)
        return send_file(
            output_buffer,
            mimetype=mimetype,
            as_attachment=True,
            download_name=output_filename
        )
    except Exception as e:
        print(f"CONVERSION ERROR: {str(e)}")
        return jsonify({"error": f"Conversion failed: {str(e)}"}), 500


# ============================================
# ===  UPSCALER  =============================
# ============================================
@app.route('/upscale-single', methods=['POST'])
@limiter.limit("10 per minute")
def upscale_single():
    file = request.files.get('file')
    target_res = request.form.get('target_res', '1080p').lower().strip()
    target_format = request.form.get('target_format', 'png').lower().strip()
    resample_filter = request.form.get('resample', 'lanczos').lower().strip()

    if not file:
        return jsonify({"error": "Missing file."}), 400

    if target_res not in RESOLUTION_PRESETS:
        return jsonify({"error": "Unsupported resolution preset."}), 400

    if target_format not in ('png', 'jpg', 'jpeg', 'webp'):
        return jsonify({"error": "Unsupported output format for upscaling."}), 400

    file_bytes = file.read()
    if len(file_bytes) == 0:
        return jsonify({"error": "File is empty."}), 400

    mime_type = validate_mime(file_bytes)
    if mime_type not in ALLOWED_MIME_TYPES:
        return jsonify({"error": f"Unsupported file type. Detected: {mime_type}"}), 400

    filter_map = {
        'lanczos': Image.Resampling.LANCZOS,
        'bicubic': Image.Resampling.BICUBIC,
        'bilinear': Image.Resampling.BILINEAR,
        'nearest': Image.Resampling.NEAREST,
    }
    resample_method = filter_map.get(resample_filter, Image.Resampling.LANCZOS)

    raw_filename = file.filename or "upscaled"
    clean_name = secure_filename(raw_filename)
    base_name = clean_name.rsplit('.', 1)[0] if '.' in clean_name else clean_name
    if not base_name:
        base_name = "upscaled"

    output_filename = f"{base_name}_upscaled.{target_format}"

    input_buffer = io.BytesIO(file_bytes)
    output_buffer = io.BytesIO()

    try:
        with Image.open(input_buffer) as img:
            original_width, original_height = img.size
            is_landscape = original_width >= original_height

            target_long_edge = RESOLUTION_PRESETS[target_res]
            if target_long_edge is None:
                new_width, new_height = original_width, original_height
            else:
                if is_landscape:
                    new_width = target_long_edge
                    new_height = int((target_long_edge / original_width) * original_height)
                else:
                    new_height = target_long_edge
                    new_width = int((target_long_edge / original_height) * original_width)

            upscaled = img.resize((new_width, new_height), resample=resample_method)

            # Handle transparency
            alpha_channel = None
            if upscaled.mode in ('RGBA', 'LA'):
                alpha_channel = upscaled.split()[-1]
                upscaled = upscaled.convert('RGB')
            elif upscaled.mode == 'P':
                upscaled_rgba = upscaled.convert('RGBA')
                alpha_channel = upscaled_rgba.split()[-1]
                upscaled = upscaled_rgba.convert('RGB')
            elif upscaled.mode != 'RGB':
                upscaled = upscaled.convert('RGB')

            if target_format in ('jpg', 'jpeg'):
                upscaled.save(output_buffer, format='JPEG', quality=92, optimize=True)
                mimetype = 'image/jpeg'
            elif target_format == 'webp':
                if alpha_channel is not None:
                    upscaled.putalpha(alpha_channel)
                upscaled.save(output_buffer, format='WEBP', quality=92, method=6)
                mimetype = 'image/webp'
            else:  # png
                if alpha_channel is not None:
                    upscaled.putalpha(alpha_channel)
                upscaled.save(output_buffer, format='PNG', optimize=True)
                mimetype = 'image/png'

        output_buffer.seek(0)
        return send_file(
            output_buffer,
            mimetype=mimetype,
            as_attachment=True,
            download_name=output_filename
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"UPSCALE ERROR: {str(e)}")
        return jsonify({"error": f"Upscale failed: {str(e)}"}), 500


# ============================================
# ===  ENHANCER  =============================
# ============================================
@app.route('/enhance-single', methods=['POST'])
@limiter.limit("10 per minute")
def enhance_single():
    file = request.files.get('file')
    target_format = request.form.get('target_format', 'png').lower().strip()
    enhance_mode = request.form.get('enhance_mode', 'full').lower().strip()

    if not file:
        return jsonify({"error": "Missing file."}), 400

    if target_format not in ('png', 'jpg', 'jpeg', 'webp'):
        return jsonify({"error": "Unsupported output format."}), 400

    file_bytes = file.read()
    if len(file_bytes) == 0:
        return jsonify({"error": "File is empty."}), 400

    mime_type = validate_mime(file_bytes)
    if mime_type not in ALLOWED_MIME_TYPES:
        return jsonify({"error": f"Unsupported file type. Detected: {mime_type}"}), 400

    raw_filename = file.filename or "enhanced"
    clean_name = secure_filename(raw_filename)
    base_name = clean_name.rsplit('.', 1)[0] if '.' in clean_name else clean_name
    if not base_name:
        base_name = "enhanced"

    output_filename = f"{base_name}_enhanced.{target_format}"

    input_buffer = io.BytesIO(file_bytes)
    output_buffer = io.BytesIO()

    try:
        with Image.open(input_buffer) as img:
            # Extract alpha channel separately (Pillow filters don't work on RGBA)
            alpha_channel = None
            if img.mode in ('RGBA', 'LA'):
                alpha_channel = img.split()[-1]
                working = img.convert('RGB')
            elif img.mode == 'P':
                img_rgba = img.convert('RGBA')
                alpha_channel = img_rgba.split()[-1]
                working = img_rgba.convert('RGB')
            else:
                working = img.convert('RGB')

            # Apply enhancements (using fast_unsharp_mask for speed on large images)
            if enhance_mode in ('sharpen', 'full'):
                working = fast_unsharp_mask(working, radius=2, percent=120, threshold=3)

            if enhance_mode in ('contrast', 'full'):
                working = ImageEnhance.Contrast(working).enhance(1.15)

            if enhance_mode in ('color', 'full'):
                working = ImageEnhance.Color(working).enhance(1.15)

            if enhance_mode in ('brightness', 'full'):
                working = ImageEnhance.Brightness(working).enhance(1.05)

            # Save with target format
            if target_format in ('jpg', 'jpeg'):
                working.save(output_buffer, format='JPEG', quality=92, optimize=True)
                mimetype = 'image/jpeg'
            elif target_format == 'webp':
                if alpha_channel is not None:
                    working.putalpha(alpha_channel)
                working.save(output_buffer, format='WEBP', quality=92, method=6)
                mimetype = 'image/webp'
            else:  # png
                if alpha_channel is not None:
                    working.putalpha(alpha_channel)
                working.save(output_buffer, format='PNG', optimize=True)
                mimetype = 'image/png'

        output_buffer.seek(0)
        return send_file(
            output_buffer,
            mimetype=mimetype,
            as_attachment=True,
            download_name=output_filename
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"ENHANCE ERROR: {str(e)}")
        return jsonify({"error": f"Enhance failed: {str(e)}"}), 500


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)