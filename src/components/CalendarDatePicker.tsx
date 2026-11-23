import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { addDaysIso, daysBetweenIso } from '../lib/scheduleForecast';

interface CalendarDatePickerProps {
  selectedDate: string; // YYYY-MM-DD
  availableDates: string[]; // sorted DESC YYYY-MM-DD
  onSelectDate: (date: string) => void;
  allowForecast?: boolean;
  isForecastDate?: boolean;
  maxForecastDays?: number;
}

const MONTHS_UK = [
  'Січень',
  'Лютий',
  'Березень',
  'Квітень',
  'Травень',
  'Червень',
  'Липень',
  'Серпень',
  'Вересень',
  'Жовтень',
  'Листопад',
  'Грудень',
];

const MONTHS_SHORT_UK = [
  'січ.',
  'лют.',
  'бер.',
  'квіт.',
  'трав.',
  'черв.',
  'лип.',
  'серп.',
  'вер.',
  'жовт.',
  'лист.',
  'груд.',
];

const WEEKDAYS_UK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const parts = iso.split('-').map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return { year: parts[0], month: parts[1] - 1, day: parts[2] };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

function toIsoDate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function formatButtonDate(iso: string): string {
  const { year, month, day } = parseIsoDate(iso);
  return `${String(day).padStart(2, '0')} ${MONTHS_SHORT_UK[month] || ''} ${year}`;
}

