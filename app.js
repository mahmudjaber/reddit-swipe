const APP_VERSION = '1.13.0';   // shown in the ＋ editor — bump with manifest.json

/* ================= CONFIG ================= */
// Default subreddits for first launch — after that, edit your list in the app
// (＋ button in the top bar). Your picks are saved in the browser.
const DEFAULT_SUBREDDITS = [
  'oddlysatisfying',
  'aww',
  'nextfuckinglevel',
  'foodporn',
  'interestingasfuck',
  'EarthPorn',
];
const PAGE_SIZE = 30;          // posts fetched per request per subreddit
const LOAD_MORE_AT = 4;        // fetch more when this many slides from the end
const BATCH_SIZE = 10;         // slides appended to My Feed at a time
const MIN_BUFFER = 20;         // refill the My Feed pool below this many posts
const MIN_VIDEO_BUFFER = 12;   // videos burn 3x faster than stills — refill early
const VIDEOS_PER_STILL = 3;    // feed rhythm: 3 videos, then 1 picture/gallery
// Where the proxy lives. '' = same origin (node server.js serves both the page
// and /api/feed). If you host this HTML elsewhere (e.g. GitHub Pages), set this
// to your deployed worker URL, e.g. 'https://reddit-swipe.<you>.workers.dev'
const API_BASE = '';
/* ========================================== */

const DEMO = new URLSearchParams(location.search).has('demo');
// Running as a Chrome extension page: host_permissions let us call reddit.com
// directly with the user's own logged-in session — no proxy needed.
const EXTENSION = location.protocol === 'chrome-extension:';

const feed = document.getElementById('feed');
const topbar = document.getElementById('topbar');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');

/* ---------- persistent state ---------- */
let subs;
try { subs = JSON.parse(localStorage.getItem('rs.subs')); } catch {}
if (!Array.isArray(subs) || subs.length === 0) subs = DEFAULT_SUBREDDITS.slice();
function saveSubs() { localStorage.setItem('rs.subs', JSON.stringify(subs)); }

let showNsfw = localStorage.getItem('rs.nsfw') === '1';

/* ---------- session state ---------- */
let mode = 'my';             // 'my' = mixed algorithmic feed, 'sub' = single subreddit
let currentSub = null;       // when mode === 'sub'
let loading = false;
let soundOn = false;         // global mute state (autoplay must start muted)
const seen = new Set();      // per-feed-build fetch dedup
const shownIds = new Set();  // everything shown this session — refresh won't repeat these

// single-sub mode
let subAfter = null;
let subExhausted = false;
let subSortIdx = 0;          // cycles hot → top(day) → rising → top(week) on refresh

// My Feed mode
const my = {
  seed: (Math.random() * 2 ** 31) | 0,
  sorts: {},                 // sub -> [sort, t] chosen for this session/refresh
  buffer: [],                // fetched-but-not-shown posts
  afters: {},                // sub -> cursor; null = exhausted
  fetching: false,
  slot: 0,                   // position in the video/still rhythm, survives batches
  videoYield: {},            // sub -> videos found so far (guides deep refills)
  sortCursor: (Math.random() * 4) | 0,  // advanced on refresh → different sorts
  recycled: false,           // whether shownIds was already recycled this build
};

const SORTS = [['hot', null], ['top', 'day'], ['rising', null], ['top', 'week']];

/* ---------- tiny DOM helper — all data-driven text via textContent ---------- */
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/* =======================================================================
   FETCHING
   -----------------------------------------------------------------------
   Reddit rate-limits bursts (HTTP 429). All requests go through a polite
   queue: max 2 in flight, spaced apart, one automatic wait-and-retry on
   429 honoring Retry-After. Fetched pages are cached for 5 minutes so
   chip-hopping and buffer refills don't refetch the same listing.
   ======================================================================= */
const fetchQueue = [];
let activeFetches = 0;
const MAX_CONCURRENT = 2;
const SPACING_MS = 400;

function politeFetch(url, opts) {
  return new Promise((resolve, reject) => {
    fetchQueue.push({ url, opts, resolve, reject });
    pumpQueue();
  });
}
async function pumpQueue() {
  if (activeFetches >= MAX_CONCURRENT || fetchQueue.length === 0) return;
  const job = fetchQueue.shift();
  activeFetches++;
  try {
    let res = await fetch(job.url, job.opts);
    if (res.status === 429) {
      const wait = Math.min(parseInt(res.headers.get('retry-after'), 10) || 15, 60);
      if (feed.children.length === 0) {
        showStatus(`Reddit rate limit — retrying in ${wait}s…`);
      }
      await new Promise(r => setTimeout(r, wait * 1000));
      res = await fetch(job.url, job.opts);
    }
    job.resolve(res);
  } catch (e) {
    job.reject(e);
  } finally {
    activeFetches--;
    setTimeout(pumpQueue, SPACING_MS);
  }
}

const pageCache = new Map();   // url -> { json, at }
const PAGE_CACHE_MS = 5 * 60_000;

async function fetchSubPage(sub, sort, t, cursor) {
  if (DEMO) return demoPage(cursor);
  const qs = `limit=${PAGE_SIZE}&raw_json=1` +
             (cursor ? `&after=${encodeURIComponent(cursor)}` : '') +
             (t ? `&t=${t}` : '');
  const url = EXTENSION
    ? `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}.json?${qs}`
    : `${API_BASE}/api/feed?sub=${encodeURIComponent(sub)}&sort=${sort}&${qs}`;

  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return cached.json;

  const res = await politeFetch(url, EXTENSION ? { credentials: 'include' } : undefined);
  if (!res.ok) {
    if (EXTENSION) {
      throw new Error('Reddit responded HTTP ' + res.status +
        (res.status === 403 ? ' — open reddit.com in another tab (log in), then tap here to retry' :
         res.status === 429 ? ' — rate limited; wait a minute, then tap here to retry' : ''));
    }
    let msg = 'proxy responded ' + res.status;
    try { const e = await res.json(); if (e.error) msg = e.error; } catch {}
    throw new Error(msg);
  }
  const json = await res.json();
  pageCache.set(url, { json, at: Date.now() });
  return json;
}

/* =======================================================================
   VIDEO CACHE — Cache Storage API, LRU-evicted by video id
   -----------------------------------------------------------------------
   HLS: every segment the player downloads is written through, so rewatches
   and revisits are served from disk at zero extra bandwidth. mp4/redgifs:
   cached in the background only AFTER the video leaves the screen (never
   competes with the playing video). v.redd.it URLs carry expiring auth
   tokens in the query string, so cache keys are the bare path.
   ======================================================================= */
