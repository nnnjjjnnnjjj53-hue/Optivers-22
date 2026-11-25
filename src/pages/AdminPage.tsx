import React, { useEffect, useState } from 'react';
import { DEFAULT_LANDING_PREVIEW_FRAMES, TYPES } from '../data/seed';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { getShopDaysLeft, isAdminRole, useOptiVerse } from '../services/optiverseStore';
import { FrameType, LandingPreviewFrame, Plan, SponsoredSupplier } from '../types';
import { AdminLensMatrixManager } from '../components/AdminLensMatrixManager';
import { I } from '../components/Icons';
import {
  Bars,
  Egp,
  Head,
  LineChart,
  Shell,
  ShellNavItem,
  Stat,
  Switch,
  dlCsv,
  fmt,
  stBadge,
  waNum,
} from '../components/UiShared';

const ADMIN_SETTINGS_KEY = 'optiverse_admin_settings_v1';

interface AdminSettingsState {
  toggles: Record<string, boolean>;
  perms: Record<string, boolean[]>;
}

const DEFAULT_ADMIN_SETTINGS: AdminSettingsState = {
  toggles: {
    'التسجيل التلقائي للمحلات الجديدة': true,
    'إشعارات واتساب للتجار': true,
    'قفل رابط المتجر عند انتهاء الاشتراك': true,
    'وضع الصيانة': false,
  },
  perms: {
    'مالك المنصة': [true, true, true],
    'مدير دعم': [true, false, false],
    'محاسب': [false, true, false],
  },
};

