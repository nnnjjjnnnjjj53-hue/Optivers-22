import React, { useEffect, useState } from 'react';
import { CATS, DEFAULT_SHOP_ID, EGYPT_GOVERNORATES, TYPES } from '../data/seed';
import { useOptiVerse, useResolvedRxUrl } from '../services/optiverseStore';
import { FrameCat, FrameShapeTag, Inquiry, Product } from '../types';
import { BeforeAfter, MiniGlasses, Rx } from './GlassesGraphics';
import { Eyewear3DViewer } from './Eyewear3DARStage';
import { GuidedCaptureWizard } from './GuidedCaptureWizard';
import { I } from './Icons';
import { Egp, Modal, Switch, fmt, waNum } from './UiShared';
import { formatOpticalDimensions, resolveProductOpticalDimensions } from '../utils/opticalDimensions';
import { resolveStoreFrontUrl } from '../utils/bulkFrameProcessor';
import { recordStoreFriendShare } from '../utils/storeAnalytics';
import { canvasToBlob, loadImageToCanvas } from '../utils/visionPipeline';

const SHAPE_TAG_OPTIONS: { key: FrameShapeTag; label: string }[] = [
  { key: 'round', label: 'دائري (Round)' },
  { key: 'oval', label: 'بيضاوي (Oval)' },
  { key: 'square', label: 'مربع (Square)' },
  { key: 'cat_eye', label: 'كات آي (Cat-Eye)' },
  { key: 'aviator', label: 'أفياتور (Aviator)' },
];

