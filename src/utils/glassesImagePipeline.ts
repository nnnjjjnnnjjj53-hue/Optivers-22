import * as ort from 'onnxruntime-web/webgpu';
import { FrameCat, FrameMaterial, FrameType, LensRegionBox, ModelCalibration } from '../types';
import { idbGetCachedModel, idbPutCachedModel } from './indexedDbStore';

// Commercial-permissive Open-Source Segmentation Model:
// U²-Net Portable (xuebinqin/U-2-Net — Apache-2.0 License) running locally via onnxruntime-web (MIT License).
// WebGPU execution provider is preferred, with automatic WASM fallback.
export const SEGMENTATION_MODEL_ID = 'u2netp-apache-2.0';
export const SEGMENTATION_MODEL_URL = 'https://huggingface.co/tomjackson2023/rembg/resolve/main/u2netp.onnx';
const ORT_WASM_CDN_FALLBACK = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
const U2NET_INPUT_SIZE = 320;
const STUDIO_BG_HEX = '#F8F7F4';

export type SegmentationBackend = 'webgpu' | 'wasm' | 'fallback';
export type PipelineQuality = 'good' | 'check';

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface RenderedWebpAsset {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  ext: 'webp' | 'png';
}

export interface QualityAssessment {
  quality: PipelineQuality;
  confidenceScore: number;
  transparentFrameDetected: boolean;
  fgRatio: number;
  reasons: string[];
  noteAr?: string;
}

export interface ProcessGlassesImageOptions {
  category?: FrameCat;
  material?: FrameMaterial;
  frameWidthMm?: number;
  opticalDimensions?: string;
  fitScale?: number;
  eyeLineOffset?: number;
  angleType?: 'front' | 'angled45';
  maxSidePx?: number;
  onStage?: (stageLabelAr: string) => void;
}

export interface ProcessedGlassesResult {
  storeImage: RenderedWebpAsset;
  cutoutImage: RenderedWebpAsset;
  lensMask: { blob: Blob; dataUrl: string };
  quality: PipelineQuality;
  qualityAssessment: QualityAssessment;
  qualityNoteAr?: string;
  backendUsed: SegmentationBackend;
  deskewAngleDeg: number;
  width: number;
  height: number;
  aspectRatio: number;
  sampledFrameColor: string;
  sampledLensColor: string;
  detectedCat: FrameCat;
  detectedMaterial: FrameMaterial;
  detectedType: FrameType;
  leftLensBox: LensRegionBox;
  rightLensBox: LensRegionBox;
  calibration: ModelCalibration;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function isOffscreenSupported(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

function createWorkCanvas(w: number, h: number): AnyCanvas {
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  if (isOffscreenSupported()) {
    return new OffscreenCanvas(cw, ch);
  }
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  return c;
}

function get2dCtx(canvas: AnyCanvas): AnyCtx {
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!ctx) throw new Error('2D Canvas context unavailable');
  return ctx as AnyCtx;
}

function releaseCanvas(c: AnyCanvas | null | undefined): void {
  if (!c) return;
  try {
    c.width = 0;
    c.height = 0;
  } catch {
    // ignore
  }
}

async function canvasToBlobUniversal(
  canvas: AnyCanvas,
  mime = 'image/webp',
  quality = 0.88
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: mime, quality });
  }
  const htmlCanvas = canvas as HTMLCanvasElement;
  return new Promise((resolve, reject) => {
    htmlCanvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Canvas toBlob failed'));
      },
      mime,
      quality
    );
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'image/webp'};base64,${btoa(bin)}`;
}

async function exportWebpAsset(canvas: AnyCanvas, quality = 0.88): Promise<RenderedWebpAsset> {
  let blob: Blob;
  let ext: 'webp' | 'png' = 'webp';
  try {
    blob = await canvasToBlobUniversal(canvas, 'image/webp', quality);
    if (!blob || blob.size === 0 || blob.type !== 'image/webp') {
      throw new Error('WebP unavailable');
    }
  } catch {
    blob = await canvasToBlobUniversal(canvas, 'image/png', 1);
    ext = 'png';
  }
  const dataUrl = await blobToDataUrl(blob);
  return {
    blob,
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    ext,
  };
}

/**
 * Pure dimension scaler capping longest side to `maxSidePx` (default 1024px) while preserving aspect ratio.
 */
export function computeDownscaledDimensions(
  srcWidth: number,
  srcHeight: number,
  maxSidePx = 1024
): { width: number; height: number } {
  const w = Math.max(1, srcWidth);
  const h = Math.max(1, srcHeight);
  const longest = Math.max(w, h);
  if (longest <= maxSidePx) {
    return { width: Math.round(w), height: Math.round(h) };
  }
  const scale = maxSidePx / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * Reads JPEG EXIF Orientation tag (1..8) from raw file bytes so rotated phone photos upright properly
 * even in environments where `imageOrientation: 'from-image'` isn't applied automatically.
 */
export function parseExifOrientationFromBytes(bytes: Uint8Array): number {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xda || marker === 0xd9) break;
    const segLen = (bytes[offset] << 8) | bytes[offset + 1];
    if (segLen < 2 || offset + segLen > bytes.length) break;

    if (marker === 0xe1 && segLen >= 14) {
      // Check "Exif\0\0"
      if (
        bytes[offset + 2] === 0x45 &&
        bytes[offset + 3] === 0x78 &&
        bytes[offset + 4] === 0x69 &&
        bytes[offset + 5] === 0x66 &&
        bytes[offset + 6] === 0x00 &&
        bytes[offset + 7] === 0x00
      ) {
        const tiffStart = offset + 8;
        const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
        const readU16 = (pos: number) =>
          little ? bytes[pos] | (bytes[pos + 1] << 8) : (bytes[pos] << 8) | bytes[pos + 1];
        const readU32 = (pos: number) =>
          little
            ? (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)) >>> 0
            : ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;

        const firstIfdOffset = readU32(tiffStart + 4);
        const ifdPos = tiffStart + firstIfdOffset;
        if (ifdPos + 2 < bytes.length) {
          const entries = readU16(ifdPos);
          for (let i = 0; i < entries; i++) {
            const ent = ifdPos + 2 + i * 12;
            if (ent + 12 > bytes.length) break;
            const tag = readU16(ent);
            if (tag === 0x0112) {
              const val = readU16(ent + 8);
              return val >= 1 && val <= 8 ? val : 1;
            }
          }
        }
      }
    }
    offset += segLen;
  }
  return 1;
}

async function decodeAndDownscaleWithExif(source: Blob, maxSidePx = 1024): Promise<AnyCanvas> {
  // Modern browsers & Workers support EXIF-aware createImageBitmap directly
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch {
      try {
        bitmap = await createImageBitmap(source);
      } catch {
        bitmap = null;
      }
    }
    if (bitmap) {
      try {
        const { width, height } = computeDownscaledDimensions(bitmap.width, bitmap.height, maxSidePx);
        const canvas = createWorkCanvas(width, height);
        const ctx = get2dCtx(canvas);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, width, height);
        return canvas;
      } finally {
        try {
          bitmap.close();
        } catch {
          // ignore
        }
      }
    }
  }

  // Fallback for DOM HTMLImageElement (main thread without ImageBitmap orientation support)
  const headBytes = new Uint8Array(await source.slice(0, 65536).arrayBuffer());
  const orientation = parseExifOrientationFromBytes(headBytes);
  const url = URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
      el.src = url;
    });
    const rawW = img.naturalWidth || img.width || 1;
    const rawH = img.naturalHeight || img.height || 1;
    const swapped = orientation >= 5 && orientation <= 8;
    const target = computeDownscaledDimensions(swapped ? rawH : rawW, swapped ? rawW : rawH, maxSidePx);
    const canvas = createWorkCanvas(target.width, target.height);
    const ctx = get2dCtx(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const drawW = swapped ? target.height : target.width;
    const drawH = swapped ? target.width : target.height;
    ctx.save();
    switch (orientation) {
      case 2:
        ctx.translate(target.width, 0);
        ctx.scale(-1, 1);
        break;
      case 3:
        ctx.translate(target.width, target.height);
        ctx.rotate(Math.PI);
        break;
      case 4:
        ctx.translate(0, target.height);
        ctx.scale(1, -1);
        break;
      case 5:
        ctx.rotate(0.5 * Math.PI);
        ctx.scale(1, -1);
        break;
      case 6:
        ctx.rotate(0.5 * Math.PI);
        ctx.translate(0, -target.width);
        break;
      case 7:
        ctx.rotate(0.5 * Math.PI);
        ctx.translate(target.height, -target.width);
        ctx.scale(-1, 1);
        break;
      case 8:
        ctx.rotate(-0.5 * Math.PI);
        ctx.translate(-target.height, 0);
        break;
      default:
        break;
    }
    ctx.drawImage(img, 0, 0, drawW, drawH);
    ctx.restore();
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Singleton ONNX Runtime session cache inside worker / thread
let ortSessionPromise: Promise<{ session: ort.InferenceSession; backend: SegmentationBackend } | null> | null = null;

function resolveWasmBaseUrl(): string {
  try {
    const loc = (globalThis as { location?: { origin?: string } }).location;
    if (loc?.origin && loc.origin !== 'null' && !loc.origin.startsWith('file:')) {
      return `${loc.origin}/ort/`;
    }
  } catch {
    // ignore
  }
  return ORT_WASM_CDN_FALLBACK;
}

async function fetchModelBufferWithCache(): Promise<ArrayBuffer> {
  const cached = await idbGetCachedModel(SEGMENTATION_MODEL_ID);
  if (cached && cached.byteLength > 1_000_000) {
    return cached;
  }

  const res = await fetch(SEGMENTATION_MODEL_URL, { mode: 'cors' });
  if (!res.ok) {
    throw new Error(`Model download failed: ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  void idbPutCachedModel(SEGMENTATION_MODEL_ID, buf);
  return buf;
}

