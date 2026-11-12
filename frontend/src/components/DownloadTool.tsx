import React, { useState, useRef, useEffect } from "react";
import { downloadMedia } from "../api/client";
import type { DownloadType, DownloadQuality } from "../types";
import { Link2, Download, Video, ChevronDown, X, RefreshCw } from "lucide-react";

const DOWNLOAD_FORMATS = ["MP4 (1080p)", "MP4 (720p)", "MP3 (Audio)", "WEBM"];

interface DownloadItem {
  id: string;
  url: string;
  title: string;
  duration: string;
  status: "idle" | "fetching" | "ready";
}

interface DownloadToolProps {
  onBusyChange?: (busy: boolean) => void;
}

function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export const DownloadTool: React.FC<DownloadToolProps> = ({ onBusyChange }) => {
  const [urlInput, setUrlInput] = useState<string>("");
  const [format, setFormat] = useState<string>(DOWNLOAD_FORMATS[0]);
  const [isFormatOpen, setIsFormatOpen] = useState<boolean>(false);
  const [activeMedia, setActiveMedia] = useState<DownloadItem | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const formatRef = useRef<HTMLDivElement>(null);
  const isDownloadingRef = useRef<boolean>(false);

  useEffect(() => {
    onBusyChange?.(isDownloading);
  }, [isDownloading, onBusyChange]);

  useEffect(() => {
    return () => {
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (formatRef.current && !formatRef.current.contains(event.target as Node)) {
        setIsFormatOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFetchMedia = (e: React.FormEvent) => {
    e.preventDefault();
    if (isDownloadingRef.current) return;
    setDownloadError(null);

    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) return;

    if (!isValidHttpUrl(trimmedUrl)) {
      setDownloadError("Please enter a valid http:// or https:// media link.");
      return;
    }

    const cleanTitle = trimmedUrl.replace(/^https?:\/\//, "");
    const displayTitle = cleanTitle.length > 48 ? `${cleanTitle.substring(0, 48)}...` : cleanTitle;

    setActiveMedia({
      id: Date.now().toString(),
      url: trimmedUrl,
      title: displayTitle,
      duration: "Ready to download",
      status: "ready",
    });
  };

  const handleDownload = async () => {
    if (!activeMedia || isDownloading || isDownloadingRef.current) return;
    isDownloadingRef.current = true;
    setIsDownloading(true);
    setDownloadError(null);

    let type: DownloadType = "mp4";
    let quality: DownloadQuality = "1080";

    if (format.includes("MP3")) {
      type = "mp3";
      quality = "192";
    } else if (format.includes("720p")) {
      quality = "720";
    }

    try {
      await downloadMedia({
        url: activeMedia.url,
        type,
        quality,
      });
    } catch (err: unknown) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      isDownloadingRef.current = false;
      setIsDownloading(false);
    }
  };

  return (
    <div className="tool-view">
      <div className="queue-wrapper">
        {/* Input Form */}
        <form
          onSubmit={handleFetchMedia}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          <label
            htmlFor="media-url-input"
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-secondary)",
            }}
          >
            Media Link
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", width: "100%" }}>
            <div style={{ position: "relative", flex: "1 1 280px" }}>
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  paddingLeft: "0.875rem",
                  display: "flex",
                  alignItems: "center",
                  pointerEvents: "none",
                  color: "var(--text-muted)",
                }}
              >
                <Link2 size={18} strokeWidth={1.75} />
              </div>
              <input
                id="media-url-input"
                type="url"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={urlInput}
                disabled={isDownloading}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste link from YouTube, Vimeo, or TikTok..."
                style={{
                  width: "100%",
                  minHeight: "44px",
                  paddingLeft: "2.75rem",
                  paddingRight: "1rem",
                  backgroundColor: "var(--bg-card)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  fontFamily: "var(--font-body)",
                  fontSize: "0.9375rem",
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
            </div>
            <button
              type="submit"
              disabled={isDownloading}
              className="btn-primary"
              style={{ flexShrink: 0 }}
            >
              Fetch Link
            </button>
          </div>
        </form>

        {downloadError && !activeMedia && (
          <div
            role="alert"
            style={{
              padding: "0.875rem 1rem",
              backgroundColor: "var(--status-error-bg)",
              border: "1px solid var(--status-error-text)",
              borderRadius: "var(--radius-md)",
              color: "var(--status-error-text)",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            {downloadError}
          </div>
        )}

        {/* Empty State */}
        {!activeMedia && (
          <div className="atelier-dropzone" style={{ cursor: "default" }}>
            <div className="atelier-drop-icon">
              <Download size={26} strokeWidth={1.75} />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.375rem",
                alignItems: "center",
              }}
            >
              <h3 className="atelier-drop-title">Paste a link above to prepare your download</h3>
              <p className="atelier-drop-hint">
                Save clean MP4 video up to 1080p or extract MP3 audio directly in memory
              </p>
            </div>
          </div>
        )}

        {/* Fetched Result Card */}
        {activeMedia && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div className="queue-card">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  minWidth: 0,
                  flex: "1 1 200px",
                }}
              >
                <div className="queue-file-badge">
                  <Video size={20} strokeWidth={1.75} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: "0.9375rem",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      textOverflow: "ellipsis",
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {activeMedia.title}
                  </p>
                  <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                    Status: {isDownloading ? "Extracting in memory..." : activeMedia.duration}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={isDownloading}
                onClick={() => {
                  if (isDownloadingRef.current) return;
                  setActiveMedia(null);
                  setDownloadError(null);
                }}
                style={{
                  width: "44px",
                  height: "44px",
                  background: "none",
                  border: "none",
                  cursor: isDownloading ? "not-allowed" : "pointer",
                  opacity: isDownloading ? 0.45 : 1,
                  color: "var(--text-muted)",
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-label="Clear fetched link"
                title="Clear fetched link"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>

            {/* Controls Bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "1rem",
                paddingTop: "0.75rem",
                borderTop: "1px solid var(--border-color)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  position: "relative",
                }}
                ref={formatRef}
              >
                <label
                  htmlFor="download-format-trigger"
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Save as:
                </label>

                <div style={{ position: "relative" }}>
                  <button
                    id="download-format-trigger"
                    type="button"
                    disabled={isDownloading}
                    aria-haspopup="listbox"
                    aria-expanded={isFormatOpen}
                    onClick={() => setIsFormatOpen((prev) => !prev)}
                    className="btn-secondary"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "10.5rem",
                      padding: "0 0.875rem",
                    }}
                  >
                    <span>{format}</span>
                    <ChevronDown
                      size={16}
                      strokeWidth={1.75}
                      style={{ color: "var(--text-muted)" }}
                    />
                  </button>

                  {isFormatOpen && (
                    <div
                      role="listbox"
                      className="atelier-popover"
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 6px)",
                        left: 0,
                        width: "10.5rem",
                        backgroundColor: "var(--bg-card)",
                        border: "1px solid var(--border-strong)",
                        borderRadius: "var(--radius-md)",
                        boxShadow: "var(--shadow-card)",
                        zIndex: 30,
                        overflow: "hidden",
                        padding: "0.25rem",
                      }}
                    >
                      {DOWNLOAD_FORMATS.map((fmt) => {
                        const isSelected = format === fmt;
                        return (
                          <button
                            key={fmt}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              setFormat(fmt);
                              setIsFormatOpen(false);
                            }}
                            style={{
                              width: "100%",
                              minHeight: "40px",
                              textAlign: "left",
                              padding: "0 0.75rem",
                              borderRadius: "var(--radius-sm)",
                              border: "none",
                              backgroundColor: isSelected
                                ? "var(--accent-amber-soft)"
                                : "transparent",
                              color: isSelected ? "var(--accent-amber)" : "var(--text-primary)",
                              fontSize: "0.875rem",
                              fontWeight: isSelected ? 700 : 500,
                              cursor: "pointer",
                            }}
                          >
                            {fmt}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloading}
                className="btn-primary"
              >
                {isDownloading ? (
                  <RefreshCw size={16} strokeWidth={1.75} className="animate-spin shrink-0" />
                ) : (
                  <Download size={16} strokeWidth={1.75} />
                )}
                <span>{isDownloading ? "Downloading..." : "Download File"}</span>
              </button>
            </div>

            {downloadError && (
              <div
                role="alert"
                style={{
                  padding: "0.875rem 1rem",
                  backgroundColor: "var(--status-error-bg)",
                  border: "1px solid var(--status-error-text)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--status-error-text)",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                {downloadError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DownloadTool;
