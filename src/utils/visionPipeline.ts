import { FrameCat } from '../types';
import { processGlassesImageInWorker } from './glassesWorkerClient';

export type ExtractionPreset = 'auto' | 'thin_metal' | 'transparent' | 'sunglasses';

export interface EditedGlassesAsset {
  imageDataUrl: string;
  imageBlob: Blob;
  originalDataUrl: string;
  originalBlob: Blob;
  maskDataUrl: string;
  maskBlob: Blob;
  mimeExt: 'webp' | 'png';
  width: number;
  height: number;
  sampledFrameColor: string;
  sampledLensColor: string;
  presetUsed: ExtractionPreset;
  usedFallbackExtractor?: boolean;
}

export interface ExtractGlassesOptions {
  angleYaw?: number;
  preset?: ExtractionPreset;
  category?: FrameCat;
  trimTemples?: boolean;
  onProgress?: (label: string) => void;
}

export interface LensPocket {
  pixels: Int32Array;
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime = 'image/png', quality = 0.94): Promise<Blob> {
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

export async function loadImageToCanvas(
  source: File | Blob | HTMLVideoElement | HTMLImageElement | string,
  maxDim = 1024
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  if (source instanceof HTMLVideoElement) {
    const w = source.videoWidth || 1280;
    const h = source.videoHeight || 720;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  let img: HTMLImageElement;
  let revokeUrl: string | null = null;
  if (source instanceof HTMLImageElement) {
    img = source;
  } else {
    img = new Image();
    img.crossOrigin = 'anonymous';
    const srcUrl =
      typeof source === 'string'
        ? source
        : ((revokeUrl = URL.createObjectURL(source)), revokeUrl);
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('تعذر قراءة الصورة'));
      img.src = srcUrl;
    });
  }

  const w = img.naturalWidth || img.width || 800;
  const h = img.naturalHeight || img.height || 600;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  if (revokeUrl) URL.revokeObjectURL(revokeUrl);
  return canvas;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(0.0001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Samples average border color from the original photo so enclosed light/gray/cream backgrounds
 * inside lenses and around edges can be distinguished accurately from colored or clear frames.
 */
export function sampleOuterBorderColorPixels(
  rawD: Uint8ClampedArray,
  w: number,
  h: number
): { r: number; g: number; b: number } {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let count = 0;
  const margin = Math.max(2, Math.min(10, Math.round(Math.min(w, h) * 0.025)));

  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (x < margin || x >= w - margin || y < margin || y >= h - margin) {
        const i = (y * w + x) * 4;
        if (rawD[i + 3] < 20) continue;
        sr += rawD[i];
        sg += rawD[i + 1];
        sb += rawD[i + 2];
        count++;
      }
    }
  }
  if (!count) return { r: 245, g: 245, b: 245 };
  return { r: sr / count, g: sg / count, b: sb / count };
}

/**
 * Fallback/supplementary background-flood + edge-aware foreground extractor.
 * Used either to recover transparent crystal/thin metal rims or as a 100% offline fallback if ML WASM fails.
 */
