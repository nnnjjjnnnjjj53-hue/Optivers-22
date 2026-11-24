import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CATS, FRAME_COLORS, SHAPES, TYPES } from '../data/seed';
import { GlassesPhotoAngle, ProcessedGlassesPhoto, processMerchantGlassesPhoto } from '../ai';
import { useOptiVerse } from '../services/optiverseStore';
import { FaceShape, FrameCat, FrameSize, FrameType, Product, ProductImage } from '../types';
import { EditedGlassesAsset, ExtractionPreset, applyManualMaskEdit } from '../utils/visionPipeline';
import { FrameFitPreview, PhotoUploadGuidelines } from './FrameFitPreviewCard';
import { MiniGlasses } from './GlassesGraphics';
import { I } from './Icons';

const PRESET_OPTIONS: { id: ExtractionPreset; label: string; hint: string }[] = [
  { id: 'auto', label: 'تلقائي', hint: 'متوازن لمعظم النظارات' },
  { id: 'thin_metal', label: 'إطار معدني رفيع', hint: 'يحفظ الأسلاك الرفيعة والجسر' },
  { id: 'transparent', label: 'إطار شفاف', hint: 'يحافظ على البلاستيك الشفاف' },
  { id: 'sunglasses', label: 'نظارة شمسية', hint: 'يحفظ لون وتظليل العدسة' },
];

const ALL_SIZES: FrameSize[] = ['Small', 'Medium', 'Large'];

interface GalleryDraft {
  id: string;
  label: string;
  imageUrl: string;
  blob?: Blob;
  ext?: string;
}

