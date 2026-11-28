import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { CATS, SHAPES, TYPES } from '../data/seed';
import { useOptiVerse } from '../services/optiverseStore';
import { FrameSize, Product } from '../types';
import {
  resolveAngled45Url,
  resolveClipOnFrontCatalogUrl,
  resolveClipOnSideUrl,
  resolveStoreFrontUrl,
} from '../utils/bulkFrameProcessor';
import { MiniGlasses } from './GlassesGraphics';
import { I, ICON_PATHS } from './Icons';
import { fmt } from './UiShared';
import { formatOpticalDimensions, resolveProductOpticalDimensions } from '../utils/opticalDimensions';

const CustomerPhotoTryOn = lazy(() =>
  import('./CustomerPhotoTryOn').then((m) => ({ default: m.CustomerPhotoTryOn }))
);

interface ProductDetailsViewProps {
  product: Product;
  relatedProducts: Product[];
  initialColor: string;
  initialSize: FrameSize;
  isFavorite: boolean;
  initialRxUrl?: string | null;
  onRxAttached?: (rxDataUrl: string | null) => void;
  onToggleFavorite: () => void;
  onBack: () => void;
  onSelectRelated: (productId: string) => void;
  onTryOn: (color: string, size: FrameSize) => void;
  onAddToCart: (color: string, size: FrameSize) => void;
  onGoCheckout: (color: string, size: FrameSize) => void;
  autoFocusReview?: boolean;
}

const FRAME_MODE_LABELS: Record<string, string> = {
  prescription: 'نظارات طبية',
  sunglasses: 'نظارات شمسية',
  clip_on: 'بغيار شمس مغناطيسي',
  kids: 'نظارات أطفال',
  metal: 'شنابر معادن',
};

