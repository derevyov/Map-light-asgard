import React, { useEffect, useState } from 'react';
import { Check, Home, Shuffle, Star, Trash2, X } from 'lucide-react';
import { stateColor, stateLabel } from '../lib/resolver';
import {
  buildMergedIntervals,
  formatDurationShort,
  normalizeDisplayState,
} from '../lib/scheduleIntervals';
import {
  BuildingRecord,
  DualQueueType,
  FavoriteAddress,
  formatSlotTime,
  formatSubqueue,
  SlotState,
  SubqueueId,
} from '../lib/types';

export type AppMode = 'view' | 'edit' | 'admin';

interface BuildingInspectorProps {
  appMode: AppMode;
  building: BuildingRecord;
  isHome: boolean;
  favorite: FavoriteAddress | null;
  queuesMap: Partial<Record<SubqueueId, SlotState[]>>;
  currentSlot: number;
  mergedLightDark: boolean;
  onClose: () => void;
  onSetHome: (building: BuildingRecord) => void;
  onSaveFavorite: (building: BuildingRecord, note: string) => void;
  onRemoveFavorite: (key: string) => void;
  onSelectPrimaryQueue: (
    building: BuildingRecord,
    nextPrimary: SubqueueId,
    allQueues: SubqueueId[]
  ) => void;
  onSetDualType: (building: BuildingRecord, dualType: DualQueueType) => void;
  onStartTransfer: (building: BuildingRecord) => void;
  onDeleteManualPoint?: (pointId: string) => void;
  onSelectSlot: (slot: number) => void;
}

