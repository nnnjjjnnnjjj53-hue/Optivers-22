import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FrameSize, Product } from '../types';
import { resolveStoreFrontUrl, resolveTryOnFrontUrl } from '../utils/bulkFrameProcessor';
import { FRAME_SIZE_SCALE, getFaceLandmarker, getLandmarkerRuntimeInfo } from '../utils/faceTracker';
import { assessOpticalFit, resolveProductOpticalDimensions } from '../utils/opticalDimensions';
import { recordStoreCameraTryOn } from '../utils/storeAnalytics';

interface TryOnRenderer {
  domElement: HTMLCanvasElement;
  render: (scene: THREE.Scene, camera: THREE.Camera) => void;
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
  setPixelRatio: (value: number) => void;
  setClearColor?: (color: THREE.ColorRepresentation, alpha?: number) => void;
  outputColorSpace?: string;
  dispose: () => void;
}

export interface OrthographicFacePose {
  anchor: THREE.Vector3;
  quaternion: THREE.Quaternion;
  faceWidth: number;
  yawDeg: number;
}

export type FrameFitStatus = 'ideal' | 'narrow' | 'oversized';

export interface PhysicalIrisFit {
  pixelIPD: number;
  pixelsPerMm: number;
  targetWidthPx: number;
  userFaceWidthMm: number;
  matchPct: number;
  fitStatus: FrameFitStatus;
  fitLabelAr: string;
}

export interface VideoTryOnHandle {
  getCanvas: () => HTMLCanvasElement | null;
  renderNow: () => HTMLCanvasElement | null;
}

interface VideoTryOnCanvasProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  product: Product;
  frontImageUrl?: string;
  glbUrl?: string;
  frameSize?: FrameSize;
  fitScaleOverride?: number;
  eyeLineOffsetOverride?: number;
  active?: boolean;
  showDebugBadge?: boolean;
  onLandmarksFrame?: (landmarks: { x: number; y: number; z: number }[] | null) => void;
}

const ADULT_IPD_MM = 63;
const KIDS_IPD_MM = 54;
const IRIS_CALIBRATION_FACTOR = 0.92;

/**
 * Pure OrthographicCamera pose computation in un-mirrored video pixel space:
 *  - Maps normalized MediaPipe landmark `(l.x, l.y, l.z)` -> `((l.x - 0.5)*w, -(l.y - 0.5)*h, -l.z*w)`
 *  - Basis:
 *      x = normalize(L263 - L33)
 *      approxUp = normalize(L10 - L152)
 *      z = normalize(cross(x, approxUp))
 *      y = normalize(cross(z, x))
 *  - faceWidth = distance(L127, L356)
 *  - anchor = lerp(avg(L33, L133, L263, L362), L168, 0.25) + z * (faceWidth * 0.07)
 */
export function computeOrthographicPose(
  landmarks: { x: number; y: number; z: number }[],
  w: number,
  h: number
): OrthographicFacePose {
  const toVec = (idx: number) => {
    const l = landmarks[idx] || { x: 0.5, y: 0.5, z: 0 };
    return new THREE.Vector3((l.x - 0.5) * w, -(l.y - 0.5) * h, -l.z * w);
  };

  const L33 = toVec(33);
  const L133 = toVec(133);
  const L263 = toVec(263);
  const L362 = toVec(362);
  const L10 = toVec(10);
  const L152 = toVec(152);
  const L127 = toVec(127);
  const L356 = toVec(356);
  const L168 = toVec(168);

  const x = new THREE.Vector3().subVectors(L263, L33);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  else x.normalize();

  const approxUp = new THREE.Vector3().subVectors(L10, L152);
  if (approxUp.lengthSq() < 1e-6) approxUp.set(0, 1, 0);
  else approxUp.normalize();

  const z = new THREE.Vector3().crossVectors(x, approxUp);
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
  else z.normalize();

  const y = new THREE.Vector3().crossVectors(z, x).normalize();

  const basisMat = new THREE.Matrix4().makeBasis(x, y, z);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basisMat);

  const faceWidth = Math.max(24, L127.distanceTo(L356));
  const eyeAvg = new THREE.Vector3().add(L33).add(L133).add(L263).add(L362).multiplyScalar(0.25);
  const anchor = eyeAvg.lerp(L168, 0.25).addScaledVector(z, faceWidth * 0.07);
  const yawDeg = Math.asin(Math.max(-1, Math.min(1, z.x))) * (180 / Math.PI);

  return { anchor, quaternion, faceWidth, yawDeg };
}

