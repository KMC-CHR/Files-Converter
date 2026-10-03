import os
from flask import Flask
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from dotenv import load_dotenv

# Import local modules at top of file to satisfy PEP8/Flake8
from utils import init_local_ai
from routes.main import main_bp
from routes.convert import convert_bp
from routes.upscale import upscale_bp
from routes.enhance import enhance_bp
from routes.ai import ai_bp
from routes.download import download_bp

# Load local .env environment variables
load_dotenv()

# Optional HEIF support registration
try:
    import pillow_heif  # type: ignore
    pillow_heif.register_heif_opener()
except Exception as e:
    print(f"INFO: HEIF opener optional mode active ({e})")

# Initialize local OpenCV AI model on startup
init_local_ai()


def create_app():
    app = Flask(__name__)

    # Enforce strict 15MB upload limit
    app.config['MAX_CONTENT_LENGTH'] = 15 * 1024 * 1024

    # Configure rate limiter using client IP
    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://"
    )

    # Apply endpoint-specific rate limits
    limiter.limit("20 per minute")(main_bp)
    limiter.limit("30 per minute")(convert_bp)
    limiter.limit("20 per minute")(upscale_bp)
    limiter.limit("20 per minute")(enhance_bp)
    limiter.limit("10 per minute")(ai_bp)
    limiter.limit("5 per minute")(download_bp)

    # Register Blueprints
    app.register_blueprint(main_bp)
    app.register_blueprint(convert_bp)
    app.register_blueprint(upscale_bp)
    app.register_blueprint(enhance_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(download_bp)

    return app


app = create_app()

if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', 5000))
    app.run(host=host, port=port, debug=False)