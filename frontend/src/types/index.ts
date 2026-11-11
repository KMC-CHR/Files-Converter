export type TabType =
  | "convert"
  | "remove-bg"
  | "upscale"
  | "ai-upscale"
  | "enhance"
  | "video-download";

export type ResolutionPreset = 0 | 720 | 1080;

export type QualityPreset = "u2net" | "isnet-general-use";

export type TargetFormat = "webp" | "png" | "jpg";

export type UpscaleScale = 2 | 4;

export type UpscaleResolution = "720p" | "1080p" | "1440p" | "2160p";

export type UpscaleFilter = "lanczos" | "bicubic" | "bilinear";

export type EnhanceMode = "full" | "sharpen" | "contrast" | "color";

export type DownloadType = "mp4" | "mp3";

export type DownloadQuality = "360" | "480" | "720" | "1080" | "128" | "192" | "256" | "320";

export interface ConvertOptions {
  format: TargetFormat;
  quality: number;
}

export interface UpscaleOptions {
  target_res: UpscaleResolution;
  filter: UpscaleFilter;
}

export interface EnhanceOptions {
  mode: EnhanceMode;
  factor: number;
}

export interface DownloadRequest {
  url: string;
  type: DownloadType;
  quality: DownloadQuality;
}

export interface ProcessingState {
  isLoading: boolean;
  progress: number;
  error: string | null;
  successMessage: string | null;
}
