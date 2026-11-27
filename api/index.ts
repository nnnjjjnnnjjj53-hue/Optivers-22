import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type EyewearFrameMode = 'prescription' | 'sunglasses' | 'clip_on' | 'kids' | 'metal';
type EyewearSubMode = 'optical' | 'sun';

interface SplitSheetRequestBody {
  imageBase64?: unknown;
  mimeType?: unknown;
  frameType?: unknown;
  subCategory?: unknown;
  isClipOnAttachment?: unknown;
  keepLensBranding?: unknown;
  isCrystalFrame?: unknown;
  isPatterned?: unknown;
  modelCode?: unknown;
  frameColor?: unknown;
  phash?: unknown;
  lensWidthMm?: unknown;
  bridgeWidthMm?: unknown;
  templeLengthMm?: unknown;
  totalFrameWidthMm?: unknown;
}

interface ExtractDimensionsRequestBody {
  imageBase64?: unknown;
  mimeType?: unknown;
}

interface CacheSaveBody {
  modelCode?: unknown;
  frameColor?: unknown;
  phash?: unknown;
  keepLensBranding?: unknown;
  isCrystalFrame?: unknown;
  isPatterned?: unknown;
  frameType?: unknown;
  imagePath?: unknown;
  frontCatalogPath?: unknown;
  sideImagePath?: unknown;
  lensMaskUrl?: unknown;
  lensWidthMm?: unknown;
  bridgeWidthMm?: unknown;
  templeLengthMm?: unknown;
  totalFrameWidthMm?: unknown;
}

interface BatchSplitItem {
  localId: string;
  imageBase64: string;
  mimeType?: string;
  frameType?: EyewearFrameMode;
  subCategory?: EyewearSubMode;
  isClipOnAttachment?: boolean;
  keepLensBranding?: boolean;
  isCrystalFrame?: boolean;
  isPatterned?: boolean;
  modelCode?: string;
  frameColor?: string;
  phash?: string;
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
}

interface BatchSplitRequestBody {
  items?: BatchSplitItem[];
  turbo?: boolean;
}

interface AuthContext {
  userId: string;
  email: string;
  role: 'super_admin' | 'admin' | 'merchant';
  isAdmin: boolean;
  isDemoAdminStore: boolean;
  shopId: string;
  planTier: 'basic' | 'pro' | 'premium';
  remainingCredits: number;
  supabaseMode: boolean;
}

interface SharedCacheEntry {
  cacheKey: string;
  modelCode?: string | null;
  frameColor?: string | null;
  phash?: string | null;
  keepLensBranding: boolean;
  isCrystalFrame: boolean;
  isPatterned?: boolean;
  frameType: string;
  imagePath?: string | null;
  frontCatalogPath?: string | null;
  sideImagePath?: string | null;
  lensMaskUrl?: string | null;
  lensWidthMm?: number | null;
  bridgeWidthMm?: number | null;
  templeLengthMm?: number | null;
  totalFrameWidthMm?: number | null;
}

interface BatchJobState {
  jobId: string;
  geminiBatchName?: string;
  userId: string;
  status: 'processing' | 'completed' | 'failed';
  total: number;
  done: number;
  results: Record<
    string,
    {
      splitImageBase64?: string;
      mimeType?: string;
      cacheHit?: boolean;
      cachedAssets?: SharedCacheEntry;
      error?: string;
    }
  >;
  createdAt: number;
}

const ALLOWED_FRAME_MODES = new Set<EyewearFrameMode>([
  'prescription',
  'sunglasses',
  'clip_on',
  'kids',
  'metal',
]);

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_BATCH_SIZE = 50;
const MAX_AI_LOGO_GENERATIONS = 2;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120;
const VISUAL_MATCH_WINDOW_MS = 60 * 60 * 1000;
const VISUAL_MATCH_MAX_REQUESTS = 10;

const rateLimitStore = new Map<string, number[]>();
const visualMatchRateStore = new Map<string, number[]>();
const memorySharedCache = new Map<string, SharedCacheEntry>();
const memoryDemoCredits = new Map<string, number>();
const memoryLogoGenerations = new Map<string, number>();
const batchJobsStore = new Map<string, BatchJobState>();

let cachedSupabaseAdmin: SupabaseClient | null | undefined;

function getSupabaseAdminClient(): SupabaseClient | null {
  if (cachedSupabaseAdmin !== undefined) return cachedSupabaseAdmin;
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    cachedSupabaseAdmin = null;
    return null;
  }
  cachedSupabaseAdmin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedSupabaseAdmin;
}

function getConfiguredAdminEmail(): string {
  return (process.env.ADMIN_EMAIL || process.env.VITE_ADMIN_EMAIL || '').trim().toLowerCase();
}