const VIDCACHE = 'rs-video-cache-v1';
const VID_CACHE_CAP = 512 * 1024 * 1024;   // evict oldest videos past this
const MP4_CACHE_MAX = 30 * 1024 * 1024;    // don't cache huge single files
const CACHE_OK = typeof caches !== 'undefined';

let vidIndex = {};                          // videoId -> { at, bytes }
try { vidIndex = JSON.parse(localStorage.getItem('rs.vidcache')) || {}; } catch {}
const saveVidIndex = () => { try { localStorage.setItem('rs.vidcache', JSON.stringify(vidIndex)); } catch {} };

function cacheKeyOf(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'v.redd.it') return 'https://v.redd.it' + u.pathname;
  } catch {}
  return url.split('#')[0];
}
function vidIdOf(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'v.redd.it' ? u.pathname.split('/')[1] : u.hostname + u.pathname;
  } catch { return url; }
}
function cacheTotalBytes() {
  return Object.values(vidIndex).reduce((a, e) => a + (e.bytes || 0), 0);
}
function fmtBytes(n) {
  return n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(0) + ' MB' : Math.ceil(n / 1e3) + ' KB';
}
function bumpVidIndex(id, addBytes) {
  const e = vidIndex[id] || (vidIndex[id] = { at: 0, bytes: 0 });
  e.at = Date.now();
  e.bytes += addBytes;
  saveVidIndex();
  if (addBytes > 0) evictVidCache();
}
async function evictVidCache() {
  let total = cacheTotalBytes();
  if (total <= VID_CACHE_CAP) return;
  const cache = await caches.open(VIDCACHE);
  const keys = await cache.keys();
  const oldest = Object.keys(vidIndex).sort((a, b) => vidIndex[a].at - vidIndex[b].at);
  for (const id of oldest) {
    if (total <= VID_CACHE_CAP * 0.8) break;   // free a chunk, not one file at a time
    for (const req of keys) if (vidIdOf(req.url) === id) cache.delete(req);
    total -= vidIndex[id].bytes;
    delete vidIndex[id];
  }
  saveVidIndex();
}

// hls.js fragment loader with cache-first reads and write-through on miss
function makeCacheFragLoader() {
  return class extends Hls.DefaultConfig.loader {
    load(context, config, callbacks) {
      if (!CACHE_OK || context.responseType !== 'arraybuffer') {
        return super.load(context, config, callbacks);
      }
      // CMAF fragments are byte ranges within one file — the range MUST be
      // part of the key or fragments would overwrite each other
      const range = context.rangeStart != null ? `?r=${context.rangeStart}-${context.rangeEnd ?? ''}` : '';
      const key = cacheKeyOf(context.url) + range;
      caches.open(VIDCACHE).then(c => c.match(key)).then(hit => {
        if (!hit) {
          const orig = callbacks.onSuccess;
          callbacks.onSuccess = (response, stats, ctx, xhr) => {
            if (response.data && response.data.byteLength) {
              const copy = response.data.slice(0);
              caches.open(VIDCACHE)
                .then(c => c.put(key, new Response(copy)))
                .then(() => bumpVidIndex(vidIdOf(context.url), copy.byteLength))
                .catch(() => {});
            }
            orig(response, stats, ctx, xhr);
          };
          return super.load(context, config, callbacks);
        }
        hit.arrayBuffer().then(data => {
          bumpVidIndex(vidIdOf(context.url), 0);   // touch LRU, no size change
          const now = performance.now();
          const stats = this.stats;
          stats.loading.start = stats.loading.first = stats.loading.end = now;
          stats.loaded = stats.total = data.byteLength;
          callbacks.onSuccess({ url: context.url, data }, stats, context, null);
        });
      }).catch(() => super.load(context, config, callbacks));
    }
  };
}

// mp4 paths: play from cache when we have it (via blob URL), else network
async function setMp4Src(s, v, url) {
  s._mp4Url = url;
  if (CACHE_OK) {
    try {
      const cache = await caches.open(VIDCACHE);
      const hit = await cache.match(cacheKeyOf(url));
      if (hit) {
        bumpVidIndex(vidIdOf(url), 0);
        s._blobUrl = URL.createObjectURL(await hit.blob());
        v.src = s._blobUrl;
        return;
      }
    } catch {}
  }
  v.src = url;
}

// background write-through queue — one at a time, only videos actually watched
const mp4CacheQueue = [];
let mp4Caching = false;
function queueMp4Cache(url) {
  if (!CACHE_OK || mp4CacheQueue.includes(url)) return;
  mp4CacheQueue.push(url);
  pumpMp4Cache();
}
async function pumpMp4Cache() {
  if (mp4Caching || mp4CacheQueue.length === 0) return;
  mp4Caching = true;
  const url = mp4CacheQueue.shift();
  try {
    const cache = await caches.open(VIDCACHE);
    if (!await cache.match(cacheKeyOf(url))) {
      const res = await fetch(url);
      const len = +res.headers.get('content-length') || 0;
      if (res.ok && (!len || len < MP4_CACHE_MAX)) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength < MP4_CACHE_MAX) {
          await cache.put(cacheKeyOf(url), new Response(buf));
          bumpVidIndex(vidIdOf(url), buf.byteLength);
        }
      }
    }
  } catch {}
  mp4Caching = false;
  setTimeout(pumpMp4Cache, 500);
}

// Find a playable video for a post, looking beyond native reddit video:
// crossposts carry the video on their parent, and animated GIFs (imgur .gifv,
// direct .gif posts) come with an mp4 rendition in the preview.
function videoInfoOf(post) {
  if (post.media && post.media.reddit_video) return post.media.reddit_video;
  const xp = post.crosspost_parent_list && post.crosspost_parent_list[0];
  if (xp && xp.media && xp.media.reddit_video) return xp.media.reddit_video;
  // trust the preview's own is_gif/has_audio — many of these are real videos
  // with sound (external videos rehosted by reddit), not gifs
  const rvp = post.preview && post.preview.reddit_video_preview;
  if (rvp && rvp.fallback_url) return rvp;
  if (/\.gifv$/i.test(post.url || '')) {
    return { fallback_url: post.url.replace(/\.gifv$/i, '.mp4'), has_audio: false, is_gif: true };
  }
  return null;
}

