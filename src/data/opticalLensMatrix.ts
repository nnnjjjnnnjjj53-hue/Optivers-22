import {
  CustomLabDesign,
  LensCategoryKey,
  LensIndex,
  LensMatrixPriceCell,
  LensTrack,
  MerchantLensBrandConfig,
  OfficialLensBrand,
  PhotoVariant,
  SponsorBadgeType,
} from '../types';

export interface LensCategoryMeta {
  key: LensCategoryKey;
  nameAr: string;
  nameEn: string;
  descAr: string;
  coatingPreviewId: string;
  indices: LensIndex[];
  variants: PhotoVariant[];
}

export const LENS_TRACKS: { key: LensTrack; labelAr: string; labelEn: string; descAr: string }[] = [
  {
    key: 'single_vision',
    labelAr: 'عدسات جاهزة (Single Vision)',
    labelEn: 'Single Vision',
    descAr: 'عدسات جاهزة للرؤية البعيدة أو القراءة — تسليم سريع',
  },
  {
    key: 'custom_lab',
    labelAr: 'عدسات التصنيع (Multifocal & Bifocal)',
    labelEn: 'Custom Lab (Multifocal & Bifocal)',
    descAr: 'عدسات مالتي فوكال وباي فوكال مخصصة حسب كشف النظر بالمعمل',
  },
];

export const CUSTOM_LAB_DESIGNS: { key: CustomLabDesign; labelAr: string; descAr: string }[] = [
  {
    key: 'progressive',
    labelAr: 'مالتي فوكال (Progressive)',
    descAr: 'رؤية متدرجة سلسة للبعيد والمتوسط والقراءة بدون خط فاصل',
  },
  {
    key: 'bifocal',
    labelAr: 'باي فوكال (Bifocal)',
    descAr: 'عدسة ثنائية البؤرة للبعيد والقراءة بوضوح عالٍ',
  },
];

export const LENS_CATEGORIES: LensCategoryMeta[] = [
  {
    key: 'white_plastic',
    nameAr: 'بلاستيك أبيض',
    nameEn: 'White Plastic',
    descAr: 'عدسة صافية قياسية للاستخدام اليومي الأساسي بدون طبقات ملونة',
    coatingPreviewId: 'plastic',
    indices: ['1.56', '1.60', '1.67', '1.74'],
    variants: ['none'],
  },
  {
    key: 'anti_reflection',
    nameAr: 'أنتي ريفليكشن',
    nameEn: 'Anti-Reflection',
    descAr: 'تقلل الوهج وانعكاسات الإضاءة وتمنح رؤية نقية نهاراً وليلاً',
    coatingPreviewId: 'ar',
    indices: ['1.56', '1.60', '1.67', '1.74'],
    variants: ['none'],
  },
  {
    key: 'blue_cut',
    nameAr: 'بلو كات',
    nameEn: 'Blue Cut',
    descAr: 'حماية فعّالة للعين من الأشعة الزرقاء الضارة للشاشات والهواتف',
    coatingPreviewId: 'bluecut',
    indices: ['1.56', '1.60', '1.67', '1.74'],
    variants: ['none'],
  },
  {
    key: 'photochromic',
    nameAr: 'أنتي ريفليكشن + فوتو',
    nameEn: 'Photochromic',
    descAr: 'تتحول تلقائياً لنظارة شمسية في الشمس وتعود صافية في الأماكن المغلقة',
    coatingPreviewId: 'ar',
    indices: ['1.56', '1.60', '1.67'],
    variants: ['photo_grey', 'photo_brown'],
  },
  {
    key: 'night_drive',
    nameAr: 'نايت درايف',
    nameEn: 'Night Drive',
    descAr: 'تقلل وهج مصابيح السيارات ليلاً وتزيد وضوح الطريق والتباين',
    coatingPreviewId: 'bluectrl',
    indices: ['1.56', '1.60', '1.67'],
    variants: ['none'],
  },
  {
    key: 'three_in_one',
    nameAr: 'العدسة الشاملة ثلاثية الخواص',
    nameEn: '3-in-1: بلو كات + فوتو + نايت درايف',
    descAr: 'حماية شاملة: عزل الضوء الأزرق + تغميق بالشمس + منع وهج القيادة الليلية',
    coatingPreviewId: 'bluectrl',
    indices: ['1.56', '1.60', '1.67'],
    variants: ['photo_grey', 'photo_brown'],
  },
];