export function extractFallbackForegroundFromPixels(
  rawD: Uint8ClampedArray,
  w: number,
  h: number,
  outerBg: { r: number; g: number; b: number },
  preset: ExtractionPreset = 'auto'
): Uint8ClampedArray {
  const total = w * h;
  const out = new Uint8ClampedArray(rawD);
  const bgDist = new Float32Array(total);
  const edgeMag = new Float32Array(total);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      const r = rawD[i];
      const g = rawD[i + 1];
      const b = rawD[i + 2];
      bgDist[p] = Math.hypot(r - outerBg.r, g - outerBg.g, b - outerBg.b);

      if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        const l = (p - 1) * 4;
        const rt = (p + 1) * 4;
        const u = (p - w) * 4;
        const dn = (p + w) * 4;
        const gx = Math.hypot(rawD[rt] - rawD[l], rawD[rt + 1] - rawD[l + 1], rawD[rt + 2] - rawD[l + 2]);
        const gy = Math.hypot(rawD[dn] - rawD[u], rawD[dn + 1] - rawD[u + 1], rawD[dn + 2] - rawD[u + 2]);
        edgeMag[p] = Math.hypot(gx, gy);
      }
    }
  }

  const bgThreshold = preset === 'transparent' ? 14 : preset === 'thin_metal' ? 20 : 24;
  const edgeStop = preset === 'transparent' ? 16 : 24;
  const exactBgTol = preset === 'transparent' ? 6 : 10;

  const isBg = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const pushIfBg = (p: number) => {
    if (isBg[p]) return;
    if (bgDist[p] <= exactBgTol || (bgDist[p] <= bgThreshold && edgeMag[p] <= edgeStop)) {
      isBg[p] = 1;
      queue[tail++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    pushIfBg(x);
    pushIfBg((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    pushIfBg(y * w);
    pushIfBg(y * w + w - 1);
  }

  while (head < tail) {
    const cur = queue[head++];
    const x = cur % w;
    const y = (cur - x) / w;
    if (x > 0) pushIfBg(cur - 1);
    if (x < w - 1) pushIfBg(cur + 1);
    if (y > 0) pushIfBg(cur - w);
    if (y < h - 1) pushIfBg(cur + w);
  }

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (isBg[p] || bgDist[p] <= exactBgTol) {
      out[i + 3] = 0;
    } else {
      const soft = smoothstep(exactBgTol, bgThreshold * 1.4, bgDist[p]);
      out[i + 3] = Math.round(rawD[i + 3] * Math.max(0.18, soft));
    }
  }
  return out;
}

/**
 * Recovers thin metal wires or semi-transparent crystal acetate pixels near the foreground
 * that neural segmentation occasionally under-segments.
 */
function recoverFineAndTransparentRims(
  d: Uint8ClampedArray,
  rawD: Uint8ClampedArray,
  w: number,
  h: number,
  outerBg: { r: number; g: number; b: number },
  preset: ExtractionPreset
) {
  const total = w * h;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 70) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return;

  // Expand slightly around the detected frame box to rescue clipped thin wire nose-pads/bridges/crystal edges
  const pad = preset === 'thin_metal' || preset === 'transparent' ? 14 : 8;
  minX = Math.max(1, minX - pad);
  maxX = Math.min(w - 2, maxX + pad);
  minY = Math.max(1, minY - pad);
  maxY = Math.min(h - 2, maxY + pad);

  // Build distance-to-opaque seed (within 6px) so we never rescue distant background noise
  const nearSolid = new Uint8Array(total);
  const expandR = preset === 'transparent' ? 6 : 4;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (d[(y * w + x) * 4 + 3] > 80) {
        for (let dy = -expandR; dy <= expandR; dy++) {
          const ny = y + dy;
          if (ny < minY || ny > maxY) continue;
          for (let dx = -expandR; dx <= expandR; dx++) {
            const nx = x + dx;
            if (nx < minX || nx > maxX) continue;
            nearSolid[ny * w + nx] = 1;
          }
        }
      }
    }
  }

  const distThresh = preset === 'transparent' ? 15 : preset === 'thin_metal' ? 21 : 28;
  const edgeThresh = preset === 'transparent' ? 20 : preset === 'thin_metal' ? 26 : 34;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = y * w + x;
      const i = p * 4;
      if (d[i + 3] >= 180 || !nearSolid[p]) continue;

      const r = rawD[i];
      const g = rawD[i + 1];
      const b = rawD[i + 2];
      const bgDiff = Math.hypot(r - outerBg.r, g - outerBg.g, b - outerBg.b);

      const l = (p - 1) * 4;
      const rt = (p + 1) * 4;
      const u = (p - w) * 4;
      const dn = (p + w) * 4;
      const gx = Math.hypot(rawD[rt] - rawD[l], rawD[rt + 1] - rawD[l + 1], rawD[rt + 2] - rawD[l + 2]);
      const gy = Math.hypot(rawD[dn] - rawD[u], rawD[dn + 1] - rawD[u + 1], rawD[dn + 2] - rawD[u + 2]);
      const grad = Math.hypot(gx, gy);

      // Rescue thin wire / crystal edge pixel with genuine structural contrast
      if (bgDiff >= distThresh && (grad >= edgeThresh || bgDiff >= distThresh * 1.45)) {
        const recoveredA = Math.round(
          Math.max(
            d[i + 3],
            Math.min(
              preset === 'transparent' ? 215 : 245,
              110 + smoothstep(distThresh, distThresh * 2.4, bgDiff + grad * 0.5) * 135
            )
          )
        );
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = recoveredA;
      }
    }
  }
}

/**
 * Keeps the main glasses connected component(s) and wipes out small leftover background specks
 * without erasing thin wire rims or detached hinges/temple segments.
 */
function removeSmallSpecks(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  minAlpha = 22,
  preset: ExtractionPreset = 'auto'
) {
  const total = w * h;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const comps: { pixels: Int32Array; area: number }[] = [];

  for (let p = 0; p < total; p++) {
    if (visited[p] || d[p * 4 + 3] <= minAlpha) continue;
    let qh = 0;
    let qt = 0;
    visited[p] = 1;
    queue[qt++] = p;

    while (qh < qt) {
      const cur = queue[qh++];
      const x = cur % w;
      const y = (cur - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const np = ny * w + nx;
          if (!visited[np] && d[np * 4 + 3] > minAlpha) {
            visited[np] = 1;
            queue[qt++] = np;
          }
        }
      }
    }

    comps.push({ pixels: queue.slice(0, qt), area: qt });
  }

  if (comps.length <= 1) return;
  comps.sort((a, b) => b.area - a.area);
  const mainArea = comps[0].area;
  // Much gentler speck threshold on thin-metal & transparent frames so 1-2px segments are never erased
  const ratio = preset === 'thin_metal' || preset === 'transparent' ? 0.004 : 0.01;
  const minFloor = preset === 'thin_metal' || preset === 'transparent' ? 14 : 28;
  const threshold = Math.max(minFloor, Math.round(mainArea * ratio));

  for (let c = 1; c < comps.length; c++) {
    if (comps[c].area < threshold) {
      const px = comps[c].pixels;
      for (let k = 0; k < px.length; k++) {
        const i = px[k] * 4;
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
      }
    }
  }
}

/**
 * Computes Chamfer Euclidean distance transform from transparent background pixels (`alpha <= minAlpha`).
 */
