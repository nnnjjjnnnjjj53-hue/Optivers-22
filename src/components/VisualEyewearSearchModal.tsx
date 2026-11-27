import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { EGYPT_GOVERNORATES } from '../data/seed';
import { isShopExpiredOrPaused, useOptiVerse } from '../services/optiverseStore';
import { FrameColorFamily, FrameShapeTag, Product, Shop } from '../types';
import { resolveStoreFrontUrl } from '../utils/bulkFrameProcessor';
import { MiniGlasses } from './GlassesGraphics';
import { I } from './Icons';
import { D, Pr } from './UiShared';

export interface VisualMatchAnalysis {
  is_eyewear: boolean;
  frame_shape: FrameShapeTag;
  color_family: FrameColorFamily;
  category: 'sun' | 'med';
  material: 'metal' | 'tr_plastic';
  style_summary_ar: string;
}

interface VisualEyewearSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHAPE_LABELS_AR: Record<FrameShapeTag, string> = {
  round: 'دائري',
  oval: 'بيضاوي',
  square: 'مربع',
  cat_eye: 'كات آي',
  aviator: 'أفياتور',
};

const COLOR_LABELS_AR: Record<FrameColorFamily, string> = {
  black: 'أسود',
  brown_tortoise: 'بني / هافانا',
  clear: 'شفاف / كريستال',
  metal: 'معدني (ذهبي/فضي)',
  other: 'متنوع',
};

function resolveProductShapeTag(p: Product): FrameShapeTag {
  const explicit = p.frameShapeTag || p.modelCalibration?.frameShapeTag;
  if (explicit) return explicit;
  if (p.type === 'round') return 'round';
  if (p.type === 'aviator') return 'aviator';
  if (p.type === 'cat') return 'cat_eye';
  if (p.type === 'rimless') return 'oval';
  return 'square';
}

function resolveProductColorFamily(p: Product): FrameColorFamily {
  const explicit = p.colorFamily || p.modelCalibration?.colorFamily;
  if (explicit) return explicit;
  if (p.isCrystalFrame || p.frame === 'transparent') return 'clear';
  if (p.frameType === 'metal' || p.modelCalibration?.material === 'metal' || p.type === 'rimless') {
    return 'metal';
  }
  const hex = (p.frameHexColor || p.frame || '').toLowerCase();
  if (/^#([0-9a-f]{6})$/.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (r < 68 && g < 68 && b < 68) return 'black';
    if (r > g && g >= b && r - b >= 18) return 'brown_tortoise';
    if (r > 185 && g > 185 && b > 185) return 'clear';
  }
  return 'other';
}

function resolveProductMaterial(p: Product): 'metal' | 'tr_plastic' {
  const mat = p.modelCalibration?.material;
  if (mat === 'metal' || p.frameType === 'metal' || p.type === 'rimless' || p.type === 'aviator') {
    return 'metal';
  }
  return 'tr_plastic';
}

function scoreProductMatch(
  p: Product,
  shop: Shop,
  analysis: VisualMatchAnalysis,
  selectedGov: string
): number {
  let score = 0;

  // 1. Shape (up to 40 points)
  const prodShape = resolveProductShapeTag(p);
  if (prodShape === analysis.frame_shape) {
    score += 40;
  } else if (
    (prodShape === 'round' && analysis.frame_shape === 'oval') ||
    (prodShape === 'oval' && analysis.frame_shape === 'round')
  ) {
    score += 22;
  } else if (
    (prodShape === 'square' && analysis.frame_shape === 'aviator') ||
    (prodShape === 'aviator' && analysis.frame_shape === 'square')
  ) {
    score += 12;
  }

  // 2. Color family (up to 26 points)
  const prodColor = resolveProductColorFamily(p);
  if (prodColor === analysis.color_family) {
    score += 26;
  } else if (
    (prodColor === 'black' && analysis.color_family === 'brown_tortoise') ||
    (prodColor === 'brown_tortoise' && analysis.color_family === 'black') ||
    (prodColor === 'metal' && analysis.color_family === 'clear')
  ) {
    score += 11;
  }

  // 3. Category: sun vs med (up to 20 points)
  const prodCat = p.cat === 'sun' ? 'sun' : 'med';
  if (prodCat === analysis.category) {
    score += 20;
  }

  // 4. Material: metal vs tr_plastic (up to 10 points)
  const prodMaterial = resolveProductMaterial(p);
  if (prodMaterial === analysis.material) {
    score += 10;
  }

  // 5. Location / Featured polish (up to 4 points, capped at 99%)
  const shopGov = (shop.governorate || shop.city || '').trim();
  if (selectedGov !== 'الكل' && shopGov === selectedGov) {
    score += 4;
  } else if (shop.isFeatured) {
    score += 3;
  }

  return Math.max(0, Math.min(99, Math.round(score)));
}