export const PHOTO_VARIANT_LABELS: Record<PhotoVariant, string> = {
  none: 'قياسي',
  photo_grey: 'فوتو جراي (Photo Grey)',
  photo_brown: 'فوتو براون (Photo Brown)',
};

export const LENS_INDEX_META: Record<
  LensIndex,
  { index: LensIndex; labelAr: string; shortAr: string; tooltipAr: string }
> = {
  '1.56': {
    index: '1.56',
    labelAr: '1.56 (عادي)',
    shortAr: 'عادي',
    tooltipAr: 'مناسب لضعف النظر البسيط (حتى ±2.00 ديوبتر) — اقتصادي ومريح للشنابر الكاملة',
  },
  '1.60': {
    index: '1.60',
    labelAr: '1.60 (مضغوط)',
    shortAr: 'مضغوط',
    tooltipAr: 'أنحف بنسبة 20% وأكثر متانة — مثالي للقياسات المتوسطة (±2.25 إلى ±4.00) أو الإطارات الرفيعة',
  },
  '1.67': {
    index: '1.67',
    labelAr: '1.67 (عالي الضغط)',
    shortAr: 'عالي الضغط',
    tooltipAr: 'عدسة رفيعة جداً وخفيفة على الأنف — مثالية للقياسات العالية (±4.25 إلى ±6.00)',
  },
  '1.74': {
    index: '1.74',
    labelAr: '1.74 (فائق الضغط)',
    shortAr: 'فائق الضغط',
    tooltipAr: 'أرفع عدسة طبية متاحة عالمياً — للقياسات الشديدة فوق ±6.00 لتجنب سماكة الأطراف',
  },
};

export const SPONSOR_BADGE_LABELS: Record<SponsorBadgeType, string> = {
  official_sponsor: 'الراعي الرسمي ⭐',
  featured_partner: 'شريك مميز',
  none: 'شركة معتمدة',
};

export function makeMatrixCellKey(
  categoryKey: LensCategoryKey,
  variant: PhotoVariant,
  index: LensIndex
): string {
  return `${categoryKey}:${variant}:${index}`;
}

export function getMatrixCellsForCategory(categoryKey: LensCategoryKey): {
  key: string;
  categoryKey: LensCategoryKey;
  variant: PhotoVariant;
  variantLabelAr: string;
  index: LensIndex;
  labelAr: string;
}[] {
  const meta = LENS_CATEGORIES.find((c) => c.key === categoryKey) || LENS_CATEGORIES[0];
  const cells: {
    key: string;
    categoryKey: LensCategoryKey;
    variant: PhotoVariant;
    variantLabelAr: string;
    index: LensIndex;
    labelAr: string;
  }[] = [];

  for (const variant of meta.variants) {
    for (const index of meta.indices) {
      const variantLabelAr = variant === 'none' ? '' : PHOTO_VARIANT_LABELS[variant];
      cells.push({
        key: makeMatrixCellKey(meta.key, variant, index),
        categoryKey: meta.key,
        variant,
        variantLabelAr,
        index,
        labelAr: variant === 'none' ? `ضغط ${index}` : `${variantLabelAr} · ${index}`,
      });
    }
  }
  return cells;
}

const BASE_SV_PRICES: Record<LensCategoryKey, Record<LensIndex, number>> = {
  white_plastic: { '1.56': 250, '1.60': 420, '1.67': 680, '1.74': 1150 },
  anti_reflection: { '1.56': 400, '1.60': 600, '1.67': 900, '1.74': 1450 },
  blue_cut: { '1.56': 550, '1.60': 780, '1.67': 1150, '1.74': 1750 },
  photochromic: { '1.56': 680, '1.60': 950, '1.67': 1350, '1.74': 1350 },
  night_drive: { '1.56': 700, '1.60': 980, '1.67': 1400, '1.74': 1400 },
  three_in_one: { '1.56': 950, '1.60': 1300, '1.67': 1750, '1.74': 1750 },
};

