import React, { useEffect, useRef, useState } from 'react';
import { InquiryStatus, OrderStage, ShopStatus } from '../types';
import { I } from './Icons';

export const fmt = (n: number | string) => Number(n).toLocaleString('en-US');

export function Egp({ v }: { v: number }) {
  return (
    <span className="tabular-nums inline-flex items-baseline gap-1">
      <span dir="ltr">{fmt(v)}</span>
      <span className="text-[.75em] opacity-70">ج.م</span>
    </span>
  );
}

export const eff = (x: { price: number; salePrice?: number; disc?: number }) => {
  if (x.salePrice != null && x.salePrice > 0 && x.salePrice < x.price) {
    return Math.round(x.salePrice);
  }
  return Math.round(x.price * (1 - (+(x.disc || 0)) / 100));
};

export const D = <T extends { price: number; salePrice?: number; disc?: number }>(
  x: T
): T & { orig: number; disc: number } => {
  const effectivePrice = eff(x);
  const computedDisc =
    x.price > 0 && effectivePrice < x.price
      ? Math.round(((x.price - effectivePrice) / x.price) * 100)
      : Number(x.disc || 0);
  return {
    ...x,
    orig: x.price,
    price: effectivePrice,
    disc: computedDisc,
  };
};

export function Pr({ x }: { x: { orig?: number; price: number; salePrice?: number; disc?: number } }) {
  const effective = x.orig != null ? x.price : eff(x);
  const orig = x.orig != null ? x.orig : x.price;
  const pct =
    orig > 0 && effective < orig
      ? Math.round(((orig - effective) / orig) * 100)
      : Number(x.disc || 0);

  if (orig > effective) {
    return (
      <span className="tabular-nums inline-flex items-center gap-1 flex-wrap">
        <s className="text-slate-400 text-[.82em]">{fmt(orig)}</s>
        <Egp v={effective} />
        {pct > 0 && <span className="badge b-ok">-{pct}%</span>}
      </span>
    );
  }
  return <Egp v={effective} />;
}

export const waNum = (s: string) => String(s).replace(/\D/g, '').replace(/^0/, '20');

export const stBadge = (s: ShopStatus) =>
  s === 'trial' ? (
    <span className="badge b-info">تجريبي 14 يوماً</span>
  ) : s === 'active' ? (
    <span className="badge b-ok">نشط</span>
  ) : s === 'soon' ? (
    <span className="badge b-warn">ينتهي قريباً</span>
  ) : s === 'expired' ? (
    <span className="badge b-bad">منتهي</span>
  ) : (
    <span className="badge b-bad">موقوف</span>
  );

export const qBadge = (s: InquiryStatus) =>
  s === 'new' ? (
    <span className="badge b-info">جديد</span>
  ) : s === 'confirmed' ? (
    <span className="badge b-ok">تم تأكيد الملاءمة</span>
  ) : (
    <span className="badge b-warn">تم اقتراح عدسة بديلة</span>
  );

export const STAGES: [OrderStage, string][] = [
  ['review', 'تم التأكيد'],
  ['making', 'جاري التصنيع'],
  ['ready', 'جاهز للاستلام'],
  ['done', 'تم التسليم'],
];

export function Stages({ s }: { s?: OrderStage }) {
  const i = Math.max(0, STAGES.findIndex((x) => x[0] === (s || 'review')));
  return (
    <div className="flex items-start mt-3">
      {STAGES.map((x, k) => (
        <React.Fragment key={x[0]}>
          <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <span
              className={
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold ' +
                (k <= i ? 'bg-[#0284C7] text-white' : 'bg-slate-100 text-slate-500 border border-slate-200')
              }
            >
              {k < i ? <I n="check" s={13} /> : k + 1}
            </span>
            <span className={'text-[.62rem] text-center leading-tight ' + (k === i ? 'font-bold text-[#0F172A]' : 'text-slate-500')}>
              {x[1]}
            </span>
          </div>
          {k < 3 && <span className={'h-0.5 w-5 mt-3.5 rounded ' + (k < i ? 'bg-[#0284C7]' : 'bg-slate-200')} />}
        </React.Fragment>
      ))}
    </div>
  );
}

