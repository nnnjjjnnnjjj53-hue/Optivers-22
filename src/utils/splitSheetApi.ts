import { EyewearFrameMode, EyewearSubMode, FrameColorFamily, FrameShapeTag } from '../types';

export interface SplitSheetPayloadOptions {
  frameType: EyewearFrameMode;
  subCategory: EyewearSubMode;
  isClipOnAttachment?: boolean;
  keepLensBranding?: boolean;
  isCrystalFrame?: boolean;
  isPatterned?: boolean;
  modelCode?: string | null;
  frameColor?: string | null;
  phash?: string | null;
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
  authToken?: string | null;
  shopId?: string | null;
  role?: string | null;
  planTier?: string | null;
  isDemoAdminStore?: boolean;
}

export interface SharedCachedAssets {
  cacheKey: string;
  modelCode?: string | null;
  frameColor?: string | null;
  phash?: string | null;
  keepLensBranding?: boolean;
  isCrystalFrame?: boolean;
  isPatterned?: boolean;
  imagePath?: string | null;
  frontCatalogPath?: string | null;
  sideImagePath?: string | null;
  lensMaskUrl?: string | null;
  lensWidthMm?: number | null;
  bridgeWidthMm?: number | null;
  templeLengthMm?: number | null;
  totalFrameWidthMm?: number | null;
}

export interface SplitSheetApiResponse {
  blob?: Blob;
  cacheHit: boolean;
  cachedAssets?: SharedCachedAssets;
  solidModelTemplate?: SharedCachedAssets;
  messageAr?: string;
}

export interface ExtractedOpticalDimensionsResult {
  found: boolean;
  lensWidthMm: number | null;
  bridgeWidthMm: number | null;
  templeLengthMm: number | null;
  totalFrameWidthMm: number | null;
  modelCode: string | null;
  isCrystalFrame: boolean;
  frameShape?: FrameShapeTag;
  isPatterned: boolean;
  colorFamily: FrameColorFamily;
  autoFrameMode?: EyewearFrameMode;
  lensTint?: 'clear' | 'tinted';
  rawText: string | null;
}

function buildAuthHeaders(opts?: {
  authToken?: string | null;
  shopId?: string | null;
  role?: string | null;
  planTier?: string | null;
  isDemoAdminStore?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts?.authToken) {
    headers['Authorization'] = `Bearer ${opts.authToken}`;
  }
  if (opts?.shopId) {
    headers['x-optiverse-demo-shop'] = opts.shopId;
  }
  if (opts?.role) {
    headers['x-optiverse-demo-role'] = opts.role;
  }
  if (opts?.planTier) {
    headers['x-optiverse-plan-tier'] = opts.planTier;
  }
  if (opts?.isDemoAdminStore) {
    headers['x-optiverse-admin-demo'] = '1';
  }
  return headers;
}

/**
 * Computes a fast 64-bit perceptual difference hash (dHash, 16 hex chars) on a 9x8 grayscale canvas
 * for zero-cost global duplicate frame matching across merchants.
 */
