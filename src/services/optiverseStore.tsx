import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AUDIT0,
  BRANDS0,
  DEFAULT_SHOP_ID,
  EXTRAS0,
  INQ0,
  LENS_TYPES0,
  PAYMENTS0,
  PLANS0,
  PRODUCTS0,
  SHOPS0,
} from '../data/seed';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { idbLoadSnapshot, idbSaveSnapshot } from '../utils/indexedDbStore';
import {
  AuditLog,
  AuthSession,
  Brand,
  CartItem,
  Inquiry,
  LensType,
  PaymentRecord,
  Plan,
  Product,
  ProductImage,
  ProductReview,
  ProtectionExtra,
  Shop,
} from '../types';

const STORAGE_KEY = 'optiverse_state_v2';
const MY_INQ_KEY = 'optiverse_my_inquiries_v1';
const FAV_STORAGE_KEY = 'optiverse_fav_by_shop_v1';
const CART_STORAGE_KEY = 'optiverse_cart_by_shop_v1';

export type ModalState =
  | null
  | 'addshop'
  | 'addprod'
  | { t: 'editprod'; p: Product }
  | { t: 'delprod'; p: Product }
  | { t: 'renew'; s: Shop }
  | { t: 'editplan'; s: Shop }
  | { t: 'addpayment'; s?: Shop }
  | { t: 'view3d'; p: Product }
  | { t: 'share'; link: string }
  | { t: 'vote'; p: Product; link: string }
  | { t: 'catitem'; kind: 'lens' | 'brand' | 'extra'; item?: any }
  | { t: 'catdel'; kind: 'lens' | 'brand' | 'extra'; item: any }
  | { t: 'disc'; kind: 'lens' | 'brand' | 'extra' | 'prod'; item: any }
  | { t: 'ba'; lens: string }
  | { t: 'zoom'; q: Inquiry }
  | { t: 'confirmq'; q: Inquiry }
  | { t: 'altq'; q: Inquiry }
  | { t: 'sent'; q: Inquiry }
  | { t: 'checkout'; total: number };

export function getShopDaysLeft(shop: Shop): number {
  if (shop.status === 'trial' && shop.trialEndsAt) {
    const ms = new Date(shop.trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }
  return Math.max(0, shop.days);
}

export function isShopExpiredOrPaused(shop: Shop): boolean {
  if (shop.status === 'paused' || shop.status === 'expired') return true;
  if (shop.status === 'trial' && getShopDaysLeft(shop) <= 0) return true;
  return false;
}

function getAdminOwnerEmail(): string {
  return String(import.meta.env.VITE_ADMIN_EMAIL || 'admin@optiverse.app').trim().toLowerCase();
}

function makeSlug(name: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^\w\u0600-\u06FF]+/g, '-')
      .replace(/^-|-$/g, '') || 'shop-' + Date.now();
  return `${base}-${Math.floor(100 + Math.random() * 900)}`;
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface PersistedSnapshot {
  shops: Shop[];
  products: Product[];
  reviews?: ProductReview[];
  inq: Inquiry[];
  lensTypes: LensType[];
  brands: Brand[];
  extras: ProtectionExtra[];
  plans: Plan[];
  payments: PaymentRecord[];
  auditLogs: AuditLog[];
  extraShops: number;
}

function normalizeCatalogShopIds<T extends { shopId?: string }>(items: T[]): T[] {
  return items.map((item) => (item.shopId ? item : { ...item, shopId: DEFAULT_SHOP_ID }));
}

function loadSnapshot(): PersistedSnapshot {
  // Purge any legacy image-heavy snapshot from localStorage so images reside strictly in IndexedDB
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw.includes('data:image/')) {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  return {
    shops: SHOPS0,
    products: PRODUCTS0,
    reviews: [],
    inq: INQ0,
    lensTypes: LENS_TYPES0,
    brands: BRANDS0,
    extras: EXTRAS0,
    plans: PLANS0,
    payments: PAYMENTS0,
    auditLogs: AUDIT0,
    extraShops: 0,
  };
}

function loadJsonMap<T>(key: string, fallback: Record<string, T>): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // ignore
  }
  return fallback;
}

function getMyInquiryIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(MY_INQ_KEY) || '[]');
  } catch {
    return [];
  }
}

function addMyInquiryId(id: string) {
  try {
    const ids = getMyInquiryIds();
    if (!ids.includes(id)) {
      localStorage.setItem(MY_INQ_KEY, JSON.stringify([id, ...ids].slice(0, 50)));
    }
  } catch {
    // ignore
  }
}

