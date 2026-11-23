import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Clock,
  ExternalLink,
  Eye,
  Layers,
  Menu,
  Moon,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Zap,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import defaultOverridesData from '../data/dual_queue_overrides.json';
import { AccessControlModal } from './components/AccessControlModal';
import { AnalyticsPage } from './components/AnalyticsPage';
import { AuditDashboardModal } from './components/AuditDashboardModal';
import { AppMode, BuildingInspector } from './components/BuildingInspector';
import { CalendarDatePicker } from './components/CalendarDatePicker';
import { FavoritesWatchPage } from './components/FavoritesWatchPage';
import { ManualPointModal, NearestQueueSuggestion } from './components/ManualPointModal';
import { MapCanvas, MapCanvasHandle } from './components/MapCanvas';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SidebarPanel, SidebarTab } from './components/SidebarPanel';
import {
  loadFavoritesFromBrowserDb,
  persistFavoritesToBrowserDb,
  readFavoritesSync,
} from './lib/favoritesStore';
import { APP_VERSION, APP_VERSION_FULL } from './lib/version';
import {
  approveAccessRequest,
  cancelAccessRequest,
  createSharedHistoryEntry,
  createSharedManualPoint,
  createSharedTransfer,
  deleteSharedHistoryEntry,
  deleteSharedManualPoint,
  deleteSharedOverride,
  deleteSharedTransfer,
  deleteUserRoleRecord,
  getFirebaseIdToken,
  loadAuditVisitArchives,
  loadCloudAnalyticsArchive,
  logSharedAuditEvent,
  rejectAccessRequest,
  saveSharedOverride,
  saveUserFavoritesPref,
  saveUserHomePref,
  setUserBanStatus,
  signInWithGoogle,
  signOutUser,
  submitAccessRequest,
  subscribeAccessRequests,
  subscribeAllUserRoles,
  subscribeAuditEvents,
  subscribeAuth,
  subscribeMyUserRole,
  subscribeSharedAssignmentHistory,
  subscribeSharedManualPoints,
  subscribeSharedOverrides,
  subscribeSharedTransfers,
  subscribeUserPrefs,
  syncAuditVisitArchives,
  syncCloudAnalyticsArchive,
  updateUserRoleType,
} from './lib/firebase';
import {
  loadManualPointsAndHistory,
  persistAssignmentHistory,
  persistManualPoints,
  readAssignmentHistorySync,
  readManualPointsSync,
} from './lib/manualPointsStore';
import { clearOsmCache } from './lib/osmCache';
import {
  buildAddressIndex,
  getFallbackSeedPayload,
  normalizeHouse,
  normalizeStreet,
  parseDpemGrafHtml,
} from './lib/parser';
import { resolveBuilding } from './lib/resolver';
import { normalizeDisplayState } from './lib/scheduleIntervals';
import {
  fetchTelegramAuthConfig,
  getTelegramWebApp,
  initTelegramMiniApp,
  openCurrentUrlInExternalBrowser,
  syncTelegramThemeColors,
  TelegramLoginWidgetPayload,
  triggerTelegramHaptic,
  verifyTelegramLoginWidget,
  verifyTelegramMiniAppInitData,
} from './lib/telegram';
import {
  AnalyticsWindow,
  computeOutageAnalytics,
  loadLocalAnalyticsArchive,
  mergeAnalyticsArchives,
  saveLocalAnalyticsArchive,
  snapshotFromSchedule,
} from './lib/outageAnalytics';
import {
  buildUnifiedDaySchedules,
  detectScheduleShiftModel,
  formatShiftSlotsUk,
  resolveScheduleOrForecastForDate,
} from './lib/scheduleForecast';
import {
  AccessRequestRecord,
  AssignmentHistoryEntry,
  AuditEventRecord,
  BuildingOverride,
  BuildingRecord,
  DiffLogEntry,
  DpemApiPayload,
  DualQueueType,
  EffectiveRoleName,
  FavoriteAddress,
  FeederRow,
  FeederTransfer,
  formatSlotTime,
  formatSubqueue,
  GlobalDualMode,
  ManualPoint,
  OutageAnalyticsPayload,
  OutageNotice,
  ScheduleByDate,
  ServerAuditStats,
  ServerAuditVisit,
  SlotState,
  SUBQUEUES,
  SubqueueId,
  TelegramUserProfile,
  UserRoleRecord,
} from './lib/types';

const LS_TRANSFERS = 'dpem_transfers_v2';
const LS_OVERRIDES = 'dpem_overrides_v2';
const LS_MY_HOME = 'dpem_my_home_v2';
const LS_API_URL = 'dpem_api_url_v2';
const LS_THEME = 'dpem_theme_v1';
const LS_VISITOR_ID = 'dpem_visitor_id_v1';
const LS_MERGED_LIGHT_DARK = 'dpem_merged_light_dark_v1';
const ADMIN_EMAIL = 'derevyov@gmail.com';

function getOrCreateVisitorId(): string {
  try {
    const existing = localStorage.getItem(LS_VISITOR_ID);
    if (existing && /^[a-zA-Z0-9_-]{6,64}$/.test(existing)) return existing;
    const next = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(LS_VISITOR_ID, next);
    return next;
  } catch {
    return `v_${Math.random().toString(36).slice(2, 12)}`;
  }
}

function loadJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getCurrentHalfHourSlot(): number {
  const now = new Date();
  return now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
}

function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function pickPreferredDate(scheduleByDate: ScheduleByDate): string {
  const today = getTodayIsoDate();
  if (scheduleByDate[today]) return today;
  const dates = Object.keys(scheduleByDate).sort().reverse();
  return dates[0] || today;
}