export const BuildingInspector: React.FC<BuildingInspectorProps> = ({
  appMode,
  building,
  isHome,
  favorite,
  queuesMap,
  currentSlot,
  mergedLightDark,
  onClose,
  onSetHome,
  onSaveFavorite,
  onRemoveFavorite,
  onSelectPrimaryQueue,
  onSetDualType,
  onStartTransfer,
  onDeleteManualPoint,
  onSelectSlot,
}) => {
  const [favOpen, setFavOpen] = useState<boolean>(false);
  const [noteInput, setNoteInput] = useState<string>(favorite?.note || '');

  useEffect(() => {
    setNoteInput(favorite?.note || '');
    setFavOpen(false);
  }, [building.id, favorite?.note]);

  const vis = building.currentVisual;
  const info = vis?.info ?? null;
  const primarySchedule = info ? queuesMap[info.primary] || [] : [];
  const secondarySchedule = info?.secondary ? queuesMap[info.secondary] || [] : [];
  const hasCollision = Boolean(info && info.allQueues.length > 1);
  const canEditStructure = appMode === 'edit' || appMode === 'admin';

  const sourceText =
    building.source === 'manual'
      ? 'Вказана точка'
      : building.source === 'google'
      ? 'Точка Google Maps'
      : 'Контур OSM';

  const handleFavoriteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveFavorite(building, noteInput.trim());
    setFavOpen(false);
  };

  return (
    <div
      className="fixed sm:absolute bottom-0 inset-x-0 sm:inset-x-auto sm:bottom-auto sm:top-3 sm:right-3 z-[1050] sm:w-[345px] bg-white/97 dark:bg-[#111827]/97 backdrop-blur-md border-t sm:border border-slate-200 dark:border-slate-700/90 rounded-t-xl sm:rounded-lg shadow-2xl text-slate-900 dark:text-slate-100 overflow-hidden"
      role="dialog"
      aria-label="Деталі будівлі"
    >
      {/* Mobile drag handle indicator */}
      <div className="sm:hidden flex justify-center pt-2 pb-0.5">
        <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-2.5 sm:py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {building.label || `${building.street || 'Без вулиці'}, ${building.house}`}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            <span>{sourceText}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {building.lat.toFixed(5)}, {building.lng.toFixed(5)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 sm:p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors shrink-0"
          aria-label="Закрити"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3 text-xs max-h-[54vh] sm:max-h-[calc(100vh-185px)] overflow-y-auto">
        {/* Status Row */}
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-800/80">
          <span className="text-slate-500 dark:text-slate-400">
            Статус ({formatSlotTime(currentSlot)})
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100 text-right">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: vis?.color || '#64748b' }}
            />
            {vis?.statusText || 'Немає даних'}
          </span>
        </div>

        {/* Manual Point Note */}
        {building.source === 'manual' && building.manualNote && (
          <div className="px-2.5 py-1.5 rounded bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 text-sky-900 dark:text-sky-200">
            <span className="font-semibold">Примітка точки: </span>
            <span>{building.manualNote}</span>
          </div>
        )}

        {/* Saved Favorite Note Display */}
        {favorite && !favOpen && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200">
            <div className="min-w-0 truncate">
              <span className="font-semibold">Обране: </span>
              <span>{favorite.note || 'Без примітки'}</span>
            </div>
            <button
              type="button"
              onClick={() => setFavOpen(true)}
              className="text-[11px] underline shrink-0 hover:text-amber-700 dark:hover:text-amber-100"
            >
              Змінити
            </button>
          </div>
        )}

        {/* Queue & Feeder details */}
        {info ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Активна підчерга</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {formatSubqueue(info.primary)}
                {info.secondary ? ` (інша: ${formatSubqueue(info.secondary)})` : ''}
              </span>
            </div>

            {/* Collision Resolver: highlights first by default, lets user change anytime */}
            {hasCollision && (
              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0b1120] border border-slate-200 dark:border-slate-700/80 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Колізія адрес ({info.allQueues.length} черги)
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Обрано першу · можна змінити
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {info.allQueues.map((q) => {
                    const isPrimary = q === info.primary;
                    const qState = queuesMap[q]?.[currentSlot] || 'on';
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() => onSelectPrimaryQueue(building, q, info.allQueues)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-mono font-semibold border transition-colors ${
                          isPrimary
                            ? 'bg-sky-600 border-sky-500 text-white'
                            : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-sky-500'
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: stateColor(qState) }}
                        />
                        <span>{formatSubqueue(q)}</span>
                      </button>
                    );
                  })}
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Режим відображення колізії
                  </label>
                  <select
                    value={info.dualType}
                    onChange={(e) => onSetDualType(building, e.target.value as DualQueueType)}
                    className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                  >
                    <option value="backup">Підсвічувати тільки основну (1-шу)</option>
                    <option value="split_entrances">2 черги: частина підʼїздів (фіолетовий)</option>
                    <option value="split_lifts">2 черги: квартири відкл., ліфти є (блакитний)</option>
                  </select>
                </div>
              </div>
            )}

            <div className="text-slate-700 dark:text-slate-300 leading-relaxed break-words">
              <span className="text-slate-500 dark:text-slate-400">Фідер: </span>
              {info.feeder}
            </div>
            {info.isWildcardMatch && (
              <div className="text-slate-500 dark:text-slate-400">
                Привʼязка за списком вулиці (МПЗ / приватний сектор)
              </div>
            )}
            {info.isTransferred && (
              <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 leading-snug">
                <div className="font-semibold">Тимчасовий перенос фідера</div>
                <div className="text-amber-800 dark:text-amber-300/90 mt-0.5">
                  Перенесено з: {info.transferredFrom}
                </div>
                {info.transferReason && (
                  <div className="text-amber-700 dark:text-amber-300/80 mt-0.5">
                    {info.transferReason}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Адресу{' '}
            <span className="text-slate-900 dark:text-slate-200 font-medium">
              {building.street}, {building.house}
            </span>{' '}
            не знайдено у таблиці ДПЕМ. У режимі «Редагування» можна призначити фідер або вказати точку на карті.
          </div>
        )}

        {/* 24h mini schedule bar (merged contiguous intervals or 48 half-hour slots) */}
        {info && primarySchedule.length === 48 && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                Графік 24 год ({formatSubqueue(info.primary)})
                {mergedLightDark ? ' · обʼєднано' : ''}
              </span>
              <span className="font-mono">00:00 — 24:00</span>
            </div>

            {mergedLightDark ? (
              <>
                <div className="relative h-5 rounded overflow-hidden border border-slate-200 dark:border-slate-800 flex bg-slate-100 dark:bg-slate-950">
                  {buildMergedIntervals(primarySchedule, true).map((seg) => {
                    const widthPct = ((seg.endSlot - seg.startSlot) / 48) * 100;
                    return (
                      <button
                        key={`${seg.startSlot}-${seg.endSlot}`}
                        type="button"
                        onClick={() => onSelectSlot(seg.startSlot)}
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: stateColor(seg.state),
                        }}
                        className="h-full border-r border-white/25 dark:border-slate-950/40 last:border-r-0 hover:opacity-90 transition-opacity"
                        title={`${seg.startTime}–${seg.endTime}: ${stateLabel(seg.state)} (${formatDurationShort(seg.durationMin)})`}
                      />
                    );
                  })}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white dark:bg-sky-300 shadow-[0_0_4px_rgba(0,0,0,0.9)] pointer-events-none"
                    style={{ left: `${((currentSlot + 0.5) / 48) * 100}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {buildMergedIntervals(primarySchedule, true).map((seg) => (
                    <button
                      key={`chip-${seg.startSlot}`}
                      type="button"
                      onClick={() => onSelectSlot(seg.startSlot)}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                        seg.state === 'on'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300/70 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                          : 'bg-red-50 dark:bg-red-950/40 border-red-300/70 dark:border-red-800 text-red-800 dark:text-red-300'
                      }`}
                    >
                      <span>
                        {seg.startTime}–{seg.endTime}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="grid grid-cols-48 gap-[1px] h-4 bg-slate-100 dark:bg-slate-950 p-[2px] rounded border border-slate-200 dark:border-slate-800">
                {primarySchedule.map((st, idx) => (
                  <button
                    key={idx}
                    type="button"
                    title={formatSlotTime(idx)}
                    onClick={() => onSelectSlot(idx)}
                    className={`h-full rounded-[1px] transition-opacity ${
                      idx === currentSlot
                        ? 'ring-1 ring-slate-900 dark:ring-white z-10'
                        : 'opacity-85 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: stateColor(st) }}
                  />
                ))}
              </div>
            )}

            {info.secondary && secondarySchedule.length === 48 && (
              <>
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                  <span>Альтернативна черга ({formatSubqueue(info.secondary)})</span>
                  <span>
                    {info.dualType === 'backup'
                      ? 'Резерв'
                      : info.dualType === 'split_lifts'
                      ? 'Ліфти'
                      : 'Підʼїзди'}
                  </span>
                </div>
                <div className="grid grid-cols-48 gap-[1px] h-3 bg-slate-100 dark:bg-slate-950 p-[2px] rounded border border-slate-200 dark:border-slate-800">
                  {secondarySchedule.map((st, idx) => (
                    <button
                      key={idx}
                      type="button"
                      title={formatSlotTime(idx)}
                      onClick={() => onSelectSlot(idx)}
                      className={`h-full rounded-[1px] ${
                        idx === currentSlot
                          ? 'ring-1 ring-slate-900 dark:ring-white z-10'
                          : 'opacity-80 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: stateColor(normalizeDisplayState(st, mergedLightDark)),
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Inline Favorite Note Form */}
        {favOpen && (
          <form
            onSubmit={handleFavoriteSubmit}
            className="p-2.5 rounded bg-slate-50 dark:bg-[#0b1120] border border-slate-200 dark:border-slate-700 space-y-2"
          >
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
              Примітка для обраної адреси (зберігається в браузері)
            </label>
            <input
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              maxLength={120}
              placeholder="Наприклад: Батьки, Офіс, Гараж, Школа…"
              autoFocus
              className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
            />
            <div className="flex items-center justify-between gap-2">
              {favorite ? (
                <button
                  type="button"
                  onClick={() => {
                    onRemoveFavorite(building.key);
                    setFavOpen(false);
                  }}
                  className="text-[11px] text-red-600 dark:text-red-400 hover:underline py-1"
                >
                  Видалити з обраного
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFavOpen(false)}
                  className="px-2.5 py-1.5 rounded text-[11px] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold"
                >
                  <Check className="w-3 h-3" />
                  <span>Зберегти</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Controls */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <div className={`grid gap-1.5 ${canEditStructure ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <button
              type="button"
              onClick={() => onSetHome(building)}
              className={`flex items-center justify-center gap-1 px-2 py-2.5 sm:py-2 rounded font-medium transition-colors whitespace-nowrap ${
                isHome
                  ? 'bg-sky-100 dark:bg-sky-500/20 border border-sky-400 dark:border-sky-500/60 text-sky-800 dark:text-sky-300'
                  : 'bg-sky-600 hover:bg-sky-500 text-white'
              }`}
            >
              <Home className="w-3.5 h-3.5 shrink-0" />
              <span>Мій дім</span>
            </button>

            <button
              type="button"
              onClick={() => setFavOpen((v) => !v)}
              className={`flex items-center justify-center gap-1 px-2 py-2.5 sm:py-2 rounded font-medium transition-colors whitespace-nowrap ${
                favorite
                  ? 'bg-amber-100 dark:bg-amber-500/20 border border-amber-400 dark:border-amber-500/60 text-amber-800 dark:text-amber-300'
                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200'
              }`}
            >
              <Star
                className={`w-3.5 h-3.5 shrink-0 ${favorite ? 'fill-amber-500 text-amber-500' : ''}`}
              />
              <span>Обране</span>
            </button>

            {canEditStructure &&
              (building.source === 'manual' && onDeleteManualPoint ? (
                <button
                  type="button"
                  onClick={() => onDeleteManualPoint(building.id)}
                  className="flex items-center justify-center gap-1 px-2 py-2.5 sm:py-2 rounded font-medium bg-red-600 hover:bg-red-500 text-white transition-colors whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Видалити</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onStartTransfer(building)}
                  className="flex items-center justify-center gap-1 px-2 py-2.5 sm:py-2 rounded font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors whitespace-nowrap"
                >
                  <Shuffle className="w-3.5 h-3.5 shrink-0" />
                  <span>Фідер</span>
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};