export interface StoreCtxValue {
  route: string;
  navigate: (path: string) => void;
  toast: (msg: string) => void;
  modal: ModalState;
  setModal: React.Dispatch<React.SetStateAction<ModalState>>;
  session: AuthSession | null;
  setSession: React.Dispatch<React.SetStateAction<AuthSession | null>>;
  authLoading: boolean;
  signInWithSupabase: (
    email: string,
    password: string,
    expectedRole?: 'admin' | 'merchant'
  ) => Promise<{ ok: boolean; role?: 'admin' | 'merchant'; error?: string; needsMfa?: boolean }>;
  signInUnified: (
    email: string,
    password: string
  ) => Promise<{ ok: boolean; role?: 'admin' | 'merchant'; error?: string; needsMfa?: boolean }>;
  signInWithGoogle: () => Promise<{ ok: boolean; error?: string }>;
  signInWithApple: () => Promise<{ ok: boolean; error?: string }>;
  registerMerchant: (opts: {
    email: string;
    password: string;
    ownerName?: string;
    shopName: string;
    wa: string;
    city: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  shops: Shop[];
  setShops: React.Dispatch<React.SetStateAction<Shop[]>>;
  activeShop: Shop;
  setActiveShopSlug: (slug: string) => void;
  updateShop: (shopId: string, patch: Partial<Shop>) => Promise<void>;
  addShopManual: (opts: {
    name: string;
    ownerName?: string;
    ownerEmail?: string;
    city?: string;
    plan?: string;
    wa?: string;
  }) => Promise<Shop>;
  extraShops: number;
  setExtraShops: React.Dispatch<React.SetStateAction<number>>;
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  addProduct: (prod: Omit<Product, 'id'>, images?: ProductImage[]) => Promise<Product>;
  addProductsBulk: (items: { prod: Omit<Product, 'id'>; images?: ProductImage[] }[]) => Promise<Product[]>;
  updateProduct: (
    productId: string,
    patch: Partial<Omit<Product, 'id' | 'shopId'>>,
    replacedImages?: ProductImage[]
  ) => Promise<Product | null>;
  updateProductsBatch: (
    updates: { productId: string; patch: Partial<Omit<Product, 'id' | 'shopId'>> }[]
  ) => Promise<void>;
  toggleProductPublished: (productId: string) => Promise<void>;
  softDeleteProductByCode: (shopId: string, code: string) => Promise<{ ok: boolean; product?: Product; error?: string }>;
  softDeleteProductById: (productId: string) => Promise<void>;
  updateProductDiscount: (productId: string, disc: number) => Promise<void>;
  reviews: ProductReview[];
  addProductReview: (review: {
    productId: string;
    shopId: string;
    authorName: string;
    rating: number;
    comment: string;
  }) => Promise<ProductReview>;
  inq: Inquiry[];
  setInq: React.Dispatch<React.SetStateAction<Inquiry[]>>;
  addInquiry: (q: Inquiry) => Promise<void>;
  updateInquiry: (id: string, patch: Partial<Inquiry>) => Promise<void>;
  lensTypes: LensType[];
  setLensTypes: React.Dispatch<React.SetStateAction<LensType[]>>;
  brands: Brand[];
  setBrands: React.Dispatch<React.SetStateAction<Brand[]>>;
  extras: ProtectionExtra[];
  setExtras: React.Dispatch<React.SetStateAction<ProtectionExtra[]>>;
  syncCatalogItem: (kind: 'lens' | 'brand' | 'extra', shopId: string, op: 'upsert' | 'delete', item: any) => Promise<void>;
  plans: Plan[];
  setPlans: React.Dispatch<React.SetStateAction<Plan[]>>;
  savePlan: (plan: Plan) => Promise<void>;
  payments: PaymentRecord[];
  setPayments: React.Dispatch<React.SetStateAction<PaymentRecord[]>>;
  recordPayment: (opts: {
    shopId?: string;
    shopName: string;
    amount: number;
    method: 'InstaPay' | 'Vodafone Cash';
    referenceNo?: string;
    status?: 'ok' | 'wait' | 'late';
  }) => Promise<void>;
  auditLogs: AuditLog[];
  logAudit: (action: string, details: string, shopId?: string) => Promise<void>;
  fav: string[];
  setFav: React.Dispatch<React.SetStateAction<string[]>>;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  enterShopAsMerchant: (s: Shop) => void;
  exportFullBackup: () => Promise<void>;
  uploadAssetToStorage: (blob: Blob, folder: string, ext: string) => Promise<string>;
}

const Ctx = createContext<StoreCtxValue | null>(null);

export const useOptiVerse = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOptiVerse must be used inside OptiVerseProvider');
  return ctx;
};

export function OptiVerseProvider({ children }: { children: React.ReactNode }) {
  const initial = useRef<PersistedSnapshot>(loadSnapshot()).current;
  const [route, setRoute] = useState<string>(() => (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'));
  const [modal, setModal] = useState<ModalState>(null);
  const [tst, setTst] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(isSupabaseConfigured);

  const [shops, setShops] = useState<Shop[]>(initial.shops);
  const [activeShopSlug, setActiveShopSlug] = useState<string>('dahab-optics');
  const [extraShops, setExtraShops] = useState<number>(initial.extraShops);
  const [products, setProducts] = useState<Product[]>(initial.products);
  const [reviews, setReviews] = useState<ProductReview[]>(initial.reviews || []);
  const [inq, setInq] = useState<Inquiry[]>(() => {
    const mineIds = getMyInquiryIds();
    return initial.inq.map((q) => (mineIds.includes(q.id) ? { ...q, mine: true } : q));
  });
  const [lensTypes, setLensTypes] = useState<LensType[]>(initial.lensTypes);
  const [brands, setBrands] = useState<Brand[]>(initial.brands);
  const [extras, setExtras] = useState<ProtectionExtra[]>(initial.extras);
  const [plans, setPlans] = useState<Plan[]>(initial.plans);
  const [payments, setPayments] = useState<PaymentRecord[]>(initial.payments);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(initial.auditLogs);
  const [favByShop, setFavByShop] = useState<Record<string, string[]>>(() =>
    loadJsonMap<string[]>(FAV_STORAGE_KEY, { 'dahab-optics': ['p-1001'] })
  );
  const [cartByShop, setCartByShop] = useState<Record<string, CartItem[]>>(() =>
    loadJsonMap<CartItem[]>(CART_STORAGE_KEY, {})
  );

  const toastTimer = useRef<number | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const idbHydratedRef = useRef(false);
  const hasMutatedBeforeIdbRef = useRef(false);

  const toast = useCallback((m: string) => {
    setTst(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setTst(null), 2800);
  }, []);

  const navigate = useCallback((path: string) => {
    const clean = path.startsWith('/') ? path : '/' + path;
    const current = window.location.pathname + window.location.search;
    if (current !== clean) {
      window.history.pushState({}, '', clean);
    }
    setRoute(clean);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname + window.location.search || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Hydrate full catalog & WebP frame assets from IndexedDB on startup (prevents localStorage 5MB quota limits)
  useEffect(() => {
    let alive = true;
    idbLoadSnapshot<PersistedSnapshot>().then((idbSnap) => {
      idbHydratedRef.current = true;
      if (!alive || !idbSnap || hasMutatedBeforeIdbRef.current) return;
      if (idbSnap.shops?.length) setShops(idbSnap.shops);
      if (idbSnap.products?.length) setProducts(idbSnap.products);
      if (idbSnap.reviews?.length) setReviews(idbSnap.reviews);
      if (idbSnap.inq?.length) {
        const mineIds = getMyInquiryIds();
        setInq(idbSnap.inq.map((q) => (mineIds.includes(q.id) ? { ...q, mine: true } : q)));
      }
      if (idbSnap.lensTypes?.length) setLensTypes(normalizeCatalogShopIds(idbSnap.lensTypes));
      if (idbSnap.brands?.length) setBrands(normalizeCatalogShopIds(idbSnap.brands));
      if (idbSnap.extras?.length) setExtras(normalizeCatalogShopIds(idbSnap.extras));
      if (idbSnap.plans?.length) setPlans(idbSnap.plans);
      if (idbSnap.payments?.length) setPayments(idbSnap.payments);
      if (idbSnap.auditLogs?.length) setAuditLogs(idbSnap.auditLogs);
      if (typeof idbSnap.extraShops === 'number') setExtraShops(idbSnap.extraShops);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Persist full state (hundreds of WebP frames) to IndexedDB, with safe lightweight localStorage fallback
  useEffect(() => {
    if (idbHydratedRef.current) {
      hasMutatedBeforeIdbRef.current = true;
    }
    const snap: PersistedSnapshot = {
      shops,
      products,
      reviews,
      inq,
      lensTypes,
      brands,
      extras,
      plans,
      payments,
      auditLogs,
      extraShops,
    };

    const timer = window.setTimeout(() => {
      // Persist all images and product snapshots exclusively in IndexedDB (never localStorage)
      void idbSaveSnapshot(snap);

      try {
        if (products.length <= 25) {
          bcRef.current?.postMessage({ type: 'SYNC_STATE', payload: snap });
        } else {
          bcRef.current?.postMessage({ type: 'RELOAD_IDB' });
        }
      } catch {
        // ignore cross-tab broadcast clone limits
      }
    }, 120);

    return () => window.clearTimeout(timer);
  }, [shops, products, reviews, inq, lensTypes, brands, extras, plans, payments, auditLogs, extraShops]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('optiverse_realtime');
    bcRef.current = bc;
    bc.onmessage = (ev) => {
      const applySnap = (p: PersistedSnapshot) => {
        setShops(p.shops);
        setProducts(p.products);
        if (p.reviews) setReviews(p.reviews);
        const mineIds = getMyInquiryIds();
        setInq(p.inq.map((q) => (mineIds.includes(q.id) ? { ...q, mine: true } : q)));
        setLensTypes(p.lensTypes);
        setBrands(p.brands);
        setExtras(p.extras);
        setPlans(p.plans);
        if (p.payments) setPayments(p.payments);
      };
      if (ev.data?.type === 'SYNC_STATE' && ev.data.payload) {
        applySnap(ev.data.payload as PersistedSnapshot);
      } else if (ev.data?.type === 'RELOAD_IDB') {
        void idbLoadSnapshot<PersistedSnapshot>().then((snap) => {
          if (snap) applySnap(snap);
        });
      }
    };
    return () => bc.close();
  }, []);

  // Resolve active shop based on route slug (/s/[slug], /shop/[slug] or /[slug]), merchant session, or fallback
  const routePath = route.split('?')[0];
  const routeSlug = routePath.startsWith('/s/')
    ? routePath.slice(3).replace(/^\/+|\/+$/g, '').split('/')[0]
    : routePath.startsWith('/shop/')
    ? routePath.slice(6).replace(/^\/+|\/+$/g, '').split('/')[0]
    : routePath !== '/' && !routePath.startsWith('/admin') && !routePath.startsWith('/merchant')
    ? routePath.slice(1).split('/')[0]
    : '';

  const activeShop =
    shops.find((s) => s.slug === (routeSlug || activeShopSlug)) ||
    (session?.shopId ? shops.find((s) => s.id === session.shopId) : undefined) ||
    shops[0];

  const currentShopKey = activeShop?.slug || 'dahab-optics';
  const fav = favByShop[currentShopKey] ?? (activeShop?.id === DEFAULT_SHOP_ID ? ['p-1001'] : []);
  const cart = cartByShop[currentShopKey] ?? [];

  const setFav: React.Dispatch<React.SetStateAction<string[]>> = useCallback(
    (updater) => {
      setFavByShop((prev) => {
        const cur = prev[currentShopKey] ?? (activeShop?.id === DEFAULT_SHOP_ID ? ['p-1001'] : []);
        const nextList = typeof updater === 'function' ? updater(cur) : updater;
        const next = { ...prev, [currentShopKey]: nextList };
        try {
          localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [activeShop?.id, currentShopKey]
  );

  const setCart: React.Dispatch<React.SetStateAction<CartItem[]>> = useCallback(
    (updater) => {
      setCartByShop((prev) => {
        const cur = prev[currentShopKey] ?? [];
        const nextList = typeof updater === 'function' ? updater(cur) : updater;
        const next = { ...prev, [currentShopKey]: nextList };
        try {
          localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [currentShopKey]
  );

  const seedCatalogForShop = useCallback(async (shopId: string, intoSupabase = true) => {
    const newLenses = LENS_TYPES0.map((item) => ({ ...item, shopId }));
    const newBrands = BRANDS0.map((item) => ({ ...item, shopId }));
    const newExtras = EXTRAS0.map((item) => ({ ...item, shopId }));

    setLensTypes((prev) => {
      if (prev.some((x) => x.shopId === shopId)) return prev;
      return [...prev, ...newLenses];
    });
    setBrands((prev) => {
      if (prev.some((x) => x.shopId === shopId)) return prev;
      return [...prev, ...newBrands];
    });
    setExtras((prev) => {
      if (prev.some((x) => x.shopId === shopId)) return prev;
      return [...prev, ...newExtras];
    });

    if (intoSupabase && supabase) {
      await Promise.all([
        supabase.from('lens_types').upsert(
          newLenses.map((l, idx) => ({
            id: l.id,
            shop_id: shopId,
            name_ar: l.name,
            name_en: l.en,
            description: l.desc,
            icon: l.icon,
            price: l.price,
            discount_pct: l.disc || 0,
            is_active: l.on !== false,
            sort_order: idx,
          }))
        ),
        supabase.from('brands').upsert(
          newBrands.map((b, idx) => ({
            id: b.id,
            shop_id: shopId,
            name_ar: b.name,
            name_en: b.en,
            price: b.price,
            discount_pct: b.disc || 0,
            is_active: b.on !== false,
            sort_order: idx,
          }))
        ),
        supabase.from('extras').upsert(
          newExtras.map((e, idx) => ({
            id: e.id,
            shop_id: shopId,
            name_ar: e.name,
            price: e.price,
            discount_pct: e.disc || 0,
            is_active: e.on !== false,
            sort_order: idx,
          }))
        ),
      ]);
    }
  }, []);

  // Hydrate & Subscribe from Supabase when configured
  const hydrateFromSupabase = useCallback(async () => {
    if (!supabase) return;
    try {
      const [shopsRes, plansRes, prodsRes, imgsRes, ltRes, brRes, exRes, inqRes, payRes] = await Promise.all([
        supabase.from('shops').select('*').order('created_at', { ascending: false }),
        supabase.from('plans').select('*').order('sort_order', { ascending: true }),
        supabase.from('products').select('*').eq('is_deleted', false).order('created_at', { ascending: true }),
        supabase.from('product_images').select('*').order('sort_order', { ascending: true }),
        supabase.from('lens_types').select('*').order('sort_order', { ascending: true }),
        supabase.from('brands').select('*').order('sort_order', { ascending: true }),
        supabase.from('extras').select('*').order('sort_order', { ascending: true }),
        supabase.from('inquiries').select('*').order('created_at', { ascending: false }),
        supabase.from('payments').select('*').order('created_at', { ascending: false }),
      ]);

      if (shopsRes.data?.length) {
        setShops(
          shopsRes.data.map((r: any) => ({
            id: r.id,
            ownerId: r.owner_id,
            ownerName: r.owner_name || undefined,
            ownerEmail: r.owner_email || undefined,
            name: r.name,
            city: r.city,
            slug: r.slug,
            plan: r.plan_name,
            price: r.price,
            status: r.status,
            days: r.days_left,
            trialEndsAt: r.trial_ends_at || undefined,
            exp: r.expires_label,
            logo: r.logo,
            color: r.color,
            wa: r.wa_phone,
          }))
        );
      }
      if (plansRes.data?.length) {
        setPlans(
          plansRes.data.map((r: any) => ({
            id: r.id,
            name: r.name,
            price: r.price,
            on: r.is_active,
            feats: r.features || [],
          }))
        );
      }
      if (prodsRes.data) {
        const imgMap = new Map<string, ProductImage[]>();
        (imgsRes.data || []).forEach((im: any) => {
          const list = imgMap.get(im.product_id) || [];
          list.push({
            id: im.id,
            productId: im.product_id,
            angleYaw: im.angle_yaw,
            label: im.label,
            imageUrl: im.image_url,
            originalImageUrl: im.original_image_url || undefined,
            lensMaskUrl: im.lens_mask_url || undefined,
            kind: im.kind === 'gallery' ? 'gallery' : 'front_tryon',
            sortOrder: im.sort_order,
          });
          imgMap.set(im.product_id, list);
        });
        if (prodsRes.data.length) {
          setProducts(
            prodsRes.data.map((r: any) => {
              const pImgs = imgMap.get(r.id) || [];
              const colorsList =
                Array.isArray(r.frame_colors) && r.frame_colors.length
                  ? r.frame_colors
                  : Array.isArray(r.available_colors) && r.available_colors.length
                  ? r.available_colors
                  : [r.frame_color];
              const resolvedModel3d = r.model_3d_url || r.glb_url || undefined;
              const resolvedTryonMode =
                r.tryon_mode === '3d' || r.tryon_mode === '2d'
                  ? r.tryon_mode
                  : resolvedModel3d
                  ? '3d'
                  : '2d';
              const resolvedProcessed = r.processed_image || pImgs[0]?.imageUrl || undefined;
              const resolvedAdditional: string[] = Array.isArray(r.additional_images)
                ? r.additional_images
                : pImgs.filter((im) => im.kind === 'gallery').map((im) => im.imageUrl);

              return {
                id: r.id,
                shopId: r.shop_id,
                code: r.code,
                name: r.name,
                description: r.description || '',
                type: r.type,
                cat: r.cat,
                frameType: r.frame_type || undefined,
                subCategory: r.sub_category || undefined,
                price: r.price,
                disc: r.discount_pct || 0,
                frame: r.frame_color,
                lens: r.lens_color,
                tryonMode: resolvedTryonMode,
                processedImage: resolvedProcessed,
                imagePath: r.image_path || undefined,
                frontCatalogPath: r.front_catalog_path || undefined,
                sideImagePath: r.side_image_path || undefined,
                clipOnImagePath: r.clip_on_image_path || undefined,
                clipOnFrontCatalogPath: r.clip_on_front_catalog_path || undefined,
                clipOnSideImagePath: r.clip_on_side_image_path || undefined,
                aspectRatio: typeof r.aspect_ratio === 'number' ? r.aspect_ratio : undefined,
                lensWidthMm: typeof r.lens_width_mm === 'number' ? r.lens_width_mm : undefined,
                bridgeWidthMm: typeof r.bridge_width_mm === 'number' ? r.bridge_width_mm : undefined,
                templeLengthMm: typeof r.temple_length_mm === 'number' ? r.temple_length_mm : undefined,
                totalFrameWidthMm: typeof r.total_frame_width_mm === 'number' ? r.total_frame_width_mm : undefined,
                frameHexColor: r.frame_hex_color || undefined,
                frameOpacity: typeof r.frame_opacity === 'number' ? r.frame_opacity : undefined,
                additionalImages: resolvedAdditional,
                model3dUrl: resolvedModel3d,
                modelCalibration:
                  r.model_calibration && typeof r.model_calibration === 'object' ? r.model_calibration : {},
                frameColors: colorsList,
                availableColors: colorsList,
                availableSizes:
                  Array.isArray(r.available_sizes) && r.available_sizes.length
                    ? r.available_sizes
                    : ['Small', 'Medium', 'Large'],
                shapes: r.shapes || ['oval', 'round'],
                glbUrl: resolvedModel3d,
                images: pImgs,
                isPublished: r.is_published !== false,
                isDeleted: r.is_deleted,
              };
            })
          );
        }
      }
      const revRes = await supabase
        .from('frame_reviews')
        .select('*')
        .order('created_at', { ascending: false });
      if (revRes.data?.length) {
        setReviews(
          revRes.data.map((rv: any) => ({
            id: rv.id,
            productId: rv.product_id,
            shopId: rv.shop_id,
            authorName: rv.author_name,
            rating: Number(rv.rating || 5),
            comment: rv.comment,
            createdAt: rv.created_at,
          }))
        );
      }
      if (ltRes.data?.length) {
        setLensTypes(
          ltRes.data.map((r: any) => ({
            id: r.id,
            shopId: r.shop_id,
            name: r.name_ar,
            en: r.name_en,
            desc: r.description,
            icon: r.icon,
            price: r.price,
            disc: r.discount_pct || 0,
            on: r.is_active,
          }))
        );
      }
      if (brRes.data?.length) {
        setBrands(
          brRes.data.map((r: any) => ({
            id: r.id,
            shopId: r.shop_id,
            name: r.name_ar,
            en: r.name_en,
            price: r.price,
            disc: r.discount_pct || 0,
            on: r.is_active,
          }))
        );
      }
      if (exRes.data?.length) {
        setExtras(
          exRes.data.map((r: any) => ({
            id: r.id,
            shopId: r.shop_id,
            name: r.name_ar,
            price: r.price,
            disc: r.discount_pct || 0,
            on: r.is_active,
          }))
        );
      }
      if (inqRes.data?.length) {
        const mineIds = getMyInquiryIds();
        setInq(
          inqRes.data.map((r: any) => ({
            id: r.ref_code || r.id,
            shopId: r.shop_id,
            kind: r.kind,
            cust: r.customer_name,
            phone: r.phone,
            frameName: r.frame_name,
            type: r.frame_type,
            frame: r.frame_color,
            lens: r.lens_color,
            lensName: r.lens_name,
            brandName: r.brand_name,
            extrasTxt: r.extras_txt,
            fp: r.frame_price,
            lensPrice: r.lens_price,
            add: r.add_price,
            price: r.initial_price,
            final: r.final_price || undefined,
            img: r.rx_image_url,
            pd: r.pd || '',
            notes: r.notes || '',
            status: r.status,
            alt: r.alt_to || undefined,
            altFrom: r.alt_from || undefined,
            stage: r.stage,
            pay: r.payment_method || undefined,
            time: new Date(r.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
            mine: mineIds.includes(r.ref_code || r.id),
          }))
        );
      }
      if (payRes.data?.length) {
        setPayments(
          payRes.data.map((r: any) => ({
            id: r.invoice_no || r.id,
            shopId: r.shop_id || undefined,
            shopName: r.shop_name,
            amount: r.amount,
            method: r.method,
            referenceNo: r.reference_no || undefined,
            status: r.status,
            date: r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG') : 'اليوم',
          }))
        );
      }
    } catch {
      // Keep graceful local state if schema isn't pushed yet
    }
  }, []);

  const resolveSupabaseUser = useCallback(
    async (user: { id: string; email?: string | null; user_metadata?: any }, shouldRedirect: boolean) => {
      if (!supabase) return null;
      const email = (user.email || '').trim().toLowerCase();
      const adminEmail = getAdminOwnerEmail();

      let roleRow: { role: 'admin' | 'merchant'; shop_id?: string | null } | null = null;

      const { data: byId } = await supabase
        .from('user_roles')
        .select('role, shop_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (byId) {
        roleRow = byId;
      } else if (email) {
        const { data: byEmail } = await supabase
          .from('user_roles')
          .select('role, shop_id')
          .eq('email', email)
          .maybeSingle();
        if (byEmail) {
          roleRow = byEmail;
          await supabase.from('user_roles').upsert({
            user_id: user.id,
            email,
            role: byEmail.role,
            shop_id: byEmail.shop_id || null,
          });
        }
      }

      const isAdmin = roleRow?.role === 'admin' || (adminEmail && email === adminEmail);

      if (isAdmin) {
        if (!roleRow) {
          await supabase.from('user_roles').upsert({ user_id: user.id, email, role: 'admin' });
        }
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const verifiedTotp = factors?.totp?.find((f) => f.status === 'verified');
        const nextSess: AuthSession = {
          userId: user.id,
          email: user.email || adminEmail,
          role: 'admin',
          mfaVerified: !verifiedTotp,
        };
        setSession(nextSess);
        if (shouldRedirect && !window.location.pathname.startsWith('/admin')) {
          navigate('/admin');
        }
        return { role: 'admin' as const, needsMfa: Boolean(verifiedTotp) };
      }

      // Regular merchant account — ensure a 14-day trial store exists (handles Google first-time sign-in)
      let shopId = roleRow?.shop_id || undefined;
      if (!shopId) {
        const { data: existingShop } = await supabase
          .from('shops')
          .select('id, slug')
          .eq('owner_id', user.id)
          .maybeSingle();
        if (existingShop) {
          shopId = existingShop.id;
        } else {
          const displayName =
            user.user_metadata?.full_name || user.user_metadata?.name || (email ? email.split('@')[0] : 'متجر جديد');
          const trialEnd = new Date(Date.now() + 14 * 86400000).toISOString();
          const { data: newShop } = await supabase
            .from('shops')
            .insert({
              owner_id: user.id,
              owner_name: displayName,
              owner_email: email || null,
              name: `متجر ${displayName}`,
              city: 'القاهرة',
              slug: makeSlug(displayName),
              wa_phone: '01001234567',
              plan_name: 'أساسية',
              price: 600,
              status: 'trial',
              days_left: 14,
              trial_ends_at: trialEnd,
              expires_label: 'تجربة 14 يوماً',
            })
            .select('id, slug')
            .single();
          if (newShop) {
            shopId = newShop.id;
            setActiveShopSlug(newShop.slug);
            await seedCatalogForShop(newShop.id, true);
          }
        }
      }

      if (!roleRow) {
        await supabase.from('user_roles').upsert({
          user_id: user.id,
          email,
          role: 'merchant',
          shop_id: shopId || null,
        });
      }

      setSession({
        userId: user.id,
        email: user.email || '',
        role: 'merchant',
        shopId,
      });
      await hydrateFromSupabase();
      if (shouldRedirect && !window.location.pathname.startsWith('/merchant')) {
        navigate('/merchant');
      }
      return { role: 'merchant' as const, needsMfa: false };
    },
    [hydrateFromSupabase, navigate, seedCatalogForShop]
  );

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;
    const syncAuth = async () => {
      try {
        const {
          data: { session: sbSess },
        } = await supabase!.auth.getSession();
        if (sbSess?.user && mounted) {
          const curPath = window.location.pathname;
          const onAuthLanding = curPath === '/merchant' || curPath === '/admin';
          await resolveSupabaseUser(sbSess.user, onAuthLanding);
        }
      } finally {
        if (mounted) setAuthLoading(false);
      }
    };

    syncAuth();
    hydrateFromSupabase();

    const { data: authSub } = supabase.auth.onAuthStateChange(async (event, sbSess) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && sbSess?.user) {
        await resolveSupabaseUser(sbSess.user, true);
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
      }
    });

    const channel = supabase
      .channel('optiverse-realtime-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => hydrateFromSupabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_images' }, () => hydrateFromSupabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lens_types' }, () => hydrateFromSupabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brands' }, () => hydrateFromSupabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extras' }, () => hydrateFromSupabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inquiries' }, () => hydrateFromSupabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shops' }, () => hydrateFromSupabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => hydrateFromSupabase())
      .subscribe();

    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
      supabase?.removeChannel(channel);
    };
  }, [hydrateFromSupabase, resolveSupabaseUser]);

  const logAudit = useCallback(
    async (action: string, details: string, shopId?: string) => {
      const entry: AuditLog = {
        id: 'aud-' + Date.now(),
        actorRole: session?.role || 'merchant',
        shopId,
        action,
        details,
        createdAt: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
      };
      setAuditLogs((a) => [entry, ...a].slice(0, 100));
      if (supabase && session) {
        await supabase.from('audit_logs').insert({
          actor_id: session.userId,
          actor_role: session.role,
          shop_id: shopId || null,
          action,
          details,
        });
      }
    },
    [session]
  );

  const signInUnified = useCallback(
    async (email: string, password: string) => {
      const cleanEmail = email.trim().toLowerCase();
      const adminEmail = getAdminOwnerEmail();

      if (!supabase) {
        // Local preview mode: Smart Role Redirect based on admin email or matching shop owner
        if (cleanEmail && (cleanEmail === adminEmail || cleanEmail === 'admin@optiverse.com' || cleanEmail === 'admin@optiverse.app')) {
          setSession({
            userId: 'local-admin',
            email: cleanEmail,
            role: 'admin',
            mfaVerified: true,
          });
          navigate('/admin');
          return { ok: true, role: 'admin' as const, needsMfa: false };
        }
        const matchedShop =
          shops.find((s) => s.ownerEmail?.toLowerCase() === cleanEmail) || activeShop;
        setActiveShopSlug(matchedShop.slug);
        setSession({
          userId: 'local-merchant',
          email: cleanEmail || matchedShop.ownerEmail || 'dahab@optiverse.app',
          role: 'merchant',
          shopId: matchedShop.id,
        });
        navigate('/merchant');
        return { ok: true, role: 'merchant' as const, needsMfa: false };
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.user) {
        return { ok: false, error: error?.message || 'بيانات الدخول غير صحيحة' };
      }
      const res = await resolveSupabaseUser(data.user, true);
      if (!res) {
        return { ok: false, error: 'تعذّر التحقق من صلاحيات الحساب.' };
      }
      return { ok: true, role: res.role, needsMfa: res.needsMfa };
    },
    [activeShop, navigate, resolveSupabaseUser, shops]
  );

  const signInWithSupabase = useCallback(
    async (email: string, password: string, _expectedRole?: 'admin' | 'merchant') => {
      return signInUnified(email, password);
    },
    [signInUnified]
  );

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      // Local preview fallback for Google Sign-In so flows are immediately testable without remote secrets
      const newShopId = 'shop-' + Date.now();
      const trialEndsAt = new Date(Date.now() + 14 * 86400000).toISOString();
      const slug = makeSlug('google-optics');
      const newShop: Shop = {
        id: newShopId,
        name: 'متجر Google التجريبي',
        ownerName: 'تاجر Google',
        ownerEmail: 'merchant.google@gmail.com',
        city: 'القاهرة',
        slug,
        plan: 'أساسية',
        days: 14,
        trialEndsAt,
        status: 'trial',
        exp: 'تجربة 14 يوماً',
        price: 600,
        color: '#0284C7',
        wa: '01001234567',
        logo: '👓',
      };
      setShops((a) => [newShop, ...a]);
      await seedCatalogForShop(newShopId, false);
      setExtraShops((x) => x + 1);
      setActiveShopSlug(slug);
      setSession({
        userId: 'google-preview-' + Date.now(),
        email: 'merchant.google@gmail.com',
        role: 'merchant',
        shopId: newShopId,
      });
      navigate('/merchant');
      toast('تم تسجيل الدخول بحساب Google وتفعيل 14 يوماً تجريبية مجاناً ✓');
      return { ok: true };
    }

    const redirectTo = `${window.location.origin}/merchant`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }, [navigate, seedCatalogForShop, toast]);

  const signInWithApple = useCallback(async () => {
    if (!supabase) {
      const newShopId = 'shop-' + Date.now();
      const trialEndsAt = new Date(Date.now() + 14 * 86400000).toISOString();
      const slug = makeSlug('apple-optics');
      const newShop: Shop = {
        id: newShopId,
        name: 'متجر Apple التجريبي',
        ownerName: 'تاجر Apple',
        ownerEmail: 'merchant.apple@icloud.com',
        city: 'القاهرة',
        slug,
        plan: 'أساسية',
        days: 14,
        trialEndsAt,
        status: 'trial',
        exp: 'تجربة 14 يوماً',
        price: 600,
        color: '#0284C7',
        wa: '01001234567',
        logo: '👓',
      };
      setShops((a) => [newShop, ...a]);
      await seedCatalogForShop(newShopId, false);
      setExtraShops((x) => x + 1);
      setActiveShopSlug(slug);
      setSession({
        userId: 'apple-preview-' + Date.now(),
        email: 'merchant.apple@icloud.com',
        role: 'merchant',
        shopId: newShopId,
      });
      navigate('/merchant');
      toast('تم تسجيل الدخول بحساب Apple وتفعيل 14 يوماً تجريبية مجاناً ✓');
      return { ok: true };
    }

    const redirectTo = `${window.location.origin}/merchant`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo },
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }, [navigate, seedCatalogForShop, toast]);

  const registerMerchant = useCallback(
    async ({
      email,
      password,
      ownerName,
      shopName,
      wa,
      city,
    }: {
      email: string;
      password: string;
      ownerName?: string;
      shopName: string;
      wa: string;
      city: string;
    }) => {
      const finalSlug = makeSlug(shopName);
      const trialEndsAt = new Date(Date.now() + 14 * 86400000).toISOString();
      const cleanOwner = ownerName?.trim() || email.split('@')[0] || 'تاجر جديد';

      if (!supabase) {
        const newShopId = 'shop-' + Date.now();
        const newShop: Shop = {
          id: newShopId,
          name: shopName,
          ownerName: cleanOwner,
          ownerEmail: email,
          city: city || 'القاهرة',
          slug: finalSlug,
          plan: 'أساسية',
          days: 14,
          trialEndsAt,
          status: 'trial',
          exp: 'تجربة 14 يوماً',
          price: 600,
          color: '#0284C7',
          wa: wa || '01001234567',
          logo: '👓',
        };
        setShops((a) => [newShop, ...a]);
        await seedCatalogForShop(newShopId, false);
        setExtraShops((x) => x + 1);
        setActiveShopSlug(finalSlug);
        setSession({ userId: 'merchant-' + Date.now(), email, role: 'merchant', shopId: newShopId });
        await logAudit('تسجيل تاجر جديد (تجربة 14 يوماً)', `${shopName} — ${cleanOwner}`, newShopId);
        navigate('/merchant');
        return { ok: true };
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: cleanOwner } },
      });
      if (error || !data.user) {
        return { ok: false, error: error?.message || 'تعذّر إنشاء الحساب' };
      }

      const { data: shopRow, error: shopErr } = await supabase
        .from('shops')
        .insert({
          owner_id: data.user.id,
          owner_name: cleanOwner,
          owner_email: email.trim().toLowerCase(),
          name: shopName,
          city: city || 'القاهرة',
          slug: finalSlug,
          wa_phone: wa || '01001234567',
          plan_name: 'أساسية',
          price: 600,
          status: 'trial',
          days_left: 14,
          trial_ends_at: trialEndsAt,
          expires_label: 'تجربة 14 يوماً',
        })
        .select('*')
        .single();

      if (shopErr || !shopRow) {
        return { ok: false, error: shopErr?.message || 'تعذّر إنشاء المتجر' };
      }

      await supabase.from('user_roles').upsert({
        user_id: data.user.id,
        email: email.trim().toLowerCase(),
        role: 'merchant',
        shop_id: shopRow.id,
      });

      await seedCatalogForShop(shopRow.id, true);
      setActiveShopSlug(finalSlug);
      setSession({
        userId: data.user.id,
        email,
        role: 'merchant',
        shopId: shopRow.id,
      });
      await hydrateFromSupabase();
      navigate('/merchant');
      return { ok: true };
    },
    [hydrateFromSupabase, logAudit, navigate, seedCatalogForShop]
  );

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    navigate('/');
    toast('تم تسجيل الخروج ✓');
  }, [navigate, toast]);

  const uploadAssetToStorage = useCallback(
    async (blob: Blob, folder: string, ext: string): Promise<string> => {
      if (supabase && session) {
        const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from('optiverse-assets').upload(path, blob, {
          cacheControl: '3600',
          upsert: false,
          contentType: blob.type || (ext === 'glb' ? 'model/gltf-binary' : `image/${ext}`),
        });
        if (!error) {
          const { data } = supabase.storage.from('optiverse-assets').getPublicUrl(path);
          return data.publicUrl;
        }
      }
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
    },
    [session]
  );

  const updateShop = useCallback(
    async (shopId: string, patch: Partial<Shop>) => {
      setShops((a) => a.map((s) => (s.id === shopId ? { ...s, ...patch } : s)));
      if (supabase) {
        await supabase
          .from('shops')
          .update({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.ownerName !== undefined ? { owner_name: patch.ownerName } : {}),
            ...(patch.ownerEmail !== undefined ? { owner_email: patch.ownerEmail } : {}),
            ...(patch.plan !== undefined ? { plan_name: patch.plan } : {}),
            ...(patch.price !== undefined ? { price: patch.price } : {}),
            ...(patch.logo !== undefined ? { logo: patch.logo } : {}),
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            ...(patch.wa !== undefined ? { wa_phone: patch.wa } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.days !== undefined ? { days_left: patch.days } : {}),
            ...(patch.trialEndsAt !== undefined ? { trial_ends_at: patch.trialEndsAt } : {}),
            ...(patch.exp !== undefined ? { expires_label: patch.exp } : {}),
          })
          .eq('id', shopId);
      }
    },
    []
  );