function clampIntInRange(val: unknown, min: number, max: number): number | null {
  const num = typeof val === 'number' ? val : typeof val === 'string' && val.trim() ? Number(val) : NaN;
  if (!Number.isFinite(num)) return null;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizeCacheToken(val: unknown): string {
  return typeof val === 'string' ? val.trim().toLowerCase().replace(/[^a-z0-9#_-]+/g, '') : '';
}

export function buildSharedCacheKeys(params: {
  modelCode?: unknown;
  frameColor?: unknown;
  phash?: unknown;
  keepLensBranding?: boolean;
  isPatterned?: boolean;
}): { primaryKey: string; phashKey: string; modelCode: string; frameColor: string; phash: string } {
  const modelCode = normalizeCacheToken(params.modelCode);
  const frameColor = normalizeCacheToken(params.frameColor) || 'default';
  const phash = normalizeCacheToken(params.phash);
  const brandFlag = params.keepLensBranding ? 'brand1' : 'brand0';
  const patFlag = params.isPatterned ? 'pat1' : 'pat0';
  const primaryKey = modelCode ? `mc:${modelCode}:${frameColor}:${brandFlag}:${patFlag}` : '';
  const phashKey = phash ? `ph:${phash}:${brandFlag}:${patFlag}` : '';
  return { primaryKey, phashKey, modelCode, frameColor, phash };
}

function checkRateLimit(userKey: string): boolean {
  const now = Date.now();
  const prev = (rateLimitStore.get(userKey) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX_REQUESTS) {
    rateLimitStore.set(userKey, prev);
    return false;
  }
  prev.push(now);
  rateLimitStore.set(userKey, prev);
  return true;
}

function getClientIpKey(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(xff) ? xff[0] : typeof xff === 'string' ? xff.split(',')[0] : '';
  const raw = (forwarded || req.ip || req.socket?.remoteAddress || 'unknown').trim();
  return raw.slice(0, 80) || 'unknown';
}

function checkVisualMatchRateLimit(ipKey: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  if (visualMatchRateStore.size > 4000) {
    for (const [k, list] of visualMatchRateStore.entries()) {
      const fresh = list.filter((ts) => now - ts < VISUAL_MATCH_WINDOW_MS);
      if (fresh.length === 0) visualMatchRateStore.delete(k);
      else visualMatchRateStore.set(k, fresh);
    }
  }
  const prev = (visualMatchRateStore.get(ipKey) || []).filter((ts) => now - ts < VISUAL_MATCH_WINDOW_MS);
  if (prev.length >= VISUAL_MATCH_MAX_REQUESTS) {
    visualMatchRateStore.set(ipKey, prev);
    const oldest = prev[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((VISUAL_MATCH_WINDOW_MS - (now - oldest)) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  prev.push(now);
  visualMatchRateStore.set(ipKey, prev);
  return { allowed: true, remaining: Math.max(0, VISUAL_MATCH_MAX_REQUESTS - prev.length), retryAfterSec: 0 };
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('مفتاح Gemini API المدفوع غير مفعّل بعد — يرجى إضافته من Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isLocalPreviewMode(): boolean {
  const onVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const hasSupabaseUrl = Boolean((process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim());
  const hasServiceKey = Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim());
  return !onVercel && !hasSupabaseUrl && !hasServiceKey;
}

export async function authenticateRequest(
  req: Request,
  options: {
    requireCredits?: boolean;
    requireTurbo?: boolean;
    skipAuthForPublicRead?: boolean;
    allowPreviewWithoutAuth?: boolean;
  } = {}
): Promise<AuthContext> {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const demoShopHeader = String(req.headers['x-optiverse-demo-shop'] || '').trim();
  const demoRoleHeader = String(req.headers['x-optiverse-demo-role'] || '').trim();
  const isAdminEmailEnv = getConfiguredAdminEmail();
  const supabaseAdmin = getSupabaseAdminClient();

  if (supabaseAdmin) {
    if (!bearerToken) {
      const err = new Error('يرجى تسجيل الدخول بحساب التاجر أولاً للوصول إلى خدمات المعالجة.');
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(bearerToken);
    if (userErr || !userData?.user) {
      const err = new Error('انتهت جلسة تسجيل الدخول — يرجى إعادة تسجيل الدخول والمحاولة مجدداً.');
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }

    const user = userData.user;
    const email = (user.email || '').trim().toLowerCase();
    const rateKey = `u:${user.id}`;
    if (!checkRateLimit(rateKey)) {
      const err = new Error('تم تجاوز الحد المسموح من الطلبات في الدقيقة — انتظر لحظات ثم أعد المحاولة.');
      (err as Error & { statusCode?: number }).statusCode = 429;
      throw err;
    }

    const { data: roleRow } = await supabaseAdmin
      .from('user_roles')
      .select('role, shop_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const isSuperAdmin =
      Boolean(isAdminEmailEnv && email === isAdminEmailEnv) ||
      roleRow?.role === 'super_admin' ||
      roleRow?.role === 'admin';

    const resolvedRole: 'super_admin' | 'admin' | 'merchant' = isSuperAdmin
      ? 'super_admin'
      : 'merchant';

    let shopId = '';
    if (isSuperAdmin && demoShopHeader) {
      shopId = demoShopHeader;
    } else if (roleRow?.shop_id) {
      shopId = String(roleRow.shop_id);
    }
    if (!shopId) {
      const { data: shopByOwner } = await supabaseAdmin
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();
      if (shopByOwner?.id) shopId = String(shopByOwner.id);
    }

    let planTier: 'basic' | 'pro' | 'premium' = isSuperAdmin ? 'premium' : 'basic';
    let isDemoAdminStore = isSuperAdmin;
    let remainingCredits = isSuperAdmin ? 999_999 : 0;

    if (shopId) {
      const { data: shopRow } = await supabaseAdmin
        .from('shops')
        .select(
          'id, status, trial_ends_at, plan_tier, ai_credits_limit, ai_credits_used, topup_credits, is_demo_admin_store'
        )
        .eq('id', shopId)
        .maybeSingle();

      if (shopRow) {
        if (shopRow.plan_tier === 'pro' || shopRow.plan_tier === 'premium') {
          planTier = shopRow.plan_tier;
        }
        isDemoAdminStore = isDemoAdminStore || Boolean(shopRow.is_demo_admin_store);

        const rawLimit = Number(shopRow.ai_credits_limit ?? 25);
        const hasUnlimitedPackage = Number.isFinite(rawLimit) && rawLimit >= 99999;

        if (!isSuperAdmin && !isDemoAdminStore && !hasUnlimitedPackage && options.requireCredits) {
          const st = String(shopRow.status || 'trial');
          const trialExpired =
            st === 'trial' &&
            shopRow.trial_ends_at &&
            new Date(String(shopRow.trial_ends_at)).getTime() < Date.now();

          if (st === 'paused' || st === 'expired' || trialExpired) {
            const err = new Error(
              'انتهت الفترة التجريبية أو الاشتراك غير نشط — يرجى تفعيل أو تجديد الباقة للمتابعة.'
            );
            (err as Error & { statusCode?: number }).statusCode = 403;
            throw err;
          }

          const totalAllowed =
            (Number.isFinite(rawLimit) ? rawLimit : 25) + Number(shopRow.topup_credits ?? 0);
          const used = Number(shopRow.ai_credits_used ?? 0);
          remainingCredits = Math.max(0, totalAllowed - (Number.isFinite(used) ? used : 0));

          if (remainingCredits <= 0) {
            const err = new Error(
              'نفد رصيد المعالجة بالذكاء الاصطناعي — اشحن باقة 50 نظارة إضافية أو قم بترقية الباقة.'
            );
            (err as Error & { statusCode?: number }).statusCode = 402;
            throw err;
          }
        } else {
          const totalAllowed =
            (Number.isFinite(rawLimit) ? rawLimit : 250) + Number(shopRow.topup_credits ?? 0);
          const used = Number(shopRow.ai_credits_used ?? 0);
          remainingCredits =
            isSuperAdmin || isDemoAdminStore || hasUnlimitedPackage
              ? 999_999
              : Math.max(0, totalAllowed - (Number.isFinite(used) ? used : 0));
        }
      }
    }

    if (options.requireTurbo && !isSuperAdmin && !isDemoAdminStore && planTier === 'basic') {
      const err = new Error(
        'الرفع الفوري تيربو ⚡ متاح حصرياً في الباقة الاحترافية وبريميوم.'
      );
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    return {
      userId: user.id,
      email,
      role: resolvedRole,
      isAdmin: isSuperAdmin,
      isDemoAdminStore,
      shopId,
      planTier,
      remainingCredits,
      supabaseMode: true,
    };
  }

  // Production / Configured-Supabase / Vercel guard:
  // When not in local preview mode and SUPABASE_SERVICE_ROLE_KEY is missing, reject strictly and never trust client headers.
  if (!isLocalPreviewMode()) {
    const err = new Error('الخدمة غير مهيأة — يرجى التحقق من إعدادات المصادقة والبيئة.');
    (err as Error & { statusCode?: number }).statusCode = process.env.NODE_ENV === 'production' ? 503 : 401;
    throw err;
  }

  // Local / AI Studio Preview fallback when Supabase is not configured:
  const identityKey = bearerToken || demoShopHeader;
  if (!identityKey && !options.skipAuthForPublicRead) {
    if (options.allowPreviewWithoutAuth) {
      const previewRateKey = `preview:${req.ip || 'anon'}`;
      if (!checkRateLimit(previewRateKey)) {
        const err = new Error('تم تجاوز الحد المسموح من الطلبات — انتظر دقيقة ثم أعد المحاولة.');
        (err as Error & { statusCode?: number }).statusCode = 429;
        throw err;
      }
      return {
        userId: 'preview-merchant',
        email: 'merchant@preview.local',
        role: 'merchant',
        isAdmin: false,
        isDemoAdminStore: true,
        shopId: '11111111-1111-4111-8111-111111111101',
        planTier: 'pro',
        remainingCredits: 250,
        supabaseMode: false,
      };
    }
    const err = new Error('يرجى تسجيل الدخول بحساب التاجر أولاً لاستخدام خدمات المعالجة.');
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }

  const rateKey = `local:${identityKey || req.ip || 'anon'}`;
  if (!checkRateLimit(rateKey)) {
    const err = new Error('تم تجاوز الحد المسموح من الطلبات — انتظر دقيقة ثم أعد المحاولة.');
    (err as Error & { statusCode?: number }).statusCode = 429;
    throw err;
  }

  const isSuperAdmin =
    demoRoleHeader === 'super_admin' ||
    demoRoleHeader === 'admin' ||
    String(req.headers['x-optiverse-admin-demo'] || '') === '1';

  const planTierHeader = String(req.headers['x-optiverse-plan-tier'] || 'pro');
  const planTier: 'basic' | 'pro' | 'premium' =
    planTierHeader === 'premium' ? 'premium' : planTierHeader === 'pro' ? 'pro' : 'basic';

  const creditKey = demoShopHeader || identityKey || 'default';
  if (!memoryDemoCredits.has(creditKey)) {
    memoryDemoCredits.set(creditKey, 250);
  }
  const rem = isSuperAdmin ? 999_999 : (memoryDemoCredits.get(creditKey) ?? 250);

  if (options.requireCredits && !isSuperAdmin && rem <= 0) {
    const err = new Error(
      'نفد رصيد المعالجة بالذكاء الاصطناعي في الحساب — اشحن باقة إضافية أو قم بترقية الباقة.'
    );
    (err as Error & { statusCode?: number }).statusCode = 402;
    throw err;
  }

  if (options.requireTurbo && !isSuperAdmin && planTier === 'basic') {
    const err = new Error('الرفع الفوري تيربو ⚡ متاح حصرياً في الباقة الاحترافية وبريميوم.');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  return {
    userId: identityKey || 'preview-user',
    email: isSuperAdmin ? isAdminEmailEnv : 'merchant@preview.local',
    role: isSuperAdmin ? 'super_admin' : 'merchant',
    isAdmin: isSuperAdmin,
    isDemoAdminStore: isSuperAdmin,
    shopId: demoShopHeader || '11111111-1111-4111-8111-111111111101',
    planTier,
    remainingCredits: rem,
    supabaseMode: false,
  };
}

async function deductAiCredit(ctx: AuthContext, amount = 1): Promise<void> {
  if (ctx.isAdmin || ctx.isDemoAdminStore || ctx.remainingCredits >= 99999 || amount <= 0) return;

  const supabaseAdmin = getSupabaseAdminClient();
  if (supabaseAdmin && ctx.shopId) {
    const { data, error } = await supabaseAdmin.rpc('consume_ai_credits', {
      p_shop_id: ctx.shopId,
      p_amount: amount,
    });
    if (error || !data) {
      const err = new Error(
        'نفد رصيد المعالجة بالذكاء الاصطناعي — اشحن باقة 50 نظارة إضافية أو قم بترقية الباقة.'
      );
      (err as Error & { statusCode?: number }).statusCode = 402;
      throw err;
    }
    return;
  }

  const key = ctx.shopId || ctx.userId || 'default';
  const cur = memoryDemoCredits.get(key) ?? 250;
  if (cur < amount) {
    const err = new Error(
      'نفد رصيد المعالجة بالذكاء الاصطناعي في الحساب — اشحن باقة إضافية أو قم بترقية الباقة.'
    );
    (err as Error & { statusCode?: number }).statusCode = 402;
    throw err;
  }
  memoryDemoCredits.set(key, Math.max(0, cur - amount));
}

async function findSharedCacheMatch(params: {
  modelCode?: unknown;
  frameColor?: unknown;
  phash?: unknown;
  keepLensBranding: boolean;
  isPatterned?: boolean;
}): Promise<{ exact: SharedCacheEntry | null; solidTemplate: SharedCacheEntry | null }> {
  const keys = buildSharedCacheKeys(params);
  if (!keys.primaryKey && !keys.phashKey) return { exact: null, solidTemplate: null };

  const supabaseAdmin = getSupabaseAdminClient();
  if (supabaseAdmin) {
    if (keys.primaryKey) {
      const { data } = await supabaseAdmin
        .from('shared_eyewear_cache')
        .select('*')
        .eq('cache_key', keys.primaryKey)
        .maybeSingle();
      if (data) {
        await supabaseAdmin
          .from('shared_eyewear_cache')
          .update({ hit_count: Number(data.hit_count ?? 0) + 1 })
          .eq('id', data.id);
        return {
          exact: {
            cacheKey: data.cache_key,
            modelCode: data.model_code,
            frameColor: data.frame_color,
            phash: data.phash,
            keepLensBranding: Boolean(data.keep_lens_branding),
            isCrystalFrame: Boolean(data.is_crystal_frame),
            isPatterned: String(data.cache_key || '').includes(':pat1'),
            frameType: data.frame_type || 'prescription',
            imagePath: data.image_path,
            frontCatalogPath: data.front_catalog_path,
            sideImagePath: data.side_image_path,
            lensMaskUrl: data.lens_mask_url,
            lensWidthMm: data.lens_width_mm,
            bridgeWidthMm: data.bridge_width_mm,
            templeLengthMm: data.temple_length_mm,
            totalFrameWidthMm: data.total_frame_width_mm,
          },
          solidTemplate: null,
        };
      }
    }

    if (keys.phash) {
      const { data } = await supabaseAdmin
        .from('shared_eyewear_cache')
        .select('*')
        .eq('phash', keys.phash)
        .eq('keep_lens_branding', params.keepLensBranding)
        .limit(1)
        .maybeSingle();
      if (data) {
        await supabaseAdmin
          .from('shared_eyewear_cache')
          .update({ hit_count: Number(data.hit_count ?? 0) + 1 })
          .eq('id', data.id);
        return {
          exact: {
            cacheKey: data.cache_key,
            modelCode: data.model_code,
            frameColor: data.frame_color,
            phash: data.phash,
            keepLensBranding: Boolean(data.keep_lens_branding),
            isCrystalFrame: Boolean(data.is_crystal_frame),
            isPatterned: String(data.cache_key || '').includes(':pat1'),
            frameType: data.frame_type || 'prescription',
            imagePath: data.image_path,
            frontCatalogPath: data.front_catalog_path,
            sideImagePath: data.side_image_path,
            lensMaskUrl: data.lens_mask_url,
            lensWidthMm: data.lens_width_mm,
            bridgeWidthMm: data.bridge_width_mm,
            templeLengthMm: data.temple_length_mm,
            totalFrameWidthMm: data.total_frame_width_mm,
          },
          solidTemplate: null,
        };
      }
    }

    // Solid-color cross-store template match ONLY when incoming frame is uniform solid color (!isPatterned)
    if (!params.isPatterned && keys.modelCode) {
      const { data: siblings } = await supabaseAdmin
        .from('shared_eyewear_cache')
        .select('*')
        .eq('model_code', keys.modelCode)
        .eq('keep_lens_branding', params.keepLensBranding)
        .limit(5);
      const solidRow = (siblings || []).find(
        (r: any) => !String(r.cache_key || '').includes(':pat1') && (r.front_catalog_path || r.image_path)
      );
      if (solidRow) {
        return {
          exact: null,
          solidTemplate: {
            cacheKey: solidRow.cache_key,
            modelCode: solidRow.model_code,
            frameColor: solidRow.frame_color,
            phash: solidRow.phash,
            keepLensBranding: Boolean(solidRow.keep_lens_branding),
            isCrystalFrame: Boolean(solidRow.is_crystal_frame),
            isPatterned: false,
            frameType: solidRow.frame_type || 'prescription',
            imagePath: solidRow.image_path,
            frontCatalogPath: solidRow.front_catalog_path,
            sideImagePath: solidRow.side_image_path,
            lensMaskUrl: solidRow.lens_mask_url,
            lensWidthMm: solidRow.lens_width_mm,
            bridgeWidthMm: solidRow.bridge_width_mm,
            templeLengthMm: solidRow.temple_length_mm,
            totalFrameWidthMm: solidRow.total_frame_width_mm,
          },
        };
      }
    }
  }

  if (keys.primaryKey && memorySharedCache.has(keys.primaryKey)) {
    return { exact: memorySharedCache.get(keys.primaryKey)!, solidTemplate: null };
  }
  if (keys.phashKey && memorySharedCache.has(keys.phashKey)) {
    return { exact: memorySharedCache.get(keys.phashKey)!, solidTemplate: null };
  }
  if (!params.isPatterned && keys.modelCode) {
    for (const entry of memorySharedCache.values()) {
      if (
        normalizeCacheToken(entry.modelCode) === keys.modelCode &&
        entry.keepLensBranding === params.keepLensBranding &&
        !entry.isPatterned &&
        (entry.frontCatalogPath || entry.imagePath)
      ) {
        return { exact: null, solidTemplate: entry };
      }
    }
  }
  return { exact: null, solidTemplate: null };
}

async function saveSharedCacheEntry(entry: SharedCacheEntry): Promise<void> {
  const keys = buildSharedCacheKeys({
    modelCode: entry.modelCode,
    frameColor: entry.frameColor,
    phash: entry.phash,
    keepLensBranding: entry.keepLensBranding,
    isPatterned: entry.isPatterned,
  });

  if (keys.primaryKey) memorySharedCache.set(keys.primaryKey, entry);
  if (keys.phashKey) memorySharedCache.set(keys.phashKey, entry);

  const supabaseAdmin = getSupabaseAdminClient();
  if (supabaseAdmin && (keys.primaryKey || keys.phashKey)) {
    const cacheKey = keys.primaryKey || keys.phashKey;
    await supabaseAdmin.from('shared_eyewear_cache').upsert(
      {
        cache_key: cacheKey,
        model_code: keys.modelCode || null,
        frame_color: keys.frameColor || null,
        phash: keys.phash || null,
        keep_lens_branding: entry.keepLensBranding,
        is_crystal_frame: entry.isCrystalFrame,
        frame_type: entry.frameType,
        image_path: entry.imagePath || null,
        front_catalog_path: entry.frontCatalogPath || null,
        side_image_path: entry.sideImagePath || null,
        lens_mask_url: entry.lensMaskUrl || null,
        lens_width_mm: entry.lensWidthMm || null,
        bridge_width_mm: entry.bridgeWidthMm || null,
        temple_length_mm: entry.templeLengthMm || null,
        total_frame_width_mm: entry.totalFrameWidthMm || null,
      },
      { onConflict: 'cache_key' }
    );
  }
}

export function buildEyewearSplitSheetPrompt(params: {
  frameType: EyewearFrameMode;
  subCategory: EyewearSubMode;
  isClipOnAttachment: boolean;
  keepLensBranding?: boolean;
  isCrystalFrame?: boolean;
  lensWidthMm?: number | null;
  bridgeWidthMm?: number | null;
  templeLengthMm?: number | null;
  totalFrameWidthMm?: number | null;
}): string {
  const isSun =
    params.frameType === 'sunglasses' ||
    params.subCategory === 'sun' ||
    params.isClipOnAttachment;

  const crystalLeftBgRule = params.isCrystalFrame
    ? [
        '- CRYSTAL/TRANSPARENT ACETATE SPECIAL BACKGROUND RULE:',
        '  * Place the transparent/crystal frame on a completely flat PURE #FFFFFF WHITE studio background filling the entire LEFT HALF (do NOT use green chroma key so ZERO green tint/spill contaminates transparent acetate edges).',
      ].join('\n')
    : [
        '- Place it on a completely flat, solid, uniform Chroma-Key studio color filling the entire LEFT HALF:',
        '  * Use solid pure #0000FF blue if the frame is clear, transparent, white, silver, or light metal;',
        '  * Use solid pure #00FF00 green if the frame is dark, black, brown, tortoiseshell, gold, or colored;',
        '  * Use solid pure #FF00FF magenta ONLY if the frame itself is green.',
      ].join('\n');

  const lensBrandingRule = params.keepLensBranding
    ? 'LENS BRANDING RULE: PRESERVE the authentic printed brand logo, demo mark, or model code text cleanly inside the lens across both halves while removing dust, stands, and background glare.'
    : 'LENS BRANDING & CLEANING RULE: COMPLETELY ERASE any printed brand logos, white ink text, model code stamps, demo markings, and stickers inside BOTH lenses so both lenses are 100% clean transparent optical glass.';

  const lensRule = isSun
    ? `Keep the original dark, tinted, gradient, or mirrored sunglasses lenses 100% intact with their natural color, density, and tint across BOTH halves. ${
        params.keepLensBranding
          ? 'Preserve small corner brand markings if printed on the lens.'
          : 'Remove any temporary store stickers or price tags on the lens.'
      }`
    : `In the LEFT HALF, BOTH lens openings MUST be 100% hollow and empty showing ONLY the exact flat background color inside the rims (completely remove stands, bottle caps, table surfaces, reflections, and folded side temples visible behind the lenses). ${lensBrandingRule}`;

  const metalRule =
    params.frameType === 'metal'
      ? 'This is a metal / half-rim / rimless frame: keep thin ~1mm metal wires, bridges, and nose-pad arms razor-sharp and crisp without eroding them, and render clean polished glass bevel edges along frameless/half-rim lenses.'
      : '';

  const clipOnRule =
    params.frameType === 'clip_on'
      ? params.isClipOnAttachment
        ? 'Accurately preserve the attached magnetic dark sun clip-on visor mounted securely on top of the optical frame across BOTH halves.'
        : 'Show ONLY the base optical frame without any magnetic clip-on attached across BOTH halves.'
      : '';

  const kidsRule =
    params.frameType === 'kids'
      ? 'Preserve the compact pediatric eyewear proportions cleanly.'
      : '';

  const opticalSizeRule =
    params.lensWidthMm && params.bridgeWidthMm && params.templeLengthMm
      ? `PHYSICAL PROPORTION ACCURACY: Maintain true-to-scale physical geometry matching ${params.lensWidthMm}mm lens width, ${params.bridgeWidthMm}mm nose bridge gap, and ${params.templeLengthMm}mm temple arm length (total frame front width ~${params.totalFrameWidthMm || 2 * params.lensWidthMm + params.bridgeWidthMm + 10}mm) across both halves.`
      : '';

  return [
    'Generate a single ultra-clean 16:9 horizontal split-screen product studio sheet divided strictly at the exact vertical center (x = 50% width), with ZERO dividing line, ZERO border, ZERO text, ZERO labels, and ZERO watermark.',
    '',
    'LEFT HALF (0% to 50% width — Virtual Try-On Orthographic Front Cutout Base):',
    '- Show a strict flat 100% straight orthographic front view of ONLY the front face of the eyewear frame from the input photo, with both side temples/arms completely folded and hidden behind the front frame.',
    '- Center the eyewear horizontally and vertically inside the LEFT HALF only (leaving clean margin inside 0%..50% so nothing crosses x = 50%).',
    crystalLeftBgRule,
    '- ZERO gradients, ZERO shadows, and ZERO highlights on the left-half background.',
    `- ${lensRule}`,
    '',
    'RIGHT HALF (50% to 100% width — 3/4 Three-Quarter Side Studio Catalog Shot):',
    '- Re-render the EXACT SAME eyewear frame from a ~35-degree 3/4 three-quarter side perspective angle facing slightly toward the center-left, clearly showing the open full side temple/arm, hinge hardware, nose pads, and curved ear tip.',
    `- Center the 3/4 view cleanly inside the RIGHT HALF (50%..100%) on a completely solid #F8F9FA snow-white studio background with even Warby Parker-style lighting and a soft, realistic natural studio contact shadow directly beneath the bottom rims and temple tips. ${
      !isSun ? lensBrandingRule : ''
    }`,
    '',
    'STRICT COLOR & MATERIAL PRESERVATION RULES:',
    '- Preserve 100% of the exact original RGB color, shade, finish, opacity, and solid vs. patterned surface from the input photo.',
    '- If the input frame is crystal clear/transparent acetate, keep it pure neutral crystal clear with ZERO green or blue color cast or tint.',
    '- NEVER invent tortoiseshell or marbled patterns on solid-color frames, and never alter metallic gold/silver/gunmetal tones.',
    '- Completely remove all props, stands, hands, tables, walls, and clutter from the input photo.',
    opticalSizeRule,
    metalRule,
    clipOnRule,
    kidsRule,
  ]
    .filter(Boolean)
    .join('\n');
}

async function generateSplitSheetWithFallback(
  ai: GoogleGenAI,
  cleanBase64: string,
  safeMimeType: string,
  prompt: string
): Promise<{ splitImageBase64: string; mimeType: string; modelUsed: string }> {
  const errors: string[] = [];

  // 1) Primary model: gemini-2.5-flash-image (multimodal image editing + split-sheet generation)
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: safeMimeType,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: '16:9',
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return {
          splitImageBase64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'image/png',
          modelUsed: 'gemini-2.5-flash-image',
        };
      }
    }
    errors.push('gemini-2.5-flash-image: لم يُرجع صورة في الاستجابة');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`gemini-2.5-flash-image: ${msg}`);
  }

  // 2) Automatic fallback: imagen-3.0-generate-002
  try {
    const imagenRes = await ai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '16:9',
      },
    });
    const imgObj = imagenRes?.generatedImages?.[0]?.image;
    if (imgObj?.imageBytes) {
      return {
        splitImageBase64: imgObj.imageBytes,
        mimeType: imgObj.mimeType || 'image/png',
        modelUsed: 'imagen-3.0-generate-002',
      };
    }
    errors.push('imagen-3.0-generate-002: لم يُرجع صورة في الاستجابة');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`imagen-3.0-generate-002: ${msg}`);
  }

  const finalError = new Error(
    errors.filter(Boolean).join(' | ') || 'تعذر توليد لوحة الاستوديو (16:9) عبر نماذج الذكاء الاصطناعي'
  );
  (finalError as Error & { statusCode?: number }).statusCode = 502;
  throw finalError;
}

export function createEyewearServerApp() {
  const app = express();
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/api')) {
      res.setHeader('X-Frame-Options', 'DENY');
    }
    next();
  });
  app.use(express.json({ limit: '24mb' }));

  // 1. Auth Role Bootstrap & 1-Click Super Admin Demo Store Provisioning
  app.post('/api/auth/bootstrap', async (req: Request, res: Response) => {
    try {
      const ctx = await authenticateRequest(req, { requireCredits: false });
      const action = String((req.body || {}).action || 'resolve');
      const supabaseAdmin = getSupabaseAdminClient();

      if (action === 'ensure_demo_store' && ctx.isAdmin) {
        if (supabaseAdmin) {
          const { data: existingDemo } = await supabaseAdmin
            .from('shops')
            .select('id, slug')
            .eq('is_demo_admin_store', true)
            .maybeSingle();

          if (existingDemo?.id) {
            res.json({
              ok: true,
              role: 'super_admin',
              shopId: existingDemo.id,
              slug: existingDemo.slug,
              isDemoAdminStore: true,
            });
            return;
          }

          const { data: createdDemo } = await supabaseAdmin
            .from('shops')
            .insert({
              owner_id: ctx.userId,
              owner_name: 'حساب المعاينة (أدمن)',
              owner_email: ctx.email,
              name: 'متجر OptiVerse التجريبي',
              city: 'القاهرة',
              governorate: 'القاهرة',
              address: 'مقر الإدارة التجريبي',
              onboarding_completed: true,
              is_demo_admin_store: true,
              is_featured: true,
              enable_delivery_service: true,
              plan_tier: 'premium',
              plan_name: 'بريميوم',
              status: 'active',
              ai_credits_limit: 999999,
              slug: `admin-demo-${Date.now().toString(36)}`,
              color: '#0284C7',
              wa_phone: '01001234567',
              logo: '⭐',
            })
            .select('id, slug')
            .single();

          res.json({
            ok: true,
            role: 'super_admin',
            shopId: createdDemo?.id || ctx.shopId,
            slug: createdDemo?.slug || 'optivibe',
            isDemoAdminStore: true,
          });
          return;
        }
      }

      if (supabaseAdmin && ctx.isAdmin) {
        await supabaseAdmin.from('user_roles').upsert(
          {
            user_id: ctx.userId,
            email: ctx.email,
            role: 'super_admin',
            shop_id: ctx.shopId || null,
          },
          { onConflict: 'user_id' }
        );
      }

      res.json({
        ok: true,
        role: ctx.role,
        shopId: ctx.shopId,
        isDemoAdminStore: ctx.isDemoAdminStore,
        planTier: ctx.planTier,
      });
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode || 401;
      res.status(code).json({
        error: err instanceof Error ? err.message : 'تعذر التحقق من صلاحيات الحساب',
      });
    }
  });

  // 2. Zero-Cost OCR Dimension, Model Code & Crystal Frame Extraction (gemini-3.5-flash-lite)
  app.post('/api/eyewear/extract-dimensions', async (req: Request, res: Response) => {
    try {
      await authenticateRequest(req, { requireCredits: false, allowPreviewWithoutAuth: true });

      const body = (req.body || {}) as ExtractDimensionsRequestBody;
      const rawBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      const rawMime = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'image/jpeg';

      if (!rawBase64) {
        res.status(400).json({ error: 'بيانات الصورة مفقودة في الطلب' });
        return;
      }

      const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      if (cleanBase64.length > 20_000_000) {
        res.status(413).json({ error: 'حجم الصورة يتجاوز الحد المسموح به (15MB)' });
        return;
      }

      const safeMimeType = ALLOWED_MIME_TYPES.has(rawMime) ? rawMime : 'image/jpeg';
      const ai = getGeminiClient();

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: safeMimeType,
              },
            },
            {
              text: [
                'Inspect this eyewear photo carefully for:',
                '1. Printed optical sizing specification on the inner temple arm, nose bridge, lens sticker, or price tag (e.g., 52□18-140, 50-19-142, 48[]17 135).',
                '2. Brand or model code printed on the temple or lens (e.g., RB3025, RB2140, GG0061S, TF5178) — set null if absent.',
                '3. Whether the eyewear frame material is transparent/crystal/clear acetate (is_crystal_frame=true if see-through clear plastic/crystal; false otherwise).',
                '4. Frame silhouette shape (frame_shape): choose one of round, oval, square, cat_eye, aviator.',
                '5. Whether the frame has a multi-color or patterned texture (is_patterned=true for tortoiseshell, havana, leopard, marbled, two-tone, mix-color acetate; false for single solid color or uniform metal).',
                '6. Frame color family (color_family): choose one of black, brown_tortoise, clear, metal, other.',
                '7. Automatic frame classification mode (auto_frame_mode): choose strictly one of prescription, sunglasses, clip_on, kids, metal:',
                '   - kids: compact pediatric/children proportions or child styling/sizing (e.g. lens width <= 46mm).',
                '   - clip_on: frame visibly wearing a magnetic sun clip-on visor attachment over an optical rim.',
                '   - sunglasses: dark, tinted, gradient, or mirrored sun lenses (not clear optical lenses).',
                '   - metal: thin metal wire, half-rim (nylor), or rimless frame with clear optical lenses.',
                '   - prescription: standard acetate/plastic optical frame with clear lenses.',
                '8. Lens tint state (lens_tint): choose strictly clear (transparent/empty optical lenses) or tinted (dark, colored, gradient, or mirrored sunglasses/clip-on lenses).',
                'Extract three integer millimeter values if clearly legible: lens_width_mm (35..70), bridge_width_mm (10..30), temple_length_mm (110..165).',
                'If sizing numbers are absent, set found=false and return null for unknown numbers. Never invent numbers.',
              ].join('\n'),
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              found: { type: Type.BOOLEAN },
              lens_width_mm: { type: Type.INTEGER, nullable: true },
              bridge_width_mm: { type: Type.INTEGER, nullable: true },
              temple_length_mm: { type: Type.INTEGER, nullable: true },
              model_code: { type: Type.STRING, nullable: true },
              is_crystal_frame: { type: Type.BOOLEAN },
              frame_shape: {
                type: Type.STRING,
                enum: ['round', 'oval', 'square', 'cat_eye', 'aviator'],
              },
              is_patterned: { type: Type.BOOLEAN },
              color_family: {
                type: Type.STRING,
                enum: ['black', 'brown_tortoise', 'clear', 'metal', 'other'],
              },
              auto_frame_mode: {
                type: Type.STRING,
                enum: ['prescription', 'sunglasses', 'clip_on', 'kids', 'metal'],
              },
              lens_tint: {
                type: Type.STRING,
                enum: ['clear', 'tinted'],
              },
              raw_text: { type: Type.STRING, nullable: true },
            },
            required: [
              'found',
              'is_crystal_frame',
              'frame_shape',
              'is_patterned',
              'color_family',
              'auto_frame_mode',
              'lens_tint',
            ],
          },
        },
      });

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(response.text || '{}') as Record<string, unknown>;
      } catch {
        parsed = {};
      }

      const lens = clampIntInRange(parsed.lens_width_mm, 35, 70);
      const bridge = clampIntInRange(parsed.bridge_width_mm, 10, 30);
      const temple = clampIntInRange(parsed.temple_length_mm, 110, 165);
      const found = Boolean(parsed.found) && lens !== null && bridge !== null;
      const modelCode =
        typeof parsed.model_code === 'string' && parsed.model_code.trim()
          ? parsed.model_code.trim().slice(0, 48)
          : null;
      const allowedShapes = new Set(['round', 'oval', 'square', 'cat_eye', 'aviator']);
      const allowedColors = new Set(['black', 'brown_tortoise', 'clear', 'metal', 'other']);
      const allowedTints = new Set(['clear', 'tinted']);
      const frameShape =
        typeof parsed.frame_shape === 'string' && allowedShapes.has(parsed.frame_shape)
          ? parsed.frame_shape
          : 'square';
      const colorFamily =
        typeof parsed.color_family === 'string' && allowedColors.has(parsed.color_family)
          ? parsed.color_family
          : parsed.is_crystal_frame
          ? 'clear'
          : 'other';
      const autoFrameMode: EyewearFrameMode =
        typeof parsed.auto_frame_mode === 'string' &&
        ALLOWED_FRAME_MODES.has(parsed.auto_frame_mode as EyewearFrameMode)
          ? (parsed.auto_frame_mode as EyewearFrameMode)
          : 'prescription';
      const lensTint: 'clear' | 'tinted' =
        typeof parsed.lens_tint === 'string' && allowedTints.has(parsed.lens_tint)
          ? (parsed.lens_tint as 'clear' | 'tinted')
          : autoFrameMode === 'sunglasses' || autoFrameMode === 'clip_on'
          ? 'tinted'
          : 'clear';

      res.json({
        ok: true,
        found,
        lens_width_mm: lens,
        bridge_width_mm: bridge,
        temple_length_mm: temple,
        total_frame_width_mm: lens !== null && bridge !== null ? 2 * lens + bridge + 10 : null,
        model_code: modelCode,
        is_crystal_frame: Boolean(parsed.is_crystal_frame),
        frame_shape: frameShape,
        is_patterned: Boolean(parsed.is_patterned),
        color_family: colorFamily,
        auto_frame_mode: autoFrameMode,
        lens_tint: lensTint,
        raw_text: typeof parsed.raw_text === 'string' ? parsed.raw_text.slice(0, 64) : null,
      });
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode;
      const message =
        err instanceof Error ? err.message : 'تعذّر فحص مقاسات النظارة عبر الخادم';
      const status =
        code ||
        (message.includes('GEMINI_API_KEY') || message.includes('Settings > Secrets') ? 503 : 500);
      res.status(status).json({ error: message });
    }
  });

  // 3. Shared Catalog Cache Save (called by merchant browser after uploading WebP assets)
  app.post('/api/eyewear/cache-save', async (req: Request, res: Response) => {
    try {
      await authenticateRequest(req, { requireCredits: false, allowPreviewWithoutAuth: true });
      const body = (req.body || {}) as CacheSaveBody;
      const keepLensBranding = Boolean(body.keepLensBranding);
      const isPatterned = Boolean(body.isPatterned);
      const modelCode = typeof body.modelCode === 'string' ? body.modelCode.trim() : '';
      const frameColor = typeof body.frameColor === 'string' ? body.frameColor.trim() : '';
      const phash = typeof body.phash === 'string' ? body.phash.trim() : '';

      if (!modelCode && !phash) {
        res.json({ ok: true, skipped: true });
        return;
      }

      const keys = buildSharedCacheKeys({ modelCode, frameColor, phash, keepLensBranding, isPatterned });
      await saveSharedCacheEntry({
        cacheKey: keys.primaryKey || keys.phashKey,
        modelCode: modelCode || null,
        frameColor: frameColor || null,
        phash: phash || null,
        keepLensBranding,
        isCrystalFrame: Boolean(body.isCrystalFrame),
        isPatterned,
        frameType: typeof body.frameType === 'string' ? body.frameType : 'prescription',
        imagePath: typeof body.imagePath === 'string' ? body.imagePath : null,
        frontCatalogPath: typeof body.frontCatalogPath === 'string' ? body.frontCatalogPath : null,
        sideImagePath: typeof body.sideImagePath === 'string' ? body.sideImagePath : null,
        lensMaskUrl: typeof body.lensMaskUrl === 'string' ? body.lensMaskUrl : null,
        lensWidthMm: clampIntInRange(body.lensWidthMm, 35, 70),
        bridgeWidthMm: clampIntInRange(body.bridgeWidthMm, 10, 30),
        templeLengthMm: clampIntInRange(body.templeLengthMm, 110, 165),
        totalFrameWidthMm: clampIntInRange(body.totalFrameWidthMm, 95, 175),
      });

      res.json({ ok: true });
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode || 500;
      res.status(code).json({
        error: err instanceof Error ? err.message : 'تعذر حفظ النسخة في الكتالوج المشترك',
      });
    }
  });

  // 4. Protected Single-Call 16:9 Split Sheet (Auth + Credit Guard + Shared Cache + Model Fallback)
  const handleSplitSheetRequest = async (req: Request, res: Response) => {
    try {
      const ctx = await authenticateRequest(req, { requireCredits: true, allowPreviewWithoutAuth: true });
      const body = (req.body || {}) as SplitSheetRequestBody;
      const keepLensBranding = Boolean(body.keepLensBranding);
      const isCrystalFrame = Boolean(body.isCrystalFrame);
      const isPatterned = Boolean(body.isPatterned);

      // Step A: Query Global Shared Catalog Cache BEFORE touching Gemini or image buffers
      const cacheMatch = await findSharedCacheMatch({
        modelCode: body.modelCode,
        frameColor: body.frameColor,
        phash: body.phash,
        keepLensBranding,
        isPatterned,
      });

      if (cacheMatch.exact && (cacheMatch.exact.frontCatalogPath || cacheMatch.exact.imagePath)) {
        // Immediately discard incoming uploaded image data — $0.00 Gemini cost & 0 credit deduction
        res.json({
          ok: true,
          cacheHit: true,
          cachedAssets: cacheMatch.exact,
          messageAr: 'تم استرجاع الموديل من الكتالوج المشترك بدون استهلاك رصيد ⚡',
        });
        return;
      }

      if (
        !isPatterned &&
        cacheMatch.solidTemplate &&
        (cacheMatch.solidTemplate.frontCatalogPath || cacheMatch.solidTemplate.imagePath)
      ) {
        res.json({
          ok: true,
          cacheHit: false,
          solidModelTemplate: cacheMatch.solidTemplate,
          messageAr: 'تمت مطابقة الموديل بلون سادة لإعادة التلوين محلياً بدون استهلاك رصيد 🎨',
        });
        return;
      }

      const rawBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      const rawMime = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'image/jpeg';

      if (!rawBase64) {
        res.status(400).json({ error: 'بيانات الصورة مفقودة في الطلب' });
        return;
      }

      const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      if (cleanBase64.length > 20_000_000) {
        res.status(413).json({ error: 'حجم الصورة يتجاوز الحد المسموح به (15MB)' });
        return;
      }

      const safeMimeType = ALLOWED_MIME_TYPES.has(rawMime) ? rawMime : 'image/jpeg';
      const frameType: EyewearFrameMode = ALLOWED_FRAME_MODES.has(body.frameType as EyewearFrameMode)
        ? (body.frameType as EyewearFrameMode)
        : 'prescription';
      const subCategory: EyewearSubMode = body.subCategory === 'sun' ? 'sun' : 'optical';
      const isClipOnAttachment = Boolean(body.isClipOnAttachment);
      const lensWidthMm = clampIntInRange(body.lensWidthMm, 35, 70);
      const bridgeWidthMm = clampIntInRange(body.bridgeWidthMm, 10, 30);
      const templeLengthMm = clampIntInRange(body.templeLengthMm, 110, 165);
      const totalFrameWidthMm =
        lensWidthMm && bridgeWidthMm
          ? 2 * lensWidthMm + bridgeWidthMm + 10
          : clampIntInRange(body.totalFrameWidthMm, 95, 175);

      const ai = getGeminiClient();
      const prompt = buildEyewearSplitSheetPrompt({
        frameType,
        subCategory,
        isClipOnAttachment,
        keepLensBranding,
        isCrystalFrame,
        lensWidthMm,
        bridgeWidthMm,
        templeLengthMm,
        totalFrameWidthMm,
      });

      const generated = await generateSplitSheetWithFallback(ai, cleanBase64, safeMimeType, prompt);
      if (!generated?.splitImageBase64) {
        res.status(502).json({
          error: 'لم يُرجع نموذج الذكاء الاصطناعي صورة لوحة الاستوديو',
        });
        return;
      }

      await deductAiCredit(ctx, 1);

      res.json({
        ok: true,
        splitImageBase64: generated.splitImageBase64,
        mimeType: generated.mimeType || 'image/png',
        modelUsed: generated.modelUsed,
        cacheHit: false,
      });
    } catch (err) {
      const rawCode = (err as Error & { statusCode?: number }).statusCode;
      const message =
        err instanceof Error ? err.message : 'تعذر الاتصال بخدمة توليد صور الاستوديو';
      const status =
        rawCode && rawCode >= 400
          ? rawCode
          : message.includes('GEMINI_API_KEY') || message.includes('Settings > Secrets')
          ? 503
          : 500;
      res.status(status).json({ error: message });
    }
  };

  app.post('/api/eyewear/split-sheet', handleSplitSheetRequest);
  app.post('/api/eyewear/generate-studio-sheet', handleSplitSheetRequest);

  // 5. Gemini Batch API Bulk Processing Endpoint (50-item batch limit + 50% batch discount default vs Pro/Premium Turbo)
  app.post('/api/eyewear/batch-split-sheet', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as BatchSplitRequestBody;
      const turbo = Boolean(body.turbo);
      const ctx = await authenticateRequest(req, {
        requireCredits: true,
        requireTurbo: turbo,
        allowPreviewWithoutAuth: true,
      });

      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) {
        res.status(400).json({ error: 'قائمة الصور المرفوعة فارغة' });
        return;
      }
      if (items.length > MAX_BATCH_SIZE) {
        res.status(400).json({
          error: `الحد الأقصى للدفعة الواحدة هو ${MAX_BATCH_SIZE} صورة.`,
        });
        return;
      }

      if (!ctx.isAdmin && !ctx.isDemoAdminStore && items.length > ctx.remainingCredits) {
        res.status(402).json({
          error: `رصيدك المتاح (${ctx.remainingCredits}) لا يكفي لمعالجة ${items.length} نظارة — قم بالشحن أو الترقية.`,
        });
        return;
      }

      const jobId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const job: BatchJobState = {
        jobId,
        userId: ctx.userId,
        status: 'processing',
        total: items.length,
        done: 0,
        results: {},
        createdAt: Date.now(),
      };
      batchJobsStore.set(jobId, job);

      const ai = getGeminiClient();



      const processQueueAsync = async () => {
        const concurrency = turbo ? 4 : 2;
        let idx = 0;

        const worker = async () => {
          while (idx < items.length) {
            const current = items[idx++];
            try {
              const keepLensBranding = Boolean(current.keepLensBranding);
              const cacheMatch = await findSharedCacheMatch({
                modelCode: current.modelCode,
                frameColor: current.frameColor,
                phash: current.phash,
                keepLensBranding,
                isPatterned: Boolean(current.isPatterned),
              });

              if (cacheMatch.exact && (cacheMatch.exact.frontCatalogPath || cacheMatch.exact.imagePath)) {
                job.results[current.localId] = {
                  cacheHit: true,
                  cachedAssets: cacheMatch.exact,
                };
              } else {
                const prompt = buildEyewearSplitSheetPrompt({
                  frameType: ALLOWED_FRAME_MODES.has(current.frameType as EyewearFrameMode)
                    ? (current.frameType as EyewearFrameMode)
                    : 'prescription',
                  subCategory: current.subCategory === 'sun' ? 'sun' : 'optical',
                  isClipOnAttachment: Boolean(current.isClipOnAttachment),
                  keepLensBranding,
                  isCrystalFrame: Boolean(current.isCrystalFrame),
                  lensWidthMm: current.lensWidthMm,
                  bridgeWidthMm: current.bridgeWidthMm,
                  templeLengthMm: current.templeLengthMm,
                  totalFrameWidthMm: current.totalFrameWidthMm,
                });
                const generated = await generateSplitSheetWithFallback(
                  ai,
                  current.imageBase64.replace(/^data:[^;]+;base64,/, ''),
                  ALLOWED_MIME_TYPES.has(current.mimeType || '') ? current.mimeType! : 'image/jpeg',
                  prompt
                );
                await deductAiCredit(ctx, 1);
                job.results[current.localId] = {
                  splitImageBase64: generated.splitImageBase64,
                  mimeType: generated.mimeType,
                  cacheHit: false,
                };
              }
            } catch (err) {
              job.results[current.localId] = {
                error: err instanceof Error ? err.message : 'فشلت معالجة الإطار',
              };
            } finally {
              job.done += 1;
            }
          }
        };

        await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
        job.status = 'completed';
      };

      void processQueueAsync();

      res.json({
        ok: true,
        jobId,
        geminiBatchName: job.geminiBatchName || null,
        mode: turbo ? 'turbo' : 'batch_api',
        total: items.length,
      });
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode || 500;
      res.status(code).json({
        error: err instanceof Error ? err.message : 'تعذر بدء دفعة المعالجة',
      });
    }
  });

  app.get('/api/eyewear/batch-status/:jobId', async (req: Request, res: Response) => {
    try {
      const ctx = await authenticateRequest(req, { requireCredits: false, allowPreviewWithoutAuth: true });
      const job = batchJobsStore.get(String(req.params.jobId || ''));
      if (!job || (job.userId !== ctx.userId && !ctx.isAdmin)) {
        res.status(404).json({ error: 'لم يتم العثور على الدفعة المطلوبة' });
        return;
      }
      res.json({
        ok: true,
        jobId: job.jobId,
        geminiBatchName: job.geminiBatchName || null,
        status: job.status,
        total: job.total,
        done: job.done,
        results: job.status === 'completed' ? job.results : {},
      });
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode || 401;
      res.status(code).json({
        error: err instanceof Error ? err.message : 'غير مصرح',
      });
    }
  });

  // 6. Protected AI Merchant Logo Designer (strictly capped at 2 generations per merchant)
  app.post('/api/merchant/generate-logo', async (req: Request, res: Response) => {
    try {
      const ctx = await authenticateRequest(req, { requireCredits: false });
      const body = (req.body || {}) as {
        imageBase64?: unknown;
        mimeType?: unknown;
        shopName?: unknown;
      };

      const rawBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      const rawMime = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'image/jpeg';
      const shopName =
        typeof body.shopName === 'string' && body.shopName.trim()
          ? body.shopName.trim().slice(0, 60)
          : 'Optical Store';

      if (!rawBase64) {
        res.status(400).json({ error: 'يرجى رفع صورة يافطة المحل أولاً.' });
        return;
      }

      const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      if (cleanBase64.length > 20_000_000) {
        res.status(413).json({ error: 'حجم الصورة يتجاوز الحد المسموح به (15MB).' });
        return;
      }

      const safeMimeType = ALLOWED_MIME_TYPES.has(rawMime) ? rawMime : 'image/jpeg';
      const shopKey = ctx.shopId || ctx.userId;
      let usedCount = memoryLogoGenerations.get(shopKey) ?? 0;

      const supabaseAdmin = getSupabaseAdminClient();
      if (supabaseAdmin && ctx.shopId) {
        try {
          const { data: row } = await supabaseAdmin
            .from('shops')
            .select('ai_logo_generations')
            .eq('id', ctx.shopId)
            .maybeSingle();
          if (row && typeof row.ai_logo_generations === 'number') {
            usedCount = Math.max(usedCount, row.ai_logo_generations);
          }
        } catch {
          // Optional column may not exist yet in older Supabase schemas
        }
      }

      if (usedCount >= MAX_AI_LOGO_GENERATIONS) {
        res.status(403).json({
          error: 'لقد استنفدت الحد الأقصى لتصميم اللوجو بالذكاء الاصطناعي (محاولتان فقط لكل متجر). يمكنك رفع لوجو جاهز من جهازك.',
          usedGenerations: usedCount,
          maxGenerations: MAX_AI_LOGO_GENERATIONS,
        });
        return;
      }

      const ai = getGeminiClient();
      const prompt = [
        `Design a minimalist, luxury optical storefront vector emblem logo for "${shopName}" inspired by the storefront signboard photo attached.`,
        'Rules:',
        '- Output a clean, flat, centered square emblem/logo on a pure solid #FFFFFF white background.',
        '- Extract the core brand symbol, geometric eyewear motif, and clean luxury typography aesthetic from the signboard.',
        '- Remove all street background, walls, wires, sky, reflections, and photographic noise.',
        '- Crisp sharp edges, luxury optical boutique aesthetic (Deep Royal Navy #0F172A, Optical Sapphire #0284C7, or Warm Gold #D97706).',
        '- Zero watermark, zero mockup frame, zero border.',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
        contents: {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: safeMimeType,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: '1:1',
          },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      let outBase64 = '';
      let outMime = 'image/png';
      for (const part of parts) {
        if (part.inlineData?.data) {
          outBase64 = part.inlineData.data;
          outMime = part.inlineData.mimeType || 'image/png';
          break;
        }
      }

      if (!outBase64) {
        res.status(502).json({ error: 'لم يتمكن الذكاء الاصطناعي من استخراج اللوجو — حاول بصورة أوضح لليافطة.' });
        return;
      }

      const nextCount = usedCount + 1;
      memoryLogoGenerations.set(shopKey, nextCount);
      if (supabaseAdmin && ctx.shopId) {
        try {
          await supabaseAdmin
            .from('shops')
            .update({ ai_logo_generations: nextCount })
            .eq('id', ctx.shopId);
        } catch {
          // Ignore if column doesn't exist yet
        }
      }

      res.json({
        ok: true,
        logoDataUrl: `data:${outMime};base64,${outBase64}`,
        usedGenerations: nextCount,
        maxGenerations: MAX_AI_LOGO_GENERATIONS,
      });
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode;
      const message = err instanceof Error ? err.message : 'تعذر تصميم اللوجو بالذكاء الاصطناعي';
      const status =
        code ||
        (message.includes('GEMINI_API_KEY') || message.includes('Settings > Secrets') ? 503 : 500);
      res.status(status).json({ error: message });
    }
  });

  // 7. Guest-First Visual Eyewear Search (Strict 10 req/hour per IP, zero merchant credit deduction)
  app.post('/api/eyewear/visual-match', async (req: Request, res: Response) => {
    try {
      const ipKey = getClientIpKey(req);
      const rl = checkVisualMatchRateLimit(ipKey);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSec));
        res.status(429).json({
          error: 'وصلت للحد الأقصى للبحث بالصورة (10 عمليات في الساعة). يرجى المحاولة بعد قليل.',
          retryAfterSec: rl.retryAfterSec,
        });
        return;
      }

      const body = (req.body || {}) as { imageBase64?: unknown; mimeType?: unknown };
      const rawBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      const rawMime = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'image/jpeg';

      if (!rawBase64) {
        res.status(400).json({ error: 'يرجى اختيار صورة نظارة واضحة أولاً.' });
        return;
      }

      const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      if (!cleanBase64 || cleanBase64.length > 3_500_000) {
        res.status(413).json({ error: 'حجم الصورة كبير جداً. يرجى اختيار صورة أصغر.' });
        return;
      }

      const safeMimeType = ALLOWED_MIME_TYPES.has(rawMime) ? rawMime : 'image/jpeg';
      const ai = getGeminiClient();

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: safeMimeType,
              },
            },
            {
              text: [
                'Analyze this uploaded photo for eyewear visual search matching:',
                '1. is_eyewear: true if the photo clearly depicts eyeglasses, sunglasses, optical frames, or a person wearing clearly visible glasses; false if it does not show eyewear.',
                '2. frame_shape: choose closest silhouette from "round", "oval", "square", "cat_eye", "aviator".',
                '3. color_family: choose primary frame color from "black", "brown_tortoise", "clear", "metal", "other".',
                '4. category: "sun" if dark/tinted sunglasses, otherwise "med" for optical/clear-lens frames.',
                '5. material: "metal" for wire/metal/rimless-metal frames, or "tr_plastic" for acetate/plastic frames.',
                '6. style_summary_ar: concise friendly Arabic description (6-12 words) of the eyewear style, e.g., "نظارة أفياتور معدنية شمسية باللون الذهبي".',
              ].join('\n'),
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              is_eyewear: { type: Type.BOOLEAN },
              frame_shape: {
                type: Type.STRING,
                enum: ['round', 'oval', 'square', 'cat_eye', 'aviator'],
              },
              color_family: {
                type: Type.STRING,
                enum: ['black', 'brown_tortoise', 'clear', 'metal', 'other'],
              },
              category: {
                type: Type.STRING,
                enum: ['sun', 'med'],
              },
              material: {
                type: Type.STRING,
                enum: ['metal', 'tr_plastic'],
              },
              style_summary_ar: { type: Type.STRING },
            },
            required: ['is_eyewear', 'frame_shape', 'color_family', 'category', 'material', 'style_summary_ar'],
          },
        },
      });

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(response.text || '{}') as Record<string, unknown>;
      } catch {
        parsed = {};
      }

      const isEyewear = Boolean(parsed.is_eyewear);
      if (!isEyewear) {
        res.json({
          ok: true,
          is_eyewear: false,
          remaining: rl.remaining,
          message: 'لم نتمكن من تمييز نظارة واضحة في هذه الصورة. من فضلك ارفع صورة نظارة أوضح وبإضاءة جيدة.',
        });
        return;
      }

      const allowedShapes = new Set(['round', 'oval', 'square', 'cat_eye', 'aviator']);
      const allowedColors = new Set(['black', 'brown_tortoise', 'clear', 'metal', 'other']);
      const frameShape =
        typeof parsed.frame_shape === 'string' && allowedShapes.has(parsed.frame_shape)
          ? parsed.frame_shape
          : 'square';
      const colorFamily =
        typeof parsed.color_family === 'string' && allowedColors.has(parsed.color_family)
          ? parsed.color_family
          : 'other';
      const category = parsed.category === 'sun' ? 'sun' : 'med';
      const material = parsed.material === 'metal' ? 'metal' : 'tr_plastic';
      const styleSummaryAr =
        typeof parsed.style_summary_ar === 'string' && parsed.style_summary_ar.trim()
          ? parsed.style_summary_ar.trim().slice(0, 120)
          : 'نظارة عصرية أنيقة';

      res.json({
        ok: true,
        is_eyewear: true,
        remaining: rl.remaining,
        analysis: {
          is_eyewear: true,
          frame_shape: frameShape,
          color_family: colorFamily,
          category,
          material,
          style_summary_ar: styleSummaryAr,
        },
      });
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode;
      const message = err instanceof Error ? err.message : 'تعذر تحليل الصورة حالياً — حاول مرة أخرى.';
      const status =
        code ||
        (message.includes('GEMINI_API_KEY') || message.includes('Settings > Secrets') ? 503 : 500);
      res.status(status).json({ error: message });
    }
  });

  // 8. Smart Paper Ledger OCR Scanner (Zero-credit extraction via gemini-3.5-flash-lite)
  app.post('/api/merchant/scan-ledger', async (req: Request, res: Response) => {
    try {
      await authenticateRequest(req, { requireCredits: false, allowPreviewWithoutAuth: true });

      const body = (req.body || {}) as { imageBase64?: unknown; mimeType?: unknown };
      const rawBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      const rawMime = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'image/jpeg';

      if (!rawBase64) {
        res.status(400).json({ error: 'يرجى اختيار صورة دفتر العملاء أو الفاتورة أولاً.' });
        return;
      }

      const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      if (!cleanBase64 || cleanBase64.length > 12_000_000) {
        res.status(413).json({ error: 'حجم الصورة يتجاوز الحد المسموح به (9MB).' });
        return;
      }

      const safeMimeType = ALLOWED_MIME_TYPES.has(rawMime) ? rawMime : 'image/jpeg';
      const todayIso = new Date().toISOString().slice(0, 10);
      const ai = getGeminiClient();

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: safeMimeType,
              },
            },
            {
              text: [
                'You are an expert Arabic/English optical store OCR assistant.',
                'Inspect this photo of an eyewear shop paper ledger, handwritten notebook, invoice, or customer table.',
                'Extract EVERY distinct customer order/row visible into a JSON array.',
                'Rules:',
                '- customerName: Customer full name in Arabic or English as written. Never invent names; if missing write "عميل دفتر".',
                '- phone: Normalize Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) to English digits and normalize Egyptian mobile format to 01xxxxxxxxx (11 digits starting with 010, 011, 012, or 015). If country code +20 / 20 is present, convert to 01xxxxxxxxx. If unclear, return best digits visible or "".',
                '- productName: Frame model, frame code, and/or lens description (e.g., "شنبر أسيتات + عدسة بلو كت"). Default to "نظارة طبية" if unspecified.',
                `- orderDate: Date in YYYY-MM-DD format (convert Arabic numerals and DD/MM/YYYY or D/M/YY formats accurately). If year is omitted, assume ${todayIso.slice(0, 4)}. If no date is visible for a row, use "${todayIso}".`,
                '- pd: Pupillary distance (e.g., "63") if written, else null.',
                '- pricePaid: Total numeric price in EGP if written, else null.',
                '- notes: Short optical/Rx or delivery note if written (e.g., R/L sphere/cyl summary), else null.',
                '- Return an empty array [] if no customer rows are legible.',
              ].join('\n'),
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                customerName: { type: Type.STRING },
                phone: { type: Type.STRING },
                productName: { type: Type.STRING },
                orderDate: { type: Type.STRING },
                pd: { type: Type.STRING, nullable: true },
                pricePaid: { type: Type.NUMBER, nullable: true },
                notes: { type: Type.STRING, nullable: true },
              },
              required: ['customerName', 'phone', 'productName', 'orderDate'],
            },
          },
        },
      });

      const toLatinDigits = (val: string) =>
        val
          .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
          .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

      const normalizeEgyptianPhone = (raw: unknown): string => {
        if (typeof raw !== 'string') return '';
        let digits = toLatinDigits(raw).replace(/[^\d+]/g, '');
        if (digits.startsWith('+20')) digits = '0' + digits.slice(3);
        else if (digits.startsWith('0020')) digits = '0' + digits.slice(4);
        else if (digits.startsWith('20') && digits.length >= 12) digits = '0' + digits.slice(2);
        else if (/^1[0125]\d{8}$/.test(digits)) digits = '0' + digits;
        digits = digits.replace(/\D/g, '');
        const match = digits.match(/01[0125]\d{8}/);
        if (match) return match[0];
        return digits.slice(0, 15);
      };

      const normalizeDateStr = (raw: unknown): string => {
        if (typeof raw !== 'string' || !raw.trim()) return todayIso;
        const cleaned = toLatinDigits(raw.trim());
        if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
          const parsed = new Date(cleaned);
          if (!Number.isNaN(parsed.getTime())) return cleaned;
        }
        const dmy = cleaned.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
        if (dmy) {
          const dd = dmy[1].padStart(2, '0');
          const mm = dmy[2].padStart(2, '0');
          const yyyy = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
          const iso = `${yyyy}-${mm}-${dd}`;
          if (!Number.isNaN(new Date(iso).getTime())) return iso;
        }
        return todayIso;
      };

      let rawArr: unknown[] = [];
      try {
        const parsed = JSON.parse(response.text || '[]') as unknown;
        if (Array.isArray(parsed)) rawArr = parsed;
      } catch {
        rawArr = [];
      }

      const customers = rawArr
        .slice(0, 60)
        .map((entry) => {
          const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
          const customerName =
            typeof row.customerName === 'string' && row.customerName.trim()
              ? row.customerName.trim().slice(0, 80)
              : 'عميل دفتر';
          const phone = normalizeEgyptianPhone(row.phone);
          const productName =
            typeof row.productName === 'string' && row.productName.trim()
              ? row.productName.trim().slice(0, 120)
              : 'نظارة طبية';
          const orderDate = normalizeDateStr(row.orderDate);
          const pd =
            typeof row.pd === 'string' && row.pd.trim()
              ? toLatinDigits(row.pd.trim()).slice(0, 20)
              : undefined;
          const priceNum =
            typeof row.pricePaid === 'number' && Number.isFinite(row.pricePaid) && row.pricePaid > 0
              ? Math.round(row.pricePaid)
              : undefined;
          const notes =
            typeof row.notes === 'string' && row.notes.trim()
              ? row.notes.trim().slice(0, 200)
              : undefined;
          return {
            customerName,
            phone,
            productName,
            orderDate,
            ...(pd ? { pd } : {}),
            ...(priceNum ? { pricePaid: priceNum } : {}),
            ...(notes ? { notes } : {}),
          };
        })
        .filter((c) => Boolean(c.customerName || c.phone));

      res.json({ ok: true, customers });
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode;
      const message =
        err instanceof Error ? err.message : 'تعذر قراءة صورة الدفتر حالياً — حاول بصورة أوضح.';
      const status =
        code ||
        (message.includes('GEMINI_API_KEY') || message.includes('Settings > Secrets') ? 503 : 500);
      res.status(status).json({ error: message });
    }
  });

  return app;
}


const app = createEyewearServerApp();
export default app;
