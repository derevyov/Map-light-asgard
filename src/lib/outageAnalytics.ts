import {
  ArchivedDaySnapshot,
  ArchivedStreetIncident,
  AssignmentHistoryEntry,
  BuildingOverride,
  BuildingRecord,
  FeederRow,
  FeederTransfer,
  OutageAnalyticsPayload,
  OutageNotice,
  ScheduleByDate,
  SlotState,
  SUBQUEUES,
  SubqueueId,
} from './types';
import { normalizeStreet } from './parser';

export type AnalyticsWindow = '7d' | '30d';

export interface QueueUnluckyRow {
  queue: SubqueueId;
  rank: number;
  totalOffHours: number;
  pureOffHours: number;
  switchOffHours: number;
  avgHoursPerDay: number;
  maxDayHours: number;
  daysWithData: number;
  deltaFromMeanHours: number;
}

export interface DailyQueuePoint {
  date: string;
  shortLabel: string;
  fullLabel: string;
  hasData: boolean;
  cityAvgHours: number;
  maxQueueHours: number;
  minQueueHours: number;
  byQueue: Record<SubqueueId, number>;
}

export interface HotspotItem {
  id: string;
  name: string;
  kind: 'street' | 'zone';
  sublabel: string;
  queues: SubqueueId[];
  buildingsCount: number;
  avgOffHoursPeriod: number;
  avgOffHoursPerDay: number;
  operCount: number;
  emergencyCount: number;
  plannedCount: number;
  transferCount: number;
  editCount: number;
  totalIncidents: number;
  score: number;
  sampleBuildingId?: string;
}

export interface ComputedOutageAnalytics {
  window: AnalyticsWindow;
  windowDays: number;
  trackedDaysCount: number;
  unluckyQueues: QueueUnluckyRow[];
  dailySeries: DailyQueuePoint[];
  cityAvgTotalHours: number;
  cityAvgPerDay: number;
  mostUnlucky: QueueUnluckyRow | null;
  mostStable: QueueUnluckyRow | null;
  streetHotspots: HotspotItem[];
  zoneHotspots: HotspotItem[];
  totalIncidentsInWindow: number;
}

const LS_ANALYTICS_ARCHIVE = 'dpem_analytics_archive_30d_v1';
const MAX_ARCHIVE_DAYS = 35;
const MAX_ARCHIVE_INCIDENTS = 400;

export function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function snapshotFromSchedule(
  scheduleByDate: ScheduleByDate,
  source: 'live' | 'fallback' | 'local-html' = 'live'
): ArchivedDaySnapshot[] {
  const out: ArchivedDaySnapshot[] = [];
  const nowIso = new Date().toISOString();

  for (const [date, day] of Object.entries(scheduleByDate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day?.queues) continue;
    const queueOffHours: Partial<Record<SubqueueId, number>> = {};
    const queueSwitchOffHours: Partial<Record<SubqueueId, number>> = {};
    const queueSwitchOnHours: Partial<Record<SubqueueId, number>> = {};
    const queuePossibleHours: Partial<Record<SubqueueId, number>> = {};

    for (const q of SUBQUEUES) {
      const slots: SlotState[] | undefined = day.queues[q];
      if (!Array.isArray(slots) || slots.length === 0) continue;
      let off = 0;
      let swOff = 0;
      let swOn = 0;
      let poss = 0;
      for (let i = 0; i < Math.min(48, slots.length); i++) {
        const s = slots[i];
        if (s === 'off') off += 0.5;
        else if (s === 'switch_off') swOff += 0.5;
        else if (s === 'switch_on') swOn += 0.5;
        else if (s === 'possible') poss += 0.5;
      }
      queueOffHours[q] = off;
      queueSwitchOffHours[q] = swOff;
      queueSwitchOnHours[q] = swOn;
      queuePossibleHours[q] = poss;
    }

    out.push({
      date,
      queueOffHours,
      queueSwitchOffHours,
      queueSwitchOnHours,
      queuePossibleHours,
      source,
      updatedAt: day.savedAt || nowIso,
    });
  }

  return out;
}

