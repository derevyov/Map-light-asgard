import { formatSlotTime, SlotState } from './types';

export interface MergedScheduleInterval {
  startSlot: number;
  endSlot: number; // exclusive (1..48)
  startTime: string; // HH:MM
  endTime: string; // HH:MM (24:00 for end of day)
  durationMin: number;
  state: SlotState;
}

export function normalizeDisplayState(state: SlotState, mergedLightDark: boolean): SlotState {
  if (!mergedLightDark) return state;
  if (state === 'switch_off') return 'off';
  if (state === 'switch_on') return 'on';
  return state;
}

export function scheduleHasSwitching(schedule: SlotState[]): boolean {
  return schedule.some((s) => s === 'switch_off' || s === 'switch_on');
}

function slotStartLabel(slot: number): string {
  if (slot >= 48) return '24:00';
  return formatSlotTime(slot).slice(0, 5);
}

export function buildMergedIntervals(
  schedule: SlotState[],
  mergedLightDark: boolean
): MergedScheduleInterval[] {
  if (!schedule || schedule.length === 0) return [];
  const total = Math.min(48, schedule.length);
  const intervals: MergedScheduleInterval[] = [];

  let runStart = 0;
  let runState = normalizeDisplayState(schedule[0] || 'on', mergedLightDark);

  for (let i = 1; i <= total; i++) {
    const nextState =
      i < total ? normalizeDisplayState(schedule[i] || 'on', mergedLightDark) : null;
    if (nextState !== runState) {
      intervals.push({
        startSlot: runStart,
        endSlot: i,
        startTime: slotStartLabel(runStart),
        endTime: slotStartLabel(i),
        durationMin: (i - runStart) * 30,
        state: runState,
      });
      if (nextState !== null) {
        runStart = i;
        runState = nextState;
      }
    }
  }

  return intervals;
}

export function computeScheduleTotals(
  schedule: SlotState[],
  mergedLightDark: boolean
): {
  lightMin: number;
  offMin: number;
  otherMin: number;
  hasSwitching: boolean;
} {
  let lightMin = 0;
  let offMin = 0;
  let otherMin = 0;
  let hasSwitching = false;

  for (let i = 0; i < Math.min(48, schedule.length); i++) {
    const raw = schedule[i] || 'on';
    if (raw === 'switch_off' || raw === 'switch_on') hasSwitching = true;
    const eff = normalizeDisplayState(raw, mergedLightDark);
    if (eff === 'on') lightMin += 30;
    else if (eff === 'off') offMin += 30;
    else otherMin += 30;
  }

  return { lightMin, offMin, otherMin, hasSwitching };
}

export function formatDurationShort(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h}г ${m}хв`;
}
