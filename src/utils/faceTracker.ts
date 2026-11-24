import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FaceShape, FrameSize } from '../types';

export interface FaceTrackingFrame {
  detected: boolean;
  leftEye: { x: number; y: number }; // normalized 0..1
  rightEye: { x: number; y: number };
  noseBridge: { x: number; y: number }; // landmark 168
  sellion: { x: number; y: number }; // landmark 6
  noseTip: { x: number; y: number }; // landmark 1
  yaw: number; // degrees (-55..+55)
  pitch: number; // degrees (-30..+30)
  roll: number; // radians
  eyeDistance: number; // normalized 0..1
  cheekWidth: number; // normalized distance 234..454
  pdMm: number;
  faceShape: FaceShape;
  templeLeft: { x: number; y: number };
  templeRight: { x: number; y: number };
  earLeft: { x: number; y: number }; // landmark 234
  earRight: { x: number; y: number }; // landmark 454
  contourPoints: { x: number; y: number }[];
}

export interface PlacementGeometry {
  cx: number;
  cy: number;
  glassesWidth: number;
  glassesHeight: number;
  rollDeg: number;
  screenYawDeg: number;
  pitchDeg: number;
  leftEar?: { x: number; y: number };
  rightEar?: { x: number; y: number };
  occluderPolygon?: string;
  contourScreenPoints?: { x: number; y: number }[];
  eyeDistPx: number;
}

export const FRAME_SIZE_SCALE: Record<FrameSize, number> = {
  Small: 0.92,
  Medium: 1.0,
  Large: 1.08,
};

/**
 * Adaptive One-Euro Filter (Casiez et al.) eliminates stationary micro-jitter
 * while preserving fast head rotation responsiveness with virtually zero lag.
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.6, beta = 0.045, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const r = 2 * Math.PI * cutoff * dt;
    return r / (r + 1);
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(value: number, timestampSec: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = value;
      this.tPrev = timestampSec;
      return value;
    }
    const dt = Math.max(1 / 120, Math.min(0.25, timestampSec - this.tPrev));
    this.tPrev = timestampSec;

    const dx = (value - this.xPrev) / dt;
    const ad = this.alpha(this.dCutoff, dt);
    const dxHat = ad * dx + (1 - ad) * this.dxPrev;
    this.dxPrev = dxHat;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * value + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }
}

export class FaceTrackingSmoother {
  private filters = new Map<string, OneEuroFilter>();
  private lastShape: FaceShape | null = null;
  private shapeStreak = 0;

  private f(key: string, val: number, tSec: number, minCutoff = 1.9, beta = 0.06): number {
    let inst = this.filters.get(key);
    if (!inst) {
      inst = new OneEuroFilter(minCutoff, beta, 1.2);
      this.filters.set(key, inst);
    }
    return inst.filter(val, tSec);
  }

  reset() {
    this.filters.clear();
    this.lastShape = null;
    this.shapeStreak = 0;
  }

  smooth(raw: FaceTrackingFrame, timestampMs: number): FaceTrackingFrame {
    const tSec = timestampMs / 1000;

    // Stabilize face shape classification across consecutive frames to prevent flicker
    let stableShape = raw.faceShape;
    if (!this.lastShape) {
      this.lastShape = raw.faceShape;
      this.shapeStreak = 1;
    } else if (raw.faceShape === this.lastShape) {
      this.shapeStreak = Math.min(10, this.shapeStreak + 1);
    } else {
      this.shapeStreak -= 1;
      if (this.shapeStreak <= 0) {
        this.lastShape = raw.faceShape;
        this.shapeStreak = 2;
      } else {
        stableShape = this.lastShape;
      }
    }

    return {
      ...raw,
      leftEye: {
        x: this.f('leX', raw.leftEye.x, tSec, 2.2, 0.08),
        y: this.f('leY', raw.leftEye.y, tSec, 2.2, 0.08),
      },
      rightEye: {
        x: this.f('reX', raw.rightEye.x, tSec, 2.2, 0.08),
        y: this.f('reY', raw.rightEye.y, tSec, 2.2, 0.08),
      },
      noseBridge: {
        x: this.f('nbX', raw.noseBridge.x, tSec, 2.2, 0.08),
        y: this.f('nbY', raw.noseBridge.y, tSec, 2.2, 0.08),
      },
      sellion: {
        x: this.f('seX', raw.sellion.x, tSec, 2.2, 0.08),
        y: this.f('seY', raw.sellion.y, tSec, 2.2, 0.08),
      },
      noseTip: {
        x: this.f('ntX', raw.noseTip.x, tSec, 2.0, 0.07),
        y: this.f('ntY', raw.noseTip.y, tSec, 2.0, 0.07),
      },
      earLeft: {
        x: this.f('elX', raw.earLeft.x, tSec, 1.8, 0.05),
        y: this.f('elY', raw.earLeft.y, tSec, 1.8, 0.05),
      },
      earRight: {
        x: this.f('erX', raw.earRight.x, tSec, 1.8, 0.05),
        y: this.f('erY', raw.earRight.y, tSec, 1.8, 0.05),
      },
      yaw: this.f('yaw', raw.yaw, tSec, 1.7, 0.03),
      pitch: this.f('pitch', raw.pitch, tSec, 1.7, 0.03),
      roll: this.f('roll', raw.roll, tSec, 2.0, 0.05),
      eyeDistance: this.f('ed', raw.eyeDistance, tSec, 1.6, 0.04),
      cheekWidth: this.f('cw', raw.cheekWidth, tSec, 1.5, 0.04),
      pdMm: Math.round(this.f('pd', raw.pdMm, tSec, 0.9, 0.01)),
      faceShape: stableShape,
    };
  }
}

const MEDIAPIPE_WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MEDIAPIPE_MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface LandmarkerRuntimeInfo {
  delegate: 'GPU' | 'CPU';
  wasmSource: string;
  modelSource: string;
  ready: boolean;
}

let landmarkerPromise: Promise<FaceLandmarker> | null = null;
let imageLandmarkerPromise: Promise<FaceLandmarker> | null = null;
let logFilterInstalled = false;
let runtimeInfo: LandmarkerRuntimeInfo = {
  delegate: 'GPU',
  wasmSource: MEDIAPIPE_WASM_CDN,
  modelSource: MEDIAPIPE_MODEL_CDN,
  ready: false,
};

export function getLandmarkerRuntimeInfo(): LandmarkerRuntimeInfo {
  return { ...runtimeInfo };
}

/**
 * MediaPipe's WASM runtime routes C++ stderr (including TFLite INFO logs) to console.error.
 * Reclassify those benign INFO messages to console.info so they are not surfaced as runtime errors.
 */
