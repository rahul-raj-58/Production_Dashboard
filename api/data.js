// Vercel Serverless Function: /api/data
// Fallback proxy — tries hard to mimic a real browser request to Metabase.

const UUID = 'd5777560-dcd6-427f-a8c1-e745c4d24aa6';
const BASE = 'https://metabase.spyne.ai';
const ROW_LIMIT = 2000;

const CANDIDATE_URLS = [
  BASE + '/api/public/card/' + UUID + '/query/json',
  BASE + '/api/public/card/' + UUID + '/query',
  BASE + '/public/question/' + UUID + '.json',
];

// Headers that look as close as possible to a real Chrome browser
const HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="121", "Google Chrome";v="121"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Referer': BASE + '/public/question/' + UUID
};

function jsonResponse(res, statusCode, obj) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  try { res.end(JSON.stringify(obj)); } catch (e) { res.end('{"__proxy_error":true,"message":"stringify failed"}'); }
}

function tryUrl(url) {
  return fetch(url, { method: 'GET', headers: HEADERS, redirect: 'follow' })
    .then(function (r) {
      return r.text().then(function (text) {
        let parsed = null, isArray = false, hasMetabaseShape = false;
        try {
          parsed = JSON.parse(text);
          isArray = Array.isArray(parsed);
          hasMetabaseShape = !!(parsed && parsed.data && Array.isArray(parsed.data.rows));
        } catch (e) {}
        return {
          url: url, status: r.status, ok: r.ok,
          contentType: r.headers.get('content-type') || '',
          isArray: isArray, hasMetabaseShape: hasMetabaseShape,
          parsed: parsed, bodyPreview: text.slice(0, 500), error: null
        };
      }).catch(function (e) {
        return { url: url, status: r.status, ok: r.ok, contentType: '', isArray: false, hasMetabaseShape: false, parsed: null, bodyPreview: '', error: 'read body failed: ' + e.message };
      });
    })
    .catch(function (e) {
      return { url: url, status: 0, ok: false, contentType: '', isArray: false, hasMetabaseShape: false, parsed: null, bodyPreview: '', error: String(e && e.message ? e.message : e) };
    });
}

function metabaseShapeToRows(parsed) {
  const cols = parsed.data.cols.map(function (c) { return c.name || c.display_name; });
  return parsed.data.rows.map(function (row) {
    const obj = {};
    cols.forEach(function (name, i) { obj[name] = row[i]; });
    return obj;
  });
}

function tryAllUrls(index, attempts, onDone) {
  if (index >= CANDIDATE_URLS.length) { onDone({ success: false, attempts: attempts }); return; }
  tryUrl(CANDIDATE_URLS[index]).then(function (r) {
    attempts.push({ url: r.url, status: r.status, ok: r.ok, contentType: r.contentType, isArray: r.isArray, hasMetabaseShape: r.hasMetabaseShape, bodyPreview: r.bodyPreview, error: r.error });
    if (r.ok && r.isArray) { onDone({ success: true, rows: r.parsed, attempts: attempts }); return; }
    if (r.ok && r.hasMetabaseShape) {
      try { onDone({ success: true, rows: metabaseShapeToRows(r.parsed), attempts: attempts }); return; }
      catch (e) { attempts[attempts.length - 1].error = 'shape parse failed: ' + e.message; }
    }
    tryAllUrls(index + 1, attempts, onDone);
  });
}

module.exports = function (req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.statusCode = 204; res.end(); return;
    }
    if (typeof fetch !== 'function') {
      jsonResponse(res, 200, { __proxy_error: true, message: 'fetch is not available', nodeVersion: process.version });
      return;
    }
    tryAllUrls(0, [], function (result) {
      if (result.success) {
        const limited = result.rows.slice(0, ROW_LIMIT);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('X-Total-Rows', String(result.rows.length));
        res.statusCode = 200;
        res.end(JSON.stringify(limited));
      } else {
        jsonResponse(res, 200, { __proxy_error: true, message: 'No candidate URL returned a usable JSON array', attempts: result.attempts, nodeVersion: process.version });
      }
    });
  } catch (outer) {
    jsonResponse(res, 200, { __proxy_error: true, message: 'Proxy threw an uncaught exception', detail: String(outer && outer.message), nodeVersion: typeof process !== 'undefined' ? process.version : 'unknown' });
  }
};
