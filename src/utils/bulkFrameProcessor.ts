import { FrameCat, FrameMaterial, FrameType, LensRegionBox, ModelCalibration, Product } from '../types';
import { PipelineQuality } from './glassesImagePipeline';
import { processGlassesImageInWorker } from './glassesWorkerClient';

export interface ProcessedBulkFrame {
  cutoutDataUrl: string;
  cutoutBlob: Blob;
  storeFrontDataUrl: string;
  storeFrontBlob: Blob;
  tryOnFrontDataUrl: string;
  tryOnFrontBlob: Blob;
  originalDataUrl: string;
  originalBlob: Blob;
  lensMaskDataUrl: string;
  lensMaskBlob: Blob;
  quality: PipelineQuality;
  qualityNoteAr?: string;
  width: number;
  height: number;
  aspectRatio: number;
  mimeExt: 'webp' | 'png';
  sampledFrameColor: string;
  sampledLensColor: string;
  detectedCat: FrameCat;
  detectedMaterial: FrameMaterial;
  detectedType: FrameType;
  tiltCorrectionDeg: number;
  bridgeCenterX: number;
  bridgeCenterY: number;
  leftLensBox: LensRegionBox;
  rightLensBox: LensRegionBox;
  calibration: ModelCalibration;
}

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface StrictBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface CutoutExtractionResult {
  pixels: Uint8ClampedArray;
  maskPixels: Uint8ClampedArray;
  cornerBg: RGBColor;
  leftLensBox: LensRegionBox;
  rightLensBox: LensRegionBox;
  sampledLensColor: string;
  detectedCat: FrameCat;
}

export interface DualCutoutResult {
  storeFrontPixels: Uint8ClampedArray;
  tryOnFrontPixels: Uint8ClampedArray;
  maskPixels: Uint8ClampedArray;
  cornerBg: RGBColor;
  leftLensBox: LensRegionBox;
  rightLensBox: LensRegionBox;
  sampledLensColor: string;
  detectedCat: FrameCat;
}

/** Canonical Store Gallery image (Studio front catalog #F8F9FA / Warby Parker style) */
export function resolveStoreFrontUrl(product: Product): string | undefined {
  return (
    product.frontCatalogPath ||
    product.storeFrontUrl ||
    product.modelCalibration?.storeFrontUrl ||
    product.processedImage ||
    product.images?.find((im) => im.kind === 'gallery' && Math.abs(im.angleYaw) <= 15)?.imageUrl ||
    product.images?.find((im) => Math.abs(im.angleYaw) <= 15)?.imageUrl ||
    product.images?.[0]?.imageUrl
  );
}

/** Canonical Live AR Try-On transparent PNG/WebP image */
export function resolveTryOnFrontUrl(product: Product): string | undefined {
  return (
    product.imagePath ||
    product.tryOnFrontUrl ||
    product.modelCalibration?.tryOnFrontUrl ||
    product.images?.find((im) => im.kind === 'front_tryon' && Math.abs(im.angleYaw) <= 15)?.imageUrl ||
    product.processedImage ||
    product.images?.[0]?.imageUrl
  );
}

/** Canonical 3/4 Side / 45° angled image for storefront card front/side switcher */
export function resolveAngled45Url(product: Product): string | undefined {
  return (
    product.sideImagePath ||
    product.images?.find((im) => Math.abs(im.angleYaw) >= 20 && Math.abs(im.angleYaw) <= 75)?.imageUrl
  );
}

/** Canonical Clip-On Try-On transparent PNG/WebP */
export function resolveClipOnTryOnUrl(product: Product): string | undefined {
  return product.clipOnImagePath || undefined;
}

/** Canonical Clip-On Front Catalog studio shot */
export function resolveClipOnFrontCatalogUrl(product: Product): string | undefined {
  return product.clipOnFrontCatalogPath || product.clipOnImagePath || undefined;
}

/** Canonical Clip-On 3/4 Side Catalog studio shot */
export function resolveClipOnSideUrl(product: Product): string | undefined {
  return product.clipOnSideImagePath || product.clipOnFrontCatalogPath || undefined;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function disposeCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  try {
    const ctx = canvas.getContext('2d');
    if (ctx && canvas.width > 0 && canvas.height > 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // ignore cleanup errors
  }
}

function canvasToBlobLocal(canvas: HTMLCanvasElement, mime = 'image/webp', quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Canvas export failed'));
      },
      mime,
      quality
    );
  });
}

async function loadSourceImageToCanvas(
  source: File | Blob | string,
  maxWidth = 700,
  exactDims?: { width: number; height: number }
): Promise<HTMLCanvasElement> {
  if (typeof source !== 'string' && typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(source, { resizeWidth: maxWidth, resizeQuality: 'high' });
    } catch {
      try {
        bitmap = await createImageBitmap(source);
      } catch {
        bitmap = null;
      }
    }
    if (bitmap) {
      try {
        const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
        const w = exactDims ? exactDims.width : Math.max(1, Math.round(bitmap.width * scale));
        const h = exactDims ? exactDims.height : Math.max(1, Math.round(bitmap.height * scale));
        const c = makeCanvas(w, h);
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, w, h);
        return c;
      } finally {
        try {
          bitmap.close();
        } catch {
          // ignore
        }
      }
    }
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    let objectUrl: string | null = null;
    el.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(el);
    };
    el.onerror = (err) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(err);
    };
    if (typeof source === 'string') {
      el.src = source;
    } else {
      objectUrl = URL.createObjectURL(source);
      el.src = objectUrl;
    }
  });

  const nw = img.naturalWidth || img.width || 1;
  const nh = img.naturalHeight || img.height || 1;
  const scale = nw > maxWidth ? maxWidth / nw : 1;
  const w = exactDims ? exactDims.width : Math.max(1, Math.round(nw * scale));
  const h = exactDims ? exactDims.height : Math.max(1, Math.round(nh * scale));

  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  img.src = '';
  return c;
}

