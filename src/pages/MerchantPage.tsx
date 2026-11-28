import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SHOP_ID, EGYPT_GOVERNORATES, STORE_THEMES, resolveStoreTheme } from '../data/seed';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  getShopDaysLeft,
  getShopMaxProducts,
  getShopPlanCapabilities,
  isAdminRole,
  isShopExpiredOrPaused,
  useOptiVerse,
} from '../services/optiverseStore';
import { CrmCustomer, Inquiry, OrderStage, Product } from '../types';
import {
  ArabicEmptyState,
  AsyncErrorBanner,
  ListCardsSkeleton,
  LoadMoreBar,
  PageSuspendFallback,
  ProductGridSkeleton,
} from '../components/AsyncStateViews';
import { ExamThumb, MiniGlasses } from '../components/GlassesGraphics';
import { I } from '../components/Icons';
import { MerchantLensMatrixManager } from '../components/MerchantLensMatrixManager';
import { PWAInstallButton } from '../components/PWAInstallPrompt';
import { useDebouncedValue } from '../utils/queryCache';
import { resolveAngled45Url, resolveStoreFrontUrl } from '../utils/bulkFrameProcessor';

const BulkFrameUploader = lazy(() =>
  import('../components/BulkFrameUploader').then((m) => ({ default: m.BulkFrameUploader }))
);
const VipInStoreConsultantModal = lazy(() =>
  import('../components/VipInStoreConsultantModal').then((m) => ({ default: m.VipInStoreConsultantModal }))
);
import { formatOpticalDimensions, resolveProductOpticalDimensions } from '../utils/opticalDimensions';
import {
  ScannedLedgerCustomer,
  encodeCompactUploadBase64,
  scanPaperLedgerViaServer,
} from '../utils/splitSheetApi';
import {
  ReminderTypeKey,
  buildReminderWhatsAppMessage,
  dispatchDueRemindersNotification,
  evaluateCustomerReminders,
  isCustomerContactLenses,
} from '../utils/crmReminders';
import {
  ANALYTICS_UPDATED_EVENT,
  ShopLiveAnalyticsSummary,
  fetchShopLiveAnalytics,
  getLocalShopLiveAnalytics,
} from '../utils/storeAnalytics';
import {
  D,
  Egp,
  Head,
  Modal,
  Pr,
  QR,
  STAGES,
  Shell,
  ShellNavItem,
  Switch,
  dlCsv,
  fmt,
  qBadge,
  waNum,
} from '../components/UiShared';

const MERCHANT_PAGE_SIZE = 24;

type MerchantSection = 'home' | 'prods' | 'crm' | 'store';

function normalizeMerchantSection(raw?: string): MerchantSection {
  if (raw === 'prods' || raw === 'inventory') return 'prods';
  if (raw === 'crm' || raw === 'inq') return 'crm';
  if (raw === 'store' || raw === 'sub' || raw === 'delivery' || raw === 'lens' || raw === 'lens_teaser') {
    return 'store';
  }
  return 'home';
}

