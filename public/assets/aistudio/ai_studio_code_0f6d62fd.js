const SUBQUEUES = ['1-1','1-2','2-1','2-2','3-1','3-2','4-1','4-2','5-1','5-2','6-1','6-2'];

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const [grafRes, operRes] = await Promise.all([
      fetch('https://info.dpem.mk.ua/off_graf.html', { cf: { cacheTtl: 120 } }),
      fetch('https://info.dpem.mk.ua/off_o.html', { cf: { cacheTtl: 120 } })
    ]);

    const grafHtml = await grafRes.text();
    const operHtml = await operRes.text();
    const parsed = parseDpemGrafHtml(grafHtml);

    const operUpdatedAt = operHtml.match(/Інформація оновлена станом на:\s*([\d.: ]+)/)?.[1] || null;

    return new Response(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      operUpdatedAt,
      ...parsed
    }), {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120' }
    });
  }
};

function parseDpemGrafHtml(html) {
  // 1. Извлекаем массив records = [...]
  const recMatch = html.match(/records\s*=\s*(\[\s*\{[\s\S]*?\}\s*\])\s*;/);
  const rawRecords = recMatch ? JSON.parse(recMatch[1]) : [];

  const codeMap = { '0': 'on', '1': 'switch_off', '2': 'off', '3': 'switch_on', '4': 'possible' };
  const scheduleByDate = {};
  for (const rec of rawRecords) {
    const dayObj = {};
    SUBQUEUES.forEach((q, qIdx) => {
      dayObj[q] = rec.data.slice(qIdx * 48, (qIdx + 1) * 48).map(v => codeMap[v] || 'on');
    });
    scheduleByDate[rec.date] = { savedAt: rec.saved_at, queues: dayObj };
  }

  // 2. Извлекаем привязки адресов из #cherga-1 .. #cherga-12
  const feederRows = [];
  for (let i = 1; i <= 12; i++) {
    const startIdx = html.indexOf(`id="cherga-${i}"`);
    if (startIdx === -1) continue;
    const endIdx = i < 12 ? html.indexOf(`id="cherga-${i + 1}"`, startIdx) : html.indexOf('class="content-container"', startIdx);
    const chunk = html.slice(startIdx, endIdx > startIdx ? endIdx : undefined);
    const queue = SUBQUEUES[i - 1];

    const trMatches = chunk.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trMatches) {
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
      if (tds.length !== 5) continue;
      const clean = s => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ').trim();

      const settlement = clean(tds[0]);
      if (/Найменування/i.test(settlement)) continue;
      const substation = clean(tds[1]).replace(/ПС-35\/10\s*кВ\s*/i, '');
      const feeder = clean(tds[2]);
      const switchType = clean(tds[3]);
      const consumersText = clean(tds[4]);

      feederRows.push({ queue, settlement, substation, feeder: `${substation} Ф-${feeder}`, switchType, consumersText });
    }
  }

  return { scheduleByDate, feederRows };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}