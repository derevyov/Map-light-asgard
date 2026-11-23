export type SubqueueId =
  | '1-1'
  | '1-2'
  | '2-1'
  | '2-2'
  | '3-1'
  | '3-2'
  | '4-1'
  | '4-2'
  | '5-1'
  | '5-2'
  | '6-1'
  | '6-2';

export const SUBQUEUES: SubqueueId[] = [
  '1-1',
  '1-2',
  '2-1',
  '2-2',
  '3-1',
  '3-2',
  '4-1',
  '4-2',
  '5-1',
  '5-2',
  '6-1',
  '6-2',
];

export type SlotState = 'on' | 'switch_off' | 'off' | 'switch_on' | 'possible';

export type DualQueueType = 'none' | 'backup' | 'split_entrances' | 'split_lifts';

export type GlobalDualMode = 'primary' | 'split';

export interface DaySchedule {
  savedAt: string;
  queues: Record<SubqueueId, SlotState[]>;
}

export type ScheduleByDate = Record<string, DaySchedule>;

export interface FeederRow {
  queue: SubqueueId;
  settlement: string;
  substation: string;
  feeder: string;
  switchType: string;
  consumersText: string;
}

export interface AddressEntry {
  queue: SubqueueId;
  feeder: string;
  substation: string;
  switchType: string;
  settlement: string;
}

export interface OutageNotice {
  type: 'oper' | 'emergency' | 'planned';
  substation?: string;
  feeder?: string;
  timeRange?: string;
  description: string;
}

export interface FeederTransfer {
  id: string;
  street: string;
  houses: string[];
  targetQueue: SubqueueId;
  targetFeeder: string;
  manual: boolean;
  reason?: string;
  createdAt?: string;
}

export interface BuildingOverride {
  primary?: SubqueueId;
  secondary?: SubqueueId | null;
  dualType?: DualQueueType;
  note?: string;
}

export interface DpemApiPayload {
  fetchedAt: string;
  source: 'live' | 'fallback' | 'local-html';
  warning?: string;
  operUpdatedAt: string | null;
  emergencyUpdatedAt: string | null;
  plannedUpdatedAt: string | null;
  scheduleByDate: ScheduleByDate;
  feederRows: FeederRow[];
  operOutages: OutageNotice[];
  emergencyOutages: OutageNotice[];
  plannedOutages: OutageNotice[];
  autoTransfers: FeederTransfer[];
}

export interface GoogleExtraPoint {
  id: string;
  street: string;
  house: string;
  label: string;
  lat: number;
  lng: number;
  category: 'residential' | 'dormitory' | 'public' | 'commercial';
}

export interface ResolvedBuildingInfo {
  key: string;
  primary: SubqueueId;
  secondary: SubqueueId | null;
  allQueues: SubqueueId[];
  hasCollision: boolean;
  dualType: DualQueueType;
  feeder: string;
  entries: AddressEntry[];
  transferredFrom: string | null;
  isTransferred: boolean;
  transferReason?: string;
  isWildcardMatch: boolean;
  hasUserOverride: boolean;
}

export interface BuildingVisual {
  color: string;
  opacity: number;
  dash: string | null;
  statusText: string;
  statusCode: 'off' | 'switch' | 'possible' | 'dual_split' | 'dual_lifts' | 'on' | 'unmapped' | 'filtered';
  info: ResolvedBuildingInfo | null;
  s1: SlotState | null;
  s2: SlotState | null;
}

export interface BuildingRecord {
  id: string;
  key: string;
  street: string;
  house: string;
  label?: string;
  source: 'osm' | 'google' | 'manual';
  manualQueue?: SubqueueId;
  manualFeeder?: string;
  manualNote?: string;
  lat: number;
  lng: number;
  currentVisual?: BuildingVisual;
}

export interface FavoriteAddress {
  id: string;
  key: string;
  buildingId: string;
  street: string;
  house: string;
  label?: string;
  note: string;
  lat: number;
  lng: number;
  savedAt: string;
}

export interface ManualPoint {
  id: string;
  label: string;
  queue: SubqueueId;
  feeder: string;
  note: string;
  lat: number;
  lng: number;
  createdAt: string;
  authorUid?: string;
  authorName?: string;
  isCloud?: boolean;
}

