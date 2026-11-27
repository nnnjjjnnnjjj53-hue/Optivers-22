import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaceShape, FrameSize, Product, ProductImage } from '../types';
import { useDeviceCapabilities } from '../utils/deviceCapabilities';
import {
  FaceLightingEstimate,
  analyzeFaceLighting,
  selectGlassesAngleLayers,
} from '../ai';
import {
  FRAME_SIZE_SCALE,
  FaceTrackingFrame,
  FaceTrackingSmoother,
  Metric3DPlacement,
  PlacementGeometry,
  computeCalibratedPlacement,
  computeMetric3DPlacement,
  extractTrackingFromLandmarks,
} from '../utils/faceTracker';
import { Eyewear3DARHandle, Eyewear3DARStage } from './Eyewear3DARStage';
import { CustomerPhotoTryOn } from './CustomerPhotoTryOn';
import { VideoTryOnCanvas, VideoTryOnHandle } from './VideoTryOnCanvas';
import { Glasses, MiniGlasses, getCoatingStyle } from './GlassesGraphics';
import { I } from './Icons';
import { resolveStoreFrontUrl, resolveTryOnFrontUrl } from '../utils/bulkFrameProcessor';
import { resolveProductOpticalDimensions } from '../utils/opticalDimensions';
import { recordStoreFriendShare } from '../utils/storeAnalytics';

export type TryOnMode = 'camera' | 'photo';

interface FaceTryOnStageProps {
  product: Product;
  products?: Product[];
  onSelectProduct?: (productId: string) => void;
  onOrderProduct?: (productId: string) => void;
  onRxAttached?: (rxDataUrl: string | null) => void;
  initialRxUrl?: string | null;
  compareProduct?: Product;
  splitMode?: boolean;
  frameColor: string;
  lensColor: string;
  frameSize?: FrameSize;
  coatingId?: string;
  faceShape: FaceShape;
  onFaceShapeDetected: (shape: FaceShape) => void;
  onPdDetected?: (pdMm: number) => void;
  camOn: boolean;
  onStartCam: () => void;
  onModeChange?: (mode: TryOnMode) => void;
  yawManual?: number;
  onYawManualChange?: (y: number) => void;
  showLauncherWhenIdle?: boolean;
}

interface PhotoManualTransform {
  dx: number;
  dy: number;
  scale: number;
  rotDeg: number;
}

function getContainRect(boxW: number, boxH: number, imgW: number, imgH: number) {
  const bw = Math.max(1, boxW);
  const bh = Math.max(1, boxH);
  const iw = Math.max(1, imgW);
  const ih = Math.max(1, imgH);
  const scale = Math.min(bw / iw, bh / ih);
  const rw = iw * scale;
  const rh = ih * scale;
  return {
    x: (bw - rw) / 2,
    y: (bh - rh) / 2,
    w: rw,
    h: rh,
  };
}

function mapContainPoint(
  normX: number,
  normY: number,
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number
) {
  const rect = getContainRect(boxW, boxH, imgW, imgH);
  return {
    x: normX * rect.w + rect.x,
    y: normY * rect.h + rect.y,
  };
}

