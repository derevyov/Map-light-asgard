import type { FavoriteAddress } from './types';

const LS_KEY = 'dpem_favorites_v1';
const DB_NAME = 'dpem_favorites_chrome_db';
const STORE_NAME = 'favorites';

function openFavoritesDb(): Promise<IDBDatabase | null> {
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
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function readFavoritesSync(): FavoriteAddress[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is FavoriteAddress =>
        Boolean(x) &&
        typeof x === 'object' &&
        typeof x.key === 'string' &&
        typeof x.street === 'string' &&
        typeof x.house === 'string'
    );
  } catch {
    return [];
  }
}

export async function loadFavoritesFromBrowserDb(): Promise<FavoriteAddress[]> {
  const fromLs = readFavoritesSync();
  const db = await openFavoritesDb();
  if (!db) return fromLs;

  try {
    const fromIdb = await new Promise<FavoriteAddress[]>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? (req.result as FavoriteAddress[]) : [];
        resolve(rows);
      };
      req.onerror = () => resolve([]);
    });

    if (fromIdb.length > 0) {
      // Keep localStorage mirrored
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(fromIdb));
      } catch {
        // ignore
      }
      return fromIdb.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    }

    // Backfill IndexedDB if localStorage already has items
    if (fromLs.length > 0) {
      await persistFavoritesToBrowserDb(fromLs);
    }
    return fromLs;
  } catch {
    return fromLs;
  }
}

export async function persistFavoritesToBrowserDb(
  favorites: FavoriteAddress[]
): Promise<void> {
  const safeList = favorites.slice(0, 100);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(safeList));
  } catch {
    // ignore quota errors
  }

  const db = await openFavoritesDb();
  if (!db) return;

  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      for (const item of safeList) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore IndexedDB errors
  }
}
