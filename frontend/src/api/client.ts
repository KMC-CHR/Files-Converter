import * as ort from "onnxruntime-web";
import type { ConvertOptions, UpscaleOptions, EnhanceOptions, DownloadRequest } from "../types";

/* ==========================================================================
   Background removal pipeline (client-side, u2netp via onnxruntime-web)

   1. Letterbox the photo into 320x320 (no squashing)
   2. Run the model twice (normal + mirrored) and average the two masks
   3. Quality gate: if the mask looks wrong, run the rescue path
      (Otsu threshold, largest-blob keep, hole fill, border flood-fill)
   4. Upscale the mask and snap it to real edges with a guided filter
   5. Decontaminate edge colors so no old background color survives
   ========================================================================== */

// ---------- Runtime setup ----------

const MODEL_SIZE = 320;
const MODEL_PATH = "/models/u2netp.onnx";
const WASM_CDN_PATH = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

ort.env.wasm.wasmPaths = WASM_CDN_PATH;
ort.env.wasm.numThreads = 1;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
    if (!sessionPromise) {
        sessionPromise = ort.InferenceSession.create(MODEL_PATH).catch((err: unknown) => {
            sessionPromise = null; // allow a retry after a failed load
            throw err;
        });
    }
    return sessionPromise;
}

// ---------- Tunable constants ----------

// Longest side used for matting. Bigger = sharper output but more memory.
const MAX_WORK_SIDE = 2048;

// ImageNet statistics the model was trained with. Padding uses the mean color
// so letterbox bars normalize to ~0 and do not look like content.
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
const PAD_COLOR = "rgb(124,116,104)";

// Soft ramp applied to the normalized mask. Slightly inward of 0.5 so the
// edge sits on the subject instead of just outside it.
const RAMP_LOW = 0.3;
const RAMP_HIGH = 0.85;

// Quality gate thresholds
const GATE_MIN_FOREGROUND = 0.02;
const GATE_MAX_FOREGROUND = 0.97;
const GATE_MAX_UNCERTAIN = 0.18;
const GATE_MAX_BLOBS = 4;
const GATE_BLOB_MIN_AREA = 0.005;

// Background detection / flood fill
const BG_MIN_SHARE = 0.45;
const BG_TOLERANCE = 36;

// Guided filter and decontamination
const GUIDED_EPS = 1e-3;
const SOLID_ALPHA = 0.98;
const MIN_ALPHA = 0.003;
const UNBLEND_MIN_ALPHA = 0.25;
const UNBLEND_MAX_DISTANCE = 60; // RGB distance within which un-blend is trusted

interface RGB {
    r: number;
    g: number;
    b: number;
}

interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

function clamp(value: number, low: number, high: number): number {
    return value < low ? low : value > high ? high : value;
}

function smoothstep01(t: number): number {
    const c = clamp(t, 0, 1);
    return c * c * (3 - 2 * c);
}

// ---------- Canvas helpers ----------

function createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
        throw new Error("Failed to obtain 2D context from canvas");
    }
    return ctx;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Failed to create PNG blob from canvas"));
        }, "image/png");
    });
}

function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load image file into browser element"));
        };
        image.src = url;
    });
}

// ---------- Step 1: model input (letterbox) ----------

function computeLetterbox(imageW: number, imageH: number): Box {
    const scale = MODEL_SIZE / Math.max(imageW, imageH);
    let w = Math.max(1, Math.round(imageW * scale));
    const h = Math.max(1, Math.round(imageH * scale));
    // Keep left/right margins equal so mirroring maps the image onto itself
    if ((MODEL_SIZE - w) % 2 !== 0) {
        w = w > 1 ? w - 1 : w + 1;
    }
    return {
        x: (MODEL_SIZE - w) / 2,
        y: Math.floor((MODEL_SIZE - h) / 2),
        w,
        h,
    };
}

