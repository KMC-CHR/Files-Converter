import io
import os
import gc
from fastapi import APIRouter, File, UploadFile, Form, HTTPException, Response
from PIL import Image, ImageFilter
from utils import normalize_image

upscale_router = APIRouter(prefix="/api", tags=["Upscale"])

@upscale_router.post("/upscale")
@upscale_router.post("/upscale-single")
async def upscale_single(
    file: UploadFile = File(...),
    target_res: str = Form("1080p"),
    target_format: str = Form("png"),
    filter: str = Form(None),
    resample: str = Form(None)
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty filename")

    target_fmt = target_format.lower()
    resample_mode = (filter or resample or "lanczos").lower()

    res_map = {'720p': 1280, '1080p': 1920, '1440p': 2560, '2160p': 3840}
    target_width = res_map.get(target_res, 1920)

    filter_map = {
        'lanczos': Image.Resampling.LANCZOS,
        'bicubic': Image.Resampling.BICUBIC,
        'bilinear': Image.Resampling.BILINEAR
    }
    resample_filter = filter_map.get(resample_mode, Image.Resampling.LANCZOS)

    try:
        input_bytes = await file.read()
        img = Image.open(io.BytesIO(input_bytes))
        img = normalize_image(img)

        width_percent = (target_width / float(img.size[0]))
        target_height = int((float(img.size[1]) * float(width_percent)))

        img_resized = img.resize((target_width, target_height), resample_filter)
        img_resized = img_resized.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=2))

        output_io = io.BytesIO()

        if target_fmt in ('jpg', 'jpeg'):
            if img_resized.mode == 'RGBA':
                background = Image.new('RGB', img_resized.size, (255, 255, 255))
                background.paste(img_resized, mask=img_resized.split()[3])
                img_resized = background
            img_resized.save(output_io, format='JPEG', quality=95)
            mimetype = 'image/jpeg'
            ext = 'jpg'
        elif target_fmt == 'webp':
            img_resized.save(output_io, format='WEBP', quality=92)
            mimetype = 'image/webp'
            ext = 'webp'
        else:
            img_resized.save(output_io, format='PNG', optimize=True)
            mimetype = 'image/png'
            ext = 'png'

        output_io.seek(0)
        content_bytes = output_io.getvalue()

        del input_bytes, img, img_resized
        gc.collect()

        filename_no_ext = os.path.splitext(file.filename)[0]
        download_name = f"upscaled_{target_res}_{filename_no_ext}.{ext}"

        return Response(
            content=content_bytes,
            media_type=mimetype,
            headers={
                "Content-Disposition": f'attachment; filename="{download_name}"'
            }
        )
    except Exception as e:
        gc.collect()
        raise HTTPException(status_code=500, detail=f"Upscaling failed: {str(e)}")