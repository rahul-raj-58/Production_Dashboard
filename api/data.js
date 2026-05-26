// Vercel Serverless Function: /api/data
// Robust version — never crashes the runtime, always returns JSON with details.

const UUID = 'd5777560-dcd6-427f-a8c1-e745c4d24aa6';


const BASE = 'https://metabase.spyne.ai';

const CANDIDATE_URLS = [
  BASE + '/api/public/card/' + UUID + '/query/json',
  BASE + '/api/public/card/' + UUID + '/query',
  BASE + '/public/question/' + UUID + '.json',
  BASE + '/public/question/' + UUID + '/query/json',
];

const COMMON_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
};

async function safeFetch(url) {
  const out = { url, status: 0, ok: false, contentType: '', isArray: false, hasMetabaseShape: false, parsed: null, bodyPreview: '', error: null };
  try {
    const r = await fetch(url, { method: 'GET', headers: COMMON_HEADERS, redirect: 'follow' });
    out.status = r.status;
    out.ok = r.ok;
    out.contentType = r.headers.get('content-type') || '';
    let text = '';
    try { text = await r.text(); } catch (e) { out.error = 'read body failed: ' + (e && e.message); return out; }
    out.bodyPreview = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text);
      out.parsed = parsed;
      out.isArray = Array.isArray(parsed);
      out.hasMetabaseShape = !!(parsed && parsed.data && Array.isArray(parsed.data.rows));
    } catch (e) {
      // not JSON — leave parsed null, body preview already captured
    }
  } catch (e) {
    out.error = String(e && e.message ? e.message : e);
  }
  return out;
}

function metabaseShapeToRows(parsed) {
  const cols = parsed.data.cols.map(function (c) { return c.name || c.display_name; });
  return parsed.data.rows.map(function (row) {
    const obj = {};
    cols.forEach(function (name, i) { obj[name] = row[i]; });
    return obj;
  });
}

module.exports = async function handler(req, res) {
  // Catch ALL errors and always return a JSON 200 — never let the function crash.
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const attempts = [];
    for (let i = 0; i < CANDIDATE_URLS.length; i++) {
      const url = CANDIDATE_URLS[i];
      const r = await safeFetch(url);
      attempts.push({
        url: r.url,
        status: r.status,
        ok: r.ok,
        contentType: r.contentType,
        isArray: r.isArray,
        hasMetabaseShape: r.hasMetabaseShape,
        bodyPreview: r.bodyPreview,
        error: r.error,
      });

      if (r.ok && r.isArray) {
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        res.status(200).send(JSON.stringify(r.parsed));
        return;
      }
      if (r.ok && r.hasMetabaseShape) {
        try {
          const rows = metabaseShapeToRows(r.parsed);
          res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
          res.status(200).send(JSON.stringify(rows));
          return;
        } catch (e) {
          attempts[attempts.length - 1].error = 'shape parse failed: ' + (e && e.message);
        }
      }
    }

    res.status(200).send(JSON.stringify({
      __proxy_error: true,
      message: 'No candidate URL returned a usable JSON array',
      attempts: attempts,
    }));
  } catch (outer) {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify({
        __proxy_error: true,
        message: 'Proxy threw an uncaught exception',
        detail: String(outer && outer.message ? outer.message : outer),
        stack: outer && outer.stack ? String(outer.stack).slice(0, 1500) : null,
      }));
    } catch (_) {
      // last resort
      res.status(500).end('proxy fatal');
    }
  }
};