function computeDistanceFromBackground(d: Uint8ClampedArray, w: number, h: number, minAlpha = 22): Float32Array {
  const total = w * h;
  const dist = new Float32Array(total);
  const INF = 1e6;

  for (let p = 0; p < total; p++) {
    dist[p] = d[p * 4 + 3] <= minAlpha ? 0 : INF;
  }

  const SQRT2 = 1.4142135;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = dist[p];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, dist[p - 1] + 1);
      if (y > 0) {
        v = Math.min(v, dist[p - w] + 1);
        if (x > 0) v = Math.min(v, dist[p - w - 1] + SQRT2);
        if (x < w - 1) v = Math.min(v, dist[p - w + 1] + SQRT2);
      }
      dist[p] = v;
    }
  }

  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      let v = dist[p];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, dist[p + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, dist[p + w] + 1);
        if (x < w - 1) v = Math.min(v, dist[p + w + 1] + SQRT2);
        if (x > 0) v = Math.min(v, dist[p + w - 1] + SQRT2);
      }
      dist[p] = v;
    }
  }

  return dist;
}

/**
 * Stroke-width-aware edge refinement & background-color decontamination.
 * CRITICAL FIX vs legacy pipeline:
 * - Thin metal wires / nose-pad arms (localMaxDist <= 3.2) are NEVER eroded; only halo color is decontaminated.
 * - Thick acetate edges receive subtle ~0.6px anti-aliased feathering without chewing into hinges.
 * - Uses sampled `outerBg` for un-premultiplying edge bleed so neither white nor dark halos appear.
 */
function smoothEdgesAndDefringe(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  outerBg: { r: number; g: number; b: number },
  preset: ExtractionPreset
) {
  const total = w * h;
  const dist = computeDistanceFromBackground(d, w, h, 22);

  const localMaxDist = new Float32Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (dist[p] === 0) continue;
      let m = dist[p];
      for (let dy = -2; dy <= 2; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const nd = dist[ny * w + nx];
          if (nd > m) m = nd;
        }
      }
      localMaxDist[p] = m;
    }
  }

  const origCopy = new Uint8ClampedArray(d);
  const bgLum = 0.299 * outerBg.r + 0.587 * outerBg.g + 0.114 * outerBg.b;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      const origA = origCopy[i + 3];
      if (origA <= 22) {
        d[i + 3] = 0;
        continue;
      }

      const dp = dist[p];
      const thick = localMaxDist[p];
      const isThinFeature = thick <= 3.4 || preset === 'thin_metal' || preset === 'transparent';

      // Preserve 100% of thin wire/metal pixels; apply subtle <1px smoothing only on thicker frames
      let newA = origA;
      if (!isThinFeature && dp < 1.9) {
        newA = Math.round(origA * smoothstep(0.2, 1.45, dp));
      }

      if (dp <= 3.2 && newA > 0) {
        const r = origCopy[i];
        const g = origCopy[i + 1];
        const b = origCopy[i + 2];
        const pixBgDist = Math.hypot(r - outerBg.r, g - outerBg.g, b - outerBg.b);

        // Locate nearest crisp interior color pixel to recover edge RGB without halo bleed
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let sCount = 0;
        const minIntDist = isThinFeature ? 1.0 : 1.8;
        for (let dy = -3; dy <= 3; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const np = ny * w + nx;
            const ni = np * 4;
            if (dist[np] >= minIntDist && origCopy[ni + 3] >= 180) {
              const ndBg = Math.hypot(
                origCopy[ni] - outerBg.r,
                origCopy[ni + 1] - outerBg.g,
                origCopy[ni + 2] - outerBg.b
              );
              if (ndBg > 24) {
                sr += origCopy[ni];
                sg += origCopy[ni + 1];
                sb += origCopy[ni + 2];
                sCount++;
              }
            }
          }
        }

        if (sCount > 0) {
          const ir = sr / sCount;
          const ig = sg / sCount;
          const ib = sb / sCount;
          const intBgDist = Math.hypot(ir - outerBg.r, ig - outerBg.g, ib - outerBg.b);

          // Decontaminate pixels blended heavily toward background color (white OR dark halo removal)
          const looksLikeHalo = pixBgDist < Math.max(26, intBgDist * 0.45);
          if (looksLikeHalo && preset !== 'transparent') {
            const pull = dp <= 1.6 ? 0.78 : 0.45;
            d[i] = Math.round(r * (1 - pull) + ir * pull);
            d[i + 1] = Math.round(g * (1 - pull) + ig * pull);
            d[i + 2] = Math.round(b * (1 - pull) + ib * pull);
            if (!isThinFeature && dp <= 1.25 && pixBgDist < 16) {
              newA = Math.round(newA * 0.55);
            }
          }
        }

        // Un-premultiply semi-transparent edge pixels against actual sampled outerBg
        const aNorm = newA / 255;
        if (aNorm > 0.12 && aNorm < 0.88 && preset !== 'transparent') {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (Math.abs(lum - bgLum) < 42 && pixBgDist < 48) {
            const denom = Math.max(0.4, aNorm);
            d[i] = Math.max(0, Math.min(255, Math.round((d[i] - (1 - aNorm) * outerBg.r) / denom)));
            d[i + 1] = Math.max(0, Math.min(255, Math.round((d[i + 1] - (1 - aNorm) * outerBg.g) / denom)));
            d[i + 2] = Math.max(0, Math.min(255, Math.round((d[i + 2] - (1 - aNorm) * outerBg.b) / denom)));
          }
        }
      }

      d[i + 3] = newA;
    }
  }
}

