import streetAliasesData from '../../data/street_aliases.json' with { type: 'json' };
import seedAddressesData from '../../data/seed_addresses.json' with { type: 'json' };
import { SUBQUEUES } from './types.ts';
import type {
  AddressEntry,
  AddressIndexResult,
  FeederRow,
  FeederTransfer,
  OutageNotice,
  ScheduleByDate,
  SlotState,
  SubqueueId,
} from './types.ts';

export const CODE_MAP: Record<string, SlotState> = {
  '0': 'on',
  '1': 'switch_off',
  '2': 'off',
  '3': 'switch_on',
  '4': 'possible',
};

const ALIAS_MAP: Record<string, string> = streetAliasesData.aliases;

export function normalizeStreet(input = ''): string {
  let clean = input
    .toLowerCase()
    .replace(/[«»"'`’]/g, '')
    .replace(
      /(?:^|\s)(?:вулиця|вул\.|улица|ул\.|проспект|пр-кт\.?|пр-т\.?|пр\.|бульвар|б-вар\.?|б-р\.?|бул\.|провулок|пров\.|пер\.|смт\.?)(?=\s|$)/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (ALIAS_MAP[clean]) {
    return ALIAS_MAP[clean];
  }

  for (const [alias, canon] of Object.entries(ALIAS_MAP)) {
    if (clean === alias || clean.includes(alias)) {
      return canon;
    }
  }

  return clean;
}

export function normalizeHouse(house = ''): string {
  return house
    .replace(/\(.*?\)/g, '')
    .replace(/^[–—\-\s№#]+/, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

/**
 * Expands numeric house ranges like "37-39" -> ["37", "38", "39"]
 * while preserving fractional and lettered house numbers ("54-Б", "20/145", "14/1/2/3", "3с/3", "5/5").
 */
export function expandHouseTokens(str: string): string[] {
  const tokens: string[] = [];
  for (const part of str.split(',')) {
    const raw = part
      .replace(/\(.*?\)/g, '')
      .replace(/^[–—\-№#\s]+/, '')
      .replace(/\.$/, '')
      .trim()
      .toUpperCase();

    if (!raw) continue;

    // Pure numeric range (e.g. 37-39 or 37–39), do NOT expand lettered like 54-Б or fractional like 20/145
    const rangeMatch = raw.match(/^(\d+)[–—\-](\d+)$/);
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      if (b > a && b - a <= 25) {
        for (let k = a; k <= b; k++) {
          tokens.push(String(k));
        }
        continue;
      }
    }

    // Ignore purely non-house trailing words
    if (/^\d/.test(raw)) {
      tokens.push(raw.replace(/\s+/g, ''));
    }
  }
  return tokens;
}

export function buildAddressIndex(feederRows: FeederRow[]): AddressIndexResult {
  const addressIndex = new Map<string, AddressEntry[]>();
  const streetWildcardIndex = new Map<string, AddressEntry[]>();
  const feedersSet = new Set<string>();

  const pushEntry = (
    map: Map<string, AddressEntry[]>,
    key: string,
    entry: AddressEntry
  ) => {
    const arr = map.get(key) ?? [];
    if (!arr.some((x) => x.queue === entry.queue && x.feeder === entry.feeder)) {
      arr.push(entry);
      map.set(key, arr);
    }
  };

  for (const row of feederRows) {
    feedersSet.add(row.feeder);
    const entry: AddressEntry = {
      queue: row.queue,
      feeder: row.feeder,
      substation: row.substation,
      switchType: row.switchType,
      settlement: row.settlement,
    };

    const rawSegments = row.consumersText.split(/[\n;]+/);
    for (let seg of rawSegments) {
      seg = seg
        .replace(/ЧАСТКОВО:|ЧАСТИНОВО:|МПЗ\s*[-:]?|смт\.?\s*Костянтинівка\s*:?/gi, '')
        .trim();
      if (!seg) continue;

      // Special case: "гуртожитки 1, 2, 3, 4, 5, 6, 7, 8"
      const dormMatch = seg.match(/гуртожитки\s+([0-9,\s–—\-]+)/i);
      if (dormMatch) {
        const nums = expandHouseTokens(dormMatch[1]);
        for (const h of nums) {
          pushEntry(addressIndex, `гуртожитки|${h}`, entry);
        }
        continue;
      }

      // Special case: street with dash prefix before number like "Гідробудівників –16" or "Володимирська № 4, 6, 8, 10"
      const streetHouseMatch = seg.match(
        /^(?:вулиця|вул\.|пр-т\.?|пр-кт\.?|пр\.|б-р\.?|б-вар\.?|бул\.|пров\.?)?\s*([А-ЯІЇЄҐа-яіїєґ'\.\-\s]{3,}?)(?:\s*[–—\-№#]+\s*|\s+)([0-9][0-9А-ЯІЇЄҐа-яіїєґA-Za-z\/\-–—,\s]*)$/
      );

      if (streetHouseMatch) {
        const st = normalizeStreet(streetHouseMatch[1]);
        const houses = expandHouseTokens(streetHouseMatch[2]);
        if (st.length >= 2 && houses.length > 0) {
          for (const h of houses) {
            pushEntry(addressIndex, `${st}|${h}`, entry);
          }
          continue;
        }
      }

      // Wildcard street list without house numbers (e.g., MПЗ: "вул. Степова, Гардова, Садова, ...")
      if (/вул\.|пров\.|пр\.|б-р\./i.test(seg)) {
        const withoutPrefix = seg.replace(/^(?:вул\.|пров\.|пр\.|б-р\.)\s*/i, '');
        const candidateStreets = withoutPrefix.split(',');
        for (const candidate of candidateStreets) {
          const trimmed = candidate.trim();
          // Skip items containing digits or non-street organization keywords
          if (
            !trimmed ||
            /\d/.test(trimmed) ||
            /ТОВ|ФОП|ДНЗ|Ліцей|КП|АЗС|ГК|ДК|кафе|магазин|ринок|гаражі|суд|пошта|банк/i.test(
              trimmed
            )
          ) {
            continue;
          }
          const st = normalizeStreet(trimmed);
          if (st.length >= 3) {
            pushEntry(streetWildcardIndex, st, entry);
          }
        }
      }
    }
  }

  const dualQueueKeys = new Set<string>();
  for (const [key, arr] of addressIndex.entries()) {
    const uniqueQueues = new Set(arr.map((x) => x.queue));
    if (uniqueQueues.size > 1) {
      dualQueueKeys.add(key);
    }
  }

  return {
    addressIndex,
    streetWildcardIndex,
    feeders: [...feedersSet].sort((a, b) => a.localeCompare(b, 'uk')),
    dualQueueCount: dualQueueKeys.size,
    dualQueueKeys,
  };
}

export function cleanHtmlText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

export function parseDpemGrafHtml(html: string): {
  scheduleByDate: ScheduleByDate;
  feederRows: FeederRow[];
} {
  const recMatch = html.match(/records\s*=\s*(\[\s*\{[\s\S]*?\}\s*\])\s*;/);
  if (!recMatch) {
    throw new Error('Не найден массив records в HTML-файле off_graf.html');
  }

  const rawRecords = JSON.parse(recMatch[1]) as Array<{
    date: string;
    saved_at?: string;
    data: string[];
  }>;

  const scheduleByDate: ScheduleByDate = {};
  for (const rec of rawRecords) {
    if (!rec?.date || !Array.isArray(rec.data)) continue;
    const queues = {} as Record<SubqueueId, SlotState[]>;
    SUBQUEUES.forEach((q, qIdx) => {
      const slice = rec.data.slice(qIdx * 48, (qIdx + 1) * 48);
      queues[q] = Array.from({ length: 48 }, (_, idx) => CODE_MAP[String(slice[idx] ?? '0')] || 'on');
    });
    scheduleByDate[rec.date] = {
      savedAt: rec.saved_at || rec.date,
      queues,
    };
  }

  const feederRows: FeederRow[] = [];
  for (let i = 1; i <= 12; i++) {
    const startIdx = html.indexOf(`id="cherga-${i}"`);
    if (startIdx === -1) continue;
    const nextCherga = i < 12 ? html.indexOf(`id="cherga-${i + 1}"`, startIdx) : -1;
    const contentEnd = html.indexOf('class="content-container"', startIdx);
    const endIdx =
      nextCherga > startIdx
        ? nextCherga
        : contentEnd > startIdx
        ? contentEnd
        : html.length;
    const chunk = html.slice(startIdx, endIdx);
    const queue = SUBQUEUES[i - 1];

    const trMatches = chunk.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trMatches) {
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      if (tds.length !== 5) continue;
      const settlement = cleanHtmlText(tds[0]);
      if (/Найменування|Населений/i.test(settlement)) continue;
      const substation = cleanHtmlText(tds[1]).replace(/ПС-35\/10\s*кВ\s*/i, '').trim();
      const feederRaw = cleanHtmlText(tds[2]);
      const feederLabel = /^\d/.test(feederRaw)
        ? `${substation.replace(/[«»"]/g, '')} Ф-${feederRaw}`
        : `${substation.replace(/[«»"]/g, '')} ${feederRaw}`;

      feederRows.push({
        queue,
        settlement,
        substation,
        feeder: feederLabel.trim(),
        switchType: cleanHtmlText(tds[3]),
        consumersText: cleanHtmlText(tds[4]),
      });
    }
  }

  return { scheduleByDate, feederRows };
}

export function parseOperOrPlannedHtml(
  html: string,
  type: 'oper' | 'emergency' | 'planned'
): { updatedAt: string | null; notices: OutageNotice[]; autoTransfers: FeederTransfer[] } {
  const updatedMatch = html.match(/Інформація оновлена станом на:\s*([\d.: ]+)/i);
  const updatedAt = updatedMatch ? updatedMatch[1].trim() : null;

  const notices: OutageNotice[] = [];
  const autoTransfers: FeederTransfer[] = [];

  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      cleanHtmlText(m[1])
    );
    if (tds.length < 2) continue;
    const joined = tds.join(' | ');
    if (/Підстанція|Найменування|Дата|Початок/i.test(tds[0]) && tds.length >= 3) {
      continue;
    }
    if (joined.length < 8) continue;

    notices.push({
      type,
      substation: tds[0] || undefined,
      feeder: tds[1] || undefined,
      timeRange: tds.length >= 4 ? `${tds[2]} – ${tds[3]}` : undefined,
      description: tds[tds.length - 1] || joined,
    });

    if (type === 'emergency') {
      const detected = extractAutoTransferFromText(joined);
      if (detected) {
        autoTransfers.push(detected);
      }
    }
  }

  // Also scan plain paragraph/div blocks in off_a.html for transfer announcements
  if (type === 'emergency') {
    const blocks = html.match(/<(?:p|div|li)[^>]*>[\s\S]*?<\/(?:p|div|li)>/gi) || [];
    for (const block of blocks) {
      const text = cleanHtmlText(block);
      if (text.length > 15 && text.length < 400 && /перенес|переключ|живл/i.test(text)) {
        const detected = extractAutoTransferFromText(text);
        if (
          detected &&
          !autoTransfers.some(
            (t) =>
              t.street === detected.street &&
              t.targetQueue === detected.targetQueue &&
              t.houses.join(',') === detected.houses.join(',')
          )
        ) {
          autoTransfers.push(detected);
        }
      }
    }
  }

  return { updatedAt, notices: notices.slice(0, 40), autoTransfers };
}

function parseQueueToken(raw: string): SubqueueId | null {
  const m = raw.match(/([1-6])\s*[-–—]?\s*(?:[ІI]{2}|2)/i);
  if (m) return `${m[1]}-2` as SubqueueId;
  const m1 = raw.match(/([1-6])\s*[-–—]?\s*(?:[ІI]|1)?/i);
  if (m1) return `${m1[1]}-1` as SubqueueId;
  return null;
}

export function extractAutoTransferFromText(text: string): FeederTransfer | null {
  if (!/перенес/i.test(text)) return null;

  const queueMatch = text.match(/(?:до|на)\s+([1-6](?:\s*[-–—]\s*(?:[ІI]{1,2}|[12]))?(?:-?ї)?\s*(?:під)?черг)/i);
  if (!queueMatch) return null;
  const targetQueue = parseQueueToken(queueMatch[1]);
  if (!targetQueue) return null;

  const feederMatch = text.match(/фідер(?:у|а)?\s*№?\s*([0-9\-–]+)/i);
  const targetFeeder = feederMatch ? `Ф-${feederMatch[1]}` : 'Аварійний перенос';

  const addrMatch = text.match(
    /(?:вул\.|пр-т|пр-кт|пр\.|б-р\.?)\s*([А-ЯІЇЄҐа-яіїєґ'\.\-\s]{3,}?)\s+([0-9][0-9А-ЯІЇЄҐа-яіїєґA-Za-z\/\-–,\s]*)/i
  );
  if (!addrMatch) return null;

  const street = normalizeStreet(addrMatch[1]);
  const houses = expandHouseTokens(addrMatch[2]);
  if (!street || houses.length === 0) return null;

  return {
    id: `auto_${street}_${houses.join('_')}_${targetQueue}`,
    street,
    houses,
    targetQueue,
    targetFeeder,
    manual: false,
    reason: text.slice(0, 180),
  };
}

export function getFallbackSeedPayload(): {
  scheduleByDate: ScheduleByDate;
  feederRows: FeederRow[];
} {
  const scheduleByDate: ScheduleByDate = {};
  for (const rec of seedAddressesData.fallbackRecords) {
    const queues = {} as Record<SubqueueId, SlotState[]>;
    for (const q of SUBQUEUES) {
      const arr = (rec.queues as Record<string, string[]>)[q] || [];
      queues[q] = Array.from({ length: 48 }, (_, i) => CODE_MAP[arr[i] ?? '0'] || 'on');
    }
    scheduleByDate[rec.date] = {
      savedAt: `${rec.saved_at} (резервний знімок)`,
      queues,
    };
  }

  return {
    scheduleByDate,
    feederRows: seedAddressesData.feederRows as FeederRow[],
  };
}
