import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Flame,
  MapPin,
  RefreshCw,
  Search,
  TrendingUp,
} from 'lucide-react';
import {
  AnalyticsWindow,
  ComputedOutageAnalytics,
  HotspotItem,
} from '../lib/outageAnalytics';
import { formatSubqueue, SubqueueId } from '../lib/types';

interface AnalyticsPageProps {
  analytics: ComputedOutageAnalytics;
  window: AnalyticsWindow;
  onChangeWindow: (w: AnalyticsWindow) => void;
  includeSwitches: boolean;
  onToggleIncludeSwitches: () => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  onBackToMap: () => void;
  onJumpToStreet: (streetName: string, buildingId?: string) => void;
  onOpenAuditModal: () => void;
}

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({
  analytics,
  window: activeWindow,
  onChangeWindow,
  includeSwitches,
  onToggleIncludeSwitches,
  isRefreshing,
  onRefresh,
  onBackToMap,
  onJumpToStreet,
  onOpenAuditModal,
}) => {
  const [selectedQueue, setSelectedQueue] = useState<SubqueueId | null>(null);
  const [hoveredDayIdx, setHoveredDayIdx] = useState<number | null>(null);
  const [hotspotTab, setHotspotTab] = useState<'street' | 'zone'>('street');
  const [hotspotQuery, setHotspotQuery] = useState<string>('');

  const maxQueueHours = useMemo(
    () => Math.max(1, ...analytics.unluckyQueues.map((q) => q.totalOffHours)),
    [analytics.unluckyQueues]
  );

  const dailyMaxHours = useMemo(() => {
    const vals = analytics.dailySeries.map((d) =>
      selectedQueue ? d.byQueue[selectedQueue] || 0 : d.cityAvgHours
    );
    return Math.max(2, ...vals);
  }, [analytics.dailySeries, selectedQueue]);

  const hoveredDay = hoveredDayIdx !== null ? analytics.dailySeries[hoveredDayIdx] : null;

  const filteredHotspots = useMemo(() => {
    const base: HotspotItem[] =
      hotspotTab === 'street' ? analytics.streetHotspots : analytics.zoneHotspots;
    const q = hotspotQuery.trim().toLowerCase();
    if (!q) return base.slice(0, 20);
    return base
      .filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.sublabel.toLowerCase().includes(q) ||
          item.queues.some((sq) => formatSubqueue(sq).toLowerCase().includes(q) || sq.includes(q))
      )
      .slice(0, 25);
  }, [analytics.streetHotspots, analytics.zoneHotspots, hotspotTab, hotspotQuery]);

  const topStreet = analytics.streetHotspots[0] || null;
  const spreadHours =
    analytics.mostUnlucky && analytics.mostStable
      ? Number(
          (analytics.mostUnlucky.totalOffHours - analytics.mostStable.totalOffHours).toFixed(1)
        )
      : 0;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-6">
        {/* Top Action & Period Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <button
                type="button"
                onClick={onBackToMap}
                className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>На карту</span>
              </button>
              <span aria-hidden="true">/</span>
              <span>Аналітика відключень ГПВ</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Невезучі черги та гарячі точки
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Період: {activeWindow === '7d' ? 'останні 7 днів (тиждень)' : 'останні 30 днів (місяць)'}
              <span className="mx-1.5" aria-hidden="true">·</span>
              Зібрано реальних днів: <span className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200">{analytics.trackedDaysCount}</span> із {analytics.windowDays}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Period Segmented Switcher */}
            <div
              className="inline-flex items-center p-0.5 rounded-lg bg-slate-200/80 dark:bg-[#111827] border border-slate-300 dark:border-slate-800 text-xs"
              role="tablist"
              aria-label="Період статистики"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeWindow === '7d'}
                onClick={() => onChangeWindow('7d')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                  activeWindow === '7d'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                За тиждень
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeWindow === '30d'}
                onClick={() => onChangeWindow('30d')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                  activeWindow === '30d'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                За місяць
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleIncludeSwitches}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                includeSwitches
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-white dark:bg-[#111827] border-slate-300 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {includeSwitches ? 'З перемиканнями' : 'Лише точні відключення'}
            </button>

            <button
              type="button"
              onClick={onOpenAuditModal}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <BarChart3 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Аудит</span>
            </button>

            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-2 rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors"
              aria-label="Оновити аналітику"
              title="Оновити аналітику"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 4 Flat Single-Elevation KPI Tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Найневезучіша черга
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
                {analytics.mostUnlucky ? formatSubqueue(analytics.mostUnlucky.queue) : '—'}
              </span>
              {analytics.mostUnlucky && (
                <span className="font-mono text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                  {analytics.mostUnlucky.totalOffHours} год
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {analytics.mostUnlucky
                ? `~${analytics.mostUnlucky.avgHoursPerDay} год/добу`
                : 'Очікування графіка'}
            </div>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Найстабільніша черга
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {analytics.mostStable ? formatSubqueue(analytics.mostStable.queue) : '—'}
              </span>
              {analytics.mostStable && (
                <span className="font-mono text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                  {analytics.mostStable.totalOffHours} год
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {analytics.mostStable
                ? `~${analytics.mostStable.avgHoursPerDay} год/добу`
                : 'Очікування графіка'}
            </div>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Середньо по місту
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {analytics.cityAvgPerDay}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">год/добу</span>
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Різниця макс–мін: {spreadHours} год
            </div>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Найгарячіша вулиця
            </div>
            <div className="mt-1.5 text-base font-bold text-slate-900 dark:text-white truncate">
              {topStreet ? topStreet.name : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {topStreet
                ? `${topStreet.avgOffHoursPeriod} год · ${topStreet.totalIncidents} подій`
                : 'Немає інцидентів'}
            </div>
          </div>
        </div>

        {/* Main 2-Column Charts Section: Unlucky Queue Ranking + Daily Trend */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left (7 cols): Ranked Unlucky Queues Horizontal Bar Chart */}
          <section className="lg:col-span-7 p-4 sm:p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span>Графік невезучих черг (1.1 – 6.2)</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Натисніть на чергу, щоб переглянути її щоденну динаміку праворуч
                </p>
              </div>
              {selectedQueue && (
                <button
                  type="button"
                  onClick={() => setSelectedQueue(null)}
                  className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap"
                >
                  Скинути вибір ({formatSubqueue(selectedQueue)})
                </button>
              )}
            </div>

            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800/70">
              {analytics.unluckyQueues.map((row) => {
                const pct =
                  maxQueueHours > 0 ? Math.max(3, (row.totalOffHours / maxQueueHours) * 100) : 0;
                const isSelected = selectedQueue === row.queue;
                const barColor =
                  row.rank <= 3
                    ? 'bg-red-600 dark:bg-red-500'
                    : row.rank <= 8
                    ? 'bg-amber-500 dark:bg-amber-500'
                    : 'bg-emerald-600 dark:bg-emerald-500';
                const deltaText =
                  row.deltaFromMeanHours > 0
                    ? `+${row.deltaFromMeanHours} год`
                    : `${row.deltaFromMeanHours} год`;

                return (
                  <button
                    key={row.queue}
                    type="button"
                    onClick={() => setSelectedQueue(isSelected ? null : row.queue)}
                    className={`w-full py-2 px-2 -mx-2 rounded-md text-left transition-colors flex items-center gap-3 ${
                      isSelected
                        ? 'bg-sky-50 dark:bg-sky-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <span className="w-5 text-right font-mono text-xs text-slate-400 tabular-nums shrink-0">
                      {row.rank}.
                    </span>
                    <span className="w-11 font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                      {formatSubqueue(row.queue)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="h-3 rounded-xs bg-slate-100 dark:bg-slate-800/90 overflow-hidden">
                        <div
                          className={`h-full ${barColor} transition-all`}
                          style={{ width: `${row.totalOffHours > 0 ? pct : 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-24 sm:w-32 text-right font-mono text-xs tabular-nums shrink-0">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {row.totalOffHours} год
                      </span>
                      <span className="hidden sm:inline text-slate-400"> · </span>
                      <span
                        className={`hidden sm:inline ${
                          row.deltaFromMeanHours > 0
                            ? 'text-red-600 dark:text-red-400'
                            : row.deltaFromMeanHours < 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {deltaText}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Right (5 cols): Daily Bar Chart for 7d or 30d */}
          <section className="lg:col-span-5 p-4 sm:p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col justify-between space-y-4">
            <div className="space-y-1">
              <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
                {selectedQueue
                  ? `Динаміка черги ${formatSubqueue(selectedQueue)} (${
                      activeWindow === '7d' ? '7 днів' : '30 днів'
                    })`
                  : `Середні відключення по днях (${activeWindow === '7d' ? '7 днів' : '30 днів'})`}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 min-h-[18px]">
                {hoveredDay ? (
                  hoveredDay.hasData ? (
                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
                      {hoveredDay.fullLabel}:{' '}
                      <strong>
                        {selectedQueue
                          ? hoveredDay.byQueue[selectedQueue]
                          : hoveredDay.cityAvgHours}{' '}
                        год
                      </strong>
                      {!selectedQueue && (
                        <> (мін {hoveredDay.minQueueHours} · макс {hoveredDay.maxQueueHours})</>
                      )}
                    </span>
                  ) : (
                    <span>{hoveredDay.fullLabel}: даних за цей день ще не накопичено</span>
                  )
                ) : (
                  'Наведіть або натисніть на стовпчик дня для деталей'
                )}
              </p>
            </div>

            {/* Vertical Bar Chart */}
            <div className="w-full h-56 flex items-end gap-[3px] sm:gap-1 pt-5 pb-7 px-1 relative border-t border-b border-slate-100 dark:border-slate-800">
              <div className="pointer-events-none absolute inset-x-0 top-5 border-t border-dashed border-slate-200 dark:border-slate-800 flex justify-end">
                <span className="text-[10px] font-mono text-slate-400 -mt-3.5 pr-1 tabular-nums">
                  {dailyMaxHours} год
                </span>
              </div>
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-slate-200/70 dark:border-slate-800/70 flex justify-end">
                <span className="text-[10px] font-mono text-slate-400 -mt-3.5 pr-1 tabular-nums">
                  {(dailyMaxHours / 2).toFixed(1)}
                </span>
              </div>

              {analytics.dailySeries.map((day, idx) => {
                const val = selectedQueue ? day.byQueue[selectedQueue] || 0 : day.cityAvgHours;
                const heightPct = day.hasData
                  ? val > 0
                    ? Math.max(6, (val / dailyMaxHours) * 100)
                    : 4
                  : 0;
                const isHovered = hoveredDayIdx === idx;
                const showLabel =
                  activeWindow === '7d'
                    ? true
                    : idx === 0 ||
                      idx === analytics.dailySeries.length - 1 ||
                      idx % 5 === 0;

                return (
                  <button
                    key={day.date}
                    type="button"
                    onMouseEnter={() => setHoveredDayIdx(idx)}
                    onMouseLeave={() => setHoveredDayIdx(null)}
                    onClick={() => setHoveredDayIdx(isHovered ? null : idx)}
                    className="flex-1 h-full flex flex-col justify-end items-center relative focus:outline-none"
                    aria-label={`${day.fullLabel}: ${day.hasData ? `${val} годин` : 'немає даних'}`}
                  >
                    {day.hasData ? (
                      <div
                        className={`w-full max-w-[28px] rounded-t-xs transition-opacity ${
                          val >= 8
                            ? 'bg-red-600 dark:bg-red-500'
                            : val >= 4
                            ? 'bg-amber-500'
                            : 'bg-sky-600 dark:bg-sky-500'
                        } ${isHovered ? 'ring-2 ring-slate-900 dark:ring-white' : ''}`}
                        style={{ height: `${heightPct}%` }}
                      />
                    ) : (
                      <div className="w-full max-w-[28px] h-[2px] bg-slate-200 dark:bg-slate-800" />
                    )}
                    {showLabel && (
                      <span className="absolute -bottom-5 text-[9px] font-mono text-slate-400 tabular-nums whitespace-nowrap">
                        {day.shortLabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Архів поповнюється автоматично з графіків ДПЕМ щодня (зберігається на сервері та локально в браузері до 30 днів).
              {analytics.trackedDaysCount < analytics.windowDays && (
                <>
                  {' '}
                  Порожні стовпчики — дні, за які архів ще не встиг накопичитись.
                </>
              )}
            </div>
          </section>
        </div>

        {/* Hotspots Section: Streets & Substation/Feeder Districts */}
        <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>Гарячі точки: вулиці та райони з найчастішими відключеннями</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Враховано аварійні/оперативні/планові повідомлення ДПЕМ, переноси фідерів та сумарні години ГПВ
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center p-0.5 rounded-md bg-slate-100 dark:bg-[#0b1120] border border-slate-200 dark:border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setHotspotTab('street')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                    hotspotTab === 'street'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Вулиці ({analytics.streetHotspots.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHotspotTab('zone')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                    hotspotTab === 'zone'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Райони / Фідери ({analytics.zoneHotspots.length})
                </button>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={hotspotQuery}
                  onChange={(e) => setHotspotQuery(e.target.value)}
                  placeholder="Пошук вулиці або черги…"
                  className="bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded-md pl-8 pr-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 w-48 sm:w-56"
                />
              </div>
            </div>
          </div>

          {/* High-Density Data Table */}
          <div className="overflow-x-auto">
            {filteredHotspots.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                За вашим запитом гарячих точок не знайдено.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#0f172a]">
                    <th className="py-2.5 pl-4 pr-2 w-10">#</th>
                    <th className="py-2.5 px-3">
                      {hotspotTab === 'street' ? 'Вулиця / мікрорайон' : 'Підстанція та фідер'}
                    </th>
                    <th className="py-2.5 px-3">Черги</th>
                    <th className="py-2.5 px-3 text-right">Без світла</th>
                    <th className="py-2.5 px-3 text-right">Події / переноси</th>
                    <th className="py-2.5 pl-3 pr-4 text-right w-24">Карта</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredHotspots.map((item, idx) => {
                    const incidentParts: string[] = [];
                    if (item.emergencyCount > 0) incidentParts.push(`Авар: ${item.emergencyCount}`);
                    if (item.operCount > 0) incidentParts.push(`Опер: ${item.operCount}`);
                    if (item.transferCount > 0) incidentParts.push(`Перен: ${item.transferCount}`);
                    if (item.plannedCount > 0) incidentParts.push(`План: ${item.plannedCount}`);

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2.5 pl-4 pr-2 font-mono text-xs text-slate-400 tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-3 min-w-[180px]">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {item.name}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            {item.sublabel}
                            {item.editCount > 0 && ` · ${item.editCount} правок`}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums">
                          {item.queues.length > 0
                            ? item.queues.map(formatSubqueue).join(' · ')
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              item.avgOffHoursPerDay >= 6
                                ? 'text-red-600 dark:text-red-400'
                                : item.avgOffHoursPerDay >= 3
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {item.avgOffHoursPeriod} год
                          </span>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            ~{item.avgOffHoursPerDay} год/добу
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                          {item.totalIncidents > 0 ? (
                            <span className="text-amber-700 dark:text-amber-300 font-medium">
                              {incidentParts.join(' · ')}
                            </span>
                          ) : (
                            <span className="text-slate-400">Лише за ГПВ</span>
                          )}
                        </td>
                        <td className="py-2.5 pl-3 pr-4 text-right">
                          {hotspotTab === 'street' ? (
                            <button
                              type="button"
                              onClick={() => onJumpToStreet(item.name, item.sampleBuildingId)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-sky-700 dark:text-sky-400 whitespace-nowrap"
                            >
                              <MapPin className="w-3 h-3" />
                              <span>Показати</span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400 font-mono">
                              {item.queues[0] ? formatSubqueue(item.queues[0]) : '—'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
