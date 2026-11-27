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
    addInquiry,
    toast,
    setModal,
    uploadAssetToStorage,
  } = useOptiVerse();

  const rxEnabled = Boolean(
    platformSettings.enableLensesSystem ?? platformSettings.enablePrescriptionLenses
  );
  const directoryEnabled = Boolean(platformSettings.enableStoresDirectory);

  const shop = shops.find((s) => s.slug === slug);
  const theme = resolveStoreTheme(shop?.themeKey, shop?.color);
  const isImageLogo = Boolean(shop?.logo && (/^(https?:|data:image\/|blob:|\/)/i.test(shop.logo)));
  const queryString = route.includes('?')
    ? route.split('?')[1]
    : typeof window !== 'undefined'
    ? window.location.search.slice(1)
    : '';
  const queryParams = new URLSearchParams(queryString);
  const isMerchantPreview = queryParams.get('preview') === '1';
  const autoFocusReview = queryParams.get('review') === '1';
  const autoTryOn = queryParams.get('tryon') === '1';
  const showPreviewBar =
    isMerchantPreview || Boolean(session && (session.role === 'merchant' || isAdminRole(session.role)));

  const products = allProductsRaw
    .filter(
      (p) =>
        p.shopId === shop?.id &&
        !p.isDeleted &&
        (showPreviewBar || p.isPublished !== false) &&
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
  const [cardSelectedColors, setCardSelectedColors] = useState<Record<string, string>>({});

  const [step, setStep] = useState(1);
  const [lensTrack, setLensTrack] = useState<LensTrack>('single_vision');
  const [labDesign, setLabDesign] = useState<CustomLabDesign>('progressive');
  const [lensCategory, setLensCategory] = useState<LensCategoryKey>('blue_cut');
  const [photoVariant, setPhotoVariant] = useState<PhotoVariant>('photo_grey');
  const [lensIndexChoice, setLensIndexChoice] = useState<LensIndex | 'store_decide'>('1.56');
  const [selectedLensBrandId, setSelectedLensBrandId] = useState<string>('');

  const [img, setImg] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [pd, setPd] = useState('');
  const [cname, setCname] = useState('');
  const [cphone, setCphone] = useState('');

  const [fc, setFc] = useState(cur?.frame || '#C9A24B');
  const [lc, setLc] = useState(cur?.lens || '#475569');
  const [cardAngles, setCardAngles] = useState<Record<string, 'front' | 'angled45'>>({});
  const [storeVisibleCount, setStoreVisibleCount] = useState(STORE_PAGE_SIZE);
  const pollHandledRef = useRef<string>('');
  const tryOnHandledRef = useRef<string>('');

  useEffect(() => {
    if (autoTryOn && tryOnHandledRef.current !== route) {
      tryOnHandledRef.current = route;
      setTab('shop');
      setDetailId(null);
      setCamOn(true);
    }
  }, [autoTryOn, route]);

  useEffect(() => {
    setStoreVisibleCount(STORE_PAGE_SIZE);
  }, [cat, shapeFilter, colorFilter, searchQuery, shop?.id]);

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
    navigate(`/s/${shop.slug}/f/${frameId}${isMerchantPreview ? '?preview=1' : ''}`);
  };

  const closeFrameDetail = () => {
    setDetailId(null);
    if (shop) {
      navigate(`/s/${shop.slug}${isMerchantPreview ? '?preview=1' : ''}`);
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

  if (!shop) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-6 text-center">
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
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass rounded-3xl p-8 max-w-md text-center space-y-3">
          <span className="w-16 h-16 rounded-full b-warn inline-flex items-center justify-center">
            <I n="pause" s={28} />
          </span>
          <h1 className="font-extrabold text-xl">{shop.name}</h1>
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
        className="min-h-screen flex items-center justify-center p-4"
        style={{ '--acc': theme.accent, backgroundColor: theme.pageBg, color: theme.text } as React.CSSProperties}
      >
        <div className="glass rounded-3xl p-8 max-w-md text-center space-y-3">
          <span
            className="w-14 h-14 rounded-2xl text-white text-2xl inline-flex items-center justify-center overflow-hidden"
            style={{ backgroundColor: theme.primary }}
          >
            {isImageLogo ? (
              <img src={shop.logo} alt={shop.name} className="w-full h-full object-contain bg-white p-1" />
            ) : (
              shop.logo
            )}
          </span>
          <h1 className="font-extrabold text-xl">{shop.name}</h1>
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
  const sortedProducts =
    cat === 'best_fit'
      ? [...filteredProducts].sort((a, b) => faceMatch(b, face) - faceMatch(a, face))
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

  const toggleCompareId = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };
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

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const c = await loadImageToCanvas(f, 1000);
      const blob = await canvasToBlob(c, 'image/webp', 0.85);
      const url = await uploadAssetToStorage(blob, `shops/${shop.id}/rx`, 'webp');
      setImg(url);
      toast('تم رفع وضغط صورة الكشف ✓');
    } catch {
      const r = new FileReader();
      r.onload = () => setImg(String(r.result));
      r.readAsDataURL(f);
    }
  };

  const submitRx = async () => {
    if (!cname.trim() || !cphone.trim()) {
      toast('اكتب اسمك ورقم موبايلك أولاً');
      return;
    }
    const brandDisplay = selectedBrandOption
      ? `${selectedBrandOption.nameAr}${
          selectedBrandOption.sponsorBadge !== 'none'
            ? ` (${SPONSOR_BADGE_LABELS[selectedBrandOption.sponsorBadge]})`
            : ''
        }`
      : '—';
    const estDaysTxt =
      lensTrack === 'custom_lab' && selectedBrandOption?.estimatedDays
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
      lensName: `${activeCatMeta.nameAr}${variantSuffix}`,
      brandName: brandDisplay,
      extrasTxt: `${trackLabelAr} · ${indexLabelAr}${estDaysTxt}`,
      fp: cur.price,
      lensPrice: lensEstimatedPrice,
      add: 0,
      price: total,
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
    setImg(null);
    setNotes('');
    setStep(1);
  };

  const Heart = ({ p }: { p: Product }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setFav((f) => (f.includes(p.id) ? f.filter((x) => x !== p.id) : [...f, p.id]));
      }}
      className="w-9 h-9 rounded-full bg-slate-900/10 hover:bg-slate-900/20 backdrop-blur-sm flex items-center justify-center cursor-pointer transition"
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
      className="pb-28 min-h-screen overflow-x-hidden"
      style={
        {
          '--acc': theme.accent,
          backgroundColor: theme.pageBg,
          color: theme.text,
        } as React.CSSProperties
      }
    >
      {/* Merchant Preview Return Bar (Hidden for regular customers) */}
      {showPreviewBar && (
        <div className="bg-slate-900 text-amber-400 sticky top-0 z-50 border-b border-amber-400/25 px-4 py-2.5">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-2 text-xs sm:text-sm">
            <span className="font-bold flex items-center gap-1.5 truncate">
              <I n="eye" s={15} /> أنت الآن في وضع المعاينة كعميل
            </span>
            <button
              type="button"
              onClick={() => navigate('/merchant')}
              className="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs whitespace-nowrap shrink-0 cursor-pointer transition"
            >
              العودة للوحة التحكم ↩
            </button>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-5 pt-2">
        <div className="flex items-center justify-between py-4 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-11 h-11 rounded-2xl text-white text-xl flex items-center justify-center shadow-sm shrink-0 overflow-hidden"
              style={{ backgroundColor: theme.primary }}
            >
              {isImageLogo ? (
                <img src={shop.logo} alt={shop.name} className="w-full h-full object-contain bg-white p-0.5" />
              ) : (
                shop.logo
              )}
            </span>
            <div className="min-w-0">
              <div className="font-extrabold leading-tight truncate flex items-center gap-1.5">
                <span>{shop.name}</span>
                {shop.isFeatured && <span title="متجر مميز">⭐</span>}
              </div>
              <div className="text-xs opacity-75 flex items-center gap-1.5 flex-wrap">
                <span>متجر نظارات تفاعلي · {shop.governorate || shop.city}</span>
                {Boolean(shop.mapsUrl && /^https?:\/\//i.test(shop.mapsUrl)) && (
                  <a
                    href={shop.mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold hover:underline inline-flex items-center gap-0.5"
                    style={{ color: theme.accent }}
                  >
                    <I n="map" s={11} /> الخريطة
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {directoryEnabled && (
              <button
                type="button"
                className="btn btn-g btn-sm whitespace-nowrap"
                onClick={() => navigate('/stores')}
              >
                <I n="map" s={14} /> دليل المحلات
              </button>
            )}
            <button type="button" className="btn btn-g btn-sm whitespace-nowrap shrink-0" onClick={() => setTab('cart')}>
              <I n="bag" s={15} /> <span className="tabular-nums">{cart.length}</span>
            </button>
          </div>
        </div>

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
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold inline-flex items-center gap-1 transition"
                >
                  📞 اتصال
                </a>
                <a
                  href={`https://wa.me/${waNum(shop.wa)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold inline-flex items-center gap-1 transition"
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
                alt={shop.name}
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
                      <img src={shop.logo} alt={shop.name} className="w-full h-full object-contain p-1" />
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
                <h1 className="text-2xl sm:text-4xl font-extrabold leading-tight">{shop.name}</h1>
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
                  className="btn !bg-white hover:!bg-slate-100 !text-[#0F172A] !px-4 !py-2.5 text-xs sm:text-sm shadow-sm"
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
                  className="btn !bg-[#0284C7] hover:!bg-[#0369A1] !text-white !px-4 !py-2.5 text-xs sm:text-sm shadow-sm"
                >
                  <I n="camera" s={16} /> جرّب بالكاميرا <span dir="ltr">3D</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'shop' && detailProduct && (
          <div className="mb-6">
            <ProductDetailsView
              product={detailProduct}
              relatedProducts={products.filter((p) => p.id !== detailProduct.id)}
              initialColor={detailProduct.id === cur.id ? fc : detailProduct.frame}
              initialSize={selectedSize}
              isFavorite={fav.includes(detailProduct.id)}
              autoFocusReview={autoFocusReview}
              initialRxUrl={img}
              onRxAttached={(rxUrl) => {
                setImg(rxUrl);
                if (rxUrl) toast('تم حفظ صورة الكشف للخطوة الأخيرة ✓');
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
                closeFrameDetail();
                if (rxEnabled) {
                  setTab('lens');
                } else {
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
                  setTab('cart');
                  setModal({ t: 'checkout', total: cartTotal + detailProduct.price });
                }
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
            closeFrameDetail();
            if (rxEnabled) {
              setTab('lens');
            } else {
              addCart({
                productId: targetProd.id,
                name: targetProd.name,
                desc: `إطار فقط · مقاس ${selectedSize}`,
                price: targetProd.price,
                type: targetProd.type,
                frame: fc,
                lens: lc,
                size: selectedSize,
              });
              setTab('cart');
              setModal({ t: 'checkout', total: cartTotal + targetProd.price });
            }
          }}
          initialRxUrl={img}
          onRxAttached={(rxUrl) => {
            setImg(rxUrl);
            if (rxUrl) toast('تم إرفاق روشتة كشف النظر ✓');
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
                    className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer"
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
                    className="w-full rounded-2xl bg-white border border-slate-200 focus:border-[#0284C7] ps-10 pe-4 py-2.5 text-sm text-[#0F172A] outline-none shadow-sm transition"
                  />
                  <span className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    🔍
                  </span>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {(
                    [
                      ['all', 'الكل'],
                      ['new_arrivals', 'وصل حديثاً ✨'],
                      ['prescription', 'طبي'],
                      ['sunglasses', 'شمس'],
                      ['metal', 'معادن'],
                      ['best_fit', 'الأكثر ملاءمة لوجهك'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCat(id)}
                      className={
                        'px-3.5 py-2 rounded-full text-xs font-extrabold whitespace-nowrap border transition cursor-pointer shrink-0 ' +
                        (cat === id
                          ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-sm'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-[#0284C7]')
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
                  const angled45Img = resolveAngled45Url(activeVariant);
                  const activeAngle = angled45Img && cardAngles[p.id] === 'angled45' ? 'angled45' : 'front';
                  const displayedCardUrl = activeAngle === 'angled45' && angled45Img ? angled45Img : storeImg;
                  const isCompared = compareIds.includes(activeVariant.id);

                  return (
                    <div
                      key={p.id}
                      onClick={() => openFrameDetail(activeVariant.id)}
                      className={
                        'rounded-2xl bg-white border p-3 sm:p-4 cursor-pointer transition text-slate-900 flex flex-col ' +
                        (isCompared
                          ? 'border-[#0284C7] ring-2 ring-[#0284C7]/25 shadow-md'
                          : 'border-slate-200 hover:border-slate-300 shadow-sm')
                      }
                    >
                      <div className="relative rounded-xl bg-[#F8F9FA] border border-slate-100 py-5 px-2 flex flex-col items-center justify-center min-h-[155px] sm:min-h-[175px]">
                        <MiniGlasses
                          type={activeVariant.type}
                          frame={activeSwatch}
                          lens={activeVariant.lens}
                          w={135}
                          imageUrl={displayedCardUrl}
                        />

                        {/* Top-Right: Wishlist Heart */}
                        <span className="absolute top-2 start-2 z-10">
                          <Heart p={activeVariant} />
                        </span>

                        {/* Top-Left: Compare 2 Frames Toggle */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCompareId(activeVariant.id);
                          }}
                          className={
                            'absolute top-2 end-2 z-10 px-2 py-1 rounded-lg text-[0.65rem] font-extrabold border transition cursor-pointer ' +
                            (isCompared
                              ? 'bg-[#0284C7] text-white border-[#0284C7] shadow-sm'
                              : 'bg-white/95 text-[#0F172A] border-slate-200 hover:border-slate-400')
                          }
                        >
                          {isCompared ? 'مختارة ✓' : 'قارن ⚖️'}
                        </button>

                        {/* Bottom-Right Floating Try-On Pill Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCurId(activeVariant.id);
                            setFc(activeSwatch);
                            setDetailId(null);
                            setCamOn(true);
                          }}
                          className="absolute bottom-2 start-2 z-10 px-2.5 py-1 rounded-full bg-[#0284C7] hover:bg-[#0369A1] text-white text-[0.66rem] font-extrabold shadow-sm cursor-pointer transition"
                        >
                          جرّب على وجهك
                        </button>

                        {angled45Img && (
                          <div
                            className="absolute bottom-2 end-2 z-10 inline-flex rounded-lg bg-white/90 p-0.5 border border-slate-200"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => setCardAngles((prev) => ({ ...prev, [p.id]: 'front' }))}
                              className={
                                'px-1.5 py-0.5 rounded text-[0.58rem] font-bold cursor-pointer ' +
                                (activeAngle === 'front' ? 'bg-slate-900 text-white' : 'text-slate-600')
                              }
                            >
                              أمامي
                            </button>
                            <button
                              type="button"
                              onClick={() => setCardAngles((prev) => ({ ...prev, [p.id]: 'angled45' }))}
                              className={
                                'px-1.5 py-0.5 rounded text-[0.58rem] font-bold cursor-pointer ' +
                                (activeAngle === 'angled45' ? 'bg-slate-900 text-white' : 'text-slate-600')
                              }
                            >
                              جانبي 3/4
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 font-extrabold text-sm text-[#0F172A] truncate">{activeVariant.name}</div>
                      <div className="text-[0.68rem] text-slate-500 font-mono mt-0.5" dir="ltr" style={{ textAlign: 'start' }}>
                        {formatOpticalDimensions(resolveProductOpticalDimensions(activeVariant))} mm
                      </div>

                      {((shop.showStockCountToCustomer && (activeVariant.stock ?? 1) === 1) || isActiveNewCollection(activeVariant)) && (
                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                          {isActiveNewCollection(activeVariant) && (
                            <span className="px-2 py-0.5 rounded-md bg-sky-50 text-[#0284C7] border border-sky-200 text-[0.62rem] font-extrabold">
                              كوليكشن جديد ✨
                            </span>
                          )}
                          {shop.showStockCountToCustomer && (activeVariant.stock ?? 1) === 1 && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-300 text-[0.62rem] font-extrabold">
                              متبقي قطعة واحدة فقط!
                            </span>
                          )}
                        </div>
                      )}

                      {/* Interactive Color Swatches (Respects shop.showColorSwatchesToCustomer) */}
                      {shop.showColorSwatchesToCustomer !== false && (
                        <div
                          className="flex items-center gap-1.5 mt-2 flex-wrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {swatches.slice(0, 5).map((hex) => (
                            <button
                              key={hex}
                              type="button"
                              aria-label={`لون ${hex}`}
                              onClick={() => {
                                setCardSelectedColors((prev) => ({ ...prev, [p.id]: hex }));
                                if (cur.id === activeVariant.id) setFc(hex);
                              }}
                              className={
                                'w-4 h-4 rounded-full border cursor-pointer transition ' +
                                (activeSwatch === hex ? 'ring-2 ring-[#0F172A] ring-offset-1 border-[#0F172A]' : 'border-slate-300')
                              }
                              style={{
                                background:
                                  hex === 'transparent'
                                    ? 'linear-gradient(135deg, #ffffff 45%, #e2e8f0 55%)'
                                    : hex,
                              }}
                            />
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-100 gap-1">
                        <span className="text-[#0F172A] font-extrabold text-sm">
                          <Pr x={activeVariant} />
                        </span>
                        <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-[#059669] border border-emerald-200 text-[0.65rem] font-bold tabular-nums">
                          {faceMatch(activeVariant, face)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {list.length > STORE_PAGE_SIZE && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white border border-slate-200 px-4 py-3 text-xs text-slate-700">
                  <span>
                    عرض <b>{Math.min(storeVisibleCount, list.length)}</b> من <b>{list.length}</b> نظارة
                  </span>
                  {list.length > storeVisibleCount && (
                    <button
                      type="button"
                      className="px-3.5 py-1.5 rounded-xl bg-slate-900 text-white font-bold cursor-pointer"
                      onClick={() => setStoreVisibleCount((c) => c + STORE_PAGE_SIZE)}
                    >
                      عرض المزيد (+{Math.min(STORE_PAGE_SIZE, list.length - storeVisibleCount)})
                    </button>
                  )}
                </div>
              )}

              {!list.length && (
                <div className="rounded-2xl bg-white border border-slate-200 text-center text-slate-500 py-10 text-sm">
                  لا توجد نظارات مطابقة لهذا التصنيف حالياً
                </div>
              )}
            </section>

            {/* Section 2: وصل حديثاً (Horizontal Scrollable New Arrivals) */}
            {newestFrames.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg sm:text-xl font-extrabold text-[#0F172A]">وصل حديثاً</h2>
                  <span className="text-xs font-bold text-[#0284C7]">أحدث إضافات المتجر</span>
                </div>
                <div className="flex overflow-x-auto gap-3.5 pb-2 snap-x">
                  {newestFrames.map((np) => (
                    <div
                      key={np.id}
                      onClick={() => openFrameDetail(np.id)}
                      className="min-w-[185px] sm:min-w-[210px] snap-start rounded-2xl bg-white border border-[#E2E8F0] p-3 cursor-pointer hover:border-[#0284C7] transition shrink-0 shadow-sm"
                    >
                      <div className="relative rounded-xl bg-[#F8F9FA] py-4 px-2 flex items-center justify-center mb-2.5">
                        <span className="absolute top-1.5 start-1.5 px-2 py-0.5 rounded-full bg-amber-50 text-[#B45309] border border-amber-200 text-[0.62rem] font-extrabold">
                          جديد ✨
                        </span>
                        <MiniGlasses
                          type={np.type}
                          frame={np.frame}
                          lens={np.lens}
                          w={115}
                          imageUrl={resolveStoreFrontUrl(np)}
                        />
                      </div>
                      <div className="font-extrabold text-xs sm:text-sm text-[#0F172A] truncate">{np.name}</div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs font-extrabold text-[#D97706]">
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
                          className="text-[0.65rem] font-extrabold text-[#0284C7] hover:underline cursor-pointer"
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
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
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
                          'py-2.5 px-3 rounded-xl border text-xs font-extrabold cursor-pointer transition ' +
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
                          'py-2.5 px-3 rounded-xl border text-xs font-extrabold cursor-pointer transition flex items-center gap-2 ' +
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
              </div>
            </div>

            <div className="lg:col-span-3">
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
                          <input type="file" accept="image/*" className="hidden" onChange={onFile} />
                        </label>
                        <button
                          type="button"
                          className="rounded-2xl border border-[#E2E8F0] bg-white hover:bg-slate-50 p-4 text-center cursor-pointer transition"
                          onClick={() => setImg('demo')}
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
                          ) : (
                            <img src={img} alt="كشف" className="w-full h-24 object-cover" />
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
                        <button type="button" className="btn btn-d btn-sm" onClick={() => setImg(null)}>
                          <I n="trash" s={14} />
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2.5">
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
                    <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 text-xs leading-6 text-amber-900">
                      {effectiveIndexChoice === 'store_decide'
                        ? 'سيراجع أخصائي البصريات كشفك لتحديد درجة الضغط والسعر النهائي الأنسب قبل أي دفع.'
                        : 'صاحب المحل هيراجع الكشف ويأكد لك الملاءمة والسعر النهائي قبل أي دفع — السعر الظاهر مبدئي.'}
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
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
        <div className="fixed bottom-16 inset-x-0 z-40 px-4 pointer-events-none">
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

            <div className="grid grid-cols-2 gap-3">
              {[cmpA, cmpB].map((item, idx) => {
                const imgUrl =
                  cmpViewAngle === 'angled45' && resolveAngled45Url(item)
                    ? resolveAngled45Url(item)
                    : resolveStoreFrontUrl(item);
                const matchPct = faceMatch(item, face);
                const dims = resolveProductOpticalDimensions(item);
                const waText = encodeURIComponent(
                  `مرحباً ${shop.name}، بعد المقارنة اخترت نظارة "${item.name}" (${item.modelCode || item.code}) بسعر ${fmt(item.price)} ج.م.`
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

      <nav className="fixed bottom-0 inset-x-0 z-40 glass-s border-x-0 border-b-0">
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
                'relative flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[.66rem] font-bold transition cursor-pointer ' +
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
                className="relative -mt-6 mx-1 flex flex-col items-center shrink-0 cursor-pointer group"
                aria-label="جرّب الآن بالكاميرا"
              >
                <span className="w-14 h-14 rounded-full bg-[#0284C7] group-hover:bg-[#0369A1] text-white shadow-xl ring-4 ring-white flex items-center justify-center transition-transform group-hover:scale-105">
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
