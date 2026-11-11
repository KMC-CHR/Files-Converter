import React, { useState, useRef, useEffect } from "react";
import { convertImage } from "../api/client";
import type { TargetFormat } from "../types";
import {
  Plus,
  Trash2,
  X,
  CheckCircle2,
  ArrowRight,
  Image as ImageIcon,
  RefreshCw,
  ChevronDown,
} from "lucide-react";

const DEFAULT_TARGET_FORMAT = "WEBP";
const MAXIMUM_FILES_LIMIT = 10;
const CONVERT_FORMATS = ["WEBP", "PNG", "JPG"];
const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i;

interface FileItem {
  id: string;
  file: File;
  name: string;
  sizeMB: number;
  status: "ready" | "processing" | "completed" | "error";
}

function isSupportedImageFile(file: File): boolean {
  if (file.type && file.type.startsWith("image/")) {
    return true;
  }
  return IMAGE_EXTENSION_REGEX.test(file.name);
}

export const ConvertTool: React.FC = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [targetFormat, setTargetFormat] = useState<string>(DEFAULT_TARGET_FORMAT);
  const [isFormatOpen, setIsFormatOpen] = useState<boolean>(false);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (formatRef.current && !formatRef.current.contains(event.target as Node)) {
        setIsFormatOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const totalMB = files.reduce((acc, curr) => acc + curr.sizeMB, 0).toFixed(2);

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

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const droppedList = event.dataTransfer.files;
    if (!droppedList || droppedList.length === 0) return;

    const copiedFiles = Array.from(droppedList);
    addFiles(copiedFiles);
  };

  const handleConvertAll = async () => {
    if (files.length === 0 || isConverting) return;
    setIsConverting(true);

    const targetFmt = targetFormat.toLowerCase() as TargetFormat;

    for (const item of files) {
      if (item.status === "completed") continue;
      setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: "processing" } : f)));

      try {
        await convertImage(item.file, { format: targetFmt, quality: 95 });
        setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: "completed" } : f)));
      } catch {
        setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: "error" } : f)));
      }
    }

    setIsConverting(false);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedList = event.target.files;
    if (selectedList && selectedList.length > 0) {
      const copiedFiles = Array.from(selectedList);
      addFiles(copiedFiles);
    }
    event.target.value = "";
  };

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
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
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
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
            <RefreshCw size={26} strokeWidth={1.75} />
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
              {isDragging ? "Release to add images" : "Drop images to switch format"}
            </h3>
            <p className="atelier-drop-hint">
              Convert up to {MAXIMUM_FILES_LIMIT} images at once to WEBP, PNG, or JPG
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
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={
            isDragging
              ? {
                  borderColor: "var(--accent-amber)",
                  boxShadow: "0 0 0 3px var(--accent-amber-soft)",
                }
              : undefined
          }
        >
          {/* Header Bar */}
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
                Total batch size: {totalMB} MB {isDragging ? "• Release to add more" : ""}
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={openFilePicker}
                disabled={isAtCapacity}
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
                onClick={() => setFiles([])}
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

          {/* Compact Studio Ledger (Fixed height with internal scroll at 5+ items) */}
          <div className="studio-ledger" role="list" aria-label="Convert file queue">
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
                      Converting
                    </span>
                  ) : file.status === "completed" ? (
                    <span className="status-pill completed">
                      <CheckCircle2 size={13} strokeWidth={1.75} className="shrink-0" />
                      Done
                    </span>
                  ) : file.status === "error" ? (
                    <span className="status-pill error">Failed</span>
                  ) : (
                    <span className="status-pill">Ready</span>
                  )}

                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((item) => item.id !== file.id))}
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
                      cursor: "pointer",
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
                htmlFor="convert-format-trigger"
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
                  id="convert-format-trigger"
                  type="button"
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
                  <span>{targetFormat}</span>
                  <ChevronDown
                    size={16}
                    strokeWidth={1.75}
                    style={{ color: "var(--text-muted)" }}
                  />
                </button>

                {isFormatOpen && (
                  <div
                    role="listbox"
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
                    {CONVERT_FORMATS.map((fmt) => {
                      const isSelected = targetFormat === fmt;
                      return (
                        <button
                          key={fmt}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            setTargetFormat(fmt);
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
              onClick={handleConvertAll}
              disabled={isConverting || files.length === 0}
              className="btn-primary"
            >
              <span>{isConverting ? "Converting..." : "Convert Files"}</span>
              <ArrowRight size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConvertTool;
