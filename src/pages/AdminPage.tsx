import React, { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { getShopDaysLeft, useOptiVerse } from '../services/optiverseStore';
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
  stBadge,
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
    plans,
    setPlans,
    savePlan,
    payments,
    auditLogs,
    logAudit,
    exportFullBackup,
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

  const [sec, setSec] = useState('over');
  const [range, setRange] = useState<6 | 12>(6);
  const [q, setQ] = useState('');
  const [flt, setFlt] = useState('all');

  useEffect(() => {
    try {
      localStorage.setItem(ADMIN_SETTINGS_KEY, JSON.stringify(adminCfg));
    } catch {
      // ignore
    }
  }, [adminCfg]);

  useEffect(() => {
    if (!supabase || session?.role !== 'admin') return;
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
        role: 'admin',
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
    if (res.role !== 'admin') {
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
  if (!session || session.role !== 'admin' || session.mfaVerified === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
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
              {authErr && <div className="text-xs text-rose-300">{authErr}</div>}
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
        s.slug.toLowerCase().includes(searchLower))
  );

  const collectedTotal = payments.filter((p) => p.status === 'ok').reduce((sum, p) => sum + p.amount, 0);
  const pendingTotal = payments.filter((p) => p.status === 'wait').reduce((sum, p) => sum + p.amount, 0);
  const lateTotal = payments.filter((p) => p.status === 'late').reduce((sum, p) => sum + p.amount, 0);

  const Table = ({ list }: { list: typeof shops }) => (
    <div className="glass rounded-2xl overflow-x-auto">
      <table className="w-full text-sm min-w-[920px]">
        <thead className="text-xs text-slate-500">
          <tr className="border-b border-[#E2E8F0]">
            {['اسم المحل', 'صاحب المحل', 'الباقة', 'حالة الاشتراك', 'تاريخ الانتهاء', 'رابط متجر المحل', 'إجراءات'].map((h) => (
              <th key={h} className="p-3 text-start font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((s) => {
            const dLeft = getShopDaysLeft(s);
            const shopPath = `/shop/${s.slug}`;
            return (
              <tr key={s.id} className="border-b border-slate-100 hover:bg-[#F8F9FA] align-top">
                <td className="p-3">
                  <div className="font-bold">{s.name}</div>
                  <div className="text-xs opacity-60">{s.city}</div>
                </td>
                <td className="p-3">
                  <div className="font-semibold text-xs">{s.ownerName || 'غير محدد'}</div>
                  {s.ownerEmail && (
                    <div className="text-[.7rem] opacity-60 font-mono" dir="ltr" style={{ textAlign: 'start' }}>
                      {s.ownerEmail}
                    </div>
                  )}
                </td>
                <td className="p-3">
                  <span className={'badge ' + (s.plan === 'احترافية' ? 'b-acc' : 'b-info')}>{s.plan}</span>
                  <div className="text-[.7rem] opacity-60 mt-1 tabular-nums">{s.price} ج.م/ش</div>
                </td>
                <td className="p-3">{stBadge(s.status)}</td>
                <td className="p-3 opacity-85 tabular-nums whitespace-nowrap">
                  <div>{s.exp}</div>
                  <div className="text-xs opacity-60">({dLeft} يوم)</div>
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
                        <I n="check" s={13} /> تفعيل الاشتراك
                      </button>
                    )}
                    <button className="btn btn-g btn-sm" onClick={() => setModal({ t: 'renew', s })}>
                      <I n="refresh" s={13} /> تجديد
                    </button>
                    <button className="btn btn-g btn-sm" onClick={() => setModal({ t: 'editplan', s })}>
                      <I n="edit" s={13} /> الباقة
                    </button>
                    <button className="btn btn-g btn-sm" onClick={() => setModal({ t: 'addpayment', s })}>
                      <I n="receipt" s={13} /> تسجيل دفع
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
                      {s.status === 'paused' ? 'استئناف' : 'إيقاف مؤقت'}
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
      headerAction={
        <button className="btn btn-d btn-sm whitespace-nowrap shrink-0" title="تسجيل الخروج" onClick={signOut}>
          <I n="logout" s={14} /> تسجيل الخروج
        </button>
      }
    >
      {sec === 'over' && (
        <>
          <Head t="نظرة عامة والإيرادات" sub="لوحة مالك منصة OptiVerse">
            <button className="btn btn-g" onClick={() => setModal({ t: 'addpayment' })}>
              <I n="receipt" s={16} /> تسجيل عملية دفع
            </button>
            <button className="btn btn-p" onClick={() => setModal('addshop')}>
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
              label="الفترة التجريبية 14 يوماً"
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
              {plans.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] mb-2.5">
                  <div>
                    <div className="font-bold text-sm">{p.name}</div>
                    <div className="text-xs opacity-70">
                      <Egp v={p.price} /> / شهر
                    </div>
                  </div>
                  <Switch
                    on={p.on}
                    onChange={async (v) => {
                      await savePlan({ ...p, on: v });
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
                placeholder="ابحث باسم المحل أو المالك أو البريد..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <span className="absolute top-1/2 -translate-y-1/2 start-3 opacity-50">
                <I n="search" s={16} />
              </span>
            </div>
            {[
              ['all', 'الكل'],
              ['trial', 'تجريبي 14 يوماً'],
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
          <Head t="الباقات والاشتراكات" sub="عدّل الأسعار وفعّل الباقات" />
          <div className="grid md:grid-cols-2 gap-4">
            {plans.map((p) => (
              <div key={p.id} className="glass rounded-2xl p-5">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-extrabold text-lg">{p.name}</h3>
                    <span className="text-xs opacity-60">
                      {shops.filter((s) => s.plan === (p.id === 1 ? 'أساسية' : 'احترافية')).length} مشترك
                    </span>
                  </div>
                  <Switch
                    on={p.on}
                    onChange={async (v) => {
                      await savePlan({ ...p, on: v });
                      toast(v ? `تم تفعيل ${p.name}` : `تم إيقاف ${p.name}`);
                    }}
                  />
                </div>
                <label className="text-xs opacity-60">السعر الشهري (ج.م)</label>
                <input
                  className="inp my-2"
                  type="number"
                  value={p.price}
                  onChange={(e) => setPlans((a) => a.map((x) => (x.id === p.id ? { ...x, price: +e.target.value } : x)))}
                />
                <ul className="text-sm space-y-1.5 mt-3 opacity-85">
                  {p.feats.map((f) => (
                    <li key={f} className="flex gap-2">
                      <I n="check" s={15} c="tx-acc" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  className="btn btn-p mt-4"
                  onClick={async () => {
                    await savePlan(p);
                    toast('تم حفظ تعديلات الباقة ✓');
                  }}
                >
                  حفظ التعديلات
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
          <Head t="إعدادات النظام والصلاحيات" sub="تحكم في المنصة، 2FA، النسخ الاحتياطي وسجل العمليات الحساسة">
            <button className="btn btn-p" onClick={exportFullBackup}>
              <I n="dl" s={16} /> نسخة احتياطية كاملة (JSON)
            </button>
          </Head>
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
    </Shell>
  );
}