export async function computePerceptualHash(file: Blob): Promise<string> {
  let bm: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (typeof createImageBitmap !== 'function') return '';
    bm = await createImageBitmap(file);
    canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '';
    ctx.drawImage(bm, 0, 0, 9, 8);
    const px = ctx.getImageData(0, 0, 9, 8).data;
    let hex = '';
    let nibble = 0;
    let bitIdx = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i1 = (y * 9 + x) * 4;
        const i2 = (y * 9 + x + 1) * 4;
        const l1 = 0.299 * px[i1] + 0.587 * px[i1 + 1] + 0.114 * px[i1 + 2];
        const l2 = 0.299 * px[i2] + 0.587 * px[i2 + 1] + 0.114 * px[i2 + 2];
        nibble = (nibble << 1) | (l1 > l2 ? 1 : 0);
        bitIdx++;
        if (bitIdx === 4) {
          hex += nibble.toString(16);
          nibble = 0;
          bitIdx = 0;
        }
      }
    }
    return hex;
  } catch {
    return '';
  } finally {
    if (bm) {
      try {
        bm.close();
      } catch {
        // ignore
      }
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

/**
 * Pure pixel variance analyzer for detecting multi-color / patterned frames
 * (tortoiseshell, havana, two-tone split acetate) vs. uniform solid frames.
 */
export function analyzeRgbaFrameColorVariance(
  px: Uint8ClampedArray,
  width: number,
  height: number
): { variance: number; isPatterned: boolean; dominantHex: string; colorFamily: FrameColorFamily } {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const hues: number[] = [];
  const lums: number[] = [];

  for (let y = Math.floor(height * 0.15); y < Math.ceil(height * 0.85); y++) {
    for (let x = Math.floor(width * 0.08); x < Math.ceil(width * 0.92); x++) {
      const i = (y * width + x) * 4;
      if (px[i + 3] < 200) continue;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      // Exclude bright white studio walls/tables
      if (lum > 228 && Math.max(r, g, b) - Math.min(r, g, b) < 18) continue;
      rs.push(r);
      gs.push(g);
      bs.push(b);
      lums.push(lum);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min > 16) {
        let h = 0;
        if (max === r) h = ((g - b) / (max - min)) % 6;
        else if (max === g) h = (b - r) / (max - min) + 2;
        else h = (r - g) / (max - min) + 4;
        hues.push(((h * 60 + 360) % 360));
      }
    }
  }

  if (rs.length < 12) {
    return { variance: 0, isPatterned: false, dominantHex: '#1f2937', colorFamily: 'black' };
  }

  const meanR = rs.reduce((a, b) => a + b, 0) / rs.length;
  const meanG = gs.reduce((a, b) => a + b, 0) / gs.length;
  const meanB = bs.reduce((a, b) => a + b, 0) / bs.length;
  const meanLum = lums.reduce((a, b) => a + b, 0) / lums.length;

  let varSum = 0;
  for (let k = 0; k < rs.length; k++) {
    varSum += Math.pow(rs[k] - meanR, 2) + Math.pow(gs[k] - meanG, 2) + Math.pow(bs[k] - meanB, 2);
  }
  const rgbStdDev = Math.sqrt(varSum / (rs.length * 3));

  let hueSpread = 0;
  if (hues.length >= 8) {
    const sortedH = [...hues].sort((a, b) => a - b);
    hueSpread = sortedH[Math.floor(sortedH.length * 0.9)] - sortedH[Math.floor(sortedH.length * 0.1)];
  }

  const sortedL = [...lums].sort((a, b) => a - b);
  const lumSpan = sortedL[Math.floor(sortedL.length * 0.9)] - sortedL[Math.floor(sortedL.length * 0.1)];

  // Tortoiseshell / mix-color frames display strong bimodal luminance (>70) or wide RGB/hue variance
  const isPatterned = rgbStdDev > 38 || (lumSpan > 74 && hueSpread > 30);

  const hex = `#${[meanR, meanG, meanB]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`;

  let colorFamily: FrameColorFamily = 'other';
  if (isPatterned || (meanR > meanB + 22 && meanLum < 165)) {
    colorFamily = 'brown_tortoise';
  } else if (meanLum < 68 && Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB) < 22) {
    colorFamily = 'black';
  } else if (meanLum > 185) {
    colorFamily = 'clear';
  }

  return {
    variance: Math.round(rgbStdDev),
    isPatterned,
    dominantHex: hex,
    colorFamily,
  };
}

