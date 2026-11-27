import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { getShopMaxProducts, getShopPlanCapabilities, isAdminRole, useOptiVerse } from '../services/optiverseStore';
import {
  EyewearFrameMode,
  EyewearSubMode,
  FrameCat,
  FrameColorFamily,
  FrameMaterial,
  FrameShapeTag,
  FrameSize,
  FrameType,
  ModelCalibration,
  Product,
  ProductImage,
} from '../types';
import { generateTintedCatalogAsset, processCutoutInWorker } from '../utils/cutoutWorkerClient';
import { processGlassesImage, refineGlassesMaskAndDecontaminate } from '../utils/glassesImagePipeline';
import {
  computeFrameColorVariance,
  computePerceptualHash,
  estimateLensTintLocally,
  extractOpticalDimensionsViaServer,
  generateSplitSheetViaServer,
  saveToSharedEyewearCache,
} from '../utils/splitSheetApi';
import { CutoutWorkerOutput } from '../workers/cutoutWorker';
import { deleteDraftFrame, loadDraftFrames, PersistedDraftFrame, saveDraftFrame } from '../utils/draftStorage';
import { Eyewear3DViewer } from './Eyewear3DARStage';
import { FrameFitPreview, PhotoUploadGuidelines } from './FrameFitPreviewCard';
import { I } from './Icons';
import { CollectionPosterFrame, NewCollectionPromoModal } from './NewCollectionPromoModal';
import { Modal } from './UiShared';

type CardProcessStatus = 'enhancing' | 'ready' | 'error';

const MAX_BATCH_SIZE = 50;

interface BulkFrameItem {
  localId: string;
  savedProductId?: string;
  sourceFile?: File;
  clipOnSourceFile?: File;
  sideSourceFile?: File;
  originalThumbUrl: string;
  status: CardProcessStatus;
  stageLabel: string;
  errorMsg?: string;
  quality?: 'good' | 'check';
  qualityNoteAr?: string;
  approved: boolean;
  isPublished: boolean;
  mergedIntoExistingProduct?: boolean;
  showFacePreview?: boolean;
  previewClipOn?: boolean;
  cacheHit?: boolean;
  autoColorSibling?: boolean;
  localFallback?: boolean;
  name: string;
  code: string;
  modelCode?: string;
  phash?: string;
  price: number;
  salePrice?: number;
  frameType: EyewearFrameMode;
  subCategory: EyewearSubMode;
  frameWidthMm: number;
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
  ocrFound?: boolean;
  isCrystalFrame?: boolean;
  keepLensBranding?: boolean;
  opticalDimensions: string;
  fitScale: number;
  eyeLineOffset: number;
  cat: FrameCat;
  material: FrameMaterial;
  type: FrameType;
  aspectRatio: number;
  frameHexColor: string;
  frameColors?: string[];
  frameOpacity: number;
  frameShapeTag?: FrameShapeTag;
  isPatterned?: boolean;
  colorFamily?: FrameColorFamily;
  calibration?: ModelCalibration;
  imagePath?: string; // 1200px transparent Try-On
  frontCatalogPath?: string; // 1200x900 #F8F9FA studio shot
  sideImagePath?: string; // 1200x900 #F8F9FA 3/4 side shot
  clipOnImagePath?: string;
  clipOnFrontCatalogPath?: string;
  clipOnSideImagePath?: string;
  maskUrl?: string;
  sideBusy?: boolean;
  glbFile?: File;
  glbPreviewUrl?: string;
  glbStorageUrl?: string;
  reprocessing?: boolean;
  isNewCollection?: boolean;
  newCollectionUntil?: string;
  lensTint?: 'clear' | 'tinted';
  preOcrChecked?: boolean;
}

const FRAME_MODES: {
  id: EyewearFrameMode;
  title: string;
  desc: string;
  badge?: string;
}[] = [
  {
    id: 'prescription',
    title: 'نظارات طبية',
    desc: 'صورة أمامية واحدة · تفريغ العدسات بشفافية طبيعية للوجه',
  },
  {
    id: 'sunglasses',
    title: 'نظارات شمسية',
    desc: 'صورة أمامية واحدة · يحافظ على لون وتظليل عدسات الشمس',
  },
  {
    id: 'clip_on',
    title: 'نظارات بغيار شمس',
    desc: 'صورتان لكل نظارة (بدون الغيار + بالغيار المغناطيسي)',
    badge: 'زوج صور',
  },
  {
    id: 'kids',
    title: 'نظارات أطفال',
    desc: 'مقاس ومقياس أطفال مخصص (0.90x) بالتجربة الثلاثية الأبعاد',
  },
  {
    id: 'metal',
    title: 'شنابر معادن / هاف فريم / فريم ليس',
    desc: 'حماية الحواف المعدنية الدقيقة ولمعان معدني واقعي',
  },
];

const WIDTH_PRESETS: { label: string; mm: number }[] = [
  { label: 'S (128mm)', mm: 128 },
  { label: 'M (136mm)', mm: 136 },
  { label: 'L (144mm)', mm: 144 },
];

const PAGE_SIZE = 24;

