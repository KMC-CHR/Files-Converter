import os
import tempfile
import traceback
from flask import Blueprint, request, jsonify, send_file
import yt_dlp

download_bp = Blueprint('download', __name__)

@download_bp.route('/download-media', methods=['POST'])
def download_media():
    data = request.get_json() or {}
    url = data.get('url', '').strip()
    media_type = data.get('type', 'mp4').strip().lower()
    quality = data.get('quality', '1080').strip()

    if not url:
        return jsonify({'error': 'No URL provided'}), 400

    temp_dir = tempfile.mkdtemp()
    output_template = os.path.join(temp_dir, '%(title)s.%(ext)s')

    # MP3 Audio Mode
    if media_type == 'mp3':
        bitrate = quality if quality in ('320', '256', '192', '128') else '192'
        ydl_opts = {
            'format': 'bestaudio[ext=m4a]/bestaudio/best',
            'outtmpl': output_template,
            'quiet': False,
            'nocheckcertificate': True,
            'concurrent_fragment_downloads': 4,
            'socket_timeout': 30,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': bitrate,
            }],
            'postprocessor_args': {
                'ffmpeg': ['-threads', '4', '-preset', 'ultrafast']
            }
        }
    # MP4 Video Mode
    else:
        height_limit = quality if quality in ('360', '480', '720', '1080') else '1080'
        format_rule = f"bestvideo[height<={height_limit}]+bestaudio/best[height<={height_limit}]/best"
        ydl_opts = {
            'format': format_rule,
            'outtmpl': output_template,
            'merge_output_format': 'mp4',
            'quiet': False,
            'nocheckcertificate': True,
            'concurrent_fragment_downloads': 4,
            'socket_timeout': 30,
        }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if info is None:
                return jsonify({'error': 'Could not extract media metadata'}), 400

            filename = ydl.prepare_filename(info)
            target_ext = '.mp3' if media_type == 'mp3' else '.mp4'
            base_name = os.path.splitext(filename)[0]
            output_file = f"{base_name}{target_ext}"

            if not os.path.exists(output_file):
                files_in_dir = [os.path.join(temp_dir, f) for f in os.listdir(temp_dir) if f.endswith(target_ext)]
                if files_in_dir:
                    output_file = files_in_dir[0]
                else:
                    return jsonify({'error': f'Download failed: {media_type.upper()} file not generated'}), 500

        mimetype = 'audio/mpeg' if media_type == 'mp3' else 'video/mp4'

        return send_file(
            output_file,
            mimetype=mimetype,
            as_attachment=True,
            download_name=os.path.basename(output_file)
        )
    except Exception as e:
        print("ERROR IN /download-media:")
        traceback.print_exc()
        return jsonify({'error': f'Failed to process link: {str(e)}'}), 500