/**
 * Detects the left & right symmetric lens cavities inside the frame.
 */
export function detectTwoSymmetricLenses(
  d: Uint8ClampedArray,
  rawD: Uint8ClampedArray,
  w: number,
  h: number,
  outerBg: { r: number; g: number; b: number },
  isSunglasses = false
): { leftLens: LensPocket | null; rightLens: LensPocket | null } {
  const total = w * h;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 32) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return { leftLens: null, rightLens: null };

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const boxArea = boxW * boxH;

  // Compute dominant outer-rim color along the top & outer perimeter of the opaque silhouette
  let rimR = 0;
  let rimG = 0;
  let rimB = 0;
  let rimCount = 0;
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= Math.min(maxY, minY + Math.round(boxH * 0.25)); y++) {
      const p = y * w + x;
      if (d[p * 4 + 3] > 180) {
        const bgD = Math.hypot(
          rawD[p * 4] - outerBg.r,
          rawD[p * 4 + 1] - outerBg.g,
          rawD[p * 4 + 2] - outerBg.b
        );
        if (bgD < 26) continue;
        rimR += rawD[p * 4];
        rimG += rawD[p * 4 + 1];
        rimB += rawD[p * 4 + 2];
        rimCount++;
        break;
      }
    }
  }
  const avgRim = rimCount > 0 ? { r: rimR / rimCount, g: rimG / rimCount, b: rimB / rimCount } : null;

  // Identify candidate clear OR tinted lens pixels
  const isLensCandidatePx = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const a = d[i + 3];
    if (a < 85) {
      isLensCandidatePx[p] = 1;
      continue;
    }
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const bgDist = Math.hypot(rawD[i] - outerBg.r, rawD[i + 1] - outerBg.g, rawD[i + 2] - outerBg.b);

    // Clear lens pixels match background closely OR appear bright neutral glass
    if ((bgDist < 58 && chroma < 48) || (lum > 148 && chroma < 38)) {
      isLensCandidatePx[p] = 1;
      continue;
    }

    // For tinted sunglasses: smooth interior region whose color differs cleanly from the outer frame rim
    if (isSunglasses && avgRim) {
      const rimDist = Math.hypot(rawD[i] - avgRim.r, rawD[i + 1] - avgRim.g, rawD[i + 2] - avgRim.b);
      if (rimDist > 24 && bgDist > 26) {
        isLensCandidatePx[p] = 1;
      }
    }
  }

  // Flood-fill true exterior background from canvas edges across transparent pixels (a < 42)
  const exterior = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const pushExt = (p: number) => {
    if (exterior[p] || d[p * 4 + 3] >= 42) return;
    exterior[p] = 1;
    queue[tail++] = p;
  };

  for (let x = 0; x < w; x++) {
    pushExt(x);
    pushExt((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    pushExt(y * w);
    pushExt(y * w + w - 1);
  }

  while (head < tail) {
    const cur = queue[head++];
    const x = cur % w;
    const y = (cur - x) / w;
    if (x > 0) pushExt(cur - 1);
    if (x < w - 1) pushExt(cur + 1);
    if (y > 0) pushExt(cur - w);
    if (y < h - 1) pushExt(cur + w);
  }

  const visited = new Uint8Array(total);
  const pockets: LensPocket[] = [];
  const minArea = Math.max(80, Math.round(boxArea * 0.015));
  const maxArea = Math.round(boxArea * 0.34);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = y * w + x;
      if (exterior[p] || visited[p] || !isLensCandidatePx[p]) continue;

      let qh = 0;
      let qt = 0;
      visited[p] = 1;
      queue[qt++] = p;

      while (qh < qt) {
        const cur = queue[qh++];
        const cx = cur % w;
        const cy = (cur - cx) / w;
        const nb = [
          cx > minX ? cur - 1 : -1,
          cx < maxX ? cur + 1 : -1,
          cy > minY ? cur - w : -1,
          cy < maxY ? cur + w : -1,
        ];
        for (const np of nb) {
          if (np >= 0 && !exterior[np] && !visited[np] && isLensCandidatePx[np]) {
            visited[np] = 1;
            queue[qt++] = np;
          }
        }
      }

      if (qt >= minArea && qt <= maxArea) {
        let sx = 0;
        let sy = 0;
        let pMinX = w;
        let pMaxX = -1;
        let pMinY = h;
        let pMaxY = -1;
        for (let k = 0; k < qt; k++) {
          const px = queue[k] % w;
          const py = (queue[k] - px) / w;
          sx += px;
          sy += py;
          if (px < pMinX) pMinX = px;
          if (px > pMaxX) pMaxX = px;
          if (py < pMinY) pMinY = py;
          if (py > pMaxY) pMaxY = py;
        }
        pockets.push({
          pixels: queue.slice(0, qt),
          cx: (sx / qt - minX) / boxW,
          cy: (sy / qt - minY) / boxH,
          minX: pMinX,
          maxX: pMaxX,
          minY: pMinY,
          maxY: pMaxY,
        });
      }
    }
  }

  const leftCandidates = pockets
    .filter((c) => c.cx >= 0.08 && c.cx <= 0.47 && c.cy >= 0.14 && c.cy <= 0.86)
    .sort((a, b) => b.pixels.length - a.pixels.length);
  const rightCandidates = pockets
    .filter((c) => c.cx >= 0.53 && c.cx <= 0.92 && c.cy >= 0.14 && c.cy <= 0.86)
    .sort((a, b) => b.pixels.length - a.pixels.length);

  for (const lc of leftCandidates) {
    for (const rc of rightCandidates) {
      const ratio = Math.min(lc.pixels.length, rc.pixels.length) / Math.max(1, Math.max(lc.pixels.length, rc.pixels.length));
      if (ratio >= 0.34 && Math.abs(lc.cy - rc.cy) <= 0.18) {
        return { leftLens: lc, rightLens: rc };
      }
    }
  }

  return {
    leftLens: leftCandidates[0] || null,
    rightLens: rightCandidates[0] || null,
  };
}

