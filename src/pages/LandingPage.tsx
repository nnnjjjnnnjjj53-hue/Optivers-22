import React, { useEffect, useRef, useState } from 'react';
import landingEditorialPortrait from '../assets/images/landing_editorial_portrait_1795613820913.jpg';
import { DEFAULT_LANDING_PREVIEW_FRAMES } from '../data/seed';
import { isAdminRole, useOptiVerse } from '../services/optiverseStore';
import { BillingCycle, LandingPreviewFrame } from '../types';
import { Corners, Glasses, MiniGlasses } from '../components/GlassesGraphics';
import { I } from '../components/Icons';
import { fmt } from '../components/UiShared';

export function LandingPage() {
  const { navigate, platformSettings, plans, shops, session } = useOptiVerse();
  const previewFrames: LandingPreviewFrame[] =
    platformSettings.landingPreviewFrames && platformSettings.landingPreviewFrames.length
      ? platformSettings.landingPreviewFrames
      : DEFAULT_LANDING_PREVIEW_FRAMES;
  const [activeFrameId, setActiveFrameId] = useState<string>(previewFrames[0]?.id || 'lp-aviator');
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [showBottomPricingBar, setShowBottomPricingBar] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.scrollY < 140 : true
  );
  const [arrivedPricingGlow, setArrivedPricingGlow] = useState(false);
  const pricingGlowTimerRef = useRef<number | null>(null);
  const pricingScrollRafRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (pricingGlowTimerRef.current) window.clearTimeout(pricingGlowTimerRef.current);
      if (pricingScrollRafRef.current) window.cancelAnimationFrame(pricingScrollRafRef.current);
    };
  }, []);

  const scrollToPricing = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    const target = document.getElementById('pricing');
    if (!target) return;
    if (pricingGlowTimerRef.current) window.clearTimeout(pricingGlowTimerRef.current);
    if (pricingScrollRafRef.current) window.cancelAnimationFrame(pricingScrollRafRef.current);

    const startY = window.scrollY || window.pageYOffset || 0;
    const rect = target.getBoundingClientRect();
    const targetY = Math.max(0, startY + rect.top - 72);
    const distance = targetY - startY;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced || Math.abs(distance) < 4) {
      window.scrollTo(0, targetY);
      setArrivedPricingGlow(true);
      pricingGlowTimerRef.current = window.setTimeout(() => setArrivedPricingGlow(false), 1400);
      return;
    }

    const duration = 720;
    const startTime = performance.now();
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      window.scrollTo(0, startY + distance * easeInOutCubic(progress));
      if (progress < 1) {
        pricingScrollRafRef.current = window.requestAnimationFrame(step);
      } else {
        pricingScrollRafRef.current = 0;
        setArrivedPricingGlow(true);
        pricingGlowTimerRef.current = window.setTimeout(() => setArrivedPricingGlow(false), 1400);
      }
    };
    pricingScrollRafRef.current = window.requestAnimationFrame(step);
  };

  useEffect(() => {
    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        setShowBottomPricingBar((window.scrollY || 0) < 140);
      });
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const cur = previewFrames.find((f) => f.id === activeFrameId) || previewFrames[0];
  const demoSlug = shops[0]?.slug || 'optivibe';
  const directoryEnabled = Boolean(platformSettings.enableStoresDirectory);
  const isMerchantLoggedIn = Boolean(
    session && (session.role === 'merchant' || isAdminRole(session.role))
  );

  const allPlans = platformSettings?.plans?.length ? platformSettings.plans : plans;
  const activePlans = allPlans.filter((p) => p.on);
  const basicPlan = allPlans.find((p) => p.tierKey === 'basic') || allPlans[0];
  const proPlan = allPlans.find((p) => p.tierKey === 'pro') || allPlans[1];
  const premiumPlan = allPlans.find((p) => p.tierKey === 'premium') || allPlans[2];

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
            {directoryEnabled && (
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
            )}
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
            {directoryEnabled && (
              <button
                type="button"
                className="md:hidden btn btn-g btn-sm whitespace-nowrap shrink-0"
                onClick={() => navigate('/stores')}
              >
                دليل المحلات
              </button>
            )}
            <button
              type="button"
              className="btn btn-g btn-sm sm:btn border-[#0F172A]/20 text-[#0F172A] hover:bg-slate-100 font-extrabold whitespace-nowrap shrink-0"
              onClick={() => navigate(isMerchantLoggedIn ? '/merchant' : '/merchant?mode=login')}
            >
              {isMerchantLoggedIn ? 'لوحة تحكم متجري' : 'دخول التاجر'}
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
            {isMerchantLoggedIn ? (
              <button
                type="button"
                className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white !py-3.5 !px-6 !text-sm sm:!text-base shadow-md"
                onClick={() => navigate('/merchant')}
              >
                <I n="store" s={18} /> لوحة تحكم متجري
              </button>
            ) : (
              <button
                type="button"
                className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white !py-3.5 !px-6 !text-sm sm:!text-base shadow-md"
                onClick={() => navigate('/merchant?mode=signup')}
              >
                <I n="spark" s={18} /> ابدأ تجربتك المجانية 14 يوماً
              </button>
            )}
            {directoryEnabled && (
              <button
                type="button"
                className="btn !bg-white hover:!bg-slate-50 !border-2 !border-[#0F172A] !text-[#0F172A] !py-3.5 !px-6 !text-sm sm:!text-base"
                onClick={() => navigate('/stores')}
              >
                <I n="map" s={18} /> دليل المحلات المعتمدة ⭐
              </button>
            )}
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
                src={landingEditorialPortrait}
                alt="معاينة تفاعلية حية لتركيب النظارة على الوجه بتقنية OptiVerse"
                className="w-full h-full object-cover object-top select-none"
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(15,23,42,0.16) 0%, rgba(15,23,42,0) 24%, rgba(15,23,42,0) 64%, rgba(15,23,42,0.58) 100%)',
                }}
              />

              {/* Live Eyewear Frame Overlaid Directly Onto Her Eye Pupils & Nose Bridge */}
              <div
                className="pointer-events-none absolute z-[6] flex items-center justify-center transition-all duration-200"
                style={{
                  top: '43.5%',
                  left: '50%',
                  transform: 'translate(-50%, -50%) rotate(-1.2deg)',
                  width: '38%',
                }}
              >
                {cur.imageUrl ? (
                  <img
                    src={cur.imageUrl}
                    alt={cur.name}
                    className="w-full h-auto object-contain drop-shadow-[0_6px_12px_rgba(15,23,42,0.35)]"
                  />
                ) : (
                  <svg viewBox="-88 -30 176 62" className="w-full h-auto overflow-visible drop-shadow-[0_6px_10px_rgba(15,23,42,0.28)]">
                    <Glasses
                      type={cur.type}
                      frame={cur.frameColor}
                      lens={cur.lensColor}
                      isSun={false}
                      hideTemples={true}
                    />
                  </svg>
                )}
              </div>

              <Corners />

              {/* Subtle Horizontal Optical Scan Sweep */}
              <svg
                viewBox="0 0 300 330"
                className="pointer-events-none absolute inset-0 w-full h-full z-[5]"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="heroBioLine" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#F59E0B" stopOpacity="0" />
                    <stop offset="0.5" stopColor="#FBBF24" stopOpacity="0.92" />
                    <stop offset="1" stopColor="#F59E0B" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <rect x="34" y="0" width="232" height="2" fill="url(#heroBioLine)" className="scanline" />
              </svg>

              {/* Top Status & Biometric PD Badges */}
              <span
                dir="ltr"
                className="absolute top-3 start-3 z-[6] badge !bg-[#0284C7] !text-white !border-0 shadow-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white dotp" /> AI LIVE
              </span>

              <span className="absolute top-3 end-3 z-[6] badge !bg-[#059669] !text-white !border-0 shadow-sm">
                <span>مقاس مثالي</span>{' '}
                <span dir="ltr" className="inline-block font-mono">
                  98% · {cur.dimensions?.replace(/□/g, '-')}
                </span>
              </span>

              {/* Camera CTA Button */}
              <button
                type="button"
                onClick={() => navigate(`/shop/${demoSlug}?tryon=1`)}
                className="absolute bottom-3 start-3 z-[10] px-3.5 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-extrabold flex items-center gap-1.5 shadow-xl cursor-pointer"
              >
                <span>افتح الكاميرا وجرّبها على وجهك الآن 📸</span>
              </button>

              {/* Active Frame Preview Pill overlaid cleanly bottom-end */}
              <div className="absolute bottom-3 end-3 z-[6] inline-flex items-center gap-2 rounded-xl bg-white/95 backdrop-blur-md border border-[#E2E8F0] px-2.5 py-1.5 shadow-md">
                <MiniGlasses
                  type={cur.type}
                  frame={cur.frameColor}
                  lens={cur.lensColor}
                  w={52}
                  imageUrl={cur.imageUrl}
                />
                <div className="text-start leading-tight">
                  <div dir="ltr" className="text-[0.7rem] font-extrabold text-[#0F172A]">
                    {cur.name}
                  </div>
                  <div dir="ltr" className="text-[0.62rem] font-mono text-[#0284C7]">
                    {cur.dimensions?.replace(/□/g, '-')} mm
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3 border-t border-[#E2E8F0] bg-white">
              {previewFrames.slice(0, 6).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setActiveFrameId(f.id)}
                  className={
                    'rounded-2xl p-2 flex flex-col items-center gap-1 border transition cursor-pointer ' +
                    (cur.id === f.id
                      ? 'border-[#0284C7] bg-sky-50 text-[#0F172A]'
                      : 'border-[#E2E8F0] bg-[#F8F9FA] text-slate-700 hover:bg-slate-100')
                  }
                >
                  <MiniGlasses
                    type={f.type}
                    frame={f.frameColor}
                    lens={f.lensColor}
                    w={86}
                    imageUrl={f.imageUrl}
                  />
                  <span dir="ltr" className="text-xs font-bold truncate max-w-full">
                    {f.name}
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
                  {discountMonths === 2 ? 'شهران مجاناً' : `${discountMonths} شهور مجاناً`}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {activePlans.map((p, planIdx) => {
            const isPopular = p.tierKey === 'pro';
            const isPremium = p.tierKey === 'premium';
            const displayMonthly = computeDisplayedMonthly(p.price);
            const annualTotal = computeAnnualTotal(p.price);
            return (
              <div
                key={p.id}
                style={arrivedPricingGlow ? { animationDelay: `${planIdx * 110}ms` } : undefined}
                className={
                  'rounded-3xl p-6 bg-white border flex flex-col transition-all duration-300 ' +
                  (isPopular
                    ? 'border-[#0284C7] ring-2 ring-[#0284C7]/20 shadow-md'
                    : isPremium
                    ? 'border-[#D97706]/60 shadow-sm'
                    : 'border-[#E2E8F0] shadow-sm') +
                  (arrivedPricingGlow ? ' pricing-arrive-glow ring-2 ring-amber-400/50' : '')
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
        — منصة محلات البصريات الذكية
        {directoryEnabled && (
          <>
            {' '}
            ·{' '}
            <button
              type="button"
              className="text-[#0284C7] font-bold hover:underline cursor-pointer"
              onClick={() => navigate('/stores')}
            >
              دليل المحلات المعتمدة
            </button>
          </>
        )}
      </footer>

      {/* Scroll-Aware Elevated 3-Column Fixed Bottom Pricing Bar + Golden Triple-Chevron Button (Guests Only) */}
      {!isMerchantLoggedIn && (
        <div
          aria-hidden={!showBottomPricingBar}
          className={
            'fixed bottom-2 sm:bottom-3 inset-x-0 z-40 transition-all duration-300 ease-out px-2 sm:px-4 ' +
            (showBottomPricingBar
              ? 'translate-y-0 opacity-100 pointer-events-auto'
              : 'translate-y-full opacity-0 pointer-events-none')
          }
        >
          <div className="max-w-4xl mx-auto flex flex-col items-center gap-1.5">
            <a
              href="#pricing"
              onClick={scrollToPricing}
              className="w-full grid grid-cols-3 bg-white/95 backdrop-blur-md border border-[#E2E8F0] shadow-xl rounded-2xl overflow-hidden divide-x divide-x-reverse divide-[#E2E8F0]"
            >
              <div className="px-2 sm:px-4 py-2.5 text-center hover:bg-slate-50 transition">
                <div className="text-[0.68rem] sm:text-xs font-extrabold text-[#0F172A] truncate">
                  الباقة الأساسية
                </div>
                <div className="text-[0.68rem] sm:text-xs font-bold text-[#0284C7] mt-0.5 tabular-nums">
                  <span dir="ltr">{fmt(basicPlan?.price ?? 599)}</span> ج.م / شهرياً
                </div>
              </div>
              <div className="px-2 sm:px-4 py-2.5 text-center bg-sky-50/70 hover:bg-sky-50 transition">
                <div className="text-[0.68rem] sm:text-xs font-extrabold text-[#0F172A] truncate">
                  الباقة الاحترافية
                </div>
                <div className="text-[0.68rem] sm:text-xs font-bold text-[#0284C7] mt-0.5 tabular-nums">
                  <span dir="ltr">{fmt(proPlan?.price ?? 999)}</span> ج.م / شهرياً
                </div>
              </div>
              <div className="px-2 sm:px-4 py-2.5 text-center hover:bg-amber-50/60 transition">
                <div className="text-[0.68rem] sm:text-xs font-extrabold text-[#0F172A] truncate">
                  باقة البريميوم
                </div>
                <div className="text-[0.68rem] sm:text-xs font-bold text-[#D97706] mt-0.5 tabular-nums">
                  <span dir="ltr">{fmt(premiumPlan?.price ?? 1399)}</span> ج.م / شهرياً
                </div>
              </div>
            </a>

            <button
              type="button"
              onClick={scrollToPricing}
              aria-label="الانتقال إلى تفاصيل الباقات"
              className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-slate-900/90 hover:bg-slate-900 border border-amber-400/50 text-amber-400 shadow-lg cursor-pointer transition hover:scale-[1.03]"
            >
              <span className="text-[0.65rem] font-extrabold text-amber-200 tracking-wide">تفاصيل الباقات</span>
              <span className="inline-flex flex-col items-center -space-y-2 leading-none" aria-hidden="true">
                <svg viewBox="0 0 16 10" className="w-3 h-2 chevron-pulse-1 text-amber-300" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 2.5L8 7.5L13 2.5" />
                </svg>
                <svg viewBox="0 0 16 10" className="w-3 h-2 chevron-pulse-2 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 2.5L8 7.5L13 2.5" />
                </svg>
                <svg viewBox="0 0 16 10" className="w-3 h-2 chevron-pulse-3 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 2.5L8 7.5L13 2.5" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