function Glasses25DOverlay({
  product,
  frontImage,
  sideImage,
  placement,
  frameColor,
  lensColor,
  coatingId,
  stageW,
  stageH,
  slotId,
  svgRef,
  manualTransform,
  lighting,
}: {
  product: Product;
  frontImage?: ProductImage;
  sideImage?: ProductImage;
  placement: PlacementGeometry;
  frameColor: string;
  lensColor: string;
  coatingId?: string;
  stageW: number;
  stageH: number;
  slotId: string;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  manualTransform?: PhotoManualTransform;
  lighting?: FaceLightingEstimate;
}) {
  const dx = manualTransform?.dx || 0;
  const dy = manualTransform?.dy || 0;
  const scale = manualTransform?.scale || 1;
  const extraRot = manualTransform?.rotDeg || 0;

  const cx = placement.cx + dx;
  const cy = placement.cy + dy;
  const gw = placement.glassesWidth * scale;
  const gh = placement.glassesHeight * scale;
  const rollDeg = placement.rollDeg + extraRot;
  const yaw = placement.screenYawDeg;
  const pitch = placement.pitchDeg;

  const coat = getCoatingStyle(coatingId, yaw);
  const glintPercent = Math.max(12, Math.min(88, 50 + yaw * 0.85));

  const yawRad = (yaw * Math.PI) / 180;
  const cosYaw = Math.max(0.55, Math.cos(yawRad));
  const rollRad = (rollDeg * Math.PI) / 180;
  const rotC = Math.cos(rollRad);
  const rotS = Math.sin(rollRad);

  const halfProjectedW = (gw * cosYaw) / 2;
  const hingeYOffset = -gh * 0.14;
  const hingeLeft = {
    x: cx + -halfProjectedW * 0.92 * rotC - hingeYOffset * rotS,
    y: cy + -halfProjectedW * 0.92 * rotS + hingeYOffset * rotC,
  };
  const hingeRight = {
    x: cx + halfProjectedW * 0.92 * rotC - hingeYOffset * rotS,
    y: cy + halfProjectedW * 0.92 * rotS + hingeYOffset * rotC,
  };

  // Strict Single-Visible-Side Occlusion Rule:
  // Keep temples hidden when looking straight (|yaw| < 12°) and reveal smoothly when turning head.
  const showLeftArm = yaw >= 12;
  const showRightArm = yaw <= -12;
  const armOpacity = Math.min(0.96, Math.max(0.25, (Math.abs(yaw) - 10) / 14));

  const maskId = `head-occ-${slotId}`;
  const armColor = frameColor && frameColor !== 'transparent' ? frameColor : product.frame || '#C9A24B';
  const armThickness =
    product.type === 'rimless'
      ? Math.max(1.8, placement.eyeDistPx * scale * 0.025)
      : product.type === 'wayfarer'
      ? Math.max(3.4, placement.eyeDistPx * scale * 0.05)
      : Math.max(2.3, placement.eyeDistPx * scale * 0.035);

  const renderVisibleSideArm = (
    hinge: { x: number; y: number },
    ear: { x: number; y: number } | undefined,
    side: 'left' | 'right',
    visible: boolean
  ) => {
    if (!ear || !visible) return null;

    if (sideImage) {
      const vecX = ear.x - hinge.x;
      const vecY = ear.y - hinge.y;
      const armLen = Math.max(18, Math.hypot(vecX, vecY) * 1.06);
      const armH = Math.max(14, gh * 0.46);
      const anchorY = armH * 0.34;

      if (side === 'right') {
        const deg = (Math.atan2(vecY, vecX) * 180) / Math.PI;
        return (
          <g
            key={side}
            mask={placement.occluderPolygon ? `url(#${maskId})` : undefined}
            opacity={armOpacity}
          >
            <g transform={`translate(${hinge.x.toFixed(1)}, ${hinge.y.toFixed(1)}) rotate(${deg.toFixed(2)})`}>
              <image
                href={sideImage.imageUrl}
                x={-armLen * 0.04}
                y={-anchorY}
                width={armLen}
                height={armH}
                preserveAspectRatio="none"
                style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.34))' }}
              />
            </g>
          </g>
        );
      }

      // Left arm: mirror horizontally so hinge aligns on the right edge (0,0) pointing leftward toward ear
      const degLeft = (Math.atan2(-vecY, -vecX) * 180) / Math.PI;
      return (
        <g
          key={side}
          mask={placement.occluderPolygon ? `url(#${maskId})` : undefined}
          opacity={armOpacity}
        >
          <g
            transform={`translate(${hinge.x.toFixed(1)}, ${hinge.y.toFixed(1)}) rotate(${degLeft.toFixed(2)}) scale(-1, 1)`}
          >
            <image
              href={sideImage.imageUrl}
              x={-armLen * 0.04}
              y={-anchorY}
              width={armLen}
              height={armH}
              preserveAspectRatio="none"
              style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.34))' }}
            />
          </g>
        </g>
      );
    }

    const dxArm = ear.x - hinge.x;
    const dyArm = ear.y - hinge.y;
    const ctrlX = hinge.x + dxArm * 0.56;
    const ctrlY = hinge.y + dyArm * 0.34;
    const tipX = ear.x + (side === 'left' ? -armThickness * 0.55 : armThickness * 0.55);
    const tipY = ear.y + armThickness * 1.9;
    const armPath = `M${hinge.x.toFixed(1)},${hinge.y.toFixed(1)} Q${ctrlX.toFixed(1)},${ctrlY.toFixed(1)} ${ear.x.toFixed(1)},${ear.y.toFixed(1)} Q${tipX.toFixed(1)},${(ear.y + armThickness * 0.85).toFixed(1)} ${tipX.toFixed(1)},${tipY.toFixed(1)}`;

    return (
      <g
        key={side}
        mask={placement.occluderPolygon ? `url(#${maskId})` : undefined}
        opacity={armOpacity}
      >
        <path
          d={armPath}
          stroke="rgba(8,5,3,0.34)"
          strokeWidth={armThickness + 1.4}
          strokeLinecap="round"
          fill="none"
          transform="translate(0, 2)"
        />
        <path d={armPath} stroke={armColor} strokeWidth={armThickness} strokeLinecap="round" fill="none" />
        <path
          d={armPath}
          stroke="rgba(255,255,255,0.28)"
          strokeWidth={Math.max(0.7, armThickness * 0.32)}
          strokeLinecap="round"
          fill="none"
          transform="translate(0, -0.5)"
        />
      </g>
    );
  };

  const angleLayers = selectGlassesAngleLayers(product.images, yaw);
  const hasDedicatedSideViews = (product.images || []).some(
    (im) => Math.abs(im.angleYaw) >= 25 && Math.abs(im.angleYaw) <= 95
  );
  const shadowOffsetX = (lighting?.directionalBiasX || 0) * -4.5;
  const shadowAlpha = lighting?.shadowAlpha ?? 0.28;
  const ambientFilter = lighting?.ambientCssFilter ? ` ${lighting.ambientCssFilter}` : '';

  if (frontImage && angleLayers.length > 0) {
    return (
      <>
        {!hasDedicatedSideViews && placement.leftEar && placement.rightEar && (showLeftArm || showRightArm) && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${stageW} ${stageH}`}
          >
            <defs>
              <mask id={maskId}>
                <rect x="0" y="0" width={stageW} height={stageH} fill="white" />
                {placement.occluderPolygon && <polygon points={placement.occluderPolygon} fill="black" />}
              </mask>
            </defs>
            {renderVisibleSideArm(hingeLeft, placement.leftEar, 'left', showLeftArm)}
            {renderVisibleSideArm(hingeRight, placement.rightEar, 'right', showRightArm)}
          </svg>
        )}

        {/* Soft nasal & cheek skin-contact drop shadow */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: cx - gw * 0.22 + shadowOffsetX,
            top: cy + gh * 0.04,
            width: gw * 0.44,
            height: gh * 0.36,
            transform: `rotate(${rollDeg.toFixed(2)}deg)`,
            background: `radial-gradient(ellipse at center, rgba(0,0,0,${shadowAlpha.toFixed(2)}) 0%, rgba(0,0,0,${(shadowAlpha * 0.4).toFixed(2)}) 55%, transparent 100%)`,
            filter: 'blur(5px)',
          }}
        />

        {angleLayers.map(({ img: layerImg, weight }, idx) => {
          const residualYaw = Math.abs(layerImg.angleYaw) > 20 ? (yaw - layerImg.angleYaw) * 0.35 : yaw * 0.88;
          return (
            <div
              key={`${layerImg.id}-${idx}`}
              className="absolute pointer-events-none"
              style={{
                left: cx - gw / 2,
                top: cy - gh / 2,
                width: gw,
                height: gh,
                opacity: weight,
                transform: `perspective(720px) rotateZ(${rollDeg.toFixed(2)}deg) rotateY(${residualYaw.toFixed(2)}deg) rotateX(${(-pitch * 0.65).toFixed(2)}deg)`,
                transformOrigin: 'center center',
                filter: `drop-shadow(${shadowOffsetX.toFixed(1)}px 6px 8px rgba(0,0,0,0.36)) drop-shadow(0 2px 3px rgba(0,0,0,0.22))${ambientFilter}`,
              }}
            >
              {layerImg.lensMaskUrl && (
                <>
                  {product.cat === 'sun' && (
                    <div
                      className="absolute inset-0 z-[1]"
                      style={{
                        background: `linear-gradient(180deg, ${lensColor}aa, ${lensColor}66)`,
                        opacity: 0.56,
                        WebkitMaskImage: `url(${layerImg.lensMaskUrl})`,
                        maskImage: `url(${layerImg.lensMaskUrl})`,
                        WebkitMaskSize: 'contain',
                        maskSize: 'contain',
                        WebkitMaskPosition: 'center',
                        maskPosition: 'center',
                        WebkitMaskRepeat: 'no-repeat',
                        maskRepeat: 'no-repeat',
                        mixBlendMode: 'multiply',
                      }}
                    />
                  )}
                  <div
                    className="absolute inset-0 z-[3]"
                    style={{
                      background: `linear-gradient(${115 + yaw * 0.7}deg, transparent ${Math.max(4, glintPercent - 26)}%, ${coat.secondary} ${glintPercent - 6}%, ${coat.color} ${glintPercent + 6}%, transparent ${Math.min(96, glintPercent + 26)}%)`,
                      opacity: coatingId === 'ar' || coatingId === 'bluecut' || coatingId === 'bluectrl' ? 0.16 : 0.09,
                      WebkitMaskImage: `url(${layerImg.lensMaskUrl})`,
                      maskImage: `url(${layerImg.lensMaskUrl})`,
                      WebkitMaskSize: 'contain',
                      maskSize: 'contain',
                      WebkitMaskPosition: 'center',
                      maskPosition: 'center',
                      WebkitMaskRepeat: 'no-repeat',
                      maskRepeat: 'no-repeat',
                      mixBlendMode: 'screen',
                    }}
                  />
                </>
              )}
              <img
                src={layerImg.imageUrl}
                alt={product.name}
                crossOrigin="anonymous"
                className="w-full h-full object-contain relative z-[2]"
              />
            </div>
          );
        })}
      </>
    );
  }

  // Template SVG Glasses fallback (when product uses a built-in frame template)
  const svgW = (gw / cosYaw) * (230 / 168);
  const svgH = svgW * (88 / 230);

  return (
    <>
      {placement.leftEar && placement.rightEar && (showLeftArm || showRightArm) && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${stageW} ${stageH}`}
        >
          <defs>
            <mask id={maskId}>
              <rect x="0" y="0" width={stageW} height={stageH} fill="white" />
              {placement.occluderPolygon && <polygon points={placement.occluderPolygon} fill="black" />}
            </mask>
          </defs>
          {renderVisibleSideArm(hingeLeft, placement.leftEar, 'left', showLeftArm)}
          {renderVisibleSideArm(hingeRight, placement.rightEar, 'right', showRightArm)}
        </svg>
      )}
      <div
        className="absolute pointer-events-none"
        style={{
          left: cx - svgW / 2,
          top: cy - svgH * (33 / 88),
          width: svgW,
          height: svgH,
          transform: `perspective(720px) rotateZ(${rollDeg.toFixed(2)}deg) rotateY(${(yaw * 0.88).toFixed(2)}deg) rotateX(${(-pitch * 0.65).toFixed(2)}deg)`,
          transformOrigin: 'center 37%',
          filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.36)) drop-shadow(0 2px 3px rgba(0,0,0,0.22))',
        }}
      >
        <svg ref={svgRef} viewBox="-115 -33 230 88" className="w-full h-full overflow-visible">
          <Glasses
            type={product.type}
            frame={frameColor}
            lens={lensColor}
            isSun={product.cat === 'sun'}
            coatingId={coatingId}
            yaw={yaw}
            pitch={pitch}
            castShadow={false}
            hideTemples
          />
        </svg>
      </div>
    </>
  );
}

