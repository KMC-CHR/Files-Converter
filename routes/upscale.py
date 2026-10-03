import io
import os
import gc
from flask import Blueprint, request, jsonify, send_file
from PIL import Image, ImageFilter
from utils import normalize_image

upscale_bp = Blueprint('upscale', __name__)

@upscale_bp.route('/upscale-single', methods=['POST'])
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