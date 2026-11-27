import { FaceShape, Product } from '../types';
import { resolveTryOnFrontUrl } from './bulkFrameProcessor';
import { assessOpticalFit, resolveProductOpticalDimensions } from './opticalDimensions';

export type VipFaceShape = 'round' | 'oval' | 'square' | 'heart';

export interface VipFaceAnalysisResult {
  shape: VipFaceShape;
  userFaceWidthMm: number;
  whRatio: number;
  jawToCheek: number;
  foreheadToJaw: number;
}

export interface VipFrameRecommendation {
  product: Product;
  score: number;
  matchReasonAr: string;
}

export const VIP_FACE_SHAPE_META: Record<
  VipFaceShape,
  {
    labelAr: string;
    shortAr: string;
    emoji: string;
    reasonAr: string;
    recommendedTagsAr: string;
  }
> = {
  round: {
    labelAr: 'دائري',
    shortAr: 'وجه دائري',
    emoji: '⚪',
    reasonAr: 'الإطارات المربعة والمستطيلة والـ Cat-Eye تبرز زوايا الوجه وتمنح توازناً بصرياً أنيقاً.',
    recommendedTagsAr: 'مربع · هندسي · Cat-Eye',
  },
  oval: {
    labelAr: 'بيضاوي',
    shortAr: 'وجه بيضاوي',
    emoji: '💎',
    reasonAr: 'ملامحك متناسقة وتناسبك أغلب الإطارات؛ الأفياتور والمربع والكلاسيك يبرزون التوازن الطبيعي.',
    recommendedTagsAr: 'أفياتور · مربع · دائري',
  },
  square: {
    labelAr: 'مربع',
    shortAr: 'وجه مربع',
    emoji: '🟦',
    reasonAr: 'الإطارات الدائرية والبيضاوية والأفياتور تليّن زوايا الفك وتضفي انسيابية ناعمة على الوجه.',
    recommendedTagsAr: 'دائري · بيضاوي · أفياتور',
  },
  heart: {
    labelAr: 'قلب',
    shortAr: 'وجه قلب',
    emoji: '🩷',
    reasonAr: 'الإطارات الخفيفة والأفياتور والدائرية توازن عرض الجبهة العلوي مع استدقاق الذقن.',
    recommendedTagsAr: 'أفياتور · دائري · حافة رفيعة',
  },
};

function pxDist(
  a: { x: number; y: number } | undefined,
  b: { x: number; y: number } | undefined,
  w: number,
  h: number
): number {
  if (!a || !b) return 0;
  return Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
}

/**
 * Classifies face shape locally from MediaPipe FaceLandmarker points
 * into: round | oval | square | heart (zero external API or token calls).
 */
export function classifyVipFaceShape(
  landmarks: { x: number; y: number; z: number }[],
  videoWidth = 1280,
  videoHeight = 720
): VipFaceAnalysisResult | null {
  if (!landmarks || landmarks.length < 400) return null;
  const w = Math.max(160, videoWidth || 1280);
  const h = Math.max(120, videoHeight || 720);

  const foreheadTop = landmarks[10];
  const chinBottom = landmarks[152];
  const foreheadL = landmarks[54] || landmarks[71];
  const foreheadR = landmarks[284] || landmarks[301];
  const cheekL = landmarks[234] || landmarks[127];
  const cheekR = landmarks[454] || landmarks[356];
  const jawL = landmarks[172] || landmarks[58];
  const jawR = landmarks[397] || landmarks[288];

  const faceLength = pxDist(foreheadTop, chinBottom, w, h);
  const foreheadWidth = pxDist(foreheadL, foreheadR, w, h);
  const cheekWidth = pxDist(cheekL, cheekR, w, h);
  const jawWidth = pxDist(jawL, jawR, w, h);

  if (faceLength < 20 || cheekWidth < 20) return null;

  const whRatio = cheekWidth / faceLength;
  const jawToCheek = jawWidth / cheekWidth;
  const foreheadToJaw = foreheadWidth / Math.max(1, jawWidth);

  let shape: VipFaceShape = 'oval';
  if (foreheadToJaw >= 1.22 && jawToCheek <= 0.79) {
    shape = 'heart';
  } else if (jawToCheek >= 0.85 && whRatio < 0.89) {
    shape = 'square';
  } else if (whRatio >= 0.8 && jawToCheek < 0.85) {
    shape = 'round';
  } else {
    shape = 'oval';
  }

  // Estimate physical cheek width in mm using calibrated iris/eye span (~63mm average adult IPD)
  const hasIrises = landmarks.length > 473 && landmarks[468] && landmarks[473];
  const eyeDistPx = hasIrises
    ? pxDist(landmarks[468], landmarks[473], w, h)
    : pxDist(landmarks[33], landmarks[263], w, h) * 0.68;
  const pxPerMm = Math.max(0.4, eyeDistPx / 63);
  const userFaceWidthMm = Math.round(Math.max(122, Math.min(156, cheekWidth / pxPerMm)));

  return {
    shape,
    userFaceWidthMm,
    whRatio,
    jawToCheek,
    foreheadToJaw,
  };
}