function formatCameraError(err: unknown): { title: string; detail: string } {
  const e = err as { name?: string; message?: string };
  const name = e?.name || '';
  const msg = (e?.message || '').toLowerCase();

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || msg.includes('permission')) {
    return {
      title: 'تعذر تشغيل الكاميرا الآن',
      detail: 'اسمح بالوصول للكاميرا من المتصفح، أو ارفع صورة شخصية واضحة لوجهك لتجربة النظارة فوراً.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      title: 'الكاميرا غير متوفرة على هذا الجهاز',
      detail: 'يمكنك تجربة النظارة فوراً برفع صورة شخصية واضحة لوجهك.',
    };
  }
  return {
    title: 'تعذّر فتح الكاميرا',
    detail: 'يمكنك التجربة فوراً برفع صورة شخصية واضحة لوجهك.',
  };
}

export function FaceTryOnStage({
  product,
  products,
  onSelectProduct,
  onOrderProduct,
  onRxAttached,
  initialRxUrl,
  compareProduct,
  splitMode = false,
  frameColor,
  lensColor,
  frameSize = 'Medium',
  coatingId = 'ar',
  faceShape,
  onFaceShapeDetected,
  onPdDetected,
  camOn,
  onStartCam,
  onModeChange,
  yawManual = 0,
  onYawManualChange,
  showLauncherWhenIdle = false,
}: FaceTryOnStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const compareVideoRef = useRef<HTMLVideoElement | null>(null);
  const fullStageRef = useRef<HTMLDivElement | null>(null);
  const fullHalfStageRef = useRef<HTMLDivElement | null>(null);
  const inlineStageRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const smootherRef = useRef<FaceTrackingSmoother>(new FaceTrackingSmoother());
  const lastEmittedShapeRef = useRef<FaceShape | null>(null);
  const lastEmittedPdRef = useRef<number | null>(null);
  const lastPdEmitMsRef = useRef<number>(0);
  const lastLightProbeMsRef = useRef<number>(0);
  const mainSvgRef = useRef<SVGSVGElement | null>(null);
  const ar3dRef = useRef<Eyewear3DARHandle | null>(null);
  const videoTryOnRef = useRef<VideoTryOnHandle | null>(null);
  const deviceCaps = useDeviceCapabilities();
  const [liveLighting, setLiveLighting] = useState<FaceLightingEstimate | undefined>(undefined);
  const [photoLighting, setPhotoLighting] = useState<FaceLightingEstimate | undefined>(undefined);

  const inlineDragRef = useRef<{ active: boolean; startX: number; baseYaw: number }>({
    active: false,
    startX: 0,
    baseYaw: 0,
  });
  const [halfStageSize, setHalfStageSize] = useState({ w: 220, h: 640 });

  const [fullscreen, setFullscreen] = useState(false);
  const [photoCanvasModalOpen, setPhotoCanvasModalOpen] = useState(false);
  const [mode, setMode] = useState<TryOnMode>('camera');
  const [camStatus, setCamStatus] = useState<'idle' | 'starting' | 'streaming' | 'error'>('idle');
  const [camError, setCamError] = useState<{ title: string; detail: string } | null>(null);
  const [stageSize, setStageSize] = useState({ w: 420, h: 640 });
  const [inlineSize, setInlineSize] = useState({ w: 420, h: 420 });
  const [frontAspect, setFrontAspect] = useState<number>(0.41);

  // Screenshot capture preview state
  const [flashActive, setFlashActive] = useState(false);
  const [shotBusy, setShotBusy] = useState(false);
  const [capturedShot, setCapturedShot] = useState<{ url: string; blob: Blob } | null>(null);
  const [shotToast, setShotToast] = useState<string | null>(null);

  // Uploaded / Photo try-on state (when user picks a photo instead of live stream)
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [photoNaturalSize, setPhotoNaturalSize] = useState({ w: 600, h: 720 });
  const [photoTracking, setPhotoTracking] = useState<FaceTrackingFrame | null>(null);
  const [manualTransform, setManualTransform] = useState<PhotoManualTransform>({
    dx: 0,
    dy: 0,
    scale: 1,
    rotDeg: 0,
  });

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    type: 'none' | 'drag' | 'pinch';
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
    startDist: number;
    startAngle: number;
    startMidX: number;
    startMidY: number;
    baseScale: number;
    baseRot: number;
  }>({
    type: 'none',
    startX: 0,
    startY: 0,
    baseDx: 0,
    baseDy: 0,
    startDist: 1,
    startAngle: 0,
    startMidX: 0,
    startMidY: 0,
    baseScale: 1,
    baseRot: 0,
  });

  const carouselItems = products && products.length > 0 ? products : [product];
  const frontImgOf = (p: Product): ProductImage | undefined => {
    const tryOnUrl = resolveTryOnFrontUrl(p);
    const matching = p.images?.find((im) => im.kind === 'front_tryon' || Math.abs(im.angleYaw) <= 15) || p.images?.[0];
    if (tryOnUrl) {
      return {
        ...(matching || {
          id: 'tryon-' + p.id,
          productId: p.id,
          angleYaw: 0,
          label: 'أمامية للتجربة',
          kind: 'front_tryon' as const,
          sortOrder: 0,
        }),
        imageUrl: tryOnUrl,
      };
    }
    return matching;
  };
  const sideImgOf = (p: Product): ProductImage | undefined =>
    p.images?.find((im) => Math.abs(im.angleYaw) >= 60);

  const mainFrontImg = frontImgOf(product);
  const mainSideImg = sideImgOf(product);

  // Measure real aspect ratio of front glasses cutout PNG so dimensions never distort
  useEffect(() => {
    if (!mainFrontImg?.imageUrl) {
      setFrontAspect(0.41);
      return;
    }
    let cancelled = false;
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      if (!cancelled && im.naturalWidth > 0 && im.naturalHeight > 0) {
        setFrontAspect(im.naturalHeight / im.naturalWidth);
      }
    };
    im.src = mainFrontImg.imageUrl;
    return () => {
      cancelled = true;
    };
  }, [mainFrontImg?.imageUrl]);

  const stopLiveCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    smootherRef.current.reset();
    setCamStatus('idle');
    setLiveLighting(undefined);
  }, []);

  const attachStreamToVideo = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    if (compareVideoRef.current && compareVideoRef.current.srcObject !== stream) {
      compareVideoRef.current.srcObject = stream;
      compareVideoRef.current.play().catch(() => {});
    }
  }, []);

  const openAndroidFriendlyStream = async (): Promise<MediaStream> => {
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: 'user' }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr: unknown;
    for (const c of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(c);
      } catch (err) {
        lastErr = err;
        const errName = (err as { name?: string })?.name || '';
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') throw err;
      }
    }
    throw lastErr;
  };

  const handleLandmarksFrame = useCallback(
    (pts: { x: number; y: number; z: number }[] | null) => {
      if (!pts) {
        return;
      }
      const now = performance.now();
      if (now - lastLightProbeMsRef.current < 450) return;
      lastLightProbeMsRef.current = now;

      const raw = extractTrackingFromLandmarks(pts);
      const smoothed = smootherRef.current.smooth(raw, now);

      if (videoRef.current && videoRef.current.videoWidth > 0) {
        setLiveLighting(
          analyzeFaceLighting(
            videoRef.current,
            { x: smoothed.noseBridge.x, y: smoothed.noseBridge.y },
            smoothed.eyeDistance * 1.9
          )
        );
      }

      if (lastEmittedShapeRef.current !== smoothed.faceShape) {
        lastEmittedShapeRef.current = smoothed.faceShape;
        onFaceShapeDetected(smoothed.faceShape);
      }
      void onPdDetected;
      void lastEmittedPdRef;
      void lastPdEmitMsRef;
    },
    [onFaceShapeDetected, onPdDetected]
  );

  const startLiveCamera = useCallback(async () => {
    stopLiveCamera();
    setFullscreen(true);
    setMode('camera');
    onModeChange?.('camera');
    onStartCam();
    setCamError(null);
    setCamStatus('starting');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCamError(formatCameraError(new Error('getUserMedia unsupported')));
      setCamStatus('error');
      return;
    }

    try {
      const stream = await openAndroidFriendlyStream();
      streamRef.current = stream;
      setCamStatus('streaming');
      attachStreamToVideo();
      requestAnimationFrame(attachStreamToVideo);
    } catch (err) {
      setCamError(formatCameraError(err));
      setCamStatus('error');
    }
  }, [attachStreamToVideo, onModeChange, onStartCam, stopLiveCamera]);

  // Allow external trigger (e.g. clicking "جرّب" button in product catalog or PDP)
  useEffect(() => {
    if (camOn && !fullscreen && camStatus === 'idle') {
      startLiveCamera();
    }
  }, [camOn, camStatus, fullscreen, startLiveCamera]);

  const closeFullscreen = useCallback(() => {
    stopLiveCamera();
    setFullscreen(false);
    setCapturedShot((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    onModeChange?.('photo');
  }, [onModeChange, stopLiveCamera]);

  const handleGalleryUpload = useCallback(
    async (file: File) => {
      stopLiveCamera();
      setFullscreen(true);
      setMode('photo');
      onModeChange?.('photo');

      const dataUrl = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.readAsDataURL(file);
      });
      if (!dataUrl) return;

      setPhotoSrc(dataUrl);
      setPhotoTracking(null);
      setPhotoLighting(undefined);
      setManualTransform({ dx: 0, dy: 0, scale: 1, rotDeg: 0 });

      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((res) => {
        img.onload = () => res();
        img.onerror = () => res();
        img.src = dataUrl;
      });
      const nw = img.naturalWidth || 600;
      const nh = img.naturalHeight || 720;
      setPhotoNaturalSize({ w: nw, h: nh });

      let detectedFace: FaceTrackingFrame | null = null;
      try {
        const { detectFaceOnImage } = await import('../utils/faceTracker');
        detectedFace = await detectFaceOnImage(img);
        if (detectedFace) {
          setPhotoTracking(detectedFace);
          onFaceShapeDetected(detectedFace.faceShape);
        }
      } catch {
        // user can drag/pinch adjust
      }

      setPhotoLighting(
        analyzeFaceLighting(
          img,
          detectedFace ? { x: detectedFace.noseBridge.x, y: detectedFace.noseBridge.y } : undefined,
          detectedFace ? detectedFace.eyeDistance * 1.9 : undefined
        )
      );
    },
    [onFaceShapeDetected, onModeChange, stopLiveCamera]
  );

  useEffect(() => {
    if (mode === 'camera' && camStatus === 'streaming') {
      attachStreamToVideo();
    }
  }, [mode, camStatus, fullscreen, splitMode, attachStreamToVideo]);

  useEffect(() => {
    const updateSizes = () => {
      if (fullStageRef.current) {
        const r = fullStageRef.current.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) setStageSize({ w: r.width, h: r.height });
      }
      if (fullHalfStageRef.current) {
        const r = fullHalfStageRef.current.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) setHalfStageSize({ w: r.width, h: r.height });
      }
      if (inlineStageRef.current) {
        const r = inlineStageRef.current.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) setInlineSize({ w: r.width, h: r.height });
      }
    };
    updateSizes();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateSizes);
      if (fullStageRef.current) ro.observe(fullStageRef.current);
      if (fullHalfStageRef.current) ro.observe(fullHalfStageRef.current);
      if (inlineStageRef.current) ro.observe(inlineStageRef.current);
    }
    window.addEventListener('resize', updateSizes);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateSizes);
    };
  }, [fullscreen, mode, camStatus, photoSrc, splitMode]);

  useEffect(() => {
    return () => {
      stopLiveCamera();
    };
  }, [stopLiveCamera]);

  const activeStageW = splitMode && compareProduct ? halfStageSize.w : stageSize.w;
  const activeStageH = splitMode && compareProduct ? halfStageSize.h : stageSize.h;

  const isProduct3D = (p: Product) =>
    Boolean((p.glbUrl || p.model3dUrl || '').trim());

  const mainIs3D = isProduct3D(product);
  const activeFrameWidthMm = resolveProductOpticalDimensions(product).totalFrameWidthMm;
  const activeAspectRatio = product.modelCalibration?.aspectRatio || frontAspect;
  const activeFitScale = product.modelCalibration?.fitScale ?? 1.0;
  const activeEyeLineOffset = product.modelCalibration?.eyeLineOffset ?? 0.04;

  const photoBasePlacement = useMemo<Metric3DPlacement>(() => {
    const bw = activeStageW;
    const bh = activeStageH;
    if (photoTracking) {
      const p = computeMetric3DPlacement(
        photoTracking,
        (nx, ny) => mapContainPoint(nx, ny, photoNaturalSize.w, photoNaturalSize.h, bw, bh),
        activeFrameWidthMm,
        frameSize,
        activeAspectRatio
      );
      const scaledW = p.glassesWidth * activeFitScale;
      const scaledH = scaledW * activeAspectRatio;
      return {
        ...p,
        glassesWidth: scaledW,
        glassesHeight: scaledH,
        cy: p.cy + scaledH * activeEyeLineOffset,
      };
    }
    const defaultW = Math.min(bw, bh) * 0.46 * (FRAME_SIZE_SCALE[frameSize] ?? 1.0) * activeFitScale;
    const defaultH = defaultW * activeAspectRatio;
    return {
      cx: bw / 2,
      cy: bh * 0.42 + defaultH * activeEyeLineOffset,
      glassesWidth: defaultW,
      glassesHeight: defaultH,
      rollDeg: 0,
      screenYawDeg: 0,
      yawDeg: 0,
      pitchDeg: 0,
      eyeDistPx: defaultW / 2.34,
      pxPerMm: defaultW / activeFrameWidthMm,
      frameWidthMm: activeFrameWidthMm,
      cheekSpanPx: defaultW * 0.96,
      bridgePx: { x: bw / 2, y: bh * 0.42 },
    };
  }, [
    activeAspectRatio,
    activeEyeLineOffset,
    activeFitScale,
    activeFrameWidthMm,
    frameSize,
    photoNaturalSize.h,
    photoNaturalSize.w,
    photoTracking,
    activeStageH,
    activeStageW,
  ]);

  // Multi-touch pointer handlers for Photo mode
  const beginGestureFromPointers = (map: Map<number, { x: number; y: number }>, cur: PhotoManualTransform) => {
    const pts = Array.from(map.values());
    if (pts.length === 1) {
      gestureRef.current = {
        ...gestureRef.current,
        type: 'drag',
        startX: pts[0].x,
        startY: pts[0].y,
        baseDx: cur.dx,
        baseDy: cur.dy,
      };
    } else if (pts.length >= 2) {
      const dist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * (180 / Math.PI);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      gestureRef.current = {
        type: 'pinch',
        startX: midX,
        startY: midY,
        baseDx: cur.dx,
        baseDy: cur.dy,
        startDist: dist,
        startAngle: angle,
        startMidX: midX,
        startMidY: midY,
        baseScale: cur.scale,
        baseRot: cur.rotDeg,
      };
    }
  };

  const handlePhotoPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!photoSrc) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGestureFromPointers(pointersRef.current, manualTransform);
  };

  const handlePhotoPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointersRef.current.values());
    const g = gestureRef.current;

    if (g.type === 'drag' && pts.length === 1) {
      setManualTransform((prev) => ({
        ...prev,
        dx: g.baseDx + (pts[0].x - g.startX),
        dy: g.baseDy + (pts[0].y - g.startY),
      }));
    } else if (g.type === 'pinch' && pts.length >= 2) {
      const dist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * (180 / Math.PI);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;

      let dAngle = angle - g.startAngle;
      if (dAngle > 180) dAngle -= 360;
      if (dAngle < -180) dAngle += 360;

      setManualTransform({
        dx: g.baseDx + (midX - g.startMidX),
        dy: g.baseDy + (midY - g.startMidY),
        scale: Math.max(0.42, Math.min(2.4, g.baseScale * (dist / g.startDist))),
        rotDeg: Math.max(-45, Math.min(45, g.baseRot + dAngle)),
      });
    }
  };

  const handlePhotoPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) gestureRef.current.type = 'none';
    else beginGestureFromPointers(pointersRef.current, manualTransform);
  };

  // High-Res Screenshot Composite Builder (works seamlessly in both Live Camera & Photo mode)
  const captureTryOnComposite = async (openPreview = true): Promise<{ url: string; blob: Blob } | null> => {
    if (shotBusy) return null;
    setShotBusy(true);
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 160);

    try {
      const dpr = Math.min(2, window.devicePixelRatio || 1.5);
      const outW = Math.max(480, Math.round(stageSize.w * dpr));
      const outH = Math.max(640, Math.round(stageSize.h * dpr));
      const out = document.createElement('canvas');
      out.width = outW;
      out.height = outH;
      const ctx = out.getContext('2d')!;

      let activePlacement: PlacementGeometry;
      let tDx = 0;
      let tDy = 0;
      let tScale = 1;
      let tRot = 0;

      if (mode === 'camera' && videoRef.current && videoRef.current.videoWidth > 0) {
        const v = videoRef.current;
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        const scaleCover = Math.max(outW / vw, outH / vh);
        const rw = vw * scaleCover;
        const rh = vh * scaleCover;
        const ox = (outW - rw) / 2;
        const oy = (outH - rh) / 2;
        const liveCanvas = videoTryOnRef.current?.renderNow() || null;

        ctx.save();
        ctx.translate(outW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(v, outW - (ox + rw), oy, rw, rh);
        if (liveCanvas && liveCanvas.width > 0 && liveCanvas.height > 0) {
          ctx.drawImage(liveCanvas, outW - (ox + rw), oy, rw, rh);
        }
        ctx.restore();

        const blob = await new Promise<Blob | null>((resolve) => out.toBlob((b) => resolve(b), 'image/png', 0.96));
        if (blob) {
          const url = URL.createObjectURL(blob);
          const shot = { url, blob };
          if (openPreview) {
            setCapturedShot((prev) => {
              if (prev) URL.revokeObjectURL(prev.url);
              return shot;
            });
            setShotToast(null);
          }
          return shot;
        }
        return null;
      } else if (mode === 'photo' && photoSrc) {
        const baseImg = new Image();
        baseImg.crossOrigin = 'anonymous';
        await new Promise<void>((res) => {
          baseImg.onload = () => res();
          baseImg.onerror = () => res();
          baseImg.src = photoSrc;
        });
        ctx.fillStyle = '#050911';
        ctx.fillRect(0, 0, outW, outH);
        const cr = getContainRect(outW, outH, baseImg.naturalWidth || 600, baseImg.naturalHeight || 720);
        ctx.drawImage(baseImg, cr.x, cr.y, cr.w, cr.h);

        activePlacement = photoBasePlacement;
        tDx = manualTransform.dx;
        tDy = manualTransform.dy;
        tScale = manualTransform.scale;
        tRot = manualTransform.rotDeg;
      } else {
        return null;
      }

      const capturedWebgl = mainIs3D ? ar3dRef.current?.renderAndCapture() : null;
      if (capturedWebgl && capturedWebgl.width > 0 && capturedWebgl.height > 0) {
        ctx.drawImage(capturedWebgl, 0, 0, outW, outH);
      } else {
      ctx.save();
      ctx.scale(dpr, dpr);

      const cx = activePlacement.cx + tDx;
      const cy = activePlacement.cy + tDy;
      const gw = activePlacement.glassesWidth * tScale;
      const gh = activePlacement.glassesHeight * tScale;
      const rollDeg = activePlacement.rollDeg + tRot;
      const yaw = activePlacement.screenYawDeg;
      const cosYaw = Math.max(0.55, Math.cos((yaw * Math.PI) / 180));

      // Draw exposed side temple arm (with head contour occlusion) when head is turned >= 12°
      const showLeftArm = yaw >= 12;
      const showRightArm = yaw <= -12;
      if ((showLeftArm || showRightArm) && activePlacement.leftEar && activePlacement.rightEar && mainSideImg) {
        const sideImgEl = new Image();
        sideImgEl.crossOrigin = 'anonymous';
        await new Promise<void>((res) => {
          sideImgEl.onload = () => res();
          sideImgEl.onerror = () => res();
          sideImgEl.src = mainSideImg.imageUrl;
        });

        const rollRad = (rollDeg * Math.PI) / 180;
        const rotC = Math.cos(rollRad);
        const rotS = Math.sin(rollRad);
        const halfProjectedW = (gw * cosYaw) / 2;
        const hingeYOffset = -gh * 0.14;
        const hinge = showLeftArm
          ? {
              x: cx + -halfProjectedW * 0.92 * rotC - hingeYOffset * rotS,
              y: cy + -halfProjectedW * 0.92 * rotS + hingeYOffset * rotC,
            }
          : {
              x: cx + halfProjectedW * 0.92 * rotC - hingeYOffset * rotS,
              y: cy + halfProjectedW * 0.92 * rotS + hingeYOffset * rotC,
            };
        const ear = showLeftArm ? activePlacement.leftEar : activePlacement.rightEar;
        const vecX = ear.x - hinge.x;
        const vecY = ear.y - hinge.y;
        const armLen = Math.max(18, Math.hypot(vecX, vecY) * 1.06);
        const armH = Math.max(14, gh * 0.46);
        const anchorY = armH * 0.34;

        ctx.save();
        if (activePlacement.contourScreenPoints && activePlacement.contourScreenPoints.length > 5) {
          ctx.beginPath();
          ctx.rect(0, 0, stageSize.w, stageSize.h);
          const pts = activePlacement.contourScreenPoints;
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.clip('evenodd');
        }
        ctx.globalAlpha = Math.min(0.96, Math.max(0.25, (Math.abs(yaw) - 3.5) / 12));
        ctx.shadowColor = 'rgba(0,0,0,0.34)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 3;
        ctx.translate(hinge.x, hinge.y);
        if (showRightArm) {
          ctx.rotate(Math.atan2(vecY, vecX));
        } else {
          ctx.rotate(Math.atan2(-vecY, -vecX));
          ctx.scale(-1, 1);
        }
        ctx.drawImage(sideImgEl, -armLen * 0.04, -anchorY, armLen, armH);
        ctx.restore();
      }

      // Soft nasal contact shadow adaptive to facial illumination
      const activeShotShadow = photoLighting?.shadowAlpha ?? 0.28;
      ctx.save();
      ctx.translate(cx, cy + gh * 0.16);
      ctx.rotate((rollDeg * Math.PI) / 180);
      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, gw * 0.22);
      grad.addColorStop(0, `rgba(0,0,0,${activeShotShadow.toFixed(2)})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, gw * 0.22, gh * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Front glasses frame (with foreshortening & soft drop shadow)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rollDeg * Math.PI) / 180);
      ctx.scale(cosYaw, 1);
      ctx.shadowColor = 'rgba(0,0,0,0.36)';
      ctx.shadowBlur = Math.max(8, gw * 0.032);
      ctx.shadowOffsetY = Math.max(5, gw * 0.018);

      if (mainFrontImg) {
        const gImg = new Image();
        gImg.crossOrigin = 'anonymous';
        await new Promise<void>((res) => {
          gImg.onload = () => res();
          gImg.onerror = () => res();
          gImg.src = mainFrontImg.imageUrl;
        });

        if (product.cat === 'sun' && mainFrontImg.lensMaskUrl) {
          const mImg = new Image();
          mImg.crossOrigin = 'anonymous';
          await new Promise<void>((res) => {
            mImg.onload = () => res();
            mImg.onerror = () => res();
            mImg.src = mainFrontImg.lensMaskUrl!;
          });
          const tc = document.createElement('canvas');
          tc.width = Math.max(1, Math.round(gw));
          tc.height = Math.max(1, Math.round(gh));
          const tCtx = tc.getContext('2d')!;
          tCtx.drawImage(mImg, 0, 0, tc.width, tc.height);
          tCtx.globalCompositeOperation = 'source-in';
          tCtx.fillStyle = lensColor || '#334155';
          tCtx.globalAlpha = 0.54;
          tCtx.fillRect(0, 0, tc.width, tc.height);
          ctx.drawImage(tc, -gw / 2, -gh / 2, gw, gh);
        }
        ctx.drawImage(gImg, -gw / 2, -gh / 2, gw, gh);
      } else if (mainSvgRef.current) {
        const xml = new XMLSerializer().serializeToString(mainSvgRef.current);
        const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);
        const svgImg = new Image();
        await new Promise<void>((res) => {
          svgImg.onload = () => res();
          svgImg.onerror = () => res();
          svgImg.src = svgUrl;
        });
        const svgW = (gw / cosYaw) * (230 / 168);
        const svgH = svgW * (88 / 230);
        ctx.drawImage(svgImg, -svgW / 2, -svgH * (33 / 88), svgW, svgH);
        URL.revokeObjectURL(svgUrl);
      }

      ctx.restore();
      ctx.restore();
      }

      const blob = await new Promise<Blob | null>((resolve) => out.toBlob((b) => resolve(b), 'image/png', 0.96));
      if (blob) {
        const url = URL.createObjectURL(blob);
        const shot = { url, blob };
        if (openPreview) {
          setCapturedShot((prev) => {
            if (prev) URL.revokeObjectURL(prev.url);
            return shot;
          });
          setShotToast(null);
        }
        return shot;
      }
      return null;
    } finally {
      setShotBusy(false);
    }
  };

  const captureTryOnScreenshot = async () => {
    await captureTryOnComposite(true);
  };

  const handleSaveScreenshot = (shotArg?: { url: string; blob: Blob }) => {
    const targetShot = shotArg || capturedShot;
    if (!targetShot) return;
    const a = document.createElement('a');
    a.href = targetShot.url;
    a.download = `optiverse-${product.code || 'tryon'}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setShotToast('تم حفظ الصورة في جهازك ✓');
  };

  const buildShareTextAndUrl = () => {
    const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
    const text = `شوف نظارة "${product.name}" عليّ بالكاميرا 3D — ما رأيك؟ 👓${pageUrl ? `\n${pageUrl}` : ''}`;
    return { text, pageUrl };
  };

  const shareShotWithFriends = async (shotArg?: { url: string; blob: Blob }) => {
    const targetShot = shotArg || capturedShot;
    if (!targetShot) return;
    const { text, pageUrl } = buildShareTextAndUrl();
    try {
      const file = new File([targetShot.blob], `optiverse-${product.code || 'tryon'}.png`, {
        type: 'image/png',
      });
      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: product.name,
          text,
        });
        recordStoreFriendShare(product.shopId);
        setShotToast('تمت المشاركة مع أصدقائك ✓');
        return;
      }
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: product.name,
          text,
          ...(pageUrl ? { url: pageUrl } : {}),
        });
        recordStoreFriendShare(product.shopId);
        setShotToast('تمت المشاركة مع أصدقائك ✓');
        return;
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        return;
      }
    }
    // Fallback when native Web Share API is unavailable: keep user in camera and open preview + WhatsApp share
    setCapturedShot((prev) => {
      if (prev && prev.url !== targetShot.url) URL.revokeObjectURL(prev.url);
      return targetShot;
    });
    setShotToast('الصورة جاهزة! اضغط على واتساب أو حفظ للمشاركة مع أصدقائك 📤');
  };

  const handleQuickShareFromCamera = async () => {
    const shot = await captureTryOnComposite(false);
    if (!shot) return;
    setCapturedShot((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return shot;
    });
    await shareShotWithFriends(shot);
  };

  const handleShareScreenshot = async () => {
    await shareShotWithFriends();
  };

  const showSplit = Boolean(splitMode && compareProduct && compareProduct.id !== product.id);
  const cmpFrontImg = compareProduct ? frontImgOf(compareProduct) : undefined;
  const cmpSideImg = compareProduct ? sideImgOf(compareProduct) : undefined;

  // Direct real-face try-on only: no static dummy model portrait is rendered outside LandingPage
  if (!fullscreen) {
    return (
      <>
        {showLauncherWhenIdle && (
          <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-4 flex flex-col items-center gap-2.5">
            <div className="text-xs font-extrabold text-[#0F172A]">
              اختر طريقة المعاينة المباشرة على وجهك الحقيقي:
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
              <button
                type="button"
                onClick={startLiveCamera}
                className="btn bg-[#0284C7] hover:bg-[#0369A1] text-white !px-2.5 !py-2.5 shadow-sm text-xs sm:text-sm font-bold justify-center whitespace-nowrap active:scale-[0.97] transition-transform duration-150"
              >
                <I n="camera" s={15} />{' '}
                <span>
                  الكاميرا الحية <span dir="ltr">3D</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPhotoCanvasModalOpen(true)}
                className="px-2.5 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-[#0F172A] border border-[#E2E8F0] shadow-sm text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap active:scale-[0.97] transition-transform duration-150"
              >
                <I n="upload" s={15} /> <span>جرّب على صورتك</span>
              </button>
            </div>
            <label className="text-xs font-bold text-[#0F172A] hover:text-[#0284C7] bg-white px-3.5 py-1 rounded-full border border-[#E2E8F0] shadow-sm cursor-pointer whitespace-nowrap">
              أو ارفع صورة سريعاً
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) handleGalleryUpload(f);
                }}
              />
            </label>
            <p className="text-[0.7rem] text-slate-600 text-center leading-5 pt-0.5">
              🔒 خصوصيتك محمية: الكاميرا تعمل لحظياً على جهازك فقط ولا يتم التقاط أو حفظ أي صور.
            </p>
          </div>
        )}

        {photoCanvasModalOpen && (
          <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto flex items-center justify-center">
            <div className="w-full max-w-2xl my-auto">
              <CustomerPhotoTryOn
                product={product}
                initialSubMode="tryon"
                initialRxUrl={initialRxUrl}
                onRxAttached={onRxAttached}
                onOrderProduct={(pid) => {
                  setPhotoCanvasModalOpen(false);
                  onOrderProduct?.(pid);
                }}
                onClose={() => setPhotoCanvasModalOpen(false)}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  // FULL-SCREEN CLEAN AI VIRTUAL TRY-ON EXPERIENCE
  return (
    <div ref={fullStageRef} className="fixed inset-0 z-[85] h-[100dvh] bg-black overflow-hidden select-none flex flex-col">
      {/* Main Full-Screen Camera or Photo Canvas */}
      {mode === 'camera' ? (
        <div className="relative flex-1 min-h-0 w-full overflow-hidden flex items-center justify-center bg-black">
          {showSplit && compareProduct ? (
            <div className="grid grid-cols-2 w-full h-full divide-x divide-x-reverse divide-white/25">
              <div ref={fullHalfStageRef} className="relative w-full h-full overflow-hidden flex items-center justify-center">
                <div className="relative w-full h-full overflow-hidden">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="absolute inset-0 w-full h-full object-cover z-0"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  <VideoTryOnCanvas
                    ref={videoTryOnRef}
                    videoRef={videoRef}
                    product={product}
                    frontImageUrl={mainFrontImg?.imageUrl}
                    glbUrl={product.glbUrl || product.model3dUrl}
                    frameSize={frameSize}
                    active={camStatus === 'streaming'}
                    onLandmarksFrame={handleLandmarksFrame}
                    showDebugBadge={true}
                  />
                </div>
                <div className="absolute top-16 inset-x-2 z-20 flex justify-center pointer-events-none">
                  <span className="px-2.5 py-0.5 rounded-full bg-black/65 border border-white/15 text-xs font-bold text-white truncate">
                    {product.name}
                  </span>
                </div>
              </div>
              <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
                <div className="relative w-full h-full overflow-hidden">
                  <video
                    ref={compareVideoRef}
                    playsInline
                    muted
                    autoPlay
                    className="absolute inset-0 w-full h-full object-cover z-0"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  <VideoTryOnCanvas
                    videoRef={compareVideoRef}
                    product={compareProduct}
                    frontImageUrl={cmpFrontImg?.imageUrl}
                    glbUrl={compareProduct.glbUrl || compareProduct.model3dUrl}
                    frameSize={frameSize}
                    active={camStatus === 'streaming'}
                    showDebugBadge={false}
                  />
                </div>
                <div className="absolute top-16 inset-x-2 z-20 flex justify-center pointer-events-none">
                  <span className="px-2.5 py-0.5 rounded-full bg-black/65 border border-white/15 text-xs font-bold text-white truncate">
                    {compareProduct.name}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative w-full h-full overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="absolute inset-0 w-full h-full object-cover z-0"
                style={{ transform: 'scaleX(-1)' }}
              />
              <VideoTryOnCanvas
                ref={videoTryOnRef}
                videoRef={videoRef}
                product={product}
                frontImageUrl={mainFrontImg?.imageUrl}
                glbUrl={product.glbUrl || product.model3dUrl}
                frameSize={frameSize}
                active={camStatus === 'streaming'}
                onLandmarksFrame={handleLandmarksFrame}
                showDebugBadge={true}
                carouselProducts={carouselItems}
                onSelectProduct={onSelectProduct}
                onCaptureShot={captureTryOnScreenshot}
                onQuickShare={handleQuickShareFromCamera}
                onOrderProduct={
                  onOrderProduct
                    ? (pid) => {
                        onOrderProduct(pid);
                        closeFullscreen();
                      }
                    : undefined
                }
                shotBusy={shotBusy}
                showControlsOverlay={true}
              />
            </div>
          )}

          {camStatus === 'starting' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center p-6 bg-black/80 gap-3">
              <span className="w-16 h-16 rounded-full b-acc flex items-center justify-center">
                <I n="camera" s={30} />
              </span>
              <div className="font-bold text-base">جاري تشغيل الكاميرا...</div>
            </div>
          )}

          {camStatus === 'error' && camError && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center p-6 bg-black/90 gap-3">
              <div className="font-extrabold text-lg text-white">{camError.title}</div>
              <p className="text-sm text-white/80 max-w-sm leading-6">{camError.detail}</p>
              <div className="flex flex-wrap gap-2.5 justify-center mt-2">
                <label className="btn btn-p cursor-pointer">
                  <I n="upload" s={15} /> رفع صورة شخصية للتجربة
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) handleGalleryUpload(f);
                    }}
                  />
                </label>
                <button type="button" className="btn btn-g" onClick={startLiveCamera}>
                  <I n="refresh" s={15} /> إعادة محاولة الكاميرا
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          className="relative flex-1 min-h-0 w-full touch-none cursor-move overflow-hidden bg-slate-950"
          onPointerDown={handlePhotoPointerDown}
          onPointerMove={handlePhotoPointerMove}
          onPointerUp={handlePhotoPointerUp}
          onPointerCancel={handlePhotoPointerUp}
          onWheel={(e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.06 : 0.94;
            setManualTransform((prev) => ({
              ...prev,
              scale: Math.max(0.42, Math.min(2.4, prev.scale * factor)),
            }));
          }}
        >
          {photoSrc && showSplit && compareProduct ? (
            <div className="grid grid-cols-2 w-full h-full divide-x divide-x-reverse divide-white/25">
              <div ref={fullHalfStageRef} className="relative w-full h-full overflow-hidden">
                <img
                  src={photoSrc}
                  alt="صورتك للتجربة"
                  className="w-full h-full object-contain pointer-events-none select-none"
                />
                {mainIs3D ? (
                  <Eyewear3DARStage
                    ref={ar3dRef}
                    product={product}
                    frontImageUrl={mainFrontImg?.imageUrl}
                    placement={{
                      ...photoBasePlacement,
                      cx: photoBasePlacement.cx + manualTransform.dx,
                      cy: photoBasePlacement.cy + manualTransform.dy,
                      glassesWidth: photoBasePlacement.glassesWidth * manualTransform.scale,
                      glassesHeight: photoBasePlacement.glassesHeight * manualTransform.scale,
                      rollDeg: photoBasePlacement.rollDeg + manualTransform.rotDeg,
                    }}
                    frameColor={frameColor}
                    lensColor={lensColor}
                    coatingId={coatingId}
                    stageW={activeStageW}
                    stageH={activeStageH}
                    lightingBiasX={photoLighting?.directionalBiasX || 0}
                    enableHeadOccluder={true}
                    useEmaStabilizer={false}
                  />
                ) : (
                  <Glasses25DOverlay
                    product={product}
                    frontImage={mainFrontImg}
                    sideImage={mainSideImg}
                    placement={photoBasePlacement}
                    frameColor={frameColor}
                    lensColor={lensColor}
                    coatingId={coatingId}
                    stageW={activeStageW}
                    stageH={activeStageH}
                    slotId="fullscreen-photo-a"
                    svgRef={mainSvgRef}
                    manualTransform={manualTransform}
                    lighting={photoLighting}
                  />
                )}
              </div>
              <div className="relative w-full h-full overflow-hidden">
                <img
                  src={photoSrc}
                  alt="صورتك للتجربة"
                  className="w-full h-full object-contain pointer-events-none select-none"
                />
                {isProduct3D(compareProduct) ? (
                  <Eyewear3DARStage
                    product={compareProduct}
                    frontImageUrl={cmpFrontImg?.imageUrl}
                    placement={{
                      ...photoBasePlacement,
                      cx: photoBasePlacement.cx + manualTransform.dx,
                      cy: photoBasePlacement.cy + manualTransform.dy,
                      glassesWidth:
                        photoBasePlacement.glassesWidth *
                        manualTransform.scale *
                        (resolveProductOpticalDimensions(compareProduct).totalFrameWidthMm / activeFrameWidthMm),
                      glassesHeight:
                        photoBasePlacement.glassesHeight *
                        manualTransform.scale *
                        (resolveProductOpticalDimensions(compareProduct).totalFrameWidthMm / activeFrameWidthMm),
                      rollDeg: photoBasePlacement.rollDeg + manualTransform.rotDeg,
                    }}
                    frameColor={compareProduct.frame}
                    lensColor={compareProduct.lens}
                    coatingId={coatingId}
                    stageW={activeStageW}
                    stageH={activeStageH}
                    lightingBiasX={photoLighting?.directionalBiasX || 0}
                    enableHeadOccluder={true}
                    useEmaStabilizer={false}
                  />
                ) : (
                  <Glasses25DOverlay
                    product={compareProduct}
                    frontImage={cmpFrontImg}
                    sideImage={cmpSideImg}
                    placement={photoBasePlacement}
                    frameColor={compareProduct.frame}
                    lensColor={compareProduct.lens}
                    coatingId={coatingId}
                    stageW={activeStageW}
                    stageH={activeStageH}
                    slotId="fullscreen-photo-b"
                    manualTransform={manualTransform}
                    lighting={photoLighting}
                  />
                )}
              </div>
            </div>
          ) : photoSrc ? (
            <>
              <img
                src={photoSrc}
                alt="صورتك للتجربة"
                className="w-full h-full object-contain pointer-events-none select-none"
              />
              {mainIs3D ? (
                <Eyewear3DARStage
                  ref={ar3dRef}
                  product={product}
                  frontImageUrl={mainFrontImg?.imageUrl}
                  placement={{
                    ...photoBasePlacement,
                    cx: photoBasePlacement.cx + manualTransform.dx,
                    cy: photoBasePlacement.cy + manualTransform.dy,
                    glassesWidth: photoBasePlacement.glassesWidth * manualTransform.scale,
                    glassesHeight: photoBasePlacement.glassesHeight * manualTransform.scale,
                    rollDeg: photoBasePlacement.rollDeg + manualTransform.rotDeg,
                  }}
                  frameColor={frameColor}
                  lensColor={lensColor}
                  coatingId={coatingId}
                  stageW={activeStageW}
                  stageH={activeStageH}
                  lightingBiasX={photoLighting?.directionalBiasX || 0}
                  enableHeadOccluder={true}
                  useEmaStabilizer={false}
                />
              ) : (
                <Glasses25DOverlay
                  product={product}
                  frontImage={mainFrontImg}
                  sideImage={mainSideImg}
                  placement={photoBasePlacement}
                  frameColor={frameColor}
                  lensColor={lensColor}
                  coatingId={coatingId}
                  stageW={activeStageW}
                  stageH={activeStageH}
                  slotId="fullscreen-photo"
                  svgRef={mainSvgRef}
                  manualTransform={manualTransform}
                  lighting={photoLighting}
                />
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Brief Capture Flash */}
      {flashActive && <div className="fixed inset-0 bg-white/75 pointer-events-none z-40 transition-opacity" />}

      {/* Ultra-Clean Top Bar (Exit + Frame Name + Photo Switch) */}
      <div className="fixed top-0 inset-x-0 z-30 px-3 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-gradient-to-b from-black/75 via-black/35 to-transparent flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={closeFullscreen}
          className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-md border border-white/15 text-white flex items-center justify-center hover:bg-black/75 transition cursor-pointer shrink-0"
          aria-label="إغلاق الكاميرا"
        >
          <I n="x" s={20} />
        </button>

        <div className="text-center min-w-0">
          <div className="font-bold text-sm sm:text-base text-white truncate">{product.name}</div>
          <div className="text-xs text-white/75 tabular-nums">{product.price} ج.م</div>
        </div>

        <div className="shrink-0">
          {mode === 'photo' ? (
            <button
              type="button"
              onClick={startLiveCamera}
              className="h-10 px-3 rounded-full bg-black/50 backdrop-blur-md border border-white/15 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <I n="camera" s={15} /> الكاميرا
            </button>
          ) : (
            <label className="h-10 px-3 rounded-full bg-black/50 backdrop-blur-md border border-white/15 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <I n="upload" s={15} /> صورة
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) handleGalleryUpload(f);
                }}
              />
            </label>
          )}
        </div>
      </div>

      {/* Bottom Dock for Photo / Split Comparison Mode (Single Live Camera renders transparent Edge-to-Edge overlay inside VideoTryOnCanvas) */}
      {(mode !== 'camera' || showSplit) && (
        <div className="shrink-0 w-full z-30 pt-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] px-3 bg-gradient-to-t from-black via-black/95 to-black/80 border-t border-white/10 flex flex-col items-center gap-2.5">
          {/* Circular Screenshot Shutter Button + Share with Friends + Direct Order CTA */}
          {(camStatus === 'streaming' || (mode === 'photo' && photoSrc)) && (
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              <button
                type="button"
                disabled={shotBusy}
                onClick={handleQuickShareFromCamera}
                className="h-11 px-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-extrabold text-xs sm:text-sm shadow-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-transform duration-150 active:scale-[0.97]"
              >
                <span>مشاركة مع الأصدقاء 📤</span>
              </button>

              <button
                type="button"
                disabled={shotBusy}
                onClick={captureTryOnScreenshot}
                aria-label="التقاط صورة"
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-[3.5px] border-white bg-white/20 backdrop-blur-md flex items-center justify-center shadow-2xl active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <span className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white flex items-center justify-center text-slate-900">
                  <I n="camera" s={20} />
                </span>
              </button>

              {onOrderProduct && (
                <button
                  type="button"
                  onClick={() => {
                    onOrderProduct(product.id);
                    closeFullscreen();
                  }}
                  className="h-11 px-3.5 sm:px-4 rounded-full bg-[#D97706] hover:bg-[#B45309] text-white font-extrabold text-xs sm:text-sm shadow-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-transform duration-150 active:scale-[0.97]"
                >
                  <I n="bag" s={15} /> اطلب هذه النظارة
                </button>
              )}
            </div>
          )}

          <p className="text-[0.68rem] text-white/75 text-center leading-4 px-2">
            🔒 خصوصيتك محمية: الكاميرا تعمل لحظياً على جهازك فقط ولا يتم التقاط أو حفظ أي صور.
          </p>

          {/* Simple Horizontal Strip to Switch Between Available Glasses */}
          <div className="w-full max-w-2xl flex items-center gap-2.5 overflow-x-auto noscroll px-1 pb-0.5">
            {carouselItems.map((item) => {
              const selected = item.id === product.id;
              const thumbUrl = resolveStoreFrontUrl(item) || frontImgOf(item)?.imageUrl;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectProduct?.(item.id)}
                  className={
                    'shrink-0 w-24 rounded-2xl p-2 flex flex-col items-center gap-1 transition-all duration-150 active:scale-[0.97] cursor-pointer backdrop-blur-md border ' +
                    (selected
                      ? 'bg-white/25 border-white shadow-lg scale-[1.03]'
                      : 'bg-black/45 border-white/15 opacity-80 hover:opacity-100')
                  }
                >
                  <div className="h-9 w-full flex items-center justify-center">
                    <MiniGlasses
                      type={item.type}
                      frame={item.frame}
                      lens={item.lens}
                      w={68}
                      imageUrl={thumbUrl}
                    />
                  </div>
                  <span className="text-[0.68rem] font-bold text-white truncate w-full text-center">
                    {item.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Instant Screenshot Preview Sheet (Save, Share, Retake, or Order Directly) */}
      {capturedShot && (
        <div className="fixed inset-0 z-50 h-[100dvh] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-md space-y-3 my-auto">
            <div className="relative rounded-3xl overflow-hidden border border-white/15 bg-slate-950 max-h-[58vh] flex items-center justify-center">
              <img src={capturedShot.url} alt="لقطة التجربة" className="w-full h-full object-contain max-h-[58vh]" />
            </div>

            {shotToast && (
              <div className="text-center text-xs font-bold text-teal-300">{shotToast}</div>
            )}

            {onOrderProduct && (
              <button
                type="button"
                onClick={() => {
                  onOrderProduct(product.id);
                  closeFullscreen();
                }}
                className="btn bg-[#D97706] hover:bg-[#B45309] text-white w-full !py-3 text-sm font-extrabold"
              >
                <I n="bag" s={16} /> متابعة الطلب من المتجر
              </button>
            )}

            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => handleSaveScreenshot()} className="btn btn-g !py-2.5 text-xs">
                <I n="dl" s={15} /> حفظ الصورة
              </button>
              <button type="button" onClick={handleShareScreenshot} className="btn btn-g !py-2.5 text-xs">
                <I n="share" s={15} /> مشاركة فورية
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(buildShareTextAndUrl().text)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  recordStoreFriendShare(product.shopId);
                  handleSaveScreenshot();
                }}
                className="btn bg-emerald-600 hover:bg-emerald-700 text-white !py-2.5 text-xs font-extrabold"
              >
                <I n="msg" s={15} /> واتساب
              </a>
            </div>

            <div className="grid grid-cols-2 gap-2.5 items-center">
              {mode === 'photo' ? (
                <label className="btn btn-g !py-2.5 text-xs cursor-pointer">
                  <I n="upload" s={14} /> اختيار صورة أخرى
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) {
                        setCapturedShot((prev) => {
                          if (prev) URL.revokeObjectURL(prev.url);
                          return null;
                        });
                        setShotToast(null);
                        handleGalleryUpload(f);
                      }
                    }}
                  />
                </label>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCapturedShot((prev) => {
                      if (prev) URL.revokeObjectURL(prev.url);
                      return null;
                    });
                    setShotToast(null);
                    startLiveCamera();
                  }}
                  className="btn btn-g !py-2.5 text-xs"
                >
                  <I n="refresh" s={14} /> إعادة التصوير
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setCapturedShot((prev) => {
                    if (prev) URL.revokeObjectURL(prev.url);
                    return null;
                  });
                  setShotToast(null);
                }}
                className="py-2.5 text-xs sm:text-sm font-semibold text-white/80 hover:text-white cursor-pointer text-center"
              >
                إغلاق والعودة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
