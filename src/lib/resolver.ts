import { normalizeHouse, normalizeStreet } from './parser';
import { normalizeDisplayState } from './scheduleIntervals';
import {
  AddressIndexResult,
  BuildingOverride,
  BuildingVisual,
  DualQueueType,
  FeederTransfer,
  formatSubqueue,
  GlobalDualMode,
  ResolvedBuildingInfo,
  SlotState,
  SubqueueId,
} from './types';

export interface ResolverContext {
  index: AddressIndexResult;
  overrides: Record<string, BuildingOverride>;
  transfers: FeederTransfer[];
}

export function stateColor(state: SlotState): string {
  switch (state) {
    case 'off':
      return '#ef4444';
    case 'switch_off':
    case 'switch_on':
      return '#f97316';
    case 'possible':
      return '#eab308';
    default:
      return '#22c55e';
  }
}

export function stateLabel(state: SlotState): string {
  switch (state) {
    case 'off':
      return 'Відключено';
    case 'switch_off':
      return 'Перемикання на відкл. (±30 хв)';
    case 'switch_on':
      return 'Перемикання на вкл. (±30 хв)';
    case 'possible':
      return 'Можливе відключення';
    default:
      return 'Світло є';
  }
}

export function resolveBuilding(
  street: string,
  house: string,
  ctx: ResolverContext
): ResolvedBuildingInfo | null {
  const st = normalizeStreet(street);
  const hn = normalizeHouse(house);
  const key = `${st}|${hn}`;

  let entries = ctx.index.addressIndex.get(key) || [];
  let isWildcardMatch = false;
  if (entries.length === 0 && st && ctx.index.streetWildcardIndex.has(st)) {
    entries = ctx.index.streetWildcardIndex.get(st) || [];
    isWildcardMatch = true;
  }

  const ov = ctx.overrides[key];
  const activeTransfer = ctx.transfers.find(
    (t) => normalizeStreet(t.street) === st && t.houses.some((h) => normalizeHouse(h) === hn)
  );

  if (entries.length === 0 && !activeTransfer && !ov?.primary) {
    return null;
  }

  const uniqueQueues = [...new Set(entries.map((e) => e.queue))];
  const hasCollision = uniqueQueues.length > 1;
  let primary: SubqueueId =
    ov?.primary || uniqueQueues[0] || (activeTransfer?.targetQueue as SubqueueId);
  let secondary: SubqueueId | null =
    ov?.secondary !== undefined
      ? ov.secondary
      : uniqueQueues.find((q) => q !== primary) || null;

  // On address collision without explicit user mode, highlight the first (primary) queue by default,
  // while letting the user switch primary queue or dual-queue visualization in the inspector.
  const dualType: DualQueueType = ov?.dualType || (secondary ? 'backup' : 'none');

  let feeder = entries.map((e) => `${formatSubqueue(e.queue)}: ${e.feeder}`).join(' | ');
  let transferredFrom: string | null = null;

  if (activeTransfer) {
    transferredFrom = primary
      ? `${formatSubqueue(primary)}${feeder ? ` (${feeder})` : ''}`
      : 'без привʼязки';
    primary = activeTransfer.targetQueue;
    feeder = activeTransfer.targetFeeder
      ? `${formatSubqueue(activeTransfer.targetQueue)}: ${activeTransfer.targetFeeder}`
      : `${formatSubqueue(activeTransfer.targetQueue)} (перенос)`;
  }

  return {
    key,
    primary,
    secondary,
    allQueues: uniqueQueues.length > 0 ? uniqueQueues : [primary],
    hasCollision,
    dualType,
    feeder: feeder || formatSubqueue(primary),
    entries,
    transferredFrom,
    isTransferred: Boolean(activeTransfer),
    transferReason: activeTransfer?.reason,
    isWildcardMatch,
    hasUserOverride: Boolean(ov),
  };
}

export interface VisualComputeOptions {
  queuesMap: Partial<Record<SubqueueId, SlotState[]>>;
  slot: number;
  dualMode: GlobalDualMode;
  selectedQueue: SubqueueId | null;
  selectedFeeder: string;
  onlyDualHighlight: boolean;
  mergedLightDark?: boolean;
}

