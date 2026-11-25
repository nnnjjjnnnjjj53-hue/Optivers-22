import { EyewearFrameMode, EyewearSubMode } from '../types';

export interface SplitSheetPayloadOptions {
  frameType: EyewearFrameMode;
  subCategory: EyewearSubMode;
  isClipOnAttachment?: boolean;
  keepLensBranding?: boolean;
  isCrystalFrame?: boolean;
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
 * Downscales any phone photo to max 1024px JPEG before sending to the server
 * and immediately disposes the temporary canvas/bitmap so RAM stays O(1).
 */
export async function encodeCompactUploadBase64(
  file: Blob,
  maxSidePx = 1024
): Promise<{ base64: string; mimeType: string }> {
  let bm: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (typeof createImageBitmap === 'function') {
      try {
        bm = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        bm = await createImageBitmap(file);
      }
      const scale = Math.min(1, maxSidePx / Math.max(bm.width, bm.height));
      const w = Math.max(1, Math.round(bm.width * scale));
      const h = Math.max(1, Math.round(bm.height * scale));
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bm, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        return {
          base64: dataUrl.replace(/^data:[^;]+;base64,/, ''),
          mimeType: 'image/jpeg',
        };
      }
    }
  } catch {
    // Fallback to raw FileReader base64 if bitmap decoding fails
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
 * brand/model code, and crystal/transparent acetate status using free-tier gemini-2.5-flash-lite.
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
  const { base64, mimeType } = await encodeCompactUploadBase64(file, 1024);
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
    encodeCompactUploadBase64(file, 1024),
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
      ...(options.modelCode ? { modelCode: options.modelCode } : {}),
      ...(options.frameColor ? { frameColor: options.frameColor } : {}),
      ...(computedPhash ? { phash: computedPhash } : {}),
      ...(options.lensWidthMm ? { lensWidthMm: options.lensWidthMm } : {}),
      ...(options.bridgeWidthMm ? { bridgeWidthMm: options.bridgeWidthMm } : {}),
      ...(options.templeLengthMm ? { templeLengthMm: options.templeLengthMm } : {}),
      ...(options.totalFrameWidthMm ? { totalFrameWidthMm: options.totalFrameWidthMm } : {}),
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    cacheHit?: boolean;
    cachedAssets?: SharedCachedAssets;
    messageAr?: string;
    splitImageBase64?: string;
    mimeType?: string;
    error?: string;
  };

  if (response.ok && payload.cacheHit && payload.cachedAssets) {
    return {
      cacheHit: true,
      cachedAssets: payload.cachedAssets,
      messageAr: payload.messageAr,
    };
  }

  if (!response.ok || !payload.splitImageBase64) {
    throw new Error(payload.error || `فشل توليد لوحة الاستوديو (${response.status})`);
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
        encodeCompactUploadBase64(item.file, 1024),
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

  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    jobId?: string;
    mode?: 'turbo' | 'batch_api';
    total?: number;
    error?: string;
  };
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
  const payload = (await response.json().catch(() => ({}))) as {
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
  };
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