function getModelPixels(image: HTMLImageElement, box: Box): Uint8ClampedArray {
    const canvas = createCanvas(MODEL_SIZE, MODEL_SIZE);
    const ctx = get2d(canvas);
    ctx.fillStyle = PAD_COLOR;
    ctx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, box.x, box.y, box.w, box.h);
    return ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
}

function buildTensorData(pixels: Uint8ClampedArray, flip: boolean): Float32Array {
    const area = MODEL_SIZE * MODEL_SIZE;
    const data = new Float32Array(3 * area);
    for (let row = 0; row < MODEL_SIZE; row++) {
        for (let col = 0; col < MODEL_SIZE; col++) {
            const srcCol = flip ? MODEL_SIZE - 1 - col : col;
            const src = (row * MODEL_SIZE + srcCol) * 4;
            const dst = row * MODEL_SIZE + col;
            for (let c = 0; c < 3; c++) {
                data[c * area + dst] = (pixels[src + c] / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
            }
        }
    }
    return data;
}

// ---------- Step 2: inference (+ mirror averaging) ----------

async function runModel(
    session: ort.InferenceSession,
    pixels: Uint8ClampedArray,
    flip: boolean,
): Promise<Float32Array> {
    const tensor = new ort.Tensor("float32", buildTensorData(pixels, flip), [
        1,
        3,
        MODEL_SIZE,
        MODEL_SIZE,
    ]);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const raw = results[session.outputNames[0]].data as Float32Array;

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < raw.length; i++) {
        if (raw[i] < min) min = raw[i];
        if (raw[i] > max) max = raw[i];
    }
    const range = max - min || 1;

    // Min-max normalize and un-mirror in one pass
    const out = new Float32Array(raw.length);
    for (let row = 0; row < MODEL_SIZE; row++) {
        for (let col = 0; col < MODEL_SIZE; col++) {
            const srcCol = flip ? MODEL_SIZE - 1 - col : col;
            out[row * MODEL_SIZE + col] = (raw[row * MODEL_SIZE + srcCol] - min) / range;
        }
    }
    return out;
}

function averageMasks(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) * 0.5;
    return out;
}

function cropMask(mask: Float32Array, box: Box): Float32Array {
    const out = new Float32Array(box.w * box.h);
    for (let y = 0; y < box.h; y++) {
        for (let x = 0; x < box.w; x++) {
            out[y * box.w + x] = mask[(box.y + y) * MODEL_SIZE + box.x + x];
        }
    }
    return out;
}

function cropRgba(pixels: Uint8ClampedArray, box: Box): Uint8ClampedArray {
    const out = new Uint8ClampedArray(box.w * box.h * 4);
    for (let y = 0; y < box.h; y++) {
        const srcStart = ((box.y + y) * MODEL_SIZE + box.x) * 4;
        out.set(pixels.subarray(srcStart, srcStart + box.w * 4), y * box.w * 4);
    }
    return out;
}

// ---------- Background detection ----------

// Finds the dominant color along the image border. Returns null when the
// border is not mostly one color (busy or gradient backgrounds).
function measureBorderBackground(rgba: Uint8ClampedArray, w: number, h: number): RGB | null {
    const thickness = Math.max(1, Math.round(Math.min(w, h) * 0.01));
    const counts = new Int32Array(4096);
    const sumR = new Float64Array(4096);
    const sumG = new Float64Array(4096);
    const sumB = new Float64Array(4096);
    let total = 0;

    const visit = (x: number, y: number): void => {
        const i = (y * w + x) * 4;
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        counts[bin]++;
        sumR[bin] += r;
        sumG[bin] += g;
        sumB[bin] += b;
        total++;
    };

    for (let y = 0; y < h; y++) {
        if (y < thickness || y >= h - thickness) {
            for (let x = 0; x < w; x++) visit(x, y);
        } else {
            for (let x = 0; x < Math.min(thickness, w); x++) visit(x, y);
            for (let x = Math.max(thickness, w - thickness); x < w; x++) visit(x, y);
        }
    }

    let best = 0;
    for (let bin = 1; bin < 4096; bin++) {
        if (counts[bin] > counts[best]) best = bin;
    }
    if (total === 0 || counts[best] / total < BG_MIN_SHARE) return null;
    return {
        r: sumR[best] / counts[best],
        g: sumG[best] / counts[best],
        b: sumB[best] / counts[best],
    };
}

