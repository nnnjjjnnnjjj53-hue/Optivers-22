import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getShopMaxProducts, getShopPlanCapabilities, useOptiVerse } from '../services/optiverseStore';
import {
  EyewearFrameMode,
  EyewearSubMode,
  FrameCat,
  FrameMaterial,
  FrameSize,
  FrameType,
  ModelCalibration,
  Product,
  ProductImage,
} from '../types';
import { generateTintedCatalogAsset, processCutoutInWorker } from '../utils/cutoutWorkerClient';
import {
  computePerceptualHash,
  extractOpticalDimensionsViaServer,
  generateSplitSheetViaServer,
  pollBatchSplitSheetStatus,
  saveToSharedEyewearCache,
  submitBatchSplitSheetViaServer,
} from '../utils/splitSheetApi';
import { CutoutWorkerOutput } from '../workers/cutoutWorker';
import { deleteDraftFrame, loadDraftFrames, PersistedDraftFrame, saveDraftFrame } from '../utils/draftStorage';
import { Eyewear3DViewer } from './Eyewear3DARStage';
import { FrameFitPreview, PhotoUploadGuidelines } from './FrameFitPreviewCard';
import { I } from './Icons';
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
  showFacePreview?: boolean;
  previewClipOn?: boolean;
  cacheHit?: boolean;
  autoColorSibling?: boolean;
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
    .replace(/[-_](black|gold|silver|blue|brown|red|green|clear|crystal|havana|tortoise|gray|grey|c\d+)$/i, '')
    .trim();
  return stem.length >= 3 ? stem : '';
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
    // Approval gate: never publish until merchant explicitly clicks اعتماد
    isPublished: Boolean(it.isPublished),
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