export function buildSeededMatrixPrices(
  brandMultiplier: number,
  track: LensTrack = 'single_vision'
): Record<string, LensMatrixPriceCell> {
  const trackMultiplier = track === 'custom_lab' ? 2.4 : 1.0;
  const out: Record<string, LensMatrixPriceCell> = {};

  for (const cat of LENS_CATEGORIES) {
    for (const variant of cat.variants) {
      for (const index of cat.indices) {
        const base = BASE_SV_PRICES[cat.key][index] || 450;
        const raw = base * brandMultiplier * trackMultiplier;
        const rounded = Math.round(raw / 10) * 10;
        out[makeMatrixCellKey(cat.key, variant, index)] = {
          enabled: true,
          recommendedPrice: rounded,
        };
      }
    }
  }
  return out;
}

export const DEFAULT_OFFICIAL_LENS_BRANDS: OfficialLensBrand[] = [
  // Track A: Single Vision
  {
    id: 'sv-pixel',
    track: 'single_vision',
    nameAr: 'بيكسل',
    nameEn: 'Pixel',
    origin: 'ألماني',
    priority: 1,
    sponsorBadge: 'official_sponsor',
    allowedVariancePct: 20,
    isActive: true,
    prices: buildSeededMatrixPrices(1.35, 'single_vision'),
  },
  {
    id: 'sv-kodak',
    track: 'single_vision',
    nameAr: 'كوداك',
    nameEn: 'Kodak',
    origin: 'أمريكي',
    priority: 2,
    sponsorBadge: 'featured_partner',
    allowedVariancePct: 20,
    isActive: true,
    prices: buildSeededMatrixPrices(1.45, 'single_vision'),
  },
  {
    id: 'sv-scope',
    track: 'single_vision',
    nameAr: 'سكوب',
    nameEn: 'Scope',
    origin: 'كوري',
    priority: 3,
    sponsorBadge: 'featured_partner',
    allowedVariancePct: 20,
    isActive: true,
    prices: buildSeededMatrixPrices(1.2, 'single_vision'),
  },
  {
    id: 'sv-hcl',
    track: 'single_vision',
    nameAr: 'إتش سي إل',
    nameEn: 'HCL',
    origin: 'كوري',
    priority: 4,
    sponsorBadge: 'none',
    allowedVariancePct: 20,
    isActive: true,
    prices: buildSeededMatrixPrices(1.1, 'single_vision'),
  },
  {
    id: 'sv-best',
    track: 'single_vision',
    nameAr: 'بيست',
    nameEn: 'Best',
    origin: 'اقتصادي معتمد',
    priority: 5,
    sponsorBadge: 'none',
    allowedVariancePct: 25,
    isActive: true,
    prices: buildSeededMatrixPrices(0.85, 'single_vision'),
  },
  {
    id: 'sv-biven',
    track: 'single_vision',
    nameAr: 'بيفين',
    nameEn: 'Biven',
    origin: 'كوري / صيني',
    priority: 6,
    sponsorBadge: 'none',
    allowedVariancePct: 25,
    isActive: true,
    prices: buildSeededMatrixPrices(0.95, 'single_vision'),
  },
  {
    id: 'sv-square',
    track: 'single_vision',
    nameAr: 'سكوير',
    nameEn: 'Square',
    origin: 'كوري',
    priority: 7,
    sponsorBadge: 'none',
    allowedVariancePct: 25,
    isActive: true,
    prices: buildSeededMatrixPrices(1.0, 'single_vision'),
  },

  // Track B: Custom Lab (Multifocal & Bifocal)
  {
    id: 'lab-kodak',
    track: 'custom_lab',
    nameAr: 'كوداك تصنيع',
    nameEn: 'Kodak Lab',
    origin: 'أمريكي — معمل',
    priority: 1,
    sponsorBadge: 'official_sponsor',
    allowedVariancePct: 15,
    estimatedDays: 4,
    supportsProgressive: true,
    supportsBifocal: true,
    isActive: true,
    prices: buildSeededMatrixPrices(1.4, 'custom_lab'),
  },
  {
    id: 'lab-pixel',
    track: 'custom_lab',
    nameAr: 'بيكسل تصنيع',
    nameEn: 'Pixel Lab',
    origin: 'ألماني — معمل',
    priority: 2,
    sponsorBadge: 'featured_partner',
    allowedVariancePct: 15,
    estimatedDays: 5,
    supportsProgressive: true,
    supportsBifocal: true,
    isActive: true,
    prices: buildSeededMatrixPrices(1.3, 'custom_lab'),
  },
  {
    id: 'lab-scope',
    track: 'custom_lab',
    nameAr: 'سكوب تصنيع',
    nameEn: 'Scope Lab',
    origin: 'كوري — معمل',
    priority: 3,
    sponsorBadge: 'none',
    allowedVariancePct: 20,
    estimatedDays: 5,
    supportsProgressive: true,
    supportsBifocal: true,
    isActive: true,
    prices: buildSeededMatrixPrices(1.15, 'custom_lab'),
  },
  {
    id: 'lab-hcl',
    track: 'custom_lab',
    nameAr: 'HCL تصنيع',
    nameEn: 'HCL Lab',
    origin: 'كوري — معمل',
    priority: 4,
    sponsorBadge: 'none',
    allowedVariancePct: 20,
    estimatedDays: 6,
    supportsProgressive: true,
    supportsBifocal: true,
    isActive: true,
    prices: buildSeededMatrixPrices(1.0, 'custom_lab'),
  },
];