// ---------- Binary mask tools (used by the rescue path) ----------

function otsuThreshold(values: Float32Array): number {
    const bins = 256;
    const hist = new Float64Array(bins);
    for (let i = 0; i < values.length; i++) {
        hist[clamp(Math.floor(values[i] * (bins - 1)), 0, bins - 1)]++;
    }
    let totalSum = 0;
    for (let i = 0; i < bins; i++) totalSum += i * hist[i];

    let bgWeight = 0;
    let bgSum = 0;
    let bestVariance = -1;
    let bestBin = bins >> 1;
    for (let i = 0; i < bins; i++) {
        bgWeight += hist[i];
        const fgWeight = values.length - bgWeight;
        if (bgWeight === 0 || fgWeight === 0) continue;
        bgSum += i * hist[i];
        const diff = bgSum / bgWeight - (totalSum - bgSum) / fgWeight;
        const variance = bgWeight * fgWeight * diff * diff;
        if (variance > bestVariance) {
            bestVariance = variance;
            bestBin = i;
        }
    }
    return bestBin / (bins - 1);
}

interface Components {
    labels: Int32Array;
    sizes: number[]; // sizes[label]; index 0 unused
}

// 4-connected component labeling of every pixel equal to `value`
function labelComponents(mask: Uint8Array, w: number, h: number, value: number): Components {
    const n = w * h;
    const labels = new Int32Array(n);
    const sizes: number[] = [0];
    const queue = new Int32Array(n);

    for (let start = 0; start < n; start++) {
        if (mask[start] !== value || labels[start] !== 0) continue;
        const id = sizes.length;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        labels[start] = id;
        while (head < tail) {
            const p = queue[head++];
            const x = p % w;
            const y = (p - x) / w;
            if (x > 0 && mask[p - 1] === value && labels[p - 1] === 0) {
                labels[p - 1] = id;
                queue[tail++] = p - 1;
            }
            if (x < w - 1 && mask[p + 1] === value && labels[p + 1] === 0) {
                labels[p + 1] = id;
                queue[tail++] = p + 1;
            }
            if (y > 0 && mask[p - w] === value && labels[p - w] === 0) {
                labels[p - w] = id;
                queue[tail++] = p - w;
            }
            if (y < h - 1 && mask[p + w] === value && labels[p + w] === 0) {
                labels[p + w] = id;
                queue[tail++] = p + w;
            }
        }
        sizes.push(tail);
    }
    return { labels, sizes };
}

// Keep real subjects (>=10% of the biggest blob), fill small enclosed holes
function cleanBinary(binary: Uint8Array, w: number, h: number): Uint8Array {
    const out = binary.slice();
    const n = w * h;

    const fg = labelComponents(out, w, h, 1);
    let largest = 0;
    for (let i = 1; i < fg.sizes.length; i++) largest = Math.max(largest, fg.sizes[i]);
    for (let i = 0; i < n; i++) {
        if (out[i] === 1 && fg.sizes[fg.labels[i]] < largest * 0.1) out[i] = 0;
    }

    const bg = labelComponents(out, w, h, 0);
    const touchesBorder = new Uint8Array(bg.sizes.length);
    for (let x = 0; x < w; x++) {
        touchesBorder[bg.labels[x]] = 1;
        touchesBorder[bg.labels[(h - 1) * w + x]] = 1;
    }
    for (let y = 0; y < h; y++) {
        touchesBorder[bg.labels[y * w]] = 1;
        touchesBorder[bg.labels[y * w + w - 1]] = 1;
    }
    const maxHole = n * 0.01;
    for (let i = 0; i < n; i++) {
        if (out[i] !== 0) continue;
        const id = bg.labels[i];
        if (!touchesBorder[id] && bg.sizes[id] <= maxHole) out[i] = 1;
    }
    return out;
}

