import { useState, useRef } from "react";
import { Image as ImageIcon, Download, RefreshCw, Layers } from "lucide-react";
import { removeBackground } from "../api/client";

export function RemoveBgTool() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (processedUrl) URL.revokeObjectURL(processedUrl);
    setFile(null);
    setPreviewUrl(null);
    setProcessedBlob(null);
    setProcessedUrl(null);
    setError(null);
  };

  const handleFileSelect = (selectedFile: File) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(selectedFile.type)) {
      setError("Please select a valid image file (JPEG, PNG, or WebP).");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (processedUrl) URL.revokeObjectURL(processedUrl);

    setError(null);
    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setProcessedBlob(null);
    setProcessedUrl(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
      e.dataTransfer.clearData();
    }
  };

  const handleProcess = async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);

    try {
      const blob = await removeBackground(file);
      if (processedUrl) URL.revokeObjectURL(processedUrl);
      setProcessedBlob(blob);
      setProcessedUrl(URL.createObjectURL(blob));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Background removal failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!processedBlob || !file) return;
    const link = document.createElement("a");
    const url = URL.createObjectURL(processedBlob);
    link.href = url;

    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const nameWithoutExt = safeName.substring(0, safeName.lastIndexOf(".")) || safeName;

    link.download = `${nameWithoutExt}_no_bg.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!file) {
    return (
      <div
        className={`atelier-dropzone ${isDragging ? "dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            if (e.target.files?.[0]) {
              handleFileSelect(e.target.files[0]);
            }
            e.target.value = "";
          }}
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
        />
        <div className="atelier-drop-icon">
          <ImageIcon size={26} strokeWidth={1.75} />
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
            {isDragging ? "Release to load image" : "Drop an image to cut out the subject"}
          </h3>
          <p className="atelier-drop-hint">Supports JPEG, PNG, and WebP formats</p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          Choose Image
        </button>
      </div>
    );
  }

  return (
    <div
      className="queue-wrapper"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={
        isDragging
          ? { borderColor: "var(--accent-amber)", boxShadow: "0 0 0 3px var(--accent-amber-soft)" }
          : undefined
      }
    >
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file.name}
          </h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            Drop another image anytime to replace
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={resetState} className="btn-secondary">
            Change Image
          </button>

          {!processedBlob ? (
            <button
              type="button"
              onClick={handleProcess}
              disabled={isProcessing}
              className="btn-primary"
            >
              {isProcessing ? (
                <RefreshCw className="animate-spin" size={16} strokeWidth={1.75} />
              ) : (
                <Layers size={16} strokeWidth={1.75} />
              )}
              <span>{isProcessing ? "Removing..." : "Remove Background"}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDownload}
              className="btn-primary"
              style={{
                backgroundColor: "var(--status-success-text)",
                borderColor: "var(--status-success-text)",
                color: "#FFFFFC",
              }}
            >
              <Download size={16} strokeWidth={1.75} />
              <span>Download PNG</span>
            </button>
          )}
        </div>
      </div>

      {error && (
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
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "1.5rem",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-secondary)" }}>
            Original
          </span>
          <div
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
              backgroundColor: "var(--bg-card)",
              minHeight: "240px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Original preview"
                style={{ width: "100%", maxHeight: "380px", objectFit: "contain" }}
              />
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-secondary)" }}>
            Transparent Result
          </span>
          <div
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
              backgroundColor: "var(--bg-card)",
              backgroundImage: "radial-gradient(var(--border-strong) 1px, transparent 0)",
              backgroundSize: "12px 12px",
              minHeight: "240px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: processedUrl ? 0 : "1.5rem",
              textAlign: "center",
            }}
          >
            {processedUrl ? (
              <img
                src={processedUrl}
                alt="No background result preview"
                style={{ width: "100%", maxHeight: "380px", objectFit: "contain" }}
              />
            ) : (
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                {isProcessing
                  ? "Isolating subject in memory..."
                  : 'Click "Remove Background" to preview cutout'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RemoveBgTool;
