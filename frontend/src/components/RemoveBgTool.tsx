import { useState, useRef, useEffect } from "react";
import { Image as ImageIcon, Download, RefreshCw, Layers } from "lucide-react";
import { removeBackground } from "../api/client";

interface RemoveBgToolProps {
  onBusyChange?: (busy: boolean) => void;
}

export function RemoveBgTool({ onBusyChange }: RemoveBgToolProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef<number>(0);
  const isProcessingRef = useRef<boolean>(false);

  useEffect(() => {
    onBusyChange?.(isProcessing);
  }, [isProcessing, onBusyChange]);

  useEffect(() => {
    return () => {
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  const resetState = () => {
    if (isProcessingRef.current) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (processedUrl) URL.revokeObjectURL(processedUrl);
    setFile(null);
    setPreviewUrl(null);
    setProcessedBlob(null);
    setProcessedUrl(null);
    setError(null);
  };

  const handleFileSelect = (selectedFile: File) => {
    if (isProcessingRef.current) return;
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

  const handleFileSelectRef = useRef(handleFileSelect);
  useEffect(() => {
    handleFileSelectRef.current = handleFileSelect;
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
      if (isProcessingRef.current) return;
      const droppedFile = e.dataTransfer?.files?.[0];
      if (droppedFile) {
        handleFileSelectRef.current(droppedFile);
        e.dataTransfer.clearData();
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

  const handleProcess = async () => {
    if (!file || isProcessing || isProcessingRef.current) return;
    isProcessingRef.current = true;
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
      isProcessingRef.current = false;
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
            {isDragging ? "Release anywhere to load image" : "Drop an image to cut out the subject"}
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
            {isDragging
              ? "Release anywhere to replace image"
              : "Drop another image anytime to replace"}
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={resetState}
            disabled={isProcessing}
            className="btn-secondary"
          >
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
              position: "relative",
            }}
          >
            {processedUrl ? (
              <img
                src={processedUrl}
                alt="No background result preview"
                className="cutout-reveal"
                style={{ width: "100%", maxHeight: "380px", objectFit: "contain" }}
              />
            ) : isProcessing ? (
              <div
                aria-busy="true"
                aria-label="Isolating subject in memory"
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <div className="fc-skeleton-block" style={{ width: "100%", height: "168px" }} />
                <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                  Isolating subject in memory...
                </span>
              </div>
            ) : (
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                Click "Remove Background" to preview cutout
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RemoveBgTool;