  const addShopManual = useCallback(
    async ({
      name,
      ownerName,
      ownerEmail,
      city,
      plan = 'أساسية',
      wa = '01001234567',
    }: {
      name: string;
      ownerName?: string;
      ownerEmail?: string;
      city?: string;
      plan?: string;
      wa?: string;
    }): Promise<Shop> => {
      const matchedPlan = plans.find((pl) => pl.name.includes(plan));
      const price = matchedPlan?.price ?? (plan === 'احترافية' ? 1200 : 600);
      const slug = makeSlug(name);
      const tempId = generateId('s');
      let finalShop: Shop = {
        id: tempId,
        name: name.trim(),
        ownerName: ownerName?.trim() || 'صاحب المحل',
        ownerEmail: ownerEmail?.trim() || undefined,
        city: city?.trim() || 'القاهرة',
        plan,
        days: 30,
        status: 'active',
        exp: 'مفعل (شهر)',
        slug,
        price,
        color: '#14B8A6',
        wa,
        logo: '👓',
      };

      if (supabase) {
        const { data: shopRow } = await supabase
          .from('shops')
          .insert({
            owner_name: finalShop.ownerName,
            owner_email: finalShop.ownerEmail || null,
            name: finalShop.name,
            city: finalShop.city,
            slug: finalShop.slug,
            plan_name: finalShop.plan,
            price: finalShop.price,
            status: 'active',
            days_left: 30,
            expires_label: 'مفعل (شهر)',
            wa_phone: finalShop.wa,
            logo: finalShop.logo,
            color: finalShop.color,
          })
          .select('*')
          .single();
        if (shopRow?.id) {
          finalShop = { ...finalShop, id: shopRow.id };
        }
      }

      setShops((a) => [finalShop, ...a]);
      await seedCatalogForShop(finalShop.id, Boolean(supabase));
      setExtraShops((x) => x + 1);
      await logAudit('إضافة محل يدوياً', `المحل: ${finalShop.name} (${finalShop.plan})`, finalShop.id);
      return finalShop;
    },
    [logAudit, plans, seedCatalogForShop]
  );