export const CalendarDatePicker: React.FC<CalendarDatePickerProps> = ({
  selectedDate,
  availableDates,
  onSelectDate,
  allowForecast = false,
  isForecastDate = false,
  maxForecastDays = 180,
}) => {
  const [open, setOpen] = useState(false);
  const initial = parseIsoDate(selectedDate);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);
  const latestDate = availableDates[0] || selectedDate;
  const maxForecastIso = useMemo(
    () => addDaysIso(latestDate, maxForecastDays),
    [latestDate, maxForecastDays]
  );

  // Sync displayed calendar month when selectedDate changes externally
  useEffect(() => {
    const parsed = parseIsoDate(selectedDate);
    setViewYear(parsed.year);
    setViewMonth(parsed.month);
  }, [selectedDate]);

  // Close on outside click or Escape key
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const calendarCells = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    // Convert JS Sunday=0..Saturday=6 into Monday=0..Sunday=6
    const startOffset = (firstOfMonth.getDay() + 6) % 7;

    const cells: Array<{ day: number | null; iso: string | null }> = [];
    for (let i = 0; i < startOffset; i++) {
      cells.push({ day: null, iso: null });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ day, iso: toIsoDate(viewYear, viewMonth, day) });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const shiftMonth = (delta: number) => {
    let nextM = viewMonth + delta;
    let nextY = viewYear;
    if (nextM < 0) {
      nextM = 11;
      nextY -= 1;
    } else if (nextM > 11) {
      nextM = 0;
      nextY += 1;
    }
    setViewMonth(nextM);
    setViewYear(nextY);
  };

  // Count how many dates have official DPEM schedules in the currently viewed month
  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-`;
  const monthAvailableCount = useMemo(
    () => availableDates.filter((d) => d.startsWith(monthPrefix)).length,
    [availableDates, monthPrefix]
  );

  const isSelectedForecast = isForecastDate || (allowForecast && !availableSet.has(selectedDate));

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Вибір дати графіка у календарі"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-colors whitespace-nowrap ${
          isSelectedForecast
            ? 'bg-violet-50 dark:bg-violet-950/60 border-violet-500 text-violet-800 dark:text-violet-200'
            : open
            ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-500 text-sky-700 dark:text-sky-300'
            : 'bg-slate-50 dark:bg-[#0b1120] border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 hover:border-sky-500/70'
        }`}
      >
        {isSelectedForecast ? (
          <Sparkles className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
        ) : (
          <CalendarIcon className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
        )}
        <span className="font-mono tabular-nums">{formatButtonDate(selectedDate)}</span>
        {isSelectedForecast && (
          <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-violet-600 text-white leading-none">
            Прогноз
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Календар графіків ДПЕМ та прогнозу"
          className="fixed inset-x-3 top-24 sm:inset-auto sm:absolute sm:right-0 md:left-0 md:right-auto sm:top-full sm:mt-1.5 z-[2500] sm:w-[292px] bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 rounded-lg shadow-2xl p-3 text-xs text-slate-900 dark:text-slate-100"
        >
          {/* Month Navigation */}
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
              aria-label="Попередній місяць"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="text-center">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {MONTHS_UK[viewMonth]} {viewYear}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {monthAvailableCount > 0
                  ? `${monthAvailableCount} офіц. дн.${allowForecast ? ' · інше — прогноз' : ''}`
                  : allowForecast
                  ? 'Прогноз за алгоритмом зміщення'
                  : 'Немає графіків за цей місяць'}
              </div>
            </div>

            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
              aria-label="Наступний місяць"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS_UK.map((wd) => (
              <div
                key={wd}
                className="text-center text-[10px] font-semibold text-slate-400 dark:text-slate-500 py-0.5"
              >
                {wd}
              </div>
            ))}
          </div>

          {/* Calendar Day Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cell, idx) => {
              if (!cell.day || !cell.iso) {
                return <div key={`empty_${idx}`} className="h-8" />;
              }

              const hasData = availableSet.has(cell.iso);
              const deltaFromLatest = daysBetweenIso(latestDate, cell.iso);
              const isForecastable =
                allowForecast && !hasData && cell.iso <= maxForecastIso && deltaFromLatest >= -30;
              const isClickable = hasData || isForecastable;
              const isSelected = cell.iso === selectedDate;
              const isLatest = cell.iso === latestDate;

              return (
                <button
                  key={cell.iso}
                  type="button"
                  disabled={!isClickable}
                  onClick={() => {
                    onSelectDate(cell.iso!);
                    setOpen(false);
                  }}
                  title={
                    hasData
                      ? `Офіційний графік ДПЕМ за ${cell.iso}`
                      : isForecastable
                      ? `Прогноз графіка за ${cell.iso} (${
                          deltaFromLatest >= 0 ? `+${deltaFromLatest}` : deltaFromLatest
                        } дн. від ${latestDate})`
                      : `Немає даних за ${cell.iso}`
                  }
                  className={`relative h-8 rounded flex flex-col items-center justify-center font-mono text-xs transition-colors ${
                    isSelected
                      ? hasData
                        ? 'bg-sky-600 text-white font-bold shadow-xs'
                        : 'bg-violet-600 text-white font-bold shadow-xs'
                      : hasData
                      ? 'bg-slate-50 dark:bg-slate-800/80 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-slate-900 dark:text-slate-100 font-medium border border-slate-200 dark:border-slate-700/70'
                      : isForecastable
                      ? 'bg-violet-50/40 dark:bg-violet-950/20 hover:bg-violet-100 dark:hover:bg-violet-900/50 text-slate-700 dark:text-slate-300 border border-dashed border-violet-300/60 dark:border-violet-800/50'
                      : 'text-slate-400 dark:text-slate-600 opacity-35 cursor-not-allowed'
                  } ${isLatest && !isSelected ? 'ring-1 ring-emerald-500/80' : ''}`}
                >
                  <span>{cell.day}</span>
                  {hasData ? (
                    <span
                      className={`w-1 h-1 rounded-full mt-0.5 ${
                        isSelected ? 'bg-white' : 'bg-emerald-500'
                      }`}
                    />
                  ) : isForecastable ? (
                    <span
                      className={`w-1 h-1 rounded-full mt-0.5 ${
                        isSelected ? 'bg-white' : 'bg-violet-400/80'
                      }`}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          {allowForecast && (
            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                Офіційний ДПЕМ
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
                Прогноз (до {maxForecastDays} дн.)
              </span>
            </div>
          )}

          {/* Footer: Quick jumps */}
          <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
            {latestDate && (
              <button
                type="button"
                onClick={() => {
                  onSelectDate(latestDate);
                  setOpen(false);
                }}
                className="px-2 py-1 rounded bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-sky-700 dark:text-sky-300 font-semibold transition-colors"
              >
                Офіц. ({latestDate.slice(5)})
              </button>
            )}
            {allowForecast && latestDate && (
              <div className="flex items-center gap-1">
                {[7, 14, 30].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      onSelectDate(addDaysIso(latestDate, d));
                      setOpen(false);
                    }}
                    className="px-1.5 py-1 rounded bg-violet-50 dark:bg-violet-950/60 hover:bg-violet-100 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-300 font-mono font-semibold transition-colors"
                  >
                    +{d}д
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
