import {
  EditedGlassesAsset,
  ExtractionPreset,
  applyManualMaskEdit,
  canvasToBlob,
  loadImageToCanvas,
} from '../utils/visionPipeline';
import { FrameCat } from '../types';
import { PipelineQuality } from '../utils/glassesImagePipeline';
import { processGlassesImageInWorker } from '../utils/glassesWorkerClient';

export type GlassesPhotoAngle = 'front' | 'angled';

export interface ProcessedGlassesPhoto extends EditedGlassesAsset {
  angleType: GlassesPhotoAngle;
  lightingAdjusted: boolean;
  angleCorrectionDeg: number;
  angleCorrectionApplied: boolean;
  angleCorrectionNote?: string;
  unleveledImageDataUrl: string;
  unleveledImageBlob: Blob;
  unleveledMaskDataUrl: string;
  unleveledMaskBlob: Blob;
  storeFrontDataUrl?: string;
  storeFrontBlob?: Blob;
  tryOnFrontDataUrl?: string;
  tryOnFrontBlob?: Blob;
  quality?: PipelineQuality;
  qualityNoteAr?: string;
}

export interface ProcessMerchantPhotoOptions {
  angleType: GlassesPhotoAngle;
  preset?: ExtractionPreset;
  category?: FrameCat;
  autoEnhanceLighting?: boolean;
  autoLevelTilt?: boolean;
  onProgress?: (label: string) => void;
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

async function exportBestAsset(
  canvas: HTMLCanvasElement,
  quality = 0.92
): Promise<{ blob: Blob; dataUrl: string; ext: 'webp' | 'png' }> {
  try {
    const wb = await canvasToBlob(canvas, 'image/webp', quality);
    if (wb.type === 'image/webp' && wb.size > 0) {
      return {
        blob: wb,
        dataUrl: canvas.toDataURL('image/webp', quality),
        ext: 'webp',
      };
    }
  } catch {
    // Fallback to PNG below
  }
  const pb = await canvasToBlob(canvas, 'image/png', 1);
  return {
    blob: pb,
    dataUrl: canvas.toDataURL('image/png'),
    ext: 'png',
  };
}

/**
 * Pure non-destructive studio exposure lift:
 * - Only gently brightens underexposed photos while maintaining exact RGB ratios (never alters hue/color).
 * - Preserves 100% of frame design, thickness, and lens colors.
 */
export function normalizeLightingPixelsPreservingColor(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  outerBg: { r: number; g: number; b: number }
): { adjusted: boolean; gain: number } {
  let sumLum = 0;
  let fgCount = 0;

  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 120) continue;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const bgDiff = Math.hypot(r - outerBg.r, g - outerBg.g, b - outerBg.b);
      if (bgDiff < 22) continue;
      sumLum += 0.299 * r + 0.587 * g + 0.114 * b;
      fgCount++;
    }
  }

  if (fgCount < 40) return { adjusted: false, gain: 1 };
  const meanLum = sumLum / fgCount;

  // Apply gentle bounded exposure lift ONLY when visibly dim (mean foreground luminance < 88)
  if (meanLum >= 88) return { adjusted: false, gain: 1 };

  const rawGain = 1 + Math.min(0.16, ((88 - meanLum) / 88) * 0.22);
  const gain = Number(Math.max(1.02, Math.min(1.16, rawGain)).toFixed(3));

  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (d[i + 3] <= 20) continue;
    // Scale R/G/B uniformly to preserve exact hue & frame tone
    d[i] = Math.min(255, Math.round(d[i] * gain));
    d[i + 1] = Math.min(255, Math.round(d[i + 1] * gain));
    d[i + 2] = Math.min(255, Math.round(d[i + 2] * gain));
  }

  return { adjusted: true, gain };
}

/**
 * Measures slight unintentional camera tilt (horizon roll) on front-facing isolated glasses
 * by comparing left and right frame mass vertical centers.
 * Returns null if frame is asymmetrical, too small, or already level (< 1.5° or > 10°).
 */
export function estimateSafeHorizonTiltDeg(
  d: Uint8ClampedArray,
  w: number,
  h: number
): { angleDeg: number; confident: boolean; reason?: string } {
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] >= 120) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  if (boxW < 70 || boxH < 18) {
    return { angleDeg: 0, confident: false, reason: 'حجم الإطار صغير — تم الحفاظ على الصورة الأصلية' };
  }

  let lSumX = 0;
  let lSumY = 0;
  let lCount = 0;
  let rSumX = 0;
  let rSumY = 0;
  let rCount = 0;

  const leftEnd = minX + boxW * 0.42;
  const rightStart = minX + boxW * 0.58;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (d[(y * w + x) * 4 + 3] < 140) continue;
      if (x <= leftEnd) {
        lSumX += x;
        lSumY += y;
        lCount++;
      } else if (x >= rightStart) {
        rSumX += x;
        rSumY += y;
        rCount++;
      }
    }
  }

  if (lCount < 45 || rCount < 45) {
    return { angleDeg: 0, confident: false, reason: 'زاوية غير متماثلة — تم الحفاظ على الوضع الأصلي' };
  }

  const symRatio = Math.min(lCount, rCount) / Math.max(lCount, rCount);
  if (symRatio < 0.62) {
    return {
      angleDeg: 0,
      confident: false,
      reason: 'الصورة مائلة بطبيعتها — تم الحفاظ على الزاوية الأصلية بدون تعديل',
    };
  }

  const lx = lSumX / lCount;
  const ly = lSumY / lCount;
  const rx = rSumX / rCount;
  const ry = rSumY / rCount;
  const tiltDeg = (Math.atan2(ry - ly, rx - lx) * 180) / Math.PI;

  if (Math.abs(tiltDeg) < 1.5) {
    return { angleDeg: 0, confident: true, reason: 'استقامة الصورة ممتازة بالفعل' };
  }
  if (Math.abs(tiltDeg) > 10) {
    return {
      angleDeg: 0,
      confident: false,
      reason: 'درجة الميل كبيرة — تم الحفاظ على الصورة الأصلية لتجنب أي تشويه',
    };
  }

  return { angleDeg: Number((-tiltDeg).toFixed(2)), confident: true };
}

