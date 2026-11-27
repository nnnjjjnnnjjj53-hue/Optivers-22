import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { Product } from '../types';
import { resolveStoreFrontUrl } from './bulkFrameProcessor';

export interface ShopAnalyticsFrameEntry {
  count: number;
  name?: string;
  imageUrl?: string;
}

export interface ShopAnalyticsDayBucket {
  visits: number;
  tryons: number;
  shares: number;
  frameTryons: Record<string, ShopAnalyticsFrameEntry>;
}

interface StoredShopAnalytics {
  days: Record<string, ShopAnalyticsDayBucket>;
}

export interface ShopLiveAnalyticsSummary {
  todayVisits: number;
  totalVisits: number;
  todayTryons: number;
  totalTryons: number;
  todayShares: number;
  totalShares: number;
  topTriedFrameToday: {
    productId: string;
    name: string;
    imageUrl?: string;
    count: number;
  } | null;
}

export const ANALYTICS_UPDATED_EVENT = 'optiverse:analytics-updated';

const STORAGE_PREFIX = 'optiverse_shop_analytics_v1_';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getAnalyticsTodayKey(): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function emptyDayBucket(): ShopAnalyticsDayBucket {
  return { visits: 0, tryons: 0, shares: 0, frameTryons: {} };
}

function readLocalAnalytics(shopId: string): StoredShopAnalytics {
  if (typeof window === 'undefined' || !shopId) return { days: {} };
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${shopId}`);
    if (!raw) return { days: {} };
    const parsed = JSON.parse(raw) as Partial<StoredShopAnalytics>;
    if (!parsed || typeof parsed !== 'object' || !parsed.days || typeof parsed.days !== 'object') {
      return { days: {} };
    }
    return { days: parsed.days };
  } catch {
    return { days: {} };
  }
}

function writeLocalAnalytics(shopId: string, data: StoredShopAnalytics): void {
  if (typeof window === 'undefined' || !shopId) return;
  try {
    // Keep up to the most recent 60 days locally so storage stays compact
    const sortedDates = Object.keys(data.days).sort();
    if (sortedDates.length > 60) {
      const pruned: Record<string, ShopAnalyticsDayBucket> = {};
      for (const d of sortedDates.slice(-60)) {
        pruned[d] = data.days[d];
      }
      data = { days: pruned };
    }
    window.localStorage.setItem(`${STORAGE_PREFIX}${shopId}`, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent(ANALYTICS_UPDATED_EVENT, { detail: { shopId } }));
  } catch {
    // Ignore quota or storage restriction errors
  }
}

async function emitSupabaseEvent(
  shopId: string,
  eventType: 'visit' | 'tryon' | 'share',
  productId?: string
): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !UUID_RE.test(shopId)) return;
  try {
    await supabase.rpc('record_shop_analytics_event', {
      p_shop_id: shopId,
      p_event_type: eventType,
      p_product_id: productId || null,
    });
  } catch {
    // Graceful no-op if offline or migration 010 not yet applied
  }
}

export function recordStoreVisit(shopId?: string): void {
  if (!shopId || typeof window === 'undefined') return;
  const todayKey = getAnalyticsTodayKey();
  const sessionKey = `optiverse_visit_${shopId}_${todayKey}`;
  try {
    if (window.sessionStorage.getItem(sessionKey) === '1') return;
    window.sessionStorage.setItem(sessionKey, '1');
  } catch {
    // Continue even if sessionStorage is restricted
  }

  const stored = readLocalAnalytics(shopId);
  const bucket = stored.days[todayKey] || emptyDayBucket();
  stored.days[todayKey] = {
    ...bucket,
    visits: (bucket.visits || 0) + 1,
  };
  writeLocalAnalytics(shopId, stored);
  void emitSupabaseEvent(shopId, 'visit');
}

export function recordStoreCameraTryOn(
  shopId?: string,
  product?: { id: string; name?: string; imageUrl?: string }
): void {
  if (!shopId || !product?.id) return;
  const todayKey = getAnalyticsTodayKey();
  const stored = readLocalAnalytics(shopId);
  const bucket = stored.days[todayKey] || emptyDayBucket();
  const prevEntry = bucket.frameTryons?.[product.id];
  const nextFrameTryons: Record<string, ShopAnalyticsFrameEntry> = {
    ...(bucket.frameTryons || {}),
    [product.id]: {
      count: (prevEntry?.count || 0) + 1,
      name: product.name || prevEntry?.name,
      imageUrl: product.imageUrl || prevEntry?.imageUrl,
    },
  };
  stored.days[todayKey] = {
    ...bucket,
    tryons: (bucket.tryons || 0) + 1,
    frameTryons: nextFrameTryons,
  };
  writeLocalAnalytics(shopId, stored);
  void emitSupabaseEvent(shopId, 'tryon', product.id);
}

export function recordStoreFriendShare(shopId?: string): void {
  if (!shopId) return;
  const todayKey = getAnalyticsTodayKey();
  const stored = readLocalAnalytics(shopId);
  const bucket = stored.days[todayKey] || emptyDayBucket();
  stored.days[todayKey] = {
    ...bucket,
    shares: (bucket.shares || 0) + 1,
  };
  writeLocalAnalytics(shopId, stored);
  void emitSupabaseEvent(shopId, 'share');
}

function summarizeDaysMap(
  days: Record<string, ShopAnalyticsDayBucket>,
  products: Product[]
): ShopLiveAnalyticsSummary {
  const todayKey = getAnalyticsTodayKey();
  let todayVisits = 0;
  let totalVisits = 0;
  let todayTryons = 0;
  let totalTryons = 0;
  let todayShares = 0;
  let totalShares = 0;

  for (const [dateKey, bucket] of Object.entries(days)) {
    const v = Math.max(0, Number(bucket.visits) || 0);
    const t = Math.max(0, Number(bucket.tryons) || 0);
    const s = Math.max(0, Number(bucket.shares) || 0);
    totalVisits += v;
    totalTryons += t;
    totalShares += s;
    if (dateKey === todayKey) {
      todayVisits += v;
      todayTryons += t;
      todayShares += s;
    }
  }

  const todayFrameMap = days[todayKey]?.frameTryons || {};
  let topTriedFrameToday: ShopLiveAnalyticsSummary['topTriedFrameToday'] = null;

  for (const [pid, entry] of Object.entries(todayFrameMap)) {
    const count = Math.max(0, Number(entry?.count) || 0);
    if (count <= 0) continue;
    if (!topTriedFrameToday || count > topTriedFrameToday.count) {
      const matched = products.find((p) => p.id === pid);
      const imageUrl =
        (matched && (resolveStoreFrontUrl(matched) || matched.processedImage || matched.images?.[0]?.imageUrl)) ||
        entry.imageUrl;
      topTriedFrameToday = {
        productId: pid,
        name: matched?.name || entry.name || 'نظارة مميزة',
        imageUrl,
        count,
      };
    }
  }

  return {
    todayVisits,
    totalVisits,
    todayTryons,
    totalTryons,
    todayShares,
    totalShares,
    topTriedFrameToday,
  };
}

export function getLocalShopLiveAnalytics(shopId: string, products: Product[]): ShopLiveAnalyticsSummary {
  const stored = readLocalAnalytics(shopId);
  return summarizeDaysMap(stored.days, products);
}

export async function fetchShopLiveAnalytics(
  shopId: string,
  products: Product[]
): Promise<ShopLiveAnalyticsSummary> {
  const local = readLocalAnalytics(shopId);
  if (!isSupabaseConfigured || !supabase || !UUID_RE.test(shopId)) {
    return summarizeDaysMap(local.days, products);
  }

  try {
    const { data, error } = await supabase
      .from('shop_daily_analytics')
      .select('stat_date, visits_count, tryons_count, shares_count, frame_tryons')
      .eq('shop_id', shopId);

    if (error || !Array.isArray(data)) {
      return summarizeDaysMap(local.days, products);
    }

    const mergedDays: Record<string, ShopAnalyticsDayBucket> = { ...local.days };
    for (const row of data) {
      const dateKey = String(row.stat_date || '').slice(0, 10);
      if (!dateKey) continue;
      const localBucket = mergedDays[dateKey] || emptyDayBucket();
      const remoteFramesRaw =
        row.frame_tryons && typeof row.frame_tryons === 'object'
          ? (row.frame_tryons as Record<string, number>)
          : {};
      const mergedFrames: Record<string, ShopAnalyticsFrameEntry> = { ...localBucket.frameTryons };
      for (const [pid, rawCount] of Object.entries(remoteFramesRaw)) {
        const remoteCount = Math.max(0, Number(rawCount) || 0);
        const existing = mergedFrames[pid];
        mergedFrames[pid] = {
          ...(existing || {}),
          count: Math.max(existing?.count || 0, remoteCount),
        };
      }

      mergedDays[dateKey] = {
        visits: Math.max(localBucket.visits || 0, Number(row.visits_count) || 0),
        tryons: Math.max(localBucket.tryons || 0, Number(row.tryons_count) || 0),
        shares: Math.max(localBucket.shares || 0, Number(row.shares_count) || 0),
        frameTryons: mergedFrames,
      };
    }

    return summarizeDaysMap(mergedDays, products);
  } catch {
    return summarizeDaysMap(local.days, products);
  }
}
