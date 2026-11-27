import { CrmCustomer, Shop } from '../types';

export type ReminderTypeKey = 'review' | '6m' | '12m';

export interface EvaluatedCustomerReminders {
  isContactLenses: boolean;
  isAnnualContactLenses: boolean;
  hoursSince: number;
  daysSince: number;
  dueReview24h: boolean;
  dueMaint4m: boolean;
  dueExam12m: boolean;
  dueLens3m: boolean;
  dueLens12m: boolean;
  hasAnyDue: boolean;
  primaryType: ReminderTypeKey | null;
  primaryBadgeLabel: string;
}

const CONTACT_LENS_RE =
  /عدس(?:ات|ة)\s*(?:لاصق(?:ة|ه)?|سنوي(?:ة|ه)?|شهري(?:ة|ه)?|يومي(?:ة|ه)?|ملون(?:ة|ه)?|طبي(?:ة|ه)?)|لنسز|contact\s*lens/i;
const ANNUAL_LENS_RE = /عدس(?:ات|ة)\s*سنوي(?:ة|ه)?|سنوي(?:ة|ه)\s*لنسز|annual\s*contact|12\s*شهر/i;

export function isCustomerContactLenses(c: CrmCustomer): {
  isContactLenses: boolean;
  isAnnualContactLenses: boolean;
} {
  const haystack = `${c.productName || ''} ${c.lensSummary || ''} ${c.notes || ''}`.trim();
  const isContactLenses =
    c.reminderCategory === 'contact_lenses' || CONTACT_LENS_RE.test(haystack);
  const isAnnualContactLenses =
    isContactLenses &&
    (c.contactLensMonths === 12 || ANNUAL_LENS_RE.test(haystack));
  return { isContactLenses, isAnnualContactLenses };
}

export function evaluateCustomerReminders(c: CrmCustomer): EvaluatedCustomerReminders {
  const orderTime = new Date(c.orderDate).getTime();
  const safeOrderTime = Number.isFinite(orderTime) ? orderTime : Date.now();
  const diffMs = Math.max(0, Date.now() - safeOrderTime);
  const hoursSince = Math.floor(diffMs / 3600000);
  const daysSince = Math.floor(diffMs / 86400000);

  const { isContactLenses, isAnnualContactLenses } = isCustomerContactLenses(c);

  if (isContactLenses) {
    const dueLens12m = isAnnualContactLenses && daysSince >= 365 && !c.recall12mSentAt;
    const dueLens3m = !isAnnualContactLenses && daysSince >= 90 && !c.recall6mSentAt;
    const hasAnyDue = dueLens12m || dueLens3m;
    return {
      isContactLenses: true,
      isAnnualContactLenses,
      hoursSince,
      daysSince,
      dueReview24h: false,
      dueMaint4m: false,
      dueExam12m: false,
      dueLens3m,
      dueLens12m,
      hasAnyDue,
      primaryType: dueLens12m ? '12m' : dueLens3m ? '6m' : null,
      primaryBadgeLabel: dueLens12m
        ? 'تجديد العدسات السنوية (12 شهر)'
        : dueLens3m
        ? 'تجديد العدسات اللاصقة (3 شهور)'
        : isAnnualContactLenses
        ? 'عدسات سنوية (12 شهر)'
        : 'عدسات لاصقة (3 شهور)',
    };
  }

  const dueReview24h = hoursSince >= 24 && !c.recallReviewSentAt;
  const dueMaint4m = daysSince >= 120 && !c.recall6mSentAt;
  const dueExam12m = daysSince >= 365 && !c.recall12mSentAt;
  const hasAnyDue = dueReview24h || dueMaint4m || dueExam12m;
  const primaryType: ReminderTypeKey | null = dueExam12m
    ? '12m'
    : dueMaint4m
    ? '6m'
    : dueReview24h
    ? 'review'
    : null;
  const primaryBadgeLabel = dueExam12m
    ? 'كشف النظر السنوي المجاني (12 شهر)'
    : dueMaint4m
    ? 'صيانة وضبط النظارة مجاناً (4 شهور)'
    : dueReview24h
    ? 'متابعة راحة الاستخدام والتقييم (24 ساعة)'
    : 'متابع تلقائياً';

  return {
    isContactLenses: false,
    isAnnualContactLenses: false,
    hoursSince,
    daysSince,
    dueReview24h,
    dueMaint4m,
    dueExam12m,
    dueLens3m: false,
    dueLens12m: false,
    hasAnyDue,
    primaryType,
    primaryBadgeLabel,
  };
}

