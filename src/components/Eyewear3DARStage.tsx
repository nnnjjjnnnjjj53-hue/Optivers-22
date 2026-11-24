import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Product } from '../types';
import { resolveStoreFrontUrl, resolveTryOnFrontUrl } from '../utils/bulkFrameProcessor';
import { resolveProductOpticalDimensions } from '../utils/opticalDimensions';
import {
  buildEyewear3DGroup,
  createHeadOccluderMesh,
  detectSoftwareWebGL,
  disposeThreeObject,
} from '../utils/eyewear3DBuilder';
import { EMASmoother } from '../utils/faceTracker';

export interface Eyewear3DARPlacement {
  cx: number;
  cy: number;
  glassesWidth: number;
  glassesHeight: number;
  rollDeg: number;
  yawDeg: number;
  pitchDeg: number;
  cheekSpanPx?: number;
  pxPerMm?: number;
}

export interface Eyewear3DARHandle {
  renderAndCapture: () => HTMLCanvasElement | null;
}

interface Eyewear3DARStageProps {
  product: Product;
  frontImageUrl?: string;
  placement: Eyewear3DARPlacement;
  frameColor: string;
  lensColor: string;
  coatingId?: string;
  stageW: number;
  stageH: number;
  lightingBiasX?: number;
  lightingExposure?: number;
  enableHeadOccluder?: boolean;
  useEmaStabilizer?: boolean;
  className?: string;
}

/**
 * Photo-realistic plane + optional `.glb` Three.js stage for static/mannequin/photo try-on:
 *  - When `product.glbUrl` / `product.model3dUrl` exists, loads the true 3D `.glb` via GLTFLoader.
 *  - Otherwise renders the real product PNG on a textured `THREE.PlaneGeometry` (no cartoonish 3D extrusion)
 *    with `fitScale`, `eyeLineOffset`, subtle side temple strips on >15° yaw, and an invisible Head Occluder.
 */
