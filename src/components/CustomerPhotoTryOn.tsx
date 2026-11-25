import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Product } from '../types';
import { resolveClipOnTryOnUrl, resolveTryOnFrontUrl } from '../utils/bulkFrameProcessor';
import { assessOpticalFit, resolveProductOpticalDimensions } from '../utils/opticalDimensions';
import { I } from './Icons';

export interface CustomerPhotoTryOnProps {
  product: Product;
  initialSubMode?: 'tryon' | 'rx';
  initialPhotoFile?: File | null;
  initialPhotoUrl?: string | null;
  initialRxUrl?: string | null;
  onRxAttached?: (rxDataUrl: string | null) => void;
  onClose?: () => void;
  onOrderProduct?: (productId: string) => void;
}

interface CanvasGlassesTransform {
  x: number;
  y: number;
  width: number;
  rotDeg: number;
  scale: number;
}

const CANVAS_W = 720;
const CANVAS_H = 720;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

function getContainBox(boxW: number, boxH: number, imgW: number, imgH: number) {
  const scale = Math.min(boxW / Math.max(1, imgW), boxH / Math.max(1, imgH));
  const w = imgW * scale;
  const h = imgH * scale;
  return {
    x: (boxW - w) / 2,
    y: (boxH - h) / 2,
    w,
    h,
  };
}

