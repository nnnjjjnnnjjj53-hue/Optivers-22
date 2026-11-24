import React, { useState } from 'react';
import { useOptiVerse } from '../services/optiverseStore';
import { FrameType } from '../types';
import { Corners, Face, MiniGlasses } from '../components/GlassesGraphics';
import { I } from '../components/Icons';
import { fmt } from '../components/UiShared';

export function LandingPage() {
  const { navigate, plans, shops } = useOptiVerse();
  const [k, setK] = useState<FrameType>('aviator');

  const opts: [FrameType, string, string, string][] = [
    ['aviator', 'Aviator', '#C9A24B', '#475569'],
    ['wayfarer', 'Wayfarer', '#1a1a1a', '#334155'],
    ['rimless', 'Rimless', '#C0C7D1', '#cfe8ff'],
  ];
  const cur = opts.find((o) => o[0] === k) || opts[0];
  const demoSlug = shops[0]?.slug || 'dahab-optics';

  const feats = [
    [
      'spark',
      'التجربة الافتراضية بالذكاء الاصطناعي',
      'يجرّب عميلك النظارات على وجهه بالكاميرا الحية أو بصورته عبر تتبّع الوجه الدقيق بمقياس 1:1 الحقيقي، مع الحفاظ الكامل على شكل النظارة وتفاصيلها.',
    ],
    [
      'dollar',
      'إدارة العدسات والماركات والأسعار',
      'تحكم كامل في أنواع العدسات (AR، Blue Cut، Photochromic)، الشركات المصنعة، إضافات الحماية والخصومات — تتحدث فوراً في متجرك.',
    ],
    [
      'share',
      'متابعة الكشوفات الطبية والطلبات',
      'يرفع العميل كشف نظره ويتابع مراحل تجهيز نظارته خطوة بخطوة، بينما يراجع التاجر الكشف ويؤكد الملاءمة والسعر النهائي عبر واتساب.',
    ],
  ];

  const journeySteps = [
    ['store', '1. تصفّح النظارات', 'تصفّح تشكيلات النظارات من محلات البصريات المفضلة لديك في مكان واحد.'],
    ['glasses', '2. اختر نظارتك', 'حدد الإطار الذي يعجبك بالألوان والمقاسات المليمترية المتوفرة في المتجر.'],
    ['camera', '3. جرّبها بالذكاء الاصطناعي', 'ضع النظارة على وجهك مباشرة بالكاميرا أو عبر صورة شخصية بواقعية فائقة.'],
    ['eye', '4. شاهد الملاءمة قبل الشراء', 'تأكّد من تناسق الإطار مع عرض وجهك بالمليمتر قبل اتخاذ قرار الشراء.'],
    ['check', '5. اطلب مباشرة من المحل', 'أتمم طلب الإطار أو أرفق كشف نظرك ليجهّزه المحل لك مباشرة.'],
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#0F172A] overflow-x-clip">
      {/* Clean 3-zone Top Bar — Logo fixed LTR with eyeglasses icon on its right + ONLY دخول التاجر */}
      <header className="bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3.5 sm:py-4 flex items-center justify-between gap-4">
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

          <nav className="hidden md:flex items-center gap-7 text-sm font-bold text-slate-600">
            <a href="#how-it-works" className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0">
              كيف تعمل؟
            </a>
            <a href="#features" className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0">
              المميزات
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

          <div className="flex items-center shrink-0">
            <button
              className="btn btn-g btn-sm sm:btn border-[#0F172A]/20 text-[#0F172A] hover:bg-slate-100 font-extrabold"
              onClick={() => navigate('/merchant?mode=login')}
            >
              دخول التاجر
            </button>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 pt-8 sm:pt-12 pb-16 grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">
        <div className="fade">
          <span className="badge b-acc mb-4">
            <I n="spark" s={13} /> تجربة النظارات بالذكاء الاصطناعي — مجاناً لمدة 14 يوماً
          </span>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-[1.35] mb-4 text-[#0F172A]">
            جرّب نظارتك على وجهك <span className="gradtx">بالذكاء الاصطناعي</span> قبل أن تطلبها
          </h1>
          <p className="text-slate-600 leading-8 mb-7 max-w-lg text-sm sm:text-base">
            متجرك الخاص برابط واحد: يتصفّح عملاؤك نظارات المحل، يجرّبونها على وجوههم بمقياس ملم حقيقي 1:1 بالكاميرا أو الصورة
            الشخصية، ويرون شكلها الحقيقي قبل الطلب مباشرة من المتجر.
          </p>

          {/* Clean 2-button Hero Action Layout */}
          <div className="flex flex-wrap items-center gap-3.5">
            <button
              className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white !py-3.5 !px-6 !text-sm sm:!text-base shadow-md"
              onClick={() => navigate('/merchant?mode=signup')}
            >
              <I n="store" s={18} /> ابدأ تجربتك المجانية لمدة 14 يوماً
            </button>
            <button
              className="btn !bg-white hover:!bg-slate-50 !border-2 !border-[#0F172A] !text-[#0F172A] !py-3.5 !px-6 !text-sm sm:!text-base"
              onClick={() => navigate(`/shop/${demoSlug}`)}
            >
              <I n="camera" s={18} /> معاينة متجر عملاء تجريبي
            </button>
          </div>

          <div className="flex flex-wrap gap-8 mt-9 text-sm text-slate-600 tabular-nums">
            <div>
              <b className="text-xl text-[#0F172A] block">64+</b> محل بصريات
            </div>
            <div>
              <b className="text-xl text-[#0284C7] block">128K</b> تجربة افتراضية
            </div>
            <div>
              <b className="text-xl text-[#059669] block">14 يوماً</b> تجربة مجانية
            </div>
          </div>
        </div>

        <div className="relative floaty">
          <div className="relative bg-white rounded-3xl border border-[#E2E8F0] shadow-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E2E8F0] bg-[#F8F9FA]">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-bold text-slate-600 mx-auto">OptiVerse AI Try-On — معاينة تفاعلية</span>
            </div>
            <div className="relative bg-[#0F172A] aspect-[4/4.2] max-h-[430px] mx-auto">
              <Corners />
              <Face shape="oval" type={cur[0]} frame={cur[2]} lens={cur[3]} scan coatingId="ar" />
              <span className="absolute top-3 start-3 badge !bg-[#0284C7] !text-white !border-0">
                <span className="w-1.5 h-1.5 rounded-full bg-white dotp" /> AI LIVE
              </span>
              <span className="absolute top-3 end-3 badge !bg-[#059669] !text-white !border-0">
                مقاس مثالي 98% · 52□18-140
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 p-3 border-t border-[#E2E8F0] bg-white">
              {opts.map((o) => (
                <button
                  key={o[0]}
                  onClick={() => setK(o[0])}
                  className={
                    'rounded-2xl p-2 flex flex-col items-center gap-1 border transition cursor-pointer ' +
                    (k === o[0]
                      ? 'border-[#0284C7] bg-sky-50 text-[#0F172A]'
                      : 'border-[#E2E8F0] bg-[#F8F9FA] text-slate-700 hover:bg-slate-100')
                  }
                >
                  <MiniGlasses type={o[0]} frame={o[2]} lens={o[3]} w={86} />
                  <span className="text-xs font-bold">{o[1]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="max-w-6xl mx-auto px-4 pb-16">
        <div className="bg-white border border-[#E2E8F0] shadow-sm rounded-3xl p-5 sm:p-8">
          <div className="text-center max-w-2xl mx-auto mb-7">
            <span className="badge b-acc mb-2">
              <I n="spark" s={12} /> كيف تعمل منصة OptiVerse؟
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-2 text-[#0F172A]">
              من التصفّح إلى الطلب في 5 خطوات بسيطة
            </h2>
            <p className="text-xs sm:text-sm text-slate-600">
              تجربة شراء واثقة وممتعة لعملائك: يرى العميل النظارة على وجهه الحقيقي قبل أن يطلبها من متجرك المفضل.
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

      <section id="features" className="max-w-6xl mx-auto px-4 pb-16 grid md:grid-cols-3 gap-5">
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

      <section id="pricing" className="max-w-6xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-extrabold text-center mb-2 text-[#0F172A]">باقات بسيطة تناسب حجم محلك</h2>
        <p className="text-center text-sm text-slate-600 mb-8">
          كل حساب جديد يحصل على تجربة مجانية كاملة لمدة 14 يوماً بدون التزام
        </p>
        <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {plans
            .filter((p) => p.on)
            .map((p, i) => (
              <div
                key={p.id}
                className={
                  'rounded-3xl p-6 bg-white border shadow-sm ' +
                  (i ? 'border-[#0284C7] ring-2 ring-[#0284C7]/20' : 'border-[#E2E8F0]')
                }
              >
                {i ? <span className="badge b-acc mb-2">الأكثر طلباً</span> : null}
                <h3 className="font-extrabold text-lg text-[#0F172A]">{p.name}</h3>
                <div className="text-3xl font-extrabold my-3 text-[#0284C7] tabular-nums">
                  {fmt(p.price)} <span className="text-sm text-slate-500">ج.م / شهرياً</span>
                </div>
                <ul className="space-y-2 text-sm mb-5 text-slate-700">
                  {p.feats.map((x) => (
                    <li key={x} className="flex gap-2 items-center">
                      <I n="check" s={15} c="text-[#059669]" />
                      {x}
                    </li>
                  ))}
                </ul>
                <button
                  className={
                    'btn w-full ' +
                    (i
                      ? '!bg-[#D97706] hover:!bg-[#B45309] !text-white'
                      : '!bg-[#0F172A] hover:!bg-slate-800 !text-white')
                  }
                  onClick={() => navigate('/merchant?mode=signup')}
                >
                  ابدأ تجربتك المجانية لمدة 14 يوماً
                </button>
              </div>
            ))}
        </div>
      </section>

      <footer className="border-t border-[#E2E8F0] bg-white py-6 text-center text-xs text-slate-500">
        © 2026 OptiVerse — منصة محلات البصريات الذكية
      </footer>
    </div>
  );
}