export interface AssignmentHistoryEntry {
  id: string;
  timestamp: string;
  action: 'point_added' | 'point_removed' | 'collision_changed' | 'dual_mode_changed';
  title: string;
  details: string;
  queue?: SubqueueId;
  lat?: number;
  lng?: number;
  buildingKey?: string;
  authorUid?: string;
  authorName?: string;
  isCloud?: boolean;
}

export interface DiffLogEntry {
  id: string;
  time: string;
  reason: string;
  repainted: number;
  total: number;
  message: string;
}

export type AuditEventType =
  | 'login'
  | 'point_added'
  | 'point_removed'
  | 'collision_changed'
  | 'dual_mode_changed'
  | 'transfer_created'
  | 'transfer_removed'
  | 'access_requested'
  | 'role_granted'
  | 'user_banned'
  | 'user_unbanned'
  | 'role_deleted';

export type UserRoleName = 'viewer' | 'editor' | 'admin';
export type EffectiveRoleName = 'viewer' | 'editor' | 'admin' | 'super_admin' | 'banned';

export interface UserRoleRecord {
  uid: string;
  displayName: string;
  contactLabel?: string;
  role: UserRoleName;
  status: 'active' | 'banned';
  grantedByUid: string;
  grantedByName?: string;
  bannedByUid?: string;
  banReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccessRequestRecord {
  id: string;
  requesterUid: string;
  requesterName: string;
  telegramHandle?: string;
  requestedRole: 'editor' | 'admin';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  grantedRole?: '' | 'editor' | 'admin';
  reviewedByUid?: string;
  reviewedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramUserProfile {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  verified: boolean;
  isTelegramAdmin?: boolean;
}

export interface AuditEventRecord {
  id: string;
  eventType: AuditEventType;
  summary: string;
  actorUid: string;
  actorName: string;
  timestamp: string;
}

export interface ServerAuditVisit {
  ts: number;
  isAuthenticated: boolean;
  visitorTag: string;
}

export interface ServerAuditStats {
  uniqueAnonymous: number;
  uniqueLoggedIn: number;
  totalAnonymousVisits: number;
  totalLoggedInVisits: number;
  activeLast15mAnon: number;
  activeLast15mLoggedIn: number;
  visits: ServerAuditVisit[];
}

export interface ArchivedDaySnapshot {
  date: string; // YYYY-MM-DD
  queueOffHours: Partial<Record<SubqueueId, number>>;
  queueSwitchOffHours: Partial<Record<SubqueueId, number>>;
  queueSwitchOnHours: Partial<Record<SubqueueId, number>>;
  queuePossibleHours: Partial<Record<SubqueueId, number>>;
  source: 'live' | 'fallback' | 'local-html';
  updatedAt: string;
}

export interface ArchivedStreetIncident {
  id: string;
  date: string; // YYYY-MM-DD
  street: string;
  kind: 'oper' | 'emergency' | 'planned' | 'transfer';
  summary: string;
}

export interface OutageAnalyticsPayload {
  updatedAt: string;
  days: ArchivedDaySnapshot[];
  streetIncidents: ArchivedStreetIncident[];
}

export interface AddressIndexResult {
  addressIndex: Map<string, AddressEntry[]>;
  streetWildcardIndex: Map<string, AddressEntry[]>;
  feeders: string[];
  dualQueueCount: number;
  dualQueueKeys: Set<string>;
}

export function formatSubqueue(q: SubqueueId): string {
  return q.replace('-1', '-І').replace('-2', '-ІІ');
}

export function formatSlotTime(slot: number): string {
  const safeSlot = Math.max(0, Math.min(47, Math.floor(slot)));
  const m1 = safeSlot * 30;
  const m2 = m1 + 30;
  const pad = (n: number) => String(n).padStart(2, '0');
  const h2 = Math.floor(m2 / 60);
  const min2 = m2 % 60;
  return `${pad(Math.floor(m1 / 60))}:${pad(m1 % 60)} – ${pad(h2)}:${pad(min2)}`;
}