/**
 * Automatic True-to-Scale Physical Sizing using MediaPipe iris landmarks (468, 473)
 * with 63mm adult IPD or 54mm kids IPD and 0.92 perspective calibration factor.
 */
export function computePhysicalIrisFit(
  landmarks: { x: number; y: number; z: number }[],
  videoW: number,
  videoH: number,
  frameWidthMm = 136,
  fitScale = 1.0,
  isKids = false
): PhysicalIrisFit {
  const hasIrises = landmarks.length > 473 && landmarks[468] && landmarks[473];
  const leftIris = hasIrises
    ? landmarks[468]
    : {
        x: ((landmarks[33]?.x ?? 0.39) + (landmarks[133]?.x ?? 0.42)) * 0.5,
        y: ((landmarks[33]?.y ?? 0.44) + (landmarks[133]?.y ?? 0.44)) * 0.5,
      };
  const rightIris = hasIrises
    ? landmarks[473]
    : {
        x: ((landmarks[263]?.x ?? 0.61) + (landmarks[362]?.x ?? 0.58)) * 0.5,
        y: ((landmarks[263]?.y ?? 0.44) + (landmarks[362]?.y ?? 0.44)) * 0.5,
      };

  const pixelIPD = Math.max(
    18,
    Math.hypot((rightIris.x - leftIris.x) * videoW, (rightIris.y - leftIris.y) * videoH)
  );
  const referenceIpdMm = isKids ? KIDS_IPD_MM : ADULT_IPD_MM;
  const pixelsPerMm = Math.max(0.25, pixelIPD / referenceIpdMm);
  const targetWidthPx = frameWidthMm * pixelsPerMm * fitScale * IRIS_CALIBRATION_FACTOR;

  const l127 = landmarks[127] || { x: 0.28, y: 0.44, z: 0 };
  const l356 = landmarks[356] || { x: 0.72, y: 0.44, z: 0 };
  const faceWidthPx = Math.max(
    24,
    Math.hypot((l356.x - l127.x) * videoW, (l356.y - l127.y) * videoH, (l356.z - l127.z) * videoW)
  );
  const userFaceWidthMm = faceWidthPx / pixelsPerMm;
  const assessed = assessOpticalFit(userFaceWidthMm, frameWidthMm);

  return {
    pixelIPD,
    pixelsPerMm,
    targetWidthPx,
    userFaceWidthMm,
    matchPct: assessed.matchPct,
    fitStatus: assessed.status,
    fitLabelAr: assessed.badgeLabel,
  };
}

function buildSculptedTempleGeometry(): THREE.BufferGeometry {
  // Slim sculpted temple profile (thickness = 0.012) in YZ plane: hinge (0,0) back to ear bend & downward ear tip
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.018);
  shape.lineTo(-0.44, 0.013);
  shape.quadraticCurveTo(-0.56, 0.01, -0.63, -0.058);
  shape.lineTo(-0.65, -0.072);
  shape.quadraticCurveTo(-0.57, -0.014, -0.44, -0.011);
  shape.lineTo(0, -0.015);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.002,
    bevelThickness: 0.002,
  });
  // Extrude builds along +Z; rotate -90° around Y so temple extends backward along -Z
  geo.translate(0, 0, -0.006);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

function sampleDominantRimColorFromTexture(tex: THREE.Texture, fallbackHex: string): string {
  try {
    const img = tex.image as CanvasImageSource & { width?: number; height?: number };
    const w = Number(img?.width) || 0;
    const h = Number(img?.height) || 0;
    if (!w || !h) return fallbackHex;

    const c = document.createElement('canvas');
    const sw = Math.min(160, w);
    const sh = Math.max(1, Math.round((h / w) * sw));
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallbackHex;
    ctx.drawImage(img, 0, 0, sw, sh);
    const d = ctx.getImageData(0, 0, sw, sh).data;

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;
    // Focus on upper outer rim bands (avoid transparent inner lens region)
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (x > sw * 0.14 && x < sw * 0.86 && y > sh * 0.25 && y < sh * 0.78) continue;
        const i = (y * sw + x) * 4;
        if (d[i + 3] < 200) continue;
        rSum += d[i];
        gSum += d[i + 1];
        bSum += d[i + 2];
        count++;
      }
    }
    if (count < 8) return fallbackHex;
    const r = Math.round(rSum / count);
    const g = Math.round(gSum / count);
    const b = Math.round(bSum / count);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return fallbackHex;
  }
}

