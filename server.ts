import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getFallbackSeedPayload,
  parseDpemGrafHtml,
  parseOperOrPlannedHtml,
} from './src/lib/parser.ts';
import { initTelegramBot } from './src/lib/telegramBot.ts';
import type {
  ArchivedDaySnapshot,
  ArchivedStreetIncident,
  DpemApiPayload,
  OutageAnalyticsPayload,
  SubqueueId,
} from './src/lib/types.ts';
import { SUBQUEUES } from './src/lib/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DPEM_CACHE_TTL_MS = 300_000; // 5 min server cache (ideal for free hosting & <=50 users)
const OSM_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const AUDIT_STORE_PATH = '/tmp/dpem_audit_visits_v1.json';
const ANALYTICS_STORE_PATH = '/tmp/dpem_analytics_30d_v1.json';
const AUDIT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const ANALYTICS_MAX_DAYS = 35;
const ANALYTICS_MAX_INCIDENTS = 400;
const AUDIT_DEDUP_MS = 10 * 60 * 1000; // 10 min dedup per visitor/auth state
const AUDIT_MAX_EVENTS = 5000;

// Strictly allowlisted upstream URLs — never accept user-supplied URLs on the server.
const DPEM_ENDPOINTS = {
  graf: 'https://info.dpem.mk.ua/off_graf.html',
  oper: 'https://info.dpem.mk.ua/off_o.html',
  emergency: 'https://info.dpem.mk.ua/off_a.html',
  planned: 'https://info.dpem.mk.ua/off_p.html',
} as const;

// 4 compact tiles covering Pivdennoukrainsk for official OSM API v0.6 (fast & under 50k node limit)
const OSM_V06_TILES: ReadonlyArray<readonly [number, number, number, number]> = [
  [31.148, 47.81, 31.17, 47.825],
  [31.17, 47.81, 31.196, 47.825],
  [31.148, 47.825, 31.17, 47.842],
  [31.17, 47.825, 31.196, 47.842],
];

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
] as const;

const OVERPASS_QUERY = `[out:json][timeout:25];
(
  way["building"]["addr:housenumber"](47.805,31.135,47.845,31.205);
  way["power"="substation"](47.805,31.135,47.845,31.205);
);
out geom;`;

let dpemCache: { expiresAt: number; payload: DpemApiPayload } | null = null;
let osmCache: { expiresAt: number; data: unknown } | null = null;