/**
 * Trims ONLY clearly protruding lateral temple arms well beyond the hinges when requested on front try-on view,
 * leaving frame endpieces, hinges, and detailing 100% intact.
 */
function cropTemplesBeyondHinges(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  leftLens: LensPocket | null,
  rightLens: LensPocket | null
) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 32) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return;

  const colSpan = new Float32Array(w);
  for (let x = minX; x <= maxX; x++) {
    let top = h;
    let bot = -1;
    for (let y = minY; y <= maxY; y++) {
      if (d[(y * w + x) * 4 + 3] > 32) {
        if (y < top) top = y;
        if (y > bot) bot = y;
      }
    }
    colSpan[x] = bot >= top ? bot - top + 1 : 0;
  }

  const smoothSpan = new Float32Array(w);
  for (let x = minX; x <= maxX; x++) {
    let s = 0;
    let c = 0;
    for (let k = -2; k <= 2; k++) {
      const nx = x + k;
      if (nx >= minX && nx <= maxX) {
        s += colSpan[nx];
        c++;
      }
    }
    smoothSpan[x] = c ? s / c : 0;
  }

  if (!leftLens || !rightLens) return;

  const lensSpan = rightLens.maxX - leftLens.minX;
  // Generous allowance preserves outer hinges & endpiece lugs while clipping extended side temples
  const endpieceAllowance = Math.max(10, Math.round(lensSpan * 0.085));
  const lTargetHeight = Math.max(10, (leftLens.maxY - leftLens.minY) * 0.34);
  const rTargetHeight = Math.max(10, (rightLens.maxY - rightLens.minY) * 0.34);

  let hingeLeftX = minX;
  for (let x = leftLens.minX; x >= minX; x--) {
    if (smoothSpan[x] < lTargetHeight && leftLens.minX - x > endpieceAllowance * 0.65) {
      hingeLeftX = Math.max(minX, x);
      break;
    }
    if (leftLens.minX - x > endpieceAllowance * 1.7) {
      hingeLeftX = leftLens.minX - endpieceAllowance;
      break;
    }
  }

  let hingeRightX = maxX;
  for (let x = rightLens.maxX; x <= maxX; x++) {
    if (smoothSpan[x] < rTargetHeight && x - rightLens.maxX > endpieceAllowance * 0.65) {
      hingeRightX = Math.min(maxX, x);
      break;
    }
    if (x - rightLens.maxX > endpieceAllowance * 1.7) {
      hingeRightX = rightLens.maxX + endpieceAllowance;
      break;
    }
  }

  hingeLeftX = Math.min(hingeLeftX, leftLens.minX - 4);
  hingeRightX = Math.max(hingeRightX, rightLens.maxX + 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x < hingeLeftX || x > hingeRightX) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
      } else if (x === hingeLeftX || x === hingeRightX) {
        d[i + 3] = Math.round(d[i + 3] * 0.55);
      }
    }
  }
}

/**
 * Separates lens transparency from frame processing (Phase 5):
 * - Clear lenses: 85%-90% transparent (alpha 26..36/255 = 10%..14% opacity) + ultra-subtle optical reflection.
 * - Colored/tinted sunglasses: preserve the real original RGB color of the lens with realistic ~50% translucency.
 * - Frame pixels stay 100% untouched in hue and crisp opacity.
 */
