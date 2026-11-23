import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Cloud,
  Database,
  Download,
  FileUp,
  History,
  Home,
  LogIn,
  LogOut,
  MapPin,
  MapPinPlus,
  Pencil,
  RefreshCw,
  Send,
  Shield,
  Shuffle,
  Star,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { resolveBuilding, ResolverContext, stateColor, stateLabel } from '../lib/resolver';
import { TelegramLoginWidgetPayload } from '../lib/telegram';
import {
  AddressIndexResult,
  AssignmentHistoryEntry,
  BuildingOverride,
  BuildingRecord,
  DiffLogEntry,
  EffectiveRoleName,
  FavoriteAddress,
  FeederTransfer,
  formatSlotTime,
  formatSubqueue,
  ManualPoint,
  OutageNotice,
  ServerAuditStats,
  SlotState,
  SUBQUEUES,
  SubqueueId,
  TelegramUserProfile,
} from '../lib/types';
import type { AppMode } from './BuildingInspector';
import { TelegramLoginButton } from './TelegramLoginButton';

export type SidebarTab = 'overview' | 'transfers' | 'history' | 'admin';

interface SidebarPanelProps {
  appMode: AppMode;
  isAdminUser: boolean;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  authUser: User | null;
  cloudConnected: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  myHomeKey: string | null;
  favorites: FavoriteAddress[];
  onFlyToFavorite: (fav: FavoriteAddress) => void;
  onUpdateFavoriteNote: (key: string, note: string) => void;
  onRemoveFavorite: (key: string) => void;
  manualPoints: ManualPoint[];
  assignmentHistory: AssignmentHistoryEntry[];
  onStartPickPoint: () => void;
  onFlyToManualPoint: (pt: ManualPoint) => void;
  onDeleteManualPoint: (pointId: string) => void;
  onFlyToHistoryEntry: (entry: AssignmentHistoryEntry) => void;
  onClearAssignmentHistory: () => void;
  buildings: BuildingRecord[];
  resolverCtx: ResolverContext;
  addressIndex: AddressIndexResult;
  queuesMap: Partial<Record<SubqueueId, SlotState[]>>;
  currentSlot: number;
  selectedDate: string;
  osmStats: { osmCount: number; googleCount: number; substationCount: number; fromCache: boolean };
  onlyDualHighlight: boolean;
  onToggleDualHighlight: () => void;
  onClearHome: () => void;
  onFlyToHome: () => void;
  onSelectSlot: (slot: number) => void;
  transfers: FeederTransfer[];
  autoTransfers: FeederTransfer[];
  transferDraft: { street: string; houses: string };
  onTransferDraftChange: (draft: { street: string; houses: string }) => void;
  onAddTransfer: (
    street: string,
    housesRaw: string,
    targetQueue: SubqueueId,
    targetFeeder: string
  ) => void;
  onRemoveTransfer: (id: string) => void;
  overrides: Record<string, BuildingOverride>;
  onRemoveOverride: (key: string) => void;
  diffLog: DiffLogEntry[];
  apiUrl: string;
  onSaveApiUrl: (url: string) => void;
  pollIntervalMs: number;
  onPollIntervalChange: (ms: number) => void;
  onReloadOsm: () => void;
  onUploadHtmlClick: () => void;
  onExportSettings: () => void;
  onImportSettings: (file: File) => void;
  operOutages: OutageNotice[];
  emergencyOutages: OutageNotice[];
  plannedOutages: OutageNotice[];
  operUpdatedAt: string | null;
  auditStats: ServerAuditStats | null;
  auditEditsCount: number;
  onOpenAuditDashboard: () => void;
  effectiveRole: EffectiveRoleName;
  pendingAccessRequestsCount: number;
  onOpenAccessControl: () => void;
  onOpenFavoritesPage: () => void;
  telegramUser: TelegramUserProfile | null;
  telegramBotUsername: string | null;
  onTelegramWidgetAuth: (payload: TelegramLoginWidgetPayload) => void;
  onTelegramSignOut: () => void;
}

