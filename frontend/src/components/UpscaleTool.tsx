import React, { useState, useRef } from "react";
import {
  FileUp,
  Scaling,
  Plus,
  Trash2,
  X,
  Image as ImageIcon,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { upscaleImage } from "../api/client";
import type { TargetFormat } from "../types";

type ResolutionOption = "720p" | "1080p" | "1440p" | "2160p";
type AlgorithmOption = "lanczos" | "bicubic" | "bilinear";

const MAXIMUM_FILES_LIMIT = 10;
const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i;

interface QueueItem {
  id: string;
  file: File;
  resolution: ResolutionOption;
  algorithm: AlgorithmOption;
  format: TargetFormat;
  status: "ready" | "processing" | "done" | "error";
}

function isSupportedImageFile(file: File): boolean {
  if (file.type && file.type.startsWith("image/")) {
    return true;
  }
  return IMAGE_EXTENSION_REGEX.test(file.name);
}

export const UpscaleTool = () => {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [globalResolution, setGlobalResolution] = useState<ResolutionOption>("1080p");
  const [globalAlgorithm, setGlobalAlgorithm] = useState<AlgorithmOption>("lanczos");
  const [globalFormat, setGlobalFormat] = useState<TargetFormat>("png");
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incomingFiles: File[]) => {
    const imageFiles = incomingFiles.filter(isSupportedImageFile);
    if (imageFiles.length === 0) return;

    const batchTimestamp = Date.now();
    const mappedItems: QueueItem[] = imageFiles.map((file, idx) => ({
      id: `${batchTimestamp}-${idx}-${Math.random().toString(36).substring(2, 9)}`,
      file,
      resolution: globalResolution,
      algorithm: globalAlgorithm,
      format: globalFormat,
      status: "ready",
    }));

    setQueue((prev) => {
      const remainingSlots = MAXIMUM_FILES_LIMIT - prev.length;
      if (remainingSlots <= 0) return prev;
      return [...prev, ...mappedItems.slice(0, remainingSlots)];
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedList = e.target.files;
    if (selectedList && selectedList.length > 0) {
      const copiedFiles = Array.from(selectedList);
      addFiles(copiedFiles);
    }
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedList = e.dataTransfer.files;
    if (!droppedList || droppedList.length === 0) return;

    const copiedFiles = Array.from(droppedList);
    addFiles(copiedFiles);
  };

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleGlobalResolutionChange = (res: ResolutionOption) => {
    setGlobalResolution(res);
    setQueue((prev) => prev.map((item) => ({ ...item, resolution: res })));
  };

  const handleGlobalAlgorithmChange = (alg: AlgorithmOption) => {
    setGlobalAlgorithm(alg);
    setQueue((prev) => prev.map((item) => ({ ...item, algorithm: alg })));
  };

  const handleGlobalFormatChange = (fmt: TargetFormat) => {
    setGlobalFormat(fmt);
    setQueue((prev) => prev.map((item) => ({ ...item, format: fmt })));
  };

  const removeItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const clearQueue = () => {
    setQueue([]);
  };

  const calculateTotalSize = () => {
    const totalBytes = queue.reduce((acc, item) => acc + item.file.size, 0);
    return (totalBytes / (1024 * 1024)).toFixed(2);
  };

  const processQueue = async () => {
    if (queue.length === 0 || isProcessing) return;
    setIsProcessing(true);

    for (const item of queue) {
      if (item.status === "done") continue;

      setQueue((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "processing" } : i)));

      try {
        await upscaleImage(item.file, {
          target_res: item.resolution,
          filter: item.algorithm,
        });
        setQueue((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "done" } : i)));
      } catch {
        setQueue((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "error" } : i)));
      }
    }

    setIsProcessing(false);
  };

  const isAtCapacity = queue.length >= MAXIMUM_FILES_LIMIT;

  return (
    <div className="tool-view">
      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {queue.length === 0 ? (
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
            <FileUp size={26} strokeWidth={1.75} />
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
              {isDragging ? "Release to add images" : "Drop images to enlarge cleanly"}
            </h3>
            <p className="atelier-drop-hint">
              Enlarge up to {MAXIMUM_FILES_LIMIT} images at once while keeping edges crisp (up to
              4K)
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              openFilePicker();
            }}
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
          {/* Header Summary */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
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
                {queue.length}/{MAXIMUM_FILES_LIMIT} Image{queue.length !== 1 ? "s" : ""} Ready
              </h2>
              <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                Total batch size: {calculateTotalSize()} MB{" "}
                {isDragging ? "• Release to add more" : ""}
              </p>
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
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
                onClick={clearQueue}
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

          {/* Global Configuration Controls */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "0.875rem",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <label
                htmlFor="upscale-res-select"
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-secondary)",
                }}
              >
                Target Resolution
              </label>
              <select
                id="upscale-res-select"
                className="native-styled-select"
                value={globalResolution}
                onChange={(e) => handleGlobalResolutionChange(e.target.value as ResolutionOption)}
                style={{ width: "100%" }}
              >
                <option value="720p">720p (HD)</option>
                <option value="1080p">1080p (Full HD)</option>
                <option value="1440p">1440p (2K)</option>
                <option value="2160p">2160p (4K)</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <label
                htmlFor="upscale-alg-select"
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-secondary)",
                }}
              >
                Resampling Method
              </label>
              <select
                id="upscale-alg-select"
                className="native-styled-select"
                value={globalAlgorithm}
                onChange={(e) => handleGlobalAlgorithmChange(e.target.value as AlgorithmOption)}
                style={{ width: "100%" }}
              >
                <option value="lanczos">Lanczos (Crisp Edges)</option>
                <option value="bicubic">Bicubic (Smooth Gradients)</option>
                <option value="bilinear">Bilinear (Fastest)</option>
              </select>
            </div>
          </div>

          {/* Compact Studio Ledger (Fixed height with internal scroll at 5+ items) */}
          <div className="studio-ledger" role="list" aria-label="Upscale file queue">
            {queue.map((item) => (
              <div key={item.id} className="studio-ledger-row" role="listitem">
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
                        fontWeight: 600,
                        fontSize: "0.875rem",
                        color: "var(--text-primary)",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.file.name}
                    </p>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {(item.file.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "0.625rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {item.status === "processing" ? (
                    <span className="status-pill processing">
                      <RefreshCw size={13} strokeWidth={1.75} className="animate-spin shrink-0" />
                      Upscaling
                    </span>
                  ) : item.status === "done" ? (
                    <span className="status-pill completed">
                      <CheckCircle2 size={13} strokeWidth={1.75} className="shrink-0" />
                      Done
                    </span>
                  ) : item.status === "error" ? (
                    <span className="status-pill error">Failed</span>
                  ) : (
                    <span className="status-pill">Ready</span>
                  )}

                  <select
                    aria-label={`Format for ${item.file.name}`}
                    className="native-styled-select"
                    style={{ minHeight: "38px", fontSize: "0.8125rem" }}
                    value={item.format}
                    onChange={(e) => {
                      const fmt = e.target.value as TargetFormat;
                      setQueue((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, format: fmt } : i)),
                      );
                    }}
                  >
                    <option value="png">PNG</option>
                    <option value="jpg">JPG</option>
                    <option value="webp">WEBP</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    style={{
                      width: "44px",
                      height: "44px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      borderRadius: "var(--radius-sm)",
                    }}
                    aria-label={`Remove ${item.file.name}`}
                    title={`Remove ${item.file.name}`}
                  >
                    <X size={17} strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom Action Bar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "1rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <label
                htmlFor="upscale-global-format"
                style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-secondary)" }}
              >
                Save all as:
              </label>
              <select
                id="upscale-global-format"
                className="native-styled-select"
                value={globalFormat}
                onChange={(e) => handleGlobalFormatChange(e.target.value as TargetFormat)}
              >
                <option value="png">PNG</option>
                <option value="jpg">JPG</option>
                <option value="webp">WEBP</option>
              </select>
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={processQueue}
              disabled={isProcessing || queue.length === 0}
            >
              <span>{isProcessing ? "Upscaling..." : "Upscale Files"}</span>
              <Scaling size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpscaleTool;