function disposeObjectResources(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.map) std.map.dispose();
        m.dispose();
      }
    }
  });
}

function createProceduralFallbackPngUrl(product: Product): string {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 260;
  const ctx = c.getContext('2d')!;
  const frameCol = product.frame && product.frame !== 'transparent' ? product.frame : '#1e293b';
  const isSun = product.cat === 'sun';
  const lensFill = isSun ? `${product.lens || '#334155'}aa` : 'rgba(255,255,255,0.05)';

  ctx.lineWidth = product.type === 'rimless' ? 5 : 14;
  ctx.strokeStyle = frameCol;
  ctx.fillStyle = lensFill;

  const drawLens = (x: number, y: number, w: number, h: number) => {
    ctx.beginPath();
    if (product.type === 'round') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.roundRect(x, y, w, h, product.type === 'aviator' ? [18, 18, 68, 68] : 28);
    }
    ctx.fill();
    ctx.stroke();
  };

  drawLens(34, 30, 240, 185);
  drawLens(366, 30, 240, 185);

  ctx.beginPath();
  ctx.moveTo(274, 92);
  ctx.quadraticCurveTo(320, 62, 366, 92);
  ctx.stroke();

  return c.toDataURL('image/png');
}

export const VideoTryOnCanvas = forwardRef<VideoTryOnHandle, VideoTryOnCanvasProps>(function VideoTryOnCanvas(
  {
    videoRef,
    product,
    frontImageUrl,
    glbUrl,
    frameSize = 'Medium',
    fitScaleOverride,
    eyeLineOffsetOverride,
    active = true,
    showDebugBadge = true,
    onLandmarksFrame,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const threeRef = useRef<{
    renderer: TryOnRenderer;
    backend: 'webgpu' | 'webgl';
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    glassesGroup: THREE.Group;
    assetHolder: THREE.Group;
    leftTemple: THREE.Mesh;
    rightTemple: THREE.Mesh;
    leftTempleMat: THREE.MeshStandardMaterial;
    rightTempleMat: THREE.MeshStandardMaterial;
    occluder: THREE.Mesh;
    videoW: number;
    videoH: number;
  } | null>(null);

  const [rendererReadyTick, setRendererReadyTick] = useState(0);
  const [clipOnActive, setClipOnActive] = useState(false);

  useEffect(() => {
    setClipOnActive(false);
  }, [product.id]);

  const loadTokenRef = useRef(0);
  const wasFaceVisibleRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const planeHeightRef = useRef(0.42);
  const lastNoFaceWarnAtRef = useRef(0);
  const firstNoFaceAtRef = useRef<number | null>(null);
  const fpsCounterRef = useRef({ frames: 0, lastAt: performance.now(), fps: 0 });
  const lastFitStatusRef = useRef<FrameFitStatus | null>(null);
  const trackedTryOnProductsRef = useRef<Set<string>>(new Set());

  const [fitIndicator, setFitIndicator] = useState<{
    status: FrameFitStatus;
    label: PhysicalIrisFit['fitLabelAr'];
  } | null>(null);

  const [debugOpen, setDebugOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('debug') === '1';
  });
  const [debugStats, setDebugStats] = useState<{
    faceDetected: boolean;
    delegate: string;
    backend: string;
    videoW: number;
    videoH: number;
    fps: number;
    landmarksCount: number;
    lastError: string;
  }>({
    faceDetected: false,
    delegate: getLandmarkerRuntimeInfo().delegate,
    backend: 'webgl',
    videoW: 0,
    videoH: 0,
    fps: 0,
    landmarksCount: 0,
    lastError: 'none',
  });

  useEffect(() => {
    if (!active || !debugStats.faceDetected || !product.id || !product.shopId) return;
    const trackKey = `${product.shopId}:${product.id}`;
    if (trackedTryOnProductsRef.current.has(trackKey)) return;
    trackedTryOnProductsRef.current.add(trackKey);
    recordStoreCameraTryOn(product.shopId, {
      id: product.id,
      name: product.name,
      imageUrl: resolveStoreFrontUrl(product) || frontImageUrl,
    });
  }, [active, debugStats.faceDetected, product.id, product.shopId, product.name, frontImageUrl]);

  const opticalSpec = resolveProductOpticalDimensions(product);
  const frameWidthMm =
    product.totalFrameWidthMm ??
    product.modelCalibration?.totalFrameWidthMm ??
    product.modelCalibration?.frameWidthMm ??
    opticalSpec.totalFrameWidthMm;
  const templeLengthMm = opticalSpec.templeLengthMm;
  const resolvedFitScale = fitScaleOverride ?? product.modelCalibration?.fitScale ?? 1.0;
  const resolvedEyeLineOffset = eyeLineOffsetOverride ?? product.modelCalibration?.eyeLineOffset ?? 0.04;
  const sizeMultiplier = FRAME_SIZE_SCALE[frameSize] ?? 1.0;
  const isKidsFrame = product.frameType === 'kids';

  const latestPropsRef = useRef({
    active,
    frameWidthMm,
    fitScale: resolvedFitScale,
    eyeLineOffset: resolvedEyeLineOffset,
    sizeMultiplier,
    isKidsFrame,
    onLandmarksFrame,
  });
  latestPropsRef.current = {
    active,
    frameWidthMm,
    fitScale: resolvedFitScale,
    eyeLineOffset: resolvedEyeLineOffset,
    sizeMultiplier,
    isKidsFrame,
    onLandmarksFrame,
  };

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    renderNow: () => {
      const t = threeRef.current;
      if (!t) return null;
      t.renderer.render(t.scene, t.camera);
      return canvasRef.current;
    },
  }));

  // 1. Initialize Three.js Scene (WebGPURenderer with clean WebGLRenderer fallback) + OrthographicCamera + Head Occluder + 3D Temples
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let activeRenderer: TryOnRenderer | null = null;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.25));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
    dirLight.position.set(1, 2, 3);
    scene.add(dirLight);

    const camera = new THREE.OrthographicCamera(-320, 320, 240, -240, 1, 20000);
    camera.position.set(0, 0, 10000);
    camera.lookAt(0, 0, 0);

    const glassesGroup = new THREE.Group();
    glassesGroup.visible = false;
    scene.add(glassesGroup);

    // Invisible Head Occluder behind the nose bridge so rear temple ends disappear naturally behind head/ears
    const occGeo = new THREE.SphereGeometry(0.5, 24, 18);
    occGeo.scale(0.94, 1.32, 0.98);
    occGeo.translate(0, -0.05, -0.64);
    const occMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    const occluder = new THREE.Mesh(occGeo, occMat);
    occluder.renderOrder = 0;
    glassesGroup.add(occluder);

    // Sculpted realistic 3D side temple arms (thickness=0.012, anchored at x = ±0.48), revealed smoothly when |yaw| >= 12°
    const templeGeo = buildSculptedTempleGeometry();
    const initialHex =
      product.frameHexColor ||
      (product.frame && product.frame !== 'transparent' ? product.frame : '#1e293b');
    const isMetal = product.frameType === 'metal' || product.modelCalibration?.material === 'metal';
    const leftTempleMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(initialHex),
      roughness: isMetal ? 0.25 : 0.35,
      metalness: isMetal ? 0.85 : 0.25,
      transparent: true,
      opacity: 0,
    });
    const rightTempleMat = leftTempleMat.clone();

    const leftTemple = new THREE.Mesh(templeGeo, leftTempleMat);
    leftTemple.position.set(-0.48, 0.04, 0);
    leftTemple.renderOrder = 1;
    leftTemple.visible = false;
    glassesGroup.add(leftTemple);

    const rightTemple = new THREE.Mesh(templeGeo.clone(), rightTempleMat);
    rightTemple.position.set(0.48, 0.04, 0);
    rightTemple.renderOrder = 1;
    rightTemple.visible = false;
    glassesGroup.add(rightTemple);

    const assetHolder = new THREE.Group();
    glassesGroup.add(assetHolder);

    const createWebGLFallback = (): { renderer: TryOnRenderer; backend: 'webgl' } => {
      const gl = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      gl.setClearColor(0x000000, 0);
      gl.outputColorSpace = THREE.SRGBColorSpace;
      gl.setPixelRatio(1);
      gl.setSize(640, 480, false);
      return { renderer: gl, backend: 'webgl' };
    };

    const initRenderer = async () => {
      let chosenRenderer: TryOnRenderer | null = null;
      let chosenBackend: 'webgpu' | 'webgl' = 'webgl';

      const gpuApi =
        typeof navigator !== 'undefined'
          ? (navigator as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu
          : undefined;
      if (gpuApi?.requestAdapter) {
        try {
          const adapter = await gpuApi.requestAdapter();
          if (adapter && !disposed) {
            const gpuRenderer = new WebGPURenderer({
              canvas,
              alpha: true,
              antialias: true,
            });
            await gpuRenderer.init();
            if (disposed) {
              gpuRenderer.dispose();
              return;
            }
            gpuRenderer.setClearColor?.(0x000000, 0);
            if ('outputColorSpace' in gpuRenderer) {
              (gpuRenderer as unknown as { outputColorSpace: THREE.ColorSpace }).outputColorSpace =
                THREE.SRGBColorSpace;
            }
            gpuRenderer.setPixelRatio(1);
            gpuRenderer.setSize(640, 480, false);
            chosenRenderer = gpuRenderer as unknown as TryOnRenderer;
            chosenBackend = 'webgpu';
          }
        } catch (gpuErr) {
          console.info('[TryOn] WebGPURenderer unavailable, falling back to WebGLRenderer:', gpuErr);
          chosenRenderer = null;
        }
      }

      if (!chosenRenderer) {
        if (disposed) return;
        const fb = createWebGLFallback();
        chosenRenderer = fb.renderer;
        chosenBackend = fb.backend;
      }

      if (disposed) {
        chosenRenderer.dispose();
        return;
      }

      activeRenderer = chosenRenderer;
      threeRef.current = {
        renderer: chosenRenderer,
        backend: chosenBackend,
        scene,
        camera,
        glassesGroup,
        assetHolder,
        leftTemple,
        rightTemple,
        leftTempleMat,
        rightTempleMat,
        occluder,
        videoW: 640,
        videoH: 480,
      };
      setDebugStats((prev) => ({ ...prev, backend: chosenBackend }));
      setRendererReadyTick((n) => n + 1);
    };

    void initRenderer();

    return () => {
      disposed = true;
      disposeObjectResources(glassesGroup);
      activeRenderer?.dispose();
      threeRef.current = null;
    };
  }, []);

  // 2. Load hollowed Try-On PNG plane OR optional .glb model with load-token guard & Clip-On toggle
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    const token = ++loadTokenRef.current;

    const fallbackHex =
      product.frameHexColor ||
      (product.frame && product.frame !== 'transparent' ? product.frame : '#1e293b');
    const isMetal = product.frameType === 'metal' || product.modelCalibration?.material === 'metal';
    const isKids = product.frameType === 'kids';

    t.leftTempleMat.color.set(fallbackHex);
    t.rightTempleMat.color.set(fallbackHex);
    t.leftTempleMat.metalness = isMetal ? 0.85 : 0.25;
    t.leftTempleMat.roughness = isMetal ? 0.25 : 0.35;
    t.rightTempleMat.metalness = isMetal ? 0.85 : 0.25;
    t.rightTempleMat.roughness = isMetal ? 0.25 : 0.35;
    const templeScaleZ = (templeLengthMm / 140) * (isKids ? 0.72 : 1);
    t.leftTemple.scale.set(1, 1, templeScaleZ);
    t.rightTemple.scale.set(1, 1, templeScaleZ);

    const hasClipOn = product.frameType === 'clip_on' && Boolean(product.clipOnImagePath);
    const resolvedGlb = (glbUrl || product.glbUrl || product.model3dUrl || '').trim();
    const resolvedPng = (
      clipOnActive && hasClipOn
        ? product.clipOnImagePath || ''
        : frontImageUrl || resolveTryOnFrontUrl(product) || ''
    ).trim();

    const clearAssetHolder = () => {
      while (t.assetHolder.children.length > 0) {
        const ch = t.assetHolder.children[0];
        t.assetHolder.remove(ch);
        disposeObjectResources(ch);
      }
    };

    if (resolvedGlb) {
      const loader = new GLTFLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(
        resolvedGlb,
        (gltf) => {
          if (token !== loadTokenRef.current || !threeRef.current) {
            disposeObjectResources(gltf.scene);
            return;
          }
          clearAssetHolder();
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);
          const normScale = 1 / Math.max(1e-4, size.x);
          model.scale.setScalar(normScale);
          model.position.set(-center.x * normScale, -center.y * normScale, -box.max.z * normScale);
          const normH = size.y * normScale;
          planeHeightRef.current = normH;
          model.position.y -= latestPropsRef.current.eyeLineOffset * normH;
          t.leftTemple.visible = false;
          t.rightTemple.visible = false;
          t.assetHolder.add(model);
        },
        undefined,
        (err) => {
          console.warn('[TryOn] GLB load failed, falling back to PNG plane:', err);
          if (token === loadTokenRef.current) {
            loadPngPlane(resolvedPng || createProceduralFallbackPngUrl(product));
          }
        }
      );
      return;
    }

    const loadPngPlane = (url: string) => {
      const texLoader = new THREE.TextureLoader();
      texLoader.setCrossOrigin('anonymous');
      texLoader.load(
        url,
        (tex) => {
          if (token !== loadTokenRef.current || !threeRef.current) {
            tex.dispose();
            return;
          }
          clearAssetHolder();
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;

          // Match 3D side temple arm color to outer rim dominant color or saved frameHexColor
          const rimHex = product.frameHexColor || sampleDominantRimColorFromTexture(tex, fallbackHex);
          t.leftTempleMat.color.set(rimHex);
          t.rightTempleMat.color.set(rimHex);

          const imgEl = tex.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | undefined;
          const nw = imgEl?.naturalWidth || imgEl?.width || 800;
          const nh = imgEl?.naturalHeight || imgEl?.height || 340;
          const aspect = product.aspectRatio || nw / Math.max(1, nh);
          const planeH = 1 / Math.max(0.2, aspect);
          planeHeightRef.current = planeH;

          const geo = new THREE.PlaneGeometry(1, planeH);
          const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.renderOrder = 2;
          mesh.position.y = -latestPropsRef.current.eyeLineOffset * planeH;
          t.assetHolder.add(mesh);

          // Anchor 3D temple arms at exact outer frame hinge edges (x = ±0.48)
          const hingeY = planeH * 0.14 - latestPropsRef.current.eyeLineOffset * planeH;
          t.leftTemple.position.set(-0.48, hingeY, 0);
          t.rightTemple.position.set(0.48, hingeY, 0);
        },
        undefined,
        (err) => {
          console.warn('[TryOn] Texture load error:', err);
          setDebugStats((prev) => ({ ...prev, lastError: 'Texture load error' }));
        }
      );
    };

    loadPngPlane(resolvedPng || createProceduralFallbackPngUrl(product));
  }, [product, frontImageUrl, glbUrl, clipOnActive, rendererReadyTick]);

  // Apply live eyeLineOffset slider changes immediately without reloading texture
  useEffect(() => {
    const t = threeRef.current;
    if (!t || t.assetHolder.children.length === 0) return;
    const mesh = t.assetHolder.children[0];
    const planeH = planeHeightRef.current;
    mesh.position.y = -resolvedEyeLineOffset * planeH;
    const hingeY = planeH * 0.14 - resolvedEyeLineOffset * planeH;
    t.leftTemple.position.y = hingeY;
    t.rightTemple.position.y = hingeY;
  }, [resolvedEyeLineOffset]);

  // 3. Dedicated MediaPipe + Three.js loop driven via loopRef.current (zero stale closures)
  const loopRef = useRef<() => void>(() => {});
  const landmarkerRef = useRef<Awaited<ReturnType<typeof getFaceLandmarker>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFaceLandmarker()
      .then((lm) => {
        if (!cancelled) {
          landmarkerRef.current = lm;
          const info = getLandmarkerRuntimeInfo();
          setDebugStats((prev) => ({ ...prev, delegate: info.delegate }));
        }
      })
      .catch((err) => {
        console.warn('[TryOn] Landmarker init error:', err);
        if (!cancelled) {
          setDebugStats((prev) => ({
            ...prev,
            lastError: err instanceof Error ? err.message : String(err),
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  loopRef.current = () => {
    const t = threeRef.current;
    const video = videoRef.current;
    const {
      active: isActive,
      frameWidthMm: activeFrameWidthMm,
      fitScale,
      sizeMultiplier: szMult,
      isKidsFrame: isKids,
      onLandmarksFrame: emitLm,
    } = latestPropsRef.current;

    if (!t || !isActive || !video || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return;
    }

    const w = video.videoWidth;
    const h = video.videoHeight;

    if (w !== t.videoW || h !== t.videoH) {
      t.videoW = w;
      t.videoH = h;
      t.camera.left = -w / 2;
      t.camera.right = w / 2;
      t.camera.top = h / 2;
      t.camera.bottom = -h / 2;
      t.camera.updateProjectionMatrix();
      t.renderer.setPixelRatio(1);
      t.renderer.setSize(w, h, false);
      const orient = w >= h ? 'landscape' : 'portrait';
      console.info(`[TryOn] video ${w}x${h} (${orient}) [${t.backend}]`);
      setDebugStats((prev) => ({ ...prev, videoW: w, videoH: h, backend: t.backend }));
    }

    const lm = landmarkerRef.current;
    const curTime = video.currentTime;

    if (lm && curTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = curTime;
      const now = performance.now();

      try {
        const res = lm.detectForVideo(video, now);
        const fc = fpsCounterRef.current;
        fc.frames += 1;
        if (now - fc.lastAt >= 500) {
          const fps = Math.round((fc.frames * 1000) / Math.max(1, now - fc.lastAt));
          fc.frames = 0;
          fc.lastAt = now;
          setDebugStats((prev) => ({ ...prev, fps }));
        }

        const faces = res.faceLandmarks;
        if (faces && faces.length > 0 && faces[0].length > 362) {
          const pts = faces[0];
          firstNoFaceAtRef.current = null;

          const pose = computeOrthographicPose(pts, w, h);
          const physicalFit = computePhysicalIrisFit(pts, w, h, activeFrameWidthMm, fitScale, isKids);
          const targetScale = physicalFit.targetWidthPx * szMult;

          if (!wasFaceVisibleRef.current) {
            t.glassesGroup.position.copy(pose.anchor);
            t.glassesGroup.quaternion.copy(pose.quaternion);
            t.glassesGroup.scale.setScalar(targetScale);
            wasFaceVisibleRef.current = true;
          } else {
            t.glassesGroup.position.lerp(pose.anchor, 0.55);
            t.glassesGroup.quaternion.slerp(pose.quaternion, 0.55);
            const nextScale = THREE.MathUtils.lerp(t.glassesGroup.scale.x, targetScale, 0.55);
            t.glassesGroup.scale.setScalar(nextScale);
          }

          if (
            !fitIndicator ||
            lastFitStatusRef.current !== physicalFit.fitStatus ||
            fitIndicator.label !== physicalFit.fitLabelAr
          ) {
            lastFitStatusRef.current = physicalFit.fitStatus;
            setFitIndicator({ status: physicalFit.fitStatus, label: physicalFit.fitLabelAr });
          }

          // Dynamic Side Temple Arms: hidden when looking straight (|yaw| < 12°),
          // smoothly revealed as user turns head (|yaw| >= 12°) with Head Occluder hiding behind ears
          const hasGlb = Boolean((product.glbUrl || product.model3dUrl || '').trim());
          const absYaw = Math.abs(pose.yawDeg);
          const baseTempleOpacity = Math.max(0.25, Math.min(1, product.frameOpacity ?? 0.96));
          if (!hasGlb && absYaw >= 12) {
            const revealAlpha = Math.min(baseTempleOpacity, Math.max(0.18, (absYaw - 12) / 12));
            t.leftTemple.visible = pose.yawDeg >= 12;
            t.rightTemple.visible = pose.yawDeg <= -12;
            t.leftTempleMat.opacity = pose.yawDeg >= 12 ? revealAlpha : 0;
            t.rightTempleMat.opacity = pose.yawDeg <= -12 ? revealAlpha : 0;
          } else {
            t.leftTemple.visible = false;
            t.rightTemple.visible = false;
            t.leftTempleMat.opacity = 0;
            t.rightTempleMat.opacity = 0;
          }

          t.glassesGroup.visible = true;
          emitLm?.(pts);

          setDebugStats((prev) =>
            prev.faceDetected && prev.landmarksCount === pts.length
              ? prev
              : {
                  ...prev,
                  faceDetected: true,
                  landmarksCount: pts.length,
                  videoW: w,
                  videoH: h,
                  delegate: getLandmarkerRuntimeInfo().delegate,
                }
          );
        } else {
          t.glassesGroup.visible = false;
          wasFaceVisibleRef.current = false;
          emitLm?.(null);

          if (lastFitStatusRef.current !== null) {
            lastFitStatusRef.current = null;
            setFitIndicator(null);
          }

          if (firstNoFaceAtRef.current === null) {
            firstNoFaceAtRef.current = now;
          } else if (now - firstNoFaceAtRef.current > 2500 && now - lastNoFaceWarnAtRef.current > 5000) {
            lastNoFaceWarnAtRef.current = now;
            console.warn('[TryOn] No face detected for >2.5s — move closer or improve lighting');
          }

          setDebugStats((prev) =>
            !prev.faceDetected && prev.landmarksCount === 0
              ? prev
              : { ...prev, faceDetected: false, landmarksCount: 0 }
          );
        }
      } catch (err) {
        console.warn('[TryOn] detectForVideo error:', err);
        setDebugStats((prev) => ({
          ...prev,
          lastError: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    t.renderer.render(t.scene, t.camera);
  };

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      loopRef.current();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none z-10"
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* Arabic True-to-Scale 1:1 Smart Fit Match Indicator */}
      {active && fitIndicator && showDebugBadge && (
        <div className="absolute top-16 end-3 z-20 pointer-events-none">
          <span
            className={
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold backdrop-blur-md border shadow-lg ' +
              (fitIndicator.status === 'ideal'
                ? 'bg-[#059669]/95 border-emerald-300 text-white'
                : 'bg-[#D97706]/95 border-amber-300 text-white')
            }
          >
            <span className="w-2 h-2 rounded-full shrink-0 bg-white" />
            <span>{fitIndicator.label}</span>
          </span>
        </div>
      )}

      {/* Clip-On Interactive Sun Attachment Floating Button */}
      {active && product.frameType === 'clip_on' && Boolean(product.clipOnImagePath) && (
        <div className="absolute bottom-3 inset-x-0 z-20 flex justify-center pointer-events-none">
          <button
            type="button"
            onClick={() => setClipOnActive((v) => !v)}
            className="pointer-events-auto px-4 py-2 rounded-xl bg-white/95 hover:bg-white text-slate-900 border border-slate-200 shadow-lg text-xs font-extrabold flex items-center gap-2 transition cursor-pointer"
          >
            <span>{clipOnActive ? 'إزالة الغيار 👓' : 'تركيب غيار الشمس 🕶️'}</span>
          </button>
        </div>
      )}

      {showDebugBadge && active && (
        <div className="absolute top-16 start-3 z-20 flex flex-col items-start gap-1.5" dir="rtl">
          <button
            type="button"
            onClick={() => setDebugOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/65 backdrop-blur-md border border-white/15 text-[0.7rem] font-semibold text-white cursor-pointer"
          >
            <span
              className={
                'w-2 h-2 rounded-full shrink-0 ' +
                (debugStats.faceDetected ? 'bg-emerald-400' : 'bg-amber-400')
              }
            />
            <span>
              {debugStats.faceDetected ? 'تم اكتشاف الوجه ✓' : 'وجّه الكاميرا لوجهك في إضاءة واضحة 👓'}
            </span>
          </button>

          {debugOpen && (
            <div dir="ltr" className="px-2.5 py-2 rounded-lg bg-slate-950/88 border border-white/15 text-[0.68rem] font-mono text-slate-200 space-y-0.5 shadow-lg">
              <div>renderer: {debugStats.backend}</div>
              <div>delegate: {debugStats.delegate}</div>
              <div>
                video: {debugStats.videoW}x{debugStats.videoH}
              </div>
              <div>FPS: {debugStats.fps}</div>
              <div>landmarks: {debugStats.landmarksCount}</div>
              <div>lastError: {debugStats.lastError}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
});