async function hasWorkingWebGpu(): Promise<boolean> {
  try {
    const nav = (globalThis as { navigator?: { gpu?: { requestAdapter: () => Promise<unknown> } } }).navigator;
    if (!nav?.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function getSegmentationSession(): Promise<{
  session: ort.InferenceSession;
  backend: SegmentationBackend;
} | null> {
  if (ortSessionPromise) return ortSessionPromise;

  ortSessionPromise = (async () => {
    try {
      const wasmPath = resolveWasmBaseUrl();
      ort.env.wasm.wasmPaths = wasmPath;
      ort.env.wasm.numThreads = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ? 2 : 1;

      const modelBuffer = await fetchModelBufferWithCache();
      const webgpuReady = await hasWorkingWebGpu();

      if (webgpuReady) {
        try {
          const session = await ort.InferenceSession.create(modelBuffer, {
            executionProviders: ['webgpu', 'wasm'],
            graphOptimizationLevel: 'all',
          });
          return { session, backend: 'webgpu' as const };
        } catch {
          // Fall through cleanly to pure WASM EP
        }
      }

      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      return { session, backend: 'wasm' as const };
    } catch {
      ortSessionPromise = null;
      return null;
    }
  })();

  return ortSessionPromise;
}

/**
 * Runs U²-Net (u2netp.onnx, Apache-2.0) local inference to produce a full-res [0..255] foreground mask.
 */
async function runLocalU2NetMask(
  sourceCanvas: AnyCanvas
): Promise<{ alphaMask: Uint8Array; backend: SegmentationBackend } | null> {
  const loaded = await getSegmentationSession();
  if (!loaded) return null;

  const { session, backend } = loaded;
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;

  const prepCanvas = createWorkCanvas(U2NET_INPUT_SIZE, U2NET_INPUT_SIZE);
  const maskSmallCanvas = createWorkCanvas(U2NET_INPUT_SIZE, U2NET_INPUT_SIZE);
  const maskFullCanvas = createWorkCanvas(srcW, srcH);

  try {
    const prepCtx = get2dCtx(prepCanvas);
    prepCtx.imageSmoothingEnabled = true;
    prepCtx.imageSmoothingQuality = 'high';
    prepCtx.drawImage(sourceCanvas, 0, 0, U2NET_INPUT_SIZE, U2NET_INPUT_SIZE);
    const imgData = prepCtx.getImageData(0, 0, U2NET_INPUT_SIZE, U2NET_INPUT_SIZE).data;

    const totalSmall = U2NET_INPUT_SIZE * U2NET_INPUT_SIZE;
    const tensorData = new Float32Array(3 * totalSmall);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];

    for (let p = 0; p < totalSmall; p++) {
      const i = p * 4;
      tensorData[p] = (imgData[i] / 255 - mean[0]) / std[0];
      tensorData[totalSmall + p] = (imgData[i + 1] / 255 - mean[1]) / std[1];
      tensorData[totalSmall * 2 + p] = (imgData[i + 2] / 255 - mean[2]) / std[2];
    }

    const inputName = session.inputNames[0] || 'input.1';
    const outputName = session.outputNames[0] || '1959';
    const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, U2NET_INPUT_SIZE, U2NET_INPUT_SIZE]);
    const results = await session.run({ [inputName]: inputTensor });
    const outTensor = results[outputName];
    const rawOut = outTensor.data as Float32Array;

    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let p = 0; p < totalSmall; p++) {
      const v = rawOut[p];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    const span = Math.max(1e-5, maxVal - minVal);
    // Normalize saliency cleanly while preserving raw contrast when dynamic range is already high
    const needsRescale = maxVal > 1.05 || minVal < -0.05;

    const msCtx = get2dCtx(maskSmallCanvas);
    const msImg = msCtx.createImageData(U2NET_INPUT_SIZE, U2NET_INPUT_SIZE);
    for (let p = 0; p < totalSmall; p++) {
      const rawV = rawOut[p];
      const norm = needsRescale ? (rawV - minVal) / span : Math.max(0, Math.min(1, rawV));
      const a = Math.round(norm * 255);
      const i = p * 4;
      msImg.data[i] = a;
      msImg.data[i + 1] = a;
      msImg.data[i + 2] = a;
      msImg.data[i + 3] = 255;
    }
    msCtx.putImageData(msImg, 0, 0);

    const mfCtx = get2dCtx(maskFullCanvas);
    mfCtx.imageSmoothingEnabled = true;
    mfCtx.imageSmoothingQuality = 'high';
    mfCtx.drawImage(maskSmallCanvas, 0, 0, srcW, srcH);
    const mfData = mfCtx.getImageData(0, 0, srcW, srcH).data;

    const alphaMask = new Uint8Array(srcW * srcH);
    for (let p = 0; p < srcW * srcH; p++) {
      alphaMask[p] = mfData[p * 4];
    }
    return { alphaMask, backend };
  } catch {
    return null;
  } finally {
    releaseCanvas(prepCanvas);
    releaseCanvas(maskSmallCanvas);
    releaseCanvas(maskFullCanvas);
  }
}

function rgbDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Samples median background color from the four corners of the photo.
 */
export function sampleOuterCornerMedianColor(raw: Uint8ClampedArray, w: number, h: number): RGBColor {
  const patch = Math.max(2, Math.min(8, Math.floor(Math.min(w, h) * 0.04)));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const sampleBox = (x0: number, y0: number) => {
    for (let dy = 0; dy < patch; dy++) {
      for (let dx = 0; dx < patch; dx++) {
        const x = Math.max(0, Math.min(w - 1, x0 + dx));
        const y = Math.max(0, Math.min(h - 1, y0 + dy));
        const i = (y * w + x) * 4;
        if (raw[i + 3] < 200) continue;
        rs.push(raw[i]);
        gs.push(raw[i + 1]);
        bs.push(raw[i + 2]);
      }
    }
  };

  sampleBox(0, 0);
  sampleBox(Math.max(0, w - patch), 0);
  sampleBox(0, Math.max(0, h - patch));
  sampleBox(Math.max(0, w - patch), Math.max(0, h - patch));

  if (!rs.length) return { r: 245, g: 245, b: 245 };
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const m = Math.floor(rs.length / 2);
  return { r: rs[m], g: gs[m], b: bs[m] };
}

/**
 * Deterministic fallback mask when neural ONNX model cannot load offline or inside headless unit tests.
 */