  const savePlan = useCallback(
    async (plan: Plan) => {
      setPlans((a) => a.map((x) => (x.id === plan.id ? plan : x)));
      await logAudit('تحديث باقة', `${plan.name} — ${plan.price} ج.م (${plan.on ? 'مفعّلة' : 'موقوفة'})`);
      if (supabase) {
        await supabase.from('plans').upsert({
          id: plan.id,
          name: plan.name,
          price: plan.price,
          is_active: plan.on,
          features: plan.feats,
        });
      }
    },
    [logAudit]
  );

  const recordPayment = useCallback(
    async ({
      shopId,
      shopName,
      amount,
      method,
      referenceNo,
      status = 'ok',
    }: {
      shopId?: string;
      shopName: string;
      amount: number;
      method: 'InstaPay' | 'Vodafone Cash';
      referenceNo?: string;
      status?: 'ok' | 'wait' | 'late';
    }) => {
      const invNo = '#INV-' + (400 + Math.floor(Math.random() * 500));
      const rec: PaymentRecord = {
        id: invNo,
        shopId,
        shopName,
        amount,
        method,
        referenceNo: referenceNo?.trim() || undefined,
        status,
        date: new Date().toLocaleDateString('ar-EG'),
      };
      setPayments((a) => [rec, ...a]);
      await logAudit(
        'تسجيل عملية دفع',
        `${shopName} — ${amount} ج.م عبر ${method}${referenceNo ? ` (مرجع: ${referenceNo})` : ''}`,
        shopId
      );
      if (supabase) {
        await supabase.from('payments').insert({
          invoice_no: invNo,
          shop_id: shopId || null,
          shop_name: shopName,
          amount,
          method,
          reference_no: referenceNo?.trim() || null,
          status,
        });
      }
    },
    [logAudit]
  );

