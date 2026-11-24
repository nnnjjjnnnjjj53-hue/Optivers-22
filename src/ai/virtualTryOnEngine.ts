import { ProductImage } from '../types';
import {
  FRAME_SIZE_SCALE,
  FaceTrackingFrame,
  FaceTrackingSmoother,
  OneEuroFilter,
  PlacementGeometry,
  computeCalibratedPlacement,
  detectFaceOnImage,
  extractTrackingFromLandmarks,
  getFaceLandmarker,
  getImageFaceLandmarker,
} from '../utils/faceTracker';

export {
  FRAME_SIZE_SCALE,
  FaceTrackingSmoother,
  OneEuroFilter,
  computeCalibratedPlacement,
  detectFaceOnImage,
  extractTrackingFromLandmarks,
  getFaceLandmarker,
  getImageFaceLandmarker,
};
export type { FaceTrackingFrame, PlacementGeometry };

export interface FaceLightingEstimate {
  brightness: number; // 0..1
  warmth: number; // -1..+1 (positive = warm indoor, negative = cool daylight)
  directionalBiasX: number; // -1..+1 (positive = brighter on right cheek)
  shadowAlpha: number; // 0.16..0.38
  ambientCssFilter: string;
}

const DEFAULT_LIGHTING: FaceLightingEstimate = {
  brightness: 0.56,
  warmth: 0.05,
  directionalBiasX: 0,
  shadowAlpha: 0.28,
  ambientCssFilter: 'brightness(1) contrast(1)',
};

let probeCanvas: HTMLCanvasElement | null = null;

/**
 * Pure pixel-level ambient lighting estimator over face pixels.
 * Samples left & right facial illumination so cast shadows and subtle lens sheen
 * blend with the real photo/video lighting WITHOUT changing glasses hue or design.
 */
export function estimateLightingFromRgba(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  faceCenterNorm = { x: 0.5, y: 0.48 },
  faceSpanNorm = 0.28
): FaceLightingEstimate {
  if (w < 8 || h < 8 || rgba.length < w * h * 4) return DEFAULT_LIGHTING;

  const minX = Math.max(0, Math.floor((faceCenterNorm.x - faceSpanNorm * 0.65) * w));
  const maxX = Math.min(w - 1, Math.ceil((faceCenterNorm.x + faceSpanNorm * 0.65) * w));
  const minY = Math.max(0, Math.floor((faceCenterNorm.y - faceSpanNorm * 0.55) * h));
  const maxY = Math.min(h - 1, Math.ceil((faceCenterNorm.y + faceSpanNorm * 0.55) * h));
  const midX = (minX + maxX) / 2;

  let totalLum = 0;
  let totalWarm = 0;
  let count = 0;
  let leftLum = 0;
  let leftCount = 0;
  let rightLum = 0;
  let rightCount = 0;

  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] < 120) continue;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      totalLum += lum;
      totalWarm += (r - b) / 255;
      count++;
      if (x < midX) {
        leftLum += lum;
        leftCount++;
      } else {
        rightLum += lum;
        rightCount++;
      }
    }
  }

  if (count < 12) return DEFAULT_LIGHTING;

  const brightness = Math.max(0.18, Math.min(0.9, totalLum / count));
  const warmth = Math.max(-0.5, Math.min(0.5, totalWarm / count));
  const lAvg = leftCount ? leftLum / leftCount : brightness;
  const rAvg = rightCount ? rightLum / rightCount : brightness;
  const directionalBiasX = Math.max(-1, Math.min(1, (rAvg - lAvg) * 4.5));

  // Very subtle bounded brightness adjustment (0.93..1.07) keeps glasses 100% authentic in color
  const brightFactor = Number(Math.max(0.93, Math.min(1.07, 0.94 + (brightness - 0.5) * 0.22)).toFixed(3));
  const contrastFactor = Number(Math.max(0.98, Math.min(1.06, 1 + Math.abs(directionalBiasX) * 0.04)).toFixed(3));
  const shadowAlpha = Number(Math.max(0.18, Math.min(0.38, 0.22 + brightness * 0.16)).toFixed(2));

  return {
    brightness,
    warmth,
    directionalBiasX,
    shadowAlpha,
    ambientCssFilter: `brightness(${brightFactor}) contrast(${contrastFactor})`,
  };
}

/**
 * Safely analyzes face ambient lighting from an HTMLImageElement or HTMLVideoElement.
 */
export function analyzeFaceLighting(
  source: HTMLImageElement | HTMLVideoElement | null,
  faceCenterNorm?: { x: number; y: number },
  faceSpanNorm?: number
): FaceLightingEstimate {
  if (!source || typeof document === 'undefined') return DEFAULT_LIGHTING;
  try {
    if (!probeCanvas) {
      probeCanvas = document.createElement('canvas');
      probeCanvas.width = 96;
      probeCanvas.height = 96;
    }
    const ctx = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return DEFAULT_LIGHTING;
    ctx.drawImage(source, 0, 0, 96, 96);
    const data = ctx.getImageData(0, 0, 96, 96).data;
    return estimateLightingFromRgba(data, 96, 96, faceCenterNorm, faceSpanNorm);
  } catch {
    return DEFAULT_LIGHTING;
  }
}

/**
 * Selects the best angle layers from a merchant's 2-photo product set (Front + Angled/Side)
 * so turning the face naturally transitions between the front view and the authentic 2nd angle.
 */
export function selectGlassesAngleLayers(
  images: ProductImage[] | undefined,
  yawDeg: number
): { img: ProductImage; weight: number }[] {
  if (!images || images.length === 0) return [];
  const front = images.find((im) => im.kind !== 'gallery' && Math.abs(im.angleYaw) <= 20) || images[0];
  const angled = images
    .filter((im) => im.id !== front.id && Math.abs(im.angleYaw) > 20 && Math.abs(im.angleYaw) <= 75)
    .sort((a, b) => Math.abs(a.angleYaw) - Math.abs(b.angleYaw))[0];

  if (!angled) return [{ img: front, weight: 1 }];

  // Cross-fade gently only when user turns toward the captured 3/4 angle so transitions feel photographic
  const absYaw = Math.abs(yawDeg);
  const targetYaw = Math.abs(angled.angleYaw);
  if (absYaw < 14 || targetYaw >= 68) {
    return [{ img: front, weight: 1 }];
  }

  const blend = Math.min(0.85, Math.max(0, (absYaw - 14) / Math.max(12, targetYaw - 14)));
  if (blend <= 0.05) return [{ img: front, weight: 1 }];
  return [
    { img: front, weight: 1 - blend },
    { img: angled, weight: blend },
  ];
}
