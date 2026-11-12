import io
import os
import gc
import cv2
import numpy as np
from fastapi import APIRouter, File, UploadFile, HTTPException, Response
from PIL import Image, ImageFilter
from utils import (
    get_super_res,
    normalize_image,
    open_validated_image,
    read_bounded_upload,
    safe_download_filename,
)

ai_router = APIRouter(prefix="/api", tags=["AI"])

MAX_SERVER_AI_SIDE = 1024  # Prevent LapSRN from blowing past Render's 512 MB RAM limit


@ai_router.post("/ai-superres")
@ai_router.post("/ai-upscale-single")
async def ai_upscale_single(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty filename")

    try:
        input_bytes = await read_bounded_upload(file)
        pil_img = open_validated_image(input_bytes)
        pil_img = normalize_image(pil_img)

        alpha_channel = None
        if pil_img.mode == "RGBA":
            alpha_channel = pil_img.split()[3]
            rgb_img = pil_img.convert("RGB")
        else:
            rgb_img = pil_img

        sr_model = get_super_res()
        within_ram_budget = max(rgb_img.width, rgb_img.height) <= MAX_SERVER_AI_SIDE

        # Execute Local AI Model if loaded and within safe RAM dimensions
        if sr_model is not None and within_ram_budget:
            # Convert PIL RGB -> OpenCV BGR
            cv_img = cv2.cvtColor(np.array(rgb_img), cv2.COLOR_RGB2BGR)

            # Run local CPU super resolution pass
            upscaled_cv = sr_model.upsample(cv_img)

            # Convert OpenCV BGR -> PIL RGB
            upscaled_rgb = cv2.cvtColor(upscaled_cv, cv2.COLOR_BGR2RGB)
            output_img = Image.fromarray(upscaled_rgb)

            del cv_img, upscaled_cv, upscaled_rgb
            gc.collect()

        # Multi-Pass Fallback if model failed/missing or image is too large for 512 MB RAM
        else:
            target_w, target_h = rgb_img.width * 2, rgb_img.height * 2
            scaled = rgb_img.resize((target_w, target_h), Image.Resampling.LANCZOS)
            output_img = scaled.filter(ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=2))

        if alpha_channel is not None:
            upscaled_alpha = alpha_channel.resize(output_img.size, Image.Resampling.LANCZOS)
            output_img = output_img.convert("RGBA")
            output_img.putalpha(upscaled_alpha)

        output_io = io.BytesIO()
        output_img.save(output_io, format='PNG', optimize=True)
        output_io.seek(0)
        content_bytes = output_io.getvalue()

        del input_bytes, pil_img, rgb_img, output_img
        gc.collect()

        download_name = safe_download_filename(file.filename, "ai_upscaled_", "png")

        return Response(
            content=content_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": f'attachment; filename="{download_name}"'
            }
        )
    except HTTPException:
        gc.collect()
        raise
    except Exception as e:
        gc.collect()
        raise HTTPException(status_code=500, detail=f"AI Upscaling failed: {str(e)}")