function LensMaskEditor({
  asset,
  onSave,
  onCancel,
}: {
  asset: EditedGlassesAsset;
  onSave: (updated: EditedGlassesAsset) => void;
  onCancel: () => void;
}) {
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<'paint' | 'erase'>('paint');
  const [brushSize, setBrushSize] = useState(18);
  const [saving, setSaving] = useState(false);
  const drawingRef = useRef(false);
  const baseImgRef = useRef<HTMLImageElement | null>(null);

  const redraw = useCallback(() => {
    const dc = displayCanvasRef.current;
    const mc = maskCanvasRef.current;
    const baseImg = baseImgRef.current;
    if (!dc || !mc || !baseImg) return;
    const ctx = dc.getContext('2d')!;
    ctx.clearRect(0, 0, dc.width, dc.height);
    ctx.drawImage(baseImg, 0, 0, dc.width, dc.height);

    const temp = document.createElement('canvas');
    temp.width = dc.width;
    temp.height = dc.height;
    const tCtx = temp.getContext('2d')!;
    tCtx.drawImage(mc, 0, 0, dc.width, dc.height);
    tCtx.globalCompositeOperation = 'source-in';
    tCtx.fillStyle = 'rgba(20, 184, 166, 0.55)';
    tCtx.fillRect(0, 0, dc.width, dc.height);
    ctx.drawImage(temp, 0, 0);
  }, []);

  useEffect(() => {
    let alive = true;
    const cutImg = new Image();
    cutImg.crossOrigin = 'anonymous';
    const maskImg = new Image();
    maskImg.crossOrigin = 'anonymous';

    Promise.all([
      new Promise<void>((res) => {
        cutImg.onload = () => res();
        cutImg.onerror = () => res();
        cutImg.src = asset.imageDataUrl;
      }),
      new Promise<void>((res) => {
        maskImg.onload = () => res();
        maskImg.onerror = () => res();
        maskImg.src = asset.maskDataUrl;
      }),
    ]).then(() => {
      if (!alive) return;
      baseImgRef.current = cutImg;
      const w = asset.width || cutImg.naturalWidth || 520;
      const h = asset.height || cutImg.naturalHeight || 240;

      const mc = document.createElement('canvas');
      mc.width = w;
      mc.height = h;
      if (maskImg.naturalWidth > 0) {
        mc.getContext('2d')!.drawImage(maskImg, 0, 0, w, h);
      }
      maskCanvasRef.current = mc;

      if (displayCanvasRef.current) {
        displayCanvasRef.current.width = w;
        displayCanvasRef.current.height = h;
      }
      redraw();
    });

    return () => {
      alive = false;
    };
  }, [asset, redraw]);

  const paintAt = (clientX: number, clientY: number) => {
    const dc = displayCanvasRef.current;
    const mc = maskCanvasRef.current;
    if (!dc || !mc) return;
    const rect = dc.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * mc.width;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * mc.height;
    const mCtx = mc.getContext('2d')!;
    mCtx.save();
    mCtx.globalCompositeOperation = tool === 'paint' ? 'source-over' : 'destination-out';
    mCtx.fillStyle = '#ffffff';
    mCtx.beginPath();
    mCtx.arc(x, y, brushSize * (mc.width / Math.max(220, rect.width)), 0, Math.PI * 2);
    mCtx.fill();
    mCtx.restore();
    redraw();
  };

  const handleApply = async () => {
    if (!maskCanvasRef.current) return;
    setSaving(true);
    try {
      const updated = await applyManualMaskEdit(
        asset.imageDataUrl,
        maskCanvasRef.current,
        asset.originalDataUrl
      );
      onSave(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 p-3 rounded-2xl bg-white/5 border border-teal-400/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold tx-acc">تعديل منطقة العدسات يدوياً (اختياري)</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTool('paint')}
            className={'chip !py-1 !px-2.5 !text-xs ' + (tool === 'paint' ? 'on' : '')}
          >
            تحديد عدسة
          </button>
          <button
            type="button"
            onClick={() => setTool('erase')}
            className={'chip !py-1 !px-2.5 !text-xs ' + (tool === 'erase' ? 'on' : '')}
          >
            مسح
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-[#F6F5F3] p-3 flex items-center justify-center overflow-hidden">
        <canvas
          ref={displayCanvasRef}
          className="max-w-full max-h-48 touch-none cursor-crosshair"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawingRef.current = true;
            paintAt(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (!drawingRef.current) return;
            paintAt(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            drawingRef.current = false;
          }}
        />
      </div>

      <div className="flex items-center gap-3 text-xs">
        <span className="opacity-70">حجم الفرشاة</span>
        <input
          type="range"
          min={8}
          max={42}
          value={brushSize}
          onChange={(e) => setBrushSize(+e.target.value)}
          className="flex-1"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-g btn-sm" onClick={onCancel} disabled={saving}>
          إلغاء
        </button>
        <button type="button" className="btn btn-p btn-sm" onClick={() => void handleApply()} disabled={saving}>
          {saving ? 'جاري التحديث...' : 'تطبيق القناع'}
        </button>
      </div>
    </div>
  );
}

type WizardStage = 'photo' | 'wait' | 'details';

export function GuidedCaptureWizard({
  onClose,
  product,
}: {
  onClose: () => void;
  product?: Product;
}) {
  const { activeShop, products, addProduct, updateProduct, uploadAssetToStorage, toast } = useOptiVerse();
  const isEdit = Boolean(product);
  const shopProductCount = products.filter((p) => p.shopId === activeShop.id).length;

  const existingFront =
    product?.images?.find((im) => im.kind !== 'gallery' && Math.abs(im.angleYaw) <= 20) ||
    product?.images?.[0];
  const existingAngled = product?.images?.find(
    (im) => im.id !== existingFront?.id && Math.abs(im.angleYaw) > 20 && Math.abs(im.angleYaw) <= 75
  );
  const existingGallery: GalleryDraft[] = (product?.images || [])
    .filter((im) => im.id !== existingFront?.id && im.id !== existingAngled?.id)
    .map((im) => ({
      id: im.id,
      label: im.label || 'صورة إضافية',
      imageUrl: im.imageUrl,
    }));

  const [stage, setStage] = useState<WizardStage>(isEdit ? 'details' : 'photo');
  const [frontAsset, setFrontAsset] = useState<ProcessedGlassesPhoto | null>(null);
  const [angledAsset, setAngledAsset] = useState<ProcessedGlassesPhoto | null>(null);
  const [useUntouchedFrontAngle, setUseUntouchedFrontAngle] = useState(false);

  const [preset, setPreset] = useState<ExtractionPreset>(product?.cat === 'sun' ? 'sunglasses' : 'auto');
  const [editingMask, setEditingMask] = useState(false);
  const [cameraSlot, setCameraSlot] = useState<GlassesPhotoAngle | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [waitLabel, setWaitLabel] = useState('جاري عزل الخلفية وتجهيز النظارة...');
  const [waitError, setWaitError] = useState<string | null>(null);

  // Explicit merchant review & approval of processed images before publishing
  const [merchantApproved, setMerchantApproved] = useState<boolean>(isEdit);

  const [gallery, setGallery] = useState<GalleryDraft[]>(existingGallery);

  const [name, setName] = useState(product?.name || `نظارة ${1001 + shopProductCount}`);
  const [code, setCode] = useState(product?.code || `FR-${1001 + shopProductCount}`);
  const [description, setDescription] = useState(product?.description || '');
  const [frameType, setFrameType] = useState<FrameType>(product?.type || 'wayfarer');
  const [cat, setCat] = useState<FrameCat>(product?.cat || 'med');
  const [price, setPrice] = useState(String(product?.price ?? 850));
  const [disc, setDisc] = useState(String(product?.disc ?? 0));
  const [frameColor, setFrameColor] = useState(product?.frame || '#C9A24B');
  const [availableColors, setAvailableColors] = useState<string[]>(
    product?.availableColors?.length ? product.availableColors : [product?.frame || '#C9A24B']
  );
  const [availableSizes, setAvailableSizes] = useState<FrameSize[]>(
    product?.availableSizes?.length ? product.availableSizes : ['Small', 'Medium', 'Large']
  );
  const [shapes, setShapes] = useState<FaceShape[]>(
    product?.shapes?.length ? product.shapes : ['oval', 'round', 'square']
  );
  const [isPublished, setIsPublished] = useState<boolean>(product ? product.isPublished !== false : false);
  const [fitScale, setFitScale] = useState<number>(product?.modelCalibration?.fitScale ?? 1.0);
  const [eyeLineOffset, setEyeLineOffset] = useState<number>(product?.modelCalibration?.eyeLineOffset ?? 0.04);
  const [glbFile, setGlbFile] = useState<File | null>(null);
  const [existingGlbUrl, setExistingGlbUrl] = useState<string>(product?.glbUrl || product?.model3dUrl || '');
  const [publishing, setPublishing] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frontInputRef = useRef<HTMLInputElement | null>(null);
  const angledInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setCamReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCamError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCamError('الكاميرا غير مدعومة في هذا المتصفح — يمكنك رفع صورة من الجهاز.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCamReady(true);
    } catch {
      setCamError('تعذر تشغيل الكاميرا — يمكنك رفع صورة من الجهاز بسهولة.');
    }
  }, [stopCamera]);

  useEffect(() => {
    if (stage === 'photo' && cameraSlot) {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [stage, cameraSlot, startCamera, stopCamera]);

  const runProcessing = async (
    source: File | Blob | HTMLVideoElement | string,
    angleType: GlassesPhotoAngle,
    chosenPreset: ExtractionPreset = preset,
    chosenCat: FrameCat = cat
  ) => {
    const reqId = ++requestIdRef.current;
    setWaitError(null);
    setWaitLabel(
      angleType === 'front'
        ? 'جاري معالجة الصورة الأمامية وعزل الخلفية بدقة...'
        : 'جاري معالجة الصورة الجانبية وعزل الخلفية بدقة...'
    );
    setStage('wait');

    try {
      const result = await processMerchantGlassesPhoto(source, {
        angleType,
        preset: chosenPreset,
        category: chosenCat,
        autoEnhanceLighting: true,
        autoLevelTilt: angleType === 'front',
        onProgress: (label) => {
          if (requestIdRef.current === reqId) setWaitLabel(label);
        },
      });
      if (requestIdRef.current !== reqId) return;

      if (angleType === 'front') {
        setFrontAsset(result);
        setUseUntouchedFrontAngle(false);
        if (result.sampledFrameColor && !isEdit) {
          setFrameColor(result.sampledFrameColor);
          setAvailableColors((prev) =>
            prev.includes(result.sampledFrameColor) ? prev : [result.sampledFrameColor, ...prev.slice(0, 3)]
          );
        }
      } else {
        setAngledAsset(result);
      }
      setPreset(chosenPreset);
      setCameraSlot(null);
      setMerchantApproved(false);
      setIsPublished(false);
      setStage('photo');
      toast(
        angleType === 'front'
          ? 'تم تجهيز الصورة الأمامية مع الحفاظ على شكل النظارة الأصلي ✓'
          : 'تم تجهيز الصورة الثانية بنجاح ✓'
      );
    } catch {
      if (requestIdRef.current !== reqId) return;
      setWaitError('تعذر معالجة الصورة. تأكد من وضوح النظارة ثم حاول مجدداً أو جرّب نمط عزل آخر.');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, angleType: GlassesPhotoAngle) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await runProcessing(file, angleType, preset);
  };

  const handleGalleryAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 5 - gallery.length);
    e.target.value = '';
    if (!files.length) return;

    const added: GalleryDraft[] = [];
    for (const f of files) {
      const dataUrl = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result || ''));
        r.readAsDataURL(f);
      });
      if (dataUrl) {
        const ext = f.type.includes('png') ? 'png' : f.type.includes('webp') ? 'webp' : 'jpg';
        added.push({
          id: `gal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: 'صورة عرض إضافية',
          imageUrl: dataUrl,
          blob: f,
          ext,
        });
      }
    }
    setGallery((prev) => [...prev, ...added].slice(0, 5));
    toast(`تمت إضافة ${added.length} صورة عرض إضافية ✓`);
  };

  const handleReprocessPreset = async (nextPreset: ExtractionPreset) => {
    setPreset(nextPreset);
    const frontSrc = frontAsset?.originalDataUrl || existingFront?.originalImageUrl || existingFront?.imageUrl;
    const angledSrc = angledAsset?.originalDataUrl || existingAngled?.originalImageUrl || existingAngled?.imageUrl;
    if (frontSrc) {
      await runProcessing(frontSrc, 'front', nextPreset);
    }
    if (angledSrc) {
      await runProcessing(angledSrc, 'angled', nextPreset);
    }
  };

  const toggleColor = (hex: string) => {
    setAvailableColors((prev) => {
      if (prev.includes(hex)) {
        if (prev.length <= 1) return prev;
        const next = prev.filter((c) => c !== hex);
        if (frameColor === hex) setFrameColor(next[0]);
        return next;
      }
      return [...prev, hex];
    });
  };

  const toggleSize = (sz: FrameSize) => {
    setAvailableSizes((prev) =>
      prev.includes(sz) ? (prev.length > 1 ? prev.filter((x) => x !== sz) : prev) : [...prev, sz]
    );
  };

  const activeFrontCutout = frontAsset
    ? useUntouchedFrontAngle
      ? frontAsset.unleveledImageDataUrl
      : frontAsset.imageDataUrl
    : existingFront?.imageUrl;
  const activeFrontOriginal =
    frontAsset?.originalDataUrl || existingFront?.originalImageUrl || existingFront?.imageUrl;

  const activeAngledCutout = angledAsset?.imageDataUrl || existingAngled?.imageUrl;
  const activeAngledOriginal =
    angledAsset?.originalDataUrl || existingAngled?.originalImageUrl || existingAngled?.imageUrl;

  const hasAnyProcessedPhoto = Boolean(activeFrontCutout || activeAngledCutout);

  const handleSaveProduct = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      toast('اكتب اسم النظارة أولاً');
      return;
    }

    if (hasAnyProcessedPhoto && !merchantApproved) {
      toast('يرجى مراجعة الصور المعالجة وتأكيد الموافقة على النتيجة قبل النشر');
      setStage('photo');
      return;
    }

    const finalCode = (code.trim() || `FR-${1001 + shopProductCount}`).toUpperCase();
    const finalPrice = Math.max(50, parseInt(price, 10) || 850);
    const finalDisc = Math.max(0, Math.min(90, parseInt(disc, 10) || 0));
    const finalColors = availableColors.length ? availableColors : [frameColor];
    const primaryColor = finalColors.includes(frameColor) ? frameColor : finalColors[0];

    setPublishing(true);
    try {
      const productFolder = `shops/${activeShop.id}/frames/${finalCode}`;
      let nextImages: ProductImage[] | undefined;

      let savedStoreFrontUrl =
        product?.storeFrontUrl || product?.modelCalibration?.storeFrontUrl || product?.processedImage;
      let savedTryOnFrontUrl =
        product?.tryOnFrontUrl || product?.modelCalibration?.tryOnFrontUrl || existingFront?.imageUrl || product?.processedImage;

      const shouldUpdateImages = Boolean(frontAsset) || Boolean(angledAsset) || isEdit;
      if (shouldUpdateImages) {
        const list: ProductImage[] = [];
        let sortIdx = 0;

        if (frontAsset) {
          const ext = frontAsset.mimeExt || 'png';
          const tryOnBlobToSave =
            frontAsset.tryOnFrontBlob || (useUntouchedFrontAngle ? frontAsset.unleveledImageBlob : frontAsset.imageBlob);
          const storeBlobToSave = frontAsset.storeFrontBlob || tryOnBlobToSave;
          const maskBlobToSave = useUntouchedFrontAngle ? frontAsset.unleveledMaskBlob : frontAsset.maskBlob;
          const [tryOnUrl, storeUrl, origUrl, maskUrl] = await Promise.all([
            uploadAssetToStorage(tryOnBlobToSave, productFolder, ext),
            uploadAssetToStorage(storeBlobToSave, productFolder, `store-${ext}`),
            uploadAssetToStorage(frontAsset.originalBlob, productFolder, `orig-${ext}`),
            uploadAssetToStorage(maskBlobToSave, productFolder, ext),
          ]);
          savedTryOnFrontUrl = tryOnUrl;
          savedStoreFrontUrl = storeUrl;
          list.push({
            id: existingFront?.id || `img-${Date.now()}-front`,
            productId: product?.id || '',
            angleYaw: 0,
            label: 'الصورة الأمامية للتجربة',
            imageUrl: tryOnUrl,
            originalImageUrl: origUrl,
            lensMaskUrl: maskUrl,
            kind: 'front_tryon',
            sortOrder: sortIdx++,
          });
          list.push({
            id: `img-${Date.now()}-store`,
            productId: product?.id || '',
            angleYaw: 0,
            label: 'أمامي للمتجر',
            imageUrl: storeUrl,
            kind: 'gallery',
            sortOrder: sortIdx++,
          });
        } else if (existingFront) {
          list.push({ ...existingFront, sortOrder: sortIdx++ });
        }

        if (angledAsset) {
          const ext = angledAsset.mimeExt || 'png';
          const angledBlob = angledAsset.storeFrontBlob || angledAsset.imageBlob;
          const [cutUrl, origUrl, maskUrl] = await Promise.all([
            uploadAssetToStorage(angledBlob, productFolder, ext),
            uploadAssetToStorage(angledAsset.originalBlob, productFolder, `orig-side-${ext}`),
            uploadAssetToStorage(angledAsset.maskBlob, productFolder, ext),
          ]);
          list.push({
            id: existingAngled?.id || `img-${Date.now()}-angled`,
            productId: product?.id || '',
            angleYaw: 45,
            label: 'جانبي 45°',
            imageUrl: cutUrl,
            originalImageUrl: origUrl,
            lensMaskUrl: maskUrl,
            kind: 'gallery',
            sortOrder: sortIdx++,
          });
        } else if (existingAngled) {
          list.push({ ...existingAngled, sortOrder: sortIdx++ });
        }

        for (const g of gallery) {
          const finalUrl = g.blob
            ? await uploadAssetToStorage(g.blob, productFolder, g.ext || 'jpg')
            : g.imageUrl;
          list.push({
            id: g.id,
            productId: product?.id || '',
            angleYaw: 90,
            label: g.label,
            imageUrl: finalUrl,
            kind: 'gallery',
            sortOrder: sortIdx++,
          });
        }

        nextImages = list;
      }

      const frontUrl =
        savedStoreFrontUrl ||
        nextImages?.find((im) => im.kind === 'gallery' && Math.abs(im.angleYaw) <= 20)?.imageUrl ||
        nextImages?.find((im) => Math.abs(im.angleYaw) <= 20)?.imageUrl ||
        nextImages?.[0]?.imageUrl ||
        existingFront?.imageUrl ||
        product?.processedImage;
      const tryOnUrl =
        savedTryOnFrontUrl ||
        nextImages?.find((im) => im.kind === 'front_tryon' && Math.abs(im.angleYaw) <= 20)?.imageUrl ||
        frontUrl;
      const galleryUrls = (nextImages || [])
        .filter((im) => im.kind === 'gallery' || Math.abs(im.angleYaw) > 20)
        .map((im) => im.imageUrl);

      const finalGlbUrl = glbFile
        ? await uploadAssetToStorage(glbFile, productFolder, 'glb')
        : existingGlbUrl || undefined;
      const nextCalibration = {
        ...(product?.modelCalibration || {}),
        isSunglasses: cat === 'sun',
        storeFrontUrl: frontUrl,
        tryOnFrontUrl: tryOnUrl,
        fitScale,
        eyeLineOffset,
      };

      if (isEdit && product) {
        await updateProduct(
          product.id,
          {
            code: finalCode,
            name: cleanName,
            description: description.trim(),
            type: frameType,
            cat,
            price: finalPrice,
            disc: finalDisc,
            frame: primaryColor,
            lens: cat === 'sun' ? '#475569' : '#cfe8ff',
            tryonMode: finalGlbUrl ? '3d' : '2d',
            processedImage: frontUrl,
            storeFrontUrl: frontUrl,
            tryOnFrontUrl: tryOnUrl,
            glbUrl: finalGlbUrl,
            model3dUrl: finalGlbUrl,
            modelCalibration: nextCalibration,
            additionalImages: galleryUrls,
            frameColors: finalColors,
            availableColors: finalColors,
            availableSizes,
            shapes: shapes.length ? shapes : ['oval', 'round'],
            isPublished: Boolean(isPublished && (!hasAnyProcessedPhoto || merchantApproved)),
          },
          nextImages
        );
        toast(`تم حفظ تعديلات "${cleanName}" ✓`);
      } else {
        await addProduct(
          {
            shopId: activeShop.id,
            code: finalCode,
            name: cleanName,
            description: description.trim(),
            type: frameType,
            cat,
            price: finalPrice,
            disc: finalDisc,
            frame: primaryColor,
            lens: cat === 'sun' ? '#475569' : '#cfe8ff',
            tryonMode: finalGlbUrl ? '3d' : '2d',
            processedImage: frontUrl,
            storeFrontUrl: frontUrl,
            tryOnFrontUrl: tryOnUrl,
            glbUrl: finalGlbUrl,
            model3dUrl: finalGlbUrl,
            modelCalibration: nextCalibration,
            additionalImages: galleryUrls,
            frameColors: finalColors,
            availableColors: finalColors,
            availableSizes,
            shapes: shapes.length ? shapes : ['oval', 'round'],
            isPublished: Boolean(isPublished && (!hasAnyProcessedPhoto || merchantApproved)),
          },
          nextImages || []
        );
        toast(`تمت إضافة "${cleanName}" إلى المتجر بنجاح ✓`);
      }
      onClose();
    } catch {
      toast('تعذر حفظ النظارة — حاول مجدداً');
    } finally {
      setPublishing(false);
    }
  };

  const handleClose = () => {
    requestIdRef.current += 1;
    stopCamera();
    onClose();
  };

  const renderSlotCard = ({
    angleType,
    stepBadge,
    title,
    subtitle,
    cutoutUrl,
    originalUrl,
    asset,
    onPickFile,
  }: {
    angleType: GlassesPhotoAngle;
    stepBadge: string;
    title: string;
    subtitle: string;
    cutoutUrl?: string;
    originalUrl?: string;
    asset: ProcessedGlassesPhoto | null;
    onPickFile: () => void;
  }) => (
    <div className="rounded-2xl p-3.5 bg-white/[0.04] border border-white/12 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="badge b-acc">{stepBadge}</span>
            <span className="font-extrabold text-xs sm:text-sm">{title}</span>
          </div>
          <p className="text-[0.7rem] opacity-65 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" className="btn btn-p btn-sm" onClick={onPickFile}>
            <I n="upload" s={13} /> {cutoutUrl ? 'تغيير' : 'رفع صورة'}
          </button>
          <button type="button" className="btn btn-g btn-sm" onClick={() => setCameraSlot(angleType)}>
            <I n="cam" s={13} /> كاميرا
          </button>
        </div>
      </div>

      {cutoutUrl ? (
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-[#F8F7F4] border border-slate-200 p-2.5 flex items-center justify-center relative aspect-[16/10]">
              <span className="absolute top-1.5 start-1.5 text-[0.65rem] font-bold text-slate-700 bg-white/95 px-2 py-0.5 rounded border border-slate-200">
                الصورة الأصلية
              </span>
              <img src={originalUrl || cutoutUrl} alt="الصورة الأصلية" className="max-w-full max-h-full object-contain" />
            </div>
            <div className="rounded-xl bg-[#F8F7F4] border border-teal-500/60 p-2.5 flex items-center justify-center relative aspect-[16/10]">
              <span className="absolute top-1.5 start-1.5 text-[0.65rem] font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                النتيجة النهائية
              </span>
              <img
                src={asset?.storeFrontDataUrl || cutoutUrl}
                alt="النتيجة النهائية"
                className="max-w-full max-h-full object-contain"
              />
            </div>
          </div>

          {asset?.quality === 'check' && (
            <div className="rounded-xl bg-amber-500/15 border border-amber-400/35 px-3 py-2 text-[0.72rem] text-amber-200 font-semibold">
              تنبيه مراجعة: {asset.qualityNoteAr || 'يُنصح بمراجعة عزل الإطار أو الحواف قبل الاعتماد'}
            </div>
          )}

          {asset && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[0.7rem] text-teal-200 bg-teal-500/10 border border-teal-400/25 rounded-xl px-3 py-1.5">
              <span>
                {asset.lightingAdjusted ? '✓ تم توازن الإضاءة والألوان تلقائياً' : '✓ الإضاءة متوازنة — ألوان النظارة محفوظة'}
                {asset.angleCorrectionNote ? ` · ${asset.angleCorrectionNote}` : ''}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {originalUrl && (
                  <button
                    type="button"
                    onClick={() => void runProcessing(originalUrl, angleType, preset, cat)}
                    className="underline font-bold cursor-pointer text-amber-200"
                  >
                    إعادة المحاولة
                  </button>
                )}
                {angleType === 'front' && asset.angleCorrectionApplied && (
                  <button
                    type="button"
                    onClick={() => setUseUntouchedFrontAngle((v) => !v)}
                    className="underline font-bold cursor-pointer text-white"
                  >
                    {useUntouchedFrontAngle ? 'استخدام الزاوية الموزونة' : 'إرجاع الزاوية الأصلية'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          onClick={onPickFile}
          className="rounded-xl border-2 border-dashed border-white/15 hover:border-teal-400/60 bg-white/[0.02] p-4 text-center cursor-pointer transition"
        >
          <div className="text-xs font-bold opacity-80">اضغط لرفع صورة واضحة أو استخدم الكاميرا أعلاه</div>
          <div className="text-[0.68rem] opacity-55 mt-0.5">
            تتم إزالة الخلفية وتجهيز الصورة محلياً دون تعديل تصميم النظارة أو لونها
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(3,8,16,.86)', backdropFilter: 'blur(8px)' }}
      onClick={handleClose}
    >
      <div
        className="pop glass-s w-full max-w-2xl rounded-t-3xl sm:rounded-3xl p-4 sm:p-6 max-h-[94dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="font-extrabold text-lg">
              {isEdit ? `تعديل النظارة — ${product?.name}` : 'إضافة نظارة جديدة (صورتان فقط)'}
            </h3>
            <p className="text-xs opacity-65">
              صوّر أو ارفع صورتين من زاويتين مختلفتين — يعزل النظام الخلفية ويحفظ شكل النظارة الحقيقي تماماً
            </p>
          </div>
          <button
            type="button"
            className="btn btn-g btn-sm !p-2.5 shrink-0"
            onClick={handleClose}
            aria-label="إغلاق"
          >
            <I n="x" s={16} />
          </button>
        </div>

        {/* Clean 2-step switcher */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/5 mb-4">
          <button
            type="button"
            onClick={() => setStage('photo')}
            className={
              'py-2 rounded-lg text-xs sm:text-sm font-bold cursor-pointer whitespace-nowrap ' +
              (stage !== 'details' ? 'bg-acc text-[#04201c]' : 'opacity-75 hover:opacity-100')
            }
          >
            1. الصور والمعاينة (صورتان)
          </button>
          <button
            type="button"
            onClick={() => setStage('details')}
            className={
              'py-2 rounded-lg text-xs sm:text-sm font-bold cursor-pointer whitespace-nowrap ' +
              (stage === 'details' ? 'bg-acc text-[#04201c]' : 'opacity-75 hover:opacity-100')
            }
          >
            2. البيانات، المقاسات والنشر
          </button>
        </div>

        {stage === 'photo' && (
          <div className="space-y-4">
            {editingMask && frontAsset ? (
              <LensMaskEditor
                asset={frontAsset}
                onCancel={() => setEditingMask(false)}
                onSave={(updated) => {
                  setFrontAsset((prev) =>
                    prev
                      ? {
                          ...prev,
                          ...updated,
                          unleveledImageDataUrl: updated.imageDataUrl,
                          unleveledImageBlob: updated.imageBlob,
                          unleveledMaskDataUrl: updated.maskDataUrl,
                          unleveledMaskBlob: updated.maskBlob,
                        }
                      : null
                  );
                  setEditingMask(false);
                  setMerchantApproved(false);
                  toast('تم تحديث شفافية العدسات بنجاح ✓');
                }}
              />
            ) : cameraSlot ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span>
                    {cameraSlot === 'front'
                      ? 'التقاط الصورة 1 — الزاوية الأمامية'
                      : 'التقاط الصورة 2 — زاوية جانبية / مائلة'}
                  </span>
                  <button
                    type="button"
                    className="text-rose-300 cursor-pointer"
                    onClick={() => setCameraSlot(null)}
                  >
                    إلغاء الكاميرا
                  </button>
                </div>
                <div className="relative rounded-2xl bg-black overflow-hidden aspect-[4/3] max-h-[280px] w-full flex items-center justify-center border border-white/10">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className={'w-full h-full object-cover ' + (camReady ? 'opacity-100' : 'opacity-0')}
                  />
                  {!camReady && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center gap-3">
                      {camError ? (
                        <>
                          <p className="text-sm opacity-80 leading-relaxed">{camError}</p>
                          <button type="button" className="btn btn-g btn-sm" onClick={() => void startCamera()}>
                            إعادة تشغيل الكاميرا
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="w-9 h-9 rounded-full border-2 border-teal-400 border-t-transparent animate-spin" />
                          <p className="text-xs opacity-70">جاري فتح الكاميرا...</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    className="btn btn-p !py-3"
                    disabled={!camReady}
                    onClick={() => videoRef.current && void runProcessing(videoRef.current, cameraSlot, preset)}
                  >
                    <I n="cam" s={17} /> التقط وعالج الخلفية
                  </button>
                  <button
                    type="button"
                    className="btn btn-g !py-3"
                    onClick={() => setCameraSlot(null)}
                  >
                    العودة لرفع ملف
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Pre-Upload Frame Category Selector (BEFORE selecting photos) */}
                <div className="rounded-2xl bg-white/[0.04] border border-white/15 p-3 space-y-2">
                  <div className="text-xs font-extrabold text-teal-200">
                    اختر نوع النظارة أولاً (قبل اختيار الصور):
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCat('med');
                        setPreset('auto');
                        const frontSrc = frontAsset?.originalDataUrl || existingFront?.originalImageUrl || existingFront?.imageUrl;
                        if (frontSrc) void runProcessing(frontSrc, 'front', 'auto', 'med');
                      }}
                      className={
                        'p-2.5 rounded-xl border text-start transition cursor-pointer flex items-center gap-2 ' +
                        (cat !== 'sun'
                          ? 'bg-acc text-[#04201c] border-transparent font-extrabold'
                          : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.07]')
                      }
                    >
                      <I n="eye" s={16} />
                      <span className="text-xs font-extrabold">نظارات طبية (تفريغ العدسات تلقائياً)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCat('sun');
                        setPreset('sunglasses');
                        const frontSrc = frontAsset?.originalDataUrl || existingFront?.originalImageUrl || existingFront?.imageUrl;
                        if (frontSrc) void runProcessing(frontSrc, 'front', 'sunglasses', 'sun');
                      }}
                      className={
                        'p-2.5 rounded-xl border text-start transition cursor-pointer flex items-center gap-2 ' +
                        (cat === 'sun'
                          ? 'bg-acc text-[#04201c] border-transparent font-extrabold'
                          : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.07]')
                      }
                    >
                      <I n="spark" s={16} />
                      <span className="text-xs font-extrabold">نظارات شمسية (الحفاظ على لون العدسات)</span>
                    </button>
                  </div>
                </div>

                <PhotoUploadGuidelines />

                {renderSlotCard({
                  angleType: 'front',
                  stepBadge: 'أساسية',
                  title: 'الصورة الأمامية (أساسية)',
                  subtitle: 'تتم إزالة الخلفية وتجهيز نسخة المتجر ونسخة الكاميرا المفرّغة تلقائياً فور اختيار الصورة.',
                  cutoutUrl: activeFrontCutout,
                  originalUrl: activeFrontOriginal,
                  asset: frontAsset,
                  onPickFile: () => frontInputRef.current?.click(),
                })}

                {activeFrontCutout && (
                  <div className="rounded-2xl p-3 bg-white/[0.04] border border-teal-400/25 space-y-2.5">
                    <span className="text-xs font-extrabold tx-acc block">
                      النتيجة النهائية ومعاينة التثبيت على الوجه
                    </span>

                    <FrameFitPreview
                      cutoutUrl={frontAsset?.tryOnFrontDataUrl || activeFrontCutout}
                      storeFrontUrl={frontAsset?.storeFrontDataUrl}
                      type={frameType}
                      fitScale={fitScale}
                      eyeLineOffset={eyeLineOffset}
                      onChangeFitScale={setFitScale}
                      onChangeEyeLineOffset={setEyeLineOffset}
                    />
                  </div>
                )}

                {renderSlotCard({
                  angleType: 'angled',
                  stepBadge: 'اختيارية',
                  title: 'صورة جانبية 45° (اختيارية)',
                  subtitle: 'تُعزل خلفيتها تلقائياً لتتيح للعملاء التبديل بين أمامي وجانبي 45° على بطاقة المنتج.',
                  cutoutUrl: activeAngledCutout,
                  originalUrl: activeAngledOriginal,
                  asset: angledAsset,
                  onPickFile: () => angledInputRef.current?.click(),
                })}

                {hasAnyProcessedPhoto && (
                  <div className="rounded-xl p-3 bg-white/5 border border-white/10 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold">إعادة المعالجة بنمط مختلف (اختياري):</span>
                      {frontAsset && (
                        <button
                          type="button"
                          className="btn btn-g btn-sm"
                          onClick={() => setEditingMask(true)}
                        >
                          <I n="edit" s={13} /> ضبط قناع العدسات
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          title={opt.hint}
                          onClick={() => void handleReprocessPreset(opt.id)}
                          className={'chip !py-1.5 !px-3 !text-xs ' + (preset === opt.id ? 'on' : '')}
                        >
                          <I n="refresh" s={12} /> {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {hasAnyProcessedPhoto && (
                  <div
                    className={
                      'p-3.5 rounded-2xl border space-y-2.5 ' +
                      (merchantApproved
                        ? 'bg-emerald-500/10 border-emerald-400/40'
                        : 'bg-teal-500/10 border-teal-400/35')
                    }
                  >
                    <div className="text-xs leading-5">
                      <div className="font-extrabold text-teal-200">
                        {merchantApproved ? 'تم اعتماد النتيجة — جاهزة للنشر ✓' : 'مراجعة واعتماد النتيجة قبل النشر'}
                      </div>
                      <div className="opacity-80">
                        قارن الصورة الأصلية بالنتيجة النهائية أعلاه، ولا تُنشر النظارة في المتجر إلا بعد الضغط على «اعتماد».
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMerchantApproved(true);
                          setIsPublished(true);
                          toast('تم اعتماد النتيجة — يمكنك الآن المتابعة وحفظ النشر ✓');
                        }}
                        className={
                          'btn btn-sm font-extrabold ' +
                          (merchantApproved
                            ? 'bg-emerald-600/30 text-emerald-200 border border-emerald-400/40'
                            : 'btn-p')
                        }
                      >
                        <I n="check" s={14} /> {merchantApproved ? 'تم الاعتماد ✓' : 'اعتماد'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeFrontOriginal) {
                            void runProcessing(activeFrontOriginal, 'front', preset, cat);
                          } else if (activeAngledOriginal) {
                            void runProcessing(activeAngledOriginal, 'angled', preset, cat);
                          }
                        }}
                        className="btn btn-g btn-sm font-bold"
                      >
                        <I n="refresh" s={14} /> إعادة المحاولة
                      </button>
                    </div>
                  </div>
                )}

                {/* Secondary optional extra gallery images */}
                <details className="rounded-2xl p-3 bg-white/[0.03] border border-white/10">
                  <summary className="text-xs font-bold cursor-pointer flex items-center justify-between">
                    <span>صور عرض إضافية اختيارية ({gallery.length})</span>
                    <span className="text-[0.68rem] opacity-60">اختياري لصفحة التفاصيل</span>
                  </summary>
                  <div className="mt-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[0.7rem] opacity-65">يمكنك إضافة صور مقربة أو زاوية إضافية حتى 5 صور</span>
                      {gallery.length < 5 && (
                        <button
                          type="button"
                          className="btn btn-g btn-sm shrink-0"
                          onClick={() => galleryInputRef.current?.click()}
                        >
                          <I n="plus" s={13} /> إضافة صور
                        </button>
                      )}
                    </div>
                    {gallery.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {gallery.map((g) => (
                          <div
                            key={g.id}
                            className="relative w-20 h-16 shrink-0 rounded-xl bg-[#F6F5F3] border border-slate-200 p-1 flex items-center justify-center"
                          >
                            <img src={g.imageUrl} alt={g.label} className="max-w-full max-h-full object-contain" />
                            <button
                              type="button"
                              onClick={() => setGallery((prev) => prev.filter((x) => x.id !== g.id))}
                              className="absolute -top-1.5 -end-1.5 w-5 h-5 rounded-full bg-rose-500 text-white text-[0.65rem] flex items-center justify-center cursor-pointer"
                              aria-label="حذف الصورة الإضافية"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              </>
            )}

            <input
              ref={frontInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleFileChange(e, 'front')}
            />
            <input
              ref={angledInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleFileChange(e, 'angled')}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void handleGalleryAdd(e)}
            />

            <div className="flex items-center justify-between pt-2 border-t border-white/10 gap-2">
              <div className="text-xs opacity-65">
                {activeFrontCutout && activeAngledCutout
                  ? 'الصورتان جاهزتان للتجربة الافتراضية بالذكاء الاصطناعي'
                  : activeFrontCutout
                  ? 'الصورة الأمامية جاهزة — يُفضل إضافة الصورة الثانية لزاوية إضافية'
                  : 'ارفع صورتي النظارة الآن أو تابع بالرسم القياسي'}
              </div>
              <button
                type="button"
                className="btn btn-p shrink-0"
                onClick={() => setStage('details')}
              >
                متابعة للتفاصيل ←
              </button>
            </div>
          </div>
        )}

        {stage === 'wait' && (
          <div className="py-10 px-4 text-center space-y-5">
            {waitError ? (
              <>
                <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/15 border border-rose-400/30 flex items-center justify-center text-rose-300">
                  <I n="x" s={26} />
                </div>
                <div className="space-y-1.5">
                  <div className="font-bold text-base">تعذر تجهيز الصورة</div>
                  <p className="text-sm opacity-75 leading-relaxed">{waitError}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-p w-full !py-3"
                  onClick={() => {
                    requestIdRef.current += 1;
                    setWaitError(null);
                    setStage('photo');
                  }}
                >
                  حاول مرة أخرى
                </button>
              </>
            ) : (
              <>
                <div className="w-12 h-12 mx-auto rounded-full border-[3px] border-teal-400 border-t-transparent animate-spin" />
                <div className="space-y-1">
                  <div className="font-bold text-base">{waitLabel}</div>
                  <p className="text-xs opacity-65">تتم المعالجة محلياً مع حفظ النسخة الأصلية دون تغيير النظارة</p>
                </div>
              </>
            )}
          </div>
        )}

        {stage === 'details' && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-[#F6F5F3] border border-slate-200 p-3 flex items-center gap-3 text-slate-900">
              <div className="w-28 h-16 rounded-xl bg-white flex items-center justify-center p-1.5 shrink-0 border border-slate-200/70">
                {activeFrontCutout ? (
                  <img
                    src={activeFrontCutout}
                    alt={name}
                    className="max-h-full max-w-full object-contain"
                    style={{ filter: 'drop-shadow(0 6px 8px rgba(15, 23, 42, 0.16))' }}
                  />
                ) : (
                  <MiniGlasses type={frameType} frame={frameColor} lens={cat === 'sun' ? '#475569' : '#cfe8ff'} w={90} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{name || 'نظارة جديدة'}</div>
                <div className="text-xs text-slate-600">
                  {TYPES[frameType]} · {CATS[cat]} · {availableSizes.join(' / ')}
                </div>
              </div>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold cursor-pointer shrink-0"
                onClick={() => setStage('photo')}
              >
                {activeFrontCutout ? 'تعديل الصور' : 'رفع الصور'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs opacity-65">اسم النظارة</label>
                <input
                  className="inp mt-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: أفياتور تيتانيوم"
                />
              </div>
              <div>
                <label className="text-xs opacity-65">الكود</label>
                <input
                  className="inp mt-1 font-mono"
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs opacity-65">الشكل الهندسي للإطار</label>
                <select className="inp mt-1" value={frameType} onChange={(e) => setFrameType(e.target.value as FrameType)}>
                  {(Object.entries(TYPES) as [FrameType, string][]).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs opacity-65">الفئة</label>
                <select className="inp mt-1" value={cat} onChange={(e) => setCat(e.target.value as FrameCat)}>
                  {(Object.entries(CATS) as [FrameCat, string][]).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs opacity-65">السعر (ج.م)</label>
                <input
                  type="number"
                  min={50}
                  className="inp mt-1"
                  dir="ltr"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs opacity-65">الخصم % (اختياري)</label>
                <input
                  type="number"
                  min={0}
                  max={90}
                  className="inp mt-1"
                  dir="ltr"
                  value={disc}
                  onChange={(e) => setDisc(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-xs opacity-65">الوصف (يظهر في صفحة تفاصيل المنتج)</label>
              <textarea
                rows={2}
                className="inp mt-1"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="مثال: إطار معدني خفيف الوزن مناسب للاستخدام اليومي مع عدسات مقاومة للانعكاس."
              />
            </div>

            <div>
              <label className="text-xs opacity-65 block mb-1.5">الألوان المتاحة للإطار (اضغط لتحديد عدة ألوان)</label>
              <div className="flex items-center gap-2 flex-wrap">
                {FRAME_COLORS.map(([label, hex]) => {
                  const selected = availableColors.includes(hex);
                  return (
                    <button
                      key={hex}
                      type="button"
                      title={label}
                      onClick={() => {
                        toggleColor(hex);
                        setFrameColor(hex);
                      }}
                      className="w-8 h-8 rounded-full border-2 cursor-pointer relative flex items-center justify-center"
                      style={{
                        background: hex,
                        borderColor: selected ? '#14B8A6' : 'rgba(255,255,255,0.2)',
                        boxShadow: selected ? '0 0 0 2px rgba(20,184,166,0.45)' : 'none',
                      }}
                    >
                      {selected && <I n="check" s={12} c="text-white" />}
                    </button>
                  );
                })}
                <input
                  type="color"
                  value={frameColor}
                  onChange={(e) => {
                    const hex = e.target.value;
                    setFrameColor(hex);
                    setAvailableColors((prev) => (prev.includes(hex) ? prev : [...prev, hex]));
                  }}
                  className="w-8 h-7 rounded cursor-pointer bg-transparent"
                  title="إضافة لون مخصص"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs opacity-65 block mb-1.5">المقاسات المتوفرة</label>
                <div className="flex gap-1.5 flex-wrap">
                  {ALL_SIZES.map((sz) => {
                    const active = availableSizes.includes(sz);
                    return (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => toggleSize(sz)}
                        className={'chip !py-1.5 !px-3 !text-xs ' + (active ? 'on' : '')}
                      >
                        {sz}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs opacity-65 block mb-1.5">مناسبة لأشكال الوجه</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(Object.entries(SHAPES) as [FaceShape, string][]).map(([k, label]) => {
                    const active = shapes.includes(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() =>
                          setShapes((prev) =>
                            active ? (prev.length > 1 ? prev.filter((x) => x !== k) : prev) : [...prev, k]
                          )
                        }
                        className={'chip !py-1.5 !px-3 !text-xs ' + (active ? 'on' : '')}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {hasAnyProcessedPhoto && !merchantApproved && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-400/35 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs leading-5 text-amber-100 font-semibold">
                  بانتظار اعتماد النتيجة — لن تُنشر النظارة قبل الضغط على «اعتماد»
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="btn btn-p btn-sm"
                    onClick={() => {
                      setMerchantApproved(true);
                      setIsPublished(true);
                    }}
                  >
                    <I n="check" s={13} /> اعتماد
                  </button>
                  <button
                    type="button"
                    className="btn btn-g btn-sm"
                    onClick={() => setStage('photo')}
                  >
                    إعادة المحاولة
                  </button>
                </div>
              </div>
            )}

            {/* Optional 3D GLB attachment */}
            <div className="rounded-xl p-3 bg-white/[0.04] border border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <div className="font-bold">مجسم 3D (.glb) حقيقي (اختياري)</div>
                <div className="text-[0.68rem] opacity-65">
                  {glbFile
                    ? `مرفق: ${glbFile.name}`
                    : existingGlbUrl
                    ? 'يوجد ملف 3D (.glb) مرتبط حالياً'
                    : 'اتركه فارغاً لاستخدام تجربة الصورة الشفافة الواقعية (الموصى به)'}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="btn btn-g btn-sm cursor-pointer">
                  <I n="upload" s={13} /> {glbFile || existingGlbUrl ? 'تغيير .glb' : 'رفع .glb'}
                  <input
                    type="file"
                    accept=".glb,.gltf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) {
                        setGlbFile(f);
                        toast(`تم اختيار مجسم 3D: ${f.name} ✓`);
                      }
                    }}
                  />
                </label>
                {(glbFile || existingGlbUrl) && (
                  <button
                    type="button"
                    onClick={() => {
                      setGlbFile(null);
                      setExistingGlbUrl('');
                    }}
                    className="btn btn-g btn-sm text-rose-300"
                  >
                    إزالة
                  </button>
                )}
              </div>
            </div>

            <label className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
              <div>
                <div className="font-bold text-sm">نشر النظارة في متجر العملاء</div>
                <div className="text-xs opacity-60">
                  {isPublished ? 'ظاهرة الآن لجميع زوار المتجر' : 'مخفية كمسودة داخل لوحة التاجر فقط'}
                </div>
              </div>
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="w-5 h-5 accent-[var(--acc)]"
              />
            </label>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                className="btn btn-g !py-3 !text-sm"
                disabled={publishing}
                onClick={() => setStage('photo')}
              >
                السابق (الصور)
              </button>
              <button
                type="button"
                className="btn btn-p !py-3 !text-base"
                disabled={publishing}
                onClick={() => void handleSaveProduct()}
              >
                {publishing ? 'جاري الحفظ...' : isEdit ? 'حفظ التعديلات' : 'نشر النظارة في المتجر'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