// Removes only background connected to the border, so enclosed gaps between
// fingers, arms, etc. are cleared too. Never crosses pixels the model is
// confident about when `block` is supplied.
function floodBackground(
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    bg: RGB,
    tolerance: number,
    block?: Float32Array,
): Uint8Array {
    const n = w * h;
    const tol2 = tolerance * tolerance;
    const reached = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;

    const isBackground = (p: number): boolean => {
        if (block && block[p] >= 0.5) return false;
        const i = p * 4;
        const dr = rgba[i] - bg.r;
        const dg = rgba[i + 1] - bg.g;
        const db = rgba[i + 2] - bg.b;
        return dr * dr + dg * dg + db * db <= tol2;
    };
    const push = (p: number): void => {
        if (!reached[p] && isBackground(p)) {
            reached[p] = 1;
            queue[tail++] = p;
        }
    };

    for (let x = 0; x < w; x++) {
        push(x);
        push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
        push(y * w);
        push(y * w + w - 1);
    }
    while (head < tail) {
        const p = queue[head++];
        const x = p % w;
        if (x > 0) push(p - 1);
        if (x < w - 1) push(p + 1);
        if (p >= w) push(p - w);
        if (p < n - w) push(p + w);
    }
    return reached;
}

// ---------- Box filter / guided filter ----------

// Separable mean filter with clipped windows. dst may equal src.
function boxFilter(
    src: Float32Array,
    dst: Float32Array,
    tmp: Float32Array,
    w: number,
    h: number,
    r: number,
): void {
    for (let y = 0; y < h; y++) {
        const row = y * w;
        let sum = 0;
        for (let i = 0; i <= Math.min(r, w - 1); i++) sum += src[row + i];
        for (let x = 0; x < w; x++) {
            const lo = Math.max(0, x - r);
            const hi = Math.min(w - 1, x + r);
            tmp[row + x] = sum / (hi - lo + 1);
            if (x + r + 1 < w) sum += src[row + x + r + 1];
            if (x - r >= 0) sum -= src[row + x - r];
        }
    }
    for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let i = 0; i <= Math.min(r, h - 1); i++) sum += tmp[i * w + x];
        for (let y = 0; y < h; y++) {
            const lo = Math.max(0, y - r);
            const hi = Math.min(h - 1, y + r);
            dst[y * w + x] = sum / (hi - lo + 1);
            if (y + r + 1 < h) sum += tmp[(y + r + 1) * w + x];
            if (y - r >= 0) sum -= tmp[(y - r) * w + x];
        }
    }
}

// Classic guided filter (He et al.): output follows the edges of `guide`
function guidedFilter(
    guide: Float32Array,
    input: Float32Array,
    w: number,
    h: number,
    r: number,
    eps: number,
): Float32Array {
    const n = w * h;
    const tmp = new Float32Array(n);
    const meanI = new Float32Array(n);
    const meanP = new Float32Array(n);
    const x1 = new Float32Array(n);
    const x2 = new Float32Array(n);

    boxFilter(guide, meanI, tmp, w, h, r);
    boxFilter(input, meanP, tmp, w, h, r);
    for (let i = 0; i < n; i++) {
        x1[i] = guide[i] * guide[i];
        x2[i] = guide[i] * input[i];
    }
    boxFilter(x1, x1, tmp, w, h, r); // mean(I*I)
    boxFilter(x2, x2, tmp, w, h, r); // mean(I*p)

    for (let i = 0; i < n; i++) {
        const variance = x1[i] - meanI[i] * meanI[i] + eps;
        const covariance = x2[i] - meanI[i] * meanP[i];
        const a = covariance / variance;
        x1[i] = a;
        x2[i] = meanP[i] - a * meanI[i];
    }
    boxFilter(x1, x1, tmp, w, h, r); // mean(a)
    boxFilter(x2, x2, tmp, w, h, r); // mean(b)

    const out = meanP; // reuse buffer
    for (let i = 0; i < n; i++) out[i] = x1[i] * guide[i] + x2[i];
    return out;
}

