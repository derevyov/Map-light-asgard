import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  AccessRequestRecord,
  ArchivedDaySnapshot,
  AssignmentHistoryEntry,
  AuditEventRecord,
  AuditEventType,
  BuildingOverride,
  DualQueueType,
  FavoriteAddress,
  FeederTransfer,
  ManualPoint,
  ServerAuditVisit,
  SUBQUEUES,
  SubqueueId,
  UserRoleName,
  UserRoleRecord,
} from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Mandatory startup connectivity check
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration (client is offline).');
      return false;
    }
    // Permission-denied or not-found still confirms live server reachability
    return true;
  }
}

void testFirestoreConnection();

export function subscribeAuth(cb: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, cb);
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Deterministic safe Firestore document ID (matches ^[a-zA-Z0-9_\-]+$, <= 128 chars)
 * from any Unicode street|house address key.
 */
export function addressKeyToDocId(addressKey: string): string {
  const bytes = new TextEncoder().encode(addressKey);
  let hex = 'ov_';
  for (let i = 0; i < bytes.length && hex.length < 118; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function makeSafeDocId(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'doc';
  const rand = Math.random().toString(36).slice(2, 10);
  return `${cleanPrefix}_${Date.now()}_${rand}`;
}

// Subscribe to shared active feeder transfers
export function subscribeSharedTransfers(
  onData: (transfers: FeederTransfer[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'transfers';
  const q = query(collection(db, path), where('status', '==', 'active'));
  return onSnapshot(
    q,
    (snap) => {
      const list: FeederTransfer[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (
          typeof d.street === 'string' &&
          Array.isArray(d.houses) &&
          SUBQUEUES.includes(d.targetQueue)
        ) {
          list.push({
            id: docSnap.id,
            street: d.street,
            houses: d.houses.filter((h: unknown): h is string => typeof h === 'string'),
            targetQueue: d.targetQueue as SubqueueId,
            targetFeeder: typeof d.targetFeeder === 'string' ? d.targetFeeder : '',
            manual: true,
            reason: typeof d.reason === 'string' ? d.reason : undefined,
          });
        }
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export async function createSharedTransfer(input: {
  street: string;
  houses: string[];
  targetQueue: SubqueueId;
  targetFeeder: string;
  reason?: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Необхідний вхід через Google');

  const id = makeSafeDocId('tr');
  const path = `transfers/${id}`;
  const cleanStreet = input.street.trim().slice(0, 120);
  const cleanHouses = input.houses
    .map((h) => h.trim().slice(0, 32))
    .filter(Boolean)
    .slice(0, 50);

  if (cleanStreet.length < 2 || cleanHouses.length === 0) {
    throw new Error('Вкажіть коректну вулицю та номери будинків');
  }

  const payload: Record<string, unknown> = {
    street: cleanStreet,
    houses: cleanHouses,
    targetQueue: input.targetQueue,
    targetFeeder: input.targetFeeder.trim().slice(0, 80),
    authorUid: user.uid,
    authorName: (user.displayName || 'Користувач').slice(0, 80),
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.reason && input.reason.trim()) {
    payload.reason = input.reason.trim().slice(0, 240);
  }

  try {
    await setDoc(doc(db, 'transfers', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteSharedTransfer(transferId: string): Promise<void> {
  const path = `transfers/${transferId}`;
  try {
    await deleteDoc(doc(db, 'transfers', transferId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Subscribe to shared building dual-queue overrides
export function subscribeSharedOverrides(
  onData: (overrides: Record<string, BuildingOverride>) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'overrides';
  const q = query(
    collection(db, path),
    where('dualType', 'in', ['none', 'backup', 'split_entrances', 'split_lifts'])
  );
  return onSnapshot(
    q,
    (snap) => {
      const map: Record<string, BuildingOverride> = {};
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (typeof d.addressKey === 'string' && d.addressKey.length >= 3) {
          map[d.addressKey] = {
            primary:
              typeof d.primary === 'string' && SUBQUEUES.includes(d.primary as SubqueueId)
                ? (d.primary as SubqueueId)
                : undefined,
            secondary:
              typeof d.secondary === 'string' && SUBQUEUES.includes(d.secondary as SubqueueId)
                ? (d.secondary as SubqueueId)
                : undefined,
            dualType: d.dualType as DualQueueType,
            note: typeof d.note === 'string' ? d.note : undefined,
          };
        }
      });
      onData(map);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export async function saveSharedOverride(
  addressKey: string,
  override: BuildingOverride
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Необхідний вхід через Google');

  const docId = addressKeyToDocId(addressKey);
  const path = `overrides/${docId}`;
  const ref = doc(db, 'overrides', docId);

  try {
    const existingSnap = await getDoc(ref);
    const baseData: Record<string, unknown> = {
      addressKey: addressKey.slice(0, 160),
      primary: override.primary || '',
      secondary: override.secondary || '',
      dualType: override.dualType || 'split_entrances',
      authorUid: user.uid,
      updatedAt: serverTimestamp(),
    };
    if (override.note) {
      baseData.note = override.note.slice(0, 240);
    }

    if (existingSnap.exists()) {
      await setDoc(
        ref,
        {
          ...baseData,
          createdAt: existingSnap.data().createdAt,
        },
        { merge: false }
      );
    } else {
      await setDoc(ref, {
        ...baseData,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteSharedOverride(addressKey: string): Promise<void> {
  const docId = addressKeyToDocId(addressKey);
  const path = `overrides/${docId}`;
  try {
    await deleteDoc(doc(db, 'overrides', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

function cleanPipePart(val: string | undefined, maxLen: number): string {
  return String(val || '')
    .replace(/[\r\n|]+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function encodeFavoritePref(fav: FavoriteAddress): string {
  const safeKey = String(fav.key || '').replace(/[\r\n]+/g, '').trim().slice(0, 90);
  // key itself contains a single '|' (street|house or manual|id); replace '|' with '§' inside key
  const escapedKey = safeKey.replace(/\|/g, '§');
  const buildingId = cleanPipePart(fav.buildingId, 48);
  const street = cleanPipePart(fav.street, 56);
  const house = cleanPipePart(fav.house, 18);
  const label = cleanPipePart(fav.label, 48);
  const note = cleanPipePart(fav.note, 64);
  const queue = fav.queue && SUBQUEUES.includes(fav.queue) ? fav.queue : '';
  const feeder = cleanPipePart(fav.feeder, 44);
  const lat = Number.isFinite(fav.lat) ? Number(fav.lat.toFixed(6)) : 0;
  const lng = Number.isFinite(fav.lng) ? Number(fav.lng.toFixed(6)) : 0;
  const savedAt = cleanPipePart(fav.savedAt, 28);
  return [escapedKey, buildingId, street, house, label, note, queue, feeder, lat, lng, savedAt]
    .join('|')
    .slice(0, 315);
}

function decodeFavoritePref(raw: string, idx: number): FavoriteAddress | null {
  if (typeof raw !== 'string' || !raw.includes('|')) return null;
  const parts = raw.split('|');
  if (parts.length < 10) return null;
  const key = parts[0].replace(/§/g, '|').trim();
  if (!key) return null;
  const buildingId = parts[1].trim() || key;
  const street = parts[2].trim();
  const house = parts[3].trim();
  const label = parts[4].trim() || undefined;
  const note = parts[5].trim();
  const queueRaw = parts[6].trim();
  const queue = SUBQUEUES.includes(queueRaw as SubqueueId) ? (queueRaw as SubqueueId) : undefined;
  const feeder = parts[7].trim() || undefined;
  const lat = Number(parts[8]);
  const lng = Number(parts[9]);
  const savedAt = (parts[10] || '').trim() || new Date().toISOString();
  if (!street && !label) return null;
  return {
    id: `fav_cloud_${idx}_${key.slice(0, 24)}`,
    key,
    buildingId,
    street: street || label || '',
    house,
    label,
    note,
    queue,
    feeder,
    lat: Number.isFinite(lat) ? lat : 0,
    lng: Number.isFinite(lng) ? lng : 0,
    savedAt,
  };
}

// Private per-user preferences sync ("My Home" + Favorites across devices on the same account)
export function subscribeUserPrefs(
  uid: string,
  onData: (prefs: { myHomeKey: string | null; favorites: FavoriteAddress[] | null }) => void
): Unsubscribe {
  const path = `userPrefs/${uid}`;
  return onSnapshot(
    doc(db, 'userPrefs', uid),
    (snap) => {
      if (!snap.exists()) {
        onData({ myHomeKey: null, favorites: null });
        return;
      }
      const data = snap.data();
      const key = typeof data?.myHomeKey === 'string' && data.myHomeKey.length > 0 ? data.myHomeKey : null;
      let favorites: FavoriteAddress[] | null = null;
      if (Array.isArray(data?.favorites)) {
        const decoded: FavoriteAddress[] = [];
        const seen = new Set<string>();
        data.favorites.forEach((raw: unknown, idx: number) => {
          if (typeof raw !== 'string') return;
          const item = decodeFavoritePref(raw, idx);
          if (item && !seen.has(item.key)) {
            seen.add(item.key);
            decoded.push(item);
          }
        });
        favorites = decoded;
      }
      onData({ myHomeKey: key, favorites });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function saveUserHomePref(uid: string, myHomeKey: string): Promise<void> {
  const path = `userPrefs/${uid}`;
  const ref = doc(db, 'userPrefs', uid);
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        myHomeKey: myHomeKey.slice(0, 160),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        myHomeKey: myHomeKey.slice(0, 160),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveUserFavoritesPref(
  uid: string,
  favorites: FavoriteAddress[],
  fallbackHomeKey = ''
): Promise<void> {
  const path = `userPrefs/${uid}`;
  const ref = doc(db, 'userPrefs', uid);
  const encoded = favorites.slice(0, 30).map(encodeFavoritePref);
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        favorites: encoded,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        myHomeKey: fallbackHomeKey.slice(0, 160),
        favorites: encoded,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function isWithinCityBounds(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 47.7 &&
    lat <= 47.95 &&
    lng >= 31.0 &&
    lng <= 31.35
  );
}

function timestampToIso(ts: unknown): string {
  if (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof ts === 'string' && ts.length > 0) return ts;
  return new Date().toISOString();
}

// Subscribe to shared active user-pinned map points (visible to all users)
export function subscribeSharedManualPoints(
  onData: (points: ManualPoint[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'manualPoints';
  const q = query(collection(db, path), where('status', '==', 'active'));
  return onSnapshot(
    q,
    (snap) => {
      const list: ManualPoint[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (
          typeof d.label === 'string' &&
          SUBQUEUES.includes(d.queue as SubqueueId) &&
          typeof d.lat === 'number' &&
          typeof d.lng === 'number'
        ) {
          list.push({
            id: docSnap.id,
            label: d.label,
            queue: d.queue as SubqueueId,
            feeder: typeof d.feeder === 'string' ? d.feeder : '',
            note: typeof d.note === 'string' ? d.note : '',
            lat: d.lat,
            lng: d.lng,
            createdAt: timestampToIso(d.createdAt),
            authorUid: typeof d.authorUid === 'string' ? d.authorUid : undefined,
            authorName: typeof d.authorName === 'string' ? d.authorName : undefined,
            isCloud: true,
          });
        }
      });
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export async function createSharedManualPoint(input: {
  label: string;
  queue: SubqueueId;
  feeder: string;
  note: string;
  lat: number;
  lng: number;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Необхідний вхід через Google');

  const cleanLabel = input.label.trim().slice(0, 100);
  if (cleanLabel.length < 2) {
    throw new Error('Назва точки має містити щонайменше 2 символи');
  }
  if (!isWithinCityBounds(input.lat, input.lng)) {
    throw new Error('Координати виходять за межі району Південноукраїнська');
  }

  const id = makeSafeDocId('mp');
  const path = `manualPoints/${id}`;

  const payload = {
    label: cleanLabel,
    queue: input.queue,
    feeder: input.feeder.trim().slice(0, 80),
    note: input.note.trim().slice(0, 240),
    lat: Number(input.lat.toFixed(6)),
    lng: Number(input.lng.toFixed(6)),
    status: 'active',
    authorUid: user.uid,
    authorName: (user.displayName || 'Користувач').slice(0, 80),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'manualPoints', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteSharedManualPoint(pointId: string): Promise<void> {
  const path = `manualPoints/${pointId}`;
  try {
    await deleteDoc(doc(db, 'manualPoints', pointId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

const VALID_HISTORY_ACTIONS: AssignmentHistoryEntry['action'][] = [
  'point_added',
  'point_removed',
  'collision_changed',
  'dual_mode_changed',
];

// Subscribe to shared append-only assignment history journal (bounded to 100 docs for low Firestore quota usage)
export function subscribeSharedAssignmentHistory(
  onData: (entries: AssignmentHistoryEntry[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'assignmentHistory';
  const q = query(
    collection(db, path),
    where('action', 'in', VALID_HISTORY_ACTIONS),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: AssignmentHistoryEntry[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (
          typeof d.action === 'string' &&
          VALID_HISTORY_ACTIONS.includes(d.action as AssignmentHistoryEntry['action']) &&
          typeof d.title === 'string' &&
          typeof d.details === 'string'
        ) {
          list.push({
            id: docSnap.id,
            timestamp: timestampToIso(d.createdAt),
            action: d.action as AssignmentHistoryEntry['action'],
            title: d.title,
            details: d.details,
            queue:
              typeof d.queue === 'string' && SUBQUEUES.includes(d.queue as SubqueueId)
                ? (d.queue as SubqueueId)
                : undefined,
            lat: typeof d.lat === 'number' ? d.lat : undefined,
            lng: typeof d.lng === 'number' ? d.lng : undefined,
            buildingKey: typeof d.buildingKey === 'string' ? d.buildingKey : undefined,
            authorUid: typeof d.authorUid === 'string' ? d.authorUid : undefined,
            authorName: typeof d.authorName === 'string' ? d.authorName : undefined,
            isCloud: true,
          });
        }
      });
      list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      onData(list.slice(0, 200));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export async function createSharedHistoryEntry(
  input: Omit<AssignmentHistoryEntry, 'id' | 'timestamp' | 'authorUid' | 'authorName' | 'isCloud'>
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Необхідний вхід через Google');

  const id = makeSafeDocId('hist');
  const path = `assignmentHistory/${id}`;

  const payload: Record<string, unknown> = {
    action: input.action,
    title: input.title.trim().slice(0, 120) || 'Подія',
    details: input.details.trim().slice(0, 280) || 'Зміна запису',
    authorUid: user.uid,
    authorName: (user.displayName || 'Користувач').slice(0, 80),
    createdAt: serverTimestamp(),
  };

  if (input.queue && SUBQUEUES.includes(input.queue)) {
    payload.queue = input.queue;
  }
  if (
    typeof input.lat === 'number' &&
    typeof input.lng === 'number' &&
    isWithinCityBounds(input.lat, input.lng)
  ) {
    payload.lat = Number(input.lat.toFixed(6));
    payload.lng = Number(input.lng.toFixed(6));
  }
  if (input.buildingKey && input.buildingKey.trim()) {
    payload.buildingKey = input.buildingKey.trim().slice(0, 160);
  }

  try {
    await setDoc(doc(db, 'assignmentHistory', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteSharedHistoryEntry(entryId: string): Promise<void> {
  const path = `assignmentHistory/${entryId}`;
  try {
    await deleteDoc(doc(db, 'assignmentHistory', entryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

const VALID_AUDIT_EVENTS: AuditEventType[] = [
  'login',
  'point_added',
  'point_removed',
  'collision_changed',
  'dual_mode_changed',
  'transfer_created',
  'transfer_removed',
  'access_requested',
  'role_granted',
  'user_banned',
  'user_unbanned',
  'role_deleted',
];

export async function logSharedAuditEvent(
  eventType: AuditEventType,
  summary: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const id = makeSafeDocId('aud');
  const path = `auditEvents/${id}`;
  const payload = {
    eventType,
    summary: summary.trim().slice(0, 240) || eventType,
    actorUid: user.uid,
    actorName: (user.displayName || 'Користувач').slice(0, 80),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'auditEvents', id), payload);
  } catch (error) {
    // Non-blocking audit logging — report structured error without breaking user action
    try {
      handleFirestoreError(error, OperationType.CREATE, path);
    } catch {
      // ignore
    }
  }
}

// Admin-only real-time subscription to audit events (attach only when admin opens Audit Dashboard)
export function subscribeAuditEvents(
  onData: (events: AuditEventRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'auditEvents';
  const q = query(
    collection(db, path),
    where('eventType', 'in', VALID_AUDIT_EVENTS),
    limit(250)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: AuditEventRecord[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (
          typeof d.eventType === 'string' &&
          VALID_AUDIT_EVENTS.includes(d.eventType as AuditEventType) &&
          typeof d.summary === 'string' &&
          typeof d.actorUid === 'string'
        ) {
          list.push({
            id: docSnap.id,
            eventType: d.eventType as AuditEventType,
            summary: d.summary,
            actorUid: d.actorUid,
            actorName: typeof d.actorName === 'string' ? d.actorName : 'Користувач',
            timestamp: timestampToIso(d.createdAt),
          });
        }
      });
      list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export async function getFirebaseIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

function formatUtcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function encodeVisitArchiveEntry(v: ServerAuditVisit): string {
  const safeTs = Math.floor(v.ts);
  const authFlag = v.isAuthenticated ? '1' : '0';
  const safeTag =
    String(v.visitorTag || 'anon')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 16) || 'anon';
  const base = `${safeTs}|${authFlag}|${safeTag}`;
  if (!v.isAuthenticated || (!v.authProvider && !v.authLabel)) {
    return base;
  }
  const prov = v.authProvider === 'google' || v.authProvider === 'telegram' ? v.authProvider : '';
  const cleanLabel = String(v.authLabel || '')
    .replace(/[\r\n|]+/g, ' ')
    .trim()
    .slice(0, 105);
  return `${base}|${prov}|${cleanLabel}`.slice(0, 155);
}

function decodeVisitArchiveEntry(raw: string): ServerAuditVisit | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('|');
  if (parts.length < 3) return null;
  const ts = Number(parts[0]);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const isAuthenticated = parts[1] === '1';
  const visitorTag = parts[2].replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'anon';
  const provRaw = parts[3];
  const authProvider =
    provRaw === 'google' || provRaw === 'telegram' ? provRaw : undefined;
  const authLabel = parts.length >= 5 && parts[4].trim() ? parts[4].trim() : undefined;
  return {
    ts,
    isAuthenticated,
    visitorTag,
    ...(authProvider ? { authProvider } : {}),
    ...(authLabel ? { authLabel } : {}),
  };
}

function visitDedupFingerprint(v: ServerAuditVisit): string {
  // 1-minute bucket + auth state + visitorTag ensures idempotent archive merging
  return `${Math.floor(v.ts / 60_000)}|${v.isAuthenticated ? '1' : '0'}|${v.visitorTag}`;
}

// Super-Admin-only: load daily visit archives from Firestore (survives ephemeral container redeploys)
export async function loadAuditVisitArchives(days = 14): Promise<ServerAuditVisit[]> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || user.email?.toLowerCase() !== 'derevyov@gmail.com') {
    return [];
  }

  const clampedDays = Math.max(1, Math.min(30, days));
  const now = Date.now();
  const dayKeys: string[] = [];
  for (let i = 0; i < clampedDays; i++) {
    dayKeys.push(formatUtcDayKey(now - i * 24 * 60 * 60 * 1000));
  }

  const visits: ServerAuditVisit[] = [];
  const results = await Promise.allSettled(
    dayKeys.map((dayKey) => getDoc(doc(db, 'auditVisitArchives', dayKey)))
  );

  for (const res of results) {
    if (res.status !== 'fulfilled' || !res.value.exists()) continue;
    const data = res.value.data();
    const entries = Array.isArray(data.entries) ? data.entries : [];
    for (const raw of entries) {
      if (typeof raw !== 'string') continue;
      const decoded = decodeVisitArchiveEntry(raw);
      if (decoded) visits.push(decoded);
    }
  }

  visits.sort((a, b) => a.ts - b.ts);
  return visits;
}

// Super-Admin-only: persist live server visits into Firestore daily archives so redeploys never wipe history
export async function syncAuditVisitArchives(liveVisits: ServerAuditVisit[]): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || user.email?.toLowerCase() !== 'derevyov@gmail.com') {
    return;
  }
  if (!Array.isArray(liveVisits) || liveVisits.length === 0) return;

  const byDay = new Map<string, ServerAuditVisit[]>();
  for (const v of liveVisits) {
    if (!Number.isFinite(v.ts) || v.ts <= 0) continue;
    const dayKey = formatUtcDayKey(v.ts);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dayKey)) continue;
    const arr = byDay.get(dayKey) || [];
    arr.push(v);
    byDay.set(dayKey, arr);
  }

  for (const [dayKey, dayLive] of byDay.entries()) {
    const ref = doc(db, 'auditVisitArchives', dayKey);
    const path = `auditVisitArchives/${dayKey}`;
    try {
      const snap = await getDoc(ref);
      const existingVisits: ServerAuditVisit[] = [];
      const existingFingerprints = new Set<string>();

      if (snap.exists()) {
        const rawEntries = Array.isArray(snap.data().entries) ? snap.data().entries : [];
        for (const raw of rawEntries) {
          if (typeof raw !== 'string') continue;
          const decoded = decodeVisitArchiveEntry(raw);
          if (decoded) {
            existingVisits.push(decoded);
            existingFingerprints.add(visitDedupFingerprint(decoded));
          }
        }
      }

      let addedNew = false;
      const merged = [...existingVisits];
      for (const v of dayLive) {
        const fp = visitDedupFingerprint(v);
        if (existingFingerprints.has(fp)) continue;
        existingFingerprints.add(fp);
        merged.push(v);
        addedNew = true;
      }

      if (!addedNew && snap.exists()) continue;

      merged.sort((a, b) => a.ts - b.ts);
      const encoded = merged.slice(-500).map(encodeVisitArchiveEntry);
      if (encoded.length === 0) continue;

      if (snap.exists()) {
        await updateDoc(ref, {
          entries: encoded,
          updatedByUid: user.uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          dayKey,
          entries: encoded,
          updatedByUid: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.WRITE, path);
      } catch {
        // Non-blocking background sync
      }
    }
  }
}

// ============================================================================
// Persistent Cloud Analytics Archive (48-slot masks survive server redeploys)
// ============================================================================

function encodeAnalyticsQueueEntry(
  q: SubqueueId,
  day: ArchivedDaySnapshot
): string | null {
  const mask = day.queueOffSlotMask?.[q];
  if (!mask || !/^[0-4]{48}$/.test(mask)) return null;
  const offH = Number((day.queueOffHours[q] ?? 0).toFixed(1));
  const swOffH = Number((day.queueSwitchOffHours[q] ?? 0).toFixed(1));
  const swOnH = Number((day.queueSwitchOnHours[q] ?? 0).toFixed(1));
  const possH = Number((day.queuePossibleHours[q] ?? 0).toFixed(1));
  return `${q}|${offH}|${swOffH}|${swOnH}|${possH}|${mask}`;
}

function decodeAnalyticsDayDoc(dayKey: string, data: Record<string, unknown>): ArchivedDaySnapshot | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (entries.length === 0) return null;

  const queueOffHours: Partial<Record<SubqueueId, number>> = {};
  const queueSwitchOffHours: Partial<Record<SubqueueId, number>> = {};
  const queueSwitchOnHours: Partial<Record<SubqueueId, number>> = {};
  const queuePossibleHours: Partial<Record<SubqueueId, number>> = {};
  const queueOffSlotMask: Partial<Record<SubqueueId, string>> = {};

  for (const raw of entries) {
    if (typeof raw !== 'string') continue;
    const parts = raw.split('|');
    if (parts.length < 6) continue;
    const q = parts[0] as SubqueueId;
    if (!SUBQUEUES.includes(q)) continue;
    const offH = Number(parts[1]);
    const swOffH = Number(parts[2]);
    const swOnH = Number(parts[3]);
    const possH = Number(parts[4]);
    const mask = parts[5];
    if (!/^[0-4]{48}$/.test(mask)) continue;
    queueOffHours[q] = Number.isFinite(offH) ? offH : 0;
    queueSwitchOffHours[q] = Number.isFinite(swOffH) ? swOffH : 0;
    queueSwitchOnHours[q] = Number.isFinite(swOnH) ? swOnH : 0;
    queuePossibleHours[q] = Number.isFinite(possH) ? possH : 0;
    queueOffSlotMask[q] = mask;
  }

  if (Object.keys(queueOffSlotMask).length === 0) return null;
  const srcRaw = data.source;
  const source: ArchivedDaySnapshot['source'] =
    srcRaw === 'live' || srcRaw === 'fallback' || srcRaw === 'local-html' ? srcRaw : 'live';

  return {
    date: dayKey,
    queueOffHours,
    queueSwitchOffHours,
    queueSwitchOnHours,
    queuePossibleHours,
    queueOffSlotMask,
    source,
    updatedAt: timestampToIso(data.updatedAt),
  };
}

// Public read of up to 35 archived DPEM schedule days with 48-slot masks
export async function loadCloudAnalyticsArchive(): Promise<ArchivedDaySnapshot[]> {
  try {
    const q = query(
      collection(db, 'analyticsArchive'),
      where('dayKey', '>=', '2020-01-01'),
      where('dayKey', '<=', '2099-12-31'),
      limit(35)
    );
    const snap = await getDocs(q);
    const days: ArchivedDaySnapshot[] = [];
    snap.forEach((docSnap) => {
      const decoded = decodeAnalyticsDayDoc(docSnap.id, docSnap.data() as Record<string, unknown>);
      if (decoded) days.push(decoded);
    });
    return days.sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

// Super-Admin-only background archival of daily 48-slot DPEM schedules to Firestore
export async function syncCloudAnalyticsArchive(days: ArchivedDaySnapshot[]): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || user.email?.toLowerCase() !== 'derevyov@gmail.com') {
    return;
  }
  if (!Array.isArray(days) || days.length === 0) return;

  for (const day of days.slice(-35)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
    const entries: string[] = [];
    for (const q of SUBQUEUES) {
      const enc = encodeAnalyticsQueueEntry(q, day);
      if (enc) entries.push(enc);
    }
    if (entries.length === 0) continue;

    const ref = doc(db, 'analyticsArchive', day.date);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const existingData = snap.data();
        const existingEntries = Array.isArray(existingData.entries) ? existingData.entries : [];
        const existingSrc = existingData.source;
        const samePayload =
          existingEntries.length === entries.length &&
          existingEntries.every((val: unknown, i: number) => val === entries[i]);
        if (samePayload && existingSrc === day.source) continue;
        // Never overwrite 'live' cloud data with 'fallback'
        if (existingSrc === 'live' && day.source === 'fallback') continue;

        await updateDoc(ref, {
          entries,
          source: day.source,
          updatedByUid: user.uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          dayKey: day.date,
          entries,
          source: day.source,
          updatedByUid: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Non-blocking background sync
    }
  }
}

// ============================================================================
// Multi-Role RBAC: User Roles, Access Requests & Lineage-Restricted Banning
// ============================================================================

function parseRoleDoc(id: string, d: Record<string, unknown>): UserRoleRecord | null {
  if (
    typeof d.uid !== 'string' ||
    typeof d.displayName !== 'string' ||
    (d.role !== 'viewer' && d.role !== 'editor' && d.role !== 'admin') ||
    (d.status !== 'active' && d.status !== 'banned') ||
    typeof d.grantedByUid !== 'string'
  ) {
    return null;
  }
  return {
    uid: id,
    displayName: d.displayName,
    contactLabel: typeof d.contactLabel === 'string' ? d.contactLabel : undefined,
    role: d.role,
    status: d.status,
    grantedByUid: d.grantedByUid,
    grantedByName: typeof d.grantedByName === 'string' ? d.grantedByName : undefined,
    bannedByUid: typeof d.bannedByUid === 'string' ? d.bannedByUid : undefined,
    banReason: typeof d.banReason === 'string' ? d.banReason : undefined,
    createdAt: timestampToIso(d.createdAt),
    updatedAt: timestampToIso(d.updatedAt),
  };
}

export function subscribeMyUserRole(
  uid: string,
  onData: (role: UserRoleRecord | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `userRoles/${uid}`;
  return onSnapshot(
    doc(db, 'userRoles', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(parseRoleDoc(snap.id, snap.data() as Record<string, unknown>));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export function subscribeAllUserRoles(
  onData: (roles: UserRoleRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'userRoles';
  const q = query(
    collection(db, path),
    where('status', 'in', ['active', 'banned']),
    limit(150)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: UserRoleRecord[] = [];
      snap.forEach((docSnap) => {
        const parsed = parseRoleDoc(docSnap.id, docSnap.data() as Record<string, unknown>);
        if (parsed) list.push(parsed);
      });
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export function subscribeAccessRequests(
  onData: (requests: AccessRequestRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'accessRequests';
  const q = query(
    collection(db, path),
    where('status', 'in', ['pending', 'approved', 'rejected']),
    limit(120)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: AccessRequestRecord[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (
          typeof d.requesterUid === 'string' &&
          typeof d.requesterName === 'string' &&
          (d.requestedRole === 'editor' || d.requestedRole === 'admin') &&
          typeof d.reason === 'string' &&
          (d.status === 'pending' || d.status === 'approved' || d.status === 'rejected')
        ) {
          list.push({
            id: docSnap.id,
            requesterUid: d.requesterUid,
            requesterName: d.requesterName,
            telegramHandle: typeof d.telegramHandle === 'string' ? d.telegramHandle : undefined,
            requestedRole: d.requestedRole,
            reason: d.reason,
            status: d.status,
            grantedRole:
              d.grantedRole === 'editor' || d.grantedRole === 'admin' || d.grantedRole === ''
                ? d.grantedRole
                : undefined,
            reviewedByUid: typeof d.reviewedByUid === 'string' ? d.reviewedByUid : undefined,
            reviewedByName: typeof d.reviewedByName === 'string' ? d.reviewedByName : undefined,
            createdAt: timestampToIso(d.createdAt),
            updatedAt: timestampToIso(d.updatedAt),
          });
        }
      });
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export async function submitAccessRequest(input: {
  requestedRole: 'editor' | 'admin';
  reason: string;
  telegramHandle?: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) throw new Error('Необхідний вхід через Google');

  const cleanReason = input.reason.trim().slice(0, 240);
  if (cleanReason.length < 2) {
    throw new Error('Вкажіть коротку причину запиту (мін. 2 символи)');
  }

  const id = makeSafeDocId('req');
  const path = `accessRequests/${id}`;
  const payload: Record<string, unknown> = {
    requesterUid: user.uid,
    requesterName: (user.displayName || 'Користувач').slice(0, 80),
    requestedRole: input.requestedRole,
    reason: cleanReason,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const cleanTg = input.telegramHandle?.trim().slice(0, 64);
  if (cleanTg) {
    payload.telegramHandle = cleanTg;
  }

  try {
    await setDoc(doc(db, 'accessRequests', id), payload);
    void logSharedAuditEvent(
      'access_requested',
      `Запит прав «${input.requestedRole === 'admin' ? 'Адмін' : 'Редактор'}»: ${cleanReason.slice(0, 100)}`
    );
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function cancelAccessRequest(requestId: string): Promise<void> {
  const path = `accessRequests/${requestId}`;
  try {
    await deleteDoc(doc(db, 'accessRequests', requestId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function approveAccessRequest(
  req: AccessRequestRecord,
  grantRole: 'editor' | 'admin'
): Promise<void> {
  const admin = auth.currentUser;
  if (!admin || !admin.emailVerified) throw new Error('Необхідний вхід адміністратора');

  const roleRef = doc(db, 'userRoles', req.requesterUid);
  const reqRef = doc(db, 'accessRequests', req.id);
  const adminName = (admin.displayName || 'Адмін').slice(0, 80);

  try {
    const existingRole = await getDoc(roleRef);
    if (existingRole.exists()) {
      await updateDoc(roleRef, {
        role: grantRole,
        status: 'active',
        bannedByUid: '',
        banReason: '',
        updatedAt: serverTimestamp(),
      });
    } else {
      const rolePayload: Record<string, unknown> = {
        uid: req.requesterUid,
        displayName: req.requesterName.slice(0, 80),
        role: grantRole,
        status: 'active',
        grantedByUid: admin.uid,
        grantedByName: adminName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (req.telegramHandle) {
        rolePayload.contactLabel = req.telegramHandle.slice(0, 80);
      }
      await setDoc(roleRef, rolePayload);
    }

    await updateDoc(reqRef, {
      status: 'approved',
      grantedRole: grantRole,
      reviewedByUid: admin.uid,
      reviewedByName: adminName,
      updatedAt: serverTimestamp(),
    });

    void logSharedAuditEvent(
      'role_granted',
      `Видано роль «${grantRole === 'admin' ? 'Адмін' : 'Редактор'}» користувачу ${req.requesterName}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `userRoles/${req.requesterUid}`);
  }
}

export async function rejectAccessRequest(req: AccessRequestRecord): Promise<void> {
  const admin = auth.currentUser;
  if (!admin || !admin.emailVerified) throw new Error('Необхідний вхід адміністратора');

  const path = `accessRequests/${req.id}`;
  try {
    await updateDoc(doc(db, 'accessRequests', req.id), {
      status: 'rejected',
      grantedRole: '',
      reviewedByUid: admin.uid,
      reviewedByName: (admin.displayName || 'Адмін').slice(0, 80),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function setUserBanStatus(
  target: UserRoleRecord,
  banned: boolean,
  banReason?: string
): Promise<void> {
  const admin = auth.currentUser;
  if (!admin || !admin.emailVerified) throw new Error('Необхідний вхід адміністратора');

  const path = `userRoles/${target.uid}`;
  try {
    await updateDoc(doc(db, 'userRoles', target.uid), {
      status: banned ? 'banned' : 'active',
      bannedByUid: banned ? admin.uid : '',
      banReason: banned ? (banReason || 'Заблоковано адміністратором').trim().slice(0, 240) : '',
      updatedAt: serverTimestamp(),
    });
    void logSharedAuditEvent(
      banned ? 'user_banned' : 'user_unbanned',
      banned
        ? `Заблоковано ${target.displayName} (${target.role})${banReason ? `: ${banReason.slice(0, 80)}` : ''}`
        : `Розблоковано ${target.displayName} (${target.role})`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateUserRoleType(
  target: UserRoleRecord,
  nextRole: UserRoleName
): Promise<void> {
  const admin = auth.currentUser;
  if (!admin || !admin.emailVerified) throw new Error('Необхідний вхід адміністратора');

  const path = `userRoles/${target.uid}`;
  try {
    await updateDoc(doc(db, 'userRoles', target.uid), {
      role: nextRole,
      updatedAt: serverTimestamp(),
    });
    void logSharedAuditEvent(
      'role_granted',
      `Змінено роль ${target.displayName} → ${nextRole}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteUserRoleRecord(target: UserRoleRecord): Promise<void> {
  const path = `userRoles/${target.uid}`;
  try {
    await deleteDoc(doc(db, 'userRoles', target.uid));
    void logSharedAuditEvent(
      'role_deleted',
      `Супер-адмін видалив роль користувача ${target.displayName} (${target.role})`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