export function BulkFrameUploader({ onSaved }: { onSaved?: () => void }) {
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
  const creditsCap = (activeShop.aiCreditsLimit || planCaps.monthlyAiCredits || 100) + (activeShop.topupCredits || 0);
  const creditsUsed = activeShop.aiCreditsUsed || 0;
  const remainingCredits = activeShop.isDemoAdminStore ? 999999 : Math.max(0, creditsCap - creditsUsed);
  const [outOfCreditsModal, setOutOfCreditsModal] = useState<'credits' | 'capacity' | null>(null);

  // Step 1: 5 Frame Category Modes (BEFORE selecting photos)
  const [selectedMode, setSelectedMode] = useState<EyewearFrameMode>('prescription');
  const [subCategory, setSubCategory] = useState<EyewearSubMode>('optical');
  const [turboMode, setTurboMode] = useState<boolean>(planCaps.turboUploadEnabled);
  const [autoGroupColors, setAutoGroupColors] = useState<boolean>(true);
  const [keepLensBranding, setKeepLensBranding] = useState<boolean>(false);
  const [validationAlert, setValidationAlert] = useState<string | null>(null);

  const [items, setItems] = useState<BulkFrameItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [dragOver, setDragOver] = useState(false);
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
  itemsRef.current = items;

  useEffect(() => {
    setTurboMode(planCaps.turboUploadEnabled);
  }, [planCaps.turboUploadEnabled]);

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

  // Adjust sensible default width for kids vs adult modes
  useEffect(() => {
    if (selectedMode === 'kids') {
      setBulkWidthMm(122);
    } else if (bulkWidthMm === 122) {
      setBulkWidthMm(136);
    }
    if (selectedMode === 'sunglasses') {
      setSubCategory('sun');
    } else if (selectedMode === 'prescription' || selectedMode === 'clip_on') {
      setSubCategory('optical');
    }
    setValidationAlert(null);
  }, [selectedMode]);

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
      uploadAssetToStorage(res.imagePath.blob, `products/${shopId}/cutouts`, extCut),
      uploadAssetToStorage(res.frontCatalogPath.blob, `products/${shopId}/front`, extCat),
      uploadAssetToStorage(res.sideImagePath.blob, `products/${shopId}/side`, extSide),
      uploadAssetToStorage(res.lensMask.blob, `products/${shopId}/masks`, 'png'),
    ]);
    return { imagePath, frontCatalogPath, sideImagePath, maskUrl };
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
      quality: baseData.quality,
      qualityNoteAr: baseData.qualityNoteAr,
      status: 'ready',
      stageLabel: baseData.cacheHit
        ? 'من الكتالوج المشترك بدون رصيد ⚡'
        : baseData.autoColorSibling
        ? 'لون مضاف محلياً (توفير AI) 🎨'
        : baseData.quality === 'check'
        ? 'يُرجى المراجعة'
        : 'جاهزة للاعتماد',
      approved: false,
      isPublished: false,
      reprocessing: false,
    };

    const { prod, images } = buildProductPayloadFromItem(activeShop.id, updatedCard);
    let savedProductId = updatedCard.savedProductId;
    if (savedProductId) {
      await updateProduct(savedProductId, prod, images);
    } else {
      const saved = await addProduct(prod, images);
      savedProductId = saved.id;
    }
    updatedCard.savedProductId = savedProductId;

    await saveDraftFrame(toPersistedDraft(activeShop.id, updatedCard));
    setItems((prev) => prev.map((x) => (x.localId === cardSnapshot.localId ? updatedCard : x)));
    return updatedCard;
  };

  const processSingleCard = async (
    cardSnapshot: BulkFrameItem,
    signal?: AbortSignal,
    precomputedSplit?: { blob?: Blob; cacheHit?: boolean; cachedAssets?: any }
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

    try {
      const authMeta = await buildClientAuthMeta();
      const effectiveSub: EyewearSubMode =
        cardSnapshot.frameType === 'clip_on' ? 'optical' : cardSnapshot.subCategory;

      // Step 1: Zero-cost OCR dimension/model code extraction + pHash (unless already present)
      let workingCard = { ...cardSnapshot };
      if (!workingCard.phash || !workingCard.ocrFound) {
        const [ocr, phash] = await Promise.all([
          workingCard.ocrFound
            ? Promise.resolve(null)
            : extractOpticalDimensionsViaServer(srcFile, signal, authMeta),
          workingCard.phash ? Promise.resolve(workingCard.phash) : computePerceptualHash(srcFile),
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
            opticalDimensions: formatOpticalString(
              ocr.lensWidthMm,
              ocr.bridgeWidthMm,
              ocr.templeLengthMm,
              workingCard.opticalDimensions
            ),
          };
        }
        workingCard.phash = phash || workingCard.phash;
      }

      setItems((prev) =>
        prev.map((x) =>
          x.localId === workingCard.localId
            ? {
                ...workingCard,
                stageLabel: 'جاري فحص الكتالوج وتجهيز صور الاستوديو...',
              }
            : x
        )
      );

      // Step 2: Single-Call Split Sheet OR precomputed Batch result
      const splitRes =
        precomputedSplit ||
        (await generateSplitSheetViaServer(
          srcFile,
          {
            ...authMeta,
            frameType: workingCard.frameType,
            subCategory: effectiveSub,
            isClipOnAttachment: false,
            keepLensBranding: Boolean(workingCard.keepLensBranding),
            isCrystalFrame: Boolean(workingCard.isCrystalFrame),
            modelCode: workingCard.modelCode,
            phash: workingCard.phash,
            lensWidthMm: workingCard.lensWidthMm,
            bridgeWidthMm: workingCard.bridgeWidthMm,
            templeLengthMm: workingCard.templeLengthMm,
            totalFrameWidthMm: workingCard.totalFrameWidthMm || workingCard.frameWidthMm,
          },
          signal
        ));

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
      };

      if (splitRes.cacheHit && splitRes.cachedAssets && (splitRes.cachedAssets.frontCatalogPath || splitRes.cachedAssets.imagePath)) {
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
      } else {
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

        // Save to Shared Eyewear Cache (fire-and-forget)
        void saveToSharedEyewearCache({
          ...authMeta,
          modelCode: workingCard.modelCode || workingCard.code,
          frameColor: baseRes.frameHexColor,
          phash: workingCard.phash,
          keepLensBranding: Boolean(workingCard.keepLensBranding),
          isCrystalFrame: Boolean(workingCard.isCrystalFrame),
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
        };
      }

      let clipOnUrls: {
        clipOnImagePath?: string;
        clipOnFrontCatalogPath?: string;
        clipOnSideImagePath?: string;
      } = {};

      if (workingCard.frameType === 'clip_on' && workingCard.clipOnSourceFile) {
        setItems((prev) =>
          prev.map((x) =>
            x.localId === workingCard.localId
              ? { ...x, stageLabel: 'جاري تجهيز صور غيار الشمس الاستوديو...' }
              : x
          )
        );
        const clipSplitSheet = await generateSplitSheetViaServer(
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
        if (signal?.aborted) return null;

        if (clipSplitSheet.cacheHit && clipSplitSheet.cachedAssets) {
          clipOnUrls = {
            clipOnImagePath: clipSplitSheet.cachedAssets.imagePath || undefined,
            clipOnFrontCatalogPath: clipSplitSheet.cachedAssets.frontCatalogPath || undefined,
            clipOnSideImagePath: clipSplitSheet.cachedAssets.sideImagePath || undefined,
          };
        } else {
          const clipRes = await processCutoutInWorker(
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
          );
          if (signal?.aborted) return null;
          const uploadedClip = await uploadCutoutResult(clipRes, activeShop.id);
          clipOnUrls = {
            clipOnImagePath: uploadedClip.imagePath,
            clipOnFrontCatalogPath: uploadedClip.frontCatalogPath,
            clipOnSideImagePath: uploadedClip.sideImagePath,
          };
        }
      }

      if (signal?.aborted) return null;
      return await finalizeProcessedCard(workingCard, { ...baseUrls, ...baseMeta }, clipOnUrls);
    } catch (err) {
      if (signal?.aborted) return null;
      const msg = err instanceof Error ? err.message : 'تعذر تحسين الصورة';
      if (/رصيد|credit|quota|402/i.test(msg)) {
        setOutOfCreditsModal('credits');
      }
      setItems((prev) =>
        prev.map((x) =>
          x.localId === cardSnapshot.localId
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
      return null;
    }
  };

  const processSiblingColorLocally = async (
    leadCard: BulkFrameItem,
    siblingCard: BulkFrameItem,
    signal?: AbortSignal
  ): Promise<BulkFrameItem | null> => {
    if (signal?.aborted || !siblingCard.sourceFile || !leadCard.imagePath || !leadCard.frontCatalogPath) {
      return null;
    }
    try {
      const targetHex = await sampleRoughHexFromFile(siblingCard.sourceFile);
      const [tintedCut, tintedFront, tintedSide] = await Promise.all([
        generateTintedCatalogAsset(leadCard.imagePath, targetHex),
        generateTintedCatalogAsset(leadCard.frontCatalogPath, targetHex),
        leadCard.sideImagePath
          ? generateTintedCatalogAsset(leadCard.sideImagePath, targetHex)
          : Promise.resolve(null),
      ]);
      if (signal?.aborted) return null;

      const [imagePath, frontCatalogPath, sideImagePath] = await Promise.all([
        uploadAssetToStorage(tintedCut.blob, `products/${activeShop.id}/cutouts`, 'webp'),
        uploadAssetToStorage(tintedFront.blob, `products/${activeShop.id}/front`, 'webp'),
        tintedSide
          ? uploadAssetToStorage(tintedSide.blob, `products/${activeShop.id}/side`, 'webp')
          : Promise.resolve(leadCard.sideImagePath || ''),
      ]);

      return await finalizeProcessedCard(
        {
          ...siblingCard,
          modelCode: leadCard.modelCode,
          frameWidthMm: leadCard.frameWidthMm,
          lensWidthMm: leadCard.lensWidthMm,
          bridgeWidthMm: leadCard.bridgeWidthMm,
          templeLengthMm: leadCard.templeLengthMm,
          totalFrameWidthMm: leadCard.totalFrameWidthMm,
          opticalDimensions: leadCard.opticalDimensions,
          isCrystalFrame: leadCard.isCrystalFrame,
        },
        {
          imagePath,
          frontCatalogPath,
          sideImagePath: sideImagePath || frontCatalogPath,
          maskUrl: leadCard.maskUrl,
          aspectRatio: leadCard.aspectRatio,
          frameHexColor: targetHex,
          frameOpacity: leadCard.frameOpacity,
          detectedMaterial: leadCard.material,
          detectedType: leadCard.type,
          calibration: leadCard.calibration,
          quality: 'good',
          autoColorSibling: true,
        }
      );
    } catch {
      return null;
    }
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

    // Strict 50-photo batch limit
    if (files.length > MAX_BATCH_SIZE) {
      const msg = `الحد الأقصى للدفعة الواحدة هو ${MAX_BATCH_SIZE} صورة. اخترت ${files.length} صورة — قسّم الرفع على دفعات.`;
      setValidationAlert(msg);
      toast(msg);
      return;
    }

    // Clip-On strict even pairing check
    if (selectedMode === 'clip_on' && files.length % 2 !== 0) {
      const msg = 'تنبيه: كل نظارة بغيار شمس تتطلب صورتين (بدون الغيار + بالغيار).';
      setValidationAlert(msg);
      toast(msg);
      return;
    }

    const plannedPairsCount = selectedMode === 'clip_on' ? files.length / 2 : files.length;
    if (!activeShop.isDemoAdminStore && remainingCredits <= 0) {
      setOutOfCreditsModal('credits');
      return;
    }
    const remainingCapacity = Math.max(0, maxProducts - activeShopProductsCount);
    if (!activeShop.isDemoAdminStore && plannedPairsCount > remainingCapacity) {
      const msg = `متاح في باقتك حتى ${maxProducts} نظارة (المستخدم حالياً ${activeShopProductsCount}). متاح لإضافة ${remainingCapacity} نظارة فقط — قم بشحن باقة إضافية أو ترقية الباقة.`;
      setValidationAlert(msg);
      setOutOfCreditsModal('capacity');
      toast(msg);
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const chosenMode = selectedMode;
    const chosenSub: EyewearSubMode =
      chosenMode === 'sunglasses'
        ? 'sun'
        : chosenMode === 'prescription' || chosenMode === 'clip_on'
        ? 'optical'
        : subCategory;
    const chosenCat = resolveCatFromMode(chosenMode, chosenSub);
    const chosenMaterial: FrameMaterial = chosenMode === 'metal' ? 'metal' : 'tr_plastic';
    const seedNum = Math.floor(2000 + Math.random() * 6000);
    const defaultPrice = Math.max(0, Number(bulkPrice) || 950);

    const pairs: { front: File; clipOn?: File; idx: number }[] = [];
    if (chosenMode === 'clip_on') {
      for (let i = 0; i < files.length; i += 2) {
        pairs.push({ front: files[i], clipOn: files[i + 1], idx: i / 2 });
      }
    } else {
      files.forEach((f, i) => pairs.push({ front: f, idx: i }));
    }

    const newCards: BulkFrameItem[] = pairs.map(({ front, clipOn, idx }) => ({
      localId: `bulk-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      sourceFile: front,
      clipOnSourceFile: clipOn,
      originalThumbUrl: URL.createObjectURL(front),
      status: 'enhancing',
      stageLabel: 'في الانتظار...',
      approved: false,
      isPublished: false,
      name: cleanNameFromFile(front.name, idx),
      code: `FR-${seedNum + idx}`,
      price: defaultPrice,
      frameType: chosenMode,
      subCategory: chosenSub,
      frameWidthMm: chosenMode === 'kids' ? 122 : bulkWidthMm,
      opticalDimensions: bulkOpticalDim,
      keepLensBranding: Boolean(platformSettings.allowMerchantLensBrandingToggle && keepLensBranding),
      fitScale: 1.0,
      eyeLineOffset: 0.04,
      cat: chosenCat,
      material: chosenMaterial,
      type: chosenMode === 'metal' ? 'rimless' : 'wayfarer',
      aspectRatio: 2.4,
      frameHexColor: '#1f2937',
      frameOpacity: 1.0,
      reprocessing: true,
    }));

    setItems((prev) => [...prev, ...newCards]);
    setProcessing(true);
    setCancelled(false);
    setProgress({ done: 0, total: newCards.length });
    setVisibleLimit((lim) => Math.max(lim, PAGE_SIZE));

    const authMeta = await buildClientAuthMeta();
    const useTurbo = Boolean(turboMode && planCaps.turboUploadEnabled);

    // Pre-OCR + pHash on all cards when Auto-Color Grouping or Batch API is enabled
    const preparedCards = [...newCards];
    if (autoGroupColors || (!useTurbo && newCards.length > 1)) {
      await Promise.all(
        preparedCards.map(async (c, i) => {
          if (ctrl.signal.aborted || !c.sourceFile) return;
          const [ocr, phash] = await Promise.all([
            extractOpticalDimensionsViaServer(c.sourceFile, ctrl.signal, authMeta),
            computePerceptualHash(c.sourceFile),
          ]);
          const widthMm = ocr.totalFrameWidthMm || c.frameWidthMm;
          preparedCards[i] = {
            ...c,
            modelCode: ocr.modelCode || undefined,
            isCrystalFrame: ocr.isCrystalFrame,
            lensWidthMm: ocr.lensWidthMm || undefined,
            bridgeWidthMm: ocr.bridgeWidthMm || undefined,
            templeLengthMm: ocr.templeLengthMm || undefined,
            totalFrameWidthMm: widthMm,
            frameWidthMm: widthMm,
            ocrFound: ocr.found,
            opticalDimensions: formatOpticalString(
              ocr.lensWidthMm,
              ocr.bridgeWidthMm,
              ocr.templeLengthMm,
              c.opticalDimensions
            ),
            phash: phash || undefined,
          };
        })
      );
      setItems((prev) =>
        prev.map((p) => preparedCards.find((x) => x.localId === p.localId) || p)
      );
    }

    // Auto-Color Grouping: pick 1 lead frame per model group; siblings use local Canvas tinting at $0 API cost
    const leadByGroupKey = new Map<string, BulkFrameItem>();
    const siblingMap = new Map<string, BulkFrameItem>(); // sibling.localId -> leadCard
    const aiQueue: BulkFrameItem[] = [];

    for (const c of preparedCards) {
      const gKey = autoGroupColors ? extractColorGroupingKey(c.sourceFile?.name || c.name, c.modelCode) : '';
      if (gKey && leadByGroupKey.has(gKey) && c.frameType !== 'clip_on') {
        siblingMap.set(c.localId, leadByGroupKey.get(gKey)!);
      } else {
        if (gKey && !leadByGroupKey.has(gKey)) {
          leadByGroupKey.set(gKey, c);
        }
        aiQueue.push(c);
      }
    }

    let doneCount = 0;
    let successCount = 0;
    const processedLeadById = new Map<string, BulkFrameItem>();

    // Use Batch API path when Standard (non-Turbo) & >1 item in AI queue
    if (!useTurbo && aiQueue.length > 1) {
      try {
        const { jobId } = await submitBatchSplitSheetViaServer({
          ...authMeta,
          turbo: false,
          signal: ctrl.signal,
          items: aiQueue.map((c) => ({
            localId: c.localId,
            file: c.sourceFile!,
            frameType: c.frameType,
            subCategory: c.frameType === 'clip_on' ? 'optical' : c.subCategory,
            keepLensBranding: Boolean(c.keepLensBranding),
            isCrystalFrame: Boolean(c.isCrystalFrame),
            modelCode: c.modelCode,
            phash: c.phash,
            lensWidthMm: c.lensWidthMm,
            bridgeWidthMm: c.bridgeWidthMm,
            templeLengthMm: c.templeLengthMm,
            totalFrameWidthMm: c.totalFrameWidthMm,
          })),
        });

        let batchResults: Record<string, { blob?: Blob; cacheHit?: boolean; cachedAssets?: any; error?: string }> = {};
        while (!ctrl.signal.aborted) {
          const st = await pollBatchSplitSheetStatus(jobId, authMeta, ctrl.signal);
          setProgress({ done: Math.min(st.done, newCards.length), total: newCards.length });
          if (st.status === 'completed') {
            batchResults = st.results;
            break;
          }
          if (st.status === 'failed') break;
          await new Promise((r) => setTimeout(r, 1200));
        }

        for (const c of aiQueue) {
          if (ctrl.signal.aborted) break;
          const res = batchResults[c.localId];
          if (res && !res.error && (res.blob || res.cacheHit)) {
            const finished = await processSingleCard(c, ctrl.signal, res);
            if (finished) {
              processedLeadById.set(c.localId, finished);
              successCount++;
            }
          } else {
            const finished = await processSingleCard(c, ctrl.signal);
            if (finished) {
              processedLeadById.set(c.localId, finished);
              successCount++;
            }
          }
          doneCount++;
          setProgress({ done: doneCount, total: newCards.length });
        }
      } catch {
        // Fallback cleanly to sequential queue if batch submission fails
        for (const c of aiQueue) {
          if (ctrl.signal.aborted) break;
          const finished = await processSingleCard(c, ctrl.signal);
          if (finished) {
            processedLeadById.set(c.localId, finished);
            successCount++;
          }
          doneCount++;
          setProgress({ done: doneCount, total: newCards.length });
        }
      }
    } else {
      for (const c of aiQueue) {
        if (ctrl.signal.aborted) break;
        const finished = await processSingleCard(c, ctrl.signal);
        if (finished) {
          processedLeadById.set(c.localId, finished);
          successCount++;
        }
        doneCount++;
        setProgress({ done: doneCount, total: newCards.length });
        if (ctrl.signal.aborted) break;
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    // Generate $0 local color-variant assets for grouped siblings
    for (const [sibId, leadRef] of siblingMap.entries()) {
      if (ctrl.signal.aborted) break;
      const sib = preparedCards.find((x) => x.localId === sibId);
      const finishedLead = processedLeadById.get(leadRef.localId);
      let okSib: BulkFrameItem | null = null;
      if (sib && finishedLead) {
        okSib = await processSiblingColorLocally(finishedLead, sib, ctrl.signal);
      }
      if (!okSib && sib) {
        okSib = await processSingleCard(sib, ctrl.signal);
      }
      doneCount++;
      if (okSib) successCount++;
      setProgress({ done: doneCount, total: newCards.length });
    }

    setProcessing(false);
    if (ctrl.signal.aborted) {
      setCancelled(true);
      toast(`تم إيقاف المعالجة عند ${successCount} نظارة`);
    } else if (successCount > 0) {
      toast(`تم تجهيز ${successCount} نظارة — راجع النتيجة واضغط "اعتماد" لنشرها في المتجر ✓`);
    }
  };

  const handleCancelQueue = () => {
    abortRef.current?.abort();
    setCancelled(true);
    setProcessing(false);
  };

  const syncItemToProduct = (next: BulkFrameItem, rebuildImages = false) => {
    void saveDraftFrame(toPersistedDraft(activeShop.id, next));
    if (!next.savedProductId || !next.frontCatalogPath || !next.imagePath) return;
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
    if (!activeShop.isDemoAdminStore && remainingCredits <= 0) {
      setOutOfCreditsModal('credits');
      return;
    }
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
      toast(`تمت إعادة معالجة "${target.name}" بنجاح — اضغط اعتماد للنشر ✓`);
    } else {
      toast('تعذر تحسين الصورة — يمكنك المحاولة مجدداً بصورة أوضح');
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
        `products/${activeShop.id}/side`,
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
    const glbStorageUrl = await uploadAssetToStorage(file, `products/${activeShop.id}`, 'glb');
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
    <div className="rounded-3xl bg-[#F8F9FA] text-[#0F172A] p-4 sm:p-6 mb-5 border border-[#E2E8F0] shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-[#0F172A] text-white flex items-center justify-center shrink-0">
            <I n="upload" s={20} />
          </span>
          <div>
            <h3 className="font-extrabold text-base sm:text-lg text-[#0F172A]">
              استوديو الرفع الذكي — تحويل صور النظارات إلى كتالوج{' '}
              <span dir="ltr" className="inline-block">
                3D
              </span>{' '}
              احترافي في ثوانٍ
            </h3>
            <p className="text-xs text-slate-600">
              استخراج تلقائي لمقاسات الإطار وكود الموديل + عزل استوديو احترافي وصورة جانبية{' '}
              <span dir="ltr" className="inline-block">
                3/4
              </span>{' '}
              جاهزة لمتجرك
            </p>
          </div>
        </div>
        {items.length > 0 && !processing && (
          <div className="flex items-center gap-2">
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
          </div>
        )}
      </div>

      {/* Step 1: 5 Frame Category Modes BEFORE selecting files */}
      <div className="rounded-2xl bg-white border border-[#E2E8F0] p-3.5 space-y-3">
        <div className="text-xs font-extrabold text-[#0284C7]">
          1. اختر وضع الإطارات أولاً (5 أوضاع مخصصة لعزل الخلفية والعدسات):
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {FRAME_MODES.map((m) => {
            const active = selectedMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedMode(m.id)}
                className={
                  'p-3 rounded-xl border text-start transition cursor-pointer flex flex-col gap-1 ' +
                  (active
                    ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-md'
                    : 'bg-[#F8F9FA] text-[#0F172A] border-[#E2E8F0] hover:border-[#0284C7]/50 hover:bg-white')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm font-extrabold">{m.title}</span>
                  {m.badge && (
                    <span
                      className={
                        'text-[0.62rem] font-bold px-2 py-0.5 rounded-md ' +
                        (active ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800')
                      }
                    >
                      {m.badge}
                    </span>
                  )}
                </div>
                <div className={'text-[0.68rem] leading-4 ' + (active ? 'text-white/90' : 'text-slate-600')}>
                  {m.desc}
                </div>
              </button>
            );
          })}
        </div>

        {/* Sub-toggles for Kids & Metal */}
        {selectedMode === 'kids' && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
            <span className="text-xs font-bold text-slate-700">نوع نظارة الأطفال:</span>
            <button
              type="button"
              onClick={() => setSubCategory('optical')}
              className={
                'px-3 py-1 rounded-lg text-xs font-bold border cursor-pointer transition ' +
                (subCategory !== 'sun'
                  ? 'bg-[#0F172A] text-white border-[#0F172A]'
                  : 'bg-white text-slate-700 border-slate-300')
              }
            >
              طبي أطفال
            </button>
            <button
              type="button"
              onClick={() => setSubCategory('sun')}
              className={
                'px-3 py-1 rounded-lg text-xs font-bold border cursor-pointer transition ' +
                (subCategory === 'sun'
                  ? 'bg-[#0F172A] text-white border-[#0F172A]'
                  : 'bg-white text-slate-700 border-slate-300')
              }
            >
              شمس أطفال
            </button>
          </div>
        )}

        {selectedMode === 'metal' && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
            <span className="text-xs font-bold text-slate-700">نوع الشنبر المعدني:</span>
            <button
              type="button"
              onClick={() => setSubCategory('optical')}
              className={
                'px-3 py-1 rounded-lg text-xs font-bold border cursor-pointer transition ' +
                (subCategory !== 'sun'
                  ? 'bg-[#0F172A] text-white border-[#0F172A]'
                  : 'bg-white text-slate-700 border-slate-300')
              }
            >
              معدن طبي
            </button>
            <button
              type="button"
              onClick={() => setSubCategory('sun')}
              className={
                'px-3 py-1 rounded-lg text-xs font-bold border cursor-pointer transition ' +
                (subCategory === 'sun'
                  ? 'bg-[#0F172A] text-white border-[#0F172A]'
                  : 'bg-white text-slate-700 border-slate-300')
              }
            >
              معدن شمس
            </button>
          </div>
        )}

        {/* Speed Mode (Batch vs Turbo), Auto-Color Grouping & Conditional Lens Branding */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!planCaps.turboUploadEnabled}
              onClick={() => planCaps.turboUploadEnabled && setTurboMode((v) => !v)}
              className={
                'px-3 py-1.5 rounded-xl border font-extrabold flex items-center gap-1.5 transition ' +
                (!planCaps.turboUploadEnabled
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                  : turboMode
                  ? 'bg-[#D97706] text-white border-[#D97706] cursor-pointer shadow-xs'
                  : 'bg-white text-[#0F172A] border-slate-300 cursor-pointer hover:bg-slate-50')
              }
            >
              <I n="spark" s={13} />
              <span>رفع فوري تيربو ⚡</span>
              {!planCaps.turboUploadEnabled && (
                <span className="text-[0.62rem] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">
                  ترقية للاحترافية
                </span>
              )}
            </button>

            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] cursor-pointer font-bold text-[#0F172A]">
              <input
                type="checkbox"
                checked={autoGroupColors}
                onChange={(e) => setAutoGroupColors(e.target.checked)}
                className="accent-[#0284C7]"
              />
              <span>تجميع الألوان التلقائي (توفير AI)</span>
            </label>

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
            حتى <span dir="ltr">{MAX_BATCH_SIZE}</span> صورة في الدفعة الواحدة — متاح في باقتك حتى{' '}
            <span dir="ltr">{maxProducts}</span> نظارة (المضاف:{' '}
            <span dir="ltr">{activeShopProductsCount}</span>)
          </span>
        </div>
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

      {/* Multi-File Dropzone */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) void handleFilesSelected(e.dataTransfer.files);
        }}
        className={
          'block rounded-2xl border-2 border-dashed p-5 text-center transition cursor-pointer ' +
          (dragOver
            ? 'border-[#0284C7] bg-sky-50'
            : 'border-slate-300 bg-white hover:border-[#0284C7] hover:bg-slate-50')
        }
      >
        <input
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="flex flex-col items-center gap-1.5">
          {processing ? (
            <div className="w-7 h-7 rounded-full border-2 border-[#0284C7] border-t-transparent animate-spin" />
          ) : (
            <I n="upload" s={26} c="text-[#0284C7]" />
          )}
          <div className="font-bold text-sm text-[#0F172A]">
            {selectedMode === 'clip_on'
              ? 'اسحب أو اختر أزواج الصور بالترتيب: صورة بدون الغيار تليها صورة بالغيار (عدد زوجي)'
              : `اسحب وأفلت صور النظارات هنا أو اضغط لاختيار حتى ${MAX_BATCH_SIZE} صورة في الدفعة`}
          </div>
          <div className="text-xs text-slate-500">
            تُحفظ المسودات تلقائياً في المتصفح — لا تُنشر أي نظارة للعملاء قبل الضغط على «اعتماد»
          </div>
        </div>
      </label>

      {/* Queue Progress Bar + Cancel Control */}
      {(processing || progress.total > 0) && (
        <div className="rounded-xl bg-white border border-[#E2E8F0] p-3 space-y-2">
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
                          {it.stageLabel || 'جاري التحسين'}
                        </span>
                      ) : isError ? (
                        <span className="text-[0.68rem] px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-bold">
                          تعذرت المعالجة
                        </span>
                      ) : it.approved ? (
                        <span className="text-[0.68rem] px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                          معتمدة ومنشورة ✓
                        </span>
                      ) : (
                        <span className="text-[0.68rem] px-2 py-0.5 rounded-lg bg-[#0F172A] text-white font-semibold">
                          {it.cacheHit ? 'من الكتالوج المشترك ⚡' : it.autoColorSibling ? 'لون مضاف محلياً 🎨' : 'بانتظار الاعتماد'}
                        </span>
                      )}
                      <span className="text-[0.66rem] px-2 py-0.5 rounded-lg bg-[#F8F9FA] border border-[#E2E8F0] text-slate-700 font-bold">
                        {FRAME_MODES.find((m) => m.id === it.frameType)?.title || 'نظارة'}
                      </span>
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

                  {/* 3 Studio Outputs: Front Studio Catalog, 3/4 Side Catalog, & Transparent Try-On */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="relative h-28 rounded-xl border border-[#E2E8F0] bg-[#F8F9FA] flex items-center justify-center overflow-hidden p-1.5">
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

                    <div className="relative h-28 rounded-xl border border-[#E2E8F0] bg-[#F8F9FA] flex items-center justify-center overflow-hidden p-1.5">
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

                    <div
                      className="relative h-28 rounded-xl border border-[#E2E8F0] flex items-center justify-center overflow-hidden p-1.5"
                      style={{
                        backgroundImage:
                          'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
                        backgroundSize: '14px 14px',
                        backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0',
                        backgroundColor: '#f8fafc',
                      }}
                    >
                      <span className="absolute top-1 start-1 z-10 px-1.5 py-0.5 rounded bg-[#0284C7] text-white text-[0.54rem] font-bold">
                        مفرّغة للتجربة
                      </span>
                      {isEnhancing ? (
                        <div className="w-5 h-5 rounded-full border-2 border-[#0284C7] border-t-transparent animate-spin" />
                      ) : activeTryOnPreview ? (
                        <img
                          src={activeTryOnPreview}
                          alt={`مفرغة ${it.name}`}
                          loading="lazy"
                          decoding="async"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-[0.6rem] text-slate-400">جاري التجهيز</span>
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
    </div>
  );
}