function ZoomModal({ q, onClose }: { q: Inquiry; onClose: () => void }) {
  const [z, setZ] = useState(1.4);
  const resolvedRxUrl = useResolvedRxUrl(q.img);
  const isPdf = Boolean(q.img && q.img.toLowerCase().endsWith('.pdf'));
  return (
    <Modal title={`كشف النظر — ${q.cust}`} onClose={onClose} w="max-w-xl">
      <div className="rounded-xl overflow-auto max-h-[62vh] bg-slate-100">
        <div style={{ width: z * 100 + '%' }}>
          {q.img === 'demo' ? (
            <Rx n={q.rxn || 0} />
          ) : isPdf ? (
            <div className="p-6 text-center space-y-3">
              <div className="text-sm font-bold text-[#0F172A]">ملف كشف طبي (PDF)</div>
              {resolvedRxUrl && (
                <a href={resolvedRxUrl} target="_blank" rel="noreferrer" className="btn btn-p btn-sm inline-flex">
                  فتح / تحميل ملف الكشف PDF
                </a>
              )}
            </div>
          ) : (
            <img src={resolvedRxUrl || ''} alt="كشف" className="w-full" />
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <I n="search" s={16} />
        <input type="range" min="1" max="3.5" step="0.1" value={z} onChange={(e) => setZ(+e.target.value)} />
        <span className="text-xs w-10 tabular-nums">{Math.round(z * 100)}%</span>
      </div>
    </Modal>
  );
}

function VoteModal({
  p,
  p2,
  link,
  onClose,
  toast,
}: {
  p: Product;
  p2?: Product;
  link: string;
  onClose: () => void;
  toast: (m: string) => void;
}) {
  const [v, setV] = useState({ a: p2 ? 5 : 7, b: p2 ? 4 : 2 });
  const [me, setMe] = useState<'a' | 'b' | null>(null);
  const tot = Math.max(1, v.a + v.b);
  const vote = (k: 'a' | 'b') => {
    if (me) return;
    setMe(k);
    setV((x) => ({ ...x, [k]: x[k] + 1 }));
  };

  const pImg = resolveStoreFrontUrl(p) || p.processedImage || p.images?.[0]?.imageUrl;
  const p2Img = p2 ? resolveStoreFrontUrl(p2) || p2.processedImage || p2.images?.[0]?.imageUrl : undefined;

  const msg = p2
    ? encodeURIComponent(
        `أيهما أحلى عليّ؟ ⚖️\n🅰️ ${p.name}\n🅱️ ${p2.name}\nصوّت وساعدني في الاختيار:\n${link}`
      )
    : encodeURIComponent(
        `شوف نظارة ${p.name} وقولي رأيك: جميلة ومناسبة جداً 👍 ولا جرّب موديلاً آخر 🔄\n${link}`
      );

  return (
    <Modal
      title={p2 ? 'اسأل أصدقاءك: أيهما أحلى عليّ؟ ⚖️' : 'شارك مع أصدقائك رأيهم في النظارة'}
      onClose={onClose}
      w={p2 ? 'max-w-lg' : 'max-w-md'}
    >
      {p2 ? (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { tag: 'A', item: p, img: pImg },
            { tag: 'B', item: p2, img: p2Img },
          ].map(({ tag, item, img }) => (
            <div key={item.id} className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 text-center">
              <div className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#0F172A] text-white text-[0.65rem] font-extrabold mb-2">
                اختيار {tag}
              </div>
              <div className="h-24 rounded-xl bg-white border border-slate-200 flex items-center justify-center p-2 mb-2">
                <MiniGlasses type={item.type} frame={item.frame} lens={item.lens} w={100} imageUrl={img} />
              </div>
              <div className="font-extrabold text-xs text-[#0F172A] truncate">{item.name}</div>
              <div className="text-[0.7rem] font-bold text-[#D97706] mt-0.5 tabular-nums">
                <Egp v={item.salePrice && item.salePrice > 0 && item.salePrice < item.price ? item.salePrice : item.price} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex items-center gap-3 mb-4">
          <div className="rounded-xl bg-white border border-slate-200 p-2 shrink-0">
            <MiniGlasses type={p.type} frame={p.frame} lens={p.lens} w={90} imageUrl={pImg} />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-[#0F172A] truncate">{p.name}</div>
            <div className="text-xs text-slate-600">شارك الرابط مع أصدقائك وشاهد تصويتهم فوراً</div>
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        {(p2
          ? [
              ['a', `🅰️ ${p.name}`] as const,
              ['b', `🅱️ ${p2.name}`] as const,
            ]
          : [
              ['a', 'جميلة ومناسبة جداً 👍'] as const,
              ['b', 'جرّب موديلاً آخر 🔄'] as const,
            ]
        ).map((o) => {
          const pct = Math.round((v[o[0]] / tot) * 100);
          return (
            <button
              key={o[0]}
              type="button"
              onClick={() => vote(o[0])}
              className={
                'relative w-full overflow-hidden rounded-2xl border p-3.5 text-start font-bold cursor-pointer bg-white transition ' +
                (me === o[0] ? 'border-[#0284C7] ring-1 ring-[#0284C7] bg-sky-50' : 'border-[#E2E8F0] hover:border-slate-300')
              }
            >
              <span
                className="absolute inset-y-0 start-0 bg-sky-500/15 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex justify-between items-center gap-2 text-[#0F172A] text-xs sm:text-sm">
                <span className="truncate">{o[1]}</span>
                <span className="text-[#0284C7] tabular-nums shrink-0">
                  {v[o[0]]} صوت · {pct}%
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {me && <p className="text-xs text-center text-[#059669] font-bold mt-2">تم تسجيل صوتك بنجاح ✓</p>}

      <div className="grid grid-cols-2 gap-2 mt-4">
        <button
          type="button"
          className="btn btn-g"
          onClick={() => {
            recordStoreFriendShare(p.shopId);
            navigator.clipboard
              ?.writeText(link)
              .then(() => toast('تم نسخ رابط التصويت ✓'))
              .catch(() => toast('انسخ الرابط يدوياً'));
          }}
        >
          <I n="copy" s={15} /> نسخ الرابط
        </button>
        <a
          className="btn btn-p"
          href={`https://wa.me/?text=${msg}`}
          target="_blank"
          rel="noreferrer"
          onClick={() => recordStoreFriendShare(p.shopId)}
        >
          <I n="msg" s={15} /> إرسال واتساب
        </a>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="btn btn-g btn-sm w-full mt-2.5 text-xs font-bold text-[#0F172A]"
      >
        تصفّح باقي نظارات المتجر
      </button>

      <div className="p-2.5 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] text-[#0F172A] font-mono text-xs mt-3 truncate" dir="ltr">
        {link}
      </div>
    </Modal>
  );
}

function ConfirmModal({ q, onClose }: { q: Inquiry; onClose: () => void }) {
  const { updateInquiry, toast, activeShop, logAudit } = useOptiVerse();
  const [price, setPrice] = useState(q.price);
  const [ok, setOk] = useState(false);
  const msg = encodeURIComponent(
    `أهلاً ${q.cust}، ${activeShop.name} بيأكد لك ملاءمة ${q.frameName} مع ${q.lensName}${
      q.brandName && q.brandName !== '—' ? ' (' + q.brandName + ')' : ''
    } بعد مراجعة الكشف.\nالسعر النهائي: ${fmt(price)} ج.م ✅`
  );
  return (
    <Modal title="تأكيد الملاءمة والسعر النهائي" onClose={onClose}>
      {!ok ? (
        <div className="space-y-3">
          <div className="text-sm text-slate-600">
            راجعت الكشف وتأكدت إن العدسة مناسبة لقياس العميل؟ حدّد السعر النهائي اللي هيوصل له.
          </div>
          <label className="text-xs text-slate-500">السعر النهائي (ج.م)</label>
          <input className="inp" type="number" value={price} onChange={(e) => setPrice(+e.target.value || 0)} />
          <button
            className="btn btn-p w-full !py-3"
            onClick={async () => {
              await updateInquiry(q.id, { status: 'confirmed', final: price, stage: q.stage || 'review' });
              await logAudit('تأكيد ملاءمة', `الطلب ${q.id} بسعر نهائي ${price} ج.م`, activeShop.id);
              setOk(true);
              toast('تم تأكيد الملاءمة ✓');
            }}
          >
            <I n="check" s={17} /> تأكيد الملاءمة
          </button>
        </div>
      ) : (
        <div className="text-center">
          <span className="w-16 h-16 rounded-full b-ok inline-flex items-center justify-center mb-3">
            <I n="check" s={32} />
          </span>
          <div className="font-extrabold mb-1">تم تأكيد الملاءمة</div>
          <p className="text-sm text-slate-600 mb-4">أرسل السعر النهائي للعميل على واتساب</p>
          <a
            className="btn btn-p w-full !py-3"
            href={`https://wa.me/${waNum(q.phone)}?text=${msg}`}
            target="_blank"
            rel="noreferrer"
          >
            <I n="msg" s={18} /> إرسال السعر النهائي عبر واتساب
          </a>
          <button className="btn btn-g w-full mt-2" onClick={onClose}>
            تم
          </button>
        </div>
      )}
    </Modal>
  );
}

function AltModal({ q, onClose }: { q: Inquiry; onClose: () => void }) {
  const { updateInquiry, toast, lensTypes, activeShop } = useOptiVerse();
  const opts = lensTypes.filter(
    (l) => (l.shopId || DEFAULT_SHOP_ID) === activeShop.id && l.on !== false && l.name !== q.lensName
  );
  return (
    <Modal title="اقتراح عدسة بديلة" onClose={onClose}>
      <p className="text-sm text-slate-600 mb-3">
        العدسة الحالية: <b>{q.lensName}</b>. اختار بديل مناسب لقياس العميل وهيتحدّث السعر تلقائياً.
      </p>
      <div className="space-y-2">
        {opts.map((l) => {
          const np = q.fp + l.price + q.add;
          return (
            <button
              key={l.id}
              onClick={async () => {
                await updateInquiry(q.id, {
                  status: 'alt',
                  alt: l.name,
                  altFrom: q.lensName,
                  lensName: l.name,
                  lensPrice: l.price,
                  price: np,
                });
                toast(`تم اقتراح ${l.name} للعميل ✓`);
                onClose();
              }}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#E2E8F0] bg-[#F8F9FA] hover:bg-slate-100 text-start cursor-pointer"
            >
              <span className="w-9 h-9 rounded-xl b-acc flex items-center justify-center">
                <I n={l.icon} s={18} />
              </span>
              <div className="flex-1">
                <div className="font-bold text-sm text-[#0F172A]">{l.name}</div>
                <div className="text-xs text-slate-500">{l.desc}</div>
              </div>
              <b className="text-[#D97706] text-sm">
                <Egp v={np} />
              </b>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function QuickEditProductModal({ p, onClose }: { p: Product; onClose: () => void }) {
  const { activeShop, updateProduct, uploadAssetToStorage, toast } = useOptiVerse();
  const [name, setName] = useState(p.name);
  const [code, setCode] = useState(p.modelCode || p.code || '');
  const [price, setPrice] = useState(String(p.price || 0));
  const [disc, setDisc] = useState(String(p.disc || 0));
  const resolveInitialCategoryChoice = (): 'prescription' | 'sunglasses' | 'metal' | 'clip_on' | 'kids' => {
    if (p.frameType === 'clip_on') return 'clip_on';
    if (p.frameType === 'kids') return 'kids';
    if (p.frameType === 'metal' || (p.modelCalibration?.material === 'metal' && p.cat === 'sun')) return 'metal';
    if (p.frameType === 'sunglasses' || p.cat === 'sun') return 'sunglasses';
    return 'prescription';
  };
  const [categoryChoice, setCategoryChoice] = useState<'prescription' | 'sunglasses' | 'metal' | 'clip_on' | 'kids'>(
    resolveInitialCategoryChoice
  );
  const [frameShapeTag, setFrameShapeTag] = useState<FrameShapeTag>(
    p.frameShapeTag ||
      p.modelCalibration?.frameShapeTag ||
      (p.type === 'aviator'
        ? 'aviator'
        : p.type === 'round'
        ? 'round'
        : p.type === 'cat'
        ? 'cat_eye'
        : 'square')
  );
  const [isPublished, setIsPublished] = useState(p.isPublished !== false);
  const [previewImgUrl, setPreviewImgUrl] = useState<string | undefined>(
    resolveStoreFrontUrl(p) || p.processedImage || p.images?.[0]?.imageUrl
  );
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [saving, setSaving] = useState(false);

  const numPrice = Math.max(0, Math.round(Number(price) || 0));
  const numDisc = Math.max(0, Math.min(90, Math.round(Number(disc) || 0)));
  const finalPrice = Math.round(numPrice * (1 - numDisc / 100));

  const handlePhotoChange = async (file: File) => {
    setUploadingPhoto(true);
    try {
      const uploadedUrl = await uploadAssetToStorage(file, `${activeShop.id}/products/front`, 'webp');
      setPreviewImgUrl(uploadedUrl);
      setPhotoChanged(true);
      toast('تم رفع الصورة الجديدة — اضغط حفظ التعديلات للتأكيد ✓');
    } catch {
      toast('تعذر رفع الصورة');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const save = async () => {
    setSaving(true);
    const cleanName = name.trim() || p.name;
    const cleanCode = code.trim().toUpperCase() || p.code;
    const mappedCat: FrameCat =
      categoryChoice === 'sunglasses' || categoryChoice === 'metal'
        ? 'sun'
        : categoryChoice === 'kids' && (p.subCategory === 'sun' || p.cat === 'sun')
        ? 'sun'
        : 'med';
    const mappedSubCategory =
      categoryChoice === 'sunglasses' || categoryChoice === 'metal'
        ? ('sun' as const)
        : categoryChoice === 'kids'
        ? p.subCategory || (p.cat === 'sun' ? 'sun' : 'optical')
        : ('optical' as const);
    const mappedMaterial =
      categoryChoice === 'metal' || p.modelCalibration?.material === 'metal'
        ? ('metal' as const)
        : ('tr_plastic' as const);

    const nextPatch: Partial<Omit<Product, 'id' | 'shopId'>> = {
      name: cleanName,
      code: cleanCode,
      modelCode: cleanCode,
      price: numPrice,
      disc: numDisc,
      salePrice: numDisc > 0 && finalPrice < numPrice ? finalPrice : undefined,
      cat: mappedCat,
      frameType: categoryChoice,
      subCategory: mappedSubCategory,
      frameShapeTag,
      isPublished,
      modelCalibration: {
        ...(p.modelCalibration || {}),
        material: mappedMaterial,
        frameShapeTag,
        modelCode: cleanCode,
        ...(photoChanged && previewImgUrl ? { storeFrontUrl: previewImgUrl } : {}),
      },
      ...(photoChanged && previewImgUrl
        ? {
            processedImage: previewImgUrl,
            storeFrontUrl: previewImgUrl,
            frontCatalogPath: previewImgUrl,
          }
        : {}),
    };

    const nextImages =
      photoChanged && previewImgUrl
        ? [
            ...(p.images || []).filter((img) => img.kind === 'front_tryon'),
            {
              id: `img-${Date.now()}-front`,
              productId: p.id,
              angleYaw: 0,
              label: 'الصورة الأمامية للكتالوج',
              imageUrl: previewImgUrl,
              kind: 'gallery' as const,
              sortOrder: 1,
            },
            ...(p.images || []).filter((img) => img.kind !== 'front_tryon' && img.angleYaw !== 0),
          ]
        : undefined;

    await updateProduct(p.id, nextPatch, nextImages);
    setSaving(false);
    toast(`تم تحديث "${cleanName}" ✓`);
    onClose();
  };

  return (
    <Modal title="تعديل بيانات النظارة" onClose={onClose}>
      <div className="space-y-4">
        {/* Field 1: Frame Thumbnail + Change Photo */}
        <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-xl bg-white border border-slate-200 p-2 shrink-0">
              <MiniGlasses
                type={p.type}
                frame={p.frame}
                lens={p.lens}
                w={88}
                imageUrl={previewImgUrl}
              />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm text-[#0F172A] truncate">{name || p.name}</div>
              <div className="text-xs text-slate-500 font-mono truncate" dir="ltr" style={{ textAlign: 'start' }}>
                {code || p.code}
              </div>
            </div>
          </div>

          <label className="btn btn-g btn-sm shrink-0 cursor-pointer">
            <I n="camera" s={14} /> {uploadingPhoto ? 'جاري الرفع...' : 'تغيير الصورة'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploadingPhoto}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handlePhotoChange(file);
              }}
            />
          </label>
        </div>

        {/* Field 2: Frame Name & Code */}
        <div className="grid grid-cols-12 gap-2.5">
          <div className="col-span-7">
            <label className="text-xs font-bold text-slate-600 block mb-1">اسم النظارة</label>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="col-span-5">
            <label className="text-xs font-bold text-slate-600 block mb-1">الكود / الموديل</label>
            <input
              className="inp font-mono"
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        </div>

        {/* Field 3: Price & Discount % */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">السعر الأساسي (ج.م)</label>
            <input
              className="inp"
              type="number"
              min="0"
              dir="ltr"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">نسبة الخصم % (0–90)</label>
            <input
              className="inp"
              type="number"
              min="0"
              max="90"
              dir="ltr"
              value={disc}
              onChange={(e) => setDisc(e.target.value)}
            />
          </div>
        </div>

        {/* Field 4: Category & Frame Shape */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">الفئة</label>
            <select
              className="inp"
              value={categoryChoice}
              onChange={(e) =>
                setCategoryChoice(e.target.value as 'prescription' | 'sunglasses' | 'metal' | 'clip_on' | 'kids')
              }
            >
              <option value="prescription">نظارات طبية</option>
              <option value="sunglasses">نظارات شمسية</option>
              <option value="metal">نظارات شمس معادن</option>
              <option value="clip_on">نظارات بغيار شمس</option>
              <option value="kids">نظارات أطفال</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">شكل الإطار</label>
            <select
              className="inp"
              value={frameShapeTag}
              onChange={(e) => setFrameShapeTag(e.target.value as FrameShapeTag)}
            >
              {SHAPE_TAG_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Field 5: Publish Toggle + Save */}
        <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-bold text-sm text-[#0F172A]">نشر النظارة في المتجر</div>
            <div className="text-xs text-slate-500">
              {isPublished ? 'منشورة وتظهر للعملاء' : 'مسودة مخفية عن العملاء'} · السعر النهائي:{' '}
              <b className="text-[#D97706]"><Egp v={finalPrice} /></b>
            </div>
          </div>
          <Switch on={isPublished} onChange={setIsPublished} />
        </div>

        <button
          type="button"
          disabled={saving || uploadingPhoto}
          onClick={save}
          className="btn bg-[#D97706] hover:bg-[#B45309] text-white w-full !py-3 shadow-sm"
        >
          <I n="check" s={17} /> {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
        </button>
      </div>
    </Modal>
  );
}

export function Modals() {
  const {
    modal,
    setModal,
    toast,
    shops,
    addShopManual,
    activeShop,
    products,
    softDeleteProductById,
    cart,
    setCart,
    addInquiry,
    setLensTypes,
    setBrands,
    setExtras,
    syncCatalogItem,
    updateProductDiscount,
    updateShop,
    platformSettings,
    recordPayment,
    logAudit,
    uploadRxPrescriptionToStorage,
  } = useOptiVerse();
  const [f, setF] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Inquiry | null>(null);
  const [checkoutRxRef, setCheckoutRxRef] = useState<string | null>(null);
  const [checkoutRxPreview, setCheckoutRxPreview] = useState<string | null>(null);

  useEffect(() => {
    setF({});
    setDone(null);
    setCheckoutRxRef(null);
    setCheckoutRxPreview(null);
  }, [modal]);

  if (!modal) return null;
  const t = typeof modal === 'string' ? modal : modal.t;
  const close = () => setModal(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  const dynamicPlans = platformSettings.plans;
  const annualPaidMonths = Math.max(1, 12 - Math.min(6, Math.max(0, platformSettings.annualDiscountMonths ?? 2)));

  if (t === 'addprod') {
    return <GuidedCaptureWizard onClose={close} />;
  }

  if (t === 'editprod' && typeof modal !== 'string' && modal.t === 'editprod') {
    return <QuickEditProductModal p={modal.p} onClose={close} />;
  }

  if (t === 'delprod' && typeof modal !== 'string' && modal.t === 'delprod') {
    const p = modal.p;
    const shopProductsCount = products.filter((x) => x.shopId === activeShop.id && !x.isDeleted).length;
    return (
      <Modal title="تأكيد حذف النظارة" onClose={close}>
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 flex items-center gap-3">
            <div className="rounded-xl bg-white border border-slate-200 p-2 shrink-0">
              <MiniGlasses
                type={p.type}
                frame={p.frame}
                lens={p.lens}
                w={78}
                imageUrl={p.processedImage || p.images?.[0]?.imageUrl}
              />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm text-[#0F172A] truncate">{p.name}</div>
              <div className="text-xs text-slate-500 font-mono" dir="ltr" style={{ textAlign: 'start' }}>
                {p.code}
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-6">
            هل أنت متأكد من حذف <b>"{p.name}"</b>؟ ستختفي من متجر العملاء نهائياً. يمكنك بدلاً من ذلك إخفاؤها مؤقتاً من زر النشر.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-g" onClick={close}>
              إلغاء
            </button>
            <button
              type="button"
              className="btn btn-d"
              onClick={async () => {
                if (shopProductsCount < 2) {
                  toast('يجب أن تبقى نظارة واحدة على الأقل في المتجر');
                  close();
                  return;
                }
                await softDeleteProductById(p.id);
                close();
                toast(`تم حذف "${p.name}" ✓`);
              }}
            >
              <I n="trash" s={14} /> تأكيد الحذف
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (t === 'addshop') {
    return (
      <Modal title="إضافة محل يدوياً" onClose={close}>
        <div className="space-y-3">
          <input className="inp" placeholder="اسم المحل" value={f.n || ''} onChange={set('n')} />
          <input className="inp" placeholder="اسم صاحب المحل" value={f.o || ''} onChange={set('o')} />
          <input className="inp" dir="ltr" placeholder="رقم واتساب" value={f.wa || ''} onChange={set('wa')} />
          <input className="inp" type="email" dir="ltr" placeholder="بريد صاحب المحل (اختياري)" value={f.em || ''} onChange={set('em')} />
          <div className="grid grid-cols-2 gap-2">
            <select className="inp" value={f.gov || 'القاهرة'} onChange={set('gov')}>
              {EGYPT_GOVERNORATES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <input className="inp" placeholder="العنوان" value={f.addr || ''} onChange={set('addr')} />
          </div>
          <input className="inp" dir="ltr" placeholder="رابط Google Maps (اختياري)" value={f.maps || ''} onChange={set('maps')} />
          <select className="inp" value={f.p || dynamicPlans[0]?.name || 'أساسية'} onChange={set('p')}>
            {dynamicPlans.map((pl) => (
              <option key={pl.id} value={pl.name}>
                {pl.name} ({fmt(pl.price)} ج.م/ش)
              </option>
            ))}
          </select>
          <button
            className="btn btn-p w-full"
            onClick={async () => {
              if (!f.n?.trim()) {
                toast('اكتب اسم المحل أولاً');
                return;
              }
              await addShopManual({
                name: f.n,
                ownerName: f.o,
                ownerEmail: f.em,
                wa: f.wa,
                governorate: f.gov || 'القاهرة',
                city: f.gov || 'القاهرة',
                address: f.addr,
                mapsUrl: f.maps,
                plan: f.p || dynamicPlans[0]?.name || 'أساسية',
              });
              close();
              toast(`تمت إضافة ${f.n} ✓`);
            }}
          >
            إضافة المحل
          </button>
        </div>
      </Modal>
    );
  }

  if (t === 'renew' && typeof modal !== 'string' && modal.t === 'renew') {
    const s = modal.s;
    const months = Number(f.m || 1);
    const payMethod = (f.pm as 'InstaPay' | 'Vodafone Cash') || 'InstaPay';
    const refNo = f.ref || '';
    const amount =
      months === 12
        ? Math.round(s.price * annualPaidMonths)
        : months === 3
        ? Math.round(s.price * 3 * 0.9)
        : Math.round(s.price);

    return (
      <Modal title={`تجديد اشتراك ${s.name}`} onClose={close}>
        <div className="space-y-2 mb-4">
          {[
            { m: 1, label: 'تجديد شهري (شهر)', tag: null, price: Math.round(s.price) },
            { m: 3, label: '3 أشهر', tag: 'خصم 10%', price: Math.round(s.price * 3 * 0.9) },
            {
              m: 12,
              label: 'تجديد سنوي (12 شهر)',
              tag: `${platformSettings.annualDiscountMonths ?? 2} شهر مجاناً`,
              price: Math.round(s.price * annualPaidMonths),
            },
          ].map((opt) => (
            <button
              key={opt.m}
              type="button"
              onClick={() => setF({ ...f, m: String(opt.m) })}
              className={
                'w-full flex justify-between p-3 rounded-xl border cursor-pointer ' +
                (months === opt.m ? 'border-[#0284C7] bg-sky-50' : 'border-[#E2E8F0] bg-[#F8F9FA]')
              }
            >
              <span className="text-[#0F172A] font-semibold">
                {opt.label}
                {opt.tag ? <span className="badge b-ok ms-2">{opt.tag}</span> : null}
              </span>
              <b className="text-[#D97706]">
                <Egp v={opt.price} />
              </b>
            </button>
          ))}
        </div>
        <div className="space-y-2.5 mb-4">
          <div className="text-xs text-slate-600">طريقة التحصيل</div>
          <div className="grid grid-cols-2 gap-2">
            {(['InstaPay', 'Vodafone Cash'] as const).map((pm) => (
              <button
                key={pm}
                type="button"
                onClick={() => setF({ ...f, pm })}
                className={
                  'p-2.5 rounded-xl border text-xs font-bold cursor-pointer ' +
                  (payMethod === pm ? 'border-[#0284C7] bg-sky-50 text-[#0284C7]' : 'border-[#E2E8F0] bg-[#F8F9FA] text-[#0F172A]')
                }
              >
                {pm}
              </button>
            ))}
          </div>
          <input
            className="inp font-mono text-xs"
            dir="ltr"
            placeholder="رقم المرجع (Reference No - اختياري)"
            value={refNo}
            onChange={set('ref')}
          />
        </div>
        <button
          className="btn btn-p w-full"
          onClick={async () => {
            const newDays = (s.status === 'expired' || s.status === 'trial' ? 0 : s.days) + 30 * months;
            await updateShop(s.id, {
              days: newDays,
              status: 'active',
              exp: months === 12 ? 'مفعل (سنوي)' : `مفعل (${months} شهر)`,
            });
            await recordPayment({
              shopId: s.id,
              shopName: s.name,
              amount,
              method: payMethod,
              referenceNo: refNo,
              status: 'ok',
            });
            await logAudit('تجديد اشتراك', `تم تجديد ${s.name} لمدة ${months} شهر (${amount} ج.م)`, s.id);
            close();
            toast(`تم تجديد ${s.name} وتسجيل الدفعة ✓`);
          }}
        >
          تأكيد التجديد وتفعيل الاشتراك
        </button>
      </Modal>
    );
  }

  if (t === 'editplan' && typeof modal !== 'string' && modal.t === 'editplan') {
    const s = modal.s;
    const selectedPlanName = f.plan || s.plan;
    const matchedPlan =
      dynamicPlans.find((pl) => pl.name === selectedPlanName || pl.tierKey === f.tierKey) ||
      dynamicPlans.find((pl) => pl.tierKey === s.planTier) ||
      dynamicPlans[0];
    const customPrice = f.price !== undefined ? Number(f.price) : matchedPlan?.price || s.price;

    return (
      <Modal title={`تعديل الباقة — ${s.name}`} onClose={close}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {dynamicPlans.map((pl) => {
              const isSelected = selectedPlanName === pl.name || f.tierKey === pl.tierKey;
              return (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => {
                    setF({ ...f, plan: pl.name, tierKey: pl.tierKey || 'basic', price: String(pl.price) });
                  }}
                  className={
                    'p-2.5 rounded-xl border text-xs font-bold cursor-pointer text-center ' +
                    (isSelected
                      ? 'border-[#0284C7] bg-sky-50 text-[#0284C7]'
                      : 'border-[#E2E8F0] bg-[#F8F9FA] text-[#0F172A]')
                  }
                >
                  <div>{pl.name}</div>
                  <div className="text-[0.68rem] opacity-75 tabular-nums mt-0.5">{fmt(pl.price)} ج.م</div>
                </button>
              );
            })}
          </div>
          <div>
            <label className="text-xs text-slate-600">السعر الشهري للمتجر (ج.م)</label>
            <input className="inp mt-1" type="number" min="0" value={customPrice} onChange={set('price')} />
          </div>
          <button
            className="btn btn-p w-full"
            onClick={async () => {
              const chosenTier = matchedPlan?.tierKey || s.planTier || 'basic';
              await updateShop(s.id, {
                plan: selectedPlanName,
                planTier: chosenTier,
                price: customPrice,
                aiCreditsLimit: matchedPlan?.monthlyAiCredits || s.aiCreditsLimit || 110,
              });
              await logAudit('تعديل الباقة', `${s.name}: باقة ${selectedPlanName} (${customPrice} ج.م)`, s.id);
              close();
              toast(`تم تحديث باقة ${s.name} إلى ${selectedPlanName} ✓`);
            }}
          >
            <I n="check" s={16} /> حفظ الباقة
          </button>
        </div>
      </Modal>
    );
  }

  if (t === 'addpayment' && typeof modal !== 'string' && modal.t === 'addpayment') {
    const targetShop = shops.find((x) => x.id === (f.sid || modal.s?.id)) || modal.s || shops[0];
    const payMethod = (f.pm as 'InstaPay' | 'Vodafone Cash') || 'InstaPay';
    const amount = f.amt !== undefined ? Number(f.amt) : targetShop?.price || 599;
    const refNo = f.ref || '';
    const activateShop = f.act !== '0';

    return (
      <Modal title="تسجيل عملية دفع (InstaPay / فودافون كاش)" onClose={close}>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-600">المحل</label>
            <select
              className="inp mt-1"
              value={targetShop?.id || ''}
              onChange={(e) => {
                const chosen = shops.find((x) => x.id === e.target.value);
                setF({ ...f, sid: e.target.value, amt: String(chosen?.price || 599) });
              }}
            >
              {shops.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.name} ({sh.plan})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-600">وسيلة الدفع</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {(['InstaPay', 'Vodafone Cash'] as const).map((pm) => (
                <button
                  key={pm}
                  type="button"
                  onClick={() => setF({ ...f, pm })}
                  className={
                    'p-2.5 rounded-xl border text-sm font-bold cursor-pointer ' +
                    (payMethod === pm
                      ? 'border-[#0284C7] bg-sky-50 text-[#0284C7]'
                      : 'border-[#E2E8F0] bg-[#F8F9FA] text-[#0F172A]')
                  }
                >
                  {pm}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-600">المبلغ المدفوع (ج.م)</label>
            <input className="inp mt-1" type="number" min="1" value={amount} onChange={set('amt')} />
          </div>
          <div>
            <label className="text-xs text-slate-600">رقم المرجع / العملية (Reference Number)</label>
            <input
              className="inp mt-1 font-mono"
              dir="ltr"
              placeholder="مثال: IPN-948271 أو VFC-558210"
              value={refNo}
              onChange={set('ref')}
            />
          </div>
          <label className="flex items-center gap-2 text-xs p-2.5 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] text-[#0F172A] cursor-pointer">
            <input
              type="checkbox"
              checked={activateShop}
              onChange={(e) => setF({ ...f, act: e.target.checked ? '1' : '0' })}
            />
            تفعيل / تمديد اشتراك المحل 30 يوماً تلقائياً
          </label>
          <button
            className="btn btn-p w-full !py-3"
            onClick={async () => {
              if (!targetShop) return;
              if (!refNo.trim()) {
                toast('اكتب رقم المرجع أولاً');
                return;
              }
              await recordPayment({
                shopId: targetShop.id,
                shopName: targetShop.name,
                amount: Math.max(1, amount || 0),
                method: payMethod,
                referenceNo: refNo.trim(),
                status: 'ok',
              });
              if (activateShop) {
                const baseDays =
                  targetShop.status === 'expired' || targetShop.status === 'trial' ? 0 : targetShop.days;
                await updateShop(targetShop.id, {
                  status: 'active',
                  days: baseDays + 30,
                  exp: 'مفعل (شهر)',
                });
              }
              close();
              toast(`تم تسجيل الدفعة (${refNo.trim()}) ✓`);
            }}
          >
            <I n="check" s={16} /> حفظ الدفعة
          </button>
        </div>
      </Modal>
    );
  }

  if (t === 'view3d' && typeof modal !== 'string' && modal.t === 'view3d') {
    const p = modal.p;
    const dims = resolveProductOpticalDimensions(p);
    return (
      <Modal title={p.name} onClose={close} w="max-w-lg">
        <Eyewear3DViewer product={p} />
        <div className="flex justify-between items-center mt-3">
          <span className="text-sm text-slate-600">
            {TYPES[p.type]} · {CATS[p.cat]} · <span className="font-mono">{p.code}</span> ·{' '}
            <span className="font-mono text-[#0284C7] font-bold" dir="ltr">
              {formatOpticalDimensions(dims)} mm
            </span>
          </span>
          <b className="text-[#D97706]">
            <Egp v={p.salePrice && p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price} />
          </b>
        </div>
      </Modal>
    );
  }

  if (t === 'share' && typeof modal !== 'string' && modal.t === 'share') {
    const msg = encodeURIComponent('تفضل رابط متجرنا: ' + modal.link);
    return (
      <Modal title="مشاركة الرابط" onClose={close}>
        <div className="p-3 rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] text-[#0F172A] font-mono text-sm mb-3 truncate" dir="ltr">
          {modal.link}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn btn-g"
            onClick={() => {
              navigator.clipboard
                ?.writeText(modal.link)
                .then(() => toast('تم نسخ الرابط ✓'))
                .catch(() => toast('انسخ الرابط يدوياً'));
            }}
          >
            <I n="copy" s={15} /> نسخ الرابط
          </button>
          <a className="btn btn-p" href={`https://wa.me/?text=${msg}`} target="_blank" rel="noreferrer">
            <I n="msg" s={15} /> واتساب
          </a>
        </div>
      </Modal>
    );
  }

  if (t === 'vote' && typeof modal !== 'string' && modal.t === 'vote') {
    return <VoteModal p={modal.p} p2={modal.p2} link={modal.link} onClose={close} toast={toast} />;
  }

  if (t === 'catitem' && typeof modal !== 'string' && modal.t === 'catitem') {
    const k = modal.kind,
      it = modal.item;
    const setter = k === 'lens' ? setLensTypes : k === 'brand' ? setBrands : setExtras;
    const val = (key: string, d: any) => (f[key] !== undefined ? f[key] : d == null ? '' : String(d));
    const nm = val('n', it?.name),
      en = val('e', it?.en),
      pr = val('p', it?.price);
    const noun = { lens: 'نوع عدسة', brand: 'شركة', extra: 'ميزة حماية' }[k];
    const priceLbl = { lens: 'السعر الأساسي (ج.م)', brand: 'فرق السعر الإضافي (ج.م)', extra: 'السعر (ج.م)' }[k];
    const save = async () => {
      const name = nm.trim();
      const price = parseInt(pr, 10);
      if (!name) {
        toast('اكتب الاسم بالعربي أولاً');
        return;
      }
      if (isNaN(price) || price < 0) {
        toast('اكتب سعراً صحيحاً (0 أو أكثر)');
        return;
      }
      const extra = k !== 'extra' ? { en: en.trim() } : {};
      if (it) {
        const updated = { ...it, shopId: activeShop.id, name, ...extra, price };
        setter((a: any[]) =>
          a.map((x) => (x.id === it.id && (x.shopId || DEFAULT_SHOP_ID) === activeShop.id ? updated : x))
        );
        await syncCatalogItem(k, activeShop.id, 'upsert', updated);
        toast(`تم حفظ التعديلات على "${name}" — ظهرت في متجر العميل فوراً ✓`);
      } else {
        const created = {
          id: k + '_' + Date.now(),
          shopId: activeShop.id,
          name,
          ...extra,
          price,
          disc: 0,
          on: true,
          ...(k === 'lens' ? { desc: '', icon: 'eye' } : {}),
        };
        setter((a: any[]) => [...a, created]);
        await syncCatalogItem(k, activeShop.id, 'upsert', created);
        toast(`تمت إضافة "${name}" — تظهر الآن في متجر العميل ✓`);
      }
      close();
    };
    return (
      <Modal title={it ? `تعديل ${noun}` : `إضافة ${noun}`} onClose={close}>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-600">الاسم بالعربي</label>
            <input
              className="inp mt-1"
              value={nm}
              onChange={set('n')}
              placeholder={k === 'lens' ? 'مثال: فوتوكروميك' : k === 'brand' ? 'مثال: ياباني' : 'مثال: طبقة أوليوفوبيك'}
            />
          </div>
          {k !== 'extra' && (
            <div>
              <label className="text-xs text-slate-600">الاسم بالإنجليزي (اختياري)</label>
              <input
                className="inp mt-1"
                dir="ltr"
                value={en}
                onChange={set('e')}
                placeholder={k === 'lens' ? 'Photochromic' : 'Japanese'}
              />
            </div>
          )}
          <div>
            <label className="text-xs text-slate-600">{priceLbl}</label>
            <input
              className="inp mt-1"
              type="number"
              inputMode="numeric"
              min="0"
              value={pr}
              onChange={set('p')}
              placeholder="0"
            />
          </div>
          <button className="btn btn-p w-full !py-3" onClick={save}>
            <I n="check" s={17} /> {it ? 'حفظ التعديلات' : 'إضافة'}
          </button>
        </div>
      </Modal>
    );
  }

  if (t === 'catdel' && typeof modal !== 'string' && modal.t === 'catdel') {
    const k = modal.kind,
      it = modal.item;
    const setter = k === 'lens' ? setLensTypes : k === 'brand' ? setBrands : setExtras;
    return (
      <Modal title="تأكيد الحذف" onClose={close}>
        <p className="text-sm text-slate-600 mb-4">
          هتحذف <b>"{it.name}"</b> نهائياً وهيختفي من متجر العميل. لو عايز تخفيه مؤقتاً استخدم زر التفعيل/الإخفاء بدل الحذف.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn btn-g" onClick={close}>
            إلغاء
          </button>
          <button
            className="btn btn-d"
            onClick={async () => {
              setter((a: any[]) =>
                a.filter((x) => !(x.id === it.id && (x.shopId || DEFAULT_SHOP_ID) === activeShop.id))
              );
              await syncCatalogItem(k, activeShop.id, 'delete', it);
              close();
              toast(`تم حذف "${it.name}" ✓`);
            }}
          >
            <I n="trash" s={14} /> حذف
          </button>
        </div>
      </Modal>
    );
  }

  if (t === 'disc' && typeof modal !== 'string' && modal.t === 'disc') {
    const k = modal.kind,
      it = modal.item;
    const setter = k === 'lens' ? setLensTypes : k === 'brand' ? setBrands : k === 'extra' ? setExtras : null;
    const d = f.d !== undefined ? f.d : String(it.disc || '');
    const dv = parseInt(d, 10) || 0;
    const save = async () => {
      const v = d === '' ? 0 : parseInt(d, 10);
      if (isNaN(v) || v < 0 || v > 90) {
        toast('اكتب نسبة خصم من 0 إلى 90');
        return;
      }
      if (k === 'prod') {
        await updateProductDiscount(it.id, v);
      } else if (setter) {
        const updated = { ...it, shopId: activeShop.id, disc: v };
        setter((a: any[]) =>
          a.map((x) => (x.id === it.id && (x.shopId || DEFAULT_SHOP_ID) === activeShop.id ? updated : x))
        );
        await syncCatalogItem(k, activeShop.id, 'upsert', updated);
      }
      close();
      toast(
        v
          ? `تم تطبيق خصم ${v}% على "${it.name}" — ظاهر للعملاء الآن ✓`
          : `تم إلغاء الخصم عن "${it.name}" ✓`
      );
    };
    return (
      <Modal title={`خصم على ${it.name}`} onClose={close}>
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {[5, 10, 15, 20, 25, 30].map((n) => (
              <button key={n} className={'chip ' + (dv === n ? 'on' : '')} onClick={() => setF({ ...f, d: String(n) })}>
                {n}%
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs text-slate-600">نسبة الخصم % (0 = بدون خصم)</label>
            <input
              className="inp mt-1"
              type="number"
              inputMode="numeric"
              min="0"
              max="90"
              value={d}
              onChange={set('d')}
              placeholder="0"
            />
          </div>
          <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 text-sm flex justify-between">
            <span className="text-slate-600">السعر بعد الخصم</span>
            <b className="text-[#059669]">
              <Egp v={Math.round(it.price * (1 - dv / 100))} />
            </b>
          </div>
          <button className="btn btn-p w-full !py-3" onClick={save}>
            <I n="check" s={17} /> حفظ الخصم
          </button>
        </div>
      </Modal>
    );
  }

  if (t === 'ba' && typeof modal !== 'string' && modal.t === 'ba') {
    return (
      <Modal title="شاهد الفرق بعينك" onClose={close}>
        <BeforeAfter lens={modal.lens} />
      </Modal>
    );
  }

  if (t === 'zoom' && typeof modal !== 'string' && modal.t === 'zoom') {
    return <ZoomModal q={modal.q} onClose={close} />;
  }

  if (t === 'confirmq' && typeof modal !== 'string' && modal.t === 'confirmq') {
    return <ConfirmModal q={modal.q} onClose={close} />;
  }

  if (t === 'altq' && typeof modal !== 'string' && modal.t === 'altq') {
    return <AltModal q={modal.q} onClose={close} />;
  }

  if (t === 'sent' && typeof modal !== 'string' && modal.t === 'sent') {
    const q = modal.q;
    const msg = encodeURIComponent(
      `مرحباً ${activeShop.name}، أنا ${q.cust}.\nاخترت ${q.frameName} مع ${q.lensName} (${q.brandName}) — التفاصيل: ${q.extrasTxt}.\nالسعر المبدئي: ${fmt(q.price)} ج.م${
        q.pd ? '\nPD: ' + q.pd : ''
      }${q.notes ? '\nملاحظات: ' + q.notes : ''}\nرقم الاستفسار ${q.id} — برجاء مراجعة الكشف وتأكيد الملاءمة والسعر النهائي.`
    );
    return (
      <Modal title="تم إرسال استفسارك 🎉" onClose={close}>
        <div className="text-center">
          <span className="w-16 h-16 rounded-full b-ok inline-flex items-center justify-center mb-3">
            <I n="check" s={32} />
          </span>
          <div className="font-extrabold text-lg mb-1">رقم الاستفسار {q.id}</div>
          <p className="text-sm text-slate-600 mb-4 leading-7">
            وصل الطلب لصندوق المحل. كمّل على واتساب وهيأكد لك المحل كل التفاصيل والسعر النهائي.
          </p>
          <a
            className="btn btn-p w-full !py-3"
            href={`https://wa.me/${waNum(activeShop.wa)}?text=${msg}`}
            target="_blank"
            rel="noreferrer"
          >
            <I n="msg" s={18} /> فتح واتساب المحل
          </a>
          <button className="btn btn-g w-full mt-2" onClick={close}>
            تم
          </button>
        </div>
      </Modal>
    );
  }

  if (t === 'checkout' && typeof modal !== 'string' && modal.t === 'checkout') {
    const storeDisplayName = (activeShop.name || '').trim() || 'المتجر';
    const deliveryEnabled = Boolean(activeShop.enableDeliveryService);
    const wantsDelivery = deliveryEnabled && f.dlv === 'delivery';
    const deliveryFee = wantsDelivery ? Number(activeShop.deliveryFee || 0) : 0;
    const grandTotal = modal.total + deliveryFee;

    const handleCheckoutRxFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      try {
        if (isPdf) {
          if (file.size > 5 * 1024 * 1024) {
            toast('حجم ملف الـ PDF يتجاوز الحد المسموح (5 ميجابايت)');
            return;
          }
          const ref = await uploadRxPrescriptionToStorage(activeShop.id, file, 'pdf');
          setCheckoutRxPreview('pdf');
          setCheckoutRxRef(ref);
          toast('تم إرفاق ملف الكشف الطبي ✓');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => setCheckoutRxPreview(String(reader.result || ''));
        reader.readAsDataURL(file);
        const canvas = await loadImageToCanvas(file, 1600);
        let blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
        if (blob.size > 4_800_000) blob = await canvasToBlob(canvas, 'image/jpeg', 0.65);
        const ref = await uploadRxPrescriptionToStorage(activeShop.id, blob, 'jpg');
        setCheckoutRxRef(ref);
        toast('تم رفع صورة الكشف الطبي ✓');
      } catch {
        toast('تعذر رفع ملف الكشف الطبي');
      }
    };

    const submit = async () => {
      if (!f.n || !f.p) {
        toast('اكتب الاسم ورقم الموبايل');
        return;
      }
      if (wantsDelivery && !f.addr?.trim()) {
        toast('اكتب عنوان التوصيل بالتفصيل');
        return;
      }
      const deliveryTxt = wantsDelivery
        ? `توصيل للمنزل (${f.gov || activeShop.governorate || 'القاهرة'} - ${f.addr?.trim()}) · مصاريف شحن ${fmt(deliveryFee)} ج.م`
        : 'استلام من المحل';

      const q: Inquiry = {
        id: '#O-' + (400 + Math.floor(Math.random() * 500)),
        shopId: activeShop.id,
        kind: checkoutRxRef ? 'rx' : 'order',
        cust: f.n.trim(),
        phone: f.p.trim(),
        frameName: cart.map((i) => (i.size ? `${i.name} (${i.size})` : i.name)).join(' + '),
        type: cart[0]?.type || 'aviator',
        frame: cart[0]?.frame || '#C9A24B',
        lens: cart[0]?.lens || '#475569',
        lensName: 'تحديد العدسات مع أخصائي المحل (موصى به)',
        brandName: checkoutRxRef ? 'يُحدد مع المحل' : '—',
        extrasTxt: deliveryTxt,
        fp: modal.total,
        lensPrice: 0,
        add: deliveryFee,
        price: grandTotal,
        img: checkoutRxRef,
        notes: `الدفع عبر ${f.pay || 'InstaPay'} · ${deliveryTxt}`,
        pd: f.pd?.trim() || '',
        deliveryAddress: wantsDelivery ? f.addr?.trim() : undefined,
        governorate: wantsDelivery ? (f.gov || activeShop.governorate || 'القاهرة') : undefined,
        deliveryFee,
        status: 'new',
        stage: 'review',
        time: 'الآن',
        mine: true,
        rxn: 0,
        pay: f.pay || 'InstaPay',
      };
      await addInquiry(q);
      setDone(q);
      setCart([]);
    };

    if (done) {
      const deliveryLine = done.deliveryAddress
        ? `\nالتوصيل إلى: ${done.governorate || ''} - ${done.deliveryAddress} (الشحن: ${fmt(done.deliveryFee || 0)} ج.م)`
        : '';
      const msg = encodeURIComponent(
        `مرحباً ${activeShop.name}، أنا ${done.cust}، طلبت (${done.frameName}) بإجمالي ${fmt(done.price)} ج.م — رقم الطلب ${done.id}. الدفع عبر ${done.pay}.${deliveryLine}`
      );
      return (
        <Modal title="تم تسجيل طلبك 🎉" onClose={close}>
          <div className="text-center">
            <span className="w-16 h-16 rounded-full b-ok inline-flex items-center justify-center mb-3">
              <I n="check" s={32} />
            </span>
            <div className="font-extrabold text-lg mb-1">رقم الطلب {done.id}</div>
            <p className="text-sm text-slate-600 mb-4">أكمل الآن مع المحل على واتساب لتأكيد الطلب</p>
            <a
              className="btn btn-p w-full !py-3"
              href={`https://wa.me/${waNum(activeShop.wa)}?text=${msg}`}
              target="_blank"
              rel="noreferrer"
            >
              <I n="msg" s={18} /> فتح واتساب المحل
            </a>
            <button className="btn btn-g w-full mt-2" onClick={close}>
              تم
            </button>
          </div>
        </Modal>
      );
    }

    return (
        <Modal title={`إتمام الطلب — ${storeDisplayName}`} onClose={close}>
        <div className="space-y-3">
          <input className="inp" placeholder="اسمك" value={f.n || ''} onChange={set('n')} />
          <input className="inp" dir="ltr" placeholder="رقم الموبايل" value={f.p || ''} onChange={set('p')} />
          <input className="inp" dir="ltr" placeholder="مقاس PD (اختياري)" value={f.pd || ''} onChange={set('pd')} />

          {!checkoutRxRef ? (
            <label className="rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/40 hover:bg-sky-50 p-3 text-center cursor-pointer block transition">
              <div className="text-xs font-extrabold text-[#0F172A]">
                📸 رفع صورة الكشف الطبي مباشرة (اختياري)
              </div>
              <div className="text-[0.68rem] text-slate-500 mt-0.5">
                الافتراضي: تحديد العدسات مع أخصائي المحل (موصى به)
              </div>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={handleCheckoutRxFile}
              />
            </label>
          ) : (
            <div className="rounded-xl bg-[#F8F9FA] border border-emerald-300 p-2.5 flex items-center gap-2.5">
              <div className="w-12 h-12 rounded-lg overflow-hidden border border-slate-200 bg-white flex items-center justify-center shrink-0">
                {checkoutRxPreview === 'pdf' ? (
                  <span className="text-[0.65rem] font-bold">PDF</span>
                ) : (
                  <img src={checkoutRxPreview || ''} alt="كشف" className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 text-xs font-bold text-[#059669]">✓ تم إرفاق صورة الكشف الطبي</div>
              <button
                type="button"
                className="btn btn-d btn-sm"
                onClick={() => {
                  setCheckoutRxRef(null);
                  setCheckoutRxPreview(null);
                }}
              >
                <I n="trash" s={13} />
              </button>
            </div>
          )}

          {deliveryEnabled && (
            <div className="rounded-xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 space-y-2.5">
              <div className="text-xs font-bold text-[#0F172A]">طريقة الاستلام</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setF({ ...f, dlv: 'pickup' })}
                  className={
                    'p-2 rounded-xl border text-xs font-bold cursor-pointer ' +
                    (!wantsDelivery ? 'border-[#0284C7] bg-sky-50 text-[#0284C7]' : 'border-[#E2E8F0] bg-white text-slate-700')
                  }
                >
                  استلام من المحل (مجاناً)
                </button>
                <button
                  type="button"
                  onClick={() => setF({ ...f, dlv: 'delivery' })}
                  className={
                    'p-2 rounded-xl border text-xs font-bold cursor-pointer ' +
                    (wantsDelivery ? 'border-[#0284C7] bg-sky-50 text-[#0284C7]' : 'border-[#E2E8F0] bg-white text-slate-700')
                  }
                >
                  توصيل للمنزل (+{fmt(activeShop.deliveryFee || 0)} ج.م)
                </button>
              </div>
              {wantsDelivery && (
                <div className="space-y-2 pt-1">
                  <select className="inp" value={f.gov || activeShop.governorate || 'القاهرة'} onChange={set('gov')}>
                    {EGYPT_GOVERNORATES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <input
                    className="inp"
                    placeholder="العنوان بالتفصيل (الشارع، العمارة، علامة مميزة)"
                    value={f.addr || ''}
                    onChange={set('addr')}
                  />
                </div>
              )}
            </div>
          )}

          <div className="text-xs text-slate-600">طريقة الدفع</div>
          <div className="grid grid-cols-2 gap-2">
            {['InstaPay', 'Vodafone Cash'].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setF({ ...f, pay: p })}
                className={
                  'p-3 rounded-xl border font-bold text-sm cursor-pointer ' +
                  ((f.pay || 'InstaPay') === p
                    ? 'border-[#0284C7] bg-sky-50 text-[#0284C7]'
                    : 'border-[#E2E8F0] bg-[#F8F9FA] text-[#0F172A]')
                }
              >
                {p}
              </button>
            ))}
          </div>

          <div className="space-y-1 pt-2 border-t border-[#E2E8F0] text-[#0F172A]">
            {wantsDelivery && (
              <div className="flex justify-between text-xs text-slate-600">
                <span>التوصيل للمنزل</span>
                <span>+{fmt(deliveryFee)} ج.م</span>
              </div>
            )}
            <div className="flex justify-between font-extrabold">
              <span>الإجمالي</span>
              <span className="text-[#D97706]">
                <Egp v={grandTotal} />
              </span>
            </div>
          </div>

          <button className="btn bg-[#D97706] hover:bg-[#B45309] text-white w-full !py-3 shadow-sm" onClick={submit}>
            <I n="msg" s={17} /> إرسال الطلب عبر واتساب
          </button>
        </div>
      </Modal>
    );
  }

  return null;
}
