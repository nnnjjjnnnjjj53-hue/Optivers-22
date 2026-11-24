import React, { useState } from 'react';
import { InquiryStatus, OrderStage, ShopStatus } from '../types';
import { I } from './Icons';

export const fmt = (n: number | string) => Number(n).toLocaleString('en-US');

export function Egp({ v }: { v: number }) {
  return (
    <span className="tabular-nums">
      {fmt(v)} <span className="text-[.75em] opacity-70">ج.م</span>
    </span>
  );
}

export const eff = (x: { price: number; disc?: number }) =>
  Math.round(x.price * (1 - (+(x.disc || 0)) / 100));

export const D = <T extends { price: number; disc?: number }>(x: T): T & { orig: number } => ({
  ...x,
  orig: x.price,
  price: eff(x),
});

export function Pr({ x }: { x: { orig?: number; price: number; disc?: number } }) {
  if (x.orig != null && x.orig !== x.price) {
    return (
      <span className="tabular-nums">
        <s className="opacity-50 text-[.8em] me-1">{fmt(x.orig)}</s>
        <Egp v={x.price} />
        <span className="badge b-ok ms-1">-{x.disc}%</span>
      </span>
    );
  }
  return <Egp v={x.price} />;
}

export const waNum = (s: string) => String(s).replace(/\D/g, '').replace(/^0/, '20');

export const stBadge = (s: ShopStatus) =>
  s === 'trial' ? (
    <span className="badge b-info">تجريبي 7 أيام</span>
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
                (k <= i ? 'bg-acc text-[#04201c]' : 'bg-white/10')
              }
            >
              {k < i ? <I n="check" s={13} /> : k + 1}
            </span>
            <span className={'text-[.62rem] text-center leading-tight ' + (k === i ? 'font-bold' : 'opacity-50')}>
              {x[1]}
            </span>
          </div>
          {k < 3 && <span className={'h-0.5 w-5 mt-3.5 rounded ' + (k < i ? 'bg-acc' : 'bg-white/15')} />}
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
      style={{ background: 'rgba(3,8,16,.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className={'pop glass-s w-full ' + w + ' rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 gap-3">
          <h3 className="font-extrabold text-lg truncate">{title}</h3>
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
      style={{ width: 46, height: 26, background: on ? 'var(--acc)' : 'rgba(255,255,255,.16)' }}
    >
      <span
        className="absolute rounded-full bg-white transition-all"
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
      className={'glass rounded-2xl p-4 ' + (onClick ? 'cursor-pointer hover:bg-white/10 transition' : '')}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs opacity-70">{label}</span>
        <span className={'w-8 h-8 rounded-xl flex items-center justify-center ' + tone}>
          <I n={icon} s={16} />
        </span>
      </div>
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs">{sub}</div>}
    </div>
  );
}

