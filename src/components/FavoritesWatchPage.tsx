import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Clock,
  Home,
  Layers,
  MapPin,
  Pencil,
  Star,
  Trash2,
  Zap,
  ZapOff,
} from 'lucide-react';
import { CalendarDatePicker } from './CalendarDatePicker';
import { resolveBuilding, ResolverContext, stateColor, stateLabel } from '../lib/resolver';
import {
  buildMergedIntervals,
  computeScheduleTotals,
  formatDurationShort,
  normalizeDisplayState,
} from '../lib/scheduleIntervals';
import {
  BuildingRecord,
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
}

interface WatchedItem {
  id: string;
  key: string;
  title: string;
  note: string;
  isHome: boolean;
  favorite?: FavoriteAddress;
  queue: SubqueueId | null;
  feeder?: string;
  schedule: SlotState[];
  currentState: SlotState;
  nextChangeLabel: string;
  countdown: string;
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
        feeder = info?.feeder;
      } else if (favorite) {
        if (favorite.queue) {
          queue = favorite.queue;
          feeder = favorite.feeder;
        } else {
          const info = resolveBuilding(favorite.street, favorite.house, resolverCtx);
          queue = info?.primary || extractQueueFromNote(favorite.note);
          feeder = info?.feeder;
        }
      }

      const schedule = queue ? queuesMap[queue] || [] : [];
      const rawCurrent = schedule[currentSlot] || 'on';
      const currentState = normalizeDisplayState(rawCurrent, mergedLightDark);
      const cd = computeCountdownMerged(schedule, currentSlot, now, mergedLightDark);

      return {
        id: favorite?.id || `home_${key}`,
        key,
        title,
        note,
        isHome,
        favorite,
        queue,
        feeder,
        schedule,
        currentState,
        nextChangeLabel: cd.label,
        countdown: cd.countdown,
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
    () => watchedItems.some((item) => item.schedule.some((s) => s === 'switch_off' || s === 'switch_on')),
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

        {/* Helpful Banner if Switching is Rare */}
        {!anySwitchingToday && watchedItems.length > 0 && (
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
                <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" /> Зі світлом
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-red-500 inline-block" /> Без світла
                  </span>
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
                  const cursorPct = ((currentSlot + 0.5) / 48) * 100;

                  return (
                    <div
                      key={`matrix_${item.key}`}
                      className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3"
                    >
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
                                title={`${seg.startTime}–${seg.endTime}: ${stateLabel(seg.state)} (${formatDurationShort(seg.durationMin)})`}
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
                  );
                })}
              </div>
            </section>

            {/* Detailed Watch Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {watchedItems.map((item) => {
                const intervals = buildMergedIntervals(item.schedule, mergedLightDark);
                const totals = computeScheduleTotals(item.schedule, mergedLightDark);
                const isLightNow = item.currentState === 'on';
                const isOffNow = item.currentState === 'off';

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
                                Черга {formatSubqueue(item.queue)}
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

                        <div
                          className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
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
                          {item.nextChangeLabel}
                        </span>
                        <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                          {item.countdown}
                        </span>
                      </div>

                      {/* Merged Contiguous Intervals List */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>Інтервали на добу</span>
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
