# Reddit Swipe

A mobile-friendly, TikTok-style vertical swipe feed for your chosen subreddits.
Videos autoplay full-screen; gallery posts become a horizontal picture carousel
(swipe right through them, with dots + counter); single images get a blurred
backdrop. Infinite scroll, subreddit chips at the top, share/open buttons.

## Try it right now (no Reddit account needed)

```bash
node server.js
```

Open **http://localhost:8734/?demo** — demo mode uses sample videos and images
so you can feel the swiping UX immediately.

## Live Reddit feeds

Reddit killed anonymous API access in 2023 (no CORS + bot fingerprinting), so
the page can't call reddit.com directly from the browser — a tiny proxy does
it via Reddit's **official free OAuth API** instead:

1. Go to https://www.reddit.com/prefs/apps → **create another app**
2. Type: **script** · Name: anything · Redirect URI: `http://localhost:8734`
3. Copy the **client id** (the string under the app name) and the **secret**
4. Run:

```bash
REDDIT_CLIENT_ID=xxxx REDDIT_CLIENT_SECRET=yyyy node server.js
```

Open **http://localhost:8734** — real subreddit feeds now load.
Free tier is 100 requests/min, way more than this app uses (responses are
also cached for 60 s).

## Pick your subreddits

Edit the `SUBREDDITS` list at the top of the `<script>` in `index.html`.

## Deploy to the internet (free)

Use `worker.js` (Cloudflare Workers free tier) for the proxy — instructions in
its header comment. Host `index.html` anywhere static (GitHub Pages,
Cloudflare Pages) and set `API_BASE` in `index.html` to your worker URL.

## Files

- `index.html` — the whole app (no build step, no frameworks)
- `server.js`  — local proxy + static server, zero dependencies (Node 18+)
- `worker.js`  — same proxy as a Cloudflare Worker for free hosting

## Notes

- Autoplay starts muted (browsers require it); the 🔊 button unmutes.
  On iOS Safari sound comes from Reddit's HLS stream; on other browsers a
  synced audio track is used (Reddit serves video and audio separately).
- NSFW and stickied posts are filtered out.
