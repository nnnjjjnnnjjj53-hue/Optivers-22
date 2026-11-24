import React, { useEffect, useRef, useState } from 'react';
import { CATS, DEFAULT_SHOP_ID, SALES0, SHAPES, TYPES } from '../data/seed';
import { isSupabaseConfigured } from '../lib/supabase';
import { getShopDaysLeft, isShopExpiredOrPaused, useOptiVerse } from '../services/optiverseStore';
import { FaceShape, OrderStage } from '../types';
import { BulkFrameUploader } from '../components/BulkFrameUploader';
import { ExamThumb, MiniGlasses, Spin } from '../components/GlassesGraphics';
import { I } from '../components/Icons';
import {
  Bars,
  D,
  Egp,
  Head,
  LineChart,
  Pr,
  QR,
  STAGES,
  Shell,
  ShellNavItem,
  Stat,
  Switch,
  dlCsv,
  fmt,
  qBadge,
  waNum,
} from '../components/UiShared';
import { formatOpticalDimensions, resolveProductOpticalDimensions } from '../utils/opticalDimensions';

const MERCHANT_PAGE_SIZE = 24;

const CAT_META = {
  lens: { empty: 'لا توجد أنواع عدسات بعد' },
  brand: { empty: 'لا توجد شركات بعد' },
  extra: { empty: 'لا توجد إضافات بعد' },
};

function Reports() {
  const { inq, activeShop, toast } = useOptiVerse();
  const shopInq = inq.filter((q) => q.shopId === activeShop.id);
  const conf = shopInq.filter((q) => q.status === 'confirmed');
  const demoRows = activeShop.id === DEFAULT_SHOP_ID ? SALES0 : [];
  const rows = [
    ...demoRows,
    ...conf.map((q) => ({ lens: q.lensName, brand: q.brandName, price: q.final || q.price })),
  ];
  const tally = (k: 'lens' | 'brand') =>
    Object.entries(
      rows.reduce((a: Record<string, number>, r) => {
        a[r[k]] = (a[r[k]] || 0) + 1;
        return a;
      }, {})
    ).sort((a, b) => b[1] - a[1]);
  const lensR = tally('lens');
  const brandR = tally('brand');
  const rev = rows.reduce((s, r) => s + r.price, 0);
  const stTxt = { new: 'جديد', confirmed: 'تم التأكيد', alt: 'عدسة بديلة' };

  const expInq = () => {
    dlCsv('الكشوفات.csv', [
      ['الرقم', 'العميل', 'الموبايل', 'النظارة', 'العدسة', 'الشركة', 'الإضافات', 'السعر', 'الحالة', 'الوقت'],
      ...shopInq.map((q) => [
        q.id,
        q.cust,
        q.phone,
        q.frameName,
        q.lensName,
        q.brandName,
        q.extrasTxt,
        q.final || q.price,
        stTxt[q.status] || q.status,
        q.time,
      ]),
    ]);
    toast('تم تصدير الكشوفات ✓');
  };

  const expSales = () => {
    dlCsv('المبيعات.csv', [['العدسة', 'الشركة', 'السعر'], ...rows.map((r) => [r.lens, r.brand, r.price])]);
    toast('تم تصدير المبيعات ✓');
  };

  return (
    <>
      <Head t="التقارير والمبيعات" sub={`أداء ${activeShop.name} — آخر 30 يوم`}>
        <button className="btn btn-g" onClick={expInq}>
          <I n="dl" s={16} /> تصدير الكشوفات
        </button>
        <button className="btn btn-p" onClick={expSales}>
          <I n="dl" s={16} /> تصدير المبيعات
        </button>
      </Head>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="dollar" label="إيراد الشهر" value={fmt(rev) + ' ج.م'} />
        <Stat icon="check" label="طلبات مؤكدة" value={rows.length} />
        <Stat icon="trend" label="متوسط قيمة الطلب" value={fmt(Math.round(rev / Math.max(1, rows.length))) + ' ج.م'} />
        <Stat icon="receipt" label="كشوفات جديدة" value={shopInq.filter((q) => q.status === 'new').length} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="glass rounded-2xl p-5">
          <h3 className="font-bold mb-1">أكثر العدسات مبيعاً</h3>
          <p className="text-xs opacity-60 mb-3">
            الأول: <b className="tx-acc">{lensR[0]?.[0] || 'لا توجد بيانات بعد'}</b>
          </p>
          {lensR.length ? <Bars rows={lensR} /> : <div className="text-xs opacity-60 py-6 text-center">ستظهر البيانات بعد أول طلب مؤكد</div>}
        </div>
        <div className="glass rounded-2xl p-5">
          <h3 className="font-bold mb-1">أكثر الشركات مبيعاً</h3>
          <p className="text-xs opacity-60 mb-3">
            الأولى: <b className="tx-acc">{brandR[0]?.[0] || 'لا توجد بيانات بعد'}</b>
          </p>
          {brandR.length ? <Bars rows={brandR} /> : <div className="text-xs opacity-60 py-6 text-center">ستظهر البيانات بعد أول طلب مؤكد</div>}
        </div>
      </div>
    </>
  );
}