function usablePosts(data, skipShown) {
  const out = [];
  for (const child of data.data.children) {
    const post = child.data;
    if (post.stickied || seen.has(post.id)) continue;
    if (skipShown && shownIds.has(post.id)) continue;
    if (post.over_18 && !showNsfw) continue;
    // redgifs: reddit's rehosted preview is always video-only; remember the id
    // so the slide can fetch the original (which has the audio) instead
    const rg = (post.url || '').match(/redgifs\.com\/(?:watch|ifr)\/([a-z0-9]+)/i);
    if (rg) post._redgifs = rg[1].toLowerCase();
    const rv = videoInfoOf(post);       // prefer motion: a .gif still gets played as video
    if (rv) post._rv = rv;
    else if (post._redgifs) post._rv = {};   // no preview rehost — original only
    else if (!(post.is_gallery && post.media_metadata) && !isDirectImage(post)) continue;
    seen.add(post.id);
    out.push(post);
  }
  return out;
}

/* ---------- redgifs original resolution (extension only — needs host perm) ---------- */
let rgToken = null;
const rgCache = new Map();
async function resolveRedgifs(id) {
  if (rgCache.has(id)) return rgCache.get(id);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!rgToken) {
      const r = await politeFetch('https://api.redgifs.com/v2/auth/temporary');
      rgToken = (await r.json()).token;
    }
    const r = await politeFetch('https://api.redgifs.com/v2/gifs/' + encodeURIComponent(id), {
      headers: { Authorization: 'Bearer ' + rgToken },
    });
    if (r.status === 401) { rgToken = null; continue; }   // token expired — retry once
    if (!r.ok) break;
    const j = await r.json();
    const url = (j && j.gif && j.gif.urls && (j.gif.urls.hd || j.gif.urls.sd)) || null;
    rgCache.set(id, url);
    return url;
  }
  rgCache.set(id, null);
  return null;
}

/* =======================================================================
   MY FEED — the mixing algorithm
   -----------------------------------------------------------------------
   1) SCORING — each post gets a score:
        popularity  log10(upvotes)          — crowd signal
        buzz        log10(comments)         — discussion signal
        velocity    upvotes per hour        — catches fast-rising posts
        freshness   exp decay (~36 h)       — newer wins ties
        length fit  short videos (≤60s) up, long (>3 min) down — swipe pacing
        jitter      seeded random           — so every refresh reshuffles
   2) RHYTHM — slides are dealt from two score-sorted pools (videos vs
      pictures/galleries) in a fixed cycle: 3 videos, then 1 still. If one
      pool runs dry the other fills in, so the feed never stalls.
   3) DIVERSITY — avoid repeating any subreddit within the last 2 slides.
   Refresh re-seeds the jitter AND rotates each sub between hot / top(day) /
   rising / top(week), so refreshed feeds contain genuinely different posts.
   ======================================================================= */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seededRand(seed) {
  let a = seed | 0;
  a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function scorePost(p, seed) {
  const hours = Math.max(0, (Date.now() / 1000 - (p.created_utc || 0)) / 3600);
  const freshness = Math.exp(-hours / 36);
  const popularity = Math.log10((p.ups || 0) + 1);
  const buzz = Math.log10((p.num_comments || 0) + 1);
  const velocity = Math.log10((p.ups || 0) / (hours + 2) + 1);
  let lengthFit = 0;
  if (p._rv) {
    const d = p._rv.duration || 0;
    if (d > 0 && d <= 60) lengthFit = 0.4;        // snackable — ideal for swiping
    else if (d > 180) lengthFit = -0.5;           // long videos buffer poorly here
    // real videos (with sound) outrank silent gifs within the video slots
    if (p._rv.is_gif || p._rv.has_audio === false) lengthFit -= 0.6;
    else lengthFit += 0.3;
  }
  const jitter = seededRand(seed ^ hashStr(p.id));
  return popularity * 0.8 + buzz * 0.4 + velocity * 1.2 + freshness * 2.0 +
         lengthFit + jitter * 1.2;
}

function pickBatch(buffer, seed, n) {
  const scored = buffer.map(p => ({ p, s: scorePost(p, seed) })).sort((a, b) => b.s - a.s);
  const videos = scored.filter(x => x.p._rv);
  const stills = scored.filter(x => !x.p._rv);   // galleries + single images
  const out = [];
  const recentSubs = [];

  const takeFrom = pool => {
    if (!pool.length) return null;
    let idx = pool.findIndex(x => !recentSubs.includes(x.p.subreddit));
    if (idx === -1) idx = 0;                     // few subs left — allow repeats
    return pool.splice(idx, 1)[0].p;
  };

  while (out.length < n && (videos.length || stills.length)) {
    const wantVideo = my.slot % (VIDEOS_PER_STILL + 1) < VIDEOS_PER_STILL;
    const p = wantVideo ? (takeFrom(videos) || takeFrom(stills))
                        : (takeFrom(stills) || takeFrom(videos));
    if (!p) break;
    // only advance the rhythm when the slot got its intended type, so a
    // temporary video drought doesn't burn through the "still" slots
    if (!!p._rv === wantVideo) my.slot++;
    out.push(p);
    recentSubs.push(p.subreddit);
    if (recentSubs.length > 2) recentSubs.shift();
  }

  // remove picked posts from the buffer
  const taken = new Set(out.map(p => p.id));
  for (let i = buffer.length - 1; i >= 0; i--) if (taken.has(buffer[i].id)) buffer.splice(i, 1);
  return out;
}

// every refresh advances the cursor, so each sub gets a genuinely different
// sort than last time (random picks kept colliding → same cached listing)
function rotatedSortPlan() {
  my.sortCursor = (my.sortCursor + 1) % SORTS.length;
  const plan = {};
  subs.forEach((s, i) => { plan[s] = SORTS[(i + my.sortCursor) % SORTS.length]; });
  return plan;
}

async function ensureBuffer() {
  if (my.fetching) return;
  my.fetching = true;
  try {
    // videos deplete 3x faster than stills, and picture-heavy subs may only
    // have a handful per page — paginate deeper (up to 3 rounds) until the
    // video pool is healthy, and after round 1 only re-fetch subs that have
    // actually been yielding videos, to not waste rate budget on photo subs.
    for (let round = 0; round < 3; round++) {
      const videoCount = my.buffer.reduce((c, p) => c + (p._rv ? 1 : 0), 0);
      if (my.buffer.length >= MIN_BUFFER && videoCount >= MIN_VIDEO_BUFFER) return;
      let pending = subs.filter(s => my.afters[s] !== null); // null = exhausted
      if (round > 0) {
        const yielding = pending.filter(s => (my.videoYield[s] || 0) > 0);
        if (yielding.length) pending = yielding;
      }
      if (pending.length === 0) return;
      const results = await Promise.allSettled(pending.map(async sub => {
        const [sort, t] = my.sorts[sub] || ['hot', null];
        const data = await fetchSubPage(sub, sort, t, my.afters[sub]);
        my.afters[sub] = data.data.after || null;
        const posts = usablePosts(data, true);   // never re-show this session's posts
        my.videoYield[sub] = (my.videoYield[sub] || 0) + posts.filter(p => p._rv).length;
        my.buffer.push(...posts);
      }));
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length === pending.length) throw failures[0].reason;
    }
  } finally {
    my.fetching = false;
  }
}

