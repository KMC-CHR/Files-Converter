# Step 1: Build Frontend Assets
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Step 2: Set up Python Environment & System Dependencies
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

# Prevent Python from writing bytecode and buffer issues
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install Python backend dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY . .

# Copy compiled dist frontend files into application container
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Run as non-privileged user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Run FastAPI via Uvicorn with standard workers and 300s timeout for media downloads
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-keep-alive", "300"]