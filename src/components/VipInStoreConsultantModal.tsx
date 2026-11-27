import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Product, Shop } from '../types';
import { resolveStoreFrontUrl } from '../utils/bulkFrameProcessor';
import { formatOpticalDimensions, resolveProductOpticalDimensions } from '../utils/opticalDimensions';
import {
  VIP_FACE_SHAPE_META,
  VipFaceShape,
  VipFrameRecommendation,
  classifyVipFaceShape,
  recommendTop3FramesForShop,
} from '../utils/vipConsultant';
import { MiniGlasses } from './GlassesGraphics';
import { I } from './Icons';
import { Modal, Pr } from './UiShared';
import { VideoTryOnCanvas } from './VideoTryOnCanvas';

const SCAN_SAMPLES_TARGET = 12;

interface VipInStoreConsultantModalProps {
  shop: Shop;
  products: Product[];
  onClose: () => void;
}

export function VipInStoreConsultantModal({
  shop,
  products,
  onClose,
}: VipInStoreConsultantModalProps) {
  const inStockProducts = useMemo(
    () => products.filter((p) => !p.isDeleted && (p.stock ?? 1) > 0),
    [products]
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [faceVisible, setFaceVisible] = useState(false);

  // Local MediaPipe face-shape scan accumulation state
  const voteCountsRef = useRef<Record<VipFaceShape, number>>({
    round: 0,
    oval: 0,
    square: 0,
    heart: 0,
  });
  const widthSamplesRef = useRef<number[]>([]);
  const totalSamplesRef = useRef<number>(0);

  const [scanProgress, setScanProgress] = useState(0);
  const [lockedShape, setLockedShape] = useState<VipFaceShape | null>(null);
  const [lockedWidthMm, setLockedWidthMm] = useState<number | undefined>(undefined);
  const [top3, setTop3] = useState<VipFrameRecommendation[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<string>(() => inStockProducts[0]?.id || '');

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => {
        try {
          tr.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startCamera = async () => {
      if (!inStockProducts.length) return;
      setCameraError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('المتصفح لا يدعم تشغيل الكاميرا المباشرة');
        }
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
      } catch (err) {
        if (!cancelled) {
          setCameraError(
            err instanceof Error
              ? err.message
              : 'تعذر فتح الكاميرا — تأكد من منح صلاحية الكاميرا للمتصفح'
          );
        }
      }
    };

    void startCamera();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [inStockProducts.length, stopCamera]);

  const resetAnalysis = useCallback(() => {
    voteCountsRef.current = { round: 0, oval: 0, square: 0, heart: 0 };
    widthSamplesRef.current = [];
    totalSamplesRef.current = 0;
    setScanProgress(0);
    setLockedShape(null);
    setLockedWidthMm(undefined);
    setTop3([]);
    if (inStockProducts[0]) {
      setSelectedFrameId(inStockProducts[0].id);
    }
  }, [inStockProducts]);

  const handleLandmarksFrame = useCallback(
    (landmarks: { x: number; y: number; z: number }[] | null) => {
      if (!landmarks || !landmarks.length) {
        setFaceVisible(false);
        return;
      }
      setFaceVisible(true);
      if (lockedShape) return;

      const vW = videoRef.current?.videoWidth || 1280;
      const vH = videoRef.current?.videoHeight || 720;
      const sample = classifyVipFaceShape(landmarks, vW, vH);
      if (!sample) return;

      voteCountsRef.current[sample.shape] += 1;
      widthSamplesRef.current.push(sample.userFaceWidthMm);
      totalSamplesRef.current += 1;

      const pct = Math.min(100, Math.round((totalSamplesRef.current / SCAN_SAMPLES_TARGET) * 100));
      setScanProgress(pct);

      if (totalSamplesRef.current >= SCAN_SAMPLES_TARGET) {
        const counts = voteCountsRef.current;
        const winner = (Object.keys(counts) as VipFaceShape[]).reduce((best, cur) =>
          counts[cur] > counts[best] ? cur : best
        , 'oval' as VipFaceShape);
        const avgW = widthSamplesRef.current.length
          ? Math.round(
              widthSamplesRef.current.reduce((s, n) => s + n, 0) / widthSamplesRef.current.length
            )
          : undefined;

        const picks = recommendTop3FramesForShop(inStockProducts, winner, avgW);
        setLockedShape(winner);
        setLockedWidthMm(avgW);
        setTop3(picks);
        if (picks[0]) {
          setSelectedFrameId(picks[0].product.id);
        }
      }
    },
    [inStockProducts, lockedShape]
  );

  const activeProduct =
    inStockProducts.find((p) => p.id === selectedFrameId) || top3[0]?.product || inStockProducts[0];
  const activeMeta = lockedShape ? VIP_FACE_SHAPE_META[lockedShape] : null;
  const activeRecommendation = top3.find((item) => item.product.id === activeProduct?.id) || top3[0];

  return (
    <Modal
      title={`مستشار الـ VIP — ${shop.name}`}
      onClose={() => {
        stopCamera();
        onClose();
      }}
      w="max-w-4xl"
    >
      {!inStockProducts.length ? (
        <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-8 text-center space-y-3">
          <div className="text-3xl">👓</div>
          <div className="font-extrabold text-base text-[#0F172A]">
            لا توجد نظارات متوفرة في المخزن حالياً
          </div>
          <p className="text-xs text-slate-600 max-w-md mx-auto leading-6">
            لترشيح أفضل 3 نظارات للزبون تلقائياً داخل المحل، تأكد من وجود نظارات بحالة «متاح 🟢» في مخزن محلك.
          </p>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="btn btn-p btn-sm"
          >
            العودة للوحة التحكم
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-12 gap-4 items-stretch">
            {/* Live Mirror Camera + MediaPipe AR Try-On */}
            <div className="lg:col-span-7 relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-[4/3] min-h-[270px] flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />

              {activeProduct && cameraReady && !cameraError && (
                <VideoTryOnCanvas
                  videoRef={videoRef}
                  product={activeProduct}
                  active={cameraReady && !cameraError}
                  showDebugBadge={false}
                  onLandmarksFrame={handleLandmarksFrame}
                />
              )}

              {/* Top Live Consultant Status Pill */}
              <div className="absolute top-3 inset-x-3 z-20 flex items-center justify-between gap-2 pointer-events-none">
                <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-white/15 text-white text-xs font-extrabold flex items-center gap-2 shadow-lg">
                  <span
                    className={
                      'w-2 h-2 rounded-full shrink-0 ' +
                      (lockedShape
                        ? 'bg-emerald-400'
                        : faceVisible
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-rose-400')
                    }
                  />
                  {lockedShape && activeMeta ? (
                    <span>
                      {activeMeta.emoji} شكل الوجه: {activeMeta.labelAr}
                      {lockedWidthMm ? ` (${lockedWidthMm}mm)` : ''}
                    </span>
                  ) : faceVisible ? (
                    <span className="tabular-nums">جاري تحليل ملامح الزبون محلياً... {scanProgress}%</span>
                  ) : (
                    <span>وجّه الكاميرا لوجه الزبون لبدء التحليل</span>
                  )}
                </div>

                {lockedShape && (
                  <button
                    type="button"
                    onClick={resetAnalysis}
                    className="pointer-events-auto px-3 py-1.5 rounded-xl bg-white/95 hover:bg-white text-slate-900 text-xs font-extrabold shadow-lg cursor-pointer transition shrink-0"
                  >
                    فحص عميل جديد 🔄
                  </button>
                )}
              </div>

              {/* Scanning Progress Bar Overlay */}
              {!lockedShape && cameraReady && !cameraError && (
                <div className="absolute bottom-3 inset-x-4 z-20 pointer-events-none">
                  <div className="rounded-xl bg-slate-900/80 backdrop-blur-md border border-white/15 p-2.5 text-white space-y-1.5">
                    <div className="flex items-center justify-between text-[0.7rem] font-bold">
                      <span>تحليل نسب الجبهة والوجنتين والفك (MediaPipe محلي)</span>
                      <span className="tabular-nums text-amber-300">{scanProgress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 transition-all duration-150"
                        style={{ width: `${scanProgress}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Currently Wearing Frame Badge */}
              {lockedShape && activeProduct && (
                <div className="absolute bottom-3 inset-x-3 z-20 pointer-events-none flex items-center justify-between gap-2">
                  <div className="px-3 py-2 rounded-xl bg-slate-950/85 backdrop-blur-md border border-white/15 text-white min-w-0">
                    <div className="text-[0.65rem] text-amber-300 font-extrabold">
                      تُجرّب الآن على الوجه ({activeRecommendation?.score || 95}% تطابق)
                    </div>
                    <div className="text-xs font-extrabold truncate">{activeProduct.name}</div>
                  </div>
                </div>
              )}

              {cameraError && (
                <div className="absolute inset-0 z-30 bg-slate-950/92 flex flex-col items-center justify-center p-6 text-center text-white space-y-3">
                  <span className="text-3xl">📷</span>
                  <div className="font-extrabold text-sm">{cameraError}</div>
                  <p className="text-xs text-slate-300 max-w-xs">
                    تأكد من السماح بالوصول للكاميرا في إعدادات المتصفح ثم أعد فتح المساعد.
                  </p>
                </div>
              )}
            </div>

            {/* Right Panel: Face Analysis Summary + Top 3 Available Recommendations */}
            <div className="lg:col-span-5 flex flex-col gap-3">
              {lockedShape && activeMeta ? (
                <div className="rounded-2xl bg-sky-50 border border-sky-200 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-sm text-[#0F172A]">
                      {activeMeta.emoji} التحليل: {activeMeta.shortAr}
                    </span>
                    <span className="px-2 py-0.5 rounded-lg bg-white border border-sky-200 text-[#0284C7] text-[0.68rem] font-extrabold">
                      {activeMeta.recommendedTagsAr}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 leading-5">
                    {activeRecommendation?.matchReasonAr || activeMeta.reasonAr}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3.5 space-y-1.5">
                  <div className="font-extrabold text-sm text-[#0F172A] flex items-center gap-1.5">
                    <span>🪄 جاهز لاستقبال زبون الـ VIP</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-5">
                    بمجرد نظر الزبون للكاميرا لثانيتين، سيتم تحديد شكل وجهه محلياً وترشيح أفضل 3 نظارات متوفرة في مخزنك وإلباسها له فوراً.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="text-xs font-extrabold text-[#0F172A]">
                  {lockedShape
                    ? 'أفضل ترشيحات مخزنك:'
                    : 'معاينة أولية من المخزن المتاح:'}
                </div>
                <span className="text-[0.68rem] text-slate-500 font-bold">
                  {inStockProducts.length} موديل متاح
                </span>
              </div>

              <div className="space-y-2 flex-1 overflow-y-auto max-h-[300px] pe-0.5">
                {(lockedShape ? top3 : inStockProducts.slice(0, 3).map((p) => ({ product: p, score: 0, matchReasonAr: '' }))).map(
                  (rec, idx) => {
                    const p = rec.product;
                    const isSelected = activeProduct?.id === p.id;
                    const dims = resolveProductOpticalDimensions(p);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedFrameId(p.id)}
                        className={
                          'w-full rounded-2xl border p-2.5 text-start flex items-center gap-3 cursor-pointer transition ' +
                          (isSelected
                            ? 'border-[#0284C7] bg-sky-50/90 ring-2 ring-[#0284C7]/25 shadow-sm'
                            : 'border-[#E2E8F0] bg-white hover:border-slate-300')
                        }
                      >
                        <div className="w-16 h-12 rounded-xl bg-[#F8F9FA] border border-slate-200 flex items-center justify-center shrink-0 p-1">
                          <MiniGlasses
                            type={p.type}
                            frame={p.frame}
                            lens={p.lens}
                            w={58}
                            imageUrl={resolveStoreFrontUrl(p)}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded bg-[#0F172A] text-white text-[0.6rem] font-extrabold">
                              #{idx + 1}
                            </span>
                            <span className="font-extrabold text-xs text-[#0F172A] truncate">
                              {p.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[0.68rem]">
                            <span className="font-extrabold text-[#D97706]">
                              <Pr x={p} />
                            </span>
                            <span className="font-mono text-slate-400" dir="ltr">
                              {formatOpticalDimensions(dims)}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-end">
                          {rec.score > 0 && (
                            <div className="text-[0.66rem] font-extrabold text-[#059669] tabular-nums">
                              {rec.score}%
                            </div>
                          )}
                          <span
                            className={
                              'inline-block mt-0.5 px-2 py-0.5 rounded-lg text-[0.64rem] font-extrabold ' +
                              (isSelected ? 'bg-[#0284C7] text-white' : 'bg-slate-100 text-slate-700')
                            }
                          >
                            {isSelected ? 'مُجرّبة ✓' : 'جرّبها'}
                          </span>
                        </div>
                      </button>
                    );
                  }
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={resetAnalysis} className="btn btn-g btn-sm flex-1">
                  <I n="refresh" s={14} /> إعادة التحليل
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    onClose();
                  }}
                  className="btn btn-p btn-sm flex-1"
                >
                  إغلاق المساعد
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
