import io
import os
import filetype
from flask import Flask, request, send_file, jsonify, render_template
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from PIL import Image
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

# Resolution presets (width x height for landscape, will auto-detect orientation)
RESOLUTION_PRESETS = {
    '720p': 1280,
    '1080p': 1920,
    '1440p': 2560,
    '2160p': 3840,
    'source': None  # Keep original size
}

def validate_mime(file_bytes):
    kind = filetype.guess(file_bytes)
    if kind is None:
        return None
    return kind.mime

@app.route('/')
def index():
    return render_template('Index.html')

@app.route('/healthz')
def healthz():
    return 'ok', 200

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
                img = img.convert('RGB')
            
            if target_format == 'pdf':
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                img.save(output_buffer, format='PDF')
                mimetype = 'application/pdf'
            else:
                img.save(output_buffer, format=target_format.upper(), quality=85)
                mimetype = f"image/{target_format}"
        
        output_buffer.seek(0)
        return send_file(
            output_buffer,
            mimetype=mimetype,
            as_attachment=True,
            download_name=output_filename
        )
    except Exception as e:
        print(f"CONVERSION ERROR: {str(e)}")
        return jsonify({"error": "Internal conversion error. The file may be corrupted."}), 500


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

    # Map filter names to Pillow resampling methods
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

            # Calculate target dimensions
            target_long_edge = RESOLUTION_PRESETS[target_res]
            if target_long_edge is None:
                # "source" preset - just use original size
                new_width, new_height = original_width, original_height
            else:
                if is_landscape:
                    new_width = target_long_edge
                    new_height = int((target_long_edge / original_width) * original_height)
                else:
                    new_height = target_long_edge
                    new_width = int((target_long_edge / original_height) * original_width)

            # Perform the upscale
            upscaled = img.resize((new_width, new_height), resample=resample_method)

            # Handle output format
            if target_format in ('jpg', 'jpeg'):
                if upscaled.mode in ('RGBA', 'P', 'LA'):
                    # Convert transparency to white background
                    background = Image.new('RGB', upscaled.size, (255, 255, 255))
                    if upscaled.mode == 'P':
                        upscaled = upscaled.convert('RGBA')
                    background.paste(upscaled, mask=upscaled.split()[-1] if upscaled.mode == 'RGBA' else None)
                    upscaled = background
                elif upscaled.mode != 'RGB':
                    upscaled = upscaled.convert('RGB')
                upscaled.save(output_buffer, format='JPEG', quality=92, optimize=True)
                mimetype = 'image/jpeg'
            elif target_format == 'webp':
                upscaled.save(output_buffer, format='WEBP', quality=92, method=6)
                mimetype = 'image/webp'
            else:  # png
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
        print(f"UPSCALE ERROR: {str(e)}")
        return jsonify({"error": f"Upscale failed: {str(e)}"}), 500


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)