async function exportWebpOrPng(
  canvas: HTMLCanvasElement,
  quality = 0.86
): Promise<{ blob: Blob; dataUrl: string; ext: 'webp' | 'png' }> {
  try {
    const wb = await canvasToBlobLocal(canvas, 'image/webp', quality);
    if (wb.type === 'image/webp' && wb.size > 0) {
      return {
        blob: wb,
        dataUrl: canvas.toDataURL('image/webp', quality),
        ext: 'webp',
      };
    }
  } catch {
    // Fallback to PNG below if environment doesn't support WebP encoding
  }
  const pb = await canvasToBlobLocal(canvas, 'image/png', 1);
  return {
    blob: pb,
    dataUrl: canvas.toDataURL('image/png'),
    ext: 'png',
  };
}

function rgbDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Samples background colour from the four image corners using channel-wise median.
 */
export function sampleFourCornerMedianBg(d: Uint8ClampedArray, w: number, h: number): RGBColor {
  const patch = Math.max(2, Math.min(6, Math.floor(Math.min(w, h) * 0.05)));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const sampleCorner = (x0: number, y0: number) => {
    for (let dy = 0; dy < patch; dy++) {
      for (let dx = 0; dx < patch; dx++) {
        const x = Math.max(0, Math.min(w - 1, x0 + dx));
        const y = Math.max(0, Math.min(h - 1, y0 + dy));
        const i = (y * w + x) * 4;
        if (d[i + 3] < 200) continue;
        rs.push(d[i]);
        gs.push(d[i + 1]);
        bs.push(d[i + 2]);
      }
    }
  };

  sampleCorner(0, 0);
  sampleCorner(Math.max(0, w - patch), 0);
  sampleCorner(0, Math.max(0, h - patch));
  sampleCorner(Math.max(0, w - patch), Math.max(0, h - patch));

  if (rs.length === 0) {
    return { r: 255, g: 255, b: 255 };
  }

  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  return { r: rs[mid], g: gs[mid], b: bs[mid] };
}

function hasTransparentCorners(d: Uint8ClampedArray, w: number, h: number): boolean {
  const coords = [
    [1, 1],
    [w - 2, 1],
    [1, h - 2],
    [w - 2, h - 2],
  ];
  let count = 0;
  for (const [x, y] of coords) {
    const cx = Math.max(0, Math.min(w - 1, x));
    const cy = Math.max(0, Math.min(h - 1, y));
    if (d[(cy * w + cx) * 4 + 3] < 24) count++;
  }
  return count >= 3;
}

/**
 * Automatically detects whether the background around the perimeter is complex/non-uniform
 * (e.g. shot on a wooden desk or cluttered room).
 */
export function hasBusyBackground(d: Uint8ClampedArray, w: number, h: number): boolean {
  if (hasTransparentCorners(d, w, h)) return false;
  const median = sampleFourCornerMedianBg(d, w, h);
  let outliers = 0;
  let total = 0;
  const step = Math.max(2, Math.floor(Math.min(w, h) / 40));

  for (let x = 0; x < w; x += step) {
    for (const y of [2, Math.max(0, h - 3)]) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 200) continue;
      total++;
      if (rgbDist(d[i], d[i + 1], d[i + 2], median.r, median.g, median.b) > 36) outliers++;
    }
  }
  for (let y = 0; y < h; y += step) {
    for (const x of [2, Math.max(0, w - 3)]) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 200) continue;
      total++;
      if (rgbDist(d[i], d[i + 1], d[i + 2], median.r, median.g, median.b) > 36) outliers++;
    }
  }
  if (total === 0) return false;
  return outliers / total > 0.28;
}

/**
 * Photo-realistic front eyewear cutout pipeline:
 *  1. Sample corner background colour (median of 4 corners).
 *  2. Soft alpha ramp from RGB colour distance (<=25 transparent, >=70 opaque, smooth between).
 *  3. Flood-fill from image border: ONLY background-coloured regions connected to border become transparent.
 *  4. Enclosed background-coloured regions:
 *     - >= ~3% of image area (lens openings) -> subtle white glass (8–14% alpha, stronger at top)
 *     - < ~3% of image area (bridge / nose-pad gaps) -> fully transparent (alpha = 0)
 *     - Tinted sunglasses lenses have distance > 70 so they remain untouched from original photo.
 *  5. Despill semi-transparent edge pixels away from the corner background colour to eliminate halos.
 */