function computeLiveCountdown(
  schedule: SlotState[],
  currentSlot: number,
  now: Date
): { nextState: SlotState | null; label: string; countdown: string } {
  if (!schedule || schedule.length < 48) {
    return { nextState: null, label: 'Немає графіка', countdown: '—' };
  }
  const cur = schedule[currentSlot] || 'on';
  let nextSlotIdx: number | null = null;
  for (let i = currentSlot + 1; i < 48; i++) {
    if ((schedule[i] || 'on') !== cur) {
      nextSlotIdx = i;
      break;
    }
  }

  if (nextSlotIdx === null) {
    return {
      nextState: null,
      label: 'Без змін до 24:00',
      countdown: 'До кінця доби',
    };
  }

  const nextState = schedule[nextSlotIdx];
  const realSlot = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
  let totalSec: number;
  if (currentSlot === realSlot) {
    const targetDate = new Date(now);
    const targetMinutes = nextSlotIdx * 30;
    targetDate.setHours(Math.floor(targetMinutes / 60), targetMinutes % 60, 0, 0);
    totalSec = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 1000));
  } else {
    totalSec = (nextSlotIdx - currentSlot) * 30 * 60;
  }

  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    nextState,
    label: `Далі (${formatSlotTime(nextSlotIdx).slice(0, 5)}): ${stateLabel(nextState)}`,
    countdown: `${pad(h)}:${pad(m)}:${pad(s)}`,
  };
}

