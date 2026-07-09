#!/usr/bin/env node
/**
 * Zero-dependency proxy + static server for Reddit Swipe (Node 18+).
 *
 * Reddit blocked anonymous JSON access in 2023, so the browser can't call
 * reddit.com directly (no CORS + bot challenge). This server authenticates
 * with Reddit's official OAuth API and exposes a simple /api/feed endpoint.
 *
 * Setup (once, ~2 minutes):
 *   1. Go to https://www.reddit.com/prefs/apps → "create another app"
 *   2. Type: "script" (or "installed app" if you don't want a secret)
 *   3. Name: anything. Redirect URI: http://localhost:8734 (unused but required)
 *   4. Copy the client id (string under the app name) and the secret
 *
 * Run:
 *   REDDIT_CLIENT_ID=xxxx REDDIT_CLIENT_SECRET=yyyy node server.js
 *   (for an "installed app" there is no secret — just omit REDDIT_CLIENT_SECRET)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8734;
const CLIENT_ID = process.env.REDDIT_CLIENT_ID || '';
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'web:reddit-swipe-proto:v1.0';

let token = null;          // { value, expiresAt }
const feedCache = new Map(); // url -> { body, expiresAt } (60s, be nice to rate limits)

async function getToken() {
  if (token && Date.now() < token.expiresAt) return token.value;
  if (!CLIENT_ID) throw new Error('REDDIT_CLIENT_ID not set — create a free app at reddit.com/prefs/apps and restart with the env vars (see server.js header)');

  const body = CLIENT_SECRET
    ? 'grant_type=client_credentials'
    : 'grant_type=https://oauth.reddit.com/grants/installed_client&device_id=DO_NOT_TRACK_THIS_DEVICE';

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body,
  });
  if (!res.ok) throw new Error('Reddit token request failed: HTTP ' + res.status);
  const j = await res.json();
  if (!j.access_token) throw new Error('Reddit token response missing access_token: ' + JSON.stringify(j));
  token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
  return token.value;
}

const SORTS = new Set(['hot', 'new', 'rising', 'top']);
const TIMES = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);

async function feed(sub, after, limit, sort, t) {
  if (!SORTS.has(sort)) sort = 'hot';
  const url = `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/${sort}?raw_json=1&limit=${limit}` +
              (after ? `&after=${encodeURIComponent(after)}` : '') +
              (t && TIMES.has(t) ? `&t=${t}` : '');
  const cached = feedCache.get(url);
  if (cached && Date.now() < cached.expiresAt) return cached.body;

  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + await getToken(), 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error('Reddit API responded HTTP ' + res.status);
  const body = await res.text();
  feedCache.set(url, { body, expiresAt: Date.now() + 60_000 });
  return body;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (u.pathname === '/api/feed') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    const sub = (u.searchParams.get('sub') || '').replace(/[^A-Za-z0-9_]/g, '');
    const limit = Math.min(parseInt(u.searchParams.get('limit') || '40', 10) || 40, 100);
    if (!sub) { res.writeHead(400); return res.end(JSON.stringify({ error: 'missing ?sub=' })); }
    try {
      const body = await feed(sub, u.searchParams.get('after'), limit,
                              u.searchParams.get('sort') || 'hot', u.searchParams.get('t'));
      res.writeHead(200);
      res.end(body);
    } catch (err) {
      console.error(err.message);
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // static files
  const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
  const full = path.join(__dirname, path.normalize(file));
  if (!full.startsWith(__dirname) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.setHeader('Content-Type', MIME[path.extname(full)] || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
}).listen(PORT, () => {
  console.log(`Reddit Swipe running at http://localhost:${PORT}`);
  console.log(CLIENT_ID
    ? 'Reddit credentials found — live feeds enabled.'
    : 'NOTE: no REDDIT_CLIENT_ID set — only demo mode will work (http://localhost:' + PORT + '/?demo)');
});
