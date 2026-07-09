/**
 * Cloudflare Worker version of the Reddit proxy — deploy this if you want the
 * site hosted for free on the internet (workers.dev) instead of running
 * server.js locally.
 *
 * Deploy:
 *   1. Create a free app at https://www.reddit.com/prefs/apps (type "script")
 *   2. npx wrangler deploy worker.js --name reddit-swipe
 *   3. npx wrangler secret put REDDIT_CLIENT_ID
 *      npx wrangler secret put REDDIT_CLIENT_SECRET
 *   4. Host index.html anywhere (GitHub Pages, Cloudflare Pages, …) and set
 *      API_BASE in it to your worker URL — or serve the HTML from the worker
 *      too via Workers Static Assets.
 */

let cachedToken = null; // { value, expiresAt } — survives while the isolate is warm

async function getToken(env) {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  const secret = env.REDDIT_CLIENT_SECRET || '';
  const body = secret
    ? 'grant_type=client_credentials'
    : 'grant_type=https://oauth.reddit.com/grants/installed_client&device_id=DO_NOT_TRACK_THIS_DEVICE';

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(env.REDDIT_CLIENT_ID + ':' + secret),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': env.REDDIT_USER_AGENT || 'web:reddit-swipe-proto:v1.0',
    },
    body,
  });
  if (!res.ok) throw new Error('Reddit token request failed: HTTP ' + res.status);
  const j = await res.json();
  cachedToken = { value: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
  return cachedToken.value;
}

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (u.pathname !== '/api/feed') return new Response('not found', { status: 404 });

    const sub = (u.searchParams.get('sub') || '').replace(/[^A-Za-z0-9_]/g, '');
    const limit = Math.min(parseInt(u.searchParams.get('limit') || '40', 10) || 40, 100);
    const afterParam = u.searchParams.get('after');
    if (!sub) return new Response(JSON.stringify({ error: 'missing ?sub=' }), { status: 400, headers: cors });

    try {
      const api = `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/hot?raw_json=1&limit=${limit}` +
                  (afterParam ? `&after=${encodeURIComponent(afterParam)}` : '');
      const res = await fetch(api, {
        headers: {
          'Authorization': 'Bearer ' + await getToken(env),
          'User-Agent': env.REDDIT_USER_AGENT || 'web:reddit-swipe-proto:v1.0',
        },
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      if (!res.ok) throw new Error('Reddit API responded HTTP ' + res.status);
      return new Response(await res.text(), { headers: cors });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: cors });
    }
  },
};
