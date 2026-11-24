import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOptiVerse } from '../services/optiverseStore';
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
import { processCutoutInWorker } from '../utils/cutoutWorkerClient';
import { generateSplitSheetViaServer } from '../utils/splitSheetApi';
import { CutoutWorkerOutput } from '../workers/cutoutWorker';
import { deleteDraftFrame, loadDraftFrames, PersistedDraftFrame, saveDraftFrame } from '../utils/draftStorage';
import { Eyewear3DViewer } from './Eyewear3DARStage';
import { FrameFitPreview, PhotoUploadGuidelines } from './FrameFitPreviewCard';
import { I } from './Icons';
import { Modal } from './UiShared';

type CardProcessStatus = 'enhancing' | 'ready' | 'error';

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
  name: string;
  code: string;
  price: number;
  frameType: EyewearFrameMode;
  subCategory: EyewearSubMode;
  frameWidthMm: number;
  opticalDimensions: string;
  fitScale: number;
  eyeLineOffset: number;
  cat: FrameCat;
  material: FrameMaterial;
  type: FrameType;
  aspectRatio: number;
  frameHexColor: string;
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

function buildProductPayloadFromItem(
  shopId: string,
  it: BulkFrameItem
): { prod: Omit<Product, 'id'>; images: ProductImage[] } {
  const cat = resolveCatFromMode(it.frameType, it.subCategory);
  const storeFront = it.frontCatalogPath || it.imagePath || '';
  const tryOnFront = it.imagePath || storeFront;

  const prod: Omit<Product, 'id'> = {
    shopId,
    code: it.code,
    name: it.name,
    description: `إطار ${it.material === 'metal' ? 'معدن' : 'بلاستيك TR'} · عرض ${it.frameWidthMm}mm · ${it.opticalDimensions}`,
    type: it.type,
    cat,
    frameType: it.frameType,
    subCategory: it.subCategory,
    price: Math.max(0, Math.round(it.price || 0)),
    frame: it.frameHexColor || '#1f2937',
    lens: cat === 'sun' ? '#334155' : '#dbeafe',
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
    additionalImages: it.sideImagePath ? [it.sideImagePath] : undefined,
    glbUrl: it.glbStorageUrl,
    model3dUrl: it.glbStorageUrl,
    frameColors: [it.frameHexColor || '#1f2937'],
    availableColors: [it.frameHexColor || '#1f2937'],
    availableSizes: sizeListFromWidth(it.frameWidthMm),
    shapes: ['oval', 'round', 'square'],
    // Approval gate: never publish until merchant explicitly clicks اعتماد
    isPublished: Boolean(it.isPublished),
    modelCalibration: {
      ...(it.calibration || {}),
      frameWidthMm: it.frameWidthMm,
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
    price: it.price,
    frameType: it.frameType,
    subCategory: it.subCategory,
    cat: it.cat,
    material: it.material,
    type: it.type,
    frameWidthMm: it.frameWidthMm,
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
    status: d.status === 'enhancing' && !d.imagePath ? 'error' : d.status,
    stageLabel: d.imagePath ? 'جاهزة للاعتماد' : d.stageLabel,
    errorMsg: d.errorMsg,
    approved: d.approved,
    isPublished: d.isPublished,
    name: d.name,
    code: d.code,
    price: d.price,
    frameType: d.frameType,
    subCategory: d.subCategory,
    frameWidthMm: d.frameWidthMm,
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

export function BulkFrameUploader({ onSaved }: { onSaved?: () => void }) {
  const {
    activeShop,
    addProduct,
    updateProduct,
    updateProductsBatch,
    softDeleteProductById,
    uploadAssetToStorage,
    toast,
  } = useOptiVerse();

  // Step 1: 5 Frame Category Modes (BEFORE selecting photos)
  const [selectedMode, setSelectedMode] = useState<EyewearFrameMode>('prescription');
  const [subCategory, setSubCategory] = useState<EyewearSubMode>('optical');
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

  // Hydrate unresolved drafts from IndexedDB when shop changes
  useEffect(() => {
    let active = true;
    loadDraftFrames(activeShop.id).then((drafts) => {
      if (!active || !drafts.length) return;
      const hydrated = drafts.filter((d) => !d.approved).map(fromPersistedDraft);
      if (hydrated.length > 0) {
        setItems((prev) => {
          const existingIds = new Set(prev.map((x) => x.localId));
          const merged = [...prev, ...hydrated.filter((h) => !existingIds.has(h.localId))];
          return merged;
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
      setSubCategory((cur) => cur);
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

  const processSingleCard = async (
    cardSnapshot: BulkFrameItem,
    signal?: AbortSignal
  ): Promise<boolean> => {
    if (signal?.aborted) return false;

    const srcFile = cardSnapshot.sourceFile;
    if (!srcFile) {
      toast('أعد رفع الصورة الأصلية لإعادة المعالجة');
      return false;
    }

    setItems((prev) =>
      prev.map((x) =>
        x.localId === cardSnapshot.localId
          ? { ...x, status: 'enhancing', stageLabel: 'جاري التحسين', errorMsg: undefined, reprocessing: true }
          : x
      )
    );

    try {
      const effectiveSub: EyewearSubMode =
        cardSnapshot.frameType === 'clip_on' ? 'optical' : cardSnapshot.subCategory;

      setItems((prev) =>
        prev.map((x) =>
          x.localId === cardSnapshot.localId
            ? { ...x, stageLabel: 'جاري توليد لوحة الاستوديو المزدوجة (16:9)...' }
            : x
        )
      );

      // Single Gemini call produces BOTH the orthographic Chroma-Key front (left 50%)
      // AND the 3/4 angled studio catalog shot (right 50%) in one 16:9 image.
      const baseSplitSheet = await generateSplitSheetViaServer(
        srcFile,
        {
          frameType: cardSnapshot.frameType,
          subCategory: effectiveSub,
          isClipOnAttachment: false,
        },
        signal
      );

      if (signal?.aborted) return false;

      const baseRes = await processCutoutInWorker(
        srcFile,
        cardSnapshot.sideSourceFile,
        {
          frameType: cardSnapshot.frameType,
          subCategory: effectiveSub,
          material: cardSnapshot.material,
          frameWidthMm: cardSnapshot.frameWidthMm,
          opticalDimensions: cardSnapshot.opticalDimensions,
          fitScale: cardSnapshot.fitScale,
          eyeLineOffset: cardSnapshot.eyeLineOffset,
        },
        (stageLabel) => {
          if (signal?.aborted) return;
          setItems((prev) =>
            prev.map((x) => (x.localId === cardSnapshot.localId ? { ...x, stageLabel } : x))
          );
        },
        baseSplitSheet
      );

      if (signal?.aborted) return false;
      const baseUrls = await uploadCutoutResult(baseRes, activeShop.id);
      if (signal?.aborted) return false;

      let clipOnUrls: {
        clipOnImagePath?: string;
        clipOnFrontCatalogPath?: string;
        clipOnSideImagePath?: string;
      } = {};

      if (cardSnapshot.frameType === 'clip_on' && cardSnapshot.clipOnSourceFile) {
        setItems((prev) =>
          prev.map((x) =>
            x.localId === cardSnapshot.localId
              ? { ...x, stageLabel: 'جاري توليد لوحة غيار الشمس المزدوجة (16:9)...' }
              : x
          )
        );
        const clipSplitSheet = await generateSplitSheetViaServer(
          cardSnapshot.clipOnSourceFile,
          {
            frameType: 'clip_on',
            subCategory: 'sun',
            isClipOnAttachment: true,
          },
          signal
        );
        if (signal?.aborted) return false;

        const clipRes = await processCutoutInWorker(
          cardSnapshot.clipOnSourceFile,
          undefined,
          {
            frameType: 'clip_on',
            subCategory: 'sun',
            isClipOnAttachment: true,
            material: cardSnapshot.material,
            frameWidthMm: cardSnapshot.frameWidthMm,
            opticalDimensions: cardSnapshot.opticalDimensions,
            fitScale: cardSnapshot.fitScale,
            eyeLineOffset: cardSnapshot.eyeLineOffset,
          },
          undefined,
          clipSplitSheet
        );
        if (signal?.aborted) return false;
        const uploadedClip = await uploadCutoutResult(clipRes, activeShop.id);
        clipOnUrls = {
          clipOnImagePath: uploadedClip.imagePath,
          clipOnFrontCatalogPath: uploadedClip.frontCatalogPath,
          clipOnSideImagePath: uploadedClip.sideImagePath,
        };
      }

      if (signal?.aborted) return false;

      const updatedCard: BulkFrameItem = {
        ...cardSnapshot,
        cat: resolveCatFromMode(cardSnapshot.frameType, cardSnapshot.subCategory),
        material: cardSnapshot.frameType === 'metal' ? 'metal' : baseRes.detectedMaterial,
        type: cardSnapshot.type || baseRes.detectedType,
        aspectRatio: baseRes.aspectRatio,
        frameHexColor: baseRes.frameHexColor,
        frameOpacity: baseRes.frameOpacity,
        calibration: baseRes.calibration,
        imagePath: baseUrls.imagePath,
        frontCatalogPath: baseUrls.frontCatalogPath,
        sideImagePath: baseUrls.sideImagePath,
        maskUrl: baseUrls.maskUrl,
        ...clipOnUrls,
        quality: baseRes.quality,
        qualityNoteAr: baseRes.qualityNoteAr,
        status: 'ready',
        stageLabel: baseRes.quality === 'check' ? 'يُرجى المراجعة' : 'جاهزة للاعتماد',
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
      return true;
    } catch (err) {
      if (signal?.aborted) return false;
      const msg = err instanceof Error ? err.message : 'تعذر تحسين الصورة';
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
      return false;
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

    // Clip-On strict even pairing check
    if (selectedMode === 'clip_on' && files.length % 2 !== 0) {
      const msg = 'تنبيه: كل نظارة بغيار شمس تتطلب صورتين (بدون الغيار + بالغيار).';
      setValidationAlert(msg);
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
      stageLabel: 'جاري التحسين',
      approved: false,
      isPublished: false,
      name: cleanNameFromFile(front.name, idx),
      code: `FR-${seedNum + idx}`,
      price: defaultPrice,
      frameType: chosenMode,
      subCategory: chosenSub,
      frameWidthMm: chosenMode === 'kids' ? 122 : bulkWidthMm,
      opticalDimensions: bulkOpticalDim,
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

    let doneCount = 0;
    let successCount = 0;
    for (let i = 0; i < newCards.length; i++) {
      if (ctrl.signal.aborted) break;
      const ok = await processSingleCard(newCards[i], ctrl.signal);
      doneCount++;
      if (ok) successCount++;
      setProgress({ done: doneCount, total: newCards.length });
      if (ctrl.signal.aborted) break;
      await new Promise((r) => setTimeout(r, 20));
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
    <div className="rounded-3xl bg-[#F8F9FA] text-slate-900 p-4 sm:p-6 mb-5 border border-slate-200 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-[#0F766E] text-white flex items-center justify-center shrink-0">
            <I n="upload" s={20} />
          </span>
          <div>
            <h3 className="font-extrabold text-base sm:text-lg text-slate-900">
              استوديو الرفع الجماعي الذكي للنظارات (لوحة مزدوجة 16:9 بمكالمة واحدة)
            </h3>
            <p className="text-xs text-slate-600">
              ارفع 10 أو مئات الصور دفعة واحدة — توليد وتقسيم تلقائي لصورة التجربة المفرّغة ولقطة الكتالوج الأمامية والجانبية 3/4 على خلفية #F8F9FA
            </p>
          </div>
        </div>
        {items.length > 0 && !processing && (
          <div className="flex items-center gap-2">
            {readyUnapprovedCount > 0 && (
              <button
                type="button"
                className="btn btn-p btn-sm !bg-[#0F766E] !text-white"
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
      <div className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-3">
        <div className="text-xs font-extrabold text-[#0F766E]">
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
                    ? 'bg-[#0F766E] text-white border-[#0F766E] shadow-md'
                    : 'bg-[#F8F9FA] text-slate-900 border-slate-200 hover:border-[#0F766E]/50 hover:bg-white')
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
                  ? 'bg-slate-900 text-white border-slate-900'
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
                  ? 'bg-slate-900 text-white border-slate-900'
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
                  ? 'bg-slate-900 text-white border-slate-900'
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
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300')
              }
            >
              معدن شمس
            </button>
          </div>
        )}
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
      <div className="rounded-xl bg-teal-50/70 border border-teal-200 text-slate-800 p-1">
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
            ? 'border-[#0F766E] bg-teal-50'
            : 'border-slate-300 bg-white hover:border-[#0F766E] hover:bg-slate-50')
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
            <div className="w-7 h-7 rounded-full border-2 border-[#0F766E] border-t-transparent animate-spin" />
          ) : (
            <I n="upload" s={26} c="text-[#0F766E]" />
          )}
          <div className="font-bold text-sm text-slate-900">
            {selectedMode === 'clip_on'
              ? 'اسحب أو اختر أزواج الصور بالترتيب: صورة بدون الغيار تليها صورة بالغيار (عدد زوجي)'
              : 'اسحب وأفلت صور النظارات هنا أو اضغط لاختيار عدة صور معاً'}
          </div>
          <div className="text-xs text-slate-500">
            تُحفظ المسودات تلقائياً في المتصفح — لا تُنشر أي نظارة للعملاء قبل الضغط على «اعتماد»
          </div>
        </div>
      </label>

      {/* Queue Progress Bar + Cancel Control */}
      {(processing || progress.total > 0) && (
        <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-800">
            <span className="flex items-center gap-2">
              {processing && (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-[#0F766E] border-t-transparent animate-spin inline-block shrink-0" />
              )}
              {processing
                ? `جاري التحسين — تم تجهيز ${progress.done} من ${progress.total} نظارة...`
                : cancelled
                ? `تم إيقاف المعالجة — تم تجهيز ${progress.done} من ${progress.total} نظارة`
                : `تم تجهيز ${progress.done} من ${progress.total} نظارة للمراجعة والاعتماد ✓`}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[#0F766E] tabular-nums">{pct}%</span>
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
            <div className="h-full bg-[#0F766E] rounded-full transition-all duration-150" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Review Grid + Bulk Actions Bar */}
      {items.length > 0 && (
        <>
          <div className="rounded-2xl bg-white border border-slate-200 p-3 flex flex-wrap items-end gap-3">
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
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold cursor-pointer hover:bg-slate-800"
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
                          ? 'bg-[#0F766E] text-white border-[#0F766E]'
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
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold cursor-pointer hover:bg-slate-800"
                onClick={applySizeToAll}
              >
                تطبيق المقاس على الكل
              </button>
            </div>

            {readyUnapprovedCount > 0 && (
              <div className="ms-auto">
                <button
                  type="button"
                  className="btn btn-p !bg-[#0F766E] !text-white"
                  onClick={() => void handleApproveAllReady()}
                >
                  <I n="check" s={16} /> اعتماد ونشر الكل ({readyUnapprovedCount})
                </button>
              </div>
            )}
          </div>

          {/* Cards Grid */}
          <div className="grid sm:grid-cols-2 gap-4">
            {visibleItems.map((it) => {
              const isEnhancing = it.status === 'enhancing';
              const isError = it.status === 'error';
              const isReady = it.status === 'ready' && Boolean(it.frontCatalogPath && it.imagePath);
              const needsCheck = it.quality === 'check';
              const showingClipOn = Boolean(it.frameType === 'clip_on' && it.previewClipOn && it.clipOnImagePath);
              const activeTryOnPreview = showingClipOn ? it.clipOnImagePath : it.imagePath;
              const activeFrontPreview = showingClipOn && it.clipOnFrontCatalogPath ? it.clipOnFrontCatalogPath : it.frontCatalogPath;
              const activeSidePreview = showingClipOn && it.clipOnSideImagePath ? it.clipOnSideImagePath : it.sideImagePath;

              return (
                <div
                  key={it.localId}
                  className={
                    'rounded-2xl p-3.5 flex flex-col gap-3 border transition bg-white ' +
                    (it.approved
                      ? 'border-emerald-400 ring-1 ring-emerald-300'
                      : needsCheck
                      ? 'border-amber-400'
                      : 'border-slate-200 shadow-sm')
                  }
                >
                  {/* Top status & action bar */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isEnhancing ? (
                        <span className="text-[0.68rem] px-2 py-0.5 rounded-lg bg-teal-50 text-[#0F766E] border border-teal-200 font-bold flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-full border-2 border-[#0F766E] border-t-transparent animate-spin inline-block" />
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
                        <span className="text-[0.68rem] px-2 py-0.5 rounded-lg bg-slate-900 text-white font-semibold">
                          بانتظار الاعتماد
                        </span>
                      )}
                      <span className="text-[0.66rem] px-2 py-0.5 rounded-lg bg-[#F8F9FA] border border-slate-200 text-slate-700 font-bold">
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
                            className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center hover:bg-slate-800 cursor-pointer"
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
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F8F9FA] border border-slate-200">
                      <button
                        type="button"
                        onClick={() => updateCard(it.localId, { previewClipOn: false })}
                        className={
                          'py-1 rounded-lg text-[0.7rem] font-bold cursor-pointer ' +
                          (!it.previewClipOn ? 'bg-slate-900 text-white' : 'text-slate-700')
                        }
                      >
                        الوضع الطبي 👓
                      </button>
                      <button
                        type="button"
                        onClick={() => updateCard(it.localId, { previewClipOn: true })}
                        className={
                          'py-1 rounded-lg text-[0.7rem] font-bold cursor-pointer ' +
                          (it.previewClipOn ? 'bg-[#0F766E] text-white' : 'text-slate-700')
                        }
                      >
                        بغيار الشمس 🕶️
                      </button>
                    </div>
                  )}

                  {/* 3 Review Previews: Front Studio Catalog, 3/4 Side Catalog, & Transparent Try-On */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="relative h-28 rounded-xl border border-slate-200 bg-[#F8F9FA] flex items-center justify-center overflow-hidden p-1.5">
                      <span className="absolute top-1 start-1 z-10 px-1.5 py-0.5 rounded bg-slate-900/85 text-white text-[0.54rem] font-bold">
                        أمامي كتالوج
                      </span>
                      {isEnhancing ? (
                        <div className="w-5 h-5 rounded-full border-2 border-[#0F766E] border-t-transparent animate-spin" />
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

                    <div className="relative h-28 rounded-xl border border-slate-200 bg-[#F8F9FA] flex items-center justify-center overflow-hidden p-1.5">
                      <span className="absolute top-1 start-1 z-10 px-1.5 py-0.5 rounded bg-slate-900/85 text-white text-[0.54rem] font-bold">
                        جانبي 3/4
                      </span>
                      {isEnhancing || it.sideBusy ? (
                        <div className="w-5 h-5 rounded-full border-2 border-[#0F766E] border-t-transparent animate-spin" />
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
                      className="relative h-28 rounded-xl border border-slate-200 flex items-center justify-center overflow-hidden p-1.5"
                      style={{
                        backgroundImage:
                          'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
                        backgroundSize: '14px 14px',
                        backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0',
                        backgroundColor: '#f8fafc',
                      }}
                    >
                      <span className="absolute top-1 start-1 z-10 px-1.5 py-0.5 rounded bg-[#0F766E] text-white text-[0.54rem] font-bold">
                        مفرّغة للتجربة
                      </span>
                      {isEnhancing ? (
                        <div className="w-5 h-5 rounded-full border-2 border-[#0F766E] border-t-transparent animate-spin" />
                      ) : activeTryOnPreview ? (
                        <img
                          src={activeTryOnPreview}
                          alt={`مفرغة ${it.name}`}
                          loading="lazy"
                          decoding="async"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <img
                          src={it.originalThumbUrl}
                          alt={it.name}
                          loading="lazy"
                          decoding="async"
                          className="max-h-full max-w-full object-contain opacity-45"
                        />
                      )}
                    </div>
                  </div>

                  {/* Quality Warning */}
                  {isReady && needsCheck && (
                    <div className="rounded-xl bg-amber-50 border border-amber-300 px-2.5 py-1.5 text-[0.7rem] text-amber-800 font-semibold">
                      تنبيه مراجعة: {it.qualityNoteAr || 'يُنصح بمراجعة حواف الإطار قبل الاعتماد'}
                    </div>
                  )}

                  {/* Quick Name & Price + Code */}
                  <div className="grid grid-cols-12 gap-1.5">
                    <input
                      className="col-span-6 rounded-lg border border-slate-300 bg-[#F8F9FA] text-slate-900 px-2.5 py-1.5 text-xs font-bold"
                      value={it.name}
                      onChange={(e) => updateCard(it.localId, { name: e.target.value })}
                      placeholder="اسم الشنبر"
                    />
                    <input
                      type="number"
                      min="0"
                      dir="ltr"
                      className="col-span-3 rounded-lg border border-slate-300 bg-[#F8F9FA] text-slate-900 px-2 py-1.5 text-xs font-bold tabular-nums"
                      value={it.price}
                      onChange={(e) => updateCard(it.localId, { price: Math.max(0, Number(e.target.value) || 0) })}
                      placeholder="السعر"
                    />
                    <input
                      className="col-span-3 rounded-lg border border-slate-300 bg-[#F8F9FA] text-slate-700 px-2 py-1.5 text-[0.7rem] font-mono"
                      dir="ltr"
                      value={it.code}
                      onChange={(e) => updateCard(it.localId, { code: e.target.value.toUpperCase() })}
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
                            : 'bg-[#0F766E] hover:bg-[#0d655e] text-white cursor-pointer disabled:opacity-45')
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
                        <div className="flex items-center justify-between bg-[#F8F9FA] border border-slate-200 rounded-lg px-2 py-1">
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
                          className="bg-[#F8F9FA] border border-slate-200 rounded-lg px-2 py-1 font-mono text-slate-900"
                          value={it.opticalDimensions}
                          onChange={(e) => updateCard(it.localId, { opticalDimensions: e.target.value })}
                          placeholder="52-18-140"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => updateCard(it.localId, { showFacePreview: !it.showFacePreview })}
                        className="w-full py-1.5 px-2.5 rounded-lg bg-[#F8F9FA] hover:bg-slate-100 border border-slate-200 text-slate-800 text-[0.68rem] font-bold flex items-center justify-between cursor-pointer"
                      >
                        <span>معاينة وملاءمة التثبيت على الوجه</span>
                        <span className="text-[#0F766E]">{it.showFacePreview ? 'إخفاء' : 'عرض'}</span>
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
                عرض {visibleItems.length} من {items.length} نظارة
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
          <div className="flex justify-between items-center mt-3 text-xs opacity-75">
            <span>الأبعاد: {inspectItem.opticalDimensions}</span>
            <span>السعر: {inspectItem.price} ج.م</span>
          </div>
        </Modal>
      )}
    </div>
  );
}
