import io
import os
import shutil
import tempfile
import traceback

import yt_dlp
from flask import Blueprint, request, jsonify, send_file

download_bp = Blueprint('download', __name__)

MAX_FILESIZE = 100 * 1024 * 1024  # matches the "100MB" promise in the FAQ


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


@download_bp.route('/download-media', methods=['POST'])
def download_media():
    data = request.get_json(silent=True) or {}
    url = str(data.get('url', '')).strip()
    media_type = str(data.get('type', 'mp4')).strip().lower()
    quality = str(data.get('quality', '1080')).strip()

    if not url:
        return jsonify({'error': 'No URL provided'}), 400
    if not url.lower().startswith(('http://', 'https://')):
        return jsonify({'error': 'Please enter a full link starting with http(s)://'}), 400

    temp_dir = tempfile.mkdtemp()

    try:
        base_ydl_opts = {
            # restrictfilenames avoids unicode/emoji titles breaking the file lookup
            'outtmpl': os.path.join(temp_dir, '%(title).80B.%(ext)s'),
            'restrictfilenames': True,
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 30,
            'retries': 5,
            'fragment_retries': 10,           # retry bad/missing chunks instead of skipping them
            'skip_unavailable_fragments': False,  # never silently drop a chunk (= glitch/freeze)
            'concurrent_fragment_downloads': 1,   # safer than 4 on a small Render instance
            'downloader': {'m3u8': 'ffmpeg'},     # ffmpeg handles HLS timestamp breaks better
            'fixup': 'force',                     # always repair timestamps/containers
            'max_filesize': MAX_FILESIZE,
            # NOTE: no forced player_client and no 'skip': ['dash','hls'] here.
            # Skipping DASH removed every separate audio/video stream, which broke
            # MP3 and anything above 360p. yt-dlp's defaults are maintained for you.
        }

        # Optional YouTube cookies (Netscape format) to get past the bot check
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
                    # H.264 + AAC plays smoothly everywhere; VP9/AV1/Opus in .mp4 often stutters
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
                return jsonify({'error': 'Could not extract media metadata'}), 400

        # Find the produced file (don't trust prepare_filename's extension)
        candidates = [f for f in os.listdir(temp_dir) if f.lower().endswith(target_ext)]
        if not candidates:
            return jsonify({'error': f'{media_type.upper()} file was not generated'}), 500
        output_file = os.path.join(temp_dir, candidates[0])

        # Load into memory so the temp dir can be deleted right away
        with open(output_file, 'rb') as f:
            buf = io.BytesIO(f.read())
        buf.seek(0)

        return send_file(
            buf,
            mimetype=mimetype,
            as_attachment=True,
            download_name=os.path.basename(output_file),
        )
    except Exception as e:
        print('ERROR IN /download-media:')
        traceback.print_exc()
        return jsonify({'error': friendly_error(str(e))}), 500
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)