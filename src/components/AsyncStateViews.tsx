import React from 'react';
import { I } from './Icons';

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5" aria-busy="true">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-2xl bg-white border border-[#E2E8F0] p-4 space-y-3 animate-pulse"
        >
          <div className="h-40 rounded-xl bg-slate-200/70" />
          <div className="h-4 w-3/4 rounded bg-slate-200/80" />
          <div className="h-3.5 w-1/3 rounded bg-slate-200/70" />
          <div className="h-11 w-full rounded-xl bg-slate-200/70" />
        </div>
      ))}
    </div>
  );
}

export function ListCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-busy="true">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-2xl bg-white border border-[#E2E8F0] p-4 space-y-3 animate-pulse"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="h-4 w-1/2 rounded bg-slate-200/80" />
            <div className="h-5 w-16 rounded-full bg-slate-200/70" />
          </div>
          <div className="h-12 rounded-xl bg-slate-200/60" />
          <div className="h-10 w-full rounded-xl bg-slate-200/70" />
        </div>
      ))}
    </div>
  );
}

export function TableRowsSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="glass rounded-2xl p-4 space-y-3 animate-pulse" aria-busy="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="h-5 rounded bg-slate-200/75" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function AsyncErrorBanner({
  message = 'تعذّر تحميل البيانات حالياً، تحقق من الاتصال وحاول مجدداً.',
  onRetry,
  retrying = false,
}: {
  message?: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl bg-rose-50 border border-rose-200 p-4 flex flex-wrap items-center justify-between gap-3 text-rose-900"
    >
      <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold min-w-0 flex-1">
        <span className="text-lg shrink-0">⚠️</span>
        <span>{message}</span>
      </div>
      <button
        type="button"
        disabled={retrying}
        onClick={onRetry}
        className="btn btn-sm !bg-rose-600 hover:!bg-rose-700 !text-white shrink-0 font-extrabold"
      >
        <I n="refresh" s={14} /> {retrying ? 'جاري المحاولة...' : 'إعادة المحاولة'}
      </button>
    </div>
  );
}

export function ArabicEmptyState({
  title = 'لا توجد نتائج',
  subtitle,
  actionLabel,
  onAction,
}: {
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="glass rounded-2xl p-8 sm:p-10 text-center space-y-2.5">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center">
        <I n="search" s={22} />
      </div>
      <div className="font-extrabold text-sm sm:text-base text-[#0F172A]">{title}</div>
      {subtitle && <div className="text-xs text-slate-500 max-w-md mx-auto">{subtitle}</div>}
      {actionLabel && onAction && (
        <div className="pt-1">
          <button type="button" onClick={onAction} className="btn btn-g btn-sm">
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function LoadMoreBar({
  loadedCount,
  totalCount,
  hasMore,
  loadingMore = false,
  onLoadMore,
  itemLabel = 'عنصر',
}: {
  loadedCount: number;
  totalCount?: number | null;
  hasMore: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
  itemLabel?: string;
}) {
  if (!hasMore && (!totalCount || loadedCount >= totalCount)) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white border border-[#E2E8F0] px-4 py-3 text-xs text-slate-700">
      <span>
        عرض <b>{loadedCount}</b>
        {typeof totalCount === 'number' && totalCount >= loadedCount ? (
          <>
            {' '}
            من <b>{totalCount}</b>
          </>
        ) : null}{' '}
        {itemLabel}
      </span>
      {hasMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
          className="btn btn-p btn-sm font-extrabold"
        >
          {loadingMore ? 'جاري التحميل...' : 'عرض المزيد'}
        </button>
      )}
    </div>
  );
}

export function PageSuspendFallback({ label = 'جاري تحميل الصفحة...' }: { label?: string }) {
  return (
    <div dir="rtl" className="min-h-[100dvh] flex items-center justify-center p-6 bg-[#F8F9FA]">
      <div className="glass rounded-2xl px-6 py-5 flex items-center gap-3 text-sm font-bold text-[#0F172A]">
        <span className="w-5 h-5 rounded-full border-2 border-[#0284C7] border-t-transparent animate-spin shrink-0" />
        <span>{label}</span>
      </div>
    </div>
  );
}