function loadBundledOsmSnapshot(): unknown | null {
  try {
    const snapPath = path.resolve(__dirname, 'data', 'osm_buildings_snapshot.json');
    if (!fs.existsSync(snapPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    if (parsed && Array.isArray(parsed.elements) && parsed.elements.length > 0) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

async function fetchTextSafe(url: string, timeoutMs = 9000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Pivdennoukrainsk-DPEM-Outage-Map/1.0',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchDpemPayload(forceRefresh = false): Promise<DpemApiPayload> {
  if (!forceRefresh && dpemCache && Date.now() < dpemCache.expiresAt) {
    return dpemCache.payload;
  }

  const [grafHtml, operHtml, emergencyHtml, plannedHtml] = await Promise.all([
    fetchTextSafe(DPEM_ENDPOINTS.graf),
    fetchTextSafe(DPEM_ENDPOINTS.oper),
    fetchTextSafe(DPEM_ENDPOINTS.emergency),
    fetchTextSafe(DPEM_ENDPOINTS.planned),
  ]);

  const operParsed = operHtml
    ? parseOperOrPlannedHtml(operHtml, 'oper')
    : { updatedAt: null, notices: [], autoTransfers: [] };
  const emergencyParsed = emergencyHtml
    ? parseOperOrPlannedHtml(emergencyHtml, 'emergency')
    : { updatedAt: null, notices: [], autoTransfers: [] };
  const plannedParsed = plannedHtml
    ? parseOperOrPlannedHtml(plannedHtml, 'planned')
    : { updatedAt: null, notices: [], autoTransfers: [] };

  let payload: DpemApiPayload;

  if (grafHtml) {
    try {
      const parsed = parseDpemGrafHtml(grafHtml);
      const fallback = getFallbackSeedPayload();
      payload = {
        fetchedAt: new Date().toISOString(),
        source: 'live',
        operUpdatedAt: operParsed.updatedAt,
        emergencyUpdatedAt: emergencyParsed.updatedAt,
        plannedUpdatedAt: plannedParsed.updatedAt,
        scheduleByDate:
          Object.keys(parsed.scheduleByDate).length > 0
            ? parsed.scheduleByDate
            : fallback.scheduleByDate,
        feederRows: parsed.feederRows.length > 0 ? parsed.feederRows : fallback.feederRows,
        operOutages: operParsed.notices,
        emergencyOutages: emergencyParsed.notices,
        plannedOutages: plannedParsed.notices,
        autoTransfers: emergencyParsed.autoTransfers,
      };
    } catch {
      const fallback = getFallbackSeedPayload();
      payload = {
        fetchedAt: new Date().toISOString(),
        source: 'fallback',
        warning: 'Сервер ДПЕМ повернув нестандартний формат — використано базовий довідник.',
        operUpdatedAt: operParsed.updatedAt,
        emergencyUpdatedAt: emergencyParsed.updatedAt,
        plannedUpdatedAt: plannedParsed.updatedAt,
        scheduleByDate: fallback.scheduleByDate,
        feederRows: fallback.feederRows,
        operOutages: operParsed.notices,
        emergencyOutages: emergencyParsed.notices,
        plannedOutages: plannedParsed.notices,
        autoTransfers: emergencyParsed.autoTransfers,
      };
    }
  } else {
    const fallback = getFallbackSeedPayload();
    payload = {
      fetchedAt: new Date().toISOString(),
      source: 'fallback',
      warning: 'info.dpem.mk.ua тимчасово недоступний — активний базовий довідник ДПЕМ (можна завантажити локальний off_graf.html).',
      operUpdatedAt: null,
      emergencyUpdatedAt: null,
      plannedUpdatedAt: null,
      scheduleByDate: fallback.scheduleByDate,
      feederRows: fallback.feederRows,
      operOutages: [],
      emergencyOutages: [],
      plannedOutages: [],
      autoTransfers: [],
    };
  }

  dpemCache = {
    expiresAt: Date.now() + DPEM_CACHE_TTL_MS,
    payload,
  };
  recordDpemPayloadToAnalytics(payload);
  return payload;
}

interface CompactOsmWay {
  type: 'way';
  id: number;
  tags: Record<string, string>;
  geometry: Array<{ lat: number; lon: number }>;
}

async function fetchOsmViaOfficialV06(): Promise<{ elements: CompactOsmWay[] } | null> {
  const waysById = new Map<number, CompactOsmWay>();

  const tileResponses = await Promise.all(
    OSM_V06_TILES.map(async ([w, s, e, n]) => {
      try {
        const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${w},${s},${e},${n}`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(12000),
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Pivdennoukrainsk-DPEM-Outage-Map/1.0',
          },
        });
        if (!res.ok) return null;
        return (await res.json()) as {
          elements?: Array<{
            type: string;
            id: number;
            lat?: number;
            lon?: number;
            nodes?: number[];
            tags?: Record<string, string>;
          }>;
        };
      } catch {
        return null;
      }
    })
  );

  for (const data of tileResponses) {
    if (!data?.elements) continue;
    const nodes = new Map<number, { lat: number; lon: number }>();
    for (const el of data.elements) {
      if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
        nodes.set(el.id, {
          lat: Number(el.lat.toFixed(6)),
          lon: Number(el.lon.toFixed(6)),
        });
      }
    }
    for (const el of data.elements) {
      if (el.type !== 'way' || !el.tags || !Array.isArray(el.nodes)) continue;
      const isAddrBldg = Boolean(
        el.tags.building && (el.tags['addr:housenumber'] || el.tags['addr:street'])
      );
      const isSub = el.tags.power === 'substation';
      if (!isAddrBldg && !isSub) continue;
      if (waysById.has(el.id)) continue;

      const geometry = el.nodes
        .map((id) => nodes.get(id))
        .filter((pt): pt is { lat: number; lon: number } => Boolean(pt));
      if (geometry.length < 3) continue;

      const tags: Record<string, string> = {};
      for (const k of ['building', 'addr:street', 'addr:housenumber', 'name', 'power']) {
        if (el.tags[k]) tags[k] = el.tags[k];
      }
      waysById.set(el.id, { type: 'way', id: el.id, tags, geometry });
    }
  }

  const elements = [...waysById.values()];
  return elements.length > 50 ? { elements } : null;
}

async function fetchOsmData(forceRefresh = false): Promise<unknown> {
  if (!forceRefresh && osmCache && Date.now() < osmCache.expiresAt) {
    return osmCache.data;
  }

  // 1. Primary: Official OpenStreetMap API v0.6 (reliable, zero Overpass 502 queue timeouts)
  const v06Data = await fetchOsmViaOfficialV06();
  if (v06Data) {
    osmCache = {
      expiresAt: Date.now() + OSM_CACHE_TTL_MS,
      data: v06Data,
    };
    return v06Data;
  }

  // 2. Secondary: Overpass API mirrors with proper form-urlencoded + Accept: application/json
  const body = new URLSearchParams({ data: OVERPASS_QUERY }).toString();
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json',
          'User-Agent': 'Pivdennoukrainsk-DPEM-Outage-Map/1.0',
        },
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (json && Array.isArray(json.elements) && json.elements.length > 0) {
        osmCache = {
          expiresAt: Date.now() + OSM_CACHE_TTL_MS,
          data: json,
        };
        return json;
      }
    } catch {
      // Try next mirror
    }
  }

  // 3. Guaranteed fallback: real bundled Pivdennoukrainsk OpenStreetMap snapshot
  const snapshot = loadBundledOsmSnapshot();
  if (snapshot) {
    osmCache = {
      expiresAt: Date.now() + 15 * 60 * 1000,
      data: snapshot,
    };
    return snapshot;
  }

  throw new Error('OpenStreetMap тимчасово недоступний');
}

interface StoredVisitEvent {
  ts: number;
  visitorId: string;
  isAuthenticated: boolean;
}

let auditVisits: StoredVisitEvent[] = (() => {
  try {
    if (!fs.existsSync(AUDIT_STORE_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(AUDIT_STORE_PATH, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    return parsed
      .filter(
        (v): v is StoredVisitEvent =>
          Boolean(v) &&
          typeof v.ts === 'number' &&
          v.ts >= cutoff &&
          typeof v.visitorId === 'string' &&
          typeof v.isAuthenticated === 'boolean'
      )
      .slice(-AUDIT_MAX_EVENTS);
  } catch {
    return [];
  }
})();

const lastVisitByKey = new Map<string, number>();
let auditSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAuditFlush(): void {
  if (auditSaveTimer) return;
  auditSaveTimer = setTimeout(() => {
    auditSaveTimer = null;
    try {
      fs.writeFileSync(AUDIT_STORE_PATH, JSON.stringify(auditVisits));
    } catch {
      // Ephemeral memory fallback is fine if disk is read-only
    }
  }, 3000);
}

// 30-day rolling archive of DPEM queue outage hours & street incidents (zero PII, zero extra upstream fetches)
const analyticsArchive: OutageAnalyticsPayload = (() => {
  try {
    if (!fs.existsSync(ANALYTICS_STORE_PATH)) {
      return { updatedAt: new Date().toISOString(), days: [], streetIncidents: [] };
    }
    const raw = JSON.parse(fs.readFileSync(ANALYTICS_STORE_PATH, 'utf8')) as Partial<OutageAnalyticsPayload>;
    return {
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      days: Array.isArray(raw.days) ? raw.days.slice(-ANALYTICS_MAX_DAYS) : [],
      streetIncidents: Array.isArray(raw.streetIncidents)
        ? raw.streetIncidents.slice(0, ANALYTICS_MAX_INCIDENTS)
        : [],
    };
  } catch {
    return { updatedAt: new Date().toISOString(), days: [], streetIncidents: [] };
  }
})();

let analyticsSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAnalyticsFlush(): void {
  if (analyticsSaveTimer) return;
  analyticsSaveTimer = setTimeout(() => {
    analyticsSaveTimer = null;
    try {
      fs.writeFileSync(ANALYTICS_STORE_PATH, JSON.stringify(analyticsArchive));
    } catch {
      // ignore read-only disk
    }
  }, 4000);
}

function getKyivTodayIso(): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const pick = (t: string) => parts.find((p) => p.type === t)?.value || '01';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function extractIncidentStreets(text: string): string[] {
  const re =
    /(?:вул\.?|просп\.?|пр-т\.?|пр\.?|бул\.?|б-р\.?|пров\.?|площа|пл\.?|мкрн\.?|кв\.?)\s*[А-ЯІЇЄҐа-яіїєґ'’\-]{3,28}(?:\s+[А-ЯІЇЄҐа-яіїєґ'’\-]{3,24})?/gi;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const clean = m[0].replace(/[.,;:\s]+$/, '').trim();
    if (clean.length >= 5) found.push(clean);
  }
  return [...new Set(found)];
}

function recordDpemPayloadToAnalytics(payload: DpemApiPayload): void {
  const nowIso = new Date().toISOString();
  const daysMap = new Map<string, ArchivedDaySnapshot>();
  for (const d of analyticsArchive.days) {
    daysMap.set(d.date, d);
  }

  for (const [date, day] of Object.entries(payload.scheduleByDate || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day?.queues) continue;
    const queueOffHours: Partial<Record<SubqueueId, number>> = {};
    const queueSwitchOffHours: Partial<Record<SubqueueId, number>> = {};
    const queueSwitchOnHours: Partial<Record<SubqueueId, number>> = {};
    const queuePossibleHours: Partial<Record<SubqueueId, number>> = {};

    for (const q of SUBQUEUES) {
      const slots = day.queues[q];
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

    const existing = daysMap.get(date);
    if (!existing || existing.source === 'fallback' || payload.source === 'live') {
      daysMap.set(date, {
        date,
        queueOffHours,
        queueSwitchOffHours,
        queueSwitchOnHours,
        queuePossibleHours,
        source: payload.source,
        updatedAt: nowIso,
      });
    }
  }

  analyticsArchive.days = [...daysMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-ANALYTICS_MAX_DAYS);

  const todayIso = getKyivTodayIso();
  const incMap = new Map<string, ArchivedStreetIncident>();
  for (const inc of analyticsArchive.streetIncidents) {
    incMap.set(inc.id, inc);
  }

  const allNotices = [
    ...(payload.operOutages || []),
    ...(payload.emergencyOutages || []),
    ...(payload.plannedOutages || []),
  ];
  for (const notice of allNotices) {
    const rawText = `${notice.substation || ''} ${notice.feeder || ''} ${notice.description}`;
    const streets = extractIncidentStreets(rawText);
    for (const street of streets) {
      const hash = crypto
        .createHash('sha1')
        .update(`${todayIso}:${notice.type}:${street.toLowerCase()}:${notice.description.slice(0, 80)}`)
        .digest('hex')
        .slice(0, 12);
      const id = `inc_${todayIso}_${hash}`;
      if (!incMap.has(id)) {
        incMap.set(id, {
          id,
          date: todayIso,
          street,
          kind: notice.type,
          summary: notice.description.slice(0, 160),
        });
      }
    }
  }

  for (const tr of payload.autoTransfers || []) {
    if (!tr.street) continue;
    const hash = crypto
      .createHash('sha1')
      .update(`${todayIso}:transfer:${tr.street.toLowerCase()}:${tr.targetQueue}`)
      .digest('hex')
      .slice(0, 12);
    const id = `inc_${todayIso}_${hash}`;
    if (!incMap.has(id)) {
      incMap.set(id, {
        id,
        date: todayIso,
        street: tr.street,
        kind: 'transfer',
        summary: `Перенос на ${tr.targetQueue} (${tr.houses.join(', ')})`.slice(0, 160),
      });
    }
  }

  const minDate =
    analyticsArchive.days.length > 0 ? analyticsArchive.days[0].date : todayIso;
  analyticsArchive.streetIncidents = [...incMap.values()]
    .filter((i) => i.date >= minDate)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, ANALYTICS_MAX_INCIDENTS);
  analyticsArchive.updatedAt = nowIso;
  scheduleAnalyticsFlush();
}

async function startServer() {
  const app = express();

  app.get('/api/dpem', async (req, res) => {
    try {
      const force = req.query.force === '1';
      const payload = await fetchDpemPayload(force);
      res.setHeader('Cache-Control', 'public, max-age=180');
      res.json(payload);
    } catch (err) {
      const fallback = getFallbackSeedPayload();
      res.status(200).json({
        fetchedAt: new Date().toISOString(),
        source: 'fallback',
        warning: err instanceof Error ? err.message : 'Помилка опитування ДПЕМ',
        operUpdatedAt: null,
        emergencyUpdatedAt: null,
        plannedUpdatedAt: null,
        scheduleByDate: fallback.scheduleByDate,
        feederRows: fallback.feederRows,
        operOutages: [],
        emergencyOutages: [],
        plannedOutages: [],
        autoTransfers: [],
      } satisfies DpemApiPayload);
    }
  });

  app.get('/api/analytics/outages', async (_req, res) => {
    try {
      if (analyticsArchive.days.length === 0) {
        await fetchDpemPayload(false);
      }
      res.setHeader('Cache-Control', 'public, max-age=180');
      res.json(analyticsArchive);
    } catch {
      res.status(200).json(analyticsArchive);
    }
  });

  // Lightweight zero-PII visit beacon (1 request per session; 10 min server dedup)
  app.post('/api/audit/visit', express.json({ limit: '4kb' }), (req, res) => {
    const body = req.body as { visitorId?: unknown; isAuthenticated?: unknown } | undefined;
    const rawId = typeof body?.visitorId === 'string' ? body.visitorId.trim() : '';
    const isAuthenticated = body?.isAuthenticated === true;

    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(rawId)) {
      res.status(400).json({ ok: false });
      return;
    }

    const now = Date.now();
    const dedupKey = `${rawId}:${isAuthenticated ? '1' : '0'}`;
    const lastTs = lastVisitByKey.get(dedupKey) || 0;
    if (now - lastTs < AUDIT_DEDUP_MS) {
      res.status(204).end();
      return;
    }

    lastVisitByKey.set(dedupKey, now);
    if (lastVisitByKey.size > 4000) {
      const stale = now - AUDIT_DEDUP_MS;
      for (const [k, ts] of lastVisitByKey.entries()) {
        if (ts < stale) lastVisitByKey.delete(k);
      }
    }

    const cutoff = now - AUDIT_RETENTION_MS;
    if (auditVisits.length > 0 && auditVisits[0].ts < cutoff) {
      auditVisits = auditVisits.filter((v) => v.ts >= cutoff);
    }

    auditVisits.push({ ts: now, visitorId: rawId, isAuthenticated });
    if (auditVisits.length > AUDIT_MAX_EVENTS) {
      auditVisits = auditVisits.slice(-AUDIT_MAX_EVENTS);
    }
    scheduleAuditFlush();
    res.status(204).end();
  });

  app.get('/api/audit/stats', (_req, res) => {
    const now = Date.now();
    const cutoff = now - AUDIT_RETENTION_MS;
    const activeCutoff = now - 15 * 60 * 1000;
    const recent = auditVisits.filter((v) => v.ts >= cutoff);

    const loggedInVisitors = new Set<string>();
    const anonVisitors = new Set<string>();
    const activeLoggedIn = new Set<string>();
    const activeAnon = new Set<string>();
    let totalAnonymousVisits = 0;
    let totalLoggedInVisits = 0;

    for (const v of recent) {
      if (v.isAuthenticated) {
        totalLoggedInVisits++;
        loggedInVisitors.add(v.visitorId);
        if (v.ts >= activeCutoff) activeLoggedIn.add(v.visitorId);
      } else {
        totalAnonymousVisits++;
        anonVisitors.add(v.visitorId);
        if (v.ts >= activeCutoff) activeAnon.add(v.visitorId);
      }
    }

    // Do not double-count a browser that started anonymous and then signed in
    for (const id of loggedInVisitors) {
      anonVisitors.delete(id);
    }
    for (const id of activeLoggedIn) {
      activeAnon.delete(id);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      uniqueAnonymous: anonVisitors.size,
      uniqueLoggedIn: loggedInVisitors.size,
      totalAnonymousVisits,
      totalLoggedInVisits,
      activeLast15mAnon: activeAnon.size,
      activeLast15mLoggedIn: activeLoggedIn.size,
      visits: recent.slice(-1500).map((v) => ({
        ts: v.ts,
        isAuthenticated: v.isAuthenticated,
        visitorTag: v.visitorId.slice(0, 6),
      })),
    });
  });

  // ============================================================================
  // Telegram Mini App & Login Widget Cryptographic Authentication (HMAC-SHA256)
  // ============================================================================
  const SESSION_SECRET =
    process.env.SESSION_SIGNING_SECRET?.trim() || crypto.randomBytes(32).toString('hex');
  const TELEGRAM_AUTH_MAX_AGE_SEC = 24 * 60 * 60; // 24h freshness window

  function parseTelegramAdminIds(): Set<number> {
    const raw = process.env.TELEGRAM_ADMIN_IDS || '';
    const set = new Set<number>();
    for (const part of raw.split(',')) {
      const n = Number(part.trim());
      if (Number.isSafeInteger(n) && n > 0) set.add(n);
    }
    return set;
  }

  function sanitizeHttpsUrl(raw: unknown): string | undefined {
    if (typeof raw !== 'string' || !raw) return undefined;
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' ? u.toString().slice(0, 300) : undefined;
    } catch {
      return undefined;
    }
  }

  function signTelegramSessionToken(payload: {
    id: number;
    firstName: string;
    lastName?: string;
    username?: string;
    photoUrl?: string;
    isTelegramAdmin: boolean;
  }): string {
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  function verifyTelegramSessionToken(token: string): {
    id: number;
    firstName: string;
    lastName?: string;
    username?: string;
    photoUrl?: string;
    isTelegramAdmin: boolean;
  } | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
        id: number;
        firstName: string;
        lastName?: string;
        username?: string;
        photoUrl?: string;
        isTelegramAdmin: boolean;
        exp: number;
      };
      if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function verifyTimingSafeHex(actualHex: string, expectedHex: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(actualHex) || !/^[a-f0-9]{64}$/i.test(expectedHex)) {
      return false;
    }
    const a = Buffer.from(actualHex.toLowerCase(), 'hex');
    const b = Buffer.from(expectedHex.toLowerCase(), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  const telegramBotStatus = initTelegramBot({
    app,
    getDpemPayload: () => fetchDpemPayload(false),
  });

  app.get('/api/auth/telegram/config', (_req, res) => {
    const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
    const diag = telegramBotStatus.getDiagnostics();
    const rawUsername = (
      diag.resolvedBotUsername ||
      process.env.TELEGRAM_BOT_USERNAME ||
      ''
    )
      .trim()
      .replace(/^@/, '');
    const validUsername = /^[a-zA-Z0-9_]{3,64}$/.test(rawUsername) ? rawUsername : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enabled: hasToken,
      botUsername: hasToken ? validUsername : null,
      botMode: telegramBotStatus.mode,
      hasWebAppUrl: telegramBotStatus.hasWebAppUrl,
      profileSynced: diag.profileSynced,
    });
  });

  app.get('/api/auth/telegram/me', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const session = token ? verifyTelegramSessionToken(token) : null;
    res.setHeader('Cache-Control', 'no-store');
    if (!session) {
      res.status(401).json({ verified: false });
      return;
    }
    res.json({
      verified: true,
      user: { ...session, verified: true },
    });
  });

  app.post('/api/auth/telegram', express.json({ limit: '8kb' }), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!botToken) {
      res.status(200).json({
        verified: false,
        configured: false,
        error: 'TELEGRAM_BOT_TOKEN не налаштовано на сервері',
      });
      return;
    }

    const body = req.body as {
      initData?: unknown;
      loginWidget?: Record<string, unknown>;
    };
    const nowSec = Math.floor(Date.now() / 1000);
    const adminIds = parseTelegramAdminIds();

    // Path 1: Telegram Mini App WebApp.initData verification
    if (typeof body?.initData === 'string' && body.initData.length > 0 && body.initData.length <= 4096) {
      const params = new URLSearchParams(body.initData);
      const hash = params.get('hash') || '';
      const authDate = Number(params.get('auth_date') || '0');
      if (
        !hash ||
        !Number.isFinite(authDate) ||
        nowSec - authDate > TELEGRAM_AUTH_MAX_AGE_SEC ||
        authDate > nowSec + 300
      ) {
        res.status(401).json({ verified: false, configured: true, error: 'Недійсний або застарілий підпис Telegram' });
        return;
      }

      const entries: string[] = [];
      params.forEach((val, key) => {
        if (key !== 'hash') entries.push(`${key}=${val}`);
      });
      entries.sort();
      const dataCheckString = entries.join('\n');

      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
      const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

      if (!verifyTimingSafeHex(hash, expectedHash)) {
        res.status(401).json({ verified: false, configured: true, error: 'Помилка перевірки підпису Telegram' });
        return;
      }

      try {
        const userJson = params.get('user');
        const parsedUser = userJson ? (JSON.parse(userJson) as Record<string, unknown>) : null;
        const id = Number(parsedUser?.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
          res.status(400).json({ verified: false, configured: true, error: 'Некоректний профіль Telegram' });
          return;
        }
        const profile = {
          id,
          firstName: String(parsedUser?.first_name || 'Telegram').slice(0, 64),
          lastName: parsedUser?.last_name ? String(parsedUser.last_name).slice(0, 64) : undefined,
          username: parsedUser?.username ? String(parsedUser.username).slice(0, 64) : undefined,
          photoUrl: sanitizeHttpsUrl(parsedUser?.photo_url),
          isTelegramAdmin: adminIds.has(id),
        };
        const token = signTelegramSessionToken(profile);
        res.json({
          verified: true,
          configured: true,
          user: { ...profile, verified: true },
          token,
        });
        return;
      } catch {
        res.status(400).json({ verified: false, configured: true, error: 'Некоректний JSON профілю Telegram' });
        return;
      }
    }

    // Path 2: Telegram Login Widget verification (standard browser)
    if (body?.loginWidget && typeof body.loginWidget === 'object' && !Array.isArray(body.loginWidget)) {
      const w = body.loginWidget;
      const hash = typeof w.hash === 'string' ? w.hash : '';
      const authDate = Number(w.auth_date || 0);
      const id = Number(w.id || 0);
      if (
        !hash ||
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !Number.isFinite(authDate) ||
        nowSec - authDate > TELEGRAM_AUTH_MAX_AGE_SEC ||
        authDate > nowSec + 300
      ) {
        res.status(401).json({ verified: false, configured: true, error: 'Недійсні дані Telegram Login Widget' });
        return;
      }

      const allowedKeys = ['auth_date', 'first_name', 'id', 'last_name', 'photo_url', 'username'];
      const entries: string[] = [];
      for (const key of allowedKeys) {
        const v = w[key];
        if (v !== undefined && v !== null && v !== '') {
          entries.push(`${key}=${String(v)}`);
        }
      }
      entries.sort();
      const dataCheckString = entries.join('\n');

      const secretKey = crypto.createHash('sha256').update(botToken).digest();
      const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

      if (!verifyTimingSafeHex(hash, expectedHash)) {
        res.status(401).json({ verified: false, configured: true, error: 'Помилка перевірки підпису Telegram Widget' });
        return;
      }

      const profile = {
        id,
        firstName: String(w.first_name || 'Telegram').slice(0, 64),
        lastName: w.last_name ? String(w.last_name).slice(0, 64) : undefined,
        username: w.username ? String(w.username).slice(0, 64) : undefined,
        photoUrl: sanitizeHttpsUrl(w.photo_url),
        isTelegramAdmin: adminIds.has(id),
      };
      const token = signTelegramSessionToken(profile);
      res.json({
        verified: true,
        configured: true,
        user: { ...profile, verified: true },
        token,
      });
      return;
    }

    res.status(400).json({ verified: false, configured: true, error: 'Відсутні дані Telegram для перевірки' });
  });

  app.get('/api/osm', async (req, res) => {
    try {
      const force = req.query.force === '1';
      const data = await fetchOsmData(force);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.json(data);
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'Не вдалося завантажити OSM',
      });
    }
  });

  // Server-side CARTO Basemaps proxy (keeps CARTO_API_KEY strictly on the server)
  const ALLOWED_CARTO_STYLES: Record<string, string> = {
    dark_all: 'https://basemaps.cartocdn.com/dark_all',
    voyager: 'https://basemaps.cartocdn.com/rastertiles/voyager',
    light_all: 'https://basemaps.cartocdn.com/light_all',
  };

  app.get('/api/tiles/status', (_req, res) => {
    res.json({ cartoEnabled: Boolean(process.env.CARTO_API_KEY?.trim()) });
  });

  app.get('/api/tiles/:style/:z/:x/:y', async (req, res) => {
    const apiKey = process.env.CARTO_API_KEY?.trim();
    if (!apiKey) {
      res.status(404).end();
      return;
    }

    const baseUrl = ALLOWED_CARTO_STYLES[req.params.style];
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    if (
      !baseUrl ||
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      z < 0 ||
      z > 19 ||
      x < 0 ||
      y < 0 ||
      x >= 1 << z ||
      y >= 1 << z
    ) {
      res.status(400).end();
      return;
    }

    try {
      const upstream = `${baseUrl}/${z}/${x}/${y}.png?key=${encodeURIComponent(apiKey)}`;
      const tileRes = await fetch(upstream, {
        signal: AbortSignal.timeout(8000),
      });
      if (!tileRes.ok) {
        res.status(tileRes.status).end();
        return;
      }
      const buf = Buffer.from(await tileRes.arrayBuffer());
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.send(buf);
    } catch {
      res.status(502).end();
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`DPEM Outage Map server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
