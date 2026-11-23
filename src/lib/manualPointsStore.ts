import type { AssignmentHistoryEntry, ManualPoint } from './types';

const LS_POINTS_KEY = 'dpem_manual_points_v1';
const LS_HISTORY_KEY = 'dpem_assignment_history_v1';
const DB_NAME = 'dpem_manual_assignments_db';
const STORE_POINTS = 'manual_points';
const STORE_HISTORY = 'assignment_history';

function openAssignmentsDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_POINTS)) {
          db.createObjectStore(STORE_POINTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function readManualPointsSync(): ManualPoint[] {
  try {
    const raw = localStorage.getItem(LS_POINTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ManualPoint[]) : [];
  } catch {
    return [];
  }
}

export function readAssignmentHistorySync(): AssignmentHistoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AssignmentHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function loadManualPointsAndHistory(): Promise<{
  points: ManualPoint[];
  history: AssignmentHistoryEntry[];
}> {
  const lsPoints = readManualPointsSync();
  const lsHistory = readAssignmentHistorySync();
  const db = await openAssignmentsDb();
  if (!db) return { points: lsPoints, history: lsHistory };

  try {
    const [idbPoints, idbHistory] = await Promise.all([
      new Promise<ManualPoint[]>((resolve) => {
        const tx = db.transaction(STORE_POINTS, 'readonly');
        const req = tx.objectStore(STORE_POINTS).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => resolve([]);
      }),
      new Promise<AssignmentHistoryEntry[]>((resolve) => {
        const tx = db.transaction(STORE_HISTORY, 'readonly');
        const req = tx.objectStore(STORE_HISTORY).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => resolve([]);
      }),
    ]);

    const points =
      idbPoints.length > 0
        ? idbPoints.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        : lsPoints;

    const history =
      idbHistory.length > 0
        ? idbHistory.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        : lsHistory;

    return { points, history };
  } catch {
    return { points: lsPoints, history: lsHistory };
  }
}

export async function persistManualPoints(points: ManualPoint[]): Promise<void> {
  const safe = points.slice(0, 150);
  try {
    localStorage.setItem(LS_POINTS_KEY, JSON.stringify(safe));
  } catch {
    // ignore
  }
  const db = await openAssignmentsDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_POINTS, 'readwrite');
      const store = tx.objectStore(STORE_POINTS);
      store.clear();
      for (const p of safe) store.put(p);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export async function persistAssignmentHistory(
  history: AssignmentHistoryEntry[]
): Promise<void> {
  const safe = history.slice(0, 200);
  try {
    localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(safe));
  } catch {
    // ignore
  }
  const db = await openAssignmentsDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_HISTORY, 'readwrite');
      const store = tx.objectStore(STORE_HISTORY);
      store.clear();
      for (const h of safe) store.put(h);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}