export function ProductDetailsView({
  product,
  relatedProducts,
  initialColor,
  initialSize,
  isFavorite,
  initialRxUrl = null,
  onRxAttached,
  onToggleFavorite,
  onBack,
  onSelectRelated,
  onTryOn,
  onAddToCart,
  onGoCheckout,
  autoFocusReview = false,
}: ProductDetailsViewProps) {
  const { reviews, addProductReview, shops, toast, fetchProductDetails } = useOptiVerse();
  const productShop = shops.find((s) => s.id === product.shopId) || shops[0];
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setDetailsLoading(true);
    fetchProductDetails(product.id, product.shopId)
      .catch(() => {})
      .finally(() => {
        if (active) setDetailsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchProductDetails, product.id, product.shopId]);

  const colors =
    product.frameColors && product.frameColors.length > 0
      ? product.frameColors
      : product.availableColors && product.availableColors.length > 0
      ? product.availableColors
      : [product.frameHexColor || product.frame];
  const sizes: FrameSize[] =
    product.availableSizes && product.availableSizes.length > 0
      ? product.availableSizes
      : ['Small', 'Medium', 'Large'];

  const [selectedColor, setSelectedColor] = useState<string>(
    colors.includes(initialColor) ? initialColor : colors[0]
  );
  const [selectedSize, setSelectedSize] = useState<FrameSize>(
    sizes.includes(initialSize) ? initialSize : sizes[0]
  );

  const hasClipOnAssets =
    product.frameType === 'clip_on' &&
    Boolean(product.clipOnFrontCatalogPath || product.clipOnImagePath || product.clipOnSideImagePath);
  const [clipOnMode, setClipOnMode] = useState(false);
  const [activeCanvasPanel, setActiveCanvasPanel] = useState<'tryon' | 'rx' | null>(null);

  // Reviews state
  const [reviewAuthor, setReviewAuthor] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewSectionRef = useRef<HTMLDivElement | null>(null);
  const reviewAuthorInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!autoFocusReview) return;
    const t = window.setTimeout(() => {
      reviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      reviewAuthorInputRef.current?.focus();
    }, 150);
    return () => window.clearTimeout(t);
  }, [autoFocusReview, product.id]);

  const productReviews = useMemo(
    () => reviews.filter((r) => r.productId === product.id),
    [reviews, product.id]
  );
  const averageRating = useMemo(() => {
    if (productReviews.length === 0) return 0;
    const sum = productReviews.reduce((acc, r) => acc + r.rating, 0);
    return Number((sum / productReviews.length).toFixed(1));
  }, [productReviews]);

  // Showcase gallery: Front catalog studio shot + 3/4 side view (+ Clip-On variant when toggled)
  const galleryItems = useMemo(() => {
    const out: Array<{ id?: string; imageUrl: string; label?: string }> = [];
    const seen = new Set<string>();
    const pushUnique = (item: { id?: string; imageUrl?: string | null; label?: string }) => {
      if (!item.imageUrl || seen.has(item.imageUrl)) return;
      seen.add(item.imageUrl);
      out.push({ id: item.id, imageUrl: item.imageUrl, label: item.label });
    };

    if (clipOnMode && hasClipOnAssets) {
      pushUnique({
        id: `${product.id}-clipon-front`,
        imageUrl: resolveClipOnFrontCatalogUrl(product),
        label: 'الصورة الأمامية (بالوش · غيار شمس)',
      });
      pushUnique({
        id: `${product.id}-clipon-side`,
        imageUrl: resolveClipOnSideUrl(product),
        label: 'الصورة الجانبية (بالجنب 3/4 · غيار شمس)',
      });
    } else {
      pushUnique({
        id: `${product.id}-front`,
        imageUrl: resolveStoreFrontUrl(product),
        label: 'الصورة الأمامية (بالوش)',
      });
      pushUnique({
        id: `${product.id}-side`,
        imageUrl: resolveAngled45Url(product),
        label: 'الصورة الجانبية (بالجنب 3/4)',
      });
      for (const im of product.images || []) {
        pushUnique({ id: im.id, imageUrl: im.imageUrl, label: im.label });
      }
      (product.additionalImages || []).forEach((url, idx) => {
        pushUnique({ id: `${product.id}-add-${idx}`, imageUrl: url, label: `صورة إضافية ${idx + 1}` });
      });
    }
    return out;
  }, [clipOnMode, hasClipOnAssets, product]);

  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    setSelectedColor(colors.includes(initialColor) ? initialColor : colors[0]);
    setSelectedSize(sizes.includes(initialSize) ? initialSize : sizes[0]);
    setActiveImgIdx(0);
    setClipOnMode(false);
    setActiveCanvasPanel(null);
  }, [product.id]);

  useEffect(() => {
    setActiveImgIdx(0);
  }, [clipOnMode]);

  const activeImage = galleryItems[activeImgIdx] || galleryItems[0];
  const rawOrig = (product as Product & { orig?: number }).orig;
  const effectivePrice =
    rawOrig !== undefined
      ? product.price
      : product.salePrice && product.salePrice > 0 && product.salePrice < product.price
      ? product.salePrice
      : product.price;
  const origPrice =
    rawOrig !== undefined
      ? rawOrig
      : product.salePrice && product.salePrice > 0 && product.salePrice < product.price
      ? product.price
      : undefined;
  const effectiveDisc =
    origPrice && origPrice > effectivePrice
      ? product.disc || Math.round(((origPrice - effectivePrice) / origPrice) * 100)
      : 0;
  const hasDiscount = typeof origPrice === 'number' && origPrice > effectivePrice && effectiveDisc > 0;
  const opticalDims = resolveProductOpticalDimensions(product);

  const defaultDesc =
    product.cat === 'sun'
      ? `نظارة شمسية بتصميم ${TYPES[product.type]} متوازن وعدسات تحمي من الأشعة فوق البنفسجية، متاحة للتجربة الافتراضية الدقيقة على وجهك قبل الطلب.`
      : product.cat === 'safe'
      ? `إطار ${TYPES[product.type]} خفيف الوزن مهيأ لعدسات الحماية من الضوء الأزرق والاستخدام اليومي المريح أمام الشاشات.`
      : `إطار طبي ${TYPES[product.type]} مصمم لراحة الأنف طوال اليوم مع دعم كامل لتركيب العدسات الطبية حسب كشف نظرك.`;

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setReviewError(null);
    if (!reviewAuthor.trim()) {
      setReviewError('يرجى كتابة اسمك أولاً');
      return;
    }
    if (!reviewComment.trim()) {
      setReviewError('يرجى كتابة تعليقك حول النظارة');
      return;
    }
    setReviewBusy(true);
    try {
      await addProductReview({
        productId: product.id,
        shopId: product.shopId,
        authorName: reviewAuthor.trim(),
        rating: reviewRating,
        comment: reviewComment.trim(),
      });
      setReviewAuthor('');
      setReviewComment('');
      setReviewRating(5);
      toast('شكراً لك! تم إضافة تقييمك بنجاح ✓');
    } finally {
      setReviewBusy(false);
    }
  };

  return (
    <div dir="rtl" className="fade rounded-3xl bg-[#F8F9FA] text-slate-900 border border-slate-200 p-4 sm:p-7 shadow-sm">
      {/* Top Breadcrumb Navigation */}
      <div className="flex items-center justify-between gap-4 pb-5 mb-6 border-b border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 hover:opacity-75 transition cursor-pointer whitespace-nowrap shrink-0"
        >
          <I n="arrow" s={16} />
          <span>العودة إلى المتجر</span>
        </button>

        <div className="text-xs text-slate-600 flex items-center gap-2 truncate">
          <span>{(product.frameType && FRAME_MODE_LABELS[product.frameType]) || CATS[product.cat]}</span>
          <span aria-hidden="true">·</span>
          <span>{TYPES[product.type]}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono" dir="ltr">
            {product.code}
          </span>
        </div>

        <button
          type="button"
          onClick={onToggleFavorite}
          className="w-11 h-11 rounded-xl border border-slate-200 bg-white flex items-center justify-center cursor-pointer hover:bg-slate-100 transition shrink-0"
          style={{ color: isFavorite ? '#e11d48' : '#0f172a' }}
          aria-label="إضافة للمفضلة"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill={isFavorite ? '#e11d48' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d={ICON_PATHS.heart} />
          </svg>
        </button>
      </div>

      {/* Main Two-Column Contiguous PDP Layout */}
      <div className="grid lg:grid-cols-12 gap-7 items-start">
        {/* Product Stage & Front/Side Carousel (#F8F9FA clean studio showcase) */}
        <div className="lg:col-span-7 space-y-3">
          {hasClipOnAssets && (
            <div className="flex items-center justify-between gap-2 bg-white rounded-2xl border border-slate-200 p-2">
              <span className="text-xs font-extrabold text-slate-700 px-2">حالة النظارة في المعرض:</span>
              <div className="inline-flex rounded-xl bg-slate-100 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setClipOnMode(false)}
                  className={
                    'px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ' +
                    (!clipOnMode ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:text-slate-950')
                  }
                >
                  الوضع الطبي 👓
                </button>
                <button
                  type="button"
                  onClick={() => setClipOnMode(true)}
                  className={
                    'px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ' +
                    (clipOnMode ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:text-slate-950')
                  }
                >
                  بغيار الشمس 🕶️
                </button>
              </div>
            </div>
          )}

          <div
            className="relative rounded-2xl bg-[#F8F9FA] border border-slate-200 min-h-[300px] sm:min-h-[380px] flex flex-col items-center justify-center p-6 sm:p-10 overflow-hidden touch-pan-y"
            onTouchStart={(e) => setTouchStartX(e.touches[0]?.clientX ?? null)}
            onTouchEnd={(e) => {
              if (touchStartX === null || galleryItems.length < 2) return;
              const endX = e.changedTouches[0]?.clientX ?? touchStartX;
              const delta = endX - touchStartX;
              setTouchStartX(null);
              if (Math.abs(delta) < 35) return;
              if (delta > 0) {
                setActiveImgIdx((i) => (i + 1) % galleryItems.length);
              } else {
                setActiveImgIdx((i) => (i - 1 + galleryItems.length) % galleryItems.length);
              }
            }}
          >
            {galleryItems.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveImgIdx((i) => (i - 1 + galleryItems.length) % galleryItems.length)}
                  className="absolute start-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl bg-white/90 hover:bg-white border border-slate-200 text-slate-900 flex items-center justify-center shadow-sm cursor-pointer z-10"
                  aria-label="الصورة السابقة"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setActiveImgIdx((i) => (i + 1) % galleryItems.length)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl bg-white/90 hover:bg-white border border-slate-200 text-slate-900 flex items-center justify-center shadow-sm cursor-pointer z-10"
                  aria-label="الصورة التالية"
                >
                  ›
                </button>
              </>
            )}

            {activeImage ? (
              <div className="relative flex flex-col items-center justify-center w-full">
                {activeImage.label && (
                  <span className="mb-2 text-[0.7rem] font-extrabold text-teal-800 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                    {activeImage.label}
                  </span>
                )}
                <img
                  src={activeImage.imageUrl}
                  alt={product.name}
                  width={440}
                  height={260}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="max-h-[250px] sm:max-h-[300px] w-auto max-w-full object-contain select-none transition-transform duration-200"
                />
                {/* Soft natural contact shadow directly below the isolated frame */}
                <div
                  aria-hidden="true"
                  className="w-3/5 max-w-[300px] h-5 mt-3 rounded-full pointer-events-none"
                  style={{
                    background:
                      'radial-gradient(ellipse at center, rgba(15, 23, 42, 0.22) 0%, rgba(15, 23, 42, 0.08) 48%, rgba(15, 23, 42, 0) 76%)',
                  }}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center w-full">
                <MiniGlasses type={product.type} frame={selectedColor} lens={product.lens} w={270} />
                <div
                  aria-hidden="true"
                  className="w-48 h-4 mt-4 rounded-full pointer-events-none"
                  style={{
                    background:
                      'radial-gradient(ellipse at center, rgba(15, 23, 42, 0.2) 0%, rgba(15, 23, 42, 0) 75%)',
                  }}
                />
              </div>
            )}
          </div>

          {/* Multi-Angle Thumbnails (Front Studio vs 3/4 Side View) */}
          {galleryItems.length > 1 && (
            <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
              {galleryItems.map((im, idx) => (
                <button
                  key={im.id || idx}
                  type="button"
                  onClick={() => setActiveImgIdx(idx)}
                  className={
                    'min-w-[88px] h-16 rounded-xl bg-white border p-1.5 flex flex-col items-center justify-center shrink-0 cursor-pointer transition ' +
                    (activeImgIdx === idx
                      ? 'border-slate-900 ring-1 ring-slate-900'
                      : 'border-slate-200 opacity-75 hover:opacity-100')
                  }
                >
                  <img
                    src={im.imageUrl}
                    alt={im.label || `${product.name} ${idx + 1}`}
                    width={64}
                    height={40}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="max-h-10 max-w-full object-contain"
                  />
                  {im.label && (
                    <span className="text-[0.6rem] font-bold text-slate-600 truncate max-w-[82px] mt-0.5">
                      {im.label}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Contiguous Purchase & Specification Module */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
          <div>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1.5">
              <div className="flex items-center gap-2">
                <span>{TYPES[product.type]}</span>
                <span aria-hidden="true">·</span>
                <span>{(product.frameType && FRAME_MODE_LABELS[product.frameType]) || CATS[product.cat]}</span>
              </div>
              {productReviews.length > 0 && (
                <span className="inline-flex items-center gap-1 font-extrabold text-amber-600">
                  ★ {averageRating} ({productReviews.length})
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-[1.7rem] font-extrabold text-slate-900 leading-snug">
              {product.name}
            </h1>
            <div className="mt-2.5 flex items-baseline gap-2.5 tabular-nums flex-wrap">
              <span className="text-2xl font-extrabold text-slate-900">
                {fmt(effectivePrice)} <span className="text-sm font-bold text-slate-600">ج.م</span>
              </span>
              {hasDiscount && (
                <>
                  <s className="text-sm text-slate-400">{fmt(origPrice!)} ج.م</s>
                  <span className="text-xs font-bold text-[#059669]">وفر {effectiveDisc}%</span>
                </>
              )}
            </div>
            {productShop?.showStockCountToCustomer && (product.stock ?? 1) === 1 && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-xs font-extrabold">
                <span>متبقي قطعة واحدة فقط!</span>
              </div>
            )}
          </div>

          <p className="text-sm text-slate-700 leading-7 border-t border-slate-100 pt-4">
            {product.description?.trim() || defaultDesc}
          </p>

          {/* Physical Optical Millimeter Spec Strip (1:1 Scale) */}
          <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#0F172A]">المقاسات البصرية (1:1 Scale)</span>
              <span className="font-mono font-extrabold text-[#0284C7]" dir="ltr">
                {formatOpticalDimensions(opticalDims)} mm
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center">
              {[
                ['العدسة', `${opticalDims.lensWidthMm}mm`],
                ['الجسر', `${opticalDims.bridgeWidthMm}mm`],
                ['الذراع', `${opticalDims.templeLengthMm}mm`],
                ['الكلي', `${opticalDims.totalFrameWidthMm}mm`],
              ].map(([lbl, val]) => (
                <div key={lbl} className="rounded-lg bg-white border border-slate-200 py-1.5 px-1">
                  <div className="text-[0.65rem] text-slate-500">{lbl}</div>
                  <div className="text-xs font-extrabold text-[#0F172A] font-mono tabular-nums" dir="ltr">
                    {val}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Frame Color Selector */}
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-900">الألوان المتاحة</span>
              <span className="font-mono text-slate-500" dir="ltr">
                {selectedColor === 'transparent' ? 'Crystal Clear' : selectedColor}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {colors.map((hex) => {
                const active = selectedColor === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setSelectedColor(hex)}
                    title={hex}
                    aria-label={`لون ${hex}`}
                    className={
                      'w-8 h-8 rounded-full border transition cursor-pointer ' +
                      (active ? 'ring-2 ring-slate-900 ring-offset-2 border-slate-900' : 'border-slate-300')
                    }
                    style={{
                      background:
                        hex === 'transparent'
                          ? 'linear-gradient(135deg, #ffffff 45%, #e2e8f0 55%)'
                          : hex,
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* Physical Optical Spec Badge */}
          <div className="rounded-xl bg-[#F8F9FA] border border-slate-200 p-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-xs font-bold text-slate-700">مقاس هذا الإطار:</span>
            <span className="font-mono font-extrabold text-[#0284C7] text-xs" dir="ltr">
              {formatOpticalDimensions(opticalDims)} mm
            </span>
          </div>

          {/* Suitable Face Shapes */}
          <div className="space-y-1.5 border-t border-slate-100 pt-3">
            <div className="text-xs font-bold text-slate-900">أشكال الوجه المناسبة</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(product.shapes && product.shapes.length > 0
                ? product.shapes
                : (['oval', 'round', 'square'] as const)
              ).map((shp) => (
                <span
                  key={shp}
                  className="px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-[#0284C7] text-xs font-bold"
                >
                  {SHAPES[shp] || shp}
                </span>
              ))}
            </div>
          </div>

          {/* Action Buttons: Clean 2-Group Layout */}
          <div className="space-y-2.5 pt-2">
            {/* Group 1: Live 3D Camera (Primary) + Try on Photo */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <button
                type="button"
                onClick={() => onTryOn(selectedColor, selectedSize)}
                className="sm:col-span-7 min-h-[44px] py-3 px-3 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
              >
                <I n="camera" s={17} />
                <span>جرّب على وجهك الآن (كاميرا 3D) 👓</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveCanvasPanel((curPanel) => (curPanel === 'tryon' ? null : 'tryon'))}
                className="sm:col-span-5 min-h-[44px] py-3 px-2.5 rounded-xl bg-[#F8F9FA] hover:bg-slate-200 border border-[#E2E8F0] text-[#0F172A] font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <span>جرّب على صورتك 📷</span>
              </button>
            </div>

            {/* Group 2: WhatsApp Order + Add to Cart */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onGoCheckout(selectedColor, selectedSize)}
                className="min-h-[44px] py-3 px-3 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow-sm"
              >
                <I n="msg" s={15} />
                <span>اطلب الآن عبر واتساب</span>
              </button>

              <button
                type="button"
                onClick={() => onAddToCart(selectedColor, selectedSize)}
                className="min-h-[44px] py-3 px-3 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
              >
                <I n="bag" s={15} />
                <span>إضافة للسلة</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Inline Interactive 2D Portrait Try-On & Prescription Upload Drawer */}
      {activeCanvasPanel && (
        <div className="mt-6">
          <Suspense
            fallback={
              <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-xs font-bold text-slate-600">
                جاري تحميل أداة التجربة الافتراضية...
              </div>
            }
          >
            <CustomerPhotoTryOn
              product={product}
              initialSubMode={activeCanvasPanel}
              initialRxUrl={initialRxUrl}
              onRxAttached={onRxAttached}
              onOrderProduct={() => onGoCheckout(selectedColor, selectedSize)}
              onClose={() => setActiveCanvasPanel(null)}
            />
          </Suspense>
        </div>
      )}

      {/* Customer Reviews Section (1-5 Stars + Arabic RTL Submission) */}
      <div
        id="product-review-form"
        ref={reviewSectionRef}
        className="mt-8 pt-6 border-t border-slate-200 grid lg:grid-cols-12 gap-6 items-start"
      >
        <div
          className={
            'lg:col-span-5 bg-white rounded-2xl border p-5 space-y-3 ' +
            (autoFocusReview ? 'border-amber-400 ring-2 ring-amber-200 shadow-md' : 'border-slate-200')
          }
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-slate-900">أضف تقييمك للنظارة</h2>
            {productReviews.length > 0 && (
              <span className="text-xs font-extrabold text-amber-600">
                ★ {averageRating} / 5 ({productReviews.length} تقييم)
              </span>
            )}
          </div>

          <form onSubmit={handleSubmitReview} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">التقييم بالنجوم</label>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setReviewRating(star)}
                    aria-label={`${star} نجوم`}
                    className={
                      'w-9 h-9 rounded-xl border text-lg flex items-center justify-center transition cursor-pointer ' +
                      (star <= reviewRating
                        ? 'bg-amber-50 border-amber-300 text-amber-500'
                        : 'bg-[#F8F9FA] border-slate-200 text-slate-300 hover:text-amber-400')
                    }
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الاسم</label>
              <input
                ref={reviewAuthorInputRef}
                type="text"
                value={reviewAuthor}
                onChange={(e) => setReviewAuthor(e.target.value)}
                placeholder="اسمك الكريم"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-[#F8F9FA] text-slate-900 text-sm outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">تعليقك وتجربتك</label>
              <textarea
                rows={3}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="شاركنا رأيك في خامة الشنبر ومقاسه على وجهك..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-[#F8F9FA] text-slate-900 text-sm outline-none focus:border-slate-900"
              />
            </div>

            {reviewError && <div className="text-xs font-bold text-rose-600">{reviewError}</div>}

            <button
              type="submit"
              disabled={reviewBusy}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs cursor-pointer transition disabled:opacity-50"
            >
              {reviewBusy ? 'جاري النشر...' : 'إرسال التقييم'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-7 space-y-3">
          <h2 className="text-base font-extrabold text-slate-900">
            تقييمات العملاء ({productReviews.length})
          </h2>

          {detailsLoading && productReviews.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center text-xs text-slate-500 animate-pulse">
              جاري تحميل التقييمات...
            </div>
          ) : productReviews.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center text-xs text-slate-500">
              لا توجد تقييمات لهذه النظارة بعد — كن أول من يشارك تجربته!
            </div>
          ) : (
            <div className="space-y-2.5">
              {productReviews.map((rev) => (
                <div key={rev.id} className="rounded-2xl bg-white border border-slate-200 p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-extrabold text-sm text-slate-900">{rev.authorName}</div>
                    <div className="text-amber-500 text-xs font-bold tracking-wider">
                      {'★'.repeat(Math.max(1, Math.min(5, rev.rating)))}
                      <span className="text-slate-200">
                        {'★'.repeat(Math.max(0, 5 - Math.min(5, rev.rating)))}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-700 leading-6">{rev.comment}</p>
                  <div className="text-[0.68rem] text-slate-400" dir="ltr">
                    {new Date(rev.createdAt).toLocaleDateString('ar-EG')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Related Frames */}
      {relatedProducts.length > 0 && (
        <div className="mt-8 pt-6 border-t border-slate-200">
          <h2 className="text-base font-extrabold text-slate-900 mb-4">موديلات مشابهة قد تعجبك</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {relatedProducts.slice(0, 4).map((rp) => (
              <button
                key={rp.id}
                type="button"
                onClick={() => onSelectRelated(rp.id)}
                className="text-start rounded-2xl bg-white border border-slate-200 p-3 hover:border-slate-400 transition cursor-pointer"
              >
                <div className="rounded-xl bg-[#F8F9FA] py-4 px-2 flex items-center justify-center mb-2.5">
                  <MiniGlasses
                    type={rp.type}
                    frame={rp.frame}
                    lens={rp.lens}
                    w={110}
                    imageUrl={resolveStoreFrontUrl(rp)}
                  />
                </div>
                <div className="font-bold text-xs text-slate-900 truncate">{rp.name}</div>
                <div className="text-xs font-extrabold text-teal-700 mt-1 tabular-nums">{fmt(rp.price)} ج.م</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
