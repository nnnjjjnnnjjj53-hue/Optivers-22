import { EyewearFrameMode, EyewearSubMode } from '../types';

export interface SplitSheetPayloadOptions {
  frameType: EyewearFrameMode;
  subCategory: EyewearSubMode;
  isClipOnAttachment?: boolean;
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
}

export interface ExtractedOpticalDimensionsResult {
  found: boolean;
  lensWidthMm: number | null;
  bridgeWidthMm: number | null;
  templeLengthMm: number | null;
  totalFrameWidthMm: number | null;
  rawText: string | null;
}

/**
 * Downscales any phone photo to max 1024px JPEG before sending to the server
 * and immediately disposes the temporary canvas/bitmap so RAM stays O(1).
 */
async function encodeCompactUploadBase64(
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

function base64ToBlob(base64: string, mimeType: string): Blob {
  const clean = base64.replace(/^data:[^;]+;base64,/, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Step 1 Pre-Processing OCR: Reads printed optical sizing (e.g. 52□18-140) from the uploaded image
 * strictly BEFORE triggering 16:9 studio split-sheet generation.
 */
export async function extractOpticalDimensionsViaServer(
  file: Blob,
  signal?: AbortSignal
): Promise<ExtractedOpticalDimensionsResult> {
  const { base64, mimeType } = await encodeCompactUploadBase64(file, 1024);
  if (signal?.aborted) {
    throw new DOMException('تم إلغاء الطلب', 'AbortError');
  }

  try {
    const response = await fetch('/api/eyewear/extract-dimensions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      raw_text?: string | null;
    };

    if (!response.ok) {
      return {
        found: false,
        lensWidthMm: null,
        bridgeWidthMm: null,
        templeLengthMm: null,
        totalFrameWidthMm: null,
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
      rawText: null,
    };
  }
}

/**
 * Single-call 16:9 Side-by-Side Split Sheet request (cuts Gemini API cost by 50%).
 * Propagates upstream HTTP errors directly to the UI without masking failures.
 */
export async function generateSplitSheetViaServer(
  file: Blob,
  options: SplitSheetPayloadOptions,
  signal?: AbortSignal
): Promise<Blob> {
  const { base64, mimeType } = await encodeCompactUploadBase64(file, 1024);
  if (signal?.aborted) {
    throw new DOMException('تم إلغاء الطلب', 'AbortError');
  }

  const response = await fetch('/api/eyewear/split-sheet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      imageBase64: base64,
      mimeType,
      frameType: options.frameType,
      subCategory: options.subCategory,
      isClipOnAttachment: Boolean(options.isClipOnAttachment),
      ...(options.lensWidthMm ? { lensWidthMm: options.lensWidthMm } : {}),
      ...(options.bridgeWidthMm ? { bridgeWidthMm: options.bridgeWidthMm } : {}),
      ...(options.templeLengthMm ? { templeLengthMm: options.templeLengthMm } : {}),
      ...(options.totalFrameWidthMm ? { totalFrameWidthMm: options.totalFrameWidthMm } : {}),
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    splitImageBase64?: string;
    mimeType?: string;
    error?: string;
  };

  if (!response.ok || !payload.splitImageBase64) {
    throw new Error(payload.error || `فشل توليد لوحة الاستوديو (${response.status})`);
  }

  return base64ToBlob(payload.splitImageBase64, payload.mimeType || 'image/png');
}