function installMediaPipeLogFilter() {
  if (logFilterInstalled || typeof console === 'undefined') return;
  logFilterInstalled = true;
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const joined = args
      .filter((a): a is string => typeof a === 'string')
      .join(' ')
      .trim();
    if (
      joined.includes('Created TensorFlow Lite XNNPACK delegate') ||
      (joined.startsWith('INFO:') && joined.includes('TensorFlow Lite')) ||
      joined.startsWith('WARNING: Logging before InitGoogleLogging')
    ) {
      console.info(...args);
      return;
    }
    originalError(...args);
  };
}

async function createFaceLandmarker(runningMode: 'VIDEO' | 'IMAGE'): Promise<FaceLandmarker> {
  installMediaPipeLogFilter();
  let wasmSource = MEDIAPIPE_WASM_CDN;
  let modelSource = MEDIAPIPE_MODEL_CDN;
  let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

  try {
    vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_CDN);
  } catch (err) {
    console.warn('[TryOn] CDN WASM failed, falling back to /models/mediapipe:', err);
    wasmSource = '/models/mediapipe';
    modelSource = '/models/mediapipe/face_landmarker.task';
    vision = await FilesetResolver.forVisionTasks(wasmSource);
  }

  const commonOptions = {
    runningMode,
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.45,
    minFacePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
  };

  const tryCreate = async (modelPath: string) => {
    try {
      const lm = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU',
        },
        ...commonOptions,
      });
      runtimeInfo = { delegate: 'GPU', wasmSource, modelSource: modelPath, ready: true };
      console.info(`[TryOn] FaceLandmarker ready (mode=${runningMode}, delegate=GPU, model=${modelPath})`);
      return lm;
    } catch (gpuErr) {
      console.warn('[TryOn] GPU delegate failed, falling back to CPU:', gpuErr);
      const lm = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'CPU',
        },
        ...commonOptions,
      });
      runtimeInfo = { delegate: 'CPU', wasmSource, modelSource: modelPath, ready: true };
      console.info(`[TryOn] FaceLandmarker ready (mode=${runningMode}, delegate=CPU, model=${modelPath})`);
      return lm;
    }
  };

  try {
    return await tryCreate(modelSource);
  } catch (modelErr) {
    if (modelSource !== '/models/mediapipe/face_landmarker.task') {
      console.warn('[TryOn] CDN model load failed, falling back to local model:', modelErr);
      return await tryCreate('/models/mediapipe/face_landmarker.task');
    }
    throw modelErr;
  }
}

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = createFaceLandmarker('VIDEO').catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

