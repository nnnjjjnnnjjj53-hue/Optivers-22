import { EyewearFrameMode, EyewearSubMode, FrameCat, FrameMaterial, FrameType, LensRegionBox, ModelCalibration } from '../types';
import { processGlassesImage, PipelineQuality } from '../utils/glassesImagePipeline';

export type ChromaKeyKind = 'blue' | 'green' | 'magenta';

export interface ChromaKeyDetection {
  kind: ChromaKeyKind | null;
  rgb: { r: number; g: number; b: number };
}

export interface BfsLensResult {
  pixels: Uint8ClampedArray;
  maskPixels: Uint8ClampedArray;
  leftLensBox: LensRegionBox;
  rightLensBox: LensRegionBox;
  sampledLensColor: string;
}

export interface CutoutCropBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface CutoutWorkerOptions {
  frameType?: EyewearFrameMode;
  subCategory?: EyewearSubMode;
  isClipOnAttachment?: boolean;
  material?: FrameMaterial;
  frameWidthMm?: number;
  opticalDimensions?: string;
  fitScale?: number;
  eyeLineOffset?: number;
}

export interface CutoutWorkerOutput {
  imagePath: { blob: Blob; dataUrl: string; ext: 'webp' | 'png' }; // 1200px transparent cutout
  frontCatalogPath: { blob: Blob; dataUrl: string; ext: 'webp' | 'png' }; // 1200x900 #F8F9FA studio shot
  sideImagePath: { blob: Blob; dataUrl: string; ext: 'webp' | 'png' }; // 1200x900 #F8F9FA 3/4 side shot
  lensMask: { blob: Blob; dataUrl: string };
  aspectRatio: number;
  aspectRatioValid: boolean;
  frameHexColor: string;
  frameOpacity: number;
  sampledLensColor: string;
  detectedCat: FrameCat;
  detectedMaterial: FrameMaterial;
  detectedType: FrameType;
  quality: PipelineQuality;
  qualityNoteAr?: string;
  width: number;
  height: number;
  calibration: ModelCalibration;
}

export type CutoutWorkerRequest = {
  id: string;
  frontFile: Blob;
  sideFile?: Blob;
  splitSheetFile?: Blob;
  options: CutoutWorkerOptions;
};

export type CutoutWorkerResponse =
  | { id: string; kind: 'stage'; stageLabelAr: string }
  | { id: string; kind: 'done'; result: CutoutWorkerOutput }
  | { id: string; kind: 'error'; message: string };

const STUDIO_WHITE_HEX = '#F8F9FA';

function rgbDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Pure: Inspects outer corners & perimeter strips to detect vivid Chroma-Key backdrops
 * (#0000FF blue, #00FF00 green, or #FF00FF magenta) vs natural photos (returns null).
 */
export function detectChromaKeyColor(
  raw: Uint8ClampedArray,
  w: number,
  h: number
): ChromaKeyDetection {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const patch = Math.max(2, Math.min(8, Math.floor(Math.min(w, h) * 0.05)));

  const sampleCorner = (x0: number, y0: number) => {
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

  sampleCorner(0, 0);
  sampleCorner(Math.max(0, w - patch), 0);
  sampleCorner(0, Math.max(0, h - patch));
  sampleCorner(Math.max(0, w - patch), Math.max(0, h - patch));

  if (rs.length === 0) {
    return { kind: null, rgb: { r: 248, g: 249, b: 250 } };
  }

  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  const r = rs[mid];
  const g = gs[mid];
  const b = bs[mid];

  // Blue (#0000FF)
  if (b >= 175 && b - Math.max(r, g) >= 85) {
    return { kind: 'blue', rgb: { r, g, b } };
  }
  // Green (#00FF00)
  if (g >= 175 && g - Math.max(r, b) >= 85) {
    return { kind: 'green', rgb: { r, g, b } };
  }
  // Magenta (#FF00FF)
  if (r >= 170 && b >= 170 && Math.min(r, b) - g >= 80) {
    return { kind: 'magenta', rgb: { r, g, b } };
  }

  return { kind: null, rgb: { r, g, b } };
}

/**
 * Pure: Applies Chroma-Key matte + Smart Edge Despill.
 *  - Metal mode (`frameType === 'metal'`): thin-wire protection `35..75` distance thresholds.
 *  - Standard modes: `45..95` distance thresholds.
 *  - Despills edge channel `ch = Math.min(ch, Math.max(other1, other2))` to strip neon halos.
 */
export function applyChromaKeyAndDespill(
  raw: Uint8ClampedArray,
  w: number,
  h: number,
  keyKind: ChromaKeyKind,
  keyRgb: { r: number; g: number; b: number },
  frameType: EyewearFrameMode = 'prescription'
): Uint8ClampedArray {
  const total = w * h;
  const out = new Uint8ClampedArray(raw);
  const lowThresh = frameType === 'metal' ? 35 : 45;
  const highThresh = frameType === 'metal' ? 75 : 95;
  const span = Math.max(1, highThresh - lowThresh);

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const origA = raw[i + 3];
    if (origA < 16) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    const d = rgbDistance(r, g, b, keyRgb.r, keyRgb.g, keyRgb.b);

    let alpha: number;
    if (d < lowThresh) {
      alpha = 0;
    } else if (d > highThresh) {
      alpha = origA;
    } else {
      alpha = Math.min(origA, Math.round(((d - lowThresh) / span) * 255));
    }

    out[i + 3] = alpha;
    if (alpha === 0) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      continue;
    }

    // Smart edge despill on semi-transparent / key-tinged rim pixels
    const nearEdge = alpha < 252 || d < highThresh * 1.45;
    if (nearEdge) {
      if (keyKind === 'blue') {
        out[i + 2] = Math.min(b, Math.max(r, g));
      } else if (keyKind === 'green') {
        out[i + 1] = Math.min(g, Math.max(r, b));
      } else if (keyKind === 'magenta') {
        const capR = Math.min(r, Math.max(g, Math.round((g + b) * 0.5)));
        const capB = Math.min(b, Math.max(g, Math.round((g + r) * 0.5)));
        out[i] = Math.min(r, Math.max(g, capR));
        out[i + 2] = Math.min(b, Math.max(g, capB));
      }
    }
  }

  return out;
}

