import io
import os
import gc
from fastapi import APIRouter, File, UploadFile, Form, HTTPException, Response
from PIL import Image, ImageEnhance, ImageFilter
from utils import (
    normalize_image,
    open_validated_image,
    read_bounded_upload,
    safe_download_filename,
)

enhance_router = APIRouter(prefix="/api", tags=["Enhance"])

@enhance_router.post("/enhance")
@enhance_router.post("/enhance-single")
async def enhance_single(
    file: UploadFile = File(...),
    enhance_mode: str = Form(None),
    mode: str = Form(None),
    factor: float = Form(1.0),
    target_format: str = Form("png")
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty filename")

    target_fmt = target_format.lower()
    selected_mode = (enhance_mode or mode or "full").lower()

    try:
        input_bytes = await read_bounded_upload(file)
        img = open_validated_image(input_bytes)
        img = normalize_image(img)

        f = factor if factor and factor > 0 else 1.0

        if selected_mode in ('full', 'sharpen'):
            img = img.filter(ImageFilter.UnsharpMask(radius=1.8 * f, percent=int(140 * f), threshold=2))

        if selected_mode in ('full', 'contrast'):
            enhancer = ImageEnhance.Contrast(img)
            img = enhancer.enhance(1.0 + 0.20 * f)

        if selected_mode in ('full', 'color') and img.mode in ('RGB', 'RGBA'):
            enhancer = ImageEnhance.Color(img)
            img = enhancer.enhance(1.0 + 0.15 * f)

        output_io = io.BytesIO()

        if target_fmt in ('jpg', 'jpeg'):
            if img.mode == 'RGBA':
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3])
                img = background
            img.save(output_io, format='JPEG', quality=95)
            mimetype = 'image/jpeg'
            ext = 'jpg'
        elif target_fmt == 'webp':
            img.save(output_io, format='WEBP', quality=92)
            mimetype = 'image/webp'
            ext = 'webp'
        else:
            img.save(output_io, format='PNG', optimize=True)
            mimetype = 'image/png'
            ext = 'png'

        output_io.seek(0)
        content_bytes = output_io.getvalue()

        del input_bytes, img
        gc.collect()

        download_name = safe_download_filename(file.filename, "enhanced_", ext)

        return Response(
            content=content_bytes,
            media_type=mimetype,
            headers={
                "Content-Disposition": f'attachment; filename="{download_name}"'
            }
        )
    except HTTPException:
        gc.collect()
        raise
    except Exception as e:
        gc.collect()
        raise HTTPException(status_code=500, detail=f"Enhancement failed: {str(e)}")