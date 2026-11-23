import {
  ArchivedDaySnapshot,
  ScheduleByDate,
  SlotState,
  SUBQUEUES,
  SubqueueId,
} from './types';

export type ForecastMethod =
  | 'time_shift'
  | 'queue_rotation'
  | 'hybrid'
  | 'single_day_inferred';

export interface ScheduleShiftModel {
  anchorDate: string;
  knownDatesCount: number;
  samplePairsCount: number;
  method: ForecastMethod;
  /** Daily shift in 30-minute slots (e.g., +4 = +2h/day, -4 = -2h/day) */
  dailyTimeShiftSlots: number;
  /** Daily queue index rotation (0..11) */
  dailyQueueStep: number;
  /** Measured match accuracy (0..100%) across real consecutive day transitions */
  confidencePct: number;
  /** Full repeat cycle length in days */
  cycleDays: number;
  /** Concise Ukrainian explanation of detected algorithm */
  descriptionUk: string;
}

export interface ForecastDayResult {
  date: string;
  isForecast: boolean;
  queues: Record<SubqueueId, SlotState[]>;
  anchorDate: string;
  daysOffset: number;
  appliedTimeShiftSlots: number;
  appliedQueueStep: number;
  isCustomShift: boolean;
  confidencePct: number;
  summaryUk: string;
}

const MASK_TO_STATE: Record<string, SlotState> = {
  '0': 'on',
  '1': 'off',
  '2': 'switch_off',
  '3': 'switch_on',
  '4': 'possible',
};

export function decodeMaskToSlots(mask: string): SlotState[] | null {
  if (!mask || mask.length < 48) return null;
  const out: SlotState[] = [];
  for (let i = 0; i < 48; i++) {
    out.push(MASK_TO_STATE[mask[i]] || 'on');
  }
  return out;
}

function isSlotDark(s: SlotState | undefined): number {
  return s === 'off' || s === 'switch_off' ? 1 : 0;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 1;
  return Math.abs(Math.round((a * b) / gcd(a, b)));
}

