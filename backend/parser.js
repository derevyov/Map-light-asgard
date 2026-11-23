export const SUBQUEUES = [
  '1-1', '1-2', '2-1', '2-2', '3-1', '3-2',
  '4-1', '4-2', '5-1', '5-2', '6-1', '6-2',
];

export const CODE_MAP = {
  '0': 'on',
  '1': 'switch_off',
  '2': 'off',
  '3': 'switch_on',
  '4': 'possible',
};

export function cleanHtmlText(raw) {
  return String(raw || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

export function parseDpemGrafHtml(html) {
  const recMatch = html.match(/records\s*=\s*(\[\s*\{[\s\S]*?\}\s*\])\s*;/);
  const rawRecords = recMatch ? JSON.parse(recMatch[1]) : [];

  const scheduleByDate = {};
  for (const rec of rawRecords) {
    if (!rec?.date || !Array.isArray(rec.data)) continue;
    const queues = {};
    SUBQUEUES.forEach((q, qIdx) => {
      const slice = rec.data.slice(qIdx * 48, (qIdx + 1) * 48);
      queues[q] = Array.from({ length: 48 }, (_, i) => CODE_MAP[String(slice[i] ?? '0')] || 'on');
    });
    scheduleByDate[rec.date] = { savedAt: rec.saved_at || rec.date, queues };
  }

  const feederRows = [];
  for (let i = 1; i <= 12; i++) {
    const startIdx = html.indexOf(`id="cherga-${i}"`);
    if (startIdx === -1) continue;
    const nextCherga = i < 12 ? html.indexOf(`id="cherga-${i + 1}"`, startIdx) : -1;
    const contentEnd = html.indexOf('class="content-container"', startIdx);
    const endIdx = nextCherga > startIdx ? nextCherga : contentEnd > startIdx ? contentEnd : html.length;
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
      const feeder = /^\d/.test(feederRaw)
        ? `${substation.replace(/[«»"]/g, '')} Ф-${feederRaw}`
        : `${substation.replace(/[«»"]/g, '')} ${feederRaw}`;

      feederRows.push({
        queue,
        settlement,
        substation,
        feeder: feeder.trim(),
        switchType: cleanHtmlText(tds[3]),
        consumersText: cleanHtmlText(tds[4]),
      });
    }
  }

  return { scheduleByDate, feederRows };
}

export function parseOperOrPlannedHtml(html, type) {
  const updatedMatch = html.match(/Інформація оновлена станом на:\s*([\d.: ]+)/i);
  const updatedAt = updatedMatch ? updatedMatch[1].trim() : null;
  const notices = [];
  const autoTransfers = [];

  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cleanHtmlText(m[1]));
    if (tds.length < 2) continue;
    if (/Підстанція|Найменування|Дата|Початок/i.test(tds[0]) && tds.length >= 3) continue;
    const joined = tds.join(' | ');
    if (joined.length < 8) continue;
    notices.push({
      type,
      substation: tds[0] || undefined,
      feeder: tds[1] || undefined,
      timeRange: tds.length >= 4 ? `${tds[2]} – ${tds[3]}` : undefined,
      description: tds[tds.length - 1] || joined,
    });
  }

  return { updatedAt, notices: notices.slice(0, 40), autoTransfers };
}
