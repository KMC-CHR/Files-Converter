import sys
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from utils import init_local_ai
from routes.convert import convert_router
from routes.upscale import upscale_router
from routes.enhance import enhance_router
from routes.ai import ai_router
from routes.download import download_router

load_dotenv()

try:
    import pillow_heif  # type: ignore
    pillow_heif.register_heif_opener()
except Exception as e:
    print(f"INFO: HEIF opener optional mode active ({e})")

init_local_ai()

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(
    title="OmniShift Engine",
    description="FastAPI Backend for OmniShift Image & Media Processing"
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

MAX_CONTENT_LENGTH = 15 * 1024 * 1024

@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    
    if content_length:
        try:
            length_val = int(content_length)
            if length_val > MAX_CONTENT_LENGTH:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "File size exceeds maximum allowed limit of 15MB."}
                )
        except ValueError:
            return JSONResponse(
                status_code=400,
                content={"detail": "Invalid Content-Length header."}
            )
            
    return await call_next(request)

allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000")
origins = [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)

# Register active backend routers
app.include_router(convert_router)
app.include_router(upscale_router)
app.include_router(enhance_router)
app.include_router(ai_router)
app.include_router(download_router)

@app.get("/healthz")
async def health_check():
    return {"status": "ok"}

# Correct path pointing directly to frontend/dist relative to root main.py
DIST_DIR = APP_DIR / "frontend" / "dist"
ASSETS_DIR = DIST_DIR / "assets"
MODELS_DIR = DIST_DIR / "models"

# Mount static asset folders if they exist
if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")

if MODELS_DIR.exists():
    app.mount("/models", StaticFiles(directory=str(MODELS_DIR)), name="models")

# Mount static directory if existing legacy static folder is present
LEGACY_STATIC_DIR = APP_DIR / "static"
if LEGACY_STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(LEGACY_STATIC_DIR)), name="legacy_static")

# Catch-all route to serve compiled SPA files or fallback to index.html
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "API endpoint not found"})
        
    requested_file = DIST_DIR / full_path
    if requested_file.is_file():
        return FileResponse(requested_file)
        
    entry_html_file = DIST_DIR / "index.html"
    if entry_html_file.exists():
        return FileResponse(entry_html_file)
        
    return JSONResponse(status_code=404, content={"detail": "Frontend build files missing. Run 'npm run build' inside /frontend first."})