export function parseIsoToUtcMs(iso: string): number {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return NaN;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = parseIsoToUtcMs(fromIso);
  const b = parseIsoToUtcMs(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function addDaysIso(iso: string, deltaDays: number): string {
  const base = parseIsoToUtcMs(iso);
  const d = new Date(Number.isFinite(base) ? base + deltaDays * 86_400_000 : Date.now());
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatShiftSlotsUk(slots: number): string {
  if (slots === 0) return '0 год/добу';
  const hours = slots * 0.5;
  const sign = hours > 0 ? '+' : '−';
  const abs = Math.abs(hours);
  const formatted = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace('.', ',');
  return `${sign}${formatted} год/добу`;
}

export function computeCycleDays(timeShiftSlots: number, queueStep: number): number {
  const normT = ((timeShiftSlots % 48) + 48) % 48;
  const normQ = ((queueStep % 12) + 12) % 12;
  const periodT = normT === 0 ? 1 : 48 / gcd(48, normT);
  const periodQ = normQ === 0 ? 1 : 12 / gcd(12, normQ);
  return lcm(periodT, periodQ);
}

export function buildUnifiedDaySchedules(
  scheduleByDate: ScheduleByDate,
  archivedDays: ArchivedDaySnapshot[]
): Map<string, Record<SubqueueId, SlotState[]>> {
  const map = new Map<string, Record<SubqueueId, SlotState[]>>();

  // 1. Seed from archived 48-slot masks first
  for (const day of archivedDays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !day.queueOffSlotMask) continue;
    const queues = {} as Record<SubqueueId, SlotState[]>;
    let validCount = 0;
    for (const q of SUBQUEUES) {
      const mask = day.queueOffSlotMask[q];
      if (!mask) continue;
      const decoded = decodeMaskToSlots(mask);
      if (decoded) {
        queues[q] = decoded;
        validCount++;
      }
    }
    if (validCount >= 6) {
      map.set(day.date, queues);
    }
  }

  // 2. Overlay live scheduleByDate (highest fidelity)
  for (const [date, day] of Object.entries(scheduleByDate || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day?.queues) continue;
    const queues = {} as Record<SubqueueId, SlotState[]>;
    let validCount = 0;
    for (const q of SUBQUEUES) {
      const slots = day.queues[q];
      if (Array.isArray(slots) && slots.length >= 48) {
        queues[q] = slots.slice(0, 48);
        validCount++;
      }
    }
    if (validCount >= 6) {
      map.set(date, queues);
    }
  }

  return map;
}

function projectDayQueues(
  anchorQueues: Record<SubqueueId, SlotState[]>,
  deltaDays: number,
  dailyTimeShiftSlots: number,
  dailyQueueStep: number
): Record<SubqueueId, SlotState[]> {
  const out = {} as Record<SubqueueId, SlotState[]>;
  const totalTimeShift = (((dailyTimeShiftSlots * deltaDays) % 48) + 48) % 48;
  const totalQueueShift = (((dailyQueueStep * deltaDays) % 12) + 12) % 12;

  for (let qi = 0; qi < SUBQUEUES.length; qi++) {
    const targetQ = SUBQUEUES[qi];
    const sourceIdx = (((qi - totalQueueShift) % 12) + 12) % 12;
    const sourceQ = SUBQUEUES[sourceIdx];
    const srcSlots = anchorQueues[sourceQ] || anchorQueues[targetQ];
    if (!srcSlots || srcSlots.length < 48) {
      out[targetQ] = new Array<SlotState>(48).fill('on');
      continue;
    }
    const shifted = new Array<SlotState>(48);
    for (let s = 0; s < 48; s++) {
      const srcSlot = (((s - totalTimeShift) % 48) + 48) % 48;
      shifted[s] = srcSlots[srcSlot];
    }
    out[targetQ] = shifted;
  }

  return out;
}

function measurePairAccuracy(
  dayA: Record<SubqueueId, SlotState[]>,
  dayB: Record<SubqueueId, SlotState[]>,
  gapDays: number,
  dailyTimeShiftSlots: number,
  dailyQueueStep: number
): number {
  const predicted = projectDayQueues(dayA, gapDays, dailyTimeShiftSlots, dailyQueueStep);
  let matched = 0;
  let total = 0;
  for (const q of SUBQUEUES) {
    const pSlots = predicted[q];
    const bSlots = dayB[q];
    if (!pSlots || !bSlots || bSlots.length < 48) continue;
    for (let s = 0; s < 48; s++) {
      total += 1;
      if (isSlotDark(pSlots[s]) === isSlotDark(bSlots[s])) {
        matched += 1;
      }
    }
  }
  return total > 0 ? matched / total : 0;
}

function inferShiftFromSingleDay(dayQueues: Record<SubqueueId, SlotState[]>): {
  dailyTimeShiftSlots: number;
  confidencePct: number;
} {
  // Check circular phase offset between adjacent main queues (1-1->2-1->3-1->4-1->5-1->6-1 and 1-2->2-2...)
  const ladderPairs: Array<[SubqueueId, SubqueueId]> = [
    ['1-1', '2-1'],
    ['2-1', '3-1'],
    ['3-1', '4-1'],
    ['4-1', '5-1'],
    ['5-1', '6-1'],
    ['6-1', '1-1'],
    ['1-2', '2-2'],
    ['2-2', '3-2'],
    ['3-2', '4-2'],
    ['4-2', '5-2'],
    ['5-2', '6-2'],
    ['6-2', '1-2'],
  ];

  // Candidate non-zero half-hour shifts common in Ukrainian GPV rotations (+/- 1h..6h)
  const candidates = [4, -4, 6, -6, 8, -8, 2, -2, 3, -3, 12, -12];
  let bestShift = 4; // +2h/day standard fallback
  let bestScore = -1;

  for (const shift of candidates) {
    let matched = 0;
    let total = 0;
    for (const [qA, qB] of ladderPairs) {
      const a = dayQueues[qA];
      const b = dayQueues[qB];
      if (!a || !b || a.length < 48 || b.length < 48) continue;
      for (let s = 0; s < 48; s++) {
        const srcIdx = (((s - shift) % 48) + 48) % 48;
        total += 1;
        if (isSlotDark(a[srcIdx]) === isSlotDark(b[s])) matched += 1;
      }
    }
    const score = total > 0 ? matched / total : 0;
    if (score > bestScore + 0.005) {
      bestScore = score;
      bestShift = shift;
    }
  }

  return {
    dailyTimeShiftSlots: bestScore >= 0.72 ? bestShift : 4,
    confidencePct: Math.round(Math.max(45, Math.min(82, bestScore * 100))),
  };
}

export function detectScheduleShiftModel(
  unifiedDays: Map<string, Record<SubqueueId, SlotState[]>>
): ScheduleShiftModel | null {
  const sortedDates = [...unifiedDays.keys()].sort();
  if (sortedDates.length === 0) return null;

  const anchorDate = sortedDates[sortedDates.length - 1];
  const anchorQueues = unifiedDays.get(anchorDate)!;

  // Gather consecutive transition pairs (preferring 1-day gaps, up to 7-day gaps)
  const pairs: Array<{
    dayA: Record<SubqueueId, SlotState[]>;
    dayB: Record<SubqueueId, SlotState[]>;
    gap: number;
    weight: number;
  }> = [];

  for (let i = 0; i < sortedDates.length - 1; i++) {
    const gap = daysBetweenIso(sortedDates[i], sortedDates[i + 1]);
    if (gap >= 1 && gap <= 7) {
      const dayA = unifiedDays.get(sortedDates[i])!;
      const dayB = unifiedDays.get(sortedDates[i + 1])!;
      // Weight more recent transitions slightly higher
      const recencyWeight = 1 + (i / Math.max(1, sortedDates.length)) * 0.5;
      const gapWeight = gap === 1 ? 1.5 : 1;
      pairs.push({ dayA, dayB, gap, weight: recencyWeight * gapWeight });
    }
  }

  if (pairs.length === 0) {
    const inferred = inferShiftFromSingleDay(anchorQueues);
    const cycleDays = computeCycleDays(inferred.dailyTimeShiftSlots, 0);
    return {
      anchorDate,
      knownDatesCount: sortedDates.length,
      samplePairsCount: 0,
      method: 'single_day_inferred',
      dailyTimeShiftSlots: inferred.dailyTimeShiftSlots,
      dailyQueueStep: 0,
      confidencePct: inferred.confidencePct,
      cycleDays,
      descriptionUk: `Оцінка за структурою черг (${formatShiftSlotsUk(
        inferred.dailyTimeShiftSlots
      )}, цикл ${cycleDays} дн.) — уточниться автоматично після появи 2-го дня`,
    };
  }

  let bestMethod: ForecastMethod = 'time_shift';
  let bestTimeShift = 0;
  let bestQueueStep = 0;
  let bestWeightedAcc = -1;
  let bestRawAcc = 0;

  const evalCandidate = (
    method: ForecastMethod,
    tShift: number,
    qStep: number,
    simplicityBonus: number
  ) => {
    let wSum = 0;
    let accWSum = 0;
    let rawSum = 0;
    for (const p of pairs) {
      const acc = measurePairAccuracy(p.dayA, p.dayB, p.gap, tShift, qStep);
      accWSum += acc * p.weight;
      wSum += p.weight;
      rawSum += acc;
    }
    const weightedAcc = wSum > 0 ? accWSum / wSum : 0;
    const score = weightedAcc + simplicityBonus;
    if (score > bestWeightedAcc) {
      bestWeightedAcc = score;
      bestRawAcc = rawSum / pairs.length;
      bestMethod = method;
      bestTimeShift = tShift;
      bestQueueStep = qStep;
    }
  };

  // 1. Test all uniform daily time-shifts (-12h .. +11.5h in 30m steps)
  for (let t = -24; t <= 23; t++) {
    evalCandidate('time_shift', t, 0, 0.008);
  }

  // 2. Test pure queue-index rotations (1..11)
  for (let q = 1; q <= 11; q++) {
    evalCandidate('queue_rotation', 0, q, 0.006);
  }

  // 3. Test hybrid queue rotation + common time-shifts
  const hybridQSteps = [1, 2, 10, 11];
  const hybridTShifts = [-12, -8, -6, -4, -2, 2, 4, 6, 8, 12];
  for (const q of hybridQSteps) {
    for (const t of hybridTShifts) {
      evalCandidate('hybrid', t, q, 0);
    }
  }

  const confidencePct = Math.round(bestRawAcc * 100);
  const cycleDays = computeCycleDays(bestTimeShift, bestQueueStep);

  let ruleText: string;
  if (bestMethod === 'time_shift') {
    ruleText = `Зміщення ${formatShiftSlotsUk(bestTimeShift)}`;
  } else if (bestMethod === 'queue_rotation') {
    const signedQ = bestQueueStep <= 6 ? `+${bestQueueStep}` : `−${12 - bestQueueStep}`;
    ruleText = `Ротація черг (${signedQ} позиц./добу)`;
  } else {
    const signedQ = bestQueueStep <= 6 ? `+${bestQueueStep}` : `−${12 - bestQueueStep}`;
    ruleText = `Зміщення ${formatShiftSlotsUk(bestTimeShift)} + ротація (${signedQ})`;
  }

  return {
    anchorDate,
    knownDatesCount: sortedDates.length,
    samplePairsCount: pairs.length,
    method: bestMethod,
    dailyTimeShiftSlots: bestTimeShift,
    dailyQueueStep: bestQueueStep,
    confidencePct,
    cycleDays,
    descriptionUk: `${ruleText} · цикл ${cycleDays} дн. · збіг ${confidencePct}% (${pairs.length} ${
      pairs.length === 1 ? 'перехід' : pairs.length < 5 ? 'переходи' : 'переходів'
    })`,
  };
}

export function resolveScheduleOrForecastForDate(
  targetDateIso: string,
  unifiedDays: Map<string, Record<SubqueueId, SlotState[]>>,
  model: ScheduleShiftModel | null,
  customShiftSlotsOverride?: number | null
): ForecastDayResult | null {
  const real = unifiedDays.get(targetDateIso);
  if (real) {
    return {
      date: targetDateIso,
      isForecast: false,
      queues: real,
      anchorDate: targetDateIso,
      daysOffset: 0,
      appliedTimeShiftSlots: 0,
      appliedQueueStep: 0,
      isCustomShift: false,
      confidencePct: 100,
      summaryUk: 'Офіційний графік ДПЕМ',
    };
  }

  if (!model) return null;
  const anchorQueues = unifiedDays.get(model.anchorDate);
  if (!anchorQueues) return null;

  const daysOffset = daysBetweenIso(model.anchorDate, targetDateIso);
  const isCustomShift =
    typeof customShiftSlotsOverride === 'number' && Number.isFinite(customShiftSlotsOverride);
  const appliedTimeShiftSlots = isCustomShift
    ? Math.max(-24, Math.min(24, Math.round(customShiftSlotsOverride)))
    : model.dailyTimeShiftSlots;
  const appliedQueueStep = isCustomShift ? 0 : model.dailyQueueStep;

  const queues = projectDayQueues(
    anchorQueues,
    daysOffset,
    appliedTimeShiftSlots,
    appliedQueueStep
  );

  const cycleDays = computeCycleDays(appliedTimeShiftSlots, appliedQueueStep);
  const summaryUk = isCustomShift
    ? `Прогноз (ручне зміщення ${formatShiftSlotsUk(appliedTimeShiftSlots)}, цикл ${cycleDays} дн.)`
    : `Прогноз · ${model.descriptionUk}`;

  return {
    date: targetDateIso,
    isForecast: true,
    queues,
    anchorDate: model.anchorDate,
    daysOffset,
    appliedTimeShiftSlots,
    appliedQueueStep,
    isCustomShift,
    confidencePct: model.confidencePct,
    summaryUk,
  };
}