function toLatinDigits(val: string): string {
  return val
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function normalizePhoneLookup(raw?: string): string {
  if (!raw) return '';
  let d = toLatinDigits(raw).replace(/\D/g, '');
  if (d.startsWith('0020')) d = '0' + d.slice(4);
  else if (d.startsWith('20') && d.length >= 12) d = '0' + d.slice(2);
  else if (/^1[0125]\d{8}$/.test(d)) d = '0' + d;
  return d;
}

function buildEgyptianProductAd(opts: {
  shopName: string;
  city?: string;
  product: Product;
  tryCamLink: string;
  tone: 'catchy' | 'offer' | 'optical';
}): string {
  const { shopName, city, product, tryCamLink, tone } = opts;
  const finalP = D(product);
  const priceTxt = `${fmt(finalP.price)} ج.م`;
  const hasDisc = Boolean((product.disc && product.disc > 0) || (product.salePrice && product.salePrice > 0 && product.salePrice < product.price));
  const oldPriceTxt = hasDisc ? ` (بدلاً من ${fmt(product.price)} ج.م)` : '';
  const dims = formatOpticalDimensions(resolveProductOpticalDimensions(product));
  const loc = city ? ` في ${city}` : '';
  const isSun = product.cat === 'sun' || product.frameType === 'sunglasses';
  const kindEmoji = isSun ? '🕶️' : '👓';

  if (tone === 'offer') {
    return [
      `🔥 عرض خاص من ${shopName}${loc}!`,
      `${kindEmoji} نظارة ${product.name}${product.modelCode || product.code ? ` (${product.modelCode || product.code})` : ''} دلوقتي بسعر ${priceTxt}${oldPriceTxt}!`,
      `✨ مش متأكد هتليق على وشك ولا لأ؟ افتح الكاميرا من اللينك ده وجرّبها لايف 3D على وشك في ثواني قبل ما تطلب 👇`,
      tryCamLink,
      `📩 احجزها فوراً أو زورنا${loc} قبل نفاد الكمية!`,
    ].join('\n\n');
  }

  if (tone === 'optical') {
    return [
      `${kindEmoji} أناقة وراحة عينك تبدأ من ${shopName}${loc}`,
      `موديل ${product.name} — خامة متينة وتصميم مريح للّبس اليومي (مقاس بصري ${dims} mm) بسعر ${priceTxt}.`,
      `📱 جرّب النظارة على وشك دلوقتي بالكاميرا 3D بمقياس حقيقي 1:1 من بيتك عبر الرابط المباشر 👇`,
      tryCamLink,
      `تقدر كمان تبعتلنا صورة الكشف الطبي ونجهزلك العدسات المناسبة في أسرع وقت ✅`,
    ].join('\n\n');
  }

  return [
    `لو بتدور على ${isSun ? 'نظارة شمس تخطف الأنظار' : 'نظارة شيك تليق على وشك'}.. دي اتعملت عشانك! ${kindEmoji}✨`,
    `موديل ${product.name} من ${shopName}${loc} متاح دلوقتي بسعر ${priceTxt}${oldPriceTxt}.`,
    `🤳 بدل ما تحتار.. دوس على اللينك وجرّبها على وشك فوراً بالكاميرا 3D وشوف شكلها عليك لايف قبل ما تشتري 👇`,
    tryCamLink,
  ].join('\n\n');
}

function mapCreateMyShopError(rawMsg?: string): string {
  const msg = String(rawMsg || '').toUpperCase();
  if (msg.includes('INVALID_SHOP_NAME')) {
    return 'اسم المحل غير صالح (يجب أن يكون بين حرفين و80 حرفاً)';
  }
  if (msg.includes('INVALID_PHONE')) {
    return 'رقم الموبايل غير صالح (يجب أن يكون من 10 إلى 15 رقماً)';
  }
  if (msg.includes('ADMIN_CANNOT_CREATE_SHOP')) {
    return 'لا يمكن لحساب الإدارة إنشاء متجر تاجر';
  }
  if (msg.includes('NOT_AUTHENTICATED')) {
    return 'انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى';
  }
  return 'تعذّر حفظ بيانات المحل، يرجى المحاولة مرة أخرى';
}

export function MerchantPage() {
  const {
    route,
    session,
    setSession,
    authLoading,
    signInUnified,
    signInWithGoogle,
    signInWithApple,
    signInWithPhoneOtp,
    registerMerchant,
    signOut,
    platformSettings,
    activeShop,
    userHasShop,
    refreshUserSessionAndShop,
    updateShop,
    addTopUpCredits,
    products,
    updateProductStock,
    softDeleteProductByCode,
    inq,
    addInquiry,
    updateInquiry,
    crmCustomers,
    addCrmCustomer,
    markCrmRecallSent,
    toast,
    setModal,
    navigate,
    getAccessToken,
    uploadAssetToStorage,
    fetchMerchantProductsPage,
    fetchMerchantInquiriesPage,
    fetchMerchantCrmPage,
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
  const [obWa, setObWa] = useState('');
  const [obShopName, setObShopName] = useState('');
  const [obGov, setObGov] = useState('القاهرة');
  const [submittingOnboarding, setSubmittingOnboarding] = useState(false);
  const [obError, setObError] = useState<string | null>(null);

  // CRM add customer form state
  const [crmName, setCrmName] = useState('');
  const [crmPhone, setCrmPhone] = useState('');
  const [crmProdName, setCrmProdName] = useState('');
  const [crmPd, setCrmPd] = useState('');
  const [crmPrice, setCrmPrice] = useState('');
  const [crmNotes, setCrmNotes] = useState('');

  const merchantStorageKey = `optiverse_merchant_state_${activeShop?.id || 'default'}`;
  const initialMerchantState = (() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.sessionStorage.getItem(merchantStorageKey);
      return raw ? (JSON.parse(raw) as { sec?: string; invFilter?: string }) : {};
    } catch {
      return {};
    }
  })();

  const [sec, setSec] = useState<MerchantSection>(() => normalizeMerchantSection(initialMerchantState.sec));
  const [code, setCode] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  const [crmView, setCrmView] = useState<'all' | 'orders' | 'customers'>('all');
  const [crmSearch, setCrmSearch] = useState('');
  const [ledgerScanning, setLedgerScanning] = useState(false);
  const [scannedLedgerRows, setScannedLedgerRows] = useState<ScannedLedgerCustomer[]>([]);
  const [savingScannedRows, setSavingScannedRows] = useState(false);
  const [adModalProduct, setAdModalProduct] = useState<Product | null>(null);
  const [adTone, setAdTone] = useState<'catchy' | 'offer' | 'optical'>('catchy');
  const [adDraftText, setAdDraftText] = useState('');
  const [showAdvancedStoreSettings, setShowAdvancedStoreSettings] = useState(false);
  const [aiLogoBusy, setAiLogoBusy] = useState(false);
  const [hasVisitedProds, setHasVisitedProds] = useState(() => sec === 'prods');
  const [invFilter, setInvFilter] = useState<'all' | 'in_stock' | 'low' | 'out'>(() => {
    const f = initialMerchantState.invFilter;
    return f === 'in_stock' || f === 'low' || f === 'out' ? f : 'all';
  });
  const [supplierReportOpen, setSupplierReportOpen] = useState(false);
  const [newCollectionSignal, setNewCollectionSignal] = useState(0);
  const [vipModeOpen, setVipModeOpen] = useState(false);
  const qrWrapRef = useRef<HTMLDivElement | null>(null);

  const debouncedProdSearch = useDebouncedValue(prodSearch, 300);
  const debouncedCrmSearch = useDebouncedValue(crmSearch, 300);

  // Server-paginated Products state (24 per page)
  const [pagedProds, setPagedProds] = useState<Product[]>([]);
  const [prodsPage, setProdsPage] = useState(0);
  const [prodsTotalCount, setProdsTotalCount] = useState<number | null>(null);
  const [prodsHasMore, setProdsHasMore] = useState(false);
  const [prodsLoading, setProdsLoading] = useState(false);
  const [prodsLoadingMore, setProdsLoadingMore] = useState(false);
  const [prodsError, setProdsError] = useState<string | null>(null);
  const [prodsRetryNonce, setProdsRetryNonce] = useState(0);

  // Server-paginated Inquiries & CRM state (25 per page)
  const [pagedInq, setPagedInq] = useState<Inquiry[]>([]);
  const [inqPage, setInqPage] = useState(0);
  const [inqTotalCount, setInqTotalCount] = useState<number | null>(null);
  const [inqHasMore, setInqHasMore] = useState(false);
  const [inqLoading, setInqLoading] = useState(false);
  const [inqLoadingMore, setInqLoadingMore] = useState(false);
  const [inqError, setInqError] = useState<string | null>(null);

  const [pagedCrm, setPagedCrm] = useState<CrmCustomer[]>([]);
  const [crmPage, setCrmPage] = useState(0);
  const [crmTotalCount, setCrmTotalCount] = useState<number | null>(null);
  const [crmHasMore, setCrmHasMore] = useState(false);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmLoadingMore, setCrmLoadingMore] = useState(false);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [crmRetryNonce, setCrmRetryNonce] = useState(0);

  useEffect(() => {
    if (sec === 'prods') setHasVisitedProds(true);
  }, [sec]);

  const [liveStats, setLiveStats] = useState<ShopLiveAnalyticsSummary>(() =>
    activeShop?.id
      ? getLocalShopLiveAnalytics(
          activeShop.id,
          products.filter((p) => p.shopId === activeShop.id && !p.isDeleted)
        )
      : {
          todayVisits: 0,
          totalVisits: 0,
          todayTryons: 0,
          totalTryons: 0,
          todayShares: 0,
          totalShares: 0,
          topTriedFrameToday: null,
        }
  );
  const [statsRefreshing, setStatsRefreshing] = useState(false);

  const refreshLiveStats = useCallback(async () => {
    if (!activeShop?.id) return;
    setStatsRefreshing(true);
    try {
      const scoped = products.filter((p) => p.shopId === activeShop.id && !p.isDeleted);
      const summary = await fetchShopLiveAnalytics(activeShop.id, scoped);
      setLiveStats(summary);
    } finally {
      setStatsRefreshing(false);
    }
  }, [activeShop?.id, products]);

  useEffect(() => {
    void refreshLiveStats();
  }, [refreshLiveStats, sec]);

  useEffect(() => {
    if (typeof window === 'undefined' || !activeShop?.id) return;
    const onUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<{ shopId?: string }>).detail;
      if (!detail?.shopId || detail.shopId === activeShop.id) {
        void refreshLiveStats();
      }
    };
    window.addEventListener(ANALYTICS_UPDATED_EVENT, onUpdated);
    window.addEventListener('storage', onUpdated);
    return () => {
      window.removeEventListener(ANALYTICS_UPDATED_EVENT, onUpdated);
      window.removeEventListener('storage', onUpdated);
    };
  }, [activeShop?.id, refreshLiveStats]);

  useEffect(() => {
    const shopId = activeShop?.id;
    if (!shopId || sec !== 'prods') return;
    let cancelled = false;
    setProdsLoading(true);
    setProdsError(null);
    fetchMerchantProductsPage({
      shopId,
      page: 0,
      pageSize: MERCHANT_PAGE_SIZE,
      search: debouncedProdSearch,
      invFilter,
    })
      .then((res) => {
        if (cancelled) return;
        setPagedProds(res.rows);
        setProdsPage(0);
        setProdsTotalCount(res.totalCount);
        setProdsHasMore(res.hasMore);
      })
      .catch((err) => {
        if (cancelled) return;
        setProdsError(err instanceof Error ? err.message : 'تعذّر تحميل النظارات');
      })
      .finally(() => {
        if (!cancelled) setProdsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeShop?.id, sec, debouncedProdSearch, invFilter, prodsRetryNonce, fetchMerchantProductsPage]);

  const loadMoreMerchantProds = useCallback(async () => {
    if (!activeShop?.id || prodsLoadingMore || !prodsHasMore) return;
    const nextPage = prodsPage + 1;
    setProdsLoadingMore(true);
    setProdsError(null);
    try {
      const res = await fetchMerchantProductsPage({
        shopId: activeShop.id,
        page: nextPage,
        pageSize: MERCHANT_PAGE_SIZE,
        search: debouncedProdSearch,
        invFilter,
      });
      setPagedProds((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const r of res.rows) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            merged.push(r);
          }
        }
        return merged;
      });
      setProdsPage(nextPage);
      setProdsHasMore(res.hasMore);
    } catch (err) {
      setProdsError(err instanceof Error ? err.message : 'تعذّر تحميل المزيد');
    } finally {
      setProdsLoadingMore(false);
    }
  }, [activeShop?.id, prodsLoadingMore, prodsHasMore, prodsPage, debouncedProdSearch, invFilter, fetchMerchantProductsPage]);

  useEffect(() => {
    const shopId = activeShop?.id;
    if (!shopId || sec !== 'crm') return;
    let cancelled = false;
    setInqLoading(true);
    setCrmLoading(true);
    setInqError(null);
    setCrmError(null);

    fetchMerchantInquiriesPage({
      shopId,
      page: 0,
      pageSize: 25,
      search: debouncedCrmSearch,
    })
      .then((res) => {
        if (cancelled) return;
        setPagedInq(res.rows);
        setInqPage(0);
        setInqTotalCount(res.totalCount);
        setInqHasMore(res.hasMore);
      })
      .catch((err) => {
        if (cancelled) return;
        setInqError(err instanceof Error ? err.message : 'تعذّر تحميل الطلبات');
      })
      .finally(() => {
        if (!cancelled) setInqLoading(false);
      });

    fetchMerchantCrmPage({
      shopId,
      page: 0,
      pageSize: 25,
      search: debouncedCrmSearch,
    })
      .then((res) => {
        if (cancelled) return;
        setPagedCrm(res.rows);
        setCrmPage(0);
        setCrmTotalCount(res.totalCount);
        setCrmHasMore(res.hasMore);
      })
      .catch((err) => {
        if (cancelled) return;
        setCrmError(err instanceof Error ? err.message : 'تعذّر تحميل سجل العملاء');
      })
      .finally(() => {
        if (!cancelled) setCrmLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeShop?.id, sec, debouncedCrmSearch, crmRetryNonce, fetchMerchantInquiriesPage, fetchMerchantCrmPage]);

  const loadMoreMerchantInq = useCallback(async () => {
    if (!activeShop?.id || inqLoadingMore || !inqHasMore) return;
    const nextPage = inqPage + 1;
    setInqLoadingMore(true);
    try {
      const res = await fetchMerchantInquiriesPage({
        shopId: activeShop.id,
        page: nextPage,
        pageSize: 25,
        search: debouncedCrmSearch,
      });
      setPagedInq((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const r of res.rows) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            merged.push(r);
          }
        }
        return merged;
      });
      setInqPage(nextPage);
      setInqHasMore(res.hasMore);
    } catch (err) {
      setInqError(err instanceof Error ? err.message : 'تعذّر تحميل المزيد من الطلبات');
    } finally {
      setInqLoadingMore(false);
    }
  }, [activeShop?.id, inqLoadingMore, inqHasMore, inqPage, debouncedCrmSearch, fetchMerchantInquiriesPage]);

  const loadMoreMerchantCrm = useCallback(async () => {
    if (!activeShop?.id || crmLoadingMore || !crmHasMore) return;
    const nextPage = crmPage + 1;
    setCrmLoadingMore(true);
    try {
      const res = await fetchMerchantCrmPage({
        shopId: activeShop.id,
        page: nextPage,
        pageSize: 25,
        search: debouncedCrmSearch,
      });
      setPagedCrm((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const r of res.rows) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            merged.push(r);
          }
        }
        return merged;
      });
      setCrmPage(nextPage);
      setCrmHasMore(res.hasMore);
    } catch (err) {
      setCrmError(err instanceof Error ? err.message : 'تعذّر تحميل المزيد من العملاء');
    } finally {
      setCrmLoadingMore(false);
    }
  }, [activeShop?.id, crmLoadingMore, crmHasMore, crmPage, debouncedCrmSearch, fetchMerchantCrmPage]);

  useEffect(() => {
    if (typeof window === 'undefined' || !activeShop?.id) return;
    try {
      window.sessionStorage.setItem(merchantStorageKey, JSON.stringify({ sec, invFilter }));
    } catch {
      // ignore storage errors
    }
  }, [merchantStorageKey, activeShop?.id, sec, invFilter]);

  useEffect(() => {
    if (!activeShop || !activeShop.id) return;
    setObWa(activeShop.wa || '');
    const isPlaceholderShopName =
      !activeShop.onboardingCompleted &&
      (!activeShop.name ||
        activeShop.name.trim() === 'متجر جديد' ||
        (activeShop.ownerName && activeShop.name.trim() === `متجر ${activeShop.ownerName.trim()}`));
    setObShopName(isPlaceholderShopName ? '' : activeShop.name || '');
    setObGov(activeShop.governorate || activeShop.city || 'القاهرة');
  }, [activeShop?.id]);

  // Never allow Super Admin / Admin accounts to get stuck in Merchant Dashboard or Onboarding
  useEffect(() => {
    if (!authLoading && session && isAdminRole(session.role) && !activeShop?.isDemoAdminStore) {
      navigate('/admin');
    }
  }, [authLoading, session, activeShop?.isDemoAdminStore, navigate]);

  // Block direct access to preview or VIP assistant when shop status is pending
  useEffect(() => {
    if (!activeShop?.id || activeShop.status !== 'pending') return;
    const curUrl =
      typeof window !== 'undefined' ? window.location.pathname + window.location.search : route;
    const lower = curUrl.toLowerCase();
    if (
      vipModeOpen ||
      lower.includes('preview=merchant') ||
      lower.includes('/preview') ||
      lower.includes('/vip') ||
      lower.includes('vip=1') ||
      lower.includes('mode=vip')
    ) {
      setVipModeOpen(false);
      toast('المتجر غير مفعّل حتى تأكيد الإدارة');
      navigate('/');
    }
  }, [activeShop?.id, activeShop?.status, vipModeOpen, route, navigate, toast]);

  // Dispatch Service Worker notifications strictly for today's due CRM reminders (never for chats/orders)
  useEffect(() => {
    if (!session || !activeShop?.id || !activeShop.reminderNotificationsEnabled) return;
    if (isAdminRole(session.role) && !activeShop.isDemoAdminStore) return;
    const due = crmCustomers.filter(
      (c) => c.shopId === activeShop.id && evaluateCustomerReminders(c).hasAnyDue
    );
    if (due.length > 0) {
      void dispatchDueRemindersNotification(activeShop.id, activeShop.name, due);
    }
  }, [
    session,
    activeShop?.id,
    activeShop?.name,
    activeShop?.reminderNotificationsEnabled,
    activeShop?.isDemoAdminStore,
    crmCustomers,
  ]);

  useEffect(() => {
    if (!adModalProduct || !activeShop) return;
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://optiverse.app';
    const tryCamLink = `${baseOrigin}/s/${activeShop.slug}?try=${adModalProduct.id}`;
    setAdDraftText(
      buildEgyptianProductAd({
        shopName: activeShop.name,
        city: activeShop.governorate || activeShop.city,
        product: adModalProduct,
        tryCamLink,
        tone: adTone,
      })
    );
  }, [adModalProduct, adTone, activeShop?.id, activeShop?.name, activeShop?.slug, activeShop?.governorate, activeShop?.city]);

  if (authLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6 text-sm opacity-75">
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
      const trimmedShop = shopName.trim();
      if (trimmedShop.length < 2 || trimmedShop.length > 80) {
        setAuthErr('اسم المحل يجب أن يكون بين حرفين و80 حرفاً');
        return;
      }
      const normalizedWa = toLatinDigits(waPhone.trim()).replace(/\D/g, '');
      if (!/^\d{10,15}$/.test(normalizedWa)) {
        setAuthErr('يرجى إدخال رقم موبايل/واتساب صحيح من 10 إلى 15 رقماً');
        return;
      }
      setSubmitting(true);
      const res = await registerMerchant({
        email: email.trim(),
        password,
        ownerName: ownerName.trim() || undefined,
        shopName: trimmedShop,
        wa: normalizedWa,
        city: city.trim() || 'القاهرة',
      });
      setSubmitting(false);
      if (!res.ok) {
        setAuthErr(res.error || 'تعذر إنشاء المتجر');
        return;
      }
      if (res.error) {
        toast(res.error);
      } else {
        toast('تم إنشاء متجرك بنجاح 🎉');
      }
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
      <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-[#F8F9FA]">
        <div className="glass rounded-3xl p-5 sm:p-8 w-full max-w-md space-y-5 fade">
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
                'min-h-[44px] flex items-center justify-center py-2 px-1 rounded-lg text-xs font-bold cursor-pointer transition ' +
                (authMode === 'login' ? 'bg-[#0F172A] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]')
              }
            >
              دخول
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('signup')}
              className={
                'min-h-[44px] flex items-center justify-center py-2 px-1 rounded-lg text-xs font-bold cursor-pointer transition ' +
                (authMode === 'signup' ? 'bg-[#D97706] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]')
              }
            >
              تجربة 14 يوماً
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('phone')}
              className={
                'min-h-[44px] flex items-center justify-center py-2 px-1 rounded-lg text-xs font-bold cursor-pointer transition ' +
                (authMode === 'phone' ? 'bg-[#0284C7] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]')
              }
            >
              برقم الموبايل
            </button>
          </div>

          {!isSupabaseConfigured && (
            <div className="rounded-xl p-3 bg-sky-50 border border-sky-200 text-xs leading-6 text-[#0284C7] space-y-2.5">
              <div>
                وضع المعاينة التفاعلية نشط. عند ربط <code className="font-mono font-bold">VITE_SUPABASE_URL</code> و{' '}
                <code className="font-mono font-bold">VITE_SUPABASE_ANON_KEY</code> يتم التفعيل الكامل مع Supabase Auth
                (Google · Apple · OTP).
              </div>
              <button
                type="button"
                onClick={() => {
                  setSession({
                    userId: 'preview-merchant',
                    email: activeShop.ownerEmail || 'preview@optiverse.local',
                    role: 'merchant',
                    shopId: activeShop.id,
                  });
                  toast('تم فتح لوحة التاجر ومعالجة الصور في وضع المعاينة ✨');
                }}
                className="w-full min-h-[44px] py-2.5 px-3 rounded-lg bg-[#0284C7] hover:bg-[#0369A1] text-white font-extrabold text-xs cursor-pointer transition shadow-xs"
              >
                دخول فوري لمعالجة الصور ولوحة التاجر (وضع المعاينة بدون تسجيل) ✨
              </button>
            </div>
          )}

          {authMode !== 'phone' && (
            <>
              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleGoogle}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-white border border-[#E2E8F0] text-[#0F172A] font-bold text-sm hover:bg-slate-50 transition cursor-pointer shadow-xs"
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
                  className="w-full min-h-[44px] flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-[#0F172A] text-white font-bold text-sm hover:bg-slate-800 transition cursor-pointer"
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

  // Mandatory Merchant Onboarding Gate: shown when user has no shop and is not an Admin
  if (!isAdminRole(session.role) && !activeShop?.isDemoAdminStore && !userHasShop) {
    const handleCompleteOnboarding = async (e: React.FormEvent) => {
      e.preventDefault();
      if (submittingOnboarding) return;
      setObError(null);

      const trimmedName = obShopName.trim();
      if (trimmedName.length < 2 || trimmedName.length > 80) {
        const msg = 'اسم المحل التجاري يجب أن يكون بين حرفين و80 حرفاً';
        setObError(msg);
        toast(msg);
        return;
      }

      const normalizedPhone = toLatinDigits(obWa.trim()).replace(/\D/g, '');
      if (!/^\d{10,15}$/.test(normalizedPhone)) {
        const msg = 'يرجى إدخال رقم موبايل/واتساب صحيح من 10 إلى 15 رقماً';
        setObError(msg);
        toast(msg);
        return;
      }

      const trimmedGov = obGov.trim();
      if (!trimmedGov) {
        const msg = 'يرجى اختيار المحافظة';
        setObError(msg);
        toast(msg);
        return;
      }

      setSubmittingOnboarding(true);
      try {
        if (!supabase) {
          setObError('تعذّر الاتصال بقاعدة البيانات، يرجى المحاولة لاحقاً');
          return;
        }

        const { error } = await supabase.rpc('create_my_shop', {
          p_name: trimmedName,
          p_phone: normalizedPhone,
          p_governorate: trimmedGov,
        });

        if (error) {
          console.error('[create_my_shop] RPC error:', error);
          const friendly = mapCreateMyShopError(error.message);
          setObError(friendly);
          toast(friendly);
          return;
        }

        const loadedShop = await refreshUserSessionAndShop();
        if (!loadedShop) {
          console.error('[create_my_shop] Shop created but could not be reloaded for current user');
          const msg = 'تم إنشاء المحل، يرجى إعادة تحميل الصفحة للدخول للوحة التحكم';
          setObError(msg);
          toast(msg);
          return;
        }

        toast('تم تسجيل بيانات محلك بنجاح 🎉');
        navigate('/merchant');
      } catch (err: any) {
        console.error('[create_my_shop] unexpected error:', err);
        const friendly = mapCreateMyShopError(err?.message);
        setObError(friendly);
        toast(friendly);
      } finally {
        setSubmittingOnboarding(false);
      }
    };

    return (
      <div dir="rtl" className="min-h-[100dvh] flex items-center justify-center p-4 bg-[#F8F9FA]">
        <div className="glass rounded-3xl p-5 sm:p-8 w-full max-w-lg space-y-5 fade">
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

          <form onSubmit={handleCompleteOnboarding} className="space-y-3.5">
            <div>
              <label className="text-xs font-bold text-slate-700">اسم المحل التجاري *</label>
              <input
                type="text"
                dir="rtl"
                autoComplete="organization"
                minLength={2}
                maxLength={80}
                className="inp mt-1 text-right"
                placeholder="مثال: بصريات النور"
                value={obShopName}
                onChange={(e) => {
                  setObShopName(e.target.value);
                  if (obError) setObError(null);
                }}
                required
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700">رقم الموبايل / واتساب الطلبات *</label>
                <input
                  type="tel"
                  inputMode="tel"
                  className="inp mt-1"
                  dir="ltr"
                  placeholder="010xxxxxxxxx"
                  value={obWa}
                  onChange={(e) => {
                    setObWa(e.target.value);
                    if (obError) setObError(null);
                  }}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">المحافظة *</label>
                <select
                  className="inp mt-1"
                  value={obGov}
                  onChange={(e) => {
                    setObGov(e.target.value);
                    if (obError) setObError(null);
                  }}
                  required
                >
                  {EGYPT_GOVERNORATES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {obError && (
              <div className="rounded-xl p-3 bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                {obError}
              </div>
            )}

            <button
              type="submit"
              disabled={submittingOnboarding}
              className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white w-full !py-3 font-extrabold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {submittingOnboarding ? 'جاري إنشاء المحل...' : 'حفظ وبدء استخدام لوحة التاجر'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Strictly scoped to activeShop.id!
  const shopProducts = products.filter((p) => p.shopId === activeShop.id && !p.isDeleted);
  const shopInq = inq.filter((q) => q.shopId === activeShop.id);
  const newCount = shopInq.filter((q) => q.status === 'new').length;
  const trialDaysLeft = getShopDaysLeft(activeShop);
  const expiredOrPaused = isShopExpiredOrPaused(activeShop);
  const isPendingShop = activeShop.status === 'pending';
  const canShowStoreAccess =
    Boolean(activeShop.isDemoAdminStore) ||
    activeShop.status === 'trial' ||
    activeShop.status === 'active' ||
    activeShop.status === 'soon';

  const rxEnabled = Boolean(
    platformSettings.enableLensesSystem ?? platformSettings.enablePrescriptionLenses
  );
  const suppliersEnabled = Boolean(platformSettings.enableSponsoredSuppliers);
  const deliveryEnabled = Boolean(activeShop.enableDeliveryService);

  const planCaps = getShopPlanCapabilities(activeShop, platformSettings);
  const maxProducts = getShopMaxProducts(activeShop, platformSettings);
  const aiLimitNum = Number(activeShop.aiCreditsLimit ?? planCaps.monthlyAiCredits ?? 110) || 110;
  const creditsCap = aiLimitNum + (Number(activeShop.topupCredits ?? 0) || 0);
  const creditsUsed = Number(activeShop.aiCreditsUsed ?? 0) || 0;
  const creditsRemaining =
    activeShop.isDemoAdminStore || aiLimitNum >= 99999
      ? 999999
      : Math.max(0, creditsCap - creditsUsed);

  // Smart Automatic CRM Reminders (Glasses: 24h, 4m, 12m | Contact Lenses: 3m or 12m if annual)
  const shopCrm = crmCustomers.filter((c) => c.shopId === activeShop.id);
  const dueCrmList = shopCrm.map((c) => ({
    ...c,
    eval: evaluateCustomerReminders(c),
  }));
  const dueTodayCustomers = dueCrmList.filter((c) => c.eval.hasAnyDue);
  const dueRecallCount = dueTodayCustomers.length;

  const delByCode = async () => {
    const res = await softDeleteProductByCode(activeShop.id, code);
    if (!res.ok) {
      toast(res.error || 'تعذر الحذف');
      return;
    }
    setCode('');
    toast(`تم حذف "${res.product?.name}" (${res.product?.code}) من الموقع فوراً ✓`);
  };

  // Smart Inventory Calculations
  const getProdStock = (p: Product) => (typeof p.stock === 'number' ? Math.max(0, Math.floor(p.stock)) : 1);
  const totalInventoryPieces = shopProducts.reduce((sum, p) => sum + getProdStock(p), 0);
  const lowStockProducts = shopProducts.filter((p) => getProdStock(p) === 1);
  const outOfStockProducts = shopProducts.filter((p) => getProdStock(p) === 0);

  const items: ShellNavItem[] = [
    ['home', 'الرئيسية', 'home'],
    ['prods', 'النظارات والمخزن', 'box', outOfStockProducts.length],
    ['crm', 'العملاء والطلبات', 'receipt', newCount + dueRecallCount],
    ['store', 'إعدادات المحل', 'store'],
  ];

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://optiverse.app';
  const link = `${origin}/?shop=${encodeURIComponent(activeShop.slug)}`;
  const copy = () => {
    navigator.clipboard
      ?.writeText(link)
      .then(() => toast('تم نسخ رابط متجر العملاء ✓'))
      .catch(() => toast('الرابط: ' + link));
  };

  const publishedProductsCount = shopProducts.filter((p) => p.isPublished !== false).length;

  const downloadQrPng = async () => {
    const svgEl = qrWrapRef.current?.querySelector('svg');
    if (!svgEl) {
      toast('تعذر إنشاء صورة QR');
      return;
    }
    try {
      if (typeof document !== 'undefined' && 'fonts' in document) {
        await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
      }

      const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
      clonedSvg.setAttribute('width', '760');
      clonedSvg.setAttribute('height', '760');
      const xml = new XMLSerializer().serializeToString(clonedSvg);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const qrSvgUrl = URL.createObjectURL(svgBlob);
      const qrImg = new Image();
      await new Promise<void>((res, rej) => {
        qrImg.onload = () => res();
        qrImg.onerror = () => rej(new Error('QR load failed'));
        qrImg.src = qrSvgUrl;
      });

      const theme = resolveStoreTheme(activeShop.themeKey, activeShop.color);
      const accentColor = theme.accent || '#0284C7';
      const goldColor = '#D97706';
      const navyColor = '#0F172A';

      // A5 Portrait Poster Ratio (148mm x 210mm -> 1480 x 2100 px)
      const W = 1480;
      const H = 2100;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;

      const drawRoundedRect = (x: number, y: number, w: number, h: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      };

      const wrapLines = (text: string, maxWidth: number): string[] => {
        const words = text.trim().split(/\s+/);
        const lines: string[] = [];
        let current = '';
        for (const word of words) {
          const test = current ? `${current} ${word}` : word;
          if (ctx.measureText(test).width <= maxWidth) {
            current = test;
          } else {
            if (current) lines.push(current);
            current = word;
          }
        }
        if (current) lines.push(current);
        return lines;
      };

      // Outer studio sheet background
      ctx.fillStyle = '#F1F5F9';
      ctx.fillRect(0, 0, W, H);

      // Subtle A5 cut border guide
      ctx.save();
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 12]);
      ctx.strokeRect(28, 28, W - 56, H - 56);
      ctx.restore();

      // Main white luxury poster card
      ctx.save();
      ctx.shadowColor = 'rgba(15, 23, 42, 0.08)';
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 14;
      drawRoundedRect(68, 68, W - 136, H - 136, 52);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();

      drawRoundedRect(68, 68, W - 136, H - 136, 52);
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Clipped top accent ribbon inside poster card
      ctx.save();
      drawRoundedRect(68, 68, W - 136, H - 136, 52);
      ctx.clip();
      const topGrad = ctx.createLinearGradient(68, 68, W - 68, 68);
      topGrad.addColorStop(0, navyColor);
      topGrad.addColorStop(0.55, accentColor);
      topGrad.addColorStop(1, goldColor);
      ctx.fillStyle = topGrad;
      ctx.fillRect(68, 68, W - 136, 30);
      ctx.restore();

      // Top Luxury Badge Pill
      const badgeW = 540;
      const badgeH = 66;
      const badgeX = (W - badgeW) / 2;
      const badgeY = 148;
      drawRoundedRect(badgeX, badgeY, badgeW, badgeH, 33);
      ctx.fillStyle = '#F0F9FF';
      ctx.fill();
      ctx.strokeStyle = '#BAE6FD';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = accentColor;
      ctx.font = '800 30px Cairo, system-ui, sans-serif';
      ctx.fillText('✨ تجربة نظارات تفاعلية 3D على الوجه', W / 2, badgeY + badgeH / 2 + 2);

      // Optional Store Logo (Image or Emoji)
      let nameStartY = 278;
      const logoVal = (activeShop.logo || '').trim();
      const isImgLogo = /^(https?:|data:image\/|blob:|\/)/i.test(logoVal);
      if (isImgLogo) {
        try {
          const logoImg = new Image();
          logoImg.crossOrigin = 'anonymous';
          await new Promise<void>((res, rej) => {
            logoImg.onload = () => res();
            logoImg.onerror = () => rej(new Error('logo failed'));
            logoImg.src = logoVal;
          });
          const lSize = 136;
          const lx = (W - lSize) / 2;
          const ly = 244;
          drawRoundedRect(lx, ly, lSize, lSize, 32);
          ctx.fillStyle = '#F8F9FA';
          ctx.fill();
          ctx.strokeStyle = '#E2E8F0';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.save();
          drawRoundedRect(lx + 10, ly + 10, lSize - 20, lSize - 20, 24);
          ctx.clip();
          const ratio = Math.min((lSize - 24) / Math.max(1, logoImg.width), (lSize - 24) / Math.max(1, logoImg.height));
          const dw = logoImg.width * ratio;
          const dh = logoImg.height * ratio;
          ctx.drawImage(logoImg, W / 2 - dw / 2, ly + lSize / 2 - dh / 2, dw, dh);
          ctx.restore();
          nameStartY = 432;
        } catch {
          nameStartY = 290;
        }
      } else if (logoVal) {
        ctx.font = '72px system-ui, sans-serif';
        ctx.fillText(logoVal, W / 2, 296);
        nameStartY = 392;
      }

      // Store Name
      ctx.fillStyle = navyColor;
      ctx.font = '800 68px Cairo, system-ui, sans-serif';
      const nameLines = wrapLines(activeShop.name, W - 240).slice(0, 2);
      nameLines.forEach((line, idx) => {
        ctx.fillText(line, W / 2, nameStartY + idx * 82);
      });

      const subY = nameStartY + (nameLines.length - 1) * 82 + 64;
      const locParts = [activeShop.governorate || activeShop.city, activeShop.address].filter(Boolean);
      if (locParts.length) {
        ctx.fillStyle = '#64748B';
        ctx.font = '600 29px Cairo, system-ui, sans-serif';
        const locText = wrapLines(locParts.join(' — '), W - 260)[0] || '';
        ctx.fillText(locText, W / 2, subY);
      }

      // Centered Crisp QR Showcase Frame
      const qrBoxSize = 860;
      const qrBoxX = (W - qrBoxSize) / 2;
      const qrBoxY = 580;
      ctx.save();
      ctx.shadowColor = 'rgba(2, 132, 199, 0.10)';
      ctx.shadowBlur = 32;
      ctx.shadowOffsetY = 10;
      drawRoundedRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 46);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();

      drawRoundedRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 46);
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Corner framing brackets around QR
      const bLen = 58;
      const pad = 26;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      const corners = [
        [qrBoxX + pad, qrBoxY + pad, 1, 1],
        [qrBoxX + qrBoxSize - pad, qrBoxY + pad, -1, 1],
        [qrBoxX + pad, qrBoxY + qrBoxSize - pad, 1, -1],
        [qrBoxX + qrBoxSize - pad, qrBoxY + qrBoxSize - pad, -1, -1],
      ] as const;
      for (const [cx, cy, sx, sy] of corners) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + sy * bLen);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + sx * bLen, cy);
        ctx.stroke();
      }

      const qrDrawSize = 720;
      const qrDrawX = (W - qrDrawSize) / 2;
      const qrDrawY = qrBoxY + (qrBoxSize - qrDrawSize) / 2;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(qrImg, qrDrawX, qrDrawY, qrDrawSize, qrDrawSize);
      ctx.restore();
      URL.revokeObjectURL(qrSvgUrl);

      // Exact Promotional Callout Box
      const ctaX = 128;
      const ctaY = 1492;
      const ctaW = W - 256;
      const ctaH = 268;
      drawRoundedRect(ctaX, ctaY, ctaW, ctaH, 36);
      ctx.fillStyle = '#F8FAFC';
      ctx.fill();
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      const promoText = `📱 امسح الكود وجرّب كل نظارات ${activeShop.name} على وجهك بالكاميرا 3D قبل ما تشتري!`;
      ctx.fillStyle = navyColor;
      ctx.font = '800 40px Cairo, system-ui, sans-serif';
      const promoLines = wrapLines(promoText, ctaW - 88);
      const promoLineHeight = 62;
      const promoBlockHeight = promoLines.length * promoLineHeight;
      const firstLineY = ctaY + (ctaH - promoBlockHeight) / 2 + promoLineHeight / 2;
      promoLines.forEach((line, idx) => {
        ctx.fillText(line, W / 2, firstLineY + idx * promoLineHeight);
      });

      // Bottom Footer Strip (Store URL & WhatsApp)
      drawRoundedRect(128, 1806, W - 256, 152, 28);
      ctx.fillStyle = navyColor;
      ctx.fill();

      ctx.direction = 'ltr';
      ctx.fillStyle = '#38BDF8';
      ctx.font = '700 28px "IBM Plex Mono", monospace';
      ctx.fillText(link, W / 2, 1858);

      ctx.direction = 'rtl';
      ctx.fillStyle = '#E2E8F0';
      ctx.font = '700 28px Cairo, system-ui, sans-serif';
      const waLine = activeShop.wa ? `واتساب الطلبات: ${activeShop.wa}  ·  A5 جاهز للطباعة` : 'A5 جاهز للطباعة على كاونتر المحل';
      ctx.fillText(waLine, W / 2, 1916);

      const pngBlob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), 'image/png', 1));
      if (!pngBlob) return;
      const pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `poster-a5-qr-${activeShop.slug}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
      toast('تم تحميل بوستر QR بحجم A5 جاهز للطباعة ✓');
    } catch {
      toast('تعذر تصدير بوستر QR');
    }
  };

  const adminRenewMsg = encodeURIComponent(
    `مرحباً إدارة OptiVerse، أرغب في تجديد اشتراك متجر "${activeShop.name}" (${activeShop.slug}) عبر InstaPay / فودافون كاش.`
  );

  const handleAddCrm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crmName.trim() || !crmPhone.trim()) {
      toast('اكتب اسم العميل ورقم الموبايل أولاً');
      return;
    }
    const parsedPrice = Number(crmPrice);
    const prodText = crmProdName.trim() || 'إطار نظارة';
    const notesText = crmNotes.trim() || undefined;
    const lensMeta = isCustomerContactLenses({
      id: '',
      shopId: activeShop.id,
      customerName: crmName.trim(),
      phone: crmPhone.trim(),
      productName: prodText,
      notes: notesText,
      orderDate: new Date().toISOString(),
    });
    await addCrmCustomer({
      shopId: activeShop.id,
      customerName: crmName.trim(),
      phone: crmPhone.trim(),
      productName: prodText,
      pd: crmPd.trim() || undefined,
      pricePaid: !isNaN(parsedPrice) && parsedPrice > 0 ? parsedPrice : undefined,
      orderDate: new Date().toISOString(),
      notes: notesText,
      reminderCategory: lensMeta.isContactLenses ? 'contact_lenses' : 'glasses',
      contactLensMonths: lensMeta.isContactLenses ? (lensMeta.isAnnualContactLenses ? 12 : 3) : undefined,
    });
    setCrmName('');
    setCrmPhone('');
    setCrmProdName('');
    setCrmPd('');
    setCrmPrice('');
    setCrmNotes('');
    toast('تم تسجيل العميل وتفعيل قواعد التذكير الذكية ✓');
  };

  const handleScanLedgerPhoto = async (file: File) => {
    setLedgerScanning(true);
    try {
      const token = await getAccessToken();
      const extracted = await scanPaperLedgerViaServer(file, {
        authToken: token,
        shopId: activeShop.id,
        role: session.role,
        planTier: activeShop.planTier,
        isDemoAdminStore: activeShop.isDemoAdminStore,
      });
      if (!extracted.length) {
        toast('لم يتم العثور على بيانات عملاء واضحة في الصورة — جرّب التصوير بإضاءة أوضح');
        return;
      }
      setScannedLedgerRows(extracted);
      toast(`تم استخراج ${extracted.length} عميل من الدفتر — راجعهم ثم اضغط حفظ الكل ✓`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذر قراءة صورة الدفتر حالياً');
    } finally {
      setLedgerScanning(false);
    }
  };

  const handleSaveAllScannedCustomers = async () => {
    const validRows = scannedLedgerRows.filter((r) => r.customerName.trim() || r.phone.trim());
    if (!validRows.length) {
      toast('لا توجد بيانات عملاء صالحة للحفظ');
      return;
    }
    setSavingScannedRows(true);
    try {
      for (const row of validRows) {
        const isoDate = row.orderDate && /^\d{4}-\d{2}-\d{2}$/.test(row.orderDate)
          ? new Date(`${row.orderDate}T12:00:00`).toISOString()
          : new Date().toISOString();
        const prodText = row.productName.trim() || 'نظارة طبية';
        const notesText = row.notes?.trim() || 'تمت الإضافة بماسح الدفتر الذكي';
        const lensMeta = isCustomerContactLenses({
          id: '',
          shopId: activeShop.id,
          customerName: row.customerName.trim() || 'عميل دفتر',
          phone: row.phone.trim() || '01000000000',
          productName: prodText,
          notes: notesText,
          orderDate: isoDate,
        });
        await addCrmCustomer({
          shopId: activeShop.id,
          customerName: row.customerName.trim() || 'عميل دفتر',
          phone: row.phone.trim() || '01000000000',
          productName: prodText,
          pd: row.pd?.trim() || undefined,
          pricePaid: typeof row.pricePaid === 'number' && row.pricePaid > 0 ? row.pricePaid : undefined,
          orderDate: isoDate,
          notes: notesText,
          reminderCategory: lensMeta.isContactLenses ? 'contact_lenses' : 'glasses',
          contactLensMonths: lensMeta.isContactLenses ? (lensMeta.isAnnualContactLenses ? 12 : 3) : undefined,
        });
      }
      setScannedLedgerRows([]);
      toast(`تم حفظ ${validRows.length} عميل وتفعيل التذكير التلقائي ✓`);
    } finally {
      setSavingScannedRows(false);
    }
  };

  const aiLogoUsed = activeShop.aiLogoGenerations || 0;
  const aiLogoRemaining = Math.max(0, 2 - aiLogoUsed);

  const handleUploadDirectLogo = async (file: File) => {
    try {
      const url = await uploadAssetToStorage(file, `${activeShop.id}/logos`, 'webp');
      await updateShop(activeShop.id, { logo: url });
      toast('تم رفع شعار المحل وتطبيقه فوراً ✓');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذر رفع صورة اللوجو');
    }
  };

  const handleGenerateAiLogo = async (file: File) => {
    if (aiLogoUsed >= 2) {
      toast('تم استهلاك الحد الأقصى لتصميم اللوجو بالذكاء الاصطناعي (محاولتان)');
      return;
    }
    setAiLogoBusy(true);
    try {
      const { base64: imageBase64, mimeType } = await encodeCompactUploadBase64(file, 1600);

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

  const handleExportBackupCsv = () => {
    const dateStamp = new Date().toISOString().slice(0, 10);
    const rows: (string | number | null | undefined)[][] = [
      [`نسخة احتياطية متجر: ${activeShop.name}`, `تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}`],
      [],
      [`=== قاعدة العملاء وطلبات الواتساب والكشوفات (${shopCrm.length + shopInq.length}) ===`],
      [
        'المصدر',
        'اسم العميل',
        'رقم الموبايل',
        'النظارة / الموديل',
        'العدسة / الشركة',
        'مقاس PD',
        'السعر (ج.م)',
        'التاريخ / الوقت',
        'الحالة',
        'ملاحظات',
      ],
      ...shopCrm.map((c) => [
        'سجل العملاء',
        c.customerName,
        c.phone,
        c.productName,
        '—',
        c.pd || '',
        c.pricePaid ?? '',
        new Date(c.orderDate).toLocaleDateString('ar-EG'),
        c.recall12mSentAt ? 'تم تذكير الفحص' : c.recall6mSentAt ? 'تم تذكير الصيانة' : 'مفعل للتذكير',
        c.notes || '',
      ]),
      ...shopInq.map((q) => [
        q.kind === 'rx' ? 'طلب كشف / واتساب' : 'طلب مباشر',
        q.cust,
        q.phone,
        q.frameName,
        `${q.lensName}${q.brandName && q.brandName !== '—' ? ` · ${q.brandName}` : ''}`,
        q.pd || '',
        q.final || q.price,
        q.time,
        q.status === 'confirmed' ? 'تم التأكيد' : q.status === 'alt' ? 'اقتراح بديل' : 'جديد',
        q.notes || '',
      ]),
      [],
      [`=== مخزن النظارات (${shopProducts.length}) ===`],
      [
        'الكود / الموديل',
        'اسم النظارة',
        'الفئة',
        'التصميم',
        'السعر الأساسي (ج.م)',
        'الخصم %',
        'التوفر في المخزن',
        'حالة النشر',
        'المقاس البصري (mm)',
      ],
      ...shopProducts.map((p) => [
        p.modelCode || p.code,
        p.name,
        p.frameType || p.cat,
        p.type,
        p.price,
        p.disc || 0,
        (p.stock ?? 1) > 0 ? 'متاح' : 'نفد من المحل',
        p.isPublished === false ? 'مسودة مخفية' : 'منشورة',
        formatOpticalDimensions(resolveProductOpticalDimensions(p)),
      ]),
    ];

    const safeSlug = (activeShop.slug || 'store').replace(/[^a-zA-Z0-9_-]/g, '');
    dlCsv(`optiverse-backup-${safeSlug}-${dateStamp}.csv`, rows);
    toast('تم تحميل النسخة الاحتياطية (Excel / CSV) بنجاح ✓');
  };

  return (
    <Shell
      items={items}
      active={sec}
      setActive={(next) => setSec(normalizeMerchantSection(next))}
      title={activeShop.name}
      sub="لوحة تحكم التاجر"
      highlight="store"
      mobileMode="dock"
      primaryDockIds={['home', 'prods', 'crm', 'store']}
      onSignOut={signOut}
      headerAction={
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
          <PWAInstallButton />
          {canShowStoreAccess && (
            <>
              <button
                type="button"
                className="btn btn-sm bg-[#0F172A] hover:bg-slate-800 text-amber-300 border border-amber-400/30 whitespace-nowrap shrink-0 shadow-xs"
                onClick={() => setVipModeOpen(true)}
              >
                🪄 وضع المساعد داخل المحل
              </button>
              <button
                type="button"
                className="btn btn-tryon btn-sm whitespace-nowrap shrink-0"
                onClick={() => navigate(`/?shop=${encodeURIComponent(activeShop.slug)}&preview=merchant`)}
              >
                <I n="eye" s={14} /> معاينة المتجر
              </button>
            </>
          )}
        </div>
      }
    >
      {isPendingShop && (
        <div className="mb-4 rounded-2xl p-4 bg-amber-50 border-2 border-amber-300 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="font-extrabold text-amber-950 text-sm sm:text-base">
              ⏳ حسابك بانتظار تأكيد الإدارة — هنتواصل معاك قريبًا
            </div>
            <div className="text-xs text-amber-800">
              يمكنك حالياً تجهيز ورفع حتى 3 نظارات تجريبية في الكتالوج لحين تفعيل متجرك من الإدارة.
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              type="button"
              className="btn btn-g btn-sm !border-amber-300 !text-amber-950 hover:!bg-amber-100"
              onClick={async () => {
                await refreshUserSessionAndShop();
                toast('تم تحديث حالة المتجر ✓');
              }}
            >
              <I n="refresh" s={13} /> تحديث الحالة
            </button>
            <a
              className="btn !bg-[#059669] hover:!bg-[#047857] !text-white btn-sm shrink-0"
              href={`https://wa.me/${import.meta.env.VITE_ADMIN_WA || '201000000000'}?text=${encodeURIComponent(
                `مرحباً إدارة OptiVerse، تم تسجيل متجر "${activeShop.name}" وهو بانتظار تأكيد التفعيل.`
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              <I n="msg" s={14} /> تواصل مع الإدارة عبر واتساب
            </a>
          </div>
        </div>
      )}
      {sec === 'home' && (
        <>
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

          {/* Prominent Top Alert Banner when CRM reminders are due today */}
          {dueTodayCustomers.length > 0 && (
            <div className="mb-4 rounded-2xl bg-amber-50 border-2 border-amber-300 p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
                    <I n="bell" s={18} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-extrabold text-sm sm:text-base text-amber-950">
                      🔔 تنبيه التذكيرات: لديك {dueTodayCustomers.length} عميل مستحق للتذكير اليوم
                    </div>
                    <div className="text-xs text-amber-800">
                      اضغط على زر الواتساب لإرسال رسالة متابعة مخصصة حسب نوع الطلب فوراً
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCrmView('customers');
                    setSec('crm');
                  }}
                  className="btn bg-[#0F172A] hover:bg-slate-800 text-white btn-sm text-xs shrink-0"
                >
                  عرض جميع التذكيرات ({dueTodayCustomers.length})
                </button>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {dueTodayCustomers.slice(0, 3).map((c) => {
                  const pType: ReminderTypeKey = c.eval.primaryType || 'review';
                  const waText = encodeURIComponent(buildReminderWhatsAppMessage(c, activeShop, pType));
                  return (
                    <div
                      key={`home-due-${c.id}`}
                      className="rounded-xl bg-white border border-amber-200 p-3 flex flex-col justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <b className="text-xs sm:text-sm text-[#0F172A] truncate">{c.customerName}</b>
                          <span className="badge b-warn text-[0.62rem] shrink-0">{c.eval.primaryBadgeLabel}</span>
                        </div>
                        <div className="text-[0.7rem] text-slate-600 mt-0.5 truncate">
                          {c.productName} · <span dir="ltr">{c.phone}</span>
                        </div>
                      </div>
                      <a
                        href={`https://wa.me/${waNum(c.phone)}?text=${waText}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => void markCrmRecallSent(c.id, pType)}
                        className="btn bg-emerald-600 hover:bg-emerald-700 text-white btn-sm w-full text-xs font-extrabold"
                      >
                        تذكير واتساب الآن 💬
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <Head t={`أهلاً بك، ${activeShop.name} 👋`} sub="ملخص نشاط متجرك وتفاعل العملاء لحظياً" />

          {/* Compact Responsive Row of 3 Clickable Summary Cards (1 col mobile, 3 cols sm+) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 mb-5">
            <button
              type="button"
              onClick={() => setSec('prods')}
              className="glass rounded-2xl p-3 sm:p-4 text-start hover:border-[#0284C7]/50 hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-1.5"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-xs sm:text-sm font-extrabold text-[#0F172A]">
                  النظارات
                </span>
                <span className="w-7 h-7 rounded-lg bg-sky-50 text-[#0284C7] border border-sky-200 flex items-center justify-center shrink-0">
                  <I n="box" s={14} />
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-[#0F172A] tabular-nums" dir="ltr">
                {fmt(publishedProductsCount)}
              </div>
              <div className="text-[0.65rem] text-slate-500">
                من أصل <span dir="ltr">{maxProducts}</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setCrmView('customers');
                setSec('crm');
              }}
              className="glass rounded-2xl p-3 sm:p-4 text-start hover:border-[#D97706]/50 hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-1.5"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-xs sm:text-sm font-extrabold text-[#0F172A]">
                  العملاء
                </span>
                <span
                  className={
                    'w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ' +
                    (dueRecallCount > 0
                      ? 'bg-amber-50 text-[#D97706] border-amber-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200')
                  }
                >
                  <I n="bell" s={14} />
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-[#0F172A] tabular-nums" dir="ltr">
                {fmt(dueRecallCount)}
              </div>
              <div className="text-[0.65rem] text-slate-500">
                المسجلين: <span dir="ltr">{fmt(shopCrm.length)}</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setCrmView('orders');
                setSec('crm');
              }}
              className="glass rounded-2xl p-3 sm:p-4 text-start hover:border-[#0284C7]/50 hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-1.5"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-xs sm:text-sm font-extrabold text-[#0F172A]">
                  الطلبات
                </span>
                <span
                  className={
                    'w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ' +
                    (newCount > 0
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200')
                  }
                >
                  <I n="receipt" s={14} />
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-[#0F172A] tabular-nums" dir="ltr">
                {fmt(shopInq.length)}
              </div>
              <div className="text-[0.65rem] text-slate-500">
                {newCount > 0 ? `${newCount} جديدة` : 'عرض الكل'}
              </div>
            </button>
          </div>

          {/* Live Store Engagement Analytics Section */}
          <div className="glass rounded-2xl p-4 sm:p-5 mb-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-200 text-[#0284C7] flex items-center justify-center shrink-0">
                  <I n="spark" s={18} />
                </span>
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base text-[#0F172A] flex items-center gap-2">
                    <span>إحصائيات التفاعل الحي لمتجرك</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[#059669] text-[0.65rem] font-extrabold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      مباشر
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    متابعة فورية لزيارات المتجر، تجارب الكاميرا 3D، ومشاركات العملاء
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void refreshLiveStats()}
                disabled={statsRefreshing}
                className="btn btn-g btn-sm text-xs font-bold shrink-0"
              >
                <I n="refresh" s={13} /> {statsRefreshing ? 'جاري التحديث...' : 'تحديث'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* 1. Store Visits (Today / Total) */}
              <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3.5 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-slate-600">👁️ زيارات المتجر</span>
                  <span className="text-[0.65rem] font-bold text-[#0284C7] bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-lg">
                    اليوم / الإجمالي
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5 tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>
                  <span className="text-2xl font-extrabold text-[#0F172A]">{fmt(liveStats.todayVisits)}</span>
                  <span className="text-sm font-bold text-slate-400">/ {fmt(liveStats.totalVisits)}</span>
                </div>
                <div className="text-[0.68rem] text-slate-500">
                  اليوم <b className="text-[#0F172A]">{fmt(liveStats.todayVisits)}</b> · الإجمالي{' '}
                  <b className="text-[#0F172A]">{fmt(liveStats.totalVisits)}</b>
                </div>
              </div>

              {/* 2. Live 3D Face Camera Try-Ons */}
              <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3.5 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-slate-600">🤳 تجارب الكاميرا الحية 3D على الوجه</span>
                </div>
                <div className="text-2xl font-extrabold text-[#0284C7] tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>
                  {fmt(liveStats.totalTryons)}
                </div>
                <div className="text-[0.68rem] text-slate-500">
                  تجارب اليوم: <b className="text-[#0F172A]">{fmt(liveStats.todayTryons)}</b> تجربة حية
                </div>
              </div>

              {/* 3. Top Tried Frame Today (Name + Image) */}
              <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3.5 flex flex-col justify-between gap-2">
                <div className="text-xs font-extrabold text-slate-600">🔥 النظارة الأكثر تجربة اليوم</div>
                {liveStats.topTriedFrameToday ? (
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-16 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                      {liveStats.topTriedFrameToday.imageUrl ? (
                        <img
                          src={liveStats.topTriedFrameToday.imageUrl}
                          alt={liveStats.topTriedFrameToday.name}
                          width={64}
                          height={44}
                          loading="lazy"
                          decoding="async"
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <MiniGlasses type="wayfarer" frame="#0F172A" lens="#475569" w={48} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-extrabold text-xs text-[#0F172A] truncate">
                        {liveStats.topTriedFrameToday.name}
                      </div>
                      <div className="text-[0.68rem] font-bold text-[#D97706] tabular-nums">
                        {fmt(liveStats.topTriedFrameToday.count)} تجربة اليوم
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 leading-5">
                    لا توجد تجارب كاميرا مسجلة اليوم بعد
                  </div>
                )}
              </div>

              {/* 4. Friend Shares (Free Viral Reach) */}
              <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3.5 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-slate-600">📤 مشاركات الأصدقاء</span>
                  <span className="text-[0.65rem] font-bold text-[#059669] bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
                    الانتشار المجاني
                  </span>
                </div>
                <div className="text-2xl font-extrabold text-[#059669] tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>
                  {fmt(liveStats.totalShares)}
                </div>
                <div className="text-[0.68rem] text-slate-500">
                  اليوم: <b className="text-[#0F172A]">{fmt(liveStats.todayShares)}</b> مشاركة مع الأصدقاء
                </div>
              </div>
            </div>
          </div>

          {dueCrmList.length > 0 && (
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3 gap-2">
                <div>
                  <h3 className="font-bold text-[#0F172A]">متابعة العملاء المستحقة</h3>
                  <p className="text-xs text-slate-500">
                    تنبيهات الواتساب السريعة ({dueRecallCount} عملاء مستحقون الآن)
                  </p>
                </div>
                <button type="button" className="btn btn-g btn-sm" onClick={() => setSec('crm')}>
                  عرض الكل ({shopCrm.length})
                </button>
              </div>
              {dueCrmList.slice(0, 3).map((c) => {
                const recallKind = c.eval.primaryType || 'review';
                const msg = encodeURIComponent(
                  buildReminderWhatsAppMessage(c, activeShop, recallKind)
                );
                return (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] mb-2 last:mb-0"
                  >
                    <span className="w-9 h-9 rounded-full bg-[#0F172A] text-white font-extrabold flex items-center justify-center shrink-0">
                      {c.customerName[0]}
                    </span>
                    <div className="flex-1 min-w-[150px]">
                      <div className="font-bold text-sm text-[#0F172A]">{c.customerName}</div>
                      <div className="text-xs text-slate-500">
                        {c.productName} · منذ {c.eval.daysSince} يوم
                        {typeof c.pricePaid === 'number' && c.pricePaid > 0 ? ` · ${fmt(c.pricePaid)} ج.م` : ''}
                      </div>
                    </div>
                    <a
                      className="btn btn-p btn-sm"
                      href={`https://wa.me/${waNum(c.phone)}?text=${msg}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => markCrmRecallSent(c.id, recallKind)}
                    >
                      <I n="msg" s={14} />{' '}
                      {c.eval.isContactLenses
                        ? 'تجديد العدسات 💬'
                        : recallKind === 'review'
                        ? 'طلب تقييم ⭐'
                        : recallKind === '12m'
                        ? 'فحص نظر 💬'
                        : 'تذكير صيانة 💬'}
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {sec === 'prods' && (
        <Head
          t="النظارات والمخزن"
          sub={
            <>
              <span dir="ltr" className="inline-block font-bold text-[#0F172A]">
                {shopProducts.length} / {maxProducts}
              </span>{' '}
              نظارة في الكتالوج · إجمالي القطع بالمخزن: <b dir="ltr">{fmt(totalInventoryPieces)}</b>
            </>
          }
        >
          <button
            type="button"
            onClick={() => setSupplierReportOpen(true)}
            className="btn btn-g btn-sm whitespace-nowrap shrink-0 font-extrabold"
          >
            <I n="dl" s={14} /> تصدير كشف النواقص ({outOfStockProducts.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setNewCollectionSignal((s) => s + 1);
              toast('تم تفعيل وضع الكوليكشن الجديد — اختر فئة النظارات لرفع المجموعة ✨');
            }}
            className="btn btn-sm !bg-[#D97706] hover:!bg-[#B45309] !text-white font-extrabold whitespace-nowrap shrink-0 shadow-sm"
          >
            + إضافة نظارة / كوليكشن ✨
          </button>
        </Head>
      )}

      {/* Keep BulkFrameUploader mounted once prods tab is visited so background AI batches never interrupt */}
      {hasVisitedProds && (
        <div className={sec === 'prods' ? 'block' : 'hidden'}>
          <Suspense fallback={<ProductGridSkeleton count={2} />}>
            <BulkFrameUploader
              externalNewCollectionSignal={newCollectionSignal}
              onNavigateToProds={() => setSec('prods')}
            />
          </Suspense>
        </div>
      )}

      {sec === 'prods' && (
        <>
          {/* Quick Search + Inventory Filter + Delete by Code + Customer Stock Toggles */}
          <div className="glass rounded-2xl p-4 mb-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[200px] w-full sm:w-auto">
                <input
                  type="search"
                  value={prodSearch}
                  onChange={(e) => setProdSearch(e.target.value)}
                  placeholder="بحث سريع باسم النظارة أو الكود..."
                  className="inp !ps-9"
                />
                <span className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <I n="search" s={16} />
                </span>
              </div>

              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <input
                  className="inp flex-1 sm:!w-36 min-w-0 font-mono text-xs"
                  dir="ltr"
                  placeholder="حذف بكود FR-1001"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') delByCode();
                  }}
                />
                <button type="button" className="btn btn-d btn-sm whitespace-nowrap shrink-0" onClick={delByCode}>
                  <I n="trash" s={14} /> حذف
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: `الكل (${shopProducts.length})` },
                    { id: 'in_stock', label: `متوفر (${shopProducts.filter((p) => getProdStock(p) > 0).length})` },
                    { id: 'low', label: `أوشك على النفاد (${lowStockProducts.length})` },
                    { id: 'out', label: `نواقص (${outOfStockProducts.length})` },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setInvFilter(f.id)}
                    className={
                      'px-3 py-1.5 rounded-xl text-xs font-extrabold border transition cursor-pointer ' +
                      (invFilter === f.id
                        ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-sm'
                        : 'bg-white text-slate-700 border-[#E2E8F0] hover:border-[#0284C7]')
                    }
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    on={Boolean(activeShop.showStockCountToCustomer)}
                    onChange={async (v) => {
                      await updateShop(activeShop.id, { showStockCountToCustomer: v });
                      toast(v ? 'تم تفعيل عداد القطعة الأخيرة للعملاء ✓' : 'تم إخفاء عداد المخزون عن العملاء ✓');
                    }}
                  />
                  <span className="font-bold text-[#0F172A]">إظهار «متبقي قطعة»</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    on={Boolean(activeShop.hideOutOfStockToCustomer)}
                    onChange={async (v) => {
                      await updateShop(activeShop.id, { hideOutOfStockToCustomer: v });
                      toast(v ? 'سيتم إخفاء الإطارات المنتهية تلقائياً ✓' : 'الإطارات المنتهية تظهر للعملاء ✓');
                    }}
                  />
                  <span className="font-bold text-[#0F172A]">إخفاء المنتهي تلقائياً</span>
                </label>
              </div>
            </div>
          </div>

          {(() => {
            const resolvedProds = (pagedProds.length > 0 || debouncedProdSearch || invFilter !== 'all' || !prodsLoading
              ? pagedProds
              : shopProducts
            )
              .map((row) => shopProducts.find((sp) => sp.id === row.id) || row)
              .filter((p) => !p.isDeleted);

            if (prodsError) {
              return (
                <AsyncErrorBanner
                  message={prodsError}
                  retrying={prodsLoading}
                  onRetry={() => setProdsRetryNonce((n) => n + 1)}
                />
              );
            }

            if (prodsLoading && !resolvedProds.length) {
              return <ProductGridSkeleton count={6} />;
            }

            if (!resolvedProds.length) {
              return (
                <ArabicEmptyState
                  title="لا توجد نتائج"
                  subtitle="لا توجد نظارات مطابقة للبحث أو فلتر المخزن حالياً"
                  actionLabel={prodSearch.trim() || invFilter !== 'all' ? 'إظهار جميع النظارات' : undefined}
                  onAction={() => {
                    setProdSearch('');
                    setInvFilter('all');
                  }}
                />
              );
            }

            return (
              <>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {resolvedProds.map((p) => {
                    const published = p.isPublished !== false;
                    const st = getProdStock(p);
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
                                  width={160}
                                  height={120}
                                  loading="lazy"
                                  decoding="async"
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

                        {/* Inline Stock Control Bar with Instant Availability Switch */}
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] px-2.5 py-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={st > 0}
                            onClick={async () => {
                              const nextAvail = st === 0;
                              await updateProductStock(p.id, st > 0 ? -st : 1);
                              toast(nextAvail ? 'تم التحديث فوراً: متاح 🟢' : 'تم التحديث فوراً: نفد من المحل 🔴');
                            }}
                            className={
                              'inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border text-[0.7rem] font-extrabold cursor-pointer transition ' +
                              (st > 0
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                                : 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100')
                            }
                            title="تبديل فوري للتوفر في المتجر العام"
                          >
                            <span
                              className={
                                'w-7 h-4 rounded-full p-0.5 flex items-center transition-colors ' +
                                (st > 0 ? 'bg-emerald-500 justify-end' : 'bg-rose-500 justify-start')
                              }
                            >
                              <span className="w-3 h-3 rounded-full bg-white shadow-xs" />
                            </span>
                            <span>{st > 0 ? 'متاح 🟢' : 'نفد من المحل 🔴'}</span>
                          </button>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={st <= 0}
                              onClick={() => void updateProductStock(p.id, -1)}
                              aria-label="إنقاص المخزون"
                              className="w-11 h-11 sm:w-9 sm:h-9 rounded-lg bg-white hover:bg-rose-50 text-slate-900 hover:text-rose-700 border border-slate-200 font-extrabold text-sm flex items-center justify-center cursor-pointer disabled:opacity-40"
                            >
                              -
                            </button>
                            <span dir="ltr" className="min-w-[24px] text-center font-mono font-extrabold text-xs tabular-nums">
                              {st}
                            </span>
                            <button
                              type="button"
                              onClick={() => void updateProductStock(p.id, 1)}
                              aria-label="زيادة المخزون"
                              className="w-11 h-11 sm:w-9 sm:h-9 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white font-extrabold text-sm flex items-center justify-center cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1.5 mt-auto">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className="btn btn-g btn-sm flex-1"
                              onClick={() => setModal({ t: 'editprod', p })}
                            >
                              <I n="edit" s={13} /> تعديل
                            </button>
                            {canShowStoreAccess && (
                              <button
                                type="button"
                                className="btn btn-tryon btn-sm flex-1"
                                onClick={() => navigate(`/s/${activeShop.slug}/f/${p.id}?preview=merchant`)}
                              >
                                <I n="eye" s={13} /> معاينة
                              </button>
                            )}
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
                          {canShowStoreAccess && (
                            <button
                              type="button"
                              onClick={() => {
                                setAdTone('catchy');
                                setAdModalProduct(p);
                              }}
                              className="w-full py-2 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 font-extrabold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
                            >
                              <span>✨ اكتب إعلان للنظارة</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <LoadMoreBar
                  loadedCount={resolvedProds.length}
                  totalCount={prodsTotalCount}
                  hasMore={prodsHasMore}
                  loadingMore={prodsLoadingMore}
                  onLoadMore={loadMoreMerchantProds}
                  itemLabel="نظارة"
                />
              </>
            );
          })()}

          {supplierReportOpen && (
            <Modal
              title={`كشف النواقص المصور للموردين 📋 (${outOfStockProducts.length})`}
              onClose={() => setSupplierReportOpen(false)}
              w="max-w-3xl"
            >
              <div className="space-y-4">
                <div className="rounded-xl bg-sky-50 border border-sky-200 p-3 text-xs text-[#0284C7] font-bold flex flex-wrap items-center justify-between gap-2">
                  <span>
                    يضم هذا الكشف كل الإطارات التي وصل رصيدها إلى 0 لطلب إعادة التوريد بالصورة والكود والمقاس البصري.
                  </span>
                  <span className="font-mono">{new Date().toLocaleDateString('ar-EG')}</span>
                </div>

                {!outOfStockProducts.length ? (
                  <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-8 text-center text-sm text-slate-600">
                    ممتاز! لا توجد نواقص حالياً — جميع موديلات متجرك متوفرة بالمخزون ✓
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[52dvh] overflow-y-auto p-1">
                      {outOfStockProducts.map((p, idx) => {
                        const dimsText = formatOpticalDimensions(resolveProductOpticalDimensions(p));
                        const thumbUrl = resolveStoreFrontUrl(p);
                        return (
                          <div
                            key={p.id}
                            className="rounded-2xl bg-white border border-slate-200 p-3 flex items-center gap-3"
                          >
                            <div className="w-20 h-16 rounded-xl bg-[#F8F9FA] border border-slate-200 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                              <MiniGlasses
                                type={p.type}
                                frame={p.frame}
                                lens={p.lens}
                                w={72}
                                imageUrl={thumbUrl}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[0.65rem] text-rose-600 font-extrabold">
                                #{idx + 1} · مطلوب إعادة توريد
                              </div>
                              <div className="font-extrabold text-sm text-[#0F172A] truncate">{p.name}</div>
                              <div className="text-xs font-mono text-slate-600 mt-0.5" dir="ltr" style={{ textAlign: 'start' }}>
                                {p.modelCode || p.code} · {dimsText} mm
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => {
                          const rowsHtml = outOfStockProducts
                            .map((p, idx) => {
                              const dimsText = formatOpticalDimensions(resolveProductOpticalDimensions(p));
                              const thumbUrl = resolveStoreFrontUrl(p);
                              const esc = (s: string) =>
                                String(s || '')
                                  .replace(/&/g, '&amp;')
                                  .replace(/</g, '&lt;')
                                  .replace(/>/g, '&gt;')
                                  .replace(/"/g, '&quot;');
                              return `<tr>
                                <td style="padding:10px;border:1px solid #cbd5e1;text-align:center;">${idx + 1}</td>
                                <td style="padding:10px;border:1px solid #cbd5e1;text-align:center;">${
                                  thumbUrl
                                    ? `<img src="${esc(thumbUrl)}" alt="${esc(p.name)}" style="max-width:110px;max-height:60px;object-fit:contain;" />`
                                    : '👓'
                                }</td>
                                <td style="padding:10px;border:1px solid #cbd5e1;font-weight:700;">${esc(p.name)}</td>
                                <td style="padding:10px;border:1px solid #cbd5e1;font-family:monospace;direction:ltr;">${esc(p.modelCode || p.code)}</td>
                                <td style="padding:10px;border:1px solid #cbd5e1;font-family:monospace;direction:ltr;">${esc(dimsText)} mm</td>
                              </tr>`;
                            })
                            .join('');
                          const docHtml = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>كشف النواقص المصور - ${activeShop.name}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; padding: 28px; color: #0f172a; background: #fff; }
  h1 { margin: 0 0 6px; font-size: 22px; }
  .meta { color: #475569; font-size: 13px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { background: #0f172a; color: #fff; padding: 10px; border: 1px solid #0f172a; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
    <div>
      <h1>كشف نواقص المخزون المصور للموردين — ${activeShop.name}</h1>
      <div class="meta">التاريخ: ${new Date().toLocaleDateString('ar-EG')} · إجمالي النواقص: ${outOfStockProducts.length} موديل · واتساب المحل: ${activeShop.wa}</div>
    </div>
    <button class="no-print" onclick="window.print()" style="padding:8px 16px;background:#0284c7;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">طباعة / حفظ PDF</button>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>الصورة</th>
        <th>اسم الموديل</th>
        <th>الكود</th>
        <th>المقاسات البصرية</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
                          const blob = new Blob([docHtml], { type: 'text/html;charset=utf-8' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `supplier-shortage-report-${activeShop.slug || 'optiverse'}.html`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          setTimeout(() => URL.revokeObjectURL(url), 1500);
                          toast('تم تحميل كشف النواقص المصور جاهزاً للطباعة والإرسال 📋');
                        }}
                        className="btn btn-p flex-1 text-xs font-extrabold"
                      >
                        <I n="dl" s={15} /> تحميل الكشف المصور للطباعة (HTML/PDF)
                      </button>

                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(
                          [
                            `📋 طلب إعادة توريد نواقص — ${activeShop.name}:`,
                            ...outOfStockProducts.map(
                              (p, idx) =>
                                `${idx + 1}. ${p.name} | كود: ${p.modelCode || p.code} | مقاس: ${formatOpticalDimensions(resolveProductOpticalDimensions(p))} mm`
                            ),
                          ].join('\n')
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold"
                      >
                        <I n="msg" s={15} /> إرسال للمورد واتساب
                      </a>
                    </div>
                  </>
                )}
              </div>
            </Modal>
          )}

          {adModalProduct && canShowStoreAccess && (() => {
            const tryCamLink = `${origin}/s/${activeShop.slug}?try=${adModalProduct.id}`;
            const thumbUrl = resolveStoreFrontUrl(adModalProduct);
            return (
              <Modal
                title={`مولّد إعلانات السوشيال ميديا ✨ — ${adModalProduct.name}`}
                onClose={() => setAdModalProduct(null)}
                w="max-w-xl"
              >
                <div className="space-y-4">
                  <div className="flex items-center gap-3 rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3">
                    <div className="w-20 h-14 rounded-xl bg-white border border-slate-200 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                      <MiniGlasses
                        type={adModalProduct.type}
                        frame={adModalProduct.frame}
                        lens={adModalProduct.lens}
                        w={72}
                        imageUrl={thumbUrl}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-extrabold text-sm text-[#0F172A] truncate">{adModalProduct.name}</div>
                      <div className="text-xs font-extrabold text-[#D97706] mt-0.5">
                        <Pr x={D(adModalProduct)} />
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-bold text-slate-600 mb-1.5">اختر أسلوب البوست (باللهجة المصرية):</div>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          ['catchy', 'عصري وجذاب ✨'],
                          ['offer', 'عرض وخصم 🔥'],
                          ['optical', 'طبي وأنيق 👓'],
                        ] as const
                      ).map(([tKey, tLabel]) => (
                        <button
                          key={tKey}
                          type="button"
                          onClick={() => setAdTone(tKey)}
                          className={
                            'py-2 px-2 rounded-xl text-xs font-extrabold border cursor-pointer transition ' +
                            (adTone === tKey
                              ? 'bg-[#0F172A] text-white border-[#0F172A]'
                              : 'bg-white text-slate-700 border-[#E2E8F0] hover:border-[#0284C7]')
                          }
                        >
                          {tLabel}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl bg-sky-50 border border-sky-200 p-3 space-y-1.5">
                    <div className="text-[0.7rem] font-extrabold text-[#0284C7]">
                      رابط فتح الكاميرا 3D مباشرة على هذه النظارة:
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[#0F172A] flex-1 min-w-0 break-all" dir="ltr">
                        {tryCamLink}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(tryCamLink).then(() => toast('تم نسخ رابط الكاميرا المباشر ✓'));
                        }}
                        className="btn btn-g btn-sm shrink-0 text-xs"
                      >
                        <I n="copy" s={13} /> نسخ الرابط
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1">
                      نص الإعلان الجاهز (يمكنك التعديل عليه قبل النسخ):
                    </label>
                    <textarea
                      rows={7}
                      className="inp text-xs sm:text-sm leading-6"
                      value={adDraftText}
                      onChange={(e) => setAdDraftText(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard
                          ?.writeText(adDraftText)
                          .then(() => toast('تم نسخ الإعلان مع رابط الكاميرا المباشر بنجاح 🎉'))
                          .catch(() => toast('حدّد النص وانسخه يدوياً'));
                      }}
                      className="btn btn-p flex-1 text-xs sm:text-sm font-extrabold"
                    >
                      <I n="copy" s={15} /> نسخ الإعلان والرابط 📋
                    </button>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(adDraftText)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-extrabold"
                    >
                      <I n="msg" s={15} /> مشاركة واتساب
                    </a>
                  </div>
                </div>
              </Modal>
            );
          })()}
        </>
      )}

      {sec === 'crm' && (
        <>
          <Head
            t="العملاء والطلبات"
            sub={`طلبات الواتساب والكشوفات الطبية (${shopInq.length}) · قاعدة العملاء (${shopCrm.length})`}
          />

          {/* Quick Customer Prescription Archive Search */}
          <div className="glass rounded-2xl p-4 mb-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <span className="absolute inset-y-0 start-3 flex items-center text-slate-400 pointer-events-none">
                  <I n="search" s={16} />
                </span>
                <input
                  type="text"
                  className="inp !ps-9 text-xs sm:text-sm"
                  placeholder="ابحث باسم العميل أو رقم موبايله لعرض ملفه وأرشيف كشوفاته الطبية..."
                  value={crmSearch}
                  onChange={(e) => setCrmSearch(e.target.value)}
                />
              </div>
              {crmSearch.trim() && (
                <button
                  type="button"
                  onClick={() => setCrmSearch('')}
                  className="btn btn-g btn-sm text-xs"
                >
                  مسح البحث
                </button>
              )}
            </div>

            {crmSearch.trim() && (() => {
              const rawQ = crmSearch.trim();
              const qLower = rawQ.toLowerCase();
              const qDigits = normalizePhoneLookup(rawQ);
              const matchesCustomer = (name?: string, phone?: string) => {
                const nameMatch = (name || '').toLowerCase().includes(qLower);
                const normP = normalizePhoneLookup(phone);
                const phoneMatch = qDigits.length >= 3 && (normP.includes(qDigits) || (phone || '').includes(rawQ));
                return nameMatch || phoneMatch;
              };

              const matchedInqSource = pagedInq.length ? pagedInq : shopInq;
              const matchedCrmSource = pagedCrm.length ? pagedCrm : shopCrm;
              const matchedInq = matchedInqSource.filter((q) => matchesCustomer(q.cust, q.phone));
              const matchedCrm = matchedCrmSource.filter((c) => matchesCustomer(c.customerName, c.phone));

              type CustomerArchiveProfile = {
                key: string;
                name: string;
                phone: string;
                inquiries: typeof matchedInq;
                crmRows: typeof matchedCrm;
              };

              const profileMap = new Map<string, CustomerArchiveProfile>();
              const upsertProfile = (name: string, phone: string) => {
                const phoneKey = normalizePhoneLookup(phone);
                const key = phoneKey.length >= 7 ? `p:${phoneKey}` : `n:${name.trim().toLowerCase()}`;
                const existing = profileMap.get(key);
                if (existing) return existing;
                const created: CustomerArchiveProfile = {
                  key,
                  name: name.trim() || 'عميل',
                  phone: phone.trim(),
                  inquiries: [],
                  crmRows: [],
                };
                profileMap.set(key, created);
                return created;
              };

              matchedInq.forEach((q) => {
                upsertProfile(q.cust, q.phone).inquiries.push(q);
              });
              matchedCrm.forEach((c) => {
                upsertProfile(c.customerName, c.phone).crmRows.push(c);
              });

              const profiles = Array.from(profileMap.values());

              if (!profiles.length) {
                return (
                  <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-4 text-center text-xs text-slate-500">
                    لا توجد سجلات أو كشوفات طبية مطابقة لـ «{crmSearch.trim()}»
                  </div>
                );
              }

              return (
                <div className="space-y-3 pt-1">
                  <div className="text-xs font-extrabold text-[#0284C7]">
                    أرشيف ملفات العملاء المطابقة ({profiles.length})
                  </div>
                  {profiles.map((prof) => {
                    const latestInq = prof.inquiries[0];
                    const latestCrm = prof.crmRows[0];
                    const latestPd = latestInq?.pd || latestCrm?.pd || '';
                    const latestFrame = latestInq?.frameName || latestCrm?.productName || 'إطار نظارة';
                    const latestLens = latestInq?.lensName || latestCrm?.lensSummary || 'عدسات طبية';
                    const latestPrice = latestInq?.final || latestInq?.price || latestCrm?.pricePaid || 0;
                    const latestRxImg = prof.inquiries.find((x) => Boolean(x.img))?.img || null;
                    const latestNotes = latestInq?.notes || latestCrm?.notes || '';

                    const handleQuickReorderSameRx = async () => {
                      const newRef = '#Q-' + (400 + Math.floor(Math.random() * 580));
                      const reorderInq: Inquiry = {
                        id: newRef,
                        shopId: activeShop.id,
                        kind: latestInq?.kind || 'rx',
                        cust: prof.name,
                        phone: prof.phone || '01000000000',
                        frameName: latestFrame,
                        type: latestInq?.type || 'wayfarer',
                        frame: latestInq?.frame || '#0F172A',
                        lens: latestInq?.lens || '#E0F2FE',
                        lensName: latestLens,
                        brandName: latestInq?.brandName || '—',
                        extrasTxt: latestInq?.extrasTxt || 'إعادة طلب بنفس المقاس والكشف المسجل',
                        fp: latestInq?.fp || latestPrice,
                        lensPrice: latestInq?.lensPrice || 0,
                        add: 0,
                        price: latestPrice,
                        img: latestRxImg,
                        rxn: latestInq?.rxn || 0,
                        notes: latestNotes
                          ? `${latestNotes} · إعادة طلب بنفس المقاس السابق`
                          : 'إعادة طلب بنفس المقاس السابق بضغطة واحدة',
                        pd: latestPd,
                        status: 'new',
                        stage: 'review',
                        time: 'الآن',
                        mine: false,
                      };
                      await addInquiry(reorderInq);
                      toast(`تم تسجيل إعادة طلب نفس المقاس للعميل ${prof.name} (${newRef}) ✓`);
                    };

                    return (
                      <div
                        key={prof.key}
                        className="rounded-2xl bg-white border-2 border-sky-200 p-4 space-y-3 shadow-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="w-8 h-8 rounded-full bg-sky-100 text-[#0284C7] font-extrabold text-xs flex items-center justify-center">
                                <I n="user" s={15} />
                              </span>
                              <b className="text-sm sm:text-base text-[#0F172A]">{prof.name}</b>
                              {prof.phone && (
                                <span className="font-mono text-xs text-slate-600" dir="ltr">
                                  {prof.phone}
                                </span>
                              )}
                              <span className="badge b-info text-[0.65rem]">
                                {prof.inquiries.length + prof.crmRows.length} سجل / كشف
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleQuickReorderSameRx()}
                            className="btn btn-p btn-sm text-xs font-extrabold"
                          >
                            <I n="refresh" s={14} /> إعادة طلب نفس المقاس بضغطة واحدة
                          </button>
                        </div>

                        {/* Prescriptions with Images (Inquiries) */}
                        {prof.inquiries.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-extrabold text-slate-700">
                              الكشوفات الطبية والطلبات السابقة بالصور ({prof.inquiries.length}):
                            </div>
                            <div className="grid sm:grid-cols-2 gap-2.5">
                              {prof.inquiries.map((q) => (
                                <div
                                  key={q.id}
                                  className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-2.5 flex items-start gap-2.5"
                                >
                                  <div className="w-24 shrink-0">
                                    <ExamThumb q={q} onZoom={() => setModal({ t: 'zoom', q })} />
                                  </div>
                                  <div className="min-w-0 flex-1 space-y-1 text-xs">
                                    <div className="flex items-center justify-between gap-1">
                                      <b className="text-[#0F172A] truncate">{q.frameName}</b>
                                      <span className="text-[0.65rem] text-slate-500 shrink-0">{q.time}</span>
                                    </div>
                                    <div className="text-slate-600">
                                      {q.lensName}
                                      {q.brandName !== '—' ? ` · ${q.brandName}` : ''}
                                    </div>
                                    {q.pd && <span className="badge b-info text-[0.62rem]">PD: {q.pd}</span>}
                                    {q.notes && <div className="text-[0.7rem] text-slate-600">{q.notes}</div>}
                                    <div className="font-extrabold text-[#D97706]">
                                      <Egp v={q.final || q.price} />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* CRM Historical Orders & Measurements */}
                        {prof.crmRows.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-xs font-extrabold text-slate-700">
                              سجل القياسات والمبيعات ({prof.crmRows.length}):
                            </div>
                            <div className="grid sm:grid-cols-2 gap-2">
                              {prof.crmRows.map((c) => (
                                <div
                                  key={c.id}
                                  className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-2.5 text-xs space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <b className="text-[#0F172A] truncate">{c.productName}</b>
                                    <span className="badge b-info text-[0.62rem] shrink-0">
                                      {new Date(c.orderDate).toLocaleDateString('ar-EG')}
                                    </span>
                                  </div>
                                  <div className="text-slate-600 flex flex-wrap gap-2">
                                    {c.lensSummary && <span>{c.lensSummary}</span>}
                                    {c.pd && <span className="font-mono font-bold text-[#0284C7]">PD {c.pd}</span>}
                                    {typeof c.pricePaid === 'number' && c.pricePaid > 0 && (
                                      <span className="font-extrabold text-[#D97706]">{fmt(c.pricePaid)} ج.م</span>
                                    )}
                                  </div>
                                  {c.notes && <div className="text-[0.68rem] text-slate-500">{c.notes}</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-5">
            {(
              [
                ['all', `عرض الكل (${shopInq.length + shopCrm.length})`],
                ['orders', `طلبات الواتساب والكشوفات (${shopInq.length})`],
                ['customers', `قاعدة العملاء والتذكيرات (${shopCrm.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCrmView(id)}
                className={
                  'px-3.5 py-2 rounded-xl text-xs font-extrabold border transition cursor-pointer ' +
                  (crmView === id
                    ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-sm'
                    : 'bg-white text-slate-700 border-[#E2E8F0] hover:border-[#0284C7]')
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* 1. WhatsApp Orders & Medical Prescriptions */}
          {crmView !== 'customers' && (
            <div className="mb-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-extrabold text-sm sm:text-base text-[#0F172A]">
                  طلبات الواتساب والكشوفات الطبية ({inqTotalCount ?? shopInq.length})
                </h3>
                {newCount > 0 && <span className="badge b-warn">{newCount} جديدة بانتظار المراجعة</span>}
              </div>

              {inqError ? (
                <AsyncErrorBanner
                  message={inqError}
                  retrying={inqLoading}
                  onRetry={() => setCrmRetryNonce((n) => n + 1)}
                />
              ) : inqLoading && pagedInq.length === 0 ? (
                <ListCardsSkeleton count={3} />
              ) : (
                <>
                  {(pagedInq.length > 0 || debouncedCrmSearch ? pagedInq : shopInq).map((rawQ) => {
                    const q = shopInq.find((x) => x.id === rawQ.id) || rawQ;
                    return (
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
                      <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex flex-wrap items-center gap-3 mb-2">
                        <div className="grid-bg rounded-lg p-1.5 border border-[#E2E8F0] shrink-0">
                          <MiniGlasses type={q.type} frame={q.frame} lens={q.lens} w={78} />
                        </div>
                        <div className="flex-1 min-w-[140px] text-sm">
                          <div className="font-bold text-[#0F172A]">{q.frameName}</div>
                          <div className="text-xs text-slate-600">
                            العدسة: {q.lensName}
                            {q.brandName !== '—' && ` · ${q.brandName}`}
                          </div>
                          <div className="text-xs text-slate-600">الإضافات: {q.extrasTxt}</div>
                        </div>
                        <div className="text-end shrink-0">
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
                            className="inp w-full sm:!w-auto !py-1.5 text-xs"
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
                        {q.kind === 'rx' && rxEnabled && (
                          <button className="btn btn-g btn-sm" onClick={() => setModal({ t: 'altq', q })}>
                            <I n="refresh" s={14} /> اقتراح عدسة بديلة
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                    );
                  })}
                  {!(pagedInq.length > 0 || debouncedCrmSearch ? pagedInq : shopInq).length && (
                    <ArabicEmptyState
                      title="لا توجد نتائج"
                      subtitle="لا توجد طلبات واتساب أو كشوفات طبية مطابقة حالياً"
                    />
                  )}
                  <LoadMoreBar
                    loadedCount={(pagedInq.length > 0 || debouncedCrmSearch ? pagedInq : shopInq).length}
                    totalCount={inqTotalCount}
                    hasMore={inqHasMore}
                    loadingMore={inqLoadingMore}
                    onLoadMore={loadMoreMerchantInq}
                    itemLabel="طلب"
                  />
                </>
              )}
            </div>
          )}

          {/* 2. CRM Customers Database & Smart Automatic Reminders */}
          {crmView !== 'orders' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-extrabold text-sm sm:text-base text-[#0F172A]">
                  قاعدة العملاء وتذكيرات المتابعة التلقائية ({shopCrm.length})
                </h3>
                <span className="badge b-info text-[0.68rem]">
                  النظارات: 24 ساعة · 4 شهور · 12 شهر | العدسات اللاصقة: 3 شهور (أو 12 للسنوية)
                </span>
              </div>

              {/* Highlighted Due-Today Customer Cards with 1-Click Customized WhatsApp Reminder */}
              {dueTodayCustomers.length > 0 && (
                <div className="rounded-2xl bg-amber-50/80 border-2 border-amber-300 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-extrabold text-sm text-amber-950 flex items-center gap-1.5">
                      <span>🔔 عملاء مستحقون للتذكير اليوم ({dueTodayCustomers.length})</span>
                    </h4>
                    <span className="text-[0.7rem] font-bold text-amber-800">
                      أرسل تذكير الواتساب فوراً بضغطة واحدة
                    </span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {dueTodayCustomers.map((c) => {
                      const primaryType: ReminderTypeKey = c.eval.primaryType || 'review';
                      const primaryMsg = encodeURIComponent(
                        buildReminderWhatsAppMessage(c, activeShop, primaryType)
                      );
                      return (
                        <div
                          key={`due-${c.id}`}
                          className="rounded-xl bg-white border border-amber-200 p-3 flex flex-col justify-between gap-2.5 shadow-xs"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <b className="text-sm text-[#0F172A] truncate">{c.customerName}</b>
                              <span className="badge b-warn text-[0.65rem] shrink-0">
                                {c.eval.primaryBadgeLabel}
                              </span>
                            </div>
                            <div className="text-xs text-slate-600 mt-1 flex flex-wrap gap-2">
                              <span className="font-mono" dir="ltr">
                                {c.phone}
                              </span>
                              <span>· {c.productName}</span>
                            </div>
                          </div>
                          <a
                            href={`https://wa.me/${waNum(c.phone)}?text=${primaryMsg}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => void markCrmRecallSent(c.id, primaryType)}
                            className="btn bg-emerald-600 hover:bg-emerald-700 text-white btn-sm w-full text-xs font-extrabold"
                          >
                            إرسال تذكير واتساب بضغطة واحدة 💬
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Smart Paper Ledger Scanner + Review Cards */}
              <div className="glass rounded-2xl p-4 space-y-3 border border-sky-200/80">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-extrabold text-sm text-[#0F172A]">
                      ماسح الدفتر الورقي الذكي
                    </h4>
                    <p className="text-xs text-slate-500">
                      صوّر صفحة من دفتر المحل أو الفواتير المكتوبة بخط اليد لاستخراج العملاء والموبايلات وتفعيل التذكير تلقائياً
                    </p>
                  </div>
                  <label
                    className={
                      'btn btn-sm text-xs font-extrabold shrink-0 ' +
                      (ledgerScanning
                        ? 'bg-slate-200 text-slate-600 cursor-wait pointer-events-none'
                        : 'bg-[#0284C7] hover:bg-[#0369A1] text-white cursor-pointer shadow-sm')
                    }
                  >
                    <span>
                      {ledgerScanning
                        ? 'جاري قراءة الدفتر بالـ AI...'
                        : '📸 صوّر دفتر المحل لإضافة العملاء تلقائياً'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={ledgerScanning}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void handleScanLedgerPhoto(f);
                      }}
                    />
                  </label>
                </div>

                {scannedLedgerRows.length > 0 && (
                  <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-[#0F172A]">
                        مراجعة سريعة للعملاء المستخرجين ({scannedLedgerRows.length}):
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setScannedLedgerRows([])}
                          className="btn btn-g btn-sm text-xs"
                        >
                          إلغاء
                        </button>
                        <button
                          type="button"
                          disabled={savingScannedRows}
                          onClick={() => void handleSaveAllScannedCustomers()}
                          className="btn bg-emerald-600 hover:bg-emerald-700 text-white btn-sm text-xs font-extrabold"
                        >
                          {savingScannedRows ? 'جاري الحفظ...' : 'حفظ الكل وتفعيل التذكير ✓'}
                        </button>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-2.5">
                      {scannedLedgerRows.map((row) => (
                        <div
                          key={row.localId}
                          className="rounded-xl bg-white border border-slate-200 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[0.68rem] font-extrabold text-[#0284C7]">عميل مستخرج</span>
                            <button
                              type="button"
                              onClick={() =>
                                setScannedLedgerRows((prev) => prev.filter((x) => x.localId !== row.localId))
                              }
                              className="text-xs text-rose-600 font-bold hover:underline cursor-pointer"
                            >
                              حذف ✕
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              className="inp text-xs !py-1.5"
                              placeholder="الاسم"
                              value={row.customerName}
                              onChange={(e) =>
                                setScannedLedgerRows((prev) =>
                                  prev.map((x) =>
                                    x.localId === row.localId ? { ...x, customerName: e.target.value } : x
                                  )
                                )
                              }
                            />
                            <input
                              className="inp text-xs !py-1.5"
                              dir="ltr"
                              placeholder="01xxxxxxxxx"
                              value={row.phone}
                              onChange={(e) =>
                                setScannedLedgerRows((prev) =>
                                  prev.map((x) =>
                                    x.localId === row.localId ? { ...x, phone: e.target.value } : x
                                  )
                                )
                              }
                            />
                            <input
                              className="inp text-xs !py-1.5"
                              placeholder="الموديل / العدسة"
                              value={row.productName}
                              onChange={(e) =>
                                setScannedLedgerRows((prev) =>
                                  prev.map((x) =>
                                    x.localId === row.localId ? { ...x, productName: e.target.value } : x
                                  )
                                )
                              }
                            />
                            <input
                              type="date"
                              dir="ltr"
                              className="inp text-xs !py-1.5"
                              value={row.orderDate}
                              onChange={(e) =>
                                setScannedLedgerRows((prev) =>
                                  prev.map((x) =>
                                    x.localId === row.localId ? { ...x, orderDate: e.target.value } : x
                                  )
                                )
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <form onSubmit={handleAddCrm} className="glass rounded-2xl p-5 space-y-3">
                <h4 className="font-bold text-sm text-[#0F172A]">إضافة عميل جديد يدوياً</h4>
                <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
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
                  <input
                    className="inp text-xs"
                    type="number"
                    dir="ltr"
                    placeholder="المبلغ المدفوع (ج.م)"
                    value={crmPrice}
                    onChange={(e) => setCrmPrice(e.target.value)}
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
                {crmError ? (
                  <AsyncErrorBanner
                    message={crmError}
                    retrying={crmLoading}
                    onRetry={() => setCrmRetryNonce((n) => n + 1)}
                  />
                ) : crmLoading && pagedCrm.length === 0 ? (
                  <ListCardsSkeleton count={4} />
                ) : (
                  <>
                    {(pagedCrm.length > 0 || debouncedCrmSearch
                      ? pagedCrm.map((row) => {
                          const fresh = shopCrm.find((x) => x.id === row.id) || row;
                          return { ...fresh, eval: evaluateCustomerReminders(fresh) };
                        })
                      : dueCrmList
                    ).map((c) => {
                  const ev = c.eval;
                  const formattedDate = new Date(c.orderDate).toLocaleDateString('ar-EG');
                  const reviewMsg = encodeURIComponent(
                    buildReminderWhatsAppMessage(c, activeShop, 'review')
                  );
                  const maintMsg = encodeURIComponent(
                    buildReminderWhatsAppMessage(c, activeShop, '6m')
                  );
                  const examMsg = encodeURIComponent(
                    buildReminderWhatsAppMessage(c, activeShop, '12m')
                  );

                  return (
                    <div key={c.id} className="glass rounded-2xl p-4 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <b className="text-sm text-[#0F172A]">{c.customerName}</b>
                            <span className="font-mono text-xs text-slate-500" dir="ltr">
                              {c.phone}
                            </span>
                            <span className="badge b-info text-[0.65rem]">{formattedDate}</span>
                            {ev.isContactLenses ? (
                              <span className="badge b-acc text-[0.65rem]">
                                {ev.isAnnualContactLenses ? 'عدسات سنوية (12ش)' : 'عدسات لاصقة (3ش)'}
                              </span>
                            ) : (
                              <span className="badge b-info text-[0.65rem]">نظارة</span>
                            )}
                            {ev.dueReview24h && <span className="badge b-warn text-[0.65rem]">مستحق متابعة (24 ساعة)</span>}
                            {ev.dueMaint4m && <span className="badge b-warn text-[0.65rem]">مستحق صيانة مجانية (4ش)</span>}
                            {ev.dueExam12m && <span className="badge b-warn text-[0.65rem]">مستحق كشف نظر (12ش)</span>}
                            {ev.dueLens3m && <span className="badge b-warn text-[0.65rem]">مستحق تجديد عدسات (3ش)</span>}
                            {ev.dueLens12m && <span className="badge b-warn text-[0.65rem]">مستحق تجديد عدسات سنوية</span>}
                          </div>

                          <div className="text-xs text-slate-700 flex flex-wrap items-center gap-2">
                            <span>
                              <b>الموديل:</b> {c.productName}
                            </span>
                            {c.lensSummary && (
                              <span>
                                · <b>العدسة:</b> {c.lensSummary}
                              </span>
                            )}
                            {c.pd && <span className="font-mono">· PD {c.pd}</span>}
                            {typeof c.pricePaid === 'number' && c.pricePaid > 0 && (
                              <span className="font-extrabold text-[#D97706]">· المدفوع: {fmt(c.pricePaid)} ج.م</span>
                            )}
                          </div>

                          {c.notes && <div className="text-xs text-slate-500">ملاحظات: {c.notes}</div>}

                          {typeof c.rating === 'number' && c.rating > 0 && (
                            <div className="mt-1 inline-flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs">
                              <span className="text-amber-500 font-bold">{'★'.repeat(c.rating)}</span>
                              {c.reviewComment && <span className="text-slate-700">«{c.reviewComment}»</span>}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {c.recallReviewSentAt && <span className="badge b-ok text-[0.65rem]">أُرسل متابعة ✓</span>}
                          {c.recall6mSentAt && (
                            <span className="badge b-ok text-[0.65rem]">
                              {ev.isContactLenses ? 'أُرسل تجديد عدسات ✓' : 'أُرسل صيانة ✓'}
                            </span>
                          )}
                          {c.recall12mSentAt && (
                            <span className="badge b-ok text-[0.65rem]">
                              {ev.isContactLenses ? 'أُرسل تجديد سنوي ✓' : 'أُرسل فحص ✓'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                        {ev.isContactLenses ? (
                          <a
                            href={`https://wa.me/${waNum(c.phone)}?text=${ev.isAnnualContactLenses ? examMsg : maintMsg}`}
                            target="_blank"
                            rel="noreferrer"
                            className={
                              'btn btn-sm text-xs ' +
                              (ev.dueLens3m || ev.dueLens12m ? 'btn-p' : 'btn-g')
                            }
                            onClick={() =>
                              markCrmRecallSent(c.id, ev.isAnnualContactLenses ? '12m' : '6m')
                            }
                          >
                            <I n="msg" s={13} />{' '}
                            {ev.isAnnualContactLenses ? 'تذكير تجديد سنوي (12ش)' : 'تذكير تجديد العدسات (3ش)'}
                          </a>
                        ) : (
                          <>
                            <a
                              href={`https://wa.me/${waNum(c.phone)}?text=${reviewMsg}`}
                              target="_blank"
                              rel="noreferrer"
                              className={
                                'btn btn-sm text-xs ' +
                                (ev.dueReview24h ? 'bg-[#D97706] hover:bg-[#B45309] text-white' : 'btn-g')
                              }
                              onClick={() => markCrmRecallSent(c.id, 'review')}
                            >
                              <I n="msg" s={13} /> متابعة وتقييم (24 ساعة) ⭐
                            </a>
                            <a
                              href={`https://wa.me/${waNum(c.phone)}?text=${maintMsg}`}
                              target="_blank"
                              rel="noreferrer"
                              className={'btn btn-sm text-xs ' + (ev.dueMaint4m ? 'btn-p' : 'btn-g')}
                              onClick={() => markCrmRecallSent(c.id, '6m')}
                            >
                              <I n="msg" s={13} /> صيانة مجانية (4 شهور)
                            </a>
                            <a
                              href={`https://wa.me/${waNum(c.phone)}?text=${examMsg}`}
                              target="_blank"
                              rel="noreferrer"
                              className={'btn btn-sm text-xs ' + (ev.dueExam12m ? 'btn-p' : 'btn-g')}
                              onClick={() => markCrmRecallSent(c.id, '12m')}
                            >
                              <I n="msg" s={13} /> كشف نظر سنوي (12 شهر)
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                    {!(pagedCrm.length > 0 || debouncedCrmSearch ? pagedCrm : dueCrmList).length && (
                      <ArabicEmptyState
                        title="لا توجد نتائج"
                        subtitle="لا يوجد عملاء مطابقون — أضف أول عميل لبدء التذكيرات التلقائية"
                      />
                    )}
                    <LoadMoreBar
                      loadedCount={(pagedCrm.length > 0 || debouncedCrmSearch ? pagedCrm : dueCrmList).length}
                      totalCount={crmTotalCount}
                      hasMore={crmHasMore}
                      loadingMore={crmLoadingMore}
                      onLoadMore={loadMoreMerchantCrm}
                      itemLabel="عميل"
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {sec === 'store' && (
        <div className="pb-6">
          <Head
            t="إعدادات المحل"
            sub="رابط المتجر وكود QR، بيانات المحل، اللوجو، الواتساب، والباقة"
          />

          {/* Top Card: Store Link & Printable A5 QR Poster (hidden for pending or non-active stores) */}
          {canShowStoreAccess ? (
            <div className="glass rounded-2xl p-4 sm:p-5 mb-4 min-w-0">
              <div className="grid lg:grid-cols-2 gap-5 items-center">
                <div className="min-w-0">
                  <h3 className="font-extrabold text-[#0F172A] mb-2">رابط المتجر وكود QR</h3>
                  <p className="text-xs text-slate-500 mb-3">
                    شارك رابط متجرك المباشر مع عملائك أو اطبع بوستر QR جاهز مقاس A5 على كاونتر المحل
                  </p>
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] mb-3 min-w-0">
                    <I n="link" s={18} c="text-[#0284C7] shrink-0" />
                    <span className="font-mono text-xs sm:text-sm text-[#0F172A] flex-1 min-w-0 break-all text-start" dir="ltr">
                      {link}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-g flex-1 min-w-[110px]" onClick={copy}>
                      <I n="copy" s={15} /> نسخ الرابط
                    </button>
                    <button type="button" className="btn btn-g flex-1 min-w-[110px]" onClick={() => setModal({ t: 'share', link })}>
                      <I n="share" s={15} /> مشاركة
                    </button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4 rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-4 text-center sm:text-start">
                  <div ref={qrWrapRef} className="shrink-0">
                    <QR seed={activeShop.slug} />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="font-extrabold text-[#0F172A] text-sm">بوستر QR دعائي للطباعة (A5)</div>
                    <p className="text-xs text-slate-600 leading-5">
                      تصميم جاهز باسم المحل وعبارة: «امسح الكود وجرّب كل نظارات {activeShop.name} على وجهك بالكاميرا 3D»
                    </p>
                    <button type="button" className="btn btn-p btn-sm w-full sm:w-auto" onClick={downloadQrPng}>
                      <I n="dl" s={14} /> تحميل بوستر QR (A5)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="glass rounded-2xl p-5 mb-4 border border-amber-200 bg-amber-50/60">
              <div className="font-extrabold text-[#0F172A] text-sm mb-1">
                🔒 رابط المتجر العام وكود QR غير متاحين حالياً
              </div>
              <p className="text-xs text-slate-600 leading-5">
                {isPendingShop
                  ? 'سيتم إتاحة رابط المتجر العام وزر المعاينة وكود QR للطباعة تلقائياً فور تأكيد وتفعيل الإدارة لمتجرك.'
                  : 'تم إيقاف رابط المتجر العام وكود QR مؤقتاً بسبب انتهاء أو إيقاف الاشتراك.'}
              </p>
            </div>
          )}

          {/* Plan & AI Credits Summary Card */}
          <div className="glass rounded-2xl p-5 mb-4 space-y-4">
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
                      {activeShop.status === 'trial'
                        ? 'فترة تجريبية مجانية'
                        : activeShop.status === 'pending'
                        ? 'بانتظار تأكيد الإدارة'
                        : activeShop.status === 'paused'
                        ? 'موقوف مؤقتاً'
                        : activeShop.status === 'expired'
                        ? 'اشتراك منتهي'
                        : 'اشتراك مفعل'}
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
              <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex items-center justify-between">
                <span className="text-slate-600 font-bold">سعة المتجر</span>
                <b className="tabular-nums text-[#0F172A]" dir="ltr">
                  {shopProducts.length} / {maxProducts}
                </b>
              </div>
              <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex items-center justify-between">
                <span className="text-slate-600 font-bold">رصيد معالجة AI</span>
                <b className="tabular-nums text-[#0284C7]" dir="ltr">
                  {creditsRemaining} / {creditsCap}
                </b>
              </div>
              <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex items-center justify-between">
                <span className="text-slate-600 font-bold">مسطرة PD بالكاميرا</span>
                <span className={planCaps.cameraPdRulerEnabled ? 'badge b-ok' : 'badge b-warn'}>
                  {planCaps.cameraPdRulerEnabled ? 'مفعّلة ✓' : 'في الاحترافية'}
                </span>
              </div>
            </div>
          </div>

          <div className="glass rounded-2xl p-5 space-y-4 mb-4">
            <h3 className="font-bold text-[#0F172A]">بيانات المحل واللوجو والواتساب</h3>
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
                      width={48}
                      height={48}
                      loading="lazy"
                      decoding="async"
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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

            {/* Business Hours & Store Card Display Controls */}
            <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-extrabold text-[#0F172A]">شريط ساعات العمل والاتصال السريع</div>
                  <div className="text-[0.68rem] text-slate-500">
                    يظهر للعملاء حالة المحل (مفتوح الآن / مغلق الآن) مع أزرار واتساب واتصال
                  </div>
                </div>
                <Switch
                  on={Boolean(activeShop.showBusinessHoursBar)}
                  onChange={(v) => updateShop(activeShop.id, { showBusinessHoursBar: v })}
                />
              </div>

              {activeShop.showBusinessHoursBar && (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="text-[0.7rem] font-bold text-slate-600">بداية العمل</label>
                    <input
                      type="time"
                      dir="ltr"
                      className="inp mt-1 text-xs"
                      value={activeShop.workingHoursStart || '10:00'}
                      onChange={(e) => updateShop(activeShop.id, { workingHoursStart: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[0.7rem] font-bold text-slate-600">نهاية العمل</label>
                    <input
                      type="time"
                      dir="ltr"
                      className="inp mt-1 text-xs"
                      value={activeShop.workingHoursEnd || '22:00'}
                      onChange={(e) => updateShop(activeShop.id, { workingHoursEnd: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200/80 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#0F172A]">تجميع ألوان الموديل الواحد في كارت متجر العميل</span>
                  <Switch
                    on={Boolean(activeShop.groupColorsInStore)}
                    onChange={(v) => updateShop(activeShop.id, { groupColorsInStore: v })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#0F172A]">إظهار دوائر الألوان على الكارت للعميل</span>
                  <Switch
                    on={activeShop.showColorSwatchesToCustomer !== false}
                    onChange={(v) => updateShop(activeShop.id, { showColorSwatchesToCustomer: v })}
                  />
                </div>
              </div>

              {/* Storefront Promo Banner Settings */}
              <div className="pt-2 border-t border-slate-200/80 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-extrabold text-[#0F172A]">🏷️ شريط الإعلان العلوي بالمتجر (Promo Banner)</div>
                    <div className="text-[0.68rem] text-slate-500">
                      اعرض شريط عروض أو إعلان قصير أعلى صفحة متجر العملاء
                    </div>
                  </div>
                  <Switch
                    on={Boolean(activeShop.promoBannerEnabled)}
                    onChange={(v) => updateShop(activeShop.id, { promoBannerEnabled: v })}
                  />
                </div>
                {activeShop.promoBannerEnabled && (
                  <div>
                    <input
                      type="text"
                      dir="rtl"
                      className="inp text-xs"
                      maxLength={140}
                      placeholder="مثال: خصم 20% على جميع النظارات الطبية لفترة محدودة!"
                      value={activeShop.promoBannerText || ''}
                      onChange={(e) => updateShop(activeShop.id, { promoBannerText: e.target.value })}
                    />
                  </div>
                )}
              </div>

              {/* Reminder-Only Mobile Notifications Toggle */}
              <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-extrabold text-[#0F172A]">🔔 إشعارات مواعيد التذكير</div>
                  <div className="text-[0.68rem] text-slate-500">
                    تنبيه على الموبايل لمواعيد تذكير العملاء المستحقة اليوم فقط (صيانة / فحص / عدسات)
                  </div>
                </div>
                <Switch
                  on={Boolean(activeShop.reminderNotificationsEnabled)}
                  onChange={async (v) => {
                    if (v && typeof window !== 'undefined' && 'Notification' in window) {
                      const perm = await Notification.requestPermission();
                      if (perm !== 'granted') {
                        toast('يرجى السماح بالإشعارات من إعدادات المتصفح لتفعيل التنبيهات');
                        return;
                      }
                      await updateShop(activeShop.id, { reminderNotificationsEnabled: true });
                      if (dueTodayCustomers.length > 0) {
                        await dispatchDueRemindersNotification(activeShop.id, activeShop.name, dueTodayCustomers);
                      }
                      toast('تم تفعيل إشعارات مواعيد التذكير ✓');
                      return;
                    }
                    await updateShop(activeShop.id, { reminderNotificationsEnabled: v });
                    toast(v ? 'تم تفعيل إشعارات التذكير ✓' : 'تم إيقاف إشعارات التذكير');
                  }}
                />
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

          {(rxEnabled || deliveryEnabled || suppliersEnabled) && (
            <div className="glass rounded-2xl p-4 space-y-4">
              <button
                type="button"
                onClick={() => setShowAdvancedStoreSettings((v) => !v)}
                className="w-full flex items-center justify-between gap-2 text-sm font-extrabold text-[#0F172A] cursor-pointer"
              >
                <span>إعدادات إضافية (أسعار العدسات والشركات والتوصيل)</span>
                <span className="text-xs text-[#0284C7]">{showAdvancedStoreSettings ? 'إخفاء ▲' : 'عرض ▼'}</span>
              </button>

              {showAdvancedStoreSettings && (
                <div className="space-y-4 pt-3 border-t border-slate-100">
                  {deliveryEnabled && (
                    <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-4 space-y-3">
                      <h4 className="font-bold text-sm text-[#0F172A]">إعدادات التوصيل والشحن</h4>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-bold text-slate-700">رسوم التوصيل (ج.م)</label>
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
                      </div>
                    </div>
                  )}

                  {rxEnabled && <MerchantLensMatrixManager />}

                  {suppliersEnabled && (platformSettings.sponsoredSuppliers || []).some((s) => s.isActive) && (
                    <div className="grid md:grid-cols-2 gap-3">
                      {(platformSettings.sponsoredSuppliers || [])
                        .filter((s) => s.isActive)
                        .map((sup) => (
                          <div key={sup.id} className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-4 space-y-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h4 className="font-extrabold text-sm text-[#0F172A]">{sup.name}</h4>
                                <div className="text-xs text-slate-500">{sup.specialty} · {sup.city}</div>
                              </div>
                              <span className="badge b-acc">مورد معتمد ⭐</span>
                            </div>
                            <div className="rounded-xl p-2.5 bg-emerald-50 border border-emerald-200 text-xs font-bold text-[#059669]">
                              {sup.offerText}
                            </div>
                            <a
                              href={`https://wa.me/${waNum(sup.wa)}?text=${encodeURIComponent(
                                `مرحباً ${sup.name}، أتواصل معكم بصفتي تاجر مشترك في OptiVerse (${activeShop.name}) بخصوص عرض الجملة.`
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-p btn-sm w-full"
                            >
                              <I n="msg" s={14} /> تواصل على واتساب المورد
                            </a>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Data Backup & Excel/CSV Export Card */}
          <div className="glass rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <div className="font-extrabold text-sm text-[#0F172A]">النسخ الاحتياطي وتصدير البيانات</div>
              <div className="text-xs text-slate-600 mt-0.5 leading-5">
                احتفظ بنسخة كاملة من قاعدة العملاء والكشوفات وطلبات الواتساب ومخزن النظارات ({shopCrm.length + shopInq.length} سجل عملاء · {shopProducts.length} نظارة)
              </div>
            </div>
            <button
              type="button"
              onClick={handleExportBackupCsv}
              className="btn bg-[#059669] hover:bg-[#047857] text-white btn-sm sm:!px-4 sm:!py-2.5 w-full sm:w-auto shrink-0 shadow-xs"
            >
              📥 تحميل نسخة احتياطية من العملاء والنظارات (Excel / CSV)
            </button>
          </div>

          <div className="mt-5 pt-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  if (typeof window !== 'undefined') {
                    window.sessionStorage.clear();
                    for (const key of Object.keys(window.localStorage)) {
                      if (key.startsWith('optiverse_') || key.startsWith('sb-')) {
                        window.localStorage.removeItem(key);
                      }
                    }
                  }
                } catch {
                  // Ignore storage access errors
                }
                if (supabase) {
                  try {
                    await supabase.auth.signOut();
                  } catch {
                    // Ignore signOut network errors
                  }
                }
                setSession(null);
                toast('تم تسجيل الخروج ✓');
                navigate('/');
              }}
              className="w-full py-3.5 px-4 rounded-2xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-extrabold text-sm sm:text-base shadow-lg shadow-red-600/20 border border-red-500 flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <span>تسجيل الخروج 🚪</span>
            </button>
          </div>
        </div>
      )}

      {vipModeOpen && canShowStoreAccess && (
        <Suspense fallback={<PageSuspendFallback label="جاري فتح وضع المساعد VIP..." />}>
          <VipInStoreConsultantModal
            shop={activeShop}
            products={shopProducts}
            onClose={() => setVipModeOpen(false)}
          />
        </Suspense>
      )}
    </Shell>
  );
}