async function myLoadMore() {
  if (loading) return;
  loading = true;
  try {
    await ensureBuffer();
    const batch = pickBatch(my.buffer, my.seed, BATCH_SIZE);
    for (const post of batch) {
      const slide = buildSlide(post);
      if (slide) { feed.appendChild(slide); shownIds.add(post.id); }
    }
    if (feed.children.length > 0) hideStatus();
    else if (subs.every(s => my.afters[s] === null)) {
      // everything ever fetched was already shown this session — recycle once
      if (!my.recycled && shownIds.size) {
        my.recycled = true;
        shownIds.clear();
        seen.clear();
        my.afters = {};
        loading = false;
        return myLoadMore();
      }
      showStatus('No playable posts found in your subreddits — edit the list with ＋', false);
    }
    ensureBuffer(); // fire-and-forget refill for the next batch
  } catch (err) {
    console.error(err);
    if (feed.children.length === 0) showStatus('Could not load your feed — ' + err.message, false);
  } finally {
    loading = false;
  }
}

function enterMyFeed(reset) {
  mode = 'my';
  currentSub = null;
  if (reset) {
    my.seed = (Math.random() * 2 ** 31) | 0;
    my.sorts = rotatedSortPlan();
    my.buffer = [];
    my.afters = {};
    my.slot = 0;
    my.videoYield = {};
    my.recycled = false;
    seen.clear();
    feed.replaceChildren();
    feed.scrollTop = 0;
  }
  highlightChip('my');
  showStatus('Mixing your feed…');
  myLoadMore();
}

/* =======================================================================
   SINGLE SUBREDDIT MODE
   ======================================================================= */
async function subLoadMore() {
  if (loading || subExhausted) return;
  loading = true;
  try {
    const [sort, t] = SORTS[subSortIdx];
    const data = await fetchSubPage(currentSub, sort, t, subAfter);
    subAfter = data.data.after;
    if (!subAfter) subExhausted = true;
    let added = 0;
    for (const post of usablePosts(data)) {
      const slide = buildSlide(post);
      if (slide) { feed.appendChild(slide); added++; }
    }
    hideStatus();
    if (added === 0 && !subExhausted) { loading = false; return subLoadMore(); }
    if (feed.children.length === 0) {
      showStatus('No playable video/image posts found in r/' + currentSub, false);
    }
  } catch (err) {
    console.error(err);
    if (feed.children.length === 0) {
      showStatus('Could not load r/' + currentSub + ' — ' + err.message, false);
    }
  } finally {
    loading = false;
  }
}

function enterSub(sub, resetSort) {
  mode = 'sub';
  currentSub = sub;
  if (resetSort) subSortIdx = 0;
  subAfter = null;
  subExhausted = false;
  seen.clear();
  feed.replaceChildren();
  feed.scrollTop = 0;
  highlightChip(sub);
  const [sort, t] = SORTS[subSortIdx];
  showStatus(`Loading r/${sub} (${sort}${t ? ' · ' + t : ''})…`);
  subLoadMore();
}

/* ---------- refresh: new content, new order ---------- */
function refresh() {
  if (mode === 'my') {
    enterMyFeed(true);
  } else {
    subSortIdx = (subSortIdx + 1) % SORTS.length;   // hot → top(day) → rising → top(week)
    enterSub(currentSub, false);
  }
}

function loadMore() { mode === 'my' ? myLoadMore() : subLoadMore(); }

/* =======================================================================
   TOP BAR + SUBREDDIT EDITOR
   ======================================================================= */
function rebuildTopbar() {
  topbar.replaceChildren();
  const myChip = el('button', 'chip', '⭐ My Feed');
  myChip.dataset.key = 'my';
  myChip.onclick = () => { if (mode !== 'my') enterMyFeed(true); };
  topbar.appendChild(myChip);

  for (const sub of subs) {
    const b = el('button', 'chip', 'r/' + sub);
    b.dataset.key = sub;
    b.onclick = () => { if (!(mode === 'sub' && currentSub === sub)) enterSub(sub, true); };
    topbar.appendChild(b);
  }

  const edit = el('button', 'chip', '＋');
  edit.title = 'Edit subreddits';
  edit.onclick = openEditor;
  topbar.appendChild(edit);

  highlightChip(mode === 'my' ? 'my' : currentSub);
}
function highlightChip(key) {
  document.querySelectorAll('.chip').forEach(c =>
    c.classList.toggle('active', c.dataset.key === key));
}

