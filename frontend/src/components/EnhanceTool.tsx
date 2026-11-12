import React, { useState, useRef, useEffect } from "react";
import { enhanceImage } from "../api/client";
import type { EnhanceMode } from "../types";
import {
  Plus,
  Trash2,
  X,
  CheckCircle2,
  ArrowRight,
  Image as ImageIcon,
  Sliders,
  ChevronDown,
  RefreshCw,
} from "lucide-react";

const DEFAULT_OUTPUT_FORMAT = "PNG";
const MAXIMUM_FILES_LIMIT = 5;
const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i;

const ENHANCEMENT_PRESETS = [
  "Full (Sharpen + Contrast + Color)",
  "Sharpen Edges Only",
  "Boost Contrast",
  "Enhance Color Vibrance",
];

const OUTPUT_FORMATS = ["PNG", "JPG", "WEBP"];

interface FileItem {
  id: string;
  file: File;
  name: string;
  sizeMB: number;
  status: "ready" | "processing" | "completed" | "done-local" | "error";
}

interface EnhanceToolProps {
  onBusyChange?: (busy: boolean) => void;
}

function isSupportedImageFile(file: File): boolean {
  if (file.type && file.type.startsWith("image/")) {
    return true;
  }
  return IMAGE_EXTENSION_REGEX.test(file.name);
}