export function loadLocalAnalyticsArchive(): OutageAnalyticsPayload {
  try {
    const raw = localStorage.getItem(LS_ANALYTICS_ARCHIVE);
    if (!raw) {
      return { updatedAt: new Date().toISOString(), days: [], streetIncidents: [] };
    }
    const parsed = JSON.parse(raw) as Partial<OutageAnalyticsPayload>;
    return {
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      days: Array.isArray(parsed.days) ? parsed.days : [],
      streetIncidents: Array.isArray(parsed.streetIncidents) ? parsed.streetIncidents : [],
    };
  } catch {
    return { updatedAt: new Date().toISOString(), days: [], streetIncidents: [] };
  }
}

export function mergeAnalyticsArchives(
  ...sources: Array<Partial<OutageAnalyticsPayload> | null | undefined>
): OutageAnalyticsPayload {
  const daysMap = new Map<string, ArchivedDaySnapshot>();
  const incMap = new Map<string, ArchivedStreetIncident>();

  for (const src of sources) {
    if (!src) continue;
    for (const d of src.days || []) {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
      const existing = daysMap.get(d.date);
      // Prefer live data over fallback, or newer updatedAt
      if (
        !existing ||
        (existing.source === 'fallback' && d.source !== 'fallback') ||
        (existing.source === d.source && d.updatedAt >= existing.updatedAt)
      ) {
        daysMap.set(d.date, d);
      }
    }
    for (const inc of src.streetIncidents || []) {
      if (!inc || !inc.id || !inc.street) continue;
      incMap.set(inc.id, inc);
    }
  }

  const sortedDays = [...daysMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_ARCHIVE_DAYS);

  const cutoffDate =
    sortedDays.length > 0
      ? sortedDays[0].date
      : toIsoDateLocal(new Date(Date.now() - MAX_ARCHIVE_DAYS * 86_400_000));

  const filteredIncidents = [...incMap.values()]
    .filter((i) => i.date >= cutoffDate)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ARCHIVE_INCIDENTS);

  return {
    updatedAt: new Date().toISOString(),
    days: sortedDays,
    streetIncidents: filteredIncidents,
  };
}

export function saveLocalAnalyticsArchive(archive: OutageAnalyticsPayload): void {
  try {
    localStorage.setItem(LS_ANALYTICS_ARCHIVE, JSON.stringify(archive));
  } catch {
    // ignore quota errors
  }
}

function getWindowDates(windowDays: number, anchorDateIso?: string): string[] {
  const anchor = anchorDateIso
    ? new Date(`${anchorDateIso}T12:00:00`)
    : new Date();
  const base = Number.isFinite(anchor.getTime()) ? anchor : new Date();
  const dates: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86_400_000);
    dates.push(toIsoDateLocal(d));
  }
  return dates;
}

