import bundledOsmSnapshot from '../../data/osm_buildings_snapshot.json';

const DB_NAME = 'dpem_osm_cache_v2';
const STORE_NAME = 'osm_snapshots';
const CACHE_KEY = 'pivdennoukrainsk_bbox_v2';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string | undefined>;
}

export interface OsmResponse {
  elements: OsmElement[];
}

interface CachedOsmRecord {
  savedAt: number;
  data: OsmResponse;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readOsmCache(): Promise<CachedOsmRecord | null> {
  const db = await openDb();
  if (db) {
    try {
      const record = await new Promise<CachedOsmRecord | null>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(CACHE_KEY);
        getReq.onsuccess = () => resolve((getReq.result as CachedOsmRecord) || null);
        getReq.onerror = () => resolve(null);
      });
      if (
        record &&
        Date.now() - record.savedAt < CACHE_TTL_MS &&
        Array.isArray(record.data?.elements) &&
        record.data.elements.length > 0
      ) {
        return record;
      }
    } catch {
      // Fallback below
    }
  }

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedOsmRecord;
    if (
      Date.now() - parsed.savedAt < CACHE_TTL_MS &&
      Array.isArray(parsed.data?.elements) &&
      parsed.data.elements.length > 0
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export async function writeOsmCache(data: OsmResponse): Promise<void> {
  const record: CachedOsmRecord = { savedAt: Date.now(), data };
  const db = await openDb();
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record, CACHE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      return;
    } catch {
      // Fallback to localStorage
    }
  }

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(record));
  } catch {
    // Quota exceeded — safe to ignore
  }
}

export async function clearOsmCache(): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(CACHE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // ignore
    }
  }
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

export async function fetchOsmBuildings(forceRefresh = false): Promise<{
  data: OsmResponse;
  fromCache: boolean;
  savedAt: number;
}> {
  if (!forceRefresh) {
    const cached = await readOsmCache();
    if (cached) {
      return { data: cached.data, fromCache: true, savedAt: cached.savedAt };
    }
  }

  // 1. Try our server-side /api/osm proxy (official OSM API v0.6 + Overpass mirrors + server cache)
  try {
    const res = await fetch(`/api/osm${forceRefresh ? '?force=1' : ''}`);
    if (res.ok) {
      const json = (await res.json()) as OsmResponse;
      if (Array.isArray(json.elements) && json.elements.length > 0) {
        await writeOsmCache(json);
        return { data: json, fromCache: false, savedAt: Date.now() };
      }
    }
  } catch {
    // Fallback below
  }

  // 2. Try bundled real Pivdennoukrainsk OpenStreetMap building snapshot (instant, 0 network failure)
  const snapshot = bundledOsmSnapshot as unknown as OsmResponse;
  if (Array.isArray(snapshot?.elements) && snapshot.elements.length > 0) {
    await writeOsmCache(snapshot);
    return { data: snapshot, fromCache: true, savedAt: Date.now() };
  }

  throw new Error('Не вдалося завантажити контури будівель OpenStreetMap');
}