export function applyRealisticLensesToPixels(
  d: Uint8ClampedArray,
  rawD: Uint8ClampedArray,
  w: number,
  h: number,
  leftLens: LensPocket | null,
  rightLens: LensPocket | null,
  outerBg: { r: number; g: number; b: number },
  options: { isSunglasses?: boolean } = {}
): { maskPixels: Uint8ClampedArray; sampledLensColor: string } {
  const total = w * h;
  const lensFlag = new Uint8Array(total);
  const maskPixels = new Uint8ClampedArray(total * 4);

  for (const lens of [leftLens, rightLens]) {
    if (!lens) continue;
    for (let k = 0; k < lens.pixels.length; k++) {
      const p = lens.pixels[k];
      if (p < 0 || p >= total) continue;
      lensFlag[p] = 1;
    }
  }

  // Dilate 1px only into pale/background-blended seam pixels to avoid halo rim inside the lens
  const expandedLens = new Uint8Array(lensFlag);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (lensFlag[p]) continue;
      if (lensFlag[p - 1] || lensFlag[p + 1] || lensFlag[p - w] || lensFlag[p + w]) {
        const i = p * 4;
        const a = d[i + 3];
        const bgDiff = Math.hypot(rawD[i] - outerBg.r, rawD[i + 1] - outerBg.g, rawD[i + 2] - outerBg.b);
        if (a < 135 || bgDiff < 38) {
          expandedLens[p] = 1;
        }
      }
    }
  }

  // Determine whether lenses inside detected pockets are tinted sunglasses or clear optical lenses
  let tintedSamples = 0;
  let totalLensSamples = 0;
  let avgLr = 0;
  let avgLg = 0;
  let avgLb = 0;
  for (let p = 0; p < total; p++) {
    if (!expandedLens[p]) continue;
    const i = p * 4;
    const r = rawD[i];
    const g = rawD[i + 1];
    const b = rawD[i + 2];
    const bgDiff = Math.hypot(r - outerBg.r, g - outerBg.g, b - outerBg.b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    totalLensSamples++;
    if (bgDiff > 44 && lum < 175) {
      tintedSamples++;
      avgLr += r;
      avgLg += g;
      avgLb += b;
    }
  }

  const isTinted = options.isSunglasses || (totalLensSamples > 20 && tintedSamples / totalLensSamples > 0.35);
  let sampledLensColor = '#cfe8ff';
  if (isTinted && tintedSamples > 0) {
    const lr = Math.round(avgLr / tintedSamples);
    const lg = Math.round(avgLg / tintedSamples);
    const lb = Math.round(avgLb / tintedSamples);
    sampledLensColor = `#${[lr, lg, lb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } else if (isTinted) {
    sampledLensColor = '#475569';
  }

  for (let p = 0; p < total; p++) {
    if (!expandedLens[p]) continue;
    const i = p * 4;
    const x = p % w;
    const y = (p - x) / w;

    // Subtle diagonal glass highlight curve (1-3 alpha units subtle optical depth)
    const sheenFactor = Math.max(0, 1 - Math.abs((x / Math.max(1, w)) * 1.15 - (y / Math.max(1, h)) * 0.85 - 0.15) * 4);

    if (isTinted) {
      // Preserve real sunglass hue at natural ~50%-58% opacity (42%-50% transparency) so eyes stay subtly visible
      const tr = tintedSamples > 0 ? rawD[i] : 64;
      const tg = tintedSamples > 0 ? rawD[i + 1] : 78;
      const tb = tintedSamples > 0 ? rawD[i + 2] : 96;
      d[i] = Math.min(255, Math.round(tr + sheenFactor * 24));
      d[i + 1] = Math.min(255, Math.round(tg + sheenFactor * 26));
      d[i + 2] = Math.min(255, Math.round(tb + sheenFactor * 28));
      d[i + 3] = Math.round(122 + sheenFactor * 20);
    } else {
      // Clear optical lens: ~85% transparent (alpha 34..42 out of 255 = ~15% opacity) so eyes show crisply
      d[i] = Math.round(218 + sheenFactor * 30);
      d[i + 1] = Math.round(234 + sheenFactor * 18);
      d[i + 2] = Math.round(248 + sheenFactor * 7);
      d[i + 3] = Math.round(34 + sheenFactor * 8); // 38/255 = ~15% opacity => 85% transparent
    }

    maskPixels[i] = 255;
    maskPixels[i + 1] = 255;
    maskPixels[i + 2] = 255;
    maskPixels[i + 3] = 255;
  }

  return { maskPixels, sampledLensColor };
}

/**
 * Pure pixel-level refinement pipeline combining rim recovery, speck cleanup, halo-free edge smoothing,
 * symmetric lens detection, optional gentle temple trim, and realistic lens transparency.
 */
export function refineGlassesCutoutPixels(
  fgD: Uint8ClampedArray,
  rawD: Uint8ClampedArray,
  w: number,
  h: number,
  opts: {
    preset?: ExtractionPreset;
    isFrontView?: boolean;
    trimTemples?: boolean;
    isSunglasses?: boolean;
  } = {}
): { maskPixels: Uint8ClampedArray; sampledLensColor: string } {
  const preset = opts.preset || 'auto';
  const outerBg = sampleOuterBorderColorPixels(rawD, w, h);

  // 1) Recover thin wire / crystal transparent rims before speck pruning
  recoverFineAndTransparentRims(fgD, rawD, w, h, outerBg, preset);

  // 2) Remove isolated speckles while preserving thin rim segments
  removeSmallSpecks(fgD, w, h, 22, preset);

  // 3) Stroke-width-aware halo removal & gentle edge smoothing (0 erosion on thin wire)
  smoothEdgesAndDefringe(fgD, w, h, outerBg, preset);

  // 4) Detect symmetric lens pockets
  const isSun = Boolean(opts.isSunglasses || preset === 'sunglasses');
  const { leftLens, rightLens } = detectTwoSymmetricLenses(fgD, rawD, w, h, outerBg, isSun);

  // 5) Trim protruding temples beyond hinges ONLY when explicitly requested on front try-on view
  if (opts.isFrontView && opts.trimTemples) {
    cropTemplesBeyondHinges(fgD, w, h, leftLens, rightLens);
  }

  // 6) Final tiny speck sweep
  removeSmallSpecks(fgD, w, h, 20, preset);

  // 7) Realistic clear (85%-90% transparent) or original-tinted sunglasses lenses
  return applyRealisticLensesToPixels(fgD, rawD, w, h, leftLens, rightLens, outerBg, {
    isSunglasses: isSun,
  });
}

/**
 * Tightly crops and centers the transparent cutout and its lens mask while preserving exact aspect ratio.
 */
function cropAndCenterPair(
  cutoutCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement
): { cutout: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const w = cutoutCanvas.width;
  const h = cutoutCanvas.height;
  const d = cutoutCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    return { cutout: cutoutCanvas, mask: maskCanvas };
  }

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const padX = Math.max(8, Math.round(boxW * 0.03));
  const padY = Math.max(8, Math.round(boxH * 0.05));
  const outW = boxW + padX * 2;
  const outH = boxH + padY * 2;

  const cutout = document.createElement('canvas');
  cutout.width = outW;
  cutout.height = outH;
  cutout.getContext('2d', { willReadFrequently: true })!.drawImage(cutoutCanvas, minX, minY, boxW, boxH, padX, padY, boxW, boxH);

  const mask = document.createElement('canvas');
  mask.width = outW;
  mask.height = outH;
  mask.getContext('2d', { willReadFrequently: true })!.drawImage(maskCanvas, minX, minY, boxW, boxH, padX, padY, boxW, boxH);

  return { cutout, mask };
}

export function sampleDominantFrameColor(cutoutCanvas: HTMLCanvasElement): string {
  const w = cutoutCanvas.width;
  const h = cutoutCanvas.height;
  const d = cutoutCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();

  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      // Ignore transparent and semi-transparent lens pixels
      if (d[i + 3] < 175) continue;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (r > 240 && g > 240 && b > 240) continue;

      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      const existing = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
      existing.r += r;
      existing.g += g;
      existing.b += b;
      existing.count += 1;
      buckets.set(key, existing);
    }
  }

  let best: { r: number; g: number; b: number; count: number } | null = null;
  for (const b of buckets.values()) {
    if (!best || b.count > best.count) best = b;
  }

  if (!best || best.count === 0) return '#C9A24B';
  const rHex = Math.round(best.r / best.count).toString(16).padStart(2, '0');
  const gHex = Math.round(best.g / best.count).toString(16).padStart(2, '0');
  const bHex = Math.round(best.b / best.count).toString(16).padStart(2, '0');
  return `#${rHex}${gHex}${bHex}`;
}

async function exportOptimizedImage(
  canvas: HTMLCanvasElement,
  quality = 0.9
): Promise<{ blob: Blob; dataUrl: string; ext: 'webp' | 'png' }> {
  try {
    const webpBlob = await canvasToBlob(canvas, 'image/webp', quality);
    if (webpBlob.type === 'image/webp' && webpBlob.size > 0) {
      return {
        blob: webpBlob,
        dataUrl: canvas.toDataURL('image/webp', quality),
        ext: 'webp',
      };
    }
  } catch {
    // Fallback to PNG below
  }
  const pngBlob = await canvasToBlob(canvas, 'image/png', 1);
  return {
    blob: pngBlob,
    dataUrl: canvas.toDataURL('image/png'),
    ext: 'png',
  };
}

/**
 * Re-applies a manually painted/erased lens mask onto an existing cutout image so
 * merchants can refine the transparent lens opening with a brush/eraser.
 */
export async function applyManualMaskEdit(
  cutoutDataUrl: string,
  editedMaskCanvas: HTMLCanvasElement,
  originalDataUrl?: string
): Promise<EditedGlassesAsset> {
  const cutCanvas = await loadImageToCanvas(cutoutDataUrl, 960);
  const w = cutCanvas.width;
  const h = cutCanvas.height;

  const alignedMask = document.createElement('canvas');
  alignedMask.width = w;
  alignedMask.height = h;
  alignedMask.getContext('2d', { willReadFrequently: true })!.drawImage(editedMaskCanvas, 0, 0, w, h);

  const cutCtx = cutCanvas.getContext('2d', { willReadFrequently: true })!;
  const cutImg = cutCtx.getImageData(0, 0, w, h);
  const d = cutImg.data;
  const md = alignedMask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  const cleanMask = document.createElement('canvas');
  cleanMask.width = w;
  cleanMask.height = h;
  const cmCtx = cleanMask.getContext('2d', { willReadFrequently: true })!;
  const cmImg = cmCtx.createImageData(w, h);
  const cmd = cmImg.data;

  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (md[i + 3] > 90) {
      d[i] = 220;
      d[i + 1] = 236;
      d[i + 2] = 250;
      d[i + 3] = 30; // ~88% transparent

      cmd[i] = 255;
      cmd[i + 1] = 255;
      cmd[i + 2] = 255;
      cmd[i + 3] = 255;
    }
  }

  cutCtx.putImageData(cutImg, 0, 0);
  cmCtx.putImageData(cmImg, 0, 0);

  const origCanvas = originalDataUrl ? await loadImageToCanvas(originalDataUrl, 960) : cutCanvas;
  const origOut = await exportOptimizedImage(origCanvas, 0.92);
  const sampledFrameColor = sampleDominantFrameColor(cutCanvas);
  const [cutOut, maskOut] = await Promise.all([
    exportOptimizedImage(cutCanvas, 0.9),
    exportOptimizedImage(cleanMask, 0.92),
  ]);

  return {
    imageDataUrl: cutOut.dataUrl,
    imageBlob: cutOut.blob,
    originalDataUrl: originalDataUrl || origOut.dataUrl,
    originalBlob: origOut.blob,
    maskDataUrl: maskOut.dataUrl,
    maskBlob: maskOut.blob,
    mimeExt: cutOut.ext,
    width: w,
    height: h,
    sampledFrameColor,
    sampledLensColor: '#cfe8ff',
    presetUsed: 'auto',
  };
}

