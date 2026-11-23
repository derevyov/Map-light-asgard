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
  AssignmentHistoryEntry,
  AuditEventRecord,
  AuditEventType,
  BuildingOverride,
  DualQueueType,
  FeederTransfer,
  ManualPoint,
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

// Private per-user "My Home" preference sync
export function subscribeUserHomePref(
  uid: string,
  onData: (homeKey: string | null) => void
): Unsubscribe {
  const path = `userPrefs/${uid}`;
  return onSnapshot(
    doc(db, 'userPrefs', uid),
    (snap) => {
      if (snap.exists()) {
        const key = snap.data()?.myHomeKey;
        onData(typeof key === 'string' && key.length > 0 ? key : null);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function saveUserHomePref(uid: string, myHomeKey: string): Promise<void> {
  const path = `userPrefs/${uid}`;
  try {
    await setDoc(doc(db, 'userPrefs', uid), {
      myHomeKey: myHomeKey.slice(0, 160),
      updatedAt: serverTimestamp(),
    });
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
