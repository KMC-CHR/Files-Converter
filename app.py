import io
import os
import re
import filetype
import yt_dlp
from flask import Flask, request, send_file, jsonify, render_template
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from PIL import Image
import pillow_heif
from werkzeug.utils import secure_filename
import tempfile
import shutil

# Register HEIF opener safely
try:
    pillow_heif.register_heif_opener()
except Exception as e:
    print(f"WARNING: Could not register HEIF opener: {e}")

app = Flask(__name__)
# Lowered to 15MB per file to prevent memory exhaustion on the server
app.config['MAX_CONTENT_LENGTH'] = 15 * 1024 * 1024 

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# Allowed MIME types for images
ALLOWED_MIME_TYPES = {
    'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'
}
ALLOWED_TARGET_FORMATS = {'png', 'jpg', 'jpeg', 'webp', 'pdf'}

# YouTube URL Regex to prevent SSRF
YOUTUBE_REGEX = re.compile(
    r'^(https?://)?(www\.)?(youtube\.com|youtu\.?be)/.+$'
)

def validate_mime(file_bytes):
    """Use filetype library for safe, cross-platform MIME detection."""
    kind = filetype.guess(file_bytes)
    if kind is None:
        return None
    return kind.mime

@app.route('/')
def index():
    return render_template('Index.html')

@app.route('/convert-single', methods=['POST'])
@limiter.limit("10 per minute")
def convert_single():
    file = request.files.get('file')
    target_format = request.form.get('target_format', '').lower().strip()

    if not file or not target_format:
        return jsonify({"error": "Missing file or target format payload."}), 400

    if target_format not in ALLOWED_TARGET_FORMATS:
        return jsonify({"error": "Unsupported target format."}), 400

    file_bytes = file.read()
    if len(file_bytes) == 0:
        return jsonify({"error": "File is empty."}), 400

    mime_type = validate_mime(file_bytes)
    if mime_type not in ALLOWED_MIME_TYPES:
        return jsonify({"error": f"Unsupported or invalid file type. Detected: {mime_type}"}), 400

    raw_filename = file.filename or "converted"
    clean_name = secure_filename(raw_filename)
    base_name = clean_name.rsplit('.', 1)[0] if '.' in clean_name else clean_name
    if not base_name:
        base_name = "converted"
    
    output_filename = f"{base_name}.{target_format}"
    
    input_buffer = io.BytesIO(file_bytes)
    output_buffer = io.BytesIO()

    try:
        with Image.open(input_buffer) as img:
            if target_format in ('jpg', 'jpeg'):
                img = img.convert('RGB')
            
            if target_format == 'pdf':
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                img.save(output_buffer, format='PDF')
                mimetype = 'application/pdf'
            else:
                img.save(output_buffer, format=target_format.upper(), quality=85)
                mimetype = f"image/{target_format}"
        
        output_buffer.seek(0)
        return send_file(
            output_buffer,
            mimetype=mimetype,
            as_attachment=True,
            download_name=output_filename
        )
    except Exception as e:
        print(f"CONVERSION ERROR: {str(e)}")
        return jsonify({"error": "Internal conversion error. The file may be corrupted."}), 500

@app.route('/convert-yt', methods=['POST'])
@limiter.limit("5 per minute")
def convert_yt():
    data = request.get_json() or {}
    url = data.get('url', '').strip()
    target_format = data.get('target_format', 'mp3').lower().strip()

    if not url:
        return jsonify({"error": "Please provide a valid YouTube URL."}), 400
    
    # SSRF Protection: Ensure it's actually a YouTube URL
    if not YOUTUBE_REGEX.match(url):
        return jsonify({"error": "Invalid URL. Only YouTube links are allowed."}), 400

    if target_format not in ['mp3', 'mp4']:
        return jsonify({"error": "Invalid format. Choose mp3 or mp4."}), 400

    temp_dir = tempfile.gettempdir()
    
    ydl_opts = {
        'format': 'bestaudio/best' if target_format == 'mp3' else 'bestvideo+bestaudio/best',
        'outtmpl': os.path.join(temp_dir, '%(title)s.%(ext)s'),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }] if target_format == 'mp3' else [],
        'quiet': True,
        'no_warnings': True,
        # SECURITY: Limit video duration to 15 minutes (900 seconds) to prevent abuse
        'match_filter': yt_dlp.utils.match_filter_func("duration < 900"),
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            
            if target_format == 'mp3':
                base, _ = os.path.splitext(filename)
                filename = f"{base}.mp3"

            if not os.path.exists(filename):
                return jsonify({"error": "Conversion failed: Output file not found."}), 500

            with open(filename, 'rb') as f:
                file_data = io.BytesIO(f.read())
            
            # Clean up the temporary file immediately
            try:
                os.remove(filename)
            except OSError:
                pass

            file_data.seek(0)
            
            # Sanitize the YouTube title for the download name
            safe_title = secure_filename(info.get('title', 'media'))
            download_name = f"{safe_title}.{target_format}"
            
            return send_file(
                file_data,
                mimetype='audio/mpeg' if target_format == 'mp3' else 'video/mp4',
                as_attachment=True,
                download_name=download_name
            )
    except yt_dlp.utils.DownloadError as e:
        # Catch specific yt-dlp errors (like video too long or unavailable)
        error_msg = str(e)
        if "match filter" in error_msg or "duration" in error_msg:
            return jsonify({"error": "Video exceeds the 15-minute limit."}), 400
        return jsonify({"error": "Failed to download video. It may be private or region-locked."}), 400
    except Exception as e:
        print(f"YT-DLP CRITICAL ERROR: {str(e)}")
        return jsonify({"error": "Internal server error during YouTube processing."}), 500

if __name__ == '__main__':
    # Check for FFmpeg on startup
    if shutil.which("ffmpeg") is None:
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print("WARNING: FFmpeg is not installed or not in PATH.")
        print("The YouTube conversion feature will NOT work.")
        print("Please install FFmpeg before deploying.")
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
    
    app.run(host='127.0.0.1', port=5000, debug=False)

@app.route('/healthz')
def healthz():
    # A lightweight endpoint for keep-alive pings
    return 'ok', 200