import React, { useEffect, useState } from 'react';
import {
  DEFAULT_OFFICIAL_LENS_BRANDS,
  LENS_CATEGORIES,
  LENS_TRACKS,
  PHOTO_VARIANT_LABELS,
  SPONSOR_BADGE_LABELS,
  buildSeededMatrixPrices,
  getMatrixCellsForCategory,
} from '../data/opticalLensMatrix';
import { useOptiVerse } from '../services/optiverseStore';
import { LensTrack, OfficialLensBrand, SponsorBadgeType } from '../types';
import { I } from './Icons';
import { Egp, Head, Switch } from './UiShared';

export function AdminLensMatrixManager() {
  const { platformSettings, savePlatformSettings, toast } = useOptiVerse();

  const [activeTrack, setActiveTrack] = useState<LensTrack>('single_vision');
  const [brands, setBrands] = useState<OfficialLensBrand[]>(() =>
    platformSettings.officialLensBrands?.length
      ? platformSettings.officialLensBrands
      : DEFAULT_OFFICIAL_LENS_BRANDS
  );
  const [expandedBrandId, setExpandedBrandId] = useState<string | null>('sv-pixel');

  // New Official Brand Form
  const [newNameAr, setNewNameAr] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newOrigin, setNewOrigin] = useState('');
  const [newSponsorBadge, setNewSponsorBadge] = useState<SponsorBadgeType>('none');
  const [newVariancePct, setNewVariancePct] = useState(20);
  const [newEstDays, setNewEstDays] = useState(4);

  useEffect(() => {
    if (platformSettings.officialLensBrands?.length) {
      setBrands(platformSettings.officialLensBrands);
    }
  }, [platformSettings.officialLensBrands]);

  const lensesEnabled = Boolean(
    platformSettings.enableLensesSystem ?? platformSettings.enablePrescriptionLenses
  );

  const trackBrands = brands
    .filter((b) => b.track === activeTrack)
    .slice()
    .sort((a, b) => a.priority - b.priority);

  const persistBrands = async (nextAll: OfficialLensBrand[], msg?: string) => {
    setBrands(nextAll);
    await savePlatformSettings({ officialLensBrands: nextAll });
    if (msg) toast(msg);
  };

  const handleTrackSwitch = (track: LensTrack) => {
    setActiveTrack(track);
    const first = brands
      .filter((b) => b.track === track)
      .slice()
      .sort((a, b) => a.priority - b.priority)[0];
    setExpandedBrandId(first?.id || null);
  };

  const moveBrand = async (brandId: string, dir: -1 | 1) => {
    const idx = trackBrands.findIndex((b) => b.id === brandId);
    const targetIdx = idx + dir;
    if (idx < 0 || targetIdx < 0 || targetIdx >= trackBrands.length) return;

    const reordered = [...trackBrands];
    const tmp = reordered[idx];
    reordered[idx] = reordered[targetIdx];
    reordered[targetIdx] = tmp;

    const updatedPriorityMap = new Map<string, number>();
    reordered.forEach((b, i) => updatedPriorityMap.set(b.id, i + 1));

    const nextAll = brands.map((b) =>
      updatedPriorityMap.has(b.id) ? { ...b, priority: updatedPriorityMap.get(b.id)! } : b
    );
    await persistBrands(nextAll, 'تم تحديث ترتيب الأولوية والرعاية ✓');
  };

  const updateBrand = (brandId: string, patch: Partial<OfficialLensBrand>) => {
    setBrands((prev) => prev.map((b) => (b.id === brandId ? { ...b, ...patch } : b)));
  };

  const updateCell = (
    brandId: string,
    cellKey: string,
    patch: { enabled?: boolean; recommendedPrice?: number }
  ) => {
    setBrands((prev) =>
      prev.map((b) => {
        if (b.id !== brandId) return b;
        const curCell = b.prices[cellKey] || { enabled: true, recommendedPrice: 500 };
        return {
          ...b,
          prices: {
            ...b.prices,
            [cellKey]: {
              enabled: patch.enabled !== undefined ? patch.enabled : curCell.enabled,
              recommendedPrice:
                patch.recommendedPrice !== undefined
                  ? Math.max(0, Math.round(patch.recommendedPrice))
                  : curCell.recommendedPrice,
            },
          },
        };
      })
    );
  };

  const handleAddOfficialBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNameAr.trim() && !newNameEn.trim()) {
      toast('اكتب اسم الشركة بالعربية أو الإنجليزية أولاً');
      return;
    }
    const id = `${activeTrack === 'custom_lab' ? 'lab' : 'sv'}-${Date.now().toString(36)}`;
    const nextPriority = trackBrands.length + 1;
    const brandObj: OfficialLensBrand = {
      id,
      track: activeTrack,
      nameAr: newNameAr.trim() || newNameEn.trim(),
      nameEn: newNameEn.trim() || newNameAr.trim(),
      origin: newOrigin.trim() || (activeTrack === 'custom_lab' ? 'معمل تصنيع معتمد' : 'عدسات طبية'),
      priority: nextPriority,
      sponsorBadge: newSponsorBadge,
      allowedVariancePct: Math.max(0, Math.min(80, Number(newVariancePct) || 20)),
      estimatedDays: activeTrack === 'custom_lab' ? Math.max(1, Number(newEstDays) || 4) : undefined,
      supportsProgressive: activeTrack === 'custom_lab' ? true : undefined,
      supportsBifocal: activeTrack === 'custom_lab' ? true : undefined,
      isActive: true,
      prices: buildSeededMatrixPrices(1.1, activeTrack),
    };
    const nextAll = [...brands, brandObj];
    await persistBrands(nextAll, `تمت إضافة "${brandObj.nameAr}" إلى الشركات الرسمية ✓`);
    setNewNameAr('');
    setNewNameEn('');
    setNewOrigin('');
    setNewSponsorBadge('none');
    setExpandedBrandId(id);
  };

  const handleDeleteBrand = async (brandId: string, nameAr: string) => {
    const filtered = brands.filter((b) => b.id !== brandId);
    // Re-number priority cleanly on affected track
    let seq = 1;
    const normalized = filtered.map((b) =>
      b.track === activeTrack ? { ...b, priority: seq++ } : b
    );
    await persistBrands(normalized, `تم حذف "${nameAr}" من القائمة الرسمية ✓`);
  };

  return (
    <div className="space-y-5">
      <Head
        t="مصفوفة العدسات الطبية والرعاة"
        sub="إدارة الشركات الرسمية، ترتيب الظهور، شارة الراعي الرسمي، السعر الشائع في السوق، ونسبة مرونة التاجر"
      >
        <button
          type="button"
          className="btn btn-g btn-sm"
          onClick={() =>
            persistBrands(DEFAULT_OFFICIAL_LENS_BRANDS, 'تمت استعادة شركات العدسات الرسمية الافتراضية ✓')
          }
        >
          <I n="refresh" s={14} /> استعادة الافتراضي
        </button>
        <button
          type="button"
          className="btn btn-p btn-sm"
          onClick={() => persistBrands(brands, 'تم حفظ مصفوفة العدسات والرعاة ونشرها للتجار ✓')}
        >
          <I n="check" s={15} /> حفظ جميع التعديلات
        </button>
      </Head>

      {/* Master Flag Status Banner */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 border border-[#E2E8F0]">
        <div>
          <div className="font-extrabold text-sm text-[#0F172A]">
            تفعيل نظام العدسات الطبية والرعاة على مستوى المنصة
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            عند الإغلاق يظهر للتجار «العدسات الطبية — قريباً ✨» في قائمة المزيد، ويتم إخفاء خطوات العدسات وكشف النظر عن العملاء.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={'badge ' + (lensesEnabled ? 'b-ok' : 'b-warn')}>
            {lensesEnabled ? 'مفعّل للمتاجر ✓' : 'مخفي (قريباً ✨)'}
          </span>
          <Switch
            on={lensesEnabled}
            onChange={async (v) => {
              await savePlatformSettings({
                enableLensesSystem: v,
                enablePrescriptionLenses: v,
              });
              toast(
                v
                  ? 'تم تفعيل نظام العدسات الطبية والرعاة للمتاجر والتجار ✓'
                  : 'تم إغلاق نظام العدسات — يظهر الآن كـ قريباً ✨'
              );
            }}
          />
        </div>
      </div>

      {/* 2-Track Selector Tabs */}
      <div className="grid sm:grid-cols-2 gap-3">
        {LENS_TRACKS.map((tr) => {
          const active = activeTrack === tr.key;
          const count = brands.filter((b) => b.track === tr.key).length;
          return (
            <button
              key={tr.key}
              type="button"
              onClick={() => handleTrackSwitch(tr.key)}
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
              <span
                className={
                  'badge tabular-nums shrink-0 ' +
                  (active ? 'bg-amber-400 text-slate-950' : 'b-info')
                }
              >
                {count} شركات
              </span>
            </button>
          );
        })}
      </div>

      {/* Add Official Brand Form */}
      <form onSubmit={handleAddOfficialBrand} className="glass rounded-2xl p-4 space-y-3">
        <div className="font-bold text-sm text-[#0F172A] flex items-center gap-2">
          <I n="plus" s={16} c="text-[#0284C7]" /> إضافة شركة عدسات رسمية جديدة إلى{' '}
          <span className="text-[#0284C7]">
            {LENS_TRACKS.find((t) => t.key === activeTrack)?.labelAr}
          </span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <input
            className="inp text-xs"
            placeholder="الاسم بالعربية (مثال: بيكسل)"
            value={newNameAr}
            onChange={(e) => setNewNameAr(e.target.value)}
          />
          <input
            className="inp text-xs"
            dir="ltr"
            placeholder="English (e.g. Zeiss)"
            value={newNameEn}
            onChange={(e) => setNewNameEn(e.target.value)}
          />
          <input
            className="inp text-xs"
            placeholder="المنشأ / النوع (ألماني، كوري...)"
            value={newOrigin}
            onChange={(e) => setNewOrigin(e.target.value)}
          />
          <select
            className="inp text-xs"
            value={newSponsorBadge}
            onChange={(e) => setNewSponsorBadge(e.target.value as SponsorBadgeType)}
          >
            <option value="official_sponsor">{SPONSOR_BADGE_LABELS.official_sponsor}</option>
            <option value="featured_partner">{SPONSOR_BADGE_LABELS.featured_partner}</option>
            <option value="none">{SPONSOR_BADGE_LABELS.none}</option>
          </select>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={80}
              className="inp text-xs"
              title="نسبة المرونة المسموحة للتاجر (%)"
              value={newVariancePct}
              onChange={(e) => setNewVariancePct(+e.target.value)}
            />
            <span className="text-xs font-bold text-slate-600 whitespace-nowrap">% مرونة</span>
          </div>
          {activeTrack === 'custom_lab' ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={30}
                className="inp text-xs"
                title="مدة التجهيز المتوقعة (بالأيام)"
                value={newEstDays}
                onChange={(e) => setNewEstDays(+e.target.value)}
              />
              <button type="submit" className="btn btn-p btn-sm shrink-0">
                إضافة
              </button>
            </div>
          ) : (
            <button type="submit" className="btn btn-p btn-sm">
              <I n="plus" s={14} /> إضافة الشركة
            </button>
          )}
        </div>
      </form>

      {/* Official Brands List (Priority Order + Sponsor + Matrix) */}
      <div className="space-y-3">
        {trackBrands.map((b, idx) => {
          const isOpen = expandedBrandId === b.id;
          return (
            <div key={b.id} className="glass rounded-2xl overflow-hidden border border-[#E2E8F0]">
              <div className="p-4 flex flex-wrap items-center justify-between gap-3 bg-white">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveBrand(b.id, -1)}
                      title="تحريك لأعلى"
                      className="btn btn-g btn-sm !px-2 !py-1 text-xs disabled:opacity-35"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={idx === trackBrands.length - 1}
                      onClick={() => moveBrand(b.id, 1)}
                      title="تحريك لأسفل"
                      className="btn btn-g btn-sm !px-2 !py-1 text-xs disabled:opacity-35"
                    >
                      ▼
                    </button>
                  </div>

                  <span className="badge b-acc tabular-nums font-extrabold">#{idx + 1}</span>
                  <div>
                    <div className="font-extrabold text-sm text-[#0F172A] flex items-center gap-2 flex-wrap">
                      <span>{b.nameAr}</span>
                      <span className="text-xs text-slate-500 font-semibold" dir="ltr">
                        ({b.nameEn})
                      </span>
                      {b.sponsorBadge === 'official_sponsor' && (
                        <span className="badge bg-amber-100 text-amber-900 border border-amber-300 font-extrabold">
                          {SPONSOR_BADGE_LABELS.official_sponsor}
                        </span>
                      )}
                      {b.sponsorBadge === 'featured_partner' && (
                        <span className="badge b-info font-bold">
                          {SPONSOR_BADGE_LABELS.featured_partner}
                        </span>
                      )}
                      {activeTrack === 'custom_lab' && b.estimatedDays && (
                        <span className="badge bg-slate-100 text-slate-700 border border-slate-200">
                          مدة التجهيز المتوقعة: {b.estimatedDays} أيام
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {b.origin || 'عدسات معتمدة'} · مرونة التسعير للتاجر: ±{b.allowedVariancePct}%
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    className="inp !w-auto !py-1.5 text-xs"
                    value={b.sponsorBadge}
                    onChange={(e) =>
                      updateBrand(b.id, { sponsorBadge: e.target.value as SponsorBadgeType })
                    }
                  >
                    <option value="official_sponsor">{SPONSOR_BADGE_LABELS.official_sponsor}</option>
                    <option value="featured_partner">{SPONSOR_BADGE_LABELS.featured_partner}</option>
                    <option value="none">{SPONSOR_BADGE_LABELS.none}</option>
                  </select>

                  <div className="flex items-center gap-1 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl px-2 py-1">
                    <span className="text-[0.68rem] text-slate-500">مرونة ±</span>
                    <input
                      type="number"
                      min={0}
                      max={80}
                      className="w-12 text-xs font-extrabold text-center bg-transparent outline-none tabular-nums"
                      value={b.allowedVariancePct}
                      onChange={(e) =>
                        updateBrand(b.id, {
                          allowedVariancePct: Math.max(0, Math.min(80, +e.target.value)),
                        })
                      }
                    />
                    <span className="text-[0.68rem] text-slate-500">%</span>
                  </div>

                  {activeTrack === 'custom_lab' && (
                    <div className="flex items-center gap-1 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl px-2 py-1">
                      <span className="text-[0.68rem] text-slate-500">تجهيز</span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        className="w-10 text-xs font-extrabold text-center bg-transparent outline-none tabular-nums"
                        value={b.estimatedDays || 4}
                        onChange={(e) =>
                          updateBrand(b.id, { estimatedDays: Math.max(1, +e.target.value) })
                        }
                      />
                      <span className="text-[0.68rem] text-slate-500">أيام</span>
                    </div>
                  )}

                  <Switch
                    on={b.isActive}
                    onChange={(v) => updateBrand(b.id, { isActive: v })}
                  />

                  <button
                    type="button"
                    onClick={() => setExpandedBrandId(isOpen ? null : b.id)}
                    className="btn btn-g btn-sm text-xs"
                  >
                    <I n={isOpen ? 'chevU' : 'chevD'} s={14} />{' '}
                    {isOpen ? 'إخفاء الأسعار' : 'مصفوفة الأسعار (6 فئات)'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-d btn-sm !p-2"
                    title="حذف الشركة"
                    onClick={() => handleDeleteBrand(b.id, b.nameAr)}
                  >
                    <I n="trash" s={14} />
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="p-4 border-t border-[#E2E8F0] bg-[#F8F9FA] space-y-4">
                  {activeTrack === 'custom_lab' && (
                    <div className="flex flex-wrap items-center gap-4 bg-white rounded-xl p-3 border border-[#E2E8F0] text-xs">
                      <span className="font-bold text-[#0F172A]">تصميمات المعمل المدعومة:</span>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={b.supportsProgressive !== false}
                          onChange={(e) =>
                            updateBrand(b.id, { supportsProgressive: e.target.checked })
                          }
                        />
                        <span className="font-semibold">مالتي فوكال (Progressive)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={b.supportsBifocal !== false}
                          onChange={(e) =>
                            updateBrand(b.id, { supportsBifocal: e.target.checked })
                          }
                        />
                        <span className="font-semibold">باي فوكال (Bifocal)</span>
                      </label>
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 gap-3">
                    {LENS_CATEGORIES.map((cat) => {
                      const cells = getMatrixCellsForCategory(cat.key);
                      return (
                        <div
                          key={cat.key}
                          className="bg-white rounded-2xl p-3.5 border border-[#E2E8F0] space-y-2.5"
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
                              const val = b.prices[cellMeta.key] || {
                                enabled: true,
                                recommendedPrice: 500,
                              };
                              return (
                                <div
                                  key={cellMeta.key}
                                  className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#F8F9FA] border border-slate-200/80 text-xs"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={val.enabled}
                                      onChange={(e) =>
                                        updateCell(b.id, cellMeta.key, {
                                          enabled: e.target.checked,
                                        })
                                      }
                                    />
                                    <span className="font-bold text-[#0F172A] truncate">
                                      {cellMeta.variant !== 'none'
                                        ? `${PHOTO_VARIANT_LABELS[cellMeta.variant]} · `
                                        : ''}
                                      <span dir="ltr">{cellMeta.index}</span>
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-[0.66rem] text-slate-500">
                                      السعر الشائع في السوق (ج.م):
                                    </span>
                                    <input
                                      type="number"
                                      min={0}
                                      step={10}
                                      disabled={!val.enabled}
                                      className="inp !w-20 !py-1 !px-2 text-xs text-center font-extrabold tabular-nums"
                                      value={val.recommendedPrice}
                                      onChange={(e) =>
                                        updateCell(b.id, cellMeta.key, {
                                          recommendedPrice: +e.target.value,
                                        })
                                      }
                                    />
                                    <span className="text-[0.68rem] text-slate-500 hidden sm:inline">
                                      <Egp v={val.recommendedPrice} />
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
                      onClick={() =>
                        persistBrands(brands, `تم حفظ أسعار "${b.nameAr}" في مصفوفة المنصة ✓`)
                      }
                    >
                      <I n="check" s={14} /> حفظ أسعار {b.nameAr}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