function openEditor() {
  const overlay = el('div', 'editor-overlay');
  const card = el('div', 'editor-card');
  card.appendChild(el('div', 'editor-title', `My Feed subreddits — v${APP_VERSION}`));

  const list = el('div', 'editor-list');
  const renderList = () => {
    list.replaceChildren();
    for (const sub of subs) {
      const row = el('div', 'editor-row');
      row.appendChild(el('span', null, 'r/' + sub));
      const rm = el('button', 'editor-remove', '✕');
      rm.onclick = () => {
        if (subs.length === 1) return alert('Keep at least one subreddit');
        subs = subs.filter(s => s !== sub);
        renderList();
      };
      row.appendChild(rm);
      list.appendChild(row);
    }
  };
  renderList();
  card.appendChild(list);

  const addRow = el('div', 'editor-add');
  const input = document.createElement('input');
  input.placeholder = 'add subreddit, e.g. r/space';
  input.autocapitalize = 'none';
  const addBtn = el('button', 'editor-btn', 'Add');
  const add = () => {
    const name = input.value.trim().replace(/^\/?(r\/)?/i, '');
    if (!/^[A-Za-z0-9_]{2,21}$/.test(name)) return alert('That does not look like a subreddit name');
    if (!subs.some(s => s.toLowerCase() === name.toLowerCase())) subs.push(name);
    input.value = '';
    renderList();
  };
  addBtn.onclick = add;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  card.appendChild(addRow);

  // 18+ toggle — only affects what YOUR logged-in Reddit account can already see
  const nsfwRow = el('label', 'editor-row');
  nsfwRow.appendChild(el('span', null, 'Show 18+ posts'));
  const nsfwToggle = document.createElement('input');
  nsfwToggle.type = 'checkbox';
  nsfwToggle.checked = showNsfw;
  nsfwToggle.onchange = () => {
    showNsfw = nsfwToggle.checked;
    localStorage.setItem('rs.nsfw', showNsfw ? '1' : '0');
  };
  nsfwRow.appendChild(nsfwToggle);
  card.appendChild(nsfwRow);

  // transfer settings between devices (desktop Chrome ⇄ iPhone Orion, …)
  const xferRow = el('div', 'editor-add');
  const copyBtn = el('button', 'editor-btn', 'Copy my settings');
  copyBtn.onclick = async () => {
    const payload = JSON.stringify({ subs, nsfw: showNsfw });
    try { await navigator.clipboard.writeText(payload); copyBtn.textContent = 'Copied ✓'; }
    catch { prompt('Copy this:', payload); }
    setTimeout(() => (copyBtn.textContent = 'Copy my settings'), 1500);
  };
  const pasteBtn = el('button', 'editor-btn', 'Paste settings');
  pasteBtn.onclick = () => {
    const raw = prompt('Paste your settings (from "Copy my settings" on the other device):');
    if (!raw) return;
    try {
      const j = JSON.parse(raw);
      if (!Array.isArray(j.subs) || !j.subs.every(s => /^[A-Za-z0-9_]{2,21}$/.test(s))) throw 0;
      subs = j.subs;
      showNsfw = !!j.nsfw;
      localStorage.setItem('rs.nsfw', showNsfw ? '1' : '0');
      nsfwToggle.checked = showNsfw;
      saveSubs();
      renderList();
    } catch {
      // also accept a plain comma/space separated list of subreddit names
      const names = raw.split(/[,\s]+/).map(s => s.trim().replace(/^\/?(r\/)?/i, '')).filter(Boolean);
      if (names.length && names.every(s => /^[A-Za-z0-9_]{2,21}$/.test(s))) {
        subs = names;
        saveSubs();
        renderList();
      } else {
        alert('Could not read that — paste exactly what "Copy my settings" produced');
      }
    }
  };
  xferRow.appendChild(copyBtn);
  xferRow.appendChild(pasteBtn);
  card.appendChild(xferRow);

  const dbg = el('button', 'editor-btn', 'Sound debug');
  dbg.onclick = () => { overlay.remove(); soundDebug(); };
  card.appendChild(dbg);

  const cacheBtn = el('button', 'editor-btn',
    `Clear video cache · ${fmtBytes(cacheTotalBytes())} of ${fmtBytes(VID_CACHE_CAP)}`);
  cacheBtn.onclick = async () => {
    if (CACHE_OK) await caches.delete(VIDCACHE);
    vidIndex = {};
    saveVidIndex();
    cacheBtn.textContent = 'Video cache cleared ✓';
  };
  card.appendChild(cacheBtn);

  const done = el('button', 'editor-btn editor-done', 'Done');
  done.onclick = () => {
    saveSubs();
    overlay.remove();
    rebuildTopbar();
    if (mode === 'sub' && !subs.includes(currentSub)) enterMyFeed(true);
    else if (mode === 'my') enterMyFeed(true);
  };
  card.appendChild(done);

  overlay.appendChild(card);
  overlay.addEventListener('click', e => { if (e.target === overlay) done.onclick(); });
  document.body.appendChild(overlay);
  input.focus();
}

/* =======================================================================
   SOUND SELF-TEST — ＋ editor → "Sound debug"
   ======================================================================= */
async function soundDebug() {
  const slides = [...document.querySelectorAll('.slide')];
  const s = slides.find(x => x._video && !x._video.paused) || slides.find(x => x._video);
  if (!s) return alert('No video slide on screen — swipe to a video first');
  const v = s._video;
  const a1 = v.webkitAudioDecodedByteCount ?? -1;
  v.muted = false;
  if (s._audio) { s._audio.currentTime = v.currentTime; s._audio.play().catch(() => {}); }
  let playErr = 'none';
  try { await v.play(); } catch (e) { playErr = e.name + ': ' + e.message; }
  await new Promise(r => setTimeout(r, 2500));
  const a2 = v.webkitAudioDecodedByteCount ?? -1;
  let hlsInfo = 'n/a';
  let manifestAudio = 'n/a';
  if (s._hls) {
    hlsInfo = `audioTracks=${s._hls.audioTracks.length} current=${s._hls.audioTrack} ` +
              `levels=${s._hls.levels.length} worker=${s._hls.config.enableWorker}`;
    try {
      const txt = await (await fetch(s._hlsUrl)).text();
      manifestAudio = (txt.match(/TYPE=AUDIO/g) || []).length + ' audio rendition(s) in manifest';
    } catch (e) { manifestAudio = 'manifest fetch failed: ' + e.message; }
  }
  alert([
    'app version: ' + APP_VERSION,
    'hls.js loaded: ' + !!window.Hls,
    'video path: ' + (s._path || 'unknown'),
    'hls attached: ' + !!s._hls + '   hls error: ' + (s._hlsErr || 'none'),
    'playing: ' + !v.paused + '   muted: ' + v.muted + '   volume: ' + v.volume,
    'audio decoded bytes: ' + a1 + ' → ' + a2 + (a2 > a1 ? '   (audio IS decoding)' : '   (NO audio decoding!)'),
    'audio element: ' + (s._audio
      ? (s._audio.error ? 'ERROR code ' + s._audio.error.code : (s._audio.paused ? 'paused' : 'playing') + ' — ' + s._audio.src.split('/').pop().split('?')[0])
      : 'not used'),
    'play() rejection: ' + playErr,
    'global soundOn: ' + soundOn,
    'hls state: ' + hlsInfo,
    'manifest: ' + manifestAudio,
  ].join('\n'));
}

/* =======================================================================
   STATUS
   ======================================================================= */
