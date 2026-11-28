import React, { useCallback, useEffect, useState } from 'react';
import { EGYPT_GOVERNORATES } from '../data/seed';
import { useOptiVerse } from '../services/optiverseStore';
import { Shop } from '../types';
import { useDebouncedValue } from '../utils/queryCache';
import {
  ArabicEmptyState,
  AsyncErrorBanner,
  ListCardsSkeleton,
  LoadMoreBar,
} from '../components/AsyncStateViews';
import { I } from '../components/Icons';
import { waNum } from '../components/UiShared';

const DIRECTORY_PAGE_SIZE = 25;

export function DirectoryPage() {
  const { navigate, platformSettings, fetchDirectoryShopsPage } = useOptiVerse();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [govFilter, setGovFilter] = useState('الكل');
  const directoryEnabled = Boolean(platformSettings.enableStoresDirectory);

  const [dirShops, setDirShops] = useState<Shop[]>([]);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    async (targetPage: number, append: boolean) => {
      if (!directoryEnabled) {
        setLoading(false);
        return;
      }
      setError(null);
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await fetchDirectoryShopsPage({
          page: targetPage,
          pageSize: DIRECTORY_PAGE_SIZE,
          search: debouncedSearch,
          gov: govFilter,
        });
        setDirShops((prev) => (append ? [...prev, ...res.rows.filter((r) => !prev.some((x) => x.id === r.id))] : res.rows));
        if (targetPage === 0) {
          setTotalCount(res.totalCount);
        }
        setHasMore(res.hasMore);
        setPage(targetPage);
      } catch (e: any) {
        setError(e?.message || 'تعذر تحميل دليل المحلات');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedSearch, directoryEnabled, fetchDirectoryShopsPage, govFilter]
  );

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  return (
    <div dir="rtl" className="min-h-[100dvh] bg-[#F8F9FA] text-[#0F172A] overflow-x-hidden">
      <header className="bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between gap-2 sm:gap-3">
          <a
            href="/"
            dir="ltr"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            className="inline-flex items-center gap-2 min-h-[44px] font-extrabold text-lg sm:text-xl whitespace-nowrap shrink-0 text-[#0F172A]"
          >
            <span>
              Opti<span className="text-[#0284C7]">Verse</span>
            </span>
            <span className="w-9 h-9 rounded-xl bg-[#0F172A] text-white flex items-center justify-center shrink-0">
              <I n="glasses" s={20} />
            </span>
          </a>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="btn btn-g btn-sm whitespace-nowrap shrink-0"
              onClick={() => navigate('/')}
            >
              الرئيسية
            </button>
            <button
              type="button"
              className="btn !bg-[#D97706] hover:!bg-[#B45309] !text-white btn-sm whitespace-nowrap shrink-0"
              onClick={() => navigate('/merchant?mode=signup')}
            >
              <I n="store" s={15} /> سجّل محلك
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:py-10 space-y-6">
        <div className="bg-white rounded-3xl border border-[#E2E8F0] shadow-sm p-6 sm:p-8 text-center">
          <span className="badge b-acc mb-3">
            <I n="map" s={13} /> شبكة المحلات المعتمدة في مصر
          </span>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-[#0F172A] mb-2">
            دليل محلات البصريات المعتمدة
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 max-w-2xl mx-auto leading-7">
            تصفّح أقرب محل بصريات معتمد في محافظتك، جرّب النظارات بمقاسها الحقيقي بتقنية AI + 3D قبل الزيارة، أو تواصل
            مع المحل مباشرة على واتساب وخرائط جوجل.
          </p>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
            <div className="sm:col-span-2 relative">
              <input
                type="text"
                className="inp ps-10"
                placeholder="ابحث باسم المحل أو العنوان أو المحافظة..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400">
                <I n="search" s={17} />
              </span>
            </div>
            <select
              className="inp font-bold"
              value={govFilter}
              onChange={(e) => setGovFilter(e.target.value)}
              aria-label="تصفية حسب المحافظة"
            >
              <option value="الكل">كل المحافظات ({EGYPT_GOVERNORATES.length})</option>
              {EGYPT_GOVERNORATES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs sm:text-sm text-slate-600 px-1">
          <span>
            إجمالي المحلات المتاحة:{' '}
            <b className="text-[#0F172A] tabular-nums">{totalCount ?? dirShops.length}</b> محل
          </span>
          {govFilter !== 'الكل' && (
            <button
              type="button"
              className="text-[#0284C7] font-bold hover:underline cursor-pointer"
              onClick={() => setGovFilter('الكل')}
            >
              عرض كل المحافظات
            </button>
          )}
        </div>

        {!directoryEnabled ? (
          <div className="bg-white rounded-3xl border border-[#E2E8F0] p-12 text-center space-y-3">
            <span className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 inline-flex items-center justify-center">
              <I n="lock" s={24} />
            </span>
            <div className="font-extrabold text-base text-[#0F172A]">دليل المحلات العام مخفي حالياً</div>
            <p className="text-xs text-slate-500">يمكن تفعيل ظهور دليل المحلات المعتمدة عبر لوحة تحكم إدارة المنصة</p>
            <button type="button" className="btn btn-p btn-sm" onClick={() => navigate('/')}>
              العودة للرئيسية
            </button>
          </div>
        ) : error ? (
          <AsyncErrorBanner message={error} onRetry={() => void loadPage(0, false)} />
        ) : loading ? (
          <ListCardsSkeleton count={6} />
        ) : dirShops.length === 0 ? (
          <ArabicEmptyState
            title="لا توجد نتائج"
            subtitle="جرّب تغيير المحافظة أو مسح نص البحث"
            actionLabel="إعادة ضبط الفلاتر"
            onAction={() => {
              setSearch('');
              setGovFilter('الكل');
            }}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {dirShops.map((s) => {
                const gov = s.governorate || s.city || 'القاهرة';
                const waHref = `https://wa.me/${waNum(s.wa)}?text=${encodeURIComponent(
                  `مرحباً ${s.name}، وجدت متجركم عبر دليل محلات OptiVerse وأرغب في الاستفسار عن النظارات.`
                )}`;
                const isImgLogo = Boolean(s.logo && /^(https?:|data:image\/|blob:|\/)/i.test(s.logo));
                return (
                  <article
                    key={s.id}
                    className={
                      'bg-white rounded-3xl border p-5 flex flex-col gap-4 transition hover:-translate-y-0.5 hover:shadow-md ' +
                      (s.isFeatured
                        ? 'border-[#D97706]/60 ring-1 ring-[#D97706]/25 shadow-sm'
                        : 'border-[#E2E8F0] shadow-xs')
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-12 h-12 rounded-2xl bg-[#0F172A] text-white text-2xl flex items-center justify-center shrink-0 overflow-hidden">
                          {isImgLogo ? (
                            <img
                              src={s.logo}
                              alt={s.name}
                              width={48}
                              height={48}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-contain bg-white p-0.5"
                            />
                          ) : (
                            s.logo || '👓'
                          )}
                        </span>
                        <div className="min-w-0">
                          <h2 className="font-extrabold text-base text-[#0F172A] truncate">{s.name}</h2>
                          <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                            <I n="map" s={12} c="text-[#0284C7]" />
                            <span>{gov}</span>
                          </div>
                        </div>
                      </div>
                      {s.isFeatured && (
                        <span className="badge !bg-amber-50 !text-[#B45309] !border-amber-200 whitespace-nowrap shrink-0">
                          متجر مميز ⭐
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 bg-[#F8F9FA] border border-[#E2E8F0] rounded-2xl p-3 space-y-1.5 min-h-[74px]">
                      <div className="font-semibold text-[#0F172A] line-clamp-2">
                        {s.address?.trim() || `${gov} — فرع ${s.name}`}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        {s.enableDeliveryService && (
                          <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-[#059669] bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
                            <I n="truck" s={12} /> خدمة التوصيل متاحة
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-[#0284C7] bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-lg">
                          AI + 3D Try-On
                        </span>
                      </div>
                    </div>

                    <div className="mt-auto space-y-2">
                      <button
                        type="button"
                        className="btn !bg-[#0284C7] hover:!bg-[#0369A1] !text-white w-full !py-2.5 text-sm shadow-xs"
                        onClick={() => navigate(`/s/${s.slug}`)}
                      >
                        <I n="enter" s={16} /> دخول المتجر
                      </button>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {Boolean(s.mapsUrl && /^https?:\/\//i.test(s.mapsUrl)) ? (
                          <a
                            href={s.mapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-g btn-sm justify-center text-xs"
                          >
                            <I n="map" s={14} /> الموقع على الخريطة
                          </a>
                        ) : (
                          <span className="btn btn-g btn-sm justify-center text-xs opacity-50 pointer-events-none">
                            <I n="map" s={14} /> {gov}
                          </span>
                        )}
                        <a
                          href={waHref}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-g btn-sm justify-center text-xs text-[#059669] hover:border-emerald-300"
                        >
                          <I n="msg" s={14} /> واتساب
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <LoadMoreBar
              hasMore={hasMore}
              loadingMore={loadingMore}
              loadedCount={dirShops.length}
              totalCount={totalCount}
              onLoadMore={() => void loadPage(page + 1, true)}
              itemLabel="متجر"
            />
          </>
        )}
      </main>
    </div>
  );
}
