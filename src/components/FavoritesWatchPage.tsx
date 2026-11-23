import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Clock,
  Home,
  Layers,
  MapPin,
  Pencil,
  Sparkles,
  Star,
  Trash2,
  Zap,
  ZapOff,
} from 'lucide-react';
import { CalendarDatePicker } from './CalendarDatePicker';
import { resolveBuilding, ResolverContext, stateColor, stateLabel } from '../lib/resolver';
import {
  ForecastDayResult,
  formatShiftSlotsUk,
  ScheduleShiftModel,
} from '../lib/scheduleForecast';
import {
  buildMergedIntervals,
  computeScheduleTotals,
  formatDurationShort,
  normalizeDisplayState,
} from '../lib/scheduleIntervals';
import {
  BuildingRecord,
  DualQueueType,
  FavoriteAddress,
  formatSlotTime,
  formatSubqueue,
  ManualPoint,
  SlotState,
  SUBQUEUES,
  SubqueueId,
} from '../lib/types';

interface FavoritesWatchPageProps {
  favorites: FavoriteAddress[];
  myHomeKey: string | null;
  buildings: BuildingRecord[];
  manualPoints: ManualPoint[];
  resolverCtx: ResolverContext;
  queuesMap: Partial<Record<SubqueueId, SlotState[]>>;
  availableDates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  currentSlot: number;
  onSelectSlot: (slot: number) => void;
  mergedLightDark: boolean;
  onToggleMergedLightDark: () => void;
  onBackToMap: () => void;
  onFlyToFavorite: (fav: FavoriteAddress) => void;
  onFlyToHome: () => void;
  onUpdateFavoriteNote: (key: string, note: string) => void;
  onRemoveFavorite: (key: string) => void;
  forecastInfo?: ForecastDayResult | null;
  shiftModel?: ScheduleShiftModel | null;
  customShiftSlots?: number | null;
  onChangeCustomShiftSlots?: (slots: number | null) => void;
}

interface WatchedItem {
  id: string;
  key: string;
  title: string;
  note: string;
  isHome: boolean;
  favorite?: FavoriteAddress;
  queue: SubqueueId | null;
  secondaryQueue: SubqueueId | null;
  dualType: DualQueueType;
  feeder?: string;
  schedule: SlotState[];
  secondarySchedule: SlotState[];
  currentState: SlotState;
  secondaryCurrentState: SlotState | null;
  nextChangeLabel: string;
  countdown: string;
  secondaryNextChangeLabel: string | null;
  secondaryCountdown: string | null;
}

function getDualRoleLabels(dualType: DualQueueType): {
  primaryShort: string;
  secondaryShort: string;
  secondaryFull: string;
} {
  if (dualType === 'split_lifts') {
    return {
      primaryShort: 'Квартири',
      secondaryShort: 'Ліфти',
      secondaryFull: 'Ліфти / МОП',
    };
  }
  if (dualType === 'split_entrances') {
    return {
      primaryShort: 'Підʼїзд 1',
      secondaryShort: 'Підʼїзд 2',
      secondaryFull: 'Інші підʼїзди',
    };
  }
  return {
    primaryShort: 'Основна',
    secondaryShort: '2-га черга',
    secondaryFull: '2-га / резервна черга',
  };
}

function secondaryStateColor(state: SlotState): string {
  switch (state) {
    case 'off':
      return '#9333ea'; // distinct violet for secondary queue OFF
    case 'switch_off':
    case 'switch_on':
      return '#d97706'; // amber for secondary switching
    case 'possible':
      return '#c084fc'; // light violet for possible
    default:
      return '#0ea5e9'; // distinct sky-blue for secondary queue ON
  }
}

