// Vercel Serverless Function: /api/data
// Proxies the Metabase public question through this domain to bypass CORS.
// Cached for 60 seconds at the edge so repeat loads are instant.

const METABASE_URL =
  'https://metabase.spyne.ai/api/public/card/d5777560-dcd6-427f-a8c1-e745c4d24aa6/query/json';

export default async function handler(req, res) {
  // Allow the dashboard to call this from anywhere
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const upstream = await fetch(METABASE_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).json({
        error: `Metabase returned ${upstream.status}`,
        detail: text.slice(0, 500),
      });
      return;
    }

    const data = await upstream.json();

    // Cache for 60s on Vercel's edge, allow stale-while-revalidate for 5 min.
    // Result: first visitor waits for Metabase, next visitors get instant cached data.
    res.setHeader(
      'Cache-Control',
      's-maxage=60, stale-while-revalidate=300'
    );
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({
      error: 'Proxy fetch failed',
      detail: String(err && err.message ? err.message : err),
    });
  }
}