// ---------- Step 3: quality gate and rescue ----------

function needsRescue(mask: Float32Array, w: number, h: number): boolean {
    const n = w * h;
    let foreground = 0;
    let uncertain = 0;
    const binary = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (mask[i] >= 0.5) {
            foreground++;
            binary[i] = 1;
        }
        if (mask[i] > 0.2 && mask[i] < 0.8) uncertain++;
    }
    const fraction = foreground / n;
    if (fraction < GATE_MIN_FOREGROUND || fraction > GATE_MAX_FOREGROUND) return true;
    if (uncertain / n > GATE_MAX_UNCERTAIN) return true;

    const blobs = labelComponents(binary, w, h, 1);
    let significant = 0;
    for (let i = 1; i < blobs.sizes.length; i++) {
        if (blobs.sizes[i] >= n * GATE_BLOB_MIN_AREA) significant++;
    }
    return significant > GATE_MAX_BLOBS;
}

function rescueMask(
    mask: Float32Array,
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    bg: RGB | null,
): Float32Array {
    const n = w * h;
    let foreground = 0;
    for (let i = 0; i < n; i++) if (mask[i] >= 0.5) foreground++;
    const fraction = foreground / n;
    const extreme = fraction < GATE_MIN_FOREGROUND || fraction > GATE_MAX_FOREGROUND;

    // Nothing reliable to rebuild from: keep the model's mask as is
    if (extreme && !bg) return mask;

    const threshold = clamp(otsuThreshold(mask), 0.25, 0.7);
    const binary = new Uint8Array(n);
    for (let i = 0; i < n; i++) binary[i] = mask[i] >= threshold ? 1 : 0;

    if (bg) {
        // When the model found almost nothing (or everything), trust the border
        // color instead; otherwise only remove background it is unsure about.
        const flooded = floodBackground(rgba, w, h, bg, BG_TOLERANCE, extreme ? undefined : mask);
        for (let i = 0; i < n; i++) {
            if (extreme) binary[i] = flooded[i] ? 0 : 1;
            else if (flooded[i]) binary[i] = 0;
        }
    }

    const cleaned = cleanBinary(binary, w, h);
    const soft = new Float32Array(n);
    for (let i = 0; i < n; i++) soft[i] = cleaned[i];
    const tmp = new Float32Array(n);
    boxFilter(soft, soft, tmp, w, h, 1);
    boxFilter(soft, soft, tmp, w, h, 1);
    return soft;
}

function applyRamp(mask: Float32Array): Float32Array {
    const out = new Float32Array(mask.length);
    const span = RAMP_HIGH - RAMP_LOW;
    for (let i = 0; i < mask.length; i++) out[i] = smoothstep01((mask[i] - RAMP_LOW) / span);
    return out;
}

// ---------- Step 4: upscale mask to working resolution ----------