export function buildReminderWhatsAppMessage(
  c: CrmCustomer,
  shop: Pick<Shop, 'name' | 'slug'>,
  type: ReminderTypeKey
): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://optiverse.app';
  const reviewUrl = `${origin}/s/${shop.slug}${c.productId ? `/f/${c.productId}` : ''}?review=1`;
  const { isContactLenses, isAnnualContactLenses } = isCustomerContactLenses(c);

  if (isContactLenses) {
    if (type === '12m' || isAnnualContactLenses) {
      return `أهلاً أ/ ${c.customerName} 👁️\nمن *${shop.name}* — مرّ عام على استلام عدساتك اللاصقة السنوية (${c.productName}). حرصاً على سلامة عينيك نذكّرك بموعد التجديد وفحص النظر قبل استبدالها، يمكنك زيارتنا أو حجز عدساتك الجديدة الآن.`;
    }
    return `أهلاً أ/ ${c.customerName} 👁️\nمن *${shop.name}* — حان موعد تجديد عبوة العدسات اللاصقة الخاصة بك (${c.productName}) بعد مرور 3 شهور.\nنوفّرها لك جاهزة بالمحل أو التوصيل مع عرض خاص لتجديد العملاء الدائمين.`;
  }

  if (type === 'review') {
    return `أهلاً أ/ ${c.customerName} 🌟\nمعك *${shop.name}*، نتمنى أن تكون نظارتك الجديدة (${c.productName}) مريحة تماماً لك بعد استلامها.\nإذا أردت أي ضبط مجاني أو مشاركة تقييمك للنظارة يسعدنا رأيك هنا:\n${reviewUrl}`;
  }
  if (type === '6m') {
    return `أهلاً أ/ ${c.customerName} 👓\nمن *${shop.name}* — مرّ 4 شهور على استلام نظارتك (${c.productName})!\nندعوك لزيارتنا لخدمة *الصيانة المجانية* (تنظيف العدسات بالموجات فوق الصوتية، شد المسامير، وضبط وسادات الأنف مجاناً بالكامل).`;
  }
  return `أهلاً أ/ ${c.customerName} 👁️\nمن *${shop.name}* — مرّ عام على فحص نظرك الأخير واستلام (${c.productName}).\nيسعدنا دعوتك لإجراء *فحص نظر سنوي مجاني* والاطمئنان على ثبات مقاسك واكتشاف أحدث تشكيلة شمبرات لدينا.`;
}

export async function dispatchDueRemindersNotification(
  shopId: string,
  shopName: string,
  dueCustomers: CrmCustomer[]
): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted' || dueCustomers.length === 0) return false;

  const todayKey = new Date().toISOString().slice(0, 10);
  const dedupKey = `optiverse_due_notif_${shopId}_${todayKey}_${dueCustomers.length}`;
  try {
    if (window.localStorage.getItem(dedupKey) === '1') return false;
  } catch {
    // ignore storage errors
  }

  const namesPreview = dueCustomers
    .slice(0, 3)
    .map((c) => c.customerName)
    .join('، ');
  const extraCount = dueCustomers.length > 3 ? ` و${dueCustomers.length - 3} آخرين` : '';
  const title = `تذكير عملاء ${shopName} (${dueCustomers.length})`;
  const body = `عملاء مستحقون للتذكير اليوم: ${namesPreview}${extraCount}. اضغط لفتح قسم التذكير وإرسال رسائل الواتساب.`;

  const options: NotificationOptions = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: `optiverse-crm-reminders-${shopId}`,
    data: { url: '/merchant' },
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500)),
      ]);
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        try {
          window.localStorage.setItem(dedupKey, '1');
        } catch {
          // ignore
        }
        return true;
      }
    }
    new Notification(title, options);
    try {
      window.localStorage.setItem(dedupKey, '1');
    } catch {
      // ignore
    }
    return true;
  } catch {
    return false;
  }
}
