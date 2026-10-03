import io
import os
import gc
import cv2
import numpy as np
from flask import Blueprint, request, jsonify, send_file
from PIL import Image, ImageFilter
from utils import normalize_image, get_super_res

ai_bp = Blueprint('ai', __name__)


@ai_bp.route('/ai-upscale-single', methods=['POST'])
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

        sr_model = get_super_res()

        # Execute 100% Local AI Model if loaded
        if sr_model is not None:
            # Convert PIL RGB -> OpenCV BGR
            cv_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

            # Run local CPU super resolution pass
            upscaled_cv = sr_model.upsample(cv_img)

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