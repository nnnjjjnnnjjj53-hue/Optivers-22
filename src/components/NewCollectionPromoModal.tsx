import React, { useEffect, useState } from 'react';
import { Shop } from '../types';
import { I } from './Icons';
import { Modal, fmt } from './UiShared';

export interface CollectionPosterFrame {
  id: string;
  name: string;
  price: number;
  imageUrl?: string;
  code?: string;
}

interface NewCollectionPromoModalProps {
  open: boolean;
  onClose: () => void;
  shop: Shop;
  frames: CollectionPosterFrame[];
  onToast?: (msg: string) => void;
}

function loadImgSafe(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    if (/^https?:/i.test(url)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function NewCollectionPromoModal({
  open,
  onClose,
  shop,
  frames,
  onToast,
}: NewCollectionPromoModalProps) {
  const [posterUrl, setPosterUrl] = useState<string>('');
  const [generating, setGenerating] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://optiverse.app';
  const storeUrl = `${origin}/s/${shop.slug}`;
  const top4 = frames.slice(0, 4);

  const promoText = [
    `✨ وصل حديثاً في ${shop.name}!`,
    `تشكيلة نظارات جديدة (${frames.length} موديلات حصرية) متاحة الآن للتجربة الافتراضية على وجهك بالكاميرا بمقاس 1:1 mm 📸`,
    top4.length ? `أبرز الموديلات: ${top4.map((f) => f.name).join(' · ')}` : '',
    `جرّبها الآن واطلب مباشرة:`,
    storeUrl,
  ]
    .filter(Boolean)
    .join('\n');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const renderPoster = async () => {
      setGenerating(true);
      try {
        const W = 1080;
        const H = 1920;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Luxury Navy-Slate Vertical Background
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, '#0F172A');
        bgGrad.addColorStop(0.55, '#1E293B');
        bgGrad.addColorStop(1, '#0B1120');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Subtle Gold Ambient Glow Top
        const radial = ctx.createRadialGradient(W / 2, 260, 40, W / 2, 260, 620);
        radial.addColorStop(0, 'rgba(217, 119, 6, 0.25)');
        radial.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = radial;
        ctx.fillRect(0, 0, W, 900);

        // Outer Luxury Gold Border
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
        ctx.lineWidth = 4;
        drawRoundedRect(ctx, 36, 36, W - 72, H - 72, 48);
        ctx.stroke();

        // Store Logo Circle / Badge
        const isLogoUrl = Boolean(shop.logo && /^(https?:|data:image\/|blob:|\/)/i.test(shop.logo));
        const logoImg = isLogoUrl ? await loadImgSafe(shop.logo) : null;
        if (cancelled) return;

        ctx.save();
        ctx.fillStyle = '#FFFFFF';
        drawRoundedRect(ctx, W / 2 - 76, 95, 152, 152, 36);
        ctx.fill();
        if (logoImg) {
          ctx.clip();
          const scale = Math.min(126 / logoImg.width, 126 / logoImg.height);
          const dw = logoImg.width * scale;
          const dh = logoImg.height * scale;
          ctx.drawImage(logoImg, W / 2 - dw / 2, 95 + (152 - dh) / 2, dw, dh);
        } else {
          ctx.fillStyle = '#0F172A';
          ctx.font = 'bold 64px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(shop.logo || '👓', W / 2, 171);
        }
        ctx.restore();

        // Store Name
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 54px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(shop.name, W / 2, 318);

        // Headline Banner
        ctx.fillStyle = '#FBBF24';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText('✨ NEW COLLECTION · كوليكشن جديد ✨', W / 2, 378);

        // Required Tagline
        ctx.fillStyle = '#E2E8F0';
        ctx.font = 'bold 38px sans-serif';
        ctx.fillText('تشكيلة جديدة متوفرة الآن للتجربة بالكاميرا', W / 2, 444);

        // 2x2 Grid of First 4 Frames
        const loadedImgs = await Promise.all(
          top4.map((f) => (f.imageUrl ? loadImgSafe(f.imageUrl) : Promise.resolve(null)))
        );
        if (cancelled) return;

        const padX = 76;
        const gap = 34;
        const cardW = (W - padX * 2 - gap) / 2;
        const cardH = 475;
        const gridTop = 515;

        for (let i = 0; i < 4; i++) {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const cx = padX + col * (cardW + gap);
          const cy = gridTop + row * (cardH + gap);
          const frame = top4[i];

          // Card surface
          ctx.fillStyle = '#F8F9FA';
          drawRoundedRect(ctx, cx, cy, cardW, cardH, 32);
          ctx.fill();

          ctx.strokeStyle = '#E2E8F0';
          ctx.lineWidth = 2;
          drawRoundedRect(ctx, cx, cy, cardW, cardH, 32);
          ctx.stroke();

          if (frame) {
            // Badge "جديد"
            ctx.fillStyle = '#D97706';
            drawRoundedRect(ctx, cx + 22, cy + 22, 108, 42, 14);
            ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 22px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('جديد ✨', cx + 76, cy + 50);

            const fImg = loadedImgs[i];
            if (fImg) {
              const boxW = cardW - 48;
              const boxH = 260;
              const scale = Math.min(boxW / fImg.width, boxH / fImg.height);
              const dw = fImg.width * scale;
              const dh = fImg.height * scale;
              ctx.drawImage(fImg, cx + (cardW - dw) / 2, cy + 84 + (boxH - dh) / 2, dw, dh);
            }

            // Frame Title
            ctx.fillStyle = '#0F172A';
            ctx.font = 'bold 28px sans-serif';
            ctx.textAlign = 'center';
            const cleanTitle = frame.name.length > 20 ? frame.name.slice(0, 19) + '…' : frame.name;
            ctx.fillText(cleanTitle, cx + cardW / 2, cy + 394);

            // Price Tag
            ctx.fillStyle = '#0284C7';
            ctx.font = 'bold 28px sans-serif';
            ctx.fillText(`${fmt(frame.price)} ج.م`, cx + cardW / 2, cy + 440);
          } else {
            ctx.fillStyle = '#94A3B8';
            ctx.font = 'bold 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(shop.name, cx + cardW / 2, cy + cardH / 2);
          }
        }

        // Bottom CTA Pill
        ctx.fillStyle = '#0284C7';
        drawRoundedRect(ctx, 110, 1595, W - 220, 110, 55);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('افتح الكاميرا وجرّب الكوليكشن على وجهك الآن 📸', W / 2, 1662);

        // Footer Store Link
        ctx.fillStyle = '#94A3B8';
        ctx.font = '26px monospace';
        ctx.fillText(storeUrl.replace(/^https?:\/\//, ''), W / 2, 1775);

        ctx.fillStyle = '#FDE68A';
        ctx.font = 'bold 26px sans-serif';
        ctx.fillText('متوفر الآن عبر متجرنا الإلكتروني · تجربة 1:1 mm', W / 2, 1825);

        if (!cancelled) {
          setPosterUrl(canvas.toDataURL('image/png'));
        }
      } finally {
        if (!cancelled) setGenerating(false);
      }
    };

    void renderPoster();
    return () => {
      cancelled = true;
    };
  }, [open, shop.name, shop.logo, shop.slug, storeUrl, frames.length]);

  if (!open) return null;

  const handleDownloadPoster = () => {
    if (!posterUrl) return;
    const a = document.createElement('a');
    a.href = posterUrl;
    a.download = `new-collection-story-${shop.slug || 'optiverse'}.png`;
    a.click();
    onToast?.('تم تحميل بوستر الستوري بنجاح 📲');
  };

  const handleCopyCopy = () => {
    navigator.clipboard
      ?.writeText(promoText)
      .then(() => onToast?.('تم نسخ نص الترويج ✓'))
      .catch(() => onToast?.('انسخ النص يدوياً'));
  };

  const waHref = `https://wa.me/?text=${encodeURIComponent(promoText)}`;
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(storeUrl)}&quote=${encodeURIComponent(promoText)}`;

  return (
    <Modal title="نافذة الترويج الفوري للكوليكشن ✨" onClose={onClose} w="max-w-3xl">
      <div className="space-y-4">
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-950 font-bold flex flex-wrap items-center justify-between gap-2">
          <span>
            🎉 تم تمييز {frames.length} نظارات بوسم «كوليكشن جديد ✨» في متجرك لمدة 7 أيام!
          </span>
          <span className="px-2 py-0.5 rounded-full bg-amber-200/70 text-amber-900 font-mono text-[0.7rem]">
            4-in-1 Story Ready
          </span>
        </div>

        <div className="grid md:grid-cols-12 gap-4 items-start">
          {/* 4-in-1 Story Poster Canvas Preview */}
          <div className="md:col-span-5 flex flex-col items-center gap-2.5">
            <div className="w-full max-w-[240px] aspect-[9/16] rounded-2xl bg-[#0F172A] border border-slate-300 overflow-hidden shadow-xl flex items-center justify-center">
              {generating || !posterUrl ? (
                <div className="text-center text-white/80 text-xs space-y-2 p-4">
                  <div className="w-6 h-6 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mx-auto" />
                  <div>جاري تصميم بوستر الستوري...</div>
                </div>
              ) : (
                <img
                  src={posterUrl}
                  alt="بوستر ستوري الكوليكشن الجديد"
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            <button
              type="button"
              disabled={!posterUrl || generating}
              onClick={handleDownloadPoster}
              className="w-full max-w-[240px] py-2.5 px-3 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition disabled:opacity-50 shadow-sm"
            >
              <span>تحميل بوستر الستوري 📲</span>
            </button>
          </div>

          {/* Pre-composed Copy & Direct Social Share Buttons */}
          <div className="md:col-span-7 space-y-3">
            <div className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-[#0F172A]">رسالة الترويج الجاهزة</span>
                <button
                  type="button"
                  onClick={handleCopyCopy}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-[0.7rem] font-bold text-slate-800 hover:bg-slate-100 cursor-pointer flex items-center gap-1"
                >
                  <I n="copy" s={12} /> نسخ النص
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-xs text-slate-700 leading-6 font-sans bg-white rounded-xl border border-slate-200 p-2.5">
                {promoText}
              </pre>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-extrabold text-[#0F172A]">مشاركة فورية على المنصات:</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <a
                  href={waHref}
                  target="_blank"
                  rel="noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <I n="msg" s={14} /> واتساب
                </a>
                <a
                  href={fbHref}
                  target="_blank"
                  rel="noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <I n="share" s={14} /> فيسبوك
                </a>
                <a
                  href="https://www.instagram.com/"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    handleDownloadPoster();
                    handleCopyCopy();
                    onToast?.('تم حفظ البوستر ونسخ النص — انشره في ستوري إنستغرام الآن 📸');
                  }}
                  className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-amber-500 hover:opacity-95 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <I n="camera" s={14} /> ستوري إنستغرام
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
