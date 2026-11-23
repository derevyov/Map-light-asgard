import { parseDpemGrafHtml, parseOperOrPlannedHtml } from './parser.js';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/api/dpem') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    const [grafRes, operRes, emergRes, plannedRes] = await Promise.all([
      fetch('https://info.dpem.mk.ua/off_graf.html', { cf: { cacheTtl: 120 } }),
      fetch('https://info.dpem.mk.ua/off_o.html', { cf: { cacheTtl: 120 } }),
      fetch('https://info.dpem.mk.ua/off_a.html', { cf: { cacheTtl: 120 } }),
      fetch('https://info.dpem.mk.ua/off_p.html', { cf: { cacheTtl: 120 } }),
    ]);

    const [grafHtml, operHtml, emergHtml, plannedHtml] = await Promise.all([
      grafRes.ok ? grafRes.text() : '',
      operRes.ok ? operRes.text() : '',
      emergRes.ok ? emergRes.text() : '',
      plannedRes.ok ? plannedRes.text() : '',
    ]);

    const parsed = grafHtml ? parseDpemGrafHtml(grafHtml) : { scheduleByDate: {}, feederRows: [] };
    const oper = operHtml ? parseOperOrPlannedHtml(operHtml, 'oper') : { updatedAt: null, notices: [], autoTransfers: [] };
    const emerg = emergHtml ? parseOperOrPlannedHtml(emergHtml, 'emergency') : { updatedAt: null, notices: [], autoTransfers: [] };
    const planned = plannedHtml ? parseOperOrPlannedHtml(plannedHtml, 'planned') : { updatedAt: null, notices: [], autoTransfers: [] };

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        source: 'live',
        operUpdatedAt: oper.updatedAt,
        emergencyUpdatedAt: emerg.updatedAt,
        plannedUpdatedAt: planned.updatedAt,
        scheduleByDate: parsed.scheduleByDate,
        feederRows: parsed.feederRows,
        operOutages: oper.notices,
        emergencyOutages: emerg.notices,
        plannedOutages: planned.notices,
        autoTransfers: emerg.autoTransfers,
      }),
      {
        headers: {
          ...corsHeaders(),
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=120',
        },
      }
    );
  },
};