function getEffectiveFrameStyle(p: Product): 'round' | 'oval' | 'square' | 'cat_eye' | 'aviator' | 'rimless' {
  const tag = p.frameShapeTag || p.modelCalibration?.frameShapeTag;
  if (tag) return tag;
  if (p.type === 'round') return 'round';
  if (p.type === 'aviator') return 'aviator';
  if (p.type === 'cat') return 'cat_eye';
  if (p.type === 'rimless') return 'rimless';
  return 'square';
}

const SHAPE_PREFERENCE_WEIGHTS: Record<
  VipFaceShape,
  Record<'round' | 'oval' | 'square' | 'cat_eye' | 'aviator' | 'rimless', number>
> = {
  round: {
    square: 34,
    cat_eye: 28,
    aviator: 18,
    rimless: 16,
    oval: 12,
    round: -8,
  },
  square: {
    round: 34,
    oval: 30,
    aviator: 26,
    rimless: 24,
    cat_eye: 16,
    square: -6,
  },
  heart: {
    aviator: 32,
    rimless: 30,
    round: 26,
    oval: 24,
    cat_eye: 14,
    square: 8,
  },
  oval: {
    aviator: 28,
    square: 26,
    round: 24,
    cat_eye: 22,
    oval: 22,
    rimless: 18,
  },
};

const REASON_BY_PAIR: Record<
  VipFaceShape,
  Partial<Record<'round' | 'oval' | 'square' | 'cat_eye' | 'aviator' | 'rimless', string>>
> = {
  round: {
    square: 'إطار مربع يحدد ملامح الوجه الدائري ويمنحه طولاً وتوازناً مثالياً',
    cat_eye: 'تصميم Cat-Eye يرفع خط العينين ويبرز تناسق الوجنتين',
    aviator: 'زوايا الأفياتور تكسر استدارة الوجه بأسلوب أنيق',
  },
  square: {
    round: 'تصميم دائري ناعم يخفف من حدة زوايا الفك',
    oval: 'خطوط بيضاوية انسيابية تمنح الوجه توازناً مريحاً',
    aviator: 'إطار أفياتور منحني يكمل عرض الجبهة والفك بسلاسة',
    rimless: 'إطار خفيف بدون حواف حادة ينعّم ملامح الوجه المربع',
  },
  heart: {
    aviator: 'إطار أفياتور يوازن عرض الجبهة العلوي مع منطقة الذقن',
    rimless: 'وزن خفيف وتصميم مفتوح يحافظ على رقة ملامح الوجه القلب',
    round: 'عدسات دائرية تضيف امتلاءً متوازناً لأسفل الوجه',
    oval: 'تناسب بيضاوي هادئ يبرز العينين دون تضخيم الجبهة',
  },
  oval: {
    aviator: 'تناسب كلاسيكي رائع للوجه البيضاوي بحضور لافت',
    square: 'خطوط مربعة عصرية تبرز تناسق الوجه البيضاوي',
    round: 'لمسة دائرية متوازنة تتماشى بسلاسة مع نسب وجهك',
    cat_eye: 'انحناءة أنيقة تبرز عظمة الوجنتين وتناسق الوجه',
  },
};

/**
 * Ranks strictly IN-STOCK frames from this specific merchant's inventory (`stock > 0 && !isDeleted`)
 * and returns the Top 3 recommendations for the detected face shape.
 */
export function recommendTop3FramesForShop(
  shopProducts: Product[],
  faceShape: VipFaceShape,
  userFaceWidthMm?: number
): VipFrameRecommendation[] {
  const inStock = shopProducts.filter((p) => !p.isDeleted && (p.stock ?? 1) > 0);
  if (!inStock.length) return [];

  const compatFaceKey: FaceShape = faceShape === 'heart' ? 'oval' : faceShape;
  const weights = SHAPE_PREFERENCE_WEIGHTS[faceShape];

  const scored = inStock.map((product) => {
    const style = getEffectiveFrameStyle(product);
    let score = 60 + (weights[style] ?? 12);

    if (product.shapes?.includes(compatFaceKey)) {
      score += 14;
    }

    const dims = resolveProductOpticalDimensions(product);
    if (userFaceWidthMm) {
      const fit = assessOpticalFit(userFaceWidthMm, dims.totalFrameWidthMm);
      if (fit.status === 'ideal') score += 12;
      else score -= 4;
    }

    // Prefer frames ready with studio/3D try-on assets for immediate in-store impression
    if (product.model3dUrl || product.glbUrl) score += 6;
    if (resolveTryOnFrontUrl(product)) score += 6;
    if (product.isPublished !== false) score += 4;

    const clampedScore = Math.max(72, Math.min(99, Math.round(score)));
    const matchReasonAr =
      REASON_BY_PAIR[faceShape]?.[style] || VIP_FACE_SHAPE_META[faceShape].reasonAr;

    return { product, score: clampedScore, matchReasonAr };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}