export function LineChart({ data, labels, h = 220 }: { data: number[]; labels: string[]; h?: number }) {
  const [i, setI] = useState(data.length - 1);
  const W = 600,
    H = h,
    pad = 28,
    max = Math.max(...data) * 1.15,
    min = 0;
  const x = (k: number) => pad + (k * (W - pad * 2)) / (data.length - 1);
  const y = (v: number) => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
  const line = data.map((v, k) => (k ? 'L' : 'M') + x(k) + ',' + y(v)).join(' ');
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-xs opacity-60">{labels[i]}</div>
          <div className="text-xl font-extrabold tx-acc">
            <Egp v={data[i]} />
          </div>
        </div>
        {i > 0 && (
          <span className="badge b-ok tabular-nums">
            {(((data[i] - data[i - 1]) / data[i - 1]) * 100).toFixed(0)}%+ عن الشهر السابق
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ touchAction: 'none' }}>
        <defs>
          <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#14B8A6" stopOpacity=".35" />
            <stop offset="1" stopColor="#14B8A6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={pad}
            x2={W - pad}
            y1={pad + g * (H - pad * 2)}
            y2={pad + g * (H - pad * 2)}
            stroke="rgba(255,255,255,.07)"
          />
        ))}
        <path d={line + ` L${x(data.length - 1)},${H - pad} L${x(0)},${H - pad} Z`} fill="url(#ga)" />
        <path d={line} fill="none" stroke="#14B8A6" strokeWidth="3" strokeLinejoin="round" />
        {data.map((v, k) => (
          <g key={k} onClick={() => setI(k)} onMouseEnter={() => setI(k)} style={{ cursor: 'pointer' }}>
            <rect x={x(k) - W / data.length / 2} y="0" width={W / data.length} height={H} fill="transparent" />
            <circle
              cx={x(k)}
              cy={y(v)}
              r={k === i ? 7 : 4}
              fill={k === i ? '#14B8A6' : '#0B1320'}
              stroke="#14B8A6"
              strokeWidth="2.5"
            />
            <text x={x(k)} y={H - 6} textAnchor="middle" fontSize="11" fill={k === i ? '#5eead4' : '#8b9bb0'}>
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
          <div className="flex justify-between text-xs mb-1 tabular-nums">
            <span>{r[0]}</span>
            <span className="opacity-70">
              {fmt(r[1])}
              {r[2] || ''}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-acc"
              style={{ width: (r[1] / m) * 100 + '%', transition: 'width .6s' }}
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
}: {
  items: ShellNavItem[];
  active: string;
  setActive: (id: string) => void;
  title: string;
  sub: string;
  children: React.ReactNode;
  highlight?: string;
  headerAction?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-screen p-4 glass-s border-y-0 border-s-0 overflow-y-auto">
        <div className="px-2 pb-4 mb-3 border-b border-white/10 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-extrabold truncate">{title}</div>
            <div className="text-xs opacity-60 truncate">{sub}</div>
          </div>
          {headerAction}
        </div>
        <div className="flex-1">
          {items.map((it) => (
            <button
              key={it[0]}
              onClick={() => setActive(it[0])}
              className={
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm font-semibold transition text-start cursor-pointer ' +
                (active === it[0]
                  ? 'bg-acc text-[#04201c]'
                  : highlight === it[0]
                  ? 'bg-teal-500/15 text-teal-200 ring-1 ring-teal-400/40 hover:bg-teal-500/25'
                  : 'hover:bg-white/10 opacity-85')
              }
            >
              <I n={it[2]} s={18} />
              <span className="truncate">{it[1]}</span>
              {(it[3] || 0) > 0 && <span className="ms-auto badge b-bad tabular-nums">{it[3]}</span>}
              {highlight === it[0] && active !== it[0] && (
                <span className="ms-auto badge b-acc !text-[.62rem]">مهم</span>
              )}
            </button>
          ))}
        </div>
      </aside>

      <div className="lg:hidden sticky top-0 z-30 glass-s border-x-0 border-t-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
          <div className="min-w-0">
            <div className="font-extrabold text-sm truncate">{title}</div>
            <div className="text-[.7rem] opacity-60 truncate">{sub}</div>
          </div>
          {headerAction}
        </div>
        <div className="overflow-x-auto noscroll">
          <div className="flex gap-2 p-2 w-max">
            {items.map((it) => (
              <button
                key={it[0]}
                onClick={() => setActive(it[0])}
                className={'chip flex items-center gap-1.5 ' + (active === it[0] ? 'on' : '')}
              >
                <I n={it[2]} s={14} />
                {it[1]}
                {(it[3] || 0) > 0 && (
                  <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[.62rem] flex items-center justify-center tabular-nums">
                    {it[3]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="flex-1 p-4 lg:p-7 min-w-0 fade" key={active}>
        {children}
      </main>
    </div>
  );
}

export function Head({ t, sub, children }: { t: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div>
        <h2 className="text-xl lg:text-2xl font-extrabold">{t}</h2>
        {sub && <p className="text-sm opacity-60">{sub}</p>}
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
      <div className="font-extrabold text-lg">{t}</div>
      <p className="text-sm opacity-60 mb-4">{s}</p>
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
    <svg viewBox="-1 -1 27 27" width={size} height={size} style={{ background: '#fff', borderRadius: 12, padding: 4 }} fill="#0B1320">
      {cells}
      <F x={0} y={0} />
      <F x={n - 7} y={0} />
      <F x={0} y={n - 7} />
    </svg>
  );
}