function computeCountdownMerged(
  schedule: SlotState[],
  currentSlot: number,
  now: Date,
  mergedLightDark: boolean
): { label: string; countdown: string } {
  if (!schedule || schedule.length < 48) {
    return { label: 'Немає графіка', countdown: '—' };
  }
  const cur = normalizeDisplayState(schedule[currentSlot] || 'on', mergedLightDark);
  let nextIdx: number | null = null;
  for (let i = currentSlot + 1; i < 48; i++) {
    if (normalizeDisplayState(schedule[i] || 'on', mergedLightDark) !== cur) {
      nextIdx = i;
      break;
    }
  }
  if (nextIdx === null) {
    return { label: 'Без змін до 24:00', countdown: 'До кінця доби' };
  }

  const nextState = normalizeDisplayState(schedule[nextIdx] || 'on', mergedLightDark);
  const realSlot = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
  let totalSec: number;
  if (currentSlot === realSlot) {
    const target = new Date(now);
    const targetMin = nextIdx * 30;
    target.setHours(Math.floor(targetMin / 60), targetMin % 60, 0, 0);
    totalSec = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  } else {
    totalSec = (nextIdx - currentSlot) * 30 * 60;
  }

  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    label: `О ${formatSlotTime(nextIdx).slice(0, 5)} → ${stateLabel(nextState)}`,
    countdown: `${pad(h)}:${pad(m)}:${pad(s)}`,
  };
}

function extractQueueFromNote(note?: string): SubqueueId | null {
  if (!note) return null;
  const romanMatch = note.match(/\b([1-6])\s*[-.]\s*(II|I)\b/i);
  if (romanMatch) {
    const sub = romanMatch[2].toUpperCase() === 'II' ? '2' : '1';
    const q = `${romanMatch[1]}-${sub}` as SubqueueId;
    if (SUBQUEUES.includes(q)) return q;
  }
  const numMatch = note.match(/\b([1-6])\s*[-.]\s*([12])\b/);
  if (numMatch) {
    const q = `${numMatch[1]}-${numMatch[2]}` as SubqueueId;
    if (SUBQUEUES.includes(q)) return q;
  }
  return null;
}

