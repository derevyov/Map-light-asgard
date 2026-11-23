import React, { useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { formatSubqueue, SUBQUEUES, SubqueueId } from '../lib/types';

interface ManualPointModalProps {
  coords: { lat: number; lng: number };
  onCancel: () => void;
  onSave: (input: {
    label: string;
    queue: SubqueueId;
    feeder: string;
    note: string;
    addToFavorites: boolean;
  }) => void;
}

export const ManualPointModal: React.FC<ManualPointModalProps> = ({
  coords,
  onCancel,
  onSave,
}) => {
  const [label, setLabel] = useState<string>('');
  const [queue, setQueue] = useState<SubqueueId>('1-1');
  const [feeder, setFeeder] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [addToFavorites, setAddToFavorites] = useState<boolean>(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalLabel =
      label.trim() || `Точка (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;
    onSave({
      label: finalLabel,
      queue,
      feeder: feeder.trim(),
      note: note.trim(),
      addToFavorites,
    });
  };

  return (
    <div
      className="absolute top-14 left-1/2 -translate-x-1/2 z-[1100] w-[340px] max-w-[calc(100vw-24px)] bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-lg shadow-2xl text-slate-900 dark:text-slate-100 overflow-hidden"
      role="dialog"
      aria-label="Вказати точку на карті"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <span className="text-sm font-semibold">Вказати точку на карті</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Скасувати"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-3 text-xs">
        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          Координати: {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
        </div>

        <div>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
            Назва або орієнтир (якщо невідома адреса)
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={100}
            autoFocus
            placeholder="Наприклад: Гараж біля ТП, Дача, Магазин…"
            className="w-full bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
              Підчерга
            </label>
            <select
              value={queue}
              onChange={(e) => setQueue(e.target.value as SubqueueId)}
              className="w-full bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
            >
              {SUBQUEUES.map((q) => (
                <option key={q} value={q}>
                  Черга {formatSubqueue(q)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
              Фідер (необовʼязково)
            </label>
            <input
              type="text"
              value={feeder}
              onChange={(e) => setFeeder(e.target.value)}
              maxLength={60}
              placeholder="Березка Ф-15"
              className="w-full bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
            Примітка
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={140}
            placeholder="Короткий коментар для історії та обраного"
            className="w-full bg-slate-50 dark:bg-[#0b1120] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
          />
        </div>

        <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={addToFavorites}
            onChange={(e) => setAddToFavorites(e.target.checked)}
            className="rounded border-slate-400 text-sky-600 focus:ring-sky-500"
          />
          <span>Також додати в обрані адреси</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Скасувати
          </button>
          <button
            type="submit"
            className="px-3.5 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors"
          >
            Зберегти точку
          </button>
        </div>
      </form>
    </div>
  );
};