export function cutOutFramePhotoPixels(
  raw: Uint8ClampedArray,
  w: number,
  h: number,
  options: { catOverride?: FrameCat; alreadySegmentedRgba?: boolean } = {}
): CutoutExtractionResult {
  const total = w * h;
  const out = new Uint8ClampedArray(raw);
  const maskPixels = new Uint8ClampedArray(total * 4);
  const cornerBg = sampleFourCornerMedianBg(raw, w, h);
  const alreadyCutout = options.alreadySegmentedRgba || hasTransparentCorners(raw, w, h);

  const distArr = new Float32Array(total);
  const rampAlpha = new Uint8Array(total);
  const isBgCandidate = new Uint8Array(total);

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const origA = raw[i + 3];
    if (origA < 24) {
      distArr[p] = 0;
      rampAlpha[p] = 0;
      isBgCandidate[p] = 1;
      continue;
    }
    const d = rgbDist(raw[i], raw[i + 1], raw[i + 2], cornerBg.r, cornerBg.g, cornerBg.b);
    distArr[p] = d;
    if (alreadyCutout) {
      rampAlpha[p] = origA;
      isBgCandidate[p] = origA < 52 ? 1 : 0;
    } else {
      const a = d <= 25 ? 0 : d >= 70 ? 255 : Math.round(((d - 25) / 45) * 255);
      rampAlpha[p] = Math.min(origA, a);
      isBgCandidate[p] = d <= 52 ? 1 : 0;
    }
  }

  const regionType = new Uint8Array(total); // 1 = exterior border bg, 2 = glass lens, 3 = small enclosed gap
  const queue = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;

  const trySeedBorder = (x: number, y: number) => {
    const p = y * w + x;
    if (regionType[p] !== 0 || !isBgCandidate[p]) return;
    regionType[p] = 1;
    queue[qTail++] = p;
  };

  for (let x = 0; x < w; x++) {
    trySeedBorder(x, 0);
    trySeedBorder(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    trySeedBorder(0, y);
    trySeedBorder(w - 1, y);
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
      if (regionType[np] !== 0 || !isBgCandidate[np]) continue;
      regionType[np] = 1;
      queue[qTail++] = np;
    }
  }

  const minLensAreaPx = Math.max(18, total * 0.03);
  const visitedEnc = new Uint8Array(total);
  const enclosedLensBoxes: { cx: number; cy: number; w: number; h: number }[] = [];

  for (let start = 0; start < total; start++) {
    if (regionType[start] !== 0 || !isBgCandidate[start] || visitedEnc[start]) continue;
    let cHead = 0;
    let cTail = 0;
    queue[cTail++] = start;
    visitedEnc[start] = 1;

    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    const compPixels: number[] = [];

    while (cHead < cTail) {
      const p = queue[cHead++];
      compPixels.push(p);
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
        if (regionType[np] !== 0 || !isBgCandidate[np] || visitedEnc[np]) continue;
        visitedEnc[np] = 1;
        queue[cTail++] = np;
      }
    }

    if (compPixels.length >= minLensAreaPx) {
      const spanY = Math.max(1, maxY - minY);
      for (const p of compPixels) {
        regionType[p] = 2;
        const y = Math.floor(p / w);
        const t = (y - minY) / spanY;
        const glassAlpha = Math.round(255 * (0.14 - 0.06 * t));
        const i = p * 4;
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
        out[i + 3] = glassAlpha;

        maskPixels[i] = 255;
        maskPixels[i + 1] = 255;
        maskPixels[i + 2] = 255;
        maskPixels[i + 3] = 255;
      }
      enclosedLensBoxes.push({
        cx: Number((((minX + maxX) * 0.5) / w).toFixed(4)),
        cy: Number((((minY + maxY) * 0.5) / h).toFixed(4)),
        w: Number(((maxX - minX + 1) / w).toFixed(4)),
        h: Number(((maxY - minY + 1) / h).toFixed(4)),
      });
    } else {
      for (const p of compPixels) {
        regionType[p] = 3;
      }
    }
  }

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const rt = regionType[p];
    if (rt === 2) continue;

    if (rt === 1 || rt === 3) {
      const d = distArr[p];
      if (d <= 25 || raw[i + 3] < 24 || alreadyCutout) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
        continue;
      }

      const x = p % w;
      const y = (p - x) / w;
      let nextToFrame = false;
      for (let k = 0; k < 4; k++) {
        const nx = x + dx4[k];
        const ny = y + dy4[k];
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const np = ny * w + nx;
          if (regionType[np] === 0 && distArr[np] >= 52) {
            nextToFrame = true;
            break;
          }
        }
      }

      if (!nextToFrame) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
        continue;
      }

      const a = rampAlpha[p];
      out[i + 3] = a;
      if (a > 0 && a < 255) {
        const aNorm = Math.max(0.3, a / 255);
        out[i] = Math.max(0, Math.min(255, Math.round(cornerBg.r + (raw[i] - cornerBg.r) / aNorm)));
        out[i + 1] = Math.max(0, Math.min(255, Math.round(cornerBg.g + (raw[i + 1] - cornerBg.g) / aNorm)));
        out[i + 2] = Math.max(0, Math.min(255, Math.round(cornerBg.b + (raw[i + 2] - cornerBg.b) / aNorm)));
      }
      continue;
    }

    const a = alreadyCutout ? raw[i + 3] : rampAlpha[p];
    out[i + 3] = a;
    if (a > 0 && a < 255 && !alreadyCutout) {
      const aNorm = Math.max(0.3, a / 255);
      out[i] = Math.max(0, Math.min(255, Math.round(cornerBg.r + (raw[i] - cornerBg.r) / aNorm)));
      out[i + 1] = Math.max(0, Math.min(255, Math.round(cornerBg.g + (raw[i + 1] - cornerBg.g) / aNorm)));
      out[i + 2] = Math.max(0, Math.min(255, Math.round(cornerBg.b + (raw[i + 2] - cornerBg.b) / aNorm)));
    } else if (a === 0) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
    }
  }

  enclosedLensBoxes.sort((a, b) => a.cx - b.cx);
  const leftLensBox: LensRegionBox = enclosedLensBoxes[0] || { cx: 0.275, cy: 0.5, w: 0.34, h: 0.72 };
  const rightLensBox: LensRegionBox =
    enclosedLensBoxes.length > 1
      ? enclosedLensBoxes[enclosedLensBoxes.length - 1]
      : { cx: 0.725, cy: 0.5, w: 0.34, h: 0.72 };

  let detectedCat: FrameCat = options.catOverride || 'med';
  let sampledLensColor = '#dbeafe';
  if (enclosedLensBoxes.length === 0) {
    const lpx = Math.round(w * 0.3);
    const rpx = Math.round(w * 0.7);
    const py = Math.round(h * 0.5);
    const li = (py * w + lpx) * 4;
    const ri = (py * w + rpx) * 4;
    const lDist = rgbDist(raw[li], raw[li + 1], raw[li + 2], cornerBg.r, cornerBg.g, cornerBg.b);
    const rDist = rgbDist(raw[ri], raw[ri + 1], raw[ri + 2], cornerBg.r, cornerBg.g, cornerBg.b);
    const lLum = 0.299 * raw[li] + 0.587 * raw[li + 1] + 0.114 * raw[li + 2];
    const rLum = 0.299 * raw[ri] + 0.587 * raw[ri + 1] + 0.114 * raw[ri + 2];
    if (!options.catOverride && (lDist > 48 || rDist > 48) && (lLum + rLum) * 0.5 < 175) {
      detectedCat = 'sun';
    }
    const mr = Math.round((raw[li] + raw[ri]) * 0.5);
    const mg = Math.round((raw[li + 1] + raw[ri + 1]) * 0.5);
    const mb = Math.round((raw[li + 2] + raw[ri + 2]) * 0.5);
    if (detectedCat === 'sun') {
      sampledLensColor = `#${[mr, mg, mb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }
  }

  return {
    pixels: out,
    maskPixels,
    cornerBg,
    leftLensBox,
    rightLensBox,
    sampledLensColor,
    detectedCat,
  };
}

/**
 * Dual-Output Image Processing (Warby Parker Store Photo + Clean Face Try-On Photo):
 *  - For Optical ('med'/'safe'):
 *      a) storeFrontPixels: Removes outer background + subtle glare inside lenses,
 *         PRESERVING folded temple arms visible behind the lenses.
 *      b) tryOnFrontPixels: Completely hollows out both left & right lens apertures
 *         (including removing any horizontal folded temple arm passing behind the lens!)
 *         and fills them with an ultra-subtle glass sheen rgba(255, 255, 255, 0.05) (alpha = 13)
 *         so the customer's eyes are 100% clear on camera.
 *  - For Sunglasses ('sun'):
 *      Preserves tinted lenses intact in both storeFrontPixels and tryOnFrontPixels while removing outer bg.
 */
export function generateDualCutoutPixels(
  raw: Uint8ClampedArray,
  w: number,
  h: number,
  options: {
    category?: FrameCat;
    alreadySegmentedRgba?: boolean;
    rawOrigPixels?: Uint8ClampedArray;
    angleType?: 'front' | 'angled45';
  } = {}
): DualCutoutResult {
  const base = cutOutFramePhotoPixels(raw, w, h, {
    catOverride: options.category,
    alreadySegmentedRgba: options.alreadySegmentedRgba,
  });

  const storeFrontPixels = new Uint8ClampedArray(base.pixels);
  const tryOnFrontPixels = new Uint8ClampedArray(base.pixels);
  const maskPixels = new Uint8ClampedArray(base.maskPixels);
  const isSunglasses = (options.category ?? base.detectedCat) === 'sun';

  if (isSunglasses || options.angleType === 'angled45') {
    return {
      storeFrontPixels,
      tryOnFrontPixels,
      maskPixels,
      cornerBg: base.cornerBg,
      leftLensBox: base.leftLensBox,
      rightLensBox: base.rightLensBox,
      sampledLensColor: base.sampledLensColor,
      detectedCat: isSunglasses ? 'sun' : base.detectedCat,
    };
  }

  // Optical front frame ("طبي"):
  // Quick inner-lens flood-fill pass to hollow out any remaining background (white wall, wooden table, glare)
  // inside the two closed lens rims and replace it with clean optical glass sheen rgba(255,255,255,0.06) (alpha = 15).
  const total = w * h;
  const cornerBg = base.cornerBg;
  const origPx = options.rawOrigPixels && options.rawOrigPixels.length === raw.length ? options.rawOrigPixels : raw;
  const alreadyCutout = Boolean(options.alreadySegmentedRgba || hasTransparentCorners(raw, w, h));
  const dx4 = [-1, 1, 0, 0];
  const dy4 = [0, 0, -1, 1];
  const queue = new Int32Array(total);

  // Step 1: Identify exterior transparent pixels connected to image border (on segmented alpha when available)
  const exterior = new Uint8Array(total);
  const isTransparentLike = (p: number) => {
    const i = p * 4;
    if (alreadyCutout) return raw[i + 3] < 52;
    if (raw[i + 3] < 24) return true;
    const d = rgbDist(raw[i], raw[i + 1], raw[i + 2], cornerBg.r, cornerBg.g, cornerBg.b);
    return d <= 52;
  };

  let qHead = 0;
  let qTail = 0;
  const seedExt = (x: number, y: number) => {
    const p = y * w + x;
    if (exterior[p] === 0 && isTransparentLike(p)) {
      exterior[p] = 1;
      queue[qTail++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    seedExt(x, 0);
    seedExt(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    seedExt(0, y);
    seedExt(w - 1, y);
  }
  while (qHead < qTail) {
    const p = queue[qHead++];
    const x = p % w;
    const y = (p - x) / w;
    for (let k = 0; k < 4; k++) {
      const nx = x + dx4[k];
      const ny = y + dy4[k];
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const np = ny * w + nx;
        if (exterior[np] === 0 && isTransparentLike(np)) {
          exterior[np] = 1;
          queue[qTail++] = np;
        }
      }
    }
  }

  // Step 2: Frame bounding box & 2-ring outer-rim protection guard from exterior silhouette
  let fMinX = w;
  let fMaxX = -1;
  let fMinY = h;
  let fMaxY = -1;
  const rimDist = new Uint8Array(total); // 1 = outer edge adjacent to exterior, 2 = 2nd ring
  const rimQueue: number[] = [];

  for (let p = 0; p < total; p++) {
    if (exterior[p] !== 0) continue;
    const x = p % w;
    const y = (p - x) / w;
    if (x < fMinX) fMinX = x;
    if (x > fMaxX) fMaxX = x;
    if (y < fMinY) fMinY = y;
    if (y > fMaxY) fMaxY = y;
    for (let k = 0; k < 4; k++) {
      const nx = x + dx4[k];
      const ny = y + dy4[k];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || exterior[ny * w + nx] === 1) {
        rimDist[p] = 1;
        rimQueue.push(p);
        break;
      }
    }
  }
  for (const p of rimQueue) {
    const x = p % w;
    const y = (p - x) / w;
    for (let k = 0; k < 4; k++) {
      const nx = x + dx4[k];
      const ny = y + dy4[k];
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const np = ny * w + nx;
        if (exterior[np] === 0 && rimDist[np] === 0) rimDist[np] = 2;
      }
    }
  }

  const fW = Math.max(1, fMaxX - fMinX + 1);
  const fH = Math.max(1, fMaxY - fMinY + 1);

  // Step 3: Build compact 32x32x32 RGB lookup table of ALL exterior background colors removed by AI
  // (captures multi-colored backgrounds such as wooden table + white wall + stand)
  const bgSeedBins = new Uint8Array(32768);
  const bgColorTable = new Uint8Array(32768);
  let hasExteriorSamples = false;
  for (let p = 0; p < total; p++) {
    if (exterior[p] !== 1) continue;
    const i = p * 4;
    if (origPx[i + 3] < 120) continue;
    hasExteriorSamples = true;
    const br = origPx[i] >> 3;
    const bg = origPx[i + 1] >> 3;
    const bb = origPx[i + 2] >> 3;
    bgSeedBins[(br << 10) | (bg << 5) | bb] = 1;
  }
  if (hasExteriorSamples) {
    for (let br = 0; br < 32; br++) {
      for (let bg = 0; bg < 32; bg++) {
        for (let bb = 0; bb < 32; bb++) {
          if (!bgSeedBins[(br << 10) | (bg << 5) | bb]) continue;
          for (let dr = -2; dr <= 2; dr++) {
            const nr = br + dr;
            if (nr < 0 || nr >= 32) continue;
            for (let dg = -2; dg <= 2; dg++) {
              const ng = bg + dg;
              if (ng < 0 || ng >= 32) continue;
              for (let db = -2; db <= 2; db++) {
                const nb = bb + db;
                if (nb < 0 || nb >= 32) continue;
                bgColorTable[(nr << 10) | (ng << 5) | nb] = 1;
              }
            }
          }
        }
      }
    }
  }

  // Sample average outer rim color from Ring 1 along top border of frame silhouette
  let rimR = 0;
  let rimG = 0;
  let rimB = 0;
  let rimSamples = 0;
  const topBandMaxY = fMinY + Math.round(fH * 0.35);
  for (const p of rimQueue) {
    const y = Math.floor(p / w);
    if (y > topBandMaxY) continue;
    const i = p * 4;
    if (raw[i + 3] < 140) continue;
    const r = origPx[i];
    const g = origPx[i + 1];
    const b = origPx[i + 2];
    const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (hasExteriorSamples && bgColorTable[bin] && r > 220 && g > 220 && b > 220) continue;
    rimR += r;
    rimG += g;
    rimB += b;
    rimSamples++;
  }
  const avgRim = rimSamples > 0 ? { r: rimR / rimSamples, g: rimG / rimSamples, b: rimB / rimSamples } : null;

  // Step 4: Mark background candidates inside enclosed silhouette (transparent AI holes OR remaining wall/table bg inside closed rims)
  const isBg = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (exterior[p] === 1) {
      isBg[p] = 1;
      continue;
    }
    const i = p * 4;
    const segA = raw[i + 3];
    if (segA < 52) {
      isBg[p] = 1;
      continue;
    }

    const r = origPx[i];
    const g = origPx[i + 1];
    const b = origPx[i + 2];
    const nearPureWhite = r > 234 && g > 234 && b > 234;

    if (alreadyCutout) {
      // Protect outer rim pixels (rimDist === 1 or 2) from being hollowed
      if (rimDist[p] !== 0) continue;
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const matchesRemovedBg = hasExteriorSamples && bgColorTable[bin] === 1;
      const diffFromRim = avgRim ? rgbDist(r, g, b, avgRim.r, avgRim.g, avgRim.b) : 999;
      if ((matchesRemovedBg && diffFromRim > 24) || (nearPureWhite && diffFromRim > 28)) {
        isBg[p] = 1;
      }
    } else {
      const d = rgbDist(r, g, b, cornerBg.r, cornerBg.g, cornerBg.b);
      isBg[p] = d <= 54 || nearPureWhite ? 1 : 0;
    }
  }

  // Step 5: Connected enclosed pockets + inner-lens flood-fill pass inside left & right closed lens openings
  const visited = new Uint8Array(total);
  const leftPocketPixels: number[] = [];
  const rightPocketPixels: number[] = [];
  const bridgeGapPixels: number[] = [];
  const minSubPocketPx = Math.max(12, Math.round(total * 0.0045));

  for (let start = 0; start < total; start++) {
    if (exterior[start] !== 0 || !isBg[start] || visited[start]) continue;
    let cHead = 0;
    let cTail = 0;
    queue[cTail++] = start;
    visited[start] = 1;
    const comp: number[] = [];
    let sumX = 0;

    while (cHead < cTail) {
      const p = queue[cHead++];
      comp.push(p);
      const x = p % w;
      sumX += x;
      const y = (p - x) / w;
      for (let k = 0; k < 4; k++) {
        const nx = x + dx4[k];
        const ny = y + dy4[k];
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const np = ny * w + nx;
          if (exterior[np] === 0 && isBg[np] && !visited[np]) {
            visited[np] = 1;
            queue[cTail++] = np;
          }
        }
      }
    }

    const cxRel = (sumX / comp.length - fMinX) / fW;
    if (comp.length < minSubPocketPx) {
      // Small bridge / nose-pad gaps become fully transparent
      if (cxRel >= 0.42 && cxRel <= 0.58) {
        for (const p of comp) bridgeGapPixels.push(p);
      }
      continue;
    }
    if (cxRel < 0.46) {
      for (const p of comp) leftPocketPixels.push(p);
    } else if (cxRel > 0.54) {
      for (const p of comp) rightPocketPixels.push(p);
    } else {
      for (const p of comp) bridgeGapPixels.push(p);
    }
  }

  // Fallback color-similarity flood-fill from interior lens seeds if AI left non-white/non-matched interior pixels
  // (e.g. slightly shaded table/wall inside closed lens rim)
  const seedInnerLensFlood = (relXStart: number, relXEnd: number, targetList: number[]) => {
    if (targetList.length >= minSubPocketPx || !alreadyCutout) return;
    const x0 = Math.max(0, Math.round(fMinX + fW * relXStart));
    const x1 = Math.min(w - 1, Math.round(fMinX + fW * relXEnd));
    const y0 = Math.max(0, Math.round(fMinY + fH * 0.25));
    const y1 = Math.min(h - 1, Math.round(fMinY + fH * 0.75));

    let bestSeed = -1;
    let bestRimDiff = 34;
    const cyTarget = (y0 + y1) * 0.5;
    const cxTarget = (x0 + x1) * 0.5;
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        const p = y * w + x;
        if (exterior[p] !== 0 || rimDist[p] !== 0) continue;
        const i = p * 4;
        const diff = avgRim ? rgbDist(origPx[i], origPx[i + 1], origPx[i + 2], avgRim.r, avgRim.g, avgRim.b) : 0;
        const distPenalty = Math.hypot(x - cxTarget, y - cyTarget) * 0.15;
        if (diff - distPenalty > bestRimDiff) {
          bestRimDiff = diff - distPenalty;
          bestSeed = p;
        }
      }
    }
    if (bestSeed < 0) return;

    const si = bestSeed * 4;
    const sr = origPx[si];
    const sg = origPx[si + 1];
    const sb = origPx[si + 2];
    const localVisited = new Uint8Array(total);
    let cHead = 0;
    let cTail = 0;
    queue[cTail++] = bestSeed;
    localVisited[bestSeed] = 1;
    const maxAllowedArea = Math.round(fW * fH * 0.36);

    while (cHead < cTail && cTail < maxAllowedArea) {
      const p = queue[cHead++];
      isBg[p] = 1;
      targetList.push(p);
      const x = p % w;
      const y = (p - x) / w;
      for (let k = 0; k < 4; k++) {
        const nx = x + dx4[k];
        const ny = y + dy4[k];
        if (nx < x0 - Math.round(fW * 0.12) || nx > x1 + Math.round(fW * 0.12) || ny < fMinY + 2 || ny > fMaxY - 2) {
          continue;
        }
        const np = ny * w + nx;
        if (localVisited[np] || exterior[np] !== 0 || rimDist[np] === 1) continue;
        const ni = np * 4;
        const dRim = avgRim ? rgbDist(origPx[ni], origPx[ni + 1], origPx[ni + 2], avgRim.r, avgRim.g, avgRim.b) : 999;
        const dSeed = rgbDist(origPx[ni], origPx[ni + 1], origPx[ni + 2], sr, sg, sb);
        const bin = ((origPx[ni] >> 3) << 10) | ((origPx[ni + 1] >> 3) << 5) | (origPx[ni + 2] >> 3);
        if ((dSeed <= 48 || (hasExteriorSamples && bgColorTable[bin] === 1)) && dRim > 22) {
          localVisited[np] = 1;
          queue[cTail++] = np;
        }
      }
    }
  };

  seedInnerLensFlood(0.14, 0.42, leftPocketPixels);
  seedInnerLensFlood(0.58, 0.86, rightPocketPixels);

  // Clear small nose-bridge gaps to full transparency
  for (const p of bridgeGapPixels) {
    const i = p * 4;
    storeFrontPixels[i] = 0;
    storeFrontPixels[i + 1] = 0;
    storeFrontPixels[i + 2] = 0;
    storeFrontPixels[i + 3] = 0;
    tryOnFrontPixels[i] = 0;
    tryOnFrontPixels[i + 1] = 0;
    tryOnFrontPixels[i + 2] = 0;
    tryOnFrontPixels[i + 3] = 0;
  }

  // Hollow each optical eye lens pocket and replace with clean optical glass sheen rgba(255, 255, 255, 0.06) (alpha = 15)
  const hollowEyePocket = (pixels: number[], sideFallback: LensRegionBox): LensRegionBox => {
    if (pixels.length === 0) return sideFallback;
    const colMinY = new Int32Array(w).fill(h);
    const colMaxY = new Int32Array(w).fill(-1);
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;

    for (const p of pixels) {
      const x = p % w;
      const y = (p - x) / w;
      if (y < colMinY[x]) colMinY[x] = y;
      if (y > colMaxY[x]) colMaxY[x] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    for (let x = minX; x <= maxX; x++) {
      const yTop = colMinY[x];
      const yBot = colMaxY[x];
      if (yBot < yTop) continue;
      for (let y = yTop; y <= yBot; y++) {
        const p = y * w + x;
        const i = p * 4;
        // tryOnFront: clean optical glass sheen rgba(255, 255, 255, 0.06) -> alpha = 15
        tryOnFrontPixels[i] = 255;
        tryOnFrontPixels[i + 1] = 255;
        tryOnFrontPixels[i + 2] = 255;
        tryOnFrontPixels[i + 3] = 15;

        maskPixels[i] = 255;
        maskPixels[i + 1] = 255;
        maskPixels[i + 2] = 255;
        maskPixels[i + 3] = 255;

        // storeFront: replace any remaining background/wall/table/glare inside lenses with rgba(255,255,255,0.06),
        // while keeping dark folded temple arms visible in clean studio photos!
        if (isBg[p]) {
          storeFrontPixels[i] = 255;
          storeFrontPixels[i + 1] = 255;
          storeFrontPixels[i + 2] = 255;
          storeFrontPixels[i + 3] = 15;
        }
      }
    }

    return {
      cx: Number((((minX + maxX) * 0.5) / w).toFixed(4)),
      cy: Number((((minY + maxY) * 0.5) / h).toFixed(4)),
      w: Number(((maxX - minX + 1) / w).toFixed(4)),
      h: Number(((maxY - minY + 1) / h).toFixed(4)),
    };
  };

  const leftBox = hollowEyePocket(leftPocketPixels, base.leftLensBox);
  const rightBox = hollowEyePocket(rightPocketPixels, base.rightLensBox);

  // Ensure any remaining unobstructed optical mask pixels use uniform rgba(255, 255, 255, 0.06) (alpha = 15)
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (base.maskPixels[i + 3] > 128 && tryOnFrontPixels[i + 3] > 15) {
      tryOnFrontPixels[i] = 255;
      tryOnFrontPixels[i + 1] = 255;
      tryOnFrontPixels[i + 2] = 255;
      tryOnFrontPixels[i + 3] = 15;
    }
  }

  return {
    storeFrontPixels,
    tryOnFrontPixels,
    maskPixels,
    cornerBg,
    leftLensBox: leftBox,
    rightLensBox: rightBox,
    sampledLensColor: base.sampledLensColor,
    detectedCat: options.category ?? 'med',
  };
}

/**
 * Scans pixels with alpha > alphaThreshold (default 51 == >0.2 normalized alpha)
 * to compute the frame bounding box for tight auto-crop.
 */
export function findStrictOpaqueBounds(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  alphaThreshold = 51
): StrictBounds {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > alphaThreshold) {
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

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Measures horizontal roll tilt up to ±15° by comparing left & right frame halves.
 */
export function measureFrameHorizontalTiltDeg(d: Uint8ClampedArray, w: number, h: number): number {
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] >= 110) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (bw < 60 || bh < 16) return 0;

  let lSumX = 0;
  let lSumY = 0;
  let lCount = 0;
  let rSumX = 0;
  let rSumY = 0;
  let rCount = 0;
  const leftEnd = minX + bw * 0.42;
  const rightStart = minX + bw * 0.58;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (d[(y * w + x) * 4 + 3] < 130) continue;
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
  if (lCount < 40 || rCount < 40) return 0;
  const sym = Math.min(lCount, rCount) / Math.max(lCount, rCount);
  if (sym < 0.58) return 0;

  const lx = lSumX / lCount;
  const ly = lSumY / lCount;
  const rx = rSumX / rCount;
  const ry = rSumY / rCount;
  const deg = (Math.atan2(ry - ly, rx - lx) * 180) / Math.PI;
  if (Math.abs(deg) < 0.8 || Math.abs(deg) > 15) return 0;
  return Number((-deg).toFixed(2));
}

function rotateCanvasRigid(src: HTMLCanvasElement, angleDeg: number): HTMLCanvasElement {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.ceil(src.width * cos + src.height * sin);
  const newH = Math.ceil(src.width * sin + src.height * cos);
  const dst = makeCanvas(newW, newH);
  const ctx = dst.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return dst;
}

function autoCropTripleWithPaddingAndCap(
  tryOnCanvas: HTMLCanvasElement,
  storeCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  padPx = 8,
  maxWidth = 900
): {
  tryOnCanvas: HTMLCanvasElement;
  storeCanvas: HTMLCanvasElement;
  maskCanvas: HTMLCanvasElement;
  bounds: StrictBounds;
} {
  const w = tryOnCanvas.width;
  const h = tryOnCanvas.height;
  const d = tryOnCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const rawBounds = findStrictOpaqueBounds(d, w, h, 51);

  const x0 = Math.max(0, rawBounds.minX - padPx);
  const y0 = Math.max(0, rawBounds.minY - padPx);
  const x1 = Math.min(w - 1, rawBounds.maxX + padPx);
  const y1 = Math.min(h - 1, rawBounds.maxY + padPx);
  const cropW = Math.max(1, x1 - x0 + 1);
  const cropH = Math.max(1, y1 - y0 + 1);

  const outScale = cropW > maxWidth ? maxWidth / cropW : 1;
  const dstW = Math.max(1, Math.round(cropW * outScale));
  const dstH = Math.max(1, Math.round(cropH * outScale));

  const cropOne = (src: HTMLCanvasElement, withStudioShadow = false) => {
    const out = makeCanvas(dstW, dstH);
    const ctx = out.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (withStudioShadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(20, 20, 20, 0.16)';
      ctx.shadowBlur = Math.max(6, Math.round(dstW * 0.012));
      ctx.shadowOffsetY = Math.max(3, Math.round(dstH * 0.015));
      ctx.drawImage(src, x0, y0, cropW, cropH, 0, 0, dstW, dstH);
      ctx.restore();
    } else {
      ctx.drawImage(src, x0, y0, cropW, cropH, 0, 0, dstW, dstH);
    }
    return out;
  };

  return {
    tryOnCanvas: cropOne(tryOnCanvas, false),
    storeCanvas: cropOne(storeCanvas, true),
    maskCanvas: cropOne(maskCanvas, false),
    bounds: {
      minX: x0,
      maxX: x1,
      minY: y0,
      maxY: y1,
      width: cropW,
      height: cropH,
    },
  };
}

function sampleDominantFrameColorLocal(canvas: HTMLCanvasElement): string {
  const w = canvas.width;
  const h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();

  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (d[i + 3] <= 180) continue;
      const rq = d[i] >> 4;
      const gq = d[i + 1] >> 4;
      const bq = d[i + 2] >> 4;
      const key = `${rq}-${gq}-${bq}`;
      const cur = buckets.get(key);
      if (cur) {
        cur.r += d[i];
        cur.g += d[i + 1];
        cur.b += d[i + 2];
        cur.count++;
      } else {
        buckets.set(key, { r: d[i], g: d[i + 1], b: d[i + 2], count: 1 });
      }
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

function estimateMaterialAndType(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  frameHex: string
): { material: FrameMaterial; type: FrameType } {
  let opaqueCols = 0;
  let totalRimRun = 0;
  let runCount = 0;
  for (let y = Math.floor(h * 0.12); y < Math.floor(h * 0.88); y += 3) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] >= 180) {
        run++;
      } else if (run > 0) {
        totalRimRun += run;
        runCount++;
        run = 0;
      }
    }
    if (run > 0) {
      totalRimRun += run;
      runCount++;
    }
  }
  for (let x = 0; x < w; x++) {
    if (d[(Math.floor(h * 0.5) * w + x) * 4 + 3] >= 180) opaqueCols++;
  }
  const avgStrokePx = runCount > 0 ? totalRimRun / runCount : 8;
  const thinRatio = avgStrokePx / Math.max(1, w);

  const r = parseInt(frameHex.slice(1, 3), 16) || 120;
  const g = parseInt(frameHex.slice(3, 5), 16) || 120;
  const b = parseInt(frameHex.slice(5, 7), 16) || 120;
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const isMetallicTone = (r > 155 && g > 125 && b < 110) || (maxC > 150 && maxC - minC < 26);

  const material: FrameMaterial = thinRatio < 0.032 || isMetallicTone ? 'metal' : 'tr_plastic';
  const aspect = h / Math.max(1, w);
  let type: FrameType = 'wayfarer';
  if (thinRatio < 0.016 && opaqueCols < w * 0.14) type = 'rimless';
  else if (material === 'metal' && aspect >= 0.37) type = 'aviator';
  else if (aspect >= 0.43) type = 'round';
  else if (aspect < 0.34) type = 'cat';

  return { material, type };
}

function measureNormalizedLensBoxesFromMask(
  maskData: Uint8ClampedArray,
  w: number,
  h: number
): { leftLensBox: LensRegionBox; rightLensBox: LensRegionBox } {
  const halfX = Math.floor(w * 0.5);
  const scanHalf = (xStart: number, xEnd: number, fallback: LensRegionBox): LensRegionBox => {
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = xStart; x < xEnd; x++) {
        if (maskData[(y * w + x) * 4 + 3] > 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    if (count < 16 || maxX <= minX || maxY <= minY) return fallback;
    const bw = (maxX - minX + 1) / Math.max(1, w);
    const bh = (maxY - minY + 1) / Math.max(1, h);
    if (bw < 0.1 || bh < 0.18) return fallback;
    return {
      cx: Number((((minX + maxX) * 0.5) / Math.max(1, w)).toFixed(4)),
      cy: Number((((minY + maxY) * 0.5) / Math.max(1, h)).toFixed(4)),
      w: Number(bw.toFixed(4)),
      h: Number(bh.toFixed(4)),
    };
  };

  return {
    leftLensBox: scanHalf(0, halfX, { cx: 0.27, cy: 0.5, w: 0.35, h: 0.72 }),
    rightLensBox: scanHalf(halfX, w, { cx: 0.73, cy: 0.5, w: 0.35, h: 0.72 }),
  };
}

/**
 * Client-side Web Worker AI segmentation + inner-lens semi-transparency pipeline:
 *  - Delegates to `processGlassesImageInWorker` (U²-Net Apache-2.0 via onnxruntime-web MIT, WebGPU -> WASM fallback).
 *  - Downscales to max 1024px respecting EXIF orientation, erodes 1px to remove halos, decontaminates edges,
 *    keeps lenses semi-transparent, PCA-deskews & tight-crops with even padding, normalizes light,
 *    and outputs WebP `storeImage` (#F8F7F4 + soft contact shadow) and `cutoutImage` + `quality` (`good` | `check`).
 */
export async function processFrameImageClientSide(
  source: File | Blob | string,
  overrides: {
    frameWidthMm?: number;
    opticalDimensions?: string;
    material?: FrameMaterial;
    cat?: FrameCat;
    fitScale?: number;
    eyeLineOffset?: number;
    angleType?: 'front' | 'angled45';
    onStage?: (stageLabelAr: string) => void;
  } = {}
): Promise<ProcessedBulkFrame> {
  let blobInput: Blob;
  if (typeof source === 'string') {
    const canvas = await loadSourceImageToCanvas(source, 1024);
    try {
      blobInput = await canvasToBlobLocal(canvas, 'image/png', 1);
    } finally {
      disposeCanvas(canvas);
    }
  } else {
    blobInput = source;
  }

  const res = await processGlassesImageInWorker(blobInput, {
    category: overrides.cat,
    material: overrides.material,
    frameWidthMm: overrides.frameWidthMm,
    opticalDimensions: overrides.opticalDimensions,
    fitScale: overrides.fitScale,
    eyeLineOffset: overrides.eyeLineOffset,
    angleType: overrides.angleType,
    onStage: overrides.onStage,
  });

  return {
    cutoutDataUrl: res.cutoutImage.dataUrl,
    cutoutBlob: res.cutoutImage.blob,
    storeFrontDataUrl: res.storeImage.dataUrl,
    storeFrontBlob: res.storeImage.blob,
    tryOnFrontDataUrl: res.cutoutImage.dataUrl,
    tryOnFrontBlob: res.cutoutImage.blob,
    originalDataUrl: res.storeImage.dataUrl,
    originalBlob: res.storeImage.blob,
    lensMaskDataUrl: res.lensMask.dataUrl,
    lensMaskBlob: res.lensMask.blob,
    quality: res.quality,
    qualityNoteAr: res.qualityNoteAr,
    width: res.width,
    height: res.height,
    aspectRatio: res.aspectRatio,
    mimeExt: res.storeImage.ext,
    sampledFrameColor: res.sampledFrameColor,
    sampledLensColor: res.sampledLensColor,
    detectedCat: res.detectedCat,
    detectedMaterial: res.detectedMaterial,
    detectedType: res.detectedType,
    tiltCorrectionDeg: res.deskewAngleDeg,
    bridgeCenterX: res.calibration.bridgeCenterX || 0.5,
    bridgeCenterY: res.calibration.bridgeCenterY || 0.46,
    leftLensBox: res.leftLensBox,
    rightLensBox: res.rightLensBox,
    calibration: res.calibration,
  };
}

/**
 * Constant-memory sequential streaming queue (1 image at a time)
 * with a 20ms main-thread yield after each item so the browser stays 60fps
 * regardless of whether 10 or 500+ photos are selected.
 */
export async function processBulkImageQueue<T>(
  files: File[],
  _concurrency = 1,
  worker: (file: File, index: number) => Promise<T>,
  onProgress?: (completed: number, total: number, index: number, result?: T, error?: unknown) => void,
  signal?: AbortSignal,
  yieldMs = 20
): Promise<void> {
  const total = files.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) break;
    const file = files[i];
    try {
      const res = await worker(file, i);
      onProgress?.(i + 1, total, i, res);
    } catch (err) {
      onProgress?.(i + 1, total, i, undefined, err);
    }
    if (signal?.aborted) break;
    await new Promise((r) => setTimeout(r, yieldMs));
  }
}