export const FavoritesWatchPage: React.FC<FavoritesWatchPageProps> = ({
  favorites,
  myHomeKey,
  buildings,
  manualPoints,
  resolverCtx,
  queuesMap,
  availableDates,
  selectedDate,
  onSelectDate,
  currentSlot,
  onSelectSlot,
  mergedLightDark,
  onToggleMergedLightDark,
  onBackToMap,
  onFlyToFavorite,
  onFlyToHome,
  onUpdateFavoriteNote,
  onRemoveFavorite,
  forecastInfo = null,
  shiftModel = null,
  customShiftSlots = null,
  onChangeCustomShiftSlots,
}) => {
  const [now, setNow] = useState<Date>(() => new Date());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string>('');

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const watchedItems = useMemo<WatchedItem[]>(() => {
    const list: WatchedItem[] = [];
    const seenKeys = new Set<string>();

    const buildFromBuilding = (
      b: BuildingRecord | undefined,
      mp: ManualPoint | undefined,
      key: string,
      title: string,
      note: string,
      isHome: boolean,
      favorite?: FavoriteAddress
    ): WatchedItem => {
      let queue: SubqueueId | null = null;
      let secondaryQueue: SubqueueId | null = null;
      let dualType: DualQueueType = 'none';
      let feeder: string | undefined;

      if (mp) {
        queue = mp.queue;
        feeder = mp.feeder || undefined;
      } else if (b?.source === 'manual' && b.manualQueue) {
        queue = b.manualQueue;
        feeder = b.manualFeeder;
      } else if (b) {
        const info = resolveBuilding(b.street, b.house, resolverCtx);
        queue = info?.primary || null;
        secondaryQueue =
          info?.secondary && info.secondary !== info.primary ? info.secondary : null;
        dualType = info?.dualType || 'none';
        feeder = info?.feeder;
      } else if (favorite) {
        const info = !favorite.key.startsWith('manual|')
          ? resolveBuilding(favorite.street, favorite.house, resolverCtx)
          : null;
        if (info) {
          queue = info.primary;
          secondaryQueue = info.secondary && info.secondary !== info.primary ? info.secondary : null;
          dualType = info.dualType || 'none';
          feeder = info.feeder;
        } else if (favorite.queue) {
          queue = favorite.queue;
          feeder = favorite.feeder;
        } else {
          queue = extractQueueFromNote(favorite.note);
        }
      }

      const schedule = queue ? queuesMap[queue] || [] : [];
      const secondarySchedule = secondaryQueue ? queuesMap[secondaryQueue] || [] : [];
      const rawCurrent = schedule[currentSlot] || 'on';
      const currentState = normalizeDisplayState(rawCurrent, mergedLightDark);
      const cd = computeCountdownMerged(schedule, currentSlot, now, mergedLightDark);

      const hasSecondary = Boolean(secondaryQueue && secondarySchedule.length >= 48);
      const secondaryCurrentState = hasSecondary
        ? normalizeDisplayState(secondarySchedule[currentSlot] || 'on', mergedLightDark)
        : null;
      const secondaryCd = hasSecondary
        ? computeCountdownMerged(secondarySchedule, currentSlot, now, mergedLightDark)
        : null;

      return {
        id: favorite?.id || `home_${key}`,
        key,
        title,
        note,
        isHome,
        favorite,
        queue,
        secondaryQueue,
        dualType,
        feeder,
        schedule,
        secondarySchedule,
        currentState,
        secondaryCurrentState,
        nextChangeLabel: cd.label,
        countdown: cd.countdown,
        secondaryNextChangeLabel: secondaryCd?.label || null,
        secondaryCountdown: secondaryCd?.countdown || null,
      };
    };

    if (myHomeKey) {
      const homeB = buildings.find((b) => b.key === myHomeKey);
      const homeMp = myHomeKey.startsWith('manual|')
        ? manualPoints.find((p) => `manual|${p.id}` === myHomeKey)
        : undefined;
      const matchingFav = favorites.find((f) => f.key === myHomeKey);
      if (homeB || homeMp || matchingFav) {
        seenKeys.add(myHomeKey);
        list.push(
          buildFromBuilding(
            homeB,
            homeMp,
            myHomeKey,
            homeMp
              ? homeMp.label
              : homeB
              ? homeB.label || `${homeB.street}, ${homeB.house}`
              : matchingFav!.label || `${matchingFav!.street}${matchingFav!.house ? `, ${matchingFav!.house}` : ''}`,
            matchingFav?.note || homeMp?.note || 'Мій дім',
            true,
            matchingFav
          )
        );
      }
    }

    for (const fav of favorites) {
      if (seenKeys.has(fav.key)) continue;
      seenKeys.add(fav.key);
      const mp = fav.key.startsWith('manual|')
        ? manualPoints.find((p) => `manual|${p.id}` === fav.key || p.id === fav.buildingId)
        : undefined;
      const b = mp ? undefined : buildings.find((x) => x.key === fav.key || x.id === fav.buildingId);
      list.push(
        buildFromBuilding(
          b,
          mp,
          fav.key,
          mp?.label || fav.label || `${fav.street}${fav.house ? `, ${fav.house}` : ''}`,
          fav.note || mp?.note || '',
          false,
          fav
        )
      );
    }

    return list;
  }, [myHomeKey, favorites, buildings, manualPoints, resolverCtx, queuesMap, currentSlot, mergedLightDark, now]);

  const anySwitchingToday = useMemo(
    () =>
      watchedItems.some(
        (item) =>
          item.schedule.some((s) => s === 'switch_off' || s === 'switch_on') ||
          item.secondarySchedule.some((s) => s === 'switch_off' || s === 'switch_on')
      ),
    [watchedItems]
  );

  const anyDualQueue = useMemo(
    () => watchedItems.some((item) => Boolean(item.secondaryQueue)),
    [watchedItems]
  );

  const nowCountOn = watchedItems.filter((w) => w.currentState === 'on').length;
  const nowCountOff = watchedItems.filter((w) => w.currentState === 'off').length;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-[#0b1120] pb-20">
      <div className="max-w-5xl mx-auto px-3 sm:px-5 py-4 space-y-4">
        {/* Sticky Control Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onBackToMap}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>До карти</span>
            </button>
            <div>
              <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                <span>Моніторинг обраних ({watchedItems.length})</span>
              </h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Слот {formatSlotTime(currentSlot)} · зі світлом: {nowCountOn}, без світла: {nowCountOff}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CalendarDatePicker
              availableDates={availableDates}
              selectedDate={selectedDate}
              onSelectDate={onSelectDate}
              allowForecast
              isForecastDate={Boolean(forecastInfo?.isForecast)}
            />

            <button
              type="button"
              onClick={onToggleMergedLightDark}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                mergedLightDark
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
              }`}
              title="Об'єднати нарізку: лише Зі світлом / Без світла (на карті та цій сторінці)"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{mergedLightDark ? 'Обʼєднано: Світло / Без' : 'Детально (з перемик.)'}</span>
            </button>
          </div>
        </div>

        {/* Forecast Banner when viewing a future / predicted calendar date */}
        {forecastInfo?.isForecast && (
          <div className="px-3.5 py-2.5 rounded-xl bg-violet-50 dark:bg-violet-950/40 border border-violet-300/80 dark:border-violet-800/70 text-xs text-violet-950 dark:text-violet-100 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-start gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 min-w-0">
                <div className="font-semibold">
                  Прогноз на {selectedDate} (
                  {forecastInfo.daysOffset >= 0
                    ? `+${forecastInfo.daysOffset}`
                    : forecastInfo.daysOffset}{' '}
                  дн. від {forecastInfo.anchorDate})
                </div>
                <div className="text-[11px] text-violet-800/90 dark:text-violet-300/90">
                  {forecastInfo.summaryUk}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {onChangeCustomShiftSlots && (
                <select
                  value={customShiftSlots === null ? 'auto' : String(customShiftSlots)}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChangeCustomShiftSlots(v === 'auto' ? null : Number(v));
                  }}
                  aria-label="Крок добового зміщення"
                  className="bg-white dark:bg-[#0b1120] border border-violet-300 dark:border-violet-700 rounded-md px-2 py-1 text-[11px] font-mono text-violet-900 dark:text-violet-100 focus:outline-none focus:border-violet-500"
                >
                  <option value="auto">
                    Авто ({shiftModel ? formatShiftSlotsUk(shiftModel.dailyTimeShiftSlots) : '+2 год/добу'})
                  </option>
                  {[-8, -6, -4, -2, 0, 2, 4, 6, 8].map((s) => (
                    <option key={s} value={String(s)}>
                      {formatShiftSlotsUk(s)}
                    </option>
                  ))}
                </select>
              )}
              {availableDates[0] && (
                <button
                  type="button"
                  onClick={() => onSelectDate(availableDates[0])}
                  className="px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
                >
                  Повернутись до офіц. ({availableDates[0].slice(5)})
                </button>
              )}
            </div>
          </div>
        )}

        {/* Helpful Banner if Switching is Rare */}
        {!forecastInfo?.isForecast && !anySwitchingToday && watchedItems.length > 0 && (
          <div className="px-3.5 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
            <span>
              Сьогодні перемикань немає — графік автоматично згруповано у чисті інтервали «Зі світлом / Без світла».
            </span>
          </div>
        )}

        {/* Empty State */}
        {watchedItems.length === 0 ? (
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center mx-auto">
              <Star className="w-6 h-6 text-amber-500" />
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Список обраних адрес порожній
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
              Натисніть на будь-який будинок або власну точку на карті та оберіть{' '}
              <strong>«В обрані»</strong> або <strong>«Мій дім»</strong> (наприклад: Дім, Робота, Батьки). Після цього тут зʼявляться живі таймери та обʼєднаний графік світла на всю добу.
            </p>
            <button
              type="button"
              onClick={onBackToMap}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Обрати адреси на карті</span>
            </button>
          </div>
        ) : (
          <>
            {/* Comparative 24h Matrix across all favorites */}
            <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-sky-500" />
                  <span>Порівняння по годинах (00:00 — 24:00)</span>
                </h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" /> Зі світлом
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-red-500 inline-block" /> Без світла
                  </span>
                  {anyDualQueue && (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-xs bg-sky-500 inline-block" /> 2-га / Ліфти: є
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-xs bg-purple-600 inline-block" /> 2-га / Ліфти: без
                      </span>
                    </>
                  )}
                  {!mergedLightDark && (
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-xs bg-orange-500 inline-block" /> Перемик.
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2.5">
                {/* Hour ticks */}
                <div className="flex justify-between text-[10px] font-mono text-slate-400 pl-0 sm:pl-44 pr-0.5">
                  <span>00:00</span>
                  <span>06:00</span>
                  <span>12:00</span>
                  <span>18:00</span>
                  <span>24:00</span>
                </div>

                {watchedItems.map((item) => {
                  const intervals = buildMergedIntervals(item.schedule, mergedLightDark);
                  const secondaryIntervals =
                    item.secondaryQueue && item.secondarySchedule.length >= 48
                      ? buildMergedIntervals(item.secondarySchedule, mergedLightDark)
                      : [];
                  const hasSecondaryRow = Boolean(item.secondaryQueue && secondaryIntervals.length > 0);
                  const dualLabels = getDualRoleLabels(item.dualType);
                  const cursorPct = ((currentSlot + 0.5) / 48) * 100;

                  return (
                    <div
                      key={`matrix_${item.key}`}
                      className={`space-y-1 ${
                        hasSecondaryRow
                          ? 'pb-1.5 border-b border-slate-100 dark:border-slate-800/70 last:border-b-0 last:pb-0'
                          : ''
                      }`}
                    >
                      {/* Primary Queue Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                        <div className="sm:w-40 shrink-0 flex items-center justify-between sm:justify-start gap-1.5 min-w-0">
                          <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate flex items-center gap-1">
                            {item.isHome && <Home className="w-3 h-3 text-sky-500 shrink-0" />}
                            <span className="truncate">{item.note || item.title}</span>
                          </span>
                          {item.queue && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                              {formatSubqueue(item.queue)}
                            </span>
                          )}
                        </div>

                        <div className="relative flex-1 h-7 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700/80 flex bg-slate-100 dark:bg-slate-900">
                          {intervals.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center text-[11px] text-slate-400">
                              Немає даних черги
                            </div>
                          ) : (
                            intervals.map((seg) => {
                              const widthPct = ((seg.endSlot - seg.startSlot) / 48) * 100;
                              const isLight = seg.state === 'on';
                              const isOff = seg.state === 'off';
                              return (
                                <button
                                  key={`${seg.startSlot}-${seg.endSlot}`}
                                  type="button"
                                  onClick={() => onSelectSlot(seg.startSlot)}
                                  style={{
                                    width: `${widthPct}%`,
                                    backgroundColor: stateColor(seg.state),
                                  }}
                                  className="h-full relative group border-r border-white/25 dark:border-slate-950/35 last:border-r-0 flex items-center justify-center overflow-hidden transition-opacity hover:opacity-90"
                                  title={`${hasSecondaryRow ? `${dualLabels.primaryShort} (${formatSubqueue(item.queue!)}) · ` : ''}${seg.startTime}–${seg.endTime}: ${stateLabel(seg.state)} (${formatDurationShort(seg.durationMin)})`}
                                >
                                  {widthPct >= 14 && (
                                    <span
                                      className={`text-[10px] font-mono font-bold px-1 truncate ${
                                        isLight || isOff ? 'text-white' : 'text-slate-950'
                                      }`}
                                    >
                                      {seg.startTime}–{seg.endTime}
                                    </span>
                                  )}
                                </button>
                              );
                            })
                          )}

                          {/* Active slot indicator line */}
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-white dark:bg-sky-300 shadow-[0_0_6px_rgba(0,0,0,0.9)] pointer-events-none"
                            style={{ left: `${cursorPct}%` }}
                          />
                        </div>
                      </div>

                      {/* Secondary Queue Row (e.g., Lifts / 2nd entrance / Backup) in distinct Sky/Violet palette */}
                      {hasSecondaryRow && item.secondaryQueue && (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                          <div className="sm:w-40 shrink-0 flex items-center justify-between sm:justify-end gap-1.5 min-w-0 pl-2 sm:pl-0">
                            <span className="text-[11px] font-medium text-purple-700 dark:text-purple-300 truncate">
                              ↳ {dualLabels.secondaryShort}
                            </span>
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/70 border border-purple-300/70 dark:border-purple-700/70 text-purple-800 dark:text-purple-200 shrink-0">
                              {formatSubqueue(item.secondaryQueue)}
                            </span>
                          </div>

                          <div className="relative flex-1 h-5 rounded-md overflow-hidden border border-purple-300/80 dark:border-purple-700/70 flex bg-slate-100 dark:bg-slate-900">
                            {secondaryIntervals.map((seg) => {
                              const widthPct = ((seg.endSlot - seg.startSlot) / 48) * 100;
                              return (
                                <button
                                  key={`sec_${seg.startSlot}-${seg.endSlot}`}
                                  type="button"
                                  onClick={() => onSelectSlot(seg.startSlot)}
                                  style={{
                                    width: `${widthPct}%`,
                                    backgroundColor: secondaryStateColor(seg.state),
                                  }}
                                  className="h-full relative group border-r border-white/25 dark:border-slate-950/35 last:border-r-0 flex items-center justify-center overflow-hidden transition-opacity hover:opacity-90"
                                  title={`${dualLabels.secondaryFull} (${formatSubqueue(item.secondaryQueue!)}) · ${seg.startTime}–${seg.endTime}: ${stateLabel(seg.state)} (${formatDurationShort(seg.durationMin)})`}
                                >
                                  {widthPct >= 14 && (
                                    <span className="text-[9px] font-mono font-bold px-1 truncate text-white">
                                      {seg.startTime}–{seg.endTime}
                                    </span>
                                  )}
                                </button>
                              );
                            })}

                            {/* Active slot indicator line */}
                            <div
                              className="absolute top-0 bottom-0 w-0.5 bg-white dark:bg-amber-300 shadow-[0_0_6px_rgba(0,0,0,0.9)] pointer-events-none"
                              style={{ left: `${cursorPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Detailed Watch Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {watchedItems.map((item) => {
                const intervals = buildMergedIntervals(item.schedule, mergedLightDark);
                const totals = computeScheduleTotals(item.schedule, mergedLightDark);
                const hasSecondary = Boolean(
                  item.secondaryQueue && item.secondarySchedule.length >= 48
                );
                const secondaryIntervals = hasSecondary
                  ? buildMergedIntervals(item.secondarySchedule, mergedLightDark)
                  : [];
                const secondaryTotals = hasSecondary
                  ? computeScheduleTotals(item.secondarySchedule, mergedLightDark)
                  : null;
                const dualLabels = getDualRoleLabels(item.dualType);
                const isLightNow = item.currentState === 'on';
                const isOffNow = item.currentState === 'off';
                const isSecLightNow = item.secondaryCurrentState === 'on';
                const isSecOffNow = item.secondaryCurrentState === 'off';

                return (
                  <article
                    key={item.key}
                    className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs flex flex-col justify-between gap-3"
                  >
                    {/* Card Header */}
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.isHome && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 text-[10px] font-bold">
                                <Home className="w-3 h-3" /> Мій дім
                              </span>
                            )}
                            {item.queue && (
                              <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                                {hasSecondary ? `${dualLabels.primaryShort}: ` : 'Черга '}
                                {formatSubqueue(item.queue)}
                              </span>
                            )}
                            {hasSecondary && item.secondaryQueue && (
                              <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/70 border border-purple-300/70 dark:border-purple-700/70 text-purple-800 dark:text-purple-200">
                                {dualLabels.secondaryShort}: {formatSubqueue(item.secondaryQueue)}
                              </span>
                            )}
                          </div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1 truncate">
                            {item.title}
                          </h3>
                          {item.feeder && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {item.feeder}
                            </p>
                          )}
                        </div>

                        <div className="shrink-0 flex flex-col items-end gap-1">
                          <div
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
                              isLightNow
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                : isOffNow
                                ? 'bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30'
                                : 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30'
                            }`}
                          >
                            {isLightNow ? (
                              <Zap className="w-3.5 h-3.5" />
                            ) : (
                              <ZapOff className="w-3.5 h-3.5" />
                            )}
                            <span>{stateLabel(item.currentState)}</span>
                          </div>

                          {hasSecondary && item.secondaryCurrentState && (
                            <div
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                isSecLightNow
                                  ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/35'
                                  : isSecOffNow
                                  ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/35'
                                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/35'
                              }`}
                            >
                              <span>
                                {dualLabels.secondaryShort}:{' '}
                                {isSecLightNow ? 'є' : isSecOffNow ? 'відкл.' : 'перемик.'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Note editor */}
                      {editingKey === item.key && item.favorite ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editingNote}
                            onChange={(e) => setEditingNote(e.target.value)}
                            placeholder="Напр.: Дім, Робота, Батьки…"
                            maxLength={120}
                            className="flex-1 bg-slate-50 dark:bg-[#0b1120] border border-sky-500 rounded-md px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => {
                              onUpdateFavoriteNote(item.key, editingNote.trim());
                              setEditingKey(null);
                            }}
                            className="px-2.5 py-1 rounded-md bg-sky-600 text-white text-xs font-semibold"
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingKey(null)}
                            className="px-2 py-1 rounded-md bg-slate-200 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300"
                          >
                            Скасувати
                          </button>
                        </div>
                      ) : (
                        item.note && (
                          <p className="text-xs text-sky-700 dark:text-sky-300 font-medium">
                            Примітка: {item.note}
                          </p>
                        )
                      )}

                      {/* Live Countdown Strip */}
                      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#0b1120] border border-slate-200 dark:border-slate-800">
                        <span className="text-xs text-slate-600 dark:text-slate-300 truncate">
                          {hasSecondary ? `${dualLabels.primaryShort}: ` : ''}
                          {item.nextChangeLabel}
                        </span>
                        <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                          {item.countdown}
                        </span>
                      </div>

                      {/* Merged Contiguous Intervals List (Primary Queue) */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>
                            {hasSecondary && item.queue
                              ? `${dualLabels.primaryShort} (${formatSubqueue(item.queue)})`
                              : 'Інтервали на добу'}
                          </span>
                          <span className="font-mono">
                            Світло: {formatDurationShort(totals.lightMin)} · Без:{' '}
                            {formatDurationShort(totals.offMin)}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {intervals.map((seg) => {
                            const active =
                              currentSlot >= seg.startSlot && currentSlot < seg.endSlot;
                            return (
                              <button
                                key={`${seg.startSlot}-${seg.endSlot}`}
                                type="button"
                                onClick={() => onSelectSlot(seg.startSlot)}
                                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono border transition-all ${
                                  active
                                    ? 'ring-2 ring-sky-500 border-sky-500 font-bold'
                                    : 'border-slate-200 dark:border-slate-700/80 hover:border-slate-400'
                                } ${
                                  seg.state === 'on'
                                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                                    : seg.state === 'off'
                                    ? 'bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-300'
                                    : 'bg-orange-50 dark:bg-orange-950/50 text-orange-800 dark:text-orange-300'
                                }`}
                              >
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: stateColor(seg.state) }}
                                />
                                <span>
                                  {seg.startTime}–{seg.endTime}
                                </span>
                                <span className="opacity-70 text-[10px]">
                                  ({formatDurationShort(seg.durationMin)})
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Secondary Queue Section (e.g. Lifts / 2nd entrance / Backup) */}
                      {hasSecondary && item.secondaryQueue && secondaryTotals && (
                        <div className="pt-2 mt-1 border-t border-dashed border-purple-200 dark:border-purple-800/70 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="font-semibold text-purple-700 dark:text-purple-300">
                              {dualLabels.secondaryFull} ({formatSubqueue(item.secondaryQueue)})
                            </span>
                            <span className="font-mono text-slate-500 dark:text-slate-400">
                              Є: {formatDurationShort(secondaryTotals.lightMin)} · Без:{' '}
                              {formatDurationShort(secondaryTotals.offMin)}
                            </span>
                          </div>

                          {item.secondaryNextChangeLabel && item.secondaryCountdown && (
                            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/70 dark:border-purple-800/50 text-[11px]">
                              <span className="text-purple-800 dark:text-purple-200 truncate">
                                {item.secondaryNextChangeLabel}
                              </span>
                              <span className="font-mono font-bold text-purple-900 dark:text-purple-100 tabular-nums shrink-0">
                                {item.secondaryCountdown}
                              </span>
                            </div>
                          )}

                          <div className="flex flex-wrap gap-1.5">
                            {secondaryIntervals.map((seg) => {
                              const active =
                                currentSlot >= seg.startSlot && currentSlot < seg.endSlot;
                              return (
                                <button
                                  key={`sec_chip_${seg.startSlot}-${seg.endSlot}`}
                                  type="button"
                                  onClick={() => onSelectSlot(seg.startSlot)}
                                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono border transition-all ${
                                    active
                                      ? 'ring-2 ring-purple-500 border-purple-500 font-bold'
                                      : 'border-slate-200 dark:border-slate-700/80 hover:border-purple-400'
                                  } ${
                                    seg.state === 'on'
                                      ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300'
                                      : seg.state === 'off'
                                      ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300'
                                      : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                                  }`}
                                >
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{ backgroundColor: secondaryStateColor(seg.state) }}
                                  />
                                  <span>
                                    {seg.startTime}–{seg.endTime}
                                  </span>
                                  <span className="opacity-70 text-[10px]">
                                    ({formatDurationShort(seg.durationMin)})
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Card Footer Actions */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          if (item.favorite) onFlyToFavorite(item.favorite);
                          else onFlyToHome();
                          onBackToMap();
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>Показати на карті</span>
                      </button>

                      {item.favorite && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingKey(item.key);
                              setEditingNote(item.note);
                            }}
                            className="p-1.5 rounded text-slate-400 hover:text-sky-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            title="Змінити примітку"
                            aria-label="Змінити примітку"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveFavorite(item.key)}
                            className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            title="Видалити з обраних"
                            aria-label="Видалити з обраних"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