function upscaleMask(
    mask: Float32Array,
    w: number,
    h: number,
    outW: number,
    outH: number,
): Float32Array {
    const small = createCanvas(w, h);
    const smallCtx = get2d(small);
    const imageData = smallCtx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const v = Math.round(clamp(mask[i], 0, 1) * 255);
        imageData.data[i * 4] = v;
        imageData.data[i * 4 + 1] = v;
        imageData.data[i * 4 + 2] = v;
        imageData.data[i * 4 + 3] = 255; // opaque so nothing is premultiplied away
    }
    smallCtx.putImageData(imageData, 0, 0);

    const big = createCanvas(outW, outH);
    const bigCtx = get2d(big);
    bigCtx.imageSmoothingEnabled = true;
    bigCtx.imageSmoothingQuality = "high";
    bigCtx.drawImage(small, 0, 0, outW, outH);
    const data = bigCtx.getImageData(0, 0, outW, outH).data;

    const out = new Float32Array(outW * outH);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4] / 255;
    return out;
}

function toGray(rgba: Uint8ClampedArray, n: number): Float32Array {
    const gray = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        gray[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
    }
    return gray;
}

// ---------- Step 5: edge color decontamination ----------

// Shrinks a binary mask by r pixels (out-of-bounds counts as solid)
function erodeMask(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
    if (r <= 0) return src;
    const tmp = new Uint8Array(w * h);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let v = 1;
            for (let k = -r; k <= r; k++) {
                const xx = x + k;
                if (xx >= 0 && xx < w && src[y * w + xx] === 0) {
                    v = 0;
                    break;
                }
            }
            tmp[y * w + x] = v;
        }
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let v = 1;
            for (let k = -r; k <= r; k++) {
                const yy = y + k;
                if (yy >= 0 && yy < h && tmp[yy * w + x] === 0) {
                    v = 0;
                    break;
                }
            }
            out[y * w + x] = v;
        }
    }
    return out;
}

// Replaces the color of every semi-transparent pixel with the color of the
// nearest confidently-opaque subject pixels (layer by layer, averaged), and
// optionally blends in an exact un-blend against the measured background.
function decontaminate(
    rgba: Uint8ClampedArray,
    alpha: Float32Array,
    w: number,
    h: number,
    bg: RGB | null,
    erodeRadius: number,
    maxLayers: number,
): Uint8ClampedArray {
    const n = w * h;

    const solidRaw = new Uint8Array(n);
    for (let i = 0; i < n; i++) solidRaw[i] = alpha[i] >= SOLID_ALPHA ? 1 : 0;
    const solid = erodeMask(solidRaw, w, h, erodeRadius);

    const filled = new Uint8Array(n);
    const color = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        if (solid[i]) {
            filled[i] = 1;
            color[i * 3] = rgba[i * 4];
            color[i * 3 + 1] = rgba[i * 4 + 1];
            color[i * 3 + 2] = rgba[i * 4 + 2];
        }
    }

    // Initial frontier: filled pixels touching an unfilled visible pixel
    let frontier: number[] = [];
    for (let p = 0; p < n; p++) {
        if (!filled[p]) continue;
        const x = p % w;
        const y = (p - x) / w;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const q = ny * w + nx;
                if (!filled[q] && alpha[q] > MIN_ALPHA) {
                    touches = true;
                    break;
                }
            }
        }
        if (touches) frontier.push(p);
    }

    const queued = new Uint8Array(n);
    for (let layer = 0; layer < maxLayers && frontier.length > 0; layer++) {
        const next: number[] = [];
        for (const p of frontier) {
            const x = p % w;
            const y = (p - x) / w;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    const q = ny * w + nx;
                    if (!filled[q] && !queued[q] && alpha[q] > MIN_ALPHA) {
                        queued[q] = 1;
                        next.push(q);
                    }
                }
            }
        }
        // Compute from the previous layer only, then commit
        for (const q of next) {
            const x = q % w;
            const y = (q - x) / w;
            let sr = 0;
            let sg = 0;
            let sb = 0;
            let count = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    const m = ny * w + nx;
                    if (filled[m]) {
                        sr += color[m * 3];
                        sg += color[m * 3 + 1];
                        sb += color[m * 3 + 2];
                        count++;
                    }
                }
            }
            if (count > 0) {
                color[q * 3] = sr / count;
                color[q * 3 + 1] = sg / count;
                color[q * 3 + 2] = sb / count;
            }
        }
        for (const q of next) filled[q] = 1;
        frontier = next;
    }

    const out = new Uint8ClampedArray(n * 4);
    for (let p = 0; p < n; p++) {
        const a = alpha[p];
        const o = p * 4;
        out[o + 3] = Math.round(a * 255);

        if (solid[p] || a <= MIN_ALPHA) {
            out[o] = rgba[o];
            out[o + 1] = rgba[o + 1];
            out[o + 2] = rgba[o + 2];
            continue;
        }

        const haveNeighbor = filled[p] === 1;
        const haveUnblend = bg !== null && a >= UNBLEND_MIN_ALPHA;
        let ur = 0;
        let ug = 0;
        let ub = 0;
        if (haveUnblend && bg) {
            ur = (rgba[o] - (1 - a) * bg.r) / a;
            ug = (rgba[o + 1] - (1 - a) * bg.g) / a;
            ub = (rgba[o + 2] - (1 - a) * bg.b) / a;
        }

        // The un-blend is only trusted when it agrees with the neighbor color;
        // if alpha was slightly off, it would otherwise re-introduce the halo.
        let unblendAgrees = false;
        if (haveNeighbor && haveUnblend) {
            const dr = ur - color[p * 3];
            const dg = ug - color[p * 3 + 1];
            const db = ub - color[p * 3 + 2];
            unblendAgrees = dr * dr + dg * dg + db * db <= UNBLEND_MAX_DISTANCE * UNBLEND_MAX_DISTANCE;
        }

        if (unblendAgrees) {
            out[o] = 0.5 * color[p * 3] + 0.5 * ur;
            out[o + 1] = 0.5 * color[p * 3 + 1] + 0.5 * ug;
            out[o + 2] = 0.5 * color[p * 3 + 2] + 0.5 * ub;
        } else if (haveNeighbor) {
            out[o] = color[p * 3];
            out[o + 1] = color[p * 3 + 1];
            out[o + 2] = color[p * 3 + 2];
        } else if (haveUnblend) {
            out[o] = ur;
            out[o + 1] = ug;
            out[o + 2] = ub;
        } else {
            out[o] = rgba[o];
            out[o + 1] = rgba[o + 1];
            out[o + 2] = rgba[o + 2];
        }
    }
    return out;
}