export function CustomerPhotoTryOn({
  product,
  initialSubMode = 'tryon',
  initialPhotoFile = null,
  initialPhotoUrl = null,
  initialRxUrl = null,
  onRxAttached,
  onClose,
  onOrderProduct,
}: CustomerPhotoTryOnProps) {
  const [subMode, setSubMode] = useState<'tryon' | 'rx'>(initialSubMode);
  const [portraitUrl, setPortraitUrl] = useState<string | null>(initialPhotoUrl);
  const [rxUrl, setRxUrl] = useState<string | null>(initialRxUrl);
  const [clipOnActive, setClipOnActive] = useState(false);
  const [autoDetectMsg, setAutoDetectMsg] = useState<string | null>(null);
  const [photoFitInfo, setPhotoFitInfo] = useState<{
    status: 'ideal' | 'narrow' | 'oversized';
    badgeLabel: string;
  } | null>(null);
  const [dragOverTryon, setDragOverTryon] = useState(false);
  const [dragOverRx, setDragOverRx] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const portraitImgRef = useRef<HTMLImageElement | null>(null);
  const glassesImgRef = useRef<HTMLImageElement | null>(null);

  const opticalSpec = resolveProductOpticalDimensions(product);
  const frameTotalWidthMm = opticalSpec.totalFrameWidthMm;
  const calFitScale = product.modelCalibration?.fitScale ?? 1.0;
  const kidsMult = product.frameType === 'kids' ? 0.9 : 1.0;
  const hasClipOn = product.frameType === 'clip_on' && Boolean(product.clipOnImagePath);
  const activeGlassesUrl =
    (clipOnActive && hasClipOn ? resolveClipOnTryOnUrl(product) : resolveTryOnFrontUrl(product)) || '';

  const [basePose, setBasePose] = useState<CanvasGlassesTransform>({
    x: CANVAS_W / 2,
    y: CANVAS_H * 0.43,
    width: CANVAS_W * 0.44 * kidsMult,
    rotDeg: 0,
    scale: 1,
  });
  const [transform, setTransform] = useState<CanvasGlassesTransform>({
    x: CANVAS_W / 2,
    y: CANVAS_H * 0.43,
    width: CANVAS_W * 0.44 * kidsMult,
    rotDeg: 0,
    scale: 1,
  });

  const dragStateRef = useRef<{
    active: boolean;
    startCanvasX: number;
    startCanvasY: number;
    baseX: number;
    baseY: number;
  }>({ active: false, startCanvasX: 0, startCanvasY: 0, baseX: 0, baseY: 0 });

  useEffect(() => {
    setClipOnActive(false);
  }, [product.id]);

  useEffect(() => {
    setSubMode(initialSubMode);
  }, [initialSubMode]);

  useEffect(() => {
    if (initialRxUrl !== undefined) {
      setRxUrl(initialRxUrl);
    }
  }, [initialRxUrl]);

  // Draw Canvas composite whenever portrait, glasses image, or transform updates
  const drawComposite = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const pImg = portraitImgRef.current;
    if (!pImg || !pImg.naturalWidth) return;

    const contain = getContainBox(CANVAS_W, CANVAS_H, pImg.naturalWidth, pImg.naturalHeight);
    ctx.drawImage(pImg, contain.x, contain.y, contain.w, contain.h);

    const gImg = glassesImgRef.current;
    if (gImg && gImg.naturalWidth) {
      const aspect = product.aspectRatio || gImg.naturalWidth / Math.max(1, gImg.naturalHeight);
      const drawW = transform.width * transform.scale;
      const drawH = drawW / Math.max(0.2, aspect);

      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.rotate((transform.rotDeg * Math.PI) / 180);
      ctx.shadowColor = 'rgba(15, 23, 42, 0.28)';
      ctx.shadowBlur = Math.max(6, drawW * 0.025);
      ctx.shadowOffsetY = Math.max(3, drawW * 0.014);
      ctx.drawImage(gImg, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }
  }, [product.aspectRatio, transform]);

  useEffect(() => {
    drawComposite();
  }, [drawComposite, portraitUrl, activeGlassesUrl]);

  // Load glasses image when active frame or clip-on changes
  useEffect(() => {
    if (!activeGlassesUrl) {
      glassesImgRef.current = null;
      drawComposite();
      return;
    }
    let cancelled = false;
    loadHtmlImage(activeGlassesUrl)
      .then((img) => {
        if (cancelled) return;
        glassesImgRef.current = img;
        drawComposite();
      })
      .catch(() => {
        if (!cancelled) {
          glassesImgRef.current = null;
          drawComposite();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeGlassesUrl, drawComposite]);

  const handlePortraitSrc = useCallback(
    async (src: string) => {
      setPortraitUrl(src);
      setAutoDetectMsg('جاري ضبط تموضع النظارة على الوجه...');
      try {
        const img = await loadHtmlImage(src);
        portraitImgRef.current = img;
        const contain = getContainBox(CANVAS_W, CANVAS_H, img.naturalWidth, img.naturalHeight);

        let nextPose: CanvasGlassesTransform = {
          x: CANVAS_W / 2,
          y: CANVAS_H * 0.43,
          width: Math.min(contain.w * 0.56, CANVAS_W * 0.45) * kidsMult,
          rotDeg: 0,
          scale: 1,
        };

        try {
          const { detectFaceOnImage } = await import('../utils/faceTracker');
          const face = await detectFaceOnImage(img);
          if (face) {
            const bridgeX = face.noseBridge.x * contain.w + contain.x;
            const bridgeY = face.noseBridge.y * contain.h + contain.y;
            const eyeDistPx = Math.max(18, face.eyeDistance * contain.w);
            const pixelsPerMm = Math.max(0.25, eyeDistPx / 63);
            const glassesW = Math.max(80, frameTotalWidthMm * pixelsPerMm * calFitScale * kidsMult);
            const userFaceWidthMm = (Math.max(eyeDistPx * 1.9, face.cheekWidth * contain.w)) / pixelsPerMm;
            const fit = assessOpticalFit(userFaceWidthMm, frameTotalWidthMm);
            setPhotoFitInfo({ status: fit.status, badgeLabel: fit.badgeLabel });
            nextPose = {
              x: bridgeX,
              y: bridgeY,
              width: glassesW,
              rotDeg: Math.max(-25, Math.min(25, (face.roll * 180) / Math.PI)),
              scale: 1,
            };
            setAutoDetectMsg('تم التثبيت بمقياس 1:1 الحقيقي — اسحب للتحريك أو عدّل الحجم والميل');
          } else {
            setPhotoFitInfo(null);
            setAutoDetectMsg('اسحب النظارة بيدك على العينين واستخدم شريط التكبير والتدوير');
          }
        } catch {
          setPhotoFitInfo(null);
          setAutoDetectMsg('اسحب النظارة بيدك على العينين واستخدم شريط التكبير والتدوير');
        }

        setBasePose(nextPose);
        setTransform(nextPose);
      } catch {
        setPhotoFitInfo(null);
        setAutoDetectMsg('تعذر تحميل الصورة المختارة');
      }
    },
    [calFitScale, frameTotalWidthMm, kidsMult]
  );

  const handlePortraitFile = useCallback(
    async (file: File) => {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl) {
        await handlePortraitSrc(dataUrl);
      }
    },
    [handlePortraitSrc]
  );

  useEffect(() => {
    if (initialPhotoFile) {
      void handlePortraitFile(initialPhotoFile);
    } else if (initialPhotoUrl) {
      void handlePortraitSrc(initialPhotoUrl);
    }
  }, [initialPhotoFile, initialPhotoUrl, handlePortraitFile, handlePortraitSrc]);

  const handleRxFile = async (file: File) => {
    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl) return;
    setRxUrl(dataUrl);
    onRxAttached?.(dataUrl);
  };

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * CANVAS_W,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * CANVAS_H,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!portraitUrl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = toCanvasCoords(e.clientX, e.clientY);
    dragStateRef.current = {
      active: true,
      startCanvasX: pt.x,
      startCanvasY: pt.y,
      baseX: transform.x,
      baseY: transform.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStateRef.current.active) return;
    const pt = toCanvasCoords(e.clientX, e.clientY);
    const dx = pt.x - dragStateRef.current.startCanvasX;
    const dy = pt.y - dragStateRef.current.startCanvasY;
    setTransform((prev) => ({
      ...prev,
      x: Math.max(0, Math.min(CANVAS_W, dragStateRef.current.baseX + dx)),
      y: Math.max(0, Math.min(CANVAS_H, dragStateRef.current.baseY + dy)),
    }));
  };

  const handlePointerUp = () => {
    dragStateRef.current.active = false;
  };

  const handleDownloadComposite = () => {
    const canvas = canvasRef.current;
    if (!canvas || !portraitUrl) return;
    drawComposite();
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `optiverse-${product.code || 'frame'}-tryon.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div
      dir="rtl"
      className="rounded-3xl bg-[#F8F9FA] text-slate-900 border border-slate-200 p-4 sm:p-5 space-y-4 shadow-sm"
    >
      {/* Header & Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSubMode('tryon')}
            className={
              'px-3.5 py-2 rounded-xl text-xs font-extrabold transition cursor-pointer border ' +
              (subMode === 'tryon'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400')
            }
          >
            التجربة على صورتك بالكانفاس
          </button>
          <button
            type="button"
            onClick={() => setSubMode('rx')}
            className={
              'px-3.5 py-2 rounded-xl text-xs font-extrabold transition cursor-pointer border ' +
              (subMode === 'rx'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400')
            }
          >
            رفع روشتة كشف النظر {rxUrl ? '✓' : ''}
          </button>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
            aria-label="إغلاق"
          >
            <I n="x" s={16} />
          </button>
        )}
      </div>

      {/* MODE A: Personal Photo Canvas Try-On */}
      {subMode === 'tryon' && (
        <div className="space-y-3">
          {!portraitUrl ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverTryon(true);
              }}
              onDragLeave={() => setDragOverTryon(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverTryon(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handlePortraitFile(f);
              }}
              className={
                'rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition ' +
                (dragOverTryon
                  ? 'border-teal-600 bg-teal-50'
                  : 'border-slate-300 bg-white hover:border-slate-400')
              }
            >
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-800 mx-auto mb-3 flex items-center justify-center">
                <I n="upload" s={22} />
              </div>
              <div className="font-extrabold text-sm text-slate-900">
                رفع صورة شخصية لتجربة النظارة
              </div>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                اسحب صورتك وأفلتها هنا أو اختر صورة من جهازك أو التقط سيلفي مباشرة
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2">
                <label className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer">
                  <I n="upload" s={14} /> اختيار صورة من الجهاز
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void handlePortraitFile(f);
                    }}
                  />
                </label>

                <label className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer">
                  <I n="camera" s={14} /> التقاط بالكاميرا
                  <input
                    type="file"
                    accept="image/*"
                    capture="user"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void handlePortraitFile(f);
                    }}
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Interactive HTML5 Canvas Stage */}
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-inner max-w-lg mx-auto">
                <canvas
                  ref={canvasRef}
                  width={CANVAS_W}
                  height={CANVAS_H}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onWheel={(e) => {
                    e.preventDefault();
                    const factor = e.deltaY < 0 ? 1.06 : 0.94;
                    setTransform((prev) => ({
                      ...prev,
                      scale: Math.max(0.35, Math.min(2.5, Number((prev.scale * factor).toFixed(2)))),
                    }));
                  }}
                  className="w-full h-auto block touch-none cursor-grab active:cursor-grabbing"
                />

                {photoFitInfo && (
                  <div className="absolute top-3 end-3 pointer-events-none">
                    <span
                      className={
                        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold shadow-md border ' +
                        (photoFitInfo.status === 'ideal'
                          ? 'bg-[#059669] border-emerald-300 text-white'
                          : 'bg-[#D97706] border-amber-300 text-white')
                      }
                    >
                      <span className="w-2 h-2 rounded-full bg-white" />
                      {photoFitInfo.badgeLabel}
                    </span>
                  </div>
                )}

                {hasClipOn && (
                  <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none">
                    <button
                      type="button"
                      onClick={() => setClipOnActive((v) => !v)}
                      className="pointer-events-auto px-4 py-2 rounded-xl bg-white/95 hover:bg-white text-[#0F172A] border border-[#E2E8F0] shadow-md text-xs font-extrabold cursor-pointer"
                    >
                      {clipOnActive ? 'إزالة الغيار 👓' : 'تركيب غيار الشمس 🕶️'}
                    </button>
                  </div>
                )}
              </div>

              {autoDetectMsg && (
                <div className="text-center text-xs font-semibold text-[#0284C7]">{autoDetectMsg}</div>
              )}

              {/* Arabic Controls Toolbar */}
              <div className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  {/* Scale Control */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>تكبير وتصغير</span>
                      <span dir="ltr" className="font-mono text-slate-900">
                        {Math.round(transform.scale * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setTransform((p) => ({
                            ...p,
                            scale: Math.max(0.35, Number((p.scale - 0.08).toFixed(2))),
                          }))
                        }
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={0.35}
                        max={2.5}
                        step={0.02}
                        value={transform.scale}
                        onChange={(e) =>
                          setTransform((p) => ({ ...p, scale: Number(e.target.value) }))
                        }
                        className="flex-1 accent-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setTransform((p) => ({
                            ...p,
                            scale: Math.min(2.5, Number((p.scale + 0.08).toFixed(2))),
                          }))
                        }
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Rotation Control */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>تدوير</span>
                      <span dir="ltr" className="font-mono text-slate-900">
                        {Math.round(transform.rotDeg)}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-45}
                      max={45}
                      step={1}
                      value={transform.rotDeg}
                      onChange={(e) =>
                        setTransform((p) => ({ ...p, rotDeg: Number(e.target.value) }))
                      }
                      className="w-full accent-slate-900"
                    />
                  </div>
                </div>

                {/* Action Buttons Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTransform(basePose)}
                      className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer"
                    >
                      إعادة التوسيط
                    </button>

                    <label className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer inline-flex items-center gap-1">
                      <I n="refresh" s={13} /> استبدال الصورة
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) void handlePortraitFile(f);
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        portraitImgRef.current = null;
                        setPortraitUrl(null);
                        setPhotoFitInfo(null);
                        setAutoDetectMsg(null);
                      }}
                      className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer inline-flex items-center gap-1"
                    >
                      <I n="trash" s={13} /> حذف
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadComposite}
                      className="px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-extrabold cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <I n="dl" s={14} /> تحميل الصورة
                    </button>

                    {onOrderProduct && (
                      <button
                        type="button"
                        onClick={() => onOrderProduct(product.id)}
                        className="px-4 py-2 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-extrabold cursor-pointer inline-flex items-center gap-1.5 shadow-sm"
                      >
                        <I n="bag" s={14} /> اطلب هذه النظارة
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODE B: Prescription Upload */}
      {subMode === 'rx' && (
        <div className="space-y-3">
          {!rxUrl ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverRx(true);
              }}
              onDragLeave={() => setDragOverRx(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverRx(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleRxFile(f);
              }}
              className={
                'rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition ' +
                (dragOverRx
                  ? 'border-teal-600 bg-teal-50'
                  : 'border-slate-300 bg-white hover:border-slate-400')
              }
            >
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-800 mx-auto mb-3 flex items-center justify-center">
                <I n="receipt" s={22} />
              </div>
              <div className="font-extrabold text-sm text-slate-900">رفع روشتة كشف النظر</div>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                ارفق صورة واضحة لكشف النظارة ليقوم المحل بتجهيز العدسات بدقة
              </p>
              <label className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer">
                <I n="upload" s={14} /> اختر صورة الروشتة
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void handleRxFile(f);
                  }}
                />
              </label>
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-extrabold text-teal-700">
                  <I n="check" s={16} /> تم إرفاق صورة روشتة الكشف
                </div>
                <div className="flex items-center gap-2">
                  <label className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer inline-flex items-center gap-1">
                    <I n="refresh" s={12} /> استبدال
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void handleRxFile(f);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setRxUrl(null);
                      onRxAttached?.(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer inline-flex items-center gap-1"
                  >
                    <I n="trash" s={12} /> حذف
                  </button>
                </div>
              </div>

              <div className="rounded-xl overflow-hidden border border-slate-200 bg-[#F8F9FA] flex items-center justify-center max-h-72 p-2">
                <img
                  src={rxUrl}
                  alt="روشتة كشف النظر"
                  loading="lazy"
                  decoding="async"
                  className="max-h-64 w-auto object-contain rounded-lg"
                />
              </div>

              {onOrderProduct && (
                <button
                  type="button"
                  onClick={() => onOrderProduct(product.id)}
                  className="w-full py-2.5 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-extrabold cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <I n="eye" s={15} /> متابعة اختيار العدسات وإرسال الكشف
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
