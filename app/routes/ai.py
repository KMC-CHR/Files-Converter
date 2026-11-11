import io
import os
import gc
import cv2
import numpy as np
from fastapi import APIRouter, File, UploadFile, HTTPException, Response
from PIL import Image, ImageFilter
from utils import normalize_image, get_super_res

ai_router = APIRouter(prefix="/api", tags=["AI"])

@ai_router.post("/ai-superres")
@ai_router.post("/ai-upscale-single")
async def ai_upscale_single(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty filename")

    try:
        input_bytes = await file.read()
        pil_img = Image.open(io.BytesIO(input_bytes))
        pil_img = normalize_image(pil_img)

        sr_model = get_super_res()

        # Execute Local AI Model if loaded
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

        # Multi-Pass Fallback if model failed/missing
        else:
            target_w, target_h = pil_img.width * 2, pil_img.height * 2
            scaled = pil_img.resize((target_w, target_h), Image.Resampling.LANCZOS)
            output_img = scaled.filter(ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=2))

        output_io = io.BytesIO()
        output_img.save(output_io, format='PNG', optimize=True)
        output_io.seek(0)
        content_bytes = output_io.getvalue()

        del input_bytes, pil_img
        gc.collect()

        filename_no_ext = os.path.splitext(file.filename)[0]
        download_name = f"ai_upscaled_{filename_no_ext}.png"

        return Response(
            content=content_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": f'attachment; filename="{download_name}"'
            }
        )
    except Exception as e:
        gc.collect()
        raise HTTPException(status_code=500, detail=f"AI Upscaling failed: {str(e)}")