function showStatus(msg, spin = true) {
  statusEl.classList.remove('hidden');
  statusEl.querySelector('.spinner').style.display = spin ? '' : 'none';
  statusText.textContent = msg;
}
function hideStatus() { statusEl.classList.add('hidden'); }
statusEl.addEventListener('click', () => {
  if (!loading && feed.children.length === 0) {
    showStatus('Retrying…');
    loadMore();
  }
});

/* =======================================================================
   SLIDE BUILDERS
   ======================================================================= */
function buildSlide(post) {
  if (post._rv || (post.is_video && post.media && post.media.reddit_video)) return videoSlide(post);
  if (post.is_gallery && post.media_metadata) return gallerySlide(post);
  if (isDirectImage(post)) return imageSlide(post);
  return null;
}

function isDirectImage(post) {
  return /\.(jpe?g|png|gif|webp)$/i.test(post.url || '') ||
         (post.post_hint === 'image' && post.preview);
}

function railButton(iconChar, label, onClick) {
  const b = el('button');
  b.appendChild(el('span', 'icon', iconChar));
  b.appendChild(document.createTextNode(label));
  b.onclick = onClick;
  return b;
}

function baseSlide(post, typeLabel) {
  const s = el('div', 'slide');

  const overlay = el('div', 'overlay');
  overlay.appendChild(el('div', 'sub', 'r/' + post.subreddit));
  overlay.appendChild(el('div', 'title', post.title));
  overlay.appendChild(el('div', 'meta',
    `▲ ${fmt(post.ups)} · 💬 ${fmt(post.num_comments)} · u/${post.author}`));
  s.appendChild(overlay);

  const permalink = 'https://www.reddit.com' + post.permalink;
  const rail = el('div', 'rail');
  rail.appendChild(railButton('↗', 'open', e => {
    e.stopPropagation();
    window.open(permalink, '_blank');
  }));
  rail.appendChild(railButton('➦', 'share', async e => {
    e.stopPropagation();
    if (navigator.share) { try { await navigator.share({ title: post.title, url: permalink }); } catch {} }
    else { await navigator.clipboard.writeText(permalink); alert('Link copied'); }
  }));
  s.appendChild(rail);

  if (typeLabel) s.appendChild(el('div', 'type-badge', typeLabel));
  return s;
}

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

/* ----- video ----- */
function setBadge(s, text) {
  let b = s.querySelector('.type-badge');
  if (!text) { if (b) b.remove(); return; }
  if (b) b.textContent = text;
  else s.appendChild(el('div', 'type-badge', text));
}

