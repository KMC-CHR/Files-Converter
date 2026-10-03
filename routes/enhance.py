import io
import os
import gc
from flask import Blueprint, request, jsonify, send_file
from PIL import Image, ImageEnhance, ImageFilter
from utils import normalize_image

enhance_bp = Blueprint('enhance', __name__)

@enhance_bp.route('/enhance-single', methods=['POST'])
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