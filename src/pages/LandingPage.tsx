import React, { useEffect, useState } from 'react';
import heroPortraitImg from '../assets/images/hero_portrait_eyewear_1795571804020.jpg';
import { useOptiVerse } from '../services/optiverseStore';
import { BillingCycle, FrameType } from '../types';
import { Corners, MiniGlasses } from '../components/GlassesGraphics';
import { I } from '../components/Icons';
import { fmt } from '../components/UiShared';

export function LandingPage() {
  const { navigate, platformSettings, plans, shops } = useOptiVerse();
  const [k, setK] = useState<FrameType>('aviator');
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [showBottomPricingBar, setShowBottomPricingBar] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.scrollY < 150 : true
  );

  useEffect(() => {
    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        setShowBottomPricingBar((window.scrollY || 0) < 150);
      });
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const opts: [FrameType, string, string, string, string][] = [
    ['aviator', 'Aviator', '#C9A24B', '#475569', '54□16-142'],
    ['wayfarer', 'Wayfarer', '#1a1a1a', '#334155', '52□18-140'],
    ['rimless', 'Rimless', '#C0C7D1', '#cfe8ff', '51□19-138'],
  ];
  const cur = opts.find((o) => o[0] === k) || opts[0];
  const demoSlug = shops[0]?.slug || 'dahab-optics';

  const activePlans = (platformSettings?.plans?.length ? platformSettings.plans : plans).filter((p) => p.on);
  const discountMonths = Math.max(0, Math.min(6, platformSettings?.annualDiscountMonths ?? 2));
  const paidMonthsPerYear = Math.max(6, 12 - discountMonths);

  const feats: [string, React.ReactNode, React.ReactNode][] = [
    [
      'spark',
      <>
        تجربة <span dir="ltr" className="inline-block">1:1 mm</span> الحقيقية بتقنية{' '}
        <span dir="ltr" className="inline-block">AI + 3D</span>
      </>,
      <>
        يقيس النظام عرض الوجه بدقة مليمترية ويُركّب النظارة بمقاسها الحقيقي (العدسة · الجسر · الذراع) مع محاكاة طلاءات{' '}
        <span dir="ltr" className="inline-block">(AR, Blue Cut)</span> على وجه العميل مباشرة.
      </>,
    ],
    [
      'camera',
      'كتالوج ستوديو خلال 8 ثوانٍ',
      'حوّل صور النظارات الملتقطة بالموبايل إلى صور كتالوج احترافية بخلفية بيضاء نقية ونسخة شفافة للتجربة الافتراضية فوراً.',
    ],
    [
      'eye',
      'توليد تلقائي للألوان بدون تكلفة إضافية',
      'ارفع النظارة مرة واحدة وأنشئ نسخاً لونية إضافية محلياً داخل المتصفح بنفس التصميم والأبعاد دون أي استهلاك إضافي.',
    ],
    [
      'map',
      'دليل محلات البصريات وخرائط جوجل',
      <>
        ظهور متجرك ضمن دليل المحلات المعتمدة حسب المحافظة مع رابط الموقع على{' '}
        <span dir="ltr" className="inline-block">Google Maps</span> وخدمة التوصيل عند تفعيلها.
      </>,
    ],
    [
      'msg',
      'طلبات مباشرة عبر واتساب',
      'يختار العميل الإطار والمقاس واللون ويرسل طلبه أو استفساره مباشرة على رقم واتساب المحل بدون عمولات وسطاء.',
    ],
    [
      'bell',
      'قاعدة عملاء وتذكيرات 6 و12 شهر',
      'سجل عملاء متكامل مع تنبيهات تلقائية لمواعيد الصيانة والكشف الدوري لرفع معدل تكرار الشراء في محلك.',
    ],
  ];

  const journeySteps: [string, React.ReactNode, React.ReactNode][] = [
    ['store', '1. تصفّح النظارات', 'يتصفّح العميل موديلات محلك أو يكتشف متجرك عبر دليل المحلات المعتمدة.'],
    ['glasses', '2. اختر الإطار واللون', 'يستعرض الزوايا المختلفة والألوان المتوفرة والمقاسات المليمترية الواضحة.'],
    [
      'camera',
      <>
        3. جرّبها بتقنية <span dir="ltr" className="inline-block">AI + 3D</span>
      </>,
      <>
        يرى النظارة على وجهه الحقيقي بالكاميرا أو بصورته الشخصية بمقياس{' '}
        <span dir="ltr" className="inline-block">1:1 mm</span>.
      </>,
    ],
    ['eye', '4. تأكّد من الملاءمة', 'يتحقق من تناسق عرض الإطار مع تقاسيم وجهه بنسبة تطابق ذكية قبل الشراء.'],
    ['check', '5. اطلب مباشرة عبر واتساب', 'يرسل الطلب إلى واتساب المحل أو يشارك النظارة مع أصدقائه للتصويت.'],
  ];

  const computeDisplayedMonthly = (baseMonthly: number) =>
    billing === 'annual' ? Math.round((baseMonthly * paidMonthsPerYear) / 12) : baseMonthly;

  const computeAnnualTotal = (baseMonthly: number) => baseMonthly * paidMonthsPerYear;

  return (
    <div dir="rtl" className="min-h-screen bg-[#F8F9FA] text-[#0F172A] overflow-x-clip">
      {/* Main Clean Top Bar */}
      <header className="bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3.5 sm:py-4 flex items-center justify-between gap-3">
          <a
            href="/"
            dir="ltr"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            className="inline-flex items-center gap-2 font-extrabold text-lg sm:text-xl whitespace-nowrap shrink-0 text-[#0F172A]"
          >
            <span>
              Opti<span className="text-[#0284C7]">Verse</span>
            </span>
            <span className="w-9 h-9 rounded-xl bg-[#0F172A] text-white flex items-center justify-center shrink-0">
              <I n="glasses" s={20} />
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-bold text-slate-600">
            <a href="#how-it-works" className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0">
              كيف تعمل؟
            </a>
            <a href="#features" className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0">
              المميزات
            </a>
            <a
              href="/stores"
              onClick={(e) => {
                e.preventDefault();
                navigate('/stores');
              }}
              className="hover:text-[#0284C7] transition-colors whitespace-nowrap shrink-0"
            >
              دليل المحلات
            </a>
            <a href="#pricing" className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0">
              الباقات
            </a>
            <a
              href={`/shop/${demoSlug}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/shop/${demoSlug}`);
              }}
              className="hover:text-[#0284C7] transition-colors whitespace-nowrap shrink-0"
            >
              متجر تجريبي
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="md:hidden btn btn-g btn-sm whitespace-nowrap shrink-0"
              onClick={() => navigate('/stores')}
            >
              دليل المحلات
            </button>
            <button
              type="button"
              className="btn btn-g btn-sm sm:btn border-[#0F172A]/20 text-[#0F172A] hover:bg-slate-100 font-extrabold whitespace-nowrap shrink-0"
              onClick={() => navigate('/merchant?mode=login')}
            >
              دخول التاجر
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-4 pt-8 sm:pt-12 pb-16 grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">
        <div className="fade">
          <span className="badge b-acc mb-4">
            <I n="spark" s={13} />
            <span>
              منصة البصريات الذكية — تجربة افتراضية دقيقة <span dir="ltr" className="inline-block">AI + 3D</span>
            </span>
          </span>
          <h1 className="text-3xl sm:text-4xl lg:text-[2.7rem] font-extrabold leading-[1.35] mb-4 text-[#0F172A]">
            قِس نظارتك بمقاسها الحقيقي على وجهك بتقنية{' '}
            <span dir="ltr" className="gradtx inline-block">
              AI + 3D
            </span>{' '}
            قبل الشراء
          </h1>
          <p className="text-slate-600 leading-8 mb-7 max-w-lg text-sm sm:text-base">
            متجرك الإلكتروني الخاص برابط واحد: يعرض عملاؤك تشكيلة محلك، يجرّبون الإطارات بمقياس{' '}
            <span dir="ltr" className="inline-block font-bold text-[#0F172A]">
              1:1 mm
            </span>{' '}
            على الوجه بالكاميرا أو الصورة، ويطلبون منك مباشرة عبر واتساب.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white !py-3.5 !px-6 !text-sm sm:!text-base shadow-md"
              onClick={() => navigate('/merchant?mode=signup')}
            >
              <I n="store" s={18} /> ابدأ متجرك الآن
            </button>
            <button
              type="button"
              className="btn !bg-white hover:!bg-slate-50 !border-2 !border-[#0F172A] !text-[#0F172A] !py-3.5 !px-6 !text-sm sm:!text-base"
              onClick={() => navigate('/stores')}
            >
              <I n="map" s={18} /> دليل المحلات المعتمدة ⭐
            </button>
            <button
              type="button"
              className="btn btn-g !py-3.5 !px-4 !text-sm"
              onClick={() => navigate(`/shop/${demoSlug}`)}
            >
              <I n="camera" s={16} /> معاينة متجر تجريبي
            </button>
          </div>

          <div className="flex flex-wrap gap-8 mt-9 text-sm text-slate-600 tabular-nums">
            <div>
              <b className="text-xl text-[#0F172A] block" dir="ltr">
                1:1 mm
              </b>
              دقة حقيقية
            </div>
            <div>
              <b className="text-xl text-[#0284C7] block">8 ثوانٍ</b>
              <span>
                كتالوج <span dir="ltr" className="inline-block">3D</span>
              </span>
            </div>
            <div>
              <b className="text-xl text-[#059669] block" dir="ltr">
                AI + 3D
              </b>
              تتبّع فوري للوجه
            </div>
          </div>
        </div>

        {/* Interactive Studio Portrait Preview Card */}
        <div className="relative floaty">
          <div className="relative bg-white rounded-3xl border border-[#E2E8F0] shadow-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E2E8F0] bg-[#F8F9FA]">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-bold text-slate-600 mx-auto truncate">
                <span dir="ltr" className="inline-block">
                  OptiVerse AI + 3D Try-On
                </span>{' '}
                — معاينة تفاعلية
              </span>
            </div>

            <div className="relative bg-[#F1F5F9] aspect-[4/4.4] max-h-[440px] w-full overflow-hidden">
              <img
                src={heroPortraitImg}
                alt="عميلة ترتدي نظارة طبية أنيقة ضمن تجربة OptiVerse الذكية بمقياس 1:1 mm"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover object-top select-none"
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(15,23,42,0.18) 0%, rgba(15,23,42,0) 24%, rgba(15,23,42,0) 64%, rgba(15,23,42,0.62) 100%)',
                }}
              />

              <Corners />

              {/* Golden Biometric Facial Landmarks & Optical Scan Overlay */}
              <svg
                viewBox="0 0 300 330"
                className="pointer-events-none absolute inset-0 w-full h-full"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="heroBioLine" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#F59E0B" stopOpacity="0" />
                    <stop offset="0.5" stopColor="#FBBF24" stopOpacity="0.92" />
                    <stop offset="1" stopColor="#F59E0B" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Biometric measurement vectors across eyes, bridge, cheekbones & temples */}
                <g stroke="#FBBF24" strokeWidth="1" strokeDasharray="3 3" opacity="0.72" fill="none">
                  <path d="M90,141 L122,138 L150,141 L178,138 L210,141" />
                  <path d="M122,138 L150,170 L178,138" />
                  <path d="M98,178 L150,218 L202,178" />
                  <path d="M150,96 L150,170" />
                </g>

                {/* Golden landmark nodes */}
                {[
                  [90, 141],
                  [122, 138],
                  [150, 141],
                  [178, 138],
                  [210, 141],
                  [150, 170],
                  [98, 178],
                  [202, 178],
                  [150, 218],
                  [150, 96],
                ].map(([cx, cy], idx) => (
                  <g key={idx}>
                    <circle cx={cx} cy={cy} r="5.5" fill="rgba(217, 119, 6, 0.25)" />
                    <circle cx={cx} cy={cy} r="2.4" fill="#FBBF24" />
                  </g>
                ))}

                {/* Dynamic subtle optical scan sweep */}
                <rect x="34" y="0" width="232" height="2" fill="url(#heroBioLine)" className="scanline" />
              </svg>

              {/* Top Status & Biometric PD Badges */}
              <span
                dir="ltr"
                className="absolute top-3 start-3 badge !bg-[#0284C7] !text-white !border-0 shadow-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white dotp" /> AI LIVE
              </span>

              <span className="absolute top-3 end-3 badge !bg-[#059669] !text-white !border-0 shadow-sm">
                <span>مقاس مثالي</span>{' '}
                <span dir="ltr" className="inline-block font-mono">
                  98% · {cur[4]}
                </span>
              </span>

              {/* PD: 63mm Golden Biometric Badge */}
              <div
                dir="ltr"
                className="absolute bottom-3 start-3 inline-flex items-center gap-1.5 rounded-xl bg-[#0F172A]/85 backdrop-blur-md border border-[#FBBF24]/50 px-3 py-1.5 text-xs font-extrabold text-[#FDE68A] shadow-md tabular-nums"
              >
                <span className="w-2 h-2 rounded-full bg-[#FBBF24] shrink-0" />
                <span>PD: 63mm</span>
              </div>

              {/* Active Frame Preview Pill overlaid cleanly bottom-end */}
              <div className="absolute bottom-3 end-3 inline-flex items-center gap-2 rounded-xl bg-white/95 backdrop-blur-md border border-[#E2E8F0] px-2.5 py-1.5 shadow-md">
                <MiniGlasses type={cur[0]} frame={cur[2]} lens={cur[3]} w={52} />
                <div className="text-start leading-tight">
                  <div dir="ltr" className="text-[0.7rem] font-extrabold text-[#0F172A]">
                    {cur[1]}
                  </div>
                  <div dir="ltr" className="text-[0.62rem] font-mono text-[#0284C7]">
                    {cur[4]} mm
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3 border-t border-[#E2E8F0] bg-white">
              {opts.map((o) => (
                <button
                  key={o[0]}
                  type="button"
                  onClick={() => setK(o[0])}
                  className={
                    'rounded-2xl p-2 flex flex-col items-center gap-1 border transition cursor-pointer ' +
                    (k === o[0]
                      ? 'border-[#0284C7] bg-sky-50 text-[#0F172A]'
                      : 'border-[#E2E8F0] bg-[#F8F9FA] text-slate-700 hover:bg-slate-100')
                  }
                >
                  <MiniGlasses type={o[0]} frame={o[2]} lens={o[3]} w={86} />
                  <span dir="ltr" className="text-xs font-bold">
                    {o[1]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 5-Step Journey */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-4 pb-16">
        <div className="bg-white border border-[#E2E8F0] shadow-sm rounded-3xl p-5 sm:p-8">
          <div className="text-center max-w-2xl mx-auto mb-7">
            <span className="badge b-acc mb-2">
              <I n="spark" s={12} />
              <span>
                كيف تعمل منصة{' '}
                <span dir="ltr" className="inline-block">
                  OptiVerse
                </span>
                ؟
              </span>
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-2 text-[#0F172A]">
              من التصفّح إلى الطلب في 5 خطوات بسيطة
            </h2>
            <p className="text-xs sm:text-sm text-slate-600">
              تجربة شراء واثقة وممتعة لعملائك: يرى العميل النظارة بمقاسها المليمتري على وجهه قبل أن يطلبها من محلك.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {journeySteps.map((st, idx) => (
              <div
                key={idx}
                className="rounded-2xl bg-[#F8F9FA] border border-[#E2E8F0] p-4 flex flex-col gap-2.5 hover:border-[#0284C7]/50 hover:bg-white transition"
              >
                <span className="w-10 h-10 rounded-xl bg-sky-50 text-[#0284C7] border border-sky-200 flex items-center justify-center shrink-0">
                  <I n={st[0]} s={20} />
                </span>
                <div className="font-extrabold text-sm text-[#0F172A]">{st[1]}</div>
                <p className="text-xs text-slate-600 leading-6">{st[2]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6 Core SaaS Features */}
      <section id="features" className="max-w-6xl mx-auto px-4 pb-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {feats.map((f, i) => (
          <div
            key={i}
            className="bg-white border border-[#E2E8F0] shadow-sm rounded-3xl p-6 hover:-translate-y-1 hover:shadow-md transition"
          >
            <span className="w-12 h-12 rounded-2xl bg-sky-50 text-[#0284C7] border border-sky-200 flex items-center justify-center mb-4">
              <I n={f[0]} s={24} />
            </span>
            <h3 className="font-extrabold text-lg mb-2 text-[#0F172A]">{f[1]}</h3>
            <p className="text-sm text-slate-600 leading-7">{f[2]}</p>
          </div>
        ))}
      </section>

      {/* Dynamic 3-Tier Pricing Section */}
      <section id="pricing" className="max-w-6xl mx-auto px-4 pb-16">
        <div className="text-center max-w-2xl mx-auto mb-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-2 text-[#0F172A]">باقات مرنة تناسب حجم محلك</h2>
          <p className="text-sm text-slate-600 mb-5">
            اختر الباقة المناسبة لعدد نظارات متجرك مع تحديث فوري عبر لوحة التاجر
          </p>

          <div className="inline-flex items-center gap-1.5 bg-white p-1.5 rounded-2xl border border-[#E2E8F0] shadow-xs">
            <button
              type="button"
              onClick={() => setBilling('monthly')}
              className={
                'px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition cursor-pointer ' +
                (billing === 'monthly' ? 'bg-[#0F172A] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]')
              }
            >
              اشتراك شهري
            </button>
            <button
              type="button"
              onClick={() => setBilling('annual')}
              className={
                'px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition cursor-pointer flex items-center gap-2 ' +
                (billing === 'annual' ? 'bg-[#059669] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]')
              }
            >
              <span>اشتراك سنوي</span>
              {discountMonths > 0 && (
                <span
                  className={
                    'text-[0.7rem] px-2 py-0.5 rounded-lg ' +
                    (billing === 'annual' ? 'bg-white/20 text-white' : 'bg-emerald-50 text-[#059669]')
                  }
                >
                  {discountMonths} شهور مجاناً
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {activePlans.map((p) => {
            const isPopular = p.tierKey === 'pro';
            const isPremium = p.tierKey === 'premium';
            const displayMonthly = computeDisplayedMonthly(p.price);
            const annualTotal = computeAnnualTotal(p.price);
            return (
              <div
                key={p.id}
                className={
                  'rounded-3xl p-6 bg-white border flex flex-col ' +
                  (isPopular
                    ? 'border-[#0284C7] ring-2 ring-[#0284C7]/20 shadow-md'
                    : isPremium
                    ? 'border-[#D97706]/60 shadow-sm'
                    : 'border-[#E2E8F0] shadow-sm')
                }
              >
                <div className="flex items-center justify-between gap-2 mb-2 min-h-[26px]">
                  <h3 className="font-extrabold text-lg text-[#0F172A]">{p.name}</h3>
                  {isPopular ? (
                    <span className="badge b-acc">الأكثر طلباً</span>
                  ) : isPremium ? (
                    <span className="badge !bg-amber-50 !text-[#B45309] !border-amber-200">متجر مميز ⭐</span>
                  ) : null}
                </div>

                <div className="my-3 tabular-nums">
                  <div className="text-3xl font-extrabold text-[#0284C7]">
                    <span dir="ltr" className="inline-block">
                      {fmt(displayMonthly)}
                    </span>{' '}
                    <span className="text-sm font-bold text-slate-500">ج.م / شهرياً</span>
                  </div>
                  {billing === 'annual' && (
                    <div className="text-xs text-[#059669] font-bold mt-1">
                      يُدفع{' '}
                      <span dir="ltr" className="inline-block">
                        {fmt(annualTotal)}
                      </span>{' '}
                      ج.م سنوياً (بدلاً من{' '}
                      <span dir="ltr" className="inline-block">
                        {fmt(p.price * 12)}
                      </span>{' '}
                      ج.م)
                    </div>
                  )}
                </div>

                <div className="text-xs font-bold text-slate-600 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl px-3 py-2 mb-4 flex items-center justify-between">
                  <span>الحد الأقصى للنظارات</span>
                  <b className="text-[#0F172A] tabular-nums">
                    <span dir="ltr" className="inline-block">
                      {p.maxProducts}
                    </span>{' '}
                    نظارة
                  </b>
                </div>

                <ul className="space-y-2 text-sm mb-6 text-slate-700 flex-1">
                  {p.feats.map((x) => (
                    <li key={x} className="flex gap-2 items-start">
                      <I n="check" s={15} c="text-[#059669] shrink-0 mt-1" />
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  className={
                    'btn w-full ' +
                    (isPopular
                      ? '!bg-[#D97706] hover:!bg-[#B45309] !text-white'
                      : '!bg-[#0F172A] hover:!bg-slate-800 !text-white')
                  }
                  onClick={() => navigate('/merchant?mode=signup')}
                >
                  اشترك الآن
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="border-t border-[#E2E8F0] bg-white pt-6 pb-24 sm:pb-24 px-4 text-center text-xs text-slate-500">
        © 2026{' '}
        <span dir="ltr" className="inline-block font-bold">
          OptiVerse
        </span>{' '}
        — منصة محلات البصريات الذكية ·{' '}
        <button
          type="button"
          className="text-[#0284C7] font-bold hover:underline cursor-pointer"
          onClick={() => navigate('/stores')}
        >
          دليل المحلات المعتمدة
        </button>
      </footer>

      {/* Scroll-Aware Fixed Bottom Pricing Bar (ONLY on LandingPage, visible near top scrollY < 150) */}
      <div
        aria-hidden={!showBottomPricingBar}
        className={
          'fixed bottom-0 inset-x-0 z-40 transition-all duration-300 ease-out px-2.5 sm:px-4 pb-2.5 sm:pb-3 ' +
          (showBottomPricingBar
            ? 'translate-y-0 opacity-100 pointer-events-auto'
            : 'translate-y-full opacity-0 pointer-events-none')
        }
      >
        <div className="max-w-5xl mx-auto">
          <div className="bg-white/95 backdrop-blur-md border border-[#E2E8F0] shadow-xl rounded-2xl px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs sm:text-sm font-extrabold text-[#0F172A] min-w-0">
              <I n="crown" s={16} c="text-[#D97706] shrink-0" />
              <span className="truncate">
                باقات{' '}
                <span dir="ltr" className="inline-block">
                  OptiVerse
                </span>{' '}
                للمحلات
              </span>
            </div>

            <div className="flex items-center gap-1 bg-[#F8F9FA] p-1 rounded-xl border border-[#E2E8F0] text-[0.7rem] sm:text-xs font-bold shrink-0">
              <button
                type="button"
                onClick={() => setBilling('monthly')}
                className={
                  'px-2.5 sm:px-3 py-1 rounded-lg transition cursor-pointer whitespace-nowrap ' +
                  (billing === 'monthly' ? 'bg-[#0F172A] text-white' : 'text-slate-600')
                }
              >
                شهري
              </button>
              <button
                type="button"
                onClick={() => setBilling('annual')}
                className={
                  'px-2.5 sm:px-3 py-1 rounded-lg transition cursor-pointer whitespace-nowrap ' +
                  (billing === 'annual' ? 'bg-[#059669] text-white' : 'text-slate-600')
                }
              >
                سنوي (وفّر {discountMonths} شهور)
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ms-auto sm:ms-0">
              <a href="#pricing" className="btn btn-g btn-sm !text-[0.72rem] sm:!text-xs whitespace-nowrap shrink-0">
                مقارنة الباقات
              </a>
              <button
                type="button"
                className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white btn-sm !text-[0.72rem] sm:!text-xs whitespace-nowrap shrink-0"
                onClick={() => navigate('/merchant?mode=signup')}
              >
                ابدأ متجرك الآن
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
