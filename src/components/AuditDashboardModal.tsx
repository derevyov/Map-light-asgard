import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Edit3,
  Flame,
  RefreshCw,
  Shield,
  TrendingUp,
  UserCheck,
  Users,
  UserX,
  X,
} from 'lucide-react';
import {
  AssignmentHistoryEntry,
  AuditEventRecord,
  FeederTransfer,
  formatSubqueue,
  ManualPoint,
  ServerAuditStats,
} from '../lib/types';
import { ComputedOutageAnalytics } from '../lib/outageAnalytics';

type TimeRange = '24h' | '7d' | '14d';
type FeedFilter = 'all' | 'visits' | 'edits';

interface AuditDashboardModalProps {
  isAdminUser: boolean;
  stats: ServerAuditStats | null;
  loadingStats: boolean;
  onRefreshStats: () => void;
  auditEvents: AuditEventRecord[];
  assignmentHistory: AssignmentHistoryEntry[];
  manualPoints: ManualPoint[];
  transfers: FeederTransfer[];
  overridesCount: number;
  outageAnalytics: ComputedOutageAnalytics;
  onOpenAnalyticsPage: (window?: '7d' | '30d') => void;
  onClose: () => void;
}

interface TimeBucket {
  key: string;
  label: string;
  fullLabel: string;
  startMs: number;
  endMs: number;
  anonVisits: number;
  loggedInVisits: number;
  pointEdits: number;
  collisionEdits: number;
  transferEdits: number;
}

interface UnifiedFeedItem {
  id: string;
  ts: number;
  kind: 'visit_anon' | 'visit_auth' | 'edit';
  badge: string;
  actor: string;
  text: string;
}

function buildBuckets(range: TimeRange): TimeBucket[] {
  const now = new Date();
  const buckets: TimeBucket[] = [];

  if (range === '24h') {
    const endHour = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      0,
      0,
      0
    );
    for (let i = 23; i >= 0; i--) {
      const start = new Date(endHour.getTime() - i * 3600_000);
      const end = new Date(start.getTime() + 3600_000);
      const hh = String(start.getHours()).padStart(2, '0');
      buckets.push({
        key: `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}-${hh}`,
        label: i % 3 === 0 || i === 0 ? `${hh}:00` : '',
        fullLabel: `${start.toLocaleDateString('uk-UA', {
          day: '2-digit',
          month: '2-digit',
        })} ${hh}:00–${String(end.getHours()).padStart(2, '0')}:00`,
        startMs: start.getTime(),
        endMs: end.getTime(),
        anonVisits: 0,
        loggedInVisits: 0,
        pointEdits: 0,
        collisionEdits: 0,
        transferEdits: 0,
      });
    }
    return buckets;
  }

  const days = range === '7d' ? 7 : 14;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(todayStart.getTime() - i * 86_400_000);
    const end = new Date(start.getTime() + 86_400_000);
    const shortDate = start.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
    buckets.push({
      key: `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`,
      label: days === 14 && i % 2 === 1 && i !== 0 ? '' : shortDate,
      fullLabel: start.toLocaleDateString('uk-UA', {
        weekday: 'short',
        day: '2-digit',
        month: 'long',
      }),
      startMs: start.getTime(),
      endMs: end.getTime(),
      anonVisits: 0,
      loggedInVisits: 0,
      pointEdits: 0,
      collisionEdits: 0,
      transferEdits: 0,
    });
  }
  return buckets;
}

