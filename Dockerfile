FROM python:3.11-slim

# Install system dependencies in one layer as root
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    libheif-dev \
    liblcms2-dev \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Create non-root system user
RUN groupadd -r appuser && useradd -r -g appuser -s /bin/false appuser

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application assets
COPY app.py .
COPY static/ ./static/
COPY templates/ ./templates/

# Set non-root ownership and switch user
RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "2", "--timeout", "120", "app:app"]