export async function getImageFaceLandmarker(): Promise<FaceLandmarker> {
  if (!imageLandmarkerPromise) {
    imageLandmarkerPromise = createFaceLandmarker('IMAGE').catch((err) => {
      imageLandmarkerPromise = null;
      throw err;
    });
  }
  return imageLandmarkerPromise;
}

export async function detectFaceOnImage(
  source: HTMLImageElement | HTMLCanvasElement
): Promise<FaceTrackingFrame | null> {
  const landmarker = await getImageFaceLandmarker();
  const res = landmarker.detect(source);
  if (!res.faceLandmarks || res.faceLandmarks.length === 0) {
    return null;
  }
  const mat = res.facialTransformationMatrixes?.[0]?.data;
  return extractTrackingFromLandmarks(
    res.faceLandmarks[0],
    mat ? Array.from(mat) : undefined
  );
}

const dist2d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

// Face contour indices for temple/ear occlusion mask
const CONTOUR_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

export function extractTrackingFromLandmarks(
  landmarks: { x: number; y: number; z: number }[],
  matrixData?: number[]
): FaceTrackingFrame {
  // MediaPipe FaceMesh key landmarks (+ iris centers 468 & 473 when available)
  const leftEyeOuter = landmarks[33];
  const leftEyeInner = landmarks[133];
  const rightEyeInner = landmarks[362];
  const rightEyeOuter = landmarks[263];
  const leftIris = landmarks.length > 468 ? landmarks[468] : undefined;
  const rightIris = landmarks.length > 473 ? landmarks[473] : undefined;

  const noseBridge = landmarks[168] || landmarks[6];
  const sellion = landmarks[6] || noseBridge;
  const noseTip = landmarks[1];
  const chin = landmarks[152];
  const forehead = landmarks[10];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const leftJaw = landmarks[172];
  const rightJaw = landmarks[397];

  const leftSocketCenter = {
    x: (leftEyeOuter.x + leftEyeInner.x) / 2,
    y: (leftEyeOuter.y + leftEyeInner.y) / 2,
  };
  const rightSocketCenter = {
    x: (rightEyeOuter.x + rightEyeInner.x) / 2,
    y: (rightEyeOuter.y + rightEyeInner.y) / 2,
  };

  // Blend iris center with eye socket center for steady anchor even when blinking or looking sideways
  const leftEye = leftIris
    ? { x: leftIris.x * 0.55 + leftSocketCenter.x * 0.45, y: leftIris.y * 0.55 + leftSocketCenter.y * 0.45 }
    : leftSocketCenter;
  const rightEye = rightIris
    ? { x: rightIris.x * 0.55 + rightSocketCenter.x * 0.45, y: rightIris.y * 0.55 + rightSocketCenter.y * 0.45 }
    : rightSocketCenter;

  const eyeDistance = dist2d(leftEye, rightEye);
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

  // Compute yaw & pitch from transformation matrix if available, otherwise from landmark geometry
  let yaw = 0;
  let pitch = 0;
  if (matrixData && matrixData.length >= 16) {
    const r02 = matrixData[8];
    const r22 = matrixData[10];
    const r12 = matrixData[9];
    yaw = Math.atan2(r02, r22) * (180 / Math.PI);
    pitch = Math.asin(Math.max(-1, Math.min(1, -r12))) * (180 / Math.PI);
  } else {
    const midEyeX = (leftEye.x + rightEye.x) / 2;
    const asym = (noseTip.x - midEyeX) / Math.max(0.05, eyeDistance);
    yaw = Math.max(-50, Math.min(50, asym * 92));
    const midEyeY = (leftEye.y + rightEye.y) / 2;
    pitch = Math.max(-28, Math.min(28, ((noseTip.y - midEyeY) / Math.max(0.05, eyeDistance) - 0.55) * 52));
  }

  yaw = Math.max(-55, Math.min(55, yaw));
  pitch = Math.max(-30, Math.min(30, pitch));

  const faceHeight = dist2d(forehead, chin);
  const cheekWidth = dist2d(leftCheek, rightCheek);
  const jawWidth = dist2d(leftJaw, rightJaw);
  const whRatio = cheekWidth / Math.max(0.05, faceHeight);
  const jawRatio = jawWidth / Math.max(0.05, cheekWidth);

  let faceShape: FaceShape = 'oval';
  if (jawRatio > 0.84) faceShape = 'square';
  else if (whRatio > 0.83) faceShape = 'round';
  else faceShape = 'oval';

  // Estimate PD in mm calibrated against yaw-compensated eye-to-cheek proportion
  const cosYaw = Math.max(0.65, Math.cos((yaw * Math.PI) / 180));
  const ratio = (eyeDistance / cosYaw) / Math.max(0.08, cheekWidth);
  const pdMm = Math.round(Math.max(56, Math.min(72, 54 + ratio * 22)));

  return {
    detected: true,
    leftEye,
    rightEye,
    noseBridge: { x: noseBridge.x, y: noseBridge.y },
    sellion: { x: sellion.x, y: sellion.y },
    noseTip: { x: noseTip.x, y: noseTip.y },
    yaw,
    pitch,
    roll,
    eyeDistance,
    cheekWidth,
    pdMm,
    faceShape,
    templeLeft: { x: landmarks[127]?.x ?? leftCheek.x, y: landmarks[127]?.y ?? leftCheek.y },
    templeRight: { x: landmarks[356]?.x ?? rightCheek.x, y: landmarks[356]?.y ?? rightCheek.y },
    earLeft: { x: leftCheek.x, y: leftCheek.y },
    earRight: { x: rightCheek.x, y: rightCheek.y },
    contourPoints: CONTOUR_INDICES.filter((idx) => Boolean(landmarks[idx])).map((idx) => ({
      x: landmarks[idx].x,
      y: landmarks[idx].y,
    })),
  };
}