export function buildFallbackForegroundMask(
  raw: Uint8ClampedArray,
  w: number,
  h: number,
  outerBg: RGBColor = sampleOuterCornerMedianColor(raw, w, h)
): Uint8Array {
  const total = w * h;
  const mask = new Uint8Array(total);
  const edgeMag = new Float32Array(total);
  const bgDist = new Float32Array(total);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      bgDist[p] = rgbDist(raw[i], raw[i + 1], raw[i + 2], outerBg.r, outerBg.g, outerBg.b);
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        const l = (p - 1) * 4;
        const rt = (p + 1) * 4;
        const u = (p - w) * 4;
        const dn = (p + w) * 4;
        const gx = rgbDist(raw[rt], raw[rt + 1], raw[rt + 2], raw[l], raw[l + 1], raw[l + 2]);
        const gy = rgbDist(raw[dn], raw[dn + 1], raw[dn + 2], raw[u], raw[u + 1], raw[u + 2]);
        edgeMag[p] = Math.hypot(gx, gy);
      }
    }
  }

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const pushBg = (p: number) => {
    if (visited[p]) return;
    if (bgDist[p] <= 12 || (bgDist[p] <= 34 && edgeMag[p] <= 26) || raw[p * 4 + 3] < 24) {
      visited[p] = 1;
      queue[tail++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    pushBg(x);
    pushBg((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    pushBg(y * w);
    pushBg(y * w + w - 1);
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) pushBg(p - 1);
    if (x < w - 1) pushBg(p + 1);
    if (y > 0) pushBg(p - w);
    if (y < h - 1) pushBg(p + w);
  }

  for (let p = 0; p < total; p++) {
    if (visited[p] || bgDist[p] <= 14) {
      mask[p] = 0;
    } else {
      const a = Math.min(255, Math.max(0, Math.round(((bgDist[p] - 14) / 36) * 255)));
      mask[p] = Math.min(raw[p * 4 + 3], a);
    }
  }
  return mask;
}

/**
 * Pure Step 3 — Mask Refinement, 1px Halo Erosion, Edge Color Decontamination, and Semi-Transparent Lenses:
 *  - Erodes 1px from thick foreground boundaries to eliminate fringe halos while guarding 1-2px thin bridges.
 *  - Feathers boundary transitions slightly (~0.8px) for crisp anti-aliasing.
 *  - Decontaminates edge RGB colors away from the sampled background tint.
 *  - Detects left/right enclosed lens cavities and keeps lens areas semi-transparent (never filled solid!).
 */
export function refineGlassesMaskAndDecontaminate(
  rawRgba: Uint8ClampedArray,
  initialMask: Uint8Array,
  w: number,
  h: number,
  options: { category?: FrameCat; outerBg?: RGBColor } = {}
): {
  refinedPixels: Uint8ClampedArray;
  lensMaskPixels: Uint8ClampedArray;
  outerBg: RGBColor;
  detectedCat: FrameCat;
  sampledLensColor: string;
  leftLensBox: LensRegionBox;
  rightLensBox: LensRegionBox;
} {
  const total = w * h;
  const outerBg = options.outerBg || sampleOuterCornerMedianColor(rawRgba, w, h);
  const refinedPixels = new Uint8ClampedArray(rawRgba);
  const lensMaskPixels = new Uint8ClampedArray(total * 4);

  // 1) Clean binary threshold & 1px morphological erosion to kill background halo
  const eroded = new Uint8Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const a = initialMask[p];
      if (a < 28) {
        eroded[p] = 0;
        continue;
      }

      // Check 4-connected neighbors
      const nL = x > 0 ? initialMask[p - 1] : 0;
      const nR = x < w - 1 ? initialMask[p + 1] : 0;
      const nU = y > 0 ? initialMask[p - w] : 0;
      const nD = y < h - 1 ? initialMask[p + w] : 0;
      const minNb = Math.min(nL, nR, nU, nD);

      // Guard 1-2px thin wires (pixels whose opposite neighbors are BOTH background, yet contrast strongly against outerBg)
      const isHorizontalWire = nU < 40 && nD < 40 && a >= 140;
      const isVerticalWire = nL < 40 && nR < 40 && a >= 140;
      const bgContrast = rgbDist(
        rawRgba[p * 4],
        rawRgba[p * 4 + 1],
        rawRgba[p * 4 + 2],
        outerBg.r,
        outerBg.g,
        outerBg.b
      );

      if ((isHorizontalWire || isVerticalWire) && bgContrast >= 42) {
        eroded[p] = a;
      } else {
        // Explicit 1px erosion on outer rim silhouette to kill background halos
        eroded[p] = minNb < 96 ? Math.min(a, minNb) : a;
      }
    }
  }

  // 2) Slight edge feathering (0.5 * center + 0.5 * neighbor avg ONLY along 1px boundary)
  const feathered = new Uint8Array(eroded);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const c = eroded[p];
      if (c === 0 || c === 255) {
        const avgNb = (eroded[p - 1] + eroded[p + 1] + eroded[p - w] + eroded[p + w]) * 0.25;
        if (Math.abs(c - avgNb) > 24) {
          feathered[p] = Math.round(c * 0.68 + avgNb * 0.32);
        }
      }
    }
  }

  // 3) Edge color decontamination against sampled outer background + crisp interior pixel color
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      const a = feathered[p];
      if (a <= 14) {
        refinedPixels[i] = 0;
        refinedPixels[i + 1] = 0;
        refinedPixels[i + 2] = 0;
        refinedPixels[i + 3] = 0;
        continue;
      }

      refinedPixels[i + 3] = a;
      const nearBoundary =
        x === 0 ||
        x === w - 1 ||
        y === 0 ||
        y === h - 1 ||
        feathered[p - 1] < 210 ||
        feathered[p + 1] < 210 ||
        feathered[p - w] < 210 ||
        feathered[p + w] < 210;

      if (nearBoundary) {
        const r = rawRgba[i];
        const g = rawRgba[i + 1];
        const b = rawRgba[i + 2];
        const bgDiff = rgbDist(r, g, b, outerBg.r, outerBg.g, outerBg.b);

        // Search 3px radius for crisp opaque interior pixel
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let sc = 0;
        for (let dy = -3; dy <= 3; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const np = ny * w + nx;
            if (feathered[np] >= 220) {
              const ni = np * 4;
              const nDiff = rgbDist(rawRgba[ni], rawRgba[ni + 1], rawRgba[ni + 2], outerBg.r, outerBg.g, outerBg.b);
              if (nDiff > 28) {
                sr += rawRgba[ni];
                sg += rawRgba[ni + 1];
                sb += rawRgba[ni + 2];
                sc++;
              }
            }
          }
        }

        if (sc > 0) {
          const ir = sr / sc;
          const ig = sg / sc;
          const ib = sb / sc;
          const intDiff = rgbDist(ir, ig, ib, outerBg.r, outerBg.g, outerBg.b);
          if (bgDiff < intDiff * 0.65) {
            const pull = a < 210 ? 0.78 : 0.48;
            refinedPixels[i] = Math.max(0, Math.min(255, Math.round(r * (1 - pull) + ir * pull)));
            refinedPixels[i + 1] = Math.max(0, Math.min(255, Math.round(g * (1 - pull) + ig * pull)));
            refinedPixels[i + 2] = Math.max(0, Math.min(255, Math.round(b * (1 - pull) + ib * pull)));
          }
        } else if (a < 230 && a > 40) {
          const an = Math.max(0.35, a / 255);
          refinedPixels[i] = Math.max(0, Math.min(255, Math.round(outerBg.r + (r - outerBg.r) / an)));
          refinedPixels[i + 1] = Math.max(0, Math.min(255, Math.round(outerBg.g + (g - outerBg.g) / an)));
          refinedPixels[i + 2] = Math.max(0, Math.min(255, Math.round(outerBg.b + (b - outerBg.b) / an)));
        }
      }
    }
  }

  // 4) Detect exterior vs enclosed lens cavities & ensure lenses are ALWAYS semi-transparent (never filled solid!)
  const exterior = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qh = 0;
  let qt = 0;
  const pushExt = (p: number) => {
    if (!exterior[p] && feathered[p] < 48) {
      exterior[p] = 1;
      queue[qt++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    pushExt(x);
    pushExt((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    pushExt(y * w);
    pushExt(y * w + w - 1);
  }
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) pushExt(p - 1);
    if (x < w - 1) pushExt(p + 1);
    if (y > 0) pushExt(p - w);
    if (y < h - 1) pushExt(p + w);
  }

  // Frame bounding box
  let fMinX = w;
  let fMaxX = -1;
  let fMinY = h;
  let fMaxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!exterior[y * w + x] && feathered[y * w + x] >= 48) {
        if (x < fMinX) fMinX = x;
        if (x > fMaxX) fMaxX = x;
        if (y < fMinY) fMinY = y;
        if (y > fMaxY) fMaxY = y;
      }
    }
  }
  const fW = Math.max(1, fMaxX - fMinX + 1);
  const fH = Math.max(1, fMaxY - fMinY + 1);

  // Sample average top rim color to distinguish closed rim from interior lens pixels
  let rimR = 0;
  let rimG = 0;
  let rimB = 0;
  let rimCount = 0;
  if (fMaxX > fMinX) {
    for (let x = fMinX; x <= fMaxX; x += 2) {
      for (let y = fMinY; y <= Math.min(fMaxY, fMinY + Math.round(fH * 0.25)); y++) {
        const p = y * w + x;
        if (feathered[p] >= 200) {
          const i = p * 4;
          const d = rgbDist(rawRgba[i], rawRgba[i + 1], rawRgba[i + 2], outerBg.r, outerBg.g, outerBg.b);
          if (d > 22) {
            rimR += rawRgba[i];
            rimG += rawRgba[i + 1];
            rimB += rawRgba[i + 2];
            rimCount++;
            break;
          }
        }
      }
    }
  }
  const avgRim = rimCount > 0 ? { r: rimR / rimCount, g: rimG / rimCount, b: rimB / rimCount } : null;

  // Identify enclosed cavity pixels inside frame silhouette (either transparent pockets or interior background/glass)
  const isLensCandidate = new Uint8Array(total);
  for (let y = fMinY; y <= fMaxY; y++) {
    for (let x = fMinX; x <= fMaxX; x++) {
      const p = y * w + x;
      if (exterior[p]) continue;
      if (feathered[p] < 60) {
        isLensCandidate[p] = 1;
        continue;
      }
      const i = p * 4;
      const r = rawRgba[i];
      const g = rawRgba[i + 1];
      const b = rawRgba[i + 2];
      const dBg = rgbDist(r, g, b, outerBg.r, outerBg.g, outerBg.b);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const dRim = avgRim ? rgbDist(r, g, b, avgRim.r, avgRim.g, avgRim.b) : 999;

      if ((dBg <= 42 && dRim > 20) || (options.category !== 'sun' && lum > 175 && chroma < 30 && dRim > 22)) {
        isLensCandidate[p] = 1;
      } else if (options.category === 'sun' && avgRim && dRim > 28 && dBg > 24) {
        // Interior tinted sunglass region
        const relX = (x - fMinX) / fW;
        const relY = (y - fMinY) / fH;
        if (relY > 0.14 && relY < 0.88 && ((relX > 0.08 && relX < 0.45) || (relX > 0.55 && relX < 0.92))) {
          isLensCandidate[p] = 1;
        }
      }
    }
  }

  // Group connected cavities into Left Lens, Right Lens, or small bridge/nose-pad gaps
  const visited = new Uint8Array(total);
  const pockets: { pixels: number[]; cx: number; cy: number; minX: number; maxX: number; minY: number; maxY: number }[] = [];
  const minLensPx = Math.max(18, Math.round(fW * fH * 0.025));

  for (let y = fMinY; y <= fMaxY; y++) {
    for (let x = fMinX; x <= fMaxX; x++) {
      const start = y * w + x;
      if (exterior[start] || !isLensCandidate[start] || visited[start]) continue;
      qh = 0;
      qt = 0;
      visited[start] = 1;
      queue[qt++] = start;
      let sx = 0;
      let sy = 0;
      let pMinX = w;
      let pMaxX = -1;
      let pMinY = h;
      let pMaxY = -1;

      while (qh < qt) {
        const cur = queue[qh++];
        const cx = cur % w;
        const cy = (cur - cx) / w;
        sx += cx;
        sy += cy;
        if (cx < pMinX) pMinX = cx;
        if (cx > pMaxX) pMaxX = cx;
        if (cy < pMinY) pMinY = cy;
        if (cy > pMaxY) pMaxY = cy;
        const nbs = [
          cx > fMinX ? cur - 1 : -1,
          cx < fMaxX ? cur + 1 : -1,
          cy > fMinY ? cur - w : -1,
          cy < fMaxY ? cur + w : -1,
        ];
        for (const np of nbs) {
          if (np >= 0 && !exterior[np] && !visited[np] && isLensCandidate[np]) {
            visited[np] = 1;
            queue[qt++] = np;
          }
        }
      }

      const list = Array.from(queue.subarray(0, qt));
      const relCx = (sx / qt - fMinX) / fW;
      const relCy = (sy / qt - fMinY) / fH;

      if (qt < minLensPx) {
        // Small nose-pad / bridge gap -> clear to fully transparent
        if (relCx >= 0.42 && relCx <= 0.58) {
          for (const p of list) {
            const i = p * 4;
            refinedPixels[i] = 0;
            refinedPixels[i + 1] = 0;
            refinedPixels[i + 2] = 0;
            refinedPixels[i + 3] = 0;
          }
        }
        continue;
      }

      if (relCx >= 0.43 && relCx <= 0.57 && qt < fW * fH * 0.08) {
        // Bridge cutout opening -> fully transparent
        for (const p of list) {
          const i = p * 4;
          refinedPixels[i] = 0;
          refinedPixels[i + 1] = 0;
          refinedPixels[i + 2] = 0;
          refinedPixels[i + 3] = 0;
        }
        continue;
      }

      pockets.push({
        pixels: list,
        cx: relCx,
        cy: relCy,
        minX: pMinX,
        maxX: pMaxX,
        minY: pMinY,
        maxY: pMaxY,
      });
    }
  }

  const leftPocket =
    pockets.filter((c) => c.cx < 0.48).sort((a, b) => b.pixels.length - a.pixels.length)[0] || null;
  const rightPocket =
    pockets.filter((c) => c.cx > 0.52).sort((a, b) => b.pixels.length - a.pixels.length)[0] || null;

  // Determine optical vs sunglasses from lens interior pixels
  let tintedSamples = 0;
  let totalLensSamples = 0;
  let sumLr = 0;
  let sumLg = 0;
  let sumLb = 0;
  for (const pk of [leftPocket, rightPocket]) {
    if (!pk) continue;
    for (const p of pk.pixels) {
      const i = p * 4;
      const r = rawRgba[i];
      const g = rawRgba[i + 1];
      const b = rawRgba[i + 2];
      const dBg = rgbDist(r, g, b, outerBg.r, outerBg.g, outerBg.b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      totalLensSamples++;
      if (dBg > 46 && lum < 172) {
        tintedSamples++;
        sumLr += r;
        sumLg += g;
        sumLb += b;
      }
    }
  }

  const detectedCat: FrameCat =
    options.category || (totalLensSamples > 20 && tintedSamples / totalLensSamples > 0.42 ? 'sun' : 'med');
  const isSun = detectedCat === 'sun';
  let sampledLensColor = '#dbeafe';
  if (isSun && tintedSamples > 0) {
    const lr = Math.round(sumLr / tintedSamples);
    const lg = Math.round(sumLg / tintedSamples);
    const lb = Math.round(sumLb / tintedSamples);
    sampledLensColor = `#${[lr, lg, lb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } else if (isSun) {
    sampledLensColor = '#334155';
  }

  // Apply semi-transparent glass (clear optical alpha ~ 18..34; sunglasses alpha ~ 142..182, NEVER opaque 255)
  for (const pk of [leftPocket, rightPocket]) {
    if (!pk) continue;
    const spanY = Math.max(1, pk.maxY - pk.minY);
    for (const p of pk.pixels) {
      const i = p * 4;
      const x = p % w;
      const y = (p - x) / w;
      const t = (y - pk.minY) / spanY;
      const sheen = Math.max(0, 1 - Math.abs((x / Math.max(1, w)) * 1.2 - (y / Math.max(1, h)) * 0.85 - 0.12) * 3.5);

      if (isSun) {
        const r = rawRgba[i];
        const g = rawRgba[i + 1];
        const b = rawRgba[i + 2];
        refinedPixels[i] = Math.min(255, Math.round(r + sheen * 18));
        refinedPixels[i + 1] = Math.min(255, Math.round(g + sheen * 18));
        refinedPixels[i + 2] = Math.min(255, Math.round(b + sheen * 20));
        // Semi-transparent tinted sunglasses (56%..72% opacity, never solid 255)
        refinedPixels[i + 3] = Math.round(145 + sheen * 32);
      } else {
        // Clear optical glass: ultra-subtle white reflection (7%..13% opacity => alpha 18..34)
        refinedPixels[i] = 246;
        refinedPixels[i + 1] = 250;
        refinedPixels[i + 2] = 255;
        refinedPixels[i + 3] = Math.round(18 + (1 - t) * 10 + sheen * 6);
      }

      lensMaskPixels[i] = 255;
      lensMaskPixels[i + 1] = 255;
      lensMaskPixels[i + 2] = 255;
      lensMaskPixels[i + 3] = 255;
    }
  }

  const toBox = (pk: (typeof pockets)[number] | null, fallbackCx: number): LensRegionBox =>
    pk
      ? {
          cx: Number((((pk.minX + pk.maxX) * 0.5) / Math.max(1, w)).toFixed(4)),
          cy: Number((((pk.minY + pk.maxY) * 0.5) / Math.max(1, h)).toFixed(4)),
          w: Number(((pk.maxX - pk.minX + 1) / Math.max(1, w)).toFixed(4)),
          h: Number(((pk.maxY - pk.minY + 1) / Math.max(1, h)).toFixed(4)),
        }
      : { cx: fallbackCx, cy: 0.5, w: 0.34, h: 0.7 };

  return {
    refinedPixels,
    lensMaskPixels,
    outerBg,
    detectedCat,
    sampledLensColor,
    leftLensBox: toBox(leftPocket, 0.275),
    rightLensBox: toBox(rightPocket, 0.725),
  };
}

/**
 * Pure Step 4a — Measures the frame's Principal Axis orientation (2nd-moment PCA covariance eigenangle)
 * from opaque frame pixels, returning the counter-rotation angle in degrees needed to level the frame horizontally.
 */
export function computePrincipalAxisAngleDeg(
  pixels: Uint8ClampedArray,
  w: number,
  h: number
): number {
  let count = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = pixels[(y * w + x) * 4 + 3];
      if (a >= 110) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }
  if (count < 40) return 0;

  const meanX = sumX / count;
  const meanY = sumY / count;
  let mu20 = 0;
  let mu02 = 0;
  let mu11 = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = pixels[(y * w + x) * 4 + 3];
      if (a >= 110) {
        const dx = x - meanX;
        const dy = y - meanY;
        mu20 += dx * dx;
        mu02 += dy * dy;
        mu11 += dx * dy;
      }
    }
  }

  if (Math.abs(mu20 - mu02) < 1e-6 && Math.abs(mu11) < 1e-6) return 0;
  // Principal eigenvector angle relative to +X axis
  const thetaRad = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
  let deg = (thetaRad * 180) / Math.PI;
  // Normalize into [-45, 45] horizontal axis range
  if (deg > 45) deg -= 90;
  if (deg < -45) deg += 90;

  if (Math.abs(deg) < 0.6 || Math.abs(deg) > 22) return 0;
  return Number((-deg).toFixed(2));
}

/**
 * Pure Step 5 — Canvas Light Normalization on foreground pixels:
 *  1. Damped gray-world white-balance correction (removes yellow/blue lighting cast without mutating real brand colors).
 *  2. Auto-levels using 2nd..98th percentile foreground luminance.
 *  3. Mild contrast (+7%) and saturation (+8%) boost.
 */
export function normalizeLightingAutoLevelsGrayWorld(
  pixels: Uint8ClampedArray,
  w: number,
  h: number
): { applied: boolean; wbGains: [number, number, number]; contrastGain: number } {
  const total = w * h;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let fgCount = 0;
  const hist = new Uint32Array(256);

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (pixels[i + 3] < 60) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    fgCount++;
    const lum = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
    hist[lum]++;
  }

  if (fgCount < 30) {
    return { applied: false, wbGains: [1, 1, 1], contrastGain: 1 };
  }

  // 1) Damped bounded Gray-World white balance
  const avgR = Math.max(1, sumR / fgCount);
  const avgG = Math.max(1, sumG / fgCount);
  const avgB = Math.max(1, sumB / fgCount);
  const avgGray = (avgR + avgG + avgB) / 3;
  const clampGain = (raw: number) => Math.max(0.88, Math.min(1.14, 1 + (raw - 1) * 0.45));
  const wbR = clampGain(avgGray / avgR);
  const wbG = clampGain(avgGray / avgG);
  const wbB = clampGain(avgGray / avgB);

  // 2) Auto-levels via 2%..98% foreground luminance percentiles
  const lowCut = Math.floor(fgCount * 0.02);
  const highCut = Math.ceil(fgCount * 0.98);
  let acc = 0;
  let pLow = 0;
  let pHigh = 255;
  let foundLow = false;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (!foundLow && acc >= lowCut) {
      pLow = v;
      foundLow = true;
    }
    if (acc >= highCut) {
      pHigh = v;
      break;
    }
  }

  // Only stretch conservatively so dark black frames remain rich dark and specular whites don't clip
  const effLow = Math.min(48, Math.max(0, pLow - 4));
  const effHigh = Math.max(195, Math.min(255, pHigh + 4));
  const levelSpan = Math.max(40, effHigh - effLow);
  const levelGain = Math.min(1.32, 240 / levelSpan);
  const contrastFactor = 1.07;
  const satBoost = 1.08;

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (pixels[i + 3] <= 20) continue;

    // White balance
    let r = pixels[i] * wbR;
    let g = pixels[i + 1] * wbG;
    let b = pixels[i + 2] * wbB;

    // Auto-levels stretch anchored gently around effLow
    r = Math.max(0, r - effLow * 0.35) * (0.65 + 0.35 * levelGain);
    g = Math.max(0, g - effLow * 0.35) * (0.65 + 0.35 * levelGain);
    b = Math.max(0, b - effLow * 0.35) * (0.65 + 0.35 * levelGain);

    // Mild contrast around 128
    r = (r - 128) * contrastFactor + 128;
    g = (g - 128) * contrastFactor + 128;
    b = (b - 128) * contrastFactor + 128;

    // Mild saturation boost preserving luminance
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    r = luma + (r - luma) * satBoost;
    g = luma + (g - luma) * satBoost;
    b = luma + (b - luma) * satBoost;

    pixels[i] = Math.max(0, Math.min(255, Math.round(r)));
    pixels[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    pixels[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }

  return {
    applied: true,
    wbGains: [Number(wbR.toFixed(3)), Number(wbG.toFixed(3)), Number(wbB.toFixed(3))],
    contrastGain: contrastFactor,
  };
}

/**
 * Pure Step 7 — Evaluates mask confidence and detects transparent/clear crystal frames so questionable
 * isolations return `quality: 'check'` with a helpful Arabic owner review note.
 */
export function assessGlassesSegmentationQuality(
  refinedPixels: Uint8ClampedArray,
  rawPixels: Uint8ClampedArray,
  w: number,
  h: number,
  outerBg: RGBColor,
  backend: SegmentationBackend
): QualityAssessment {
  const total = Math.max(1, w * h);
  let fgPixels = 0;
  let leftFg = 0;
  let rightFg = 0;
  let transparentFramePx = 0;
  let borderCutTouchPx = 0;
  const halfX = Math.floor(w * 0.5);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      const a = refinedPixels[i + 3];
      if (a >= 72) {
        fgPixels++;
        if (x < halfX) leftFg++;
        else rightFg++;

        if (x <= 1 || x >= w - 2 || y <= 1 || y >= h - 2) {
          borderCutTouchPx++;
        }

        const r = rawPixels[i];
        const g = rawPixels[i + 1];
        const b = rawPixels[i + 2];
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const bgDiff = rgbDist(r, g, b, outerBg.r, outerBg.g, outerBg.b);
        if (chroma <= 32 && lum >= 170 && bgDiff <= 46) {
          transparentFramePx++;
        }
      }
    }
  }

  const fgRatio = fgPixels / total;
  const symmetry = fgPixels > 0 ? Math.min(leftFg, rightFg) / Math.max(1, Math.max(leftFg, rightFg)) : 0;
  const transparentRatio = fgPixels > 0 ? transparentFramePx / fgPixels : 0;
  const transparentFrameDetected = fgPixels > 20 && transparentRatio >= 0.3;

  const reasons: string[] = [];
  if (fgRatio < 0.012) {
    reasons.push('نسبة الإطار المعزول منخفضة جداً — يُنصح بالمراجعة');
  } else if (fgRatio > 0.72) {
    reasons.push('قد تتبقى أجزاء من الخلفية حول الإطار');
  }
  if (symmetry < 0.42 && fgPixels > 40) {
    reasons.push('توازن الجانبين غير متماثل — يرجى التحقق من اكتمال الإطار');
  }
  if (borderCutTouchPx > Math.max(16, w * 0.18)) {
    reasons.push('أطراف الإطار قريبة جداً من حافة الصورة');
  }
  if (transparentFrameDetected) {
    reasons.push('تم رصد إطار شفاف أو فاتح جداً — يُنصح بمراجعة حواف الإطار قبل الاعتماد');
  }

  let confidenceScore = 0.94;
  if (backend === 'fallback') confidenceScore -= 0.08;
  if (fgRatio < 0.012 || fgRatio > 0.72) confidenceScore -= 0.35;
  if (symmetry < 0.42) confidenceScore -= 0.25;
  if (transparentFrameDetected) confidenceScore -= 0.2;
  confidenceScore = Math.max(0.1, Math.min(1, Number(confidenceScore.toFixed(2))));

  const quality: PipelineQuality = reasons.length > 0 || confidenceScore < 0.75 ? 'check' : 'good';
  return {
    quality,
    confidenceScore,
    transparentFrameDetected,
    fgRatio: Number(fgRatio.toFixed(4)),
    reasons,
    noteAr: reasons[0],
  };
}

function rotateCanvas(src: AnyCanvas, angleDeg: number): AnyCanvas {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.max(1, Math.ceil(src.width * cos + src.height * sin));
  const newH = Math.max(1, Math.ceil(src.width * sin + src.height * cos));
  const dst = createWorkCanvas(newW, newH);
  const ctx = get2dCtx(dst);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return dst;
}

function findOpaqueBounds(d: Uint8ClampedArray, w: number, h: number, threshold = 32) {
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { minX: 0, maxX: Math.max(0, w - 1), minY: 0, maxY: Math.max(0, h - 1), width: w, height: h };
  }
  return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Renders the Warby Parker style studio image on #F8F7F4 background
 * with a soft contact shadow (blurred ellipse under the frame + very light drop shadow).
 */
function renderStudioStoreCanvas(cutoutCanvas: AnyCanvas): AnyCanvas {
  const fw = cutoutCanvas.width;
  const fh = cutoutCanvas.height;
  const padX = Math.max(24, Math.round(fw * 0.1));
  const padTop = Math.max(22, Math.round(fh * 0.14));
  const padBot = Math.max(30, Math.round(fh * 0.22));
  const outW = fw + padX * 2;
  const outH = fh + padTop + padBot;

  const canvas = createWorkCanvas(outW, outH);
  const ctx = get2dCtx(canvas);
  ctx.fillStyle = STUDIO_BG_HEX;
  ctx.fillRect(0, 0, outW, outH);

  // Soft contact shadow: blurred ellipse directly beneath the frame
  const shadowCx = outW * 0.5;
  const shadowCy = padTop + fh * 0.96;
  const shadowRx = fw * 0.42;
  const shadowRy = Math.max(6, fh * 0.085);

  ctx.save();
  try {
    if ('filter' in ctx) {
      ctx.filter = `blur(${Math.max(4, Math.round(fw * 0.015))}px)`;
    }
    const grad = ctx.createRadialGradient(shadowCx, shadowCy, shadowRx * 0.1, shadowCx, shadowCy, shadowRx);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.22)');
    grad.addColorStop(0.65, 'rgba(15, 23, 42, 0.09)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(shadowCx, shadowCy, shadowRx, shadowRy, 0, 0, Math.PI * 2);
    ctx.fill();
  } finally {
    ctx.restore();
  }

  // Draw frame with very light drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.11)';
  ctx.shadowBlur = Math.max(6, Math.round(fw * 0.014));
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(3, Math.round(fh * 0.025));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cutoutCanvas, padX, padTop, fw, fh);
  ctx.restore();

  return canvas;
}

function sampleDominantHexColor(d: Uint8ClampedArray, w: number, h: number): string {
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 180) continue;
      const key = `${d[i] >> 4}-${d[i + 1] >> 4}-${d[i + 2] >> 4}`;
      const cur = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
      cur.r += d[i];
      cur.g += d[i + 1];
      cur.b += d[i + 2];
      cur.count++;
      buckets.set(key, cur);
    }
  }
  let best: { r: number; g: number; b: number; count: number } | null = null;
  for (const item of buckets.values()) {
    if (!best || item.count > best.count) best = item;
  }
  if (!best) return '#1f2937';
  const r = Math.round(best.r / best.count);
  const g = Math.round(best.g / best.count);
  const b = Math.round(best.b / best.count);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function inferMaterialAndType(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  frameHex: string
): { material: FrameMaterial; type: FrameType } {
  let opaqueCols = 0;
  let totalRun = 0;
  let runCount = 0;
  for (let y = Math.floor(h * 0.14); y < Math.floor(h * 0.86); y += 3) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] >= 180) run++;
      else if (run > 0) {
        totalRun += run;
        runCount++;
        run = 0;
      }
    }
    if (run > 0) {
      totalRun += run;
      runCount++;
    }
  }
  for (let x = 0; x < w; x++) {
    if (d[(Math.floor(h * 0.5) * w + x) * 4 + 3] >= 180) opaqueCols++;
  }
  const avgStroke = runCount > 0 ? totalRun / runCount : 8;
  const thinRatio = avgStroke / Math.max(1, w);
  const r = parseInt(frameHex.slice(1, 3), 16) || 100;
  const g = parseInt(frameHex.slice(3, 5), 16) || 100;
  const b = parseInt(frameHex.slice(5, 7), 16) || 100;
  const metallic = (r > 155 && g > 125 && b < 110) || (Math.max(r, g, b) > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 26);

  const material: FrameMaterial = thinRatio < 0.032 || metallic ? 'metal' : 'tr_plastic';
  const aspect = h / Math.max(1, w);
  let type: FrameType = 'wayfarer';
  if (thinRatio < 0.016 && opaqueCols < w * 0.14) type = 'rimless';
  else if (material === 'metal' && aspect >= 0.37) type = 'aviator';
  else if (aspect >= 0.43) type = 'round';
  else if (aspect < 0.34) type = 'cat';
  return { material, type };
}

/**
 * Pure End-to-End Client-Side Product Image Pipeline:
 *  `processGlassesImage(file) -> { storeImage, cutoutImage, quality }`
 *
 * Works cleanly inside Web Workers (OffscreenCanvas + createImageBitmap) and main-thread fallback.
 */
export async function processGlassesImage(
  file: File | Blob,
  options: ProcessGlassesImageOptions = {}
): Promise<ProcessedGlassesResult> {
  const maxSidePx = Math.min(1024, options.maxSidePx || 1024);
  const canvases: AnyCanvas[] = [];
  const track = <T extends AnyCanvas>(c: T): T => {
    canvases.push(c);
    return c;
  };

  try {
    options.onStage?.('جاري قراءة الصورة وتصحيح الاتجاه...');
    const sourceCanvas = track(await decodeAndDownscaleWithExif(file, maxSidePx));
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    const rawRgba = get2dCtx(sourceCanvas).getImageData(0, 0, sw, sh).data;
    const outerBg = sampleOuterCornerMedianColor(rawRgba, sw, sh);

    options.onStage?.('جاري عزل النظارة محلياً بالذكاء الاصطناعي...');
    const nnMask = await runLocalU2NetMask(sourceCanvas);
    const backendUsed: SegmentationBackend = nnMask ? nnMask.backend : 'fallback';
    const initialMask = nnMask ? nnMask.alphaMask : buildFallbackForegroundMask(rawRgba, sw, sh, outerBg);

    options.onStage?.('جاري تنقية الحواف وإزالة الهالات والعدسات...');
    const refined = refineGlassesMaskAndDecontaminate(rawRgba, initialMask, sw, sh, {
      category: options.category,
      outerBg,
    });

    // Quality evaluation prior to tight cropping so border/coverage ratios remain accurate
    const qualityAssessment = assessGlassesSegmentationQuality(
      refined.refinedPixels,
      rawRgba,
      sw,
      sh,
      outerBg,
      backendUsed
    );

    options.onStage?.('جاري موازنة الإضاءة والألوان...');
    normalizeLightingAutoLevelsGrayWorld(refined.refinedPixels, sw, sh);

    const refinedCanvas = track(createWorkCanvas(sw, sh));
    const refCtx = get2dCtx(refinedCanvas);
    const refImgData = refCtx.createImageData(sw, sh);
    refImgData.data.set(refined.refinedPixels);
    refCtx.putImageData(refImgData, 0, 0);

    const maskCanvas = track(createWorkCanvas(sw, sh));
    const mCtx = get2dCtx(maskCanvas);
    const mImgData = mCtx.createImageData(sw, sh);
    mImgData.data.set(refined.lensMaskPixels);
    mCtx.putImageData(mImgData, 0, 0);

    // Step 4: Deskew based on principal axis (front shots), auto-crop tightly & center with even padding
    const deskewAngleDeg =
      options.angleType === 'angled45' ? 0 : computePrincipalAxisAngleDeg(refined.refinedPixels, sw, sh);

    const leveledCut = Math.abs(deskewAngleDeg) >= 0.6 ? track(rotateCanvas(refinedCanvas, deskewAngleDeg)) : refinedCanvas;
    const leveledMask = Math.abs(deskewAngleDeg) >= 0.6 ? track(rotateCanvas(maskCanvas, deskewAngleDeg)) : maskCanvas;

    const lw = leveledCut.width;
    const lh = leveledCut.height;
    const leveledRgba = get2dCtx(leveledCut).getImageData(0, 0, lw, lh).data;
    const tight = findOpaqueBounds(leveledRgba, lw, lh, 32);

    const padX = Math.max(8, Math.round(tight.width * 0.04));
    const padY = Math.max(8, Math.round(tight.height * 0.06));
    const outW = Math.min(maxSidePx, tight.width + padX * 2);
    const outH = Math.max(1, Math.round((tight.height + padY * 2) * (outW / Math.max(1, tight.width + padX * 2))));
    const scale = outW / Math.max(1, tight.width + padX * 2);
    const dstPadX = padX * scale;
    const dstPadY = padY * scale;

    const centeredCutCanvas = track(createWorkCanvas(outW, outH));
    const ccCtx = get2dCtx(centeredCutCanvas);
    ccCtx.imageSmoothingEnabled = true;
    ccCtx.imageSmoothingQuality = 'high';
    ccCtx.drawImage(
      leveledCut,
      tight.minX,
      tight.minY,
      tight.width,
      tight.height,
      dstPadX,
      dstPadY,
      tight.width * scale,
      tight.height * scale
    );

    const centeredMaskCanvas = track(createWorkCanvas(outW, outH));
    const cmCtx = get2dCtx(centeredMaskCanvas);
    cmCtx.drawImage(
      leveledMask,
      tight.minX,
      tight.minY,
      tight.width,
      tight.height,
      dstPadX,
      dstPadY,
      tight.width * scale,
      tight.height * scale
    );

    // Step 6: Render storeImage (#F8F7F4 + soft contact shadow) and export both WebP outputs
    options.onStage?.('جاري تصدير نسختي المتجر والتجربة الحية...');
    const studioCanvas = track(renderStudioStoreCanvas(centeredCutCanvas));

    const [cutoutImage, storeImage, maskOut] = await Promise.all([
      exportWebpAsset(centeredCutCanvas, 0.88),
      exportWebpAsset(studioCanvas, 0.88),
      exportWebpAsset(centeredMaskCanvas, 0.85),
    ]);

    const finalCutData = ccCtx.getImageData(0, 0, outW, outH).data;
    const sampledFrameColor = sampleDominantHexColor(finalCutData, outW, outH);
    const inferred = inferMaterialAndType(finalCutData, outW, outH, sampledFrameColor);
    const detectedMaterial: FrameMaterial = options.material || inferred.material;
    const frameWidthMm = options.frameWidthMm || 136;
    const opticalDimensions = options.opticalDimensions || '52-18-140';
    const fitScale = options.fitScale ?? 1.0;
    const eyeLineOffset = options.eyeLineOffset ?? 0.04;
    const aspectRatio = Number((outH / Math.max(1, outW)).toFixed(4));
    const bridgeCenterX = Number(((refined.leftLensBox.cx + refined.rightLensBox.cx) * 0.5).toFixed(4));
    const bridgeCenterY = Number(((refined.leftLensBox.cy + refined.rightLensBox.cy) * 0.5 * 0.92).toFixed(4));

    const calibration: ModelCalibration = {
      frameWidthMm,
      opticalDimensions,
      material: detectedMaterial,
      bridgeCenterX,
      bridgeCenterY,
      tiltCorrectionDeg: deskewAngleDeg,
      isSunglasses: refined.detectedCat === 'sun',
      lensMaskUrl: maskOut.dataUrl,
      storeFrontUrl: storeImage.dataUrl,
      tryOnFrontUrl: cutoutImage.dataUrl,
      aspectRatio,
      fitScale,
      eyeLineOffset,
      leftLensBox: refined.leftLensBox,
      rightLensBox: refined.rightLensBox,
    };

    return {
      storeImage,
      cutoutImage,
      lensMask: { blob: maskOut.blob, dataUrl: maskOut.dataUrl },
      quality: qualityAssessment.quality,
      qualityAssessment,
      qualityNoteAr: qualityAssessment.noteAr,
      backendUsed,
      deskewAngleDeg,
      width: outW,
      height: outH,
      aspectRatio,
      sampledFrameColor,
      sampledLensColor: refined.sampledLensColor,
      detectedCat: refined.detectedCat,
      detectedMaterial,
      detectedType: inferred.type,
      leftLensBox: refined.leftLensBox,
      rightLensBox: refined.rightLensBox,
      calibration,
    };
  } finally {
    for (const c of canvases) {
      releaseCanvas(c);
    }
  }
}