// ---------- Public: background removal ----------

export async function removeBackground(file: File): Promise<Blob> {
    const session = await getSession();
    const image = await loadImage(file);
    const imageW = image.naturalWidth;
    const imageH = image.naturalHeight;

    // Working-resolution copy of the photo (capped to keep memory sane)
    const scale = Math.min(1, MAX_WORK_SIDE / Math.max(imageW, imageH));
    const workW = Math.max(1, Math.round(imageW * scale));
    const workH = Math.max(1, Math.round(imageH * scale));
    const workCanvas = createCanvas(workW, workH);
    const workCtx = get2d(workCanvas);
    workCtx.imageSmoothingEnabled = true;
    workCtx.imageSmoothingQuality = "high";
    workCtx.drawImage(image, 0, 0, workW, workH);
    const workPixels = workCtx.getImageData(0, 0, workW, workH).data;

    // Steps 1-2: letterbox + normal/mirrored inference, averaged
    const box = computeLetterbox(imageW, imageH);
    const modelPixels = getModelPixels(image, box);
    const maskNormal = await runModel(session, modelPixels, false);
    const maskMirror = await runModel(session, modelPixels, true);
    const mask = cropMask(averageMasks(maskNormal, maskMirror), box);
    const smallRgba = cropRgba(modelPixels, box);

    // Step 3: quality gate with automatic rescue
    let softMask: Float32Array;
    if (needsRescue(mask, box.w, box.h)) {
        const smallBg = measureBorderBackground(smallRgba, box.w, box.h);
        softMask = rescueMask(mask, smallRgba, box.w, box.h, smallBg);
    } else {
        softMask = applyRamp(mask);
    }

    // Step 4: upscale and snap to real edges
    const roughAlpha = upscaleMask(softMask, box.w, box.h, workW, workH);
    const guide = toGray(workPixels, workW * workH);
    const radius = Math.max(3, Math.ceil(Math.max(workW, workH) / MODEL_SIZE));
    const alpha = guidedFilter(guide, roughAlpha, workW, workH, radius, GUIDED_EPS);
    for (let i = 0; i < alpha.length; i++) {
        alpha[i] = clamp((alpha[i] - 0.04) / 0.92, 0, 1); // remove faint haze
    }

    // Step 5: remove old background color from edge pixels
    const workBg = measureBorderBackground(workPixels, workW, workH);
    const erodeRadius = Math.max(1, Math.round(radius / 3));
    const result = decontaminate(
        workPixels,
        alpha,
        workW,
        workH,
        workBg,
        erodeRadius,
        radius * 2 + erodeRadius,
    );

    const outCanvas = createCanvas(workW, workH);
    const outCtx = get2d(outCanvas);
    const outImage = outCtx.createImageData(workW, workH);
    outImage.data.set(result);
    outCtx.putImageData(outImage, 0, 0);
    return canvasToBlob(outCanvas);
}

