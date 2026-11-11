import io
import os
import shutil
import tempfile
import traceback
from typing import Optional

import yt_dlp
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, HttpUrl

download_router = APIRouter(prefix="/api", tags=["Download"])

MAX_FILESIZE = 100 * 1024 * 1024  # 100MB limit


class DownloadRequest(BaseModel):
    url: str
    type: Optional[str] = "mp4"
    quality: Optional[str] = "1080"


def friendly_error(raw: str) -> str:
    """Turn raw yt-dlp errors into something a user can understand."""
    low = raw.lower()
    if 'sign in to confirm' in low or 'not a bot' in low:
        return ('YouTube blocked this server (bot check). '
                'The site owner needs to add YouTube cookies (YOUTUBE_COOKIES).')
    if 'js runtime' in low or 'javascript runtime' in low:
        return 'Server is missing a JavaScript runtime needed for YouTube.'
    if 'requested format is not available' in low:
        return 'No downloadable format found for this link at that quality.'
    if 'private video' in low or 'members-only' in low:
        return 'This video is private or members-only.'
    if 'max-filesize' in low or 'larger than max' in low:
        return 'File is larger than the 100MB limit. Try a lower resolution.'
    if 'unsupported url' in low:
        return 'This link is not supported.'
    return f'Failed to process link: {raw[:300]}'


@download_router.post("/download-media")
async def download_media(payload: DownloadRequest):
    url = payload.url.strip()
    media_type = (payload.type or "mp4").strip().lower()
    quality = (payload.quality or "1080").strip()

    if not url:
        raise HTTPException(status_code=400, detail="No URL provided")
    if not url.lower().startswith(('http://', 'https://')):
        raise HTTPException(status_code=400, detail="Please enter a full link starting with http(s)://")

    temp_dir = tempfile.mkdtemp()

    try:
        base_ydl_opts = {
            'outtmpl': os.path.join(temp_dir, '%(title).80B.%(ext)s'),
            'restrictfilenames': True,
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 30,
            'retries': 5,
            'fragment_retries': 10,
            'skip_unavailable_fragments': False,
            'concurrent_fragment_downloads': 1,
            'downloader': {'m3u8': 'ffmpeg'},
            'fixup': 'force',
            'max_filesize': MAX_FILESIZE,
        }

        raw_cookies = os.environ.get('YOUTUBE_COOKIES', '').strip()
        if raw_cookies:
            raw_cookies = raw_cookies.replace('\\n', '\n').replace('\\t', '\t')
            cookie_path = os.path.join(temp_dir, 'cookies.txt')
            with open(cookie_path, 'w', encoding='utf-8') as f:
                f.write(raw_cookies + '\n')
            base_ydl_opts['cookiefile'] = cookie_path

        if media_type == 'mp3':
            bitrate = quality if quality in ('320', '256', '192', '128') else '192'
            ydl_opts = {
                **base_ydl_opts,
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': bitrate,
                }],
            }
            target_ext = '.mp3'
            mimetype = 'audio/mpeg'
        else:
            h = quality if quality in ('360', '480', '720', '1080') else '1080'
            ydl_opts = {
                **base_ydl_opts,
                'format': (
                    f'bv*[height<={h}][vcodec^=avc1]+ba[ext=m4a]/'
                    f'bv*[height<={h}][ext=mp4]+ba[ext=m4a]/'
                    f'bv*[height<={h}]+ba/'
                    f'b[height<={h}]/'
                    'bv*+ba/b'
                ),
                'merge_output_format': 'mp4',
            }
            target_ext = '.mp4'
            mimetype = 'video/mp4'

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if info is None:
                raise HTTPException(status_code=400, detail="Could not extract media metadata")

        candidates = [f for f in os.listdir(temp_dir) if f.lower().endswith(target_ext)]
        if not candidates:
            raise HTTPException(status_code=500, detail=f"{media_type.upper()} file was not generated")
        
        output_file = os.path.join(temp_dir, candidates[0])

        with open(output_file, 'rb') as f:
            content_bytes = f.read()

        filename = os.path.basename(output_file)

        return Response(
            content=content_bytes,
            media_type=mimetype,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        print('ERROR IN /download-media:')
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=friendly_error(str(e)))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)