export const Eyewear3DARStage = forwardRef<Eyewear3DARHandle, Eyewear3DARStageProps>(function Eyewear3DARStage(
  {
    product,
    frontImageUrl,
    placement,
    frameColor,
    lensColor,
    coatingId = 'ar',
    stageW,
    stageH,
    lightingBiasX = 0,
    lightingExposure = 1.05,
    enableHeadOccluder = true,
    useEmaStabilizer = true,
    className = '',
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    pmrem: THREE.PMREMGenerator;
    envRT: THREE.WebGLRenderTarget;
    anchorGroup: THREE.Group;
    eyewearGroup: THREE.Group | null;
    occluderMesh: THREE.Mesh;
    keyLight: THREE.DirectionalLight;
    isSoftwareGl: boolean;
  } | null>(null);

  const emaRef = useRef<EMASmoother>(new EMASmoother(0.36, 0.3));
  const latestPlacementRef = useRef<Eyewear3DARPlacement>(placement);
  const latestSizeRef = useRef({ w: stageW, h: stageH });
  const latestLightsRef = useRef({ biasX: lightingBiasX, exposure: lightingExposure });
  const latestEnableOccRef = useRef(enableHeadOccluder);
  const latestUseEmaRef = useRef(useEmaStabilizer);
  const buildVersionRef = useRef(0);

  latestPlacementRef.current = placement;
  latestSizeRef.current = { w: Math.max(1, stageW), h: Math.max(1, stageH) };
  latestLightsRef.current = { biasX: lightingBiasX, exposure: lightingExposure };
  latestEnableOccRef.current = enableHeadOccluder;
  latestUseEmaRef.current = useEmaStabilizer;

  const cal = product.modelCalibration || {};
  const opticalSpec = resolveProductOpticalDimensions(product);
  const frameWidthMm =
    product.totalFrameWidthMm ?? cal.totalFrameWidthMm ?? cal.frameWidthMm ?? opticalSpec.totalFrameWidthMm;
  const templeLengthRatio = Math.max(0.75, Math.min(1.25, opticalSpec.templeLengthMm / 140));
  const fitScale = cal.fitScale ?? 1.0;
  const eyeLineOffset = cal.eyeLineOffset ?? 0.04;
  const resolvedGlb = (product.glbUrl || product.model3dUrl || '').trim();
  const resolvedCutout = frontImageUrl || resolveTryOnFrontUrl(product);

  const applyTransformAndRender = () => {
    const t = threeRef.current;
    if (!t || !t.eyewearGroup) return;

    const { w, h } = latestSizeRef.current;
    const raw = latestPlacementRef.current;
    const smoothed = latestUseEmaRef.current
      ? emaRef.current.update({
          cx: raw.cx,
          cy: raw.cy,
          pxPerMm: raw.pxPerMm || raw.glassesWidth / frameWidthMm,
          glassesWidth: raw.glassesWidth,
          cheekSpanPx: raw.cheekSpanPx || raw.glassesWidth * 0.96,
          yaw: raw.yawDeg,
          pitch: raw.pitchDeg,
          roll: raw.rollDeg,
        })
      : {
          cx: raw.cx,
          cy: raw.cy,
          pxPerMm: raw.pxPerMm || raw.glassesWidth / frameWidthMm,
          glassesWidth: raw.glassesWidth,
          cheekSpanPx: raw.cheekSpanPx || raw.glassesWidth * 0.96,
          yaw: raw.yawDeg,
          pitch: raw.pitchDeg,
          roll: raw.rollDeg,
        };

    const fovRad = (t.camera.fov * Math.PI) / 180;
    const modelWidthUnits = frameWidthMm / 100;
    const safeGlassesW = Math.max(24, smoothed.glassesWidth * fitScale);
    const worldPerPx = modelWidthUnits / safeGlassesW;
    const worldStageH = Math.max(0.4, h * worldPerPx);
    const camDist = Math.max(1.2, worldStageH / (2 * Math.tan(fovRad * 0.5)));

    t.camera.aspect = Math.max(0.2, w / Math.max(1, h));
    t.camera.position.set(0, 0, camDist);
    t.camera.updateProjectionMatrix();

    const worldX = (smoothed.cx - w * 0.5) * worldPerPx;
    const worldY = -(smoothed.cy - h * 0.5) * worldPerPx;
    t.anchorGroup.position.set(worldX, worldY, 0);
    t.anchorGroup.rotation.order = 'YXZ';
    t.anchorGroup.rotation.set(
      (smoothed.pitch * 0.72 * Math.PI) / 180,
      (smoothed.yaw * 0.94 * Math.PI) / 180,
      (-smoothed.roll * Math.PI) / 180
    );

    // Toggle color-matched temple strips on photo plane when head yaw exceeds 12°
    const leftArm = t.eyewearGroup.getObjectByName('photo_temple_left') as THREE.Mesh | undefined;
    const rightArm = t.eyewearGroup.getObjectByName('photo_temple_right') as THREE.Mesh | undefined;
    if (leftArm && rightArm) {
      const absYaw = Math.abs(smoothed.yaw);
      leftArm.visible = smoothed.yaw >= 12;
      rightArm.visible = smoothed.yaw <= -12;
      const alpha = Math.min(0.95, Math.max(0.18, (absYaw - 12) / 12));
      (leftArm.material as THREE.MeshBasicMaterial).opacity = alpha;
      (rightArm.material as THREE.MeshBasicMaterial).opacity = alpha;
    }

    t.occluderMesh.visible = latestEnableOccRef.current;
    if (t.occluderMesh.visible) {
      const occScaleX = Math.max(0.75, Math.min(1.35, (smoothed.cheekSpanPx * worldPerPx) / 1.38));
      t.occluderMesh.scale.set(occScaleX, 1, occScaleX);
    }

    t.keyLight.position.x = 1.4 + latestLightsRef.current.biasX * 2.2;
    t.renderer.toneMappingExposure = Math.max(0.8, Math.min(1.45, latestLightsRef.current.exposure));

    t.renderer.render(t.scene, t.camera);
  };

  useImperativeHandle(ref, () => ({
    renderAndCapture: () => {
      const t = threeRef.current;
      if (!t) return null;
      applyTransformAndRender();
      return t.renderer.domElement;
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    const isSoftwareGl = detectSoftwareWebGL(renderer.getContext());
    const maxDpr = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(maxDpr);
    renderer.setSize(Math.max(1, latestSizeRef.current.w), Math.max(1, latestSizeRef.current.h), false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.pointerEvents = 'none';

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;

    scene.add(new THREE.HemisphereLight(0xeef6ff, 0x1e293b, 0.72));
    const keyLight = new THREE.DirectionalLight(0xfff5e8, 1.32);
    keyLight.position.set(1.4, 2.0, 2.8);
    scene.add(keyLight);

    const camera = new THREE.PerspectiveCamera(
      34,
      Math.max(0.2, latestSizeRef.current.w / Math.max(1, latestSizeRef.current.h)),
      0.1,
      40
    );

    const anchorGroup = new THREE.Group();
    const occluderMesh = createHeadOccluderMesh();
    anchorGroup.add(occluderMesh);
    scene.add(anchorGroup);

    threeRef.current = {
      renderer,
      scene,
      camera,
      pmrem,
      envRT,
      anchorGroup,
      eyewearGroup: null,
      occluderMesh,
      keyLight,
      isSoftwareGl,
    };

    return () => {
      const t = threeRef.current;
      if (t) {
        if (t.eyewearGroup) {
          t.anchorGroup.remove(t.eyewearGroup);
          disposeThreeObject(t.eyewearGroup);
        }
        disposeThreeObject(t.occluderMesh);
        t.envRT.dispose();
        t.pmrem.dispose();
        t.renderer.dispose();
      }
      threeRef.current = null;
      container.innerHTML = '';
    };
  }, []);

  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    const w = Math.max(1, Math.round(stageW));
    const h = Math.max(1, Math.round(stageH));
    const maxDpr = t.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    t.renderer.setPixelRatio(maxDpr);
    t.renderer.setSize(w, h, false);
    applyTransformAndRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageW, stageH]);

  // Load real `.glb` if attached, OR build flat photo textured plane (no single-photo 3D extrusion)
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    const myVersion = ++buildVersionRef.current;
    emaRef.current.reset();

    const commitGroup = (group: THREE.Group) => {
      if (myVersion !== buildVersionRef.current || !threeRef.current) {
        disposeThreeObject(group);
        return;
      }
      if (t.eyewearGroup) {
        t.anchorGroup.remove(t.eyewearGroup);
        disposeThreeObject(t.eyewearGroup);
      }
      t.eyewearGroup = group;
      t.anchorGroup.add(group);
      applyTransformAndRender();
    };

    const modelWidth = frameWidthMm / 100;

    if (resolvedGlb) {
      const loader = new GLTFLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(
        resolvedGlb,
        (gltf) => {
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);
          const normScale = modelWidth / Math.max(1e-4, size.x);
          model.scale.setScalar(normScale);
          model.position.set(-center.x * normScale, -center.y * normScale, -box.max.z * normScale);
          const g = new THREE.Group();
          g.add(model);
          commitGroup(g);
        },
        undefined,
        () => {
          if (myVersion === buildVersionRef.current && resolvedCutout) {
            loadPhotoPlane(resolvedCutout);
          }
        }
      );
      return;
    }

    const loadPhotoPlane = (url: string) => {
      const texLoader = new THREE.TextureLoader();
      texLoader.setCrossOrigin('anonymous');
      texLoader.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const imgEl = tex.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
        const nw = imgEl?.naturalWidth || imgEl?.width || 800;
        const nh = imgEl?.naturalHeight || imgEl?.height || 340;
        const planeH = modelWidth / Math.max(0.2, nw / Math.max(1, nh));

        const g = new THREE.Group();
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(modelWidth, planeH),
          new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
          })
        );
        plane.position.y = -eyeLineOffset * planeH;
        plane.renderOrder = 2;
        g.add(plane);

        // Color-matched side temple strips scaled proportionally to templeLengthMm (templeLength / 140)
        const stripHex = frameColor && frameColor !== 'transparent' ? frameColor : product.frame || '#1e293b';
        const stripLength = modelWidth * 0.56 * templeLengthRatio;
        const stripGeo = new THREE.BoxGeometry(0.018, 0.032, stripLength);
        stripGeo.translate(0, 0, -stripLength * 0.5);
        const stripMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(stripHex),
          transparent: true,
          opacity: 0.9,
        });
        const hingeY = planeH * 0.14 - eyeLineOffset * planeH;

        const leftStrip = new THREE.Mesh(stripGeo, stripMat);
        leftStrip.name = 'photo_temple_left';
        leftStrip.position.set(-modelWidth * 0.485, hingeY, 0);
        leftStrip.renderOrder = 1;
        leftStrip.visible = false;
        g.add(leftStrip);

        const rightStrip = new THREE.Mesh(stripGeo.clone(), stripMat.clone());
        rightStrip.name = 'photo_temple_right';
        rightStrip.position.set(modelWidth * 0.485, hingeY, 0);
        rightStrip.renderOrder = 1;
        rightStrip.visible = false;
        g.add(rightStrip);

        commitGroup(g);
      });
    };

    if (resolvedCutout) {
      loadPhotoPlane(resolvedCutout);
    } else {
      buildEyewear3DGroup({
        frameWidthMm,
        opticalDimensions: cal.opticalDimensions,
        material: cal.material || 'tr_plastic',
        cat: product.cat,
        type: product.type,
        frameColor,
        lensColor,
        coatingId,
        aspectRatio: cal.aspectRatio,
        calibration: cal,
      }).then(commitGroup);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, resolvedGlb, resolvedCutout, frameWidthMm, eyeLineOffset, product.type, frameColor]);

  useEffect(() => {
    applyTransformAndRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    placement.cx,
    placement.cy,
    placement.glassesWidth,
    placement.glassesHeight,
    placement.rollDeg,
    placement.yawDeg,
    placement.pitchDeg,
    placement.cheekSpanPx,
    lightingBiasX,
    lightingExposure,
    enableHeadOccluder,
    fitScale,
  ]);

  return (
    <div
      ref={containerRef}
      className={'absolute inset-0 w-full h-full pointer-events-none ' + className}
      aria-hidden="true"
    />
  );
});