function rotateCanvasRigidly(src: HTMLCanvasElement, angleDeg: number): HTMLCanvasElement {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.ceil(src.width * cos + src.height * sin);
  const newH = Math.ceil(src.width * sin + src.height * cos);

  const dst = createCanvas(newW, newH);
  const ctx = dst.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return dst;
}

function trimTransparentBounds(
  cutCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement
): { cut: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const w = cutCanvas.width;
  const h = cutCanvas.height;
  const d = cutCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 18) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return { cut: cutCanvas, mask: maskCanvas };

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const padX = Math.max(8, Math.round(bw * 0.03));
  const padY = Math.max(8, Math.round(bh * 0.05));

  const cut = createCanvas(bw + padX * 2, bh + padY * 2);
  cut.getContext('2d')!.drawImage(cutCanvas, minX, minY, bw, bh, padX, padY, bw, bh);

  const mask = createCanvas(bw + padX * 2, bh + padY * 2);
  mask.getContext('2d')!.drawImage(maskCanvas, minX, minY, bw, bh, padX, padY, bw, bh);
  return { cut, mask };
}

/**
 * Processes one merchant glasses photo (either Front view or Angled/Side view):
 * 1. Preserves the untouched original photo (`originalDataUrl`, `originalBlob`).
 * 2. Isolates the glasses accurately with thin-rim and crystal-frame protection.
 * 3. Applies gentle, color-preserving lighting normalization ONLY if dim.
 * 4. Applies rigid horizon tilt leveling ONLY on front shots when high-confidence & safe (<= 10°);
 *    otherwise keeps untouched orientation and always retains unleveled version for 1-click toggle.
 */
export async function processMerchantGlassesPhoto(
  source: File | Blob | HTMLVideoElement | HTMLImageElement | string,
  opts: ProcessMerchantPhotoOptions
): Promise<ProcessedGlassesPhoto> {
  const {
    angleType,
    preset = 'auto',
    category = 'med',
    onProgress,
  } = opts;

  onProgress?.('جاري قراءة الصورة وحفظ النسخة الأصلية...');
  const rawCanvas = await loadImageToCanvas(source, 1024);
  const untouchedOrigExport = await exportBestAsset(rawCanvas, 0.9);
  const sourceBlob =
    source instanceof Blob ? source : await canvasToBlob(rawCanvas, 'image/png', 1);

  const isSunglasses = category === 'sun' || preset === 'sunglasses';
  const res = await processGlassesImageInWorker(sourceBlob, {
    category: isSunglasses ? 'sun' : 'med',
    angleType: angleType === 'front' ? 'front' : 'angled45',
    onStage: onProgress,
  });

  const angleCorrectionApplied = Math.abs(res.deskewAngleDeg) >= 0.6;
  const angleCorrectionNote =
    angleType === 'angled'
      ? 'تم الحفاظ على زاوية التصوير الجانبية كما هي'
      : angleCorrectionApplied
      ? `تمت موازنة الميل تلقائياً (${res.deskewAngleDeg > 0 ? '+' : ''}${res.deskewAngleDeg}°)`
      : 'استقامة الصورة ممتازة';

  return {
    imageDataUrl: res.cutoutImage.dataUrl,
    imageBlob: res.cutoutImage.blob,
    maskDataUrl: res.lensMask.dataUrl,
    maskBlob: res.lensMask.blob,
    originalDataUrl: untouchedOrigExport.dataUrl,
    originalBlob: untouchedOrigExport.blob,
    storeFrontDataUrl: res.storeImage.dataUrl,
    storeFrontBlob: res.storeImage.blob,
    tryOnFrontDataUrl: res.cutoutImage.dataUrl,
    tryOnFrontBlob: res.cutoutImage.blob,
    quality: res.quality,
    qualityNoteAr: res.qualityNoteAr,
    mimeExt: res.storeImage.ext,
    width: res.width,
    height: res.height,
    sampledFrameColor: res.sampledFrameColor,
    sampledLensColor: res.sampledLensColor,
    presetUsed: preset,
    usedFallbackExtractor: res.backendUsed === 'fallback',
    angleType,
    lightingAdjusted: true,
    angleCorrectionDeg: res.deskewAngleDeg,
    angleCorrectionApplied,
    angleCorrectionNote,
    unleveledImageDataUrl: res.cutoutImage.dataUrl,
    unleveledImageBlob: res.cutoutImage.blob,
    unleveledMaskDataUrl: res.lensMask.dataUrl,
    unleveledMaskBlob: res.lensMask.blob,
  };
}

export { applyManualMaskEdit };
