import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { I } from './Icons';

export interface VisualPhotographyGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'all' | 'front' | 'side' | 'clipon';
}

export function VisualPhotographyGuideModal({
  isOpen,
  onClose,
  initialTab = 'all',
}: VisualPhotographyGuideModalProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'front' | 'side' | 'clipon'>(initialTab);
  const [frontViewMode, setFrontViewMode] = useState<'correct' | 'mistake'>('correct');
  const [clipOnMounted, setClipOnMounted] = useState<boolean>(true);

  if (!isOpen) return null;

  const modalNode = (
    <div
      dir="rtl"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md fade overflow-y-auto"
      style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-3xl max-w-4xl w-full my-auto shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
        style={{ backgroundColor: '#FFFFFF' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-7 py-4 border-b border-slate-200 bg-[#F8F9FA] shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-sky-50 text-[#0284C7] border border-sky-200 flex items-center justify-center text-xl shrink-0">
              📸
            </span>
            <div>
              <h2 className="font-extrabold text-base sm:text-lg text-slate-900 leading-tight">
                دليل التصوير المصور للإطارات
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                إرشادات عملية لتجهيز صور استوديو فائقة الجودة وتجربة افتراضية دقيقة 1:1
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-2xl bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-900 border border-slate-200 flex items-center justify-center font-bold text-sm transition cursor-pointer shadow-xs shrink-0"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation Chips */}
        <div className="flex items-center gap-1.5 px-5 sm:px-7 pt-3.5 pb-2 border-b border-slate-100 overflow-x-auto no-scrollbar shrink-0 bg-white">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={
              'px-3.5 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition cursor-pointer shrink-0 ' +
              (activeTab === 'all'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
            }
          >
            عرض الكل (3 كروت) 📋
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('front')}
            className={
              'px-3.5 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition cursor-pointer shrink-0 ' +
              (activeTab === 'front'
                ? 'bg-[#0284C7] text-white shadow-sm'
                : 'bg-sky-50 text-[#0284C7] border border-sky-200 hover:bg-sky-100')
            }
          >
            1. الصورة الأمامية (Front Shot) 👓
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('side')}
            className={
              'px-3.5 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition cursor-pointer shrink-0 ' +
              (activeTab === 'side'
                ? 'bg-[#0F172A] text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
            }
          >
            2. الزاوية الجانبية 3/4 (Side Shot) 📐
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('clipon')}
            className={
              'px-3.5 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition cursor-pointer shrink-0 ' +
              (activeTab === 'clipon'
                ? 'bg-[#D97706] text-white shadow-sm'
                : 'bg-amber-50 text-[#B45309] border border-amber-200 hover:bg-amber-100')
            }
          >
            3. نظارات بغيار شمس (Clip-On) ⚠️
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-7 overflow-y-auto space-y-6 flex-1">
          {/* Quick Overview Info Banner */}
          <div className="rounded-2xl bg-gradient-to-r from-sky-50 via-indigo-50 to-amber-50 border border-sky-200/80 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0284C7] animate-pulse shrink-0" />
              <span className="font-extrabold text-slate-900">
                لكل نظارة تحتاج صورتين فقط:
              </span>
              <span className="text-slate-700">
                صورة <b className="text-[#0284C7]">أمامية مستقيمة</b> + صورة <b className="text-slate-900">جانبية 3/4</b>.
              </span>
            </div>
            <div className="text-slate-500 font-mono text-[0.72rem]">
              خلفية فاتحة موحدة · إضاءة ناعمة بدون ظلال
            </div>
          </div>

          <div
            className={
              'grid gap-5 sm:gap-6 ' +
              (activeTab === 'all' ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1')
            }
          >
            {/* Card 1: Front Shot */}
            {(activeTab === 'all' || activeTab === 'front') && (
              <div className="rounded-3xl bg-white border border-slate-200 p-4 sm:p-5 shadow-sm hover:border-[#0284C7]/60 transition flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="badge !bg-sky-50 !text-[#0284C7] !border-sky-200 font-extrabold text-[0.7rem]">
                      الكارت 1 · لقطة مستقيمة 0°
                    </span>
                    <span className="text-slate-400 text-xs font-mono">Front 0°</span>
                  </div>
                  <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                    <span>الصور الأمامية (Front Shot)</span>
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1.5 leading-6">
                    ضع الإطار على خلفية فاتحة سادة، وتأكد من استقامة النظارة تماماً على مستوى الكاميرا،{' '}
                    <b className="text-[#0284C7]">مع طي الأذرع للخلف خلف الإطار</b> حتى لا تظهر وتتداخل مع تفريغ العدسات.
                  </p>
                </div>

                {/* Illustration: SVG Front Shot Diagram */}
                <div className="rounded-2xl bg-gradient-to-b from-[#F8F9FA] to-[#EDF2F7] border border-slate-200/90 p-3 sm:p-4 relative overflow-hidden">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[0.68rem] font-extrabold text-slate-700 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      الرسم التوضيحي للأذرع المطوية
                    </span>
                    {activeTab === 'front' && (
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-[0.65rem] font-bold">
                        <button
                          type="button"
                          onClick={() => setFrontViewMode('correct')}
                          className={
                            'px-2 py-0.5 rounded-md transition ' +
                            (frontViewMode === 'correct'
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-600 hover:text-slate-900')
                          }
                        >
                          صحيح ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => setFrontViewMode('mistake')}
                          className={
                            'px-2 py-0.5 rounded-md transition ' +
                            (frontViewMode === 'mistake'
                              ? 'bg-rose-600 text-white'
                              : 'text-slate-600 hover:text-slate-900')
                          }
                        >
                          خطأ شائع ✕
                        </button>
                      </div>
                    )}
                  </div>

                  <svg
                    viewBox="0 0 320 170"
                    className="w-full h-auto max-h-[160px] mx-auto select-none"
                    aria-label="رسم توضيحي للصورة الأمامية"
                  >
                    <defs>
                      <linearGradient id="frontRimGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#1E293B" />
                        <stop offset="100%" stopColor="#0F172A" />
                      </linearGradient>
                      <linearGradient id="lensClearGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#E0F2FE" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#BAE6FD" stopOpacity="0.25" />
                      </linearGradient>
                      <linearGradient id="badTempleGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#EF4444" stopOpacity="0.9" />
                        <stop offset="100%" stopColor="#B91C1C" stopOpacity="0.7" />
                      </linearGradient>
                    </defs>

                    {/* Studio Ground Shadow */}
                    <ellipse cx="160" cy="148" rx="120" ry="12" fill="#0F172A" opacity="0.08" />
                    <line x1="30" y1="148" x2="290" y2="148" stroke="#CBD5E1" strokeDasharray="3 3" strokeWidth="1" />
                    <text x="160" y="163" textAnchor="middle" fontSize="9" fill="#64748B" fontWeight="bold">
                      مستوى السطح الأفقي (استقامة 0°)
                    </text>

                    {/* If mistake mode: show open temple arms extending visibly inside the lenses */}
                    {frontViewMode === 'mistake' && (
                      <g className="animate-pulse">
                        {/* Left open temple poking across */}
                        <path
                          d="M60 85 L145 102"
                          stroke="url(#badTempleGrad)"
                          strokeWidth="8"
                          strokeLinecap="round"
                        />
                        {/* Right open temple poking across */}
                        <path
                          d="M260 85 L175 102"
                          stroke="url(#badTempleGrad)"
                          strokeWidth="8"
                          strokeLinecap="round"
                        />
                        <rect x="75" y="40" width="170" height="22" rx="6" fill="#FEE2E2" stroke="#F87171" strokeWidth="1" />
                        <text x="160" y="55" textAnchor="middle" fontSize="10" fill="#991B1B" fontWeight="extrabold">
                          ✕ خطأ: الأذرع ظاهرة خلف العدسة
                        </text>
                      </g>
                    )}

                    {/* Correct mode: Folded temples hidden behind the frame with green indicator arrows */}
                    {frontViewMode === 'correct' && (
                      <g>
                        {/* Folded temple hints tucked strictly behind frame */}
                        <path
                          d="M58 85 Q90 90 120 88"
                          stroke="#94A3B8"
                          strokeWidth="4"
                          strokeDasharray="4 3"
                          opacity="0.4"
                        />
                        <path
                          d="M262 85 Q230 90 200 88"
                          stroke="#94A3B8"
                          strokeWidth="4"
                          strokeDasharray="4 3"
                          opacity="0.4"
                        />
                        {/* Left folded temple arrow pointing backward */}
                        <path
                          d="M50 68 Q38 52 24 64"
                          fill="none"
                          stroke="#059669"
                          strokeWidth="2"
                          markerEnd="url(#arrowhead)"
                        />
                        <path d="M22 66 L24 64 L20 62" fill="none" stroke="#059669" strokeWidth="2" />
                        {/* Right folded temple arrow */}
                        <path
                          d="M270 68 Q282 52 296 64"
                          fill="none"
                          stroke="#059669"
                          strokeWidth="2"
                        />
                        <path d="M298 66 L296 64 L300 62" fill="none" stroke="#059669" strokeWidth="2" />
                      </g>
                    )}

                    {/* Eyewear Front Frame Geometry */}
                    {/* Left Rim */}
                    <rect
                      x="56"
                      y="68"
                      width="92"
                      height="58"
                      rx="14"
                      fill="url(#frontRimGrad)"
                      stroke="#0F172A"
                      strokeWidth="2"
                    />
                    {/* Left Lens Cavity */}
                    <rect
                      x="64"
                      y="74"
                      width="76"
                      height="46"
                      rx="10"
                      fill="url(#lensClearGrad)"
                      stroke="#38BDF8"
                      strokeWidth="1.2"
                    />
                    {/* Lens Clean Glare Line */}
                    <line x1="72" y1="78" x2="98" y2="78" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />

                    {/* Right Rim */}
                    <rect
                      x="172"
                      y="68"
                      width="92"
                      height="58"
                      rx="14"
                      fill="url(#frontRimGrad)"
                      stroke="#0F172A"
                      strokeWidth="2"
                    />
                    {/* Right Lens Cavity */}
                    <rect
                      x="180"
                      y="74"
                      width="76"
                      height="46"
                      rx="10"
                      fill="url(#lensClearGrad)"
                      stroke="#38BDF8"
                      strokeWidth="1.2"
                    />
                    {/* Lens Clean Glare Line */}
                    <line x1="188" y1="78" x2="214" y2="78" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />

                    {/* Bridge */}
                    <path
                      d="M148 84 Q160 78 172 84"
                      fill="none"
                      stroke="url(#frontRimGrad)"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />

                    {/* Hinges L/R */}
                    <rect x="51" y="74" width="6" height="10" rx="2" fill="#C9A24B" />
                    <rect x="263" y="74" width="6" height="10" rx="2" fill="#C9A24B" />

                    {/* Status Pill on Illustration */}
                    {frontViewMode === 'correct' && (
                      <g>
                        <rect x="68" y="24" width="184" height="22" rx="11" fill="#ECFDF5" stroke="#A7F3D0" strokeWidth="1.2" />
                        <text x="160" y="38" textAnchor="middle" fontSize="9.5" fill="#065F46" fontWeight="extrabold">
                          ✓ الأذرع مطوية بالخلف (مخفية تماماً)
                        </text>
                      </g>
                    )}
                  </svg>
                </div>

                <div className="space-y-2 text-xs text-slate-700 bg-sky-50/70 border border-sky-100 rounded-2xl p-3">
                  <div className="font-extrabold text-[#0284C7] flex items-center gap-1.5">
                    <I n="check" s={14} c="text-[#059669]" /> نصائح لقطة الوجه الأمامية:
                  </div>
                  <ul className="space-y-1 text-[0.72rem] text-slate-700 list-disc list-inside">
                    <li>الكاميرا في مستوى النظر تماماً (بدون زاوية علوية أو سفلية).</li>
                    <li>لا تسمح بظهور خيال الذراع خلف زجاج العدسة.</li>
                    <li>تأكد أن الإطار يملأ 80% من عرض كادر الكاميرا.</li>
                  </ul>
                </div>
              </div>
            )}

            {/* Card 2: Side Perspective Shot */}
            {(activeTab === 'all' || activeTab === 'side') && (
              <div className="rounded-3xl bg-white border border-slate-200 p-4 sm:p-5 shadow-sm hover:border-[#0F172A]/60 transition flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="badge !bg-slate-100 !text-slate-800 !border-slate-300 font-extrabold text-[0.7rem]">
                      الكارت 2 · زاوية ثلاثية الأبعاد
                    </span>
                    <span className="text-slate-400 text-xs font-mono">Angle ~35°</span>
                  </div>
                  <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                    <span>الصورة الجانبية 3/4 (Side Perspective)</span>
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1.5 leading-6">
                    التقط الشنبر بزاوية حوالي <b className="text-slate-900">35 درجة</b> لإظهار المفصلة والذراع المفتوح والعمق الحقيقي للإطار على خلفية بيضاء نقية.
                  </p>
                </div>

                {/* Illustration: SVG 3/4 Perspective Angle */}
                <div className="rounded-2xl bg-gradient-to-b from-[#F8F9FA] to-[#EDF2F7] border border-slate-200/90 p-3 sm:p-4 relative overflow-hidden">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[0.68rem] font-extrabold text-slate-700 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-[#0284C7]" />
                      رسم توضيحي لزاوية 35° مع الذراع المفتوح
                    </span>
                    <span className="badge !bg-sky-50 !text-[#0284C7] !border-sky-200 text-[0.65rem] font-bold">
                      زاوية 35°
                    </span>
                  </div>

                  <svg
                    viewBox="0 0 320 170"
                    className="w-full h-auto max-h-[160px] mx-auto select-none"
                    aria-label="رسم توضيحي للصورة الجانبية"
                  >
                    <defs>
                      <linearGradient id="sideRimGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#334155" />
                        <stop offset="100%" stopColor="#0F172A" />
                      </linearGradient>
                      <linearGradient id="sideTempleGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#D97706" />
                        <stop offset="100%" stopColor="#92400E" />
                      </linearGradient>
                    </defs>

                    {/* Perspective Shadow */}
                    <ellipse cx="145" cy="148" rx="115" ry="12" fill="#0F172A" opacity="0.08" />

                    {/* Angle Arc Indicator: 35° */}
                    <path
                      d="M210 148 A50 50 0 0 0 248 116"
                      fill="none"
                      stroke="#0284C7"
                      strokeWidth="2"
                      strokeDasharray="3 3"
                    />
                    <text x="242" y="142" fontSize="9" fill="#0284C7" fontWeight="extrabold">
                      35°
                    </text>

                    {/* The 3D Open Temple Arm extending backward */}
                    <path
                      d="M74 88 C120 70 200 66 270 76 L278 78 C240 84 140 88 74 98 Z"
                      fill="url(#sideTempleGrad)"
                      stroke="#78350F"
                      strokeWidth="1"
                    />
                    {/* Metal Hinge Detail */}
                    <circle cx="74" cy="92" r="5" fill="#F59E0B" stroke="#B45309" strokeWidth="1.5" />

                    {/* Far Temple (subtle perspective hint behind) */}
                    <path
                      d="M178 78 L220 74"
                      stroke="#64748B"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      opacity="0.5"
                    />

                    {/* Angled Front Face (Front Right Rim in foreground, Left in background) */}
                    {/* Forefront Right Rim (Larger, facing viewer) */}
                    <path
                      d="M62 76 C72 68 115 64 125 74 C132 85 128 118 118 126 C105 132 68 130 58 122 C52 110 54 86 62 76 Z"
                      fill="url(#sideRimGrad)"
                      stroke="#0F172A"
                      strokeWidth="2"
                    />
                    <path
                      d="M70 82 C78 76 108 72 116 80 C122 90 118 114 110 120 C100 124 74 122 66 116 C62 106 64 90 70 82 Z"
                      fill="#E0F2FE"
                      fillOpacity="0.4"
                      stroke="#38BDF8"
                      strokeWidth="1"
                    />
                    <line x1="74" y1="84" x2="96" y2="84" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.9" />

                    {/* Angled Bridge */}
                    <path
                      d="M125 88 C135 84 145 82 152 84"
                      fill="none"
                      stroke="url(#sideRimGrad)"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />

                    {/* Receding Left Rim (Smaller, shifted back) */}
                    <path
                      d="M152 82 C160 76 188 74 195 80 C200 90 196 112 190 116 C182 120 160 118 154 114 C150 106 148 90 152 82 Z"
                      fill="url(#sideRimGrad)"
                      stroke="#0F172A"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M158 86 C164 82 182 80 188 84 C192 92 188 106 184 110 C178 112 164 112 160 108 C156 102 156 92 158 86 Z"
                      fill="#E0F2FE"
                      fillOpacity="0.3"
                      stroke="#38BDF8"
                      strokeWidth="0.8"
                    />

                    {/* Callout Arrow for Hinge & Open Temple */}
                    <g>
                      <line x1="74" y1="92" x2="48" y2="52" stroke="#D97706" strokeWidth="1.5" strokeDasharray="2 2" />
                      <rect x="18" y="34" width="94" height="18" rx="9" fill="#FFFBEB" stroke="#FCD34D" strokeWidth="1" />
                      <text x="65" y="46" textAnchor="middle" fontSize="8.5" fill="#B45309" fontWeight="extrabold">
                        المفصلة والذراع المفتوح
                      </text>
                    </g>

                    <g>
                      <line x1="240" y1="76" x2="255" y2="48" stroke="#0284C7" strokeWidth="1.5" strokeDasharray="2 2" />
                      <rect x="205" y="32" width="98" height="18" rx="9" fill="#F0F9FF" stroke="#BAE6FD" strokeWidth="1" />
                      <text x="254" y="44" textAnchor="middle" fontSize="8.5" fill="#0369A1" fontWeight="extrabold">
                        عمق الإطار الحقيقي
                      </text>
                    </g>
                  </svg>
                </div>

                <div className="space-y-2 text-xs text-slate-700 bg-slate-50 border border-slate-200/80 rounded-2xl p-3">
                  <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
                    <I n="check" s={14} c="text-[#0284C7]" /> أهمية اللقطة الجانبية 3/4:
                  </div>
                  <ul className="space-y-1 text-[0.72rem] text-slate-700 list-disc list-inside">
                    <li>تُظهر للعميل فخامة الذراع والنقش الجانبي والمفصلة.</li>
                    <li>تُستخدم كصورة ثانية تفاعلية عند تمرير الماوس بالمتجر.</li>
                    <li>تُحسّن دوران الإطار في تجربة الوجه ثلاثية الأبعاد.</li>
                  </ul>
                </div>
              </div>
            )}

            {/* Card 3: Clip-On Guide (Crucial for Try-On) */}
            {(activeTab === 'all' || activeTab === 'clipon') && (
              <div className="rounded-3xl bg-white border-2 border-amber-400/80 p-4 sm:p-5 shadow-md flex flex-col justify-between space-y-4 relative overflow-hidden">
                <div className="absolute top-0 end-0 bg-amber-500 text-white text-[0.62rem] font-extrabold px-3 py-1 rounded-bl-xl shadow-xs">
                  مهم جداً للـ AI ⚠️
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="badge !bg-amber-50 !text-[#B45309] !border-amber-200 font-extrabold text-[0.7rem]">
                      الكارت 3 · ميزة حصرية
                    </span>
                    <span className="text-amber-600 text-xs font-mono">Clip-On Frames</span>
                  </div>
                  <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                    <span>نظارات بغيار شمس (Clip-On Guide)</span>
                  </h3>
                  <div className="text-xs sm:text-sm text-slate-700 mt-1.5 leading-6 space-y-1.5">
                    <div>
                      <span className="inline-block px-1.5 py-0.5 rounded bg-sky-100 text-[#0284C7] font-extrabold text-xs">
                        1. الصورة الأمامية:
                      </span>{' '}
                      التقطها للإطار الطبي <b>بدون الغيار الشمسي</b> (حتى يتمكن العميل من تجربة وقياس الشنبر الطبي على وجهه بدقة مليمترية).
                    </div>
                    <div>
                      <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-[#B45309] font-extrabold text-xs">
                        2. الصورة الجانبية 3/4:
                      </span>{' '}
                      التقطها <b>بالغيار الشمسي المغناطيسي مركّباً</b> على الإطار (ليظهر بشكله الشمسي الفخم في الكتالوج).
                    </div>
                  </div>
                </div>

                {/* Illustration: Interactive Clip-On Snap Diagram */}
                <div className="rounded-2xl bg-gradient-to-b from-amber-50/60 to-slate-100 border border-amber-200 p-3 sm:p-4 relative overflow-hidden">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[0.68rem] font-extrabold text-slate-800 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      محاكاة تركيب الغيار الشمسي
                    </span>
                    <button
                      type="button"
                      onClick={() => setClipOnMounted((prev) => !prev)}
                      className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[0.68rem] font-extrabold transition cursor-pointer shadow-xs"
                    >
                      {clipOnMounted ? 'فصل الغيار ✕' : 'تركيب الغيار 🧲'}
                    </button>
                  </div>

                  <svg
                    viewBox="0 0 320 170"
                    className="w-full h-auto max-h-[160px] mx-auto select-none"
                    aria-label="رسم توضيحي للنظارات بغيار شمس"
                  >
                    <defs>
                      <linearGradient id="clipSunGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#1E293B" />
                        <stop offset="100%" stopColor="#0B1329" />
                      </linearGradient>
                      <linearGradient id="darkSunLensGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1E3A8A" />
                        <stop offset="100%" stopColor="#0F172A" />
                      </linearGradient>
                    </defs>

                    {/* Shadow */}
                    <ellipse cx="160" cy="150" rx="120" ry="10" fill="#0F172A" opacity="0.08" />

                    {/* Step 1 Base: Transparent Optical Frame (Stays below) */}
                    <g transform="translate(0, 20)">
                      {/* Left Rim */}
                      <rect x="62" y="58" width="86" height="52" rx="12" fill="#E2E8F0" stroke="#475569" strokeWidth="2" />
                      <rect x="70" y="64" width="70" height="40" rx="8" fill="#F0F9FF" stroke="#38BDF8" strokeWidth="1" />
                      <line x1="76" y1="68" x2="98" y2="68" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
                      {/* Right Rim */}
                      <rect x="172" y="58" width="86" height="52" rx="12" fill="#E2E8F0" stroke="#475569" strokeWidth="2" />
                      <rect x="180" y="64" width="70" height="40" rx="8" fill="#F0F9FF" stroke="#38BDF8" strokeWidth="1" />
                      <line x1="186" y1="68" x2="208" y2="68" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
                      {/* Bridge */}
                      <path d="M148 74 Q160 68 172 74" fill="none" stroke="#475569" strokeWidth="5" strokeLinecap="round" />

                      {/* Micro Magnets */}
                      <circle cx="64" cy="62" r="3" fill="#D97706" />
                      <circle cx="256" cy="62" r="3" fill="#D97706" />

                      <text x="160" y="122" textAnchor="middle" fontSize="9" fill="#475569" fontWeight="bold">
                        الإطار الطبي الأساسي (شفاف للقياس الأمامي)
                      </text>
                    </g>

                    {/* Step 2: Dark Sunglasses Magnetic Clip-on Overlay */}
                    <g
                      transform={clipOnMounted ? 'translate(0, 18)' : 'translate(0, -32)'}
                      className="transition-transform duration-500 ease-out"
                    >
                      {/* Left Clip Rim */}
                      <rect
                        x="60"
                        y="56"
                        width="90"
                        height="56"
                        rx="13"
                        fill="none"
                        stroke="url(#clipSunGrad)"
                        strokeWidth="3.5"
                      />
                      {/* Tinted Dark Sunglass Lens */}
                      <rect
                        x="68"
                        y="62"
                        width="74"
                        height="44"
                        rx="9"
                        fill="url(#darkSunLensGrad)"
                        fillOpacity="0.85"
                        stroke="#0F172A"
                        strokeWidth="0.8"
                      />
                      <line x1="76" y1="67" x2="102" y2="67" stroke="#93C5FD" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />

                      {/* Right Clip Rim */}
                      <rect
                        x="170"
                        y="56"
                        width="90"
                        height="56"
                        rx="13"
                        fill="none"
                        stroke="url(#clipSunGrad)"
                        strokeWidth="3.5"
                      />
                      {/* Tinted Dark Sunglass Lens */}
                      <rect
                        x="178"
                        y="62"
                        width="74"
                        height="44"
                        rx="9"
                        fill="url(#darkSunLensGrad)"
                        fillOpacity="0.85"
                        stroke="#0F172A"
                        strokeWidth="0.8"
                      />
                      <line x1="186" y1="67" x2="212" y2="67" stroke="#93C5FD" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />

                      {/* Clip Bridge with Top Hook */}
                      <path d="M150 72 Q160 64 170 72" fill="none" stroke="url(#clipSunGrad)" strokeWidth="4.5" strokeLinecap="round" />
                      <circle cx="160" cy="67" r="2.5" fill="#D97706" />

                      {/* Magnetic Prongs */}
                      <circle cx="62" cy="60" r="3" fill="#F59E0B" stroke="#B45309" strokeWidth="1" />
                      <circle cx="258" cy="60" r="3" fill="#F59E0B" stroke="#B45309" strokeWidth="1" />

                      {/* Snap force lines when unmounted */}
                      {!clipOnMounted && (
                        <g>
                          <line x1="62" y1="72" x2="64" y2="92" stroke="#D97706" strokeWidth="1.8" strokeDasharray="2 2" />
                          <line x1="258" y1="72" x2="256" y2="92" stroke="#D97706" strokeWidth="1.8" strokeDasharray="2 2" />
                          <rect x="75" y="14" width="170" height="20" rx="10" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="1" />
                          <text x="160" y="27" textAnchor="middle" fontSize="9" fill="#92400E" fontWeight="extrabold">
                            🧲 الغيار الشمسي المغناطيسي للقطة 3/4
                          </text>
                        </g>
                      )}
                    </g>

                    {clipOnMounted && (
                      <g>
                        <rect x="85" y="6" width="150" height="20" rx="10" fill="#ECFDF5" stroke="#10B981" strokeWidth="1" />
                        <text x="160" y="19" textAnchor="middle" fontSize="9" fill="#065F46" fontWeight="extrabold">
                          ✓ راكب بالكامل للقطة الجانبية 3/4
                        </text>
                      </g>
                    )}
                  </svg>
                </div>

                <div className="space-y-2 text-xs text-amber-950 bg-amber-50/90 border border-amber-200/90 rounded-2xl p-3">
                  <div className="font-extrabold text-[#B45309] flex items-center gap-1.5">
                    <I n="spark" s={14} c="text-[#D97706]" /> لماذا هذه القاعدة بالغة الأهمية؟
                  </div>
                  <p className="text-[0.72rem] leading-5 text-slate-700">
                    عندما يفتح العميل الكاميرا لتجربة النظارة، يستبدل النظام زجاج العدسة الافتراضية بتقاسيم وجهه بدقة مليمترية. إذا التقطت الصورة الأمامية بالغيار الشمسي معتماً، لن يتمكن الذكاء الاصطناعي من قياس تفريغ العدسة الطبية بشكل سليم!
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Golden Rules Summary Checklist */}
          <div className="rounded-3xl bg-[#0F172A] text-white p-5 sm:p-6 space-y-3 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-400/30 flex items-center justify-center font-bold text-sm">
                ⭐
              </span>
              <div>
                <h4 className="font-extrabold text-sm sm:text-base text-white">
                  ملخص القواعد الذهبية لرفع النظارات (Checklist)
                </h4>
                <p className="text-xs text-slate-300 mt-0.5">
                  تأكد من تطبيق هذه النقاط السريعة قبل الضغط على زر رفع النظارات:
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-2.5 pt-2 text-xs">
              <div className="rounded-xl bg-white/10 p-2.5 border border-white/10 flex items-start gap-2">
                <span className="text-emerald-400 font-extrabold">✓</span>
                <div>
                  <div className="font-extrabold text-white text-[0.75rem]">الخلفية فاتحة</div>
                  <div className="text-[0.68rem] text-slate-300">بيضاء أو رمادي ناعم بدون نقوش</div>
                </div>
              </div>
              <div className="rounded-xl bg-white/10 p-2.5 border border-white/10 flex items-start gap-2">
                <span className="text-emerald-400 font-extrabold">✓</span>
                <div>
                  <div className="font-extrabold text-white text-[0.75rem]">الأذرع مخفية</div>
                  <div className="text-[0.68rem] text-slate-300">مطوية تماماً بالخلف في الصورة الأمامية</div>
                </div>
              </div>
              <div className="rounded-xl bg-white/10 p-2.5 border border-white/10 flex items-start gap-2">
                <span className="text-emerald-400 font-extrabold">✓</span>
                <div>
                  <div className="font-extrabold text-white text-[0.75rem]">زاوية 35° جانبي</div>
                  <div className="text-[0.68rem] text-slate-300">إظهار المفصلة والذراع المفتوح</div>
                </div>
              </div>
              <div className="rounded-xl bg-white/10 p-2.5 border border-white/10 flex items-start gap-2">
                <span className="text-emerald-400 font-extrabold">✓</span>
                <div>
                  <div className="font-extrabold text-white text-[0.75rem]">Clip-On مفصول أمامي</div>
                  <div className="text-[0.68rem] text-slate-300">طبي فقط بالأمام، راكب بالجانب</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-7 py-3.5 border-t border-slate-200 bg-[#F8F9FA] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 font-medium">
            تجد هذا الدليل متاحاً دائماً من قائمة المزيد وبجوار نموذج رفع النظارات.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-p px-6 py-2.5 text-xs sm:text-sm font-extrabold shadow-sm cursor-pointer"
          >
            فهمت، جاهز للتصوير والرفع ✓
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return ReactDOM.createPortal(modalNode, document.body);
  }
  return modalNode;
}