export function computeManualPointVisual(
  queue: SubqueueId,
  feeder: string,
  key: string,
  opts: VisualComputeOptions
): BuildingVisual {
  const info: ResolvedBuildingInfo = {
    key,
    primary: queue,
    secondary: null,
    allQueues: [queue],
    hasCollision: false,
    dualType: 'none',
    feeder: feeder || `${formatSubqueue(queue)} (вказано вручну)`,
    entries: [],
    transferredFrom: null,
    isTransferred: false,
    isWildcardMatch: false,
    hasUserOverride: true,
  };

  if (opts.onlyDualHighlight) {
    return {
      color: '#334155',
      opacity: 0.16,
      dash: null,
      statusText: 'Приховано (тільки 2+ черги)',
      statusCode: 'filtered',
      info,
      s1: null,
      s2: null,
    };
  }

  if (opts.selectedQueue && queue !== opts.selectedQueue) {
    return {
      color: '#334155',
      opacity: 0.16,
      dash: null,
      statusText: 'Приховано фільтром черги',
      statusCode: 'filtered',
      info,
      s1: null,
      s2: null,
    };
  }

  if (opts.selectedFeeder && !info.feeder.includes(opts.selectedFeeder)) {
    return {
      color: '#334155',
      opacity: 0.16,
      dash: null,
      statusText: 'Інший фідер',
      statusCode: 'filtered',
      info,
      s1: null,
      s2: null,
    };
  }

  const rawS1: SlotState = opts.queuesMap[queue]?.[opts.slot] || 'on';
  const s1: SlotState = normalizeDisplayState(rawS1, Boolean(opts.mergedLightDark));
  return {
    color: stateColor(s1),
    opacity: 0.85,
    dash: null,
    statusText: stateLabel(s1),
    statusCode:
      s1 === 'off'
        ? 'off'
        : s1 === 'possible'
        ? 'possible'
        : s1 === 'switch_off' || s1 === 'switch_on'
        ? 'switch'
        : 'on',
    info,
    s1,
    s2: null,
  };
}

export function computeBuildingVisual(
  street: string,
  house: string,
  ctx: ResolverContext,
  opts: VisualComputeOptions
): BuildingVisual {
  const info = resolveBuilding(street, house, ctx);
  if (!info) {
    return {
      color: '#64748b',
      opacity: 0.22,
      dash: null,
      statusText: 'Немає в таблиці ДПЕМ',
      statusCode: 'unmapped',
      info: null,
      s1: null,
      s2: null,
    };
  }

  if (opts.onlyDualHighlight && !info.secondary) {
    return {
      color: '#334155',
      opacity: 0.14,
      dash: null,
      statusText: 'Приховано (тільки 2+ черги)',
      statusCode: 'filtered',
      info,
      s1: null,
      s2: null,
    };
  }

  if (
    opts.selectedQueue &&
    info.primary !== opts.selectedQueue &&
    info.secondary !== opts.selectedQueue
  ) {
    return {
      color: '#334155',
      opacity: 0.15,
      dash: null,
      statusText: 'Приховано фільтром черги',
      statusCode: 'filtered',
      info,
      s1: null,
      s2: null,
    };
  }

  if (opts.selectedFeeder && !info.feeder.includes(opts.selectedFeeder)) {
    return {
      color: '#334155',
      opacity: 0.15,
      dash: null,
      statusText: 'Інший фідер',
      statusCode: 'filtered',
      info,
      s1: null,
      s2: null,
    };
  }

  const rawS1: SlotState = opts.queuesMap[info.primary]?.[opts.slot] || 'on';
  const s1: SlotState = normalizeDisplayState(rawS1, Boolean(opts.mergedLightDark));
  const rawS2: SlotState | null = info.secondary
    ? opts.queuesMap[info.secondary]?.[opts.slot] || 'on'
    : null;
  const s2: SlotState | null = rawS2
    ? normalizeDisplayState(rawS2, Boolean(opts.mergedLightDark))
    : null;

  const isOut = (st: SlotState) => st === 'off' || st === 'switch_off' || st === 'switch_on';

  let color = stateColor(s1);
  let statusText = stateLabel(s1);
  let statusCode: BuildingVisual['statusCode'] =
    s1 === 'off'
      ? 'off'
      : s1 === 'possible'
      ? 'possible'
      : s1 === 'switch_off' || s1 === 'switch_on'
      ? 'switch'
      : 'on';

  if (s2 && opts.dualMode === 'split' && info.dualType !== 'backup') {
    const out1 = isOut(s1);
    const out2 = isOut(s2);

    if (out1 && out2) {
      color = '#ef4444';
      statusText = 'Відключені обидві черги';
      statusCode = 'off';
    } else if (info.dualType === 'split_lifts' && out1 && !out2) {
      color = '#38bdf8';
      statusText = 'Світло відкл., ліфти працюють';
      statusCode = 'dual_lifts';
    } else if (out1 !== out2) {
      color = '#a855f7';
      statusText = 'Частково: частина підʼїздів зі світлом';
      statusCode = 'dual_split';
    } else if (s1 === 'possible' || s2 === 'possible') {
      color = '#eab308';
      statusText = 'Можливе відключення (2 черги)';
      statusCode = 'possible';
    }
  }

  return {
    color,
    opacity: 0.72,
    dash: info.isTransferred ? '5, 5' : null,
    statusText,
    statusCode,
    info,
    s1,
    s2,
  };
}