function formatShortDateUk(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}`;
}

function formatFullDateUk(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('uk-UA', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
  });
}

function extractStreetsFromText(
  text: string,
  knownStreets: Array<{ norm: string; display: string }>
): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const ks of knownStreets) {
    if (ks.norm.length >= 4 && lower.includes(ks.norm)) {
      matched.push(ks.display);
    }
  }

  if (matched.length > 0) return [...new Set(matched)];

  // Fallback regex for street names like "вул. Енергобудівників", "пр. Незалежності", "бул. Курчатова"
  const re =
    /(?:вул\.?|просп\.?|пр-т\.?|пр\.?|бул\.?|б-р\.?|пров\.?|площа|пл\.?|мкрн\.?|кв\.?)\s*([А-ЯІЇЄҐа-яіїєґ'’\-]{3,28}(?:\s+[А-ЯІЇЄҐа-яіїєґ'’\-]{3,24})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const clean = m[0].replace(/[.,;:\s]+$/, '').trim();
    if (clean.length >= 5) matched.push(clean);
  }
  return [...new Set(matched)];
}

export function computeOutageAnalytics(params: {
  window: AnalyticsWindow;
  includeSwitches: boolean;
  archive: OutageAnalyticsPayload;
  scheduleByDate: ScheduleByDate;
  feederRows: FeederRow[];
  buildings: BuildingRecord[];
  operOutages: OutageNotice[];
  emergencyOutages: OutageNotice[];
  plannedOutages: OutageNotice[];
  transfers: FeederTransfer[];
  overrides: Record<string, BuildingOverride>;
  assignmentHistory: AssignmentHistoryEntry[];
}): ComputedOutageAnalytics {
  const {
    window,
    includeSwitches,
    archive,
    scheduleByDate,
    feederRows,
    buildings,
    operOutages,
    emergencyOutages,
    plannedOutages,
    transfers,
    overrides,
    assignmentHistory,
  } = params;

  const windowDays = window === '7d' ? 7 : 30;
  const liveSnapshots = snapshotFromSchedule(scheduleByDate, 'live');
  const merged = mergeAnalyticsArchives(archive, {
    updatedAt: new Date().toISOString(),
    days: liveSnapshots,
    streetIncidents: [],
  });

  const daysByDate = new Map<string, ArchivedDaySnapshot>();
  for (const d of merged.days) {
    daysByDate.set(d.date, d);
  }

  const todayIso = toIsoDateLocal(new Date());
  // Anchor window to today (or latest date if tomorrow is already published, still include today + past)
  const windowDates = getWindowDates(windowDays, todayIso);
  // Also include tomorrow if published and inside scheduleByDate? Keep clean calendar window ending today,
  // or if no today yet but archived dates exist (e.g. seed date), anchor to latest archived date!
  const hasAnyInTodayWindow = windowDates.some((dt) => daysByDate.has(dt));
  const effectiveDates =
    hasAnyInTodayWindow || merged.days.length === 0
      ? windowDates
      : getWindowDates(windowDays, merged.days[merged.days.length - 1].date);

  const effectiveDateSet = new Set(effectiveDates);

  // 1. Build daily series + per-queue totals
  const pureOffTotals: Record<SubqueueId, number> = {} as Record<SubqueueId, number>;
  const switchOffTotals: Record<SubqueueId, number> = {} as Record<SubqueueId, number>;
  const maxDayByQueue: Record<SubqueueId, number> = {} as Record<SubqueueId, number>;
  const daysWithDataByQueue: Record<SubqueueId, number> = {} as Record<SubqueueId, number>;

  for (const q of SUBQUEUES) {
    pureOffTotals[q] = 0;
    switchOffTotals[q] = 0;
    maxDayByQueue[q] = 0;
    daysWithDataByQueue[q] = 0;
  }

  let trackedDaysCount = 0;
  const dailySeries: DailyQueuePoint[] = effectiveDates.map((date) => {
    const snap = daysByDate.get(date);
    const byQueue = {} as Record<SubqueueId, number>;

    if (!snap) {
      for (const q of SUBQUEUES) byQueue[q] = 0;
      return {
        date,
        shortLabel: formatShortDateUk(date),
        fullLabel: formatFullDateUk(date),
        hasData: false,
        cityAvgHours: 0,
        maxQueueHours: 0,
        minQueueHours: 0,
        byQueue,
      };
    }

    trackedDaysCount += 1;
    let sum = 0;
    let maxH = -Infinity;
    let minH = Infinity;

    for (const q of SUBQUEUES) {
      const pure = snap.queueOffHours[q] ?? 0;
      const swOff = snap.queueSwitchOffHours[q] ?? 0;
      const total = includeSwitches ? pure + swOff : pure;
      byQueue[q] = Number(total.toFixed(1));
      pureOffTotals[q] += pure;
      switchOffTotals[q] += swOff;
      if (total > maxDayByQueue[q]) maxDayByQueue[q] = total;
      daysWithDataByQueue[q] += 1;
      sum += total;
      if (total > maxH) maxH = total;
      if (total < minH) minH = total;
    }

    return {
      date,
      shortLabel: formatShortDateUk(date),
      fullLabel: formatFullDateUk(date),
      hasData: true,
      cityAvgHours: Number((sum / SUBQUEUES.length).toFixed(1)),
      maxQueueHours: Number((Number.isFinite(maxH) ? maxH : 0).toFixed(1)),
      minQueueHours: Number((Number.isFinite(minH) ? minH : 0).toFixed(1)),
      byQueue,
    };
  });

  const rawQueueRows = SUBQUEUES.map((q) => {
    const pure = Number(pureOffTotals[q].toFixed(1));
    const swOff = Number(switchOffTotals[q].toFixed(1));
    const total = Number((includeSwitches ? pure + swOff : pure).toFixed(1));
    const daysCnt = daysWithDataByQueue[q];
    return {
      queue: q,
      totalOffHours: total,
      pureOffHours: pure,
      switchOffHours: swOff,
      avgHoursPerDay: daysCnt > 0 ? Number((total / daysCnt).toFixed(1)) : 0,
      maxDayHours: Number(maxDayByQueue[q].toFixed(1)),
      daysWithData: daysCnt,
    };
  });

  const cityAvgTotalHours =
    rawQueueRows.length > 0
      ? Number(
          (
            rawQueueRows.reduce((acc, r) => acc + r.totalOffHours, 0) / rawQueueRows.length
          ).toFixed(1)
        )
      : 0;
  const cityAvgPerDay =
    trackedDaysCount > 0 ? Number((cityAvgTotalHours / trackedDaysCount).toFixed(1)) : 0;

  const unluckyQueues: QueueUnluckyRow[] = [...rawQueueRows]
    .sort((a, b) => b.totalOffHours - a.totalOffHours || a.queue.localeCompare(b.queue))
    .map((r, idx) => ({
      ...r,
      rank: idx + 1,
      deltaFromMeanHours: Number((r.totalOffHours - cityAvgTotalHours).toFixed(1)),
    }));

  const queueTotalMap = new Map<SubqueueId, number>();
  for (const r of unluckyQueues) {
    queueTotalMap.set(r.queue, r.totalOffHours);
  }

  // 2. Build Street Hotspots & Substation/Zone Hotspots
  interface StreetAcc {
    display: string;
    queues: Set<SubqueueId>;
    buildingsCount: number;
    sampleBuildingId?: string;
    operCount: number;
    emergencyCount: number;
    plannedCount: number;
    transferCount: number;
    editCount: number;
  }

  const streetMap = new Map<string, StreetAcc>();
  const ensureStreet = (rawName: string): StreetAcc => {
    const clean = rawName.trim();
    const norm = normalizeStreet(clean) || clean.toLowerCase();
    let acc = streetMap.get(norm);
    if (!acc) {
      acc = {
        display: clean,
        queues: new Set<SubqueueId>(),
        buildingsCount: 0,
        operCount: 0,
        emergencyCount: 0,
        plannedCount: 0,
        transferCount: 0,
        editCount: 0,
      };
      streetMap.set(norm, acc);
    } else if (clean.length > acc.display.length && /[А-ЯІЇЄҐ]/.test(clean[0] || '')) {
      acc.display = clean;
    }
    return acc;
  };

  // Seed streets from buildings on the map
  for (const b of buildings) {
    if (!b.street) continue;
    const acc = ensureStreet(b.street);
    acc.buildingsCount += 1;
    if (!acc.sampleBuildingId) acc.sampleBuildingId = b.id;
    const ov = overrides[b.key];
    const q = ov?.primary || b.manualQueue || b.currentVisual?.info?.primary;
    if (q) acc.queues.add(q);
    const q2 = ov?.secondary || b.currentVisual?.info?.secondary;
    if (q2) acc.queues.add(q2);
  }

  // Also index substation / feeder zones from feederRows
  interface ZoneAcc {
    name: string;
    substation: string;
    queues: Set<SubqueueId>;
    buildingsCount: number;
    operCount: number;
    emergencyCount: number;
    plannedCount: number;
    transferCount: number;
  }

  const zoneMap = new Map<string, ZoneAcc>();
  const knownStreetTokens: Array<{ norm: string; display: string }> = [];
  for (const [norm, acc] of streetMap.entries()) {
    if (norm.length >= 4) knownStreetTokens.push({ norm, display: acc.display });
  }

  for (const row of feederRows) {
    const zoneKey = `${row.substation} · ${row.feeder}`.trim();
    let z = zoneMap.get(zoneKey);
    if (!z) {
      z = {
        name: zoneKey,
        substation: row.substation || 'Підстанція ДПЕМ',
        queues: new Set<SubqueueId>(),
        buildingsCount: 0,
        operCount: 0,
        emergencyCount: 0,
        plannedCount: 0,
        transferCount: 0,
      };
      zoneMap.set(zoneKey, z);
    }
    z.queues.add(row.queue);

    // Link feeder row streets to streetMap
    const matchedStreets = extractStreetsFromText(row.consumersText, knownStreetTokens);
    for (const st of matchedStreets) {
      const acc = ensureStreet(st);
      acc.queues.add(row.queue);
      z.buildingsCount += Math.max(1, Math.round(acc.buildingsCount / Math.max(1, acc.queues.size)));
    }
  }

  // Count live oper / emergency / planned notices + archived incidents within window
  const seenIncidentFingerprints = new Set<string>();
  const addStreetIncident = (
    street: string,
    kind: 'oper' | 'emergency' | 'planned' | 'transfer',
    fp: string
  ) => {
    const norm = normalizeStreet(street) || street.toLowerCase();
    const key = `${norm}:${kind}:${fp}`;
    if (seenIncidentFingerprints.has(key)) return;
    seenIncidentFingerprints.add(key);

    const acc = ensureStreet(street);
    if (kind === 'oper') acc.operCount += 1;
    else if (kind === 'emergency') acc.emergencyCount += 1;
    else if (kind === 'planned') acc.plannedCount += 1;
    else acc.transferCount += 1;
  };

  for (const inc of merged.streetIncidents) {
    if (!effectiveDateSet.has(inc.date)) continue;
    addStreetIncident(inc.street, inc.kind, inc.id);
  }

  const allLiveNotices: OutageNotice[] = [
    ...operOutages,
    ...emergencyOutages,
    ...plannedOutages,
  ];
  for (const notice of allLiveNotices) {
    const fullText = `${notice.substation || ''} ${notice.feeder || ''} ${notice.description}`;
    const streets = extractStreetsFromText(fullText, knownStreetTokens);
    const fp = `${todayIso}:${notice.description.slice(0, 40)}`;
    for (const st of streets) {
      addStreetIncident(st, notice.type, fp);
    }

    // Also attribute to matching feeder zone
    if (notice.feeder || notice.substation) {
      for (const z of zoneMap.values()) {
        const matchFeeder =
          notice.feeder && z.name.toLowerCase().includes(notice.feeder.toLowerCase());
        const matchSub =
          notice.substation && z.substation.toLowerCase().includes(notice.substation.toLowerCase());
        if (matchFeeder || matchSub) {
          if (notice.type === 'oper') z.operCount += 1;
          else if (notice.type === 'emergency') z.emergencyCount += 1;
          else z.plannedCount += 1;
        }
      }
    }
  }

  // Include active & historical feeder transfers
  for (const t of transfers) {
    const dateStr = t.createdAt ? t.createdAt.slice(0, 10) : todayIso;
    if (t.createdAt && !effectiveDateSet.has(dateStr) && window === '7d') {
      // Keep active transfers visible even if created earlier, counted once
    }
    if (t.street) {
      addStreetIncident(t.street, 'transfer', t.id);
      const acc = ensureStreet(t.street);
      acc.queues.add(t.targetQueue);
    }
    if (t.targetFeeder) {
      for (const z of zoneMap.values()) {
        if (z.name.toLowerCase().includes(t.targetFeeder.toLowerCase())) {
          z.transferCount += 1;
        }
      }
    }
  }

  // Include collision / manual reassignments from assignmentHistory within window
  const cutoffMs = Date.now() - windowDays * 86_400_000;
  for (const h of assignmentHistory) {
    const ts = Date.parse(h.timestamp);
    if (Number.isFinite(ts) && ts < cutoffMs) continue;
    const streets = extractStreetsFromText(`${h.title} ${h.details}`, knownStreetTokens);
    for (const st of streets) {
      const acc = ensureStreet(st);
      acc.editCount += 1;
    }
  }

  const streetHotspots: HotspotItem[] = [...streetMap.entries()]
    .map(([norm, acc]) => {
      const queues = [...acc.queues].sort();
      const avgOffHoursPeriod =
        queues.length > 0
          ? Number(
              (
                queues.reduce((sum, q) => sum + (queueTotalMap.get(q) || 0), 0) / queues.length
              ).toFixed(1)
            )
          : 0;
      const avgOffHoursPerDay =
        trackedDaysCount > 0 ? Number((avgOffHoursPeriod / trackedDaysCount).toFixed(1)) : 0;
      const totalIncidents =
        acc.emergencyCount + acc.operCount + acc.plannedCount + acc.transferCount;
      // Rank primarily by real incidents (emergency/oper/planned/transfers) + scheduled outage hours
      const score =
        acc.emergencyCount * 30 +
        acc.operCount * 22 +
        acc.transferCount * 18 +
        acc.plannedCount * 12 +
        avgOffHoursPeriod * 2 +
        Math.min(acc.buildingsCount, 30) * 0.15;

      return {
        id: `street:${norm}`,
        name: acc.display,
        kind: 'street' as const,
        sublabel: `${acc.buildingsCount} буд.`,
        queues,
        buildingsCount: acc.buildingsCount,
        avgOffHoursPeriod,
        avgOffHoursPerDay,
        operCount: acc.operCount,
        emergencyCount: acc.emergencyCount,
        plannedCount: acc.plannedCount,
        transferCount: acc.transferCount,
        editCount: acc.editCount,
        totalIncidents,
        score,
        sampleBuildingId: acc.sampleBuildingId,
      };
    })
    .filter((item) => item.buildingsCount > 0 || item.totalIncidents > 0)
    .sort(
      (a, b) =>
        b.totalIncidents - a.totalIncidents ||
        b.avgOffHoursPeriod - a.avgOffHoursPeriod ||
        b.buildingsCount - a.buildingsCount
    );

  const zoneHotspots: HotspotItem[] = [...zoneMap.values()]
    .map((z) => {
      const queues = [...z.queues].sort();
      const avgOffHoursPeriod =
        queues.length > 0
          ? Number(
              (
                queues.reduce((sum, q) => sum + (queueTotalMap.get(q) || 0), 0) / queues.length
              ).toFixed(1)
            )
          : 0;
      const avgOffHoursPerDay =
        trackedDaysCount > 0 ? Number((avgOffHoursPeriod / trackedDaysCount).toFixed(1)) : 0;
      const totalIncidents = z.emergencyCount + z.operCount + z.plannedCount + z.transferCount;
      const score =
        z.emergencyCount * 30 +
        z.operCount * 22 +
        z.transferCount * 18 +
        z.plannedCount * 12 +
        avgOffHoursPeriod * 2;

      return {
        id: `zone:${z.name}`,
        name: z.name,
        kind: 'zone' as const,
        sublabel: z.substation,
        queues,
        buildingsCount: z.buildingsCount,
        avgOffHoursPeriod,
        avgOffHoursPerDay,
        operCount: z.operCount,
        emergencyCount: z.emergencyCount,
        plannedCount: z.plannedCount,
        transferCount: z.transferCount,
        editCount: 0,
        totalIncidents,
        score,
      };
    })
    .sort(
      (a, b) =>
        b.totalIncidents - a.totalIncidents ||
        b.avgOffHoursPeriod - a.avgOffHoursPeriod ||
        a.name.localeCompare(b.name)
    );

  const totalIncidentsInWindow = streetHotspots.reduce((sum, s) => sum + s.totalIncidents, 0);

  return {
    window,
    windowDays,
    trackedDaysCount,
    unluckyQueues,
    dailySeries,
    cityAvgTotalHours,
    cityAvgPerDay,
    mostUnlucky: unluckyQueues[0] || null,
    mostStable: unluckyQueues.length > 0 ? unluckyQueues[unluckyQueues.length - 1] : null,
    streetHotspots,
    zoneHotspots,
    totalIncidentsInWindow,
  };
}