export function getAllowedPriceBounds(
  recommendedPrice: number,
  allowedVariancePct: number
): { min: number; max: number } {
  const safeRec = Math.max(0, Math.round(recommendedPrice));
  const pct = Math.max(0, Math.min(90, allowedVariancePct));
  const min = Math.max(0, Math.round(safeRec * (1 - pct / 100)));
  const max = Math.round(safeRec * (1 + pct / 100));
  return { min, max };
}

export function clampMerchantPriceToVariance(
  price: number,
  recommendedPrice: number,
  allowedVariancePct: number
): { min: number; max: number; clamped: number; isOutOfBounds: boolean } {
  const { min, max } = getAllowedPriceBounds(recommendedPrice, allowedVariancePct);
  const rounded = Math.max(0, Math.round(price));
  const isOutOfBounds = rounded < min || rounded > max;
  const clamped = Math.max(min, Math.min(max, rounded));
  return { min, max, clamped, isOutOfBounds };
}

export interface ResolvedMerchantBrandRow {
  brandId: string;
  track: LensTrack;
  isCustomBrand: boolean;
  nameAr: string;
  nameEn: string;
  origin?: string;
  priority: number;
  sponsorBadge: SponsorBadgeType;
  allowedVariancePct: number;
  estimatedDays?: number;
  supportsProgressive: boolean;
  supportsBifocal: boolean;
  isEnabled: boolean;
  officialPrices?: Record<string, LensMatrixPriceCell>;
  merchantPrices: Record<string, { enabled: boolean; price: number }>;
}

export function resolveMerchantBrandRowsForTrack(
  officialBrands: OfficialLensBrand[],
  merchantConfigs: MerchantLensBrandConfig[],
  shopId: string,
  track: LensTrack
): { officialRows: ResolvedMerchantBrandRow[]; customRows: ResolvedMerchantBrandRow[] } {
  const configByBrandId = new Map<string, MerchantLensBrandConfig>();
  merchantConfigs
    .filter((c) => c.shopId === shopId && c.track === track)
    .forEach((c) => configByBrandId.set(c.brandId, c));

  const officialRows: ResolvedMerchantBrandRow[] = officialBrands
    .filter((b) => b.track === track && b.isActive)
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((b) => {
      const cfg = configByBrandId.get(b.id);
      const merchantPrices: Record<string, { enabled: boolean; price: number }> = {};
      for (const [cellKey, cell] of Object.entries(b.prices || {})) {
        const override = cfg?.prices?.[cellKey];
        const rawPrice = override ? override.price : cell.recommendedPrice;
        const { clamped } = clampMerchantPriceToVariance(
          rawPrice,
          cell.recommendedPrice,
          b.allowedVariancePct
        );
        merchantPrices[cellKey] = {
          enabled: override ? override.enabled && cell.enabled : cell.enabled,
          price: clamped,
        };
      }
      return {
        brandId: b.id,
        track: b.track,
        isCustomBrand: false,
        nameAr: b.nameAr,
        nameEn: b.nameEn,
        origin: b.origin,
        priority: b.priority,
        sponsorBadge: b.sponsorBadge,
        allowedVariancePct: b.allowedVariancePct,
        estimatedDays: b.estimatedDays,
        supportsProgressive: b.supportsProgressive !== false,
        supportsBifocal: b.supportsBifocal !== false,
        isEnabled: cfg ? cfg.isEnabled : true,
        officialPrices: b.prices,
        merchantPrices,
      };
    });

  const customRows: ResolvedMerchantBrandRow[] = merchantConfigs
    .filter((c) => c.shopId === shopId && c.track === track && c.isCustomBrand)
    .map((c, idx) => ({
      brandId: c.brandId,
      track: c.track,
      isCustomBrand: true,
      nameAr: c.nameAr || 'شركة خاصة',
      nameEn: c.nameEn || 'Custom Brand',
      origin: c.origin || 'خاصة بالمحل',
      priority: 1000 + idx,
      sponsorBadge: 'none',
      allowedVariancePct: 100,
      estimatedDays: c.estimatedDays,
      supportsProgressive: c.supportsProgressive !== false,
      supportsBifocal: c.supportsBifocal !== false,
      isEnabled: c.isEnabled,
      merchantPrices: c.prices || {},
    }));

  return { officialRows, customRows };
}

