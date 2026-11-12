import io
import os
import gc
from fastapi import APIRouter, File, UploadFile, Form, HTTPException, Response
from PIL import Image
from utils import (
    normalize_image,
    open_validated_image,
    read_bounded_upload,
    safe_download_filename,
)

convert_router = APIRouter(prefix="/api", tags=["Convert"])

@convert_router.post("/convert")
@convert_router.post("/convert-single")
async def convert_single(
    file: UploadFile = File(...),
    target_format: str = Form(None),
    format: str = Form(None),
    quality: int = Form(95)
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty filename")

    target_fmt = (target_format or format or "png").lower()

    try:
        image_bytes = await read_bounded_upload(file)
        img = open_validated_image(image_bytes)
        img = normalize_image(img)
        output_io = io.BytesIO()

        if target_fmt in ('jpg', 'jpeg'):
            if img.mode == 'RGBA':
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3])
                img = background
            img.save(output_io, format='JPEG', quality=quality or 95)
            mimetype = 'image/jpeg'
            ext = 'jpg'
        elif target_fmt == 'webp':
            img.save(output_io, format='WEBP', quality=quality or 92)
            mimetype = 'image/webp'
            ext = 'webp'
        else:
            img.save(output_io, format='PNG', optimize=True)
            mimetype = 'image/png'
            ext = 'png'

        output_io.seek(0)
        content_bytes = output_io.getvalue()

        del image_bytes, img
        gc.collect()

        download_name = safe_download_filename(file.filename, "converted_", ext)

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
        raise HTTPException(status_code=500, detail=f"Image conversion failed: {str(e)}")