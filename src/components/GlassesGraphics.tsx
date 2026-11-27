import React, { useId, useState } from 'react';
import { FaceShape, FrameType, Inquiry, Product } from '../types';
import { resolveStoreFrontUrl } from '../utils/bulkFrameProcessor';
import { useResolvedRxUrl } from '../services/optiverseStore';
import { I } from './Icons';

export const LENS_SHAPES: Record<FrameType, { d: string; w: number; fill: number }> = {
  aviator: { d: 'M-36,-15 Q0,-22 36,-15 Q40,14 9,26 Q-30,28 -38,3 Z', w: 2.7, fill: 0.05 },
  wayfarer: { d: 'M-37,-15 L35,-18 Q40,-18 39,-12 L35,12 Q31,23 12,23 L-23,23 Q-37,21 -38,7 Z', w: 6.2, fill: 0.055 },
  rimless: { d: 'M0,-20 C27,-20 37,-9 37,2 C37,17 20,24 0,24 C-23,24 -37,15 -37,2 C-37,-11 -21,-20 0,-20Z', w: 2.0, fill: 0.18 },
  round: { d: 'M-29,1 a29,28 0 1 0 58,0 a29,28 0 1 0 -58,0', w: 3.4, fill: 0.05 },
  cat: { d: 'M-37,-4 Q-35,-21 -6,-18 Q22,-16 39,-23 Q41,5 33,16 Q25,25 4,25 Q-35,25 -37,-4Z', w: 4.5, fill: 0.055 },
};

