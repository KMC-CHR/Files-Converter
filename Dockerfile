FROM python:3.11-slim

# Install FFmpeg (media processing) and system libraries for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Deno: JavaScript runtime required by yt-dlp to solve media extraction challenges
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

WORKDIR /app

# Install Python backend dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Run as non-privileged user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Run FastAPI via Uvicorn with standard workers and 300s timeout for media downloads
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--timeout-keep-alive", "300"]