export const EnhanceTool: React.FC<EnhanceToolProps> = ({ onBusyChange }) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>(ENHANCEMENT_PRESETS[0]);
  const [outputFormat, setOutputFormat] = useState<string>(DEFAULT_OUTPUT_FORMAT);
  const [isPresetOpen, setIsPresetOpen] = useState<boolean>(false);
  const [isFormatOpen, setIsFormatOpen] = useState<boolean>(false);
  const [isEnhancing, setIsEnhancing] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetRef = useRef<HTMLDivElement>(null);
  const formatRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef<number>(0);
  const isEnhancingRef = useRef<boolean>(false);

  useEffect(() => {
    onBusyChange?.(isEnhancing);
  }, [isEnhancing, onBusyChange]);

  useEffect(() => {
    return () => {
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (presetRef.current && !presetRef.current.contains(event.target as Node)) {
        setIsPresetOpen(false);
      }
      if (formatRef.current && !formatRef.current.contains(event.target as Node)) {
        setIsFormatOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const totalMB = files.reduce((acc, curr) => acc + curr.sizeMB, 0).toFixed(2);

  const getModeKey = (preset: string): EnhanceMode => {
    if (preset.includes("Sharpen")) return "sharpen";
    if (preset.includes("Contrast")) return "contrast";
    if (preset.includes("Color")) return "color";
    return "full";
  };

  const addFiles = (incomingFiles: File[]) => {
    const imageFiles = incomingFiles.filter(isSupportedImageFile);
    if (imageFiles.length === 0) return;

    const batchTimestamp = Date.now();
    const mappedItems: FileItem[] = imageFiles.map((file, idx) => ({
      id: `${batchTimestamp}-${idx}-${Math.random().toString(36).substring(2, 9)}`,
      file,
      name: file.name,
      sizeMB: Number((file.size / (1024 * 1024)).toFixed(2)),
      status: "ready",
    }));

    setFiles((prev) => {
      const remainingSlots = MAXIMUM_FILES_LIMIT - prev.length;
      if (remainingSlots <= 0) return prev;
      return [...prev, ...mappedItems.slice(0, remainingSlots)];
    });
  };

  const addFilesRef = useRef(addFiles);
  useEffect(() => {
    addFilesRef.current = addFiles;
  });

  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean =>
      Boolean(e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes("Files"));

    const onWindowDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      if (dragDepthRef.current === 1) {
        setIsDragging(true);
      }
    };

    const onWindowDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onWindowDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragging(false);
      }
    };

    const onWindowDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const droppedList = e.dataTransfer?.files;
      if (droppedList && droppedList.length > 0) {
        addFilesRef.current(Array.from(droppedList));
      }
    };

    window.addEventListener("dragenter", onWindowDragEnter);
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("drop", onWindowDrop);

    return () => {
      window.removeEventListener("dragenter", onWindowDragEnter);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("dragleave", onWindowDragLeave);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, []);

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleEnhanceAll = async () => {
    if (files.length === 0 || isEnhancing || isEnhancingRef.current) return;
    isEnhancingRef.current = true;
    setIsEnhancing(true);

    const mode = getModeKey(selectedPreset);

    try {
      for (const item of files) {
        if (item.status === "completed" || item.status === "done-local") continue;
        setFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, status: "processing" } : f)),
        );

        try {
          const source = await enhanceImage(item.file, { mode, factor: 1.0 });
          const nextStatus = source === "local" ? "done-local" : "completed";
          setFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, status: nextStatus } : f)),
          );
        } catch {
          setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: "error" } : f)));
        }
      }
    } finally {
      isEnhancingRef.current = false;
      setIsEnhancing(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedList = event.target.files;
    if (selectedList && selectedList.length > 0) {
      const copiedFiles = Array.from(selectedList);
      addFiles(copiedFiles);
    }
    event.target.value = "";
  };

  const isAtCapacity = files.length >= MAXIMUM_FILES_LIMIT;

  return (
    <div className="tool-view">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        multiple
        accept="image/*"
        className="hidden"
      />

      {files.length === 0 ? (
        <div
          className={`atelier-dropzone ${isDragging ? "dragging" : ""}`}
          onClick={openFilePicker}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openFilePicker();
            }
          }}
        >
          <div className="atelier-drop-icon">
            <Sliders size={26} strokeWidth={1.75} />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.375rem",
              alignItems: "center",
            }}
          >
            <h3 className="atelier-drop-title">
              {isDragging
                ? "Release anywhere to add images"
                : "Drop images to balance tone and clarity"}
            </h3>
            <p className="atelier-drop-hint">
              Enhance up to {MAXIMUM_FILES_LIMIT} images at once with crisp detail and natural color
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openFilePicker();
            }}
            className="btn-primary"
          >
            Choose Images
          </button>
        </div>
      ) : (
        <div
          className="queue-wrapper"
          style={
            isDragging
              ? {
                  borderColor: "var(--accent-amber)",
                  boxShadow: "0 0 0 3px var(--accent-amber-soft)",
                }
              : undefined
          }
        >
          {/* Header Summary */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "1.125rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                {files.length}/{MAXIMUM_FILES_LIMIT} Image{files.length !== 1 ? "s" : ""} Ready
              </h2>
              <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                Total batch size: {totalMB} MB {isDragging ? "• Release anywhere to add more" : ""}
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={openFilePicker}
                disabled={isAtCapacity || isEnhancing}
                className="btn-secondary"
                style={{
                  width: "44px",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-label="Add images"
                title={isAtCapacity ? `Maximum ${MAXIMUM_FILES_LIMIT} files reached` : "Add images"}
              >
                <Plus size={18} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!isEnhancingRef.current) setFiles([]);
                }}
                disabled={isEnhancing}
                className="btn-secondary"
                style={{
                  width: "44px",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-label="Clear all images"
                title="Clear all images"
              >
                <Trash2 size={18} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          {/* Preset Dropdown */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              position: "relative",
            }}
            ref={presetRef}
          >
            <label
              htmlFor="enhance-preset-trigger"
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-secondary)",
              }}
            >
              Enhancement Preset
            </label>

            <button
              id="enhance-preset-trigger"
              type="button"
              disabled={isEnhancing}
              aria-haspopup="listbox"
              aria-expanded={isPresetOpen}
              onClick={() => setIsPresetOpen((prev) => !prev)}
              className="btn-secondary"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 1rem",
                textAlign: "left",
              }}
            >
              <span>{selectedPreset}</span>
              <ChevronDown
                size={16}
                strokeWidth={1.75}
                style={{
                  color: "var(--text-muted)",
                  transform: isPresetOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.2s ease",
                }}
              />
            </button>

            {isPresetOpen && (
              <div
                role="listbox"
                className="atelier-popover from-top"
                style={{
                  position: "absolute",
                  zIndex: 30,
                  left: 0,
                  right: 0,
                  top: "calc(100% + 6px)",
                  backgroundColor: "var(--bg-card)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-card)",
                  overflow: "hidden",
                  padding: "0.25rem",
                }}
              >
                {ENHANCEMENT_PRESETS.map((preset) => {
                  const isSelected = selectedPreset === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setSelectedPreset(preset);
                        setIsPresetOpen(false);
                      }}
                      style={{
                        width: "100%",
                        minHeight: "44px",
                        textAlign: "left",
                        padding: "0 0.875rem",
                        borderRadius: "var(--radius-sm)",
                        border: "none",
                        backgroundColor: isSelected ? "var(--accent-amber-soft)" : "transparent",
                        color: isSelected ? "var(--accent-amber)" : "var(--text-primary)",
                        fontSize: "0.875rem",
                        fontWeight: isSelected ? 700 : 500,
                        cursor: "pointer",
                      }}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Compact Studio Ledger (Fixed height with internal scroll at 5+ items) */}
          <div className="studio-ledger" role="list" aria-label="Enhance file queue">
            {files.map((file) => (
              <div key={file.id} className="studio-ledger-row" role="listitem">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    minWidth: 0,
                    flex: "1 1 180px",
                  }}
                >
                  <div className="queue-file-badge">
                    <ImageIcon size={18} strokeWidth={1.75} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: "0.875rem",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {file.name}
                    </p>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {file.sizeMB} MB
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                  {file.status === "processing" ? (
                    <span className="status-pill processing">
                      <RefreshCw size={13} strokeWidth={1.75} className="animate-spin shrink-0" />
                      Enhancing
                    </span>
                  ) : file.status === "completed" ? (
                    <span className="status-pill completed">
                      <CheckCircle2 size={13} strokeWidth={1.75} className="shrink-0" />
                      Done
                    </span>
                  ) : file.status === "done-local" ? (
                    <span className="status-pill completed">
                      <CheckCircle2 size={13} strokeWidth={1.75} className="shrink-0" />
                      Done (Local)
                    </span>
                  ) : file.status === "error" ? (
                    <span className="status-pill error">Failed</span>
                  ) : (
                    <span className="status-pill">Ready</span>
                  )}

                  <button
                    type="button"
                    disabled={isEnhancing}
                    onClick={() => {
                      if (!isEnhancingRef.current) {
                        setFiles((prev) => prev.filter((item) => item.id !== file.id));
                      }
                    }}
                    style={{
                      width: "44px",
                      height: "44px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      background: "transparent",
                      color: "var(--text-muted)",
                      borderRadius: "var(--radius-sm)",
                      cursor: isEnhancing ? "not-allowed" : "pointer",
                      opacity: isEnhancing ? 0.45 : 1,
                    }}
                    aria-label={`Remove ${file.name}`}
                    title={`Remove ${file.name}`}
                  >
                    <X size={17} strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Footer Controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              flexWrap: "wrap",
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
                htmlFor="enhance-format-trigger"
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                }}
              >
                Save all as:
              </label>

              <div style={{ position: "relative" }}>
                <button
                  id="enhance-format-trigger"
                  type="button"
                  disabled={isEnhancing}
                  aria-haspopup="listbox"
                  aria-expanded={isFormatOpen}
                  onClick={() => setIsFormatOpen((prev) => !prev)}
                  className="btn-secondary"
                  style={{
                    width: "7.5rem",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 0.875rem",
                  }}
                >
                  <span>{outputFormat}</span>
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
                      width: "7.5rem",
                      backgroundColor: "var(--bg-card)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: "var(--radius-md)",
                      boxShadow: "var(--shadow-card)",
                      zIndex: 30,
                      overflow: "hidden",
                      padding: "0.25rem",
                    }}
                  >
                    {OUTPUT_FORMATS.map((fmt) => {
                      const isSelected = outputFormat === fmt;
                      return (
                        <button
                          key={fmt}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            setOutputFormat(fmt);
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
              onClick={handleEnhanceAll}
              disabled={isEnhancing || files.length === 0}
              className="btn-primary"
            >
              <span>{isEnhancing ? "Enhancing..." : "Enhance Files"}</span>
              <ArrowRight size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhanceTool;
