import { useState, useEffect } from "react";
import {
  RefreshCw,
  Layers,
  Maximize2,
  Sparkles,
  Sliders,
  Download,
  ShieldCheck,
  Zap,
  Cpu,
  Plus,
  Minus,
} from "lucide-react";
import { Header } from "./components/Header";
import { ConvertTool } from "./components/ConvertTool";
import { RemoveBgTool } from "./components/RemoveBgTool";
import { UpscaleTool } from "./components/UpscaleTool";
import { AiSuperResTool } from "./components/AiSuperResTool";
import { EnhanceTool } from "./components/EnhanceTool";
import { DownloadTool } from "./components/DownloadTool";

type ToolTab = "convert" | "remove-bg" | "upscale" | "ai-upscale" | "enhance" | "download";
type ThemeMode = "light" | "dark";

interface ToolConfig {
  id: ToolTab;
  label: string;
  shortDesc: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}

const TOOLS: ToolConfig[] = [
  {
    id: "convert",
    label: "Convert",
    shortDesc: "WEBP, PNG, JPG & more",
    title: "Format Conversion",
    subtitle: "Switch image formats cleanly in batch without losing sharpness.",
    icon: <RefreshCw size={18} strokeWidth={1.75} />,
  },
  {
    id: "remove-bg",
    label: "Remove BG",
    shortDesc: "Clean alpha cutouts",
    title: "Background Removal",
    subtitle: "Isolate subjects with clean, transparent edges in seconds.",
    icon: <Layers size={18} strokeWidth={1.75} />,
  },
  {
    id: "upscale",
    label: "Standard Upscale",
    shortDesc: "Fast 2x to 4x resize",
    title: "Standard Upscale",
    subtitle: "Enlarge images quickly using precision pixel resampling.",
    icon: <Maximize2 size={18} strokeWidth={1.75} />,
  },
  {
    id: "ai-upscale",
    label: "AI Super-Res",
    shortDesc: "Neural edge rebuild",
    title: "AI Super-Resolution",
    subtitle: "Reconstruct fine textures and crisp edges when scaling up.",
    icon: <Sparkles size={18} strokeWidth={1.75} />,
  },
  {
    id: "enhance",
    label: "Enhance",
    shortDesc: "Tone, light & clarity",
    title: "Image Enhancement",
    subtitle: "Balance contrast, sharpness, and natural color vibrance.",
    icon: <Sliders size={18} strokeWidth={1.75} />,
  },
  {
    id: "download",
    label: "Link Downloader",
    shortDesc: "MP4 video or MP3 audio",
    title: "Media Link Downloader",
    subtitle: "Fetch clean video or audio streams directly from a link.",
    icon: <Download size={18} strokeWidth={1.75} />,
  },
];

const FAQ_ITEMS = [
  {
    question: "Can I download MP3 audio files directly from video links?",
    answer:
      "Yes. Paste your link in the Link Downloader tab, choose MP3 (Audio) from the format menu, and FileCraft extracts the audio track in memory.",
  },
  {
    question: "What video resolutions are available for MP4 downloads?",
    answer:
      "You can save clean MP4 video files in 1080p Full HD or 720p HD depending on the source stream quality.",
  },
  {
    question: "What website video links are supported?",
    answer:
      "Public links from major video platforms including YouTube, Vimeo, and TikTok are supported.",
  },
  {
    question: "What is the file size limit for video downloads?",
    answer:
      "Downloads are processed in volatile memory without writing permanent files to disk, keeping transfers fast and lightweight for standard clips and tracks.",
  },
  {
    question: "How does AI Super-Resolution differ from Standard Upscaling?",
    answer:
      "Standard Upscale uses mathematical Lanczos or Bicubic resampling for instant resizing, while AI Super-Resolution uses neural reconstruction to rebuild fine edge detail.",
  },
];

