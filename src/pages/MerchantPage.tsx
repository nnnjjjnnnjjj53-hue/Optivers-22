import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_SHOP_ID, EGYPT_GOVERNORATES, SALES0, STORE_THEMES } from '../data/seed';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  getShopDaysLeft,
  getShopMaxProducts,
  getShopPlanCapabilities,
  isAdminRole,
  isShopExpiredOrPaused,
  useOptiVerse,
} from '../services/optiverseStore';
import { OrderStage } from '../types';
import { BulkFrameUploader } from '../components/BulkFrameUploader';
import { ExamThumb, MiniGlasses } from '../components/GlassesGraphics';
import { I } from '../components/Icons';
import { MerchantLensMatrixManager } from '../components/MerchantLensMatrixManager';
import { resolveAngled45Url, resolveStoreFrontUrl } from '../utils/bulkFrameProcessor';
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
    dlCsv('الطلبات.csv', [
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
    toast('تم تصدير الطلبات ✓');
  };

  const expSales = () => {
    dlCsv('المبيعات.csv', [['العدسة', 'الشركة', 'السعر'], ...rows.map((r) => [r.lens, r.brand, r.price])]);
    toast('تم تصدير المبيعات ✓');
  };

  return (
    <>
      <Head t="التقارير والمبيعات" sub={`أداء ${activeShop.name} — آخر 30 يوم`}>
        <button className="btn btn-g" onClick={expInq}>
          <I n="dl" s={16} /> تصدير الطلبات
        </button>
        <button className="btn btn-p" onClick={expSales}>
          <I n="dl" s={16} /> تصدير المبيعات
        </button>
      </Head>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="dollar" label="إيراد الشهر" value={fmt(rev) + ' ج.م'} />
        <Stat icon="check" label="طلبات مؤكدة" value={rows.length} />
        <Stat icon="trend" label="متوسط قيمة الطلب" value={fmt(Math.round(rev / Math.max(1, rows.length))) + ' ج.م'} />
        <Stat icon="receipt" label="طلبات جديدة" value={shopInq.filter((q) => q.status === 'new').length} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="glass rounded-2xl p-5">
          <h3 className="font-bold mb-1">أكثر الفئات مبيعاً</h3>
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
    signInWithPhoneOtp,
    registerMerchant,
    signOut,
    platformSettings,
    activeShop,
    updateShop,
    addTopUpCredits,
    products,
    softDeleteProductByCode,
    inq,
    updateInquiry,
    crmCustomers,
    addCrmCustomer,
    markCrmRecallSent,
    toast,
    setModal,
    navigate,
    lensTypes,
    brands,
    extras,
    getAccessToken,
    uploadAssetToStorage,
  } = useOptiVerse();

  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'phone'>(() =>
    route.includes('signup') ? 'signup' : 'login'
  );
  useEffect(() => {
    if (route.includes('signup')) setAuthMode('signup');
    else if (route.includes('login')) setAuthMode('login');
  }, [route]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneLogin, setPhoneLogin] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [shopName, setShopName] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [city, setCity] = useState('القاهرة');
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Onboarding Profile Gate state
  const [obOwnerName, setObOwnerName] = useState('');
  const [obWa, setObWa] = useState('');
  const [obShopName, setObShopName] = useState('');
  const [obGov, setObGov] = useState('القاهرة');
  const [obAddress, setObAddress] = useState('');
  const [obMapsUrl, setObMapsUrl] = useState('');

  // CRM add customer form state
  const [crmName, setCrmName] = useState('');
  const [crmPhone, setCrmPhone] = useState('');
  const [crmProdName, setCrmProdName] = useState('');
  const [crmPd, setCrmPd] = useState('');
  const [crmNotes, setCrmNotes] = useState('');

  const [sec, setSec] = useState('home');
  const [code, setCode] = useState('');
  const [aiLogoBusy, setAiLogoBusy] = useState(false);
  const [visibleProdsCount, setVisibleProdsCount] = useState(MERCHANT_PAGE_SIZE);
  const qrWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleProdsCount(MERCHANT_PAGE_SIZE);
  }, [activeShop?.id]);

  useEffect(() => {
    if (!activeShop) return;
    setObOwnerName(activeShop.ownerName || '');
    setObWa(activeShop.wa || '');
    setObShopName(activeShop.name || '');
    setObGov(activeShop.governorate || activeShop.city || 'القاهرة');
    setObAddress(activeShop.address || '');
    setObMapsUrl(activeShop.mapsUrl || '');
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

    if (authMode === 'phone') {
      setSubmitting(true);
      const res = await signInWithPhoneOtp(phoneLogin.trim());
      setSubmitting(false);
      if (!res.ok) {
        setAuthErr(res.error || 'تعذر إرسال رمز OTP');
      } else {
        toast('تم إرسال رمز التحقق إلى هاتفك ✓');
      }
      return;
    }

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
    if (isAdminRole(res.role)) {
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

  if (!session || (session.role !== 'merchant' && !isAdminRole(session.role))) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#F8F9FA]">
        <div className="glass rounded-3xl p-6 sm:p-8 w-full max-w-md space-y-5 fade">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-extrabold text-xl text-[#0F172A]">
              <span className="w-9 h-9 rounded-xl bg-[#0F172A] text-white flex items-center justify-center">
                <I n="store" s={20} />
              </span>
              {authMode === 'signup'
                ? 'تجربة مجانية 14 يوماً'
                : authMode === 'phone'
                ? 'الدخول برقم الموبايل'
                : 'تسجيل دخول التاجر'}
            </div>
            <button className="btn btn-g btn-sm" onClick={() => navigate('/')}>
              الرئيسية
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className={
                'py-2 rounded-lg text-xs font-bold cursor-pointer transition ' +
                (authMode === 'login' ? 'bg-[#0F172A] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]')
              }
            >
              دخول
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('signup')}
              className={
                'py-2 rounded-lg text-xs font-bold cursor-pointer transition ' +
                (authMode === 'signup' ? 'bg-[#D97706] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]')
              }
            >
              تجربة 14 يوماً
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('phone')}
              className={
                'py-2 rounded-lg text-xs font-bold cursor-pointer transition ' +
                (authMode === 'phone' ? 'bg-[#0284C7] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]')
              }
            >
              برقم الموبايل
            </button>
          </div>

          {!isSupabaseConfigured && (
            <div className="rounded-xl p-3 bg-sky-50 border border-sky-200 text-xs leading-6 text-[#0284C7]">
              وضع المعاينة التفاعلية نشط. عند ربط <code className="font-mono font-bold">VITE_SUPABASE_URL</code> و{' '}
              <code className="font-mono font-bold">VITE_SUPABASE_ANON_KEY</code> يتم التفعيل الكامل مع Supabase Auth
              (Google · Apple · OTP).
            </div>
          )}

          {authMode !== 'phone' && (
            <>
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
            </>
          )}

          <form onSubmit={handleAuth} className="space-y-3">
            {authMode === 'phone' ? (
              <>
                <input
                  className="inp"
                  type="tel"
                  dir="ltr"
                  placeholder="+20 100 123 4567"
                  value={phoneLogin}
                  onChange={(e) => setPhoneLogin(e.target.value)}
                  required
                />
                <div className="text-xs text-slate-500">
                  سنرسل رمز تحقق SMS (OTP) للدخول الفوري إلى متجرك دون كلمة مرور.
                </div>
              </>
            ) : (
              <>
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
                      <select
                        className="inp"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                      >
                        {EGYPT_GOVERNORATES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
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
              </>
            )}

            {authErr && <div className="text-xs text-rose-600 font-bold">{authErr}</div>}
            <button className="btn btn-p w-full !py-3" disabled={submitting} type="submit">
              {submitting
                ? 'جاري التحميل...'
                : authMode === 'phone'
                ? 'إرسال رمز التحقق (OTP)'
                : authMode === 'login'
                ? 'تسجيل الدخول'
                : 'ابدأ تجربتك المجانية لمدة 14 يوماً'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Mandatory Merchant Onboarding Profile Gate (blocks dashboard until key contact/location fields are completed)
  if (!activeShop.onboardingCompleted && !activeShop.isDemoAdminStore) {
    const handleCompleteOnboarding = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!obOwnerName.trim() || !obWa.trim() || !obShopName.trim() || !obAddress.trim()) {
        toast('يرجى استكمال اسم المالك، رقم الواتساب، اسم المحل، والعنوان');
        return;
      }
      await updateShop(activeShop.id, {
        ownerName: obOwnerName.trim(),
        wa: obWa.trim(),
        name: obShopName.trim(),
        governorate: obGov,
        city: obGov,
        address: obAddress.trim(),
        mapsUrl: obMapsUrl.trim() || undefined,
        onboardingCompleted: true,
      });
      toast('تم تفعيل ملف محلك بنجاح! مرحباً بك في لوحة التحكم 🎉');
    };

    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center p-4 bg-[#F8F9FA]">
        <div className="glass rounded-3xl p-6 sm:p-8 w-full max-w-lg space-y-5 fade">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="badge b-info mb-1">خطوة واحدة لبدء متجرك</span>
              <h1 className="font-extrabold text-xl text-[#0F172A]">استكمال بيانات محل البصريات</h1>
              <p className="text-xs text-slate-600 mt-0.5">
                تظهر هذه البيانات لعملائك في دليل المحلات المعتمدة ورابط الطلبات عبر واتساب
              </p>
            </div>
            <button type="button" className="btn btn-g btn-sm shrink-0" onClick={signOut}>
              خروج
            </button>
          </div>

          <form onSubmit={handleCompleteOnboarding} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700">اسم صاحب المحل *</label>
                <input
                  className="inp mt-1"
                  placeholder="مثال: أحمد محمد"
                  value={obOwnerName}
                  onChange={(e) => setObOwnerName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">رقم واتساب الطلبات *</label>
                <input
                  className="inp mt-1"
                  dir="ltr"
                  placeholder="01001234567"
                  value={obWa}
                  onChange={(e) => setObWa(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700">اسم المحل التجاري *</label>
                <input
                  className="inp mt-1"
                  placeholder="مثال: بصريات النور"
                  value={obShopName}
                  onChange={(e) => setObShopName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">المحافظة *</label>
                <select
                  className="inp mt-1"
                  value={obGov}
                  onChange={(e) => setObGov(e.target.value)}
                >
                  {EGYPT_GOVERNORATES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">العنوان التفصيلي *</label>
              <input
                className="inp mt-1"
                placeholder="الشارع والمنطقة وأقرب علامة مميزة"
                value={obAddress}
                onChange={(e) => setObAddress(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">رابط الموقع على Google Maps (اختياري)</label>
              <input
                className="inp mt-1"
                dir="ltr"
                placeholder="https://maps.google.com/?q=..."
                value={obMapsUrl}
                onChange={(e) => setObMapsUrl(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white w-full !py-3 font-extrabold"
            >
              حفظ وبدء استخدام لوحة التاجر
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

  const rxEnabled = Boolean(
    platformSettings.enableLensesSystem ?? platformSettings.enablePrescriptionLenses
  );
  const suppliersEnabled = Boolean(platformSettings.enableSponsoredSuppliers);
  const deliveryEnabled = Boolean(activeShop.enableDeliveryService);

  const planCaps = getShopPlanCapabilities(activeShop, platformSettings);
  const maxProducts = getShopMaxProducts(activeShop, platformSettings);
  const creditsCap = (activeShop.aiCreditsLimit || planCaps.monthlyAiCredits || 110) + (activeShop.topupCredits || 0);
  const creditsUsed = activeShop.aiCreditsUsed || 0;
  const creditsRemaining = Math.max(0, creditsCap - creditsUsed);

  // CRM Customers & Recalls (6-month & 12-month intervals)
  const shopCrm = crmCustomers.filter((c) => c.shopId === activeShop.id);
  const nowMs = Date.now();
  const dueCrmList = shopCrm
    .map((c) => {
      const daysSince = Math.floor((nowMs - new Date(c.orderDate).getTime()) / 86400000);
      const due12 = (activeShop.recall12mEnabled ?? true) && daysSince >= 360 && !c.recall12mSentAt;
      const due6 = (activeShop.recall6mEnabled ?? true) && daysSince >= 180 && daysSince < 360 && !c.recall6mSentAt;
      return { ...c, daysSince, due6, due12 };
    });
  const dueRecallCount = dueCrmList.filter((c) => c.due6 || c.due12).length;

  const confirmedShopSales = shopInq
    .filter((q) => q.status === 'confirmed')
    .reduce((sum, q) => sum + (q.final || q.price), 0);
  const monthlyShopRevenue = confirmedShopSales;
  const totalTryOns = shopInq.length;

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
    ['crm', 'قاعدة العملاء', 'bell', dueRecallCount],
    ...(rxEnabled
      ? ([
          ['inq', 'الكشوفات الطبية والاستفسارات', 'receipt', newCount],
          ['lens', 'إدارة أسعار العدسات والشركات', 'dollar'],
        ] as ShellNavItem[])
      : ([['lens_teaser', 'العدسات الطبية — قريباً ✨', 'eye']] as ShellNavItem[])),
    ...(deliveryEnabled ? ([['delivery', 'إعدادات التوصيل', 'truck']] as ShellNavItem[]) : []),
    ...(suppliersEnabled ? ([['suppliers', 'الموردون المعتمدون ⭐', 'crown']] as ShellNavItem[]) : []),
    ['stats', 'الإحصائيات', 'chart'],
    ['rep', 'التقارير والمبيعات', 'trend'],
    ['about', 'حول OptiVerse', 'info'],
    ['store', 'بيانات المحل والسمات واللوجو', 'store'],
    ['sub', 'الاشتراك والباقات', 'crown'],
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

  // Strictly real radar metrics computed from actual store inquiries/try-ons & confirmed purchases
  const radar: [string, number, number][] = shopProducts
    .map((p) => {
      const trials = shopInq.filter((q) => q.frameName === p.name).length;
      const bought = shopInq.filter((q) => q.frameName === p.name && q.status === 'confirmed').length;
      return [p.name, trials, bought] as [string, number, number];
    })
    .filter((r) => r[1] > 0 || r[2] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const totalRadarTrials = radar.reduce((sum, r) => sum + r[1], 0);
  const mostTriedFrame = radar[0];
  const lowestConvFrame =
    radar.length > 0
      ? [...radar].sort((a, b) => a[2] / Math.max(1, a[1]) - b[2] / Math.max(1, b[1]))[0]
      : null;

  const adminRenewMsg = encodeURIComponent(
    `مرحباً إدارة OptiVerse، أرغب في تجديد اشتراك متجر "${activeShop.name}" (${activeShop.slug}) عبر InstaPay / فودافون كاش.`
  );

  const handleAddCrm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crmName.trim() || !crmPhone.trim()) {
      toast('اكتب اسم العميل ورقم الموبايل أولاً');
      return;
    }
    await addCrmCustomer({
      shopId: activeShop.id,
      customerName: crmName.trim(),
      phone: crmPhone.trim(),
      productName: crmProdName.trim() || 'إطار نظارة',
      pd: crmPd.trim() || undefined,
      orderDate: new Date().toISOString(),
      notes: crmNotes.trim() || undefined,
    });
    setCrmName('');
    setCrmPhone('');
    setCrmProdName('');
    setCrmPd('');
    setCrmNotes('');
    toast('تم تسجيل العميل في قاعدة البيانات ✓');
  };

  const aiLogoUsed = activeShop.aiLogoGenerations || 0;
  const aiLogoRemaining = Math.max(0, 2 - aiLogoUsed);

  const handleUploadDirectLogo = async (file: File) => {
    try {
      const url = await uploadAssetToStorage(file, `logos/${activeShop.id}`, 'png');
      await updateShop(activeShop.id, { logo: url });
      toast('تم رفع شعار المحل وتطبيقه فوراً ✓');
    } catch {
      toast('تعذر رفع صورة اللوجو');
    }
  };

  const handleGenerateAiLogo = async (file: File) => {
    if (aiLogoUsed >= 2) {
      toast('تم استهلاك الحد الأقصى لتصميم اللوجو بالذكاء الاصطناعي (محاولتان)');
      return;
    }
    setAiLogoBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('تعذر قراءة الصورة'));
        reader.readAsDataURL(file);
      });
      const mimeMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = mimeMatch ? mimeMatch[1] : file.type || 'image/jpeg';
      const imageBase64 = mimeMatch ? mimeMatch[2] : dataUrl;

      const token = await getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-optiverse-demo-shop': activeShop.id,
        'x-optiverse-demo-role': session?.role || 'merchant',
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch('/api/merchant/generate-logo', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          imageBase64,
          mimeType,
          shopId: activeShop.id,
          shopName: activeShop.name,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok || !json?.logoDataUrl) {
        throw new Error(json?.error || 'تعذر تصميم اللوجو بالذكاء الاصطناعي');
      }
      await updateShop(activeShop.id, {
        logo: json.logoDataUrl,
        aiLogoGenerations: Number(json.usedGenerations ?? aiLogoUsed + 1),
      });
      toast('تم تصميم شعار المتجر بالذكاء الاصطناعي وتطبيقه فوراً ✨');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذر تصميم اللوجو');
    } finally {
      setAiLogoBusy(false);
    }
  };

  return (
    <Shell
      items={items}
      active={sec}
      setActive={setSec}
      title={activeShop.name}
      sub="لوحة تحكم التاجر"
      highlight="store"
      mobileMode="dock"
      primaryDockIds={['home', 'prods', 'crm']}
      onSignOut={signOut}
      headerAction={
        <button
          type="button"
          className="btn btn-tryon btn-sm whitespace-nowrap shrink-0"
          onClick={() => navigate(`/shop/${activeShop.slug}?preview=1`)}
        >
          <I n="eye" s={14} /> معاينة المتجر
        </button>
      }
    >
      {sec === 'home' && (
        <>
          {/* 14-Day Free Trial Countdown / Expired Renewal Banner (ONLY on Home tab) */}
          {expiredOrPaused ? (
            <div className="mb-4 rounded-2xl p-4 bg-rose-50 border border-rose-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-extrabold text-rose-800 text-sm sm:text-base">
                  انتهت الفترة التجريبية المجانية أو تم إيقاف الاشتراك — متجر العملاء متوقف مؤقتاً
                </div>
                <div className="text-xs text-rose-700 mt-0.5 leading-6">
                  لإعادة تفعيل رابط متجرك فوراً، جدّد الاشتراك مع إدارة المنصة عبر{' '}
                  <span dir="ltr" className="inline-block font-bold">
                    InstaPay
                  </span>{' '}
                  أو{' '}
                  <span dir="ltr" className="inline-block font-bold">
                    Vodafone Cash
                  </span>{' '}
                  وأرسل إيصال التحويل.
                </div>
              </div>
              <a
                className="btn btn-p btn-sm shrink-0"
                href={`https://wa.me/${import.meta.env.VITE_ADMIN_WA || '201000000000'}?text=${adminRenewMsg}`}
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
                  <span>
                    متبقي <span dir="ltr">{trialDaysLeft}</span> أيام في فترتك التجريبية المجانية
                  </span>
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
                href={`https://wa.me/${import.meta.env.VITE_ADMIN_WA || '201000000000'}?text=${adminRenewMsg}`}
                target="_blank"
                rel="noreferrer"
              >
                <I n="crown" s={14} /> تفعيل الاشتراك الدائم
              </a>
            </div>
          ) : null}

          <Head t={`أهلاً بك، ${activeShop.name} 👋`} sub="ملخص نشاط متجرك اليوم" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat
              icon="eye"
              label="تجارب العملاء المسجلة"
              value={<span dir="ltr">{totalTryOns}</span>}
              sub={<span className="text-slate-500">إجمالي التفاعلات والطلبات</span>}
            />
            <Stat
              icon="bell"
              tone="b-warn"
              label="تذكيرات العملاء المستحقة"
              value={<span dir="ltr">{dueRecallCount}</span>}
              sub={<span className="text-slate-500">متابعة 6 و12 شهر</span>}
              onClick={() => setSec('crm')}
            />
            <Stat
              icon="box"
              label="النظارات المنشورة"
              value={
                <span dir="ltr" className="inline-block">
                  {shopProducts.length} / {maxProducts}
                </span>
              }
              onClick={() => setSec('prods')}
            />
            <Stat icon="dollar" label="مبيعات الشهر" value={<Egp v={monthlyShopRevenue} />} />
          </div>

          <div className="glass rounded-2xl p-5 mb-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-9 h-9 rounded-xl b-acc flex items-center justify-center">
                <I n="spark" s={18} />
              </span>
              <h3 className="font-bold text-[#0F172A]">رادار التحليلات الذكية</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">أكثر النظارات تجربةً وطلبًا من عملائك</p>

            {totalRadarTrials < 5 ? (
              <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-6 text-center text-sm text-slate-600 leading-7">
                ستظهر توصيات الأداء الذكية تلقائياً بعد بدء تجربة العملاء لنظاراتك
              </div>
            ) : (
              <>
                <div className="grid md:grid-cols-2 gap-3 mb-4">
                  {lowestConvFrame && (
                    <div className="rounded-xl p-3.5 bg-rose-50 border border-rose-200 text-sm leading-7 text-rose-900">
                      <b className="text-rose-700">⚠ الأقل تحويلاً:</b> «{lowestConvFrame[0]}» تم تجربتها{' '}
                      <span dir="ltr" className="font-bold">
                        {lowestConvFrame[1]}
                      </span>{' '}
                      مرة بمبيعات{' '}
                      <span dir="ltr" className="font-bold">
                        {lowestConvFrame[2]}
                      </span>{' '}
                      (<span dir="ltr">{((lowestConvFrame[2] / Math.max(1, lowestConvFrame[1])) * 100).toFixed(1)}%</span>
                      ). راجع السعر أو أضف عرضاً ترويجياً.
                    </div>
                  )}
                  {mostTriedFrame && (
                    <div className="rounded-xl p-3.5 bg-sky-50 border border-sky-200 text-sm leading-7 text-sky-950">
                      <b className="text-[#0284C7]">🔥 الأكثر تفاعلاً:</b> «{mostTriedFrame[0]}» في الصدارة بـ{' '}
                      <span dir="ltr" className="font-bold">
                        {mostTriedFrame[1]}
                      </span>{' '}
                      تجربة وطلب مؤكد{' '}
                      <span dir="ltr" className="font-bold">
                        ({mostTriedFrame[2]})
                      </span>
                      .
                    </div>
                  )}
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
                        const c = (r[2] / Math.max(1, r[1])) * 100;
                        return (
                          <tr key={r[0]} className="border-b border-slate-100 tabular-nums">
                            <td className="p-2 font-bold text-[#0F172A]">{r[0]}</td>
                            <td className="p-2 text-center" dir="ltr">
                              {r[1]}
                            </td>
                            <td className="p-2 text-center" dir="ltr">
                              {r[2]}
                            </td>
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
                                <span
                                  dir="ltr"
                                  className={'text-xs font-bold ' + (c < 5 ? 'text-rose-600' : 'text-[#059669]')}
                                >
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
              </>
            )}
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-[#0F172A]">متابعة العملاء (CRM 6 و12 شهر)</h3>
                <p className="text-xs text-slate-500">تنبيهات الصيانة الدورية وتغيير الإطارات عبر واتساب</p>
              </div>
              <button type="button" className="btn btn-g btn-sm" onClick={() => setSec('crm')}>
                إدارة قاعدة العملاء ({shopCrm.length})
              </button>
            </div>
            {dueCrmList.slice(0, 3).map((c) => {
              const recallKind = c.due12 ? '12m' : '6m';
              const msg = encodeURIComponent(
                `أهلاً ${c.customerName} 👋 ${activeShop.name} بيفكّرك بموعد صيانة ومراجعة نظارتك (${c.productName}). تحب تشرفنا في المحل؟`
              );
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] mb-2">
                  <span className="w-9 h-9 rounded-full bg-[#0F172A] text-white font-extrabold flex items-center justify-center">
                    {c.customerName[0]}
                  </span>
                  <div className="flex-1 min-w-[150px]">
                    <div className="font-bold text-sm text-[#0F172A]">{c.customerName}</div>
                    <div className="text-xs text-slate-500">
                      {c.productName} · منذ {c.daysSince} يوم
                    </div>
                  </div>
                  <a
                    className="btn btn-p btn-sm"
                    href={`https://wa.me/${waNum(c.phone)}?text=${msg}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => markCrmRecallSent(c.id, recallKind)}
                  >
                    <I n="msg" s={14} /> تذكير واتساب 💬
                  </a>
                </div>
              );
            })}
          </div>
        </>
      )}

      {sec === 'prods' && (
        <>
          <Head
            t="منتجاتي"
            sub={
              <>
                <span dir="ltr" className="inline-block font-bold text-[#0F172A]">
                  {shopProducts.length} / {maxProducts}
                </span>{' '}
                نظارة متاحة في الكتالوج
              </>
            }
          />
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

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {shopProducts.slice(0, visibleProdsCount).map((p) => {
              const published = p.isPublished !== false;
              return (
                <div
                  key={p.id}
                  className={
                    'glass rounded-2xl p-4 transition flex flex-col gap-3 ' +
                    (!published ? 'opacity-70' : '')
                  }
                >
                  <div
                    className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] cursor-pointer relative overflow-hidden p-2"
                    onClick={() => setModal({ t: 'editprod', p })}
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <div className="relative aspect-[4/3] rounded-lg bg-white border border-slate-200/80 flex items-center justify-center p-1.5 overflow-hidden">
                        <span className="absolute top-1 start-1 z-10 px-1.5 py-0.5 rounded bg-slate-900/80 text-white text-[0.55rem] font-bold">
                          بالوش
                        </span>
                        <MiniGlasses
                          type={p.type}
                          frame={p.frame}
                          lens={p.lens}
                          w={105}
                          imageUrl={resolveStoreFrontUrl(p)}
                        />
                      </div>
                      <div className="relative aspect-[4/3] rounded-lg bg-white border border-slate-200/80 flex items-center justify-center p-1.5 overflow-hidden">
                        <span className="absolute top-1 start-1 z-10 px-1.5 py-0.5 rounded bg-slate-700/80 text-white text-[0.55rem] font-bold">
                          بالجنب
                        </span>
                        {resolveAngled45Url(p) ? (
                          <img
                            src={resolveAngled45Url(p)}
                            alt={`زاوية جانبية ${p.name}`}
                            loading="lazy"
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <MiniGlasses
                            type={p.type}
                            frame={p.frame}
                            lens={p.lens}
                            w={105}
                            imageUrl={resolveStoreFrontUrl(p)}
                          />
                        )}
                      </div>
                    </div>
                    {!published && (
                      <span className="absolute top-2 end-2 z-20 badge b-warn">مخفية</span>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-[#0F172A] truncate">{p.name}</div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5 truncate" dir="ltr" style={{ textAlign: 'start' }}>
                        {p.modelCode || p.code}
                      </div>
                    </div>
                    <div className="font-extrabold text-[#D97706] shrink-0">
                      <Pr x={D(p)} />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 mt-auto">
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
                      <I n="eye" s={13} /> معاينة
                    </button>
                    <button
                      type="button"
                      className="btn btn-d btn-sm !px-2.5 shrink-0"
                      title="حذف"
                      aria-label="حذف"
                      onClick={() => setModal({ t: 'delprod', p })}
                    >
                      <I n="trash" s={13} />
                    </button>
                  </div>
                </div>
              );
            })}
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

      {sec === 'crm' && (
        <>
          <Head t="قاعدة عملاء المحل وتذكيرات المتابعة (CRM)" sub="تسجيل عملاء المحل وتنبيهات الصيانة بعد 6 و12 شهراً عبر واتساب" />

          <div className="glass rounded-2xl p-5 mb-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-[#0F172A]">تذكير الصيانة الدورية (6 شهور)</span>
                <Switch
                  on={activeShop.recall6mEnabled ?? true}
                  onChange={(v) => updateShop(activeShop.id, { recall6mEnabled: v })}
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-[#0F172A]">تذكير المراجعة السنوية (12 شهر)</span>
                <Switch
                  on={activeShop.recall12mEnabled ?? true}
                  onChange={(v) => updateShop(activeShop.id, { recall12mEnabled: v })}
                />
              </div>
            </div>
            <span className="badge b-warn">{dueRecallCount} عملاء مستحقون للتذكير الآن</span>
          </div>

          <form onSubmit={handleAddCrm} className="glass rounded-2xl p-5 mb-5 space-y-3">
            <h3 className="font-bold text-sm text-[#0F172A]">إضافة عميل جديد</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <input
                className="inp text-xs"
                placeholder="اسم العميل *"
                value={crmName}
                onChange={(e) => setCrmName(e.target.value)}
                required
              />
              <input
                className="inp text-xs"
                dir="ltr"
                placeholder="رقم الموبايل *"
                value={crmPhone}
                onChange={(e) => setCrmPhone(e.target.value)}
                required
              />
              <input
                className="inp text-xs"
                placeholder="الموديل / النظارة"
                value={crmProdName}
                onChange={(e) => setCrmProdName(e.target.value)}
              />
              <input
                className="inp text-xs"
                dir="ltr"
                placeholder="PD (اختياري)"
                value={crmPd}
                onChange={(e) => setCrmPd(e.target.value)}
              />
              <div className="flex gap-2">
                <input
                  className="inp text-xs flex-1"
                  placeholder="ملاحظات..."
                  value={crmNotes}
                  onChange={(e) => setCrmNotes(e.target.value)}
                />
                <button type="submit" className="btn btn-p btn-sm shrink-0">
                  إضافة
                </button>
              </div>
            </div>
          </form>

          <div className="space-y-3">
            {dueCrmList.map((c) => {
              const recallType: '6m' | '12m' = c.due12 ? '12m' : '6m';
              const waText = encodeURIComponent(
                `أهلاً ${c.customerName} 👋 معكم ${activeShop.name}. مرّ ${
                  recallType === '12m' ? 'عام كامل' : '6 أشهر'
                } على نظارتك (${c.productName}) — يشرفنا زيارتك لخدمة الصيانة والتنظيف المجاني أو استعراض الموديلات الجديدة.`
              );
              return (
                <div key={c.id} className="glass rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <b className="text-sm text-[#0F172A]">{c.customerName}</b>
                      <span className="font-mono text-xs text-slate-500" dir="ltr">{c.phone}</span>
                      {(c.due6 || c.due12) && (
                        <span className="badge b-warn">
                          {c.due12 ? 'مستحق تذكير 12 شهر' : 'مستحق تذكير 6 شهور'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      {c.productName} {c.pd ? `· PD ${c.pd}` : ''} · منذ {c.daysSince} يوم
                      {c.notes ? ` · ${c.notes}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.recall6mSentAt && <span className="badge b-ok text-[0.68rem]">أُرسل 6ش ✓</span>}
                    {c.recall12mSentAt && <span className="badge b-ok text-[0.68rem]">أُرسل 12ش ✓</span>}
                    <a
                      href={`https://wa.me/${waNum(c.phone)}?text=${waText}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-p btn-sm"
                      onClick={() => markCrmRecallSent(c.id, recallType)}
                    >
                      <I n="msg" s={14} /> إرسال تذكير واتساب 💬
                    </a>
                  </div>
                </div>
              );
            })}
            {!dueCrmList.length && (
              <div className="glass rounded-2xl p-10 text-center text-sm text-slate-500">
                لا يوجد عملاء مسجلون بعد — أضف أول عميل لبدء التذكيرات التلقائية
              </div>
            )}
          </div>
        </>
      )}

      {sec === 'inq' && rxEnabled && (
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

      {sec === 'lens' && rxEnabled && <MerchantLensMatrixManager />}

      {sec === 'lens_teaser' && !rxEnabled && (
        <>
          <Head
            t="العدسات الطبية — قريباً ✨"
            sub="مصفوفة متكاملة لتسعير العدسات الطبية وربط الشركات المصنعة بمتجرك"
          />
          <div className="glass rounded-3xl p-6 sm:p-8 max-w-2xl space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-12 h-12 rounded-2xl bg-sky-50 text-[#0284C7] border border-sky-200 flex items-center justify-center shrink-0">
                <I n="eye" s={24} />
              </span>
              <div>
                <div className="font-extrabold text-base sm:text-lg text-[#0F172A]">
                  العدسات الطبية — قريباً ✨
                </div>
                <div className="text-xs text-slate-500">
                  يتم تجهيز مصفوفة العدسات والرعاة المعتمدين على مستوى المنصة حالياً
                </div>
              </div>
            </div>
            <p className="text-sm text-slate-600 leading-7">
              قريباً ستتمكن من تفعيل العدسات الجاهزة (Single Vision) وعدسات التصنيع (Progressive &amp; Bifocal) بدرجات ضغط 1.56 حتى 1.74 وبأسعار الشركات المعتمدة أو شركاتك الخاصة مع استلام الكشوفات الطبية مباشرة على واتساب.
            </p>
            <div className="rounded-2xl p-3.5 bg-[#F8F9FA] border border-[#E2E8F0] text-xs text-slate-600">
              متجرك يعمل الآن بكامل طاقته لعرض الإطارات والتجربة الحية 1:1 على الوجه واستقبال طلبات الواتساب.
            </div>
          </div>
        </>
      )}

      {sec === 'delivery' && deliveryEnabled && (
        <>
          <Head t="إعدادات التوصيل والشحن" sub="حدّد رسوم ومناطق التوصيل التي تظهر لعملائك في السلة ودليل المحلات" />
          <div className="glass rounded-2xl p-5 max-w-xl space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-700">رسوم التوصيل الافتراضية (ج.م)</label>
              <input
                type="number"
                className="inp mt-1"
                value={activeShop.deliveryFee ?? 60}
                onChange={(e) => updateShop(activeShop.id, { deliveryFee: Math.max(0, +e.target.value) })}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">مناطق التغطية</label>
              <input
                className="inp mt-1"
                placeholder="مثال: القاهرة والجيزة خلال 24 ساعة"
                value={activeShop.deliveryAreas || ''}
                onChange={(e) => updateShop(activeShop.id, { deliveryAreas: e.target.value })}
              />
            </div>
            <button type="button" className="btn btn-p" onClick={() => toast('تم حفظ إعدادات التوصيل ✓')}>
              حفظ إعدادات التوصيل
            </button>
          </div>
        </>
      )}

      {sec === 'suppliers' && suppliersEnabled && (
        <>
          <Head t="الموردون المعتمدون بالمنصة ⭐" sub="تواصل مباشر مع كبار مستوردي الشنابر والعدسات بأسعار خاصة لتجار OptiVerse" />
          <div className="grid md:grid-cols-2 gap-4">
            {(platformSettings.sponsoredSuppliers || [])
              .filter((s) => s.isActive)
              .map((sup) => (
                <div key={sup.id} className="glass rounded-2xl p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-extrabold text-base text-[#0F172A]">{sup.name}</h3>
                      <div className="text-xs text-slate-500 mt-0.5">{sup.specialty} · {sup.city}</div>
                    </div>
                    <span className="badge b-acc">مورد معتمد ⭐</span>
                  </div>
                  <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-200 text-xs font-bold text-[#059669]">
                    {sup.offerText}
                  </div>
                  <a
                    href={`https://wa.me/${waNum(sup.wa)}?text=${encodeURIComponent(
                      `مرحباً ${sup.name}، أتواصل معكم بصفتي تاجر مشترك في OptiVerse (${activeShop.name}) بخصوص عرض الجملة.`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-p w-full"
                  >
                    <I n="msg" s={16} /> تواصل على واتساب المورد
                  </a>
                </div>
              ))}
          </div>
        </>
      )}

      {sec === 'rep' && <Reports />}

      {sec === 'stats' && (
        <>
          <Head t="الإحصائيات" sub="أداء متجرك آخر 30 يوم" />
          {totalRadarTrials < 5 ? (
            <div className="glass rounded-2xl p-8 text-center text-sm text-slate-600 leading-7">
              ستظهر إحصائيات التجارب الأسبوعية والنظارات الأكثر تجربة تلقائياً بعد بدء تجربة العملاء لنظاراتك
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="glass rounded-2xl p-5">
                <h3 className="font-bold mb-3">التجارب الأسبوعية</h3>
                <LineChart
                  data={[0, 0, 0, 0, 0, 0, totalRadarTrials]}
                  labels={['أسبوع 1', 'أسبوع 2', 'أسبوع 3', 'أسبوع 4', 'أسبوع 5', 'أسبوع 6', 'الأسبوع الحالي']}
                  h={200}
                  isCurrency={false}
                  unit="تجربة"
                  changeLabel="عن الأسبوع السابق"
                />
              </div>
              <div className="glass rounded-2xl p-5">
                <h3 className="font-bold mb-4">النظارات الأكثر تجربة</h3>
                <Bars rows={radar.map((r) => [r[0], r[1], ' تجربة'])} />
              </div>
            </div>
          )}
        </>
      )}

      {sec === 'about' && (
        <>
          <Head
            t={
              <>
                حول <span dir="ltr">OptiVerse</span>
              </>
            }
            sub="كل ما تحتاج معرفته عن المنصة"
          />
          <div className="glass rounded-2xl p-6 mb-5 leading-8 text-sm opacity-90">
            <p className="mb-3">
              <span dir="ltr" className="inline-block font-bold">
                OptiVerse
              </span>{' '}
              منصة <span dir="ltr" className="inline-block">SaaS</span> تمنح محلات النظارات متجراً تفاعلياً برابط
              خاص. ترفع صور نظاراتك لتُعزل وتنتج صور كتالوج استوديو احترافية وتجربة{' '}
              <span dir="ltr" className="inline-block font-bold">
                AI + 3D
              </span>{' '}
              بمقياس{' '}
              <span dir="ltr" className="inline-block font-bold">
                1:1 mm
              </span>{' '}
              على وجه العميل، مع دليل محلات معتمد وقاعدة عملاء وتذكيرات دورية.
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mt-4">
              {[
                ['camera', 'تجربة حية 1:1 mm', 'تتبّع نقاط الوجه بدقة وقياس PD'],
                ['spark', 'ذكاء اصطناعي', 'عزل صور ستوديو + تجميع ألوان مجاني + قراءة المقاسات'],
                ['msg', 'طلب مباشر', 'استلام الطلبات مباشرة على واتساب المحل بدون عمولات'],
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
        </>
      )}

      {sec === 'store' && (
        <>
          <Head
            t="بيانات المحل والسمات واللوجو"
            sub="إعداد متجر العملاء وتخصيص اللوجو والسمة الفاخرة ورابط المتجر ورمز QR"
          />

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="glass rounded-2xl p-5 min-w-0">
              <h3 className="font-bold text-[#0F172A] mb-3">رابط المتجر</h3>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] mb-3 min-w-0">
                <I n="link" s={18} c="text-[#0284C7] shrink-0" />
                <span className="font-mono text-xs sm:text-sm text-[#0F172A] flex-1 min-w-0 break-all text-start" dir="ltr">
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
              <h3 className="font-bold text-[#0F172A]">تخصيص الواجهة واللوجو والبيانات</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-600">اسم المحل</label>
                  <input
                    className="inp mt-1"
                    value={activeShop.name}
                    onChange={(e) => updateShop(activeShop.id, { name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600">المحافظة</label>
                  <select
                    className="inp mt-1"
                    value={activeShop.governorate || activeShop.city || 'القاهرة'}
                    onChange={(e) => updateShop(activeShop.id, { governorate: e.target.value, city: e.target.value })}
                  >
                    {EGYPT_GOVERNORATES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-600">وصف / شعار المحل المختصر</label>
                <input
                  className="inp mt-1"
                  placeholder="مثال: أحدث موديلات النظارات الطبية والشمسية بتجربة ثلاثية الأبعاد"
                  value={activeShop.tagline || ''}
                  onChange={(e) => updateShop(activeShop.id, { tagline: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs text-slate-600">العنوان</label>
                <input
                  className="inp mt-1"
                  value={activeShop.address || ''}
                  onChange={(e) => updateShop(activeShop.id, { address: e.target.value })}
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-600">رابط Google Maps</label>
                  <input
                    className="inp mt-1"
                    dir="ltr"
                    value={activeShop.mapsUrl || ''}
                    onChange={(e) => updateShop(activeShop.id, { mapsUrl: e.target.value })}
                  />
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
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-600">رابط صورة البانر (Hero Banner Image)</label>
                  <input
                    className="inp mt-1"
                    dir="ltr"
                    placeholder="https://images.unsplash.com/..."
                    value={activeShop.bannerImageUrl || ''}
                    onChange={(e) => updateShop(activeShop.id, { bannerImageUrl: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600">رابط فيديو ترويجي (Hero Video MP4 / WebM)</label>
                  <input
                    className="inp mt-1"
                    dir="ltr"
                    placeholder="https://.../video.mp4"
                    value={activeShop.videoUrl || ''}
                    onChange={(e) => updateShop(activeShop.id, { videoUrl: e.target.value })}
                  />
                </div>
              </div>

              {/* Logo Upload & AI Shop-Sign Logo Generator */}
              <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    {activeShop.logo &&
                    (activeShop.logo.startsWith('http') ||
                      activeShop.logo.startsWith('data:') ||
                      activeShop.logo.startsWith('/')) ? (
                      <img
                        src={activeShop.logo}
                        alt={activeShop.name}
                        className="w-12 h-12 rounded-xl object-contain bg-white border border-[#E2E8F0] p-1 shrink-0"
                      />
                    ) : (
                      <span className="w-12 h-12 rounded-xl bg-white border border-[#E2E8F0] flex items-center justify-center text-2xl shrink-0">
                        {activeShop.logo || '👓'}
                      </span>
                    )}
                    <div>
                      <div className="text-xs font-extrabold text-[#0F172A]">لوجو المحل</div>
                      <div className="text-[0.68rem] text-slate-500">ارفع شعاراً جاهزاً أو صوّر يافطة المحل</div>
                    </div>
                  </div>
                  <span className="badge b-info text-[0.65rem]" dir="ltr">
                    AI: {aiLogoRemaining} / 2
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                  <label className="btn btn-g btn-sm cursor-pointer text-xs justify-center">
                    <I n="upload" s={14} /> رفع صورة اللوجو
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void handleUploadDirectLogo(f);
                      }}
                    />
                  </label>

                  <label
                    className={
                      'btn btn-sm text-xs justify-center ' +
                      (aiLogoUsed >= 2 || aiLogoBusy
                        ? 'bg-slate-200 text-slate-500 cursor-not-allowed pointer-events-none'
                        : 'bg-[#0284C7] hover:bg-[#0369A1] text-white cursor-pointer')
                    }
                  >
                    <I n="spark" s={14} />
                    <span>
                      {aiLogoBusy
                        ? 'جاري تصميم اللوجو...'
                        : aiLogoUsed >= 2
                        ? 'اكتمل حد AI (2/2)'
                        : 'صوّر يافطة المحل لتصميم لوجو بالـ AI ✨'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={aiLogoUsed >= 2 || aiLogoBusy}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void handleGenerateAiLogo(f);
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* 4 Curated Luxury Storefront Themes */}
              <div>
                <label className="text-xs font-extrabold text-[#0F172A] block mb-2">
                  سمات المتجر الفاخرة (تظهر فوراً للعملاء)
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {STORE_THEMES.map((th) => {
                    const active = (activeShop.themeKey || 'royal_classic') === th.key;
                    return (
                      <button
                        key={th.key}
                        type="button"
                        onClick={() => updateShop(activeShop.id, { themeKey: th.key, color: th.accent })}
                        className={
                          'rounded-2xl p-3 border text-start cursor-pointer transition flex flex-col gap-1.5 ' +
                          (active
                            ? 'border-[#0284C7] bg-sky-50/70 ring-1 ring-[#0284C7]'
                            : 'border-[#E2E8F0] bg-[#F8F9FA] hover:bg-white')
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-xs text-[#0F172A]">{th.nameAr}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            {th.swatches.map((sw, sIdx) => (
                              <span
                                key={sIdx}
                                className="w-3.5 h-3.5 rounded-full border border-slate-300"
                                style={{ background: sw }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="text-[0.68rem] text-slate-600 leading-4">{th.descAr}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-p w-full"
                onClick={() => toast('تم حفظ بيانات المتجر واللوجو والسمة ✓')}
              >
                <I n="check" s={16} /> حفظ التخصيصات
              </button>
            </div>
          </div>
        </>
      )}

      {sec === 'sub' && (
        <>
          <Head
            t="الاشتراك والباقات"
            sub="متابعة الباقة الحالية والمدة المتبقية وسعة النظارات ورصيد معالجة AI"
          />

          <div className="glass rounded-2xl p-5 mb-4 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="w-11 h-11 rounded-2xl bg-amber-50 text-[#D97706] border border-amber-200 flex items-center justify-center shrink-0">
                  <I n="crown" s={22} />
                </span>
                <div>
                  <div className="font-extrabold text-[#0F172A] text-base sm:text-lg flex items-center gap-2 flex-wrap">
                    <span>الباقة الحالية: {activeShop.plan}</span>
                    {activeShop.isFeatured && <span className="badge b-acc">متجر مميز ⭐</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="badge b-info text-xs font-extrabold">
                      متبقي في اشتراكك: <span dir="ltr">{trialDaysLeft}</span> يوماً
                    </span>
                    <span className="text-xs text-slate-500">
                      {activeShop.status === 'trial' ? 'فترة تجريبية مجانية' : 'اشتراك مفعل'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white btn-sm whitespace-nowrap shrink-0"
                  onClick={() => addTopUpCredits(activeShop.id)}
                >
                  <I n="plus" s={14} /> +{platformSettings.topupPackFrames} نظارة إضافية بـ{' '}
                  <span dir="ltr">{platformSettings.topupPackPrice}</span> ج.م
                </button>
                <a
                  className="btn btn-p btn-sm whitespace-nowrap shrink-0"
                  href={`https://wa.me/${import.meta.env.VITE_ADMIN_WA || '201000000000'}?text=${adminRenewMsg}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <I n="msg" s={14} /> ترقية / تجديد الاشتراك
                </a>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 text-xs sm:text-sm">
              <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3.5 flex items-center justify-between">
                <span className="text-slate-600 font-bold">سعة المتجر</span>
                <b className="tabular-nums text-[#0F172A]" dir="ltr">
                  {shopProducts.length} / {maxProducts}
                </b>
              </div>
              <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3.5 flex items-center justify-between">
                <span className="text-slate-600 font-bold">رصيد معالجة AI</span>
                <b className="tabular-nums text-[#0284C7]" dir="ltr">
                  {creditsRemaining} / {creditsCap}
                </b>
              </div>
              <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3.5 flex items-center justify-between">
                <span className="text-slate-600 font-bold">مسطرة PD بالكاميرا</span>
                <span className={planCaps.cameraPdRulerEnabled ? 'badge b-ok' : 'badge b-warn'}>
                  {planCaps.cameraPdRulerEnabled ? 'مفعّلة ✓' : 'في الاحترافية'}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
