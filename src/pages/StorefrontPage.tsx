import React, { useEffect, useRef, useState } from 'react';
import { CATS, DEFAULT_SHOP_ID, FRAME_COLORS, LENS_COLORS, TYPES, faceMatch, resolveStoreTheme } from '../data/seed';
import {
  CUSTOM_LAB_DESIGNS,
  DEFAULT_OFFICIAL_LENS_BRANDS,
  LENS_CATEGORIES,
  LENS_INDEX_META,
  LENS_TRACKS,
  PHOTO_VARIANT_LABELS,
  SPONSOR_BADGE_LABELS,
  resolveCustomerLensBrands,
} from '../data/opticalLensMatrix';
import { isAdminRole, isShopExpiredOrPaused, useOptiVerse } from '../services/optiverseStore';
import {
  CustomLabDesign,
  FaceShape,
  FrameColorFamily,
  FrameShapeTag,
  FrameSize,
  Inquiry,
  LensCategoryKey,
  LensIndex,
  LensTrack,
  PhotoVariant,
  Product,
} from '../types';
import { FaceTryOnStage } from '../components/FaceTryOnStage';
import { Glasses, MiniGlasses, getCoatingStyle } from '../components/GlassesGraphics';
import { I, ICON_PATHS } from '../components/Icons';
import { ProductDetailsView } from '../components/ProductDetailsView';
import { D, Egp, Empty, Modal, Pr, Stages, fmt, qBadge, waNum } from '../components/UiShared';
import { canvasToBlob, loadImageToCanvas } from '../utils/visionPipeline';
import { resolveAngled45Url, resolveStoreFrontUrl } from '../utils/bulkFrameProcessor';
import { formatOpticalDimensions, resolveProductOpticalDimensions } from '../utils/opticalDimensions';
import { recordStoreFriendShare, recordStoreVisit } from '../utils/storeAnalytics';

const STORE_PAGE_SIZE = 24;

function resolveProductShapeTag(p: Product): FrameShapeTag {
  const tag = p.frameShapeTag || p.modelCalibration?.frameShapeTag;
  if (tag) return tag;
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
    if (r < 65 && g < 65 && b < 65) return 'black';
    if (r > g && g >= b && r - b >= 20) return 'brown_tortoise';
    if (r > 185 && g > 185 && b > 185) return 'clear';
  }
  return 'other';
}