export const SidebarPanel: React.FC<SidebarPanelProps> = ({
  appMode,
  isAdminUser,
  activeTab,
  onTabChange,
  mobileOpen,
  onCloseMobile,
  authUser,
  cloudConnected,
  onSignIn,
  onSignOut,
  myHomeKey,
  favorites,
  onFlyToFavorite,
  onUpdateFavoriteNote,
  onRemoveFavorite,
  manualPoints,
  assignmentHistory,
  onStartPickPoint,
  onFlyToManualPoint,
  onDeleteManualPoint,
  onFlyToHistoryEntry,
  onClearAssignmentHistory,
  buildings,
  resolverCtx,
  addressIndex,
  queuesMap,
  currentSlot,
  osmStats,
  onlyDualHighlight,
  onToggleDualHighlight,
  onClearHome,
  onFlyToHome,
  onSelectSlot,
  transfers,
  autoTransfers,
  transferDraft,
  onTransferDraftChange,
  onAddTransfer,
  onRemoveTransfer,
  overrides,
  onRemoveOverride,
  diffLog,
  apiUrl,
  onSaveApiUrl,
  pollIntervalMs,
  onPollIntervalChange,
  onReloadOsm,
  onUploadHtmlClick,
  onExportSettings,
  onImportSettings,
  operOutages,
  emergencyOutages,
  plannedOutages,
  operUpdatedAt,
  auditStats,
  auditEditsCount,
  onOpenAuditDashboard,
  effectiveRole,
  pendingAccessRequestsCount,
  onOpenAccessControl,
  onOpenFavoritesPage,
  telegramUser,
  telegramBotUsername,
  onTelegramWidgetAuth,
  onTelegramSignOut,
}) => {
  const [targetQueue, setTargetQueue] = useState<SubqueueId>('6-1');
  const [targetFeeder, setTargetFeeder] = useState<string>('');
  const [apiInput, setApiInput] = useState<string>(apiUrl);
  const [editingFavKey, setEditingFavKey] = useState<string | null>(null);
  const [editingFavNote, setEditingFavNote] = useState<string>('');
  const [now, setNow] = useState<Date>(() => new Date());
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setApiInput(apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    if (!myHomeKey) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [myHomeKey]);

  const homeBuilding = myHomeKey ? buildings.find((b) => b.key === myHomeKey) || null : null;
  const homeInfo = homeBuilding
    ? resolveBuilding(homeBuilding.street, homeBuilding.house, resolverCtx)
    : null;
  const homeSchedule = homeInfo ? queuesMap[homeInfo.primary] || [] : [];
  const homeCountdown = homeInfo ? computeLiveCountdown(homeSchedule, currentSlot, now) : null;

  const overrideEntries = Object.entries(overrides);
  const totalNotices = operOutages.length + emergencyOutages.length + plannedOutages.length;

  const visibleTabs: Array<{ id: SidebarTab; label: string }> =
    appMode === 'view'
      ? [
          { id: 'overview', label: 'Огляд' },
          { id: 'history', label: `Історія (${assignmentHistory.length})` },
        ]
      : appMode === 'edit'
      ? [
          { id: 'overview', label: 'Огляд' },
          { id: 'transfers', label: `Переноси (${transfers.length + autoTransfers.length})` },
          { id: 'history', label: `Історія (${assignmentHistory.length})` },
        ]
      : [
          { id: 'overview', label: 'Огляд' },
          { id: 'transfers', label: 'Переноси' },
          { id: 'history', label: 'Історія' },
          { id: 'admin', label: 'Адмін' },
        ];

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddTransfer(transferDraft.street, transferDraft.houses, targetQueue, targetFeeder);
    setTargetFeeder('');
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-950/55 z-[1190] lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`${
          mobileOpen
            ? 'fixed inset-y-0 right-0 z-[1200] flex shadow-2xl'
            : 'hidden lg:flex'
        } w-[360px] max-w-[92vw] shrink-0 flex-col bg-white dark:bg-[#111827] border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 overflow-hidden`}
      >
        {/* Segmented Tabs Header */}
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex-1 flex items-center gap-1 p-1 bg-slate-100 dark:bg-[#0b1120] rounded-md border border-slate-200 dark:border-slate-800 overflow-x-auto">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mobileOpen && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Закрити панель"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Scrollable Tab Body */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800/80">
          {activeTab === 'overview' && (
            <>
              {/* My Home Section */}
              <section className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Home className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>Мій дім</span>
                  </h3>
                  {myHomeKey && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onFlyToHome();
                          onCloseMobile();
                        }}
                        className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        На карті
                      </button>
                      <span className="text-slate-400" aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={onClearHome}
                        className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-red-500 transition-colors"
                      >
                        Скинути
                      </button>
                    </div>
                  )}
                </div>

                {homeBuilding && homeInfo ? (
                  <div className="space-y-2 text-xs">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {homeBuilding.label || `${homeBuilding.street}, ${homeBuilding.house}`}
                    </div>
                    <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                      <span>
                        Черга{' '}
                        <strong className="font-mono text-slate-900 dark:text-white">
                          {formatSubqueue(homeInfo.primary)}
                        </strong>
                        {homeInfo.secondary && (
                          <span className="text-slate-500 dark:text-slate-400">
                            {' '}· 2-га{' '}
                            <strong className="font-mono text-slate-800 dark:text-slate-200">
                              {formatSubqueue(homeInfo.secondary)}
                            </strong>
                          </span>
                        )}
                      </span>
                      <span
                        className="font-semibold"
                        style={{ color: stateColor(homeSchedule[currentSlot] || 'on') }}
                      >
                        {stateLabel(homeSchedule[currentSlot] || 'on')}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                      {homeInfo.feeder}
                    </div>

                    {homeCountdown && (
                      <div className="flex items-center justify-between pt-2 pb-1 border-t border-slate-200 dark:border-slate-800">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {homeCountdown.label}
                        </span>
                        <span className="font-mono text-sm font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                          {homeCountdown.countdown}
                        </span>
                      </div>
                    )}

                    {homeSchedule.length === 48 && (
                      <div className="grid grid-cols-48 gap-[1px] h-3.5 bg-slate-100 dark:bg-slate-950 p-[2px] rounded border border-slate-200 dark:border-slate-800">
                        {homeSchedule.map((st, idx) => (
                          <button
                            key={idx}
                            type="button"
                            title={formatSlotTime(idx)}
                            onClick={() => onSelectSlot(idx)}
                            className={`h-full rounded-[1px] ${
                              idx === currentSlot
                                ? 'ring-1 ring-slate-900 dark:ring-white z-10'
                                : 'opacity-85 hover:opacity-100'
                            }`}
                            style={{ backgroundColor: stateColor(st) }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Натисніть на будівлю на карті та виберіть «Мій дім», щоб бачити живий таймер до наступного перемикання.
                  </p>
                )}
              </section>

              {/* Saved Favorite Addresses with Notes (IndexedDB + localStorage) */}
              <section className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    <span>Обрані адреси ({favorites.length})</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenFavoritesPage();
                      onCloseMobile();
                    }}
                    className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    Окрема сторінка →
                  </button>
                </div>

                {favorites.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Натисніть на будь-яку будівлю та оберіть «Обране», щоб зберегти адресу з приміткою (наприклад: Батьки, Офіс, Гараж).
                  </p>
                ) : (
                  <div className="space-y-2 text-xs">
                    {favorites.map((fav) => {
                      const mp = fav.key.startsWith('manual|')
                        ? manualPoints.find((p) => `manual|${p.id}` === fav.key)
                        : null;
                      const info = mp
                        ? null
                        : resolveBuilding(fav.street, fav.house, resolverCtx);
                      const activeQueue = mp ? mp.queue : info?.primary || null;
                      const curState: SlotState = activeQueue
                        ? queuesMap[activeQueue]?.[currentSlot] || 'on'
                        : 'on';

                      const isEditing = editingFavKey === fav.key;

                      return (
                        <div
                          key={fav.key}
                          className="py-2 border-b border-slate-200 dark:border-slate-800/80 last:border-b-0 space-y-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                onFlyToFavorite(fav);
                                onCloseMobile();
                              }}
                              className="text-left min-w-0 flex-1 group"
                            >
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                                  style={{
                                    backgroundColor: activeQueue ? stateColor(curState) : '#64748b',
                                  }}
                                />
                                <span className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 truncate transition-colors">
                                  {fav.label || `${fav.street}, ${fav.house}`}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 pl-4">
                                <span>
                                  {activeQueue ? `Черга ${formatSubqueue(activeQueue)}` : 'Без черги'}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{activeQueue ? stateLabel(curState) : 'Немає в ДПЕМ'}</span>
                              </div>
                              {fav.note && !isEditing && (
                                <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5 pl-4 break-words">
                                  {fav.note}
                                </div>
                              )}
                            </button>

                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingFavKey(isEditing ? null : fav.key);
                                  setEditingFavNote(fav.note || '');
                                }}
                                className="p-1.5 text-slate-400 hover:text-sky-500 transition-colors"
                                title="Редагувати примітку"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onRemoveFavorite(fav.key)}
                                className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                                title="Видалити з обраного"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {isEditing && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                onUpdateFavoriteNote(fav.key, editingFavNote.trim());
                                setEditingFavKey(null);
                              }}
                              className="flex gap-1.5 pl-4"
                            >
                              <input
                                type="text"
                                value={editingFavNote}
                                onChange={(e) => setEditingFavNote(e.target.value)}
                                maxLength={120}
                                placeholder="Примітка…"
                                className="flex-1 min-w-0 bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                              />
                              <button
                                type="submit"
                                className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium"
                              >
                                OK
                              </button>
                            </form>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Address Base Stats */}
              <section className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>Статистика бази адрес</span>
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {osmStats.fromCache ? 'OSM з кешу' : 'OSM актуальний'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Адрес у таблиці ДПЕМ
                    </div>
                    <div className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {addressIndex.addressIndex.size}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Вулиць списком (МПЗ)
                    </div>
                    <div className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {addressIndex.streetWildcardIndex.size}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Будівель OSM / Точок
                    </div>
                    <div className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {osmStats.osmCount} / {osmStats.googleCount + manualPoints.length}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Підстанцій OSM
                    </div>
                    <div className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {osmStats.substationCount}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-slate-200 dark:border-slate-800/80 text-xs">
                  <div>
                    <div className="text-slate-700 dark:text-slate-300">
                      Колізій (2+ черги на дім)
                    </div>
                    <div className="font-mono text-sm font-bold text-purple-600 dark:text-purple-400 tabular-nums">
                      {addressIndex.dualQueueCount} адрес
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleDualHighlight}
                    className={`px-2.5 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap ${
                      onlyDualHighlight
                        ? 'bg-purple-600 border-purple-500 text-white'
                        : 'bg-slate-100 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    {onlyDualHighlight ? 'Показати всі' : 'Виділити колізії'}
                  </button>
                </div>
              </section>

              {/* Operational / Emergency / Planned Notices */}
              <section className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                    <span>Зведення ДПЕМ</span>
                  </h3>
                  {operUpdatedAt && (
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {operUpdatedAt}
                    </span>
                  )}
                </div>

                {totalNotices === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    На сторінках off_o / off_a / off_p додаткових повідомлень зараз немає.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1 text-xs">
                    {emergencyOutages.map((n, i) => (
                      <div key={`em_${i}`} className="py-1.5 border-b border-slate-200 dark:border-slate-800/70">
                        <div className="font-medium text-red-600 dark:text-red-400">
                          Аварійне {n.substation ? `· ${n.substation}` : ''} {n.feeder || ''}
                        </div>
                        <div className="text-slate-700 dark:text-slate-300 mt-0.5 leading-snug">
                          {n.description}
                        </div>
                      </div>
                    ))}
                    {operOutages.map((n, i) => (
                      <div key={`op_${i}`} className="py-1.5 border-b border-slate-200 dark:border-slate-800/70">
                        <div className="font-medium text-amber-700 dark:text-amber-300">
                          Погодинне {n.timeRange ? `· ${n.timeRange}` : ''}
                        </div>
                        <div className="text-slate-700 dark:text-slate-300 mt-0.5 leading-snug">
                          {n.description}
                        </div>
                      </div>
                    ))}
                    {plannedOutages.map((n, i) => (
                      <div key={`pl_${i}`} className="py-1.5 border-b border-slate-200 dark:border-slate-800/70">
                        <div className="font-medium text-sky-700 dark:text-sky-300">
                          Плановий ремонт {n.timeRange ? `· ${n.timeRange}` : ''}
                        </div>
                        <div className="text-slate-700 dark:text-slate-300 mt-0.5 leading-snug">
                          {n.description}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === 'transfers' && (
            <>
              {/* Add Transfer Form */}
              <section className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Shuffle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                    <span>Перенос адрес на інший фідер</span>
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {authUser ? 'У Firestore' : 'Локально'}
                  </span>
                </div>

                <form onSubmit={handleTransferSubmit} className="space-y-2.5 text-xs">
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Вулиця
                    </label>
                    <input
                      type="text"
                      value={transferDraft.street}
                      onChange={(e) =>
                        onTransferDraftChange({ ...transferDraft, street: e.target.value })
                      }
                      placeholder="Наприклад: Незалежності"
                      className="w-full bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-2 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Будинки (через кому)
                    </label>
                    <input
                      type="text"
                      value={transferDraft.houses}
                      onChange={(e) =>
                        onTransferDraftChange({ ...transferDraft, houses: e.target.value })
                      }
                      placeholder="Наприклад: 1, 3, 5, 6А"
                      className="w-full bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-2 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        Цільова черга
                      </label>
                      <select
                        value={targetQueue}
                        onChange={(e) => setTargetQueue(e.target.value as SubqueueId)}
                        className="w-full bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                      >
                        {SUBQUEUES.map((q) => (
                          <option key={q} value={q}>
                            Черга {formatSubqueue(q)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        Фідер (необовʼязк.)
                      </label>
                      <input
                        type="text"
                        value={targetFeeder}
                        onChange={(e) => setTargetFeeder(e.target.value)}
                        placeholder="Березка Ф-12"
                        className="w-full bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-2 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 px-3 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold transition-colors"
                  >
                    Застосувати перенос
                  </button>
                </form>
              </section>

              {/* Active Transfers List */}
              <section className="p-4 space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Активні переноси ({transfers.length + autoTransfers.length})
                </h3>

                {transfers.length === 0 && autoTransfers.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Тимчасових переносів немає. На карті перенесені будинки мають пунктирний контур.
                  </p>
                ) : (
                  <div className="space-y-2 text-xs">
                    {autoTransfers.map((t) => (
                      <div
                        key={t.id}
                        className="py-2 border-b border-slate-200 dark:border-slate-800/80"
                      >
                        <div className="font-medium text-amber-700 dark:text-amber-300">
                          [Авто off_a] {t.street} ({t.houses.join(', ')}) →{' '}
                          {formatSubqueue(t.targetQueue)}
                        </div>
                        {t.targetFeeder && (
                          <div className="text-[11px] text-slate-500">{t.targetFeeder}</div>
                        )}
                      </div>
                    ))}

                    {transfers.map((t) => (
                      <div
                        key={t.id}
                        className="py-2 border-b border-slate-200 dark:border-slate-800/80 flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {t.street} ({t.houses.join(', ')}) →{' '}
                            <span className="font-mono text-amber-600 dark:text-amber-400">
                              {formatSubqueue(t.targetQueue)}
                            </span>
                          </div>
                          {t.targetFeeder && (
                            <div className="text-[11px] text-slate-500">{t.targetFeeder}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveTransfer(t.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 transition-colors shrink-0"
                          title="Скасувати перенос"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Active Dual-Queue Overrides */}
              <section className="p-4 space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Уточнення колізій ({overrideEntries.length})
                </h3>
                {overrideEntries.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Індивідуальні правила для колізій налаштовуються при кліку по будинку на карті.
                  </p>
                ) : (
                  <div className="space-y-2 text-xs max-h-56 overflow-y-auto pr-1">
                    {overrideEntries.map(([key, ov]) => {
                      const [st, hn] = key.split('|');
                      return (
                        <div
                          key={key}
                          className="py-1.5 border-b border-slate-200 dark:border-slate-800/80 flex items-start justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800 dark:text-slate-200 capitalize truncate">
                              {st}, {hn}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {ov.primary ? `Осн: ${formatSubqueue(ov.primary)}` : ''}
                              {ov.secondary ? ` · 2-га: ${formatSubqueue(ov.secondary)}` : ''}
                              {ov.dualType
                                ? ` · ${
                                    ov.dualType === 'backup'
                                      ? 'Тільки 1-ша'
                                      : ov.dualType === 'split_lifts'
                                      ? 'Ліфти'
                                      : 'Підʼїзди'
                                  }`
                                : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onRemoveOverride(key)}
                            className="p-1.5 text-slate-400 hover:text-red-500 transition-colors shrink-0"
                            title="Скинути правило"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === 'history' && (
            <>
              {/* Shared Firestore Banner */}
              <section className="p-3.5 bg-slate-50 dark:bg-[#0b1120]/60 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                    <Cloud className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                    <span>
                      {cloudConnected ? 'Спільна база Firestore (для всіх)' : 'Локальний режим'}
                    </span>
                  </div>
                  {!authUser && (
                    <button
                      type="button"
                      onClick={onSignIn}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold whitespace-nowrap shrink-0"
                    >
                      <LogIn className="w-3 h-3" />
                      <span>Увійти</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                  {effectiveRole === 'banned'
                    ? 'Ваш доступ до спільних правок заблоковано адміністратором.'
                    : effectiveRole === 'super_admin' || effectiveRole === 'admin' || effectiveRole === 'editor'
                    ? `Ви увійшли як ${authUser?.displayName || authUser?.email} (${
                        effectiveRole === 'super_admin'
                          ? 'Супер-адмін'
                          : effectiveRole === 'admin'
                          ? 'Адмін'
                          : 'Редактор'
                      }) — правки одразу бачать усі.`
                    : 'Усі бачать спільні точки та історію. Щоб вносити спільні правки, подайте запит адміністраторам.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onOpenAccessControl();
                    onCloseMobile();
                  }}
                  className="mt-2 w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] hover:border-sky-500 text-[11px] font-semibold text-slate-800 dark:text-slate-200 transition-colors"
                >
                  {effectiveRole === 'super_admin' || effectiveRole === 'admin' ? (
                    <>
                      <Users className="w-3.5 h-3.5 text-sky-500" />
                      <span>
                        Права та запити
                        {pendingAccessRequestsCount > 0 ? ` (${pendingAccessRequestsCount} нових)` : ''}
                      </span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5 text-sky-500" />
                      <span>Запросити права редактора / адміна</span>
                    </>
                  )}
                </button>
              </section>

              {/* Pinned Manual Points (When address is unknown) */}
              <section className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>Вказані точки ({manualPoints.length})</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      onStartPickPoint();
                      onCloseMobile();
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium whitespace-nowrap"
                  >
                    <MapPinPlus className="w-3 h-3" />
                    <span>Вказати</span>
                  </button>
                </div>

                {manualPoints.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Якщо не знаєте точну адресу, натисніть «Вказати точку» та клікніть будь-де на карті.
                  </p>
                ) : (
                  <div className="space-y-2 text-xs">
                    {manualPoints.map((pt) => {
                      const st = queuesMap[pt.queue]?.[currentSlot] || 'on';
                      return (
                        <div
                          key={pt.id}
                          className="py-2 border-b border-slate-200 dark:border-slate-800/80 last:border-b-0 flex items-start justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onFlyToManualPoint(pt);
                              onCloseMobile();
                            }}
                            className="text-left min-w-0 flex-1 group"
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: stateColor(st) }}
                              />
                              <span className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 truncate">
                                {pt.label}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 pl-4 mt-0.5">
                              Черга <span className="font-mono">{formatSubqueue(pt.queue)}</span> ·{' '}
                              {stateLabel(st)}
                              {pt.authorName ? ` · ${pt.authorName}` : ''}
                              {!pt.isCloud ? ' · Локально' : ''}
                            </div>
                            {pt.note && (
                              <div className="text-[11px] text-slate-600 dark:text-slate-300 pl-4 mt-0.5 break-words">
                                {pt.note}
                              </div>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => onDeleteManualPoint(pt.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 transition-colors shrink-0"
                            title="Видалити точку"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Separate Shared Assignment History Journal */}
              <section className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>Історія вказань ({assignmentHistory.length})</span>
                  </h3>
                  {assignmentHistory.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearAssignmentHistory}
                      className="text-[11px] text-slate-500 hover:text-red-500 transition-colors"
                    >
                      Очистити
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  Окремий спільний журнал усіх вказаних точок та ручних змін колізій адрес (зберігається у Firestore для всіх).
                </p>

                {assignmentHistory.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Записів поки немає.
                  </p>
                ) : (
                  <div className="space-y-2 text-xs max-h-96 overflow-y-auto pr-1">
                    {assignmentHistory.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onFlyToHistoryEntry(item);
                          onCloseMobile();
                        }}
                        className="w-full text-left py-2 border-b border-slate-200 dark:border-slate-800/70 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded px-1.5 -mx-1.5 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {item.title}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400 shrink-0 tabular-nums">
                            {new Date(item.timestamp).toLocaleString('uk-UA', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">
                          {item.details}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {item.isCloud
                            ? `Firestore${item.authorName ? ` · ${item.authorName}` : ''}`
                            : 'Локальний запис'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === 'admin' && (
            <>
              {/* Audit Dashboard Quick Preview Card */}
              <section className="p-4 space-y-3 bg-slate-50/70 dark:bg-[#0b1120]/50 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>Аудит та дашборд</span>
                  </h3>
                  <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {(auditStats?.activeLast15mAnon || 0) +
                      (auditStats?.activeLast15mLoggedIn || 0)}{' '}
                    онлайн
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                    <div className="text-[10px] text-slate-500">Анонімні</div>
                    <div className="font-mono text-base font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                      {auditStats?.uniqueAnonymous ?? '—'}
                    </div>
                  </div>
                  <div className="p-2 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                    <div className="text-[10px] text-slate-500">Залогінені</div>
                    <div className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {auditStats?.uniqueLoggedIn ?? '—'}
                    </div>
                  </div>
                  <div className="p-2 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                    <div className="text-[10px] text-slate-500">Правки</div>
                    <div className="font-mono text-base font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                      {auditEditsCount}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onOpenAuditDashboard();
                    onCloseMobile();
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Відкрити дашборд аудиту</span>
                </button>
              </section>

              {/* RBAC Access Requests & Team Moderation */}
              <section className="p-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>Команда та запити прав</span>
                  </h3>
                  {pendingAccessRequestsCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-mono text-[10px] font-bold">
                      {pendingAccessRequestsCount} нових
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {effectiveRole === 'super_admin'
                    ? 'Супер-адмін: видача ролей, бан та видалення будь-яких адмінів і редакторів.'
                    : effectiveRole === 'admin'
                    ? 'Адмін: видача ролей редактора/адміна, бан редакторів і доданих вами адмінів.'
                    : 'Подайте запит на права редактора або адміністратора для спільних правок.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onOpenAccessControl();
                    onCloseMobile();
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-semibold transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5 text-sky-500" />
                  <span>
                    {isAdminUser ? 'Керувати правами та запитами' : 'Подати запит на права'}
                  </span>
                </button>
              </section>

              {/* Admin Auth, Telegram Login & Cloud Status */}
              <section className="p-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>Авторизація (Google / Telegram)</span>
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {effectiveRole === 'super_admin'
                      ? 'Супер-адмін'
                      : effectiveRole === 'admin'
                      ? 'Адмін'
                      : effectiveRole === 'editor'
                      ? 'Редактор'
                      : effectiveRole === 'banned'
                      ? 'Бан'
                      : 'Гість'}
                  </span>
                </div>

                {authUser ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {authUser.displayName || authUser.email}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {isAdminUser
                            ? 'Права адміністратора Firestore активні'
                            : effectiveRole === 'editor'
                            ? 'Права редактора Firestore активні'
                            : 'Режим перегляду — подайте запит на редагування'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onSignOut}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium shrink-0"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>Вийти</span>
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <Cloud className="w-3.5 h-3.5 text-sky-500" />
                      <span>
                        Firestore: {cloudConnected ? 'підключено в реальному часі' : 'офлайн'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                      Увійдіть через Google (для спільної бази Firestore та ролей) або Telegram.
                    </p>
                    <button
                      type="button"
                      onClick={onSignIn}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Увійти через Google</span>
                    </button>
                  </div>
                )}

                {/* Telegram Account Status / Login Widget */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  {telegramUser ? (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-2">
                        <Send className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {telegramUser.firstName}
                            {telegramUser.username ? ` (@${telegramUser.username})` : ''}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {telegramUser.verified
                              ? 'Telegram підтверджено (HMAC-SHA256)'
                              : 'Telegram Mini App профіль (додайте TELEGRAM_BOT_TOKEN для підпису)'}
                          </div>
                        </div>
                      </div>
                      {telegramUser.verified && (
                        <button
                          type="button"
                          onClick={onTelegramSignOut}
                          className="text-[11px] text-slate-500 hover:text-red-500 shrink-0"
                        >
                          Вийти
                        </button>
                      )}
                    </div>
                  ) : telegramBotUsername ? (
                    <div className="space-y-1.5">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Або увійдіть через Telegram:
                      </div>
                      <TelegramLoginButton
                        botUsername={telegramBotUsername}
                        onAuth={onTelegramWidgetAuth}
                      />
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Send className="w-3 h-3 text-sky-500 shrink-0" />
                      <span>
                        Telegram Mini App працює автоматично при відкритті з бота. Для входу через Telegram у браузері задайте <code className="font-mono">TELEGRAM_BOT_TOKEN</code> та <code className="font-mono">TELEGRAM_BOT_USERNAME</code>.
                      </span>
                    </div>
                  )}
                </div>
              </section>

              {/* Live API, HTML Upload & OSM Cache */}
              <section className="p-4 space-y-3 text-xs">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Джерело Live API, HTML та кеш OSM
                </h3>
                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      URL API (порожньо = вбудований проксі /api/dpem)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="url"
                        value={apiInput}
                        onChange={(e) => setApiInput(e.target.value)}
                        placeholder="https://your-worker.workers.dev"
                        className="flex-1 min-w-0 bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => onSaveApiUrl(apiInput.trim())}
                        className="px-3 py-1.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-medium whitespace-nowrap"
                      >
                        OK
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Інтервал фонового опитування
                    </label>
                    <select
                      value={pollIntervalMs}
                      onChange={(e) => onPollIntervalChange(Number(e.target.value))}
                      className="w-full bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                    >
                      <option value={300000}>Раз на 5 хвилин</option>
                      <option value={600000}>Раз на 10 хвилин (оптимально)</option>
                      <option value={1800000}>Раз на 30 хвилин (економний)</option>
                      <option value={0}>Лише вручну</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onUploadHtmlClick}
                      className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium"
                    >
                      <FileUp className="w-3.5 h-3.5 text-sky-500" />
                      <span>HTML файл</span>
                    </button>
                    <button
                      type="button"
                      onClick={onReloadOsm}
                      className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Кеш OSM</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* Export / Import JSON Settings */}
              <section className="p-4 space-y-2.5 text-xs">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Експорт / Імпорт бази (JSON)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Включає переноси фідерів, колізії, обрані адреси, вказані точки та історію вказань.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onExportSettings}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Експорт</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => importInputRef.current?.click()}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Імпорт</span>
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        onImportSettings(file);
                        e.target.value = '';
                      }
                    }}
                  />
                </div>
              </section>

              {/* Diff Render Log */}
              <section className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Журнал Diff-перемальовування
                  </h3>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {diffLog.length} подій
                  </span>
                </div>

                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1 font-mono text-[11px]">
                  {diffLog.length === 0 ? (
                    <div className="text-slate-500 font-sans text-xs">
                      Очікування завантаження карти…
                    </div>
                  ) : (
                    diffLog.map((entry) => (
                      <div
                        key={entry.id}
                        className="py-1 border-b border-slate-200 dark:border-slate-800/60 leading-snug text-slate-500 dark:text-slate-400"
                      >
                        <span className="text-slate-400 dark:text-slate-500">[{entry.time}]</span>{' '}
                        <span className="text-slate-800 dark:text-slate-200 font-medium">
                          {entry.reason}:
                        </span>{' '}
                        <span
                          className={
                            entry.repainted > 0
                              ? 'text-sky-600 dark:text-sky-400 font-medium'
                              : 'text-slate-400 dark:text-slate-500'
                          }
                        >
                          {entry.message}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