/**
 * Calibrates exact screen placement, auto-sizing (IPD + cheekbone width + FrameSize),
 * nose-bridge anchor, and perspective yaw/pitch/roll up to ±42° without frame distortion or drop-out.
 */
export function computeCalibratedPlacement(
  tracking: FaceTrackingFrame,
  mapFn: (nx: number, ny: number) => { x: number; y: number },
  frameAspectRatio = 0.41,
  frameSize: FrameSize = 'Medium'
): PlacementGeometry {
  const lPx = mapFn(tracking.leftEye.x, tracking.leftEye.y);
  const rPx = mapFn(tracking.rightEye.x, tracking.rightEye.y);
  const leftEyeScreen = rPx.x < lPx.x ? rPx : lPx;
  const rightEyeScreen = rPx.x < lPx.x ? lPx : rPx;

  const ear234 = mapFn(tracking.earLeft.x, tracking.earLeft.y);
  const ear454 = mapFn(tracking.earRight.x, tracking.earRight.y);
  const screenLeftEar = ear234.x < ear454.x ? ear234 : ear454;
  const screenRightEar = ear234.x < ear454.x ? ear454 : ear234;

  const bridgePx = mapFn(tracking.noseBridge.x, tracking.noseBridge.y);
  const sellionPx = mapFn(tracking.sellion.x, tracking.sellion.y);
  const noseTipPx = mapFn(tracking.noseTip.x, tracking.noseTip.y);

  const cheekSpanPx = Math.max(
    24,
    Math.hypot(screenRightEar.x - screenLeftEar.x, screenRightEar.y - screenLeftEar.y)
  );
  const eyeDistPx = Math.max(
    16,
    Math.hypot(rightEyeScreen.x - leftEyeScreen.x, rightEyeScreen.y - leftEyeScreen.y)
  );
  const rollDeg =
    Math.atan2(rightEyeScreen.y - leftEyeScreen.y, rightEyeScreen.x - leftEyeScreen.x) * (180 / Math.PI);

  const midCheekX = (screenLeftEar.x + screenRightEar.x) / 2;
  const headTurn = (noseTipPx.x - midCheekX) / Math.max(20, cheekSpanPx);
  const screenYawDeg = Math.max(-42, Math.min(42, headTurn * 112));

  // Blend true yaw-compensated IPD with anatomical cheek-span width so narrow/wide faces match realistically
  const cosYaw = Math.max(0.62, Math.cos((screenYawDeg * Math.PI) / 180));
  const trueEyeDistPx = eyeDistPx / cosYaw;
  const ipdDrivenW = trueEyeDistPx * 2.34;
  const cheekDrivenW = (cheekSpanPx / Math.max(0.72, cosYaw)) * 1.03;
  const sizeMult = FRAME_SIZE_SCALE[frameSize] ?? 1.0;

  const glassesWidth = (ipdDrivenW * 0.68 + cheekDrivenW * 0.32) * sizeMult;
  const clampedRatio = Math.max(0.28, Math.min(0.65, frameAspectRatio || 0.41));
  const glassesHeight = glassesWidth * clampedRatio;

  // Anchor smoothly on nose bridge/sellion shifted vertically in local head-up axis
  const midEyeX = (leftEyeScreen.x + rightEyeScreen.x) / 2;
  const midEyeY = (leftEyeScreen.y + rightEyeScreen.y) / 2;
  const cx = bridgePx.x * 0.65 + midEyeX * 0.35;
  const cy = bridgePx.y * 0.62 + sellionPx.y * 0.22 + midEyeY * 0.16 + trueEyeDistPx * 0.045;

  const earLiftY = trueEyeDistPx * 0.085;
  const leftEar = { x: screenLeftEar.x, y: screenLeftEar.y - earLiftY };
  const rightEar = { x: screenRightEar.x, y: screenRightEar.y - earLiftY };

  const contourScreenPoints =
    tracking.contourPoints.length > 10
      ? tracking.contourPoints.map((pt) => mapFn(pt.x, pt.y))
      : undefined;

  const occluderPolygon = contourScreenPoints
    ? contourScreenPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    : undefined;

  return {
    cx,
    cy,
    glassesWidth,
    glassesHeight,
    rollDeg,
    screenYawDeg,
    pitchDeg: Math.max(-24, Math.min(24, tracking.pitch)),
    leftEar,
    rightEar,
    occluderPolygon,
    contourScreenPoints,
    eyeDistPx: trueEyeDistPx,
  };
}