  const addProduct = useCallback(
    async (prod: Omit<Product, 'id'>, images: ProductImage[] = []) => {
      const tempId = generateId('p');
      const colorsArr = prod.frameColors?.length
        ? prod.frameColors
        : prod.availableColors?.length
        ? prod.availableColors
        : [prod.frame];
      const frontImgUrl = prod.processedImage || images[0]?.imageUrl || undefined;
      const extraImgs = prod.additionalImages?.length
        ? prod.additionalImages
        : images.filter((im) => im.kind === 'gallery').map((im) => im.imageUrl);
      const model3d = prod.model3dUrl || prod.glbUrl || undefined;

      const normalizedProd: Omit<Product, 'id'> = {
        ...prod,
        tryonMode: prod.tryonMode || (model3d ? '3d' : '2d'),
        processedImage: frontImgUrl,
        additionalImages: extraImgs,
        model3dUrl: model3d,
        modelCalibration: prod.modelCalibration || {},
        frameColors: colorsArr,
        availableColors: colorsArr,
        availableSizes: prod.availableSizes?.length ? prod.availableSizes : ['Small', 'Medium', 'Large'],
        isPublished: prod.isPublished !== false,
      };
      const fullProd: Product = {
        ...normalizedProd,
        id: tempId,
        images: images.map((im) => ({ ...im, productId: tempId })),
      };
      setProducts((a) => [...a, fullProd]);
      await logAudit('إضافة نظارة', `تمت إضافة ${prod.name} (${prod.code})`, prod.shopId);

      if (supabase) {
        const basePayload = {
          ...(tempId.includes('-') && tempId.length === 36 ? { id: tempId } : {}),
          shop_id: prod.shopId,
          code: prod.code,
          name: prod.name,
          type: prod.type,
          cat: prod.cat,
          price: prod.price,
          discount_pct: prod.disc || 0,
          frame_color: prod.frame,
          lens_color: prod.lens,
          shapes: prod.shapes,
          glb_url: model3d || null,
        };
        const extPayload = {
          ...basePayload,
          description: normalizedProd.description || '',
          tryon_mode: normalizedProd.tryonMode,
          processed_image: normalizedProd.processedImage || null,
          additional_images: normalizedProd.additionalImages || [],
          model_3d_url: normalizedProd.model3dUrl || null,
          model_calibration: normalizedProd.modelCalibration || {},
          frame_colors: normalizedProd.frameColors || [],
          available_colors: normalizedProd.availableColors || [],
          available_sizes: normalizedProd.availableSizes || ['Small', 'Medium', 'Large'],
          is_published: normalizedProd.isPublished,
        };
        const extV5Payload = {
          ...extPayload,
          frame_type: normalizedProd.frameType || null,
          sub_category: normalizedProd.subCategory || null,
          image_path: normalizedProd.imagePath || null,
          front_catalog_path: normalizedProd.frontCatalogPath || null,
          side_image_path: normalizedProd.sideImagePath || null,
          clip_on_image_path: normalizedProd.clipOnImagePath || null,
          clip_on_front_catalog_path: normalizedProd.clipOnFrontCatalogPath || null,
          clip_on_side_image_path: normalizedProd.clipOnSideImagePath || null,
          aspect_ratio: normalizedProd.aspectRatio || null,
          lens_width_mm: normalizedProd.lensWidthMm ?? normalizedProd.modelCalibration?.lensWidthMm ?? null,
          bridge_width_mm: normalizedProd.bridgeWidthMm ?? normalizedProd.modelCalibration?.bridgeWidthMm ?? null,
          temple_length_mm: normalizedProd.templeLengthMm ?? normalizedProd.modelCalibration?.templeLengthMm ?? null,
          total_frame_width_mm:
            normalizedProd.totalFrameWidthMm ?? normalizedProd.modelCalibration?.totalFrameWidthMm ?? null,
          frame_hex_color: normalizedProd.frameHexColor || null,
          frame_opacity: normalizedProd.frameOpacity ?? null,
        };

        let insRes = await supabase.from('products').insert(extV5Payload).select('id').single();
        if (insRes.error) {
          const { lens_width_mm: _l, bridge_width_mm: _b, temple_length_mm: _t, total_frame_width_mm: _w, ...extV5Fallback } = extV5Payload;
          insRes = await supabase.from('products').insert(extV5Fallback).select('id').single();
        }
        if (insRes.error) {
          insRes = await supabase.from('products').insert(extPayload).select('id').single();
        }
        if (insRes.error) {
          // Graceful fallback if migrations 003/004/005 haven't been applied on remote DB yet
          insRes = await supabase.from('products').insert(basePayload).select('id').single();
        }
        const inserted = insRes.data;

        if (inserted?.id) {
          const finalId = inserted.id;
          const syncedImages = images.map((im) => ({ ...im, productId: finalId }));
          if (finalId !== tempId) {
            setProducts((a) =>
              a.map((p) => (p.id === tempId ? { ...p, id: finalId, images: syncedImages } : p))
            );
          }
          if (syncedImages.length) {
            const imgRows = syncedImages.map((im, idx) => ({
              product_id: finalId,
              shop_id: prod.shopId,
              angle_yaw: im.angleYaw,
              label: im.label,
              image_url: im.imageUrl,
              original_image_url: im.originalImageUrl || null,
              lens_mask_url: im.lensMaskUrl || null,
              kind: im.kind || 'front_tryon',
              sort_order: idx,
            }));
            const imgIns = await supabase.from('product_images').insert(imgRows);
            if (imgIns.error) {
              await supabase.from('product_images').insert(
                syncedImages.map((im, idx) => ({
                  product_id: finalId,
                  shop_id: prod.shopId,
                  angle_yaw: im.angleYaw,
                  label: im.label,
                  image_url: im.imageUrl,
                  lens_mask_url: im.lensMaskUrl || null,
                  sort_order: idx,
                }))
              );
            }
          }
          return { ...fullProd, id: finalId, images: syncedImages };
        }
      }
      return fullProd;
    },
    [logAudit]
  );

