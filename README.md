# OmniShift 🚀

OmniShift is a fast, free, and all-in-one web tool to convert images, upscale low-resolution photos with AI, enhance colors, and download online media. 

---

## ✨ Features

- **🔄 Image Format Converter**
  - Easily convert images between **PNG**, **JPG**, and modern **WebP** formats.
  - Supports modern mobile formats like **HEIC/HEIF**.
  - Keeps transparent backgrounds clean and intact.

- **🔍 Standard Resolution Upscaler**
  - Boost image resolution up to **720p**, **1080p**, **2K**, or **4K**.
  - Uses high-quality smoothing filters (**Lanczos**, **Bicubic**) with smart edge sharpening.

- **🧠 Local AI Super-Resolution**
  - $2\times$ smart detail restoration powered by a local deep-learning AI model (**LapSRN**).
  - Runs **100% locally on your computer's CPU** — no external AI subscription, API keys, or graphics card needed.

- **🎨 Image Enhancer**
  - Automatically polish photos in one click.
  - Boost sharpness, balance contrast, or make colors more vibrant.

- **🎬 Video & Audio Downloader**
  - Save media as universal **MP4 video** (up to 1080p) or **MP3 audio** (up to 320 kbps).
  - Built with universal playback compatibility in mind.

- **🛡️ Built-in Protection**
  - Upload safety limits (15 MB image limit) and automatic rate limiting so servers don't freeze or crash.

---

## 🛠️ Built With

- **Backend:** Python, [Flask](https://flask.palletsprojects.com/)
- **Image & AI Engine:** [Pillow](https://python-pillow.org/), [OpenCV](https://opencv.org/), [NumPy](https://numpy.org/)
- **Media Engine:** [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org/)
- **Frontend:** Clean HTML5, CSS3, JavaScript, [Lucide Icons](https://lucide.dev/)
- **Deployment:** Docker, Gunicorn

---

## 📁 Project Layout

```text
Files-Converter/
├── app.py              # Main application entry point & setup
├── utils.py            # AI model loading & image helpers
├── requirements.txt    # List of required Python packages
├── Dockerfile          # Everything needed to run the app in a container
├── LapSRN_x2.pb        # Pre-trained AI upscaling brain (model weights)
├── routes/             # App features divided into clean modules
├── static/             # Stylesheets (CSS), icons, and assets
└── templates/          # Web page layout (HTML)
```

---

## 🚀 Quick Start (Running Locally)

### Prerequisites

1. **Python 3.11 or newer** installed on your computer.
2. **FFmpeg** installed (needed for video and audio processing):
   - **Windows:** Run `winget install Gyan.FFmpeg`
   - **Mac:** Run `brew install ffmpeg`
   - **Linux:** Run `sudo apt install ffmpeg`

---

### Step-by-Step Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/Files-Converter.git
   cd Files-Converter
   ```

2. **Create a virtual environment (recommended):**
   ```bash
   # On Windows (PowerShell):
   python -m venv .venv
   .venv\Scripts\Activate.ps1

   # On Mac / Linux:
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Start the app:**
   ```bash
   python app.py
   ```

5. Open your browser and go to:
   ```text
   http://127.0.0.1:5000
   ```

---

### 🐳 Run with Docker

If you have Docker installed, you can run everything (including Python, FFmpeg, and AI dependencies) with two commands without installing anything else:

```bash
docker build -t omnishift .
docker run -d -p 5000:5000 --name omnishift omnishift
```
Then visit `http://localhost:5000` in your browser.

---

## 📄 License

This project is open-source and free to use under the MIT License.