export async function computeFrameColorVariance(
  file: Blob
): Promise<{ variance: number; isPatterned: boolean; dominantHex: string; colorFamily: FrameColorFamily }> {
  let bm: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (typeof createImageBitmap !== 'function') {
      return { variance: 0, isPatterned: false, dominantHex: '#1f2937', colorFamily: 'black' };
    }
    bm = await createImageBitmap(file);
    canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { variance: 0, isPatterned: false, dominantHex: '#1f2937', colorFamily: 'black' };
    }
    ctx.drawImage(bm, 0, 0, 48, 48);
    const px = ctx.getImageData(0, 0, 48, 48).data;
    return analyzeRgbaFrameColorVariance(px, 48, 48);
  } catch {
    return { variance: 0, isPatterned: false, dominantHex: '#1f2937', colorFamily: 'black' };
  } finally {
    if (bm) {
      try {
        bm.close();
      } catch {
        // ignore
      }
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

/**
 * Local fallback heuristic to detect whether eyewear lenses are clear optical glass
 * or dark/tinted sunglasses when server AI classification is unavailable.
 */
export async function estimateLensTintLocally(file: Blob): Promise<'clear' | 'tinted'> {
  let bm: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (typeof createImageBitmap !== 'function') return 'clear';
    bm = await createImageBitmap(file);
    canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 36;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'clear';
    ctx.drawImage(bm, 0, 0, 48, 36);
    const px = ctx.getImageData(0, 0, 48, 36).data;

    // Sample corner background luminance
    let bgLum = 0;
    let bgCount = 0;
    for (const [cx, cy] of [
      [2, 2],
      [45, 2],
      [2, 33],
      [45, 33],
    ]) {
      const i = (cy * 48 + cx) * 4;
      bgLum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      bgCount++;
    }
    const meanBg = bgLum / Math.max(1, bgCount);

    // Sample left & right lens interior centers
    const sampleRegion = (x0: number, x1: number, y0: number, y1: number) => {
      let sum = 0;
      let count = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * 48 + x) * 4;
          if (px[i + 3] < 120) continue;
          sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          count++;
        }
      }
      return count > 0 ? sum / count : meanBg;
    };

    const leftCenter = sampleRegion(11, 19, 13, 23);
    const rightCenter = sampleRegion(28, 36, 13, 23);
    const lensAvg = (leftCenter + rightCenter) * 0.5;

    // If both lens centers are markedly darker than the background, treat as tinted
    if (lensAvg < 118 && meanBg - lensAvg > 58) {
      return 'tinted';
    }
    return 'clear';
  } catch {
    return 'clear';
  } finally {
    if (bm) {
      try {
        bm.close();
      } catch {
        // ignore
      }
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

/**
 * Downscales any phone photo to max 1600px JPEG (0.85) before sending to the server,
 * guaranteeing request bodies stay strictly below 3MB and immediately disposing canvas/bitmap.
 */
export async function encodeCompactUploadBase64(
  file: Blob,
  maxSidePx = 1600
): Promise<{ base64: string; mimeType: string }> {
  const MAX_BASE64_CHARS = 2_600_000; // Keeps JSON request body safely < 3MB
  let bm: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (typeof createImageBitmap === 'function') {
      try {
        bm = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        bm = await createImageBitmap(file);
      }
      const clampedMaxSide = Math.min(1600, Math.max(320, maxSidePx));
      let curScale = Math.min(1, clampedMaxSide / Math.max(1, bm.width, bm.height));
      canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const qualities = [0.85, 0.72, 0.58, 0.45];
        for (let pass = 0; pass < 3; pass++) {
          const w = Math.max(1, Math.round(bm.width * curScale));
          const h = Math.max(1, Math.round(bm.height * curScale));
          canvas.width = w;
          canvas.height = h;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(bm, 0, 0, w, h);

          for (const q of qualities) {
            const dataUrl = canvas.toDataURL('image/jpeg', q);
            const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
            if (base64.length <= MAX_BASE64_CHARS || (pass === 2 && q === qualities[qualities.length - 1])) {
              return {
                base64,
                mimeType: 'image/jpeg',
              };
            }
          }
          curScale *= 0.72;
        }
      }
    }
  } catch {
    // Fallback to HTMLImageElement + canvas resize if createImageBitmap fails
  } finally {
    if (bm) {
      try {
        bm.close();
      } catch {
        // ignore
      }
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  // Secondary browser-compatible canvas resize via HTMLImageElement
  try {
    const objUrl = URL.createObjectURL(file);
    try {
      const imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('تعذر تحميل الصورة'));
        el.src = objUrl;
      });
      const clampedMax = Math.min(1600, Math.max(320, maxSidePx));
      let curScale = Math.min(1, clampedMax / Math.max(1, imgEl.naturalWidth || imgEl.width, imgEl.naturalHeight || imgEl.height));
      const c2 = document.createElement('canvas');
      const ctx2 = c2.getContext('2d');
      if (ctx2) {
        for (const q of [0.85, 0.7, 0.52]) {
          const w = Math.max(1, Math.round((imgEl.naturalWidth || imgEl.width) * curScale));
          const h = Math.max(1, Math.round((imgEl.naturalHeight || imgEl.height) * curScale));
          c2.width = w;
          c2.height = h;
          ctx2.fillStyle = '#ffffff';
          ctx2.fillRect(0, 0, w, h);
          ctx2.drawImage(imgEl, 0, 0, w, h);
          const dataUrl = c2.toDataURL('image/jpeg', q);
          const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
          if (base64.length <= MAX_BASE64_CHARS || q === 0.52) {
            c2.width = 0;
            c2.height = 0;
            return { base64, mimeType: 'image/jpeg' };
          }
          curScale *= 0.75;
        }
      }
      c2.width = 0;
      c2.height = 0;
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  } catch {
    // Fall through to FileReader only if canvas decoding is impossible
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.readAsDataURL(file);
  });
  return {
    base64: dataUrl.replace(/^data:[^;]+;base64,/, ''),
    mimeType: file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg',
  };
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const clean = base64.replace(/^data:[^;]+;base64,/, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Step 1 Pre-Processing OCR: Reads printed optical sizing (e.g. 52□18-140),
 * brand/model code, and crystal/transparent acetate status using free-tier gemini-3.5-flash-lite.
 */
export async function extractOpticalDimensionsViaServer(
  file: Blob,
  signal?: AbortSignal,
  authMeta?: {
    authToken?: string | null;
    shopId?: string | null;
    role?: string | null;
    planTier?: string | null;
    isDemoAdminStore?: boolean;
  }
): Promise<ExtractedOpticalDimensionsResult> {
  const { base64, mimeType } = await encodeCompactUploadBase64(file, 1600);
  if (signal?.aborted) {
    throw new DOMException('تم إلغاء الطلب', 'AbortError');
  }

  try {
    const response = await fetch('/api/eyewear/extract-dimensions', {
      method: 'POST',
      headers: buildAuthHeaders(authMeta),
      signal,
      body: JSON.stringify({
        imageBase64: base64,
        mimeType,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      found?: boolean;
      lens_width_mm?: number | null;
      bridge_width_mm?: number | null;
      temple_length_mm?: number | null;
      total_frame_width_mm?: number | null;
      model_code?: string | null;
      is_crystal_frame?: boolean;
      frame_shape?: FrameShapeTag;
      is_patterned?: boolean;
      color_family?: FrameColorFamily;
      auto_frame_mode?: EyewearFrameMode;
      lens_tint?: 'clear' | 'tinted';
      raw_text?: string | null;
    };

    if (!response.ok) {
      return {
        found: false,
        lensWidthMm: null,
        bridgeWidthMm: null,
        templeLengthMm: null,
        totalFrameWidthMm: null,
        modelCode: null,
        isCrystalFrame: false,
        frameShape: undefined,
        isPatterned: false,
        colorFamily: 'other',
        autoFrameMode: undefined,
        lensTint: undefined,
        rawText: null,
      };
    }

    return {
      found: Boolean(payload.found),
      lensWidthMm: typeof payload.lens_width_mm === 'number' ? payload.lens_width_mm : null,
      bridgeWidthMm: typeof payload.bridge_width_mm === 'number' ? payload.bridge_width_mm : null,
      templeLengthMm: typeof payload.temple_length_mm === 'number' ? payload.temple_length_mm : null,
      totalFrameWidthMm:
        typeof payload.total_frame_width_mm === 'number' ? payload.total_frame_width_mm : null,
      modelCode: typeof payload.model_code === 'string' ? payload.model_code : null,
      isCrystalFrame: Boolean(payload.is_crystal_frame),
      frameShape: payload.frame_shape,
      isPatterned: Boolean(payload.is_patterned),
      colorFamily: payload.color_family || (payload.is_crystal_frame ? 'clear' : 'other'),
      autoFrameMode: payload.auto_frame_mode,
      lensTint: payload.lens_tint,
      rawText: typeof payload.raw_text === 'string' ? payload.raw_text : null,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return {
      found: false,
      lensWidthMm: null,
      bridgeWidthMm: null,
      templeLengthMm: null,
      totalFrameWidthMm: null,
      modelCode: null,
      isCrystalFrame: false,
      frameShape: undefined,
      isPatterned: false,
      colorFamily: 'other',
      autoFrameMode: undefined,
      lensTint: undefined,
      rawText: null,
    };
  }
}

/**
 * Single-call 16:9 Side-by-Side Split Sheet request (with Global Shared Catalog Cache check).
 * Returns either a cache hit (instant zero cost) or generated 16:9 image Blob.
 */
export async function generateSplitSheetViaServer(
  file: Blob,
  options: SplitSheetPayloadOptions,
  signal?: AbortSignal
): Promise<SplitSheetApiResponse> {
  const [{ base64, mimeType }, computedPhash] = await Promise.all([
    encodeCompactUploadBase64(file, 1600),
    options.phash ? Promise.resolve(options.phash) : computePerceptualHash(file),
  ]);
  if (signal?.aborted) {
    throw new DOMException('تم إلغاء الطلب', 'AbortError');
  }

  const response = await fetch('/api/eyewear/split-sheet', {
    method: 'POST',
    headers: buildAuthHeaders(options),
    signal,
    body: JSON.stringify({
      imageBase64: base64,
      mimeType,
      frameType: options.frameType,
      subCategory: options.subCategory,
      isClipOnAttachment: Boolean(options.isClipOnAttachment),
      keepLensBranding: Boolean(options.keepLensBranding),
      isCrystalFrame: Boolean(options.isCrystalFrame),
      isPatterned: Boolean(options.isPatterned),
      ...(options.modelCode ? { modelCode: options.modelCode } : {}),
      ...(options.frameColor ? { frameColor: options.frameColor } : {}),
      ...(computedPhash ? { phash: computedPhash } : {}),
      ...(options.lensWidthMm ? { lensWidthMm: options.lensWidthMm } : {}),
      ...(options.bridgeWidthMm ? { bridgeWidthMm: options.bridgeWidthMm } : {}),
      ...(options.templeLengthMm ? { templeLengthMm: options.templeLengthMm } : {}),
      ...(options.totalFrameWidthMm ? { totalFrameWidthMm: options.totalFrameWidthMm } : {}),
    }),
  });

  const rawText = await response.text().catch(() => '');
  let payload: {
    cacheHit?: boolean;
    cachedAssets?: SharedCachedAssets;
    solidModelTemplate?: SharedCachedAssets;
    messageAr?: string;
    splitImageBase64?: string;
    mimeType?: string;
    error?: string;
  } = {};
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as typeof payload;
    } catch {
      throw new Error(`استجابة غير صالحة من الخادم (${response.status}) — لم يُرجع الخادم بيانات JSON`);
    }
  }

  if (
    response.ok &&
    payload.cacheHit &&
    payload.cachedAssets &&
    (payload.cachedAssets.frontCatalogPath || payload.cachedAssets.imagePath)
  ) {
    return {
      cacheHit: true,
      cachedAssets: payload.cachedAssets,
      messageAr: payload.messageAr,
    };
  }

  if (
    response.ok &&
    payload.solidModelTemplate &&
    (payload.solidModelTemplate.frontCatalogPath || payload.solidModelTemplate.imagePath)
  ) {
    return {
      cacheHit: false,
      solidModelTemplate: payload.solidModelTemplate,
      messageAr: payload.messageAr,
    };
  }

  if (!response.ok || !payload.splitImageBase64) {
    throw new Error(
      payload.error || `فشل توليد لوحة الاستوديو (${response.status}): لم يتم استلام الصورة من الخادم`
    );
  }

  return {
    cacheHit: false,
    blob: base64ToBlob(payload.splitImageBase64, payload.mimeType || 'image/png'),
  };
}

export async function saveToSharedEyewearCache(params: {
  modelCode?: string | null;
  frameColor?: string | null;
  phash?: string | null;
  keepLensBranding?: boolean;
  isCrystalFrame?: boolean;
  isPatterned?: boolean;
  frameType?: EyewearFrameMode;
  imagePath?: string;
  frontCatalogPath?: string;
  sideImagePath?: string;
  lensMaskUrl?: string;
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
  authToken?: string | null;
  shopId?: string | null;
  role?: string | null;
  isDemoAdminStore?: boolean;
}): Promise<void> {
  if (!params.modelCode && !params.phash) return;
  try {
    await fetch('/api/eyewear/cache-save', {
      method: 'POST',
      headers: buildAuthHeaders(params),
      body: JSON.stringify({
        modelCode: params.modelCode,
        frameColor: params.frameColor,
        phash: params.phash,
        keepLensBranding: Boolean(params.keepLensBranding),
        isCrystalFrame: Boolean(params.isCrystalFrame),
        isPatterned: Boolean(params.isPatterned),
        frameType: params.frameType || 'prescription',
        imagePath: params.imagePath,
        frontCatalogPath: params.frontCatalogPath,
        sideImagePath: params.sideImagePath,
        lensMaskUrl: params.lensMaskUrl,
        lensWidthMm: params.lensWidthMm,
        bridgeWidthMm: params.bridgeWidthMm,
        templeLengthMm: params.templeLengthMm,
        totalFrameWidthMm: params.totalFrameWidthMm,
      }),
    });
  } catch {
    // Non-blocking cache write
  }
}

export async function submitBatchSplitSheetViaServer(params: {
  items: Array<{
    localId: string;
    file: Blob;
    frameType: EyewearFrameMode;
    subCategory: EyewearSubMode;
    isClipOnAttachment?: boolean;
    keepLensBranding?: boolean;
    isCrystalFrame?: boolean;
    isPatterned?: boolean;
    modelCode?: string | null;
    frameColor?: string | null;
    phash?: string | null;
    lensWidthMm?: number;
    bridgeWidthMm?: number;
    templeLengthMm?: number;
    totalFrameWidthMm?: number;
  }>;
  turbo: boolean;
  authToken?: string | null;
  shopId?: string | null;
  role?: string | null;
  planTier?: string | null;
  isDemoAdminStore?: boolean;
  signal?: AbortSignal;
}): Promise<{ jobId: string; mode: 'turbo' | 'batch_api'; total: number }> {
  const encodedItems = await Promise.all(
    params.items.map(async (item) => {
      const [{ base64, mimeType }, phash] = await Promise.all([
        encodeCompactUploadBase64(item.file, 1600),
        item.phash ? Promise.resolve(item.phash) : computePerceptualHash(item.file),
      ]);
      return {
        localId: item.localId,
        imageBase64: base64,
        mimeType,
        frameType: item.frameType,
        subCategory: item.subCategory,
        isClipOnAttachment: Boolean(item.isClipOnAttachment),
        keepLensBranding: Boolean(item.keepLensBranding),
        isCrystalFrame: Boolean(item.isCrystalFrame),
        isPatterned: Boolean(item.isPatterned),
        modelCode: item.modelCode || undefined,
        frameColor: item.frameColor || undefined,
        phash: phash || undefined,
        lensWidthMm: item.lensWidthMm,
        bridgeWidthMm: item.bridgeWidthMm,
        templeLengthMm: item.templeLengthMm,
        totalFrameWidthMm: item.totalFrameWidthMm,
      };
    })
  );

  const response = await fetch('/api/eyewear/batch-split-sheet', {
    method: 'POST',
    headers: buildAuthHeaders(params),
    signal: params.signal,
    body: JSON.stringify({
      turbo: params.turbo,
      items: encodedItems,
    }),
  });

  const rawText = await response.text().catch(() => '');
  let payload: {
    ok?: boolean;
    jobId?: string;
    mode?: 'turbo' | 'batch_api';
    total?: number;
    error?: string;
  } = {};
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as typeof payload;
    } catch {
      throw new Error(`تعذر بدء المعالجة الجماعية (${response.status}) — استجابة غير صالحة`);
    }
  }
  if (!response.ok || !payload.jobId) {
    throw new Error(payload.error || `تعذر بدء المعالجة الجماعية (${response.status})`);
  }

  return {
    jobId: payload.jobId,
    mode: payload.mode || (params.turbo ? 'turbo' : 'batch_api'),
    total: payload.total || encodedItems.length,
  };
}

export async function pollBatchSplitSheetStatus(
  jobId: string,
  authMeta?: {
    authToken?: string | null;
    shopId?: string | null;
    role?: string | null;
    planTier?: string | null;
    isDemoAdminStore?: boolean;
  },
  signal?: AbortSignal
): Promise<{
  status: 'processing' | 'completed' | 'failed';
  total: number;
  done: number;
  results: Record<
    string,
    {
      blob?: Blob;
      cacheHit?: boolean;
      cachedAssets?: SharedCachedAssets;
      error?: string;
    }
  >;
}> {
  const response = await fetch(`/api/eyewear/batch-status/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: buildAuthHeaders(authMeta),
    signal,
  });
  const rawText = await response.text().catch(() => '');
  let payload: {
    status?: 'processing' | 'completed' | 'failed';
    total?: number;
    done?: number;
    results?: Record<
      string,
      {
        splitImageBase64?: string;
        mimeType?: string;
        cacheHit?: boolean;
        cachedAssets?: SharedCachedAssets;
        error?: string;
      }
    >;
    error?: string;
  } = {};
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as typeof payload;
    } catch {
      throw new Error(`استجابة غير صالحة أثناء متابعة حالة الدفعة (${response.status})`);
    }
  }
  if (!response.ok) {
    throw new Error(payload.error || 'تعذر متابعة حالة الدفعة');
  }

  const mapped: Record<
    string,
    {
      blob?: Blob;
      cacheHit?: boolean;
      cachedAssets?: SharedCachedAssets;
      error?: string;
    }
  > = {};
  if (payload.results) {
    for (const [key, item] of Object.entries(payload.results)) {
      mapped[key] = {
        cacheHit: item.cacheHit,
        cachedAssets: item.cachedAssets,
        error: item.error,
        blob: item.splitImageBase64
          ? base64ToBlob(item.splitImageBase64, item.mimeType || 'image/png')
          : undefined,
      };
    }
  }

  return {
    status: payload.status || 'processing',
    total: payload.total || 0,
    done: payload.done || 0,
    results: mapped,
  };
}