  const addProductsBulk = useCallback(
    async (items: { prod: Omit<Product, 'id'>; images?: ProductImage[] }[]): Promise<Product[]> => {
      if (!items.length) return [];
      const prepared = items.map(({ prod, images = [] }) => {
        const tempId = generateId('p');
        const colorsArr = prod.frameColors?.length
          ? prod.frameColors
          : prod.availableColors?.length
          ? prod.availableColors
          : [prod.frame];
        const frontImgUrl = prod.processedImage || images[0]?.imageUrl || undefined;
        const extraImgs = prod.additionalImages?.length
          ? prod.additionalImages
          : images.filter((im) => im.kind === 'gallery').map((im) => im.imageUrl);
        const model3d = prod.model3dUrl || prod.glbUrl || undefined;

        const normalizedProd: Omit<Product, 'id'> = {
          ...prod,
          tryonMode: prod.tryonMode || '3d',
          processedImage: frontImgUrl,
          additionalImages: extraImgs,
          model3dUrl: model3d,
          modelCalibration: prod.modelCalibration || {},
          frameColors: colorsArr,
          availableColors: colorsArr,
          availableSizes: prod.availableSizes?.length ? prod.availableSizes : ['Small', 'Medium', 'Large'],
          isPublished: prod.isPublished !== false,
        };
        const fullProd: Product = {
          ...normalizedProd,
          id: tempId,
          images: images.map((im) => ({ ...im, productId: tempId })),
        };
        return { fullProd, normalizedProd, images };
      });

      setProducts((prev) => [...prev, ...prepared.map((x) => x.fullProd)]);
      await logAudit('رفع جماعي 3D', `تمت إضافة ${prepared.length} نظارة 3D للكتالوج`, items[0].prod.shopId);

      if (supabase) {
        const CHUNK_SIZE = 25;
        const finalProducts = [...prepared.map((x) => x.fullProd)];
        for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
          const slice = prepared.slice(i, i + CHUNK_SIZE);
          const extRows = slice.map(({ fullProd, normalizedProd }) => ({
            ...(fullProd.id.includes('-') && fullProd.id.length === 36 ? { id: fullProd.id } : {}),
            shop_id: normalizedProd.shopId,
            code: normalizedProd.code,
            name: normalizedProd.name,
            description: normalizedProd.description || '',
            type: normalizedProd.type,
            cat: normalizedProd.cat,
            price: normalizedProd.price,
            discount_pct: normalizedProd.disc || 0,
            frame_color: normalizedProd.frame,
            lens_color: normalizedProd.lens,
            shapes: normalizedProd.shapes,
            glb_url: normalizedProd.model3dUrl || null,
            tryon_mode: normalizedProd.tryonMode,
            processed_image: normalizedProd.processedImage || null,
            additional_images: normalizedProd.additionalImages || [],
            model_3d_url: normalizedProd.model3dUrl || null,
            model_calibration: normalizedProd.modelCalibration || {},
            frame_colors: normalizedProd.frameColors || [],
            available_colors: normalizedProd.availableColors || [],
            available_sizes: normalizedProd.availableSizes || ['Small', 'Medium', 'Large'],
            is_published: normalizedProd.isPublished,
          }));

          const extV5Rows = slice.map(({ normalizedProd }, idx) => ({
            ...extRows[idx],
            frame_type: normalizedProd.frameType || null,
            sub_category: normalizedProd.subCategory || null,
            image_path: normalizedProd.imagePath || null,
            front_catalog_path: normalizedProd.frontCatalogPath || null,
            side_image_path: normalizedProd.sideImagePath || null,
            clip_on_image_path: normalizedProd.clipOnImagePath || null,
            clip_on_front_catalog_path: normalizedProd.clipOnFrontCatalogPath || null,
            clip_on_side_image_path: normalizedProd.clipOnSideImagePath || null,
            aspect_ratio: normalizedProd.aspectRatio ?? null,
            lens_width_mm: normalizedProd.lensWidthMm ?? normalizedProd.modelCalibration?.lensWidthMm ?? null,
            bridge_width_mm: normalizedProd.bridgeWidthMm ?? normalizedProd.modelCalibration?.bridgeWidthMm ?? null,
            temple_length_mm: normalizedProd.templeLengthMm ?? normalizedProd.modelCalibration?.templeLengthMm ?? null,
            total_frame_width_mm:
              normalizedProd.totalFrameWidthMm ?? normalizedProd.modelCalibration?.totalFrameWidthMm ?? null,
            frame_hex_color: normalizedProd.frameHexColor || null,
            frame_opacity: normalizedProd.frameOpacity ?? null,
          }));

          let insRes = await supabase.from('products').insert(extV5Rows).select('id');
          if (insRes.error) {
            const fallbackRows = extV5Rows.map(({ lens_width_mm: _l, bridge_width_mm: _b, temple_length_mm: _t, total_frame_width_mm: _w, ...rest }) => rest);
            insRes = await supabase.from('products').insert(fallbackRows).select('id');
          }
          if (insRes.error) {
            insRes = await supabase.from('products').insert(extRows).select('id');
          }
          if (!insRes.error && insRes.data?.length) {
            const imgBatch: any[] = [];
            insRes.data.forEach((row: { id: string }, idx: number) => {
              const target = slice[idx];
              const finalId = row.id;
              const origIdx = i + idx;
              const syncedImages = target.images.map((im) => ({ ...im, productId: finalId }));
              finalProducts[origIdx] = { ...target.fullProd, id: finalId, images: syncedImages };
              syncedImages.forEach((im, imIdx) => {
                imgBatch.push({
                  product_id: finalId,
                  shop_id: target.normalizedProd.shopId,
                  angle_yaw: im.angleYaw,
                  label: im.label,
                  image_url: im.imageUrl,
                  original_image_url: im.originalImageUrl || null,
                  lens_mask_url: im.lensMaskUrl || null,
                  kind: im.kind || 'front_tryon',
                  sort_order: imIdx,
                });
              });
            });
            if (imgBatch.length) {
              await supabase.from('product_images').insert(imgBatch);
            }
          }
        }
        setProducts((prev) => {
          const map = new Map(finalProducts.map((p) => [p.code + '|' + p.shopId, p]));
          return prev.map((p) => map.get(p.code + '|' + p.shopId) || p);
        });
        return finalProducts;
      }

      return prepared.map((x) => x.fullProd);
    },
    [logAudit]
  );

  const updateProduct = useCallback(
    async (
      productId: string,
      patch: Partial<Omit<Product, 'id' | 'shopId'>>,
      replacedImages?: ProductImage[]
    ): Promise<Product | null> => {
      const existing = products.find((p) => p.id === productId);
      if (!existing) return null;

      const mergedColors = patch.frameColors || patch.availableColors;
      const resolvedModel3d = patch.model3dUrl !== undefined ? patch.model3dUrl : patch.glbUrl;

      const updated: Product = {
        ...existing,
        ...patch,
        ...(mergedColors ? { frameColors: mergedColors, availableColors: mergedColors } : {}),
        ...(resolvedModel3d !== undefined ? { model3dUrl: resolvedModel3d, glbUrl: resolvedModel3d } : {}),
        images: replacedImages !== undefined ? replacedImages.map((im) => ({ ...im, productId })) : existing.images,
      };
      setProducts((a) => a.map((p) => (p.id === productId ? updated : p)));
      await logAudit('تعديل نظارة', `تم تعديل ${updated.name} (${updated.code})`, existing.shopId);

      if (supabase) {
        const baseUpdate: Record<string, any> = {};
        if (patch.code !== undefined) baseUpdate.code = patch.code;
        if (patch.name !== undefined) baseUpdate.name = patch.name;
        if (patch.type !== undefined) baseUpdate.type = patch.type;
        if (patch.cat !== undefined) baseUpdate.cat = patch.cat;
        if (patch.price !== undefined) baseUpdate.price = patch.price;
        if (patch.disc !== undefined) baseUpdate.discount_pct = patch.disc;
        if (patch.frame !== undefined) baseUpdate.frame_color = patch.frame;
        if (patch.lens !== undefined) baseUpdate.lens_color = patch.lens;
        if (patch.shapes !== undefined) baseUpdate.shapes = patch.shapes;
        if (resolvedModel3d !== undefined) baseUpdate.glb_url = resolvedModel3d || null;

        const extUpdate: Record<string, any> = {
          ...baseUpdate,
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.tryonMode !== undefined ? { tryon_mode: patch.tryonMode } : {}),
          ...(patch.processedImage !== undefined ? { processed_image: patch.processedImage || null } : {}),
          ...(patch.additionalImages !== undefined ? { additional_images: patch.additionalImages } : {}),
          ...(resolvedModel3d !== undefined ? { model_3d_url: resolvedModel3d || null } : {}),
          ...(patch.modelCalibration !== undefined ? { model_calibration: patch.modelCalibration } : {}),
          ...(mergedColors !== undefined ? { frame_colors: mergedColors, available_colors: mergedColors } : {}),
          ...(patch.availableSizes !== undefined ? { available_sizes: patch.availableSizes } : {}),
          ...(patch.isPublished !== undefined ? { is_published: patch.isPublished } : {}),
        };

        const extV5Update: Record<string, any> = {
          ...extUpdate,
          ...(patch.frameType !== undefined ? { frame_type: patch.frameType } : {}),
          ...(patch.subCategory !== undefined ? { sub_category: patch.subCategory } : {}),
          ...(patch.imagePath !== undefined ? { image_path: patch.imagePath || null } : {}),
          ...(patch.frontCatalogPath !== undefined ? { front_catalog_path: patch.frontCatalogPath || null } : {}),
          ...(patch.sideImagePath !== undefined ? { side_image_path: patch.sideImagePath || null } : {}),
          ...(patch.clipOnImagePath !== undefined ? { clip_on_image_path: patch.clipOnImagePath || null } : {}),
          ...(patch.clipOnFrontCatalogPath !== undefined
            ? { clip_on_front_catalog_path: patch.clipOnFrontCatalogPath || null }
            : {}),
          ...(patch.clipOnSideImagePath !== undefined
            ? { clip_on_side_image_path: patch.clipOnSideImagePath || null }
            : {}),
          ...(patch.aspectRatio !== undefined ? { aspect_ratio: patch.aspectRatio } : {}),
          ...(patch.lensWidthMm !== undefined ? { lens_width_mm: patch.lensWidthMm } : {}),
          ...(patch.bridgeWidthMm !== undefined ? { bridge_width_mm: patch.bridgeWidthMm } : {}),
          ...(patch.templeLengthMm !== undefined ? { temple_length_mm: patch.templeLengthMm } : {}),
          ...(patch.totalFrameWidthMm !== undefined ? { total_frame_width_mm: patch.totalFrameWidthMm } : {}),
          ...(patch.frameHexColor !== undefined ? { frame_hex_color: patch.frameHexColor } : {}),
          ...(patch.frameOpacity !== undefined ? { frame_opacity: patch.frameOpacity } : {}),
        };

        if (Object.keys(extV5Update).length > 0) {
          let upRes = await supabase.from('products').update(extV5Update).eq('id', productId);
          if (upRes.error) {
            const { lens_width_mm: _l, bridge_width_mm: _b, temple_length_mm: _t, total_frame_width_mm: _w, ...extV5Fallback } = extV5Update;
            if (Object.keys(extV5Fallback).length > 0) {
              upRes = await supabase.from('products').update(extV5Fallback).eq('id', productId);
            }
          }
          if (upRes.error && Object.keys(extUpdate).length > 0) {
            upRes = await supabase.from('products').update(extUpdate).eq('id', productId);
          }
          if (upRes.error && Object.keys(baseUpdate).length > 0) {
            await supabase.from('products').update(baseUpdate).eq('id', productId);
          }
        }

        if (replacedImages !== undefined) {
          await supabase.from('product_images').delete().eq('product_id', productId);
          if (replacedImages.length > 0) {
            const imgRows = replacedImages.map((im, idx) => ({
              product_id: productId,
              shop_id: existing.shopId,
              angle_yaw: im.angleYaw,
              label: im.label,
              image_url: im.imageUrl,
              original_image_url: im.originalImageUrl || null,
              lens_mask_url: im.lensMaskUrl || null,
              kind: im.kind || 'front_tryon',
              sort_order: idx,
            }));
            const imgIns = await supabase.from('product_images').insert(imgRows);
            if (imgIns.error) {
              await supabase.from('product_images').insert(
                replacedImages.map((im, idx) => ({
                  product_id: productId,
                  shop_id: existing.shopId,
                  angle_yaw: im.angleYaw,
                  label: im.label,
                  image_url: im.imageUrl,
                  lens_mask_url: im.lensMaskUrl || null,
                  sort_order: idx,
                }))
              );
            }
          }
        }
      }
      return updated;
    },
    [logAudit, products]
  );

  const updateProductsBatch = useCallback(
    async (updates: { productId: string; patch: Partial<Omit<Product, 'id' | 'shopId'>> }[]) => {
      if (!updates.length) return;
      const patchMap = new Map(updates.map((u) => [u.productId, u.patch]));
      setProducts((prev) =>
        prev.map((p) => {
          const patch = patchMap.get(p.id);
          return patch ? { ...p, ...patch } : p;
        })
      );
      if (supabase) {
        for (let i = 0; i < updates.length; i += 20) {
          const chunk = updates.slice(i, i + 20);
          await Promise.all(
            chunk.map(({ productId, patch }) =>
              supabase!
                .from('products')
                .update({
                  ...(patch.price !== undefined ? { price: patch.price } : {}),
                  ...(patch.description !== undefined ? { description: patch.description } : {}),
                  ...(patch.modelCalibration !== undefined ? { model_calibration: patch.modelCalibration } : {}),
                  ...(patch.availableSizes !== undefined ? { available_sizes: patch.availableSizes } : {}),
                  ...(patch.isPublished !== undefined ? { is_published: patch.isPublished } : {}),
                })
                .eq('id', productId)
            )
          );
        }
      }
    },
    []
  );

  const toggleProductPublished = useCallback(
    async (productId: string) => {
      const target = products.find((p) => p.id === productId);
      if (!target) return;
      const nextPub = target.isPublished === false;
      await updateProduct(productId, { isPublished: nextPub });
    },
    [products, updateProduct]
  );

  const softDeleteProductByCode = useCallback(
    async (shopId: string, rawCode: string) => {
      const c = rawCode.trim().toUpperCase();
      if (!c) return { ok: false, error: 'اكتب كود النظارة' };
      const shopProds = products.filter((x) => x.shopId === shopId && !x.isDeleted);
      const found = shopProds.find((x) => (x.code || '').toUpperCase() === c);
      if (!found) return { ok: false, error: `لا توجد نظارة بالكود ${c}` };
      if (shopProds.length < 2) return { ok: false, error: 'لازم تفضل نظارة واحدة على الأقل في المتجر' };

      setProducts((a) => a.filter((x) => x.id !== found.id));
      await logAudit('حذف نظارة بالكود', `حذف ${found.name} (${found.code}) بعد البيع`, shopId);

      if (supabase) {
        await supabase
          .from('products')
          .update({ is_deleted: true, deleted_at: new Date().toISOString() })
          .eq('id', found.id);
      }
      return { ok: true, product: found };
    },
    [products, logAudit]
  );

  const softDeleteProductById = useCallback(
    async (productId: string) => {
      const target = products.find((p) => p.id === productId);
      setProducts((a) => a.filter((x) => x.id !== productId));
      if (target) {
        await logAudit('حذف نظارة', `حذف ${target.name} (${target.code})`, target.shopId);
      }
      if (supabase) {
        await supabase
          .from('products')
          .update({ is_deleted: true, deleted_at: new Date().toISOString() })
          .eq('id', productId);
      }
    },
    [products, logAudit]
  );

  const updateProductDiscount = useCallback(
    async (productId: string, disc: number) => {
      const target = products.find((p) => p.id === productId);
      setProducts((a) => a.map((x) => (x.id === productId ? { ...x, disc } : x)));
      if (target) {
        await logAudit('تعديل خصم', `تطبيق خصم ${disc}% على ${target.name}`, target.shopId);
      }
      if (supabase) {
        await supabase.from('products').update({ discount_pct: disc }).eq('id', productId);
      }
    },
    [products, logAudit]
  );

  const addProductReview = useCallback(
    async (input: {
      productId: string;
      shopId: string;
      authorName: string;
      rating: number;
      comment: string;
    }): Promise<ProductReview> => {
      const review: ProductReview = {
        id: generateId('rev'),
        productId: input.productId,
        shopId: input.shopId,
        authorName: input.authorName.trim(),
        rating: Math.max(1, Math.min(5, Math.round(input.rating))),
        comment: input.comment.trim(),
        createdAt: new Date().toISOString(),
      };
      setReviews((prev) => [review, ...prev]);
      if (supabase) {
        await supabase.from('frame_reviews').insert({
          id: review.id.length === 36 ? review.id : undefined,
          product_id: review.productId,
          shop_id: review.shopId,
          author_name: review.authorName,
          rating: review.rating,
          comment: review.comment,
        });
      }
      return review;
    },
    []
  );

  const syncCatalogItem = useCallback(
    async (kind: 'lens' | 'brand' | 'extra', shopId: string, op: 'upsert' | 'delete', item: any) => {
      const table = kind === 'lens' ? 'lens_types' : kind === 'brand' ? 'brands' : 'extras';
      await logAudit(
        op === 'delete' ? 'حذف من الكتالوج' : 'تحديث كتالوج العدسات',
        `${kind}: ${item.name} (${item.price} ج.م)`,
        shopId
      );
      if (!supabase) return;
      if (op === 'delete') {
        await supabase.from(table).delete().eq('shop_id', shopId).eq('id', item.id);
      } else {
        await supabase.from(table).upsert({
          id: item.id,
          shop_id: shopId,
          name_ar: item.name,
          ...(kind !== 'extra' ? { name_en: item.en || '' } : {}),
          ...(kind === 'lens' ? { description: item.desc || '', icon: item.icon || 'eye' } : {}),
          price: item.price,
          discount_pct: item.disc || 0,
          is_active: item.on !== false,
        });
      }
    },
    [logAudit]
  );

  const addInquiry = useCallback(async (q: Inquiry) => {
    addMyInquiryId(q.id);
    setInq((a) => [q, ...a]);
    if (supabase) {
      await supabase.from('inquiries').insert({
        ref_code: q.id,
        shop_id: q.shopId,
        kind: q.kind,
        customer_name: q.cust,
        phone: q.phone,
        frame_name: q.frameName,
        frame_type: q.type,
        frame_color: q.frame,
        lens_color: q.lens,
        lens_name: q.lensName,
        brand_name: q.brandName,
        extras_txt: q.extrasTxt,
        frame_price: q.fp,
        lens_price: q.lensPrice,
        add_price: q.add,
        initial_price: q.price,
        rx_image_url: q.img,
        pd: q.pd,
        notes: q.notes,
        status: q.status,
        stage: q.stage || 'review',
        payment_method: q.pay || null,
      });
    }
  }, []);

  const updateInquiry = useCallback(async (id: string, patch: Partial<Inquiry>) => {
    setInq((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (supabase) {
      await supabase
        .from('inquiries')
        .update({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.final !== undefined ? { final_price: patch.final } : {}),
          ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
          ...(patch.alt !== undefined ? { alt_to: patch.alt } : {}),
          ...(patch.altFrom !== undefined ? { alt_from: patch.altFrom } : {}),
          ...(patch.lensName !== undefined ? { lens_name: patch.lensName } : {}),
          ...(patch.lensPrice !== undefined ? { lens_price: patch.lensPrice } : {}),
          ...(patch.price !== undefined ? { initial_price: patch.price } : {}),
        })
        .eq('ref_code', id);
    }
  }, []);

  const enterShopAsMerchant = useCallback(
    (s: Shop) => {
      setActiveShopSlug(s.slug);
      setSession({
        userId: session?.userId || 'admin-impersonate',
        email: session?.email || 'admin@optiverse.app',
        role: 'merchant',
        shopId: s.id,
      });
      navigate('/merchant');
      toast(`دخلت كمتجر: ${s.name}`);
    },
    [navigate, session, toast]
  );

  const exportFullBackup = useCallback(async () => {
    let payload: any = null;
    if (supabase && session?.role === 'admin') {
      try {
        const { data, error } = await supabase.functions.invoke('optiverse-admin', {
          body: { action: 'export_backup' },
        });
        if (!error && data && !data.error) {
          payload = data;
        }
      } catch {
        // fallback cleanly to local snapshot export
      }
    }

    if (!payload) {
      payload = {
        exported_at: new Date().toISOString(),
        shops,
        products,
        inquiries: inq,
        lensTypes,
        brands,
        extras,
        plans,
        payments,
        auditLogs,
      };
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `optiverse-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('تم تصدير نسخة احتياطية كاملة (JSON) ✓');
  }, [session?.role, shops, products, inq, lensTypes, brands, extras, plans, payments, auditLogs, toast]);

  return (
    <Ctx.Provider
      value={{
        route,
        navigate,
        toast,
        modal,
        setModal,
        session,
        setSession,
        authLoading,
        signInWithSupabase,
        signInUnified,
        signInWithGoogle,
        signInWithApple,
        registerMerchant,
        signOut,
        shops,
        setShops,
        activeShop,
        setActiveShopSlug,
        updateShop,
        addShopManual,
        extraShops,
        setExtraShops,
        products,
        setProducts,
        addProduct,
        addProductsBulk,
        updateProduct,
        updateProductsBatch,
        toggleProductPublished,
        softDeleteProductByCode,
        softDeleteProductById,
        updateProductDiscount,
        reviews,
        addProductReview,
        inq,
        setInq,
        addInquiry,
        updateInquiry,
        lensTypes,
        setLensTypes,
        brands,
        setBrands,
        extras,
        setExtras,
        syncCatalogItem,
        plans,
        setPlans,
        savePlan,
        payments,
        setPayments,
        recordPayment,
        auditLogs,
        logAudit,
        fav,
        setFav,
        cart,
        setCart,
        enterShopAsMerchant,
        exportFullBackup,
        uploadAssetToStorage,
      }}
    >
      {children}
      {tst && (
        <div className="fixed z-[120] bottom-24 inset-x-0 flex justify-center pointer-events-none px-4">
          <div className="pop glass-s px-5 py-3 rounded-2xl font-bold text-sm shadow-2xl border border-teal-400/40 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="tx-acc">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {tst}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