function loadAdminSettings(): AdminSettingsState {
  try {
    const raw = localStorage.getItem(ADMIN_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        toggles: { ...DEFAULT_ADMIN_SETTINGS.toggles, ...(parsed.toggles || {}) },
        perms: { ...DEFAULT_ADMIN_SETTINGS.perms, ...(parsed.perms || {}) },
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_ADMIN_SETTINGS;
}

export function AdminPage() {
  const {
    session,
    setSession,
    authLoading,
    signInUnified,
    signInWithGoogle,
    signOut,
    shops,
    updateShop,
    toast,
    setModal,
    navigate,
    enterShopAsMerchant,
    switchToAdminDemoStore,
    platformSettings,
    savePlatformSettings,
    plans,
    savePlan,
    payments,
    auditLogs,
    logAudit,
    exportFullBackup,
    uploadAssetToStorage,
  } = useOptiVerse();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 2FA TOTP challenge & enrollment state
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [enrollQr, setEnrollQr] = useState<{ factorId: string; qrSvg: string } | null>(null);
  const [enrollCode, setEnrollCode] = useState('');
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [mfaEnrolled, setMfaEnrolled] = useState(false);

  const [adminCfg, setAdminCfg] = useState<AdminSettingsState>(() => loadAdminSettings());
  const [draftPlans, setDraftPlans] = useState<Plan[]>(() =>
    platformSettings.plans?.length ? platformSettings.plans : plans
  );
  const [draftCommerce, setDraftCommerce] = useState({
    annualDiscountMonths: platformSettings.annualDiscountMonths,
    trialDays: platformSettings.trialDays,
    trialMaxProducts: platformSettings.trialMaxProducts,
    trialAiCredits: platformSettings.trialAiCredits,
    topupPackFrames: platformSettings.topupPackFrames,
    topupPackPrice: platformSettings.topupPackPrice,
  });

  // Sponsored Supplier Form
  const [supName, setSupName] = useState('');
  const [supSpec, setSupSpec] = useState('');
  const [supCity, setSupCity] = useState('القاهرة');
  const [supWa, setSupWa] = useState('');
  const [supOffer, setSupOffer] = useState('');

  const [sec, setSec] = useState('over');
  const [range, setRange] = useState<6 | 12>(6);
  const [q, setQ] = useState('');
  const [flt, setFlt] = useState('all');

  const [draftPreviewFrames, setDraftPreviewFrames] = useState<LandingPreviewFrame[]>(() =>
    platformSettings.landingPreviewFrames?.length
      ? platformSettings.landingPreviewFrames
      : DEFAULT_LANDING_PREVIEW_FRAMES
  );
  const [newFrameName, setNewFrameName] = useState('');
  const [newFrameDim, setNewFrameDim] = useState('52-18-140');
  const [newFrameType, setNewFrameType] = useState<FrameType>('aviator');

  useEffect(() => {
    setDraftPlans(platformSettings.plans?.length ? platformSettings.plans : plans);
    setDraftCommerce({
      annualDiscountMonths: platformSettings.annualDiscountMonths,
      trialDays: platformSettings.trialDays,
      trialMaxProducts: platformSettings.trialMaxProducts,
      trialAiCredits: platformSettings.trialAiCredits,
      topupPackFrames: platformSettings.topupPackFrames,
      topupPackPrice: platformSettings.topupPackPrice,
    });
    setDraftPreviewFrames(
      platformSettings.landingPreviewFrames?.length
        ? platformSettings.landingPreviewFrames
        : DEFAULT_LANDING_PREVIEW_FRAMES
    );
  }, [platformSettings, plans]);

  useEffect(() => {
    try {
      localStorage.setItem(ADMIN_SETTINGS_KEY, JSON.stringify(adminCfg));
    } catch {
      // ignore
    }
  }, [adminCfg]);

  useEffect(() => {
    if (!supabase || !isAdminRole(session?.role)) return;
    supabase.auth.mfa
      .listFactors()
      .then(({ data }) => {
        const verified = data?.totp?.some((f) => f.status === 'verified');
        setMfaEnrolled(Boolean(verified));
      })
      .catch(() => {});
  }, [session?.role, session?.userId]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-sm opacity-75">
        جاري التحقق من جلسة الإدارة...
      </div>
    );
  }

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr(null);
    if (!isSupabaseConfigured) {
      setSession({
        userId: 'local-admin',
        email: email || 'admin@optiverse.app',
        role: 'super_admin',
        mfaVerified: true,
      });
      toast('تم الدخول إلى لوحة الإدارة (وضع المعاينة المحلي)');
      return;
    }
    setSubmitting(true);
    const res = await signInUnified(email.trim(), password);
    setSubmitting(false);
    if (!res.ok) {
      setAuthErr(res.error || 'تعذر تسجيل الدخول');
      return;
    }
    if (!isAdminRole(res.role)) {
      toast('تم التعرف على الحساب كتاجر وتوجيهك للوحة التاجر');
      return;
    }
    if (res.needsMfa && supabase) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.find((f) => f.status === 'verified');
      if (totp) {
        setMfaFactorId(totp.id);
        return;
      }
    }
    toast('مرحباً بك في الإدارة العليا لـ OptiVerse');
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !mfaFactorId) return;
    setSubmitting(true);
    const { data: chal, error: chErr } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
    if (chErr || !chal) {
      setSubmitting(false);
      setAuthErr(chErr?.message || 'تعذر بدء تحقق 2FA');
      return;
    }
    const { error: verErr } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: chal.id,
      code: mfaCode.trim(),
    });
    setSubmitting(false);
    if (verErr) {
      setAuthErr('رمز التحقق غير صحيح');
      return;
    }
    setMfaFactorId(null);
    setSession((s) => (s ? { ...s, mfaVerified: true } : s));
    toast('تم التحقق الثنائي بنجاح ✓');
  };

  const handleEnroll2FA = async () => {
    if (!supabase) {
      toast('تفعيل 2FA يتطلب ربط Supabase Auth أولاً');
      return;
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'OptiVerse Admin' });
    if (error || !data) {
      toast(error?.message || 'تعذر تفعيل المصادقة الثنائية');
      return;
    }
    setEnrollCode('');
    setEnrollQr({ factorId: data.id, qrSvg: data.totp.qr_code });
  };

  const handleConfirmEnroll2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !enrollQr) return;
    const cleanCode = enrollCode.trim();
    if (cleanCode.length < 6) {
      toast('أدخل رمز التحقق المكوّن من 6 أرقام');
      return;
    }
    setEnrollBusy(true);
    const { data: chal, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enrollQr.factorId });
    if (chErr || !chal) {
      setEnrollBusy(false);
      toast(chErr?.message || 'تعذر بدء تحقق 2FA');
      return;
    }
    const { error: verErr } = await supabase.auth.mfa.verify({
      factorId: enrollQr.factorId,
      challengeId: chal.id,
      code: cleanCode,
    });
    setEnrollBusy(false);
    if (verErr) {
      toast('رمز التحقق غير صحيح — تأكد من التطبيق وحاول مجدداً');
      return;
    }
    setEnrollQr(null);
    setEnrollCode('');
    setMfaEnrolled(true);
    await logAudit('تفعيل 2FA', 'تم تفعيل المصادقة الثنائية (TOTP) لحساب الإدارة');
    toast('تم تفعيل المصادقة الثنائية (2FA) بنجاح ✓');
  };

  // Strict Admin Gate (NO public signup for admin role)
  if (!session || !isAdminRole(session.role) || session.mfaVerified === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#F8F9FA]">
        <div className="glass rounded-3xl p-6 sm:p-8 w-full max-w-md space-y-5 fade">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-[#0F172A] text-white flex items-center justify-center">
              <I n="lock" s={22} />
            </span>
            <div>
              <h1 className="font-extrabold text-xl text-[#0F172A]">الإدارة العليا — OptiVerse</h1>
              <p className="text-xs text-slate-500">دخول خاص بمالك المنصة فقط (بدون تسجيل عام)</p>
            </div>
          </div>

          {!isSupabaseConfigured && (
            <div className="rounded-2xl p-3.5 bg-amber-50 border border-amber-200 text-xs leading-6 text-amber-900">
              لتفعيل المصادقة السحابية الحقيقية و2FA: أضف <code className="font-mono font-bold">VITE_SUPABASE_URL</code> و
              <code className="font-mono font-bold">VITE_SUPABASE_ANON_KEY</code> وأنشئ حساب Admin من لوحة Supabase في جدول{' '}
              <code className="font-mono font-bold">user_roles</code>.
            </div>
          )}

          {mfaFactorId ? (
            <form onSubmit={handleVerifyMfa} className="space-y-3">
              <div className="text-sm opacity-80">أدخل رمز التحقق الثنائي (2FA) من تطبيق المصادقة:</div>
              <input
                className="inp font-mono text-center tracking-widest"
                dir="ltr"
                placeholder="000000"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                required
              />
              {authErr && <div className="text-xs text-rose-600 font-bold">{authErr}</div>}
              <button className="btn btn-p w-full !py-3" disabled={submitting} type="submit">
                {submitting ? 'جاري التحقق...' : 'تأكيد رمز 2FA'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleAdminLogin} className="space-y-3">
              <div>
                <label className="text-xs opacity-65">البريد الإلكتروني</label>
                <input
                  className="inp mt-1"
                  type="email"
                  dir="ltr"
                  placeholder="admin@optiverse.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required={isSupabaseConfigured}
                />
              </div>
              <div>
                <label className="text-xs opacity-65">كلمة المرور</label>
                <input
                  className="inp mt-1"
                  type="password"
                  dir="ltr"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={isSupabaseConfigured}
                />
              </div>
              {authErr && <div className="text-xs text-rose-600 font-bold">{authErr}</div>}
              <button className="btn btn-p w-full !py-3" disabled={submitting} type="submit">
                <I n="enter" s={17} /> {submitting ? 'جاري الدخول...' : 'دخول الإدارة'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => signInWithGoogle()}
                className="btn btn-g w-full !py-2.5 text-xs"
              >
                الدخول عبر Google (لحساب مالك المنصة فقط)
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const items: ShellNavItem[] = [
    ['over', 'نظرة عامة والإيرادات', 'chart'],
    ['shops', 'إدارة المحلات المشتركة', 'store'],
    ['lenses', 'مصفوفة العدسات والرعاة', 'eye'],
    ['plans', 'الباقات والاشتراكات', 'crown'],
    ['pay', 'المدفوعات والفواتير', 'receipt'],
    ['stats', 'إحصائيات التجربة بالذكاء الاصطناعي', 'box'],
    ['set', 'إعدادات النظام والصلاحيات', 'gear'],
  ];

  const m6 = [21500, 26800, 31200, 36900, 41100, 48500];
  const m12 = [9800, 12400, 14100, 16800, 18900, 21500, 26800, 31200, 36900, 41100, 48500, 52300];
  const l6 = ['يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر'];
  const l12 = ['ديسمبر', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', ...l6].slice(0, 12);

  const totalShopsCount = shops.length;
  const trialShopsCount = shops.filter((s) => s.status === 'trial').length;
  const activeShopsCount = shops.filter((s) => s.status === 'active' || s.status === 'soon').length;
  const soon = shops.filter((s) => s.status === 'soon').length;
  const monthlyRevenue = shops
    .filter((s) => s.status === 'active' || s.status === 'soon')
    .reduce((sum, s) => sum + s.price, 0);

  const searchLower = q.trim().toLowerCase();
  const rows = shops.filter(
    (s) =>
      (flt === 'all' || s.status === flt) &&
      (!searchLower ||
        s.name.toLowerCase().includes(searchLower) ||
        (s.ownerName || '').toLowerCase().includes(searchLower) ||
        (s.ownerEmail || '').toLowerCase().includes(searchLower) ||
        (s.governorate || s.city || '').toLowerCase().includes(searchLower) ||
        s.slug.toLowerCase().includes(searchLower))
  );

  const collectedTotal = payments.filter((p) => p.status === 'ok').reduce((sum, p) => sum + p.amount, 0);
  const pendingTotal = payments.filter((p) => p.status === 'wait').reduce((sum, p) => sum + p.amount, 0);
  const lateTotal = payments.filter((p) => p.status === 'late').reduce((sum, p) => sum + p.amount, 0);

  const savePlanUpdate = async (updatedPlan: Plan) => {
    const nextList = draftPlans.map((p) => (p.id === updatedPlan.id ? updatedPlan : p));
    setDraftPlans(nextList);
    await savePlan(updatedPlan);
    await savePlatformSettings({ plans: nextList });
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim()) {
      toast('اكتب اسم المورد أولاً');
      return;
    }
    const newSup: SponsoredSupplier = {
      id: `sup-${Date.now()}`,
      name: supName.trim(),
      specialty: supSpec.trim() || 'شنابر وعدسات جملة',
      city: supCity.trim() || 'القاهرة',
      wa: supWa.trim() || '01000000000',
      offerText: supOffer.trim() || 'أسعار خاصة لتجار OptiVerse',
      isActive: true,
    };
    await savePlatformSettings({
      sponsoredSuppliers: [newSup, ...(platformSettings.sponsoredSuppliers || [])],
    });
    setSupName('');
    setSupSpec('');
    setSupWa('');
    setSupOffer('');
    toast('تم إضافة المورد المعتمد ✓');
  };

  const Table = ({ list }: { list: typeof shops }) => (
    <div className="glass rounded-2xl overflow-x-auto">
      <table className="w-full text-sm min-w-[1120px]">
        <thead className="text-xs text-slate-500">
          <tr className="border-b border-[#E2E8F0]">
            {[
              'المحل والمحافظة',
              'بيانات المالك والتواصل',
              'الباقة والرصيد',
              'الحالة والمدة',
              'التوصيل والتمييز',
              'رابط المتجر',
              'إجراءات',
            ].map((h) => (
              <th key={h} className="p-3 text-start font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((s) => {
            const dLeft = getShopDaysLeft(s);
            const shopPath = `/s/${s.slug}`;
            const gov = s.governorate || s.city || 'القاهرة';
            const creditsCap = (s.aiCreditsLimit || 110) + (s.topupCredits || 0);
            const creditsUsed = s.aiCreditsUsed || 0;
            const waHref = `https://wa.me/${waNum(s.wa)}?text=${encodeURIComponent(
              `مرحباً ${s.ownerName || s.name}، معك إدارة منصة OptiVerse بخصوص متجرك "${s.name}".`
            )}`;
            return (
              <tr key={s.id} className="border-b border-slate-100 hover:bg-[#F8F9FA] align-top">
                <td className="p-3">
                  <div className="font-bold flex items-center gap-1.5">
                    <span>{s.name}</span>
                    {s.isFeatured && <span title="متجر مميز">⭐</span>}
                    {s.isDemoAdminStore && <span className="badge b-info text-[0.65rem]">ديمو</span>}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">{gov}</div>
                  {s.address && <div className="text-[0.68rem] text-slate-500 max-w-[180px] truncate">{s.address}</div>}
                  {s.mapsUrl && (
                    <a
                      href={s.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[0.68rem] text-[#0284C7] hover:underline mt-0.5"
                    >
                      <I n="map" s={11} /> الخريطة
                    </a>
                  )}
                </td>
                <td className="p-3">
                  <div className="font-semibold text-xs text-[#0F172A]">{s.ownerName || 'غير محدد'}</div>
                  {s.ownerEmail && (
                    <div className="text-[.7rem] opacity-65 font-mono" dir="ltr" style={{ textAlign: 'start' }}>
                      {s.ownerEmail}
                    </div>
                  )}
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#059669] hover:underline mt-1"
                    dir="ltr"
                  >
                    <I n="msg" s={12} /> {s.wa || 'واتساب'}
                  </a>
                </td>
                <td className="p-3">
                  <span className={'badge ' + (s.planTier === 'pro' || s.plan === 'الاحترافية' ? 'b-acc' : 'b-info')}>
                    {s.plan}
                  </span>
                  <div className="text-[.7rem] opacity-70 mt-1 tabular-nums">{s.price} ج.م/ش</div>
                  <div className="text-[.68rem] text-slate-500 tabular-nums mt-0.5">
                    AI: {creditsUsed} / {creditsCap}
                  </div>
                </td>
                <td className="p-3 whitespace-nowrap">
                  <div>{stBadge(s.status)}</div>
                  <div className="text-xs text-slate-600 mt-1 tabular-nums">
                    {s.exp} ({dLeft} يوم)
                  </div>
                </td>
                <td className="p-3">
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">توصيل</span>
                      <Switch
                        on={Boolean(s.enableDeliveryService)}
                        onChange={async (v) => {
                          await updateShop(s.id, { enableDeliveryService: v });
                          await logAudit('تفعيل التوصيل', `${s.name}: ${v}`, s.id);
                          toast(v ? `تم تفعيل خدمة التوصيل لـ ${s.name} ✓` : `تم إيقاف التوصيل لـ ${s.name}`);
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">مميز ⭐</span>
                      <Switch
                        on={Boolean(s.isFeatured)}
                        onChange={async (v) => {
                          await updateShop(s.id, { isFeatured: v });
                          await logAudit('تمييز متجر بالدليل', `${s.name}: ${v}`, s.id);
                          toast(v ? `تم تمييز ${s.name} في دليل المحلات ⭐` : `تم إلغاء تمييز ${s.name}`);
                        }}
                      />
                    </div>
                  </div>
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => navigate(shopPath)}
                      className="font-mono text-xs tx-acc hover:underline cursor-pointer"
                      dir="ltr"
                    >
                      {shopPath}
                    </button>
                    <button
                      type="button"
                      title="نسخ رابط المتجر"
                      className="btn btn-g btn-sm !p-1.5"
                      onClick={() => {
                        const full = `${window.location.origin}${shopPath}`;
                        navigator.clipboard?.writeText(full).then(() => toast('تم نسخ رابط المتجر ✓')).catch(() => toast(full));
                      }}
                    >
                      <I n="copy" s={12} />
                    </button>
                  </div>
                </td>
                <td className="p-3">
                  <div className="flex gap-1.5 flex-wrap">
                    {(s.status === 'trial' || s.status === 'expired' || s.status === 'paused') && (
                      <button
                        className="btn btn-p btn-sm"
                        onClick={async () => {
                          await updateShop(s.id, {
                            status: 'active',
                            days: Math.max(30, dLeft),
                            exp: 'مفعل (شهر)',
                          });
                          await logAudit('تفعيل الاشتراك', `تم تفعيل اشتراك ${s.name}`, s.id);
                          toast(`تم تفعيل اشتراك ${s.name} ✓`);
                        }}
                      >
                        <I n="check" s={13} /> تفعيل
                      </button>
                    )}
                    <button className="btn btn-g btn-sm" onClick={() => setModal({ t: 'renew', s })}>
                      <I n="refresh" s={13} /> تجديد
                    </button>
                    <button className="btn btn-g btn-sm" onClick={() => setModal({ t: 'editplan', s })}>
                      <I n="edit" s={13} /> الباقة
                    </button>
                    <button className="btn btn-g btn-sm" onClick={() => setModal({ t: 'addpayment', s })}>
                      <I n="receipt" s={13} /> دفع
                    </button>
                    <button
                      className="btn btn-g btn-sm"
                      onClick={async () => {
                        const next = s.status === 'paused' ? 'active' : 'paused';
                        await updateShop(s.id, { status: next });
                        await logAudit(
                          next === 'paused' ? 'إيقاف متجر' : 'استئناف متجر',
                          `${s.name} (${s.slug})`,
                          s.id
                        );
                        toast(next === 'active' ? `تم استئناف ${s.name}` : `تم إيقاف ${s.name} مؤقتاً`);
                      }}
                    >
                      <I n={s.status === 'paused' ? 'play' : 'pause'} s={13} />{' '}
                      {s.status === 'paused' ? 'استئناف' : 'إيقاف'}
                    </button>
                    <button className="btn btn-p btn-sm" onClick={() => enterShopAsMerchant(s)}>
                      <I n="enter" s={13} /> دخول كمتجر
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {!list.length && (
            <tr>
              <td colSpan={7} className="p-8 text-center opacity-60">
                لا توجد نتائج
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <Shell
      items={items}
      active={sec}
      setActive={setSec}
      title="الإدارة العليا"
      sub="مالك المنصة · OptiVerse"
      onSignOut={signOut}
      headerAction={
        <button
          type="button"
          className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white btn-sm whitespace-nowrap shrink-0"
          onClick={switchToAdminDemoStore}
        >
          <I n="store" s={14} /> متجر الديمو ⭐
        </button>
      }
    >
      {sec === 'over' && (
        <>
          <Head t="نظرة عامة والإيرادات" sub="لوحة مالك منصة OptiVerse">
            <button type="button" className="btn btn-tryon" onClick={switchToAdminDemoStore}>
              <I n="enter" s={16} /> التبديل إلى متجر الديمو الخاص بي
            </button>
            <button type="button" className="btn btn-g" onClick={() => setModal({ t: 'addpayment' })}>
              <I n="receipt" s={16} /> تسجيل عملية دفع
            </button>
            <button type="button" className="btn btn-p" onClick={() => setModal('addshop')}>
              <I n="plus" s={16} /> إضافة محل يدوياً
            </button>
          </Head>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat
              icon="store"
              label="إجمالي المحلات"
              value={`${totalShopsCount} محل`}
              sub={<span className="opacity-60">شامل المحلات المسجلة والتجريبية</span>}
              onClick={() => {
                setFlt('all');
                setSec('shops');
              }}
            />
            <Stat
              icon="spark"
              tone="b-info"
              label={`الفترة التجريبية ${platformSettings.trialDays} يوماً`}
              value={`${trialShopsCount} محلات`}
              sub={<span className="text-[#0284C7] font-semibold">محلات في التجربة المجانية</span>}
              onClick={() => {
                setFlt('trial');
                setSec('shops');
              }}
            />
            <Stat
              icon="check"
              label="الاشتراكات النشطة"
              value={`${activeShopsCount} محل`}
              sub={<span className="text-[#D97706] font-semibold">تنتهي قريباً: {soon}</span>}
              onClick={() => {
                setFlt('active');
                setSec('shops');
              }}
            />
            <Stat
              icon="dollar"
              label="إجمالي الإيرادات الشهرية"
              value={<Egp v={monthlyRevenue} />}
              sub={<span className="badge b-ok">+18%</span>}
            />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mb-5">
            <div className="glass rounded-2xl p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-[#0F172A]">نمو الإيرادات الشهرية</h3>
                <div className="flex gap-1.5">
                  <button className={'chip ' + (range === 6 ? 'on' : '')} onClick={() => setRange(6)}>
                    6 أشهر
                  </button>
                  <button className={'chip ' + (range === 12 ? 'on' : '')} onClick={() => setRange(12)}>
                    12 شهر
                  </button>
                </div>
              </div>
              <LineChart key={range} data={range === 6 ? m6 : m12} labels={range === 6 ? l6 : l12} />
            </div>
            <div className="glass rounded-2xl p-5">
              <h3 className="font-bold text-[#0F172A] mb-1">التحكم السريع بالباقات</h3>
              <p className="text-xs text-slate-500 mb-4">فعّل أو أوقف الباقات المتاحة للتسجيل</p>
              {draftPlans.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] mb-2.5">
                  <div>
                    <div className="font-bold text-sm">{p.name}</div>
                    <div className="text-xs opacity-70">
                      <Egp v={p.price} /> / شهر · {p.maxProducts} نظارة
                    </div>
                  </div>
                  <Switch
                    on={p.on}
                    onChange={async (v) => {
                      await savePlanUpdate({ ...p, on: v });
                      toast(v ? `تم تفعيل ${p.name}` : `تم إيقاف ${p.name}`);
                    }}
                  />
                </div>
              ))}
              <button className="btn btn-g w-full mt-2" onClick={() => setModal('addshop')}>
                <I n="plus" s={16} /> إضافة محل يدوياً
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">المحلات المشتركة</h3>
            <button className="btn btn-g btn-sm" onClick={() => setSec('shops')}>
              عرض الكل ({totalShopsCount})
            </button>
          </div>
          <Table list={shops} />
        </>
      )}

      {sec === 'shops' && (
        <>
          <Head t="إدارة المحلات المشتركة" sub={`${totalShopsCount} محل مسجّل · ${trialShopsCount} في التجربة المجانية`}>
            <button className="btn btn-p" onClick={() => setModal('addshop')}>
              <I n="plus" s={16} /> إضافة محل
            </button>
          </Head>
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <input
                className="inp ps-10"
                placeholder="ابحث باسم المحل أو المالك أو المحافظة أو البريد..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <span className="absolute top-1/2 -translate-y-1/2 start-3 opacity-50">
                <I n="search" s={16} />
              </span>
            </div>
            {[
              ['all', 'الكل'],
              ['trial', 'تجريبي'],
              ['active', 'نشط'],
              ['soon', 'ينتهي قريباً'],
              ['expired', 'منتهي'],
              ['paused', 'موقوف'],
            ].map((f) => (
              <button key={f[0]} className={'chip ' + (flt === f[0] ? 'on' : '')} onClick={() => setFlt(f[0])}>
                {f[1]}
              </button>
            ))}
          </div>
          <Table list={rows} />
        </>
      )}

      {sec === 'plans' && (
        <>
          <Head t="الباقات والاشتراكات والتسعير" sub="تعديل أسعار ومميزات الباقات الثلاثة + حدود التجربة والـ Top-up" />

          {/* Global Commerce Rules */}
          <div className="glass rounded-2xl p-5 mb-5">
            <h3 className="font-bold text-[#0F172A] mb-3">الإعدادات التجارية العامة (الفترة التجريبية + السنوي + Top-Up)</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="text-xs text-slate-600">شهور الخصم السنوي</label>
                <input
                  className="inp mt-1"
                  type="number"
                  min={0}
                  max={6}
                  value={draftCommerce.annualDiscountMonths}
                  onChange={(e) => setDraftCommerce((c) => ({ ...c, annualDiscountMonths: Math.max(0, +e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">أيام التجربة</label>
                <input
                  className="inp mt-1"
                  type="number"
                  min={1}
                  value={draftCommerce.trialDays}
                  onChange={(e) => setDraftCommerce((c) => ({ ...c, trialDays: Math.max(1, +e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">حد نظارات التجربة</label>
                <input
                  className="inp mt-1"
                  type="number"
                  min={1}
                  value={draftCommerce.trialMaxProducts}
                  onChange={(e) => setDraftCommerce((c) => ({ ...c, trialMaxProducts: Math.max(1, +e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">رصيد AI التجريبي</label>
                <input
                  className="inp mt-1"
                  type="number"
                  min={1}
                  value={draftCommerce.trialAiCredits}
                  onChange={(e) => setDraftCommerce((c) => ({ ...c, trialAiCredits: Math.max(1, +e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">باقة Top-Up (نظارات)</label>
                <input
                  className="inp mt-1"
                  type="number"
                  min={1}
                  value={draftCommerce.topupPackFrames}
                  onChange={(e) => setDraftCommerce((c) => ({ ...c, topupPackFrames: Math.max(1, +e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">سعر Top-Up (ج.م)</label>
                <input
                  className="inp mt-1"
                  type="number"
                  min={0}
                  value={draftCommerce.topupPackPrice}
                  onChange={(e) => setDraftCommerce((c) => ({ ...c, topupPackPrice: Math.max(0, +e.target.value) }))}
                />
              </div>
            </div>
            <button
              type="button"
              className="btn btn-p btn-sm mt-4"
              onClick={async () => {
                await savePlatformSettings(draftCommerce);
                toast('تم حفظ الإعدادات التجارية وحدود المنصة ✓');
              }}
            >
              حفظ الإعدادات التجارية
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {draftPlans.map((p) => (
              <div key={p.id} className="glass rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-extrabold text-lg text-[#0F172A]">{p.name}</h3>
                    <span className="text-xs opacity-60">
                      {shops.filter((s) => s.planTier === p.tierKey || s.plan === p.name).length} مشترك
                    </span>
                  </div>
                  <Switch
                    on={p.on}
                    onChange={async (v) => {
                      await savePlanUpdate({ ...p, on: v });
                      toast(v ? `تم تفعيل ${p.name}` : `تم إيقاف ${p.name}`);
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs opacity-65">السعر الشهري (ج.م)</label>
                    <input
                      className="inp mt-1"
                      type="number"
                      value={p.price}
                      onChange={(e) =>
                        setDraftPlans((a) => a.map((x) => (x.id === p.id ? { ...x, price: +e.target.value } : x)))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs opacity-65">حد النظارات</label>
                    <input
                      className="inp mt-1"
                      type="number"
                      value={p.maxProducts}
                      onChange={(e) =>
                        setDraftPlans((a) => a.map((x) => (x.id === p.id ? { ...x, maxProducts: +e.target.value } : x)))
                      }
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs opacity-65">رصيد معالجة AI الشهري</label>
                  <input
                    className="inp mt-1"
                    type="number"
                    value={p.monthlyAiCredits}
                    onChange={(e) =>
                      setDraftPlans((a) => a.map((x) => (x.id === p.id ? { ...x, monthlyAiCredits: +e.target.value } : x)))
                    }
                  />
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
                  <div className="flex items-center justify-between">
                    <span>الرفع التيربو الفوري ⚡</span>
                    <Switch
                      on={p.turboUploadEnabled}
                      onChange={(v) =>
                        setDraftPlans((a) => a.map((x) => (x.id === p.id ? { ...x, turboUploadEnabled: v } : x)))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>مسطرة PD بالكاميرا</span>
                    <Switch
                      on={p.cameraPdRulerEnabled}
                      onChange={(v) =>
                        setDraftPlans((a) => a.map((x) => (x.id === p.id ? { ...x, cameraPdRulerEnabled: v } : x)))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>تمييز بالدليل ⭐</span>
                    <Switch
                      on={p.featuredBoostEnabled}
                      onChange={(v) =>
                        setDraftPlans((a) => a.map((x) => (x.id === p.id ? { ...x, featuredBoostEnabled: v } : x)))
                      }
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-p mt-auto"
                  onClick={async () => {
                    await savePlanUpdate(p);
                    toast(`تم حفظ تعديلات باقة "${p.name}" ✓`);
                  }}
                >
                  حفظ تعديلات الباقة
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {sec === 'pay' && (
        <>
          <Head t="المدفوعات والفواتير" sub="العمليات عبر InstaPay وفودافون كاش مع أرقام المرجع">
            <button className="btn btn-p" onClick={() => setModal({ t: 'addpayment' })}>
              <I n="plus" s={16} /> تسجيل عملية دفع
            </button>
            <button
              className="btn btn-g"
              onClick={() => {
                dlCsv('المدفوعات.csv', [
                  ['رقم الفاتورة', 'المحل', 'المبلغ', 'الطريقة', 'رقم المرجع', 'الحالة'],
                  ...payments.map((r) => [r.id, r.shopName, r.amount, r.method, r.referenceNo || '', r.status]),
                ]);
                toast('تم تصدير تقرير المدفوعات ✓');
              }}
            >
              <I n="dl" s={16} /> تصدير CSV
            </button>
          </Head>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Stat icon="check" label="مُحصّل" value={<Egp v={collectedTotal} />} />
            <Stat icon="bell" tone="b-warn" label="معلّق" value={<Egp v={pendingTotal} />} />
            <Stat icon="x" tone="b-bad" label="متأخر" value={<Egp v={lateTotal} />} />
          </div>
          <div className="glass rounded-2xl overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-[#E2E8F0]">
                  {['رقم الفاتورة', 'المحل', 'المبلغ', 'الطريقة', 'رقم المرجع', 'الحالة'].map((h) => (
                    <th key={h} className="p-3 text-start">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="p-3 font-mono text-xs">{r.id}</td>
                    <td className="p-3 font-bold">{r.shopName}</td>
                    <td className="p-3">
                      <Egp v={r.amount} />
                    </td>
                    <td className="p-3 opacity-80">{r.method}</td>
                    <td className="p-3 font-mono text-xs opacity-75" dir="ltr" style={{ textAlign: 'start' }}>
                      {r.referenceNo || '—'}
                    </td>
                    <td className="p-3">
                      <span className={'badge ' + (r.status === 'ok' ? 'b-ok' : r.status === 'wait' ? 'b-warn' : 'b-bad')}>
                        {r.status === 'ok' ? 'مدفوعة' : r.status === 'wait' ? 'بانتظار التأكيد' : 'متأخرة'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {sec === 'stats' && (
        <>
          <Head t="إحصائيات التجربة بالذكاء الاصطناعي" sub="استخدام التجربة الافتراضية الحية عبر المنصة" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat icon="eye" label="تجارب اليوم" value="1,284" />
            <Stat icon="box" label="نظارات مجهزة بالذكاء الاصطناعي" value="3,920" />
            <Stat icon="share" label="مشاركات للأصدقاء" value="9,310" />
            <Stat icon="msg" label="طلبات واتساب" value="4,775" />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="glass rounded-2xl p-5">
              <h3 className="font-bold mb-4">الأكثر تجربةً (نوع الإطار)</h3>
              <Bars
                rows={[
                  ['Aviator', 41200],
                  ['Wayfarer', 33800],
                  ['Round', 22100],
                  ['Rimless', 17300],
                  ['Cat-Eye', 9600],
                ]}
              />
            </div>
            <div className="glass rounded-2xl p-5">
              <h3 className="font-bold mb-4">الأجهزة المستخدمة</h3>
              <Bars
                rows={[
                  ['Android', 54, '%'],
                  ['iPhone', 38, '%'],
                  ['كمبيوتر', 8, '%'],
                ]}
                max={100}
              />
              <h3 className="font-bold mt-6 mb-4">شكل الوجه المكتشف</h3>
              <Bars
                rows={[
                  ['بيضاوي', 46, '%'],
                  ['دائري', 31, '%'],
                  ['مربع', 23, '%'],
                ]}
                max={100}
              />
            </div>
          </div>
        </>
      )}

      {sec === 'set' && (
        <>
          <Head t="إعدادات النظام والصلاحيات" sub="مفاتيح تشغيل المنصة، الموردين المعتمدين، 2FA وسجل العمليات">
            <button className="btn btn-p" onClick={exportFullBackup}>
              <I n="dl" s={16} /> نسخة احتياطية كاملة (JSON)
            </button>
          </Head>

          {/* 3 Global Feature Flag Toggles (all default OFF) */}
          <div className="glass rounded-2xl p-5 mb-5">
            <h3 className="font-bold text-[#0F172A] mb-1">مفاتيح الميزات الاختيارية على مستوى المنصة</h3>
            <p className="text-xs text-slate-500 mb-3">
              تكون مغلقة افتراضياً (OFF) لتبسيط الواجهة ويمكن تفعيلها فورياً لكل التجار والمتاجر من هنا
            </p>
            <div className="divide-y divide-slate-100">
              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">تفعيل نظام العدسات الطبية والرعاة</div>
                  <div className="text-xs text-slate-500">
                    إظهار مصفوفة العدسات والرعاة ورفع كشف النظر في متاجر العملاء ولوحات التجار (أو إظهارها كـ قريباً ✨ للتجار عند الإيقاف)
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className="btn btn-g btn-sm text-xs"
                    onClick={() => setSec('lenses')}
                  >
                    فتح مصفوفة العدسات والرعاة
                  </button>
                  <Switch
                    on={Boolean(platformSettings.enableLensesSystem ?? platformSettings.enablePrescriptionLenses)}
                    onChange={async (v) => {
                      await savePlatformSettings({ enableLensesSystem: v, enablePrescriptionLenses: v });
                      toast(
                        v
                          ? 'تم تفعيل نظام العدسات الطبية والرعاة ✓'
                          : 'تم إغلاق نظام العدسات — سيظهر للتجار كـ قريباً ✨'
                      );
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">إتاحة خيار إبقاء شعار/كتابة العدسة التجريبية للتجار</div>
                  <div className="text-xs text-slate-500">
                    السماح للتاجر في أداة الرفع بالاحتفاظ بعلامة الماركة على العدسة بدلاً من تفريغها بالكامل
                  </div>
                </div>
                <Switch
                  on={Boolean(platformSettings.allowMerchantLensBrandingToggle)}
                  onChange={async (v) => {
                    await savePlatformSettings({ allowMerchantLensBrandingToggle: v });
                    toast(v ? 'تم إتاحة خيار إبقاء شعار العدسة للتجار ✓' : 'تم إغلاق خيار إبقاء شعار العدسة');
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">تفعيل قسم الموردين المعتمدين بالمنصة ⭐</div>
                  <div className="text-xs text-slate-500">
                    إظهار دليل تجار الجملة والموردين المعتمدين داخل لوحة تحكم كل تاجر
                  </div>
                </div>
                <Switch
                  on={Boolean(platformSettings.enableSponsoredSuppliers)}
                  onChange={async (v) => {
                    await savePlatformSettings({ enableSponsoredSuppliers: v });
                    toast(v ? 'تم تفعيل قسم الموردين المعتمدين ⭐' : 'تم إخفاء قسم الموردين المعتمدين');
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <div className="font-bold text-sm text-[#0F172A]">تفعيل دليل المحلات المعتمدة العام</div>
                  <div className="text-xs text-slate-500">
                    إظهار أزرار وروابط «دليل المحلات» للزوار في الصفحة الرئيسية ومتاجر العملاء
                  </div>
                </div>
                <Switch
                  on={Boolean(platformSettings.enableStoresDirectory)}
                  onChange={async (v) => {
                    await savePlatformSettings({ enableStoresDirectory: v });
                    toast(v ? 'تم تفعيل دليل المحلات المعتمدة العام ✓' : 'تم إخفاء دليل المحلات المعتمدة العام');
                  }}
                />
              </div>
            </div>
          </div>

          {/* Landing Page Interactive Preview Frames Manager */}
          <div className="glass rounded-2xl p-5 mb-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-[#0F172A]">نظارات المعاينة التفاعلية بالرئيسية</h3>
                <p className="text-xs text-slate-500">
                  أضف أو ارفع صور نظارات شفافة (PNG / WebP) وعدّل ترتيبها لتظهر فوق وجه المعاينة في الصفحة الرئيسية
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-g btn-sm"
                  onClick={async () => {
                    setDraftPreviewFrames(DEFAULT_LANDING_PREVIEW_FRAMES);
                    await savePlatformSettings({ landingPreviewFrames: DEFAULT_LANDING_PREVIEW_FRAMES });
                    toast('تمت استعادة نظارات المعاينة الافتراضية ✓');
                  }}
                >
                  استعادة الافتراضي
                </button>
                <button
                  type="button"
                  className="btn btn-p btn-sm"
                  onClick={async () => {
                    await savePlatformSettings({ landingPreviewFrames: draftPreviewFrames });
                    toast('تم حفظ نظارات المعاينة بالرئيسية ✓');
                  }}
                >
                  <I n="check" s={14} /> حفظ القائمة
                </button>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <input
                className="inp text-xs"
                placeholder="اسم النظارة (مثال: Classic Gold)"
                value={newFrameName}
                onChange={(e) => setNewFrameName(e.target.value)}
              />
              <input
                className="inp text-xs font-mono"
                dir="ltr"
                placeholder="52-18-140"
                value={newFrameDim}
                onChange={(e) => setNewFrameDim(e.target.value)}
              />
              <select
                className="inp text-xs"
                value={newFrameType}
                onChange={(e) => setNewFrameType(e.target.value as FrameType)}
              >
                {(Object.entries(TYPES) as [FrameType, string][]).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-p btn-sm"
                onClick={async () => {
                  if (!newFrameName.trim()) {
                    toast('اكتب اسم النظارة أولاً');
                    return;
                  }
                  const nextItem: LandingPreviewFrame = {
                    id: `lp-${Date.now().toString(36)}`,
                    name: newFrameName.trim(),
                    type: newFrameType,
                    frameColor: '#0F172A',
                    lensColor: '#dbeafe',
                    dimensions: newFrameDim.trim() || '52-18-140',
                  };
                  const nextList = [...draftPreviewFrames, nextItem];
                  setDraftPreviewFrames(nextList);
                  setNewFrameName('');
                  await savePlatformSettings({ landingPreviewFrames: nextList });
                  toast(`تمت إضافة "${nextItem.name}" إلى نظارات المعاينة ✓`);
                }}
              >
                <I n="plus" s={14} /> إضافة نظارة
              </button>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {draftPreviewFrames.map((pf, idx) => (
                <div
                  key={pf.id}
                  className="rounded-2xl p-3.5 bg-[#F8F9FA] border border-[#E2E8F0] space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="badge b-acc tabular-nums">#{idx + 1}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        title="تحريك لأعلى"
                        className="btn btn-g btn-sm !p-1.5 disabled:opacity-40"
                        onClick={async () => {
                          const next = [...draftPreviewFrames];
                          const tmp = next[idx - 1];
                          next[idx - 1] = next[idx];
                          next[idx] = tmp;
                          setDraftPreviewFrames(next);
                          await savePlatformSettings({ landingPreviewFrames: next });
                        }}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={idx === draftPreviewFrames.length - 1}
                        title="تحريك لأسفل"
                        className="btn btn-g btn-sm !p-1.5 disabled:opacity-40"
                        onClick={async () => {
                          const next = [...draftPreviewFrames];
                          const tmp = next[idx + 1];
                          next[idx + 1] = next[idx];
                          next[idx] = tmp;
                          setDraftPreviewFrames(next);
                          await savePlatformSettings({ landingPreviewFrames: next });
                        }}
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        disabled={draftPreviewFrames.length <= 1}
                        title="حذف"
                        className="btn btn-d btn-sm !p-1.5 disabled:opacity-40"
                        onClick={async () => {
                          const next = draftPreviewFrames.filter((x) => x.id !== pf.id);
                          setDraftPreviewFrames(next);
                          await savePlatformSettings({ landingPreviewFrames: next });
                          toast('تم حذف نظارة المعاينة ✓');
                        }}
                      >
                        <I n="trash" s={13} />
                      </button>
                    </div>
                  </div>

                  {pf.imageUrl && (
                    <div className="rounded-xl bg-white border border-slate-200 p-2 flex items-center justify-center h-20">
                      <img src={pf.imageUrl} alt={pf.name} className="max-h-16 object-contain" />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="inp text-xs"
                      value={pf.name}
                      onChange={(e) =>
                        setDraftPreviewFrames((prev) =>
                          prev.map((x) => (x.id === pf.id ? { ...x, name: e.target.value } : x))
                        )
                      }
                      placeholder="الاسم"
                    />
                    <input
                      className="inp text-xs font-mono"
                      dir="ltr"
                      value={pf.dimensions}
                      onChange={(e) =>
                        setDraftPreviewFrames((prev) =>
                          prev.map((x) => (x.id === pf.id ? { ...x, dimensions: e.target.value } : x))
                        )
                      }
                      placeholder="52-18-140"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <label className="btn btn-g btn-sm flex-1 cursor-pointer text-xs">
                      <I n="upload" s={13} /> {pf.imageUrl ? 'تغيير صورة PNG' : 'رفع صورة PNG شفافة'}
                      <input
                        type="file"
                        accept="image/png,image/webp,image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          try {
                            const url = await uploadAssetToStorage(file, 'landing-preview', 'png');
                            const next = draftPreviewFrames.map((x) =>
                              x.id === pf.id ? { ...x, imageUrl: url } : x
                            );
                            setDraftPreviewFrames(next);
                            await savePlatformSettings({ landingPreviewFrames: next });
                            toast(`تم رفع صورة "${pf.name}" ✓`);
                          } catch {
                            toast('تعذر رفع الصورة');
                          }
                        }}
                      />
                    </label>
                    {pf.imageUrl && (
                      <button
                        type="button"
                        className="btn btn-g btn-sm text-xs"
                        onClick={async () => {
                          const next = draftPreviewFrames.map((x) =>
                            x.id === pf.id ? { ...x, imageUrl: undefined } : x
                          );
                          setDraftPreviewFrames(next);
                          await savePlatformSettings({ landingPreviewFrames: next });
                        }}
                      >
                        إزالة الصورة
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sponsored Suppliers CRUD when toggled ON */}
          {platformSettings.enableSponsoredSuppliers && (
            <div className="glass rounded-2xl p-5 mb-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-[#0F172A]">إدارة الموردين المعتمدين ⭐</h3>
                <span className="badge b-acc">
                  {(platformSettings.sponsoredSuppliers || []).length} موردين
                </span>
              </div>

              <form onSubmit={handleAddSupplier} className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                <input
                  className="inp text-xs"
                  placeholder="اسم المورد / الشركة"
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  required
                />
                <input
                  className="inp text-xs"
                  placeholder="التخصص (مثلاً: عدسات / أسيتات)"
                  value={supSpec}
                  onChange={(e) => setSupSpec(e.target.value)}
                />
                <input
                  className="inp text-xs"
                  placeholder="المدينة / المحافظة"
                  value={supCity}
                  onChange={(e) => setSupCity(e.target.value)}
                />
                <input
                  className="inp text-xs"
                  dir="ltr"
                  placeholder="رقم واتساب المورد"
                  value={supWa}
                  onChange={(e) => setSupWa(e.target.value)}
                />
                <div className="flex gap-2">
                  <input
                    className="inp text-xs flex-1"
                    placeholder="عرض الجملة..."
                    value={supOffer}
                    onChange={(e) => setSupOffer(e.target.value)}
                  />
                  <button type="submit" className="btn btn-p btn-sm shrink-0">
                    إضافة
                  </button>
                </div>
              </form>

              <div className="grid md:grid-cols-2 gap-3">
                {(platformSettings.sponsoredSuppliers || []).map((sup) => (
                  <div
                    key={sup.id}
                    className="rounded-xl p-3.5 bg-[#F8F9FA] border border-[#E2E8F0] flex items-start justify-between gap-3"
                  >
                    <div className="text-xs space-y-1">
                      <div className="font-extrabold text-sm text-[#0F172A]">{sup.name}</div>
                      <div className="text-slate-600">{sup.specialty} · {sup.city}</div>
                      <div className="text-[#059669] font-bold">{sup.offerText}</div>
                      <div className="font-mono text-slate-500" dir="ltr">{sup.wa}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        on={sup.isActive}
                        onChange={async (v) => {
                          await savePlatformSettings({
                            sponsoredSuppliers: (platformSettings.sponsoredSuppliers || []).map((x) =>
                              x.id === sup.id ? { ...x, isActive: v } : x
                            ),
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-d btn-sm !p-1.5"
                        onClick={async () => {
                          await savePlatformSettings({
                            sponsoredSuppliers: (platformSettings.sponsoredSuppliers || []).filter((x) => x.id !== sup.id),
                          });
                          toast('تم حذف المورد ✓');
                        }}
                      >
                        <I n="trash" s={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4 mb-5">
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold">إعدادات عامة والأمان (2FA)</h3>
                {mfaEnrolled && (
                  <span className="badge b-ok">
                    <I n="check" s={12} /> 2FA مفعّلة
                  </span>
                )}
              </div>
              {Object.entries(adminCfg.toggles).map(([label, val]) => (
                <div key={label} className="flex items-center justify-between py-3 border-b border-slate-100 text-sm">
                  <span>{label}</span>
                  <Switch
                    on={val}
                    onChange={(nextVal) => {
                      setAdminCfg((prev) => ({
                        ...prev,
                        toggles: { ...prev.toggles, [label]: nextVal },
                      }));
                      toast(`تم تحديث "${label}" ✓`);
                    }}
                  />
                </div>
              ))}
              <div className="pt-4">
                <button className="btn btn-g w-full" onClick={handleEnroll2FA}>
                  <I n="shield" s={16} />{' '}
                  {mfaEnrolled ? 'إضافة عامل مصادقة ثنائية آخر (2FA)' : 'تفعيل المصادقة الثنائية (2FA) لحساب المدير'}
                </button>
                {enrollQr && (
                  <form onSubmit={handleConfirmEnroll2FA} className="mt-3 p-4 rounded-xl bg-white text-slate-900 text-center space-y-3">
                    <img src={enrollQr.qrSvg} alt="2FA QR" className="mx-auto w-36 h-36" />
                    <div className="text-xs font-bold">امسح الكود بتطبيق Google Authenticator ثم أدخل الرمز للتفعيل</div>
                    <div className="flex gap-2">
                      <input
                        className="inp !bg-slate-100 !text-slate-900 !border-slate-300 font-mono text-center tracking-widest"
                        dir="ltr"
                        maxLength={6}
                        placeholder="000000"
                        value={enrollCode}
                        onChange={(e) => setEnrollCode(e.target.value)}
                        required
                      />
                      <button type="submit" disabled={enrollBusy} className="btn btn-p shrink-0">
                        {enrollBusy ? '...' : 'تفعيل'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
            <div className="glass rounded-2xl p-5">
              <h3 className="font-bold text-[#0F172A] mb-3">الصلاحيات</h3>
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="text-start p-2">الدور</th>
                    <th>المحلات</th>
                    <th>المدفوعات</th>
                    <th>الإعدادات</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(adminCfg.perms).map(([roleName, vals]) => (
                    <tr key={roleName} className="border-t border-slate-100">
                      <td className="p-2 font-bold">{roleName}</td>
                      {vals.map((v, i) => (
                        <td key={i} className="text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setAdminCfg((prev) => ({
                                ...prev,
                                perms: {
                                  ...prev.perms,
                                  [roleName]: prev.perms[roleName].map((old, idx) => (idx === i ? !old : old)),
                                },
                              }))
                            }
                            className={
                              'w-7 h-7 rounded-lg inline-flex items-center justify-center cursor-pointer ' +
                              (v ? 'b-acc' : 'bg-[#F8F9FA] border border-[#E2E8F0] text-slate-400')
                            }
                          >
                            {v ? <I n="check" s={15} /> : <I n="lock" s={13} />}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="btn btn-p mt-4"
                onClick={async () => {
                  await logAudit('تحديث الصلاحيات', 'تم حفظ مصفوفة صلاحيات الإدارة');
                  toast('تم حفظ الصلاحيات ✓');
                }}
              >
                حفظ
              </button>
            </div>
          </div>

          <div className="glass rounded-2xl p-5">
            <h3 className="font-bold text-[#0F172A] mb-3">سجل العمليات الحساسة (Audit Log)</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] gap-3">
                  <div>
                    <b className="text-[#0284C7]">{log.action}</b> — <span>{log.details}</span>
                  </div>
                  <span className="text-slate-500 whitespace-nowrap">{log.createdAt}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {sec === 'lenses' && <AdminLensMatrixManager />}
    </Shell>
  );
}