/**
 * Pure: BFS Flood-Fill from the 4 image edges (`alpha < 50`):
 *  - Border-connected background pockets -> transparent `alpha = 0`.
 *  - Interior enclosed pockets (`area >= total * 0.03`):
 *      - Optical modes -> crisp subtle glass reflection `rgba(255, 255, 255, 0.08)` (`alpha = 20`) + lens mask.
 *      - Sunglasses / sun-clip-on modes (`skipSunglasses: true`) -> untouched original tinted lenses!
 *  - Small enclosed cutouts (`area < total * 0.03`, e.g., nose-pad / bridge gaps) -> `alpha = 0`.
 */
export function applyBfsLensFloodFill(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  options: { skipSunglasses?: boolean } = {}
): BfsLensResult {
  const total = w * h;
  const out = new Uint8ClampedArray(pixels);
  const maskPixels = new Uint8ClampedArray(total * 4);
  const region = new Uint8Array(total); // 1 = exterior bg
  const queue = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;

  const isBgPixel = (p: number) => out[p * 4 + 3] < 50;

  const seedBorder = (x: number, y: number) => {
    const p = y * w + x;
    if (region[p] === 0 && isBgPixel(p)) {
      region[p] = 1;
      queue[qTail++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    seedBorder(x, 0);
    seedBorder(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    seedBorder(0, y);
    seedBorder(w - 1, y);
  }

  const dx4 = [-1, 1, 0, 0];
  const dy4 = [0, 0, -1, 1];
  while (qHead < qTail) {
    const p = queue[qHead++];
    const x = p % w;
    const y = (p - x) / w;
    for (let k = 0; k < 4; k++) {
      const nx = x + dx4[k];
      const ny = y + dy4[k];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const np = ny * w + nx;
      if (region[np] === 0 && isBgPixel(np)) {
        region[np] = 1;
        queue[qTail++] = np;
      }
    }
  }

  for (let p = 0; p < total; p++) {
    if (region[p] === 1 && out[p * 4 + 3] < 50) {
      const i = p * 4;
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
    }
  }

  const lensAreaThreshold = Math.max(16, total * 0.03);
  const visited = new Uint8Array(total);
  const lensBoxes: LensRegionBox[] = [];

  for (let start = 0; start < total; start++) {
    if (region[start] !== 0 || !isBgPixel(start) || visited[start]) continue;
    let cHead = 0;
    let cTail = 0;
    visited[start] = 1;
    queue[cTail++] = start;

    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    const comp: number[] = [];

    while (cHead < cTail) {
      const p = queue[cHead++];
      comp.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let k = 0; k < 4; k++) {
        const nx = x + dx4[k];
        const ny = y + dy4[k];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const np = ny * w + nx;
        if (region[np] === 0 && isBgPixel(np) && !visited[np]) {
          visited[np] = 1;
          queue[cTail++] = np;
        }
      }
    }

    if (comp.length >= lensAreaThreshold) {
      if (!options.skipSunglasses) {
        for (const p of comp) {
          const i = p * 4;
          // Optical glass sheen rgba(255, 255, 255, 0.08) -> alpha = 20
          out[i] = 255;
          out[i + 1] = 255;
          out[i + 2] = 255;
          out[i + 3] = 20;

          maskPixels[i] = 255;
          maskPixels[i + 1] = 255;
          maskPixels[i + 2] = 255;
          maskPixels[i + 3] = 255;
        }
      }
      lensBoxes.push({
        cx: Number((((minX + maxX) * 0.5) / Math.max(1, w)).toFixed(4)),
        cy: Number((((minY + maxY) * 0.5) / Math.max(1, h)).toFixed(4)),
        w: Number(((maxX - minX + 1) / Math.max(1, w)).toFixed(4)),
        h: Number(((maxY - minY + 1) / Math.max(1, h)).toFixed(4)),
      });
    } else {
      // Small bridge / nose-pad cutouts -> fully transparent alpha = 0
      for (const p of comp) {
        const i = p * 4;
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
      }
    }
  }

  lensBoxes.sort((a, b) => a.cx - b.cx);
  const leftLensBox = lensBoxes[0] || { cx: 0.275, cy: 0.5, w: 0.34, h: 0.7 };
  const rightLensBox =
    lensBoxes.length > 1 ? lensBoxes[lensBoxes.length - 1] : { cx: 0.725, cy: 0.5, w: 0.34, h: 0.7 };

  let sampledLensColor = '#dbeafe';
  if (options.skipSunglasses) {
    const lx = Math.round(w * 0.3);
    const rx = Math.round(w * 0.7);
    const py = Math.round(h * 0.5);
    const li = (py * w + lx) * 4;
    const ri = (py * w + rx) * 4;
    if (out[li + 3] >= 80 && out[ri + 3] >= 80) {
      const mr = Math.round((out[li] + out[ri]) * 0.5);
      const mg = Math.round((out[li + 1] + out[ri + 1]) * 0.5);
      const mb = Math.round((out[li + 2] + out[ri + 2]) * 0.5);
      sampledLensColor = `#${[mr, mg, mb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    } else {
      sampledLensColor = '#334155';
    }
  }

  return {
    pixels: out,
    maskPixels,
    leftLensBox,
    rightLensBox,
    sampledLensColor,
  };
}

/**
 * Pure: Computes median R/G/B of opaque rim pixels to color-match 3D side temples
 * cleanly without noise, plus detects light crystal acetate frames (`frameOpacity = 0.75`).
 */
export function computeMedianFrameHexAndOpacity(
  pixels: Uint8ClampedArray,
  w: number,
  h: number
): { frameHexColor: string; frameOpacity: number } {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 70));

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (pixels[i + 3] < 180) continue;
      rs.push(pixels[i]);
      gs.push(pixels[i + 1]);
      bs.push(pixels[i + 2]);
    }
  }

  if (rs.length === 0) {
    return { frameHexColor: '#1f2937', frameOpacity: 1.0 };
  }

  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  const r = rs[mid];
  const g = gs[mid];
  const b = bs[mid];
  const frameHexColor = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const frameOpacity = lum > 195 && chroma < 28 ? 0.75 : 1.0;

  return { frameHexColor, frameOpacity };
}

/**
 * Pure: Tight bounding box (`alpha > threshold`) with uniform `padPx` padding (+8px default).
 */
export function computeTightCropBounds(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  padPx = 8,
  alphaThreshold = 45
): CutoutCropBounds {
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3] > alphaThreshold) {
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

  const x0 = Math.max(0, minX - padPx);
  const y0 = Math.max(0, minY - padPx);
  const x1 = Math.min(w - 1, maxX + padPx);
  const y1 = Math.min(h - 1, maxY + padPx);

  return {
    minX: x0,
    maxX: x1,
    minY: y0,
    maxY: y1,
    width: Math.max(1, x1 - x0 + 1),
    height: Math.max(1, y1 - y0 + 1),
  };
}

export function validateEyewearAspectRatio(width: number, height: number): { aspectRatio: number; valid: boolean } {
  const ratio = Number((width / Math.max(1, height)).toFixed(4));
  return {
    aspectRatio: ratio,
    valid: ratio >= 2.0 && ratio <= 4.5,
  };
}

export interface VerticalSplitRegions {
  midX: number;
  left: { x: number; y: number; width: number; height: number };
  right: { x: number; y: number; width: number; height: number };
}

/**
 * Pure: Splits a 16:9 side-by-side studio sheet cleanly down the exact vertical center (midX = floor(width / 2)).
 *  - Left half (0 .. midX): flat orthographic front view on chroma-key backdrop.
 *  - Right half (midX .. width): ~35° 3/4 side studio catalog view on #F8F9FA with soft shadow.
 */
export function computeVerticalSplitRegions(width: number, height: number): VerticalSplitRegions {
  const safeW = Math.max(2, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const midX = Math.floor(safeW / 2);
  return {
    midX,
    left: { x: 0, y: 0, width: midX, height: safeH },
    right: { x: midX, y: 0, width: Math.max(1, safeW - midX), height: safeH },
  };
}

/**
 * Pure: Trims excess uniform outer studio whitespace (#F8F9FA / #FFFFFF) around the right-half 3/4 shot
 * while intentionally preserving the natural soft drop shadow beneath the frame and temple tips.
 */
export function trimStudioWhitespaceBounds(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  padPx = 24
): CutoutCropBounds {
  // Sample outer 4 corners to detect the right-half studio background color
  const patch = Math.max(2, Math.min(6, Math.floor(Math.min(w, h) * 0.04)));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const sampleCorner = (x0: number, y0: number) => {
    for (let dy = 0; dy < patch; dy++) {
      for (let dx = 0; dx < patch; dx++) {
        const x = Math.max(0, Math.min(w - 1, x0 + dx));
        const y = Math.max(0, Math.min(h - 1, y0 + dy));
        const i = (y * w + x) * 4;
        if (pixels[i + 3] < 200) continue;
        rs.push(pixels[i]);
        gs.push(pixels[i + 1]);
        bs.push(pixels[i + 2]);
      }
    }
  };
  sampleCorner(0, 0);
  sampleCorner(Math.max(0, w - patch), 0);
  sampleCorner(0, Math.max(0, h - patch));
  sampleCorner(Math.max(0, w - patch), Math.max(0, h - patch));

  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  const bgR = rs.length ? rs[mid] : 248;
  const bgG = gs.length ? gs[mid] : 249;
  const bgB = bs.length ? bs[mid] : 250;

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (pixels[i + 3] < 20) continue;
      // Threshold = 9 preserves subtle soft contact shadows while trimming flat studio margins
      const dist = rgbDistance(pixels[i], pixels[i + 1], pixels[i + 2], bgR, bgG, bgB);
      if (dist > 9) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      minX: 0,
      maxX: Math.max(0, w - 1),
      minY: 0,
      maxY: Math.max(0, h - 1),
      width: Math.max(1, w),
      height: Math.max(1, h),
    };
  }

  const x0 = Math.max(0, minX - padPx);
  const y0 = Math.max(0, minY - padPx);
  const x1 = Math.min(w - 1, maxX + padPx);
  const y1 = Math.min(h - 1, maxY + padPx);

  return {
    minX: x0,
    maxX: x1,
    minY: y0,
    maxY: y1,
    width: Math.max(1, x1 - x0 + 1),
    height: Math.max(1, y1 - y0 + 1),
  };
}

// ---------- Canvas & Worker Execution Utilities ----------

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createCanvasLocal(w: number, h: number): AnyCanvas {
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(cw, ch);
  }
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  return c;
}

function getCtx2d(c: AnyCanvas): AnyCtx {
  const ctx = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!ctx) throw new Error('2D context unavailable');
  return ctx as AnyCtx;
}

function disposeWorkCanvas(c: AnyCanvas | null | undefined): void {
  if (!c) return;
  try {
    c.width = 0;
    c.height = 0;
  } catch {
    // ignore
  }
}

async function canvasToBlobSafe(c: AnyCanvas, mime: string, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && c instanceof OffscreenCanvas) {
    return c.convertToBlob({ type: mime, quality });
  }
  const html = c as HTMLCanvasElement;
  return new Promise((resolve, reject) => {
    html.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, quality);
  });
}

async function blobToDataUrlSafe(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('FileReader failed'));
      fr.readAsDataURL(blob);
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

async function exportAsset(
  c: AnyCanvas,
  preferMime: 'image/webp' | 'image/png' = 'image/webp',
  quality = 0.88
): Promise<{ blob: Blob; dataUrl: string; ext: 'webp' | 'png' }> {
  let blob: Blob;
  let ext: 'webp' | 'png' = preferMime === 'image/png' ? 'png' : 'webp';
  try {
    blob = await canvasToBlobSafe(c, preferMime, quality);
    if (!blob || blob.size === 0 || (preferMime === 'image/webp' && blob.type !== 'image/webp')) {
      throw new Error('WebP export unsupported');
    }
  } catch {
    blob = await canvasToBlobSafe(c, 'image/png', 1);
    ext = 'png';
  }
  const dataUrl = await blobToDataUrlSafe(blob);
  return { blob, dataUrl, ext };
}

async function decodeBlobToCanvas(blob: Blob, maxWidth = 1200): Promise<AnyCanvas> {
  if (typeof createImageBitmap === 'function') {
    let bm: ImageBitmap | null = null;
    try {
      bm = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      try {
        bm = await createImageBitmap(blob);
      } catch {
        bm = null;
      }
    }
    if (bm) {
      try {
        const scale = bm.width > maxWidth ? maxWidth / bm.width : 1;
        const w = Math.max(1, Math.round(bm.width * scale));
        const h = Math.max(1, Math.round(bm.height * scale));
        const c = createCanvasLocal(w, h);
        const ctx = getCtx2d(c);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bm, 0, 0, w, h);
        return c;
      } finally {
        try {
          bm.close();
        } catch {
          // ignore
        }
      }
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('تعذر تحميل الصورة'));
      el.src = url;
    });
    const nw = img.naturalWidth || img.width || 1;
    const nh = img.naturalHeight || img.height || 1;
    const scale = nw > maxWidth ? maxWidth / nw : 1;
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const c = createCanvasLocal(w, h);
    const ctx = getCtx2d(c);
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Composites centered frame + soft ground contact ellipse shadow onto 1200x900 `#F8F9FA` white studio card.
 */
function renderStudio1200x900Front(cutoutCanvas: AnyCanvas): AnyCanvas {
  const W = 1200;
  const H = 900;
  const out = createCanvasLocal(W, H);
  const ctx = getCtx2d(out);
  ctx.fillStyle = STUDIO_WHITE_HEX;
  ctx.fillRect(0, 0, W, H);

  const maxDrawW = 920;
  const maxDrawH = 580;
  const scale = Math.min(maxDrawW / Math.max(1, cutoutCanvas.width), maxDrawH / Math.max(1, cutoutCanvas.height));
  const dw = Math.round(cutoutCanvas.width * scale);
  const dh = Math.round(cutoutCanvas.height * scale);
  const dx = Math.round((W - dw) * 0.5);
  const dy = Math.round((H - dh) * 0.46);

  // Subtle floor contact shadow beneath the frame
  const scx = W * 0.5;
  const scy = dy + dh + 26;
  ctx.save();
  try {
    if ('filter' in ctx) ctx.filter = 'blur(12px)';
    const grad = ctx.createRadialGradient(scx, scy, dw * 0.08, scx, scy, dw * 0.46);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.22)');
    grad.addColorStop(0.65, 'rgba(15, 23, 42, 0.08)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(scx, scy, dw * 0.45, Math.max(12, dh * 0.08), 0, 0, Math.PI * 2);
    ctx.fill();
  } finally {
    ctx.restore();
  }

  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.12)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 10;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cutoutCanvas, dx, dy, dw, dh);
  ctx.restore();

  return out;
}

/**
 * Generates a realistic ~35° 3/4 Side Perspective studio image (1200x900 `#F8F9FA`)
 * with subtle foreshortening, color-matched curved side temple arm, and ground shadow.
 */
function renderStudio1200x900SidePerspective(
  cutoutCanvas: AnyCanvas,
  frameHex: string,
  frameOpacity: number,
  isMetal: boolean
): AnyCanvas {
  const W = 1200;
  const H = 900;
  const out = createCanvasLocal(W, H);
  const ctx = getCtx2d(out);
  ctx.fillStyle = STUDIO_WHITE_HEX;
  ctx.fillRect(0, 0, W, H);

  const targetFrontW = 680;
  const baseScale = Math.min(targetFrontW / Math.max(1, cutoutCanvas.width), 500 / Math.max(1, cutoutCanvas.height));
  const fullW = Math.round(cutoutCanvas.width * baseScale);
  const fullH = Math.round(cutoutCanvas.height * baseScale);

  // Horizontal foreshortening ~cos(35°) = 0.82 + subtle slice shear for realistic 3/4 depth
  const foreshortenW = Math.round(fullW * 0.82);
  const centerX = W * 0.44;
  const centerY = H * 0.48;
  const frontLeft = Math.round(centerX - foreshortenW * 0.5);
  const frontTop = Math.round(centerY - fullH * 0.5);

  // Soft studio contact shadow underneath angled frame & temple
  ctx.save();
  try {
    if ('filter' in ctx) ctx.filter = 'blur(14px)';
    const grad = ctx.createRadialGradient(W * 0.52, frontTop + fullH + 34, 40, W * 0.52, frontTop + fullH + 34, fullW * 0.55);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.22)');
    grad.addColorStop(0.65, 'rgba(15, 23, 42, 0.08)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(W * 0.52, frontTop + fullH + 34, fullW * 0.52, 22, -0.06, 0, Math.PI * 2);
    ctx.fill();
  } finally {
    ctx.restore();
  }

  // Far back left temple tucked partially behind front frame
  const strokeW = isMetal ? 10 : 18;
  ctx.save();
  ctx.globalAlpha = Math.max(0.5, frameOpacity * 0.85);
  ctx.strokeStyle = frameHex;
  ctx.lineWidth = Math.max(6, strokeW * 0.82);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(frontLeft + 18, frontTop + fullH * 0.3);
  ctx.quadraticCurveTo(frontLeft + 170, frontTop + fullH * 0.24, frontLeft + 340, frontTop + fullH * 0.27);
  ctx.quadraticCurveTo(frontLeft + 390, frontTop + fullH * 0.28, frontLeft + 412, frontTop + fullH * 0.46);
  ctx.stroke();
  ctx.restore();

  // Draw foreshortened front frame with slight perspective trapezoid vertical taper
  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.14)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 8;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const strips = 32;
  const srcStripW = cutoutCanvas.width / strips;
  const dstStripW = foreshortenW / strips;
  for (let s = 0; s < strips; s++) {
    const t = s / Math.max(1, strips - 1); // 0 (left/near) -> 1 (right/far)
    const vScale = 1.04 - t * 0.1;
    const yShift = fullH * (1 - vScale) * 0.5 - t * 14;
    ctx.drawImage(
      cutoutCanvas,
      s * srcStripW,
      0,
      Math.ceil(srcStripW) + 0.5,
      cutoutCanvas.height,
      frontLeft + s * dstStripW,
      frontTop + yShift,
      dstStripW + 0.8,
      fullH * vScale
    );
  }
  ctx.restore();

  // Foreground right temple arm extending from right hinge back & hooking smoothly down
  const hingeX = frontLeft + foreshortenW - 14;
  const hingeY = frontTop + fullH * 0.28 - 10;
  const earStart = { x: hingeX + 220, y: hingeY + 12 };
  const tipEnd = { x: hingeX + 278, y: hingeY + 96 };

  ctx.save();
  ctx.globalAlpha = frameOpacity;
  ctx.shadowColor = 'rgba(15, 23, 42, 0.16)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 8;
  ctx.strokeStyle = frameHex;
  ctx.lineWidth = strokeW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(hingeX, hingeY);
  ctx.lineTo(earStart.x, earStart.y);
  ctx.quadraticCurveTo(earStart.x + 42, earStart.y + 8, tipEnd.x, tipEnd.y);
  ctx.stroke();

  // Metallic specular highlight along temple arm
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = isMetal ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(2, strokeW * 0.28);
  ctx.beginPath();
  ctx.moveTo(hingeX + 4, hingeY - 2);
  ctx.lineTo(earStart.x - 4, earStart.y - 2);
  ctx.stroke();
  ctx.restore();

  return out;
}

/**
 * Centers the trimmed right-half AI 3/4 side studio shot (with its natural bottom contact shadow)
 * onto a clean 1200x900 `#F8F9FA` catalog card.
 */
function renderStudio1200x900RightCatalog(trimmedRightCanvas: AnyCanvas): AnyCanvas {
  const W = 1200;
  const H = 900;
  const out = createCanvasLocal(W, H);
  const ctx = getCtx2d(out);
  ctx.fillStyle = STUDIO_WHITE_HEX;
  ctx.fillRect(0, 0, W, H);

  const maxDrawW = 960;
  const maxDrawH = 680;
  const scale = Math.min(
    maxDrawW / Math.max(1, trimmedRightCanvas.width),
    maxDrawH / Math.max(1, trimmedRightCanvas.height)
  );
  const dw = Math.round(trimmedRightCanvas.width * scale);
  const dh = Math.round(trimmedRightCanvas.height * scale);
  const dx = Math.round((W - dw) * 0.5);
  const dy = Math.round((H - dh) * 0.5);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(trimmedRightCanvas, dx, dy, dw, dh);
  return out;
}

export async function processCutoutFrame(
  frontFile: Blob,
  sideFile?: Blob,
  options: CutoutWorkerOptions = {},
  onStage?: (stageLabelAr: string) => void,
  splitSheetFile?: Blob
): Promise<CutoutWorkerOutput> {
  const frameType: EyewearFrameMode = options.frameType || 'prescription';
  const subCategory: EyewearSubMode =
    options.subCategory || (frameType === 'sunglasses' || options.isClipOnAttachment ? 'sun' : 'optical');
  const skipSunglasses =
    frameType === 'sunglasses' || subCategory === 'sun' || Boolean(options.isClipOnAttachment);
  const category: FrameCat = skipSunglasses ? 'sun' : 'med';

  const allocated: AnyCanvas[] = [];
  const track = <T extends AnyCanvas>(c: T): T => {
    allocated.push(c);
    return c;
  };

  try {
    let srcCanvas: AnyCanvas;
    let rightHalfCanvas: AnyCanvas | null = null;

    if (splitSheetFile) {
      onStage?.('جاري تقسيم لوحة الاستوديو المزدوجة (50% / 50%)...');
      const sheetCanvas = track(await decodeBlobToCanvas(splitSheetFile, 2400));
      const split = computeVerticalSplitRegions(sheetCanvas.width, sheetCanvas.height);

      // Left Half (0%..50%): strict orthographic front cutout base on chroma key
      srcCanvas = track(createCanvasLocal(split.left.width, split.left.height));
      const lCtx = getCtx2d(srcCanvas);
      lCtx.imageSmoothingEnabled = true;
      lCtx.imageSmoothingQuality = 'high';
      lCtx.drawImage(
        sheetCanvas,
        split.left.x,
        split.left.y,
        split.left.width,
        split.left.height,
        0,
        0,
        split.left.width,
        split.left.height
      );

      // Right Half (50%..100%): 3/4 side perspective studio shot on #F8F9FA
      rightHalfCanvas = track(createCanvasLocal(split.right.width, split.right.height));
      const rCtx = getCtx2d(rightHalfCanvas);
      rCtx.imageSmoothingEnabled = true;
      rCtx.imageSmoothingQuality = 'high';
      rCtx.drawImage(
        sheetCanvas,
        split.right.x,
        split.right.y,
        split.right.width,
        split.right.height,
        0,
        0,
        split.right.width,
        split.right.height
      );
    } else {
      onStage?.('جاري تحليل الخلفية وفحص الكروما...');
      srcCanvas = track(await decodeBlobToCanvas(frontFile, 1200));
    }

    const sw = srcCanvas.width;
    const sh = srcCanvas.height;
    const rawData = getCtx2d(srcCanvas).getImageData(0, 0, sw, sh).data;
    const chroma = detectChromaKeyColor(rawData, sw, sh);

    let cutoutCanvas: AnyCanvas;
    let maskCanvas: AnyCanvas;
    let sampledLensColor = skipSunglasses ? '#334155' : '#dbeafe';
    let leftLensBox: LensRegionBox = { cx: 0.275, cy: 0.5, w: 0.34, h: 0.7 };
    let rightLensBox: LensRegionBox = { cx: 0.725, cy: 0.5, w: 0.34, h: 0.7 };
    let detectedMaterial: FrameMaterial = options.material || (frameType === 'metal' ? 'metal' : 'tr_plastic');
    let detectedType: FrameType = frameType === 'metal' ? 'rimless' : 'wayfarer';
    let quality: PipelineQuality = 'good';
    let qualityNoteAr: string | undefined;
    let baseCalibration: ModelCalibration = {};

    if (chroma.kind) {
      onStage?.('جاري عزل الكروما وتنقية الحواف...');
      const keyed = applyChromaKeyAndDespill(rawData, sw, sh, chroma.kind, chroma.rgb, frameType);
      const bfs = applyBfsLensFloodFill(keyed, sw, sh, { skipSunglasses });
      sampledLensColor = bfs.sampledLensColor;
      leftLensBox = bfs.leftLensBox;
      rightLensBox = bfs.rightLensBox;

      const tight = computeTightCropBounds(bfs.pixels, sw, sh, 8, 45);
      const tempCut = track(createCanvasLocal(sw, sh));
      const tCtx = getCtx2d(tempCut);
      const imgData = tCtx.createImageData(sw, sh);
      imgData.data.set(bfs.pixels);
      tCtx.putImageData(imgData, 0, 0);

      const tempMask = track(createCanvasLocal(sw, sh));
      const mCtx = getCtx2d(tempMask);
      const mImgData = mCtx.createImageData(sw, sh);
      mImgData.data.set(bfs.maskPixels);
      mCtx.putImageData(mImgData, 0, 0);

      const outW = 1200;
      const outH = Math.max(1, Math.round((tight.height / Math.max(1, tight.width)) * outW));
      cutoutCanvas = track(createCanvasLocal(outW, outH));
      const ccCtx = getCtx2d(cutoutCanvas);
      ccCtx.imageSmoothingEnabled = true;
      ccCtx.imageSmoothingQuality = 'high';
      ccCtx.drawImage(tempCut, tight.minX, tight.minY, tight.width, tight.height, 0, 0, outW, outH);

      maskCanvas = track(createCanvasLocal(outW, outH));
      const cmCtx = getCtx2d(maskCanvas);
      cmCtx.drawImage(tempMask, tight.minX, tight.minY, tight.width, tight.height, 0, 0, outW, outH);
    } else {
      onStage?.('جاري العزل المحلي وتنقية العدسات...');
      const localSourceBlob = splitSheetFile ? await canvasToBlobSafe(srcCanvas, 'image/png', 1) : frontFile;
      const localRes = await processGlassesImage(localSourceBlob, {
        category,
        material: detectedMaterial,
        frameWidthMm: options.frameWidthMm || (frameType === 'kids' ? 122 : 136),
        opticalDimensions: options.opticalDimensions || '52-18-140',
        fitScale: options.fitScale ?? 1.0,
        eyeLineOffset: options.eyeLineOffset ?? 0.04,
        angleType: 'front',
        maxSidePx: 1200,
        onStage,
      });

      detectedMaterial = options.material || localRes.detectedMaterial;
      detectedType = localRes.detectedType;
      quality = localRes.quality;
      qualityNoteAr = localRes.qualityNoteAr;
      baseCalibration = localRes.calibration;
      sampledLensColor = localRes.sampledLensColor;

      const decodedCut = track(await decodeBlobToCanvas(localRes.cutoutImage.blob, 1200));
      const dRgba = getCtx2d(decodedCut).getImageData(0, 0, decodedCut.width, decodedCut.height).data;
      const bfs = applyBfsLensFloodFill(dRgba, decodedCut.width, decodedCut.height, { skipSunglasses });
      leftLensBox = bfs.leftLensBox;
      rightLensBox = bfs.rightLensBox;

      const refinedCanvas = track(createCanvasLocal(decodedCut.width, decodedCut.height));
      const rcCtx = getCtx2d(refinedCanvas);
      const rData = rcCtx.createImageData(decodedCut.width, decodedCut.height);
      rData.data.set(bfs.pixels);
      rcCtx.putImageData(rData, 0, 0);

      const tight = computeTightCropBounds(bfs.pixels, decodedCut.width, decodedCut.height, 8, 45);
      const outW = 1200;
      const outH = Math.max(1, Math.round((tight.height / Math.max(1, tight.width)) * outW));
      cutoutCanvas = track(createCanvasLocal(outW, outH));
      const ccCtx = getCtx2d(cutoutCanvas);
      ccCtx.imageSmoothingEnabled = true;
      ccCtx.imageSmoothingQuality = 'high';
      ccCtx.drawImage(refinedCanvas, tight.minX, tight.minY, tight.width, tight.height, 0, 0, outW, outH);

      maskCanvas = track(createCanvasLocal(outW, outH));
      const mTemp = track(createCanvasLocal(decodedCut.width, decodedCut.height));
      const mtCtx = getCtx2d(mTemp);
      const mData = mtCtx.createImageData(decodedCut.width, decodedCut.height);
      mData.data.set(bfs.maskPixels);
      mtCtx.putImageData(mData, 0, 0);
      getCtx2d(maskCanvas).drawImage(mTemp, tight.minX, tight.minY, tight.width, tight.height, 0, 0, outW, outH);
    }

    const cutRgba = getCtx2d(cutoutCanvas).getImageData(0, 0, cutoutCanvas.width, cutoutCanvas.height).data;
    const { frameHexColor, frameOpacity } = computeMedianFrameHexAndOpacity(
      cutRgba,
      cutoutCanvas.width,
      cutoutCanvas.height
    );
    const ratioInfo = validateEyewearAspectRatio(cutoutCanvas.width, cutoutCanvas.height);

    onStage?.('جاري إخراج صور الاستوديو #F8F9FA والزاوية 3/4...');
    // Free local Front Catalog studio card (1200x900 #F8F9FA + soft elliptical contact shadow)
    const studioFrontCanvas = track(renderStudio1200x900Front(cutoutCanvas));

    let studioSideCanvas: AnyCanvas;
    if (sideFile) {
      const sideRes = await processGlassesImage(sideFile, {
        category,
        material: detectedMaterial,
        angleType: 'angled45',
        maxSidePx: 1200,
      });
      const sideCut = track(await decodeBlobToCanvas(sideRes.cutoutImage.blob, 1000));
      studioSideCanvas = track(renderStudio1200x900Front(sideCut));
    } else if (rightHalfCanvas) {
      const rightRgba = getCtx2d(rightHalfCanvas).getImageData(0, 0, rightHalfCanvas.width, rightHalfCanvas.height).data;
      const rightBounds = trimStudioWhitespaceBounds(rightRgba, rightHalfCanvas.width, rightHalfCanvas.height, 24);
      const trimmedRight = track(createCanvasLocal(rightBounds.width, rightBounds.height));
      getCtx2d(trimmedRight).drawImage(
        rightHalfCanvas,
        rightBounds.minX,
        rightBounds.minY,
        rightBounds.width,
        rightBounds.height,
        0,
        0,
        rightBounds.width,
        rightBounds.height
      );
      studioSideCanvas = track(renderStudio1200x900RightCatalog(trimmedRight));
    } else {
      studioSideCanvas = track(
        renderStudio1200x900SidePerspective(
          cutoutCanvas,
          frameHexColor,
          frameOpacity,
          frameType === 'metal' || detectedMaterial === 'metal'
        )
      );
    }

    const [imagePath, frontCatalogPath, sideImagePath, maskAsset] = await Promise.all([
      exportAsset(cutoutCanvas, 'image/webp', 0.9),
      exportAsset(studioFrontCanvas, 'image/webp', 0.88),
      exportAsset(studioSideCanvas, 'image/webp', 0.88),
      exportAsset(maskCanvas, 'image/png', 1),
    ]);

    const normalizedAspectHeightOverWidth = Number((cutoutCanvas.height / Math.max(1, cutoutCanvas.width)).toFixed(4));
    const bridgeCenterX = Number(((leftLensBox.cx + rightLensBox.cx) * 0.5).toFixed(4));
    const bridgeCenterY = Number(((leftLensBox.cy + rightLensBox.cy) * 0.5 * 0.92).toFixed(4));

    const calibration: ModelCalibration = {
      ...baseCalibration,
      frameWidthMm: options.frameWidthMm || (frameType === 'kids' ? 122 : 136),
      opticalDimensions: options.opticalDimensions || '52-18-140',
      material: detectedMaterial,
      isSunglasses: skipSunglasses,
      bridgeCenterX,
      bridgeCenterY,
      aspectRatio: normalizedAspectHeightOverWidth,
      fitScale: options.fitScale ?? 1.0,
      eyeLineOffset: options.eyeLineOffset ?? 0.04,
      lensMaskUrl: maskAsset.dataUrl,
      storeFrontUrl: frontCatalogPath.dataUrl,
      tryOnFrontUrl: imagePath.dataUrl,
      leftLensBox,
      rightLensBox,
    };

    return {
      imagePath,
      frontCatalogPath,
      sideImagePath,
      lensMask: { blob: maskAsset.blob, dataUrl: maskAsset.dataUrl },
      aspectRatio: ratioInfo.aspectRatio,
      aspectRatioValid: ratioInfo.valid,
      frameHexColor,
      frameOpacity,
      sampledLensColor,
      detectedCat: category,
      detectedMaterial,
      detectedType,
      quality,
      qualityNoteAr,
      width: cutoutCanvas.width,
      height: cutoutCanvas.height,
      calibration,
    };
  } finally {
    for (const c of allocated) {
      disposeWorkCanvas(c);
    }
  }
}

if (typeof self !== 'undefined' && typeof (self as { document?: unknown }).document === 'undefined') {
  self.onmessage = async (ev: MessageEvent<CutoutWorkerRequest>) => {
    const { id, frontFile, sideFile, splitSheetFile, options } = ev.data;
    try {
      const result = await processCutoutFrame(
        frontFile,
        sideFile,
        options,
        (stageLabelAr) => {
          const msg: CutoutWorkerResponse = { id, kind: 'stage', stageLabelAr };
          self.postMessage(msg);
        },
        splitSheetFile
      );
      const done: CutoutWorkerResponse = { id, kind: 'done', result };
      self.postMessage(done);
    } catch (err) {
      const errMsg: CutoutWorkerResponse = {
        id,
        kind: 'error',
        message: err instanceof Error ? err.message : 'تعذر معالجة صورة النظارة',
      };
      self.postMessage(errMsg);
    }
  };
}