// ---------- Backend-powered tools (unchanged behavior) ----------

function getFilenameWithoutExtension(fullName: string): string {
    const dot = fullName.lastIndexOf(".");
    return dot === -1 ? fullName : fullName.substring(0, dot);
}

async function handleFileResponse(response: Response, defaultFilename: string): Promise<void> {
    if (!response.ok) {
        let message = "An error occurred during processing.";
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            try {
                const data = await response.json();
                message = data.detail || data.error || message;
            } catch {
                message = `Server returned error status ${response.status}`;
            }
        } else {
            try {
                const text = await response.text();
                message =
                    text && !text.trim().startsWith("<")
                        ? text
                        : `Server returned error status ${response.status} (${response.statusText || "Error"})`;
            } catch {
                message = `Server returned error status ${response.status}`;
            }
        }
        throw new Error(message);
    }

    const blob = await response.blob();
    let filename = defaultFilename;
    const disposition = response.headers.get("Content-Disposition");
    if (disposition) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
    }

    const downloadUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(anchor);
}

export async function convertImage(file: File, options: ConvertOptions): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("format", options.format);
    formData.append("quality", options.quality.toString());
    const response = await fetch("/api/convert", { method: "POST", body: formData });
    const ext = options.format.toLowerCase();
    await handleFileResponse(response, `${getFilenameWithoutExtension(file.name)}_converted.${ext}`);
}

export async function upscaleImage(file: File, options: UpscaleOptions): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("target_res", options.target_res);
    formData.append("filter", options.filter);
    const response = await fetch("/api/upscale", { method: "POST", body: formData });
    await handleFileResponse(
        response,
        `${getFilenameWithoutExtension(file.name)}_${options.target_res}.png`,
    );
}

export async function enhanceImage(file: File, options: EnhanceOptions): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", options.mode);
    formData.append("factor", options.factor.toString());
    const response = await fetch("/api/enhance", { method: "POST", body: formData });
    await handleFileResponse(response, `${getFilenameWithoutExtension(file.name)}_enhanced.png`);
}

export async function aiSuperResImage(file: File): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/ai-superres", { method: "POST", body: formData });
    await handleFileResponse(response, `${getFilenameWithoutExtension(file.name)}_superres_2x.png`);
}

export async function downloadMedia(payload: DownloadRequest): Promise<void> {
    const response = await fetch("/api/download-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const ext = payload.type === "mp3" ? "mp3" : "mp4";
    await handleFileResponse(response, `downloaded_media.${ext}`);
}