function shadeHex(hex: string, delta: number): string {
  if (!hex || hex === 'transparent') return hex || '#94a3b8';
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(parseInt(full.slice(0, 2), 16) + delta);
  const g = clamp(parseInt(full.slice(2, 4), 16) + delta);
  const b = clamp(parseInt(full.slice(4, 6), 16) + delta);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function getCoatingStyle(lensTypeId?: string, yaw = 0) {
  const sheenOpacity = 0.12 + Math.min(0.06, Math.abs(yaw) / 700);
  if (lensTypeId === 'ar') {
    return {
      color: '#22c55e',
      secondary: '#86efac',
      opacity: sheenOpacity,
      label: 'طلاء AR أخضر',
    };
  }
  if (lensTypeId === 'bluecut' || lensTypeId === 'bluectrl') {
    return {
      color: '#6366f1',
      secondary: '#38bdf8',
      opacity: Math.min(0.18, sheenOpacity + 0.02),
      label: lensTypeId === 'bluectrl' ? 'طلاء أزرق/بنفسجي عالي' : 'طلاء Blue Cut أزرق',
    };
  }
  return {
    color: '#ffffff',
    secondary: '#e0f2fe',
    opacity: 0.12 + Math.min(0.04, Math.abs(yaw) / 900),
    label: 'انعكاس زجاجي طبيعي',
  };
}

export function Glasses({
  type = 'aviator',
  frame = '#C9A24B',
  lens = '#475569',
  yaw = 0,
  pitch = 0,
  coatingId,
  isSun = false,
  castShadow = true,
  hideTemples = false,
}: {
  type?: FrameType;
  frame?: string;
  lens?: string;
  yaw?: number;
  pitch?: number;
  coatingId?: string;
  isSun?: boolean;
  castShadow?: boolean;
  hideTemples?: boolean;
}) {
  const uid = useId().replace(/:/g, '_');
  const L = LENS_SHAPES[type] || LENS_SHAPES.aviator;
  const r = (yaw * Math.PI) / 180;
  const sx = Math.max(Math.cos(r), 0.35);
  const sh = Math.sin(r);
  const coat = getCoatingStyle(coatingId, yaw);
  const isTransparentFrame = frame === 'transparent';

  // Detect metallic vs acetate styling based on frame category or metallic tones
  const isMetallic =
    type === 'aviator' ||
    type === 'rimless' ||
    /^#(c9a24b|d4af37|cbd5e1|94a3b8|e2e8f0|b87333|d97706)/i.test(frame);

  // Smoothly shift reflection band with head yaw & pitch
  const glintShiftX = yaw * 0.72;
  const glintShiftY = pitch * 0.35;

  // 92% - 95% crystal clear optical transmission so eyes and eyelids show crisply
  const opticalFillOpacity = isSun ? 0.54 : L.fill;

  const frameLight = shadeHex(frame, isMetallic ? 58 : 34);
  const frameMid = frame;
  const frameDark = shadeHex(frame, isMetallic ? -52 : -36);
  const frameDeep = shadeHex(frame, -78);

  const ex = 83 * sx;
  const len = Math.abs(sh) * 96 + 10;
  const tw = type === 'rimless' ? 1.5 : type === 'wayfarer' ? 5.6 : isMetallic ? 2.4 : 3.4;

  // Soft shadow shift opposite to upper-front ambient lighting
  const shadowOffsetX = -yaw * 0.09;
  const shadowOffsetY = 4.2 + Math.max(-1.5, Math.min(2.5, pitch * 0.08));

  const lensEl = (side: 'l' | 'r') => {
    const sideId = `${uid}_${side}`;
    const mirror = side === 'l' ? -1 : 1;
    const localGlint = glintShiftX * mirror;

    return (
      <g>
        <defs>
          <clipPath id={`clip-${sideId}`}>
            <path d={L.d} />
          </clipPath>
          <linearGradient id={`tint-${sideId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isSun ? lens : '#e2f1ff'} stopOpacity={isSun ? 0.68 : opticalFillOpacity * 1.1} />
            <stop offset="55%" stopColor={isSun ? lens : '#f8fafc'} stopOpacity={isSun ? 0.52 : opticalFillOpacity * 0.55} />
            <stop offset="100%" stopColor={isSun ? lens : '#e2f1ff'} stopOpacity={isSun ? 0.38 : opticalFillOpacity * 0.85} />
          </linearGradient>
          <linearGradient id={`glint-${sideId}`} x1="0" y1="0" x2="1" y2="0.45">
            <stop offset="0%" stopColor={coat.secondary} stopOpacity="0" />
            <stop offset="32%" stopColor={coat.secondary} stopOpacity={coat.opacity * 0.6} />
            <stop offset="50%" stopColor="#ffffff" stopOpacity={Math.min(0.18, coat.opacity * 1.1)} />
            <stop offset="68%" stopColor={coat.color} stopOpacity={coat.opacity * 0.75} />
            <stop offset="100%" stopColor={coat.color} stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`edge-${sideId}`} cx="50%" cy="50%" r="55%">
            <stop offset="80%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="97%" stopColor="#e2e8f0" stopOpacity={isSun ? 0.06 : 0.09} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.18" />
          </radialGradient>
        </defs>

        {/* Crystal clear 92%-95% glass body (or tinted sun lens; tinted slate glass on rimless for clear visibility) */}
        <path
          d={L.d}
          fill={type === 'rimless' && !isSun ? 'rgba(148,163,184,0.18)' : `url(#tint-${sideId})`}
        />

        {/* Thin bevel sheen & subtle head-angle specular coating glint (screen blend, <= 0.18 opacity) */}
        <g clipPath={`url(#clip-${sideId})`}>
          <path d={L.d} fill={`url(#edge-${sideId})`} />
          <g
            transform={`translate(${localGlint}, ${glintShiftY})`}
            filter={`url(#glint-blur-${uid})`}
            style={{ mixBlendMode: 'screen' }}
          >
            <path
              d="M-26,-32 L-1,-32 L-22,34 L-44,34 Z"
              fill={`url(#glint-${sideId})`}
              opacity={1}
            />
            <path
              d="M9,-30 L18,-30 L-2,32 L-10,32 Z"
              fill={coat.secondary}
              opacity={Math.min(0.14, coat.opacity * 0.75)}
            />
          </g>
        </g>

        {/* Frame rim */}
        {!isTransparentFrame && (
          type === 'rimless' ? (
            <>
              {/* Crisp visible bevel edge for Rimless frames */}
              <path
                d={L.d}
                fill="rgba(148,163,184,0.18)"
                stroke="#475569"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              {/* Drill-mount metallic studs at nasal & temporal mounts */}
              <circle cx="-33" cy="-5" r="2.1" fill="#475569" stroke={frameDark} strokeWidth="0.4" />
              <circle cx="34" cy="-7" r="2.2" fill="#475569" stroke={frameDark} strokeWidth="0.4" />
              <rect x="33" y="-9.2" width="6.5" height="4.4" rx="1.4" fill="#475569" />
            </>
          ) : isMetallic ? (
            <>
              {/* Subtle inner groove depth */}
              <path d={L.d} fill="none" stroke={frameDeep} strokeWidth={L.w + 0.9} strokeLinejoin="round" opacity="0.5" />
              {/* Brushed metallic rim */}
              <path d={L.d} fill="none" stroke={`url(#metal-${uid})`} strokeWidth={L.w} strokeLinejoin="round" />
              {/* Specular wire edge */}
              <path
                d={L.d}
                fill="none"
                stroke={frameLight}
                strokeWidth={Math.max(0.6, L.w * 0.28)}
                strokeLinejoin="round"
                opacity="0.65"
                transform="translate(-0.3,-0.45)"
              />
              {/* Outer hinge endpiece */}
              <rect x="35" y="-12" width="5.2" height="4.2" rx="1.2" fill={`url(#metal-${uid})`} stroke={frameDark} strokeWidth="0.4" />
            </>
          ) : (
            <>
              {/* Sculpted acetate frame depth & bevel */}
              <path d={L.d} fill="none" stroke={frameDeep} strokeWidth={L.w + 1.4} strokeLinejoin="round" opacity="0.65" />
              <path d={L.d} fill="none" stroke={`url(#acetate-${uid})`} strokeWidth={L.w} strokeLinejoin="round" />
              {/* Inner lens groove rim */}
              <path d={L.d} fill="none" stroke={frameDark} strokeWidth="1.15" strokeLinejoin="round" opacity="0.7" />
              {/* Upper-edge glossy acetate highlight */}
              <path
                d={L.d}
                fill="none"
                stroke={frameLight}
                strokeWidth="1.2"
                strokeLinejoin="round"
                opacity="0.42"
                transform="translate(0,-0.8)"
              />
              {/* Metallic hinge rivets on acetate endpiece */}
              <rect x="33.5" y="-13.5" width="7.5" height="5.5" rx="1.8" fill={`url(#acetate-${uid})`} />
              <circle cx="36.2" cy="-11.5" r="0.85" fill="#e2e8f0" opacity="0.9" />
              <circle cx="38.6" cy="-10.2" r="0.85" fill="#e2e8f0" opacity="0.9" />
            </>
          )
        )}
      </g>
    );
  };

  const bw = type === 'wayfarer' ? 5.2 : type === 'rimless' ? 1.8 : 2.6;
  const bridgeStroke = isMetallic ? `url(#metal-${uid})` : `url(#acetate-${uid})`;

  const nosePads =
    !isTransparentFrame && isMetallic ? (
      <g opacity="0.9">
        {/* Pad wire arms */}
        <path d="M-9,-3 Q-12,3 -11,7" stroke={frameDark} strokeWidth="0.9" fill="none" />
        <path d="M9,-3 Q12,3 11,7" stroke={frameDark} strokeWidth="0.9" fill="none" />
        {/* Translucent silicone nose pads */}
        <ellipse cx="-11.2" cy="7" rx="2.4" ry="4.4" transform="rotate(14 -11.2 7)" fill="rgba(241,245,249,0.58)" stroke="rgba(148,163,184,0.65)" strokeWidth="0.5" />
        <ellipse cx="11.2" cy="7" rx="2.4" ry="4.4" transform="rotate(-14 11.2 7)" fill="rgba(241,245,249,0.58)" stroke="rgba(148,163,184,0.65)" strokeWidth="0.5" />
      </g>
    ) : null;

  const bridge = isTransparentFrame ? null : type === 'aviator' ? (
    <g fill="none">
      <path d="M-12,-12 Q0,-17 12,-12" stroke={frameDark} strokeWidth="2.8" />
      <path d="M-12,-12 Q0,-17 12,-12" stroke={`url(#metal-${uid})`} strokeWidth="2.1" />
      <path d="M-10,-4 Q0,-9 10,-4" stroke={frameDark} strokeWidth="2.4" />
      <path d="M-10,-4 Q0,-9 10,-4" stroke={`url(#metal-${uid})`} strokeWidth="1.8" />
    </g>
  ) : (
    <g fill="none">
      <path d="M-10,-7 Q0,-14 10,-7" stroke={frameDeep} strokeWidth={bw + 0.9} strokeLinecap="round" opacity="0.6" />
      <path d="M-10,-7 Q0,-14 10,-7" stroke={bridgeStroke} strokeWidth={bw} strokeLinecap="round" />
      <path d="M-8,-8 Q0,-14.5 8,-8" stroke={frameLight} strokeWidth="0.9" strokeLinecap="round" opacity="0.5" />
    </g>
  );

  return (
    <g>
      <defs>
        <linearGradient id={`metal-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={frameLight} />
          <stop offset="35%" stopColor={frameMid} />
          <stop offset="68%" stopColor={frameDark} />
          <stop offset="100%" stopColor={frameLight} />
        </linearGradient>
        <linearGradient id={`acetate-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={frameLight} />
          <stop offset="32%" stopColor={frameMid} />
          <stop offset="85%" stopColor={frameDark} />
          <stop offset="100%" stopColor={frameDeep} />
        </linearGradient>
        <filter id={`shadow-blur-${uid}`} x="-35%" y="-45%" width="170%" height="200%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
        <filter id={`contact-blur-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.1" />
        </filter>
        <filter id={`glint-blur-${uid}`} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* Soft realistic shadows cast beneath lower rim and beside nose bridge */}
      {castShadow && !isTransparentFrame && (
        <g pointerEvents="none">
          {/* Lower rim & cheek ambient drop shadow */}
          <g
            transform={`translate(${shadowOffsetX}, ${shadowOffsetY}) scale(${sx} 1)`}
            filter={`url(#shadow-blur-${uid})`}
            opacity={isSun ? 0.26 : 0.18}
          >
            <g transform="translate(47,0)">
              <path d={L.d} fill={isSun ? 'rgba(10,6,4,0.34)' : 'none'} stroke="#0a0604" strokeWidth={L.w + 1.2} />
            </g>
            <g transform="translate(-47,0) scale(-1,1)">
              <path d={L.d} fill={isSun ? 'rgba(10,6,4,0.34)' : 'none'} stroke="#0a0604" strokeWidth={L.w + 1.2} />
            </g>
            <path d="M-10,-7 Q0,-14 10,-7" stroke="#0a0604" strokeWidth={bw + 1} fill="none" />
          </g>
          {/* Soft skin contact shadow on both sides of the nose */}
          <g transform={`translate(${shadowOffsetX * 0.4}, 2.4) scale(${sx} 1)`} filter={`url(#contact-blur-${uid})`} opacity="0.24">
            <ellipse cx="-12.5" cy="6" rx="4.2" ry="6.5" fill="#090503" />
            <ellipse cx="12.5" cy="6" rx="4.2" ry="6.5" fill="#090503" />
            <ellipse cx="0" cy="-6" rx="9.5" ry="3.6" fill="#090503" />
          </g>
        </g>
      )}

      {/* Front frame, lenses, bridge & nose pads */}
      <g transform={`scale(${sx} 1)`}>
        <g transform="translate(47,0)">{lensEl('r')}</g>
        <g transform="translate(-47,0) scale(-1,1)">{lensEl('l')}</g>
        {nosePads}
        {bridge}
      </g>

      {/* Tapered metallic/acetate temples (hidden when FaceTryOnStage renders 3D ear-occluded arms) */}
      {!hideTemples && !isTransparentFrame && (
        <g strokeLinecap="round" fill="none">
          <path d={`M${ex},-10 L${ex + (sh >= 0 ? len : 8)},-5`} stroke={frameDeep} strokeWidth={tw + 0.8} opacity="0.45" />
          <path d={`M${ex},-10 L${ex + (sh >= 0 ? len : 8)},-5`} stroke={bridgeStroke} strokeWidth={tw} />
          <path d={`M${-ex},-10 L${-ex - (sh < 0 ? len : 8)},-5`} stroke={frameDeep} strokeWidth={tw + 0.8} opacity="0.45" />
          <path d={`M${-ex},-10 L${-ex - (sh < 0 ? len : 8)},-5`} stroke={bridgeStroke} strokeWidth={tw} />
        </g>
      )}
    </g>
  );
}

export function MiniGlasses({
  type,
  frame,
  lens,
  w = 70,
  imageUrl,
}: {
  type: FrameType;
  frame: string;
  lens: string;
  w?: number;
  imageUrl?: string;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt="صورة النظارة"
        loading="lazy"
        decoding="async"
        style={{
          width: w,
          height: Math.round(w * 0.48),
          objectFit: 'contain',
          filter: 'drop-shadow(0 8px 10px rgba(15, 23, 42, 0.22))',
        }}
        className="mx-auto select-none pointer-events-none"
      />
    );
  }
  return (
    <svg viewBox="-110 -34 220 68" width={w} height={w * 0.31}>
      <Glasses type={type} frame={frame} lens={lens} castShadow={false} />
    </svg>
  );
}

export function Face({
  shape = 'oval',
  type,
  frame,
  lens,
  yaw = 0,
  tracking = true,
  scan = false,
  pd = true,
  coatingId,
  isSun = false,
}: {
  shape?: FaceShape;
  type: FrameType;
  frame: string;
  lens: string;
  yaw?: number;
  tracking?: boolean;
  scan?: boolean;
  pd?: boolean;
  coatingId?: string;
  isSun?: boolean;
}) {
  const r = (yaw * Math.PI) / 180;
  const c = Math.cos(r) * 0.9 + 0.1;
  const tx = yaw * 1.1;
  const head =
    shape === 'round' ? (
      <ellipse cx="150" cy="176" rx="94" ry="102" />
    ) : shape === 'square' ? (
      <path d="M64,112 Q64,72 150,70 Q236,72 236,112 L234,205 Q230,268 150,286 Q70,268 66,205 Z" />
    ) : (
      <ellipse cx="150" cy="172" rx="80" ry="116" />
    );
  const pts = [
    [115, 150],
    [185, 150],
    [150, 162],
    [150, 205],
    [72, 155],
    [228, 155],
    [150, 289],
    [88, 242],
    [212, 242],
    [150, 72],
    [120, 242],
    [180, 242],
  ];
  return (
    <svg viewBox="0 0 300 360" className="w-full h-full" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0c6a2" />
          <stop offset="1" stopColor="#d49c78" />
        </linearGradient>
        <linearGradient id="shirt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#134e4a" />
          <stop offset="1" stopColor="#0b2a2e" />
        </linearGradient>
      </defs>
      <path d="M10,362 Q22,300 100,290 L200,290 Q278,300 290,362 Z" fill="url(#shirt)" />
      <rect x="124" y="262" width="52" height="40" rx="14" fill="#d49c78" />
      <g transform={`translate(${150 - 150 * c + tx * 0.4} 0) scale(${c} 1)`}>
        <circle cx="68" cy="176" r="13" fill="#dba883" />
        <circle cx="232" cy="176" r="13" fill="#dba883" />
        <g fill="url(#skin)">{head}</g>
        <path d="M60,160 Q42,50 150,42 Q258,50 240,160 Q226,96 150,92 Q74,96 60,160Z" fill="#1c1917" />
        <g stroke="#1c1917" strokeWidth="4" strokeLinecap="round" fill="none">
          <path d="M96,132 Q115,124 134,131" />
          <path d="M166,131 Q185,124 204,132" />
        </g>
        <ellipse cx="115" cy="152" rx="13" ry="7" fill="#fff" />
        <ellipse cx="185" cy="152" rx="13" ry="7" fill="#fff" />
        <circle cx="115" cy="152" r="5" fill="#3b2314" />
        <circle cx="185" cy="152" r="5" fill="#3b2314" />
        <path d="M150,158 Q142,196 138,204 Q150,212 162,204" stroke="#b9805e" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M124,244 Q150,262 176,244" stroke="#9a4b4b" strokeWidth="4" fill="none" strokeLinecap="round" />
      </g>
      <g transform={`translate(${tx} 0)`}>
        <g transform="translate(150,157) scale(.76)">
          <Glasses type={type} frame={frame} lens={lens} yaw={yaw} coatingId={coatingId} isSun={isSun} castShadow />
        </g>
        {tracking && (
          <g>
            {pts.map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r="3.2"
                fill="#14B8A6"
                className="dotp"
                style={{ animationDelay: i * 0.15 + 's' }}
              />
            ))}
            <g stroke="rgba(20,184,166,.45)" strokeWidth="1" fill="none">
              <path d="M115,150L150,162L185,150M72,155L115,150M185,150L228,155M88,242L150,289L212,242M150,72L150,162" />
            </g>
            {pd && (
              <g>
                <path d="M115,124 L185,124 M115,119 L115,129 M185,119 L185,129" stroke="#5eead4" strokeWidth="1.5" />
                <rect x="118" y="100" width="64" height="18" rx="9" fill="rgba(11,19,32,.85)" stroke="#14B8A6" />
                <text x="150" y="113" textAnchor="middle" fontSize="10.5" fill="#5eead4" fontWeight="700">
                  PD: 63mm
                </text>
              </g>
            )}
          </g>
        )}
      </g>
      {scan && (
        <g className="scanline">
          <rect x="40" y="0" width="220" height="3" fill="#5eead4" opacity=".9" />
        </g>
      )}
    </svg>
  );
}

export function Corners() {
  return (
    <>
      {[
        'top-3 right-3 border-t-2 border-r-2',
        'top-3 left-3 border-t-2 border-l-2',
        'bottom-3 right-3 border-b-2 border-r-2',
        'bottom-3 left-3 border-b-2 border-l-2',
      ].map((c) => (
        <span key={c} className={'absolute w-6 h-6 rounded-sm bd-acc pointer-events-none ' + c} />
      ))}
    </>
  );
}

export function Spin({ p, w = 120 }: { p: Product; w?: number }) {
  const imgSrc = resolveStoreFrontUrl(p);
  if (imgSrc) {
    return (
      <div className="h-28 flex items-center justify-center p-2">
        <img
          src={imgSrc}
          alt={p.name}
          loading="lazy"
          decoding="async"
          className="max-h-full max-w-full object-contain"
          style={{ filter: 'drop-shadow(0 8px 14px rgba(20, 20, 20, 0.16))' }}
        />
      </div>
    );
  }
  return (
    <svg viewBox="-120 -50 240 100" width="100%" style={{ maxWidth: w * 2 }} className="mx-auto">
      <Glasses type={p.type} frame={p.frame} lens={p.lens} yaw={18} />
    </svg>
  );
}

export function Rx({ n = 1 }: { n?: number }) {
  const R = [
    ['-2.25', '-0.75', '180', '-2.00', '-0.50', '175'],
    ['+1.50', '-0.50', '90', '+1.25', '-0.25', '85'],
    ['-3.00', '-1.00', '10', '-2.75', '-0.75', '15'],
    ['-1.25', '0.00', '0', '-1.00', '0.00', '0'],
  ][n % 4];
  return (
    <svg viewBox="0 0 300 380" className="w-full block" style={{ background: '#f8fafc', borderRadius: 10 }}>
      <rect x="0" y="0" width="300" height="56" fill="#0f766e" />
      <text x="150" y="26" textAnchor="middle" fontSize="17" fontWeight="800" fill="#fff">
        مركز الإبصار لفحص النظر
      </text>
      <text x="150" y="44" textAnchor="middle" fontSize="10" fill="#ccfbf1">
        Vision Center — Eye Examination
      </text>
      <text x="20" y="84" fontSize="11" fill="#334155">
        DATE: 12 / 11 / 2026
      </text>
      <text x="280" y="84" textAnchor="end" fontSize="11" fill="#334155">
        PATIENT: ........
      </text>
      <g fontSize="12" fill="#0f172a" textAnchor="middle">
        {['', 'SPH', 'CYL', 'AXIS'].map((h, i) => (
          <text key={i} x={[40, 120, 185, 250][i]} y="122" fontWeight="800" fill="#0f766e">
            {h}
          </text>
        ))}
        <line x1="15" x2="285" y1="132" y2="132" stroke="#94a3b8" />
        <text x="40" y="160" fontWeight="800">
          OD
        </text>
        {[0, 1, 2].map((i) => (
          <text key={i} x={[120, 185, 250][i]} y="160">
            {R[i]}
          </text>
        ))}
        <line x1="15" x2="285" y1="174" y2="174" stroke="#e2e8f0" />
        <text x="40" y="202" fontWeight="800">
          OS
        </text>
        {[0, 1, 2].map((i) => (
          <text key={i} x={[120, 185, 250][i]} y="202">
            {R[i + 3]}
          </text>
        ))}
        <line x1="15" x2="285" y1="216" y2="216" stroke="#94a3b8" />
        <text x="40" y="250" fontWeight="800">
          PD
        </text>
        <text x="120" y="250">
          63 mm
        </text>
        <text x="40" y="282" fontWeight="800">
          ADD
        </text>
        <text x="120" y="282">
          —
        </text>
      </g>
      <rect x="15" y="300" width="270" height="34" rx="6" fill="#ecfeff" stroke="#a5f3fc" />
      <text x="150" y="322" textAnchor="middle" fontSize="11" fill="#155e75">
        ملحوظات: يُنصح بعدسات للاستخدام الدائم
      </text>
      <path d="M200,366 q10,-22 20,0 t20,0 t22,-6" stroke="#1e3a8a" strokeWidth="2" fill="none" />
      <text x="40" y="364" fontSize="10" fill="#64748b">
        Dr. signature
      </text>
    </svg>
  );
}

export function ExamThumb({ q, onZoom }: { q: Inquiry; onZoom: () => void }) {
  const resolvedRxUrl = useResolvedRxUrl(q.img);
  const isPdf = Boolean(q.img && q.img.toLowerCase().endsWith('.pdf'));

  if (!q.img) {
    return (
      <div className="rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center text-center p-4 text-xs opacity-60 h-full min-h-[140px]">
        <I n="receipt" s={26} />
        <span className="mt-1">طلب مباشر — بدون كشف</span>
      </div>
    );
  }
  return (
    <button onClick={onZoom} className="relative block w-full rounded-xl overflow-hidden group border border-white/15 cursor-pointer">
      {q.img === 'demo' ? (
        <Rx n={q.rxn || 0} />
      ) : isPdf ? (
        <div className="rounded-xl bg-slate-100 text-[#0F172A] flex flex-col items-center justify-center p-4 min-h-[140px] text-xs font-bold">
          <I n="receipt" s={26} />
          <span className="mt-1">كشف طبي PDF</span>
        </div>
      ) : (
        <img src={resolvedRxUrl || ''} alt="كشف" loading="lazy" decoding="async" className="w-full max-h-64 object-cover" />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-black/60 text-[.7rem] py-1 flex items-center justify-center gap-1">
        <I n="search" s={12} /> اضغط للتكبير
      </span>
    </button>
  );
}

export function BeforeAfter({ lens }: { lens: string }) {
  const [v, setV] = useState(50);
  const A: Record<string, { g: number; h: number }> = {
    plastic: { g: 0.5, h: 0.5 },
    glass: { g: 0.45, h: 0.5 },
    ar: { g: 0, h: 0.45 },
    bluecut: { g: 0.3, h: 0.14 },
    bluectrl: { g: 0, h: 0.04 },
  };
  const cfg = A[lens] || { g: 0.4, h: 0.4 };

  const Scene = ({ id, blur, g, h }: { id: string; blur: number; g: number; h: number }) => (
    <svg viewBox="0 0 400 240" className="w-full block" style={{ background: '#bfdbfe' }}>
      <defs>
        <filter id={'bl' + id}>
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        <filter id={'gl' + id}>
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <g filter={blur ? `url(#bl${id})` : undefined}>
        <rect x="0" y="0" width="400" height="240" fill="#bae6fd" />
        <rect x="0" y="172" width="400" height="68" fill="#7c5c3b" />
        <circle cx="340" cy="52" r="26" fill="#fde68a" />
        <rect x="300" y="20" width="90" height="70" fill="none" stroke="#e2e8f0" strokeWidth="4" />
        <rect x="118" y="66" width="172" height="104" rx="6" fill="#0f172a" />
        <rect x="126" y="74" width="156" height="88" rx="3" fill="#1e3a8a" />
        {[84, 98, 112, 126, 140].map((y, i) => (
          <rect key={y} x="136" y={y} width={[100, 70, 110, 60, 90][i]} height="6" rx="3" fill="#e0f2fe" />
        ))}
        <rect x="96" y="170" width="216" height="8" rx="4" fill="#94a3b8" />
        <circle cx="56" cy="150" r="22" fill="#16a34a" />
        <rect x="52" y="168" width="8" height="12" fill="#78350f" />
      </g>
      <ellipse cx="204" cy="116" rx="120" ry="76" fill="#60a5fa" opacity={h} filter={`url(#gl${id})`} />
      <circle cx="340" cy="52" r="64" fill="#fff" opacity={g} filter={`url(#gl${id})`} />
      <rect
        x="120"
        y="70"
        width="60"
        height="26"
        fill="#fff"
        opacity={g * 0.7}
        transform="rotate(-18 150 83)"
        filter={`url(#gl${id})`}
      />
    </svg>
  );

  return (
    <div>
      <div className="relative rounded-2xl overflow-hidden border border-white/15" dir="ltr">
        <Scene id="b" blur={2.4} g={0.85} h={0.8} />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${v}%)` }}>
          <Scene id="a" blur={0} g={cfg.g} h={cfg.h} />
        </div>
        <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: v + '%' }}>
          <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white text-[#0B1320] flex items-center justify-center text-xs font-extrabold">
            ⇆
          </span>
        </div>
        <span className="absolute top-2 left-2 badge b-bad">بدون عدسة</span>
        <span className="absolute top-2 right-2 badge b-ok">بالعدسة</span>
      </div>
      <input type="range" min="0" max="100" value={v} onChange={(e) => setV(+e.target.value)} className="mt-3" dir="ltr" />
      <p className="text-xs opacity-65 mt-2">
        اسحب المؤشر لمقارنة الرؤية: الصورة بدون عدسة (غير واضحة، وهج، وضوء أزرق) وبعدها بالعدسة المختارة.
      </p>
    </div>
  );
}