export function App() {
  const [activeTab, setActiveTab] = useState<ToolTab>("convert");
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return localStorage.getItem("filecraft-theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("filecraft-theme", theme);
    } catch {
      /* storage unavailable (private mode / blocked) - theme still applies */
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const currentTool = TOOLS.find((t) => t.id === activeTab) || TOOLS[0];

  const renderActiveTool = () => {
    switch (activeTab) {
      case "convert":
        return <ConvertTool />;
      case "remove-bg":
        return <RemoveBgTool />;
      case "upscale":
        return <UpscaleTool />;
      case "ai-upscale":
        return <AiSuperResTool />;
      case "enhance":
        return <EnhanceTool />;
      case "download":
        return <DownloadTool />;
      default:
        return <ConvertTool />;
    }
  };

  return (
    <div className="workspace-container">
      <Header theme={theme} onToggleTheme={toggleTheme} />

      {/* Atelier Studio Split */}
      <main className="studio-layout">
        <aside className="tool-rail" aria-label="Atelier tools">
          <div className="rail-section-label">Atelier Tools</div>
          {TOOLS.map((tool) => {
            const isActive = activeTab === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setActiveTab(tool.id)}
                className={`rail-btn ${isActive ? "active" : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="rail-btn-icon">{tool.icon}</span>
                <span className="rail-btn-copy">
                  <span className="rail-btn-title">{tool.label}</span>
                  <span className="rail-btn-sub">{tool.shortDesc}</span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="studio-stage" aria-live="polite">
          <div className="stage-header">
            <h1 className="stage-title">{currentTool.title}</h1>
            <p className="stage-subtitle">{currentTool.subtitle}</p>
          </div>

          {renderActiveTool()}
        </section>
      </main>

      {/* Open Trust Strip (Borderless for Breathing Room) */}
      <section className="features-grid" aria-label="Studio guarantees">
        <div className="feature-card">
          <div className="queue-file-badge">
            <ShieldCheck size={18} strokeWidth={1.75} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <h2
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.9375rem",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              Private & In-Memory
            </h2>
            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Processed directly in volatile memory with zero cloud exposure.
            </p>
          </div>
        </div>

        <div className="feature-card">
          <div className="queue-file-badge">
            <Zap size={18} strokeWidth={1.75} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <h2
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.9375rem",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              Instant Purge
            </h2>
            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Working buffers are wiped clean the moment your file downloads.
            </p>
          </div>
        </div>

        <div className="feature-card">
          <div className="queue-file-badge">
            <Cpu size={18} strokeWidth={1.75} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <h2
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.9375rem",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              Neural Reconstruction
            </h2>
            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Dedicated OpenCV LapSRN models for crisp, artifact-free scaling.
            </p>
          </div>
        </div>
      </section>

      {/* Airy Editorial FAQ */}
      <section id="faq" className="faq-section" aria-labelledby="faq-heading" tabIndex={-1}>
        <h2
          id="faq-heading"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: "0.5rem",
          }}
        >
          Frequently Asked Questions
        </h2>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openFaqIndex === index;
            return (
              <div
                key={item.question}
                style={{
                  borderBottom: "1px solid var(--border-color)",
                  padding: "0.25rem 0",
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${index}`}
                  style={{
                    width: "100%",
                    minHeight: "52px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                    padding: "0.875rem 0.25rem",
                    background: "none",
                    border: "none",
                    textAlign: "left",
                    fontFamily: "var(--font-body)",
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <span>{item.question}</span>
                  <span style={{ color: "var(--accent-amber)", flexShrink: 0 }}>
                    {isOpen ? (
                      <Minus size={18} strokeWidth={1.75} />
                    ) : (
                      <Plus size={18} strokeWidth={1.75} />
                    )}
                  </span>
                </button>

                {isOpen && (
                  <p
                    id={`faq-answer-${index}`}
                    style={{
                      padding: "0 0.25rem 1.25rem",
                      fontSize: "0.9375rem",
                      color: "var(--text-secondary)",
                      lineHeight: 1.6,
                      maxWidth: "64ch",
                    }}
                  >
                    {item.answer}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <footer
        style={{
          textAlign: "center",
          fontSize: "0.8125rem",
          color: "var(--text-muted)",
          paddingTop: "1rem",
        }}
      >
        © 2026 FileCraft. Built with FastAPI, Pillow, OpenCV & yt-dlp.
      </footer>
    </div>
  );
}

export default App;