/**
 * Interactive Viewer used in `Modals.tsx` (`view3d`) and merchant inspection:
 *  - If a real `.glb` file is attached (`product.glbUrl` / `product.model3dUrl`), renders interactive 360° Three.js GLTF scene.
 *  - Otherwise showcases the clean transparent front PNG photo over a checkerboard/studio card without fake single-photo extrusion.
 */
export function Eyewear3DViewer({
  product,
  frameWidthMmOverride,
}: {
  product: Product;
  frameWidthMmOverride?: number;
  materialOverride?: 'tr_plastic' | 'metal';
  catOverride?: 'sun' | 'med' | 'safe';
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const glbUrl = (product.glbUrl || product.model3dUrl || '').trim();
  const [loading, setLoading] = useState(Boolean(glbUrl));
  const [glbError, setGlbError] = useState(false);

  const cal = product.modelCalibration || {};
  const opticalSpec = resolveProductOpticalDimensions(product);
  const frameWidthMm =
    frameWidthMmOverride ??
    product.totalFrameWidthMm ??
    cal.totalFrameWidthMm ??
    cal.frameWidthMm ??
    opticalSpec.totalFrameWidthMm;
  const cutoutUrl = resolveStoreFrontUrl(product);

  useEffect(() => {
    if (!glbUrl) return;
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let rafId = 0;
    setLoading(true);
    setGlbError(false);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    const isSw = detectSoftwareWebGL(renderer.getContext());
    renderer.setPixelRatio(isSw ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 360, host.clientHeight || 280);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;

    scene.add(new THREE.HemisphereLight(0xf8fafc, 0x1e293b, 0.8));
    const key = new THREE.DirectionalLight(0xfff5e4, 1.35);
    key.position.set(1.8, 2.2, 3.0);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(
      34,
      (host.clientWidth || 360) / Math.max(1, host.clientHeight || 280),
      0.1,
      20
    );
    camera.position.set(-0.55, 0.25, 2.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 1.1;
    controls.maxDistance = 4.2;

    let meshGroup: THREE.Object3D | null = null;
    const loader = new GLTFLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      glbUrl,
      (gltf) => {
        if (disposed) {
          disposeThreeObject(gltf.scene);
          return;
        }
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const normScale = 1.36 / Math.max(1e-4, size.x);
        model.scale.setScalar(normScale);
        model.position.set(-center.x * normScale, -center.y * normScale, -center.z * normScale);
        meshGroup = model;
        scene.add(model);
        setLoading(false);
      },
      undefined,
      () => {
        if (!disposed) {
          setLoading(false);
          setGlbError(true);
        }
      }
    );

    const onResize = () => {
      if (!host) return;
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(host);

    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      controls.dispose();
      if (meshGroup) disposeThreeObject(meshGroup);
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      host.innerHTML = '';
    };
  }, [glbUrl]);

  if (!glbUrl || glbError) {
    return (
      <div
        className="relative w-full h-72 rounded-2xl border border-[#E2E8F0] overflow-hidden flex items-center justify-center p-6"
        style={{
          backgroundImage:
            'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
          backgroundColor: '#F8F9FA',
        }}
      >
        {cutoutUrl ? (
          <img
            src={cutoutUrl}
            alt={product.name}
            className="max-h-full max-w-full object-contain drop-shadow-xl"
          />
        ) : (
          <div className="text-xs font-bold text-slate-600">لا توجد صورة معالجة أو ملف GLB</div>
        )}
        <div className="pointer-events-none absolute bottom-2.5 inset-x-0 flex justify-center">
          <span className="px-2.5 py-0.5 rounded-md bg-[#0F172A]/85 text-white text-[0.68rem] font-semibold">
            صورة الإطار الشفافة · العرض {frameWidthMm}mm
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-72 rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] overflow-hidden select-none">
      <div ref={hostRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-600">
          جاري تحميل مجسم .GLB ثلاثي الأبعاد...
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2.5 inset-x-0 flex justify-center">
        <span className="px-2.5 py-0.5 rounded-md bg-slate-900/75 text-white text-[0.68rem] font-semibold">
          ملف 3D (.GLB) · اسحب للتدوير 360° · {frameWidthMm}mm
        </span>
      </div>
    </div>
  );
}
