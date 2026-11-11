# OmniShift

OmniShift is a high-performance, full-stack media processing utility that provides image format conversion, resolution upscaling, local CPU-powered AI super-resolution (LapSRN), image enhancement, and video/audio downloading.

---

## Features

- **Image Format Conversion**
  - Convert images between PNG, JPEG, and WebP.
  - Optional support for modern mobile formats (HEIC/HEIF).
  - Preserves alpha transparency across conversions.

- **Standard Resolution Upscaling**
  - Upscale images to standard target resolutions: 720p, 1080p, 2K, and 4K.
  - High-fidelity resampling using Lanczos and Bicubic filters with adaptive unsharp masking.

- **Local AI Super-Resolution**
  - 2x detail reconstruction using the local LapSRN deep learning model via OpenCV DNN.
  - Runs entirely on local CPU with no external cloud API keys, subscriptions, or GPU requirements.

- **Image Enhancement**
  - Instant image quality adjustments including sharpness boost, contrast balancing, and color vibrancy tuning.

- **Video and Audio Downloader**
  - Extract and download online media as MP4 video (up to 1080p) or MP3 audio (up to 320 kbps) using yt-dlp and FFmpeg.

- **Security and Resource Protection**
  - Strict upload payload enforcement (15 MB maximum per image request).
  - In-memory processing with garbage collection optimization to prevent memory leaks.
  - IP-based endpoint rate limiting powered by SlowAPI.

---

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, Uvicorn, SlowAPI
- **Image and AI Processing:** Pillow, OpenCV Headless (`cv2.dnn`), NumPy
- **Media Engine:** yt-dlp, FFmpeg, Deno
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Lucide React
- **Containerization:** Docker (Debian Slim multi-stage with Deno runtime)

---

## Project Structure

```text
Files-Converter/
├── app/
│   ├── main.py             # FastAPI entry point, middleware, CORS, routers
│   ├── utils.py            # AI model loader, image normalization, processing routines
│   ├── LapSRN_x2.pb        # Pre-trained LapSRN 2x super-resolution model weights
│   ├── models/             # Data models and schemas
│   └── routes/             # API routers (convert, upscale, enhance, ai, download)
├── frontend/
│   ├── src/                # React components, UI views, API client
│   ├── package.json        # Frontend dependencies and npm scripts
│   └── vite.config.ts      # Vite dev server configuration and /api proxy
├── Dockerfile              # Container configuration for production backend
├── requirements.txt        # Python backend dependencies
├── .gitignore              # Git ignore rules for virtualenvs, node_modules, weights
└── README.md               # Project documentation
```

---

## Prerequisites

1. **Python:** Version 3.11 or newer.
2. **Node.js:** Version 18 or newer (with npm).
3. **FFmpeg:** Required for audio extraction and video stream merging:
   - **Windows:** `winget install Gyan.FFmpeg` or download from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)
   - **macOS:** `brew install ffmpeg`
   - **Linux:** `sudo apt-get update && sudo apt-get install -y ffmpeg`

---

## Local Development Setup

### 1. Backend Setup (FastAPI)

1. Open a terminal and navigate to the repository root:
   ```bash
   cd Files-Converter
   ```

2. Create and activate a Python virtual environment:
   - **Windows (PowerShell):**
     ```powershell
     python -m venv .venv
     .venv\Scripts\Activate.ps1
     ```
   - **macOS / Linux:**
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. Install required Python packages:
   ```bash
   pip install -r requirements.txt
   ```

4. Start the FastAPI development server:
   ```bash
   uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
   ```
   The backend API will be available at `http://127.0.0.1:8000`. You can explore interactive Swagger documentation at `http://127.0.0.1:8000/docs`.

---

### 2. Frontend Setup (React + Vite)

1. Open a separate terminal window and navigate to the `frontend` directory:
   ```bash
   cd Files-Converter/frontend
   ```

2. Install frontend dependencies:
   ```bash
   npm install
   ```

3. Launch the Vite development server:
   ```bash
   npm run dev
   ```

4. Open your browser and access the application interface:
   ```text
   http://localhost:3000
   ```
   The Vite dev server proxies all `/api/*` requests directly to `http://127.0.0.1:8000`.

---

## Production Build

### Frontend Build
To create an optimized production build of the frontend:
```bash
cd frontend
npm run build
```
Compiled production assets will be output to `frontend/dist/`.

---

## Running with Docker

You can build and deploy the backend container using Docker. The Dockerfile installs FFmpeg, system libraries for OpenCV, and Deno for yt-dlp media extraction.

1. Build the Docker image:
   ```bash
   docker build -t omnishift-backend .
   ```

2. Run the container:
   ```bash
   docker run -d -p 8000:8000 --name omnishift omnishift-backend
   ```

3. Check container logs:
   ```bash
   docker logs -f omnishift
   ```

4. Verify backend health:
   ```bash
   curl http://localhost:8000/healthz
   ```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/healthz` | System health check status |
| `POST` | `/api/convert` | Converts image format (PNG, JPEG, WebP) |
| `POST` | `/api/upscale` | Standard resolution upscaling (720p, 1080p, 2K, 4K) |
| `POST` | `/api/enhance` | Image enhancement (sharpness, contrast, vibrancy) |
| `POST` | `/api/ai-upscale` | 2x local AI super-resolution using LapSRN model |
| `POST` | `/api/download` | Downloads and converts online media via yt-dlp |

---

## License

This project is licensed under the MIT License.