export function StorefrontPage({ slug, initialFrameId }: { slug: string; initialFrameId?: string }) {
  const {
    session,
    route,
    navigate,
    platformSettings,
    shops,
    products: allProductsRaw,
    fav,
    setFav,
    cart,
    setCart,
    inq,
    lensTypes,
    addInquiry,
    toast,
    setModal,
    uploadRxPrescriptionToStorage,
  } = useOptiVerse();

  const rxEnabled = Boolean(
    platformSettings.enableLensesSystem ?? platformSettings.enablePrescriptionLenses
  );
  const directoryEnabled = Boolean(platformSettings.enableStoresDirectory);

  const shop = shops.find((s) => s.slug === slug);
  const queryString = route.includes('?')
    ? route.split('?')[1]
    : typeof window !== 'undefined'
    ? window.location.search.slice(1)
    : '';
  const queryParams = new URLSearchParams(queryString);
  const isMerchantPreview = queryParams.get('preview') === 'merchant';
  const isPendingBlocked = Boolean(shop && shop.status === 'pending');

  useEffect(() => {
    if (isPendingBlocked) {
      toast('المتجر غير مفعّل حتى تأكيد الإدارة');
      navigate('/');
    }
  }, [isPendingBlocked, navigate, toast]);

  if (isPendingBlocked) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-slate-950 text-white" dir="rtl">
        <div className="max-w-md w-full bg-slate-900 border border-amber-500/30 p-8 rounded-3xl shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/10 border border-amber-400/30 flex items-center justify-center text-3xl">
            ⏳
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-amber-300">المتجر غير مفعّل حتى تأكيد الإدارة</h2>
            <p className="text-xs text-slate-300 opacity-90 leading-relaxed">
              هذا المتجر قيد المراجعة الإدارية حالياً ولا يمكن معاينته أو تصفحه قبل التفعيل.
            </p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition-all cursor-pointer shadow-lg shadow-amber-500/20"
          >
            العودة للرئيسية
          </button>
        </div>
      </div>
    );
  }

  if (!shop || (!isMerchantPreview && (shop.status === 'paused' || shop.status === 'expired'))) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-slate-950 text-white" dir="rtl">
        <div className="max-w-md w-full bg-slate-900 border border-amber-500/30 p-8 rounded-3xl shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/10 border border-amber-400/30 flex items-center justify-center text-3xl">
            👓
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-amber-300">هذا المتجر غير متاح حاليًا</h2>
            <p className="text-xs text-slate-300 opacity-90 leading-relaxed">
              عذراً، هذا المتجر غير مفعل حالياً أو قيد المراجعة الإدارية، أو انتهت صلاحية اشتراكه. يرجى التواصل مع إدارة المحل أو المنصة لمزيد من التفاصيل.
            </p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition-all cursor-pointer shadow-lg shadow-amber-500/20"
          >
            العودة للرئيسية ودليل المتاجر ⟳
          </button>
        </div>
      </div>
    );
  }

  const storeTradeName = (shop?.name || '').trim() || 'متجر البصريات';
  const theme = resolveStoreTheme(shop?.themeKey, shop?.color);
  const isImageLogo = Boolean(shop?.logo && (/^(https?:|data:image\/|blob:|\/)/i.test(shop.logo)));
  const autoFocusReview = queryParams.get('review') === '1';
  const tryProductParam = queryParams.get('try')?.trim() || '';
  const autoTryOn = queryParams.get('tryon') === '1' || Boolean(tryProductParam);
  const showPreviewBar = isMerchantPreview;

  const products = allProductsRaw
    .filter(
      (p) =>
        p.shopId === shop?.id &&
        !p.isDeleted &&
        (isMerchantPreview || p.isPublished !== false) &&
        (!shop?.hideOutOfStockToCustomer || (p.stock ?? 1) > 0)
    )
    .map(D);

  const storeUiStorageKey = `optiverse_store_state_${slug || 'default'}`;
  const initialStoredUi = (() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.sessionStorage.getItem(storeUiStorageKey);
      return raw ? (JSON.parse(raw) as { tab?: string; cat?: string; searchQuery?: string }) : {};
    } catch {
      return {};
    }
  })();

  const [tab, setTab] = useState<'shop' | 'lens' | 'fav' | 'ord' | 'cart'>(() => {
    if (initialFrameId || autoFocusReview || autoTryOn) return 'shop';
    const saved = initialStoredUi.tab;
    if (saved === 'lens' && !rxEnabled) return 'shop';
    if (saved === 'shop' || saved === 'lens' || saved === 'fav' || saved === 'ord' || saved === 'cart') {
      return saved;
    }
    return 'shop';
  });
  const [curId, setCurId] = useState<string>(initialFrameId || products[0]?.id || '');
  const [detailId, setDetailId] = useState<string | null>(autoTryOn ? null : (initialFrameId || null));
  const cur = products.find((p) => p.id === curId) || products[0];
  const detailProduct = detailId ? products.find((p) => p.id === detailId) || null : null;

  const [cat, setCat] = useState<string>(() => initialStoredUi.cat || 'all');
  const [searchQuery, setSearchQuery] = useState<string>(() => initialStoredUi.searchQuery || '');
  const [shapeFilter, setShapeFilter] = useState<'all' | FrameShapeTag>('all');
  const [colorFilter, setColorFilter] = useState<'all' | FrameColorFamily>('all');
  const [face, setFace] = useState<FaceShape>('oval');
  const [selectedSize, setSelectedSize] = useState<FrameSize>('Medium');
  const [camOn, setCamOn] = useState<boolean>(autoTryOn);
  const [yaw, setYaw] = useState(0);

  // Smart 2-Frame Comparison State
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [cmpViewAngle, setCmpViewAngle] = useState<'front' | 'angled45'>('front');
  const [cmpSplitLive, setCmpSplitLive] = useState(false);
  const [cardSelectedColors] = useState<Record<string, string>>({});

  const [step, setStep] = useState(1);
  const [lensQuickMode, setLensQuickMode] = useState(true);
  const [lensTrack, setLensTrack] = useState<LensTrack>('single_vision');
  const [labDesign, setLabDesign] = useState<CustomLabDesign>('progressive');
  const [lensCategory, setLensCategory] = useState<LensCategoryKey>('blue_cut');
  const [photoVariant, setPhotoVariant] = useState<PhotoVariant>('photo_grey');
  const [lensIndexChoice, setLensIndexChoice] = useState<LensIndex | 'store_decide'>('store_decide');
  const [selectedLensBrandId, setSelectedLensBrandId] = useState<string>('');

  const [directOrder, setDirectOrder] = useState<{
    product: Product;
    color: string;
    size: FrameSize;
  } | null>(null);
  const [directLensMode, setDirectLensMode] = useState<'specialist' | 'custom'>('specialist');
  const [directLensChoiceId, setDirectLensChoiceId] = useState<string>('');
  const [directSubmitting, setDirectSubmitting] = useState(false);

  const [img, setImg] = useState<string | null>(null);
  const [rxLocalPreview, setRxLocalPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [pd, setPd] = useState('');
  const [cname, setCname] = useState('');
  const [cphone, setCphone] = useState('');

  const [fc, setFc] = useState(cur?.frame || '#C9A24B');
  const [lc, setLc] = useState(cur?.lens || '#475569');
  const [storeVisibleCount, setStoreVisibleCount] = useState(STORE_PAGE_SIZE);
  const pollHandledRef = useRef<string>('');
  const tryOnHandledRef = useRef<string>('');

  useEffect(() => {
    if (autoTryOn) {
      const key = `${route}|${tryProductParam}|${products.length}`;
      if (tryOnHandledRef.current !== key) {
        if (tryProductParam && products.length > 0) {
          const lowerTry = tryProductParam.toLowerCase();
          const matchedTry =
            products.find((p) => p.id === tryProductParam) ||
            products.find(
              (p) =>
                (p.code || '').trim().toLowerCase() === lowerTry ||
                (p.modelCode || '').trim().toLowerCase() === lowerTry
            );
          if (matchedTry) {
            tryOnHandledRef.current = key;
            setCurId(matchedTry.id);
            setTab('shop');
            setDetailId(null);
            setCamOn(true);
          }
        } else if (!tryProductParam) {
          tryOnHandledRef.current = key;
          setTab('shop');
          setDetailId(null);
          setCamOn(true);
        }
      }
    }
  }, [autoTryOn, tryProductParam, route, products]);

  useEffect(() => {
    setStoreVisibleCount(STORE_PAGE_SIZE);
  }, [cat, shapeFilter, colorFilter, searchQuery, shop?.id]);

  useEffect(() => {
    if (shop?.id && !isMerchantPreview) {
      recordStoreVisit(shop.id);
    }
  }, [shop?.id, isMerchantPreview]);

  useEffect(() => {
    if (typeof window === 'undefined' || !slug) return;
    try {
      window.sessionStorage.setItem(storeUiStorageKey, JSON.stringify({ tab, cat, searchQuery }));
    } catch {
      // ignore storage errors
    }
  }, [storeUiStorageKey, slug, tab, cat, searchQuery]);

  // Sync /s/[slug]/f/[frameId] route param with detail view
  useEffect(() => {
    if (initialFrameId) {
      const matched = products.find((p) => p.id === initialFrameId);
      if (matched) {
        setCurId(matched.id);
        setDetailId(autoTryOn ? null : matched.id);
        setTab('shop');
      }
    } else if (autoFocusReview && products[0]) {
      setCurId(products[0].id);
      setDetailId(products[0].id);
      setTab('shop');
    } else if (shop?.slug && route.startsWith(`/s/${shop.slug}`) && !route.includes(`/s/${shop.slug}/f/`)) {
      setDetailId(null);
    }
  }, [initialFrameId, autoFocusReview, route, shop?.slug, products.length]);

  const openFrameDetail = (frameId: string) => {
    if (!shop) return;
    setCurId(frameId);
    setDetailId(frameId);
    setTab('shop');
    navigate(`/s/${shop.slug}/f/${frameId}${isMerchantPreview ? '?preview=merchant' : ''}`);
  };

  const closeFrameDetail = () => {
    setDetailId(null);
    if (shop) {
      navigate(`/s/${shop.slug}${isMerchantPreview ? '?preview=merchant' : ''}`);
    }
  };

  // Support deep linking via ?f=FRAME_CODE, ?product=PRODUCT_ID, and ?poll=ID1,ID2 | ?poll=1
  useEffect(() => {
    const qStr = route.includes('?')
      ? route.split('?')[1]
      : typeof window !== 'undefined'
      ? window.location.search.slice(1)
      : '';
    if (!qStr) return;
    const params = new URLSearchParams(qStr);

    const pollParam = params.get('poll');
    if (pollParam && products.length > 0 && pollHandledRef.current !== `${route}|${products.length}`) {
      pollHandledRef.current = `${route}|${products.length}`;
      if (pollParam === '1' && initialFrameId) {
        const target = products.find((p) => p.id === initialFrameId);
        if (target) {
          const link =
            typeof window !== 'undefined' ? window.location.href : `https://optiverse.app/s/${shop?.slug || ''}/f/${target.id}?poll=1`;
          setModal({ t: 'vote', p: target, link });
          return;
        }
      } else if (pollParam.includes(',')) {
        const [idA, idB] = pollParam.split(',').map((s) => s.trim());
        const pA = products.find((p) => p.id === idA);
        const pB = products.find((p) => p.id === idB);
        if (pA && pB) {
          setCompareIds([pA.id, pB.id]);
          const link =
            typeof window !== 'undefined'
              ? window.location.href
              : `https://optiverse.app/s/${shop?.slug || ''}?poll=${pA.id},${pB.id}`;
          setModal({ t: 'vote', p: pA, p2: pB, link });
          return;
        }
      }
    }

    const tryParam = params.get('try')?.trim();
    if (tryParam) {
      const lowerTry = tryParam.toLowerCase();
      const targetTry =
        products.find((p) => p.id === tryParam) ||
        products.find(
          (p) =>
            (p.code || '').trim().toLowerCase() === lowerTry ||
            (p.modelCode || '').trim().toLowerCase() === lowerTry
        );
      if (targetTry) {
        setCurId(targetTry.id);
        setDetailId(null);
        setTab('shop');
        setCamOn(true);
        return;
      }
    }

    const productParam = params.get('product');
    if (productParam) {
      const targetById = products.find((p) => p.id === productParam.trim());
      if (targetById) {
        setCurId(targetById.id);
        setDetailId(targetById.id);
        setTab('shop');
        return;
      }
    }
    const codeParam = params.get('f');
    if (codeParam) {
      const target = products.find((p) => (p.code || '').toUpperCase() === codeParam.trim().toUpperCase());
      if (target) {
        setCurId(target.id);
      }
    }
  }, [route, shop?.id, shop?.slug, initialFrameId, products.length]);

  useEffect(() => {
    if (cur) {
      setFc(cardSelectedColors[cur.id] || cur.frame);
      setLc(cur.lens);
      const sizes = cur.availableSizes && cur.availableSizes.length ? cur.availableSizes : (['Small', 'Medium', 'Large'] as FrameSize[]);
      setSelectedSize(sizes.includes('Medium') ? 'Medium' : sizes[0]);
    }
  }, [cur?.id]);

  // Dynamic Local SEO: title, meta description, OpenGraph, canonical URL, and Schema.org Optician JSON-LD
  useEffect(() => {
    if (!shop || typeof document === 'undefined') return;

    const prevTitle = document.title;
    const locationLabel = shop.governorate || shop.city || 'مصر';
    const seoTitle = `${storeTradeName} | نظارات طبية وشمسية بتجربة 3D في ${locationLabel}`;
    const seoDescription =
      shop.tagline?.trim() ||
      `تصفّح أحدث النظارات الطبية والشمسية في ${storeTradeName} (${locationLabel}) وجرّبها على وجهك مباشرة بالكاميرا 3D بمقياس 1:1 mm مع إرسال الكشف عبر واتساب.`;
    const canonicalUrl =
      typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '';

    document.title = seoTitle;

    const managedPrevious: { el: Element; attr: string; prevValue: string | null; created: boolean }[] = [];
    const upsertMetaTag = (selector: string, createAttr: 'name' | 'property', key: string, content: string) => {
      let el = document.head.querySelector(selector);
      let created = false;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(createAttr, key);
        document.head.appendChild(el);
        created = true;
      }
      managedPrevious.push({ el, attr: 'content', prevValue: el.getAttribute('content'), created });
      el.setAttribute('content', content);
    };

    upsertMetaTag('meta[name="description"]', 'name', 'description', seoDescription);
    upsertMetaTag('meta[property="og:title"]', 'property', 'og:title', seoTitle);
    upsertMetaTag('meta[property="og:description"]', 'property', 'og:description', seoDescription);
    upsertMetaTag('meta[name="twitter:title"]', 'name', 'twitter:title', seoTitle);
    upsertMetaTag('meta[name="twitter:description"]', 'name', 'twitter:description', seoDescription);
    if (canonicalUrl) {
      upsertMetaTag('meta[property="og:url"]', 'property', 'og:url', canonicalUrl);
    }

    let canonicalEl = document.head.querySelector('link[rel="canonical"]');
    let canonicalCreated = false;
    const prevCanonicalHref = canonicalEl?.getAttribute('href') ?? null;
    if (canonicalUrl) {
      if (!canonicalEl) {
        canonicalEl = document.createElement('link');
        canonicalEl.setAttribute('rel', 'canonical');
        document.head.appendChild(canonicalEl);
        canonicalCreated = true;
      }
      canonicalEl.setAttribute('href', canonicalUrl);
    }

    const jsonLdId = 'optiverse-store-jsonld';
    let jsonLdScript = document.getElementById(jsonLdId) as HTMLScriptElement | null;
    if (!jsonLdScript) {
      jsonLdScript = document.createElement('script');
      jsonLdScript.id = jsonLdId;
      jsonLdScript.type = 'application/ld+json';
      document.head.appendChild(jsonLdScript);
    }

    const opticianSchema: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Optician',
      name: storeTradeName,
      description: seoDescription,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      ...(shop.wa ? { telephone: shop.wa } : {}),
      ...(isImageLogo && shop.logo ? { image: shop.logo, logo: shop.logo } : {}),
      address: {
        '@type': 'PostalAddress',
        ...(shop.address ? { streetAddress: shop.address } : {}),
        addressLocality: shop.city || locationLabel,
        addressRegion: shop.governorate || shop.city || locationLabel,
        addressCountry: 'EG',
      },
      ...(shop.mapsUrl && /^https?:\/\//i.test(shop.mapsUrl) ? { hasMap: shop.mapsUrl } : {}),
    };
    jsonLdScript.textContent = JSON.stringify(opticianSchema);

    return () => {
      document.title = prevTitle;
      for (const item of managedPrevious) {
        if (item.created) item.el.remove();
        else if (item.prevValue !== null) item.el.setAttribute(item.attr, item.prevValue);
      }
      if (canonicalEl) {
        if (canonicalCreated) canonicalEl.remove();
        else if (prevCanonicalHref !== null) canonicalEl.setAttribute('href', prevCanonicalHref);
      }
      document.getElementById(jsonLdId)?.remove();
    };
  }, [
    shop?.id,
    shop?.name,
    shop?.governorate,
    shop?.city,
    shop?.tagline,
    shop?.address,
    shop?.wa,
    shop?.mapsUrl,
    shop?.logo,
    isImageLogo,
    route,
  ]);

  if (!shop) {
    return (
      <div dir="rtl" className="min-h-[100dvh] bg-[#F8F9FA] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-3xl mb-4">
          👓
        </div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-[#0F172A] mb-2">المتجر غير موجود</h1>
        <p className="text-sm text-slate-500 max-w-md mb-6 leading-relaxed">
          عذراً، لم نتمكن من العثور على المتجر المطلوب. قد يكون الرابط غير صحيح أو تم تغيير عنوان المتجر.
        </p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="btn btn-p px-6 py-2.5 text-sm font-bold shadow-sm cursor-pointer"
        >
          العودة للرئيسية
        </button>
      </div>
    );
  }

  if (isShopExpiredOrPaused(shop)) {
    const isExpired = shop.status === 'expired' || shop.status === 'trial';
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="glass rounded-3xl p-8 max-w-md text-center space-y-3">
          <span className="w-16 h-16 rounded-full b-warn inline-flex items-center justify-center">
            <I n="pause" s={28} />
          </span>
          <h1 className="font-extrabold text-xl">{storeTradeName}</h1>
          <p className="text-sm opacity-75 leading-7">
            {isExpired
              ? 'هذا المتجر متوقف مؤقتاً لحين تجديد اشتراكه. تواصل مع إدارة المحل لمزيد من التفاصيل.'
              : 'هذا المتجر متوقف مؤقتاً حالياً. تواصل مع إدارة المحل لمزيد من التفاصيل.'}
          </p>
        </div>
      </div>
    );
  }

  if (!cur) {
    return (
      <div
        className="min-h-[100dvh] flex items-center justify-center p-4"
        style={{ '--acc': theme.accent, backgroundColor: theme.pageBg, color: theme.text } as React.CSSProperties}
      >
        <div className="glass rounded-3xl p-8 max-w-md text-center space-y-3">
          <span
            className="w-14 h-14 rounded-2xl text-white text-2xl inline-flex items-center justify-center overflow-hidden"
            style={{ backgroundColor: theme.primary }}
          >
            {isImageLogo ? (
              <img src={shop.logo} alt={storeTradeName} className="w-full h-full object-contain bg-white p-1" />
            ) : (
              shop.logo
            )}
          </span>
          <h1 className="font-extrabold text-xl">{storeTradeName}</h1>
          <p className="text-sm opacity-75">لا توجد نظارات منشورة في هذا المتجر حالياً — ترقّب أحدث الموديلات قريباً.</p>
        </div>
      </div>
    );
  }

  const activeCatMeta = LENS_CATEGORIES.find((c) => c.key === lensCategory) || LENS_CATEGORIES[0];
  const effectivePhotoVariant: PhotoVariant = activeCatMeta.variants.includes(photoVariant)
    ? photoVariant
    : activeCatMeta.variants[0];
  const effectiveIndexChoice: LensIndex | 'store_decide' =
    lensIndexChoice === 'store_decide' || activeCatMeta.indices.includes(lensIndexChoice)
      ? lensIndexChoice
      : activeCatMeta.indices[0];

  const officialBrandsList = platformSettings.officialLensBrands?.length
    ? platformSettings.officialLensBrands
    : DEFAULT_OFFICIAL_LENS_BRANDS;

  const customerBrandOptions = resolveCustomerLensBrands({
    officialBrands: officialBrandsList,
    merchantConfigs: shop.merchantLensConfigs || [],
    shopId: shop.id,
    track: lensTrack,
    labDesign,
    categoryKey: lensCategory,
    variant: effectivePhotoVariant,
    indexOrStoreDecide: effectiveIndexChoice,
  });

  const selectedBrandOption =
    customerBrandOptions.find((b) => b.brandId === selectedLensBrandId) || customerBrandOptions[0];

  const lensEstimatedPrice = selectedBrandOption
    ? selectedBrandOption.isStoreDecide
      ? selectedBrandOption.minPrice
      : selectedBrandOption.exactPrice ?? selectedBrandOption.minPrice
    : 0;
  const total = cur.price + lensEstimatedPrice;

  const trackLabelAr =
    lensTrack === 'single_vision'
      ? 'رؤية واحدة (Single Vision)'
      : `تصنيع (${labDesign === 'progressive' ? 'مالتي فوكال Progressive' : 'باي فوكال Bifocal'})`;
  const indexLabelAr =
    effectiveIndexChoice === 'store_decide'
      ? 'تحديد الضغط بواسطة المتجر بعد مراجعة الكشف'
      : LENS_INDEX_META[effectiveIndexChoice].labelAr;
  const variantSuffix =
    effectivePhotoVariant !== 'none' ? ` · ${PHOTO_VARIANT_LABELS[effectivePhotoVariant]}` : '';

  const isActiveNewCollection = (p: Product) =>
    Boolean(p.isNewCollection && (!p.newCollectionUntil || Date.parse(p.newCollectionUntil) > Date.now()));
  const newestFrames = [
    ...products.filter(isActiveNewCollection).reverse(),
    ...products.filter((p) => !isActiveNewCollection(p)).slice(-6).reverse(),
  ].slice(0, 6);
  const newestFrameIds = new Set(newestFrames.map((np) => np.id));

  const matchesFilter = (p: Product, filterId: string): boolean => {
    if (filterId !== 'all') {
      if (filterId === 'new_arrivals' && !newestFrameIds.has(p.id) && !isActiveNewCollection(p)) {
        return false;
      }
      if (filterId === 'best_fit' && faceMatch(p, face) < 82) {
        return false;
      }
      if (
        filterId === 'prescription' &&
        !(p.frameType === 'prescription' || (!p.frameType && (p.cat === 'med' || p.cat === 'safe') && p.type !== 'rimless'))
      ) {
        return false;
      }
      if (filterId === 'sunglasses' && !(p.frameType === 'sunglasses' || (!p.frameType && p.cat === 'sun'))) {
        return false;
      }
      if (filterId === 'clip_on' && p.frameType !== 'clip_on') return false;
      if (filterId === 'kids' && p.frameType !== 'kids') return false;
      if (
        filterId === 'metal' &&
        !(p.frameType === 'metal' || p.modelCalibration?.material === 'metal' || (!p.frameType && p.type === 'rimless'))
      ) {
        return false;
      }
    }
    if (shapeFilter !== 'all' && resolveProductShapeTag(p) !== shapeFilter) return false;
    if (colorFilter !== 'all' && resolveProductColorFamily(p) !== colorFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const hay = `${p.name} ${p.code} ${p.modelCode || ''} ${p.description || ''} ${TYPES[p.type] || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const filteredProducts = products.filter((p) => matchesFilter(p, cat));
  const inquiryOrderCount = (p: Product) => {
    const pName = p.name.trim().toLowerCase();
    return inq.filter(
      (q) => q.shopId === shop?.id && (q.frameName || '').toLowerCase().includes(pName)
    ).length;
  };
  const sortedProducts =
    cat === 'best_fit'
      ? [...filteredProducts].sort((a, b) => faceMatch(b, face) - faceMatch(a, face))
      : cat === 'best_selling'
      ? [...filteredProducts].sort((a, b) => {
          const diff = inquiryOrderCount(b) - inquiryOrderCount(a);
          if (diff !== 0) return diff;
          const newDiff = Number(isActiveNewCollection(b)) - Number(isActiveNewCollection(a));
          if (newDiff !== 0) return newDiff;
          return (a.stock ?? 99) - (b.stock ?? 99);
        })
      : filteredProducts;

  // Group duplicate modelCode variants on one card when shop.groupColorsInStore is enabled
  const groupedVariantMap = new Map<string, Product[]>();
  const list: Product[] = [];
  if (shop.groupColorsInStore) {
    const seenModels = new Map<string, Product>();
    for (const p of sortedProducts) {
      const mk = (p.modelCode || '').trim().toLowerCase();
      if (!mk) {
        list.push(p);
        continue;
      }
      const existingList = groupedVariantMap.get(mk) || [];
      existingList.push(p);
      groupedVariantMap.set(mk, existingList);
      if (!seenModels.has(mk)) {
        seenModels.set(mk, p);
        list.push(p);
      }
    }
  } else {
    list.push(...sortedProducts);
  }
  const coatInfo = getCoatingStyle(activeCatMeta.coatingPreviewId, yaw);

  const cmpA = compareIds[0] ? products.find((p) => p.id === compareIds[0]) : undefined;
  const cmpB = compareIds[1] ? products.find((p) => p.id === compareIds[1]) : undefined;
  const fitRationaleAr = (p: Product) => {
    const score = faceMatch(p, face);
    if (score >= 90) return 'تناسب عرض الوجنتين وتبرز توازن الملامح';
    if (score >= 82) return 'خطوط إطار متزنة تمنحك إطلالة يومية أنيقة';
    return 'تصميم جريء يضيف تبايناً عصرياً على ملامحك';
  };

  const addCart = (item: Omit<typeof cart[number], 'key'>) => {
    setCart((c) => [...c, { ...item, key: String(Date.now() + Math.random()) }]);
    toast('تمت الإضافة إلى السلة ✓');
  };

  const cartTotal = cart.reduce((s, i) => s + i.price, 0);
  const mine = inq.filter((q) => q.shopId === shop.id && q.mine);

  const uploadDataUrlToRxBucket = async (dataUrl: string, targetShopId: string): Promise<string> => {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
    return uploadRxPrescriptionToStorage(targetShopId, blob, ext);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (f.type && !allowedMime.includes(f.type) && !f.type.startsWith('image/') && !isPdf) {
      toast('نوع الملف غير مدعوم — يُسمح بصور JPG/PNG/WebP أو PDF فقط');
      return;
    }

    const previewReader = new FileReader();
    previewReader.onload = () => {
      if (!isPdf) setRxLocalPreview(String(previewReader.result || ''));
    };
    if (!isPdf) previewReader.readAsDataURL(f);

    try {
      if (isPdf) {
        if (f.size > 5 * 1024 * 1024) {
          toast('حجم ملف الـ PDF يتجاوز الحد المسموح (5 ميجابايت)');
          return;
        }
        const storageRef = await uploadRxPrescriptionToStorage(shop.id, f, 'pdf');
        setRxLocalPreview('pdf');
        setImg(storageRef);
        toast('تم رفع ملف الكشف الطبي (PDF) بأمان ✓');
        return;
      }

      const c = await loadImageToCanvas(f, 1600);
      let blob = await canvasToBlob(c, 'image/jpeg', 0.85);
      if (blob.size > 4_800_000) {
        blob = await canvasToBlob(c, 'image/jpeg', 0.65);
      }
      if (blob.size > 5 * 1024 * 1024) {
        toast('حجم صورة الكشف كبير جداً — الحد الأقصى 5 ميجابايت');
        return;
      }
      const storageRef = await uploadRxPrescriptionToStorage(shop.id, blob, 'jpg');
      setImg(storageRef);
      toast('تم رفع وضغط صورة الكشف بأمان ✓');
    } catch {
      toast('تعذر رفع ملف الكشف — تأكد من الحجم (حد أقصى 5 ميجابايت)');
    }
  };

  const shopLensChoices = rxEnabled
    ? lensTypes.filter((l) => (l.shopId || DEFAULT_SHOP_ID) === shop.id && l.on !== false)
    : [];

  const submitRx = async () => {
    if (!cname.trim() || !cphone.trim()) {
      toast('اكتب اسمك ورقم موبايلك أولاً');
      return;
    }
    const isSpecialistQuick = lensQuickMode;
    const brandDisplay = isSpecialistQuick
      ? 'يُحدد مع أخصائي المحل'
      : selectedBrandOption
      ? `${selectedBrandOption.nameAr}${
          selectedBrandOption.sponsorBadge !== 'none'
            ? ` (${SPONSOR_BADGE_LABELS[selectedBrandOption.sponsorBadge]})`
            : ''
        }`
      : '—';
    const estDaysTxt =
      !isSpecialistQuick && lensTrack === 'custom_lab' && selectedBrandOption?.estimatedDays
        ? ` · مدة التجهيز المتوقعة: ${selectedBrandOption.estimatedDays} أيام`
        : '';

    const q: Inquiry = {
      id: '#Q-' + (320 + Math.floor(Math.random() * 600)),
      shopId: shop.id,
      kind: 'rx',
      cust: cname.trim(),
      phone: cphone.trim(),
      frameName: cur.name,
      type: cur.type,
      frame: fc,
      lens: lc,
      lensName: isSpecialistQuick
        ? 'تحديد العدسات مع أخصائي المحل (موصى به)'
        : `${activeCatMeta.nameAr}${variantSuffix}`,
      brandName: brandDisplay,
      extrasTxt: isSpecialistQuick
        ? `مقاس ${selectedSize} · مراجعة الكشف وتحديد الأنسب مع أخصائي المحل`
        : `${trackLabelAr} · ${indexLabelAr}${estDaysTxt}`,
      fp: cur.price,
      lensPrice: isSpecialistQuick ? 0 : lensEstimatedPrice,
      add: 0,
      price: isSpecialistQuick ? cur.price : total,
      img,
      notes,
      pd,
      status: 'new',
      stage: 'review',
      time: 'الآن',
      mine: true,
      rxn: Math.floor(Math.random() * 4),
    };
    await addInquiry(q);
    setModal({ t: 'sent', q });
    setRxLocalPreview(null);
    setImg(null);
    setNotes('');
    setStep(1);
  };

  const submitDirectOrder = async () => {
    if (!directOrder) return;
    if (!cname.trim() || !cphone.trim()) {
      toast('اكتب اسمك ورقم موبايلك أولاً');
      return;
    }
    setDirectSubmitting(true);
    try {
      const targetProd = D(directOrder.product);
      const chosenCustomShopLens = shopLensChoices.find((l) => l.id === directLensChoiceId);
      const chosenCatLens = LENS_CATEGORIES.find((c) => c.key === directLensChoiceId);
      const isSpecialist = directLensMode === 'specialist';
      const customLensLabel =
        chosenCustomShopLens?.name || chosenCatLens?.nameAr || `${activeCatMeta.nameAr}${variantSuffix}`;
      const customLensPrice = chosenCustomShopLens?.price ?? (isSpecialist ? 0 : lensEstimatedPrice);

      const q: Inquiry = {
        id: '#Q-' + (320 + Math.floor(Math.random() * 600)),
        shopId: shop.id,
        kind: 'rx',
        cust: cname.trim(),
        phone: cphone.trim(),
        frameName: `${targetProd.name} (${directOrder.size})`,
        type: targetProd.type,
        frame: directOrder.color,
        lens: targetProd.lens,
        lensName: isSpecialist ? 'تحديد العدسات مع أخصائي المحل (موصى به)' : customLensLabel,
        brandName: isSpecialist ? 'يُحدد مع المحل' : 'اختيار العميل',
        extrasTxt: isSpecialist
          ? `طلب شمبر مباشر (${directOrder.color === 'transparent' ? 'شفاف' : directOrder.color}) · مراجعة الكشف مع أخصائي المحل`
          : `طلب شمبر مباشر · نوع العدسة المختار: ${customLensLabel}`,
        fp: targetProd.price,
        lensPrice: isSpecialist ? 0 : customLensPrice,
        add: 0,
        price: targetProd.price + (isSpecialist ? 0 : customLensPrice),
        img,
        notes,
        pd,
        status: 'new',
        stage: 'review',
        time: 'الآن',
        mine: true,
        rxn: Math.floor(Math.random() * 4),
      };
      await addInquiry(q);
      setDirectOrder(null);
      setRxLocalPreview(null);
      setImg(null);
      setNotes('');
      setModal({ t: 'sent', q });
      toast('تم إرسال طلبك والكشف الطبي للمحل ✓');
    } finally {
      setDirectSubmitting(false);
    }
  };

  const Heart = ({ p }: { p: Product }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setFav((f) => (f.includes(p.id) ? f.filter((x) => x !== p.id) : [...f, p.id]));
      }}
      className="w-11 h-11 rounded-full bg-white/85 hover:bg-white border border-stone-200/80 shadow-xs backdrop-blur-sm flex items-center justify-center cursor-pointer transition-transform duration-150 active:scale-[0.97]"
      style={{ color: fav.includes(p.id) ? '#f43f5e' : '#334155' }}
      aria-label="المفضلة"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={fav.includes(p.id) ? '#f43f5e' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d={ICON_PATHS.heart} />
      </svg>
    </button>
  );

  const nav: [typeof tab, string, string][] = [
    ['shop', 'المتجر', 'store'],
    ...(rxEnabled ? ([['lens', 'العدسات', 'eye']] as [typeof tab, string, string][]) : []),
    ['fav', 'المفضلة', 'heart'],
    ['ord', 'طلباتي', 'receipt'],
    ['cart', 'السلة', 'bag'],
  ];
  const steps = ['نوع الكشف', 'خاصية العدسة', 'ضغط العدسة', 'الشركة والكشف'];

  const scrollToElement = (elId: string) => {
    if (typeof document === 'undefined') return;
    document.getElementById(elId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      className="pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-h-[100dvh] overflow-x-hidden"
      style={
        {
          '--acc': theme.accent,
          backgroundColor: theme.pageBg,
          color: theme.text,
        } as React.CSSProperties
      }
    >
      {/* Merchant Preview Return Bar (Strictly visible ONLY when ?preview=merchant) */}
      {showPreviewBar && (
        <div className="bg-slate-900 text-amber-400 border-b border-amber-400/25 px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 text-xs sm:text-sm">
            <span className="font-bold flex items-center gap-1.5 truncate">
              <I n="eye" s={15} /> أنت الآن في وضع المعاينة كعميل
            </span>
            <button
              type="button"
              onClick={() => navigate('/merchant')}
              className="min-h-[44px] px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs whitespace-nowrap shrink-0 cursor-pointer transition-transform duration-150 active:scale-[0.97]"
            >
              العودة للوحة التحكم ↩
            </button>
          </div>
        </div>
      )}

      {shop.promoBannerEnabled && shop.promoBannerText?.trim() && (
        <div
          className="w-full px-4 py-2 text-center text-xs sm:text-sm font-extrabold text-white shadow-xs"
          style={{ backgroundColor: theme.primary }}
        >
          {shop.promoBannerText.trim()}
        </div>
      )}

      {/* Translucent Frosted Glass Store Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/85 border-b border-stone-200/75">
        <div className="max-w-7xl mx-auto px-3 sm:px-5 py-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="justify-self-start flex items-center min-w-0">
            {directoryEnabled && (
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2.5 py-1.5 rounded-xl bg-[#FAF8F5] hover:bg-stone-100 border border-stone-200/85 text-xs font-bold text-[#0F172A] whitespace-nowrap cursor-pointer transition-transform duration-150 active:scale-[0.97]"
                onClick={() => navigate('/stores')}
              >
                <I n="map" s={14} /> <span className="hidden sm:inline">دليل المحلات</span>
              </button>
            )}
          </div>

          <div className="justify-self-center flex items-center justify-center gap-2 min-w-0 max-w-[185px] sm:max-w-sm">
            <span
              className="w-9 h-9 rounded-xl text-white text-base flex items-center justify-center shadow-xs shrink-0 overflow-hidden border border-stone-200/60"
              style={{ backgroundColor: theme.primary }}
            >
              {isImageLogo ? (
                <img src={shop.logo} alt={storeTradeName} className="w-full h-full object-contain bg-white p-0.5" />
              ) : (
                shop.logo
              )}
            </span>
            <div className="min-w-0 text-center">
              <div className="font-extrabold text-sm sm:text-base leading-tight truncate flex items-center justify-center gap-1 text-[#0F172A]">
                <span className="truncate">{storeTradeName}</span>
                {shop.isFeatured && <span title="متجر مميز">⭐</span>}
              </div>
              <div className="text-[0.65rem] text-slate-500 truncate hidden sm:block">
                {shop.governorate || shop.city}
              </div>
            </div>
          </div>

          <div className="justify-self-end flex items-center gap-1.5">
            {Boolean(shop.mapsUrl && /^https?:\/\//i.test(shop.mapsUrl)) && (
              <a
                href={shop.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="hidden sm:inline-flex items-center gap-1 min-h-[44px] px-2.5 py-1.5 rounded-xl bg-[#FAF8F5] hover:bg-stone-100 border border-stone-200/85 text-xs font-bold text-[#0F172A] transition-transform duration-150 active:scale-[0.97]"
              >
                <I n="map" s={13} /> الخريطة
              </a>
            )}
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl bg-[#0F172A] text-[#FAF8F5] text-xs font-extrabold whitespace-nowrap shrink-0 cursor-pointer transition-transform duration-150 active:scale-[0.97] shadow-xs"
              onClick={() => setTab('cart')}
              aria-label="السلة"
            >
              <I n="bag" s={15} /> <span className="tabular-nums">{cart.length}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 sm:px-5 pt-4 pb-8">

        {/* Optional Business Hours & Quick Contact Bar */}
        {shop.showBusinessHoursBar && (() => {
          const startStr = shop.workingHoursStart || '10:00';
          const endStr = shop.workingHoursEnd || '22:00';
          const parseMin = (hhmm: string) => {
            const [hh, mm] = hhmm.split(':').map((x) => parseInt(x, 10) || 0);
            return hh * 60 + mm;
          };
          const startMin = parseMin(startStr);
          const endMin = parseMin(endStr);
          let nowMin = new Date().getHours() * 60 + new Date().getMinutes();
          try {
            const parts = new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Africa/Cairo',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).formatToParts(new Date());
            const hh = parseInt(parts.find((p) => p.type === 'hour')?.value || '12', 10);
            const mm = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
            if (!isNaN(hh) && !isNaN(mm)) nowMin = (hh % 24) * 60 + mm;
          } catch {
            // fallback local clock
          }
          const isOpen =
            endMin >= startMin
              ? nowMin >= startMin && nowMin <= endMin
              : nowMin >= startMin || nowMin <= endMin;

          return (
            <div className="mb-4 rounded-2xl bg-white border border-slate-200 px-4 py-2.5 shadow-sm flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span
                  className={
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-extrabold ' +
                    (isOpen
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200')
                  }
                >
                  <span className={'w-2 h-2 rounded-full ' + (isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500')} />
                  {isOpen ? 'مفتوح الآن' : 'مغلق الآن'}
                </span>
                <span className="text-slate-600 font-bold" dir="ltr">
                  {startStr} - {endStr}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`tel:${shop.wa}`}
                  className="min-h-[44px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold inline-flex items-center gap-1 transition"
                >
                  📞 اتصال
                </a>
                <a
                  href={`https://wa.me/${waNum(shop.wa)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-h-[44px] px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold inline-flex items-center gap-1 transition"
                >
                  <I n="msg" s={13} /> واتساب
                </a>
              </div>
            </div>
          );
        })()}

        {/* Editorial Hero Banner (Shown ONLY on main Storefront shop grid) */}
        {tab === 'shop' && !detailProduct && (
          <div
            className="relative overflow-hidden rounded-3xl border border-[#E2E8F0] shadow-md mb-6 min-h-[250px] sm:min-h-[295px] flex items-end"
            style={{
              background:
                shop.videoUrl || shop.bannerImageUrl
                  ? '#0F172A'
                  : `linear-gradient(135deg, ${theme.primary} 0%, #0F172A 65%, ${theme.accent} 145%)`,
            }}
          >
            {shop.videoUrl ? (
              <video
                src={shop.videoUrl}
                autoPlay
                muted
                loop
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : shop.bannerImageUrl ? (
              <img
                src={shop.bannerImageUrl}
                alt={storeTradeName}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-end px-8 sm:px-14 opacity-[0.14]">
                {isImageLogo ? (
                  <img
                    src={shop.logo}
                    alt=""
                    className="w-40 h-40 sm:w-52 sm:h-52 object-contain rounded-3xl bg-white/95 p-3 shadow-2xl"
                  />
                ) : (
                  <span className="text-[7rem] sm:text-[9rem] select-none">{shop.logo}</span>
                )}
              </div>
            )}
            <div
              className="absolute inset-0"
              style={{
                background:
                  shop.videoUrl || shop.bannerImageUrl
                    ? 'linear-gradient(180deg, rgba(15,23,42,0.28) 0%, rgba(15,23,42,0.58) 55%, rgba(15,23,42,0.92) 100%)'
                    : 'linear-gradient(180deg, rgba(15,23,42,0.12) 0%, rgba(15,23,42,0.48) 100%)',
              }}
            />
            <div className="relative z-10 w-full p-5 sm:p-8 flex flex-col md:flex-row md:items-end justify-between gap-4 text-white">
              <div className="max-w-xl">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/95 text-[#0F172A] text-2xl sm:text-3xl flex items-center justify-center shadow-md shrink-0 overflow-hidden border border-white/40">
                    {isImageLogo ? (
                      <img src={shop.logo} alt={storeTradeName} className="w-full h-full object-contain p-1" />
                    ) : (
                      shop.logo
                    )}
                  </span>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-xs font-bold text-amber-200">
                    <I n="spark" s={13} />
                    <span>
                      تجربة افتراضية بمقياس <span dir="ltr">1:1 mm</span> من منزلك
                    </span>
                  </div>
                </div>
                <h1 className="text-2xl sm:text-4xl font-extrabold leading-tight">{storeTradeName}</h1>
                <p className="text-xs sm:text-sm text-slate-200 mt-1.5 leading-6">
                  {shop.tagline?.trim()
                    ? shop.tagline
                    : rxEnabled
                    ? 'تصفّح أحدث الإطارات، جرّبها على وجهك مباشرة بالكاميرا 3D، واطلب بالعدسات الطبية عبر واتساب.'
                    : 'تصفّح أحدث الإطارات بتصوير استوديو احترافي وجرّبها على وجهك بالكاميرا 3D قبل الطلب.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setTab('shop');
                    setDetailId(null);
                    setTimeout(() => scrollToElement('catalog-all'), 60);
                  }}
                  className="btn !bg-white hover:!bg-slate-100 !text-[#0F172A] !px-4 !py-2.5 text-xs sm:text-sm shadow-sm active:scale-[0.97] transition-transform duration-150"
                >
                  تصفّح مجموعة النظارات
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('shop');
                    setDetailId(null);
                    setCamOn(true);
                  }}
                  className="btn !bg-[#0284C7] hover:!bg-[#0369A1] !text-white !px-4 !py-2.5 text-xs sm:text-sm shadow-sm active:scale-[0.97] transition-transform duration-150"
                >
                  <I n="camera" s={16} /> جرّب بالكاميرا <span dir="ltr">3D</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'shop' && detailProduct && (
          <div className="mb-6 pb-28">
            <ProductDetailsView
              product={detailProduct}
              relatedProducts={products.filter((p) => p.id !== detailProduct.id)}
              initialColor={detailProduct.id === cur.id ? fc : detailProduct.frame}
              initialSize={selectedSize}
              isFavorite={fav.includes(detailProduct.id)}
              autoFocusReview={autoFocusReview}
              initialRxUrl={rxLocalPreview && rxLocalPreview !== 'pdf' ? rxLocalPreview : img}
              onRxAttached={async (rxUrl) => {
                if (!rxUrl) {
                  setRxLocalPreview(null);
                  setImg(null);
                  return;
                }
                setRxLocalPreview(rxUrl);
                if (rxUrl.startsWith('data:')) {
                  try {
                    const stored = await uploadDataUrlToRxBucket(rxUrl, shop.id);
                    setImg(stored);
                  } catch {
                    setImg(rxUrl);
                  }
                } else {
                  setImg(rxUrl);
                }
                toast('تم حفظ صورة الكشف للخطوة الأخيرة ✓');
              }}
              onToggleFavorite={() =>
                setFav((f) =>
                  f.includes(detailProduct.id) ? f.filter((x) => x !== detailProduct.id) : [...f, detailProduct.id]
                )
              }
              onBack={closeFrameDetail}
              onSelectRelated={(rid) => openFrameDetail(rid)}
              onTryOn={(color, size) => {
                setCurId(detailProduct.id);
                setFc(color);
                setSelectedSize(size);
                closeFrameDetail();
                setCamOn(true);
              }}
              onAddToCart={(color, size) => {
                addCart({
                  productId: detailProduct.id,
                  name: detailProduct.name,
                  desc: `إطار فقط · مقاس ${size}`,
                  price: detailProduct.price,
                  type: detailProduct.type,
                  frame: color,
                  lens: detailProduct.lens,
                  size,
                });
              }}
              onGoCheckout={(color, size) => {
                setCurId(detailProduct.id);
                setFc(color);
                setSelectedSize(size);
                setDirectLensMode('specialist');
                setDirectLensChoiceId('');
                setDirectOrder({ product: detailProduct, color, size });
              }}
            />
          </div>
        )}

        {/* Headless Live 3D Camera / Customer Photo Try-On Controller (Zero dummy portrait inline) */}
        <FaceTryOnStage
          product={cur}
          products={products}
          onSelectProduct={setCurId}
          onOrderProduct={(pid) => {
            const targetProd = products.find((p) => p.id === pid) || cur;
            setCurId(pid);
            setCamOn(false);
            setDirectLensMode('specialist');
            setDirectLensChoiceId('');
            setDirectOrder({ product: targetProd, color: fc, size: selectedSize });
          }}
          initialRxUrl={rxLocalPreview && rxLocalPreview !== 'pdf' ? rxLocalPreview : img}
          onRxAttached={async (rxUrl) => {
            if (!rxUrl) {
              setRxLocalPreview(null);
              setImg(null);
              return;
            }
            setRxLocalPreview(rxUrl);
            if (rxUrl.startsWith('data:')) {
              try {
                const stored = await uploadDataUrlToRxBucket(rxUrl, shop.id);
                setImg(stored);
              } catch {
                setImg(rxUrl);
              }
            } else {
              setImg(rxUrl);
            }
            toast('تم إرفاق روشتة كشف النظر ✓');
          }}
          frameColor={fc}
          lensColor={lc}
          frameSize={selectedSize}
          coatingId={activeCatMeta.coatingPreviewId}
          faceShape={face}
          onFaceShapeDetected={setFace}
          camOn={camOn}
          onStartCam={() => setCamOn(true)}
          onModeChange={(m) => {
            if (m === 'photo') setCamOn(false);
          }}
        />

        {tab === 'shop' && !detailProduct && (
          <div className="space-y-8 fade">
            {/* Section 1: مجموعة النظارات الكاملة (Search + Horizontal Filter Chips) */}
            <section id="catalog-all" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl sm:text-2xl font-extrabold text-[#0F172A]">مجموعة النظارات الكاملة</h2>
                {(cat !== 'all' || shapeFilter !== 'all' || colorFilter !== 'all' || searchQuery.trim() !== '') && (
                  <button
                    type="button"
                    onClick={() => {
                      setCat('all');
                      setShapeFilter('all');
                      setColorFilter('all');
                      setSearchQuery('');
                    }}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer inline-flex items-center justify-center"
                  >
                    إظهار جميع النظارات ✕
                  </button>
                )}
              </div>

              {/* Search Input & Horizontal Category Chips */}
              <div className="space-y-3">
                <div className="relative">
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث باسم الموديل أو الكود أو الشكل..."
                    className="w-full min-h-[44px] rounded-2xl bg-white border border-slate-200 focus:border-[#0284C7] ps-10 pe-4 py-2.5 text-base text-[#0F172A] outline-none shadow-sm transition"
                  />
                  <span className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    🔍
                  </span>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 noscroll">
                  {(
                    [
                      ['all', 'الكل'],
                      ['prescription', 'طبية'],
                      ['sunglasses', 'شمسية'],
                      ['best_selling', 'الأكثر مبيعاً'],
                      ['new_arrivals', 'وصل حديثاً ✨'],
                      ['metal', 'معادن'],
                      ['best_fit', 'الأكثر ملاءمة لوجهك'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCat(id)}
                      className={
                        'min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-full text-xs font-extrabold whitespace-nowrap border transition-all duration-150 active:scale-[0.97] cursor-pointer shrink-0 ' +
                        (cat === id
                          ? 'bg-[#0F172A] text-[#FAF8F5] border-[#0F172A] shadow-sm'
                          : 'bg-[#FAF8F5] text-[#0F172A] border-stone-200/90 hover:border-stone-400')
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {list.slice(0, storeVisibleCount).map((p) => {
                  const modelKey = (p.modelCode || '').trim().toLowerCase();
                  const groupVariants = shop.groupColorsInStore && modelKey ? groupedVariantMap.get(modelKey) || [p] : [p];
                  const mergedSwatches = Array.from(
                    new Set(
                      groupVariants.flatMap((gp) =>
                        gp.frameColors && gp.frameColors.length > 0
                          ? gp.frameColors
                          : gp.availableColors && gp.availableColors.length > 0
                          ? gp.availableColors
                          : [gp.frameHexColor || gp.frame]
                      )
                    )
                  );
                  const swatches =
                    mergedSwatches.length > 0
                      ? mergedSwatches
                      : [p.frame, '#0F172A', '#7A4A2B', '#CBD5E1'].filter((c, i, arr) => arr.indexOf(c) === i);
                  const activeSwatch = cardSelectedColors[p.id] || swatches[0];
                  const activeVariant =
                    groupVariants.find((gp) => (gp.frameHexColor || gp.frame) === activeSwatch) || p;
                  const storeImg = resolveStoreFrontUrl(activeVariant);

                  return (
                    <div
                      key={p.id}
                      onClick={() => openFrameDetail(activeVariant.id)}
                      className="rounded-2xl bg-[#FAF8F5] border border-stone-200/85 p-3 sm:p-4 cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97] text-[#0F172A] flex flex-col"
                    >
                      <div className="relative rounded-xl bg-white/85 border border-stone-100/90 px-3 py-5 flex items-center justify-center min-h-[170px] sm:min-h-[205px]">
                        <MiniGlasses
                          type={activeVariant.type}
                          frame={activeSwatch}
                          lens={activeVariant.lens}
                          w={155}
                          imageUrl={storeImg}
                        />

                        {/* Clean Wishlist Heart */}
                        <span className="absolute top-2.5 start-2.5 z-10">
                          <Heart p={activeVariant} />
                        </span>
                      </div>

                      <div className="mt-3 font-extrabold text-sm sm:text-base text-[#0F172A] truncate">
                        {activeVariant.name}
                      </div>

                      <div className="mt-1 text-sm font-extrabold text-[#0F172A] tabular-nums">
                        <Pr x={activeVariant} />
                      </div>

                      {/* Quiet Luxury Primary Try-On CTA */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurId(activeVariant.id);
                          setFc(activeSwatch);
                          setDetailId(null);
                          setCamOn(true);
                        }}
                        className="mt-3 w-full min-h-[44px] py-2.5 px-3 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-[#FAF8F5] text-xs font-extrabold shadow-xs cursor-pointer transition-all duration-150 active:scale-[0.97] flex items-center justify-center gap-1.5"
                      >
                        <I n="camera" s={14} />
                        <span>جرّب على وجهك</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              {list.length > STORE_PAGE_SIZE && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#FAF8F5] border border-stone-200/85 px-4 py-3 text-xs text-slate-700">
                  <span>
                    عرض <b>{Math.min(storeVisibleCount, list.length)}</b> من <b>{list.length}</b> نظارة
                  </span>
                  {list.length > storeVisibleCount && (
                    <button
                      type="button"
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0F172A] text-[#FAF8F5] font-bold cursor-pointer transition-transform duration-150 active:scale-[0.97]"
                      onClick={() => setStoreVisibleCount((c) => c + STORE_PAGE_SIZE)}
                    >
                      عرض المزيد (+{Math.min(STORE_PAGE_SIZE, list.length - storeVisibleCount)})
                    </button>
                  )}
                </div>
              )}

              {!list.length && (
                <div className="rounded-2xl bg-[#FAF8F5] border border-stone-200/85 text-center text-slate-500 py-10 text-sm">
                  لا توجد نظارات مطابقة لهذا التصنيف حالياً
                </div>
              )}
            </section>

            {/* Section 2: وصل حديثاً (Horizontal Scrollable New Arrivals) */}
            {newestFrames.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg sm:text-xl font-extrabold text-[#0F172A]">وصل حديثاً</h2>
                  <span className="text-xs font-bold text-slate-500">أحدث إضافات المتجر</span>
                </div>
                <div className="flex overflow-x-auto gap-3.5 pb-2 snap-x noscroll">
                  {newestFrames.map((np) => (
                    <div
                      key={np.id}
                      onClick={() => openFrameDetail(np.id)}
                      className="min-w-[185px] sm:min-w-[210px] snap-start rounded-2xl bg-[#FAF8F5] border border-stone-200/85 p-3 cursor-pointer hover:shadow-md transition-all duration-150 active:scale-[0.97] shrink-0"
                    >
                      <div className="relative rounded-xl bg-white/85 border border-stone-100/90 py-5 px-2 flex items-center justify-center mb-2.5">
                        <span className="absolute top-2 start-2 px-2 py-0.5 rounded-full bg-amber-50 text-[#B45309] border border-amber-200 text-[0.62rem] font-extrabold">
                          جديد ✨
                        </span>
                        <MiniGlasses
                          type={np.type}
                          frame={np.frame}
                          lens={np.lens}
                          w={128}
                          imageUrl={resolveStoreFrontUrl(np)}
                        />
                      </div>
                      <div className="font-extrabold text-xs sm:text-sm text-[#0F172A] truncate">{np.name}</div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs font-extrabold text-[#0F172A] tabular-nums">
                          <Pr x={np} />
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCurId(np.id);
                            setDetailId(null);
                            setCamOn(true);
                          }}
                          className="min-h-[44px] min-w-[44px] px-2.5 inline-flex items-center justify-center text-[0.72rem] font-extrabold text-[#0F172A] hover:underline cursor-pointer transition-transform duration-150 active:scale-[0.97]"
                        >
                          جرّب الآن
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Section 3: تسوّق حسب شكل الإطار */}
            <section className="space-y-3">
              <h2 className="text-lg sm:text-xl font-extrabold text-[#0F172A]">تسوّق حسب شكل الإطار</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                {(
                  [
                    { key: 'round', label: 'دائري (Round)', icon: 'round' as const },
                    { key: 'oval', label: 'بيضاوي (Oval)', icon: 'rimless' as const },
                    { key: 'square', label: 'مربع (Square)', icon: 'wayfarer' as const },
                    { key: 'cat_eye', label: 'كات آي (Cat-Eye)', icon: 'cat' as const },
                    { key: 'aviator', label: 'أفياتور (Aviator)', icon: 'aviator' as const },
                  ] as const
                ).map((sh) => {
                  const active = shapeFilter === sh.key;
                  return (
                    <button
                      key={sh.key}
                      type="button"
                      onClick={() => {
                        setShapeFilter((prev) => (prev === sh.key ? 'all' : sh.key));
                        scrollToElement('catalog-all');
                      }}
                      className={
                        'rounded-2xl p-3 border text-center cursor-pointer transition flex flex-col items-center gap-2 ' +
                        (active
                          ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-md'
                          : 'bg-white text-[#0F172A] border-[#E2E8F0] hover:border-[#0284C7]')
                      }
                    >
                      <div className="rounded-xl bg-[#F8F9FA] px-2 py-1.5 flex items-center justify-center w-full">
                        <MiniGlasses type={sh.icon} frame="#0F172A" lens="#94A3B8" w={68} />
                      </div>
                      <span className="text-xs font-extrabold">{sh.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Section 4: تسوّق حسب الفئة واللون */}
            <section className="space-y-3">
              <h2 className="text-lg sm:text-xl font-extrabold text-[#0F172A]">تسوّق حسب الفئة واللون</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white border border-[#E2E8F0] p-4 space-y-2.5">
                  <div className="text-xs font-extrabold text-slate-500">حسب الفئة</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ['prescription', 'طبية'],
                      ['sunglasses', 'شمسية'],
                      ['clip_on', 'بغيار شمس'],
                      ['kids', 'أطفالي'],
                    ].map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setCat((prev) => (prev === k ? 'all' : k));
                          scrollToElement('catalog-all');
                        }}
                        className={
                          'min-h-[44px] flex items-center justify-center py-2.5 px-3 rounded-xl border text-xs font-extrabold cursor-pointer transition ' +
                          (cat === k
                            ? 'bg-[#0F172A] text-white border-[#0F172A]'
                            : 'bg-[#F8F9FA] text-[#0F172A] border-[#E2E8F0] hover:border-[#0284C7]')
                        }
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-[#E2E8F0] p-4 space-y-2.5">
                  <div className="text-xs font-extrabold text-slate-500">حسب اللون</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['black', 'أسود', '#0F172A'],
                        ['brown_tortoise', 'بني / تايجر', '#7A4A2B'],
                        ['clear', 'شفاف', 'transparent'],
                        ['metal', 'معادن', '#C9A24B'],
                      ] as const
                    ).map(([ck, lbl, swatch]) => (
                      <button
                        key={ck}
                        type="button"
                        onClick={() => {
                          setColorFilter((prev) => (prev === ck ? 'all' : ck));
                          scrollToElement('catalog-all');
                        }}
                        className={
                          'min-h-[44px] py-2.5 px-3 rounded-xl border text-xs font-extrabold cursor-pointer transition flex items-center gap-2 ' +
                          (colorFilter === ck
                            ? 'bg-[#0F172A] text-white border-[#0F172A]'
                            : 'bg-[#F8F9FA] text-[#0F172A] border-[#E2E8F0] hover:border-[#0284C7]')
                        }
                      >
                        <span
                          className="w-4 h-4 rounded-full border border-slate-300 shrink-0"
                          style={{
                            background:
                              swatch === 'transparent'
                                ? 'linear-gradient(135deg, #ffffff 45%, #cbd5e1 55%)'
                                : swatch,
                          }}
                        />
                        <span>{lbl}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === 'lens' && rxEnabled && (
          <div className="grid lg:grid-cols-5 gap-5 fade">
            <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-6 self-start">
              <div className="glass rounded-3xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#E2E8F0] text-xs">
                  <span className="text-[#0284C7] font-bold">{coatInfo.label}</span>
                  <span className="text-slate-600">معاينة طلاء ولون العدسة</span>
                </div>
                <div className="relative bg-[#F8F9FA] aspect-[4/3.1] flex items-center justify-center p-6 overflow-hidden">
                  <svg
                    viewBox="-115 -44 230 88"
                    className="w-[78%] max-w-[260px] drop-shadow-sm"
                  >
                    <Glasses
                      type={cur.type}
                      frame={fc}
                      lens={lc}
                      yaw={yaw}
                      coatingId={activeCatMeta.coatingPreviewId}
                      isSun={cur.cat === 'sun'}
                    />
                  </svg>
                </div>
                <div className="p-3">
                  <div className="font-bold text-center text-[#0F172A] mb-2">
                    {cur.name} <span className="text-slate-500 text-sm">· {TYPES[cur.type]}</span>
                  </div>
                  <div className="flex justify-center gap-1.5 mb-2">
                    {FRAME_COLORS.map((c) => (
                      <button
                        key={c[1]}
                        title={c[0]}
                        onClick={() => setFc(c[1])}
                        className="w-7 h-7 rounded-full border-2 cursor-pointer"
                        style={{ background: c[1], borderColor: fc === c[1] ? '#0F172A' : '#CBD5E1' }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-center gap-1.5">
                    {LENS_COLORS.map((c) => (
                      <button
                        key={c[1]}
                        title={c[0]}
                        onClick={() => setLc(c[1])}
                        className="w-7 h-7 rounded-full border-2 cursor-pointer"
                        style={{ background: c[1], borderColor: lc === c[1] ? '#0F172A' : '#CBD5E1' }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="glass rounded-2xl p-4 tabular-nums space-y-1.5 text-xs sm:text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>الإطار</span>
                  <Egp v={cur.price} />
                </div>
                {lensQuickMode ? (
                  <>
                    <div className="flex justify-between text-slate-600">
                      <span>العدسات</span>
                      <b className="text-[#059669]">تحديد العدسات مع أخصائي المحل (موصى به)</b>
                    </div>
                    <div className="flex justify-between font-extrabold text-lg border-t border-[#E2E8F0] pt-3 text-[#0F172A]">
                      <span>سعر الإطار المبدئي</span>
                      <span className="text-[#D97706]">
                        <Egp v={cur.price} />
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-slate-600">
                      <span>نوع الكشف</span>
                      <b className="text-[#0F172A]">{trackLabelAr}</b>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>خاصية العدسة</span>
                      <b className="text-[#0F172A]">
                        {activeCatMeta.nameAr}
                        {variantSuffix}
                      </b>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>ضغط العدسة</span>
                      <b className="text-[#0284C7]">{indexLabelAr}</b>
                    </div>
                    <div className="flex justify-between text-slate-600 pb-1">
                      <span>الشركة: {selectedBrandOption?.nameAr || '—'}</span>
                      {selectedBrandOption?.isStoreDecide ? (
                        <span dir="ltr" className="font-bold text-[#0284C7]">
                          {fmt(selectedBrandOption.minPrice)}–{fmt(selectedBrandOption.maxPrice)} ج.م
                        </span>
                      ) : (
                        <Egp v={lensEstimatedPrice} />
                      )}
                    </div>
                    <div className="flex justify-between font-extrabold text-lg border-t border-[#E2E8F0] pt-3 text-[#0F172A]">
                      <span>{selectedBrandOption?.isStoreDecide ? 'الإجمالي يبدأ من' : 'الإجمالي'}</span>
                      <span className="text-[#D97706]">
                        <Egp v={total} />
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="lg:col-span-3 space-y-4">
              {/* Default Specialist Choice vs Optional Detailed Lens Selector */}
              <div className="glass rounded-2xl p-4 space-y-3 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-extrabold text-sm text-[#0F172A]">تحديد العدسات</div>
                    <div className="text-xs text-slate-500">
                      الخيار الافتراضي يترك تحديد العدسة الأنسب لأخصائي البصريات بعد مراجعة الكشف
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLensQuickMode((v) => !v)}
                    className={
                      'px-3 py-1.5 rounded-xl border text-xs font-extrabold cursor-pointer transition ' +
                      (!lensQuickMode
                        ? 'bg-[#0284C7] text-white border-[#0284C7]'
                        : 'bg-[#F8F9FA] text-[#0F172A] border-[#E2E8F0] hover:border-[#0284C7]')
                    }
                  >
                    {lensQuickMode ? 'اختيار نوع العدسة (اختياري) ▾' : 'العودة للوضع السريع (موصى به) ✓'}
                  </button>
                </div>

                {lensQuickMode && (
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    <div className="rounded-2xl border-2 border-[#059669] bg-emerald-50/70 p-3.5 flex items-start justify-between gap-2">
                      <div>
                        <div className="font-extrabold text-sm text-[#0F172A] flex items-center gap-1.5">
                          <span>تحديد العدسات مع أخصائي المحل (موصى به)</span>
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5 leading-5">
                          ارفع صورة الكشف الطبي وسيرشّح لك أخصائي {storeTradeName} نوع العدسة والضغط الأنسب لكشفك ويؤكد السعر النهائي على واتساب.
                        </div>
                      </div>
                      <span className="badge b-ok shrink-0">افتراضي ✓</span>
                    </div>

                    {!img ? (
                      <div className="grid sm:grid-cols-2 gap-2.5">
                        <label className="rounded-2xl border-2 border-dashed border-slate-300 bg-white hover:border-[#0284C7] p-4 text-center cursor-pointer block transition">
                          <span className="text-[#0284C7] inline-block">
                            <I n="upload" s={24} />
                          </span>
                          <div className="text-xs sm:text-sm font-bold text-[#0F172A] mt-1">
                            ارفع صورة الكشف الطبي (اختياري)
                          </div>
                          <div className="text-[0.68rem] text-slate-500">من المعرض أو الكاميرا</div>
                          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={onFile} />
                        </label>
                        <button
                          type="button"
                          className="rounded-2xl border border-[#E2E8F0] bg-[#F8F9FA] hover:bg-slate-100 p-4 text-center cursor-pointer transition"
                          onClick={() => {
                            setRxLocalPreview(null);
                            setImg('demo');
                          }}
                        >
                          <span className="text-[#0284C7] inline-block">
                            <I n="receipt" s={24} />
                          </span>
                          <div className="text-xs sm:text-sm font-bold text-[#0F172A] mt-1">
                            استخدم كشف تجريبي
                          </div>
                          <div className="text-[0.68rem] text-slate-500">لتجربة الشاشة فقط</div>
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex items-center gap-3">
                        <div className="w-20 shrink-0 rounded-lg overflow-hidden border border-slate-200">
                          {img === 'demo' ? (
                            <div className="text-xs p-2.5 bg-white text-[#0F172A] font-bold text-center">كشف تجريبي</div>
                          ) : rxLocalPreview === 'pdf' || img.endsWith('.pdf') ? (
                            <div className="text-xs p-2.5 bg-white text-[#0F172A] font-bold text-center">ملف PDF</div>
                          ) : (
                            <img src={rxLocalPreview || img} alt="كشف" className="w-full h-20 object-cover" />
                          )}
                        </div>
                        <div className="flex-1 text-xs">
                          <div className="font-bold text-[#0F172A]">تم إرفاق صورة الكشف ✓</div>
                          <div className="text-slate-500">سيصل مباشرة لقسم الكشوفات عند التاجر</div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-d btn-sm"
                          onClick={() => {
                            setRxLocalPreview(null);
                            setImg(null);
                          }}
                        >
                          <I n="trash" s={14} />
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        className="inp"
                        placeholder="اسمك"
                        value={cname}
                        onChange={(e) => setCname(e.target.value)}
                      />
                      <input
                        className="inp"
                        dir="ltr"
                        placeholder="رقم الموبايل"
                        value={cphone}
                        onChange={(e) => setCphone(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        className="inp"
                        dir="ltr"
                        placeholder="مقاس PD (اختياري) مثال: 63"
                        value={pd}
                        onChange={(e) => setPd(e.target.value)}
                      />
                      <input
                        className="inp"
                        placeholder="ملاحظات إضافية (اختياري)"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn bg-[#D97706] hover:bg-[#B45309] text-white w-full !py-3.5 text-sm sm:text-base shadow-sm"
                      onClick={submitRx}
                    >
                      <I n="msg" s={18} /> إرسال الطلب والكشف للمحل عبر واتساب
                    </button>
                  </div>
                )}
              </div>

              {!lensQuickMode && (
                <>
                  <div className="glass rounded-2xl p-3 mb-4">
                    <div className="flex items-center">
                      {steps.map((s, i) => (
                        <React.Fragment key={s}>
                          <button
                            type="button"
                            onClick={() => setStep(i + 1)}
                            className="flex flex-col items-center gap-1 flex-1 min-w-0 cursor-pointer"
                          >
                            <span
                              className={
                                'w-9 h-9 rounded-full flex items-center justify-center text-sm font-extrabold transition ' +
                                (step === i + 1
                                  ? 'bg-[#0F172A] text-white shadow-sm'
                                  : step > i + 1
                                  ? 'bg-emerald-50 text-[#059669] border border-emerald-200'
                                  : 'bg-slate-100 text-slate-600')
                              }
                            >
                              {step > i + 1 ? <I n="check" s={16} /> : i + 1}
                            </span>
                            <span
                              className={
                                'text-[.65rem] text-center leading-tight ' +
                                (step === i + 1 ? 'font-bold text-[#0F172A]' : 'text-slate-500')
                              }
                            >
                              {s}
                            </span>
                          </button>
                          {i < 3 && (
                            <span
                              className={
                                'h-0.5 w-4 sm:w-8 rounded ' +
                                (step > i + 1 ? 'bg-[#059669]' : 'bg-slate-200')
                              }
                            />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  <div className="fade" key={step}>
                    {/* Step 1: نوع الكشف */}
                    {step === 1 && (
                      <div className="space-y-3">
                        <h3 className="font-extrabold text-[#0F172A]">
                          الخطوة 1: اختر نوع الكشف
                        </h3>
                    <div className="space-y-2.5">
                      {LENS_TRACKS.map((tr) => {
                        const active = lensTrack === tr.key;
                        return (
                          <button
                            key={tr.key}
                            type="button"
                            onClick={() => {
                              setLensTrack(tr.key);
                              setSelectedLensBrandId('');
                            }}
                            className={
                              'w-full flex items-center gap-3 p-4 rounded-2xl border text-start transition cursor-pointer ' +
                              (active
                                ? 'border-[#0284C7] bg-sky-50 shadow-sm'
                                : 'border-[#E2E8F0] bg-white hover:border-slate-300')
                            }
                          >
                            <span className="w-11 h-11 rounded-xl b-acc flex items-center justify-center shrink-0">
                              <I n={tr.key === 'single_vision' ? 'eye' : 'spark'} s={21} />
                            </span>
                            <div className="flex-1">
                              <div className="font-extrabold text-sm text-[#0F172A]">
                                {tr.key === 'single_vision'
                                  ? 'رؤية واحدة (Single Vision)'
                                  : 'عدسات التصنيع (مالتي فوكال / باي فوكال)'}
                              </div>
                              <div className="text-xs text-slate-600 mt-0.5">{tr.descAr}</div>
                            </div>
                            {active && <I n="check" s={18} c="text-[#0284C7]" />}
                          </button>
                        );
                      })}
                    </div>

                    {lensTrack === 'custom_lab' && (
                      <div className="glass rounded-2xl p-4 space-y-2.5 bg-white">
                        <div className="text-xs font-extrabold text-[#0F172A]">
                          حدد تصميم عدسة التصنيع حسب كشف النظر:
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2.5">
                          {CUSTOM_LAB_DESIGNS.map((des) => {
                            const active = labDesign === des.key;
                            return (
                              <button
                                key={des.key}
                                type="button"
                                onClick={() => {
                                  setLabDesign(des.key);
                                  setSelectedLensBrandId('');
                                }}
                                className={
                                  'p-3 rounded-xl border text-start cursor-pointer transition ' +
                                  (active
                                    ? 'border-[#0284C7] bg-sky-50'
                                    : 'border-[#E2E8F0] bg-[#F8F9FA]')
                                }
                              >
                                <div className="font-bold text-xs text-[#0F172A]">{des.labelAr}</div>
                                <div className="text-[0.68rem] text-slate-500 mt-0.5">{des.descAr}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2: خاصية العدسة */}
                {step === 2 && (
                  <div className="space-y-3">
                    <h3 className="font-extrabold text-[#0F172A]">
                      الخطوة 2: اختر خاصية العدسة
                    </h3>
                    <div className="space-y-2.5">
                      {LENS_CATEGORIES.map((catMeta) => {
                        const active = lensCategory === catMeta.key;
                        return (
                          <button
                            key={catMeta.key}
                            type="button"
                            onClick={() => {
                              setLensCategory(catMeta.key);
                              if (!catMeta.variants.includes(photoVariant)) {
                                setPhotoVariant(catMeta.variants[0]);
                              }
                              if (
                                lensIndexChoice !== 'store_decide' &&
                                !catMeta.indices.includes(lensIndexChoice)
                              ) {
                                setLensIndexChoice(catMeta.indices[0]);
                              }
                            }}
                            className={
                              'w-full flex items-center gap-3 p-3.5 rounded-2xl border text-start transition cursor-pointer ' +
                              (active
                                ? 'border-[#0284C7] bg-sky-50 shadow-sm'
                                : 'border-[#E2E8F0] bg-white hover:border-slate-300')
                            }
                          >
                            <span className="w-10 h-10 rounded-xl b-acc flex items-center justify-center shrink-0">
                              <I
                                n={
                                  catMeta.key === 'photochromic' || catMeta.key === 'three_in_one'
                                    ? 'sun'
                                    : catMeta.key === 'blue_cut'
                                    ? 'shield'
                                    : 'eye'
                                }
                                s={20}
                              />
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="font-extrabold text-sm text-[#0F172A]">
                                {catMeta.nameAr}{' '}
                                <span className="text-xs text-slate-500 font-normal" dir="ltr">
                                  ({catMeta.nameEn})
                                </span>
                              </div>
                              <div className="text-xs text-slate-600 mt-0.5">{catMeta.descAr}</div>
                            </div>
                            {active && <I n="check" s={18} c="text-[#0284C7]" />}
                          </button>
                        );
                      })}
                    </div>

                    {activeCatMeta.variants.length > 1 && (
                      <div className="glass rounded-2xl p-4 space-y-2.5 bg-white">
                        <div className="text-xs font-extrabold text-[#0F172A]">
                          اختر لون التغميق في الشمس:
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          {activeCatMeta.variants.map((vr) => {
                            const active = effectivePhotoVariant === vr;
                            return (
                              <button
                                key={vr}
                                type="button"
                                onClick={() => setPhotoVariant(vr)}
                                className={
                                  'p-3 rounded-xl border text-start cursor-pointer transition flex items-center gap-2.5 ' +
                                  (active
                                    ? 'border-[#0284C7] bg-sky-50 shadow-sm'
                                    : 'border-[#E2E8F0] bg-[#F8F9FA]')
                                }
                              >
                                <span
                                  className="w-5 h-5 rounded-full border border-slate-300 shrink-0"
                                  style={{
                                    background: vr === 'photo_brown' ? '#7a4a2b' : '#475569',
                                  }}
                                />
                                <span className="font-bold text-xs text-[#0F172A]">
                                  {PHOTO_VARIANT_LABELS[vr]}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      className="btn btn-g w-full !py-3"
                      onClick={() =>
                        setModal({ t: 'ba', lens: activeCatMeta.coatingPreviewId })
                      }
                    >
                      <I n="eye" s={18} /> شاهد الفرق بعينك (Before / After)
                    </button>
                  </div>
                )}

                {/* Step 3: درجة ضغط العدسة (Index) */}
                {step === 3 && (
                  <div className="space-y-3">
                    <h3 className="font-extrabold text-[#0F172A]">
                      الخطوة 3: اختر درجة ضغط العدسة (Index)
                    </h3>
                    <div className="space-y-2.5">
                      {activeCatMeta.indices.map((idxKey) => {
                        const meta = LENS_INDEX_META[idxKey];
                        const active = effectiveIndexChoice === idxKey;
                        return (
                          <button
                            key={idxKey}
                            type="button"
                            onClick={() => setLensIndexChoice(idxKey)}
                            className={
                              'w-full p-3.5 rounded-2xl border text-start transition cursor-pointer space-y-1 ' +
                              (active
                                ? 'border-[#0284C7] bg-sky-50 shadow-sm'
                                : 'border-[#E2E8F0] bg-white hover:border-slate-300')
                            }
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-sm text-[#0F172A]" dir="ltr">
                                {meta.labelAr}
                              </span>
                              {active && <I n="check" s={17} c="text-[#0284C7]" />}
                            </div>
                            <div className="text-xs text-slate-600 leading-5">
                              {meta.tooltipAr}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => setLensIndexChoice('store_decide')}
                      className={
                        'w-full p-4 rounded-2xl border-2 text-start transition cursor-pointer flex items-center justify-between gap-3 ' +
                        (effectiveIndexChoice === 'store_decide'
                          ? 'border-[#D97706] bg-amber-50 shadow-sm'
                          : 'border-dashed border-amber-300 bg-white hover:bg-amber-50/40')
                      }
                    >
                      <div>
                        <div className="font-extrabold text-sm text-[#0F172A]">
                          تحديد الضغط بواسطة المتجر بعد مراجعة الكشف
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          لست متأكداً من درجة الضغط المناسبة؟ اترك أخصائي البصريات يرشّح لك الأنسب لمقاسك وإطارك.
                        </div>
                      </div>
                      {effectiveIndexChoice === 'store_decide' && (
                        <I n="check" s={18} c="text-[#D97706]" />
                      )}
                    </button>
                  </div>
                )}

                {/* Step 4: اختيار الشركة المصنعة والكشف */}
                {step === 4 && (
                  <div className="space-y-3.5">
                    <h3 className="font-extrabold text-[#0F172A]">
                      الخطوة 4: اختر الشركة المصنعة وأرفق الكشف
                    </h3>

                    <div className="grid sm:grid-cols-2 gap-2.5">
                      {!customerBrandOptions.length && (
                        <div className="sm:col-span-2 glass rounded-2xl p-4 text-sm text-center text-slate-500">
                          لا توجد شركات متاحة لهذا الاختيار حالياً — تواصل مع المتجر مباشرة.
                        </div>
                      )}
                      {customerBrandOptions.map((b) => {
                        const active = selectedBrandOption?.brandId === b.brandId;
                        return (
                          <button
                            key={b.brandId}
                            type="button"
                            onClick={() => setSelectedLensBrandId(b.brandId)}
                            className={
                              'p-3.5 rounded-2xl border text-start transition cursor-pointer flex flex-col gap-1.5 ' +
                              (active
                                ? 'border-[#0284C7] bg-sky-50 shadow-sm'
                                : b.sponsorBadge === 'official_sponsor'
                                ? 'border-amber-300 bg-amber-50/30 hover:border-amber-400'
                                : 'border-[#E2E8F0] bg-white hover:border-slate-300')
                            }
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-extrabold text-sm text-[#0F172A]">
                                {b.nameAr}
                              </span>
                              {b.sponsorBadge === 'official_sponsor' && (
                                <span className="badge bg-amber-100 text-amber-900 border border-amber-300 text-[0.65rem] font-extrabold">
                                  {SPONSOR_BADGE_LABELS.official_sponsor}
                                </span>
                              )}
                              {b.sponsorBadge === 'featured_partner' && (
                                <span className="badge b-info text-[0.65rem] font-bold">
                                  {SPONSOR_BADGE_LABELS.featured_partner}
                                </span>
                              )}
                            </div>

                            <div className="text-xs text-slate-500 flex items-center justify-between gap-2">
                              <span>{b.origin || 'عدسات طبية'}</span>
                              <span dir="ltr">{b.nameEn}</span>
                            </div>

                            {lensTrack === 'custom_lab' && b.estimatedDays && (
                              <div className="text-[0.68rem] font-bold text-[#0284C7]">
                                مدة التجهيز المتوقعة: {b.estimatedDays} أيام
                              </div>
                            )}

                            <div className="text-sm font-extrabold text-[#D97706] mt-auto pt-1">
                              {b.isStoreDecide ? (
                                <span dir="ltr">
                                  {fmt(b.minPrice)} – {fmt(b.maxPrice)} ج.م
                                </span>
                              ) : (
                                <Egp v={b.exactPrice ?? b.minPrice} />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {!img ? (
                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="rounded-2xl border-2 border-dashed border-slate-300 bg-white hover:border-[#0284C7] p-4 text-center cursor-pointer block transition">
                          <span className="text-[#0284C7] inline-block">
                            <I n="upload" s={26} />
                          </span>
                          <div className="text-xs sm:text-sm font-bold text-[#0F172A] mt-1">
                            ارفع صورة الكشف (اختياري)
                          </div>
                          <div className="text-[0.68rem] text-slate-500">من المعرض أو الكاميرا</div>
                          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={onFile} />
                        </label>
                        <button
                          type="button"
                          className="rounded-2xl border border-[#E2E8F0] bg-white hover:bg-slate-50 p-4 text-center cursor-pointer transition"
                          onClick={() => {
                            setRxLocalPreview(null);
                            setImg('demo');
                          }}
                        >
                          <span className="text-[#0284C7] inline-block">
                            <I n="receipt" s={26} />
                          </span>
                          <div className="text-xs sm:text-sm font-bold text-[#0F172A] mt-1">
                            استخدم كشف تجريبي
                          </div>
                          <div className="text-[0.68rem] text-slate-500">لتجربة الشاشة فقط</div>
                        </button>
                      </div>
                    ) : (
                      <div className="glass rounded-2xl p-3 flex items-center gap-3">
                        <div className="w-24 shrink-0 rounded-lg overflow-hidden border border-slate-200">
                          {img === 'demo' ? (
                            <div className="text-xs p-3 bg-[#F8F9FA] text-[#0F172A] font-bold text-center">
                              كشف تجريبي
                            </div>
                          ) : rxLocalPreview === 'pdf' || img.endsWith('.pdf') ? (
                            <div className="text-xs p-3 bg-[#F8F9FA] text-[#0F172A] font-bold text-center">
                              ملف PDF
                            </div>
                          ) : (
                            <img src={rxLocalPreview || img} alt="كشف" className="w-full h-24 object-cover" />
                          )}
                        </div>
                        <div className="flex-1 text-sm">
                          <div className="font-bold text-[#0F172A] flex items-center gap-1">
                            <span className="text-[#059669]">
                              <I n="check" s={16} />
                            </span>{' '}
                            تم إرفاق الكشف
                          </div>
                          <div className="text-xs text-slate-500">سيراجعه أخصائي المحل</div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-d btn-sm"
                          onClick={() => {
                            setRxLocalPreview(null);
                            setImg(null);
                          }}
                        >
                          <I n="trash" s={14} />
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        className="inp"
                        placeholder="اسمك"
                        value={cname}
                        onChange={(e) => setCname(e.target.value)}
                      />
                      <input
                        className="inp"
                        dir="ltr"
                        placeholder="رقم الموبايل"
                        value={cphone}
                        onChange={(e) => setCphone(e.target.value)}
                      />
                    </div>
                    <input
                      className="inp"
                      dir="ltr"
                      placeholder="مقاس PD (اختياري) مثال: 63"
                      value={pd}
                      onChange={(e) => setPd(e.target.value)}
                    />
                    <textarea
                      className="inp"
                      rows={2}
                      placeholder="ملاحظات أو استفسار للمحل..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                    <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 text-xs leading-6 text-amber-900 space-y-1.5">
                      <div>
                        {effectiveIndexChoice === 'store_decide'
                          ? 'سيراجع أخصائي البصريات كشفك لتحديد درجة الضغط والسعر النهائي الأنسب قبل أي دفع.'
                          : 'صاحب المحل هيراجع الكشف ويأكد لك الملاءمة والسعر النهائي قبل أي دفع — السعر الظاهر مبدئي.'}
                      </div>
                      <div className="pt-1.5 border-t border-amber-200/80 font-bold text-amber-950">
                        التجربة الافتراضية استرشادية لتوضيح الشكل والمقاس، ويتم اعتماد القياس الطبي النهائي بواسطة أخصائي البصريات في المحل.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn bg-[#D97706] hover:bg-[#B45309] text-white w-full !py-3.5 !text-base shadow-sm"
                      onClick={submitRx}
                    >
                      <I n="msg" s={19} /> إرسال الطلب والكشف عبر واتساب
                    </button>
                    <button
                      type="button"
                      className="btn btn-g w-full"
                      onClick={() =>
                        addCart({
                          productId: cur.id,
                          name: cur.name,
                          desc: `${activeCatMeta.nameAr}${variantSuffix} · ${
                            selectedBrandOption?.nameAr || ''
                          } · مقاس ${selectedSize}`,
                          price: total,
                          type: cur.type,
                          frame: fc,
                          lens: lc,
                          size: selectedSize,
                        })
                      }
                    >
                      <I n="bag" s={16} /> أو أضف للسلة مباشرة
                    </button>
                  </div>
                )}
                  </div>

                  <div className="flex justify-between mt-4">
                    <button
                      type="button"
                      className="btn btn-g"
                      disabled={step === 1}
                      style={{ opacity: step === 1 ? 0.35 : 1 }}
                      onClick={() => setStep((s) => Math.max(1, s - 1))}
                    >
                      السابق
                    </button>
                    {step < 4 && (
                      <button type="button" className="btn btn-p" onClick={() => setStep((s) => s + 1)}>
                        التالي
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'fav' && (
          <div className="fade">
            <h2 className="font-extrabold text-xl mb-4">المفضلة ({fav.length})</h2>
            {!fav.length ? (
              <Empty
                icon="heart"
                t="لا توجد مفضلات بعد"
                s="اضغط على القلب في أي نظارة لإضافتها"
                b="تصفح المتجر"
                on={() => setTab('shop')}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {products
                  .filter((p) => fav.includes(p.id))
                  .map((p) => (
                    <div key={p.id} className="glass rounded-2xl p-3">
                      <div className="relative rounded-xl bg-[#F8F9FA] shadow-[0_8px_22px_-8px_rgba(20,20,20,0.2)] py-3 flex justify-center">
                        <MiniGlasses
                          type={p.type}
                          frame={p.frame}
                          lens={p.lens}
                          w={120}
                          imageUrl={resolveStoreFrontUrl(p)}
                        />
                        <span className="absolute top-1.5 end-1.5">
                          <Heart p={p} />
                        </span>
                      </div>
                      <div className="font-bold text-sm mt-2">{p.name}</div>
                      <div className="tx-acc font-extrabold text-sm mb-2">
                        <Pr x={p} />
                      </div>
                      <button
                        className="btn bg-[#0284C7] hover:bg-[#0369A1] text-white btn-sm w-full"
                        onClick={() => {
                          setCurId(p.id);
                          setDetailId(null);
                          setTab('shop');
                          setCamOn(true);
                        }}
                      >
                        جرّب الآن
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {tab === 'ord' && (
          <div className="fade max-w-2xl mx-auto">
            <h2 className="font-extrabold text-xl text-[#0F172A] mb-4">طلباتي واستفساراتي</h2>
            {!mine.length ? (
              <Empty
                icon="receipt"
                t="لا توجد طلبات"
                s={rxEnabled ? 'اختار عدسة وابعت كشفك للمحل' : 'تصفّح النظارات وأضف ما يعجبك للسلة للطلب عبر واتساب'}
                b={rxEnabled ? 'اختيار العدسات' : 'تصفح المتجر'}
                on={() => setTab(rxEnabled ? 'lens' : 'shop')}
              />
            ) : (
              <div className="space-y-3">
                {mine.map((q) => (
                  <div key={q.id} className="glass rounded-2xl p-4">
                    <div className="flex justify-between mb-2">
                      <b className="font-mono text-sm">{q.id}</b>
                      {qBadge(q.status)}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-[#F8F9FA] border border-[#E2E8F0] p-1.5">
                        <MiniGlasses type={q.type} frame={q.frame} lens={q.lens} w={70} />
                      </div>
                      <div className="flex-1 text-sm">
                        <div className="font-bold text-[#0F172A]">{q.frameName}</div>
                        <div className="text-xs text-slate-600">
                          {q.lensName}
                          {q.brandName !== '—' && ` · ${q.brandName}`}
                        </div>
                      </div>
                      <div className="text-end">
                        <div className="text-[.68rem] text-slate-500">
                          {q.status === 'confirmed' ? 'السعر النهائي' : 'السعر المبدئي'}
                        </div>
                        <b className="text-[#D97706]">
                          <Egp v={q.final || q.price} />
                        </b>
                      </div>
                    </div>
                    <div
                      className={
                        'mt-3 text-xs rounded-lg p-2.5 border ' +
                        (q.status === 'confirmed'
                          ? 'bg-emerald-50 text-[#059669] border-emerald-200'
                          : q.status === 'alt'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-sky-50 text-[#0284C7] border-sky-200')
                      }
                    >
                      {q.kind === 'order'
                        ? 'طلب شراء مباشر — جاري المتابعة والتجهيز مع المحل عبر واتساب.'
                        : q.status === 'new'
                        ? 'بانتظار مراجعة المحل للكشف وتأكيد الملاءمة.'
                        : q.status === 'confirmed'
                        ? 'المحل أكد الملاءمة ✅ — أكمل الاتفاق على واتساب.'
                        : `المحل اقترح عدسة بديلة: ${q.alt} — السعر المحدّث ${fmt(q.price)} ج.م.`}
                    </div>
                    {q.status === 'confirmed' && <Stages s={q.stage} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'cart' && (
          <div className="fade max-w-2xl mx-auto">
            <h2 className="font-extrabold text-xl text-[#0F172A] mb-4">السلة ({cart.length})</h2>
            {!cart.length ? (
              <Empty
                icon="bag"
                t="سلتك فارغة"
                s="أضف نظارة من المتجر أو من قسم العدسات"
                b="تصفح المتجر"
                on={() => setTab('shop')}
              />
            ) : (
              <>
                <div className="space-y-3 mb-4">
                  {cart.map((i) => (
                    <div key={i.key} className="glass rounded-2xl p-3 flex items-center gap-3">
                      <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-2">
                        <MiniGlasses type={i.type} frame={i.frame} lens={i.lens} w={84} />
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-sm text-[#0F172A]">{i.name}</div>
                        <div className="text-xs text-slate-500">{i.desc}</div>
                        <div className="text-[#D97706] font-extrabold text-sm">
                          <Egp v={i.price} />
                        </div>
                      </div>
                      <button
                        className="btn btn-d btn-sm"
                        onClick={() => setCart((c) => c.filter((x) => x.key !== i.key))}
                      >
                        <I n="trash" s={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="glass rounded-2xl p-4 space-y-3">
                  {shop.enableDeliveryService && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-[#059669] flex items-center justify-between gap-2">
                      <span className="font-bold flex items-center gap-1.5">
                        <I n="truck" s={15} /> خدمة التوصيل متاحة ({shop.deliveryAreas || shop.city})
                      </span>
                      <b className="tabular-nums">+{fmt(shop.deliveryFee ?? 60)} ج.م</b>
                    </div>
                  )}
                  <div className="flex justify-between font-extrabold text-xl text-[#0F172A]">
                    <span>الإجمالي</span>
                    <span className="text-[#D97706]">
                      <Egp v={cartTotal} />
                    </span>
                  </div>
                  <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[0.72rem] leading-5 font-bold text-amber-950">
                    التجربة الافتراضية استرشادية لتوضيح الشكل والمقاس، ويتم اعتماد القياس الطبي النهائي بواسطة أخصائي البصريات في المحل.
                  </p>
                  <button
                    className="btn bg-[#D97706] hover:bg-[#B45309] text-white w-full !py-3 !text-base shadow-sm"
                    onClick={() => setModal({ t: 'checkout', total: cartTotal })}
                  >
                    <I n="msg" s={18} /> إتمام الطلب عبر واتساب
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Floating 2-Frame Comparison Bottom Bar */}
      {compareIds.length > 0 && tab === 'shop' && !detailProduct && (
        <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] inset-x-0 z-40 px-4 pointer-events-none">
          <div className="max-w-xl mx-auto pointer-events-auto rounded-2xl bg-slate-900 text-white shadow-xl border border-slate-700 px-3.5 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-extrabold text-amber-300 whitespace-nowrap">
                {compareIds.length === 2 ? 'جاهز للمقارنة' : 'اختر نظارة أخرى للمقارنة'}
              </span>
              <span className="text-xs text-slate-300 font-mono" dir="ltr">
                ({compareIds.length}/2)
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={compareIds.length < 2}
                onClick={() => setCompareModalOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-[#D97706] hover:bg-[#B45309] disabled:opacity-45 text-white text-xs font-extrabold cursor-pointer transition whitespace-nowrap"
              >
                قارن بين النظارتين الآن ({compareIds.length}/2)
              </button>
              <button
                type="button"
                onClick={() => setCompareIds([])}
                className="px-2 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
                aria-label="إلغاء المقارنة"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-Side 2-Frame Smart Comparison Modal */}
      {compareModalOpen && cmpA && cmpB && (
        <Modal title="قارن بين النظارتين" onClose={() => setCompareModalOpen(false)} w="max-w-3xl">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl bg-[#F8F9FA] p-1 border border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setCmpViewAngle('front')}
                  className={
                    'px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition ' +
                    (cmpViewAngle === 'front' ? 'bg-[#0F172A] text-white' : 'text-slate-600')
                  }
                >
                  بالوش
                </button>
                <button
                  type="button"
                  onClick={() => setCmpViewAngle('angled45')}
                  className={
                    'px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition ' +
                    (cmpViewAngle === 'angled45' ? 'bg-[#0F172A] text-white' : 'text-slate-600')
                  }
                >
                  بالجنب
                </button>
              </div>

              <button
                type="button"
                onClick={() => setCmpSplitLive((v) => !v)}
                className={
                  'px-3 py-1.5 rounded-xl text-xs font-extrabold border cursor-pointer transition ' +
                  (cmpSplitLive
                    ? 'bg-[#0284C7] text-white border-[#0284C7]'
                    : 'bg-white text-[#0F172A] border-[#E2E8F0]')
                }
              >
                {cmpSplitLive ? 'إخفاء المعاينة على الوجه' : 'معاينة مقارنة على الوجه 3D'}
              </button>
            </div>

            {cmpSplitLive && (
              <div className="rounded-2xl overflow-hidden border border-[#E2E8F0]">
                <FaceTryOnStage
                  product={cmpA}
                  products={products}
                  compareProduct={cmpB}
                  splitMode={true}
                  frameColor={cmpA.frame}
                  lensColor={cmpA.lens}
                  frameSize={selectedSize}
                  coatingId={activeCatMeta.coatingPreviewId}
                  faceShape={face}
                  onFaceShapeDetected={setFace}
                  camOn={false}
                  onStartCam={() => {}}
                  yawManual={yaw}
                  onYawManualChange={setYaw}
                  showLauncherWhenIdle={true}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[cmpA, cmpB].map((item, idx) => {
                const imgUrl =
                  cmpViewAngle === 'angled45' && resolveAngled45Url(item)
                    ? resolveAngled45Url(item)
                    : resolveStoreFrontUrl(item);
                const matchPct = faceMatch(item, face);
                const dims = resolveProductOpticalDimensions(item);
                const waText = encodeURIComponent(
                  `مرحباً ${storeTradeName}، بعد المقارنة اخترت نظارة "${item.name}" (${item.modelCode || item.code}) بسعر ${fmt(item.price)} ج.م.`
                );
                return (
                  <div key={item.id} className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="px-2 py-0.5 rounded-full bg-[#0F172A] text-white text-[0.65rem] font-extrabold">
                        {idx === 0 ? 'اختيار A' : 'اختيار B'}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-[#059669] border border-emerald-200 text-[0.65rem] font-extrabold tabular-nums">
                        تطابق {matchPct}%
                      </span>
                    </div>

                    <div className="h-32 rounded-xl bg-white border border-slate-200 flex items-center justify-center p-2">
                      <MiniGlasses type={item.type} frame={item.frame} lens={item.lens} w={135} imageUrl={imgUrl} />
                    </div>

                    <div>
                      <div className="font-extrabold text-sm text-[#0F172A] truncate">{item.name}</div>
                      <div className="text-sm font-extrabold text-[#D97706] mt-0.5">
                        <Pr x={item} />
                      </div>
                    </div>

                    <div className="rounded-xl bg-white border border-slate-200 p-2 text-[0.68rem] text-slate-600 leading-5">
                      <b className="text-[#0284C7] block mb-0.5">تقييم AI لملاءمة الوجه:</b>
                      {fitRationaleAr(item)}
                    </div>

                    <div className="text-[0.68rem] font-mono text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-center" dir="ltr">
                      {formatOpticalDimensions(dims)} mm · عرض {dims.totalFrameWidthMm}mm
                    </div>

                    <a
                      href={`https://wa.me/${waNum(shop.wa)}?text=${waText}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn bg-[#D97706] hover:bg-[#B45309] text-white btn-sm w-full mt-auto text-xs"
                    >
                      <I n="msg" s={14} /> اختر هذه واطلب عبر واتساب
                    </a>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                const pollLink =
                  typeof window !== 'undefined'
                    ? `${window.location.origin}/s/${shop.slug}?poll=${cmpA.id},${cmpB.id}`
                    : `https://optiverse.app/s/${shop.slug}?poll=${cmpA.id},${cmpB.id}`;
                recordStoreFriendShare(shop.id);
                setCompareModalOpen(false);
                setModal({ t: 'vote', p: cmpA, p2: cmpB, link: pollLink });
              }}
              className="btn bg-[#0284C7] hover:bg-[#0369A1] text-white w-full !py-3 text-xs sm:text-sm"
            >
              <I n="share" s={16} /> اسأل أصدقاءك: أيهما أحلى عليّ؟ ⚖️
            </button>
          </div>
        </Modal>
      )}

      {/* Direct Frame Request & Medical Prescription Upload iOS Bottom Sheet */}
      {directOrder && (
        <Modal
          variant="sheet"
          title={`طلب الشمبر وإرسال الكشف — ${storeTradeName}`}
          onClose={() => setDirectOrder(null)}
          w="max-w-lg"
        >
          <div className="space-y-3.5">
            {/* Selected Frame Summary */}
            <div className="rounded-2xl bg-[#FAF8F5] border border-stone-200/85 p-3 flex items-center gap-3">
              <div className="rounded-xl bg-white border border-stone-200/70 p-2 shrink-0">
                <MiniGlasses
                  type={directOrder.product.type}
                  frame={directOrder.color}
                  lens={directOrder.product.lens}
                  w={82}
                  imageUrl={resolveStoreFrontUrl(directOrder.product)}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold text-sm text-[#0F172A] truncate">
                  {directOrder.product.name}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  المقاس: {directOrder.size} · {TYPES[directOrder.product.type]}
                </div>
                <div className="text-sm font-extrabold text-[#0F172A] tabular-nums mt-1">
                  <Pr x={directOrder.product} />
                </div>
              </div>
            </div>

            {/* Default Lens Choice + Optional Custom Lens Picker */}
            <div className="rounded-2xl bg-[#FAF8F5] border border-stone-200/85 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-[#0F172A]">اختيار العدسات</span>
                <button
                  type="button"
                  onClick={() =>
                    setDirectLensMode((m) => (m === 'specialist' ? 'custom' : 'specialist'))
                  }
                  className={
                    'px-2.5 py-1 rounded-lg border text-[0.7rem] font-extrabold cursor-pointer transition-all duration-150 active:scale-[0.97] ' +
                    (directLensMode === 'custom'
                      ? 'bg-[#0284C7] text-white border-[#0284C7]'
                      : 'bg-white text-[#0284C7] border-sky-200 hover:bg-sky-50')
                  }
                >
                  {directLensMode === 'specialist'
                    ? 'اختيار نوع العدسة (اختياري) ▾'
                    : 'العودة للاختيار الموصى به ✓'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setDirectLensMode('specialist')}
                className={
                  'w-full rounded-xl p-3 border text-start cursor-pointer transition-all duration-150 active:scale-[0.97] flex items-start justify-between gap-2 ' +
                  (directLensMode === 'specialist'
                    ? 'bg-emerald-50/90 border-[#059669] ring-1 ring-[#059669]'
                    : 'bg-white border-slate-200 opacity-80 hover:opacity-100')
                }
              >
                <div>
                  <div className="font-extrabold text-xs sm:text-sm text-[#0F172A]">
                    تحديد العدسات مع أخصائي المحل (موصى به)
                  </div>
                  <div className="text-[0.7rem] text-slate-600 mt-0.5 leading-5">
                    يراجع أخصائي {storeTradeName} كشفك ويرشّح لك العدسة الأنسب لمقاسك قبل أي دفع.
                  </div>
                </div>
                {directLensMode === 'specialist' && (
                  <span className="badge b-ok shrink-0">موصى به ✓</span>
                )}
              </button>

              {directLensMode === 'custom' && (
                <div className="space-y-2 pt-1">
                  <div className="text-[0.7rem] font-bold text-slate-600">
                    اختر نوع العدسة المبدئي (اختياري):
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {shopLensChoices.map((lt) => {
                      const active = directLensChoiceId === lt.id;
                      return (
                        <button
                          key={lt.id}
                          type="button"
                          onClick={() => setDirectLensChoiceId(lt.id)}
                          className={
                            'p-2 rounded-xl border text-start text-xs cursor-pointer transition ' +
                            (active
                              ? 'border-[#0284C7] bg-sky-50 text-[#0F172A] font-extrabold'
                              : 'border-slate-200 bg-white text-slate-700 font-bold')
                          }
                        >
                          <div className="truncate">{lt.name}</div>
                          <div className="text-[0.65rem] text-[#D97706] tabular-nums">
                            +{fmt(lt.price)} ج.م
                          </div>
                        </button>
                      );
                    })}
                    {!shopLensChoices.length &&
                      LENS_CATEGORIES.map((catOpt) => {
                        const active = directLensChoiceId === catOpt.key;
                        return (
                          <button
                            key={catOpt.key}
                            type="button"
                            onClick={() => setDirectLensChoiceId(catOpt.key)}
                            className={
                              'p-2 rounded-xl border text-start text-xs cursor-pointer transition ' +
                              (active
                                ? 'border-[#0284C7] bg-sky-50 text-[#0F172A] font-extrabold'
                                : 'border-slate-200 bg-white text-slate-700 font-bold')
                            }
                          >
                            <div className="truncate">{catOpt.nameAr}</div>
                          </button>
                        );
                      })}
                  </div>
                  {rxEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        setDirectOrder(null);
                        closeFrameDetail();
                        setLensQuickMode(false);
                        setTab('lens');
                      }}
                      className="text-[0.7rem] font-extrabold text-[#0284C7] hover:underline cursor-pointer"
                    >
                      فتح محدد العدسات التفصيلي (الشركات ودرجة الضغط) ↗
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Direct Medical Prescription Upload */}
            {!img ? (
              <label className="rounded-2xl border-2 border-dashed border-sky-300 bg-sky-50/40 hover:bg-sky-50 p-3.5 text-center cursor-pointer block transition">
                <span className="text-[#0284C7] inline-block">
                  <I n="upload" s={22} />
                </span>
                <div className="text-xs sm:text-sm font-extrabold text-[#0F172A] mt-1">
                  📸 ارفع صورة الكشف الطبي مباشرة (اختياري)
                </div>
                <div className="text-[0.68rem] text-slate-500">
                  تصل فوراً لقسم طلبات الواتساب والكشوفات الطبية عند {storeTradeName}
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={onFile}
                />
              </label>
            ) : (
              <div className="rounded-2xl bg-[#F8F9FA] border border-emerald-300 p-2.5 flex items-center gap-3">
                <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-slate-200 bg-white flex items-center justify-center">
                  {img === 'demo' ? (
                    <span className="text-[0.65rem] font-bold">كشف تجريبي</span>
                  ) : rxLocalPreview === 'pdf' || img.endsWith('.pdf') ? (
                    <span className="text-[0.65rem] font-bold">ملف PDF</span>
                  ) : (
                    <img src={rxLocalPreview || img} alt="الكشف الطبي" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 text-xs">
                  <div className="font-extrabold text-[#059669]">✓ تم إرفاق صورة الكشف الطبي</div>
                  <div className="text-slate-500">ستظهر للتاجر فور إرسال الطلب</div>
                </div>
                <button
                  type="button"
                  className="btn btn-d btn-sm"
                  onClick={() => {
                    setRxLocalPreview(null);
                    setImg(null);
                  }}
                >
                  <I n="trash" s={14} />
                </button>
              </div>
            )}

            {/* Customer Contact & Submit */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                className="inp"
                placeholder="اسمك *"
                value={cname}
                onChange={(e) => setCname(e.target.value)}
              />
              <input
                className="inp"
                dir="ltr"
                placeholder="رقم الموبايل *"
                value={cphone}
                onChange={(e) => setCphone(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                className="inp"
                dir="ltr"
                placeholder="مقاس PD (اختياري)"
                value={pd}
                onChange={(e) => setPd(e.target.value)}
              />
              <input
                className="inp"
                placeholder="ملاحظات للمحل (اختياري)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <button
              type="button"
              disabled={directSubmitting}
              onClick={() => void submitDirectOrder()}
              className="btn bg-[#D97706] hover:bg-[#B45309] text-white w-full !py-3.5 text-sm sm:text-base shadow-sm active:scale-[0.97] transition-transform duration-150"
            >
              <I n="msg" s={18} />{' '}
              {directSubmitting ? 'جاري إرسال الطلب...' : 'إرسال طلب الشمبر والكشف عبر واتساب'}
            </button>
          </div>
        </Modal>
      )}

      <nav className="fixed bottom-0 inset-x-0 z-40 glass-s border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)]">
        {(() => {
          const midIdx = Math.floor(nav.length / 2);
          const firstHalf = nav.slice(0, midIdx);
          const secondHalf = nav.slice(midIdx);
          const renderNavBtn = (n: [typeof tab, string, string]) => (
            <button
              key={n[0]}
              type="button"
              onClick={() => {
                setTab(n[0]);
                if (n[0] === 'shop') setDetailId(null);
              }}
              className={
                'relative flex-1 min-h-[44px] flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[.66rem] font-bold transition-all duration-150 active:scale-[0.97] cursor-pointer ' +
                (tab === n[0] ? 'text-[#0284C7]' : 'text-slate-500 hover:text-[#0F172A]')
              }
            >
              <span className="relative">
                <I n={n[2]} s={20} />
                {n[0] === 'fav' && fav.length > 0 && (
                  <span className="absolute -top-1.5 -end-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[.6rem] flex items-center justify-center tabular-nums">
                    {fav.length}
                  </span>
                )}
                {n[0] === 'cart' && cart.length > 0 && (
                  <span className="absolute -top-1.5 -end-2 min-w-[16px] h-4 px-1 rounded-full bg-[#D97706] text-white text-[.6rem] flex items-center justify-center tabular-nums">
                    {cart.length}
                  </span>
                )}
              </span>
              <span className="truncate">{n[1]}</span>
              {tab === n[0] && <span className="absolute -bottom-0.5 w-6 h-0.5 rounded-full bg-[#0284C7]" />}
            </button>
          );

          return (
            <div className="max-w-xl mx-auto flex items-end justify-between px-2 py-1.5 gap-1">
              {firstHalf.map(renderNavBtn)}
              <button
                type="button"
                onClick={() => {
                  setTab('shop');
                  setDetailId(null);
                  setCamOn(true);
                }}
                className="relative -mt-6 mx-1 flex flex-col items-center shrink-0 cursor-pointer group active:scale-[0.97] transition-transform duration-150"
                aria-label="جرّب الآن بالكاميرا"
              >
                <span className="w-14 h-14 rounded-full bg-[#0284C7] group-hover:bg-[#0369A1] text-white shadow-xl ring-4 ring-white flex items-center justify-center transition-transform duration-150 group-hover:scale-105">
                  <I n="camera" s={24} />
                </span>
                <span className="mt-1 text-[0.64rem] font-extrabold text-[#0284C7] whitespace-nowrap">
                  جرّب الآن
                </span>
              </button>
              {secondHalf.map(renderNavBtn)}
            </div>
          );
        })()}
      </nav>
    </div>
  );
}
