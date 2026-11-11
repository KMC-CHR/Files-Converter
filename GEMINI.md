# GEMINI.md - Agent Context & Project Guidelines

## Overview
**OmniShift (Files-Converter)** is an all-in-one web utility for media processing, image conversion, enhancement, upscaling (standard & AI Super-Resolution via LapSRN), and video/audio downloading.

## Architecture & Tech Stack
- **Backend:** Python (Flask), OpenCV (`cv2`), Pillow (`PIL`), NumPy, `yt-dlp`.
  - Core entry / blueprints: `app/` and `routes/`.
  - AI Model / helper routines: `LapSRN_x2.pb` processed locally via OpenCV DNN module.
- **Frontend:** React 19, TypeScript, Vite, Lucide React.
  - Located in `frontend/`.
  - Vite dev server runs at port 3000 and proxies `/api` requests to Flask backend at `http://127.0.0.1:8000`.

## Key Commands

### Backend
```bash
# Activate virtual environment (Windows PowerShell)
.venv\Scripts\Activate.ps1

# Run Flask backend server
python -m flask --app app run --port 8000
# or direct entrypoint if defined (e.g., python app.py or python -m app)
```

### Frontend
```bash
cd frontend

# Install dependencies
npm install

# Run Vite dev server
npm run dev

# Run TypeScript check & production build
npm run build
```

## Conventions & Rules
- **TypeScript & Modules:**
  - TypeScript is configured with strict type checks and `verbatimModuleSyntax`. Use explicit `import type { ... }` when importing TypeScript types/interfaces.
  - Types are declared in `frontend/src/types/index.ts`.
- **API Client:**
  - All communication between frontend and backend passes through `frontend/src/api/client.ts` via relative `/api/*` endpoints.
- **Handling Binary / Large Models:**
  - Neural network models (`.pb`, `.onnx`) and virtual environment packages (`.venv`, `node_modules`) should not be committed to Git.