function videoSlide(post) {
  const rv = post._rv || post.media.reddit_video;
  const s = baseSlide(post, null);

  const media = el('div', 'media');

  const v = document.createElement('video');
  v.playsInline = true;
  v.muted = true;
  v.loop = true;
  // preload nothing by default — the warm-up observer upgrades the current and
  // next few slides to preload=auto so they don't all fight for bandwidth.
  v.preload = 'none';
  v.poster = posterOf(post) || '';

  // Safari plays HLS natively (with sound); everywhere else use the mp4
  // fallback (video-only) plus a synced <audio> element for sound.
  // NB: don't trust canPlayType('application/vnd.apple.mpegurl') — Chrome
  // answers "maybe" but can't actually play HLS, leaving a frozen poster.
  const ua = navigator.userAgent;
  const isSafari = /iPhone|iPad|iPod/.test(ua) ||
                   (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|OPR\//.test(ua));
  // Reddit's is_gif/has_audio metadata is unreliable in BOTH directions, so it
  // never decides routing: anything with an HLS stream goes through HLS, which
  // carries the audio whenever the source has any.
  if (post._redgifs && EXTENSION) {
    // reddit's rehost of redgifs is video-only — fetch the original, which
    // is a plain mp4 with the audio muxed in
    s._path = 'redgifs';
    resolveRedgifs(post._redgifs).then(url => {
      if (!url) return;
      return setMp4Src(s, v, url).then(() => {
        const r = s.getBoundingClientRect();
        if (r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.5) v.play().catch(() => {});
      });
    }).catch(() => {});
  } else if (isSafari && rv.hls_url) {
    s._path = 'native-hls';
    v.src = rv.hls_url;        // native HLS — audio is muxed in
  } else if (rv.hls_url && window.Hls && Hls.isSupported()) {
    // hls.js — audio muxed in, adaptive bitrate for smoother buffering.
    // Attached lazily by the warm-up observer so off-screen slides cost nothing.
    s._path = 'hls.js';
    s._hlsUrl = rv.hls_url;
  } else if (!/^https:\/\/v\.redd\.it\//.test(rv.fallback_url || '')) {
    s._path = 'mp4-external';
    setMp4Src(s, v, rv.fallback_url);   // e.g. imgur .gifv — no side-audio scheme exists
  } else {
    s._path = 'mp4+audio-el';
    // last resort: bare mp4 (video-only) + separate audio element. Reddit's
    // audio filename varies by transcoding era, so walk the candidates until
    // one loads.
    setMp4Src(s, v, rv.fallback_url);
    const cut = rv.fallback_url.indexOf('?');
    const query = cut >= 0 ? rv.fallback_url.slice(cut) : '';
    const base = rv.fallback_url.slice(0, rv.fallback_url.lastIndexOf('/'));
    const AUDIO_NAMES = ['CMAF_AUDIO_128.mp4', 'CMAF_AUDIO_64.mp4', 'DASH_AUDIO_128.mp4',
                         'DASH_AUDIO_64.mp4', 'DASH_audio.mp4', 'audio.mp4'];
    let ai = 0;
    const a = document.createElement('audio');
    a.src = base + '/' + AUDIO_NAMES[ai] + query;
    a.addEventListener('error', () => {
      if (++ai >= AUDIO_NAMES.length) { setBadge(s, '🔇 no sound in this video'); return; }
      a.src = base + '/' + AUDIO_NAMES[ai] + query;
      if (soundOn && !v.paused) { a.currentTime = v.currentTime; a.play().catch(() => {}); }
    });
    a.preload = 'none';
    a.loop = true;
    s._audio = a;
    media.appendChild(a);
    v.addEventListener('play', () => { if (soundOn) { a.currentTime = v.currentTime; a.play().catch(() => {}); } });
    v.addEventListener('pause', () => a.pause());
    v.addEventListener('seeked', () => { a.currentTime = v.currentTime; });
  }

  media.appendChild(v);
  s.prepend(media);
  s._video = v;

  s.appendChild(el('div', 'paused-badge', '▶'));

  // reddit's audio metadata lies both ways — verify against what's actually
  // being decoded and correct the badge accordingly
  v.addEventListener('playing', () => {
    s._played = true;   // watched videos become cache candidates on teardown
    clearTimeout(s._audChk);
    s._audChk = setTimeout(() => {
      if (v.paused || s._audio || v.webkitAudioDecodedByteCount === undefined) return;
      if (v.webkitAudioDecodedByteCount > 0) setBadge(s, null);          // it has sound
      else setBadge(s, '🔇 no sound in this video');
    }, 1800);
  });

  // buffering spinner — visible whenever the video is stalled waiting for data
  const buf = el('div', 'buffer-spinner');
  buf.appendChild(el('div', 'spinner'));
  s.appendChild(buf);
  const setBuffering = on => s.classList.toggle('buffering', on);
  v.addEventListener('waiting', () => setBuffering(true));
  v.addEventListener('stalled', () => setBuffering(true));
  v.addEventListener('playing', () => setBuffering(false));
  v.addEventListener('canplay', () => setBuffering(false));

  // sound toggle in the rail
  const rail = s.querySelector('.rail');
  const soundBtn = railButton(soundOn ? '🔊' : '🔇', 'sound', e => {
    e.stopPropagation();
    toggleSound();
  });
  rail.prepend(soundBtn);
  s._soundBtn = soundBtn;

  // tap video to pause/resume
  s.addEventListener('click', () => {
    if (v.paused) { attachHls(s); v.play().catch(() => {}); s.classList.remove('paused'); }
    else { v.pause(); s.classList.add('paused'); }
  });

  return s;
}

function toggleSound() {
  soundOn = !soundOn;
  blessNearbyVideos();   // we're inside a tap — grant sound rights to nearby videos
  document.querySelectorAll('.slide').forEach(s => {
    if (s._soundBtn) s._soundBtn.querySelector('.icon').textContent = soundOn ? '🔊' : '🔇';
    if (!s._video) return;
    if (s._audio) {           // mp4 + separate audio track
      if (soundOn && !s._video.paused) {
        s._audio.currentTime = s._video.currentTime;
        s._audio.play().catch(() => {});
      } else {
        s._audio.pause();
      }
    } else {                  // native HLS: just unmute
      s._video.muted = !soundOn;
    }
  });
}

function posterOf(post) {
  try { return post.preview.images[0].source.url; } catch { return null; }
}

/* ----- gallery → horizontal carousel ----- */
function gallerySlide(post) {
  const items = (post.gallery_data && post.gallery_data.items) || [];
  const urls = items
    .map(it => {
      const m = post.media_metadata[it.media_id];
      if (!m || m.status !== 'valid') return null;
      if (m.s && m.s.u) return m.s.u;
      if (m.s && m.s.gif) return m.s.gif;
      return null;
    })
    .filter(Boolean);
  if (urls.length === 0) return null;

  const s = baseSlide(post, `📷 1/${urls.length} — swipe →`);

  const media = el('div', 'media');
  const car = el('div', 'carousel');
  for (const u of urls) {
    const f = el('div', 'frame');
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = u;
    f.appendChild(img);
    car.appendChild(f);
  }
  media.appendChild(car);
  s.prepend(media);

  const bd = el('div', 'backdrop');
  bd.style.backgroundImage = `url("${urls[0]}")`;
  s.prepend(bd);

  const dots = el('div', 'dots');
  urls.forEach((_, i) => {
    const d = el('span');
    if (i === 0) d.className = 'on';
    dots.appendChild(d);
  });
  s.appendChild(dots);

  const badge = s.querySelector('.type-badge');
  car.addEventListener('scroll', () => {
    const i = Math.round(car.scrollLeft / car.clientWidth);
    dots.querySelectorAll('span').forEach((d, j) => d.classList.toggle('on', j === i));
    if (badge) badge.textContent = `📷 ${i + 1}/${urls.length}` + (i + 1 < urls.length ? ' — swipe →' : '');
    bd.style.backgroundImage = `url("${urls[Math.min(i, urls.length - 1)]}")`;
  }, { passive: true });

  return s;
}

/* ----- single image ----- */
function imageSlide(post) {
  let url = post.url;
  if (!/\.(jpe?g|png|gif|webp)$/i.test(url)) {
    url = posterOf(post);
    if (!url) return null;
  }
  const s = baseSlide(post, null);
  const media = el('div', 'media');
  const img = document.createElement('img');
  img.className = 'single';
  img.loading = 'lazy';
  img.src = url;
  media.appendChild(img);
  s.prepend(media);

  const bd = el('div', 'backdrop');
  bd.style.backgroundImage = `url("${url}")`;
  s.prepend(bd);
  return s;
}

/* =======================================================================
   AUTOPLAY + PRELOADING
   ======================================================================= */
// Bandwidth budget: the on-screen video gets deep buffering; nearby warm
// videos only prefetch enough for an instant start, so they don't starve the
// current video on slow connections (reddit.com feels faster because it only
// ever downloads ONE video).
const WARM_BUFFER_S = 6;
const FULL_BUFFER_S = 30;

function attachHls(s) {
  if (!s._hlsUrl || s._hls) return;
  const h = new Hls({
    capLevelToPlayerSize: true,   // don't pull 1080p for a phone-sized viewport
    startLevel: 0,                // first frame ASAP at low quality; ABR upgrades
    maxBufferLength: WARM_BUFFER_S, // off-screen slides only grab an instant-start
                                    // buffer; promoted to FULL_BUFFER_S when current
    backBufferLength: 10,         // small enough to not hog memory/bandwidth
    enableWorker: false,          // extension CSP blocks blob workers; hls.js's
                                  // silent fallback can kill the audio pipeline
    fLoader: makeCacheFragLoader(),  // disk-cache segments for instant rewatch
  });
  h.on(Hls.Events.ERROR, (_, d) => {
    s._hlsErr = d.type + '/' + d.details + (d.fatal ? ' FATAL' : '');
  });
  h.loadSource(s._hlsUrl);
  h.attachMedia(s._video);
  s._hls = h;
  s._video.muted = !soundOn;
}
function detachHls(s) {
  if (s._hls) { s._hls.destroy(); s._hls = null; }
}

// play/pause exactly the on-screen video
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    const s = e.target;
    if (!s._video) continue;
    if (e.isIntersecting && e.intersectionRatio >= 0.6) {
      s.classList.remove('paused');
      attachHls(s);
      // this video gets the bandwidth: deep buffer for it, starve the others
      // back down to their instant-start buffer
      for (const other of feed.children) {
        if (other._hls) other._hls.config.maxBufferLength = other === s ? FULL_BUFFER_S : WARM_BUFFER_S;
      }
      if (s._video.preload !== 'auto') s._video.preload = 'auto';
      if (!s._audio) s._video.muted = !soundOn;   // hls/native slides follow global sound
      const p = s._video.play();
      if (p) p.catch(() => {
        // WebKit (Safari/Orion) refuses unmuted programmatic play on elements
        // it hasn't user-activated — better muted than frozen
        if (!s._video.muted) {
          s._video.muted = true;
          s._video.play().catch(() => {});
        }
      });
    } else {
      s._video.pause();
      if (s._audio) s._audio.pause();
      s._video.currentTime = 0;
    }
  }
}, { threshold: [0, 0.6] });

