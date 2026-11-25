import React, { useEffect, useState } from 'react';
import {
  DEFAULT_OFFICIAL_LENS_BRANDS,
  LENS_CATEGORIES,
  LENS_TRACKS,
  PHOTO_VARIANT_LABELS,
  SPONSOR_BADGE_LABELS,
  buildSeededMatrixPrices,
  clampMerchantPriceToVariance,
  getAllowedPriceBounds,
  getMatrixCellsForCategory,
  resolveMerchantBrandRowsForTrack,
} from '../data/opticalLensMatrix';
import { useOptiVerse } from '../services/optiverseStore';
import { LensTrack, MerchantLensBrandConfig, MerchantLensPriceCell } from '../types';
import { I } from './Icons';
import { Egp, Head, Switch, fmt } from './UiShared';

export function MerchantLensMatrixManager() {
  const { activeShop, platformSettings, saveShopLensConfigs, toast } = useOptiVerse();

  const officialBrands = platformSettings.officialLensBrands?.length
    ? platformSettings.officialLensBrands
    : DEFAULT_OFFICIAL_LENS_BRANDS;

  const [activeTrack, setActiveTrack] = useState<LensTrack>('single_vision');
  const [configs, setConfigs] = useState<MerchantLensBrandConfig[]>(
    () => activeShop.merchantLensConfigs || []
  );
  const [expandedBrandId, setExpandedBrandId] = useState<string | null>(null);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [priceWarn, setPriceWarn] = useState<string | null>(null);

  // Add Custom Brand Form State
  const [customNameAr, setCustomNameAr] = useState('');
  const [customNameEn, setCustomNameEn] = useState('');
  const [customOrigin, setCustomOrigin] = useState('');
  const [customEstDays, setCustomEstDays] = useState(5);
  const [customProg, setCustomProg] = useState(true);
  const [customBi, setCustomBi] = useState(true);

  useEffect(() => {
    setConfigs(activeShop.merchantLensConfigs || []);
  }, [activeShop.id, activeShop.merchantLensConfigs]);

  const { officialRows, customRows } = resolveMerchantBrandRowsForTrack(
    officialBrands,
    configs,
    activeShop.id,
    activeTrack
  );

  const upsertMerchantBrandConfig = (
    brandId: string,
    track: LensTrack,
    isCustomBrand: boolean,
    updater: (cur: MerchantLensBrandConfig) => MerchantLensBrandConfig,
    baseDefaults?: Partial<MerchantLensBrandConfig>
  ): MerchantLensBrandConfig[] => {
    const existing = configs.find((c) => c.shopId === activeShop.id && c.brandId === brandId);
    const seedRow: MerchantLensBrandConfig = existing || {
      shopId: activeShop.id,
      brandId,
      track,
      isCustomBrand,
      isEnabled: true,
      prices: {},
      ...baseDefaults,
    };
    const nextRow = updater(seedRow);
    return existing
      ? configs.map((c) =>
          c.shopId === activeShop.id && c.brandId === brandId ? nextRow : c
        )
      : [...configs, nextRow];
  };

  const persist = async (next: MerchantLensBrandConfig[], msg?: string) => {
    setConfigs(next);
    await saveShopLensConfigs(activeShop.id, next);
    if (msg) toast(msg);
  };

  const handleToggleBrand = async (
    brandId: string,
    isCustomBrand: boolean,
    nextEnabled: boolean
  ) => {
    const offBrand = officialBrands.find((b) => b.id === brandId);
    const initPrices: Record<string, MerchantLensPriceCell> = {};
    if (!isCustomBrand && offBrand) {
      for (const [k, cell] of Object.entries(offBrand.prices || {})) {
        initPrices[k] = { enabled: cell.enabled, price: cell.recommendedPrice };
      }
    }
    const next = upsertMerchantBrandConfig(
      brandId,
      activeTrack,
      isCustomBrand,
      (cur) => ({ ...cur, isEnabled: nextEnabled }),
      { prices: initPrices }
    );
    await persist(
      next,
      nextEnabled ? 'تم تفعيل الشركة لعملاء متجرك ✓' : 'تم إخفاء الشركة عن عملاء متجرك'
    );
  };

  const handleOfficialCellChange = (
    brandId: string,
    cellKey: string,
    recommendedPrice: number,
    allowedVariancePct: number,
    patch: { enabled?: boolean; price?: number }
  ) => {
    const offBrand = officialBrands.find((b) => b.id === brandId);
    const initPrices: Record<string, MerchantLensPriceCell> = {};
    if (offBrand) {
      for (const [k, cell] of Object.entries(offBrand.prices || {})) {
        initPrices[k] = { enabled: cell.enabled, price: cell.recommendedPrice };
      }
    }

    let finalPrice = patch.price;
    if (patch.price !== undefined) {
      const check = clampMerchantPriceToVariance(
        patch.price,
        recommendedPrice,
        allowedVariancePct
      );
      finalPrice = check.clamped;
      if (check.isOutOfBounds) {
        setPriceWarn(
          `تم ضبط السعر ضمن الحد المسموح (${fmt(check.min)} – ${fmt(check.max)} ج.م · ±${allowedVariancePct}% من السعر الشائع)`
        );
      } else {
        setPriceWarn(null);
      }
    }

    const next = upsertMerchantBrandConfig(
      brandId,
      activeTrack,
      false,
      (cur) => {
        const merged = { ...initPrices, ...(cur.prices || {}) };
        const existingCell = merged[cellKey] || {
          enabled: true,
          price: recommendedPrice,
        };
        return {
          ...cur,
          prices: {
            ...merged,
            [cellKey]: {
              enabled: patch.enabled !== undefined ? patch.enabled : existingCell.enabled,
              price: finalPrice !== undefined ? finalPrice : existingCell.price,
            },
          },
        };
      },
      { prices: initPrices }
    );
    setConfigs(next);
  };

  const handleCustomCellChange = (
    brandId: string,
    cellKey: string,
    patch: { enabled?: boolean; price?: number }
  ) => {
    const next = upsertMerchantBrandConfig(brandId, activeTrack, true, (cur) => {
      const existingCell = cur.prices[cellKey] || { enabled: true, price: 500 };
      return {
        ...cur,
        prices: {
          ...cur.prices,
          [cellKey]: {
            enabled: patch.enabled !== undefined ? patch.enabled : existingCell.enabled,
            price:
              patch.price !== undefined
                ? Math.max(0, Math.round(patch.price))
                : existingCell.price,
          },
        },
      };
    });
    setConfigs(next);
  };

  const handleAddCustomBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customNameAr.trim() && !customNameEn.trim()) {
      toast('اكتب اسم شركة العدسات أولاً');
      return;
    }
    const id = `custom-${activeTrack === 'custom_lab' ? 'lab' : 'sv'}-${Date.now().toString(36)}`;
    const seeded = buildSeededMatrixPrices(1.0, activeTrack);
    const prices: Record<string, MerchantLensPriceCell> = {};
    for (const [k, cell] of Object.entries(seeded)) {
      prices[k] = { enabled: cell.enabled, price: cell.recommendedPrice };
    }
    const newBrand: MerchantLensBrandConfig = {
      shopId: activeShop.id,
      brandId: id,
      track: activeTrack,
      isCustomBrand: true,
      nameAr: customNameAr.trim() || customNameEn.trim(),
      nameEn: customNameEn.trim() || customNameAr.trim(),
      origin: customOrigin.trim() || 'خاصة بمحلي',
      estimatedDays:
        activeTrack === 'custom_lab' ? Math.max(1, Number(customEstDays) || 5) : undefined,
      supportsProgressive: activeTrack === 'custom_lab' ? customProg : true,
      supportsBifocal: activeTrack === 'custom_lab' ? customBi : true,
      isEnabled: true,
      prices,
    };
    const next = [...configs, newBrand];
    await persist(next, `تمت إضافة "${newBrand.nameAr}" إلى قائمة شركات متجرك ✓`);
    setCustomNameAr('');
    setCustomNameEn('');
    setCustomOrigin('');
    setShowAddCustom(false);
    setExpandedBrandId(id);
  };

  const handleDeleteCustomBrand = async (brandId: string, nameAr: string) => {
    const next = configs.filter((c) => !(c.shopId === activeShop.id && c.brandId === brandId));
    await persist(next, `تم حذف "${nameAr}" ✓`);
  };

  return (
    <div className="space-y-5">
      <Head
        t="إدارة أسعار العدسات والشركات"
        sub="فعّل الشركات والمقاسات المناسبة لمتجرك، وعدّل أسعار البيع بسهولة لعملائك"
      >
        <button
          type="button"
          className="btn btn-p btn-sm"
          onClick={() => persist(configs, 'تم حفظ أسعار العدسات والشركات ونشرها للعملاء ✓')}
        >
          <I n="check" s={15} /> حفظ جميع الأسعار
        </button>
      </Head>

      {/* 2 Top-Level Optical Track Tabs */}
      <div className="grid sm:grid-cols-2 gap-3">
        {LENS_TRACKS.map((tr) => {
          const active = activeTrack === tr.key;
          return (
            <button
              key={tr.key}
              type="button"
              onClick={() => {
                setActiveTrack(tr.key);
                setExpandedBrandId(null);
                setPriceWarn(null);
              }}
              className={
                'rounded-2xl p-4 border text-start transition cursor-pointer flex items-start justify-between gap-3 ' +
                (active
                  ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-sm'
                  : 'bg-white text-[#0F172A] border-[#E2E8F0] hover:border-[#0284C7]')
              }
            >
              <div>
                <div className="font-extrabold text-sm">{tr.labelAr}</div>
                <div className={'text-xs mt-1 ' + (active ? 'text-slate-300' : 'text-slate-500')}>
                  {tr.descAr}
                </div>
              </div>
              <I n={tr.key === 'single_vision' ? 'eye' : 'spark'} s={18} />
            </button>
          );
        })}
      </div>

      {priceWarn && (
        <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900 flex items-center justify-between gap-2">
          <span>{priceWarn}</span>
          <button
            type="button"
            className="text-amber-700 underline text-[0.7rem]"
            onClick={() => setPriceWarn(null)}
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Section 1: Official & Sponsored Brands (STRICTLY AT TOP in Admin Priority Order) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-extrabold text-sm sm:text-base text-[#0F172A]">
              الشركات الرسمية والرعاة المعتمدون
            </h3>
            <p className="text-xs text-slate-500">
              تظهر هذه الشركات في صدارة متجرك بالترتيب المعتمد مع السعر الشائع في السوق كدليل تسعير
            </p>
          </div>
          <span className="badge b-acc">{officialRows.length} شركات معتمدة</span>
        </div>

        {officialRows.map((row) => {
          const isOpen = expandedBrandId === row.brandId;
          return (
            <div
              key={row.brandId}
              className={
                'glass rounded-2xl overflow-hidden border transition ' +
                (row.sponsorBadge === 'official_sponsor'
                  ? 'border-amber-300'
                  : 'border-[#E2E8F0]')
              }
            >
              <div className="p-4 bg-white flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="badge b-info tabular-nums">#{row.priority}</span>
                    <span className="font-extrabold text-sm text-[#0F172A]">{row.nameAr}</span>
                    <span className="text-xs text-slate-500" dir="ltr">
                      ({row.nameEn})
                    </span>
                    {row.sponsorBadge === 'official_sponsor' && (
                      <span className="badge bg-amber-100 text-amber-900 border border-amber-300 font-extrabold">
                        {SPONSOR_BADGE_LABELS.official_sponsor}
                      </span>
                    )}
                    {row.sponsorBadge === 'featured_partner' && (
                      <span className="badge b-info font-bold">
                        {SPONSOR_BADGE_LABELS.featured_partner}
                      </span>
                    )}
                    {activeTrack === 'custom_lab' && row.estimatedDays && (
                      <span className="badge bg-slate-100 text-slate-700 border border-slate-200">
                        مدة التجهيز المتوقعة: {row.estimatedDays} أيام
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.origin || 'شركة معتمدة'} · نطاق التسعير المسموح: ±{row.allowedVariancePct}% من السعر الشائع
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <Switch
                    on={row.isEnabled}
                    onChange={(v) => handleToggleBrand(row.brandId, false, v)}
                  />
                  <button
                    type="button"
                    className="btn btn-g btn-sm text-xs"
                    onClick={() => setExpandedBrandId(isOpen ? null : row.brandId)}
                  >
                    <I n={isOpen ? 'chevU' : 'chevD'} s={14} />{' '}
                    {isOpen ? 'إغلاق الأسعار' : 'تعديل الأسعار والضغط'}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="p-4 border-t border-[#E2E8F0] bg-[#F8F9FA] space-y-4">
                  <div className="grid md:grid-cols-2 gap-3">
                    {LENS_CATEGORIES.map((cat) => {
                      const cells = getMatrixCellsForCategory(cat.key);
                      return (
                        <div
                          key={cat.key}
                          className="bg-white rounded-2xl p-3.5 border border-[#E2E8F0] space-y-2"
                        >
                          <div>
                            <div className="font-extrabold text-xs sm:text-sm text-[#0F172A]">
                              {cat.nameAr}{' '}
                              <span className="text-slate-500 font-normal" dir="ltr">
                                ({cat.nameEn})
                              </span>
                            </div>
                            <div className="text-[0.68rem] text-slate-500">{cat.descAr}</div>
                          </div>

                          <div className="space-y-1.5">
                            {cells.map((cellMeta) => {
                              const officialCell = row.officialPrices?.[cellMeta.key] || {
                                enabled: true,
                                recommendedPrice: 500,
                              };
                              const merchantCell = row.merchantPrices[cellMeta.key] || {
                                enabled: officialCell.enabled,
                                price: officialCell.recommendedPrice,
                              };
                              const bounds = getAllowedPriceBounds(
                                officialCell.recommendedPrice,
                                row.allowedVariancePct
                              );
                              if (!officialCell.enabled) {
                                return null;
                              }
                              return (
                                <div
                                  key={cellMeta.key}
                                  className="p-2.5 rounded-xl bg-[#F8F9FA] border border-slate-200/80 space-y-1.5"
                                >
                                  <div className="flex items-center justify-between gap-2 text-xs">
                                    <label className="flex items-center gap-2 cursor-pointer font-bold text-[#0F172A]">
                                      <input
                                        type="checkbox"
                                        checked={merchantCell.enabled}
                                        onChange={(e) =>
                                          handleOfficialCellChange(
                                            row.brandId,
                                            cellMeta.key,
                                            officialCell.recommendedPrice,
                                            row.allowedVariancePct,
                                            { enabled: e.target.checked }
                                          )
                                        }
                                      />
                                      <span>
                                        {cellMeta.variant !== 'none'
                                          ? `${PHOTO_VARIANT_LABELS[cellMeta.variant]} · `
                                          : ''}
                                        <span dir="ltr">{cellMeta.index}</span>
                                      </span>
                                    </label>

                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="number"
                                        min={bounds.min}
                                        max={bounds.max}
                                        step={10}
                                        disabled={!merchantCell.enabled}
                                        className="inp !w-20 !py-1 !px-2 text-xs text-center font-extrabold tabular-nums"
                                        value={merchantCell.price}
                                        onChange={(e) =>
                                          handleOfficialCellChange(
                                            row.brandId,
                                            cellMeta.key,
                                            officialCell.recommendedPrice,
                                            row.allowedVariancePct,
                                            { price: +e.target.value }
                                          )
                                        }
                                      />
                                      <span className="text-[0.68rem] text-slate-600 font-bold">
                                        ج.م
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between text-[0.66rem] text-slate-500">
                                    <span>
                                      السعر الشائع: <b className="text-[#0284C7]">{fmt(officialCell.recommendedPrice)} ج.م</b>
                                    </span>
                                    <span dir="ltr">
                                      [{fmt(bounds.min)} – {fmt(bounds.max)} EGP]
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="btn btn-p btn-sm"
                      onClick={() => persist(configs, `تم حفظ أسعار "${row.nameAr}" ✓`)}
                    >
                      <I n="check" s={14} /> حفظ أسعار {row.nameAr}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Section 2: Merchant Custom Brands (STRICTLY BELOW Official/Sponsored Brands) */}
      <div className="pt-4 border-t border-[#E2E8F0] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-extrabold text-sm sm:text-base text-[#0F172A]">
              شركات العدسات الخاصة بمحلي
            </h3>
            <p className="text-xs text-slate-500">
              أضف أي شركة أو معمل خاص بك وسعّرها بحرية كاملة (تظهر أسفل الشركات الرسمية في متجرك)
            </p>
          </div>
          <button
            type="button"
            className="btn btn-p btn-sm"
            onClick={() => setShowAddCustom((v) => !v)}
          >
            <I n="plus" s={14} /> + إضافة شركة عدسات خاصة بمحلي
          </button>
        </div>

        {showAddCustom && (
          <form onSubmit={handleAddCustomBrand} className="glass rounded-2xl p-4 space-y-3">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <input
                className="inp text-xs"
                placeholder="اسم الشركة بالعربية"
                value={customNameAr}
                onChange={(e) => setCustomNameAr(e.target.value)}
                required
              />
              <input
                className="inp text-xs"
                dir="ltr"
                placeholder="English Name (optional)"
                value={customNameEn}
                onChange={(e) => setCustomNameEn(e.target.value)}
              />
              <input
                className="inp text-xs"
                placeholder="المنشأ / الملاحظات (مثال: معمل خاص)"
                value={customOrigin}
                onChange={(e) => setCustomOrigin(e.target.value)}
              />
              {activeTrack === 'custom_lab' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className="inp text-xs w-20"
                    value={customEstDays}
                    onChange={(e) => setCustomEstDays(+e.target.value)}
                  />
                  <span className="text-xs text-slate-600 whitespace-nowrap">أيام تجهيز</span>
                </div>
              ) : (
                <button type="submit" className="btn btn-p btn-sm">
                  حفظ وإضافة الشركة
                </button>
              )}
            </div>
            {activeTrack === 'custom_lab' && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customProg}
                      onChange={(e) => setCustomProg(e.target.checked)}
                    />
                    <span>مالتي فوكال (Progressive)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customBi}
                      onChange={(e) => setCustomBi(e.target.checked)}
                    />
                    <span>باي فوكال (Bifocal)</span>
                  </label>
                </div>
                <button type="submit" className="btn btn-p btn-sm">
                  حفظ وإضافة الشركة
                </button>
              </div>
            )}
          </form>
        )}

        {customRows.map((row) => {
          const isOpen = expandedBrandId === row.brandId;
          return (
            <div key={row.brandId} className="glass rounded-2xl overflow-hidden border border-[#E2E8F0]">
              <div className="p-4 bg-white flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-sm text-[#0F172A]">{row.nameAr}</span>
                    {row.nameEn && row.nameEn !== row.nameAr && (
                      <span className="text-xs text-slate-500" dir="ltr">
                        ({row.nameEn})
                      </span>
                    )}
                    <span className="badge bg-slate-100 text-slate-700 border border-slate-200">
                      شركة خاصة بالمحل
                    </span>
                    {activeTrack === 'custom_lab' && row.estimatedDays && (
                      <span className="badge b-info">
                        مدة التجهيز المتوقعة: {row.estimatedDays} أيام
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{row.origin}</div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    on={row.isEnabled}
                    onChange={(v) => handleToggleBrand(row.brandId, true, v)}
                  />
                  <button
                    type="button"
                    className="btn btn-g btn-sm text-xs"
                    onClick={() => setExpandedBrandId(isOpen ? null : row.brandId)}
                  >
                    <I n={isOpen ? 'chevU' : 'chevD'} s={14} />{' '}
                    {isOpen ? 'إغلاق الأسعار' : 'تسعير الفئات والضغط'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-d btn-sm !p-2"
                    onClick={() => handleDeleteCustomBrand(row.brandId, row.nameAr)}
                  >
                    <I n="trash" s={14} />
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="p-4 border-t border-[#E2E8F0] bg-[#F8F9FA] space-y-4">
                  <div className="grid md:grid-cols-2 gap-3">
                    {LENS_CATEGORIES.map((cat) => {
                      const cells = getMatrixCellsForCategory(cat.key);
                      return (
                        <div
                          key={cat.key}
                          className="bg-white rounded-2xl p-3.5 border border-[#E2E8F0] space-y-2"
                        >
                          <div className="font-extrabold text-xs sm:text-sm text-[#0F172A]">
                            {cat.nameAr}{' '}
                            <span className="text-slate-500 font-normal" dir="ltr">
                              ({cat.nameEn})
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {cells.map((cellMeta) => {
                              const cell = row.merchantPrices[cellMeta.key] || {
                                enabled: true,
                                price: 500,
                              };
                              return (
                                <div
                                  key={cellMeta.key}
                                  className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#F8F9FA] border border-slate-200/80 text-xs"
                                >
                                  <label className="flex items-center gap-2 cursor-pointer font-bold text-[#0F172A]">
                                    <input
                                      type="checkbox"
                                      checked={cell.enabled}
                                      onChange={(e) =>
                                        handleCustomCellChange(row.brandId, cellMeta.key, {
                                          enabled: e.target.checked,
                                        })
                                      }
                                    />
                                    <span>
                                      {cellMeta.variant !== 'none'
                                        ? `${PHOTO_VARIANT_LABELS[cellMeta.variant]} · `
                                        : ''}
                                      <span dir="ltr">{cellMeta.index}</span>
                                    </span>
                                  </label>
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="number"
                                      min={0}
                                      step={10}
                                      disabled={!cell.enabled}
                                      className="inp !w-20 !py-1 !px-2 text-xs text-center font-extrabold tabular-nums"
                                      value={cell.price}
                                      onChange={(e) =>
                                        handleCustomCellChange(row.brandId, cellMeta.key, {
                                          price: +e.target.value,
                                        })
                                      }
                                    />
                                    <Egp v={cell.price} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="btn btn-p btn-sm"
                      onClick={() => persist(configs, `تم حفظ أسعار "${row.nameAr}" ✓`)}
                    >
                      <I n="check" s={14} /> حفظ أسعار {row.nameAr}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!customRows.length && !showAddCustom && (
          <div className="glass rounded-2xl p-6 text-center text-xs text-slate-500">
            لا توجد شركات خاصة مضافة بعد — يمكنك إضافة شركة خاصة بمحلك بالضغط على الزر أعلاه.
          </div>
        )}
      </div>
    </div>
  );
}
