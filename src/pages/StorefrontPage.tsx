import React, { useEffect, useState } from 'react';
import { CATS, DEFAULT_SHOP_ID, FRAME_COLORS, LENS_COLORS, SHAPES, TYPES, faceMatch } from '../data/seed';
import { isShopExpiredOrPaused, useOptiVerse } from '../services/optiverseStore';
import { FaceShape, FrameSize, Inquiry, Product } from '../types';
import { FaceTryOnStage } from '../components/FaceTryOnStage';
import { Corners, Face, MiniGlasses, getCoatingStyle } from '../components/GlassesGraphics';
import { I, ICON_PATHS } from '../components/Icons';
import { ProductDetailsView } from '../components/ProductDetailsView';
import { D, Egp, Empty, Pr, Stages, fmt, qBadge } from '../components/UiShared';
import { canvasToBlob, loadImageToCanvas } from '../utils/visionPipeline';
import { resolveAngled45Url, resolveStoreFrontUrl } from '../utils/bulkFrameProcessor';
import { formatOpticalDimensions, resolveProductOpticalDimensions } from '../utils/opticalDimensions';

const STORE_PAGE_SIZE = 24;

export function StorefrontPage({ slug, initialFrameId }: { slug: string; initialFrameId?: string }) {
  const {
    route,
    navigate,
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
    lensTypes,
    brands,
    extras,
    uploadAssetToStorage,
  } = useOptiVerse();

  const shop = shops.find((s) => s.slug === slug) || shops[0];
  const queryString = route.includes('?')
    ? route.split('?')[1]
    : typeof window !== 'undefined'
    ? window.location.search.slice(1)
    : '';
  const queryParams = new URLSearchParams(queryString);
  const isMerchantPreview = queryParams.get('preview') === '1';

  const products = allProductsRaw
    .filter((p) => p.shopId === shop.id && !p.isDeleted && (isMerchantPreview || p.isPublished !== false))
    .map(D);

  const [tab, setTab] = useState<'shop' | 'lens' | 'fav' | 'ord' | 'cart'>('shop');
  const [curId, setCurId] = useState<string>(initialFrameId || products[0]?.id || '');
  const [detailId, setDetailId] = useState<string | null>(initialFrameId || null);
  const cur = products.find((p) => p.id === curId) || products[0];
  const detailProduct = detailId ? products.find((p) => p.id === detailId) || null : null;

  const [cat, setCat] = useState<string>('all');
  const [face, setFace] = useState<FaceShape>('oval');
  const [selectedSize, setSelectedSize] = useState<FrameSize>('Medium');
  const [camOn, setCamOn] = useState(false);
  const [yaw, setYaw] = useState(0);
  const [split, setSplit] = useState(false);
  const [cmpId, setCmpId] = useState<string>(products[1]?.id || products[0]?.id || '');
  const cmp =
    products.find((p) => p.id === cmpId && p.id !== cur?.id) ||
    products.find((p) => p.id !== cur?.id) ||
    cur;

  const [step, setStep] = useState(1);
  const [lt, setLt] = useState('ar');
  const [br, setBr] = useState('best');
  const [ex, setEx] = useState<string[]>([]);

  const [img, setImg] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [pd, setPd] = useState('');
  const [cname, setCname] = useState('');
  const [cphone, setCphone] = useState('');

  const [fc, setFc] = useState(cur?.frame || '#C9A24B');
  const [lc, setLc] = useState(cur?.lens || '#475569');
  const [cardAngles, setCardAngles] = useState<Record<string, 'front' | 'angled45'>>({});
  const [storeVisibleCount, setStoreVisibleCount] = useState(STORE_PAGE_SIZE);

  useEffect(() => {
    setStoreVisibleCount(STORE_PAGE_SIZE);
  }, [cat, shop?.id]);

  // Sync /s/[slug]/f/[frameId] route param with detail view
  useEffect(() => {
    if (initialFrameId) {
      const matched = products.find((p) => p.id === initialFrameId);
      if (matched) {
        setCurId(matched.id);
        setDetailId(matched.id);
        setTab('shop');
      }
    } else if (route.startsWith(`/s/${shop.slug}`) && !route.includes(`/s/${shop.slug}/f/`)) {
      setDetailId(null);
    }
  }, [initialFrameId, route, shop.slug, products.length]);

  const openFrameDetail = (frameId: string) => {
    setCurId(frameId);
    setDetailId(frameId);
    setTab('shop');
    navigate(`/s/${shop.slug}/f/${frameId}${isMerchantPreview ? '?preview=1' : ''}`);
  };

  const closeFrameDetail = () => {
    setDetailId(null);
    navigate(`/s/${shop.slug}${isMerchantPreview ? '?preview=1' : ''}`);
  };

  // Support deep linking via ?f=FRAME_CODE or ?product=PRODUCT_ID
  useEffect(() => {
    const qStr = route.includes('?')
      ? route.split('?')[1]
      : typeof window !== 'undefined'
      ? window.location.search.slice(1)
      : '';
    if (!qStr) return;
    const params = new URLSearchParams(qStr);
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
  }, [route, shop.id, products.length]);

  useEffect(() => {
    if (cur) {
      setFc(cur.frame);
      setLc(cur.lens);
      const sizes = cur.availableSizes && cur.availableSizes.length ? cur.availableSizes : (['Small', 'Medium', 'Large'] as FrameSize[]);
      setSelectedSize(sizes.includes('Medium') ? 'Medium' : sizes[0]);
    }
  }, [cur?.id]);

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
      <div className="min-h-screen flex items-center justify-center p-4" style={{ '--acc': shop.color } as React.CSSProperties}>
        <div className="glass rounded-3xl p-8 max-w-md text-center space-y-3">
          <span className="w-14 h-14 rounded-2xl bg-[#0F172A] text-white text-2xl inline-flex items-center justify-center">
            {shop.logo}
          </span>
          <h1 className="font-extrabold text-xl">{shop.name}</h1>
          <p className="text-sm opacity-75">لا توجد نظارات منشورة في هذا المتجر حالياً — ترقّب أحدث الموديلات قريباً.</p>
        </div>
      </div>
    );
  }

  const lensV = lensTypes.filter((l) => (l.shopId || DEFAULT_SHOP_ID) === shop.id && l.on !== false).map(D);
  const brandV = brands.filter((b) => (b.shopId || DEFAULT_SHOP_ID) === shop.id && b.on !== false).map(D);
  const extrasV = extras.filter((e) => (e.shopId || DEFAULT_SHOP_ID) === shop.id && e.on !== false).map(D);

  const lensObj = lensV.find((l) => l.id === lt) || lensV[0] || { id: '_', name: 'غير متاح', en: '', desc: '', price: 0, orig: 0, icon: 'eye' };
  const brObj = brandV.find((b) => b.id === br) || brandV[0] || { id: '_', name: '—', en: '', price: 0, orig: 0 };
  const exV = ex.filter((id) => extrasV.some((e) => e.id === id));
  const extSum = exV.reduce((s, id) => s + (extrasV.find((e) => e.id === id)?.price || 0), 0);
  const lensP = lensObj.price + brObj.price + extSum;
  const total = cur.price + lensP;
  const match = faceMatch(cur, face);
  const recs = [...products].sort((a, b) => faceMatch(b, face) - faceMatch(a, face)).slice(0, 3);
  const matchesFilter = (p: Product, filterId: string): boolean => {
    if (filterId === 'all') return true;
    if (filterId === 'prescription') {
      return p.frameType === 'prescription' || (!p.frameType && (p.cat === 'med' || p.cat === 'safe') && p.type !== 'rimless');
    }
    if (filterId === 'sunglasses') {
      return p.frameType === 'sunglasses' || (!p.frameType && p.cat === 'sun');
    }
    if (filterId === 'clip_on') {
      return p.frameType === 'clip_on';
    }
    if (filterId === 'kids') {
      return p.frameType === 'kids';
    }
    if (filterId === 'metal') {
      return p.frameType === 'metal' || (!p.frameType && p.type === 'rimless');
    }
    return true;
  };
  const list = products.filter((p) => matchesFilter(p, cat));
  const coatInfo = getCoatingStyle(lensObj.id, yaw);

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
      lensName: lensObj.name,
      brandName: brObj.name,
      extrasTxt: exV.length ? exV.map((id) => extrasV.find((e) => e.id === id)?.name).join('، ') : 'بدون إضافات',
      fp: cur.price,
      lensPrice: lensObj.price,
      add: brObj.price + extSum,
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
    setEx([]);
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
    ['lens', 'العدسات', 'eye'],
    ['fav', 'المفضلة', 'heart'],
    ['ord', 'طلباتي', 'receipt'],
    ['cart', 'السلة', 'bag'],
  ];
  const steps = ['نوع العدسة', 'الشركة المصنعة', 'إضافات الحماية', 'الكشف والاستفسار'];
  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/s/${shop.slug}/f/${cur.id}`
      : `optiverse.com/s/${shop.slug}/f/${cur.id}`;

  return (
    <div className="pt-2 pb-24 min-h-screen" style={{ '--acc': shop.color } as React.CSSProperties}>
      <div className="max-w-5xl mx-auto px-3 sm:px-5">
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-[#0F172A] text-white text-xl flex items-center justify-center shadow-sm">
              {shop.logo}
            </span>
            <div>
              <div className="font-extrabold leading-tight text-[#0F172A]">{shop.name}</div>
              <div className="text-xs text-slate-500">متجر نظارات تفاعلي · {shop.city}</div>
            </div>
          </div>
          <button className="btn btn-g btn-sm" onClick={() => setTab('cart')}>
            <I n="bag" s={15} /> <span className="tabular-nums">{cart.length}</span>
          </button>
        </div>

        <div className="relative overflow-hidden rounded-3xl bg-white border border-[#E2E8F0] shadow-sm p-5 mb-5 text-center">
          <div className="relative">
            <span className="badge b-acc mb-2">
              <I n="spark" s={12} /> تجربة حية من بيتك
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] leading-snug">اختار نظاراتك وأنت في البيت</h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-1.5">
              جرّب على وشك بالكاميرا بمقياس 1:1 الحقيقي، شاركها مع صحابك، وابعت كشف نظرك للمحل
            </p>
          </div>
        </div>

        {tab === 'shop' && detailProduct && (
          <div className="mb-6">
            <ProductDetailsView
              product={detailProduct}
              relatedProducts={products.filter((p) => p.id !== detailProduct.id)}
              initialColor={detailProduct.id === cur.id ? fc : detailProduct.frame}
              initialSize={selectedSize}
              isFavorite={fav.includes(detailProduct.id)}
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
                setTab('lens');
              }}
            />
          </div>
        )}

        {tab === 'shop' && !detailProduct && (
          <div className="grid lg:grid-cols-2 gap-5 fade">
            <div>
              <div className="glass rounded-3xl overflow-hidden">
                <FaceTryOnStage
                  product={cur}
                  products={products}
                  onSelectProduct={setCurId}
                  onOrderProduct={(pid) => {
                    setCurId(pid);
                    setCamOn(false);
                    closeFrameDetail();
                    setTab('lens');
                  }}
                  initialRxUrl={img}
                  onRxAttached={(rxUrl) => {
                    setImg(rxUrl);
                    if (rxUrl) toast('تم إرفاق روشتة كشف النظر ✓');
                  }}
                  compareProduct={cmp}
                  splitMode={split}
                  frameColor={fc}
                  lensColor={lc}
                  frameSize={selectedSize}
                  coatingId={lensObj.id}
                  faceShape={face}
                  onFaceShapeDetected={setFace}
                  camOn={camOn}
                  onStartCam={() => setCamOn(true)}
                  onModeChange={(m) => {
                    if (m === 'photo') setCamOn(false);
                  }}
                  yawManual={yaw}
                  onYawManualChange={setYaw}
                />

                {/* Interactive Try-On Controls: Size, Yaw, Face Shape, Split View, Share & Friend Vote */}
                <div className="p-3.5 border-t border-[#E2E8F0] space-y-2.5 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-extrabold text-sm text-[#0F172A] truncate">{cur.name}</div>
                      <div className="text-[0.72rem] text-slate-600 flex items-center gap-1.5 flex-wrap">
                        <span>{TYPES[cur.type]}</span>
                        <span>·</span>
                        <span>{CATS[cur.cat]}</span>
                        <span>·</span>
                        <span className="font-mono text-[#0284C7] font-bold" dir="ltr">
                          {formatOpticalDimensions(resolveProductOpticalDimensions(cur))} mm
                        </span>
                        <span>·</span>
                        <Pr x={cur} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="btn btn-g btn-sm"
                        onClick={() => openFrameDetail(cur.id)}
                      >
                        التفاصيل
                      </button>
                      <button
                        type="button"
                        className="btn btn-g btn-sm"
                        onClick={() => setModal({ t: 'vote', p: cur, link: shareUrl })}
                      >
                        <I n="share" s={14} /> شارك
                      </button>
                    </div>
                  </div>

                  {/* Frame Size Calibration Switcher */}
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="opacity-70 whitespace-nowrap">مقاس الإطار:</span>
                    <div className="flex items-center gap-1">
                      {(cur.availableSizes && cur.availableSizes.length
                        ? cur.availableSizes
                        : (['Small', 'Medium', 'Large'] as FrameSize[])
                      ).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => setSelectedSize(sz)}
                          className={'chip !py-1 !px-2.5 !text-[0.7rem] ' + (selectedSize === sz ? 'on' : '')}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Horizontal Angle Preview Slider */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="opacity-70 whitespace-nowrap">زاوية الوجه:</span>
                    <input
                      type="range"
                      min={-45}
                      max={45}
                      step={1}
                      value={yaw}
                      onChange={(e) => setYaw(+e.target.value)}
                      className="flex-1 accent-[var(--acc)]"
                    />
                    <span className="font-mono-num w-10 text-center opacity-80" dir="ltr">
                      {yaw}°
                    </span>
                    {yaw !== 0 && (
                      <button
                        type="button"
                        onClick={() => setYaw(0)}
                        className="text-[0.7rem] tx-acc underline cursor-pointer whitespace-nowrap"
                      >
                        توسيط
                      </button>
                    )}
                  </div>

                  {/* Face Shape Selector + Split View Toggle */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      {(Object.entries(SHAPES) as [FaceShape, string][]).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setFace(key)}
                          className={'chip !py-1 !px-2.5 !text-[0.72rem] ' + (face === key ? 'on' : '')}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {products.length >= 2 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSplit((v) => !v)}
                          className={'chip !py-1 !px-2.5 !text-[0.72rem] ' + (split ? 'on' : '')}
                        >
                          مقارنة 2 إطار
                        </button>
                        {split && (
                          <select
                            className="inp !w-auto !py-1 !px-2 text-xs"
                            value={cmp?.id || ''}
                            onChange={(e) => setCmpId(e.target.value)}
                          >
                            {products
                              .filter((p) => p.id !== cur.id)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-[#E2E8F0] bg-[#F8F9FA] p-3 grid grid-cols-2 gap-2.5">
                  <button
                    className="btn btn-g !py-2.5"
                    onClick={() => openFrameDetail(cur.id)}
                  >
                    <I n="box" s={16} /> صفحة المنتج
                  </button>
                  <button
                    className="btn bg-[#D97706] hover:bg-[#B45309] text-white !py-2.5 shadow-sm"
                    onClick={() => setTab('lens')}
                  >
                    <I n="eye" s={16} /> اختر العدسة والكشف
                  </button>
                </div>
              </div>

              <div className="glass rounded-2xl p-4 mt-4">
                <div className="flex items-center gap-2 font-bold text-[#0F172A] mb-3">
                  <span className="text-[#0284C7]">
                    <I n="spark" s={18} />
                  </span>
                  توصيات الذكاء الاصطناعي لوجه {SHAPES[face]} (تطابق حالي {match}%)
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {recs.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setCurId(p.id)}
                      className={
                        'rounded-xl p-2 text-center border transition cursor-pointer ' +
                        (cur.id === p.id
                          ? 'border-[#0284C7] bg-sky-50 shadow-sm'
                          : 'border-[#E2E8F0] bg-[#F8F9FA] hover:border-slate-300')
                      }
                    >
                      <div className="rounded-lg bg-white border border-slate-100 py-2 px-1 flex justify-center mb-1.5">
                        <MiniGlasses
                          type={p.type}
                          frame={p.frame}
                          lens={p.lens}
                          w={80}
                          imageUrl={resolveStoreFrontUrl(p)}
                        />
                      </div>
                      <div className="text-[.7rem] font-bold text-[#0F172A] mt-1 truncate">{p.name}</div>
                      <div className="text-xs text-[#059669] font-extrabold tabular-nums">{faceMatch(p, face)}%</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* White Studio Catalog Showcase (#F8F9FA) */}
            <div className="rounded-3xl bg-[#F8F9FA] text-slate-900 border border-slate-200 p-4 shadow-sm">
              <div className="flex gap-1.5 overflow-x-auto noscroll pb-3 mb-1">
                {[
                  ['all', 'الكل'],
                  ['prescription', 'طبي'],
                  ['sunglasses', 'شمس'],
                  ['clip_on', 'بغيار شمس'],
                  ['kids', 'أطفال'],
                  ['metal', 'معادن'],
                ].map((c) => (
                  <button
                    key={c[0]}
                    type="button"
                    className={
                      'px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap transition cursor-pointer border ' +
                      (cat === c[0]
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400')
                    }
                    onClick={() => setCat(c[0])}
                  >
                    {c[1]}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {list.slice(0, storeVisibleCount).map((p) => {
                  const storeImg = resolveStoreFrontUrl(p);
                  const angled45Img = resolveAngled45Url(p);
                  const activeAngle = angled45Img && cardAngles[p.id] === 'angled45' ? 'angled45' : 'front';
                  const displayedCardUrl = activeAngle === 'angled45' && angled45Img ? angled45Img : storeImg;

                  return (
                    <div
                      key={p.id}
                      onClick={() => openFrameDetail(p.id)}
                      className={
                        'rounded-2xl bg-white border p-3 cursor-pointer transition text-slate-900 ' +
                        (cur.id === p.id
                          ? 'border-slate-900 ring-2 ring-slate-900/15 shadow-md'
                          : 'border-slate-200 hover:border-slate-300 shadow-sm')
                      }
                    >
                      <div className="relative rounded-xl bg-[#F8F9FA] border border-slate-100 py-3 px-2 flex flex-col items-center justify-center">
                        <MiniGlasses
                          type={p.type}
                          frame={p.frame}
                          lens={p.lens}
                          w={120}
                          imageUrl={displayedCardUrl}
                        />
                        {p.frameType === 'clip_on' && (
                          <span className="absolute top-1.5 start-1.5 px-1.5 py-0.5 rounded-md bg-slate-900/85 text-white text-[0.6rem] font-extrabold">
                            غيار شمس
                          </span>
                        )}
                        {p.frameType === 'kids' && (
                          <span className="absolute top-1.5 start-1.5 px-1.5 py-0.5 rounded-md bg-teal-700 text-white text-[0.6rem] font-extrabold">
                            أطفال
                          </span>
                        )}
                        <span className="absolute top-1.5 end-1.5">
                          <Heart p={p} />
                        </span>
                        {angled45Img && (
                          <div
                            className="mt-2 inline-flex rounded-lg bg-slate-200/75 p-0.5 border border-slate-200"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => setCardAngles((prev) => ({ ...prev, [p.id]: 'front' }))}
                              className={
                                'px-2 py-0.5 rounded text-[0.65rem] font-bold transition cursor-pointer ' +
                                (activeAngle === 'front'
                                  ? 'bg-slate-900 text-white shadow-sm'
                                  : 'text-slate-700 hover:text-slate-950')
                              }
                            >
                              أمامي
                            </button>
                            <button
                              type="button"
                              onClick={() => setCardAngles((prev) => ({ ...prev, [p.id]: 'angled45' }))}
                              className={
                                'px-2 py-0.5 rounded text-[0.65rem] font-bold transition cursor-pointer ' +
                                (activeAngle === 'angled45'
                                  ? 'bg-slate-900 text-white shadow-sm'
                                  : 'text-slate-700 hover:text-slate-950')
                              }
                            >
                              جانبي 3/4
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="mt-2 font-extrabold text-sm text-[#0F172A] truncate">{p.name}</div>
                      <div className="text-[0.68rem] text-slate-500 font-mono mt-0.5 flex items-center justify-between gap-1" dir="ltr">
                        <span>{formatOpticalDimensions(resolveProductOpticalDimensions(p))} mm</span>
                        <span>{resolveProductOpticalDimensions(p).totalFrameWidthMm}mm</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 gap-1">
                        <span className="text-[#0F172A] font-extrabold text-sm">
                          <Pr x={p} />
                        </span>
                        <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-[#059669] border border-emerald-200 text-[0.68rem] font-bold tabular-nums">
                          {faceMatch(p, face)}%
                        </span>
                      </div>
                      <div className="flex gap-1.5 mt-2">
                        <button
                          type="button"
                          className="py-2 px-2.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-extrabold flex-1 cursor-pointer transition shadow-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCurId(p.id);
                            setDetailId(null);
                            setCamOn(true);
                          }}
                        >
                          جربها الآن
                        </button>
                        <button
                          type="button"
                          className="px-2.5 py-2 rounded-xl bg-[#F8F9FA] hover:bg-slate-200 border border-[#E2E8F0] text-[#0F172A] cursor-pointer transition"
                          title="إضافة للسلة"
                          onClick={(e) => {
                            e.stopPropagation();
                            const defaultSz = p.availableSizes?.[0] || 'Medium';
                            addCart({
                              productId: p.id,
                              name: p.name,
                              desc: `إطار فقط · مقاس ${defaultSz}`,
                              price: p.price,
                              type: p.type,
                              frame: p.frame,
                              lens: p.lens,
                              size: defaultSz,
                            });
                          }}
                        >
                          <I n="plus" s={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {list.length > STORE_PAGE_SIZE && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white border border-slate-200 px-4 py-3 text-xs text-slate-700">
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
              {!list.length && <div className="text-center text-slate-500 py-10 text-sm">لا توجد نظارات في هذه الفئة</div>}
            </div>
          </div>
        )}

        {tab === 'lens' && (
          <div className="grid lg:grid-cols-5 gap-5 fade">
            <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-6 self-start">
              <div className="glass rounded-3xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#E2E8F0] text-xs">
                  <span className="text-[#0284C7] font-bold">{coatInfo.label}</span>
                  <span className="text-slate-600">معاينة العدسة على الوجه</span>
                </div>
                <div className="relative grid-bg aspect-[4/3.4]">
                  <Corners />
                  <Face
                    shape={face}
                    type={cur.type}
                    frame={fc}
                    lens={lc}
                    yaw={yaw}
                    tracking={false}
                    coatingId={lensObj.id}
                    isSun={cur.cat === 'sun'}
                  />
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

              <div className="glass rounded-2xl p-4 tabular-nums">
                <div className="flex justify-between text-sm text-slate-600 mb-1">
                  <span>الإطار</span>
                  <Egp v={cur.price} />
                </div>
                <div className="flex justify-between text-sm text-slate-600 mb-1">
                  <span>{lensObj.name}</span>
                  <Egp v={lensObj.price} />
                </div>
                <div className="flex justify-between text-sm text-slate-600 mb-1">
                  <span>الشركة: {brObj.name}</span>
                  <span>+{fmt(brObj.price)}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-600 mb-2">
                  <span>الإضافات</span>
                  <span>+{fmt(extSum)}</span>
                </div>
                <div className="flex justify-between font-extrabold text-xl border-t border-[#E2E8F0] pt-3 text-[#0F172A]">
                  <span>الإجمالي</span>
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
                      <button onClick={() => setStep(i + 1)} className="flex flex-col items-center gap-1 flex-1 min-w-0 cursor-pointer">
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
                        <span className={'text-[.65rem] text-center leading-tight ' + (step === i + 1 ? 'font-bold text-[#0F172A]' : 'text-slate-500')}>
                          {s}
                        </span>
                      </button>
                      {i < 3 && <span className={'h-0.5 w-4 sm:w-8 rounded ' + (step > i + 1 ? 'bg-[#059669]' : 'bg-slate-200')} />}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div className="fade" key={step}>
                {step === 1 && (
                  <div className="space-y-2.5">
                    <h3 className="font-extrabold text-[#0F172A]">الخطوة 1: اختار نوع العدسة</h3>
                    {!lensV.length && (
                      <div className="glass rounded-2xl p-4 text-sm text-center text-slate-500">غير متاح حالياً — تواصل مع المحل</div>
                    )}
                    {lensV.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => setLt(l.id)}
                        className={
                          'w-full flex items-center gap-3 p-3.5 rounded-2xl border text-start transition cursor-pointer ' +
                          (lensObj.id === l.id
                            ? 'border-[#0284C7] bg-sky-50 shadow-sm'
                            : 'border-[#E2E8F0] bg-white hover:border-slate-300')
                        }
                      >
                        <span className="w-11 h-11 rounded-xl b-acc flex items-center justify-center">
                          <I n={l.icon} s={21} />
                        </span>
                        <div className="flex-1">
                          <div className="font-bold text-sm text-[#0F172A]">
                            {l.name}{' '}
                            <span className="text-xs text-slate-500" dir="ltr">
                              {l.en}
                            </span>
                          </div>
                          <div className="text-xs text-slate-600">{l.desc}</div>
                        </div>
                        <div className="font-extrabold text-[#0284C7] text-sm">
                          <Pr x={l} />
                        </div>
                      </button>
                    ))}
                    <button className="btn btn-g w-full !py-3" onClick={() => setModal({ t: 'ba', lens: lensObj.id })}>
                      <I n="eye" s={18} /> شاهد الفرق بعينك (Before / After)
                    </button>
                  </div>
                )}

                {step === 2 && (
                  <div>
                    <h3 className="font-extrabold text-[#0F172A] mb-2.5">الخطوة 2: الشركة المصنعة</h3>
                    <div className="grid grid-cols-2 gap-2.5">
                      {!brandV.length && (
                        <div className="col-span-2 glass rounded-2xl p-4 text-sm text-center text-slate-500">
                          غير متاح حالياً — تواصل مع المحل
                        </div>
                      )}
                      {brandV.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => setBr(b.id)}
                          className={
                            'p-3.5 rounded-2xl border text-start transition cursor-pointer ' +
                            (brObj.id === b.id
                              ? 'border-[#0284C7] bg-sky-50 shadow-sm'
                              : 'border-[#E2E8F0] bg-white hover:border-slate-300')
                          }
                        >
                          <div className="font-bold text-[#0F172A]">{b.name}</div>
                          <div className="text-xs text-slate-500 mb-2" dir="ltr" style={{ textAlign: 'start' }}>
                            {b.en}
                          </div>
                          <div className="text-xs text-[#0284C7] font-bold">
                            {b.price ? (
                              <span>
                                +<Pr x={b} />
                              </span>
                            ) : (
                              'السعر الأساسي'
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 text-sm p-3 rounded-xl bg-white border border-[#E2E8F0] flex justify-between">
                      <span className="text-slate-600">السعر الحالي بعد الاختيار</span>
                      <b className="text-[#D97706]">
                        <Egp v={total} />
                      </b>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-2.5">
                    <h3 className="font-extrabold text-[#0F172A]">الخطوة 3: إضافات الحماية</h3>
                    {!extrasV.length && (
                      <div className="glass rounded-2xl p-4 text-sm text-center text-slate-500">غير متاح حالياً — تواصل مع المحل</div>
                    )}
                    {extrasV.map((e) => {
                      const on = exV.includes(e.id);
                      return (
                        <button
                          key={e.id}
                          onClick={() => setEx((x) => (on ? x.filter((i) => i !== e.id) : [...x, e.id]))}
                          className={
                            'w-full flex items-center gap-3 p-3.5 rounded-2xl border text-start transition cursor-pointer ' +
                            (on ? 'border-[#0284C7] bg-sky-50 shadow-sm' : 'border-[#E2E8F0] bg-white')
                          }
                        >
                          <span
                            className={
                              'w-6 h-6 rounded-md flex items-center justify-center ' +
                              (on ? 'bg-[#0284C7] text-white' : 'bg-slate-200 text-transparent')
                            }
                          >
                            {on && <I n="check" s={15} />}
                          </span>
                          <span className="flex-1 font-bold text-sm text-[#0F172A]">{e.name}</span>
                          <b className="text-[#0284C7] text-sm">
                            +<Pr x={e} />
                          </b>
                        </button>
                      );
                    })}
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-3">
                    <h3 className="font-extrabold text-[#0F172A]">الخطوة 4: أرفق الكشف الطبي</h3>
                    {!img ? (
                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="rounded-2xl border-2 border-dashed border-slate-300 bg-white hover:border-[#0284C7] p-5 text-center cursor-pointer block transition">
                          <span className="text-[#0284C7] inline-block">
                            <I n="upload" s={28} />
                          </span>
                          <div className="text-sm font-bold text-[#0F172A] mt-1">ارفع صورة الكشف</div>
                          <div className="text-xs text-slate-500">من المعرض أو الكاميرا</div>
                          <input type="file" accept="image/*" className="hidden" onChange={onFile} />
                        </label>
                        <button
                          className="rounded-2xl border border-[#E2E8F0] bg-white hover:bg-slate-50 p-5 text-center cursor-pointer transition"
                          onClick={() => setImg('demo')}
                        >
                          <span className="text-[#0284C7] inline-block">
                            <I n="receipt" s={28} />
                          </span>
                          <div className="text-sm font-bold text-[#0F172A] mt-1">استخدم كشف تجريبي</div>
                          <div className="text-xs text-slate-500">لتجربة الشاشة فقط</div>
                        </button>
                      </div>
                    ) : (
                      <div className="glass rounded-2xl p-3 flex items-center gap-3">
                        <div className="w-24 shrink-0 rounded-lg overflow-hidden border border-slate-200">
                          {img === 'demo' ? (
                            <div className="text-xs p-3 bg-[#F8F9FA] text-[#0F172A] font-bold text-center">كشف تجريبي</div>
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
                          <div className="text-xs text-slate-500">سيراجعه صاحب المحل</div>
                        </div>
                        <button className="btn btn-d btn-sm" onClick={() => setImg(null)}>
                          <I n="trash" s={14} />
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2.5">
                      <input className="inp" placeholder="اسمك" value={cname} onChange={(e) => setCname(e.target.value)} />
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
                      rows={3}
                      placeholder="ملاحظات أو استفسار للمحل..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                    <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 text-xs leading-6 text-amber-900">
                      صاحب المحل هيراجع الكشف ويأكد لك الملاءمة والسعر النهائي قبل أي دفع — السعر الظاهر دلوقتي مبدئي.
                    </div>
                    <button
                      className="btn bg-[#D97706] hover:bg-[#B45309] text-white w-full !py-3.5 !text-base shadow-sm"
                      onClick={submitRx}
                    >
                      <I n="msg" s={19} /> إرسال الكشف والاستفسار عبر واتساب (قبل التأكيد)
                    </button>
                    <button
                      className="btn btn-g w-full"
                      onClick={() =>
                        addCart({
                          productId: cur.id,
                          name: cur.name,
                          desc: `${lensObj.name} · ${brObj.name} · مقاس ${selectedSize}`,
                          price: total,
                          type: cur.type,
                          frame: fc,
                          lens: lc,
                          size: selectedSize,
                        })
                      }
                    >
                      <I n="bag" s={16} /> أو أضف للسلة بدون كشف
                    </button>
                  </div>
                )}
              </div>

              <div className="flex justify-between mt-4">
                <button
                  className="btn btn-g"
                  disabled={step === 1}
                  style={{ opacity: step === 1 ? 0.35 : 1 }}
                  onClick={() => setStep((s) => Math.max(1, s - 1))}
                >
                  السابق
                </button>
                {step < 4 && (
                  <button className="btn btn-p" onClick={() => setStep((s) => s + 1)}>
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
                          imageUrl={p.processedImage || p.images?.[0]?.imageUrl}
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
                          setTab('shop');
                          toast('جرّبتها على وجهك ✓');
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
                s="اختار عدسة وابعت كشفك للمحل"
                b="اختيار العدسات"
                on={() => setTab('lens')}
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
                      {q.status === 'new'
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
                <div className="glass rounded-2xl p-4">
                  <div className="flex justify-between font-extrabold text-xl mb-3 text-[#0F172A]">
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

      <nav className="fixed bottom-0 inset-x-0 z-40 glass-s border-x-0 border-b-0">
        <div className="max-w-xl mx-auto grid grid-cols-5 px-2 py-1.5">
          {nav.map((n) => (
            <button
              key={n[0]}
              onClick={() => {
                setTab(n[0]);
                if (n[0] === 'shop') setDetailId(null);
              }}
              className={
                'relative flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[.68rem] font-bold transition cursor-pointer ' +
                (tab === n[0] ? 'text-[#0284C7]' : 'text-slate-500 hover:text-[#0F172A]')
              }
            >
              <span className="relative">
                <I n={n[2]} s={22} />
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
              {n[1]}
              {tab === n[0] && <span className="absolute -bottom-0.5 w-6 h-0.5 rounded-full bg-[#0284C7]" />}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
