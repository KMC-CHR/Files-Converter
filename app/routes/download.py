import io
import ipaddress
import os
import re
import shutil
import socket
import tempfile
import time
from collections import defaultdict
from typing import Optional
from urllib.parse import urlparse

import yt_dlp
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, HttpUrl

download_router = APIRouter(prefix="/api", tags=["Download"])

MAX_FILESIZE = 100 * 1024 * 1024  # 100MB limit
ALLOWED_DOMAINS = (
    "youtube.com",
    "youtu.be",
    "vimeo.com",
    "tiktok.com",
)
RATE_LIMIT_MAX_REQUESTS = 5
RATE_LIMIT_WINDOW_SECONDS = 600
_request_timestamps: dict[str, list[float]] = defaultdict(list)


def enforce_rate_limit(client_ip: str) -> None:
    now = time.monotonic()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    recent = [ts for ts in _request_timestamps[client_ip] if ts > cutoff]
    if len(recent) >= RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(
            status_code=429,
            detail="Too many download requests. Please wait a few minutes and try again.",
        )
    recent.append(now)
    _request_timestamps[client_ip] = recent


def validate_public_url(raw_url: str) -> None:
    parsed = urlparse(raw_url)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Please enter a full link starting with http(s)://")

    hostname = parsed.hostname.strip().lower()
    if not any(hostname == d or hostname.endswith("." + d) for d in ALLOWED_DOMAINS):
        raise HTTPException(
            status_code=400,
            detail="Only YouTube, Vimeo, and TikTok links are supported.",
        )

    if hostname in ("localhost", "localhost.localdomain") or hostname.endswith(".local"):
        raise HTTPException(status_code=400, detail="Local or internal addresses are not allowed")

    try:
        addr_infos = socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve link hostname")

    if not addr_infos:
        raise HTTPException(status_code=400, detail="Could not resolve link hostname")

    for info in addr_infos:
        ip_str = info[4][0]
        try:
            ip_obj = ipaddress.ip_address(ip_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid link IP address")

        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        ):
            raise HTTPException(status_code=400, detail="Private or internal network links are not allowed")


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
    return 'Failed to process link. Please verify the URL and try again.'


@download_router.post("/download-media")
async def download_media(payload: DownloadRequest, request: Request):
    forwarded_for = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else (request.client.host if request.client else "unknown")
    enforce_rate_limit(client_ip)

    url = payload.url.strip()
    media_type = (payload.type or "mp4").strip().lower()
    quality = (payload.quality or "1080").strip()

    if not url:
        raise HTTPException(status_code=400, detail="No URL provided")
    validate_public_url(url)

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

        secret_cookie_paths = (
            "/etc/secrets/YOUTUBE_COOKIES",
            "/etc/secrets/cookies.txt",
            "YOUTUBE_COOKIES",
        )
        loaded_cookie_file = next((p for p in secret_cookie_paths if os.path.isfile(p)), None)

        if loaded_cookie_file:
            with open(loaded_cookie_file, 'r', encoding='utf-8') as src:
                raw_cookies = src.read().strip()
        else:
            raw_cookies = os.environ.get('YOUTUBE_COOKIES', '').strip()

        if raw_cookies:
            if (raw_cookies.startswith("'") and raw_cookies.endswith("'")) or (
                raw_cookies.startswith('"') and raw_cookies.endswith('"')
            ):
                raw_cookies = raw_cookies[1:-1]
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

        raw_filename = os.path.basename(output_file)
        filename = re.sub(r'[^A-Za-z0-9._-]', '_', raw_filename)

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
        print(f'ERROR IN /download-media: {type(e).__name__}')
        raise HTTPException(status_code=500, detail=friendly_error(str(e)))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)