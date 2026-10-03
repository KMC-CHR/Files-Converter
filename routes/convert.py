import io
import os
import gc
from flask import Blueprint, request, jsonify, send_file
from PIL import Image
from utils import normalize_image

convert_bp = Blueprint('convert', __name__)

@convert_bp.route('/convert-single', methods=['POST'])
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