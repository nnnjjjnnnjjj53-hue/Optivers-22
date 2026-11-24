export type OpticalPresetKey = 'S' | 'M' | 'L';

export interface OpticalPreset {
  key: OpticalPresetKey;
  labelAr: string;
  shortLabel: string;
  lensWidthMm: number;
  bridgeWidthMm: number;
  templeLengthMm: number;
  totalFrameWidthMm: number;
}

export interface OpticalDimensionsSpec {
  lensWidthMm: number;
  bridgeWidthMm: number;
  templeLengthMm: number;
  totalFrameWidthMm: number;
}

export interface OpticalFitAssessment {
  status: 'ideal' | 'narrow' | 'oversized';
  matchPct: number;
  badgeLabel: string;
  subLabel: string;
  userFaceWidthMm: number;
  frameWidthMm: number;
  diffMm: number;
}

export function clampLensWidthMm(val: number): number {
  if (!Number.isFinite(val)) return 52;
  return Math.max(35, Math.min(70, Math.round(val)));
}

export function clampBridgeWidthMm(val: number): number {
  if (!Number.isFinite(val)) return 18;
  return Math.max(10, Math.min(30, Math.round(val)));
}

export function clampTempleLengthMm(val: number): number {
  if (!Number.isFinite(val)) return 140;
  return Math.max(110, Math.min(165, Math.round(val)));
}

export function computeTotalFrameWidthMm(lensWidthMm: number, bridgeWidthMm: number): number {
  const lens = clampLensWidthMm(lensWidthMm);
  const bridge = clampBridgeWidthMm(bridgeWidthMm);
  return 2 * lens + bridge + 10;
}

export function formatOpticalDimensions(
  lensWidthMm: number,
  bridgeWidthMm: number,
  templeLengthMm: number
): string {
  return `${clampLensWidthMm(lensWidthMm)}□${clampBridgeWidthMm(bridgeWidthMm)}-${clampTempleLengthMm(templeLengthMm)}`;
}

export const OPTICAL_PRESETS: Record<OpticalPresetKey, OpticalPreset> = {
  S: {
    key: 'S',
    labelAr: 'صغير S (48-17-135)',
    shortLabel: 'S · صغير',
    lensWidthMm: 48,
    bridgeWidthMm: 17,
    templeLengthMm: 135,
    totalFrameWidthMm: computeTotalFrameWidthMm(48, 17), // 123 mm
  },
  M: {
    key: 'M',
    labelAr: 'وسط M (52-18-140)',
    shortLabel: 'M · وسط',
    lensWidthMm: 52,
    bridgeWidthMm: 18,
    templeLengthMm: 140,
    totalFrameWidthMm: computeTotalFrameWidthMm(52, 18), // 132 mm
  },
  L: {
    key: 'L',
    labelAr: 'كبير L (56-19-145)',
    shortLabel: 'L · كبير',
    lensWidthMm: 56,
    bridgeWidthMm: 19,
    templeLengthMm: 145,
    totalFrameWidthMm: computeTotalFrameWidthMm(56, 19), // 141 mm
  },
};

export function getDefaultOpticalDimensions(isKids = false): OpticalDimensionsSpec {
  if (isKids) {
    return {
      lensWidthMm: 44,
      bridgeWidthMm: 16,
      templeLengthMm: 125,
      totalFrameWidthMm: computeTotalFrameWidthMm(44, 16), // 114 mm
    };
  }
  return {
    lensWidthMm: 52,
    bridgeWidthMm: 18,
    templeLengthMm: 140,
    totalFrameWidthMm: computeTotalFrameWidthMm(52, 18), // 132 mm
  };
}

export function parseOpticalDimensionsString(
  raw?: string | null,
  isKids = false
): OpticalDimensionsSpec {
  const defaults = getDefaultOpticalDimensions(isKids);
  if (!raw || typeof raw !== 'string') return defaults;
  const match = raw.match(/(\d{2})\s*[□\[\]\-xX\/\s]\s*(\d{2})(?:\s*[-–\s]\s*(\d{3}))?/);
  if (!match) return defaults;
  const lensWidthMm = clampLensWidthMm(Number(match[1]));
  const bridgeWidthMm = clampBridgeWidthMm(Number(match[2]));
  const templeLengthMm = match[3] ? clampTempleLengthMm(Number(match[3])) : defaults.templeLengthMm;
  return {
    lensWidthMm,
    bridgeWidthMm,
    templeLengthMm,
    totalFrameWidthMm: computeTotalFrameWidthMm(lensWidthMm, bridgeWidthMm),
  };
}

export function resolveProductOpticalDimensions(product: {
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
  frameType?: string;
  modelCalibration?: {
    lensWidthMm?: number;
    bridgeWidthMm?: number;
    templeLengthMm?: number;
    totalFrameWidthMm?: number;
    frameWidthMm?: number;
    opticalDimensions?: string;
  };
}): OpticalDimensionsSpec {
  const isKids = product.frameType === 'kids';
  const parsed = parseOpticalDimensionsString(product.modelCalibration?.opticalDimensions, isKids);
  const lensWidthMm = clampLensWidthMm(
    product.lensWidthMm ?? product.modelCalibration?.lensWidthMm ?? parsed.lensWidthMm
  );
  const bridgeWidthMm = clampBridgeWidthMm(
    product.bridgeWidthMm ?? product.modelCalibration?.bridgeWidthMm ?? parsed.bridgeWidthMm
  );
  const templeLengthMm = clampTempleLengthMm(
    product.templeLengthMm ?? product.modelCalibration?.templeLengthMm ?? parsed.templeLengthMm
  );
  const totalFrameWidthMm =
    product.totalFrameWidthMm ??
    product.modelCalibration?.totalFrameWidthMm ??
    computeTotalFrameWidthMm(lensWidthMm, bridgeWidthMm);

  return {
    lensWidthMm,
    bridgeWidthMm,
    templeLengthMm,
    totalFrameWidthMm,
  };
}

export function assessOpticalFit(
  userFaceWidthMm: number,
  totalFrameWidthMm: number
): OpticalFitAssessment {
  const safeUser = Math.max(100, Math.min(180, Math.round(userFaceWidthMm)));
  const safeFrame = Math.max(95, Math.min(175, Math.round(totalFrameWidthMm)));
  const diffMm = safeFrame - safeUser;
  const matchPct = Math.max(76, Math.min(99, Math.round(99 - Math.abs(diffMm) * 1.1)));

  if (Math.abs(diffMm) <= 6) {
    return {
      status: 'ideal',
      matchPct,
      badgeLabel: `مقاس مثالي لوجهك ${matchPct}%`,
      subLabel: `متطابق بدقة 1:1 مع عرض وجهك (${safeFrame} مم)`,
      userFaceWidthMm: safeUser,
      frameWidthMm: safeFrame,
      diffMm,
    };
  }
  if (diffMm < -6) {
    return {
      status: 'narrow',
      matchPct,
      badgeLabel: 'قد يكون الإطار ضيقاً قليلاً',
      subLabel: `عرض الإطار ${safeFrame} مم مقارنة بعرض وجهك ${safeUser} مم`,
      userFaceWidthMm: safeUser,
      frameWidthMm: safeFrame,
      diffMm,
    };
  }
  return {
    status: 'oversized',
    matchPct,
    badgeLabel: 'إطار عريض Oversized',
    subLabel: `عرض الإطار ${safeFrame} مم يمنحك إطلالة أوسع من وجهك`,
    userFaceWidthMm: safeUser,
    frameWidthMm: safeFrame,
    diffMm,
  };
}