// warm-up: when a slide is within ~2.5 screens of the viewport, start
// downloading its video so it plays instantly when swiped to; when it
// drifts far away again, tear the hls instance down to free memory.
const warmIO = new IntersectionObserver(entries => {
  for (const e of entries) {
    const s = e.target;
    const v = s._video;
    if (!v) continue;
    if (e.isIntersecting) {
      if (s._hlsUrl) {
        attachHls(s);
      } else {
        // slide coming back into range after a cold teardown — re-arm from cache
        if (s._mp4Url && !v.src) setMp4Src(s, v, s._mp4Url);
        if (v.preload === 'none') {
          // warm mp4s fetch headers/first bytes only — full download ('auto')
          // is reserved for the on-screen video so it never fights for bandwidth
          v.preload = 'metadata';
          // load() resets the element (and would cancel a play() in flight),
          // so only kick it for videos that haven't started fetching at all
          if (v.networkState === HTMLMediaElement.NETWORK_EMPTY) v.load();
        }
      }
    } else {
      detachHls(s);
      // free the blob (whole file in memory) and drop the src; re-armed above
      // if the slide ever scrolls back into range
      if (s._blobUrl) {
        URL.revokeObjectURL(s._blobUrl);
        s._blobUrl = null;
        v.removeAttribute('src');
        v.load();
      }
      // a watched mp4/redgifs video becomes a cache candidate now that it's
      // off-screen and can't compete with the playing video for bandwidth
      if (s._played && s._mp4Url) queueMp4Cache(s._mp4Url);
    }
  }
}, { rootMargin: '150% 0px 150% 0px', threshold: 0 });

// WebKit (iPhone Safari/Orion) only lets a media element produce sound if a
// play() was ever issued on it DURING a user gesture. A swipe is a gesture:
// on every touch/pointer release, synchronously play()+pause() the nearby
// not-yet-blessed videos so they may autoplay WITH sound when swiped to.
function blessNearbyVideos() {
  if (!soundOn) return;
  for (const s of feed.children) {
    const v = s._video;
    if (!v || s._blessed) continue;
    const r = s.getBoundingClientRect();
    if (r.top > innerHeight * 3 || r.bottom < -innerHeight) continue;
    s._blessed = true;
    if (!v.paused) continue;                     // already playing (the current one)
    attachHls(s);
    const p = v.play();                          // inside the gesture → grants sound
    v.pause();                                   // sync pause: no audible blip
    if (p) p.catch(() => { s._blessed = false; });
  }
}
feed.addEventListener('touchend', blessNearbyVideos, { passive: true });
feed.addEventListener('pointerup', blessNearbyVideos, { passive: true });

// recovery: if a browser silently stripped sound (blocked unmute), any click
// re-asserts it on whatever is currently playing
document.addEventListener('click', () => {
  if (!soundOn) return;
  document.querySelectorAll('.slide').forEach(s => {
    if (s._video && !s._video.paused && !s._audio) s._video.muted = false;
  });
});

new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (!n.classList) continue;
    io.observe(n);
    warmIO.observe(n);
  }
}).observe(feed, { childList: true });

feed.addEventListener('scroll', () => {
  const remaining = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
  if (remaining < window.innerHeight * LOAD_MORE_AT) loadMore();
}, { passive: true });

/* =======================================================================
   FLOATING REFRESH BUTTON
   ======================================================================= */
const refreshBtn = el('button', 'refresh-btn', '🔄');
refreshBtn.title = 'Refresh — reshuffle and pull different content';
refreshBtn.onclick = refresh;
document.body.appendChild(refreshBtn);

/* =======================================================================
   DEMO MODE (?demo in the URL) — sample media, no Reddit needed
   ======================================================================= */
const DEMO_VIDEOS = [
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4',
  'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_5MB.mp4',
  'https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_5MB.mp4',
];

let demoCount = 0;
function demoPage(cursor) {
  const children = [];
  for (let i = 0; i < 8; i++) {
    const n = demoCount++;
    const kind = n % 3; // rotate: video, gallery, image
    const base = {
      id: 'demo' + n, subreddit: 'demo' + (n % 3), author: 'sample',
      ups: 1200 + n * 137, num_comments: 45 + n * 7,
      created_utc: Date.now() / 1000 - n * 3600,
      permalink: '/r/demo/', stickied: false, over_18: false,
    };
    if (kind === 0) {
      children.push({ data: { ...base,
        title: `Demo video #${n} — swipe up for the next one`,
        is_video: true,
        media: { reddit_video: { fallback_url: DEMO_VIDEOS[n % DEMO_VIDEOS.length], has_audio: true } },
      }});
    } else if (kind === 1) {
      const ids = [0, 1, 2, 3].map(j => 'g' + n + j);
      const meta = {};
      for (const id of ids) {
        meta[id] = { status: 'valid', s: { u: `https://picsum.photos/seed/${id}/900/1600` } };
      }
      children.push({ data: { ...base,
        title: `Demo gallery #${n} — swipe RIGHT through the pictures`,
        is_gallery: true,
        gallery_data: { items: ids.map(id => ({ media_id: id })) },
        media_metadata: meta,
      }});
    } else {
      children.push({ data: { ...base,
        title: `Demo photo #${n}`,
        url: `https://picsum.photos/seed/img${n}/900/1600.jpg`,
        post_hint: 'image',
      }});
    }
  }
  return { data: { after: 'demo-cursor-' + demoCount, children } };
}

/* ---------- go ---------- */
rebuildTopbar();
enterMyFeed(true);