function cleanNameFromFile(filename: string, index: number): string {
  const base = filename
    .replace(/\.[^/.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!base || /^\d+$/.test(base)) return `شنبر بصري #${index + 1}`;
  return base.slice(0, 42);
}

function extractColorGroupingKey(filename: string, modelCode?: string | null): string {
  if (modelCode && modelCode.trim().length >= 3) {
    return modelCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  const stem = filename
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[-_](black|gold|silver|blue|brown|red|green|clear|crystal|havana|tortoise|gray|grey|sun|clip|clipon|c\d+|\d+)$/i, '')
    .trim();
  return stem.length >= 3 ? stem : '';
}

function hexColorDistance(hexA?: string, hexB?: string): number {
  if (!hexA || !hexB || !/^#[0-9a-f]{6}$/i.test(hexA) || !/^#[0-9a-f]{6}$/i.test(hexB)) {
    return 999;
  }
  const r1 = parseInt(hexA.slice(1, 3), 16);
  const g1 = parseInt(hexA.slice(3, 5), 16);
  const b1 = parseInt(hexA.slice(5, 7), 16);
  const r2 = parseInt(hexB.slice(1, 3), 16);
  const g2 = parseInt(hexB.slice(3, 5), 16);
  const b2 = parseInt(hexB.slice(5, 7), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function phashHammingDistance(hashA?: string, hashB?: string): number {
  if (!hashA || !hashB || hashA.length !== hashB.length) return 999;
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    const x = parseInt(hashA[i], 16) ^ parseInt(hashB[i], 16);
    if (Number.isNaN(x)) return 999;
    dist += ((x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1));
  }
  return dist;
}

function areSequentialClipOnPair(clearItem: BulkFrameItem, tintedItem: BulkFrameItem): boolean {
  if (clearItem.lensTint !== 'clear' || tintedItem.lensTint !== 'tinted') return false;

  const codeA = (clearItem.modelCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const codeB = (tintedItem.modelCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (codeA.length >= 3 && codeB.length >= 3) {
    if (codeA === codeB || codeA.includes(codeB) || codeB.includes(codeA)) return true;
  }

  const stemA = extractColorGroupingKey(clearItem.sourceFile?.name || clearItem.name, clearItem.modelCode);
  const stemB = extractColorGroupingKey(tintedItem.sourceFile?.name || tintedItem.name, tintedItem.modelCode);
  if (stemA && stemB && stemA === stemB) return true;

  const sameShape = Boolean(
    clearItem.frameShapeTag &&
      tintedItem.frameShapeTag &&
      clearItem.frameShapeTag === tintedItem.frameShapeTag
  );
  const sameColorFamily = Boolean(
    clearItem.colorFamily &&
      tintedItem.colorFamily &&
      clearItem.colorFamily !== 'other' &&
      clearItem.colorFamily === tintedItem.colorFamily
  );
  const closeColor = hexColorDistance(clearItem.frameHexColor, tintedItem.frameHexColor) <= 85;
  const closePhash = phashHammingDistance(clearItem.phash, tintedItem.phash) <= 18;

  if (sameShape && (sameColorFamily || closeColor || closePhash)) return true;
  if (sameColorFamily && closePhash) return true;
  return false;
}

function sizeListFromWidth(mm: number): FrameSize[] {
  if (mm <= 130) return ['Small', 'Medium'];
  if (mm >= 142) return ['Medium', 'Large'];
  return ['Small', 'Medium', 'Large'];
}

function resolveCatFromMode(mode: EyewearFrameMode, sub: EyewearSubMode): FrameCat {
  if (mode === 'sunglasses') return 'sun';
  if (mode === 'prescription' || mode === 'clip_on') return 'med';
  return sub === 'sun' ? 'sun' : 'med';
}

function formatOpticalString(lens?: number | null, bridge?: number | null, temple?: number | null, fallback = '52-18-140'): string {
  if (lens && bridge) {
    return `${lens}-${bridge}-${temple || 140}`;
  }
  return fallback;
}

function buildProductPayloadFromItem(
  shopId: string,
  it: BulkFrameItem
): { prod: Omit<Product, 'id'>; images: ProductImage[] } {
  const cat = resolveCatFromMode(it.frameType, it.subCategory);
  const storeFront = it.frontCatalogPath || it.imagePath || '';
  const tryOnFront = it.imagePath || storeFront;
  const colorsList = it.frameColors?.length ? it.frameColors : [it.frameHexColor || '#1f2937'];

  const prod: Omit<Product, 'id'> = {
    shopId,
    code: it.code,
    modelCode: it.modelCode,
    name: it.name,
    description: `إطار ${it.material === 'metal' ? 'معدن' : 'بلاستيك TR'} · عرض ${it.frameWidthMm}mm · ${it.opticalDimensions}`,
    type: it.type,
    cat,
    frameType: it.frameType,
    subCategory: it.subCategory,
    price: Math.max(0, Math.round(it.price || 0)),
    salePrice: it.salePrice && it.salePrice > 0 && it.salePrice < it.price ? Math.round(it.salePrice) : undefined,
    disc:
      it.salePrice && it.salePrice > 0 && it.salePrice < it.price
        ? Math.round(((it.price - it.salePrice) / Math.max(1, it.price)) * 100)
        : 0,
    frame: it.frameHexColor || '#1f2937',
    lens: cat === 'sun' ? '#334155' : '#dbeafe',
    lensWidthMm: it.lensWidthMm,
    bridgeWidthMm: it.bridgeWidthMm,
    templeLengthMm: it.templeLengthMm,
    totalFrameWidthMm: it.totalFrameWidthMm || it.frameWidthMm,
    tryonMode: it.glbStorageUrl ? '3d' : '2d',
    processedImage: storeFront,
    storeFrontUrl: storeFront,
    tryOnFrontUrl: tryOnFront,
    imagePath: it.imagePath,
    frontCatalogPath: it.frontCatalogPath,
    sideImagePath: it.sideImagePath,
    clipOnImagePath: it.clipOnImagePath,
    clipOnFrontCatalogPath: it.clipOnFrontCatalogPath,
    clipOnSideImagePath: it.clipOnSideImagePath,
    aspectRatio: it.aspectRatio,
    frameHexColor: it.frameHexColor,
    frameOpacity: it.frameOpacity,
    keepLensBranding: Boolean(it.keepLensBranding),
    isCrystalFrame: Boolean(it.isCrystalFrame),
    phash: it.phash,
    additionalImages: it.sideImagePath ? [it.sideImagePath] : undefined,
    glbUrl: it.glbStorageUrl,
    model3dUrl: it.glbStorageUrl,
    frameColors: colorsList,
    availableColors: colorsList,
    availableSizes: sizeListFromWidth(it.frameWidthMm),
    shapes: ['oval', 'round', 'square'],
    frameShapeTag: it.frameShapeTag,
    isPatterned: it.isPatterned,
    colorFamily: it.colorFamily,
    // Approval gate: never publish until merchant explicitly clicks اعتماد
    isPublished: Boolean(it.isPublished),
    stock: 1,
    isNewCollection: Boolean(it.isNewCollection),
    newCollectionUntil: it.newCollectionUntil,
    modelCalibration: {
      ...(it.calibration || {}),
      frameWidthMm: it.frameWidthMm,
      lensWidthMm: it.lensWidthMm,
      bridgeWidthMm: it.bridgeWidthMm,
      templeLengthMm: it.templeLengthMm,
      totalFrameWidthMm: it.totalFrameWidthMm || it.frameWidthMm,
      opticalDimensions: it.opticalDimensions,
      material: it.material,
      isSunglasses: cat === 'sun',
      lensMaskUrl: it.maskUrl,
      storeFrontUrl: storeFront,
      tryOnFrontUrl: tryOnFront,
      aspectRatio: it.aspectRatio ? Number((1 / Math.max(0.2, it.aspectRatio)).toFixed(4)) : 0.41,
      fitScale: it.fitScale,
      eyeLineOffset: it.eyeLineOffset,
      frameShapeTag: it.frameShapeTag,
      isPatterned: it.isPatterned,
      colorFamily: it.colorFamily,
      modelCode: it.modelCode,
      stock: 1,
      isNewCollection: Boolean(it.isNewCollection),
      newCollectionUntil: it.newCollectionUntil,
    },
  };

  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const images: ProductImage[] = [
    {
      id: `img-${uid}-tryon`,
      productId: '',
      angleYaw: 0,
      label: 'نسخة التجربة المفرّغة',
      imageUrl: tryOnFront,
      originalImageUrl: storeFront,
      lensMaskUrl: it.maskUrl,
      kind: 'front_tryon',
      sortOrder: 0,
    },
    {
      id: `img-${uid}-store`,
      productId: '',
      angleYaw: 0,
      label: 'الصورة الأمامية للكتالوج',
      imageUrl: storeFront,
      kind: 'gallery',
      sortOrder: 1,
    },
  ];

  if (it.sideImagePath) {
    images.push({
      id: `img-${uid}-side`,
      productId: '',
      angleYaw: 35,
      label: 'الزاوية الجانبية 3/4',
      imageUrl: it.sideImagePath,
      kind: 'gallery',
      sortOrder: 2,
    });
  }

  return { prod, images };
}

function toPersistedDraft(shopId: string, it: BulkFrameItem): PersistedDraftFrame {
  return {
    localId: it.localId,
    shopId,
    savedProductId: it.savedProductId,
    name: it.name,
    code: it.code,
    modelCode: it.modelCode,
    price: it.price,
    salePrice: it.salePrice,
    frameType: it.frameType,
    subCategory: it.subCategory,
    cat: it.cat,
    material: it.material,
    type: it.type,
    frameWidthMm: it.frameWidthMm,
    lensWidthMm: it.lensWidthMm,
    bridgeWidthMm: it.bridgeWidthMm,
    templeLengthMm: it.templeLengthMm,
    totalFrameWidthMm: it.totalFrameWidthMm,
    ocrFound: it.ocrFound,
    isCrystalFrame: it.isCrystalFrame,
    keepLensBranding: it.keepLensBranding,
    opticalDimensions: it.opticalDimensions,
    fitScale: it.fitScale,
    eyeLineOffset: it.eyeLineOffset,
    status: it.status,
    stageLabel: it.stageLabel,
    errorMsg: it.errorMsg,
    approved: it.approved,
    isPublished: it.isPublished,
    aspectRatio: it.aspectRatio,
    frameHexColor: it.frameHexColor,
    frameOpacity: it.frameOpacity,
    imagePath: it.imagePath,
    frontCatalogPath: it.frontCatalogPath,
    sideImagePath: it.sideImagePath,
    clipOnImagePath: it.clipOnImagePath,
    clipOnFrontCatalogPath: it.clipOnFrontCatalogPath,
    clipOnSideImagePath: it.clipOnSideImagePath,
    lensMaskUrl: it.maskUrl,
    updatedAt: Date.now(),
  };
}

function fromPersistedDraft(d: PersistedDraftFrame): BulkFrameItem {
  return {
    localId: d.localId,
    savedProductId: d.savedProductId,
    originalThumbUrl: d.frontCatalogPath || d.imagePath || '',
    status: d.status === 'enhancing' && !d.imagePath ? 'error' : (d.status as CardProcessStatus),
    stageLabel: d.imagePath ? 'جاهزة للاعتماد' : d.stageLabel,
    errorMsg: d.errorMsg,
    approved: d.approved,
    isPublished: d.isPublished,
    name: d.name,
    code: d.code,
    modelCode: d.modelCode,
    price: d.price,
    salePrice: d.salePrice,
    frameType: d.frameType,
    subCategory: d.subCategory,
    frameWidthMm: d.frameWidthMm,
    lensWidthMm: d.lensWidthMm,
    bridgeWidthMm: d.bridgeWidthMm,
    templeLengthMm: d.templeLengthMm,
    totalFrameWidthMm: d.totalFrameWidthMm,
    ocrFound: d.ocrFound,
    isCrystalFrame: d.isCrystalFrame,
    keepLensBranding: d.keepLensBranding,
    opticalDimensions: d.opticalDimensions,
    fitScale: d.fitScale,
    eyeLineOffset: d.eyeLineOffset,
    cat: d.cat,
    material: d.material,
    type: d.type,
    aspectRatio: d.aspectRatio || 2.4,
    frameHexColor: d.frameHexColor || '#1f2937',
    frameOpacity: d.frameOpacity ?? 1.0,
    imagePath: d.imagePath,
    frontCatalogPath: d.frontCatalogPath,
    sideImagePath: d.sideImagePath,
    clipOnImagePath: d.clipOnImagePath,
    clipOnFrontCatalogPath: d.clipOnFrontCatalogPath,
    clipOnSideImagePath: d.clipOnSideImagePath,
    maskUrl: d.lensMaskUrl,
  };
}

async function sampleRoughHexFromFile(file: Blob): Promise<string> {
  try {
    if (typeof createImageBitmap !== 'function') return '#1f2937';
    const bm = await createImageBitmap(file);
    try {
      const c = document.createElement('canvas');
      c.width = 24;
      c.height = 24;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return '#1f2937';
      ctx.drawImage(bm, 0, 0, 24, 24);
      const px = ctx.getImageData(0, 0, 24, 24).data;
      const samples: Array<[number, number, number]> = [];
      for (let y = 6; y < 18; y++) {
        for (let x = 4; x < 20; x++) {
          const i = (y * 24 + x) * 4;
          if (px[i + 3] < 200) continue;
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          if (lum > 225) continue; // skip white background
          samples.push([px[i], px[i + 1], px[i + 2]]);
        }
      }
      c.width = 0;
      c.height = 0;
      if (!samples.length) return '#1f2937';
      samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
      const m = samples[Math.floor(samples.length / 2)];
      return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    } finally {
      bm.close();
    }
  } catch {
    return '#1f2937';
  }
}

export function BulkFrameUploader({
  onSaved,
  externalNewCollectionSignal = 0,
  onNavigateToProds,
}: {
  onSaved?: () => void;
  externalNewCollectionSignal?: number;
  onNavigateToProds?: () => void;
}) {
  const {
    session,
    activeShop,
    products,
    platformSettings,
    getAccessToken,
    addTopUpCredits,
    addProduct,
    updateProduct,
    updateProductsBatch,
    softDeleteProductById,
    uploadAssetToStorage,
    toast,
  } = useOptiVerse();

  const planCaps = getShopPlanCapabilities(activeShop, platformSettings);
  const maxProducts = getShopMaxProducts(activeShop, platformSettings);
  const activeShopProductsCount = useMemo(
    () => products.filter((p) => p.shopId === activeShop.id && !p.isDeleted).length,
    [products, activeShop.id]
  );
  const canSingleQuickUpload = planCaps.tierKey === 'pro' || planCaps.tierKey === 'premium';
  const isAdmin = isAdminRole(session?.role);
  const aiCreditsLimit = Number(activeShop.aiCreditsLimit ?? planCaps.monthlyAiCredits ?? 110);
  const aiCreditsUsed = Number(activeShop.aiCreditsUsed ?? 0);
  const topupCredits = Number(activeShop.topupCredits ?? 0);
  const safeAiCreditsLimit = Number.isFinite(aiCreditsLimit) ? aiCreditsLimit : 110;
  const safeAiCreditsUsed = Number.isFinite(aiCreditsUsed) ? aiCreditsUsed : 0;
  const safeTopupCredits = Number.isFinite(topupCredits) ? topupCredits : 0;
  const isUnlimitedCredits =
    isAdmin || Boolean(activeShop.isDemoAdminStore) || safeAiCreditsLimit >= 99999;
  const creditsCap = (safeAiCreditsLimit || Number(planCaps.monthlyAiCredits || 110)) + safeTopupCredits;
  const remainingCredits = isUnlimitedCredits
    ? 999999
    : Math.max(0, creditsCap - safeAiCreditsUsed);
  const [outOfCreditsModal, setOutOfCreditsModal] = useState<'credits' | 'capacity' | null>(null);

  // Unified Auto-Classification State + New Collection Mode
  const autoGroupColors = true;
  const [keepLensBranding, setKeepLensBranding] = useState<boolean>(false);
  const [validationAlert, setValidationAlert] = useState<string | null>(null);
  const [isNewCollectionMode, setIsNewCollectionMode] = useState(false);
  const [promoModalFrames, setPromoModalFrames] = useState<CollectionPosterFrame[] | null>(null);

  useEffect(() => {
    if (externalNewCollectionSignal > 0) {
      setIsNewCollectionMode(true);
    }
  }, [externalNewCollectionSignal]);

  const [items, setItems] = useState<BulkFrameItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  // Top bulk action controls
  const [bulkPrice, setBulkPrice] = useState<string>('950');
  const [bulkWidthMm, setBulkWidthMm] = useState<number>(136);
  const [bulkOpticalDim, setBulkOpticalDim] = useState<string>('52-18-140');

  // Inspection modal state
  const [inspectItem, setInspectItem] = useState<BulkFrameItem | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<BulkFrameItem[]>([]);
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const splitSheetPickerRef = useRef<HTMLInputElement | null>(null);
  const queueAnchorRef = useRef<HTMLDivElement | null>(null);
  itemsRef.current = items;

  const openUnifiedPicker = () => {
    setValidationAlert(null);
    if (pickerRef.current) {
      pickerRef.current.multiple = true;
    }
    pickerRef.current?.click();
  };

  useEffect(() => {
    if (!platformSettings.allowMerchantLensBrandingToggle) {
      setKeepLensBranding(false);
    }
  }, [platformSettings.allowMerchantLensBrandingToggle]);

  // Hydrate unresolved drafts from IndexedDB when shop changes
  useEffect(() => {
    let active = true;
    loadDraftFrames(activeShop.id).then((drafts) => {
      if (!active || !drafts.length) return;
      const hydrated = drafts.filter((d) => !d.approved).map(fromPersistedDraft);
      if (hydrated.length > 0) {
        setItems((prev) => {
          const existingIds = new Set(prev.map((x) => x.localId));
          return [...prev, ...hydrated.filter((h) => !existingIds.has(h.localId))];
        });
      }
    });
    return () => {
      active = false;
    };
  }, [activeShop.id]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      itemsRef.current.forEach((it) => {
        if (it.originalThumbUrl && it.originalThumbUrl.startsWith('blob:')) {
          URL.revokeObjectURL(it.originalThumbUrl);
        }
        if (it.glbPreviewUrl) URL.revokeObjectURL(it.glbPreviewUrl);
      });
    };
  }, []);

  const visibleItems = useMemo(() => items.slice(0, visibleLimit), [items, visibleLimit]);
  const hasMoreItems = items.length > visibleLimit;
  const readyUnapprovedCount = useMemo(
    () => items.filter((it) => it.status === 'ready' && !it.approved).length,
    [items]
  );
  const approvedCount = useMemo(
    () => items.filter((it) => it.approved && it.isPublished).length,
    [items]
  );

  const buildClientAuthMeta = async () => {
    const authToken = await getAccessToken();
    return {
      authToken,
      shopId: activeShop.id,
      role: session?.role || 'merchant',
      planTier: activeShop.planTier || 'basic',
      isDemoAdminStore: Boolean(activeShop.isDemoAdminStore),
    };
  };

  const uploadCutoutResult = async (res: CutoutWorkerOutput, shopId: string) => {
    const extCut = res.imagePath.ext || 'webp';
    const extCat = res.frontCatalogPath.ext || 'webp';
    const extSide = res.sideImagePath.ext || 'webp';
    const [imagePath, frontCatalogPath, sideImagePath, maskUrl] = await Promise.all([
      uploadAssetToStorage(res.imagePath.blob, `${shopId}/products/cutouts`, extCut),
      uploadAssetToStorage(res.frontCatalogPath.blob, `${shopId}/products/front`, extCat),
      uploadAssetToStorage(res.sideImagePath.blob, `${shopId}/products/side`, extSide),
      uploadAssetToStorage(res.lensMask.blob, `${shopId}/products/masks`, 'png'),
    ]);
    return { imagePath, frontCatalogPath, sideImagePath, maskUrl };
  };

  /**
   * Zero-Failure Local Isolation Pipeline:
   * Runs local cutout worker (processGlassesImage + refineGlassesMaskAndDecontaminate + 1200x900 #F8F9FA studio card),
   * falling back directly to main-thread processGlassesImage / refineGlassesMaskAndDecontaminate if worker fails.
   */
  const runLocalIsolationFallback = async (
    srcBlob: File | Blob,
    card: BulkFrameItem,
    effectiveSub: EyewearSubMode,
    sideFile?: File,
    isClipOnAttachment = false,
    signal?: AbortSignal
  ): Promise<{
    urls: { imagePath: string; frontCatalogPath: string; sideImagePath: string; maskUrl?: string };
    meta: {
      aspectRatio: number;
      frameHexColor: string;
      frameOpacity: number;
      detectedMaterial: FrameMaterial;
      detectedType: FrameType;
      calibration?: ModelCalibration;
      quality: 'good' | 'check';
      qualityNoteAr?: string;
    };
  }> => {
    const onStage = (stageLabel: string) => {
      if (signal?.aborted) return;
      setItems((prev) => prev.map((x) => (x.localId === card.localId ? { ...x, stageLabel } : x)));
    };

    try {
      const workerRes = await processCutoutInWorker(
        srcBlob,
        sideFile,
        {
          frameType: card.frameType,
          subCategory: effectiveSub,
          isClipOnAttachment,
          material: card.material,
          isCrystalFrame: Boolean(card.isCrystalFrame),
          frameWidthMm: card.frameWidthMm,
          opticalDimensions: card.opticalDimensions,
          fitScale: card.fitScale,
          eyeLineOffset: card.eyeLineOffset,
        },
        onStage,
        undefined
      );
      if (signal?.aborted) {
        throw new DOMException('تم إلغاء الطلب', 'AbortError');
      }
      const urls = await uploadCutoutResult(workerRes, activeShop.id);
      return {
        urls,
        meta: {
          aspectRatio: workerRes.aspectRatio,
          frameHexColor: workerRes.frameHexColor,
          frameOpacity: workerRes.frameOpacity,
          detectedMaterial: workerRes.detectedMaterial,
          detectedType: workerRes.detectedType,
          calibration: workerRes.calibration,
          quality: workerRes.quality,
          qualityNoteAr: workerRes.qualityNoteAr,
        },
      };
    } catch (workerErr) {
      if (signal?.aborted || (workerErr instanceof DOMException && workerErr.name === 'AbortError')) {
        throw workerErr;
      }
      console.warn('[OptiVerse] Worker local cutout fallback -> direct processGlassesImage:', workerErr);
    }

    // Secondary main-thread fallback calling processGlassesImage directly (which uses refineGlassesMaskAndDecontaminate)
    try {
      const cat: FrameCat =
        card.frameType === 'sunglasses' || effectiveSub === 'sun' || isClipOnAttachment ? 'sun' : 'med';
      const localRes = await processGlassesImage(srcBlob, {
        category: cat,
        material: card.material,
        frameWidthMm: card.frameWidthMm || (card.frameType === 'kids' ? 122 : 136),
        opticalDimensions: card.opticalDimensions || '52-18-140',
        fitScale: card.fitScale ?? 1.0,
        eyeLineOffset: card.eyeLineOffset ?? 0.04,
        angleType: 'front',
        maxSidePx: 1200,
        onStage,
      });
      if (signal?.aborted) {
        throw new DOMException('تم إلغاء الطلب', 'AbortError');
      }
      const [imagePath, frontCatalogPath, maskUrl] = await Promise.all([
        uploadAssetToStorage(localRes.cutoutImage.blob, `${activeShop.id}/products/cutouts`, localRes.cutoutImage.ext || 'webp'),
        uploadAssetToStorage(localRes.storeImage.blob, `${activeShop.id}/products/front`, localRes.storeImage.ext || 'webp'),
        uploadAssetToStorage(localRes.lensMask.blob, `${activeShop.id}/products/masks`, 'png'),
      ]);
      return {
        urls: {
          imagePath,
          frontCatalogPath,
          sideImagePath: frontCatalogPath,
          maskUrl,
        },
        meta: {
          aspectRatio: localRes.aspectRatio || 2.4,
          frameHexColor: localRes.sampledFrameColor || card.frameHexColor || '#1f2937',
          frameOpacity: card.isCrystalFrame ? 0.75 : 1.0,
          detectedMaterial: localRes.detectedMaterial || card.material,
          detectedType: localRes.detectedType || card.type,
          calibration: localRes.calibration,
          quality: localRes.quality || 'good',
          qualityNoteAr: localRes.qualityNoteAr,
        },
      };
    } catch (directErr) {
      if (signal?.aborted || (directErr instanceof DOMException && directErr.name === 'AbortError')) {
        throw directErr;
      }
      console.warn('[OptiVerse] Direct processGlassesImage fallback -> canvas mask pass-through:', directErr);
    }

    // Ultimate canvas + refineGlassesMaskAndDecontaminate pass-through so processing never halts
    try {
      const bm = typeof createImageBitmap === 'function' ? await createImageBitmap(srcBlob) : null;
      if (bm) {
        const scale = Math.min(1, 1024 / Math.max(1, bm.width, bm.height));
        const cw = Math.max(1, Math.round(bm.width * scale));
        const ch = Math.max(1, Math.round(bm.height * scale));
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(bm, 0, 0, cw, ch);
          bm.close();
          const img = ctx.getImageData(0, 0, cw, ch);
          const mask = new Uint8Array(cw * ch).fill(255);
          const refined = refineGlassesMaskAndDecontaminate(img.data, mask, cw, ch, {
            category: effectiveSub === 'sun' ? 'sun' : 'med',
          });
          img.data.set(refined.refinedPixels);
          ctx.putImageData(img, 0, 0);
          const outBlob = await new Promise<Blob>((resolve) => {
            c.toBlob((b) => resolve(b || srcBlob), 'image/webp', 0.88);
          });
          c.width = 0;
          c.height = 0;
          const uploadedUrl = await uploadAssetToStorage(outBlob, `${activeShop.id}/products/front`, 'webp');
          return {
            urls: {
              imagePath: uploadedUrl,
              frontCatalogPath: uploadedUrl,
              sideImagePath: uploadedUrl,
            },
            meta: {
              aspectRatio: Number((cw / Math.max(1, ch)).toFixed(4)),
              frameHexColor: card.frameHexColor || '#1f2937',
              frameOpacity: card.isCrystalFrame ? 0.75 : 1.0,
              detectedMaterial: card.material,
              detectedType: card.type,
              quality: 'good',
            },
          };
        }
        bm.close();
      }
    } catch {
      // Fall through to raw source upload
    }

    const fallbackUrl = await uploadAssetToStorage(srcBlob, `${activeShop.id}/products/front`, 'webp');
    return {
      urls: {
        imagePath: fallbackUrl,
        frontCatalogPath: fallbackUrl,
        sideImagePath: fallbackUrl,
      },
      meta: {
        aspectRatio: card.aspectRatio || 2.4,
        frameHexColor: card.frameHexColor || '#1f2937',
        frameOpacity: card.isCrystalFrame ? 0.75 : 1.0,
        detectedMaterial: card.material,
        detectedType: card.type,
        quality: 'good',
      },
    };
  };

  const finalizeProcessedCard = async (
    cardSnapshot: BulkFrameItem,
    baseData: {
      imagePath: string;
      frontCatalogPath: string;
      sideImagePath: string;
      maskUrl?: string;
      aspectRatio: number;
      frameHexColor: string;
      frameOpacity: number;
      detectedMaterial: FrameMaterial;
      detectedType: FrameType;
      calibration?: ModelCalibration;
      quality: 'good' | 'check';
      qualityNoteAr?: string;
      cacheHit?: boolean;
      autoColorSibling?: boolean;
      localFallback?: boolean;
    },
    clipOnUrls: {
      clipOnImagePath?: string;
      clipOnFrontCatalogPath?: string;
      clipOnSideImagePath?: string;
    } = {}
  ): Promise<BulkFrameItem> => {
    const updatedCard: BulkFrameItem = {
      ...cardSnapshot,
      cat: resolveCatFromMode(cardSnapshot.frameType, cardSnapshot.subCategory),
      material: cardSnapshot.frameType === 'metal' ? 'metal' : baseData.detectedMaterial,
      type: cardSnapshot.type || baseData.detectedType,
      aspectRatio: baseData.aspectRatio,
      frameHexColor: baseData.frameHexColor,
      frameColors: cardSnapshot.frameColors?.length ? cardSnapshot.frameColors : [baseData.frameHexColor],
      frameOpacity: baseData.frameOpacity,
      calibration: baseData.calibration,
      imagePath: baseData.imagePath,
      frontCatalogPath: baseData.frontCatalogPath,
      sideImagePath: baseData.sideImagePath,
      maskUrl: baseData.maskUrl,
      ...clipOnUrls,
      cacheHit: baseData.cacheHit,
      autoColorSibling: baseData.autoColorSibling,
      localFallback: Boolean(baseData.localFallback),
      quality: baseData.quality,
      qualityNoteAr: baseData.qualityNoteAr,
      status: 'ready',
      stageLabel: baseData.cacheHit
        ? 'تجهيز فوري من الكتالوج ⚡'
        : baseData.autoColorSibling
        ? 'لون مضاف محلياً 🎨'
        : baseData.localFallback
        ? 'تمت المعالجة محلياً'
        : baseData.quality === 'check'
        ? 'يُرجى المراجعة'
        : 'جاهزة للاعتماد',
      approved: false,
      isPublished: false,
      reprocessing: false,
    };

    const { prod, images } = buildProductPayloadFromItem(activeShop.id, updatedCard);
    let savedProductId = updatedCard.savedProductId;
    try {
      if (savedProductId && !updatedCard.mergedIntoExistingProduct) {
        await updateProduct(savedProductId, prod, images);
      } else if (!savedProductId) {
        const saved = await addProduct(prod, images);
        savedProductId = saved.id;
        if (saved.mergedStockDuplicate) {
          updatedCard.mergedIntoExistingProduct = true;
          updatedCard.approved = true;
          updatedCard.isPublished = true;
          updatedCard.stageLabel = 'تم دمج المخزون مع الموديل المطابق 📦';
          toast(`تم رصد موديل ولون مطابقين — تم دمج المخزون تلقائياً في "${saved.name}" (الرصيد: ${saved.stock ?? 1}) 📦`);
        }
      }
      updatedCard.savedProductId = savedProductId;
    } catch (persistErr) {
      console.warn('[OptiVerse] Non-blocking draft persistence fallback:', persistErr);
    }

    try {
      await saveDraftFrame(toPersistedDraft(activeShop.id, updatedCard));
    } catch {
      // Non-blocking IndexedDB draft save
    }
    setItems((prev) => prev.map((x) => (x.localId === cardSnapshot.localId ? updatedCard : x)));
    return updatedCard;
  };

  const processSingleCard = async (
    cardSnapshot: BulkFrameItem,
    signal?: AbortSignal,
    precomputedSplit?: {
      blob?: Blob;
      cacheHit?: boolean;
      cachedAssets?: any;
      solidModelTemplate?: any;
      localFallbackOnly?: boolean;
    }
  ): Promise<BulkFrameItem | null> => {
    if (signal?.aborted) return null;

    const srcFile = cardSnapshot.sourceFile;
    if (!srcFile) {
      toast('أعد رفع الصورة الأصلية لإعادة المعالجة');
      return null;
    }

    setItems((prev) =>
      prev.map((x) =>
        x.localId === cardSnapshot.localId
          ? { ...x, status: 'enhancing', stageLabel: 'جاري قراءة المقاسات والهاش...', errorMsg: undefined, reprocessing: true }
          : x
      )
    );

    const effectiveSub: EyewearSubMode =
      cardSnapshot.frameType === 'clip_on' ? 'optical' : cardSnapshot.subCategory;
    let workingCard = { ...cardSnapshot };
    let usedLocalFallback = Boolean(precomputedSplit?.localFallbackOnly);

    try {
      const authMeta = await buildClientAuthMeta().catch(() => ({
        authToken: null,
        shopId: activeShop.id,
        role: session?.role || 'merchant',
        planTier: activeShop.planTier || 'basic',
        isDemoAdminStore: Boolean(activeShop.isDemoAdminStore),
      }));

      // Step 1: Zero-cost OCR dimension/model/shape/pattern extraction + pHash + local color variance
      if (!workingCard.preOcrChecked && (!workingCard.phash || !workingCard.ocrFound)) {
        try {
          const [ocr, phash, colorVar] = await Promise.all([
            workingCard.ocrFound
              ? Promise.resolve(null)
              : extractOpticalDimensionsViaServer(srcFile, signal, authMeta).catch(() => null),
            workingCard.phash
              ? Promise.resolve(workingCard.phash)
              : computePerceptualHash(srcFile).catch(() => ''),
            computeFrameColorVariance(srcFile).catch(() => ({
              isPatterned: false,
              colorFamily: 'other' as const,
              dominantHex: workingCard.frameHexColor || '#1f2937',
            })),
          ]);
          if (signal?.aborted) return null;
          if (ocr) {
            const totalMm = ocr.totalFrameWidthMm || workingCard.frameWidthMm;
            workingCard = {
              ...workingCard,
              modelCode: ocr.modelCode || workingCard.modelCode,
              isCrystalFrame: ocr.isCrystalFrame || workingCard.isCrystalFrame,
              lensWidthMm: ocr.lensWidthMm || workingCard.lensWidthMm,
              bridgeWidthMm: ocr.bridgeWidthMm || workingCard.bridgeWidthMm,
              templeLengthMm: ocr.templeLengthMm || workingCard.templeLengthMm,
              totalFrameWidthMm: totalMm,
              frameWidthMm: totalMm,
              ocrFound: ocr.found,
              frameShapeTag: workingCard.frameShapeTag || ocr.frameShape,
              isPatterned: Boolean(workingCard.isPatterned || ocr.isPatterned || colorVar.isPatterned),
              colorFamily:
                workingCard.colorFamily || (ocr.colorFamily !== 'other' ? ocr.colorFamily : colorVar.colorFamily),
              frameHexColor: colorVar.dominantHex || workingCard.frameHexColor,
              opticalDimensions: formatOpticalString(
                ocr.lensWidthMm,
                ocr.bridgeWidthMm,
                ocr.templeLengthMm,
                workingCard.opticalDimensions
              ),
            };
          } else {
            workingCard = {
              ...workingCard,
              isPatterned: Boolean(workingCard.isPatterned || colorVar.isPatterned),
              colorFamily: workingCard.colorFamily || colorVar.colorFamily,
              frameHexColor: colorVar.dominantHex || workingCard.frameHexColor,
            };
          }
          workingCard.phash = phash || workingCard.phash;
        } catch (prepErr) {
          if (signal?.aborted || (prepErr instanceof DOMException && prepErr.name === 'AbortError')) {
            return null;
          }
        }
      }

      setItems((prev) =>
        prev.map((x) =>
          x.localId === workingCard.localId
            ? {
                ...workingCard,
                stageLabel: usedLocalFallback
                  ? 'جاري المعالجة محلياً...'
                  : 'جاري فحص الكتالوج وتجهيز صور الاستوديو...',
              }
            : x
        )
      );

      // Step 2: Single-Call Split Sheet OR precomputed Batch result — with Zero-Failure Local Fallback
      let splitRes: { blob?: Blob; cacheHit?: boolean; cachedAssets?: any; solidModelTemplate?: any } = {
        cacheHit: false,
      };
      if (precomputedSplit) {
        if (!precomputedSplit.localFallbackOnly) {
          splitRes = precomputedSplit;
        }
      } else if (!isUnlimitedCredits && remainingCredits <= 0) {
        usedLocalFallback = true;
      } else {
        try {
          splitRes = await generateSplitSheetViaServer(
            srcFile,
            {
              ...authMeta,
              frameType: workingCard.frameType,
              subCategory: effectiveSub,
              isClipOnAttachment: false,
              keepLensBranding: Boolean(workingCard.keepLensBranding),
              isCrystalFrame: Boolean(workingCard.isCrystalFrame),
              isPatterned: Boolean(workingCard.isPatterned),
              modelCode: workingCard.modelCode,
              frameColor: workingCard.frameHexColor,
              phash: workingCard.phash,
              lensWidthMm: workingCard.lensWidthMm,
              bridgeWidthMm: workingCard.bridgeWidthMm,
              templeLengthMm: workingCard.templeLengthMm,
              totalFrameWidthMm: workingCard.totalFrameWidthMm || workingCard.frameWidthMm,
            },
            signal
          );
        } catch (splitErr) {
          if (signal?.aborted || (splitErr instanceof DOMException && splitErr.name === 'AbortError')) {
            return null;
          }
          console.warn('[OptiVerse] Split-sheet server failed — switching to local isolation pipeline:', splitErr);
          usedLocalFallback = true;
          splitRes = { cacheHit: false };
        }
      }

      if (signal?.aborted) return null;

      let baseUrls: { imagePath: string; frontCatalogPath: string; sideImagePath: string; maskUrl?: string };
      let baseMeta: {
        aspectRatio: number;
        frameHexColor: string;
        frameOpacity: number;
        detectedMaterial: FrameMaterial;
        detectedType: FrameType;
        calibration?: ModelCalibration;
        quality: 'good' | 'check';
        qualityNoteAr?: string;
        cacheHit?: boolean;
        autoColorSibling?: boolean;
        localFallback?: boolean;
      };

      if (
        splitRes.cacheHit &&
        splitRes.cachedAssets &&
        (splitRes.cachedAssets.frontCatalogPath || splitRes.cachedAssets.imagePath)
      ) {
        const cached = splitRes.cachedAssets;
        baseUrls = {
          imagePath: cached.imagePath || cached.frontCatalogPath || '',
          frontCatalogPath: cached.frontCatalogPath || cached.imagePath || '',
          sideImagePath: cached.sideImagePath || cached.frontCatalogPath || '',
          maskUrl: cached.lensMaskUrl || undefined,
        };
        const widthMm = cached.totalFrameWidthMm || workingCard.frameWidthMm;
        workingCard.frameWidthMm = widthMm;
        workingCard.lensWidthMm = cached.lensWidthMm || workingCard.lensWidthMm;
        workingCard.bridgeWidthMm = cached.bridgeWidthMm || workingCard.bridgeWidthMm;
        workingCard.templeLengthMm = cached.templeLengthMm || workingCard.templeLengthMm;
        workingCard.totalFrameWidthMm = widthMm;
        workingCard.opticalDimensions = formatOpticalString(
          cached.lensWidthMm,
          cached.bridgeWidthMm,
          cached.templeLengthMm,
          workingCard.opticalDimensions
        );
        baseMeta = {
          aspectRatio: workingCard.aspectRatio || 2.4,
          frameHexColor: workingCard.frameHexColor || '#1f2937',
          frameOpacity: workingCard.isCrystalFrame ? 0.75 : 1.0,
          detectedMaterial: workingCard.frameType === 'metal' ? 'metal' : 'tr_plastic',
          detectedType: workingCard.type,
          quality: 'good',
          cacheHit: true,
        };
      } else if (
        splitRes.solidModelTemplate &&
        !workingCard.isPatterned &&
        (splitRes.solidModelTemplate.frontCatalogPath || splitRes.solidModelTemplate.imagePath)
      ) {
        try {
          const tpl = splitRes.solidModelTemplate;
          const targetHex = workingCard.frameHexColor || (await sampleRoughHexFromFile(srcFile));
          const srcCutUrl = tpl.imagePath || tpl.frontCatalogPath || '';
          const srcFrontUrl = tpl.frontCatalogPath || tpl.imagePath || '';
          const [tintedCut, tintedFront, tintedSide] = await Promise.all([
            generateTintedCatalogAsset(srcCutUrl, targetHex),
            generateTintedCatalogAsset(srcFrontUrl, targetHex),
            tpl.sideImagePath ? generateTintedCatalogAsset(tpl.sideImagePath, targetHex) : Promise.resolve(null),
          ]);
          if (signal?.aborted) return null;

          const [imagePath, frontCatalogPath, sideImagePath] = await Promise.all([
            uploadAssetToStorage(tintedCut.blob, `${activeShop.id}/products/cutouts`, 'webp'),
            uploadAssetToStorage(tintedFront.blob, `${activeShop.id}/products/front`, 'webp'),
            tintedSide
              ? uploadAssetToStorage(tintedSide.blob, `${activeShop.id}/products/side`, 'webp')
              : Promise.resolve(tpl.sideImagePath || ''),
          ]);

          baseUrls = {
            imagePath,
            frontCatalogPath,
            sideImagePath: sideImagePath || frontCatalogPath,
            maskUrl: tpl.lensMaskUrl || undefined,
          };

          void saveToSharedEyewearCache({
            ...authMeta,
            modelCode: workingCard.modelCode || workingCard.code,
            frameColor: targetHex,
            phash: workingCard.phash,
            keepLensBranding: Boolean(workingCard.keepLensBranding),
            isCrystalFrame: Boolean(workingCard.isCrystalFrame),
            isPatterned: false,
            frameType: workingCard.frameType,
            imagePath: baseUrls.imagePath,
            frontCatalogPath: baseUrls.frontCatalogPath,
            sideImagePath: baseUrls.sideImagePath,
            lensMaskUrl: baseUrls.maskUrl,
            lensWidthMm: workingCard.lensWidthMm,
            bridgeWidthMm: workingCard.bridgeWidthMm,
            templeLengthMm: workingCard.templeLengthMm,
            totalFrameWidthMm: workingCard.frameWidthMm,
          });

          baseMeta = {
            aspectRatio: workingCard.aspectRatio || 2.4,
            frameHexColor: targetHex,
            frameOpacity: workingCard.isCrystalFrame ? 0.75 : 1.0,
            detectedMaterial: workingCard.frameType === 'metal' ? 'metal' : 'tr_plastic',
            detectedType: workingCard.type,
            quality: 'good',
            autoColorSibling: true,
          };
        } catch (tintErr) {
          if (signal?.aborted || (tintErr instanceof DOMException && tintErr.name === 'AbortError')) {
            return null;
          }
          usedLocalFallback = true;
          const localOut = await runLocalIsolationFallback(srcFile, workingCard, effectiveSub, workingCard.sideSourceFile, false, signal);
          baseUrls = localOut.urls;
          baseMeta = { ...localOut.meta, cacheHit: false, localFallback: true };
        }
      } else if (splitRes.blob) {
        try {
          const baseRes = await processCutoutInWorker(
            srcFile,
            workingCard.sideSourceFile,
            {
              frameType: workingCard.frameType,
              subCategory: effectiveSub,
              material: workingCard.material,
              isCrystalFrame: Boolean(workingCard.isCrystalFrame),
              frameWidthMm: workingCard.frameWidthMm,
              opticalDimensions: workingCard.opticalDimensions,
              fitScale: workingCard.fitScale,
              eyeLineOffset: workingCard.eyeLineOffset,
            },
            (stageLabel) => {
              if (signal?.aborted) return;
              setItems((prev) =>
                prev.map((x) => (x.localId === workingCard.localId ? { ...x, stageLabel } : x))
              );
            },
            splitRes.blob
          );

          if (signal?.aborted) return null;
          baseUrls = await uploadCutoutResult(baseRes, activeShop.id);
          if (signal?.aborted) return null;

          void saveToSharedEyewearCache({
            ...authMeta,
            modelCode: workingCard.modelCode || workingCard.code,
            frameColor: baseRes.frameHexColor,
            phash: workingCard.phash,
            keepLensBranding: Boolean(workingCard.keepLensBranding),
            isCrystalFrame: Boolean(workingCard.isCrystalFrame),
            isPatterned: Boolean(workingCard.isPatterned),
            frameType: workingCard.frameType,
            imagePath: baseUrls.imagePath,
            frontCatalogPath: baseUrls.frontCatalogPath,
            sideImagePath: baseUrls.sideImagePath,
            lensMaskUrl: baseUrls.maskUrl,
            lensWidthMm: workingCard.lensWidthMm,
            bridgeWidthMm: workingCard.bridgeWidthMm,
            templeLengthMm: workingCard.templeLengthMm,
            totalFrameWidthMm: workingCard.frameWidthMm,
          });

          baseMeta = {
            aspectRatio: baseRes.aspectRatio,
            frameHexColor: baseRes.frameHexColor,
            frameOpacity: baseRes.frameOpacity,
            detectedMaterial: baseRes.detectedMaterial,
            detectedType: baseRes.detectedType,
            calibration: baseRes.calibration,
            quality: baseRes.quality,
            qualityNoteAr: baseRes.qualityNoteAr,
            cacheHit: false,
            localFallback: usedLocalFallback,
          };
        } catch (splitCutErr) {
          if (signal?.aborted || (splitCutErr instanceof DOMException && splitCutErr.name === 'AbortError')) {
            return null;
          }
          usedLocalFallback = true;
          const localOut = await runLocalIsolationFallback(srcFile, workingCard, effectiveSub, workingCard.sideSourceFile, false, signal);
          baseUrls = localOut.urls;
          baseMeta = { ...localOut.meta, cacheHit: false, localFallback: true };
        }
      } else {
        usedLocalFallback = true;
        setItems((prev) =>
          prev.map((x) =>
            x.localId === workingCard.localId ? { ...x, stageLabel: 'جاري العزل المحلي المباشر...' } : x
          )
        );
        const localOut = await runLocalIsolationFallback(
          srcFile,
          workingCard,
          effectiveSub,
          workingCard.sideSourceFile,
          false,
          signal
        );
        baseUrls = localOut.urls;
        baseMeta = { ...localOut.meta, cacheHit: false, localFallback: true };
      }

      if (signal?.aborted) return null;

      let clipOnUrls: {
        clipOnImagePath?: string;
        clipOnFrontCatalogPath?: string;
        clipOnSideImagePath?: string;
      } = {};

      if (workingCard.frameType === 'clip_on' && workingCard.clipOnSourceFile) {
        setItems((prev) =>
          prev.map((x) =>
            x.localId === workingCard.localId
              ? { ...x, stageLabel: 'جاري تجهيز صور غيار الشمس...' }
              : x
          )
        );
        let clipSplitSheet: { blob?: Blob; cacheHit?: boolean; cachedAssets?: any } = { cacheHit: false };
        if (!usedLocalFallback && (isUnlimitedCredits || remainingCredits > 0)) {
          try {
            clipSplitSheet = await generateSplitSheetViaServer(
              workingCard.clipOnSourceFile,
              {
                ...authMeta,
                frameType: 'clip_on',
                subCategory: 'sun',
                isClipOnAttachment: true,
                keepLensBranding: Boolean(workingCard.keepLensBranding),
                isCrystalFrame: Boolean(workingCard.isCrystalFrame),
              },
              signal
            );
          } catch (clipErr) {
            if (signal?.aborted || (clipErr instanceof DOMException && clipErr.name === 'AbortError')) {
              return null;
            }
            usedLocalFallback = true;
            clipSplitSheet = { cacheHit: false };
          }
        } else {
          usedLocalFallback = true;
        }
        if (signal?.aborted) return null;

        if (
          clipSplitSheet.cacheHit &&
          clipSplitSheet.cachedAssets &&
          (clipSplitSheet.cachedAssets.frontCatalogPath || clipSplitSheet.cachedAssets.imagePath)
        ) {
          clipOnUrls = {
            clipOnImagePath: clipSplitSheet.cachedAssets.imagePath || undefined,
            clipOnFrontCatalogPath: clipSplitSheet.cachedAssets.frontCatalogPath || undefined,
            clipOnSideImagePath: clipSplitSheet.cachedAssets.sideImagePath || undefined,
          };
        } else {
          const clipOut = clipSplitSheet.blob
            ? await processCutoutInWorker(
                workingCard.clipOnSourceFile,
                undefined,
                {
                  frameType: 'clip_on',
                  subCategory: 'sun',
                  isClipOnAttachment: true,
                  material: workingCard.material,
                  frameWidthMm: workingCard.frameWidthMm,
                  opticalDimensions: workingCard.opticalDimensions,
                  fitScale: workingCard.fitScale,
                  eyeLineOffset: workingCard.eyeLineOffset,
                },
                undefined,
                clipSplitSheet.blob
              )
                .then((clipRes) => uploadCutoutResult(clipRes, activeShop.id))
                .catch(() =>
                  runLocalIsolationFallback(
                    workingCard.clipOnSourceFile!,
                    workingCard,
                    'sun',
                    undefined,
                    true,
                    signal
                  ).then((r) => r.urls)
                )
            : await runLocalIsolationFallback(
                workingCard.clipOnSourceFile,
                workingCard,
                'sun',
                undefined,
                true,
                signal
              ).then((r) => r.urls);

          clipOnUrls = {
            clipOnImagePath: clipOut.imagePath,
            clipOnFrontCatalogPath: clipOut.frontCatalogPath,
            clipOnSideImagePath: clipOut.sideImagePath,
          };
        }
      }

      if (signal?.aborted) return null;
      const finishedCard = await finalizeProcessedCard(
        workingCard,
        { ...baseUrls, ...baseMeta, localFallback: usedLocalFallback },
        clipOnUrls
      );
      if (usedLocalFallback) {
        toast('تمت المعالجة محلياً ✓');
      }
      return finishedCard;
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return null;
      console.warn('[OptiVerse] Unexpected error in processSingleCard — forcing local Zero-Failure fallback:', err);
      try {
        const rescueOut = await runLocalIsolationFallback(
          srcFile,
          workingCard,
          effectiveSub,
          workingCard.sideSourceFile,
          false,
          signal
        );
        const rescuedCard = await finalizeProcessedCard(workingCard, {
          ...rescueOut.urls,
          ...rescueOut.meta,
          cacheHit: false,
          localFallback: true,
        });
        toast('تمت المعالجة محلياً ✓');
        return rescuedCard;
      } catch {
        // Last-resort raw upload fallback so card never enters error state
        const rawUrl = await uploadAssetToStorage(srcFile, `${activeShop.id}/products/front`, 'webp');
        const rescuedCard = await finalizeProcessedCard(workingCard, {
          imagePath: rawUrl,
          frontCatalogPath: rawUrl,
          sideImagePath: rawUrl,
          aspectRatio: workingCard.aspectRatio || 2.4,
          frameHexColor: workingCard.frameHexColor || '#1f2937',
          frameOpacity: workingCard.isCrystalFrame ? 0.75 : 1.0,
          detectedMaterial: workingCard.material,
          detectedType: workingCard.type,
          quality: 'good',
          localFallback: true,
        });
        toast('تمت المعالجة محلياً ✓');
        return rescuedCard;
      }
    }
  };

  const processSiblingColorLocally = async (
    leadCard: BulkFrameItem,
    siblingCard: BulkFrameItem,
    signal?: AbortSignal
  ): Promise<BulkFrameItem | null> => {
    if (signal?.aborted || !siblingCard.sourceFile) {
      return null;
    }
    return await processSingleCard(siblingCard, signal);
  };

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    setValidationAlert(null);
    const files = Array.from(fileList).filter(
      (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|avif)$/i.test(f.name)
    );
    if (!files.length) {
      toast('اختر ملفات صور صالحة (PNG / JPG / WebP)');
      return;
    }

    const minAllowed = canSingleQuickUpload || isAdmin ? 1 : 2;
    if (files.length < minAllowed) {
      const msg = `الحد الأدنى لدفعة الرفع هو ${minAllowed} صور (من 2 إلى 50 صورة). اخترت ${files.length} فقط.`;
      setValidationAlert(msg);
      toast(msg);
      return;
    }
    if (files.length > MAX_BATCH_SIZE) {
      const msg = `الحد الأقصى للدفعة الواحدة هو ${MAX_BATCH_SIZE} صورة. اخترت ${files.length} — قسّم الرفع على دفعات.`;
      setValidationAlert(msg);
      toast(msg);
      return;
    }

    // Never block uploads on AI credit exhaustion — server failures or 0 credits fall back locally
    const remainingCapacity = Math.max(0, maxProducts - activeShopProductsCount);
    if (!isAdmin && !activeShop.isDemoAdminStore && safeAiCreditsLimit < 99999 && files.length > remainingCapacity) {
      const msg = `متاح في باقتك حتى ${maxProducts} نظارة (المستخدم حالياً ${activeShopProductsCount}). متاح لإضافة ${remainingCapacity} نظارة فقط — قم بشحن باقة إضافية أو ترقية الباقة.`;
      setValidationAlert(msg);
      setOutOfCreditsModal('capacity');
      toast(msg);
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const seedNum = Math.floor(2000 + Math.random() * 6000);
    const defaultPrice = Math.max(0, Number(bulkPrice) || 950);
    const batchIsNewCollection = isNewCollectionMode;
    const batchNewCollectionUntil = batchIsNewCollection
      ? new Date(Date.now() + 7 * 86400000).toISOString()
      : undefined;

    const initialCards: BulkFrameItem[] = files.map((front, idx) => ({
      localId: `bulk-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      sourceFile: front,
      originalThumbUrl: URL.createObjectURL(front),
      status: 'enhancing',
      stageLabel: 'جاري التصنيف الذكي ومطابقة الأزواج...',
      approved: false,
      isPublished: false,
      name: cleanNameFromFile(front.name, idx),
      code: `FR-${seedNum + idx}`,
      price: defaultPrice,
      frameType: 'prescription',
      subCategory: 'optical',
      frameWidthMm: bulkWidthMm,
      opticalDimensions: bulkOpticalDim,
      keepLensBranding: Boolean(platformSettings.allowMerchantLensBrandingToggle && keepLensBranding),
      fitScale: 1.0,
      eyeLineOffset: 0.04,
      cat: 'med',
      material: 'tr_plastic',
      type: 'wayfarer',
      aspectRatio: 2.4,
      frameHexColor: '#1f2937',
      frameOpacity: 1.0,
      reprocessing: true,
      isNewCollection: batchIsNewCollection,
      newCollectionUntil: batchNewCollectionUntil,
      lensTint: 'clear',
    }));

    setItems((prev) => [...prev, ...initialCards]);
    setProcessing(true);
    setIsQueueModalOpen(true);
    setCancelled(false);
    setProgress({ done: 0, total: initialCards.length });
    setVisibleLimit((lim) => Math.max(lim, PAGE_SIZE));

    const authMeta = await buildClientAuthMeta().catch(() => ({
      authToken: null,
      shopId: activeShop.id,
      role: session?.role || 'merchant',
      planTier: activeShop.planTier || 'basic',
      isDemoAdminStore: Boolean(activeShop.isDemoAdminStore),
    }));
    // Step 1: Smart Auto-Classification (OCR + auto_frame_mode + lens_tint) + pHash + Local Fallbacks (concurrency = 2)
    const classifiedCards = [...initialCards];
    let classifyIdx = 0;
    const runClassifyWorker = async () => {
      while (classifyIdx < classifiedCards.length && !ctrl.signal.aborted) {
        const i = classifyIdx++;
        const c = classifiedCards[i];
        if (!c?.sourceFile) continue;
        try {
          const [ocr, phash, colorVar, localTint] = await Promise.all([
            extractOpticalDimensionsViaServer(c.sourceFile, ctrl.signal, authMeta).catch(() => null),
            computePerceptualHash(c.sourceFile).catch(() => ''),
            computeFrameColorVariance(c.sourceFile).catch(() => ({
              isPatterned: false,
              colorFamily: 'other' as const,
              dominantHex: c.frameHexColor || '#1f2937',
            })),
            estimateLensTintLocally(c.sourceFile).catch(() => 'clear' as const),
          ]);

          const resolvedMode: EyewearFrameMode =
            ocr?.autoFrameMode || (localTint === 'tinted' ? 'sunglasses' : 'prescription');
          const resolvedTint: 'clear' | 'tinted' =
            ocr?.lensTint ||
            (resolvedMode === 'sunglasses' || resolvedMode === 'clip_on' ? 'tinted' : localTint);
          const resolvedSub: EyewearSubMode =
            resolvedMode === 'sunglasses' || resolvedTint === 'tinted' ? 'sun' : 'optical';
          const resolvedCat = resolveCatFromMode(resolvedMode, resolvedSub);
          const resolvedMaterial: FrameMaterial = resolvedMode === 'metal' ? 'metal' : 'tr_plastic';
          const fallbackWidth = resolvedMode === 'kids' ? 122 : c.frameWidthMm;
          const widthMm = ocr?.totalFrameWidthMm || fallbackWidth;
          const isPatterned = Boolean(ocr?.isPatterned || colorVar.isPatterned);

          classifiedCards[i] = {
            ...c,
            frameType: resolvedMode,
            subCategory: resolvedSub,
            cat: resolvedCat,
            material: resolvedMaterial,
            type: resolvedMaterial === 'metal' ? 'rimless' : 'wayfarer',
            lensTint: resolvedTint,
            modelCode: ocr?.modelCode || undefined,
            isCrystalFrame: Boolean(ocr?.isCrystalFrame),
            lensWidthMm: ocr?.lensWidthMm || undefined,
            bridgeWidthMm: ocr?.bridgeWidthMm || undefined,
            templeLengthMm: ocr?.templeLengthMm || undefined,
            totalFrameWidthMm: widthMm,
            frameWidthMm: widthMm,
            ocrFound: Boolean(ocr?.found),
            preOcrChecked: true,
            frameShapeTag: ocr?.frameShape || undefined,
            isPatterned,
            colorFamily: ocr?.colorFamily && ocr.colorFamily !== 'other' ? ocr.colorFamily : colorVar.colorFamily,
            frameHexColor: colorVar.dominantHex || c.frameHexColor,
            opticalDimensions: formatOpticalString(
              ocr?.lensWidthMm,
              ocr?.bridgeWidthMm,
              ocr?.templeLengthMm,
              c.opticalDimensions
            ),
            phash: phash || undefined,
          };
        } catch {
          // Non-blocking auto-classification — keep defaults
        }
      }
    };
    await Promise.all([runClassifyWorker(), runClassifyWorker()]);

    if (ctrl.signal.aborted) {
      setProcessing(false);
      return;
    }

    // Step 2: Sequential Clip-On Pair Matching (clear + following tinted with matching shape+color or modelCode)
    const newCards: BulkFrameItem[] = [];
    const absorbedIds = new Set<string>();
    let mergedPairsCount = 0;

    for (let i = 0; i < classifiedCards.length; i++) {
      const curr = classifiedCards[i];
      const next = i + 1 < classifiedCards.length ? classifiedCards[i + 1] : undefined;

      if (next && areSequentialClipOnPair(curr, next)) {
        absorbedIds.add(next.localId);
        if (next.originalThumbUrl && next.originalThumbUrl.startsWith('blob:')) {
          URL.revokeObjectURL(next.originalThumbUrl);
        }
        mergedPairsCount++;
        newCards.push({
          ...curr,
          frameType: 'clip_on',
          subCategory: 'optical',
          cat: 'med',
          clipOnSourceFile: next.sourceFile,
          modelCode: curr.modelCode || next.modelCode,
          stageLabel: 'تم دمج زوج الكليب أون تلقائياً — جاري التجهيز...',
        });
        i++; // skip paired tinted frame
      } else {
        newCards.push(curr);
      }
    }

    const initialIdSet = new Set(initialCards.map((x) => x.localId));
    setItems((prev) => [
      ...prev.filter((p) => !initialIdSet.has(p.localId) && !absorbedIds.has(p.localId)),
      ...newCards,
    ]);
    setProgress({ done: 0, total: newCards.length });

    if (mergedPairsCount > 0) {
      toast(`تم دمج ${mergedPairsCount} زوج كليب أون (نظارة طبية + غيار شمس) تلقائياً 🔄`);
    }

    // Silent Hybrid Auto-Color Grouping: solid siblings recolor locally at $0 API cost; patterned frames stay in AI queue
    const leadByGroupKey = new Map<string, BulkFrameItem>();
    const siblingMap = new Map<string, BulkFrameItem>(); // sibling.localId -> leadCard
    const aiQueue: BulkFrameItem[] = [];

    for (const c of newCards) {
      const gKey = autoGroupColors ? extractColorGroupingKey(c.sourceFile?.name || c.name, c.modelCode) : '';
      const lead = gKey ? leadByGroupKey.get(gKey) : undefined;
      if (gKey && lead && c.frameType !== 'clip_on' && !c.isPatterned && !lead.isPatterned) {
        siblingMap.set(c.localId, lead);
      } else {
        if (gKey && !lead && !c.isPatterned) {
          leadByGroupKey.set(gKey, c);
        }
        aiQueue.push(c);
      }
    }

    let doneCount = 0;
    let successCount = 0;
    const processedLeadById = new Map<string, BulkFrameItem>();
    const finishedBatch: BulkFrameItem[] = [];

    // Step 3: Process one image at a time at concurrency = 2 (keeps payloads small & reliable)
    let aiQueueIdx = 0;
    const runAiWorker = async () => {
      while (aiQueueIdx < aiQueue.length && !ctrl.signal.aborted) {
        const c = aiQueue[aiQueueIdx++];
        const finished = await processSingleCard(c, ctrl.signal);
        if (finished) {
          processedLeadById.set(c.localId, finished);
          finishedBatch.push(finished);
          successCount++;
        }
        doneCount++;
        setProgress({ done: doneCount, total: newCards.length });
      }
    };
    const workerCount = Math.min(2, Math.max(1, aiQueue.length));
    await Promise.all(Array.from({ length: workerCount }, () => runAiWorker()));

    // Generate $0 local color-variant assets for grouped siblings
    for (const [sibId, leadRef] of siblingMap.entries()) {
      if (ctrl.signal.aborted) break;
      const sib = newCards.find((x) => x.localId === sibId);
      const finishedLead = processedLeadById.get(leadRef.localId);
      let okSib: BulkFrameItem | null = null;
      if (sib && finishedLead) {
        okSib = await processSiblingColorLocally(finishedLead, sib, ctrl.signal);
      }
      if (!okSib && sib) {
        okSib = await processSingleCard(sib, ctrl.signal);
      }
      doneCount++;
      if (okSib) {
        finishedBatch.push(okSib);
        successCount++;
      }
      setProgress({ done: doneCount, total: newCards.length });
    }

    setProcessing(false);
    if (ctrl.signal.aborted) {
      setCancelled(true);
      toast(`تم إيقاف المعالجة عند ${successCount} نظارة`);
    } else if (successCount > 0) {
      toast(`تم تجهيز ${successCount} نظارة — راجع النتيجة واضغط "اعتماد" لنشرها في المتجر ✓`);
      if (batchIsNewCollection && finishedBatch.length > 0) {
        setPromoModalFrames(
          finishedBatch.map((it) => ({
            id: it.savedProductId || it.localId,
            name: it.name,
            price:
              it.salePrice && it.salePrice > 0 && it.salePrice < it.price
                ? it.salePrice
                : it.price,
            imageUrl: it.frontCatalogPath || it.imagePath || it.originalThumbUrl,
            code: it.modelCode || it.code,
          }))
        );
        setIsNewCollectionMode(false);
      }
    }
  };

  const handleCancelQueue = () => {
    abortRef.current?.abort();
    setCancelled(true);
    setProcessing(false);
  };

  /**
   * Local 16:9 Split-Sheet Test Processor (Zero Gemini API calls):
   * Splits uploaded 16:9 studio sheet into Left Half (front on #00FF00 green chroma)
   * and Right Half (3/4 side on studio white), strips green chroma & edge spill to generate
   * a transparent PNG try-on asset + two pure #FFFFFF catalog studio views.
   */
  const handleSplitSheetTestSelected = async (file: File) => {
    setValidationAlert(null);
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|heic|avif)$/i.test(file.name)) {
      toast('اختر ملف صورة لوحة مزدوجة 16:9 صالح (PNG / JPG / WebP)');
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const chosenMode: EyewearFrameMode = 'prescription';
    const chosenSub: EyewearSubMode = 'optical';
    const chosenCat = resolveCatFromMode(chosenMode, chosenSub);
    const chosenMaterial: FrameMaterial = 'tr_plastic';
    const seedNum = Math.floor(2000 + Math.random() * 6000);
    const defaultPrice = Math.max(0, Number(bulkPrice) || 950);
    const localId = `split-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const draftCard: BulkFrameItem = {
      localId,
      sourceFile: file,
      originalThumbUrl: URL.createObjectURL(file),
      status: 'enhancing',
      stageLabel: 'جاري تقسيم اللوحة (16:9) وعزل الكروما الخضراء...',
      approved: false,
      isPublished: false,
      name: cleanNameFromFile(file.name, 0),
      code: `FR-${seedNum}`,
      price: defaultPrice,
      frameType: chosenMode,
      subCategory: chosenSub,
      frameWidthMm: bulkWidthMm,
      opticalDimensions: bulkOpticalDim,
      keepLensBranding: Boolean(platformSettings.allowMerchantLensBrandingToggle && keepLensBranding),
      fitScale: 1.0,
      eyeLineOffset: 0.04,
      cat: chosenCat,
      material: chosenMaterial,
      type: 'wayfarer',
      aspectRatio: 2.4,
      frameHexColor: '#1f2937',
      frameOpacity: 1.0,
      reprocessing: true,
      isNewCollection: isNewCollectionMode,
      newCollectionUntil: isNewCollectionMode
        ? new Date(Date.now() + 7 * 86400000).toISOString()
        : undefined,
    };

    setItems((prev) => [...prev, draftCard]);
    setProcessing(true);
    setIsQueueModalOpen(true);
    setCancelled(false);
    setProgress({ done: 0, total: 1 });
    setVisibleLimit((lim) => Math.max(lim, PAGE_SIZE));

    try {
      const [phash, colorVar] = await Promise.all([
        computePerceptualHash(file),
        computeFrameColorVariance(file),
      ]);
      if (ctrl.signal.aborted) return;

      const workingCard: BulkFrameItem = {
        ...draftCard,
        phash: phash || undefined,
        isPatterned: colorVar.isPatterned,
        colorFamily: colorVar.colorFamily,
        frameHexColor: colorVar.dominantHex || draftCard.frameHexColor,
      };

      const baseRes = await processCutoutInWorker(
        file,
        undefined,
        {
          frameType: workingCard.frameType,
          subCategory: chosenSub,
          material: workingCard.material,
          isCrystalFrame: Boolean(workingCard.isCrystalFrame),
          frameWidthMm: workingCard.frameWidthMm,
          opticalDimensions: workingCard.opticalDimensions,
          fitScale: workingCard.fitScale,
          eyeLineOffset: workingCard.eyeLineOffset,
          pureWhiteCatalog: true,
          preferTransparentPng: true,
        },
        (stageLabel) => {
          if (ctrl.signal.aborted) return;
          setItems((prev) => prev.map((x) => (x.localId === localId ? { ...x, stageLabel } : x)));
        },
        file
      );

      if (ctrl.signal.aborted) return;
      const baseUrls = await uploadCutoutResult(baseRes, activeShop.id);
      if (ctrl.signal.aborted) return;

      await finalizeProcessedCard(workingCard, {
        ...baseUrls,
        aspectRatio: baseRes.aspectRatio,
        frameHexColor: baseRes.frameHexColor,
        frameOpacity: baseRes.frameOpacity,
        detectedMaterial: baseRes.detectedMaterial,
        detectedType: baseRes.detectedType,
        calibration: baseRes.calibration,
        quality: baseRes.quality,
        qualityNoteAr: baseRes.qualityNoteAr,
        cacheHit: false,
      });

      setProgress({ done: 1, total: 1 });
      setProcessing(false);
      setIsQueueModalOpen(false);
      toast('تمت المعالجة ✅ — اللوحة المزدوجة جاهزة للاعتماد والتجربة بالكاميرا!');
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'تعذر تقسيم ومعالجة اللوحة المزدوجة';
      setItems((prev) =>
        prev.map((x) =>
          x.localId === localId
            ? {
                ...x,
                status: 'error',
                stageLabel: 'فشلت المعالجة',
                errorMsg: msg,
                reprocessing: false,
              }
            : x
        )
      );
      setProcessing(false);
      toast(msg);
    }
  };

  const syncItemToProduct = (next: BulkFrameItem, rebuildImages = false) => {
    void saveDraftFrame(toPersistedDraft(activeShop.id, next));
    if (next.mergedIntoExistingProduct || !next.savedProductId || !next.frontCatalogPath || !next.imagePath) return;
    const { prod, images } = buildProductPayloadFromItem(activeShop.id, next);
    void updateProduct(next.savedProductId, prod, rebuildImages ? images : undefined);
  };

  const updateCard = (localId: string, patch: Partial<BulkFrameItem>) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.localId !== localId) return it;
        const next = { ...it, ...patch };
        syncItemToProduct(next, false);
        return next;
      })
    );
  };

  const handleApproveCard = async (localId: string) => {
    const target = itemsRef.current.find((x) => x.localId === localId);
    if (!target || target.status !== 'ready' || !target.frontCatalogPath || !target.imagePath) {
      return;
    }
    const next: BulkFrameItem = {
      ...target,
      approved: true,
      isPublished: true,
    };
    setItems((prev) => prev.map((x) => (x.localId === localId ? next : x)));

    if (next.savedProductId) {
      await updateProduct(next.savedProductId, { isPublished: true });
    } else {
      const { prod, images } = buildProductPayloadFromItem(activeShop.id, next);
      const saved = await addProduct(prod, images);
      setItems((prev) => prev.map((x) => (x.localId === localId ? { ...x, savedProductId: saved.id } : x)));
    }
    await deleteDraftFrame(localId);
    toast(`تم اعتماد ونشر "${next.name}" في المتجر ✓`);
    onSaved?.();
  };

  const handleApproveAllReady = async () => {
    const toApprove = itemsRef.current.filter(
      (it) => it.status === 'ready' && !it.approved && it.frontCatalogPath && it.imagePath
    );
    if (!toApprove.length) return;

    const batch: { productId: string; patch: Partial<Omit<Product, 'id' | 'shopId'>> }[] = [];
    for (const it of toApprove) {
      if (it.savedProductId) {
        batch.push({ productId: it.savedProductId, patch: { isPublished: true } });
      }
      await deleteDraftFrame(it.localId);
    }
    setItems((prev) =>
      prev.map((it) =>
        it.status === 'ready' && !it.approved ? { ...it, approved: true, isPublished: true } : it
      )
    );
    if (batch.length) {
      await updateProductsBatch(batch);
    }
    toast(`تم اعتماد ونشر ${toApprove.length} نظارة في المتجر ✓`);
    onSaved?.();
  };

  const handleRetryCard = async (localId: string) => {
    const target = itemsRef.current.find((x) => x.localId === localId);
    if (!target) return;
    if (!target.sourceFile) {
      toast('لا يمكن إعادة المعالجة بعد تحديث الصفحة إلا برفع الصورة من جديد');
      return;
    }
    const resetTarget: BulkFrameItem = {
      ...target,
      approved: false,
      isPublished: false,
    };
    const ok = await processSingleCard(resetTarget);
    if (ok) {
      toast(
        ok.localFallback
          ? `تمت المعالجة محلياً لـ "${target.name}" — اضغط اعتماد للنشر ✓`
          : `تمت إعادة معالجة "${target.name}" بنجاح — اضغط اعتماد للنشر ✓`
      );
    } else {
      toast('تمت المحاولة — يمكنك مراجعة الصورة أو إعادة الرفع');
    }
  };

  const handleSidePhotoSelected = async (it: BulkFrameItem, file: File) => {
    setItems((prev) => prev.map((x) => (x.localId === it.localId ? { ...x, sideBusy: true } : x)));
    try {
      const res = await processCutoutInWorker(file, undefined, {
        frameType: it.frameType,
        subCategory: it.subCategory,
        material: it.material,
        isCrystalFrame: Boolean(it.isCrystalFrame),
      });
      const sideImagePath = await uploadAssetToStorage(
        res.frontCatalogPath.blob,
        `${activeShop.id}/products/side`,
        res.frontCatalogPath.ext || 'webp'
      );
      setItems((prev) =>
        prev.map((x) => {
          if (x.localId !== it.localId) return x;
          const next: BulkFrameItem = { ...x, sideSourceFile: file, sideImagePath, sideBusy: false };
          syncItemToProduct(next, true);
          return next;
        })
      );
      toast('تم تجهيز الزاوية الجانبية 3/4 على خلفية الاستوديو ✓');
    } catch {
      setItems((prev) => prev.map((x) => (x.localId === it.localId ? { ...x, sideBusy: false } : x)));
      toast('تعذر معالجة الصورة الجانبية — حاول بصورة أوضح');
    }
  };

  const applyPriceToAll = () => {
    const val = Math.max(0, Number(bulkPrice) || 0);
    const batchUpdates: { productId: string; patch: Partial<Omit<Product, 'id' | 'shopId'>> }[] = [];
    setItems((prev) =>
      prev.map((it) => {
        const next = { ...it, price: val };
        void saveDraftFrame(toPersistedDraft(activeShop.id, next));
        if (it.savedProductId) {
          batchUpdates.push({ productId: it.savedProductId, patch: { price: val } });
        }
        return next;
      })
    );
    if (batchUpdates.length) {
      void updateProductsBatch(batchUpdates);
    }
    toast(`تم تطبيق السعر (${val} ج.م) على ${items.length} نظارة ✓`);
  };

  const applySizeToAll = () => {
    const safeMm = Math.max(110, Math.min(165, Number(bulkWidthMm) || 136));
    const safeDim = bulkOpticalDim.trim() || '52-18-140';
    const sizes = sizeListFromWidth(safeMm);
    const batchUpdates: { productId: string; patch: Partial<Omit<Product, 'id' | 'shopId'>> }[] = [];
    setItems((prev) =>
      prev.map((it) => {
        const next = { ...it, frameWidthMm: safeMm, opticalDimensions: safeDim };
        void saveDraftFrame(toPersistedDraft(activeShop.id, next));
        if (it.savedProductId) {
          batchUpdates.push({
            productId: it.savedProductId,
            patch: {
              description: `إطار ${it.material === 'metal' ? 'معدن' : 'بلاستيك TR'} · عرض ${safeMm}mm · ${safeDim}`,
              availableSizes: sizes,
              modelCalibration: {
                ...(it.calibration || {}),
                frameWidthMm: safeMm,
                opticalDimensions: safeDim,
                material: it.material,
                fitScale: it.fitScale,
                eyeLineOffset: it.eyeLineOffset,
              },
            },
          });
        }
        return next;
      })
    );
    if (batchUpdates.length) {
      void updateProductsBatch(batchUpdates);
    }
    toast(`تم تطبيق المقاس (${safeMm}mm · ${safeDim}) على الكل ✓`);
  };

  const handleAttachGlb = async (localId: string, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    const glbStorageUrl = await uploadAssetToStorage(file, `${activeShop.id}/products`, 'glb');
    setItems((prev) =>
      prev.map((it) => {
        if (it.localId !== localId) return it;
        if (it.glbPreviewUrl) URL.revokeObjectURL(it.glbPreviewUrl);
        const next: BulkFrameItem = { ...it, glbFile: file, glbPreviewUrl: previewUrl, glbStorageUrl };
        syncItemToProduct(next, false);
        return next;
      })
    );
    toast(`تم إرفاق مجسم 3D (.glb): ${file.name} ✓`);
  };

  const handleFinishReview = () => {
    items.forEach((it) => {
      if (it.originalThumbUrl && it.originalThumbUrl.startsWith('blob:')) {
        URL.revokeObjectURL(it.originalThumbUrl);
      }
      if (it.glbPreviewUrl) URL.revokeObjectURL(it.glbPreviewUrl);
    });
    toast(
      approvedCount > 0
        ? `تم نشر ${approvedCount} نظارة معتمدة في متجرك ✓`
        : 'تم حفظ المسودات محلياً — يمكنك العودة ومراجعتها قبل النشر في أي وقت'
    );
    setItems([]);
    setProgress({ done: 0, total: 0 });
    setCancelled(false);
    onSaved?.();
  };

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="rounded-3xl bg-[#F8F9FA] text-[#0F172A] p-4 sm:p-5 mb-5 border border-[#E2E8F0] shadow-sm space-y-3.5">
      {/* Shared Hidden File Picker triggered directly by Unified Smart Upload Button */}
      <input
        ref={pickerRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void handleFilesSelected(e.target.files);
          }
          e.target.value = '';
        }}
      />

      {/* Admin-Only Hidden File Picker for Local 16:9 Split-Sheet Chroma Test */}
      {isAdmin === true && (
        <input
          ref={splitSheetPickerRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) {
              void handleSplitSheetTestSelected(file);
            }
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-extrabold text-[#0F172A] flex items-center gap-2">
          <I n="upload" s={17} c="text-[#0284C7]" />
          <span>الرفع الذكي والتصنيف التلقائي للنظارات</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin === true && (
            <button
              type="button"
              onClick={() => splitSheetPickerRef.current?.click()}
              disabled={processing}
              title="رفع لوحة استوديو جاهزة 16:9 (النصف الأيسر على كروما خضراء #00FF00 والنصف الأيمن زاوية 3/4) للاختبار الفوري بدون مفتاح API"
              className="px-3 py-1.5 rounded-xl text-xs font-extrabold border border-sky-300 bg-sky-50 hover:bg-sky-100 text-[#0284C7] transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <I n="spark" s={14} />
              <span>اختبار لوحة مزدوجة جاهزة (كروما + 3/4)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsNewCollectionMode((v) => !v)}
            className={
              'px-3 py-1.5 rounded-xl text-xs font-extrabold border transition cursor-pointer flex items-center gap-1.5 ' +
              (isNewCollectionMode
                ? 'bg-[#D97706] text-white border-[#D97706] shadow-sm'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300')
            }
          >
            <span>إضافة كوليكشن جديد ✨</span>
            {isNewCollectionMode && <span className="text-[0.65rem] bg-white/20 px-1.5 py-0.5 rounded">مفعّل</span>}
          </button>

          {items.length > 0 && !processing && (
            <>
              {readyUnapprovedCount > 0 && (
                <button
                  type="button"
                  className="btn btn-p btn-sm !bg-[#D97706] hover:!bg-[#B45309] !text-white"
                  onClick={() => void handleApproveAllReady()}
                >
                  <I n="check" s={14} /> اعتماد الكل ({readyUnapprovedCount})
                </button>
              )}
              <button
                type="button"
                className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-800 text-xs font-bold hover:bg-slate-100 cursor-pointer"
                onClick={handleFinishReview}
              >
                إنهاء المراجعة ({items.length})
              </button>
            </>
          )}
        </div>
      </div>

      {isNewCollectionMode && (
        <div className="rounded-2xl bg-amber-50 border border-amber-300 px-3.5 py-2.5 text-xs text-amber-950 font-bold flex flex-wrap items-center justify-between gap-2">
          <span>
            ✨ وضع الكوليكشن الجديد مفعّل: سيتم تمييز كل النظارات في الدفعة القادمة بوسم «كوليكشن جديد» لمدة 7 أيام وتجهيز بوستر ستوري 1080×1920 تلقائياً فور انتهاء الرفع!
          </span>
          <button
            type="button"
            onClick={() => setIsNewCollectionMode(false)}
            className="text-amber-900 hover:underline font-extrabold cursor-pointer"
          >
            إلغاء الوضع
          </button>
        </div>
      )}

      {/* Unified Smart Upload CTA */}
      <button
        type="button"
        onClick={openUnifiedPicker}
        disabled={processing}
        className="w-full rounded-2xl border-2 border-dashed border-[#0284C7]/50 bg-gradient-to-l from-sky-50 via-white to-amber-50/40 hover:border-[#0284C7] hover:shadow-md p-5 sm:p-6 text-center transition cursor-pointer flex flex-col items-center justify-center gap-2.5 disabled:opacity-60"
      >
        <div className="w-12 h-12 rounded-2xl bg-[#0284C7] text-white flex items-center justify-center shadow-sm">
          <I n="upload" s={24} />
        </div>
        <div className="text-base sm:text-lg font-extrabold text-[#0F172A]">
          📸 اضغط هنا لاختيار صور النظارات (من 2 إلى 50 صورة)
        </div>
        <p className="text-xs text-slate-600 max-w-2xl leading-6">
          يصنّف الذكاء الاصطناعي كل نظارة تلقائياً (طبية، شمسية، معادن، أطفال)، ويدمج صور{' '}
          <strong className="text-[#0F172A]">الكليب أون (طبي + غيار شمس)</strong> تلقائياً في منتج واحد عند رفع صورتين متتاليتين لنفس الموديل.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 text-[0.7rem] font-bold pt-0.5">
          <span className="px-2.5 py-1 rounded-lg bg-white border border-sky-200 text-[#0284C7]">
            تصنيف ذكي تلقائي ✓
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-700">
            دمج غيار الشمس تلقائياً 🔄
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700">
            تعديل سريع للنوع من الكارت ✏️
          </span>
        </div>
      </button>

      {/* Compact Options & Quota Strip (Auto-Color Grouping runs silently) */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {platformSettings.allowMerchantLensBrandingToggle && (
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 border border-sky-200 cursor-pointer font-bold text-[#0284C7]">
              <input
                type="checkbox"
                checked={keepLensBranding}
                onChange={(e) => setKeepLensBranding(e.target.checked)}
                className="accent-[#0284C7]"
              />
              <span>الحفاظ على كتابة العدسة التجريبية</span>
            </label>
          )}
        </div>

        <span className="text-[0.7rem] font-bold text-slate-600 tabular-nums">
          السعة:{' '}
          <span dir="ltr">
            {activeShopProductsCount} / {maxProducts}
          </span>
        </span>
      </div>

      {validationAlert && (
        <div
          role="alert"
          className="rounded-xl bg-rose-50 border border-rose-300 text-rose-800 px-3.5 py-2.5 text-xs font-extrabold flex items-center justify-between gap-2"
        >
          <span>{validationAlert}</span>
          <button
            type="button"
            onClick={() => setValidationAlert(null)}
            className="text-rose-700 hover:text-rose-950 font-bold cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Photo Guidelines */}
      <div className="rounded-xl bg-sky-50/70 border border-sky-200 text-slate-800 p-1">
        <PhotoUploadGuidelines />
      </div>

      {/* Queue Progress Bar + Cancel Control */}
      {(processing || progress.total > 0) && (
        <div ref={queueAnchorRef} className="rounded-xl bg-white border border-[#E2E8F0] p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-[#0F172A]">
            <span className="flex items-center gap-2">
              {processing && (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-[#0284C7] border-t-transparent animate-spin inline-block shrink-0" />
              )}
              {processing
                ? `جاري التحسين — تم تجهيز ${progress.done} من ${progress.total} نظارة...`
                : cancelled
                ? `تم إيقاف المعالجة — تم تجهيز ${progress.done} من ${progress.total} نظارة`
                : `تم تجهيز ${progress.done} من ${progress.total} نظارة للمراجعة والاعتماد ✓`}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[#0284C7] tabular-nums">{pct}%</span>
              {processing && (
                <button
                  type="button"
                  onClick={handleCancelQueue}
                  className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-700 text-[0.7rem] font-extrabold cursor-pointer transition"
                >
                  إيقاف مؤقت / إلغاء
                </button>
              )}
            </div>
          </div>
          <div className="h-2.5 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full bg-[#0284C7] rounded-full transition-all duration-150" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Review Grid + Bulk Actions Bar */}
      {items.length > 0 && (
        <>
          <div className="rounded-2xl bg-white border border-[#E2E8F0] p-3 flex flex-wrap items-end gap-3">
            <div className="flex items-end gap-1.5">
              <div>
                <label className="text-[0.68rem] text-slate-600 font-bold block mb-1">السعر الافتراضي (ج.م)</label>
                <input
                  type="number"
                  min="0"
                  dir="ltr"
                  className="rounded-lg border border-slate-300 bg-[#F8F9FA] text-slate-900 px-2.5 py-1.5 w-28 text-xs tabular-nums"
                  value={bulkPrice}
                  onChange={(e) => setBulkPrice(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-[#0F172A] text-white text-xs font-bold cursor-pointer hover:bg-slate-800"
                onClick={applyPriceToAll}
              >
                تطبيق السعر على الكل
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-1.5">
              <div>
                <label className="text-[0.68rem] text-slate-600 font-bold block mb-1">العرض (mm) والأبعاد</label>
                <div className="flex items-center gap-1">
                  {WIDTH_PRESETS.map((p) => (
                    <button
                      key={p.mm}
                      type="button"
                      className={
                        'px-2 py-1 rounded-lg text-[0.68rem] font-bold border cursor-pointer ' +
                        (bulkWidthMm === p.mm
                          ? 'bg-[#0284C7] text-white border-[#0284C7]'
                          : 'bg-[#F8F9FA] text-slate-700 border-slate-300')
                      }
                      onClick={() => setBulkWidthMm(p.mm)}
                    >
                      {p.label}
                    </button>
                  ))}
                  <input
                    type="text"
                    dir="ltr"
                    className="rounded-lg border border-slate-300 bg-[#F8F9FA] text-slate-900 w-24 px-2 py-1.5 text-xs font-mono"
                    value={bulkOpticalDim}
                    onChange={(e) => setBulkOpticalDim(e.target.value)}
                    placeholder="52-18-140"
                  />
                </div>
              </div>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-[#0F172A] text-white text-xs font-bold cursor-pointer hover:bg-slate-800"
                onClick={applySizeToAll}
              >
                تطبيق المقاس على الكل
              </button>
            </div>

            {readyUnapprovedCount > 0 && (
              <div className="ms-auto">
                <button
                  type="button"
                  className="btn btn-p !bg-[#D97706] hover:!bg-[#B45309] !text-white"
                  onClick={() => void handleApproveAllReady()}
                >
                  <I n="check" s={16} /> اعتماد ونشر الكل ({readyUnapprovedCount})
                </button>
              </div>
            )}
          </div>

          {/* Cards Grid (Clean Studio Outputs Only — No Before/After Clutter) */}
          <div className="grid sm:grid-cols-2 gap-4">
            {visibleItems.map((it) => {
              const isEnhancing = it.status === 'enhancing';
              const isError = it.status === 'error';
              const isReady = it.status === 'ready' && Boolean(it.frontCatalogPath && it.imagePath);
              const needsCheck = it.quality === 'check';
              const showingClipOn = Boolean(it.frameType === 'clip_on' && it.previewClipOn && it.clipOnImagePath);
              const activeTryOnPreview = showingClipOn ? it.clipOnImagePath : it.imagePath;
              const activeFrontPreview =
                showingClipOn && it.clipOnFrontCatalogPath ? it.clipOnFrontCatalogPath : it.frontCatalogPath;
              const activeSidePreview =
                showingClipOn && it.clipOnSideImagePath ? it.clipOnSideImagePath : it.sideImagePath;

              return (
                <div
                  key={it.localId}
                  className={
                    'rounded-2xl p-3.5 flex flex-col gap-3 border transition bg-white ' +
                    (it.approved
                      ? 'border-emerald-400 ring-1 ring-emerald-300'
                      : needsCheck
                      ? 'border-amber-400'
                      : 'border-[#E2E8F0] shadow-sm')
                  }
                >
                  {/* Top status & action bar */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isEnhancing ? (
                        <span className="text-[0.68rem] px-2 py-0.5 rounded-lg bg-sky-50 text-[#0284C7] border border-sky-200 font-bold flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-full border-2 border-[#0284C7] border-t-transparent animate-spin inline-block" />
                          جاري المعالجة...
                        </span>
                      ) : isError ? (
                        <span className="text-[0.68rem] px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-bold">
                          تعذرت المعالجة
                        </span>
                      ) : it.approved ? (
                        <span className="text-[0.68rem] px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                          معتمدة ومنشورة ✓
                        </span>
                      ) : isReady ? (
                        <span className="text-[0.68rem] px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold">
                          {it.localFallback ? 'تمت المعالجة محلياً ✅' : 'تمت المعالجة ✅'}
                        </span>
                      ) : (
                        <span className="text-[0.68rem] px-2 py-0.5 rounded-lg bg-[#0F172A] text-white font-semibold">
                          بانتظار الاعتماد
                        </span>
                      )}
                      <select
                        aria-label="تعديل نوع النظارة"
                        title="اضغط لتغيير نوع النظارة سريعاً"
                        value={it.frameType}
                        onChange={(e) => {
                          const nextMode = e.target.value as EyewearFrameMode;
                          const nextSub: EyewearSubMode =
                            nextMode === 'sunglasses' ? 'sun' : 'optical';
                          const nextCat = resolveCatFromMode(nextMode, nextSub);
                          const nextMat: FrameMaterial =
                            nextMode === 'metal' ? 'metal' : 'tr_plastic';
                          const nextWidth =
                            nextMode === 'kids' && it.frameWidthMm >= 130
                              ? 122
                              : nextMode !== 'kids' && it.frameWidthMm === 122
                              ? 136
                              : it.frameWidthMm;
                          updateCard(it.localId, {
                            frameType: nextMode,
                            subCategory: nextSub,
                            cat: nextCat,
                            material: nextMat,
                            type: nextMode === 'metal' ? 'rimless' : it.type === 'rimless' ? 'wayfarer' : it.type,
                            frameWidthMm: nextWidth,
                          });
                        }}
                        className="text-[0.66rem] px-2 py-0.5 rounded-lg bg-sky-50 hover:bg-sky-100 border border-sky-300 text-[#0F172A] font-extrabold cursor-pointer outline-none"
                      >
                        <option value="prescription">طبية 👓</option>
                        <option value="sunglasses">شمسية 🕶️</option>
                        <option value="clip_on">كليب أون (بغيار شمس) 🔄</option>
                        <option value="kids">أطفال 🧒</option>
                        <option value="metal">معادن / هاف فريم ✨</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isReady && (
                        <>
                          <label
                            className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[0.66rem] font-bold cursor-pointer"
                            title="إرفاق مجسم 3D اختياري بصيغة .glb"
                          >
                            {it.glbFile ? 'تغيير .glb' : '+ .glb'}
                            <input
                              type="file"
                              accept=".glb,.gltf"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = '';
                                if (f) void handleAttachGlb(it.localId, f);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            title="معاينة التثبيت على الوجه"
                            onClick={() => setInspectItem(it)}
                            className="w-7 h-7 rounded-lg bg-[#0F172A] text-white flex items-center justify-center hover:bg-slate-800 cursor-pointer"
                          >
                            <I n="eye" s={13} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        title="إزالة"
                        onClick={() => {
                          if (it.originalThumbUrl && it.originalThumbUrl.startsWith('blob:')) {
                            URL.revokeObjectURL(it.originalThumbUrl);
                          }
                          if (it.glbPreviewUrl) URL.revokeObjectURL(it.glbPreviewUrl);
                          if (it.savedProductId) void softDeleteProductById(it.savedProductId);
                          void deleteDraftFrame(it.localId);
                          setItems((prev) => prev.filter((x) => x.localId !== it.localId));
                        }}
                        className="w-7 h-7 rounded-lg bg-rose-600 text-white flex items-center justify-center hover:bg-rose-700 cursor-pointer"
                      >
                        <I n="x" s={13} />
                      </button>
                    </div>
                  </div>

                  {/* Clip-On Optical vs Sun Preview Switch */}
                  {isReady && it.frameType === 'clip_on' && it.clipOnImagePath && (
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0]">
                      <button
                        type="button"
                        onClick={() => updateCard(it.localId, { previewClipOn: false })}
                        className={
                          'py-1 rounded-lg text-[0.7rem] font-bold cursor-pointer ' +
                          (!it.previewClipOn ? 'bg-[#0F172A] text-white' : 'text-slate-700')
                        }
                      >
                        الوضع الطبي 👓
                      </button>
                      <button
                        type="button"
                        onClick={() => updateCard(it.localId, { previewClipOn: true })}
                        className={
                          'py-1 rounded-lg text-[0.7rem] font-bold cursor-pointer ' +
                          (it.previewClipOn ? 'bg-[#0284C7] text-white' : 'text-slate-700')
                        }
                      >
                        بغيار الشمس 🕶️
                      </button>
                    </div>
                  )}

                  {/* 2 Studio Outputs: Front Studio Catalog & 3/4 Side Catalog */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative h-32 rounded-xl border border-[#E2E8F0] bg-[#F8F9FA] flex items-center justify-center overflow-hidden p-1.5">
                      <span className="absolute top-1 start-1 z-10 px-1.5 py-0.5 rounded bg-[#0F172A]/85 text-white text-[0.54rem] font-bold">
                        أمامي كتالوج
                      </span>
                      {isEnhancing ? (
                        <div className="w-5 h-5 rounded-full border-2 border-[#0284C7] border-t-transparent animate-spin" />
                      ) : isError ? (
                        <span className="text-[0.6rem] text-rose-700 font-bold text-center">{it.errorMsg}</span>
                      ) : (
                        <img
                          src={activeFrontPreview}
                          alt={`أمامي ${it.name}`}
                          loading="lazy"
                          decoding="async"
                          className="max-h-full max-w-full object-contain"
                        />
                      )}
                    </div>

                    <div className="relative h-32 rounded-xl border border-[#E2E8F0] bg-[#F8F9FA] flex items-center justify-center overflow-hidden p-1.5">
                      <span className="absolute top-1 start-1 z-10 px-1.5 py-0.5 rounded bg-[#0F172A]/85 text-white text-[0.54rem] font-bold">
                        جانبي 3/4
                      </span>
                      {isEnhancing || it.sideBusy ? (
                        <div className="w-5 h-5 rounded-full border-2 border-[#0284C7] border-t-transparent animate-spin" />
                      ) : activeSidePreview ? (
                        <img
                          src={activeSidePreview}
                          alt={`جانبي ${it.name}`}
                          loading="lazy"
                          decoding="async"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-[0.6rem] text-slate-400">3/4</span>
                      )}
                      {isReady && (
                        <label className="absolute bottom-1 end-1 px-1.5 py-0.5 rounded bg-white/95 border border-slate-300 text-slate-800 text-[0.55rem] font-bold cursor-pointer hover:bg-slate-100">
                          تبديل
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (f) void handleSidePhotoSelected(it, f);
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Quality Warning */}
                  {isReady && needsCheck && (
                    <div className="rounded-xl bg-amber-50 border border-amber-300 px-2.5 py-1.5 text-[0.7rem] text-amber-800 font-semibold">
                      تنبيه مراجعة: {it.qualityNoteAr || 'يُنصح بمراجعة حواف الإطار قبل الاعتماد'}
                    </div>
                  )}

                  {/* Quick Name, Price, Optional Sale Price & Code/ModelCode */}
                  <div className="grid grid-cols-12 gap-1.5">
                    <input
                      className="col-span-5 rounded-lg border border-slate-300 bg-[#F8F9FA] text-slate-900 px-2.5 py-1.5 text-xs font-bold"
                      value={it.name}
                      onChange={(e) => updateCard(it.localId, { name: e.target.value })}
                      placeholder="اسم الشنبر"
                    />
                    <input
                      type="number"
                      min="0"
                      dir="ltr"
                      title="السعر الأساسي"
                      className="col-span-2 rounded-lg border border-slate-300 bg-[#F8F9FA] text-slate-900 px-2 py-1.5 text-xs font-bold tabular-nums"
                      value={it.price}
                      onChange={(e) => updateCard(it.localId, { price: Math.max(0, Number(e.target.value) || 0) })}
                      placeholder="السعر"
                    />
                    <input
                      type="number"
                      min="0"
                      dir="ltr"
                      title="سعر العرض (اختياري)"
                      className="col-span-2 rounded-lg border border-amber-300 bg-amber-50/40 text-amber-900 px-2 py-1.5 text-xs font-bold tabular-nums"
                      value={it.salePrice || ''}
                      onChange={(e) =>
                        updateCard(it.localId, {
                          salePrice: e.target.value ? Math.max(0, Number(e.target.value) || 0) : undefined,
                        })
                      }
                      placeholder="عرض"
                    />
                    <input
                      className="col-span-3 rounded-lg border border-slate-300 bg-[#F8F9FA] text-slate-700 px-2 py-1.5 text-[0.7rem] font-mono"
                      dir="ltr"
                      title="الكود / رقم الموديل"
                      value={it.modelCode || it.code}
                      onChange={(e) =>
                        updateCard(it.localId, {
                          code: e.target.value.toUpperCase(),
                          modelCode: e.target.value.toUpperCase(),
                        })
                      }
                    />
                  </div>

                  {/* Explicit Approve ("اعتماد") & Retry ("إعادة المعالجة") Controls */}
                  {!isEnhancing && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={!isReady || it.approved}
                        onClick={() => void handleApproveCard(it.localId)}
                        className={
                          'py-2 px-3 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 transition ' +
                          (it.approved
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 cursor-default'
                            : 'bg-[#D97706] hover:bg-[#B45309] text-white cursor-pointer disabled:opacity-45')
                        }
                      >
                        <I n="check" s={14} /> {it.approved ? 'تم الاعتماد ✓' : 'اعتماد'}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleRetryCard(it.localId)}
                        className="py-2 px-3 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <I n="refresh" s={14} /> إعادة المعالجة
                      </button>
                    </div>
                  )}

                  {/* Frame Specs & Fit Preview */}
                  {isReady && activeTryOnPreview && (
                    <div className="space-y-2 border-t border-slate-100 pt-2">
                      <div className="grid grid-cols-2 gap-1.5 text-[0.68rem]">
                        <div className="flex items-center justify-between bg-[#F8F9FA] border border-[#E2E8F0] rounded-lg px-2 py-1">
                          <span className="text-slate-600">العرض (mm)</span>
                          <input
                            type="number"
                            min="100"
                            max="165"
                            dir="ltr"
                            className="w-12 bg-transparent font-mono font-bold text-slate-900 text-center"
                            value={it.frameWidthMm}
                            onChange={(e) =>
                              updateCard(it.localId, {
                                frameWidthMm: Math.max(100, Math.min(165, Number(e.target.value) || 136)),
                              })
                            }
                          />
                        </div>
                        <input
                          type="text"
                          dir="ltr"
                          className="bg-[#F8F9FA] border border-[#E2E8F0] rounded-lg px-2 py-1 font-mono text-slate-900"
                          value={it.opticalDimensions}
                          onChange={(e) => updateCard(it.localId, { opticalDimensions: e.target.value })}
                          placeholder="52-18-140"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => updateCard(it.localId, { showFacePreview: !it.showFacePreview })}
                        className="w-full py-1.5 px-2.5 rounded-lg bg-[#F8F9FA] hover:bg-slate-100 border border-[#E2E8F0] text-slate-800 text-[0.68rem] font-bold flex items-center justify-between cursor-pointer"
                      >
                        <span>معاينة وملاءمة التثبيت على الوجه</span>
                        <span className="text-[#0284C7]">{it.showFacePreview ? 'إخفاء' : 'عرض'}</span>
                      </button>

                      {it.showFacePreview && (
                        <div className="bg-slate-900 text-white rounded-xl p-2">
                          <FrameFitPreview
                            cutoutUrl={activeTryOnPreview}
                            storeFrontUrl={activeFrontPreview}
                            type={it.type}
                            fitScale={it.fitScale}
                            eyeLineOffset={it.eyeLineOffset}
                            compact
                            onChangeFitScale={(v) => updateCard(it.localId, { fitScale: v })}
                            onChangeEyeLineOffset={(v) => updateCard(it.localId, { eyeLineOffset: v })}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {hasMoreItems && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <span className="text-xs text-slate-600 tabular-nums">
                عرض <span dir="ltr">{visibleItems.length} / {items.length}</span> نظارة
              </span>
              <button
                type="button"
                onClick={() => setVisibleLimit((c) => c + PAGE_SIZE)}
                className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-800 text-xs font-bold cursor-pointer"
              >
                عرض المزيد (+{Math.min(PAGE_SIZE, items.length - visibleItems.length)})
              </button>
            </div>
          )}
        </>
      )}

      {/* Detailed Inspection Modal */}
      {inspectItem && inspectItem.frontCatalogPath && inspectItem.imagePath && (
        <Modal title={`معاينة — ${inspectItem.name}`} onClose={() => setInspectItem(null)} w="max-w-lg">
          {inspectItem.glbPreviewUrl ? (
            <Eyewear3DViewer
              product={{
                id: inspectItem.localId,
                shopId: activeShop.id,
                code: inspectItem.code,
                name: inspectItem.name,
                type: inspectItem.type,
                cat: inspectItem.cat,
                frameType: inspectItem.frameType,
                subCategory: inspectItem.subCategory,
                price: inspectItem.price,
                salePrice: inspectItem.salePrice,
                disc: 0,
                frame: inspectItem.frameHexColor,
                lens: inspectItem.cat === 'sun' ? '#334155' : '#dbeafe',
                processedImage: inspectItem.frontCatalogPath,
                storeFrontUrl: inspectItem.frontCatalogPath,
                tryOnFrontUrl: inspectItem.imagePath,
                imagePath: inspectItem.imagePath,
                frontCatalogPath: inspectItem.frontCatalogPath,
                sideImagePath: inspectItem.sideImagePath,
                glbUrl: inspectItem.glbPreviewUrl,
                model3dUrl: inspectItem.glbPreviewUrl,
                shapes: ['oval', 'round', 'square'],
                modelCalibration: {
                  ...(inspectItem.calibration || {}),
                  frameWidthMm: inspectItem.frameWidthMm,
                  opticalDimensions: inspectItem.opticalDimensions,
                  material: inspectItem.material,
                  fitScale: inspectItem.fitScale,
                  eyeLineOffset: inspectItem.eyeLineOffset,
                },
              }}
              frameWidthMmOverride={inspectItem.frameWidthMm}
            />
          ) : (
            <FrameFitPreview
              cutoutUrl={inspectItem.imagePath}
              storeFrontUrl={inspectItem.frontCatalogPath}
              type={inspectItem.type}
              fitScale={inspectItem.fitScale}
              eyeLineOffset={inspectItem.eyeLineOffset}
              onChangeFitScale={(v) => {
                updateCard(inspectItem.localId, { fitScale: v });
                setInspectItem((prev) => (prev ? { ...prev, fitScale: v } : null));
              }}
              onChangeEyeLineOffset={(v) => {
                updateCard(inspectItem.localId, { eyeLineOffset: v });
                setInspectItem((prev) => (prev ? { ...prev, eyeLineOffset: v } : null));
              }}
            />
          )}
          <div className="flex justify-between items-center mt-3 text-xs text-slate-600">
            <span>
              الأبعاد: <span dir="ltr" className="font-mono font-bold">{inspectItem.opticalDimensions}</span>
            </span>
            <span>
              السعر:{' '}
              <span dir="ltr" className="font-bold text-[#0F172A]">
                {inspectItem.salePrice && inspectItem.salePrice < inspectItem.price
                  ? inspectItem.salePrice
                  : inspectItem.price}
              </span>{' '}
              ج.م
            </span>
          </div>
        </Modal>
      )}

      {/* Smart Out-of-Credits / Capacity Exhausted Popup Modal */}
      {outOfCreditsModal && (
        <Modal
          title={outOfCreditsModal === 'capacity' ? 'اكتملت سعة الكتالوج المتاحة' : 'نفد رصيد المعالجة بالذكاء الاصطناعي'}
          onClose={() => setOutOfCreditsModal(null)}
        >
          <div className="space-y-4">
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-950 leading-7">
              {outOfCreditsModal === 'capacity'
                ? 'وصل متجرك للحد الأقصى من النظارات المتاحة في باقتك الحالية. يمكنك إضافة باقة سريعة أو ترقية باقتك الآن للمتابعة فوراً.'
                : 'انتهى رصيد معالجة الصور بالذكاء الاصطناعي في باقتك الحالية. اشحن باقة إضافية فورية أو قم بترقية اشتراكك لإكمال رفع النظارات.'}
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3">
                <div className="text-slate-500 mb-1">سعة الكتالوج</div>
                <b className="text-sm text-[#0F172A] tabular-nums" dir="ltr">
                  {activeShopProductsCount} / {maxProducts}
                </b>
              </div>
              <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3">
                <div className="text-slate-500 mb-1">رصيد المعالجة</div>
                <b className="text-sm text-[#0284C7] tabular-nums" dir="ltr">
                  {remainingCredits} / {creditsCap}
                </b>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white w-full !py-3 font-extrabold"
                onClick={async () => {
                  await addTopUpCredits(activeShop.id);
                  setOutOfCreditsModal(null);
                }}
              >
                <I n="plus" s={16} />
                <span>
                  +{platformSettings.topupPackFrames} نظارة إضافية بـ{' '}
                  <span dir="ltr">{platformSettings.topupPackPrice}</span> ج.م
                </span>
              </button>

              <a
                className="btn btn-g w-full !py-2.5"
                href={`https://wa.me/201000000000?text=${encodeURIComponent(
                  `مرحباً إدارة OptiVerse، أرغب في ترقية باقة متجر "${activeShop.name}" (${activeShop.slug}).`
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                <I n="crown" s={15} c="text-[#D97706]" /> ترقية الباقة عبر واتساب الإدارة
              </a>
            </div>
          </div>
        </Modal>
      )}

      <NewCollectionPromoModal
        open={Boolean(promoModalFrames && promoModalFrames.length > 0)}
        onClose={() => setPromoModalFrames(null)}
        shop={activeShop}
        frames={promoModalFrames || []}
        onToast={toast}
      />

      {/* Portaled Live Image Processing Queue Modal (Auto-opens on upload; X minimizes to floating pill) */}
      {isQueueModalOpen &&
        (processing || progress.total > 0) &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            dir="rtl"
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-sm fade overflow-y-auto"
            style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
            onClick={() => setIsQueueModalOpen(false)}
          >
            <div
              className="pop bg-white rounded-3xl max-w-2xl w-full my-auto shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh] text-[#0F172A]"
              style={{ backgroundColor: '#FFFFFF' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header with clear X minimize button */}
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-[#F8F9FA] shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  {processing ? (
                    <span className="w-5 h-5 rounded-full border-[2.5px] border-[#0284C7] border-t-transparent animate-spin shrink-0" />
                  ) : (
                    <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-extrabold shrink-0">
                      ✓
                    </span>
                  )}
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-sm sm:text-base text-slate-900 truncate">
                      {processing
                        ? `جاري التحسين — تم تجهيز ${progress.done} من ${progress.total} نظارة`
                        : cancelled
                        ? `تم إيقاف المعالجة — تم تجهيز ${progress.done} من ${progress.total} نظارة`
                        : `اكتمل تجهيز ${progress.done} من ${progress.total} نظارة ✓`}
                    </h3>
                    <p className="text-[0.72rem] text-slate-500 truncate">
                      {processing
                        ? 'يمكنك إغلاق هذه النافذة (✕) ومتابعة تصفح لوحة التاجر بينما يستمر التجهيز في الخلفية'
                        : 'النظارات جاهزة الآن للمراجعة والاعتماد في جدول المنتجات'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsQueueModalOpen(false)}
                  aria-label="تصغير نافذة المعالجة"
                  className="w-9 h-9 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-extrabold flex items-center justify-center cursor-pointer shrink-0 shadow-xs"
                >
                  ✕
                </button>
              </div>

              {/* Progress Bar */}
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 space-y-2 shrink-0 bg-white">
                <div className="flex items-center justify-between text-xs font-extrabold">
                  <span className="text-slate-700">
                    {processing ? 'تقدم طابور المعالجة:' : 'حالة الدفعة:'}
                  </span>
                  <span className="text-[#0284C7] tabular-nums" dir="ltr">
                    {progress.done} / {progress.total} ({pct}%)
                  </span>
                </div>
                <div className="h-3 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-[#0284C7] rounded-full transition-all duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* Active Frame Queue Cards */}
              <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-2.5 bg-white">
                {items.slice(-Math.max(progress.total, 6)).map((it) => {
                  const isEnh = it.status === 'enhancing';
                  const isErr = it.status === 'error';
                  const previewSrc = it.frontCatalogPath || it.imagePath || it.originalThumbUrl;
                  return (
                    <div
                      key={it.localId}
                      className="flex items-center gap-3 p-2.5 rounded-2xl border border-slate-200 bg-[#F8F9FA]"
                    >
                      <div className="w-16 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                        {previewSrc ? (
                          <img src={previewSrc} alt={it.name} className="w-full h-full object-contain p-1" />
                        ) : (
                          <I n="eye" s={16} c="text-slate-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-extrabold text-xs text-slate-900 truncate">{it.name}</div>
                        <div className="text-[0.68rem] text-slate-500 mt-0.5 truncate">
                          {it.stageLabel} · <span className="font-mono" dir="ltr">{it.code}</span>
                        </div>
                      </div>
                      <span
                        className={
                          'px-2.5 py-1 rounded-full text-[0.66rem] font-extrabold shrink-0 ' +
                          (isEnh
                            ? 'bg-sky-50 text-[#0284C7] border border-sky-200'
                            : isErr
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
                        }
                      >
                        {isEnh ? 'جاري التحسين...' : isErr ? 'تعذر' : 'جاهزة ✓'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Footer Controls */}
              <div className="px-5 py-3.5 border-t border-slate-200 bg-[#F8F9FA] flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  {processing && (
                    <button
                      type="button"
                      onClick={handleCancelQueue}
                      className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-extrabold cursor-pointer transition"
                    >
                      إيقاف مؤقت / إلغاء
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsQueueModalOpen(false);
                    if (!processing) {
                      onNavigateToProds?.();
                      setTimeout(() => {
                        queueAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 80);
                    }
                  }}
                  className="btn btn-p px-5 py-2 text-xs font-extrabold cursor-pointer"
                >
                  {processing ? 'تصغير ومتابعة التصفح ↓' : 'عرض النظارات للمراجعة والاعتماد ✓'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Floating Minimize Pill while processing is minimized (auto-hides when done) */}
      {processing &&
        !isQueueModalOpen &&
        progress.total > 0 &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <button
            type="button"
            dir="rtl"
            onClick={() => {
              onNavigateToProds?.();
              setIsQueueModalOpen(true);
              setTimeout(() => {
                queueAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 80);
            }}
            style={{ position: 'fixed', bottom: 84, right: 16, zIndex: 9990 }}
            className="px-4 py-2.5 rounded-full bg-[#0F172A] hover:bg-slate-800 text-white border border-sky-400/50 shadow-2xl flex items-center gap-2 text-xs font-extrabold cursor-pointer transition active:scale-95"
          >
            <span className="w-3.5 h-3.5 rounded-full border-2 border-amber-300 border-t-transparent animate-spin shrink-0" />
            <span>
              المعالجة في الأسفل (<span dir="ltr">{progress.done}/{progress.total}</span>) ↓
            </span>
          </button>,
          document.body
        )}
    </div>
  );
}