/**
 * 100% Client-Side Glasses Background Removal & Cleanup Pipeline:
 * 1. Preserves the untouched original photo (`originalDataUrl`, `originalBlob`).
 * 2. Runs U²-Net (Apache-2.0) locally via onnxruntime-web WebGPU/WASM in a Web Worker (with deterministic Canvas fallback).
 * 3. Preserves thin metal & crystal/transparent rims without eroding 1-2px wires.
 * 4. Removes halos accurately against the sampled background color.
 * 5. Keeps clear lenses 85%-90% transparent and colored sunglasses true to their original hue.
 */
export async function extractGlassesFromPhoto(
  source: File | Blob | HTMLVideoElement | HTMLImageElement | string,
  optionsOrProgress?: ((label: string) => void) | ExtractGlassesOptions
): Promise<EditedGlassesAsset> {
  const opts: ExtractGlassesOptions =
    typeof optionsOrProgress === 'function' ? { onProgress: optionsOrProgress } : optionsOrProgress || {};
  const onProgress = opts.onProgress;
  const angleYaw = opts.angleYaw ?? 0;
  const preset: ExtractionPreset = opts.preset || 'auto';
  const isFrontView = Math.abs(angleYaw) <= 20;
  const isSunglasses = opts.category === 'sun' || preset === 'sunglasses';

  onProgress?.('جاري تجهيز الصورة الأصلية...');
  const rawCanvas = await loadImageToCanvas(source, 840);
  const origOut = await exportOptimizedImage(rawCanvas, 0.92);
  const inputBlob = await canvasToBlob(rawCanvas, 'image/png', 1);

  let fgCanvas: HTMLCanvasElement;
  let usedFallbackExtractor = false;

  onProgress?.('جاري عزل النظارة محلياً بالذكاء الاصطناعي...');
  try {
    const pipelineRes = await processGlassesImageInWorker(inputBlob, {
      category: isSunglasses ? 'sun' : 'med',
      angleType: isFrontView ? 'front' : 'angled45',
      onStage: onProgress,
    });
    fgCanvas = await loadImageToCanvas(pipelineRes.cutoutImage.blob, 1024);
    usedFallbackExtractor = pipelineRes.backendUsed === 'fallback';
  } catch {
    // Graceful deterministic fallback
    usedFallbackExtractor = true;
    onProgress?.('جاري العزل باستخدام المحرك البديل عالي الدقة...');
    fgCanvas = document.createElement('canvas');
    fgCanvas.width = rawCanvas.width;
    fgCanvas.height = rawCanvas.height;
    const rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true })!;
    const rawImg = rawCtx.getImageData(0, 0, rawCanvas.width, rawCanvas.height);
    const outerBg = sampleOuterBorderColorPixels(rawImg.data, rawCanvas.width, rawCanvas.height);
    const extracted = extractFallbackForegroundFromPixels(
      rawImg.data,
      rawCanvas.width,
      rawCanvas.height,
      outerBg,
      preset
    );
    const fCtx = fgCanvas.getContext('2d', { willReadFrequently: true })!;
    const fImg = fCtx.createImageData(rawCanvas.width, rawCanvas.height);
    fImg.data.set(extracted);
    fCtx.putImageData(fImg, 0, 0);
  }

  onProgress?.('جاري الحفاظ على الحواف الرفيعة وشفافية العدسات...');
  const w = fgCanvas.width;
  const h = fgCanvas.height;
  const alignedRaw = document.createElement('canvas');
  alignedRaw.width = w;
  alignedRaw.height = h;
  alignedRaw.getContext('2d', { willReadFrequently: true })!.drawImage(rawCanvas, 0, 0, w, h);
  const rawD = alignedRaw.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  const fgCtx = fgCanvas.getContext('2d', { willReadFrequently: true })!;
  const fgImg = fgCtx.getImageData(0, 0, w, h);

  const { maskPixels, sampledLensColor } = refineGlassesCutoutPixels(fgImg.data, rawD, w, h, {
    preset,
    isFrontView,
    trimTemples: opts.trimTemples ?? false,
    isSunglasses,
  });

  fgCtx.putImageData(fgImg, 0, 0);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  const mImg = mCtx.createImageData(w, h);
  mImg.data.set(maskPixels);
  mCtx.putImageData(mImg, 0, 0);

  const { cutout, mask } = cropAndCenterPair(fgCanvas, maskCanvas);
  const sampledFrameColor = sampleDominantFrameColor(cutout);

  const [cutOut, maskOut] = await Promise.all([
    exportOptimizedImage(cutout, 0.9),
    exportOptimizedImage(mask, 0.92),
  ]);

  return {
    imageDataUrl: cutOut.dataUrl,
    imageBlob: cutOut.blob,
    originalDataUrl: origOut.dataUrl,
    originalBlob: origOut.blob,
    maskDataUrl: maskOut.dataUrl,
    maskBlob: maskOut.blob,
    mimeExt: cutOut.ext,
    width: cutout.width,
    height: cutout.height,
    sampledFrameColor,
    sampledLensColor,
    presetUsed: preset,
    usedFallbackExtractor,
  };
}