export interface CustomerResolvedLensBrandOption {
  brandId: string;
  track: LensTrack;
  isCustomBrand: boolean;
  nameAr: string;
  nameEn: string;
  origin?: string;
  priority: number;
  sponsorBadge: SponsorBadgeType;
  estimatedDays?: number;
  exactPrice?: number;
  minPrice: number;
  maxPrice: number;
  isStoreDecide: boolean;
}

export function resolveCustomerLensBrands(params: {
  officialBrands: OfficialLensBrand[];
  merchantConfigs: MerchantLensBrandConfig[];
  shopId: string;
  track: LensTrack;
  labDesign?: CustomLabDesign;
  categoryKey: LensCategoryKey;
  variant: PhotoVariant;
  indexOrStoreDecide: LensIndex | 'store_decide';
}): CustomerResolvedLensBrandOption[] {
  const {
    officialBrands,
    merchantConfigs,
    shopId,
    track,
    labDesign = 'progressive',
    categoryKey,
    variant,
    indexOrStoreDecide,
  } = params;

  const { officialRows, customRows } = resolveMerchantBrandRowsForTrack(
    officialBrands,
    merchantConfigs,
    shopId,
    track
  );
  // Official/sponsored brands strictly precede custom merchant brands
  const orderedRows = [...officialRows, ...customRows];
  const catMeta = LENS_CATEGORIES.find((c) => c.key === categoryKey) || LENS_CATEGORIES[0];
  const effectiveVariant: PhotoVariant = catMeta.variants.includes(variant) ? variant : catMeta.variants[0];

  const results: CustomerResolvedLensBrandOption[] = [];

  for (const row of orderedRows) {
    if (!row.isEnabled) continue;
    if (track === 'custom_lab') {
      if (labDesign === 'progressive' && !row.supportsProgressive) continue;
      if (labDesign === 'bifocal' && !row.supportsBifocal) continue;
    }

    if (indexOrStoreDecide === 'store_decide') {
      const enabledPrices = catMeta.indices
        .map((idx) => row.merchantPrices[makeMatrixCellKey(categoryKey, effectiveVariant, idx)])
        .filter((cell) => cell && cell.enabled && cell.price > 0)
        .map((cell) => cell.price);
      if (!enabledPrices.length) continue;
      const minPrice = Math.min(...enabledPrices);
      const maxPrice = Math.max(...enabledPrices);
      results.push({
        brandId: row.brandId,
        track: row.track,
        isCustomBrand: row.isCustomBrand,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        origin: row.origin,
        priority: row.priority,
        sponsorBadge: row.sponsorBadge,
        estimatedDays: row.estimatedDays,
        minPrice,
        maxPrice,
        isStoreDecide: true,
      });
    } else {
      const cell = row.merchantPrices[makeMatrixCellKey(categoryKey, effectiveVariant, indexOrStoreDecide)];
      if (!cell || !cell.enabled) continue;
      results.push({
        brandId: row.brandId,
        track: row.track,
        isCustomBrand: row.isCustomBrand,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        origin: row.origin,
        priority: row.priority,
        sponsorBadge: row.sponsorBadge,
        estimatedDays: row.estimatedDays,
        exactPrice: cell.price,
        minPrice: cell.price,
        maxPrice: cell.price,
        isStoreDecide: false,
      });
    }
  }

  return results;
}
