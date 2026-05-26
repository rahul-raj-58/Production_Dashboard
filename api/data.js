// Vercel Serverless Function: /api/data
// Maximum-compatibility version. Uses Promise chains instead of async/await
// in the exported handler to avoid any runtime-specific quirks.

const UUID = 'd5777560-dcd6-427f-a8c1-e745c4d24aa6';
const BASE = 'https://metabase.spyne.ai';

const CANDIDATE_URLS = [
  BASE + '/api/public/card/' + UUID + '/query/json',
  BASE + '/api/public/card/' + UUID + '/query',
  BASE + '/public/question/' + UUID + '.json',
];

const HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (compatible; SpyneAnalyticsProxy/1.0)'
};

function jsonResponse(res, statusCode, obj) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  try {
    res.end(JSON.stringify(obj));
  } catch (e) {
    res.end('{"__proxy_error":true,"message":"stringify failed","detail":"' + String(e.message || e).replace(/"/g, "'") + '"}');
  }
}

function tryUrl(url) {
  return fetch(url, { method: 'GET', headers: HEADERS, redirect: 'follow' })
    .then(function (r) {
      const status = r.status;
      const ok = r.ok;
      const contentType = r.headers.get('content-type') || '';
      return r.text().then(function (text) {
        let parsed = null;
        let isArray = false;
        let hasMetabaseShape = false;
        try {
          parsed = JSON.parse(text);
          isArray = Array.isArray(parsed);
          hasMetabaseShape = !!(parsed && parsed.data && Array.isArray(parsed.data.rows));
        } catch (e) { /* not JSON */ }
        return {
          url: url, status: status, ok: ok, contentType: contentType,
          isArray: isArray, hasMetabaseShape: hasMetabaseShape,
          parsed: parsed, bodyPreview: text.slice(0, 500), error: null
        };
      }).catch(function (e) {
        return {
          url: url, status: status, ok: ok, contentType: contentType,
          isArray: false, hasMetabaseShape: false, parsed: null, bodyPreview: '',
          error: 'read body failed: ' + (e && e.message)
        };
      });
    })
    .catch(function (e) {
      return {
        url: url, status: 0, ok: false, contentType: '',
        isArray: false, hasMetabaseShape: false, parsed: null, bodyPreview: '',
        error: String(e && e.message ? e.message : e)
      };
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
  if (index >= CANDIDATE_URLS.length) {
    onDone({ success: false, attempts: attempts });
    return;
  }
  tryUrl(CANDIDATE_URLS[index]).then(function (r) {
    attempts.push({
      url: r.url, status: r.status, ok: r.ok, contentType: r.contentType,
      isArray: r.isArray, hasMetabaseShape: r.hasMetabaseShape,
      bodyPreview: r.bodyPreview, error: r.error
    });
    if (r.ok && r.isArray) { onDone({ success: true, rows: r.parsed, attempts: attempts }); return; }
    if (r.ok && r.hasMetabaseShape) {
      try {
        const rows = metabaseShapeToRows(r.parsed);
        onDone({ success: true, rows: rows, attempts: attempts });
        return;
      } catch (e) {
        attempts[attempts.length - 1].error = 'shape parse failed: ' + (e && e.message);
      }
    }
    tryAllUrls(index + 1, attempts, onDone);
  });
}

module.exports = function (req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.statusCode = 204;
      res.end();
      return;
    }
    if (typeof fetch !== 'function') {
      jsonResponse(res, 200, {
        __proxy_error: true,
        message: 'fetch is not available in this runtime',
        nodeVersion: process.version,
        hint: 'Update Vercel project Node.js version to 18 or newer in Project Settings.'
      });
      return;
    }
    tryAllUrls(0, [], function (result) {
      if (result.success) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 200;
        res.end(JSON.stringify(result.rows));
      } else {
        jsonResponse(res, 200, {
          __proxy_error: true,
          message: 'No candidate URL returned a usable JSON array',
          attempts: result.attempts,
          nodeVersion: process.version
        });
      }
    });
  } catch (outer) {
    jsonResponse(res, 200, {
      __proxy_error: true,
      message: 'Proxy threw an uncaught exception',
      detail: String(outer && outer.message ? outer.message : outer),
      stack: outer && outer.stack ? String(outer.stack).slice(0, 1500) : null,
      nodeVersion: typeof process !== 'undefined' ? process.version : 'unknown'
    });
  }
};