function formatCurrentClockTime(date = new Date()): string {
  return date.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function isSafeApiUrl(raw: string): boolean {
  if (!raw) return true;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export default function App() {
  const fallbackSeed = useMemo(() => getFallbackSeedPayload(), []);

  // App Mode: View | Edit | Admin
  const [appMode, setAppMode] = useState<AppMode>('view');

  // Theme state (Light / Dark) synced to <html class="dark">
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem(LS_THEME);
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  // Active Page: Map vs Dedicated Favorites Watch Page vs Analytics Page
  const [activePage, setActivePage] = useState<'map' | 'favorites' | 'analytics'>('map');
  const [analyticsWindow, setAnalyticsWindow] = useState<AnalyticsWindow>('7d');
  const [analyticsArchive, setAnalyticsArchive] = useState<OutageAnalyticsPayload>(() =>
    loadLocalAnalyticsArchive()
  );
  const [loadingAnalytics, setLoadingAnalytics] = useState<boolean>(false);
  const [mergedLightDark, setMergedLightDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(LS_MERGED_LIGHT_DARK);
      return saved === null ? true : saved === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0b1120' : '#ffffff');
    }
    syncTelegramThemeColors(theme);
    try {
      localStorage.setItem(LS_THEME, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_MERGED_LIGHT_DARK, mergedLightDark ? '1' : '0');
    } catch {
      // ignore
    }
  }, [mergedLightDark]);

  // Telegram Mini App & Telegram Login state (session token held strictly in React memory)
  const [telegramUser, setTelegramUser] = useState<TelegramUserProfile | null>(null);
  const [telegramSessionToken, setTelegramSessionToken] = useState<string | null>(null);
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);

  // Firebase Auth, RBAC & Cloud Firestore state
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [myRoleRecord, setMyRoleRecord] = useState<UserRoleRecord | null>(null);
  const [userRoles, setUserRoles] = useState<UserRoleRecord[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequestRecord[]>([]);
  const [accessControlOpen, setAccessControlOpen] = useState<boolean>(false);
  const [cloudConnected, setCloudConnected] = useState<boolean>(false);
  const [cloudTransfers, setCloudTransfers] = useState<FeederTransfer[]>([]);
  const [cloudOverrides, setCloudOverrides] = useState<Record<string, BuildingOverride>>({});
  const [cloudManualPoints, setCloudManualPoints] = useState<ManualPoint[]>([]);
  const [serverManualPoints, setServerManualPoints] = useState<ManualPoint[]>([]);
  const [cloudAssignmentHistory, setCloudAssignmentHistory] = useState<AssignmentHistoryEntry[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [serverAuditStats, setServerAuditStats] = useState<ServerAuditStats | null>(null);
  const [archivedAuditVisits, setArchivedAuditVisits] = useState<ServerAuditVisit[]>([]);
  const [loadingAuditStats, setLoadingAuditStats] = useState<boolean>(false);
  const [auditDashboardOpen, setAuditDashboardOpen] = useState<boolean>(false);

  const isSuperAdmin = Boolean(
    authUser && authUser.emailVerified && authUser.email === ADMIN_EMAIL
  );

  const effectiveRole: EffectiveRoleName = useMemo(() => {
    if (isSuperAdmin) return 'super_admin';
    if (!authUser || !authUser.emailVerified) return 'viewer';
    if (myRoleRecord?.status === 'banned') return 'banned';
    if (myRoleRecord?.role === 'admin' && myRoleRecord.status === 'active') return 'admin';
    if (myRoleRecord?.role === 'editor' && myRoleRecord.status === 'active') return 'editor';
    return 'viewer';
  }, [isSuperAdmin, authUser, myRoleRecord]);

  const isAdminUser = effectiveRole === 'super_admin' || effectiveRole === 'admin';
  const pendingAccessRequestsCount = useMemo(
    () => accessRequests.filter((r) => r.status === 'pending').length,
    [accessRequests]
  );

  // Core DPEM schedule & feeder rows state
  const [scheduleByDate, setScheduleByDate] = useState<ScheduleByDate>(
    fallbackSeed.scheduleByDate
  );
  const [feederRows, setFeederRows] = useState<FeederRow[]>(fallbackSeed.feederRows);
  const [operOutages, setOperOutages] = useState<OutageNotice[]>([]);
  const [emergencyOutages, setEmergencyOutages] = useState<OutageNotice[]>([]);
  const [plannedOutages, setPlannedOutages] = useState<OutageNotice[]>([]);
  const [autoTransfers, setAutoTransfers] = useState<FeederTransfer[]>([]);
  const [operUpdatedAt, setOperUpdatedAt] = useState<string | null>(null);
  const [dataSourceLabel, setDataSourceLabel] = useState<string>('Базовий довідник ДПЕМ');
  const [isPolling, setIsPolling] = useState<boolean>(false);

  // Selection & timeline state
  const availableDates = useMemo(
    () => Object.keys(scheduleByDate).sort().reverse(),
    [scheduleByDate]
  );
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    pickPreferredDate(fallbackSeed.scheduleByDate)
  );
  const userPickedDateRef = useRef<boolean>(false);
  const [customShiftSlots, setCustomShiftSlots] = useState<number | null>(null);
  const [timeSlot, setTimeSlot] = useState<number>(() => getCurrentHalfHourSlot());
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Filters & Mobile toolbar collapse
  const [selectedQueue, setSelectedQueue] = useState<SubqueueId | null>(null);
  const [selectedFeeder, setSelectedFeeder] = useState<string>('');
  const [dualMode, setDualMode] = useState<GlobalDualMode>('split');
  const [onlyDualHighlight, setOnlyDualHighlight] = useState<boolean>(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState<boolean>(false);

  // Chrome IndexedDB + localStorage Favorites, Manual Points, and Separate Assignment History
  const [favorites, setFavorites] = useState<FavoriteAddress[]>(() => readFavoritesSync());
  const [manualPoints, setManualPoints] = useState<ManualPoint[]>(() =>
    readManualPointsSync()
  );
  const [assignmentHistory, setAssignmentHistory] = useState<AssignmentHistoryEntry[]>(() =>
    readAssignmentHistorySync()
  );
  const [pickMode, setPickMode] = useState<boolean>(false);
  const [pendingPickCoords, setPendingPickCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  useEffect(() => {
    void loadFavoritesFromBrowserDb().then((list) => {
      if (list.length > 0) setFavorites(list);
    });
    void loadManualPointsAndHistory().then(({ points, history }) => {
      if (points.length > 0) setManualPoints(points);
      if (history.length > 0) setAssignmentHistory(history);
    });
  }, []);

  // Local fallback user state
  const [localTransfers, setLocalTransfers] = useState<FeederTransfer[]>(() =>
    loadJsonStorage<FeederTransfer[]>(LS_TRANSFERS, [])
  );
  const [localOverrides, setLocalOverrides] = useState<Record<string, BuildingOverride>>(() =>
    loadJsonStorage<Record<string, BuildingOverride>>(
      LS_OVERRIDES,
      defaultOverridesData as Record<string, BuildingOverride>
    )
  );
  const [myHomeKey, setMyHomeKey] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_MY_HOME) || null;
    } catch {
      return null;
    }
  });
  const [apiUrl, setApiUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_API_URL) || '';
    } catch {
      return '';
    }
  });
  // Optimized default: 10 minutes + skips when tab is hidden (minimal quota usage on free hosting)
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(600_000);

  // Map & UI state
  const mapRef = useRef<MapCanvasHandle | null>(null);
  const htmlFileInputRef = useRef<HTMLInputElement | null>(null);
  const [buildings, setBuildings] = useState<BuildingRecord[]>([]);
  const [osmStats, setOsmStats] = useState({
    osmCount: 0,
    googleCount: 0,
    substationCount: 0,
    fromCache: false,
  });
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingRecord | null>(null);
  const [diffLog, setDiffLog] = useState<DiffLogEntry[]>([]);
  const [renderMeta, setRenderMeta] = useState<{ rev: number; reason: string }>({
    rev: 0,
    reason: 'Ініціалізація',
  });

  // Search autocomplete
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchFocused, setSearchFocused] = useState<boolean>(false);

  // Sidebar & notifications
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('overview');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [transferDraft, setTransferDraft] = useState<{ street: string; houses: string }>({
    street: '',
    houses: '',
  });
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);

  const showToast = useCallback((text: string, tone: 'info' | 'warn' = 'info') => {
    setToast({ text, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const triggerDiffRender = useCallback((reason: string) => {
    setRenderMeta((prev) => ({ rev: prev.rev + 1, reason }));
  }, []);

  const appendAssignmentHistory = useCallback(
    async (
      entry: Omit<
        AssignmentHistoryEntry,
        'id' | 'timestamp' | 'authorUid' | 'authorName' | 'isCloud'
      >
    ) => {
      if (authUser) {
        try {
          await createSharedHistoryEntry(entry);
          return;
        } catch {
          // Fallback to local journal below
        }
      }

      const full: AssignmentHistoryEntry = {
        ...entry,
        id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        isCloud: false,
      };
      setAssignmentHistory((prev) => {
        const next = [full, ...prev].slice(0, 200);
        void persistAssignmentHistory(next);
        return next;
      });
    },
    [authUser]
  );

  // Switch active sidebar tab cleanly when switching AppMode
  const handleModeChange = (nextMode: AppMode) => {
    setAppMode(nextMode);
    if (nextMode === 'view' && (sidebarTab === 'transfers' || sidebarTab === 'admin')) {
      setSidebarTab('overview');
    } else if (nextMode === 'edit' && sidebarTab === 'admin') {
      setSidebarTab('transfers');
    } else if (nextMode === 'admin') {
      setSidebarTab('admin');
      if (window.innerWidth < 1024) setMobileSidebarOpen(true);
    }
  };

  // Initialize Telegram Mini App SDK (theme, expand, disableVerticalSwipes, start_param, HMAC verify)
  useEffect(() => {
    const { webApp, unsafeProfile, startQueue } = initTelegramMiniApp(theme);
    if (webApp) {
      let hasSavedTheme = false;
      try {
        hasSavedTheme = localStorage.getItem(LS_THEME) !== null;
      } catch {
        // ignore
      }
      if (!hasSavedTheme && (webApp.colorScheme === 'light' || webApp.colorScheme === 'dark')) {
        setTheme(webApp.colorScheme);
      }
      if (startQueue) {
        setSelectedQueue(startQueue);
      }
      if (unsafeProfile) {
        setTelegramUser(unsafeProfile);
      }
      if (webApp.initData) {
        void verifyTelegramMiniAppInitData(webApp.initData).then((res) => {
          if (res.verified && res.user && res.token) {
            setTelegramUser(res.user);
            setTelegramSessionToken(res.token);
          }
        });
      }
    }

    void fetchTelegramAuthConfig().then((cfg) => {
      if (cfg.enabled && cfg.botUsername) {
        setTelegramBotUsername(cfg.botUsername);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Telegram native BackButton closes topmost page/modal/drawer cleanly
  useEffect(() => {
    const wa = getTelegramWebApp();
    if (!wa?.BackButton) return;

    const hasOverlay =
      activePage !== 'map' ||
      accessControlOpen ||
      auditDashboardOpen ||
      mobileSidebarOpen ||
      Boolean(pendingPickCoords) ||
      Boolean(selectedBuilding);

    if (!hasOverlay) {
      wa.BackButton.hide();
      return;
    }

    const handleBack = () => {
      triggerTelegramHaptic('light');
      if (accessControlOpen) setAccessControlOpen(false);
      else if (auditDashboardOpen) setAuditDashboardOpen(false);
      else if (pendingPickCoords) {
        setPendingPickCoords(null);
        setPickMode(false);
      } else if (selectedBuilding) setSelectedBuilding(null);
      else if (mobileSidebarOpen) setMobileSidebarOpen(false);
      else if (activePage !== 'map') setActivePage('map');
    };

    wa.BackButton.show();
    wa.BackButton.onClick(handleBack);
    return () => {
      wa.BackButton?.offClick(handleBack);
    };
  }, [
    activePage,
    accessControlOpen,
    auditDashboardOpen,
    mobileSidebarOpen,
    pendingPickCoords,
    selectedBuilding,
  ]);

  // Subscribe to Firebase Auth
  useEffect(() => {
    const unsub = subscribeAuth((user) => {
      setAuthUser(user);
      if (!user) {
        setMyRoleRecord(null);
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to own RBAC role record & access requests when signed in
  useEffect(() => {
    if (!authUser || !authUser.emailVerified) {
      setMyRoleRecord(null);
      setAccessRequests([]);
      return;
    }
    const unsubMyRole = subscribeMyUserRole(authUser.uid, setMyRoleRecord, () => {});
    const unsubReqs = subscribeAccessRequests(setAccessRequests, () => {});
    return () => {
      unsubMyRole();
      unsubReqs();
    };
  }, [authUser]);

  // Subscribe to full team roles list ONLY for admins or when Access Control modal is open
  useEffect(() => {
    if (!authUser || !authUser.emailVerified) {
      setUserRoles([]);
      return;
    }
    if (!isAdminUser && !accessControlOpen) return;
    const unsub = subscribeAllUserRoles(setUserRoles, () => {});
    return () => unsub();
  }, [authUser, isAdminUser, accessControlOpen]);

  // Ultra-lightweight visit beacon: max 1 POST per session (anonymous), +1 POST when authenticated (Google or Telegram)
  const sentAuthKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const visitorId = getOrCreateVisitorId();
    const authIdentity = authUser
      ? `g:${authUser.uid}`
      : telegramUser?.verified
      ? `tg:${telegramUser.id}`
      : null;

    if (authIdentity) {
      if (sentAuthKeyRef.current === authIdentity) return;
      sentAuthKeyRef.current = authIdentity;

      const authProvider: 'google' | 'telegram' = authUser ? 'google' : 'telegram';
      const authLabel = authUser
        ? authUser.email
          ? authUser.displayName
            ? `${authUser.displayName} (${authUser.email})`
            : authUser.email
          : authUser.displayName || 'Google'
        : telegramUser
        ? `${[telegramUser.firstName, telegramUser.lastName].filter(Boolean).join(' ').trim() || 'Telegram'}${
            telegramUser.username ? ` (@${telegramUser.username})` : ''
          } · ID ${telegramUser.id}`
        : undefined;

      void fetch('/api/audit/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId,
          isAuthenticated: true,
          authProvider,
          authLabel,
        }),
      }).catch(() => {});

      if (authUser) {
        const loginSessionKey = `dpem_audit_login_${authUser.uid}`;
        try {
          if (!sessionStorage.getItem(loginSessionKey)) {
            sessionStorage.setItem(loginSessionKey, '1');
            void logSharedAuditEvent(
              'login',
              `Вхід Google: ${authUser.displayName || 'Користувач'}${
                authUser.email ? ` (${authUser.email})` : ''
              }`
            );
          }
        } catch {
          // ignore
        }
      }
      return;
    }

    const anonSessionKey = 'dpem_audit_anon_sent';
    try {
      if (sessionStorage.getItem(anonSessionKey)) return;
      sessionStorage.setItem(anonSessionKey, '1');
    } catch {
      // continue
    }
    void fetch('/api/audit/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, isAuthenticated: false }),
    }).catch(() => {});
  }, [authUser, telegramUser]);

  // Fetch server visit stats + merge & backup with permanent Firestore daily visit archives
  const refreshAuditStats = useCallback(async () => {
    setLoadingAuditStats(true);
    try {
      const headers: Record<string, string> = {};
      if (isSuperAdmin) {
        const fbToken = await getFirebaseIdToken();
        if (fbToken) headers['X-Firebase-Token'] = fbToken;
      }
      if (telegramSessionToken) {
        headers.Authorization = `Bearer ${telegramSessionToken}`;
      }

      const [liveRes, cloudVisits] = await Promise.all([
        fetch('/api/audit/stats', { cache: 'no-store', headers }).catch(() => null),
        isSuperAdmin ? loadAuditVisitArchives(14).catch(() => []) : Promise.resolve([]),
      ]);

      let liveData: ServerAuditStats | null = null;
      if (liveRes && liveRes.ok) {
        liveData = (await liveRes.json()) as ServerAuditStats;
        setServerAuditStats(liveData);
      }

      if (isSuperAdmin) {
        if (cloudVisits.length > 0) {
          setArchivedAuditVisits(cloudVisits);
        }
        if (liveData && Array.isArray(liveData.visits) && liveData.visits.length > 0) {
          void syncAuditVisitArchives(liveData.visits).then(async () => {
            const refreshed = await loadAuditVisitArchives(14).catch(() => []);
            if (refreshed.length > 0) {
              setArchivedAuditVisits(refreshed);
            }
          });
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingAuditStats(false);
    }
  }, [isSuperAdmin, telegramSessionToken]);

  useEffect(() => {
    if (sidebarTab === 'admin' || auditDashboardOpen) {
      void refreshAuditStats();
    }
  }, [sidebarTab, auditDashboardOpen, refreshAuditStats]);

  // Continuous background cloud archival for Super Admin so visits survive Render container redeploys
  useEffect(() => {
    if (!isSuperAdmin) return;
    void refreshAuditStats();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshAuditStats();
      }
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [isSuperAdmin, refreshAuditStats]);

  // Merge ephemeral Render server visits + permanent Firestore daily visit archives
  const mergedAuditStats = useMemo<ServerAuditStats | null>(() => {
    const liveVisits = serverAuditStats?.visits || [];
    if (!serverAuditStats && archivedAuditVisits.length === 0) return null;

    const now = Date.now();
    const cutoff = now - 14 * 24 * 60 * 60 * 1000;
    const activeCutoff = now - 15 * 60 * 1000;

    const dedup = new Map<string, ServerAuditVisit>();
    for (const v of [...archivedAuditVisits, ...liveVisits]) {
      if (!Number.isFinite(v.ts) || v.ts < cutoff) continue;
      const fp = `${Math.floor(v.ts / 60_000)}|${v.isAuthenticated ? '1' : '0'}|${v.visitorTag}`;
      const existing = dedup.get(fp);
      if (!existing || (!existing.authLabel && v.authLabel)) {
        dedup.set(fp, v);
      }
    }

    const visits = Array.from(dedup.values())
      .sort((a, b) => a.ts - b.ts)
      .slice(-2000);

    const loggedInVisitors = new Set<string>();
    const anonVisitors = new Set<string>();
    const activeLoggedIn = new Set<string>();
    const activeAnon = new Set<string>();
    let totalAnonymousVisits = 0;
    let totalLoggedInVisits = 0;

    for (const v of visits) {
      if (v.isAuthenticated) {
        totalLoggedInVisits++;
        loggedInVisitors.add(v.visitorTag);
        if (v.ts >= activeCutoff) activeLoggedIn.add(v.visitorTag);
      } else {
        totalAnonymousVisits++;
        anonVisitors.add(v.visitorTag);
        if (v.ts >= activeCutoff) activeAnon.add(v.visitorTag);
      }
    }

    for (const tag of loggedInVisitors) {
      anonVisitors.delete(tag);
    }
    for (const tag of activeLoggedIn) {
      activeAnon.delete(tag);
    }

    return {
      uniqueAnonymous: Math.max(anonVisitors.size, serverAuditStats?.uniqueAnonymous || 0),
      uniqueLoggedIn: Math.max(loggedInVisitors.size, serverAuditStats?.uniqueLoggedIn || 0),
      totalAnonymousVisits: Math.max(totalAnonymousVisits, serverAuditStats?.totalAnonymousVisits || 0),
      totalLoggedInVisits: Math.max(totalLoggedInVisits, serverAuditStats?.totalLoggedInVisits || 0),
      activeLast15mAnon: Math.max(activeAnon.size, serverAuditStats?.activeLast15mAnon || 0),
      activeLast15mLoggedIn: Math.max(activeLoggedIn.size, serverAuditStats?.activeLast15mLoggedIn || 0),
      visits,
    };
  }, [serverAuditStats, archivedAuditVisits]);

  // Attach admin-only Firestore auditEvents listener ONLY when Super Admin views Admin/Audit
  useEffect(() => {
    if (!isSuperAdmin || (!auditDashboardOpen && sidebarTab !== 'admin')) return;
    const unsub = subscribeAuditEvents(
      (list) => setAuditEvents(list),
      () => {
        // Non-fatal fallback
      }
    );
    return () => unsub();
  }, [isSuperAdmin, auditDashboardOpen, sidebarTab]);

  // Subscribe to shared Firestore collections
  useEffect(() => {
    const unsubTransfers = subscribeSharedTransfers(
      (list) => {
        setCloudConnected(true);
        setCloudTransfers(list);
        triggerDiffRender('Синхронізація Firestore (переноси)');
      },
      () => {
        setCloudConnected(false);
      }
    );

    const unsubOverrides = subscribeSharedOverrides(
      (map) => {
        setCloudConnected(true);
        setCloudOverrides(map);
        triggerDiffRender('Синхронізація Firestore (колізії)');
      },
      () => {
        setCloudConnected(false);
      }
    );

    const unsubManualPoints = subscribeSharedManualPoints(
      (list) => {
        setCloudConnected(true);
        setCloudManualPoints(list);
        triggerDiffRender('Синхронізація Firestore (вказані точки)');
      },
      () => {
        // Keep local fallback
      }
    );

    const unsubHistory = subscribeSharedAssignmentHistory(
      (list) => {
        setCloudConnected(true);
        setCloudAssignmentHistory(list);
      },
      () => {
        // Keep local fallback
      }
    );

    return () => {
      unsubTransfers();
      unsubOverrides();
      unsubManualPoints();
      unsubHistory();
    };
  }, [triggerDiffRender]);

  // Subscribe to private per-user home address + favorites across all devices on the same Google account
  const cloudFavsHydratedUidRef = useRef<string | null>(null);
  const favoritesLatestRef = useRef<FavoriteAddress[]>(favorites);
  favoritesLatestRef.current = favorites;
  const myHomeKeyLatestRef = useRef<string | null>(myHomeKey);
  myHomeKeyLatestRef.current = myHomeKey;

  useEffect(() => {
    if (!authUser) {
      cloudFavsHydratedUidRef.current = null;
      return;
    }
    const uid = authUser.uid;
    const unsub = subscribeUserPrefs(uid, ({ myHomeKey: savedHome, favorites: cloudFavs }) => {
      if (savedHome) {
        setMyHomeKey(savedHome);
        try {
          localStorage.setItem(LS_MY_HOME, savedHome);
        } catch {
          // ignore
        }
        triggerDiffRender('Синхронізація Мій дім');
      }

      const isFirstHydration = cloudFavsHydratedUidRef.current !== uid;
      cloudFavsHydratedUidRef.current = uid;

      if (cloudFavs === null) {
        // First time this account syncs favorites: push any existing local favorites to Firestore
        const local = favoritesLatestRef.current;
        if (local.length > 0) {
          void saveUserFavoritesPref(uid, local, savedHome || myHomeKeyLatestRef.current || '').catch(
            () => {}
          );
        }
        return;
      }

      if (isFirstHydration) {
        // Merge union on initial sign-in so locally starred items before sign-in are preserved
        const local = favoritesLatestRef.current;
        const cloudKeys = new Set(cloudFavs.map((f) => f.key));
        const localOnly = local.filter((f) => !cloudKeys.has(f.key));
        const mergedFavs = [...cloudFavs, ...localOnly].slice(0, 30);
        setFavorites(mergedFavs);
        void persistFavoritesToBrowserDb(mergedFavs);
        if (localOnly.length > 0) {
          void saveUserFavoritesPref(
            uid,
            mergedFavs,
            savedHome || myHomeKeyLatestRef.current || ''
          ).catch(() => {});
        }
      } else {
        // Subsequent live updates from another device on the same account
        setFavorites(cloudFavs);
        void persistFavoritesToBrowserDb(cloudFavs);
      }
    });
    return () => unsub();
  }, [authUser, triggerDiffRender]);

  // Merge cloud + local state (shared Firestore takes precedence)
  const mergedTransfers = useMemo(() => {
    const seen = new Set(cloudTransfers.map((t) => t.id));
    return [...cloudTransfers, ...localTransfers.filter((t) => !seen.has(t.id))];
  }, [cloudTransfers, localTransfers]);

  const mergedOverrides = useMemo(
    () => ({
      ...localOverrides,
      ...cloudOverrides,
    }),
    [localOverrides, cloudOverrides]
  );

  // Load public community manual points from server (shared across Telegram Mini App & browser visitors)
  const refreshServerManualPoints = useCallback(async () => {
    try {
      const res = await fetch('/api/manual-points', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { points?: ManualPoint[] };
      if (Array.isArray(data?.points)) {
        setServerManualPoints(data.points);
      }
    } catch {
      // Offline — keep existing points
    }
  }, []);

  useEffect(() => {
    void refreshServerManualPoints();
  }, [refreshServerManualPoints]);

  // Auto-promote community manual points created via Telegram/guest into permanent Firestore storage
  const promotedPointIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isSuperAdmin || !cloudConnected || serverManualPoints.length === 0) return;
    for (const sp of serverManualPoints) {
      if (promotedPointIdsRef.current.has(sp.id)) continue;
      const mLat = 111_132;
      const mLng = 111_320 * Math.cos((sp.lat * Math.PI) / 180);
      const alreadyInCloud = cloudManualPoints.some(
        (cp) =>
          cp.id === sp.id ||
          Math.hypot((cp.lat - sp.lat) * mLat, (cp.lng - sp.lng) * mLng) < 15
      );
      promotedPointIdsRef.current.add(sp.id);
      if (!alreadyInCloud) {
        void createSharedManualPoint({
          label: sp.label,
          queue: sp.queue,
          feeder: sp.feeder,
          note: sp.note,
          lat: sp.lat,
          lng: sp.lng,
        }).catch(() => {});
      }
    }
  }, [isSuperAdmin, cloudConnected, serverManualPoints, cloudManualPoints]);

  const mergedManualPoints = useMemo(() => {
    const seenIds = new Set<string>();
    const combined: ManualPoint[] = [];
    for (const src of [cloudManualPoints, serverManualPoints, manualPoints]) {
      for (const p of src) {
        if (seenIds.has(p.id)) continue;
        seenIds.add(p.id);
        combined.push(p);
      }
    }
    return combined.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [cloudManualPoints, serverManualPoints, manualPoints]);

  const mergedAssignmentHistory = useMemo(() => {
    const seen = new Set(cloudAssignmentHistory.map((h) => h.id));
    return [...cloudAssignmentHistory, ...assignmentHistory.filter((h) => !seen.has(h.id))]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 200);
  }, [cloudAssignmentHistory, assignmentHistory]);

  // Derived address index & resolver context
  const addressIndex = useMemo(() => buildAddressIndex(feederRows), [feederRows]);
  const allActiveTransfers = useMemo(
    () => [...mergedTransfers, ...autoTransfers],
    [mergedTransfers, autoTransfers]
  );
  const resolverCtx = useMemo(
    () => ({
      index: addressIndex,
      overrides: mergedOverrides,
      transfers: allActiveTransfers,
    }),
    [addressIndex, mergedOverrides, allActiveTransfers]
  );

  const unifiedDaySchedules = useMemo(
    () => buildUnifiedDaySchedules(scheduleByDate, analyticsArchive.days),
    [scheduleByDate, analyticsArchive.days]
  );

  const shiftModel = useMemo(
    () => detectScheduleShiftModel(unifiedDaySchedules),
    [unifiedDaySchedules]
  );

  const selectedDayForecast = useMemo(
    () =>
      resolveScheduleOrForecastForDate(
        selectedDate,
        unifiedDaySchedules,
        shiftModel,
        customShiftSlots
      ),
    [selectedDate, unifiedDaySchedules, shiftModel, customShiftSlots]
  );

  const currentQueuesMap = useMemo(
    () =>
      selectedDayForecast?.queues ||
      scheduleByDate[selectedDate]?.queues ||
      ({} as Partial<Record<SubqueueId, SlotState[]>>),
    [selectedDayForecast, scheduleByDate, selectedDate]
  );

  const refreshOutageAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    try {
      const [serverRes, cloudDays] = await Promise.all([
        fetch('/api/analytics/outages', { cache: 'no-store' })
          .then((r) => (r.ok ? (r.json() as Promise<OutageAnalyticsPayload>) : null))
          .catch(() => null),
        loadCloudAnalyticsArchive().catch(() => []),
      ]);
      setAnalyticsArchive((prev) => {
        const merged = mergeAnalyticsArchives(
          prev,
          serverRes,
          cloudDays.length > 0
            ? { updatedAt: new Date().toISOString(), days: cloudDays, streetIncidents: [] }
            : null
        );
        saveLocalAnalyticsArchive(merged);
        return merged;
      });
    } catch {
      // keep local archive
    } finally {
      setLoadingAnalytics(false);
    }
  }, []);

  useEffect(() => {
    void refreshOutageAnalytics();
  }, [refreshOutageAnalytics]);

  useEffect(() => {
    const liveDays = snapshotFromSchedule(scheduleByDate, 'live');
    if (liveDays.length === 0) return;
    setAnalyticsArchive((prev) => {
      const merged = mergeAnalyticsArchives(prev, {
        updatedAt: new Date().toISOString(),
        days: liveDays,
        streetIncidents: [],
      });
      saveLocalAnalyticsArchive(merged);
      return merged;
    });
  }, [scheduleByDate]);

  // Super Admin auto-persists daily 48-slot schedules to Firestore so pattern history survives Render deploys
  const lastCloudAnalyticsSigRef = useRef<string>('');
  useEffect(() => {
    if (!isSuperAdmin || !cloudConnected) return;
    const daysWithMasks = analyticsArchive.days.filter(
      (d) => d.queueOffSlotMask && Object.keys(d.queueOffSlotMask).length > 0
    );
    if (daysWithMasks.length === 0) return;
    const sig = daysWithMasks
      .map((d) => `${d.date}:${d.source}:${Object.keys(d.queueOffSlotMask || {}).length}`)
      .join('|');
    if (sig === lastCloudAnalyticsSigRef.current) return;
    lastCloudAnalyticsSigRef.current = sig;
    void syncCloudAnalyticsArchive(daysWithMasks);
  }, [isSuperAdmin, cloudConnected, analyticsArchive.days]);

  // Sync resolved favorites to Telegram bot backend whenever signed in via Telegram
  const lastTgFavSyncSigRef = useRef<string>('');
  useEffect(() => {
    if (!telegramSessionToken) return;
    const buildingByKey = new Map<string, BuildingRecord>();
    for (const b of buildings) buildingByKey.set(b.key, b);
    const manualByKey = new Map<string, ManualPoint>();
    for (const mp of mergedManualPoints) manualByKey.set(`manual|${mp.id}`, mp);

    const payloadItems: Array<{
      label: string;
      queue: SubqueueId;
      secondaryQueue?: SubqueueId;
      dualType?: 'none' | 'backup' | 'split_entrances' | 'split_lifts';
      isHome?: boolean;
    }> = [];

    const pushFromFav = (fav: FavoriteAddress) => {
      const mp = manualByKey.get(fav.key);
      const b = buildingByKey.get(fav.key);
      const resolved = !mp
        ? resolveBuilding(b?.street || fav.street, b?.house || fav.house, resolverCtx)
        : null;
      const queue = mp?.queue || resolved?.primary || fav.queue;
      if (!queue) return;
      const secondaryQueue =
        !mp && resolved?.secondary && resolved.secondary !== queue ? resolved.secondary : undefined;
      const dualType = secondaryQueue ? resolved?.dualType : undefined;
      const addrTitle =
        fav.note.trim() ||
        fav.label ||
        `${fav.street}${fav.house ? `, ${fav.house}` : ''}`.trim();
      payloadItems.push({
        label: addrTitle.slice(0, 72),
        queue,
        ...(secondaryQueue ? { secondaryQueue } : {}),
        ...(dualType && dualType !== 'none' ? { dualType } : {}),
        ...(myHomeKey === fav.key ? { isHome: true } : {}),
      });
    };

    for (const fav of favorites.slice(0, 15)) {
      pushFromFav(fav);
    }

    // If "My Home" is set but not yet in favorites, include it first for the bot
    if (myHomeKey && !favorites.some((f) => f.key === myHomeKey)) {
      const homeBuilding = buildingByKey.get(myHomeKey);
      const homeManual = manualByKey.get(myHomeKey);
      if (homeManual) {
        payloadItems.unshift({
          label: `Мій дім (${homeManual.label})`.slice(0, 72),
          queue: homeManual.queue,
          isHome: true,
        });
      } else if (homeBuilding) {
        const res = resolveBuilding(homeBuilding.street, homeBuilding.house, resolverCtx);
        if (res?.primary) {
          payloadItems.unshift({
            label: `${homeBuilding.street}${homeBuilding.house ? `, ${homeBuilding.house}` : ''}`.slice(
              0,
              72
            ),
            queue: res.primary,
            ...(res.secondary && res.secondary !== res.primary
              ? { secondaryQueue: res.secondary, dualType: res.dualType }
              : {}),
            isHome: true,
          });
        }
      }
    }

    const sig = JSON.stringify(payloadItems);
    if (sig === lastTgFavSyncSigRef.current) return;
    // Do not overwrite bot-picked queues with an empty Mini App list on initial load
    if (payloadItems.length === 0 && lastTgFavSyncSigRef.current === '') return;
    lastTgFavSyncSigRef.current = sig;

    void fetch('/api/telegram/favorites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${telegramSessionToken}`,
      },
      body: JSON.stringify({ favorites: payloadItems.slice(0, 15) }),
    }).catch(() => {
      // Non-blocking sync
    });
  }, [telegramSessionToken, favorites, myHomeKey, buildings, mergedManualPoints, resolverCtx]);

  const computedOutageAnalytics = useMemo(
    () =>
      computeOutageAnalytics({
        window: analyticsWindow,
        includeSwitches: mergedLightDark,
        archive: analyticsArchive,
        scheduleByDate,
        feederRows,
        buildings,
        operOutages,
        emergencyOutages,
        plannedOutages,
        transfers: allActiveTransfers,
        overrides: mergedOverrides,
        assignmentHistory: mergedAssignmentHistory,
      }),
    [
      analyticsWindow,
      mergedLightDark,
      analyticsArchive,
      scheduleByDate,
      feederRows,
      buildings,
      operOutages,
      emergencyOutages,
      plannedOutages,
      allActiveTransfers,
      mergedOverrides,
      mergedAssignmentHistory,
    ]
  );

  const visualOpts = useMemo(
    () => ({
      queuesMap: currentQueuesMap,
      slot: timeSlot,
      dualMode,
      selectedQueue,
      selectedFeeder,
      onlyDualHighlight,
      mergedLightDark,
    }),
    [
      currentQueuesMap,
      timeSlot,
      dualMode,
      selectedQueue,
      selectedFeeder,
      onlyDualHighlight,
      mergedLightDark,
    ]
  );

  // Persist local settings
  useEffect(() => {
    try {
      localStorage.setItem(LS_TRANSFERS, JSON.stringify(localTransfers));
    } catch {
      // ignore
    }
  }, [localTransfers]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_OVERRIDES, JSON.stringify(localOverrides));
    } catch {
      // ignore
    }
  }, [localOverrides]);

  useEffect(() => {
    if (availableDates.length > 0 && (!selectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate))) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  // Poll DPEM proxy (/api/dpem or custom Cloudflare Worker URL)
  const pollDpemApi = useCallback(
    async (force = false) => {
      const targetEndpoint =
        apiUrl && isSafeApiUrl(apiUrl) ? apiUrl : `/api/dpem${force ? '?force=1' : ''}`;

      if (force) {
        setIsPlaying(false);
        setTimeSlot(getCurrentHalfHourSlot());
        userPickedDateRef.current = false;
      }

      setIsPolling(true);
      try {
        const res = await fetch(targetEndpoint);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Partial<DpemApiPayload>;

        if (data.scheduleByDate && Object.keys(data.scheduleByDate).length > 0) {
          const nextSchedule = data.scheduleByDate;
          setScheduleByDate(nextSchedule);
          const preferred = pickPreferredDate(nextSchedule);
          setSelectedDate((prev) => {
            if (force) return preferred;
            if (nextSchedule[prev]) return prev;
            if (userPickedDateRef.current && /^\d{4}-\d{2}-\d{2}$/.test(prev)) {
              return prev;
            }
            return preferred;
          });
        }
        if (Array.isArray(data.feederRows) && data.feederRows.length > 0) {
          setFeederRows(data.feederRows);
        }
        if (Array.isArray(data.operOutages)) setOperOutages(data.operOutages);
        if (Array.isArray(data.emergencyOutages)) setEmergencyOutages(data.emergencyOutages);
        if (Array.isArray(data.plannedOutages)) setPlannedOutages(data.plannedOutages);
        if (Array.isArray(data.autoTransfers)) setAutoTransfers(data.autoTransfers);
        if (data.operUpdatedAt !== undefined) setOperUpdatedAt(data.operUpdatedAt);

        const refreshedClock = formatCurrentClockTime();
        if (data.source === 'live') {
          setDataSourceLabel(`Live ДПЕМ · ${refreshedClock}`);
          if (force) showToast(`Дані ДПЕМ оновлено о ${refreshedClock}`);
        } else {
          setDataSourceLabel(`Базовий довідник ДПЕМ · ${refreshedClock}`);
          if (force && data.warning) showToast(data.warning, 'warn');
        }

        triggerDiffRender(force ? `Оновлення · ${refreshedClock}` : 'Автоопитування API');
      } catch {
        const refreshedClock = formatCurrentClockTime();
        setDataSourceLabel(`Локальний резерв ДПЕМ · ${refreshedClock}`);
        if (force) {
          showToast('Не вдалося підключитися до API — залишено локальний довідник', 'warn');
        }
        triggerDiffRender('Перевірка стану');
      } finally {
        setIsPolling(false);
      }
    },
    [apiUrl, showToast, triggerDiffRender]
  );

  useEffect(() => {
    void pollDpemApi(false);
  }, [pollDpemApi]);

  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    const timer = setInterval(() => {
      // Skip background polling while tab is hidden to save bandwidth & free hosting quota
      if (typeof document !== 'undefined' && document.hidden) return;
      void pollDpemApi(false);
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [pollIntervalMs, pollDpemApi]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setTimeSlot((prev) => (prev + 1) % 48);
      triggerDiffRender('Автопрокрутка дня');
    }, 650);
    return () => clearInterval(timer);
  }, [isPlaying, triggerDiffRender]);

  // Auth handlers
  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
      showToast('Вхід через Google виконано');
    } catch {
      showToast('Вхід скасовано або заблоковано браузером', 'warn');
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    showToast('Ви вийшли з акаунта Google');
  };

  // Upload local off_graf.html file (offline mode)
  const handleHtmlUpload = async (file: File) => {
    if (file.size > 6 * 1024 * 1024) {
      showToast('Файл завеликий (максимум 6 МБ)', 'warn');
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseDpemGrafHtml(text);
      setScheduleByDate(parsed.scheduleByDate);
      if (parsed.feederRows.length > 0) {
        setFeederRows(parsed.feederRows);
      }
      const dates = Object.keys(parsed.scheduleByDate).sort().reverse();
      if (dates[0]) setSelectedDate(dates[0]);
      setDataSourceLabel(`Локальний HTML · ${dates.length} дат`);
      triggerDiffRender('Завантажено локальний HTML');
      showToast(
        `HTML розпарсено: ${dates.length} дат, ${parsed.feederRows.length} рядків фідерів`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Помилка розбору HTML-файлу', 'warn');
    }
  };

  // Search autocomplete matches (includes manual points + favorites!)
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const normQ = normalizeStreet(q);

    const manualAsBuildings: BuildingRecord[] = mergedManualPoints.map((mp) => ({
      id: mp.id,
      key: `manual|${mp.id}`,
      street: mp.label,
      house: '',
      label: mp.label,
      source: 'manual',
      manualQueue: mp.queue,
      manualFeeder: mp.feeder,
      manualNote: mp.note,
      lat: mp.lat,
      lng: mp.lng,
    }));

    return [...manualAsBuildings, ...buildings]
      .filter((b) => {
        const raw = `${b.label || ''} ${b.street} ${b.house} ${b.manualNote || ''}`.toLowerCase();
        return raw.includes(q) || (normQ.length >= 2 && b.key.includes(normQ));
      })
      .slice(0, 10);
  }, [buildings, mergedManualPoints, searchQuery]);

  // Auto-detect nearest DPEM-mapped building when picking a manual point (within 150m)
  const nearestPickSuggestion = useMemo<NearestQueueSuggestion | null>(() => {
    if (!pendingPickCoords || buildings.length === 0) return null;
    const mLat = 111_132;
    const mLng = 111_320 * Math.cos((pendingPickCoords.lat * Math.PI) / 180);
    let best: NearestQueueSuggestion | null = null;
    let bestDist = 150;

    for (const b of buildings) {
      const dist = Math.hypot(
        (b.lat - pendingPickCoords.lat) * mLat,
        (b.lng - pendingPickCoords.lng) * mLng
      );
      if (dist >= bestDist) continue;
      const info = resolveBuilding(b.street, b.house, resolverCtx);
      if (!info?.primary) continue;
      bestDist = dist;
      best = {
        queue: info.primary,
        feeder: info.feeder || '',
        addressLabel: b.label || `${b.street}${b.house ? `, ${b.house}` : ''}`,
        distanceMeters: Math.max(1, Math.round(dist)),
      };
    }

    return best;
  }, [pendingPickCoords, buildings, resolverCtx]);

  // Favorites CRUD (Browser IndexedDB + localStorage + Firestore cloud sync when signed in)
  const commitFavoritesUpdate = useCallback(
    (updater: (prev: FavoriteAddress[]) => FavoriteAddress[]) => {
      setFavorites((prev) => {
        const next = updater(prev).slice(0, 30);
        void persistFavoritesToBrowserDb(next);
        if (authUser) {
          void saveUserFavoritesPref(authUser.uid, next, myHomeKey || '').catch(() => {});
        }
        return next;
      });
    },
    [authUser, myHomeKey]
  );

  const handleSaveFavorite = (b: BuildingRecord, note: string) => {
    const resolved =
      b.source === 'manual'
        ? null
        : b.currentVisual?.info || resolveBuilding(b.street, b.house, resolverCtx);
    const item: FavoriteAddress = {
      id: `fav_${Date.now()}`,
      key: b.key,
      buildingId: b.id,
      street: b.street,
      house: b.house,
      label: b.label,
      note: note.slice(0, 120),
      queue: b.source === 'manual' ? b.manualQueue : resolved?.primary,
      feeder: b.source === 'manual' ? b.manualFeeder : resolved?.feeder,
      lat: b.lat,
      lng: b.lng,
      savedAt: new Date().toISOString(),
    };
    commitFavoritesUpdate((prev) => [item, ...prev.filter((x) => x.key !== b.key)]);
    showToast(`Збережено в обрані${note ? ` (${note})` : ''}`);
  };

  const handleUpdateFavoriteNote = (key: string, note: string) => {
    commitFavoritesUpdate((prev) =>
      prev.map((f) => (f.key === key ? { ...f, note: note.slice(0, 120) } : f))
    );
    showToast('Примітку оновлено');
  };

  const handleRemoveFavorite = (key: string) => {
    commitFavoritesUpdate((prev) => prev.filter((f) => f.key !== key));
    showToast('Видалено з обраних');
  };

  // Manual Point Picking (always deduplicated within 15m and published publicly for all users)
  const handleSaveManualPoint = async (input: {
    label: string;
    queue: SubqueueId;
    feeder: string;
    note: string;
    addToFavorites: boolean;
  }) => {
    if (!pendingPickCoords) return;

    const mLat = 111_132;
    const mLng = 111_320 * Math.cos((pendingPickCoords.lat * Math.PI) / 180);
    const existingNearby = mergedManualPoints.find(
      (p) =>
        Math.hypot(
          (p.lat - pendingPickCoords.lat) * mLat,
          (p.lng - pendingPickCoords.lng) * mLng
        ) < 15
    );

    if (existingNearby) {
      if (input.addToFavorites) {
        const fav: FavoriteAddress = {
          id: `fav_${existingNearby.id}`,
          key: `manual|${existingNearby.id}`,
          buildingId: existingNearby.id,
          street: existingNearby.label,
          house: '',
          label: existingNearby.label,
          note:
            input.note ||
            existingNearby.note ||
            `Вказана точка · черга ${formatSubqueue(existingNearby.queue)}`,
          queue: existingNearby.queue,
          feeder: existingNearby.feeder || undefined,
          lat: existingNearby.lat,
          lng: existingNearby.lng,
          savedAt: new Date().toISOString(),
        };
        commitFavoritesUpdate((prev) => [fav, ...prev.filter((x) => x.key !== fav.key)]);
      }
      setPendingPickCoords(null);
      setPickMode(false);
      showToast(
        `У цьому місці вже є спільна точка «${existingNearby.label}» (черга ${formatSubqueue(
          existingNearby.queue
        )}) — використано наявну`
      );
      return;
    }

    let savedId = `mp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let savedToFirestore = false;
    let savedToServer = false;
    let resolvedPoint: ManualPoint | null = null;

    // 1) If signed in with Google, save directly into permanent public Firestore
    if (authUser) {
      try {
        savedId = await createSharedManualPoint({
          label: input.label,
          queue: input.queue,
          feeder: input.feeder,
          note: input.note,
          lat: pendingPickCoords.lat,
          lng: pendingPickCoords.lng,
        });
        savedToFirestore = true;
      } catch {
        // Fall through to public server endpoint so point is still published for everyone
      }
    }

    // 2) If not signed in with Google (or Firestore write unavailable), publish via public server API
    if (!savedToFirestore) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (telegramSessionToken) {
          headers.Authorization = `Bearer ${telegramSessionToken}`;
        }
        const res = await fetch('/api/manual-points', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            label: input.label,
            queue: input.queue,
            feeder: input.feeder,
            note: input.note,
            lat: pendingPickCoords.lat,
            lng: pendingPickCoords.lng,
            visitorId: getOrCreateVisitorId(),
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { point?: ManualPoint; duplicate?: boolean };
          if (data?.point) {
            resolvedPoint = data.point;
            savedId = data.point.id;
            savedToServer = true;
            setServerManualPoints((prev) => [
              data.point!,
              ...prev.filter((x) => x.id !== data.point!.id),
            ]);
          }
        }
      } catch {
        // Offline fallback — save locally
      }
    }

    const pt: ManualPoint = resolvedPoint || {
      id: savedId,
      label: input.label,
      queue: input.queue,
      feeder: input.feeder,
      note: input.note,
      lat: pendingPickCoords.lat,
      lng: pendingPickCoords.lng,
      createdAt: new Date().toISOString(),
      isCloud: savedToFirestore || savedToServer,
    };

    if (!savedToFirestore && !savedToServer) {
      setManualPoints((prev) => {
        const next = [pt, ...prev];
        void persistManualPoints(next);
        return next;
      });
    }

    if (input.addToFavorites) {
      const fav: FavoriteAddress = {
        id: `fav_${pt.id}`,
        key: `manual|${pt.id}`,
        buildingId: pt.id,
        street: pt.label,
        house: '',
        label: pt.label,
        note: pt.note || `Вказана точка · черга ${formatSubqueue(pt.queue)}`,
        queue: pt.queue,
        feeder: pt.feeder || undefined,
        lat: pt.lat,
        lng: pt.lng,
        savedAt: pt.createdAt,
      };
      commitFavoritesUpdate((prev) => [fav, ...prev.filter((x) => x.key !== fav.key)]);
    }

    await appendAssignmentHistory({
      action: 'point_added',
      title: pt.label,
      details: `Вказано точку (${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}) → черга ${formatSubqueue(
        pt.queue
      )}${pt.feeder ? ` (${pt.feeder})` : ''}${pt.note ? ` · ${pt.note}` : ''}`,
      queue: pt.queue,
      lat: pt.lat,
      lng: pt.lng,
      buildingKey: `manual|${pt.id}`,
    });
    if (authUser) {
      void logSharedAuditEvent(
        'point_added',
        `Додано точку «${pt.label}» → черга ${formatSubqueue(pt.queue)}`
      );
    }

    setPendingPickCoords(null);
    setPickMode(false);
    showToast(
      savedToFirestore
        ? `Точку «${pt.label}» збережено у Firestore та опубліковано для всіх`
        : savedToServer
        ? `Точку «${pt.label}» збережено та опубліковано для всіх на карті`
        : `Немає звʼязку з сервером — точку «${pt.label}» збережено локально`,
      savedToFirestore || savedToServer ? 'info' : 'warn'
    );
  };

  const handleDeleteManualPoint = async (pointId: string) => {
    const cloudTarget = cloudManualPoints.find((p) => p.id === pointId);
    if (cloudTarget) {
      if (!authUser) {
        showToast('Увійдіть через Google, щоб видалити спільну точку з Firestore', 'warn');
        return;
      }
      try {
        await deleteSharedManualPoint(pointId);
        if (selectedBuilding?.id === pointId) {
          setSelectedBuilding(null);
        }
        await appendAssignmentHistory({
          action: 'point_removed',
          title: cloudTarget.label,
          details: `Видалено спільну точку (черга ${formatSubqueue(cloudTarget.queue)})`,
          lat: cloudTarget.lat,
          lng: cloudTarget.lng,
        });
        void logSharedAuditEvent(
          'point_removed',
          `Видалено точку «${cloudTarget.label}» (черга ${formatSubqueue(cloudTarget.queue)})`
        );
        showToast('Спільну точку видалено з Firestore');
      } catch {
        showToast('Видалити спільну точку може лише її автор або адміністратор', 'warn');
      }
      return;
    }

    const serverTarget = serverManualPoints.find((p) => p.id === pointId);
    if (serverTarget) {
      try {
        const headers: Record<string, string> = {
          'x-visitor-id': getOrCreateVisitorId(),
        };
        if (telegramSessionToken) {
          headers.Authorization = `Bearer ${telegramSessionToken}`;
        }
        const res = await fetch(`/api/manual-points/${encodeURIComponent(pointId)}`, {
          method: 'DELETE',
          headers,
        });
        if (!res.ok) {
          showToast('Видалити спільну точку може лише її автор або адміністратор', 'warn');
          return;
        }
        setServerManualPoints((prev) => prev.filter((p) => p.id !== pointId));
        if (selectedBuilding?.id === pointId) {
          setSelectedBuilding(null);
        }
        await appendAssignmentHistory({
          action: 'point_removed',
          title: serverTarget.label,
          details: `Видалено спільну точку (черга ${formatSubqueue(serverTarget.queue)})`,
          lat: serverTarget.lat,
          lng: serverTarget.lng,
        });
        showToast('Спільну точку видалено');
      } catch {
        showToast('Помилка видалення точки', 'warn');
      }
      return;
    }

    const target = manualPoints.find((p) => p.id === pointId);
    setManualPoints((prev) => {
      const next = prev.filter((p) => p.id !== pointId);
      void persistManualPoints(next);
      return next;
    });
    if (selectedBuilding?.id === pointId) {
      setSelectedBuilding(null);
    }
    if (target) {
      await appendAssignmentHistory({
        action: 'point_removed',
        title: target.label,
        details: `Видалено локальну точку (черга ${formatSubqueue(target.queue)})`,
        lat: target.lat,
        lng: target.lng,
      });
    }
    showToast('Вказану точку видалено');
  };

  // Building Inspector actions
  const handleSetHome = async (b: BuildingRecord) => {
    setMyHomeKey(b.key);
    try {
      localStorage.setItem(LS_MY_HOME, b.key);
    } catch {
      // ignore
    }
    if (authUser) {
      try {
        await saveUserHomePref(authUser.uid, b.key);
      } catch {
        // Local fallback saved
      }
    }
    triggerDiffRender('Обрано Мій дім');
    showToast(`«${b.label || `${b.street}, ${b.house}`}» збережено як Мій дім`);
  };

  const handleClearHome = async () => {
    setMyHomeKey(null);
    try {
      localStorage.removeItem(LS_MY_HOME);
    } catch {
      // ignore
    }
    if (authUser) {
      try {
        await saveUserHomePref(authUser.uid, '');
      } catch {
        // ignore
      }
    }
    triggerDiffRender('Скинуто Мій дім');
  };

  // Collision Primary Queue selection (highlights chosen queue + logs to separate Assignment History)
  const handleSelectPrimaryQueue = async (
    b: BuildingRecord,
    nextPrimary: SubqueueId,
    allQueues: SubqueueId[]
  ) => {
    const nextSecondary = allQueues.find((q) => q !== nextPrimary) || null;
    const prevPrimary = b.currentVisual?.info?.primary;
    const nextOv: BuildingOverride = {
      ...(mergedOverrides[b.key] || {}),
      primary: nextPrimary,
      secondary: nextSecondary,
      dualType: mergedOverrides[b.key]?.dualType || 'backup',
    };

    setLocalOverrides((prev) => ({ ...prev, [b.key]: nextOv }));
    triggerDiffRender(`Колізія → ${formatSubqueue(nextPrimary)}`);

    void appendAssignmentHistory({
      action: 'collision_changed',
      title: b.label || `${b.street}, ${b.house}`,
      details: `Змінено основну чергу колізії: ${
        prevPrimary ? formatSubqueue(prevPrimary) : '1-ша'
      } → ${formatSubqueue(nextPrimary)}`,
      queue: nextPrimary,
      lat: b.lat,
      lng: b.lng,
      buildingKey: b.key,
    });
    if (authUser) {
      void logSharedAuditEvent(
        'collision_changed',
        `Колізія «${b.label || `${b.street}, ${b.house}`}» → ${formatSubqueue(nextPrimary)}`
      );
    }

    if (authUser && (appMode === 'edit' || appMode === 'admin')) {
      try {
        await saveSharedOverride(b.key, nextOv);
        showToast(`Чергу ${formatSubqueue(nextPrimary)} збережено у Firestore`);
        return;
      } catch {
        showToast(`Обрано чергу ${formatSubqueue(nextPrimary)} локально`);
        return;
      }
    }
    showToast(`Для будинку обрано чергу ${formatSubqueue(nextPrimary)}`);
  };

  const handleSetDualType = async (b: BuildingRecord, dualType: DualQueueType) => {
    const nextOv: BuildingOverride = { ...(mergedOverrides[b.key] || {}), dualType };
    setLocalOverrides((prev) => ({ ...prev, [b.key]: nextOv }));
    triggerDiffRender('Уточнено режим колізії');

    const modeLabel =
      dualType === 'backup'
        ? 'Тільки основна (1-ша)'
        : dualType === 'split_lifts'
        ? 'Квартири + Ліфти'
        : 'Частина підʼїздів';

    void appendAssignmentHistory({
      action: 'dual_mode_changed',
      title: b.label || `${b.street}, ${b.house}`,
      details: `Режим колізії змінено на: ${modeLabel}`,
      lat: b.lat,
      lng: b.lng,
      buildingKey: b.key,
    });
    if (authUser) {
      void logSharedAuditEvent(
        'dual_mode_changed',
        `Режим колізії «${b.label || `${b.street}, ${b.house}`}»: ${modeLabel}`
      );
    }

    if (authUser && (appMode === 'edit' || appMode === 'admin')) {
      try {
        await saveSharedOverride(b.key, nextOv);
        showToast('Режим колізії збережено у Firestore');
      } catch {
        showToast('Режим колізії збережено локально');
      }
    }
  };

  const handleStartTransferFromBuilding = (b: BuildingRecord) => {
    setTransferDraft({
      street: normalizeStreet(b.street) || b.street,
      houses: b.house,
    });
    if (appMode === 'view') setAppMode('edit');
    setSidebarTab('transfers');
    setMobileSidebarOpen(true);
  };

  const handleAddTransfer = async (
    streetRaw: string,
    housesRaw: string,
    targetQueue: SubqueueId,
    targetFeeder: string
  ) => {
    const street = streetRaw.trim();
    const houses = housesRaw
      .split(',')
      .map((x) => normalizeHouse(x))
      .filter(Boolean);

    if (!street || houses.length === 0) {
      showToast('Вкажіть вулицю та хоча б один номер будинку', 'warn');
      return;
    }

    if (authUser) {
      try {
        await createSharedTransfer({
          street,
          houses,
          targetQueue,
          targetFeeder: targetFeeder.trim(),
        });
        void logSharedAuditEvent(
          'transfer_created',
          `Перенос ${street} (${houses.join(', ')}) → ${formatSubqueue(targetQueue)}`
        );
        setTransferDraft({ street: '', houses: '' });
        showToast(`Перенос ${street} → ${formatSubqueue(targetQueue)} збережено у Firestore`);
        return;
      } catch {
        showToast('Помилка запису у Firestore — збережено локально', 'warn');
      }
    }

    const next: FeederTransfer = {
      id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      street,
      houses,
      targetQueue,
      targetFeeder: targetFeeder.trim(),
      manual: true,
      createdAt: new Date().toISOString(),
    };
    setLocalTransfers((prev) => [next, ...prev]);
    setTransferDraft({ street: '', houses: '' });
    triggerDiffRender(`Перенос ${street} → ${formatSubqueue(targetQueue)}`);
    showToast(`Перенос ${street} (${houses.join(', ')}) → ${formatSubqueue(targetQueue)} застосовано`);
  };

  const handleRemoveTransfer = async (id: string) => {
    const cloudItem = cloudTransfers.find((t) => t.id === id);
    if (cloudItem) {
      if (!authUser) {
        showToast('Увійдіть через Google, щоб видалити спільний перенос із Firestore', 'warn');
        return;
      }
      try {
        await deleteSharedTransfer(id);
        void logSharedAuditEvent(
          'transfer_removed',
          `Скасовано перенос ${cloudItem.street} (${cloudItem.houses.join(', ')})`
        );
        showToast('Перенос видалено з Firestore');
      } catch {
        showToast('Видалити спільний перенос може лише його автор або адміністратор', 'warn');
      }
      return;
    }

    setLocalTransfers((prev) => prev.filter((t) => t.id !== id));
    triggerDiffRender('Скасування переносу');
  };

  const handleRemoveOverride = async (key: string) => {
    setLocalOverrides((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });

    if (cloudOverrides[key]) {
      if (!authUser) {
        showToast('Увійдіть через Google, щоб видалити хмарне правило', 'warn');
      } else {
        try {
          await deleteSharedOverride(key);
          showToast('Правило видалено з Firestore');
        } catch {
          showToast('Видалити правило може лише його автор або адміністратор', 'warn');
        }
      }
    }
    triggerDiffRender('Скинуто уточнення колізії');
  };

  const handleExportSettings = () => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      transfers: mergedTransfers,
      dual_queue_overrides: mergedOverrides,
      favorites,
      manual_points: mergedManualPoints,
      assignment_history: mergedAssignmentHistory,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dpem-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Резервну копію JSON експортовано');
  };

  const handleImportSettings = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      showToast('JSON-файл завеликий (макс. 2 МБ)', 'warn');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as {
        transfers?: unknown;
        dual_queue_overrides?: unknown;
        favorites?: unknown;
        manual_points?: unknown;
        assignment_history?: unknown;
      };
      if (Array.isArray(parsed.transfers)) {
        const validTransfers: FeederTransfer[] = parsed.transfers
          .filter(
            (t): t is FeederTransfer =>
              Boolean(t) &&
              typeof t === 'object' &&
              typeof (t as FeederTransfer).street === 'string' &&
              Array.isArray((t as FeederTransfer).houses) &&
              SUBQUEUES.includes((t as FeederTransfer).targetQueue)
          )
          .slice(0, 200);
        setLocalTransfers(validTransfers);
      }
      if (
        parsed.dual_queue_overrides &&
        typeof parsed.dual_queue_overrides === 'object' &&
        !Array.isArray(parsed.dual_queue_overrides)
      ) {
        const cleanOverrides: Record<string, BuildingOverride> = {};
        for (const [k, v] of Object.entries(
          parsed.dual_queue_overrides as Record<string, unknown>
        ).slice(0, 500)) {
          if (v && typeof v === 'object') {
            const ov = v as BuildingOverride;
            cleanOverrides[k] = {
              primary: ov.primary && SUBQUEUES.includes(ov.primary) ? ov.primary : undefined,
              secondary:
                ov.secondary && SUBQUEUES.includes(ov.secondary) ? ov.secondary : undefined,
              dualType:
                ov.dualType &&
                ['none', 'backup', 'split_entrances', 'split_lifts'].includes(ov.dualType)
                  ? ov.dualType
                  : undefined,
            };
          }
        }
        setLocalOverrides(cleanOverrides);
      }
      if (Array.isArray(parsed.favorites)) {
        const validFavs = parsed.favorites
          .filter(
            (f): f is FavoriteAddress =>
              Boolean(f) &&
              typeof f === 'object' &&
              typeof (f as FavoriteAddress).key === 'string'
          )
          .slice(0, 100);
        setFavorites(validFavs);
        void persistFavoritesToBrowserDb(validFavs);
      }
      if (Array.isArray(parsed.manual_points)) {
        const validPts = parsed.manual_points
          .filter(
            (p): p is ManualPoint =>
              Boolean(p) &&
              typeof p === 'object' &&
              typeof (p as ManualPoint).id === 'string' &&
              SUBQUEUES.includes((p as ManualPoint).queue)
          )
          .slice(0, 150);
        setManualPoints(validPts);
        void persistManualPoints(validPts);
      }
      if (Array.isArray(parsed.assignment_history)) {
        const validHist = parsed.assignment_history.slice(0, 200) as AssignmentHistoryEntry[];
        setAssignmentHistory(validHist);
        void persistAssignmentHistory(validHist);
      }
      triggerDiffRender('Імпорт JSON');
      showToast('Дані успішно імпортовано');
    } catch {
      showToast('Некоректний JSON-файл', 'warn');
    }
  };

  const handleReloadOsm = async () => {
    await clearOsmCache();
    await mapRef.current?.reloadOsm();
    showToast('Карту OSM оновлено');
  };

  const handleResetFilters = () => {
    setSelectedQueue(null);
    setSelectedFeeder('');
    setOnlyDualHighlight(false);
    triggerDiffRender('Скидання фільтрів');
  };

  const handleDiffResult = useCallback((entry: DiffLogEntry) => {
    setDiffLog((prev) => [entry, ...prev].slice(0, 60));
  }, []);

  const handleBuildingsLoaded = useCallback(
    (
      loaded: BuildingRecord[],
      stats: { osmCount: number; googleCount: number; substationCount: number; fromCache: boolean }
    ) => {
      setBuildings(loaded);
      setOsmStats(stats);
    },
    []
  );

  const handleOsmError = useCallback(
    (msg: string) => {
      showToast(msg, 'warn');
    },
    [showToast]
  );

  const queueButtonStyle = (state: SlotState, isActive: boolean) => {
    const base =
      'px-2.5 py-1 rounded text-xs font-mono font-semibold transition-all border whitespace-nowrap shrink-0 flex items-center gap-1.5';
    const ring = isActive
      ? 'ring-2 ring-sky-500 dark:ring-sky-400 ring-offset-1 ring-offset-white dark:ring-offset-[#111827]'
      : '';
    switch (state) {
      case 'off':
        return `${base} ${ring} bg-red-600 border-red-500 text-white hover:bg-red-500`;
      case 'switch_off':
      case 'switch_on':
        return `${base} ${ring} bg-orange-600 border-orange-500 text-white hover:bg-orange-500`;
      case 'possible':
        return `${base} ${ring} bg-yellow-500 dark:bg-yellow-600 border-yellow-600 dark:border-yellow-400 text-slate-950 dark:text-white hover:bg-yellow-400`;
      default:
        return `${base} ${ring} bg-emerald-50 dark:bg-emerald-950/70 border-emerald-400 dark:border-emerald-600/60 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/70`;
    }
  };

  const queueStateShortCode = (state: SlotState) => {
    if (state === 'off') return '×';
    if (state === 'switch_off' || state === 'switch_on') return '±';
    if (state === 'possible') return '?';
    return '✓';
  };

  const selectedFavorite = selectedBuilding
    ? favorites.find((f) => f.key === selectedBuilding.key) || null
    : null;

  const watchedTotalCount =
    favorites.length + (myHomeKey && !favorites.some((f) => f.key === myHomeKey) ? 1 : 0);

  return (
    <div className="h-[var(--app-height,100dvh)] w-screen flex flex-col bg-slate-50 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Hidden HTML file input shared across modes */}
      <input
        ref={htmlFileInputRef}
        type="file"
        accept=".html,.htm,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            void handleHtmlUpload(f);
            e.target.value = '';
          }
        }}
      />

      {/* Top Bar (Compact on Mobile <= 50px) */}
      <header className="shrink-0 bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 px-2.5 sm:px-4 py-2 flex items-center justify-between gap-1.5 sm:gap-3 z-30">
        {/* Zone 1: Brand Wordmark */}
        <button
          type="button"
          onClick={() => setActivePage('map')}
          title={`Карта ГПВ ДПЕМ · ${APP_VERSION_FULL}`}
          className="flex items-center gap-1 sm:gap-2 shrink-0 text-left"
        >
          <Zap className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
          <span className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            <span className="hidden sm:inline">Південноукраїнськ · </span>ГПВ
            <span className="hidden sm:inline"> ДПЕМ</span>
          </span>
          <span className="hidden md:inline-block font-mono text-[10px] font-medium text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/70">
            v{APP_VERSION}
          </span>
        </button>

        {/* Zone 2: Address Autocomplete Search */}
        <div className="relative flex-1 max-w-sm min-w-0">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
            placeholder="Адреса або точка…"
            className="w-full bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700/90 rounded-md pl-8 pr-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 transition-colors"
            autoComplete="off"
          />
          {searchFocused && searchMatches.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 rounded-md shadow-2xl z-[2000] max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {searchMatches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSearchQuery(b.label || `${b.street}, ${b.house}`);
                    setSearchFocused(false);
                    setActivePage('map');
                    mapRef.current?.flyToBuilding(b.id);
                  }}
                  className="w-full text-left px-3 py-2.5 sm:py-2 text-xs text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between gap-2"
                >
                  <span className="truncate">{b.label || `${b.street}, ${b.house}`}</span>
                  <span className="text-[11px] text-slate-500 shrink-0">
                    {b.source === 'manual' ? 'Точка' : b.source === 'google' ? 'Google' : 'OSM'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Zone 3: Favorites Page + Analytics + Desktop Utilities + Mobile Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              triggerTelegramHaptic('light');
              setActivePage((p) => (p === 'favorites' ? 'map' : 'favorites'));
            }}
            className={`px-2 py-2 sm:px-2.5 sm:py-1.5 rounded-md border text-xs font-semibold transition-colors inline-flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0 ${
              activePage === 'favorites'
                ? 'bg-amber-500 border-amber-400 text-slate-950'
                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100'
            }`}
            title="Окрема сторінка моніторингу обраних адрес"
            aria-label="Обрані адреси"
          >
            <Star
              className={`w-3.5 h-3.5 shrink-0 ${
                activePage === 'favorites'
                  ? 'fill-slate-950 text-slate-950'
                  : 'text-amber-500 fill-amber-400'
              }`}
            />
            <span className="hidden sm:inline">Обрані</span>
            {watchedTotalCount > 0 && (
              <span
                className={`font-mono text-[10px] px-1 rounded ${
                  activePage === 'favorites'
                    ? 'bg-slate-950/20 text-slate-950'
                    : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                }`}
              >
                {watchedTotalCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              triggerTelegramHaptic('light');
              setActivePage((p) => {
                const next = p === 'analytics' ? 'map' : 'analytics';
                if (next === 'analytics') void refreshOutageAnalytics();
                return next;
              });
            }}
            className={`p-2 sm:px-2.5 sm:py-1.5 rounded-md border text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activePage === 'analytics'
                ? 'bg-sky-600 border-sky-500 text-white'
                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100'
            }`}
            title="Аналітика відключень та прогноз на місяць вперед"
            aria-label="Аналітика відключень"
          >
            <BarChart3
              className={`w-3.5 h-3.5 shrink-0 ${
                activePage === 'analytics' ? 'text-white' : 'text-sky-600 dark:text-sky-400'
              }`}
            />
            <span className="hidden md:inline">Статистика</span>
          </button>

          <div className="hidden sm:inline-flex items-center">
            <PWAInstallButton />
          </div>

          {getTelegramWebApp() ? (
            <button
              type="button"
              onClick={() => {
                triggerTelegramHaptic('light');
                openCurrentUrlInExternalBrowser();
              }}
              className="hidden sm:inline-flex p-2 sm:px-2.5 sm:py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors items-center gap-1.5 whitespace-nowrap"
              title="Відкрити повний сайт у зовнішньому браузері (та додати ярлик PWA)"
              aria-label="Відкрити повний сайт у браузері"
            >
              <ExternalLink className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span className="hidden md:inline">Сайт</span>
            </button>
          ) : (
            <a
              href={`https://t.me/${telegramBotUsername || 'Map_light_asgard_bot'}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex p-2 sm:px-2.5 sm:py-1.5 rounded-md bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 border border-sky-300 dark:border-sky-800 text-xs font-semibold text-sky-700 dark:text-sky-300 transition-colors items-center gap-1.5 whitespace-nowrap"
              title={`Відкрити Telegram-бот @${telegramBotUsername || 'Map_light_asgard_bot'}`}
              aria-label="Telegram-бот"
            >
              <Send className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span className="hidden md:inline">Telegram-бот</span>
            </a>
          )}

          <button
            type="button"
            onClick={() => {
              triggerTelegramHaptic('light');
              setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
            }}
            className="hidden sm:inline-flex p-2 sm:px-2.5 sm:py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-100 transition-colors items-center gap-1.5"
            title={theme === 'dark' ? 'Світла тема' : 'Темна тема'}
            aria-label="Перемкнути тему"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-600" />
            )}
            <span className="hidden xl:inline">
              {theme === 'dark' ? 'Світла' : 'Темна'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerTelegramHaptic('light');
              void pollDpemApi(true);
            }}
            disabled={isPolling}
            className="hidden sm:inline-flex p-2 sm:px-3 sm:py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-xs font-semibold text-white transition-colors items-center gap-1.5 whitespace-nowrap"
            aria-label="Оновити дані ДПЕМ"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Оновити</span>
          </button>

          {activePage === 'map' && (
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((v) => !v)}
              className={`md:hidden p-2 rounded-md border transition-colors shrink-0 ${
                mobileFiltersOpen
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200'
              }`}
              aria-label="Фільтри та режими"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="lg:hidden relative p-2 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 shrink-0"
            aria-label="Відкрити панель управління"
          >
            <Menu className="w-3.5 h-3.5" />
            {isAdminUser && pendingAccessRequestsCount > 0 && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500" />
            )}
          </button>
        </div>
      </header>

      {/* Operational Timeline, Mode Switcher & Filters Toolbar (hidden on Favorites & Analytics Pages) */}
      <section
        className={`${
          activePage !== 'map' ? 'hidden' : ''
        } shrink-0 bg-white/95 dark:bg-[#111827]/95 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 py-2 space-y-2 z-20`}
      >
        {/* Row 1: Compact Time Slider (always visible) + Mode Switcher (desktop) */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Segmented Mode Switcher: View | Edit | Admin */}
          <div
            className={`${
              mobileFiltersOpen ? 'flex w-full sm:w-auto' : 'hidden md:flex'
            } items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-[#0b1120] border border-slate-200 dark:border-slate-800 rounded-md shrink-0`}
            role="tablist"
            aria-label="Режим роботи"
          >
            <button
              type="button"
              role="tab"
              aria-selected={appMode === 'view'}
              onClick={() => handleModeChange('view')}
              className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                appMode === 'view'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>Перегляд</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={appMode === 'edit'}
              onClick={() => handleModeChange('edit')}
              className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                appMode === 'edit'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Pencil className="w-3 h-3" />
              <span>Редагування</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={appMode === 'admin'}
              onClick={() => handleModeChange('admin')}
              className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                appMode === 'admin'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Shield className="w-3 h-3" />
              <span>Адмін</span>
            </button>
          </div>

          {/* 48-Slot Time Slider */}
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <span className="font-mono text-xs sm:text-sm font-bold text-sky-600 dark:text-sky-400 tabular-nums whitespace-nowrap min-w-[100px] sm:min-w-[114px]">
              {formatSlotTime(timeSlot)}
            </span>
            <input
              type="range"
              min={0}
              max={47}
              step={1}
              value={timeSlot}
              onChange={(e) => {
                setTimeSlot(Number(e.target.value));
                triggerDiffRender('Повзунок часу');
              }}
              className="dpem-slider flex-1"
              aria-label="Часовий слот (48 інтервалів по 30 хвилин)"
            />
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setTimeSlot(getCurrentHalfHourSlot());
                userPickedDateRef.current = false;
                setSelectedDate(pickPreferredDate(scheduleByDate));
                triggerDiffRender('Поточний час');
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0"
            >
              <Clock className="w-3 h-3 text-sky-600 dark:text-sky-400" />
              <span className="hidden xs:inline sm:inline">Зараз</span>
            </button>
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                isPlaying
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100'
              }`}
              aria-label={isPlaying ? 'Пауза' : 'Автопрокрутка дня'}
            >
              {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span className="hidden sm:inline">{isPlaying ? 'Пауза' : 'День'}</span>
            </button>
          </div>

          {/* Secondary Dropdown Filters (collapsible on mobile to keep map viewport >=80%) */}
          <div
            className={`${
              mobileFiltersOpen ? 'flex w-full' : 'hidden md:flex'
            } flex-wrap items-center gap-1.5 sm:gap-2`}
          >
            <CalendarDatePicker
              selectedDate={selectedDate}
              availableDates={availableDates}
              allowForecast
              isForecastDate={Boolean(selectedDayForecast?.isForecast)}
              onSelectDate={(dt) => {
                userPickedDateRef.current = true;
                setSelectedDate(dt);
                triggerDiffRender(`Дата ${dt}`);
              }}
            />

            <select
              value={selectedFeeder}
              onChange={(e) => {
                setSelectedFeeder(e.target.value);
                triggerDiffRender(e.target.value ? `Фідер ${e.target.value}` : 'Всі фідери');
              }}
              aria-label="Фільтр по підстанції та фідеру"
              className="bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-slate-100 max-w-[170px] focus:outline-none focus:border-sky-500"
            >
              <option value="">Всі фідери</option>
              {addressIndex.feeders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>

            <select
              value={dualMode}
              onChange={(e) => {
                setDualMode(e.target.value as GlobalDualMode);
                triggerDiffRender('Режим 2 черг');
              }}
              aria-label="Режим відображення колізій"
              className="bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
            >
              <option value="split">Колізії: за налаштуванням</option>
              <option value="primary">Колізії: завжди 1-ша черга</option>
            </select>

            <button
              type="button"
              onClick={() => {
                setMergedLightDark((v) => !v);
                triggerDiffRender('Режим світло/без світла');
              }}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium whitespace-nowrap transition-colors ${
                mergedLightDark
                  ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-400/70 dark:border-sky-700 text-sky-800 dark:text-sky-300'
                  : 'bg-slate-50 dark:bg-[#0b1120] border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
              title="Об'єднати нарізку перемикань у прості стани: Зі світлом / Без світла"
            >
              <Layers className="w-3 h-3" />
              <span>{mergedLightDark ? 'Світло / Без' : 'З перемик.'}</span>
            </button>

            {(selectedQueue || selectedFeeder || onlyDualHighlight) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 text-xs text-slate-800 dark:text-slate-200 whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Скинути</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: 12 Subqueues Interactive Filter Strip (Horizontally scrollable on mobile) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {SUBQUEUES.map((q) => {
              const rawSt = currentQueuesMap[q]?.[timeSlot] || 'on';
              const st = normalizeDisplayState(rawSt, mergedLightDark);
              const isActive = selectedQueue === q;
              return (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    const next = isActive ? null : q;
                    setSelectedQueue(next);
                    triggerDiffRender(next ? `Фільтр ${formatSubqueue(next)}` : 'Всі черги');
                  }}
                  title={`Підчерга ${formatSubqueue(q)}`}
                  className={queueButtonStyle(st, isActive)}
                >
                  <span>{formatSubqueue(q)}</span>
                  <span className="opacity-80 text-[10px]" aria-hidden="true">
                    {queueStateShortCode(st)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="hidden xl:flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
            <span>{dataSourceLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {buildings.length + mergedManualPoints.length} обʼєктів
            </span>
          </div>
        </div>

        {selectedDayForecast?.isForecast && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-violet-500/10 border border-violet-500/30 text-[11px] text-violet-800 dark:text-violet-200">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sparkles className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
              <span className="font-semibold">
                Прогноз карти на {selectedDate} ({selectedDayForecast.daysOffset > 0 ? `+${selectedDayForecast.daysOffset}` : selectedDayForecast.daysOffset} дн.)
              </span>
              <span className="hidden sm:inline text-violet-700/80 dark:text-violet-300/80 truncate">
                ·{' '}
                {customShiftSlots !== null
                  ? `Ручний зсув ${formatShiftSlotsUk(customShiftSlots)}/добу`
                  : selectedDayForecast.summaryUk}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                userPickedDateRef.current = false;
                setSelectedDate(pickPreferredDate(scheduleByDate));
                triggerDiffRender('Повернення до офіційного графіка');
              }}
              className="px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold shrink-0"
            >
              До офіц.
            </button>
          </div>
        )}
      </section>

      {/* Dedicated Full-Viewport Favorites Watch Page */}
      {activePage === 'favorites' && (
        <FavoritesWatchPage
          favorites={favorites}
          myHomeKey={myHomeKey}
          buildings={buildings}
          manualPoints={mergedManualPoints}
          resolverCtx={resolverCtx}
          queuesMap={currentQueuesMap}
          availableDates={availableDates}
          selectedDate={selectedDate}
          onSelectDate={(dt) => {
            userPickedDateRef.current = true;
            setSelectedDate(dt);
            triggerDiffRender(`Дата ${dt}`);
          }}
          currentSlot={timeSlot}
          onSelectSlot={(idx) => {
            setTimeSlot(idx);
            triggerDiffRender('Клік по шкалі обраних');
          }}
          mergedLightDark={mergedLightDark}
          onToggleMergedLightDark={() => {
            setMergedLightDark((v) => !v);
            triggerDiffRender('Режим світло/без світла');
          }}
          onBackToMap={() => setActivePage('map')}
          onFlyToFavorite={(fav) => mapRef.current?.flyToFavorite(fav.key, fav.lat, fav.lng)}
          onFlyToHome={() => {
            const b = buildings.find((x) => x.key === myHomeKey);
            if (b) {
              mapRef.current?.flyToBuilding(b.id);
              return;
            }
            const mp = mergedManualPoints.find((p) => `manual|${p.id}` === myHomeKey);
            if (mp) mapRef.current?.flyToCoords(mp.lat, mp.lng, mp.id);
          }}
          onUpdateFavoriteNote={handleUpdateFavoriteNote}
          onRemoveFavorite={handleRemoveFavorite}
          forecastInfo={selectedDayForecast}
          shiftModel={shiftModel}
          customShiftSlots={customShiftSlots}
          onChangeCustomShiftSlots={setCustomShiftSlots}
        />
      )}

      {/* Dedicated Map-Free Outage Analytics Page (Week / Month Unlucky Queues & Hotspots) */}
      {activePage === 'analytics' && (
        <AnalyticsPage
          analytics={computedOutageAnalytics}
          window={analyticsWindow}
          onChangeWindow={setAnalyticsWindow}
          includeSwitches={mergedLightDark}
          onToggleIncludeSwitches={() => {
            setMergedLightDark((v) => !v);
            triggerDiffRender('Режим перемикань');
          }}
          isRefreshing={loadingAnalytics || isPolling}
          onRefresh={() => {
            void pollDpemApi(true);
            void refreshOutageAnalytics();
          }}
          onBackToMap={() => setActivePage('map')}
          onJumpToStreet={(streetName, buildingId) => {
            setSearchQuery(streetName);
            setActivePage('map');
            if (buildingId) {
              setTimeout(() => mapRef.current?.flyToBuilding(buildingId), 120);
            }
          }}
          onOpenAuditModal={() => {
            setAuditDashboardOpen(true);
            void refreshAuditStats();
          }}
          availableDates={availableDates}
          unifiedDays={unifiedDaySchedules}
          shiftModel={shiftModel}
          customShiftSlots={customShiftSlots}
          onChangeCustomShiftSlots={setCustomShiftSlots}
          onOpenDateInFavorites={(dt) => {
            userPickedDateRef.current = true;
            setSelectedDate(dt);
            setActivePage('favorites');
            triggerDiffRender(`Прогноз обрані ${dt}`);
          }}
          onOpenDateOnMap={(dt) => {
            userPickedDateRef.current = true;
            setSelectedDate(dt);
            setActivePage('map');
            triggerDiffRender(`Прогноз карта ${dt}`);
          }}
        />
      )}

      {/* Main Split Workspace (kept mounted when viewing Favorites/Analytics for zero-lag map return) */}
      <main
        className={
          activePage !== 'map' ? 'hidden' : 'flex-1 flex min-h-0 relative'
        }
      >
        <div className="flex-1 relative min-w-0 h-full">
          <MapCanvas
            ref={mapRef}
            theme={theme}
            resolverCtx={resolverCtx}
            visualOpts={visualOpts}
            myHomeKey={myHomeKey}
            selectedBuildingId={selectedBuilding?.id || null}
            manualPoints={mergedManualPoints}
            pickMode={pickMode}
            onTogglePickMode={() => {
              setPickMode((v) => !v);
              setPendingPickCoords(null);
            }}
            onPickCoords={(coords) => {
              setPendingPickCoords(coords);
              setSelectedBuilding(null);
            }}
            renderTriggerReason={renderMeta.reason}
            renderRevision={renderMeta.rev}
            onBuildingsLoaded={handleBuildingsLoaded}
            onSelectBuilding={setSelectedBuilding}
            onDiffResult={handleDiffResult}
            onOsmError={handleOsmError}
          />

          {/* Manual Point Creation Modal (when clicking map in Pick Point mode) */}
          {pendingPickCoords && (
            <ManualPointModal
              coords={pendingPickCoords}
              suggestedMatch={nearestPickSuggestion}
              onCancel={() => {
                setPendingPickCoords(null);
                setPickMode(false);
              }}
              onSave={(input) => void handleSaveManualPoint(input)}
            />
          )}

          {/* Floating React Building Inspector (Bottom sheet on mobile, top-right on desktop) */}
          {selectedBuilding && !pendingPickCoords && (
            <BuildingInspector
              appMode={appMode}
              building={selectedBuilding}
              isHome={Boolean(myHomeKey && selectedBuilding.key === myHomeKey)}
              favorite={selectedFavorite}
              queuesMap={currentQueuesMap}
              currentSlot={timeSlot}
              mergedLightDark={mergedLightDark}
              onClose={() => setSelectedBuilding(null)}
              onSetHome={(b) => void handleSetHome(b)}
              onSaveFavorite={handleSaveFavorite}
              onRemoveFavorite={handleRemoveFavorite}
              onSelectPrimaryQueue={(b, q, all) => void handleSelectPrimaryQueue(b, q, all)}
              onSetDualType={(b, dt) => void handleSetDualType(b, dt)}
              onStartTransfer={handleStartTransferFromBuilding}
              onDeleteManualPoint={(id) => void handleDeleteManualPoint(id)}
              onSelectSlot={(idx) => {
                setTimeSlot(idx);
                triggerDiffRender('Клік по 24h шкалі');
              }}
            />
          )}

          {/* Non-intrusive Toast Notification */}
          {toast && (
            <div
              role="status"
              className={`absolute bottom-4 right-3 sm:right-4 z-[1100] max-w-[calc(100vw-24px)] sm:max-w-sm px-3.5 py-2.5 rounded-md border text-xs font-medium shadow-xl ${
                toast.tone === 'warn'
                  ? 'bg-amber-50 dark:bg-amber-950/95 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100'
                  : 'bg-white/95 dark:bg-[#111827]/95 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100'
              }`}
            >
              {toast.text}
            </div>
          )}
        </div>

        {/* Right Operational Sidebar (Responsive Drawer on Mobile) */}
        <SidebarPanel
          appMode={appMode}
          isAdminUser={isAdminUser}
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          authUser={authUser}
          cloudConnected={cloudConnected}
          onSignIn={() => void handleSignIn()}
          onSignOut={() => void handleSignOut()}
          myHomeKey={myHomeKey}
          favorites={favorites}
          onFlyToFavorite={(fav) => mapRef.current?.flyToFavorite(fav.key, fav.lat, fav.lng)}
          onUpdateFavoriteNote={handleUpdateFavoriteNote}
          onRemoveFavorite={handleRemoveFavorite}
          manualPoints={mergedManualPoints}
          assignmentHistory={mergedAssignmentHistory}
          onStartPickPoint={() => {
            setPickMode(true);
            setSelectedBuilding(null);
          }}
          onFlyToManualPoint={(pt) => mapRef.current?.flyToCoords(pt.lat, pt.lng, pt.id)}
          onDeleteManualPoint={(id) => void handleDeleteManualPoint(id)}
          onFlyToHistoryEntry={(entry) => {
            if (typeof entry.lat === 'number' && typeof entry.lng === 'number') {
              mapRef.current?.flyToFavorite(entry.buildingKey || '', entry.lat, entry.lng);
            }
          }}
          onClearAssignmentHistory={async () => {
            setAssignmentHistory([]);
            void persistAssignmentHistory([]);
            if (isAdminUser && cloudAssignmentHistory.length > 0) {
              try {
                await Promise.all(
                  cloudAssignmentHistory.map((item) => deleteSharedHistoryEntry(item.id))
                );
                showToast('Спільну та локальну історію вказань очищено');
                return;
              } catch {
                showToast('Локальну історію очищено; помилка очищення Firestore', 'warn');
                return;
              }
            }
            showToast(
              cloudAssignmentHistory.length > 0
                ? 'Локальну історію очищено (спільну історію Firestore може очищати лише адмін)'
                : 'Історію вказань очищено'
            );
          }}
          buildings={buildings}
          resolverCtx={resolverCtx}
          addressIndex={addressIndex}
          queuesMap={currentQueuesMap}
          currentSlot={timeSlot}
          selectedDate={selectedDate}
          osmStats={osmStats}
          onlyDualHighlight={onlyDualHighlight}
          onToggleDualHighlight={() => {
            setOnlyDualHighlight((v) => !v);
            triggerDiffRender('Фільтр колізій');
          }}
          onClearHome={() => void handleClearHome()}
          onFlyToHome={() => {
            const b = buildings.find((x) => x.key === myHomeKey);
            if (b) {
              mapRef.current?.flyToBuilding(b.id);
              return;
            }
            const mp = mergedManualPoints.find((p) => `manual|${p.id}` === myHomeKey);
            if (mp) mapRef.current?.flyToCoords(mp.lat, mp.lng, mp.id);
          }}
          onSelectSlot={(idx) => {
            setTimeSlot(idx);
            triggerDiffRender('Клік по графіку дому');
          }}
          transfers={mergedTransfers}
          autoTransfers={autoTransfers}
          transferDraft={transferDraft}
          onTransferDraftChange={setTransferDraft}
          onAddTransfer={(st, h, q, f) => void handleAddTransfer(st, h, q, f)}
          onRemoveTransfer={(id) => void handleRemoveTransfer(id)}
          overrides={mergedOverrides}
          onRemoveOverride={(k) => void handleRemoveOverride(k)}
          diffLog={diffLog}
          apiUrl={apiUrl}
          onSaveApiUrl={(url) => {
            if (url && !isSafeApiUrl(url)) {
              showToast('Вкажіть коректний http:// або https:// URL', 'warn');
              return;
            }
            setApiUrl(url);
            try {
              localStorage.setItem(LS_API_URL, url);
            } catch {
              // ignore
            }
            showToast(url ? 'Worker API збережено' : 'Використовується вбудований /api/dpem');
            void pollDpemApi(true);
          }}
          pollIntervalMs={pollIntervalMs}
          onPollIntervalChange={setPollIntervalMs}
          onReloadOsm={() => void handleReloadOsm()}
          onUploadHtmlClick={() => htmlFileInputRef.current?.click()}
          onExportSettings={handleExportSettings}
          onImportSettings={(f) => void handleImportSettings(f)}
          operOutages={operOutages}
          emergencyOutages={emergencyOutages}
          plannedOutages={plannedOutages}
          operUpdatedAt={operUpdatedAt}
          auditStats={mergedAuditStats}
          auditEditsCount={Math.max(
            mergedAssignmentHistory.length,
            auditEvents.filter((e) => e.eventType !== 'login').length
          )}
          onOpenAuditDashboard={() => {
            setAuditDashboardOpen(true);
            void refreshAuditStats();
          }}
          effectiveRole={effectiveRole}
          pendingAccessRequestsCount={pendingAccessRequestsCount}
          onOpenAccessControl={() => setAccessControlOpen(true)}
          onOpenFavoritesPage={() => setActivePage('favorites')}
          telegramUser={telegramUser}
          telegramBotUsername={telegramBotUsername}
          onTelegramWidgetAuth={(payload: TelegramLoginWidgetPayload) => {
            void verifyTelegramLoginWidget(payload).then((res) => {
              if (res.verified && res.user && res.token) {
                setTelegramUser(res.user);
                setTelegramSessionToken(res.token);
                showToast(`Увійшли через Telegram: ${res.user.firstName}`);
              } else {
                showToast(res.error || 'Помилка входу через Telegram', 'warn');
              }
            });
          }}
          onTelegramSignOut={() => {
            setTelegramUser(null);
            setTelegramSessionToken(null);
            showToast('Вихід з Telegram виконано');
          }}
          theme={theme}
          onToggleTheme={() => {
            triggerTelegramHaptic('light');
            setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
          }}
          isPolling={isPolling}
          onRefreshDpem={() => {
            triggerTelegramHaptic('light');
            void pollDpemApi(true);
          }}
          isTelegramMiniApp={Boolean(getTelegramWebApp())}
          onOpenExternalBrowser={() => {
            triggerTelegramHaptic('light');
            openCurrentUrlInExternalBrowser();
          }}
        />
      </main>

      {/* Full Interactive Audit Dashboard Modal */}
      {auditDashboardOpen && (
        <AuditDashboardModal
          isAdminUser={isAdminUser}
          stats={mergedAuditStats}
          loadingStats={loadingAuditStats}
          onRefreshStats={() => {
            void refreshAuditStats();
            void refreshOutageAnalytics();
          }}
          auditEvents={auditEvents}
          assignmentHistory={mergedAssignmentHistory}
          manualPoints={mergedManualPoints}
          transfers={mergedTransfers}
          overridesCount={Object.keys(mergedOverrides).length}
          outageAnalytics={computedOutageAnalytics}
          onOpenAnalyticsPage={(win) => {
            if (win) setAnalyticsWindow(win);
            setActivePage('analytics');
            void refreshOutageAnalytics();
          }}
          onClose={() => setAuditDashboardOpen(false)}
        />
      )}

      {/* Multi-Role RBAC & Access Requests Modal */}
      {accessControlOpen && (
        <AccessControlModal
          authUser={authUser}
          telegramUser={telegramUser}
          effectiveRole={effectiveRole}
          myRoleRecord={myRoleRecord}
          userRoles={userRoles}
          accessRequests={accessRequests}
          onSignInGoogle={() => void handleSignIn()}
          onSubmitRequest={async (input) => {
            try {
              await submitAccessRequest(input);
              showToast('Запит на права надіслано адміністраторам');
            } catch (err) {
              showToast(
                err instanceof Error ? err.message : 'Не вдалося надіслати запит',
                'warn'
              );
            }
          }}
          onCancelRequest={async (reqId) => {
            try {
              await cancelAccessRequest(reqId);
              showToast('Запит скасовано');
            } catch {
              showToast('Не вдалося скасувати запит', 'warn');
            }
          }}
          onApproveRequest={async (req, grantRole) => {
            try {
              await approveAccessRequest(req, grantRole);
              showToast(
                `Видано роль «${grantRole === 'admin' ? 'Адмін' : 'Редактор'}» для ${req.requesterName}`
              );
            } catch {
              showToast('Недостатньо прав або помилка запису в Firestore', 'warn');
            }
          }}
          onRejectRequest={async (req) => {
            try {
              await rejectAccessRequest(req);
              showToast(`Запит від ${req.requesterName} відхилено`);
            } catch {
              showToast('Не вдалося відхилити запит', 'warn');
            }
          }}
          onBanUser={async (target, banned, reason) => {
            try {
              await setUserBanStatus(target, banned, reason);
              showToast(
                banned
                  ? `Користувача ${target.displayName} заблоковано`
                  : `Користувача ${target.displayName} розблоковано`
              );
            } catch {
              showToast(
                'Бан дозволено лише для редакторів або адмінів, яких ви додали особисто',
                'warn'
              );
            }
          }}
          onChangeRole={async (target, nextRole) => {
            try {
              await updateUserRoleType(target, nextRole);
              showToast(`Роль ${target.displayName} змінено на ${nextRole}`);
            } catch {
              showToast('Недостатньо прав для зміни ролі цього користувача', 'warn');
            }
          }}
          onDeleteRole={async (target) => {
            try {
              await deleteUserRoleRecord(target);
              showToast(`Запис ролі ${target.displayName} видалено`);
            } catch {
              showToast('Остаточне видалення доступне лише Супер-адміну', 'warn');
            }
          }}
          onClose={() => setAccessControlOpen(false)}
        />
      )}

      {/* PWA Offline Connectivity Indicator */}
      <OfflineIndicator />
    </div>
  );
}