export function dlCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const csv =
    '\ufeff' +
    rows
      .map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(','))
      .join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function Modal({
  title,
  onClose,
  children,
  w = 'max-w-md',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  w?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className={'pop glass-s w-full ' + w + ' rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto text-[#0F172A]'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 gap-3">
          <h3 className="font-extrabold text-lg text-[#0F172A] truncate">{title}</h3>
          <button className="btn btn-g btn-sm !p-2 shrink-0" onClick={onClose} aria-label="إغلاق">
            <I n="x" s={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      type="button"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="relative shrink-0 rounded-full transition cursor-pointer"
      style={{ width: 46, height: 26, background: on ? '#0284C7' : '#CBD5E1' }}
    >
      <span
        className="absolute rounded-full bg-white shadow-sm transition-all"
        style={{ width: 20, height: 20, top: 3, insetInlineStart: on ? 23 : 3 }}
      />
    </button>
  );
}

export function Stat({
  icon,
  label,
  value,
  sub,
  tone = 'b-acc',
  onClick,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={
        'glass rounded-2xl p-4 text-[#0F172A] ' +
        (onClick ? 'cursor-pointer hover:bg-[#F8F9FA] hover:border-slate-300 transition' : '')
      }
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <span className={'w-8 h-8 rounded-xl flex items-center justify-center ' + tone}>
          <I n={icon} s={16} />
        </span>
      </div>
      <div className="text-2xl font-extrabold tabular-nums text-[#0F172A]">{value}</div>
      {sub && <div className="mt-1 text-xs">{sub}</div>}
    </div>
  );
}

export function LineChart({
  data,
  labels,
  h = 220,
  isCurrency = true,
  unit,
  changeLabel = 'عن الشهر السابق',
}: {
  data: number[];
  labels: string[];
  h?: number;
  isCurrency?: boolean;
  unit?: string;
  changeLabel?: string;
}) {
  const [i, setI] = useState(data.length - 1);
  const W = 600,
    H = h,
    pad = 28,
    max = Math.max(...data, 1) * 1.15,
    min = 0;
  const x = (k: number) => pad + (k * (W - pad * 2)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
  const line = data.map((v, k) => (k ? 'L' : 'M') + x(k) + ',' + y(v)).join(' ');
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-xs text-slate-500">{labels[i]}</div>
          <div className="text-xl font-extrabold text-[#0284C7]">
            {isCurrency && !unit ? (
              <Egp v={data[i] || 0} />
            ) : (
              <span className="tabular-nums inline-flex items-baseline gap-1">
                <span dir="ltr">{fmt(data[i] || 0)}</span>
                {unit ? <span className="text-[.75em] opacity-70">{unit}</span> : null}
              </span>
            )}
          </div>
        </div>
        {i > 0 && data[i - 1] > 0 && (
          <span className="badge b-ok tabular-nums">
            <span dir="ltr">{(((data[i] - data[i - 1]) / data[i - 1]) * 100).toFixed(0)}%+</span> {changeLabel}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ touchAction: 'none' }}>
        <defs>
          <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0284C7" stopOpacity=".24" />
            <stop offset="1" stopColor="#0284C7" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={pad}
            x2={W - pad}
            y1={pad + g * (H - pad * 2)}
            y2={pad + g * (H - pad * 2)}
            stroke="rgba(15,23,42,.08)"
          />
        ))}
        <path d={line + ` L${x(data.length - 1)},${H - pad} L${x(0)},${H - pad} Z`} fill="url(#ga)" />
        <path d={line} fill="none" stroke="#0284C7" strokeWidth="3" strokeLinejoin="round" />
        {data.map((v, k) => (
          <g key={k} onClick={() => setI(k)} onMouseEnter={() => setI(k)} style={{ cursor: 'pointer' }}>
            <rect x={x(k) - W / data.length / 2} y="0" width={W / data.length} height={H} fill="transparent" />
            <circle
              cx={x(k)}
              cy={y(v)}
              r={k === i ? 7 : 4}
              fill={k === i ? '#0284C7' : '#FFFFFF'}
              stroke="#0284C7"
              strokeWidth="2.5"
            />
            <text x={x(k)} y={H - 6} textAnchor="middle" fontSize="11" fill={k === i ? '#0284C7' : '#64748B'} fontWeight={k === i ? '700' : '500'}>
              {labels[k]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function Bars({ rows, max }: { rows: [string, number, string?][]; max?: number }) {
  const m = max || Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r[0]}>
          <div className="flex justify-between text-xs mb-1 tabular-nums text-[#0F172A]">
            <span className="font-semibold">{r[0]}</span>
            <span className="text-slate-600 font-bold">
              <span dir="ltr">{fmt(r[1])}</span>
              {r[2] || ''}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 border border-slate-200/70 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#0284C7]"
              style={{ width: (r[1] / m) * 100 + '%', transition: 'width .5s' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export type ShellNavItem = [string, string, string, number?];

export function Shell({
  items,
  active,
  setActive,
  title,
  sub,
  children,
  highlight,
  headerAction,
  onSignOut,
  mobileMode = 'drawer',
  primaryDockIds,
}: {
  items: ShellNavItem[];
  active: string;
  setActive: (id: string) => void;
  title: string;
  sub: string;
  children: React.ReactNode;
  highlight?: string;
  headerAction?: React.ReactNode;
  onSignOut?: () => void;
  mobileMode?: 'drawer' | 'dock';
  primaryDockIds?: string[];
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dockVisible, setDockVisible] = useState(true);
  const lastScrollYRef = useRef(0);
  const totalBadges = items.reduce((sum, it) => sum + (it[3] || 0), 0);

  useEffect(() => {
    if (mobileMode !== 'dock' || typeof window === 'undefined') return;
    lastScrollYRef.current = window.scrollY || 0;
    let rafId = 0;

    const handleScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const y = window.scrollY || 0;
        const prev = lastScrollYRef.current;
        if (y <= 40) {
          setDockVisible(true);
        } else if (y > 80 && y - prev > 6) {
          setDockVisible(false);
        } else if (prev - y > 6) {
          setDockVisible(true);
        }
        lastScrollYRef.current = y;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [mobileMode]);

  const selectTab = (id: string) => {
    setActive(id);
    setDrawerOpen(false);
    setDockVisible(true);
  };

  const primaryIds = primaryDockIds?.length ? primaryDockIds : items.slice(0, 3).map((x) => x[0]);
  const primaryDockItems = primaryIds
    .map((id) => items.find((it) => it[0] === id))
    .filter((x): x is ShellNavItem => Boolean(x))
    .slice(0, 3);
  const primarySet = new Set(primaryDockItems.map((x) => x[0]));
  const secondaryDockItems = items.filter((it) => !primarySet.has(it[0]));
  const secondaryBadges = secondaryDockItems.reduce((sum, it) => sum + (it[3] || 0), 0);

  return (
    <div className="min-h-screen lg:flex bg-[#F8F9FA] text-[#0F172A]">
      {/* Desktop Left/Right Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-screen p-4 bg-white border-e border-[#E2E8F0] overflow-y-auto">
        <div className="px-2 pb-4 mb-3 border-b border-[#E2E8F0] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-extrabold text-[#0F172A] truncate">{title}</div>
            <div className="text-xs text-slate-500 truncate">{sub}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {items.map((it) => {
            const isAct = active === it[0];
            const isHi = highlight === it[0] && !isAct;
            return (
              <button
                key={it[0]}
                type="button"
                onClick={() => selectTab(it[0])}
                className={
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition text-start cursor-pointer whitespace-nowrap ' +
                  (isAct
                    ? 'bg-[#0F172A] text-white shadow-sm'
                    : isHi
                    ? 'bg-sky-50 text-[#0284C7] border border-sky-200 hover:bg-sky-100/70'
                    : 'text-slate-700 hover:bg-[#F8F9FA] hover:text-[#0F172A]')
                }
              >
                <I n={it[2]} s={18} />
                <span className="truncate">{it[1]}</span>
                {(it[3] || 0) > 0 && <span className="ms-auto badge b-bad tabular-nums">{it[3]}</span>}
              </button>
            );
          })}
        </nav>

        {(headerAction || onSignOut) && (
          <div className="pt-3 mt-3 border-t border-[#E2E8F0] space-y-2">
            {headerAction && <div className="flex flex-col gap-2">{headerAction}</div>}
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="w-full btn btn-d btn-sm justify-center whitespace-nowrap"
              >
                <I n="logout" s={14} /> تسجيل الخروج
              </button>
            )}
          </div>
        )}
      </aside>

      {/* Clean Minimal Mobile Header */}
      <header className="lg:hidden sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E2E8F0]">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="font-extrabold text-sm text-[#0F172A] truncate">{title}</div>
            <div className="text-[.7rem] text-slate-500 truncate">{sub}</div>
          </div>
          {headerAction && <div className="flex items-center gap-2 shrink-0">{headerAction}</div>}
        </div>
      </header>

      {/* Main Content Area (safe bottom clearance for dock or floating menu) */}
      <main
        className={'flex-1 p-4 lg:p-7 min-w-0 fade ' + (mobileMode === 'dock' ? 'pb-24 lg:pb-8' : 'pb-28 lg:pb-8')}
        key={active}
      >
        {children}
      </main>

      {mobileMode === 'dock' ? (
        <>
          {/* Smart Auto-Hide Mobile Bottom Dock */}
          <nav
            aria-label="التنقل السريع للتاجر"
            className={
              'lg:hidden fixed bottom-0 inset-x-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-[#E2E8F0] shadow-[0_-4px_18px_rgba(15,23,42,0.06)] grid grid-cols-4 items-center px-2 transition-all duration-200 ' +
              (dockVisible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none')
            }
          >
            {primaryDockItems.map((it) => {
              const isAct = active === it[0];
              const badge = it[3] || 0;
              const shortLabel = it[0] === 'crm' ? 'العملاء' : it[1];
              return (
                <button
                  key={it[0]}
                  type="button"
                  onClick={() => selectTab(it[0])}
                  className={
                    'relative h-full flex flex-col items-center justify-center gap-0.5 text-[0.7rem] font-bold cursor-pointer transition ' +
                    (isAct ? 'text-[#0284C7]' : 'text-slate-600 hover:text-[#0F172A]')
                  }
                >
                  <div className="relative">
                    <I n={it[2]} s={20} />
                    {badge > 0 && (
                      <span className="absolute -top-1.5 -end-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#D97706] text-white text-[0.6rem] font-extrabold flex items-center justify-center tabular-nums">
                        {badge}
                      </span>
                    )}
                  </div>
                  <span className="truncate max-w-full px-1">{shortLabel}</span>
                  {isAct && <span className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-[#0284C7]" />}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={
                'relative h-full flex flex-col items-center justify-center gap-0.5 text-[0.7rem] font-bold cursor-pointer transition ' +
                (!primarySet.has(active) ? 'text-[#0284C7]' : 'text-slate-600 hover:text-[#0F172A]')
              }
            >
              <div className="relative">
                <I n="menu" s={20} />
                {secondaryBadges > 0 && (
                  <span className="absolute -top-1.5 -end-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#D97706] text-white text-[0.6rem] font-extrabold flex items-center justify-center tabular-nums">
                    {secondaryBadges}
                  </span>
                )}
              </div>
              <span>المزيد</span>
              {!primarySet.has(active) && <span className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-[#0284C7]" />}
            </button>
          </nav>

          {/* Clean Slide-Up Bottom Sheet Drawer for Secondary Sections */}
          <div
            className={
              'lg:hidden fixed inset-0 z-50 transition-opacity duration-200 ' +
              (drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
            }
            aria-hidden={!drawerOpen}
          >
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)} />
            <div
              className={
                'fixed inset-x-0 bottom-0 bg-white border-t border-[#E2E8F0] rounded-t-3xl shadow-2xl p-4 pb-6 max-h-[82vh] flex flex-col transition-transform duration-200 ease-out ' +
                (drawerOpen ? 'translate-y-0' : 'translate-y-full')
              }
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto mb-3 shrink-0" />
              <div className="flex items-center justify-between gap-2 pb-3 mb-2 border-b border-[#E2E8F0]">
                <div className="min-w-0">
                  <div className="font-extrabold text-[#0F172A] truncate">{title}</div>
                  <div className="text-xs text-slate-500 truncate">{sub}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-g btn-sm !p-2 shrink-0"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="إغلاق القائمة"
                >
                  <I n="x" s={16} />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto space-y-1 py-1">
                {secondaryDockItems.map((it) => {
                  const isAct = active === it[0];
                  return (
                    <button
                      key={it[0]}
                      type="button"
                      onClick={() => selectTab(it[0])}
                      className={
                        'w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold transition text-start cursor-pointer ' +
                        (isAct ? 'bg-[#0F172A] text-white' : 'text-slate-700 hover:bg-[#F8F9FA]')
                      }
                    >
                      <I n={it[2]} s={18} />
                      <span className="truncate">{it[1]}</span>
                      {(it[3] || 0) > 0 && <span className="ms-auto badge b-bad tabular-nums">{it[3]}</span>}
                    </button>
                  );
                })}
              </nav>

              {onSignOut && (
                <div className="pt-3 mt-2 border-t border-[#E2E8F0]">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      onSignOut();
                    }}
                    className="w-full btn btn-d justify-center"
                  >
                    <I n="logout" s={16} /> تسجيل الخروج
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Mobile Floating Bottom-Left Drawer Trigger (☰ القائمة) */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="فتح القائمة"
            className="lg:hidden fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#0F172A] text-white font-extrabold text-sm shadow-lg hover:bg-slate-800 active:scale-95 transition cursor-pointer whitespace-nowrap"
          >
            <I n="menu" s={18} />
            <span>☰ القائمة</span>
            {totalBadges > 0 && (
              <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#D97706] text-white text-[0.7rem] flex items-center justify-center tabular-nums">
                {totalBadges}
              </span>
            )}
          </button>

          {/* Smooth Slide-Over Drawer (Compositor transform + opacity) */}
          <div
            className={
              'lg:hidden fixed inset-0 z-50 transition-opacity duration-200 ' +
              (drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
            }
            aria-hidden={!drawerOpen}
          >
            <div
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
              onClick={() => setDrawerOpen(false)}
            />
            <div
              className={
                'fixed inset-y-0 left-0 w-[82vw] max-w-[310px] bg-white border-e border-[#E2E8F0] shadow-2xl p-4 flex flex-col transition-transform duration-200 ease-out ' +
                (drawerOpen ? 'translate-x-0' : '-translate-x-full')
              }
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-[#E2E8F0]">
                <div className="min-w-0">
                  <div className="font-extrabold text-[#0F172A] truncate">{title}</div>
                  <div className="text-xs text-slate-500 truncate">{sub}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-g btn-sm !p-2 shrink-0"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="إغلاق القائمة"
                >
                  <I n="x" s={16} />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto space-y-1 py-1">
                {items.map((it) => {
                  const isAct = active === it[0];
                  return (
                    <button
                      key={it[0]}
                      type="button"
                      onClick={() => selectTab(it[0])}
                      className={
                        'w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold transition text-start cursor-pointer ' +
                        (isAct ? 'bg-[#0F172A] text-white' : 'text-slate-700 hover:bg-[#F8F9FA]')
                      }
                    >
                      <I n={it[2]} s={18} />
                      <span className="truncate">{it[1]}</span>
                      {(it[3] || 0) > 0 && <span className="ms-auto badge b-bad tabular-nums">{it[3]}</span>}
                    </button>
                  );
                })}
              </nav>

              <div className="pt-3 mt-3 border-t border-[#E2E8F0] space-y-2">
                {onSignOut && (
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      onSignOut();
                    }}
                    className="w-full btn btn-d justify-center"
                  >
                    <I n="logout" s={16} /> تسجيل الخروج
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Head({ t, sub, children }: { t: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div>
        <h2 className="text-xl lg:text-2xl font-extrabold text-[#0F172A]">{t}</h2>
        {sub && <div className="text-sm text-slate-600">{sub}</div>}
      </div>
      <div className="flex gap-2 flex-wrap">{children}</div>
    </div>
  );
}

export function Empty({
  icon,
  t,
  s,
  b,
  on,
}: {
  icon: string;
  t: string;
  s: string;
  b: string;
  on: () => void;
}) {
  return (
    <div className="glass rounded-3xl p-10 text-center">
      <span className="w-16 h-16 rounded-full b-acc inline-flex items-center justify-center mb-3">
        <I n={icon} s={30} />
      </span>
      <div className="font-extrabold text-lg text-[#0F172A]">{t}</div>
      <p className="text-sm text-slate-600 mb-4">{s}</p>
      <button className="btn btn-p" onClick={on}>
        {b}
      </button>
    </div>
  );
}

export function QR({ size = 150, seed = 'optiverse' }: { size?: number; seed?: string }) {
  const n = 25;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => (h = (h * 1664525 + 1013904223) >>> 0) / 4294967296;
  const fin = (x: number, y: number) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!fin(x, y) && rnd() > 0.52) cells.push(<rect key={x + '-' + y} x={x} y={y} width="1" height="1" />);
    }
  }
  const F = ({ x, y }: { x: number; y: number }) => (
    <g>
      <rect x={x} y={y} width="7" height="7" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" />
    </g>
  );
  return (
    <svg viewBox="-1 -1 27 27" width={size} height={size} style={{ background: '#fff', borderRadius: 12, padding: 4, border: '1px solid #e2e8f0' }} fill="#0F172A">
      {cells}
      <F x={0} y={0} />
      <F x={n - 7} y={0} />
      <F x={0} y={n - 7} />
    </svg>
  );
}