function CatCard({
  kind,
  title,
  sub,
  addLabel,
  list,
}: {
  kind: 'lens' | 'brand' | 'extra';
  title: string;
  sub: string;
  addLabel: string;
  list: any[];
}) {
  const { setModal, toast, setLensTypes, setBrands, setExtras, syncCatalogItem, activeShop } = useOptiVerse();
  const setter = kind === 'lens' ? setLensTypes : kind === 'brand' ? setBrands : setExtras;

  const toggle = async (x: any) => {
    const on = x.on !== false;
    const updated = { ...x, shopId: activeShop.id, on: !on };
    setter((a: any[]) =>
      a.map((y) => (y.id === x.id && (y.shopId || DEFAULT_SHOP_ID) === activeShop.id ? updated : y))
    );
    await syncCatalogItem(kind, activeShop.id, 'upsert', updated);
    toast(on ? `تم إخفاء "${x.name}" من واجهة العميل ✓` : `تم إظهار "${x.name}" في متجر العميل ✓`);
  };

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="font-bold">{title}</h3>
          <p className="text-xs opacity-60">{sub}</p>
        </div>
        <button className="btn btn-p btn-sm shrink-0" onClick={() => setModal({ t: 'catitem', kind })}>
          <I n="plus" s={14} /> {addLabel.replace('+ ', '')}
        </button>
      </div>
      {!list.length && <div className="text-center text-sm opacity-60 py-6">{CAT_META[kind].empty}</div>}
      {list.map((x) => {
        const on = x.on !== false;
        return (
          <div key={x.id} className="flex items-center gap-2 py-2.5 border-b border-slate-100">
            <div className={'flex-1 min-w-0 ' + (on ? '' : 'opacity-45')}>
              <div className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
                {x.name}
                {!on && <span className="badge b-warn">مخفي</span>}
              </div>
              {x.en && (
                <div className="text-xs opacity-50" dir="ltr" style={{ textAlign: 'start' }}>
                  {x.en}
                </div>
              )}
            </div>
            <b className={'tx-acc text-sm whitespace-nowrap ' + (on ? '' : 'opacity-45')}>
              {kind === 'brand' && x.price > 0 ? '+' : ''}
              <Pr x={D(x)} />
            </b>
            <Switch on={on} onChange={() => toggle(x)} />
            <button
              className="btn btn-g btn-sm !px-2 font-extrabold"
              title="خصم"
              onClick={() => setModal({ t: 'disc', kind, item: x })}
            >
              %
            </button>
            <button
              className="btn btn-g btn-sm !p-2"
              title="تعديل"
              onClick={() => setModal({ t: 'catitem', kind, item: x })}
            >
              <I n="edit" s={14} />
            </button>
            <button
              className="btn btn-d btn-sm !p-2"
              title="حذف"
              onClick={() => setModal({ t: 'catdel', kind, item: x })}
            >
              <I n="trash" s={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function MerchantPage() {
  const {
    route,
    session,
    authLoading,
    signInUnified,
    signInWithGoogle,
    signInWithApple,
    registerMerchant,
    signOut,
    activeShop,
    updateShop,
    products,
    toggleProductPublished,
    softDeleteProductByCode,
    inq,
    updateInquiry,
    toast,
    setModal,
    navigate,
    lensTypes,
    brands,
    extras,
  } = useOptiVerse();

  const [authMode, setAuthMode] = useState<'login' | 'signup'>(() =>
    route.includes('signup') ? 'signup' : 'login'
  );
  useEffect(() => {
    if (route.includes('signup')) setAuthMode('signup');
    else if (route.includes('login')) setAuthMode('login');
  }, [route]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [shopName, setShopName] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [city, setCity] = useState('القاهرة');
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [sec, setSec] = useState('home');
  const [code, setCode] = useState('');
  const [ai, setAi] = useState(true);
  const [fs, setFs] = useState<FaceShape>('oval');
  const [sent, setSent] = useState<Record<string, number>>({});
  const [visibleProdsCount, setVisibleProdsCount] = useState(MERCHANT_PAGE_SIZE);
  const qrWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleProdsCount(MERCHANT_PAGE_SIZE);
  }, [activeShop?.id]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-sm opacity-75">
        جاري تحميل الحساب...
      </div>
    );
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr(null);

    if (authMode === 'signup') {
      if (!shopName.trim()) {
        setAuthErr('اكتب اسم المحل');
        return;
      }
      setSubmitting(true);
      const res = await registerMerchant({
        email: email.trim() || `merchant-${Date.now()}@optiverse.app`,
        password: password || 'Merchant123!',
        ownerName: ownerName.trim() || undefined,
        shopName: shopName.trim(),
        wa: waPhone.trim() || '01001234567',
        city: city.trim() || 'القاهرة',
      });
      setSubmitting(false);
      if (!res.ok) {
        setAuthErr(res.error || 'تعذر إنشاء المتجر');
        return;
      }
      toast('تم إنشاء متجرك وتفعيل 14 يوماً تجربة مجانية 🎉');
      return;
    }

    setSubmitting(true);
    const res = await signInUnified(email.trim(), password);
    setSubmitting(false);
    if (!res.ok) {
      setAuthErr(res.error || 'بيانات الدخول غير صحيحة');
      return;
    }
    if (res.role === 'admin') {
      toast('مرحباً بمالك المنصة — تم توجيهك للوحة الإدارة العليا');
    } else {
      toast('أهلاً بعودتك إلى لوحة متجرك 👋');
    }
  };

  const handleGoogle = async () => {
    setAuthErr(null);
    setSubmitting(true);
    const res = await signInWithGoogle();
    setSubmitting(false);
    if (!res.ok) {
      setAuthErr(res.error || 'تعذر تسجيل الدخول عبر Google');
    }
  };

  const handleApple = async () => {
    setAuthErr(null);
    setSubmitting(true);
    const res = await signInWithApple();
    setSubmitting(false);
    if (!res.ok) {
      setAuthErr(res.error || 'تعذر تسجيل الدخول عبر Apple');
    }
  };

  if (!session || session.role !== 'merchant') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass rounded-3xl p-6 sm:p-8 w-full max-w-md space-y-5 fade">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-extrabold text-xl text-[#0F172A]">
              <span className="w-9 h-9 rounded-xl bg-[#0F172A] text-white flex items-center justify-center">
                <I n="store" s={20} />
              </span>
              {authMode === 'signup' ? 'تجربة مجانية 14 يوماً' : 'تسجيل دخول التاجر'}
            </div>
            <button className="btn btn-g btn-sm" onClick={() => navigate('/')}>
              الرئيسية
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className={'py-2 rounded-lg text-sm font-bold cursor-pointer transition ' + (authMode === 'login' ? 'bg-[#0F172A] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]')}
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('signup')}
              className={'py-2 rounded-lg text-sm font-bold cursor-pointer transition ' + (authMode === 'signup' ? 'bg-[#D97706] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]')}
            >
              تجربة 14 يوماً مجاناً
            </button>
          </div>

          {!isSupabaseConfigured && (
            <div className="rounded-xl p-3 bg-sky-50 border border-sky-200 text-xs leading-6 text-[#0284C7]">
              وضع المعاينة التفاعلية نشط. عند ربط <code className="font-mono font-bold">VITE_SUPABASE_URL</code> و{' '}
              <code className="font-mono font-bold">VITE_SUPABASE_ANON_KEY</code> يتم التفعيل الكامل مع Supabase Auth وتسجيل الدخول عبر Google و Apple.
            </div>
          )}

          <div className="space-y-2.5">
            <button
              type="button"
              disabled={submitting}
              onClick={handleGoogle}
              className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-white border border-[#E2E8F0] text-[#0F172A] font-bold text-sm hover:bg-slate-50 transition cursor-pointer shadow-xs"
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              المتابعة عبر حساب Google
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={handleApple}
              className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-[#0F172A] text-white font-bold text-sm hover:bg-slate-800 transition cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43Zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45Z" />
              </svg>
              المتابعة عبر حساب Apple
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex-1 h-px bg-slate-200" />
            أو بالبريد الإلكتروني
            <span className="flex-1 h-px bg-slate-200" />
          </div>

          <form onSubmit={handleAuth} className="space-y-3">
            {authMode === 'signup' && (
              <>
                <input
                  className="inp"
                  placeholder="اسم صاحب المحل"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
                <input
                  className="inp"
                  placeholder="اسم محل البصريات"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  required
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="inp"
                    dir="ltr"
                    placeholder="رقم واتساب"
                    value={waPhone}
                    onChange={(e) => setWaPhone(e.target.value)}
                  />
                  <input
                    className="inp"
                    placeholder="المدينة"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
              </>
            )}
            <input
              className="inp"
              type="email"
              dir="ltr"
              placeholder="البريد الإلكتروني"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required={isSupabaseConfigured || authMode === 'signup'}
            />
            <input
              className="inp"
              type="password"
              dir="ltr"
              placeholder="كلمة المرور"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={isSupabaseConfigured}
            />
            {authErr && <div className="text-xs text-rose-600 font-bold">{authErr}</div>}
            <button className="btn btn-p w-full !py-3" disabled={submitting} type="submit">
              {submitting
                ? 'جاري التحميل...'
                : authMode === 'login'
                ? 'تسجيل الدخول'
                : 'ابدأ تجربتك المجانية لمدة 14 يوماً'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Strictly scoped to activeShop.id!
  const shopProducts = products.filter((p) => p.shopId === activeShop.id && !p.isDeleted);
  const shopInq = inq.filter((q) => q.shopId === activeShop.id);
  const shopLenses = lensTypes.filter((l) => (l.shopId || DEFAULT_SHOP_ID) === activeShop.id);
  const shopBrands = brands.filter((b) => (b.shopId || DEFAULT_SHOP_ID) === activeShop.id);
  const shopExtras = extras.filter((e) => (e.shopId || DEFAULT_SHOP_ID) === activeShop.id);
  const newCount = shopInq.filter((q) => q.status === 'new').length;
  const trialDaysLeft = getShopDaysLeft(activeShop);
  const expiredOrPaused = isShopExpiredOrPaused(activeShop);
  const isDefaultDemoShop = activeShop.id === DEFAULT_SHOP_ID;
  const confirmedShopSales = shopInq
    .filter((q) => q.status === 'confirmed')
    .reduce((sum, q) => sum + (q.final || q.price), 0);
  const monthlyShopRevenue = isDefaultDemoShop ? 38400 + confirmedShopSales : confirmedShopSales;
  const todayTrials = isDefaultDemoShop ? 86 : shopProducts.length * 4 + shopInq.length * 3;

  const delByCode = async () => {
    const res = await softDeleteProductByCode(activeShop.id, code);
    if (!res.ok) {
      toast(res.error || 'تعذر الحذف');
      return;
    }
    setCode('');
    toast(`تم حذف "${res.product?.name}" (${res.product?.code}) من الموقع فوراً ✓`);
  };

  const items: ShellNavItem[] = [
    ['home', 'الرئيسية', 'home'],
    ['prods', 'منتجاتي', 'box'],
    ['inq', 'الكشوفات الطبية والاستفسارات', 'receipt', newCount],
    ['lens', 'إدارة أسعار العدسات والشركات', 'dollar'],
    ['stats', 'الإحصائيات', 'chart'],
    ['rep', 'التقارير والمبيعات', 'trend'],
    ['about', 'حول OptiVerse', 'info'],
    ['store', 'إعداد متجر العملاء', 'store'],
  ];

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://optiverse.app';
  const link = `${origin}/s/${activeShop.slug}`;
  const copy = () => {
    navigator.clipboard
      ?.writeText(link)
      .then(() => toast('تم نسخ رابط متجر العملاء ✓'))
      .catch(() => toast('الرابط: ' + link));
  };

  const downloadQrPng = async () => {
    const svgEl = qrWrapRef.current?.querySelector('svg');
    if (!svgEl) {
      toast('تعذر إنشاء صورة QR');
      return;
    }
    try {
      const xml = new XMLSerializer().serializeToString(svgEl);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('QR load failed'));
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = 420;
      canvas.height = 500;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 22px Cairo, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(activeShop.name, 210, 44);

      ctx.drawImage(img, 50, 68, 320, 320);

      ctx.fillStyle = '#0f766e';
      ctx.font = 'bold 14px Cairo, system-ui, sans-serif';
      ctx.fillText('امسح الكود وجرّب النظارات بالكاميرا', 210, 424);

      ctx.fillStyle = '#475569';
      ctx.font = '12px monospace';
      ctx.fillText(link, 210, 456);

      URL.revokeObjectURL(url);

      const pngBlob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), 'image/png', 1));
      if (!pngBlob) return;
      const pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `qr-${activeShop.slug}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
      toast('تم تحميل كود QR جاهز للطباعة (PNG) ✓');
    } catch {
      toast('تعذر تصدير صورة QR');
    }
  };

  const radar: [string, number, number][] = isDefaultDemoShop
    ? [
        ['أفياتور كلاسيك', 340, 4],
        ['وايفيرر بلاك', 298, 41],
        ['ريملس لايت', 210, 38],
        ['كات آي أنيقة', 187, 5],
        ['سيف بلو', 120, 29],
      ]
    : shopProducts.slice(0, 5).map((p, idx) => {
        const bought = shopInq.filter((q) => q.frameName === p.name && q.status === 'confirmed').length;
        return [p.name, Math.max(1, bought * 12 + (5 - idx) * 3), bought];
      });
  const rem: [string, string, string, string][] = [
    ['أحمد فتحي', '0100 777 1212', 'صيانة النظارة', 'مرّ 6 شهور على الشراء'],
    ['نادية محمود', '0111 220 3344', 'الكشف السنوي', 'آخر كشف: نوفمبر 2025'],
    ['هاني رضا', '0122 998 7766', 'الكشف السنوي', 'الموعد خلال أسبوع'],
    ['ليلى سامي', '0155 410 6677', 'صيانة النظارة', 'تغيير بدّات الأنف'],
  ];

  const adminRenewMsg = encodeURIComponent(
    `مرحباً إدارة OptiVerse، أرغب في تجديد اشتراك متجر "${activeShop.name}" (${activeShop.slug}) عبر InstaPay / فودافون كاش.`
  );

  return (
    <Shell
      items={items}
      active={sec}
      setActive={setSec}
      title={activeShop.name}
      sub="لوحة تحكم التاجر"
      highlight="store"
      headerAction={
        <button className="btn btn-d btn-sm whitespace-nowrap shrink-0" title="تسجيل الخروج" onClick={signOut}>
          <I n="logout" s={14} /> تسجيل الخروج
        </button>
      }
    >
      {/* 14-Day Free Trial Countdown / Expired Renewal Banner */}
      {expiredOrPaused ? (
        <div className="mb-4 rounded-2xl p-4 bg-rose-50 border border-rose-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-extrabold text-rose-800 text-sm sm:text-base">
              انتهت الفترة التجريبية المجانية أو تم إيقاف الاشتراك — متجر العملاء متوقف مؤقتاً
            </div>
            <div className="text-xs text-rose-700 mt-0.5 leading-6">
              لإعادة تفعيل رابط متجرك فوراً، جدّد الاشتراك مع إدارة المنصة عبر InstaPay أو Vodafone Cash وأرسل إيصال التحويل.
            </div>
          </div>
          <a
            className="btn btn-p btn-sm shrink-0"
            href={`https://wa.me/201000000000?text=${adminRenewMsg}`}
            target="_blank"
            rel="noreferrer"
          >
            <I n="msg" s={14} /> تجديد الاشتراك عبر واتساب الإدارة
          </a>
        </div>
      ) : activeShop.status === 'trial' ? (
        <div className="mb-4 rounded-2xl p-4 bg-sky-50 border border-sky-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[220px]">
            <div className="font-extrabold text-sm sm:text-base text-[#0F172A] flex items-center gap-2 flex-wrap">
              <I n="spark" s={17} c="text-[#0284C7]" />
              <span>متبقي {trialDaysLeft} أيام في فترتك التجريبية المجانية</span>
              <span className="badge b-info">14 يوماً مجاناً</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-sky-200/70 overflow-hidden max-w-md">
              <div
                className="h-full bg-[#0284C7] rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.round((trialDaysLeft / 14) * 100))}%` }}
              />
            </div>
          </div>
          <a
            className="btn bg-[#D97706] hover:bg-[#B45309] text-white btn-sm shrink-0"
            href={`https://wa.me/201000000000?text=${adminRenewMsg}`}
            target="_blank"
            rel="noreferrer"
          >
            <I n="crown" s={14} /> تفعيل الاشتراك الدائم (InstaPay / Vodafone Cash)
          </a>
        </div>
      ) : null}

      {sec === 'home' && (
        <>
          <Head t={`أهلاً بك، ${activeShop.name} 👋`} sub="ملخص نشاط متجرك اليوم" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat icon="eye" label="تجارب اليوم" value={todayTrials} sub={<span className="badge b-ok">+12%</span>} />
            <Stat
              icon="receipt"
              tone="b-info"
              label="استفسارات جديدة"
              value={newCount}
              sub={<span className="text-slate-500">بانتظار مراجعتك</span>}
              onClick={() => setSec('inq')}
            />
            <Stat icon="box" label="النظارات المضافة" value={shopProducts.length} />
            <Stat icon="dollar" label="مبيعات الشهر" value={<Egp v={monthlyShopRevenue} />} />
          </div>

          <div className="glass rounded-2xl p-5 mb-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-9 h-9 rounded-xl b-acc flex items-center justify-center">
                <I n="spark" s={18} />
              </span>
              <h3 className="font-bold text-[#0F172A]">رادار التحليلات الذكية</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">أين يتجرّب الناس كثيراً ولا يشترون؟</p>
            <div className="grid md:grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl p-3.5 bg-rose-50 border border-rose-200 text-sm leading-7 text-rose-900">
                <b className="text-rose-700">⚠ الأقل شراءً:</b> «أفياتور كلاسيك» اتجرّبت 340 مرة واتباعت 4 مرات فقط
                (1.2%). جرّب تعدّل السعر أو تضيف خصم على الإطار.
              </div>
              <div className="rounded-xl p-3.5 bg-sky-50 border border-sky-200 text-sm leading-7 text-sky-950">
                <b className="text-[#0284C7]">🔥 الأكثر تجربة:</b> «أفياتور كلاسيك» الأول هذا الأسبوع. و«كات آي أنيقة» (187
                تجربة) مبيعاتها ضعيفة — راجع صورها ومقاسها.
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[460px]">
                <thead className="text-xs text-slate-500">
                  <tr className="border-b border-[#E2E8F0]">
                    <th className="p-2 text-start">الإطار</th>
                    <th className="p-2">تجارب</th>
                    <th className="p-2">مشتريات</th>
                    <th className="p-2 text-start">التحويل</th>
                  </tr>
                </thead>
                <tbody>
                  {radar.map((r) => {
                    const c = (r[2] / r[1]) * 100;
                    return (
                      <tr key={r[0]} className="border-b border-slate-100 tabular-nums">
                        <td className="p-2 font-bold text-[#0F172A]">{r[0]}</td>
                        <td className="p-2 text-center">{r[1]}</td>
                        <td className="p-2 text-center">{r[2]}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: Math.min(c * 3, 100) + '%',
                                  background: c < 5 ? '#e11d48' : '#059669',
                                }}
                              />
                            </div>
                            <span className={'text-xs font-bold ' + (c < 5 ? 'text-rose-600' : 'text-[#059669]')}>
                              {c.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-[#0F172A]">تذكير الصيانة والكشف السنوي للعملاء</h3>
              <span className="badge b-warn">{rem.length} عملاء</span>
            </div>
            <div className="space-y-2.5">
              {rem.map((r) => {
                const m = encodeURIComponent(
                  `أهلاً ${r[0]} 👋 ${activeShop.name} بيفكّرك بموعد ${r[2]} (${r[3]}). تحب نحجزلك ميعاد؟`
                );
                return (
                  <div key={r[1]} className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0]">
                    <span className="w-10 h-10 rounded-full bg-[#0F172A] text-white font-extrabold flex items-center justify-center">
                      {r[0][0]}
                    </span>
                    <div className="flex-1 min-w-[150px]">
                      <div className="font-bold text-sm text-[#0F172A]">{r[0]}</div>
                      <div className="text-xs text-slate-500">
                        {r[2]} · {r[3]}
                      </div>
                    </div>
                    {sent[r[1]] ? (
                      <span className="badge b-ok">
                        <I n="check" s={12} /> تم الإرسال
                      </span>
                    ) : (
                      <a
                        className="btn btn-p btn-sm"
                        href={`https://wa.me/${waNum(r[1])}?text=${m}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => {
                          setSent((s) => ({ ...s, [r[1]]: 1 }));
                          toast('تم فتح واتساب بالتذكير ✓');
                        }}
                      >
                        <I n="msg" s={14} /> إرسال تذكير واتساب
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {sec === 'prods' && (
        <>
          <Head t="منتجاتي" sub={`${shopProducts.length} نظارة في الكتالوج`}>
            <button className="btn btn-p" onClick={() => setModal('addprod')}>
              <I n="plus" s={16} /> إضافة نظارة جديدة
            </button>
          </Head>
          <BulkFrameUploader />
          <div className="glass rounded-2xl p-4 mb-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="font-bold text-sm">حذف نظارة بالكود (بعد البيع)</div>
              <div className="text-xs opacity-60">اكتب كود النظارة اللي خرجت من المحل وهتتمسح من المتجر فوراً</div>
            </div>
            <input
              className="inp !w-40 font-mono"
              dir="ltr"
              placeholder="FR-1001"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') delByCode();
              }}
            />
            <button className="btn btn-d" onClick={delByCode}>
              <I n="trash" s={15} /> حذف بالكود
            </button>
          </div>

          <div className="glass rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-3">
            <span className="w-9 h-9 rounded-xl b-acc flex items-center justify-center">
              <I n="spark" s={18} />
            </span>
            <div className="flex-1 min-w-[180px]">
              <div className="font-bold text-sm">أشكال الوجه المناسبة (ذكاء اصطناعي)</div>
              <div className="text-xs opacity-60">أظهر النظارات الأنسب لكل شكل وجه</div>
            </div>
            {ai && (
              <div className="flex gap-1.5 flex-wrap">
                {(Object.entries(SHAPES) as [FaceShape, string][]).map((s) => (
                  <button key={s[0]} className={'chip ' + (fs === s[0] ? 'on' : '')} onClick={() => setFs(s[0])}>
                    {s[1]} ({s[0] === 'oval' ? 'Oval' : s[0] === 'round' ? 'Round' : 'Square'})
                  </button>
                ))}
              </div>
            )}
            <Switch on={ai} onChange={setAi} />
          </div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {shopProducts.slice(0, visibleProdsCount).map((p) => {
              const fit = p.shapes.includes(fs);
              const published = p.isPublished !== false;
              const hasTwoAngles =
                (p.images?.filter((im) => im.kind !== 'gallery' || Math.abs(im.angleYaw) > 15).length || 0) >= 2;
              const hasUploadedFront = Boolean(p.processedImage || p.images?.some((im) => im.imageUrl));
              return (
                <div
                  key={p.id}
                  className={
                    'glass rounded-2xl p-4 transition flex flex-col ' +
                    (!published ? 'opacity-65 ' : '') +
                    (ai && !fit ? 'opacity-45 ' : '')
                  }
                >
                  <div
                    className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] cursor-pointer relative overflow-hidden"
                    onClick={() => setModal({ t: 'editprod', p })}
                  >
                    <Spin p={p} />
                    <span className="absolute top-2 start-2 badge bg-[#0F172A] text-white">
                      {p.tryonMode === '3d' || p.modelCalibration?.frameWidthMm
                        ? `3D · ${resolveProductOpticalDimensions(p).totalFrameWidthMm}mm`
                        : hasTwoAngles
                        ? 'زاويتان · AI'
                        : hasUploadedFront
                        ? 'معزولة · AI'
                        : 'إطار قياسي'}
                    </span>
                    {!published ? (
                      <span className="absolute top-2 end-2 badge b-warn">مخفية</span>
                    ) : ai && fit ? (
                      <span className="absolute top-2 end-2 badge b-ok">مناسبة لوجه {SHAPES[fs]}</span>
                    ) : null}
                  </div>

                  <div className="flex justify-between items-start mt-3 gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-[#0F172A] truncate">{p.name}</div>
                      <div className="text-xs text-slate-600">
                        {TYPES[p.type]} · {CATS[p.cat]} ·{' '}
                        <span className="font-mono text-[#0284C7] font-bold" dir="ltr">
                          {formatOpticalDimensions(resolveProductOpticalDimensions(p))} mm
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="badge b-acc font-mono" dir="ltr">
                          {p.code}
                        </span>
                        {p.modelCalibration?.material && (
                          <span className="text-[0.68rem] text-slate-500">
                            {p.modelCalibration.material === 'metal' ? 'معدن 1.8mm' : 'TR 3.5mm'}
                          </span>
                        )}
                        {p.availableSizes && (
                          <span className="text-[0.68rem] text-slate-500">{p.availableSizes.join(' · ')}</span>
                        )}
                      </div>
                    </div>
                    <div className="font-extrabold text-[#D97706] shrink-0">
                      <Pr x={D(p)} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-[#E2E8F0]">
                    <span className="text-xs font-semibold text-slate-600">
                      {published ? 'منشورة في المتجر' : 'مسودة مخفية'}
                    </span>
                    <Switch
                      on={published}
                      onChange={async () => {
                        await toggleProductPublished(p.id);
                        toast(published ? `تم إخفاء "${p.name}" من متجر العملاء` : `تم نشر "${p.name}" للعملاء ✓`);
                      }}
                    />
                  </div>

                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    <button
                      type="button"
                      className="btn btn-g btn-sm flex-1"
                      onClick={() => setModal({ t: 'editprod', p })}
                    >
                      <I n="edit" s={13} /> تعديل
                    </button>
                    <button
                      type="button"
                      className="btn btn-tryon btn-sm flex-1"
                      onClick={() => navigate(`/s/${activeShop.slug}/f/${p.id}?preview=1`)}
                    >
                      <I n="eye" s={13} /> معاينة كعميل
                    </button>
                    <button
                      type="button"
                      className="btn btn-g btn-sm font-extrabold"
                      title="خصم"
                      onClick={() => setModal({ t: 'disc', kind: 'prod', item: p })}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      className="btn btn-d btn-sm"
                      title="حذف"
                      onClick={() => setModal({ t: 'delprod', p })}
                    >
                      <I n="trash" s={13} />
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              onClick={() => setModal('addprod')}
              className="rounded-2xl border-2 border-dashed border-slate-300 bg-white min-h-[260px] flex flex-col items-center justify-center gap-2 text-slate-600 hover:text-[#0F172A] hover:border-[#0284C7] transition cursor-pointer"
            >
              <I n="upload" s={28} />
              <b>إضافة نظارة جديدة</b>
              <span className="text-xs">صورتان من زاويتين + عزل تلقائي بالذكاء الاصطناعي</span>
            </button>
          </div>
          {shopProducts.length > MERCHANT_PAGE_SIZE && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white border border-[#E2E8F0] px-4 py-3 text-xs">
              <span className="opacity-75">
                عرض <b>{Math.min(visibleProdsCount, shopProducts.length)}</b> من <b>{shopProducts.length}</b> نظارة
              </span>
              <div className="flex items-center gap-2">
                {visibleProdsCount > MERCHANT_PAGE_SIZE && (
                  <button
                    type="button"
                    className="btn btn-g btn-sm"
                    onClick={() => setVisibleProdsCount(MERCHANT_PAGE_SIZE)}
                  >
                    العودة لأول {MERCHANT_PAGE_SIZE}
                  </button>
                )}
                {shopProducts.length > visibleProdsCount && (
                  <button
                    type="button"
                    className="btn btn-p btn-sm"
                    onClick={() => setVisibleProdsCount((c) => c + MERCHANT_PAGE_SIZE)}
                  >
                    عرض المزيد (+{Math.min(MERCHANT_PAGE_SIZE, shopProducts.length - visibleProdsCount)})
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {sec === 'inq' && (
        <>
          <Head t="الكشوفات الطبية والاستفسارات" sub={`${newCount} طلبات جديدة بانتظار مراجعتك`} />
          <div className="space-y-4">
            {shopInq.map((q) => (
              <div key={q.id} className="glass rounded-2xl p-4">
                <div className="grid sm:grid-cols-[170px_1fr] gap-4">
                  <ExamThumb q={q} onZoom={() => setModal({ t: 'zoom', q })} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div>
                        <div className="font-extrabold">
                          {q.cust} <span className="text-xs font-normal opacity-60 font-mono">{q.id}</span>
                        </div>
                        <div className="text-xs opacity-60" dir="ltr" style={{ textAlign: 'start' }}>
                          {q.phone} · {q.time}
                        </div>
                      </div>
                      {qBadge(q.status)}
                    </div>
                    <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex items-center gap-3 mb-2">
                      <div className="grid-bg rounded-lg p-1.5 border border-[#E2E8F0]">
                        <MiniGlasses type={q.type} frame={q.frame} lens={q.lens} w={78} />
                      </div>
                      <div className="flex-1 text-sm">
                        <div className="font-bold text-[#0F172A]">{q.frameName}</div>
                        <div className="text-xs text-slate-600">
                          العدسة: {q.lensName}
                          {q.brandName !== '—' && ` · ${q.brandName}`}
                        </div>
                        <div className="text-xs text-slate-600">الإضافات: {q.extrasTxt}</div>
                      </div>
                      <div className="text-end">
                        <div className="text-[.7rem] text-slate-500">
                          {q.status === 'confirmed' ? 'السعر النهائي' : 'السعر المبدئي'}
                        </div>
                        <b className="text-[#D97706]">
                          <Egp v={q.final || q.price} />
                        </b>
                      </div>
                    </div>
                    {(q.notes || q.pd) && (
                      <div className="text-xs text-slate-600 mb-2">
                        {q.pd && <span className="badge b-info me-2">PD: {q.pd}</span>}
                        {q.notes}
                      </div>
                    )}
                    {q.alt && (
                      <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
                        تم اقتراح «{q.alt}» بدل «{q.altFrom}» — بانتظار رد العميل
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button className="btn btn-p btn-sm" onClick={() => setModal({ t: 'confirmq', q })}>
                        <I n="check" s={14} /> تأكيد الملاءمة وإرسال السعر النهائي عبر واتساب
                      </button>
                      {q.status === 'confirmed' && (
                        <select
                          className="inp !w-auto !py-1.5 text-xs"
                          value={q.stage || 'review'}
                          onChange={async (e) => {
                            const v = e.target.value as OrderStage;
                            await updateInquiry(q.id, { stage: v });
                            toast('تم تحديث حالة الطلب للعميل ✓');
                          }}
                        >
                          {STAGES.map((x) => (
                            <option key={x[0]} value={x[0]}>
                              {x[1]}
                            </option>
                          ))}
                        </select>
                      )}
                      {q.kind === 'rx' && (
                        <button className="btn btn-g btn-sm" onClick={() => setModal({ t: 'altq', q })}>
                          <I n="refresh" s={14} /> اقتراح عدسة بديلة
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {!shopInq.length && <div className="glass rounded-2xl p-10 text-center opacity-70">لا توجد استفسارات بعد</div>}
          </div>
        </>
      )}

      {sec === 'lens' && (
        <>
          <Head
            t="إدارة أسعار العدسات والشركات"
            sub="أي إضافة أو تعديل أو إخفاء بيظهر لعملائك فوراً في خطوات اختيار العدسات"
          />
          <div className="grid lg:grid-cols-2 gap-4">
            <CatCard
              kind="lens"
              title="أنواع العدسات"
              sub="السعر الأساسي لكل نوع"
              addLabel="+ إضافة نوع عدسة"
              list={shopLenses}
            />
            <div className="space-y-4">
              <CatCard
                kind="brand"
                title="الشركات المصنعة"
                sub="الزيادة على السعر الأساسي"
                addLabel="+ إضافة شركة جديدة"
                list={shopBrands}
              />
              <CatCard
                kind="extra"
                title="إضافات الحماية"
                sub="سعر كل إضافة اختيارية"
                addLabel="+ إضافة ميزة حماية جديدة"
                list={shopExtras}
              />
            </div>
          </div>
        </>
      )}

      {sec === 'rep' && <Reports />}

      {sec === 'stats' && (
        <>
          <Head t="الإحصائيات" sub="أداء متجرك آخر 30 يوم" />
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="glass rounded-2xl p-5">
              <h3 className="font-bold mb-3">التجارب الأسبوعية</h3>
              <LineChart data={[310, 420, 390, 560, 610, 720, 860]} labels={['أسبوع1', '2', '3', '4', '5', '6', '7']} h={200} />
            </div>
            <div className="glass rounded-2xl p-5">
              <h3 className="font-bold mb-4">النظارات الأكثر تجربة</h3>
              <Bars rows={radar.map((r) => [r[0], r[1]])} />
            </div>
          </div>
        </>
      )}

      {sec === 'about' && (
        <>
          <Head t="حول OptiVerse" sub="كل ما تحتاج معرفته عن المنصة" />
          <div className="glass rounded-2xl p-6 mb-5 leading-8 text-sm opacity-90">
            <p className="mb-3">
              OptiVerse منصة SaaS تمنح محلات النظارات متجراً تفاعلياً برابط خاص. ترفع صورتين لنظارتك من زاويتين
              مختلفتين، وتُعزل الخلفية تلقائياً مع الحفاظ التام على شكل النظارة الحقيقي ليجرّبها العميل على وجهه
              بالذكاء الاصطناعي، ثم يرسل كشف نظره ليراجعه المحل ويؤكد الملاءمة والسعر النهائي عبر واتساب.
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mt-4">
              {[
                ['camera', 'تجربة حية', 'تتبّع نقاط الوجه عبر MediaPipe وقياس PD'],
                ['spark', 'ذكاء اصطناعي', 'ترشيح حسب شكل الوجه ورادار تحليلات'],
                ['msg', 'استفسار آمن', 'مراجعة الكشف قبل تأكيد السعر'],
              ].map((x) => (
                <div key={x[0]} className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex gap-3">
                  <span className="text-[#0284C7]">
                    <I n={x[0]} s={22} />
                  </span>
                  <div>
                    <b className="text-[#0F172A]">{x[1]}</b>
                    <div className="text-xs text-slate-600">{x[2]}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <h3 className="font-bold text-[#0F172A] mb-3">جدول مقارنة الباقات</h3>
          <div className="glass rounded-2xl overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-xs text-slate-500">
                  <th className="p-3 text-start">الميزة</th>
                  <th className="p-3">الأساسية</th>
                  <th className="p-3 text-[#D97706]">الاحترافية</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['السعر الشهري', '600 ج.م', '1,200 ج.م'],
                  ['عدد النظارات', '50', 'غير محدود'],
                  ['تجارب AR شهرياً', '2,000', 'غير محدودة'],
                  ['رابط متجر + QR', 1, 1],
                  ['استقبال الكشوفات والاستفسارات', 1, 1],
                  ['ترشيح الذكاء الاصطناعي لشكل الوجه', 0, 1],
                  ['رادار التحليلات الذكية', 0, 1],
                  ['تذكيرات واتساب للعملاء', 0, 1],
                  ['مقارنة Split View', 0, 1],
                  ['الدعم الفني', 'بريد إلكتروني', 'واتساب أولوية'],
                ].map((r) => (
                  <tr key={r[0] as string} className="border-b border-slate-100">
                    <td className="p-3 font-semibold text-[#0F172A]">{r[0]}</td>
                    {[r[1], r[2]].map((v, i) => (
                      <td key={i} className="p-3 text-center">
                        {v === 1 ? (
                          <span className="text-[#059669] inline-block">
                            <I n="check" s={17} />
                          </span>
                        ) : v === 0 ? (
                          <span className="opacity-30">—</span>
                        ) : (
                          v
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {sec === 'store' && (
        <>
          <Head t="إعداد متجر العملاء" sub="إدارة رابط المتجر ورمز QR وتخصيص مظهر المتجر لعملائك">
            <button className="btn btn-tryon" onClick={() => navigate(`/shop/${activeShop.slug}`)}>
              <I n="eye" s={16} /> معاينة كعميل
            </button>
          </Head>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="glass rounded-2xl p-5">
              <h3 className="font-bold text-[#0F172A] mb-3">رابط المتجر</h3>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] mb-3">
                <I n="link" s={18} c="text-[#0284C7]" />
                <span className="font-mono text-sm text-[#0F172A] flex-1 truncate" dir="ltr">
                  {link}
                </span>
              </div>
              <div className="flex gap-2 mb-5">
                <button className="btn btn-g flex-1" onClick={copy}>
                  <I n="copy" s={15} /> نسخ
                </button>
                <button className="btn btn-g flex-1" onClick={() => setModal({ t: 'share', link })}>
                  <I n="share" s={15} /> مشاركة
                </button>
              </div>
              <div className="flex items-center gap-4">
                <div ref={qrWrapRef}>
                  <QR seed={activeShop.slug} />
                </div>
                <div>
                  <div className="font-bold text-[#0F172A] mb-1">كود QR للمتجر</div>
                  <p className="text-xs text-slate-500 mb-3">اطبعه وضعه على واجهة المحل</p>
                  <button className="btn btn-p btn-sm" onClick={downloadQrPng}>
                    <I n="dl" s={14} /> تحميل QR (PNG)
                  </button>
                </div>
              </div>
            </div>

            <div className="glass rounded-2xl p-5 space-y-4">
              <h3 className="font-bold text-[#0F172A]">تخصيص الواجهة</h3>
              <div>
                <label className="text-xs text-slate-600">اسم المحل</label>
                <input
                  className="inp mt-1"
                  value={activeShop.name}
                  onChange={(e) => updateShop(activeShop.id, { name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">اللوجو</label>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {['👓', '🕶️', '✨', '👁️', '🌟'].map((l) => (
                    <button
                      key={l}
                      onClick={() => updateShop(activeShop.id, { logo: l })}
                      className={
                        'w-11 h-11 rounded-xl text-xl border cursor-pointer ' +
                        (activeShop.logo === l ? 'border-[#0284C7] bg-sky-50' : 'border-[#E2E8F0] bg-[#F8F9FA]')
                      }
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-600">لون الواجهة</label>
                <div className="flex gap-2 mt-1">
                  {['#0284C7', '#0F172A', '#D97706', '#059669', '#e11d48'].map((c) => (
                    <button
                      key={c}
                      onClick={() => updateShop(activeShop.id, { color: c })}
                      className="w-9 h-9 rounded-full border-2 cursor-pointer"
                      style={{ background: c, borderColor: activeShop.color === c ? '#0F172A' : 'transparent' }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-600">رقم واتساب الطلبات</label>
                <input
                  className="inp mt-1"
                  dir="ltr"
                  value={activeShop.wa}
                  onChange={(e) => updateShop(activeShop.id, { wa: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-p flex-1" onClick={() => toast('تم حفظ إعدادات المتجر ✓')}>
                  حفظ
                </button>
                <button className="btn btn-tryon flex-1" onClick={() => navigate(`/shop/${activeShop.slug}`)}>
                  <I n="eye" s={15} /> معاينة كعميل
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