async function compressImageTo384Base64(file: File): Promise<{
  base64: string;
  mimeType: string;
  previewDataUrl: string;
}> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('تعذر قراءة ملف الصورة المرفوع'));
      el.src = objectUrl;
    });

    const maxDim = 384;
    const srcW = Math.max(1, img.naturalWidth || img.width || maxDim);
    const srcH = Math.max(1, img.naturalHeight || img.height || maxDim);
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('تعذر تهيئة ضغط الصورة');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
    return {
      base64,
      mimeType: 'image/jpeg',
      previewDataUrl: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function VisualEyewearSearchModal({ isOpen, onClose }: VisualEyewearSearchModalProps) {
  const { products, shops, navigate } = useOptiVerse();
  const [selectedGov, setSelectedGov] = useState<string>('الكل');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notEyewearMsg, setNotEyewearMsg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<VisualMatchAnalysis | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const activeShopMap = useMemo(() => {
    const map = new Map<string, Shop>();
    for (const s of shops) {
      if (!isShopExpiredOrPaused(s)) {
        map.set(s.id, s);
      }
    }
    return map;
  }, [shops]);

  const allScoredMatches = useMemo(() => {
    if (!analysis) return [];
    const list: Array<{ product: Product; shop: Shop; score: number }> = [];
    for (const p of products) {
      if (p.isDeleted || p.isPublished === false) continue;
      const shop = activeShopMap.get(p.shopId);
      if (!shop) continue;
      if (shop.hideOutOfStockToCustomer && (p.stock ?? 1) <= 0) continue;
      const score = scoreProductMatch(p, shop, analysis, selectedGov);
      list.push({ product: p, shop, score });
    }
    return list.sort((a, b) => b.score - a.score);
  }, [analysis, products, activeShopMap, selectedGov]);

  const filteredMatches = useMemo(() => {
    if (!analysis) return [];
    const byGov =
      selectedGov === 'الكل'
        ? allScoredMatches
        : allScoredMatches.filter(
            (m) => (m.shop.governorate || m.shop.city || '').trim() === selectedGov
          );
    return byGov.filter((m) => m.score >= 35).slice(0, 12);
  }, [analysis, allScoredMatches, selectedGov]);

  const handleFileChange = async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|heic|avif)$/i.test(file.name)) {
      setErrorMsg('من فضلك اختر ملف صورة صالح (JPG / PNG / WebP).');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setNotEyewearMsg(null);

    try {
      const compressed = await compressImageTo384Base64(file);
      setPreviewUrl(compressed.previewDataUrl);

      const res = await fetch('/api/eyewear/visual-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: compressed.base64,
          mimeType: compressed.mimeType,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        is_eyewear?: boolean;
        message?: string;
        error?: string;
        analysis?: VisualMatchAnalysis;
      };

      if (!res.ok) {
        throw new Error(data.error || 'تعذر تحليل الصورة حالياً — حاول مرة أخرى.');
      }

      if (!data.is_eyewear || !data.analysis) {
        setAnalysis(null);
        setNotEyewearMsg(
          data.message ||
            'لم نتمكن من تمييز نظارة واضحة في هذه الصورة. من فضلك ارفع صورة نظارة أوضح وبإضاءة جيدة.'
        );
        return;
      }

      setAnalysis(data.analysis);
    } catch (err) {
      setAnalysis(null);
      setErrorMsg(err instanceof Error ? err.message : 'حدث خطأ أثناء البحث بالصورة.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const inviteMsg = encodeURIComponent(
    `مرحباً! أدعوكم للانضمام إلى منصة OptiVerse لعرض نظارات محلكم بتقنية التجربة الافتراضية 3D${
      selectedGov !== 'الكل' ? ` لعملاء محافظة ${selectedGov}` : ''
    } — سجلوا مجاناً الآن: ${typeof window !== 'undefined' ? window.location.origin : 'https://optiverse.app'}/merchant?mode=signup`
  );

  const modalNode = (
    <div
      dir="rtl"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-sm fade overflow-y-auto"
      style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pop bg-white rounded-3xl max-w-4xl w-full my-auto shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] text-[#0F172A]"
        style={{ backgroundColor: '#FFFFFF' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-200 bg-[#F8F9FA] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-2xl bg-sky-50 text-[#0284C7] border border-sky-200 flex items-center justify-center text-xl shrink-0">
              📷
            </span>
            <div className="min-w-0">
              <h2 className="font-extrabold text-base sm:text-lg text-slate-900 truncate">
                البحث الذكي عن نظارة بالصورة وأقرب محل
              </h2>
              <p className="text-xs text-slate-500 truncate">
                ارفع صورة أي نظارة أعجبتك وسنجد أقرب الموديلات المتوفرة في محلات محافظتك فوراً
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="w-9 h-9 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 font-extrabold flex items-center justify-center cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {/* Step 1 + 2: Governorate & Photo Upload */}
          <div className="grid sm:grid-cols-12 gap-4 items-stretch">
            <div className="sm:col-span-5 rounded-2xl bg-[#F8F9FA] border border-slate-200 p-4 flex flex-col justify-between gap-3">
              <div>
                <label
                  htmlFor="visual-search-gov"
                  className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5 mb-2"
                >
                  <I n="map" s={14} c="text-[#0284C7]" />
                  <span>1. اختر المحافظة</span>
                </label>
                <select
                  id="visual-search-gov"
                  className="inp font-bold bg-white"
                  value={selectedGov}
                  onChange={(e) => setSelectedGov(e.target.value)}
                >
                  <option value="الكل">كل المحافظات ({EGYPT_GOVERNORATES.length})</option>
                  {EGYPT_GOVERNORATES.map((gov) => (
                    <option key={gov} value={gov}>
                      {gov}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[0.72rem] text-slate-500 leading-5">
                لا يتطلب تسجيل دخول — يمكنك تغيير المحافظة في أي وقت لتصفية النتائج فوراً.
              </p>
            </div>

            <div className="sm:col-span-7">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  void handleFileChange(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-full min-h-[126px] rounded-2xl border-2 border-dashed border-[#0284C7]/50 hover:border-[#0284C7] bg-sky-50/50 hover:bg-sky-50/90 p-4 flex items-center gap-4 text-start transition cursor-pointer disabled:opacity-60"
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="الصورة المرفوعة"
                    className="w-24 h-20 rounded-xl object-contain bg-white border border-slate-200 p-1 shrink-0 shadow-xs"
                  />
                ) : (
                  <span className="w-14 h-14 rounded-2xl bg-[#0284C7] text-white flex items-center justify-center shrink-0 shadow-sm">
                    <I n="camera" s={26} />
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold text-sm text-[#0F172A]">
                    {loading
                      ? 'جاري تحليل التصميم بالذكاء الاصطناعي...'
                      : previewUrl
                      ? '2. تغيير صورة النظارة والبحث مجدداً 📷'
                      : '2. اضغط هنا لرفع صورة النظارة التي أعجبتك 📷'}
                  </div>
                  <div className="text-xs text-slate-600 mt-1 leading-5">
                    يتم ضغط الصورة تلقائياً إلى <span dir="ltr">384px</span> قبل الإرسال لتعمل بسرعة البرق على باقات 4G.
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="rounded-2xl bg-sky-50 border border-sky-200 p-5 flex items-center justify-center gap-3 text-sm font-extrabold text-[#0284C7]">
              <span className="w-5 h-5 rounded-full border-2 border-[#0284C7] border-t-transparent animate-spin shrink-0" />
              <span>جاري مطابقة الشكل واللون والخامة مع كتالوج المحلات...</span>
            </div>
          )}

          {/* Non-Eyewear Friendly Warning */}
          {!loading && notEyewearMsg && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-amber-950 text-xs sm:text-sm font-bold leading-6">
                <span className="text-lg shrink-0">👓</span>
                <span>{notEyewearMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-sm !bg-[#D97706] hover:!bg-[#B45309] !text-white font-extrabold cursor-pointer shrink-0"
              >
                اختر صورة أوضح
              </button>
            </div>
          )}

          {/* Error Banner */}
          {!loading && errorMsg && (
            <div
              role="alert"
              className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-xs sm:text-sm font-bold text-rose-800"
            >
              {errorMsg}
            </div>
          )}

          {/* AI Analysis Summary Chips */}
          {!loading && analysis && (
            <div className="rounded-2xl bg-gradient-to-l from-sky-50 to-slate-50 border border-sky-200/80 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs sm:text-sm font-extrabold text-[#0F172A] flex items-center gap-2">
                  <I n="spark" s={16} c="text-[#0284C7]" />
                  <span>التحليل الذكي: {analysis.style_summary_ar}</span>
                </div>
                <span className="text-[0.72rem] font-bold text-slate-600 tabular-nums">
                  {filteredMatches.length} نتيجة مطابقة
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[0.7rem] font-bold">
                <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-700">
                  الشكل: {SHAPE_LABELS_AR[analysis.frame_shape] || analysis.frame_shape}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-700">
                  اللون: {COLOR_LABELS_AR[analysis.color_family] || analysis.color_family}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-700">
                  النوع: {analysis.category === 'sun' ? 'نظارة شمسية' : 'نظارة طبية'}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-700">
                  الخامة: {analysis.material === 'metal' ? 'معدن' : 'بلاستيك / أسيتات'}
                </span>
              </div>
            </div>
          )}

          {/* Results Grid or Smart Empty State */}
          {!loading && analysis && (
            filteredMatches.length > 0 ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredMatches.map(({ product, shop, score }) => {
                  const thumb = resolveStoreFrontUrl(product);
                  const shopGov = shop.governorate || shop.city || 'القاهرة';
                  const hasMapUrl = Boolean(shop.mapsUrl && /^https?:\/\//i.test(shop.mapsUrl));
                  const priced = D(product);

                  return (
                    <article
                      key={product.id}
                      className="rounded-2xl bg-white border border-slate-200 hover:border-[#0284C7]/60 shadow-xs hover:shadow-md transition p-3.5 flex flex-col gap-3"
                    >
                      <div className="relative aspect-[4/3] rounded-xl bg-[#F8F9FA] border border-slate-100 flex items-center justify-center p-3 overflow-hidden">
                        <span className="absolute top-2 start-2 z-10 px-2.5 py-0.5 rounded-full bg-[#059669] text-white text-[0.68rem] font-extrabold shadow-xs tabular-nums">
                          تطابق {score}%
                        </span>
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={product.name}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <MiniGlasses
                            type={product.type}
                            frame={product.frame}
                            lens={product.lens}
                            w={135}
                          />
                        )}
                      </div>

                      <div className="space-y-1">
                        <h3 className="font-extrabold text-sm text-[#0F172A] truncate">{product.name}</h3>
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                          <span className="truncate font-semibold">
                            🏪 {shop.name} · {shopGov}
                          </span>
                        </div>
                        <div className="text-sm font-extrabold text-[#0284C7]">
                          <Pr x={priced} />
                        </div>
                      </div>

                      <div className="mt-auto space-y-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            navigate(`/s/${shop.slug}/f/${product.id}?tryon=1`);
                          }}
                          className="w-full py-2.5 px-3 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer"
                        >
                          <span>جرّبها على وشك الآن 👓</span>
                        </button>

                        {hasMapUrl ? (
                          <a
                            href={shop.mapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="w-full py-2 px-3 rounded-xl bg-[#F8F9FA] hover:bg-slate-100 border border-slate-200 text-[#0F172A] text-xs font-bold flex items-center justify-center gap-1.5 transition"
                          >
                            <span>موقع المحل على الخريطة 📍</span>
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              navigate(`/s/${shop.slug}`);
                            }}
                            className="w-full py-2 px-3 rounded-xl bg-[#F8F9FA] hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                          >
                            <span>زيارة صفحة المحل 🏪</span>
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-3xl bg-[#F8F9FA] border border-slate-200 p-6 sm:p-8 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-sky-50 text-[#0284C7] border border-sky-200 mx-auto flex items-center justify-center text-2xl">
                  📍
                </div>
                <div className="space-y-1.5 max-w-lg mx-auto">
                  <h3 className="font-extrabold text-base text-[#0F172A]">
                    {selectedGov !== 'الكل'
                      ? `لا توجد نظارات مطابقة مسجلة في محافظة ${selectedGov} حالياً`
                      : 'لا توجد نظارات مطابقة تماماً حالياً'}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-6">
                    ساعِد في توفير هذه الميزة في منطقتك وشارك رابط الانضمام مع محل البصريات المفضل لديك ليعرض نظاراته بالتجربة الافتراضية.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <a
                    href={`https://wa.me/?text=${inviteMsg}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn !bg-[#059669] hover:!bg-[#047857] !text-white !px-5 !py-2.5 text-xs sm:text-sm font-extrabold shadow-sm"
                  >
                    <I n="msg" s={16} /> ادعُ محل البصريات القريب منك للانضمام عبر واتساب
                  </a>

                  {selectedGov !== 'الكل' && allScoredMatches.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedGov('الكل')}
                      className="btn btn-g !px-4 !py-2.5 text-xs sm:text-sm font-bold"
                    >
                      عرض النتائج في كل المحافظات ({allScoredMatches.slice(0, 12).length})
                    </button>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return ReactDOM.createPortal(modalNode, document.body);
  }
  return modalNode;
}
