/* ================= CONFIG — edit your subreddits here ================= */
const SUBREDDITS = [
  'oddlysatisfying',
  'aww',
  'nextfuckinglevel',
  'foodporn',
  'interestingasfuck',
  'EarthPorn',
];
const PAGE_SIZE = 40;          // posts fetched per request
const LOAD_MORE_AT = 4;        // fetch next page when this many slides from the end
// Where the proxy lives. '' = same origin (node server.js serves both the page
// and /api/feed). If you host this HTML elsewhere (e.g. GitHub Pages), set this
// to your deployed worker URL, e.g. 'https://reddit-swipe.<you>.workers.dev'
const API_BASE = '';
/* ====================================================================== */

const DEMO = new URLSearchParams(location.search).has('demo');
// Running as a Chrome extension page: host_permissions let us call reddit.com
// directly with the user's own logged-in session — no proxy needed.
const EXTENSION = location.protocol === 'chrome-extension:';

const feed = document.getElementById('feed');
const topbar = document.getElementById('topbar');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');

let currentSub = SUBREDDITS[0];
let after = null;            // reddit pagination cursor
let loading = false;
let exhausted = false;
let soundOn = false;         // global mute state (autoplay must start muted)
const seen = new Set();

/* tiny DOM helper — everything data-driven is set via textContent (no innerHTML) */
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- top bar chips ---------- */
for (const sub of SUBREDDITS) {
  const b = el('button', 'chip' + (sub === currentSub ? ' active' : ''), 'r/' + sub);
  b.onclick = () => switchSub(sub, b);
  topbar.appendChild(b);
}

function switchSub(sub, chipEl) {
  if (sub === currentSub) return;
  currentSub = sub;
  after = null;
  exhausted = false;
  seen.clear();
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chipEl.classList.add('active');
  feed.innerHTML = '';
  feed.scrollTop = 0;
  showStatus('Loading r/' + sub + '…');
  loadMore();
}

function showStatus(msg, spin = true) {
  statusEl.classList.remove('hidden');
  statusEl.querySelector('.spinner').style.display = spin ? '' : 'none';
  statusText.textContent = msg;
}
function hideStatus() { statusEl.classList.add('hidden'); }

/* ---------- fetching ---------- */
async function fetchPage(sub, cursor) {
  if (DEMO) return demoPage(cursor);
  if (EXTENSION) {
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=${PAGE_SIZE}&raw_json=1` +
                (cursor ? `&after=${encodeURIComponent(cursor)}` : '');
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error('Reddit responded HTTP ' + res.status +
        (res.status === 403 ? ' — open reddit.com in another tab (log in), then tap here to retry' : ''));
    }
    return res.json();
  }
  const url = `${API_BASE}/api/feed?sub=${encodeURIComponent(sub)}&limit=${PAGE_SIZE}` +
              (cursor ? `&after=${encodeURIComponent(cursor)}` : '');
  const res = await fetch(url);
  if (!res.ok) {
    let msg = 'proxy responded ' + res.status;
    try { const e = await res.json(); if (e.error) msg = e.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

/* ---------- demo mode (?demo in the URL) — sample media, no Reddit needed ---------- */
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
      id: 'demo' + n, subreddit: 'demo', author: 'sample',
      ups: 1200 + n * 137, num_comments: 45 + n * 7,
      permalink: '/r/demo/', stickied: false, over_18: false,
    };
    if (kind === 0) {
      children.push({ data: { ...base,
        title: `Demo video #${n} — swipe up for the next one`,
        is_video: true,
        media: { reddit_video: { fallback_url: DEMO_VIDEOS[n % DEMO_VIDEOS.length] } },
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

async function loadMore() {
  if (loading || exhausted) return;
  loading = true;
  try {
    const data = await fetchPage(currentSub, after);
    after = data.data.after;
    if (!after) exhausted = true;

    let added = 0;
    for (const child of data.data.children) {
      const post = child.data;
      if (post.stickied || post.over_18 || seen.has(post.id)) continue;
      const slide = buildSlide(post);
      if (slide) { feed.appendChild(slide); seen.add(post.id); added++; }
    }
    hideStatus();
    if (added === 0 && !exhausted) { loading = false; return loadMore(); }
    if (feed.children.length === 0) {
      showStatus('No playable video/image posts found in r/' + currentSub, false);
    }
  } catch (err) {
    console.error(err);
    if (feed.children.length === 0) {
      showStatus('Could not load r/' + currentSub + ' — ' + err.message +
                 '. Reddit sometimes rate-limits; wait a moment or pick another subreddit.', false);
    }
  } finally {
    loading = false;
  }
}

/* ---------- slide builders ---------- */
function buildSlide(post) {
  if (post.is_video && post.media && post.media.reddit_video) return videoSlide(post);
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
function videoSlide(post) {
  const rv = post.media.reddit_video;
  const s = baseSlide(post, null);

  const media = el('div', 'media');

  const v = document.createElement('video');
  v.playsInline = true;
  v.muted = true;
  v.loop = true;
  v.preload = 'metadata';
  v.poster = posterOf(post) || '';

  // Safari plays HLS natively (with sound); everywhere else use the mp4
  // fallback (video-only) plus a synced <audio> element for sound.
  // NB: don't trust canPlayType('application/vnd.apple.mpegurl') — Chrome
  // answers "maybe" but can't actually play HLS, leaving a frozen poster.
  const ua = navigator.userAgent;
  const isSafari = /iPhone|iPad|iPod/.test(ua) ||
                   (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|OPR\//.test(ua));
  if (isSafari && rv.hls_url) {
    v.src = rv.hls_url;
  } else if (rv.is_gif || rv.has_audio === false) {
    v.src = rv.fallback_url;   // no audio track exists — video alone
  } else {
    v.src = rv.fallback_url;
    // reddit serves video & audio separately; both old (DASH_*) and new (CMAF_*) naming
    const audioUrl = rv.fallback_url
      .replace(/CMAF_\d+/, 'CMAF_AUDIO_128')
      .replace(/DASH_\d+/, 'DASH_AUDIO_128');
    const a = document.createElement('audio');
    a.src = audioUrl;
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
    if (v.paused) { v.play().catch(() => {}); s.classList.remove('paused'); }
    else { v.pause(); s.classList.add('paused'); }
  });

  return s;
}

function toggleSound() {
  soundOn = !soundOn;
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

  // dots
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

/* ---------- autoplay via IntersectionObserver ---------- */
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    const s = e.target;
    if (!s._video) continue;
    if (e.isIntersecting && e.intersectionRatio >= 0.6) {
      s.classList.remove('paused');
      s._video.play().catch(() => {});
    } else {
      s._video.pause();
      if (s._audio) s._audio.pause();
      s._video.currentTime = 0;
    }
  }
}, { threshold: [0, 0.6] });

// observe every slide added to the feed + infinite scroll trigger
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) if (n.classList) io.observe(n);
}).observe(feed, { childList: true });

feed.addEventListener('scroll', () => {
  const remaining = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
  if (remaining < window.innerHeight * LOAD_MORE_AT) loadMore();
}, { passive: true });

// tap the error screen to retry
statusEl.addEventListener('click', () => {
  if (!loading && feed.children.length === 0) {
    showStatus('Loading r/' + currentSub + '…');
    loadMore();
  }
});

/* ---------- go ---------- */
showStatus('Loading r/' + currentSub + '…');
loadMore();