export const AuditDashboardModal: React.FC<AuditDashboardModalProps> = ({
  isAdminUser,
  stats,
  loadingStats,
  onRefreshStats,
  auditEvents,
  assignmentHistory,
  manualPoints,
  transfers,
  overridesCount,
  outageAnalytics,
  onOpenAnalyticsPage,
  onClose,
}) => {
  const [range, setRange] = useState<TimeRange>('7d');
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [hotspotMode, setHotspotMode] = useState<'street' | 'zone'>('street');
  const [hoveredVisitIdx, setHoveredVisitIdx] = useState<number | null>(null);
  const [hoveredEditIdx, setHoveredEditIdx] = useState<number | null>(null);

  // Merge Firestore auditEvents + assignmentHistory edits into a single deduplicated edit stream
  const allEditRecords = useMemo(() => {
    const items: Array<{
      id: string;
      ts: number;
      category: 'point' | 'collision' | 'transfer';
      actor: string;
      summary: string;
    }> = [];
    const seenFingerprints = new Set<string>();

    for (const ev of auditEvents) {
      if (ev.eventType === 'login') continue;
      const ts = Date.parse(ev.timestamp);
      if (!Number.isFinite(ts)) continue;
      const category =
        ev.eventType === 'transfer_created' || ev.eventType === 'transfer_removed'
          ? 'transfer'
          : ev.eventType === 'collision_changed' || ev.eventType === 'dual_mode_changed'
          ? 'collision'
          : 'point';
      const fp = `${category}:${Math.floor(ts / 5000)}:${ev.summary.slice(0, 24)}`;
      seenFingerprints.add(fp);
      items.push({
        id: ev.id,
        ts,
        category,
        actor: ev.actorName || 'Користувач',
        summary: ev.summary,
      });
    }

    for (const h of assignmentHistory) {
      const ts = Date.parse(h.timestamp);
      if (!Number.isFinite(ts)) continue;
      const category =
        h.action === 'collision_changed' || h.action === 'dual_mode_changed'
          ? 'collision'
          : 'point';
      const summary = `${h.title}: ${h.details}`;
      const fp = `${category}:${Math.floor(ts / 5000)}:${summary.slice(0, 24)}`;
      if (seenFingerprints.has(fp)) continue;
      seenFingerprints.add(fp);
      items.push({
        id: h.id,
        ts,
        category,
        actor: h.authorName || (h.isCloud ? 'Користувач' : 'Локально'),
        summary,
      });
    }

    for (const t of transfers) {
      if (!t.createdAt) continue;
      const ts = Date.parse(t.createdAt);
      if (!Number.isFinite(ts)) continue;
      const summary = `Перенос ${t.street} (${t.houses.join(', ')}) → ${t.targetQueue}`;
      const fp = `transfer:${Math.floor(ts / 5000)}:${summary.slice(0, 24)}`;
      if (seenFingerprints.has(fp)) continue;
      seenFingerprints.add(fp);
      items.push({
        id: t.id,
        ts,
        category: 'transfer',
        actor: 'Диспетчер',
        summary,
      });
    }

    items.sort((a, b) => b.ts - a.ts);
    return items;
  }, [auditEvents, assignmentHistory, transfers]);

  // Populate time buckets for both charts
  const buckets = useMemo(() => {
    const list = buildBuckets(range);
    if (list.length === 0) return list;
    const minMs = list[0].startMs;
    const maxMs = list[list.length - 1].endMs;

    const findBucket = (ts: number) => {
      if (ts < minMs || ts >= maxMs) return null;
      return list.find((b) => ts >= b.startMs && ts < b.endMs) || null;
    };

    for (const v of stats?.visits || []) {
      const b = findBucket(v.ts);
      if (!b) continue;
      if (v.isAuthenticated) b.loggedInVisits++;
      else b.anonVisits++;
    }

    // Also include Firestore 'login' events when server restarted and cleared /tmp
    const serverLoginTimes = new Set(
      (stats?.visits || [])
        .filter((v) => v.isAuthenticated)
        .map((v) => Math.floor(v.ts / 60_000))
    );
    for (const ev of auditEvents) {
      if (ev.eventType !== 'login') continue;
      const ts = Date.parse(ev.timestamp);
      if (!Number.isFinite(ts)) continue;
      if (serverLoginTimes.has(Math.floor(ts / 60_000))) continue;
      const b = findBucket(ts);
      if (b) b.loggedInVisits++;
    }

    for (const ed of allEditRecords) {
      const b = findBucket(ed.ts);
      if (!b) continue;
      if (ed.category === 'point') b.pointEdits++;
      else if (ed.category === 'collision') b.collisionEdits++;
      else b.transferEdits++;
    }

    return list;
  }, [range, stats, auditEvents, allEditRecords]);

  // Aggregate KPI metrics
  const kpis = useMemo(() => {
    const uniqueAnon = stats?.uniqueAnonymous || 0;
    const firestoreUniqueActors = new Set(auditEvents.map((e) => e.actorUid)).size;
    const uniqueLoggedIn = Math.max(stats?.uniqueLoggedIn || 0, firestoreUniqueActors);
    const totalAnonVisits = stats?.totalAnonymousVisits || 0;
    const totalLoggedInVisits = Math.max(
      stats?.totalLoggedInVisits || 0,
      auditEvents.filter((e) => e.eventType === 'login').length
    );
    const totalVisits = totalAnonVisits + totalLoggedInVisits;
    const anonPct = totalVisits > 0 ? Math.round((totalAnonVisits / totalVisits) * 100) : 0;
    const authPct = totalVisits > 0 ? 100 - anonPct : 0;
    const activeOnline = (stats?.activeLast15mAnon || 0) + (stats?.activeLast15mLoggedIn || 0);

    const pointCount = allEditRecords.filter((e) => e.category === 'point').length;
    const collisionCount = allEditRecords.filter((e) => e.category === 'collision').length;
    const transferCount = allEditRecords.filter((e) => e.category === 'transfer').length;
    const totalEdits = allEditRecords.length;

    return {
      uniqueAnon,
      uniqueLoggedIn,
      totalAnonVisits,
      totalLoggedInVisits,
      totalVisits,
      anonPct,
      authPct,
      activeOnline,
      activeAnon: stats?.activeLast15mAnon || 0,
      activeAuth: stats?.activeLast15mLoggedIn || 0,
      pointCount,
      collisionCount,
      transferCount,
      totalEdits,
    };
  }, [stats, auditEvents, allEditRecords]);

  // Top editors breakdown
  const topEditors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of allEditRecords) {
      counts.set(e.actor, (counts.get(e.actor) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [allEditRecords]);

  // Unified recent audit feed
  const feedItems = useMemo(() => {
    const list: UnifiedFeedItem[] = [];

    for (const v of (stats?.visits || []).slice(-60)) {
      list.push({
        id: `v_${v.ts}_${v.visitorTag}`,
        ts: v.ts,
        kind: v.isAuthenticated ? 'visit_auth' : 'visit_anon',
        badge: v.isAuthenticated ? 'Захід (авториз.)' : 'Анонімний захід',
        actor: v.isAuthenticated ? `Користувач #${v.visitorTag}` : `Гість #${v.visitorTag}`,
        text: v.isAuthenticated
          ? 'Відкриття карти авторизованим користувачем'
          : 'Перегляд карти без входу в акаунт',
      });
    }

    for (const e of allEditRecords.slice(0, 80)) {
      list.push({
        id: `e_${e.id}`,
        ts: e.ts,
        kind: 'edit',
        badge:
          e.category === 'point'
            ? 'Точка'
            : e.category === 'collision'
            ? 'Колізія'
            : 'Перенос',
        actor: e.actor,
        text: e.summary,
      });
    }

    list.sort((a, b) => b.ts - a.ts);
    return list
      .filter((item) => {
        if (feedFilter === 'visits') return item.kind !== 'edit';
        if (feedFilter === 'edits') return item.kind === 'edit';
        return true;
      })
      .slice(0, 50);
  }, [stats, allEditRecords, feedFilter]);

  const maxVisitVal = Math.max(
    1,
    ...buckets.map((b) => b.anonVisits + b.loggedInVisits)
  );
  const maxEditVal = Math.max(
    1,
    ...buckets.map((b) => b.pointEdits + b.collisionEdits + b.transferEdits)
  );

  const hoveredVisitBucket = hoveredVisitIdx !== null ? buckets[hoveredVisitIdx] : null;
  const hoveredEditBucket = hoveredEditIdx !== null ? buckets[hoveredEditIdx] : null;

  return (
    <div
      className="fixed inset-0 z-[2600] bg-slate-950/65 backdrop-blur-[2px] flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Дашборд аудиту та активності"
    >
      <div className="w-full max-w-5xl max-h-[94dvh] flex flex-col bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700/90 rounded-xl shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="shrink-0 px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#111827] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-600/15 dark:bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold leading-tight">
                Дашборд аудиту та активності
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Відвідуваність (анонімні / залогінені), графік заходів та історія правок
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Period Switcher */}
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-200/80 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded-md text-xs">
              {(
                [
                  { id: '24h', label: '24 год' },
                  { id: '7d', label: '7 днів' },
                  { id: '14d', label: '14 днів' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRange(opt.id)}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    range === opt.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onRefreshStats}
              disabled={loadingStats}
              className="p-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
              title="Оновити статистику"
              aria-label="Оновити статистику"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
              aria-label="Закрити дашборд"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {!isAdminUser && (
            <div className="px-3.5 py-2.5 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/35 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
              <Shield className="w-4 h-4 shrink-0" />
              <span>
                Повний журнал авторизацій Firestore доступний після входу під акаунтом адміністратора. Нижче показано зведену статистику сервера та спільних правок.
              </span>
            </div>
          )}

          {/* 4 KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111827]">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Анонімні</span>
                <UserX className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {kpis.uniqueAnon}
                </span>
                <span className="text-[11px] text-slate-500">унікальних</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {kpis.totalAnonVisits} заходів · {kpis.activeAnon} зараз
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111827]">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Залогінені</span>
                <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {kpis.uniqueLoggedIn}
                </span>
                <span className="text-[11px] text-slate-500">користувачів</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {kpis.totalLoggedInVisits} заходів · {kpis.activeAuth} зараз
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111827]">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Усього заходів</span>
                <Users className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {kpis.totalVisits}
                </span>
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  {kpis.activeOnline} онлайн (15 хв)
                </span>
              </div>
              {/* Ratio bar */}
              <div className="mt-2 space-y-1">
                <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden flex">
                  <div
                    className="bg-sky-500 h-full transition-all"
                    style={{ width: `${kpis.anonPct}%` }}
                  />
                  <div
                    className="bg-emerald-500 h-full transition-all"
                    style={{ width: `${kpis.authPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-slate-500 tabular-nums">
                  <span>Анон {kpis.anonPct}%</span>
                  <span>Авт {kpis.authPct}%</span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111827]">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Усього правок</span>
                <Edit3 className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {kpis.totalEdits}
                </span>
                <span className="text-[11px] text-slate-500">подій</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {manualPoints.length} точок · {overridesCount} колізій · {transfers.length} переносів
              </div>
            </div>
          </div>

          {/* 2 Interactive Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Chart 1: Visits (Anonymous vs Logged In) */}
            <section className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Графік заходів
                  </h3>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {hoveredVisitBucket ? (
                      <span>
                        <strong className="text-slate-800 dark:text-slate-200">
                          {hoveredVisitBucket.fullLabel}:
                        </strong>{' '}
                        Анонімні {hoveredVisitBucket.anonVisits} · Залогінені{' '}
                        {hoveredVisitBucket.loggedInVisits}
                      </span>
                    ) : (
                      'Наведіть або натисніть на стовпчик для деталей'
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-sky-500" />
                    Анонімні
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
                    Залогінені
                  </span>
                </div>
              </div>

              <div className="w-full h-44 flex items-end gap-1 pt-4 pb-6 px-1 relative border-t border-b border-slate-100 dark:border-slate-800/80">
                {/* Horizontal guide lines */}
                <div className="pointer-events-none absolute inset-x-0 top-4 border-t border-dashed border-slate-200/80 dark:border-slate-800 flex justify-end">
                  <span className="text-[9px] font-mono text-slate-400 -mt-3 pr-1">
                    {maxVisitVal}
                  </span>
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-slate-200/60 dark:border-slate-800/70" />

                {buckets.map((b, idx) => {
                  const total = b.anonVisits + b.loggedInVisits;
                  const totalH = total > 0 ? Math.max(6, (total / maxVisitVal) * 100) : 0;
                  const authShare = total > 0 ? (b.loggedInVisits / total) * 100 : 0;
                  const anonShare = total > 0 ? 100 - authShare : 0;
                  const isHovered = hoveredVisitIdx === idx;

                  return (
                    <button
                      key={b.key}
                      type="button"
                      onMouseEnter={() => setHoveredVisitIdx(idx)}
                      onMouseLeave={() => setHoveredVisitIdx(null)}
                      onClick={() => setHoveredVisitIdx(isHovered ? null : idx)}
                      className="flex-1 h-full flex flex-col justify-end items-center group relative focus:outline-none"
                      aria-label={`${b.fullLabel}: анонімні ${b.anonVisits}, залогінені ${b.loggedInVisits}`}
                    >
                      <div
                        className={`w-full max-w-[26px] rounded-t-sm overflow-hidden flex flex-col justify-end transition-all ${
                          isHovered ? 'ring-2 ring-sky-400/80' : ''
                        }`}
                        style={{ height: `${totalH}%` }}
                      >
                        {b.loggedInVisits > 0 && (
                          <div
                            className="w-full bg-emerald-500"
                            style={{ height: `${authShare}%` }}
                          />
                        )}
                        {b.anonVisits > 0 && (
                          <div
                            className="w-full bg-sky-500"
                            style={{ height: `${anonShare}%` }}
                          />
                        )}
                      </div>
                      {total === 0 && (
                        <div className="w-full max-w-[26px] h-[2px] bg-slate-200 dark:bg-slate-800 rounded-full" />
                      )}
                      {b.label && (
                        <span className="absolute -bottom-5 text-[9px] font-mono text-slate-400 whitespace-nowrap">
                          {b.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Chart 2: Edits (Points / Collisions / Transfers) */}
            <section className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Графік правок
                  </h3>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {hoveredEditBucket ? (
                      <span>
                        <strong className="text-slate-800 dark:text-slate-200">
                          {hoveredEditBucket.fullLabel}:
                        </strong>{' '}
                        Точки {hoveredEditBucket.pointEdits} · Колізії{' '}
                        {hoveredEditBucket.collisionEdits} · Переноси{' '}
                        {hoveredEditBucket.transferEdits}
                      </span>
                    ) : (
                      'Усі додані точки, зміни колізій та переноси фідерів'
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-sky-500" />
                    Точки
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-purple-500" />
                    Колізії
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-500" />
                    Переноси
                  </span>
                </div>
              </div>

              <div className="w-full h-44 flex items-end gap-1 pt-4 pb-6 px-1 relative border-t border-b border-slate-100 dark:border-slate-800/80">
                <div className="pointer-events-none absolute inset-x-0 top-4 border-t border-dashed border-slate-200/80 dark:border-slate-800 flex justify-end">
                  <span className="text-[9px] font-mono text-slate-400 -mt-3 pr-1">
                    {maxEditVal}
                  </span>
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-slate-200/60 dark:border-slate-800/70" />

                {buckets.map((b, idx) => {
                  const total = b.pointEdits + b.collisionEdits + b.transferEdits;
                  const totalH = total > 0 ? Math.max(6, (total / maxEditVal) * 100) : 0;
                  const pShare = total > 0 ? (b.pointEdits / total) * 100 : 0;
                  const cShare = total > 0 ? (b.collisionEdits / total) * 100 : 0;
                  const tShare = total > 0 ? (b.transferEdits / total) * 100 : 0;
                  const isHovered = hoveredEditIdx === idx;

                  return (
                    <button
                      key={b.key}
                      type="button"
                      onMouseEnter={() => setHoveredEditIdx(idx)}
                      onMouseLeave={() => setHoveredEditIdx(null)}
                      onClick={() => setHoveredEditIdx(isHovered ? null : idx)}
                      className="flex-1 h-full flex flex-col justify-end items-center group relative focus:outline-none"
                      aria-label={`${b.fullLabel}: точки ${b.pointEdits}, колізії ${b.collisionEdits}, переноси ${b.transferEdits}`}
                    >
                      <div
                        className={`w-full max-w-[26px] rounded-t-sm overflow-hidden flex flex-col justify-end transition-all ${
                          isHovered ? 'ring-2 ring-amber-400/80' : ''
                        }`}
                        style={{ height: `${totalH}%` }}
                      >
                        {b.transferEdits > 0 && (
                          <div className="w-full bg-amber-500" style={{ height: `${tShare}%` }} />
                        )}
                        {b.collisionEdits > 0 && (
                          <div className="w-full bg-purple-500" style={{ height: `${cShare}%` }} />
                        )}
                        {b.pointEdits > 0 && (
                          <div className="w-full bg-sky-500" style={{ height: `${pShare}%` }} />
                        )}
                      </div>
                      {total === 0 && (
                        <div className="w-full max-w-[26px] h-[2px] bg-slate-200 dark:bg-slate-800 rounded-full" />
                      )}
                      {b.label && (
                        <span className="absolute -bottom-5 text-[9px] font-mono text-slate-400 whitespace-nowrap">
                          {b.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Hotspots ("Гарячі точки") & Unlucky Queues ("Графік невезучих черг") */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Block 1: Гарячі точки */}
            <section className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>Гарячі точки</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Вулиці та райони з найчастішими відключеннями й переносами
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setHotspotMode('street')}
                    className={`px-2 py-0.5 rounded border transition-colors ${
                      hotspotMode === 'street'
                        ? 'bg-sky-600 border-sky-500 text-white font-medium'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Вулиці
                  </button>
                  <button
                    type="button"
                    onClick={() => setHotspotMode('zone')}
                    className={`px-2 py-0.5 rounded border transition-colors ${
                      hotspotMode === 'zone'
                        ? 'bg-sky-600 border-sky-500 text-white font-medium'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Райони
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                {(hotspotMode === 'street'
                  ? outageAnalytics.streetHotspots
                  : outageAnalytics.zoneHotspots
                )
                  .slice(0, 7)
                  .map((spot, idx) => (
                    <div
                      key={spot.id}
                      className="py-2 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            {idx + 1}.
                          </span>
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {spot.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                          {spot.sublabel}
                          {spot.queues.length > 0 &&
                            ` · черги ${spot.queues.slice(0, 3).map(formatSubqueue).join(', ')}`}
                          {spot.totalIncidents > 0 && ` · подій: ${spot.totalIncidents}`}
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div className="text-xs font-semibold text-red-600 dark:text-red-400">
                          {spot.avgOffHoursPeriod} год
                        </div>
                        <div className="text-[10px] text-slate-400">
                          ~{spot.avgOffHoursPerDay} год/д
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </section>

            {/* Block 2: Графік невезучих черг */}
            <section className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col justify-between space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                    <span>Графік невезучих черг</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Рейтинг черг за годинами без світла ({outageAnalytics.trackedDaysCount} дн. архіву)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAnalyticsPage('7d');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium transition-colors whitespace-nowrap"
                >
                  <span>Тиждень / Місяць</span>
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>

              {(() => {
                const maxQ = Math.max(
                  1,
                  ...outageAnalytics.unluckyQueues.map((r) => r.totalOffHours)
                );
                return (
                  <div className="space-y-1.5">
                    {outageAnalytics.unluckyQueues.map((row) => {
                      const pct =
                        row.totalOffHours > 0
                          ? Math.max(4, (row.totalOffHours / maxQ) * 100)
                          : 0;
                      const barCls =
                        row.rank <= 3
                          ? 'bg-red-600 dark:bg-red-500'
                          : row.rank <= 8
                          ? 'bg-amber-500'
                          : 'bg-emerald-600 dark:bg-emerald-500';
                      return (
                        <div
                          key={row.queue}
                          className="flex items-center gap-2 text-[11px] font-mono tabular-nums"
                        >
                          <span className="w-9 font-semibold text-slate-800 dark:text-slate-200 shrink-0">
                            {formatSubqueue(row.queue)}
                          </span>
                          <div className="flex-1 h-2.5 rounded-xs bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full ${barCls}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-16 text-right text-slate-700 dark:text-slate-300 shrink-0">
                            {row.totalOffHours} год
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </section>
          </div>

          {/* Bottom Split: Breakdown + Recent Audit Feed */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Breakdown + Active Editors */}
            <div className="space-y-4">
              <section className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-2.5 text-xs">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                  Розподіл правок
                </h3>
                {[
                  { label: 'Вказані точки', val: kpis.pointCount, color: 'bg-sky-500' },
                  { label: 'Зміни колізій', val: kpis.collisionCount, color: 'bg-purple-500' },
                  { label: 'Переноси фідерів', val: kpis.transferCount, color: 'bg-amber-500' },
                ].map((row) => {
                  const pct =
                    kpis.totalEdits > 0 ? Math.round((row.val / kpis.totalEdits) * 100) : 0;
                  return (
                    <div key={row.label} className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-600 dark:text-slate-300">{row.label}</span>
                        <span className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                          {row.val} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full ${row.color}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </section>

              <section className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-2 text-xs">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                  Найактивніші редактори
                </h3>
                {topEditors.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Правок ще не зафіксовано.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {topEditors.map(([name, count]) => (
                      <div
                        key={name}
                        className="py-1.5 flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="truncate text-slate-800 dark:text-slate-200">{name}</span>
                        <span className="font-mono font-semibold text-sky-600 dark:text-sky-400 tabular-nums shrink-0">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Live Filterable Audit Event Stream */}
            <section className="lg:col-span-2 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  <span>Останні події аудиту</span>
                </h3>
                <div className="flex items-center gap-1 text-[11px]">
                  {(
                    [
                      { id: 'all', label: 'Усі' },
                      { id: 'visits', label: 'Заходи' },
                      { id: 'edits', label: 'Правки' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFeedFilter(f.id)}
                      className={`px-2 py-0.5 rounded border transition-colors ${
                        feedFilter === f.id
                          ? 'bg-sky-600 border-sky-500 text-white font-medium'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 pr-1 text-xs">
                {feedItems.length === 0 ? (
                  <div className="py-8 text-center text-slate-500">Подій поки немає.</div>
                ) : (
                  feedItems.map((item) => (
                    <div key={item.id} className="py-2 flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              item.kind === 'edit'
                                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                : item.kind === 'visit_auth'
                                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                : 'bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300'
                            }`}
                          >
                            {item.badge}
                          </span>
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {item.actor}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug break-words">
                          {item.text}
                        </div>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0 tabular-nums">
                        {new Date(item.ts).toLocaleString('uk-UA', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