export interface Metric3DPlacement extends PlacementGeometry {
  pxPerMm: number;
  frameWidthMm: number;
  cheekSpanPx: number;
  bridgePx: { x: number; y: number };
  yawDeg: number;
}

export interface Smooth3DPose {
  cx: number;
  cy: number;
  pxPerMm: number;
  glassesWidth: number;
  cheekSpanPx: number;
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * Exponential Moving Average (EMA) stabilizer for 3D AR try-on pose vectors.
 * Eliminates high-frequency landmark jitter while maintaining snappy tracking during head turns.
 */
export class EMASmoother {
  private alphaPos: number;
  private alphaRot: number;
  private state: Smooth3DPose | null = null;

  constructor(alphaPos = 0.34, alphaRot = 0.28) {
    this.alphaPos = alphaPos;
    this.alphaRot = alphaRot;
  }

  reset() {
    this.state = null;
  }

  update(next: Smooth3DPose): Smooth3DPose {
    if (!this.state) {
      this.state = { ...next };
      return { ...this.state };
    }
    const prev = this.state;
    // Adaptive boost if head moves rapidly so frame doesn't lag behind
    const deltaPos = Math.hypot(next.cx - prev.cx, next.cy - prev.cy);
    const adaptivePos = deltaPos > 14 ? Math.min(0.68, this.alphaPos * 1.65) : this.alphaPos;
    const deltaRot = Math.max(Math.abs(next.yaw - prev.yaw), Math.abs(next.pitch - prev.pitch));
    const adaptiveRot = deltaRot > 8 ? Math.min(0.6, this.alphaRot * 1.65) : this.alphaRot;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const smoothed: Smooth3DPose = {
      cx: lerp(prev.cx, next.cx, adaptivePos),
      cy: lerp(prev.cy, next.cy, adaptivePos),
      pxPerMm: lerp(prev.pxPerMm, next.pxPerMm, adaptivePos * 0.85),
      glassesWidth: lerp(prev.glassesWidth, next.glassesWidth, adaptivePos * 0.85),
      cheekSpanPx: lerp(prev.cheekSpanPx, next.cheekSpanPx, adaptivePos * 0.85),
      yaw: lerp(prev.yaw, next.yaw, adaptiveRot),
      pitch: lerp(prev.pitch, next.pitch, adaptiveRot),
      roll: lerp(prev.roll, next.roll, adaptiveRot),
    };
    this.state = smoothed;
    return { ...smoothed };
  }
}

/**
 * Computes exact metric 3D AR placement using MediaPipe iris (468, 473) & temple/ear (234, 454)
 * landmarks combined with the merchant-configured frame width in millimeters (mm).
 */
export function computeMetric3DPlacement(
  tracking: FaceTrackingFrame,
  mapFn: (nx: number, ny: number) => { x: number; y: number },
  frameWidthMm = 136,
  frameSize: FrameSize = 'Medium',
  frameAspectRatio = 0.41
): Metric3DPlacement {
  const lPx = mapFn(tracking.leftEye.x, tracking.leftEye.y);
  const rPx = mapFn(tracking.rightEye.x, tracking.rightEye.y);
  const leftEyeScreen = rPx.x < lPx.x ? rPx : lPx;
  const rightEyeScreen = rPx.x < lPx.x ? lPx : rPx;

  const ear234 = mapFn(tracking.earLeft.x, tracking.earLeft.y);
  const ear454 = mapFn(tracking.earRight.x, tracking.earRight.y);
  const screenLeftEar = ear234.x < ear454.x ? ear234 : ear454;
  const screenRightEar = ear234.x < ear454.x ? ear454 : ear234;

  const bridgePx = mapFn(tracking.noseBridge.x, tracking.noseBridge.y);
  const sellionPx = mapFn(tracking.sellion.x, tracking.sellion.y);
  const noseTipPx = mapFn(tracking.noseTip.x, tracking.noseTip.y);

  const cheekSpanPx = Math.max(
    24,
    Math.hypot(screenRightEar.x - screenLeftEar.x, screenRightEar.y - screenLeftEar.y)
  );
  const eyeDistPx = Math.max(
    16,
    Math.hypot(rightEyeScreen.x - leftEyeScreen.x, rightEyeScreen.y - leftEyeScreen.y)
  );
  const rollDeg =
    Math.atan2(rightEyeScreen.y - leftEyeScreen.y, rightEyeScreen.x - leftEyeScreen.x) * (180 / Math.PI);

  const midCheekX = (screenLeftEar.x + screenRightEar.x) / 2;
  const headTurn = (noseTipPx.x - midCheekX) / Math.max(20, cheekSpanPx);
  const screenYawDeg = Math.max(-48, Math.min(48, headTurn * 114));

  const cosYaw = Math.max(0.58, Math.cos((screenYawDeg * Math.PI) / 180));
  const trueEyeDistPx = eyeDistPx / cosYaw;
  const trueCheekSpanPx = cheekSpanPx / Math.max(0.7, cosYaw);

  // Calibrate pixels-per-mm from true IPD (tracking.pdMm ~63mm) & anatomical cheek span (~140mm)
  const pdMm = Math.max(54, Math.min(74, tracking.pdMm || 63));
  const pxPerMmFromPupils = trueEyeDistPx / pdMm;
  const pxPerMmFromTemples = trueCheekSpanPx / 140;
  const pxPerMm = pxPerMmFromPupils * 0.72 + pxPerMmFromTemples * 0.28;

  const safeWidthMm = Math.max(110, Math.min(165, frameWidthMm || 136));
  const sizeMult = FRAME_SIZE_SCALE[frameSize] ?? 1.0;
  const glassesWidth = safeWidthMm * pxPerMm * sizeMult;
  const clampedRatio = Math.max(0.24, Math.min(0.68, frameAspectRatio || 0.41));
  const glassesHeight = glassesWidth * clampedRatio;

  const midEyeX = (leftEyeScreen.x + rightEyeScreen.x) / 2;
  const midEyeY = (leftEyeScreen.y + rightEyeScreen.y) / 2;
  const cx = bridgePx.x * 0.68 + midEyeX * 0.32;
  const cy = bridgePx.y * 0.62 + sellionPx.y * 0.22 + midEyeY * 0.16 + trueEyeDistPx * 0.04;

  const earLiftY = trueEyeDistPx * 0.085;
  const leftEar = { x: screenLeftEar.x, y: screenLeftEar.y - earLiftY };
  const rightEar = { x: screenRightEar.x, y: screenRightEar.y - earLiftY };

  const contourScreenPoints =
    tracking.contourPoints.length > 10
      ? tracking.contourPoints.map((pt) => mapFn(pt.x, pt.y))
      : undefined;

  const occluderPolygon = contourScreenPoints
    ? contourScreenPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    : undefined;

  return {
    cx,
    cy,
    glassesWidth,
    glassesHeight,
    rollDeg,
    screenYawDeg,
    yawDeg: screenYawDeg,
    pitchDeg: Math.max(-28, Math.min(28, tracking.pitch)),
    leftEar,
    rightEar,
    occluderPolygon,
    contourScreenPoints,
    eyeDistPx: trueEyeDistPx,
    pxPerMm,
    frameWidthMm: safeWidthMm,
    cheekSpanPx: trueCheekSpanPx,
    bridgePx,
  };
}

