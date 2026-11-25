import React from 'react';
import { FrameType } from '../types';
import { Face } from './GlassesGraphics';
import { I } from './Icons';

export function PhotoUploadGuidelines() {
  return (
    <div className="rounded-xl bg-sky-50 border border-sky-200 p-3 text-xs space-y-1.5 text-[#0F172A]">
      <div className="font-extrabold text-[#0284C7] flex items-center gap-1.5">
        <I n="spark" s={14} /> إرشادات تصوير الإطار للحصول على تجربة واقعية مطابقة للطبيعة:
      </div>
      <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-[0.72rem] text-slate-700 list-disc list-inside">
        <li>لقطة أمامية مستقيمة تماماً على مستوى العين</li>
        <li>ذات الأذرع المطوية للخلف بحيث تكون مخفية خلف الإطار</li>
        <li>خلفية فاتحة سادة أو بلون موحد نظيف</li>
        <li>إضاءة متساوية بدون ظلال قاسية أو لمعان حاد</li>
        <li>ملء الإطار لعرض الصورة بأكبر مساحة ممكنة</li>
      </ul>
    </div>
  );
}

export function FrameFitPreview({
  cutoutUrl,
  storeFrontUrl,
  type = 'wayfarer',
  fitScale,
  eyeLineOffset,
  onChangeFitScale,
  onChangeEyeLineOffset,
  compact = false,
}: {
  cutoutUrl: string;
  storeFrontUrl?: string;
  type?: FrameType;
  fitScale: number;
  eyeLineOffset: number;
  onChangeFitScale: (v: number) => void;
  onChangeEyeLineOffset: (v: number) => void;
  compact?: boolean;
}) {
  const finalStoreUrl = storeFrontUrl || cutoutUrl;

  return (
    <div className="space-y-2.5">
      {/* ONLY 2 clean preview boxes side-by-side: 1. Final Store Photo (#F8F7F4)  2. Face Alignment Preview */}
      <div className="grid grid-cols-2 gap-2">
        <div
          className={
            'relative rounded-xl border border-[#E5E3DE] bg-[#F8F7F4] flex items-center justify-center overflow-hidden p-2.5 ' +
            (compact ? 'h-32' : 'h-40')
          }
        >
          <span className="absolute top-1.5 start-1.5 z-10 px-1.5 py-0.5 rounded bg-[#141414]/80 text-white text-[0.58rem] font-bold">
            النتيجة النهائية
          </span>
          <img
            src={finalStoreUrl}
            alt="النتيجة النهائية"
            loading="lazy"
            decoding="async"
            className="max-h-full max-w-full object-contain"
            style={{ filter: 'drop-shadow(0 8px 12px rgba(20, 20, 20, 0.14))' }}
          />
        </div>

        <div
          className={
            'relative rounded-xl bg-slate-900 border border-slate-300 flex items-center justify-center overflow-hidden ' +
            (compact ? 'h-32' : 'h-40')
          }
        >
          <span className="absolute top-1.5 start-1.5 z-10 px-1.5 py-0.5 rounded bg-black/70 text-sky-200 text-[0.58rem] font-bold">
            معاينة على الوجه
          </span>
          <div className="relative h-full aspect-[300/360]">
            <Face
              shape="oval"
              type={type}
              frame="transparent"
              lens="transparent"
              yaw={0}
              tracking={false}
              pd={false}
            />
            <img
              src={cutoutUrl}
              alt="معاينة التثبيت على الوجه"
              loading="lazy"
              decoding="async"
              className="absolute pointer-events-none select-none object-contain"
              style={{
                left: '50%',
                top: '42.2%',
                width: `${(54.6 * fitScale).toFixed(2)}%`,
                transform: `translate(-50%, calc(-50% + ${(eyeLineOffset * 100).toFixed(2)}%))`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Fit sliders wrapped cleanly in dir="ltr" so RTL layout never inverts range direction or numbers */}
      <div className="grid sm:grid-cols-2 gap-2 rounded-xl bg-white border border-slate-200 text-[#0F172A] p-2.5 text-[0.68rem]">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-slate-600 font-semibold">مقياس الملاءمة (fitScale)</span>
            <span dir="ltr" className="font-mono text-[#0284C7] font-bold tabular-nums">
              {fitScale.toFixed(2)}
            </span>
          </div>
          <div dir="ltr">
            <input
              type="range"
              dir="ltr"
              min={0.85}
              max={1.15}
              step={0.01}
              value={fitScale}
              onChange={(e) => onChangeFitScale(Number(e.target.value))}
              className="w-full accent-[#0284C7] cursor-pointer"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-slate-600 font-semibold">محاذاة خط العين (eyeLineOffset)</span>
            <span dir="ltr" className="font-mono text-[#0284C7] font-bold tabular-nums">
              {eyeLineOffset >= 0 ? `+${eyeLineOffset.toFixed(2)}` : eyeLineOffset.toFixed(2)}
            </span>
          </div>
          <div dir="ltr">
            <input
              type="range"
              dir="ltr"
              min={-0.15}
              max={0.15}
              step={0.01}
              value={eyeLineOffset}
              onChange={(e) => onChangeEyeLineOffset(Number(e.target.value))}
              className="w-full accent-[#0284C7] cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
