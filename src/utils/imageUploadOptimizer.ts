export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_IMAGE_WIDTH = 1600;
export const DEFAULT_WEBP_QUALITY = 0.8;

export interface OptimizedUploadResult {
  blob: Blob;
  ext: string;
  contentType: string;
}

function isRasterImageMimeOrExt(mime: string, ext?: string): boolean {
  const cleanExt = (ext || '').toLowerCase();
  if (cleanExt === 'glb' || cleanExt === 'pdf' || cleanExt === 'svg') return false;
  if (mime === 'model/gltf-binary' || mime === 'application/pdf' || mime === 'image/svg+xml') return false;
  if (mime.startsWith('image/')) return true;
  return ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'avif'].includes(cleanExt);
}

async function decodeToDrawable(blob: Blob): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fallback to HTMLImageElement
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('تعذّر قراءة ملف الصورة'));
    };
    img.src = url;
  });
}

function canvasToBlobAsync(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), mimeType, quality);
  });
}

export async function optimizeImageForUpload(
  input: Blob,
  opts?: {
    extHint?: string;
    maxWidth?: number;
    quality?: number;
    maxBytes?: number;
    preservePngIfAlreadySmall?: boolean;
  }
): Promise<OptimizedUploadResult> {
  const maxBytes = opts?.maxBytes ?? MAX_UPLOAD_BYTES;
  const maxWidth = opts?.maxWidth ?? DEFAULT_MAX_IMAGE_WIDTH;
  const quality = opts?.quality ?? DEFAULT_WEBP_QUALITY;
  const cleanExt = (opts?.extHint || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const mime = (input.type || '').toLowerCase();

  if (input.size > maxBytes * 3 && isRasterImageMimeOrExt(mime, cleanExt)) {
    throw new Error('حجم الصورة الأصلي كبير جداً (الحد الأقصى 5 ميجابايت بعد الضغط)');
  }

  if (!isRasterImageMimeOrExt(mime, cleanExt)) {
    if (input.size > maxBytes) {
      throw new Error('حجم الملف يتجاوز الحد الأقصى المسموح به (5 ميجابايت)');
    }
    const resolvedExt =
      cleanExt ||
      (mime === 'application/pdf' ? 'pdf' : mime === 'model/gltf-binary' ? 'glb' : 'bin');
    const resolvedType =
      mime ||
      (resolvedExt === 'pdf'
        ? 'application/pdf'
        : resolvedExt === 'glb'
        ? 'model/gltf-binary'
        : 'application/octet-stream');
    return {
      blob: input,
      ext: resolvedExt,
      contentType: resolvedType,
    };
  }

  if (typeof document === 'undefined') {
    if (input.size > maxBytes) {
      throw new Error('حجم الصورة يتجاوز الحد الأقصى المسموح به (5 ميجابايت)');
    }
    return {
      blob: input,
      ext: cleanExt || 'webp',
      contentType: mime || 'image/webp',
    };
  }

  const drawable = await decodeToDrawable(input);
  const srcW = 'naturalWidth' in drawable ? drawable.naturalWidth : drawable.width;
  const srcH = 'naturalHeight' in drawable ? drawable.naturalHeight : drawable.height;

  const scale = srcW > maxWidth ? maxWidth / Math.max(1, srcW) : 1;
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if ('close' in drawable && typeof drawable.close === 'function') drawable.close();
    throw new Error('تعذّر معالجة الصورة قبل الرفع');
  }
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(drawable, 0, 0, targetW, targetH);
  if ('close' in drawable && typeof drawable.close === 'function') {
    drawable.close();
  }

  let webpBlob = await canvasToBlobAsync(canvas, 'image/webp', quality);
  if (webpBlob && webpBlob.size > maxBytes) {
    webpBlob = await canvasToBlobAsync(canvas, 'image/webp', 0.65);
  }

  const finalBlob = webpBlob || input;
  if (finalBlob.size > maxBytes) {
    throw new Error('حجم الصورة يتجاوز الحد الأقصى المسموح به (5 ميجابايت)');
  }

  return {
    blob: finalBlob,
    ext: webpBlob ? 'webp' : cleanExt || 'jpg',
    contentType: webpBlob ? 'image/webp' : mime || 'image/jpeg',
  };
}
