// Vercel Serverless Function: /api/data
// Tries multiple Metabase public-endpoint URL patterns and returns the first
// one that yields a valid JSON array. Surfaces diagnostic info if all fail.

const UUID = 'd5777560-dcd6-427f-a8c1-e745c4d24aa6';
const BASE = 'https://metabase.spyne.ai';

// Different Metabase versions/configs expose public questions at different paths.
// We'll try them in order until one returns a JSON array.
const CANDIDATE_URLS = [
  `${BASE}/api/public/card/${UUID}/query/json`,
  `${BASE}/api/public/card/${UUID}/query`,
  `${BASE}/public/question/${UUID}.json`,
  `${BASE}/public/question/${UUID}/query/json`,
];

const COMMON_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
};

async function tryFetch(url) {
  try {
    const r = await fetch(url, { method: 'GET', headers: COMMON_HEADERS, redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) {}
    return {
      url,
      status: r.status,
      ok: r.ok,
      contentType: ct,
      isArray: Array.isArray(parsed),
      // Metabase sometimes wraps result in { data: { rows, cols } } — handle that
      hasMetabaseShape: parsed && parsed.data && Array.isArray(parsed.data.rows),
      parsed,
      bodyPreview: text.slice(0, 500),
    };
  } catch (err) {
    return { url, status: 0, ok: false, error: String(err.message || err) };
  }
}

// Convert Metabase's {data: {rows: [[...]], cols: [{name},...]}} shape to array of objects
function metabaseShapeToRows(parsed) {
  const cols = parsed.data.cols.map((c) => c.name || c.display_name);
  return parsed.data.rows.map((row) => {
    const obj = {};
    cols.forEach((name, i) => { obj[name] = row[i]; });
    return obj;
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const attempts = [];
  for (const url of CANDIDATE_URLS) {
    const r = await tryFetch(url);
    attempts.push({
      url: r.url, status: r.status, contentType: r.contentType,
      isArray: r.isArray, hasMetabaseShape: r.hasMetabaseShape,
      bodyPreview: r.bodyPreview, error: r.error,
    });

    // Direct array of objects — perfect
    if (r.ok && r.isArray) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.status(200).json(r.parsed);
      return;
    }

    // Metabase wrapped shape — convert and return
    if (r.ok && r.hasMetabaseShape) {
      const rows = metabaseShapeToRows(r.parsed);
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.status(200).json(rows);
      return;
    }
  }

  // All attempts failed — return a diagnostic so the dashboard can show what happened
  res.status(200).json({
    __proxy_error: true,
    message: 'No candidate URL returned a usable JSON array',
    attempts,
  });
}
