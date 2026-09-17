# Use a lightweight, minimal Python base image
FROM python:3.11-slim

# Install system dependencies including FFmpeg, libmagic, and build tools for Pillow/HEIF
# hadolint ignore=DL3008,DL3015
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libmagic1 \
    build-essential \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

# Create an unprivileged user and group for security
RUN groupadd -r appuser && useradd -r -g appuser -s /bin/false appuser

# Set the working directory
WORKDIR /app

# Copy dependency definition and install requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files into the container
COPY app.py .
COPY static/ ./static/
COPY templates/ ./templates/

# Set ownership of application files to the unprivileged user
RUN chown -R appuser:appuser /app

# Switch to the non-root user
USER appuser

# Expose the application port
EXPOSE 5000

# Start the application using a production WSGI server (Gunicorn)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--timeout", "600", "app:app"]