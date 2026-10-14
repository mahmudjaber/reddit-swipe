const APP_VERSION = '1.23.0';   // shown in the ＋ editor — bump with manifest.json

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
// NB: don't trust canPlayType('application/vnd.apple.mpegurl') — Chrome
// answers "maybe" but can't actually play HLS, leaving a frozen poster.
const IS_SAFARI = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Edg\/|OPR\//.test(navigator.userAgent));

const feed = document.getElementById('feed');
const topbar = document.getElementById('topbar');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');

/* ---------- smart feed presets ---------- */
// Curated, video/image-heavy combos — tap one in the ＋ panel to add it as a
// feed. The NSFW list is imported from nsfwdog.com's most-subscribed
// communities (1M+ members each), favoring gif/video subs.
const PRESET_FEEDS = [
  { name: '😂 Funny', subs: ['funny', 'Unexpected', 'ContagiousLaughter', 'WatchPeopleDieInside', 'therewasanattempt', 'instant_regret', 'AnimalsBeingDerps', 'KidsAreFuckingStupid', 'holdmybeer', 'memes'] },
  { name: '🖤 Dark Comedy', subs: ['WatchPeopleDieInside', 'PeopleFuckingDying', 'whatcouldgowrong', 'AbruptChaos', 'instantkarma', 'Wellthatsucks', 'LeopardsAteMyFace', 'ImTheMainCharacter', 'dankmemes', 'HolUp', 'shitposting', 'distressingmemes', 'NoahGetTheBoat', 'MakeMeSuffer', 'blursedimages'] },
  { name: '🔬 Science', subs: ['Damnthatsinteresting', 'interestingasfuck', 'educationalgifs', 'chemicalreactiongifs', 'science', 'blackmagicfuckery'] },
  { name: '🌌 Space', subs: ['space', 'spaceporn', 'astrophotography', 'nasa', 'Astronomy', 'spacex'] },
  { name: '🐾 Animals', subs: ['aww', 'AnimalsBeingBros', 'AnimalsBeingDerps', 'AnimalsBeingJerks', 'rarepuppers', 'Zoomies', 'cats', 'dogswithjobs', 'NatureIsFuckingLit'] },
  { name: '🤯 Mind-blowing', subs: ['nextfuckinglevel', 'BeAmazed', 'toptalent', 'blackmagicfuckery', 'woahdude', 'Damnthatsinteresting', 'humansaremetal'] },
  { name: '✨ Satisfying', subs: ['oddlysatisfying', 'powerwashingporn', 'ASMR', 'ArtisanVideos', 'toptalent'] },
  { name: '🍔 Food', subs: ['FoodPorn', 'GifRecipes', 'food', 'Baking', 'Pizza', 'Cooking', 'DessertPorn', 'Breadit', 'BBQ', 'burgers', 'sushi', 'ramen', 'CulinaryPlating', 'StreetEatsWorld'] },
  { name: '💪 Gym & Healthy', subs: ['GYM', 'formcheck', 'powerlifting', 'crossfit', 'bodyweightfitness', 'homegym', 'MealPrepSunday', 'EatCheapAndHealthy', 'HealthyFood', '1200isplenty', 'Volumeeating', 'nutrition'] },
  { name: '🎮 Gaming', subs: ['gaming', 'GamePhysics', 'pcmasterrace', 'IndieGaming'] },
  { name: '⚽ Sports', subs: ['sports', 'nba', 'soccer', 'formula1', 'MMA', 'TheOcho'] },
  { name: '🛠 Engineering', subs: ['EngineeringPorn', 'specializedtools', 'mechanical_gifs', 'techsupportgore', 'gadgets'] },
  { name: '🌍 Nature & Travel', subs: ['EarthPorn', 'NatureIsFuckingLit', 'natureismetal', 'travel', 'hiking', 'CampingandHiking'] },
  { name: '🔞 NSFW', nsfw: true, subs: ['RealGirls', 'nsfw_gif', 'GirlsFinishingTheJob', 'TittyDrop', 'HoldTheMoan', 'porninfifteenseconds', 'LegalTeens', 'PetiteGoneWild', 'AsiansGoneWild', 'collegesluts', 'gonewild', 'BustyPetite', 'pawg', 'LipsThatGrip', 'adorableporn', 'nsfwhardcore', 'Blowjobs', 'milf', 'BiggerThanYouThought', 'SheFucksHim', '60fpsporn', 'porn_gifs', 'NSFWverifiedamateurs', 'homemadexxx'] },
  // second set — the rest of nsfwdog.com's 1M+ communities, no overlap with NSFW 1
  { name: '🔞 NSFW 2', nsfw: true, subs: ['nsfw', 'porn', 'cumsluts', 'anal', 'lesbians', 'BreedingMaterial', 'latinas', 'AsianHotties', 'boobs', 'ass', 'bigasses', 'pussy', 'curvy', 'GothSluts', 'DadWouldBeProud', 'needysluts', 'godpussy', 'nsfw_gifs', 'tiktokporn', 'TikTokNSFW', 'nudes', 'slut', 'Amateur', 'NSFW_Snapchat'] },
  // sets 3 and 4 come from nsfwdog.com directory pages 2 and 3 (all 1M+)
  { name: '🔞 NSFW 3', nsfw: true, subs: ['squirting', 'juicyasians', 'chubby', 'JizzedToThis', 'ThickThighs', 'OnOff', 'shelikesitrough', 'girlsmasturbating', 'deepthroat', 'cuckold', 'hotwife', 'RealHomePorn', 'BigBoobsGW', 'tiktokthots', 'naturaltitties', 'bigtiddygothgf', 'thickwhitegirls', 'asstastic', 'creampies', 'homemadensfw', 'stacked', 'SlutsOfSnapchat', 'FitNakedGirls', 'WatchItForThePlot', 'nsfwcosplay', 'threesome', 'PublicFlashing', 'GettingHerselfOff', 'paag'] },
  { name: '🔞 NSFW 4', nsfw: true, subs: ['shortporn', 'amateurcumsluts', 'egirls', 'naughtywives', 'altgonewild', 'AnalGW', 'PublicSexPorn', 'palegirls', 'booty', 'smallboobs', 'cumshots', 'gonewild30plus', 'redheads', 'hotmoms', 'girlswhoride', 'BootyQueens', 'WomenBendingOver', 'facefuck', 'boobbounce', 'brownhotties', 'BDSM', 'OBSF', 'tinytits', 'doggystyle_nsfw', 'ebony', 'orgasms', 'girlsinyogapants', 'justfriendshavingfun', 'slimthick', 'adorablenudes', 'AmateurPorn', 'collegeamateurs'] },
  // sets 5-7 come from nsfwdog.com directory pages 4-6 (all 1M+)
  { name: '🔞 NSFW 5', nsfw: true, subs: ['AsianNSFW', 'SpreadEm', 'couplesgonewild', 'maturemilf', 'fitgirls', 'tits', 'petite', 'PerfectBody', 'wetpussys', 'massivecock', 'rearpussy', 'gwpublic', 'bubblebutts', 'hugeboobs', 'BodyPerfection', 'IndiansGoneWild', 'wifesharing', 'ebonyhomemade', 'massivetitsnass', 'MasturbationGoneWild', 'PornStarHQ', 'twerking', 'nipples', 'BDSMGW', 'girlswithglasses', 'LongPorn', 'amateurmilfs', 'SwingersGW', 'CougarsForCubs', 'slutwife', 'gwcouples', 'boobies'] },
  { name: '🔞 NSFW 6', nsfw: true, subs: ['OutdoorRecreation', 'TightDresses', 'hotchickswithtattoos', 'sextrophies', 'FlashingGirls', 'buttplug', 'BBW', 'hungrybutts', 'damngoodinterracial', 'quiver', 'normalnudes', 'PublicNudity', 'BonerMaterial', 'shavedpussies', 'pronebone', 'cosplaybabes', '2busty2hide', 'mombod', 'couplesporn', 'ghostnipples', 'facedownassup', 'creampie', 'ediblebuttholes', 'BustyNaturals', 'funsized', 'punkgirls', 'vagina', 'stripgirls', 'monsterdicks', 'assholebehindthong'] },
  { name: '🔞 NSFW 7', nsfw: true, subs: ['lesbian_gifs', 'exhibitionistfun', 'bimbofetish', 'gangbang', 'UnderwearGW', 'KoreanNSFW', 'emogirlsfuck', 'boltedontits', 'homegrowntits', 'bustyasians', 'girlsshowering', 'LabiaGW', 'bigtitsinbikinis', 'centaurgirls', 'thighhighs', 'NSFW_Japan', 'hairypussy', 'indianbabes', 'RealPublicNudity', 'athleticbabes', 'pantiestotheside', 'AsianPorn', 'girlskissing', 'FlashingAndFlaunting', 'darkangels', 'cuckquean', 'StraightGirlsPlaying', '40plusGoneWild', 'extramile', 'braless', 'bigareolas', 'camgirls', 'ridingxxx'] },
];
// by name too: preset feeds added before the nsfw flag was stored lack it
const NSFW_PRESET_NAMES = new Set(PRESET_FEEDS.filter(p => p.nsfw).map(p => p.name));
const isNsfwFeed = f => !!(f && (f.nsfw || NSFW_PRESET_NAMES.has(f.name)));

/* ---------- persistent state ---------- */
// feeds: [{ name, subs: [...] }], one of them active. Migrates the legacy
// single rs.subs list into feeds[0].
let feeds;
try { feeds = JSON.parse(localStorage.getItem('rs.feeds')); } catch {}
if (!Array.isArray(feeds) || feeds.length === 0 || !feeds.every(f => f && f.name && Array.isArray(f.subs))) {
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem('rs.subs')); } catch {}
  feeds = [{ name: '⭐ My Feed', subs: Array.isArray(legacy) && legacy.length ? legacy : DEFAULT_SUBREDDITS.slice() }];
}
let activeFeed = 0;
try { activeFeed = parseInt(localStorage.getItem('rs.activeFeed'), 10) || 0; } catch {}
if (activeFeed < 0 || activeFeed >= feeds.length) activeFeed = 0;
let subs = feeds[activeFeed].subs;   // alias the engine reads everywhere
function saveSubs() {
  feeds[activeFeed].subs = subs;
  try {
    localStorage.setItem('rs.feeds', JSON.stringify(feeds));
    localStorage.setItem('rs.activeFeed', String(activeFeed));
  } catch (e) { console.warn('saveSubs failed', e); }
}
function switchFeed(i) {
  activeFeed = Math.max(0, Math.min(i, feeds.length - 1));
  subs = feeds[activeFeed].subs;
  saveSubs();
  enterMyFeed(true);   // rebuilds the top bar once mode is 'my'
}

let showNsfw = false;
try { showNsfw = localStorage.getItem('rs.nsfw') === '1'; } catch {}
function persistNsfw() { try { localStorage.setItem('rs.nsfw', showNsfw ? '1' : '0'); } catch {} }

// lowercase names, hidden from the mixed feed only — single-sub mode still shows them
let hiddenSubs = new Set();
try { hiddenSubs = new Set((JSON.parse(localStorage.getItem('rs.hidden')) || []).filter(s => typeof s === 'string')); } catch {}
const saveHidden = () => { try { localStorage.setItem('rs.hidden', JSON.stringify([...hiddenSubs])); } catch {} };
const isHidden = s => hiddenSubs.has((s || '').toLowerCase());

/* ---------- saved posts (surface in 👤 Profile) ---------- */
let savedPosts = [];
try { savedPosts = JSON.parse(localStorage.getItem('rs.saved')); } catch {}
// re-slimming shrinks saves made before slimPost trimmed galleries
savedPosts = Array.isArray(savedPosts) ? savedPosts.filter(p => p && p.id).map(p => { try { return slimPost(p); } catch { return null; } }).filter(Boolean) : [];
const SAVED_MAX = 300;   // localStorage budget — oldest save drops past this
// runtime fields are rebuilt on load and must never reach storage
function persistSaved() {
  try {
    localStorage.setItem('rs.saved', JSON.stringify(savedPosts, (k, v) => (k === '_rv' || k === '_redgifs') ? undefined : v));
    return true;
  } catch {
    alert('Saved list is full — remove some saved posts in 👤');
    return false;
  }
}
function isSaved(id) { return savedPosts.some(p => p.id === id); }
// keep only the fields the slide builders actually read — full reddit post
// objects are 10-30KB each and would blow the localStorage quota fast
function slimPost(post) {
  const p = {};
  for (const k of ['id', 'title', 'subreddit', 'author', 'ups', 'num_comments', 'permalink',
                   'created_utc', 'over_18', 'is_video', 'url', 'is_gallery',
                   'gallery_data', 'domain', 'post_hint', 'savedAt']) {
    if (post[k] !== undefined) p[k] = post[k];
  }
  // galleries: the source plus one small rendition for the backdrop
  if (post.media_metadata) {
    p.media_metadata = {};
    for (const [k, m] of Object.entries(post.media_metadata)) {
      if (!m) continue;
      p.media_metadata[k] = {
        status: m.status, e: m.e, m: m.m,
        s: m.s && { u: m.s.u, gif: m.s.gif, x: m.s.x, y: m.s.y },
        p: m.p && m.p.length ? [m.p[0]] : undefined,
      };
    }
  }
  if (post.media && post.media.reddit_video) p.media = { reddit_video: post.media.reddit_video };
  const xp = post.crosspost_parent_list && post.crosspost_parent_list[0];
  if (xp && xp.media) p.crosspost_parent_list = [{ media: xp.media }];
  if (post.preview) {
    p.preview = {};
    if (post.preview.reddit_video_preview) p.preview.reddit_video_preview = post.preview.reddit_video_preview;
    const img = post.preview.images && post.preview.images[0];
    if (img) p.preview.images = [{ source: img.source, resolutions: (img.resolutions || []).slice(0, 4) }];
  }
  return p;
}
function toggleSave(post, btn) {
  const i = savedPosts.findIndex(p => p.id === post.id);
  const sl = [...feed.children].find(x => x._post && x._post.id === post.id);
  const before = savedPosts.slice();
  if (i >= 0) savedPosts.splice(i, 1);
  else {
    const sp = slimPost(post);
    sp.savedAt = Date.now();
    savedPosts.unshift(sp);
    if (savedPosts.length > SAVED_MAX) savedPosts.pop();
  }
  const ok = persistSaved();
  if (!ok) savedPosts = before;
  else if (i >= 0) {
    dropMp4Cache(post.id);   // only saved posts get cached
  } else if (sl && sl._mp4Url && sl !== currentSlide) {
    queueMp4Cache(sl._mp4Url, post.id);   // the on-screen slide is queued by warmIO once it leaves the screen
  }
  // a save retracted on the same slide was never a signal, so toggling can't add up
  if (ok && i < 0) { if (sl && sl._credit) sl._credit('save', 3); else taste.event(post, 3); }
  else if (ok && sl && sl._credited && sl._credited.delete('save')) taste.undo(post, 3);
  else if (ok) taste.event(post, -1.5);
  if (btn) paintSave(btn, post.id);
}
function paintSave(btn, id) {
  const on = isSaved(id);
  btn.querySelector('.icon').textContent = on ? '💛' : '🔖';
  btn.lastChild.textContent = on ? 'saved' : 'save';
  btn.setAttribute('aria-label', on ? 'saved' : 'save');
}

/* ---------- taste: local, decaying per-sub and per-format affinity ---------- */
const TASTE_KEY = 'rs.taste', HALF_LIFE_D = 21, TASTE_MAX = 400;
let T; try { T = JSON.parse(localStorage.getItem(TASTE_KEY)); } catch {}
if (!T || T.v !== 1 || !T.subs || typeof T.subs !== 'object' || !T.fmt || typeof T.fmt !== 'object') T = { v: 1, off: false, seeded: false, subs: {}, fmt: {} };
for (const m of [T.subs, T.fmt]) for (const k of Object.keys(m)) {
  const e = m[k];
  if (!Array.isArray(e) || e.length !== 4 || !e.every(Number.isFinite)) delete m[k];
}
const today = () => Math.floor(Date.now() / 864e5);
// sub names like 'constructor' must not read Object.prototype members
const own = (m, k) => Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null;
// entries are [pos, neg, events, day]
function decayed(e) { const f = 0.5 ** ((today() - e[3]) / HALF_LIFE_D); return [e[0] * f, e[1] * f, e[2], today()]; }
function bump(map, key, sig) {
  if (!key || !sig || key === '__proto__') return;
  const e = decayed(own(map, key) || [0, 0, 0, today()]);
  if (sig > 0) e[0] += sig; else e[1] -= sig;
  e[2]++;
  map[key] = e;
}
// takes back a positive bump exactly
function unbump(map, key, sig) {
  const e0 = key && own(map, key);
  if (!e0) return;
  const e = decayed(e0);
  e[0] = Math.max(0, e[0] - sig);
  e[2] = Math.max(0, e[2] - 1);
  map[key] = e;
}
// Laplace-smoothed like ratio scaled by confidence, in (-1, 1)
function aff(map, key) {
  const e = own(map, key);
  if (!e) return 0;
  const [p, n] = decayed(e);
  return (2 * ((p + 2) / (p + n + 4)) - 1) * (1 - Math.exp(-(p + n) / 6));
}
let tasteT = 0;
function flushTaste() {
  clearTimeout(tasteT);
  tasteT = 0;
  const ks = Object.keys(T.subs);
  if (ks.length > TASTE_MAX) {
    // rank by decayed mass, computed once so the comparator stays consistent
    const m = {};
    for (const k of ks) { const [p, n] = decayed(T.subs[k]); m[k] = p + n; }
    ks.sort((a, b) => m[b] - m[a]).slice(TASTE_MAX).forEach(k => delete T.subs[k]);
  }
  try { localStorage.setItem(TASTE_KEY, JSON.stringify(T)); } catch {}
}
addEventListener('pagehide', flushTaste);
document.addEventListener('visibilitychange', () => { if (document.hidden && tasteT) flushTaste(); });
const postKind = p => p._rv ? (p._rv.is_gif || p._rv.has_audio === false ? 'gif' : 'video') : (p.is_gallery ? 'gallery' : 'image');
// saved mode replays past choices, so it never teaches
const taste = {
  event(post, sig) {
    if (T.off || !post || mode === 'saved') return;
    bump(T.subs, (post.subreddit || '').toLowerCase(), sig);
    bump(T.fmt, postKind(post), sig * 0.5);
    if (!tasteT) tasteT = setTimeout(flushTaste, 3000);
  },
  undo(post, sig) {
    if (T.off || !post || mode === 'saved') return;
    unbump(T.subs, (post.subreddit || '').toLowerCase(), sig);
    unbump(T.fmt, postKind(post), sig * 0.5);
    if (!tasteT) tasteT = setTimeout(flushTaste, 3000);
  },
  sub: s => T.off ? 0 : aff(T.subs, (s || '').toLowerCase()),
  fmt: k => T.off ? 0 : aff(T.fmt, k),
  reset() { T = { v: 1, off: T.off, seeded: true, subs: {}, fmt: {} }; flushTaste(); },
};
// cold start: saves are the strongest signal there is
if (!T.seeded) {
  for (const p of savedPosts) {
    const rv = videoInfoOf(p) || (/redgifs\.com\//i.test(p.url || '') ? {} : null);
    bump(T.subs, (p.subreddit || '').toLowerCase(), 2);
    bump(T.fmt, postKind({ _rv: rv, is_gallery: p.is_gallery }), 1);
  }
  T.seeded = true;
  flushTaste();
}

/* ---------- session state ---------- */
let mode = 'my';             // 'my' = mixed algorithmic feed, 'sub' = single subreddit, 'saved'
let currentSub = null;       // when mode === 'sub'
let stash = null;            // the 'my' feed parked while saved or single-sub mode is open
let loading = false;
// bumped on every feed rebuild — in-flight loads from an older build drop their results
let gen = 0;
function newBuild() { gen++; loading = false; my.fetchP = null; bufWaiters.splice(0).forEach(r => r()); setBusy(false); abortStaleFetches(); }
// a replaced build never reaches its own finally, so newBuild clears the spin too
function setBusy(on) { document.getElementById('refresh-chip')?.classList.toggle('busy', on); }
let soundOn = false;        // global mute state (autoplay must start muted)
const seen = new Set();      // per-feed-build fetch dedup

// posts actually watched, across launches — newest last
const SEEN_MAX = 1500;
let seenRing = [];
try { seenRing = JSON.parse(localStorage.getItem('rs.seen')) || []; } catch {}
if (!Array.isArray(seenRing)) seenRing = [];
const pastSeen = new Set(seenRing);   // watched in earlier sessions (launch snapshot)
let seenT = 0;
function flushSeen() {
  clearTimeout(seenT);
  seenT = 0;
  try { localStorage.setItem('rs.seen', JSON.stringify(seenRing)); } catch {}
}
function rememberSeen(id) {
  const k = seenRing.indexOf(id);
  if (k >= 0) seenRing.splice(k, 1);
  seenRing.push(id);
  if (seenRing.length > SEEN_MAX) seenRing.splice(0, seenRing.length - SEEN_MAX);
  markShown(id);   // watched in any mode: no build this session repeats it
  if (!seenT) seenT = setTimeout(flushSeen, 2000);
}
addEventListener('pagehide', () => { if (seenT) flushSeen(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && seenT) flushSeen(); });

const shownIds = new Set();  // shown this session plus watched before — refresh won't repeat these
seenRing.forEach(id => shownIds.add(id));
const sessionShown = new Set();  // shown or watched this session
function markShown(id) { shownIds.add(id); sessionShown.add(id); }

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
  fetchP: null,              // in-flight refill, shared by every caller
  slot: 0,                  // position in the video/still rhythm, survives batches
  videoYield: {},            // sub -> videos found so far (guides deep refills)
  sortCursor: (Math.random() * 4) | 0,  // advanced on refresh → different sorts
  personaIdx: (Math.random() * 5) | 0,  // advanced on refresh → different ranking feel
  persona: null,
  spotlight: null,           // subs boosted this refresh so different subs lead
  recycled: false,           // whether shownIds was already recycled this build
  stale: [],                 // usable posts skipped only for an earlier session's history
  deepFills: 0,              // extra refills this build spent paging past watched posts
  // the list this build fetches; the editor re-points `subs` while browsing feeds
  subs,
  order: null,               // this build's seeded sub order (fetch priority)
  announced: 0,              // gen whose persona was already toasted
};

// first render waits only until the buffer can make a varied batch, not
// for the whole fetch round — the slowest sub no longer sets the pace
let bufWaiters = [];
function notifyBuffer(force) {
  const vids = my.buffer.reduce((c, p) => c + (p._rv ? 1 : 0), 0);
  const subsIn = new Set(my.buffer.map(p => p.subreddit)).size;
  const live = my.subs.filter(s => !isHidden(s)).length;
  if (force || (my.buffer.length >= BATCH_SIZE && vids >= 4 && subsIn >= Math.min(3, live))) bufWaiters.splice(0).forEach(r => r());
}
const bufferReady = () => new Promise(r => { bufWaiters.push(r); notifyBuffer(); });

const SORTS = [['hot', null], ['top', 'day'], ['rising', null], ['top', 'week']];

// Every refresh rotates to the next persona: a different ranking character
// (metric weights), different reddit sorts to pull from, and a different
// video:still rhythm — so refreshes FEEL different, not just reshuffled.
// w.taste scales the learned affinity; Lucky dip keeps it low to stay the discovery persona
const PERSONAS = [
  { name: '🔥 Trending now',     w: { pop: 0.5, buzz: 0.5, vel: 2.2, fresh: 2.4, jit: 0.8, taste: 1.0 }, vps: 3, sorts: [['hot', null], ['rising', null], ['top', 'day']] },
  { name: '🏆 All-time bangers', w: { pop: 1.6, buzz: 0.6, vel: 0.3, fresh: 0.3, jit: 0.8, taste: 1.2 }, vps: 3, sorts: [['top', 'week'], ['top', 'month'], ['top', 'all']] },
  { name: '🌱 Fresh finds',      w: { pop: 0.3, buzz: 0.3, vel: 1.2, fresh: 3.0, jit: 1.0, taste: 0.8 }, vps: 2, sorts: [['rising', null], ['new', null], ['hot', null]] },
  { name: '🎲 Lucky dip',        w: { pop: 0.6, buzz: 0.3, vel: 0.6, fresh: 0.8, jit: 3.0, taste: 0.4 }, vps: 4, sorts: [['top', 'month'], ['hot', null], ['rising', null], ['top', 'week']] },
  { name: '💛 For you',          w: { pop: 0.8, buzz: 0.4, vel: 1.2, fresh: 2.0, jit: 1.2, taste: 1.5 }, vps: 3, sorts: SORTS },
];

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

// the clock starts when the request leaves the queue, not when it joins it,
// and keeps running through the body read; paused while a 429 retry waits
function withTimeout(ms) {
  const ctl = new AbortController();
  let t = 0;
  return {
    signal: ctl.signal,
    start: () => { clearTimeout(t); t = setTimeout(() => ctl.abort(), ms); },
    done: () => clearTimeout(t),
    abort: () => ctl.abort(),
  };
}

// stale(): true once the caller's feed build is gone — the job is dropped
// unsent so a switched or refreshed feed doesn't queue behind the old one
function politeFetch(url, opts, timer, stale) {
  return new Promise((resolve, reject) => {
    fetchQueue.push({ url, opts, timer, stale, resolve, reject });
    pumpQueue();
  });
}
// requests already sent: a replaced build aborts its own so they free their slots now
const inflight = new Set();
function abortStaleFetches() {
  for (const j of inflight) if (j.stale && j.stale() && j.timer) j.timer.abort();
}
let queuePausedUntil = 0;
async function pumpQueue() {
  const now = Date.now();
  if (now < queuePausedUntil) { setTimeout(pumpQueue, queuePausedUntil - now); return; }
  if (activeFetches >= MAX_CONCURRENT || fetchQueue.length === 0) return;
  const job = fetchQueue.shift();
  if ((job.opts && job.opts.signal && job.opts.signal.aborted) || (job.stale && job.stale())) {
    job.reject(new DOMException('aborted', 'AbortError'));
    setTimeout(pumpQueue, 0);
    return;
  }
  activeFetches++;
  inflight.add(job);
  try {
    if (job.timer) job.timer.start();
    const res = await fetch(job.url, job.opts);
    if (res.status === 429 && !job.retried) {
      const wait = Math.min(parseInt(res.headers.get('retry-after'), 10) || 15, 60);
      if (job.timer) job.timer.done();
      job.retried = true;
      queuePausedUntil = Date.now() + wait * 1000;   // global pause: the limit is per client
      if (feed.children.length === 0 && !(job.stale && job.stale())) {
        showStatus(`Reddit rate limit — retrying in ${wait}s…`);
      }
      fetchQueue.unshift(job);
    } else job.resolve(res);
  } catch (e) {
    job.reject(e);
  } finally {
    inflight.delete(job);
    activeFetches--;
    setTimeout(pumpQueue, SPACING_MS);
  }
}

const pageCache = new Map();   // url -> { json, at }; first pages only, oldest first
const PAGE_CACHE_MS = 5 * 60_000;
const PAGE_CACHE_MAX = 60;
function pageCachePut(url, json) {
  const now = Date.now();
  for (const [k, v] of pageCache) if (now - v.at >= PAGE_CACHE_MS) pageCache.delete(k);
  pageCache.delete(url);
  pageCache.set(url, { json, at: now });
  while (pageCache.size > PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
}

async function fetchSubPage(sub, sort, t, cursor, stale) {
  if (DEMO) return demoPage(cursor);
  const qs = `limit=${PAGE_SIZE}&raw_json=1` +
             (cursor ? `&after=${encodeURIComponent(cursor)}` : '') +
             (t ? `&t=${t}` : '');
  const url = EXTENSION
    ? `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}.json?${qs}`
    : `${API_BASE}/api/feed?sub=${encodeURIComponent(sub)}&sort=${sort}&${qs}`;

  const cached = !cursor && pageCache.get(url);
  if (cached) {
    if (Date.now() - cached.at < PAGE_CACHE_MS) return cached.json;
    pageCache.delete(url);
  }

  for (let attempt = 0; ; attempt++) {
    const to = withTimeout(15000);
    try {
      const res = await politeFetch(url, { ...(EXTENSION ? { credentials: 'include' } : {}), signal: to.signal }, to, stale);
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
      if (!cursor) pageCachePut(url, json);
      return json;
    } catch (e) {
      if (stale && stale()) throw e;   // aborted by newBuild, not a timeout: never re-queue
      if (to.signal.aborted && attempt === 0) continue;
      // must not match the 403|404|451 blacklist test in ensureBuffer
      if (to.signal.aborted) throw new Error('network timeout — tap to retry');
      throw e;
    } finally {
      to.done();
    }
  }
}

/* =======================================================================
   VIDEO CACHE — Cache Storage API, LRU-evicted by video id
   -----------------------------------------------------------------------
   HLS: every segment the player downloads is written through, so rewatches
   and revisits are served from disk at zero extra bandwidth. mp4/redgifs:
   only SAVED posts are cached, in the background once the video is off
   screen, and the download is aborted on every swipe so it never competes
   with the video being watched. v.redd.it URLs carry expiring auth tokens
   in the query string, so cache keys are the bare path.
   ======================================================================= */
const VIDCACHE = 'rs-video-cache-v1';
const VID_CACHE_CAP = 512 * 1024 * 1024;   // evict oldest videos past this
const MP4_CACHE_MAX = 30 * 1024 * 1024;    // don't cache huge single files
const CACHE_OK = typeof caches !== 'undefined';

let vidIndex = {};                          // videoId -> { at, bytes }
try { vidIndex = JSON.parse(localStorage.getItem('rs.vidcache')) || {}; } catch {}
const saveVidIndex = () => { try { localStorage.setItem('rs.vidcache', JSON.stringify(vidIndex)); } catch {} };
// LRU touches happen per fragment — batch them; size changes still save at once
let vidSaveT = 0;
const saveVidIndexSoon = () => { if (!vidSaveT) vidSaveT = setTimeout(() => { vidSaveT = 0; saveVidIndex(); }, 2000); };
const flushVidIndex = () => { if (vidSaveT) { clearTimeout(vidSaveT); vidSaveT = 0; } saveVidIndex(); };
addEventListener('pagehide', flushVidIndex);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushVidIndex(); });

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
  addBytes > 0 ? saveVidIndex() : saveVidIndexSoon();
  if (addBytes > 0) evictVidCache();
}
// one run at a time: overlapping runs each subtract from a stale total
let evicting = false;
async function evictVidCache() {
  if (evicting || cacheTotalBytes() <= VID_CACHE_CAP) return;
  evicting = true;
  try {
    const cache = await caches.open(VIDCACHE);
    const byId = new Map();
    for (const req of await cache.keys()) {
      const id = vidIdOf(req.url);
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(req);
    }
    let total = cacheTotalBytes();   // writes may have landed during the awaits
    const oldest = Object.keys(vidIndex).sort((a, b) => vidIndex[a].at - vidIndex[b].at);
    for (const id of oldest) {
      if (total <= VID_CACHE_CAP * 0.8) break;   // free a chunk, not one file at a time
      for (const req of byId.get(id) || []) cache.delete(req);
      total -= vidIndex[id].bytes || 0;
      delete vidIndex[id];
    }
    saveVidIndex();
  } catch {} finally {
    evicting = false;
  }
}

// hls.js fragment loader with cache-first reads and write-through on miss
function makeCacheFragLoader() {
  return class extends Hls.DefaultConfig.loader {
    // an abort can land while the cache lookup is still pending
    abort() { this._cacheCancelled = true; super.abort(); }
    destroy() { this._cacheCancelled = true; super.destroy(); }
    load(context, config, callbacks) {
      if (!CACHE_OK || context.responseType !== 'arraybuffer') {
        return super.load(context, config, callbacks);
      }
      this._cacheCancelled = false;
      // CMAF fragments are byte ranges within one file — the range MUST be
      // part of the key or fragments would overwrite each other
      const range = context.rangeStart != null ? `?r=${context.rangeStart}-${context.rangeEnd ?? ''}` : '';
      const key = cacheKeyOf(context.url) + range;
      const id = vidIdOf(context.url);
      let netStarted = false;
      const net = () => {
        if (this._cacheCancelled || netStarted) return;
        netStarted = true;
        super.load(context, config, { ...callbacks, onSuccess: (response, stats, ctx, xhr) => {
          if (response.data && response.data.byteLength) {
            const copy = response.data.slice(0);
            caches.open(VIDCACHE)
              .then(c => c.put(key, new Response(copy)))
              .then(() => bumpVidIndex(id, copy.byteLength))
              .catch(() => {});
          }
          callbacks.onSuccess(response, stats, ctx, xhr);
        } });
      };
      if (!vidIndex[id]) return net();   // never cached: skip the lookup
      caches.open(VIDCACHE).then(c => c.match(key)).then(hit => hit ? hit.arrayBuffer() : null).then(data => {
        if (this._cacheCancelled) return;
        if (!data) return net();
        bumpVidIndex(id, 0);   // touch LRU, no size change
        // report a transfer at the learned network speed — instant hits would
        // read as ~80 Mbps and push ABR to levels the network can't sustain
        const now = performance.now(), st = this.stats, ttfb = 80;
        const xfer = Math.max(50, data.byteLength * 8 / netBwBps * 1000);
        st.loading.start = now - ttfb - xfer;
        st.loading.first = st.loading.start + ttfb;
        st.loading.end = now;
        st.loaded = st.total = data.byteLength;
        st._fromCache = true;
        queueMicrotask(() => { if (!this._cacheCancelled) callbacks.onSuccess({ url: context.url, data }, st, context, null); });
      }).catch(net);
    }
  };
}

// mp4 paths: play from cache when we have it (via blob URL), else network
async function setMp4Src(s, v, url) {
  s._mp4Url = url;
  const gen = s._gen = (s._gen || 0) + 1;   // a newer call (or a release) wins
  const stale = () => s._dead || s._gen !== gen;
  if (CACHE_OK) {
    try {
      const cache = await caches.open(VIDCACHE);
      if (stale()) return;
      const hit = await cache.match(cacheKeyOf(url));
      if (stale()) return;
      if (hit) {
        bumpVidIndex(vidIdOf(url), 0);
        const blob = await hit.blob();
        if (stale()) return;
        if (s._blobUrl) URL.revokeObjectURL(s._blobUrl);
        s._blobUrl = URL.createObjectURL(blob);
        v.src = s._blobUrl;
        return;
      }
    } catch {}
  }
  if (stale()) return;
  v.src = url;
}

// background write-through queue — one at a time, saved posts only;
// onBecameCurrent aborts the download in flight and it retries later
const mp4CacheQueue = [];   // {url, id} — id is the saved post's id
let mp4Caching = false;
let mp4Ctl = null;
let mp4CachingId = null;
function queueMp4Cache(url, id) {
  if (!CACHE_OK || mp4CacheQueue.some(q => q.url === url)) return;
  mp4CacheQueue.push({ url, id });
  if (mp4CacheQueue.length > 5) mp4CacheQueue.shift();
  pumpMp4Cache();
}
// a post was unsaved: forget its queued download and cancel it if in flight
function dropMp4Cache(id) {
  for (let i = mp4CacheQueue.length - 1; i >= 0; i--) if (mp4CacheQueue[i].id === id) mp4CacheQueue.splice(i, 1);
  if (mp4CachingId === id && mp4Ctl) mp4Ctl.abort();
}
async function pumpMp4Cache() {
  if (mp4Caching || mp4CacheQueue.length === 0) return;
  mp4Caching = true;
  const { url, id } = mp4CacheQueue.shift();
  let timedOut = false, t = 0, ctl = null;
  try {
    const cache = await caches.open(VIDCACHE);
    if (isSaved(id) && !await cache.match(cacheKeyOf(url))) {
      mp4CachingId = id;
      ctl = mp4Ctl = new AbortController();
      t = setTimeout(() => { timedOut = true; ctl.abort(); }, 30000);
      const res = await fetch(url, { signal: ctl.signal, priority: 'low' });
      const len = +res.headers.get('content-length') || 0;
      if (res.ok && (!len || len < MP4_CACHE_MAX)) {
        // read in chunks so a body with no length stops at the cap
        const r = res.body.getReader();
        const parts = [];
        let n = 0;
        for (;;) {
          const { done, value } = await r.read();
          if (done) break;
          n += value.byteLength;
          if (n >= MP4_CACHE_MAX) break;
          parts.push(value);
        }
        clearTimeout(t);
        if (n < MP4_CACHE_MAX && isSaved(id)) {
          await cache.put(cacheKeyOf(url), new Response(new Blob(parts)));
          bumpVidIndex(vidIdOf(url), n);
        }
      }
    }
  } catch (e) {
    // aborted by a swipe: try again later; a timeout means the link is too slow
    if (e && e.name === 'AbortError' && !timedOut && isSaved(id) && !mp4CacheQueue.some(q => q.url === url)) mp4CacheQueue.unshift({ url, id });
  } finally {
    clearTimeout(t);
    // an unread (not ok / oversized / capped) body would keep downloading
    if (ctl) ctl.abort();
  }
  mp4Ctl = null;
  mp4CachingId = null;
  mp4Caching = false;
  setTimeout(pumpMp4Cache, 8000);
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

// stale: collects the posts skipped only because an earlier session watched them
function usablePosts(data, skipShown, stale) {
  const out = [];
  for (const child of data.data.children) {
    const post = child.data;
    if (post.stickied || seen.has(post.id)) continue;
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
    if (skipShown && shownIds.has(post.id)) {
      if (stale && pastSeen.has(post.id) && !sessionShown.has(post.id)) stale.push(post);
      continue;
    }
    out.push(post);
  }
  return out;
}

/* ---------- redgifs original resolution (extension only — needs host perm) ---------- */
// direct fetches, not politeFetch: redgifs' limits are its own and must not
// queue behind (or pause) reddit listings
let rgTokenP = null;                 // one shared token request
const rgCache = new Map();           // id -> Promise<url|null>; failures are dropped so they can retry
async function rgFetch(url, opts = {}) {
  const to = withTimeout(10000);
  to.start();
  try {
    const r = await fetch(url, { ...opts, signal: to.signal });
    const j = r.ok ? await r.json() : null;
    return { status: r.status, ok: r.ok, j };
  } finally {
    to.done();
  }
}
function getRgToken() {
  return rgTokenP ||= rgFetch('https://api.redgifs.com/v2/auth/temporary').then(r => {
    if (!r.ok || !r.j || !r.j.token) throw new Error('rg auth ' + r.status);
    return r.j.token;
  }).catch(e => { rgTokenP = null; throw e; });
}
function resolveRedgifs(id) {
  if (rgCache.has(id)) return rgCache.get(id);
  const p = (async () => {
    for (let a = 0; a < 2; a++) {
      const tp = getRgToken();
      const tok = await tp;
      const r = await rgFetch('https://api.redgifs.com/v2/gifs/' + encodeURIComponent(id), {
        headers: { Authorization: 'Bearer ' + tok },
      });
      if (r.status === 401) { if (rgTokenP === tp) rgTokenP = null; continue; }   // expired — retry once
      if (!r.ok) return null;
      // SD first: on a swipe feed, time-to-first-frame beats resolution — HD
      // files run 10-30MB and crawl on weak connections
      return (r.j && r.j.gif && r.j.gif.urls && (r.j.gif.urls.sd || r.j.gif.urls.hd)) || null;
    }
    return null;
  })().catch(() => null);
  rgCache.set(id, p);
  p.then(u => { if (u === null) rgCache.delete(id); });
  return p;
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
  const w = (my.persona && my.persona.w) || { pop: 0.8, buzz: 0.4, vel: 1.2, fresh: 2.0, jit: 1.2 };
  const spotlight = my.spotlight && p.subreddit && my.spotlight.has(p.subreddit.toLowerCase()) ? 0.8 : 0;
  // quality gate: a liked sub's 3-upvote post must not beat a 50k one
  const gate = Math.min(1, popularity / 2);
  const tasteTerm = gate * Math.max(-1.5, Math.min(1.5, (w.taste ?? 1) * taste.sub(p.subreddit) + 0.4 * taste.fmt(postKind(p))));
  return popularity * w.pop + buzz * w.buzz + velocity * w.vel + freshness * w.fresh +
         lengthFit + spotlight + jitter * w.jit + tasteTerm;
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

  const vps = (my.persona && my.persona.vps) || VIDEOS_PER_STILL;
  while (out.length < n && (videos.length || stills.length)) {
    const wantVideo = my.slot % (vps + 1) < vps;
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

// every refresh advances persona + cursor: new ranking character, new sorts
// per sub, seeded-shuffled sub order, and a fresh spotlight set so different
// subreddits lead the mix each time
function rotatedSortPlan() {
  my.personaIdx = (my.personaIdx + 1) % PERSONAS.length;
  my.persona = PERSONAS[my.personaIdx];
  my.sortCursor = (my.sortCursor + 1) % 9973;
  // liked subs lead more often, but the seeded rotation still moves them around
  const key = new Map(subs.map(s => [s, seededRand(my.seed ^ hashStr(s)) - 0.3 * taste.sub(s)]));
  const order = subs.filter(s => !isHidden(s)).sort((a, b) => key.get(a) - key.get(b));
  my.order = order;
  const pool = my.persona.sorts;
  const plan = {};
  order.forEach((s, i) => { plan[s] = pool[(i + my.sortCursor) % pool.length]; });
  // the leaders plus one random sub from the rest, so the spotlight keeps exploring
  const k = Math.min(3, Math.ceil(order.length / 3));
  const spot = order.slice(0, k > 1 ? k - 1 : k);
  const rest = order.slice(spot.length);
  if (k > 1 && rest.length) spot.push(rest[Math.floor(seededRand(my.seed ^ 0x5f3759df) * rest.length)]);
  my.spotlight = new Set(spot.map(s => s.toLowerCase()));
  return plan;
}

// returns the in-flight refill when there is one, so every caller can await it
function ensureBuffer() {
  if (my.fetchP) return my.fetchP;
  const g = gen;
  const p = (async () => {
    // videos deplete 3x faster than stills, and picture-heavy subs may only
    // have a handful per page — paginate deeper (up to 3 rounds) until the
    // video pool is healthy, and after round 1 only re-fetch subs that have
    // actually been yielding videos, to not waste rate budget on photo subs.
    for (let round = 0; round < 3; round++) {
      if (g !== gen) return;
      const videoCount = my.buffer.reduce((c, p) => c + (p._rv ? 1 : 0), 0);
      if (my.buffer.length >= MIN_BUFFER && videoCount >= MIN_VIDEO_BUFFER) return;
      let pending = my.subs.filter(s => my.afters[s] !== null && !isHidden(s)); // null = exhausted
      if (round > 0) {
        const yielding = pending.filter(s => (my.videoYield[s] || 0) > 0);
        if (yielding.length) pending = yielding;
      }
      if (pending.length === 0) return;
      // the queue is FIFO, so spotlight subs' listings come back first;
      // deeper rounds spend the rate budget on liked subs first
      const rank = s => (my.spotlight && my.spotlight.has(s.toLowerCase()) ? 0 : 1);
      const ord = s => (my.order ? my.order.indexOf(s) : 0);
      const liked = new Map(pending.map(s => [s, round > 0 ? taste.sub(s) : 0]));
      pending.sort((a, b) => liked.get(b) - liked.get(a) || rank(a) - rank(b) || ord(a) - ord(b));
      const results = await Promise.allSettled(pending.map(async sub => {
        const [sort, t] = my.sorts[sub] || ['hot', null];
        const data = await fetchSubPage(sub, sort, t, my.afters[sub], () => g !== gen);
        if (g !== gen) return;                       // stale build: drop the page
        my.afters[sub] = data.data.after || null;
        if (isHidden(sub)) return;                   // hidden while its page was in flight
        // never re-show this session's posts; aggregates like r/popular carry hidden subs' posts
        const posts = usablePosts(data, true, my.stale).filter(p => !isHidden(p.subreddit));
        my.videoYield[sub] = (my.videoYield[sub] || 0) + posts.filter(p => p._rv).length;
        my.buffer.push(...posts);
        notifyBuffer();
      }));
      if (g !== gen) return;
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length === pending.length) {
        // everything failed at once (offline, logged out, rate limited) — a
        // global failure, so blacklist nothing and let a retry fetch again
        if (my.buffer.length) break;
        throw failures[0].reason;
      }
      // banned/private/typo'd subs (common in imported lists) 404 forever —
      // mark them exhausted so they can't stall or re-fetch every round
      results.forEach((r, i) => {
        if (r.status === 'rejected' && /HTTP (403|404|451)/.test(String(r.reason && r.reason.message))) {
          my.afters[pending[i]] = null;
        }
      });
    }
  })().finally(() => {
    if (my.fetchP === p) my.fetchP = null;
    if (g === gen) notifyBuffer(true);   // a stale fill must not wake the new build's waiters
  });
  my.fetchP = p;
  return p;
}

async function myLoadMore() {
  if (loading) return;
  loading = true;
  if (feed.children.length === 0) setBusy(true);   // background top-ups must not look like a refresh
  const g = gen;
  try {
    const fill = ensureBuffer();
    fill.catch(() => {});
    if (feed.children.length === 0) {
      await Promise.race([fill, bufferReady()]);
      // an empty buffer means the forced wake-up: fill has settled, so this rethrows its real error
      if (g === gen && !my.buffer.length) await fill;
    } else if (my.buffer.length < BATCH_SIZE) await fill;
    if (g !== gen || mode !== 'my') return;
    const render = () => {
      for (const post of pickBatch(my.buffer, my.seed, BATCH_SIZE)) {
        const slide = buildSlide(post);
        if (slide) { feed.appendChild(slide); markShown(post.id); }
      }
    };
    render();
    const exhausted = my.subs.every(s => my.afters[s] === null || isHidden(s));
    if (feed.children.length === 0 && my.stale.length && (exhausted || my.deepFills > 0)) {
      // nothing new even a page deeper: replay earlier sessions' posts already
      // fetched, rather than refetching every sub from page 1
      my.buffer.push(...my.stale.splice(0).filter(p => !isHidden(p.subreddit)));
      render();
    }
    if (feed.children.length > 0) {
      hideStatus();
      if (my.announced !== gen && my.persona) {
        my.announced = gen;
        toast(my.persona.name);
        const chip = topbar.querySelector(`[data-key="feed:${activeFeed}"]`);
        if (chip) chip.title = feeds[activeFeed].name + ' · ' + my.persona.name;
      }
    } else {
      if (exhausted && my.subs.length && my.subs.every(isHidden)) return showStatus('Every subreddit in this feed is hidden — unhide some in ＋ → Advanced', false, EDIT_FEEDS);
      if (!exhausted && my.deepFills < 3) {
        // every fetched post was watched before; page deeper before recycling
        my.deepFills++;
        showStatus('Looking past posts you\'ve seen…');
        const live = () => g === gen && mode === 'my' && feed.children.length === 0;
        ensureBuffer().then(() => { if (live()) myLoadMore(); },
          e => { if (live()) showStatus('Could not load your feed — ' + e.message, false, EDIT_FEEDS); });
        return;
      }
      // everything fetched was already shown — recycle once
      if (!my.recycled && shownIds.size) {
        my.recycled = true;
        shownIds.clear();
        seen.clear();
        my.afters = {};
        my.stale = [];
        loading = false;
        return await myLoadMore();   // await: our finally must not clear the retry's loading flag
      }
      if (exhausted) showStatus('No playable posts found in your subreddits — edit the list with ＋', false, EDIT_FEEDS);
      else showStatus('Nothing loaded yet — tap to retry', false);
    }
    ensureBuffer().catch(() => {}); // fire-and-forget refill for the next batch
  } catch (err) {
    console.error(err);
    if (g === gen && feed.children.length === 0) showStatus('Could not load your feed — ' + err.message, false, EDIT_FEEDS);
  } finally {
    if (g === gen) { loading = false; setBusy(false); }
  }
}

function enterMyFeed(reset) {
  dropStash();
  removeModePill();
  mode = 'my';
  currentSub = null;
  if (reset) {
    newBuild();
    my.seed = (Math.random() * 2 ** 31) | 0;
    my.subs = subs;
    my.sorts = rotatedSortPlan();
    my.buffer = [];
    my.afters = {};
    my.slot = 0;
    my.videoYield = {};
    my.recycled = false;
    my.stale = [];
    my.deepFills = 0;
    seenRing.forEach(id => shownIds.add(id));   // a recycle cleared it for the last build only
    seen.clear();
    clearFeed();
  }
  rebuildTopbar();   // drops a single-sub chip
  if (subs.length === 0) return showStatus(EMPTY_FEED_MSG, false, EDIT_FEEDS);
  if (!showNsfw && isNsfwFeed(feeds[activeFeed])) {
    return showStatus('This is an 18+ feed — turn on "Show 18+ posts" in ＋', false, { label: 'Open ＋', onClick: openEditor });
  }
  showStatus(`Mixing ${my.persona ? my.persona.name : 'your feed'}…`);
  myLoadMore();
}

/* =======================================================================
   SINGLE SUBREDDIT MODE
   ======================================================================= */
async function subLoadMore() {
  if (loading || subExhausted) return;
  loading = true;
  const g = gen;
  try {
    const [sort, t] = SORTS[subSortIdx];
    const data = await fetchSubPage(currentSub, sort, t, subAfter, () => g !== gen);
    if (g !== gen || mode !== 'sub') return;
    subAfter = data.data.after;
    if (!subAfter) subExhausted = true;
    let added = 0;
    for (const post of usablePosts(data)) {
      const slide = buildSlide(post);
      if (slide) { feed.appendChild(slide); added++; }
    }
    hideStatus();
    if (added === 0 && !subExhausted) { loading = false; return await subLoadMore(); }
    if (feed.children.length === 0) {
      showStatus('No playable video/image posts found in r/' + currentSub, false);
    }
  } catch (err) {
    if (g !== gen) return;   // the build was replaced (its queued fetch was dropped)
    console.error(err);
    if (feed.children.length === 0) {
      showStatus('Could not load r/' + currentSub + ' — ' + err.message, false);
    }
  } finally {
    if (g === gen) loading = false;
  }
}

function enterSub(sub, resetSort) {
  newBuild();
  stashFeed();   // before mode changes: only a 'my' feed is stashed
  removeModePill();
  mode = 'sub';
  currentSub = sub;
  if (resetSort) subSortIdx = 0;
  subAfter = null;
  subExhausted = false;
  seen.clear();
  rebuildTopbar();   // adds the temporary r/sub chip
  const [sort, t] = SORTS[subSortIdx];
  showStatus(`Loading r/${sub} (${sort}${t ? ' · ' + t : ''})…`);
  // a fresh visit, not a sort-cycling refresh, offers to keep the sub
  const f = feeds[activeFeed];
  const has = () => f.subs.some(x => x.toLowerCase() === sub.toLowerCase());
  if (resetSort && !has()) {
    toast('Watching r/' + sub, { action: '＋ Add to ' + f.name, ms: 5000, onAction: () => {
      if (!has()) { f.subs.push(sub); saveSubs(); }
      if (hiddenSubs.delete(sub.toLowerCase())) saveHidden();
      toast('Added ✓');
    } });
  }
  subLoadMore();
}

/* ---------- refresh: new content, new order ---------- */
function refresh() {
  if (mode === 'saved') {
    enterSavedFeed();
  } else if (mode === 'my') {
    enterMyFeed(true);
  } else {
    subSortIdx = (subSortIdx + 1) % SORTS.length;   // hot → top(day) → rising → top(week)
    enterSub(currentSub, false);
  }
  // a 429 pause outlives the status that announced it
  const wait = Math.ceil((queuePausedUntil - Date.now()) / 1000);
  if (mode !== 'saved' && loading && wait > 0 && feed.children.length === 0) {
    showStatus(`Reddit rate limit — retrying in ${wait}s…`);
  }
}
// no !loading guard: newBuild() drops the in-flight load, so a refresh always wins
let lastRefresh = 0;
function tryRefresh() {
  const now = Date.now();
  if (now - lastRefresh < 600) return;
  lastRefresh = now;
  refresh();
}

function loadMore() {
  if (mode === 'saved') return;   // saved feed is finite, no pagination
  mode === 'my' ? myLoadMore() : subLoadMore();
}

/* =======================================================================
   TOP BAR + SUBREDDIT EDITOR
   ======================================================================= */
function rebuildTopbar() {
  topbar.replaceChildren();

  const home = el('button', 'chip icon', '🏠');
  home.dataset.key = 'home';
  home.title = 'Back to your feed';
  home.setAttribute('aria-label', 'Home feed');
  home.onclick = () => {
    const ov = document.querySelector('.editor-overlay');
    if (ov) { saveSubs(); ov._close ? ov._close() : ov.remove(); }
    if (mode !== 'my') restoreFeed();   // falls back to a fresh build when nothing is stashed
    else feed.scrollTo({ top: 0, behavior: 'smooth' });
  };
  topbar.appendChild(home);

  const rf = el('button', 'chip icon', '🔄');
  rf.id = 'refresh-chip';
  rf.title = 'Refresh — new mix';
  rf.setAttribute('aria-label', 'Refresh feed');
  rf.classList.toggle('busy', loading && mode === 'my' && feed.children.length === 0);
  rf.onclick = tryRefresh;
  topbar.appendChild(rf);

  const wrap = el('div', null);
  wrap.id = 'chipwrap';
  const strip = el('div', 'chips');
  // a plain mouse wheel only scrolls vertically, and this strip only overflows sideways
  strip.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) {
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
  wrap.appendChild(strip);
  topbar.appendChild(wrap);

  // sub: prefix — a sub named "home" or "profile" must not share a pinned chip's key
  if (mode === 'sub' && currentSub) {
    const c = el('button', 'chip', 'r/' + currentSub + ' ✕');
    c.dataset.key = 'sub:' + currentSub;
    c.title = 'Back to your feed';
    c.onclick = restoreFeed;
    strip.appendChild(c);
  }

  feeds.forEach((f, i) => {
    if (isNsfwFeed(f) && !showNsfw && i !== activeFeed) return;
    const b = el('button', 'chip', f.name);
    b.dataset.key = 'feed:' + i;
    b.onclick = () => {
      if (i === activeFeed && mode !== 'my' && stash) restoreFeed();
      else if (i !== activeFeed || mode !== 'my') switchFeed(i);
    };
    strip.appendChild(b);
  });

  const prof = el('button', 'chip icon', '👤');
  prof.dataset.key = 'profile';
  prof.title = 'Profile — saved posts';
  prof.setAttribute('aria-label', 'Profile and saved posts');
  prof.onclick = openProfile;
  topbar.appendChild(prof);

  const edit = el('button', 'chip icon', '＋');
  edit.title = 'Manage feeds';
  edit.setAttribute('aria-label', 'Manage feeds');
  edit.onclick = openEditor;
  topbar.appendChild(edit);

  highlightChip(mode === 'my' ? 'feed:' + activeFeed : mode === 'saved' ? 'profile' : 'sub:' + currentSub);
}
function highlightChip(key) {
  let active = null;
  topbar.querySelectorAll('.chip').forEach(c => {
    const on = c.dataset.key === key;
    c.classList.toggle('active', on);
    // aria-current="" reads as false, so set an explicit value
    if (on) { c.setAttribute('aria-current', 'true'); active = c; } else c.removeAttribute('aria-current');
  });
  const strip = topbar.querySelector('.chips');
  // plain scrollLeft: older WebKit rejects behavior:'instant' with a TypeError
  if (active && strip && strip.contains(active)) {
    strip.scrollLeft = active.offsetLeft - strip.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
  }
}

function fold(label, className) {
  const d = el('details', className);
  d.appendChild(el('summary', null, label));
  return d;
}

function openEditor() {
  if (document.querySelector('.editor-overlay')) return;
  const overlay = el('div', 'editor-overlay');
  const card = el('div', 'editor-card');
  // closing without changes to the watched feed must not rebuild (and refetch) it;
  // feed objects are edited in place, so identity catches a delete or a switch
  const feed0 = feeds[activeFeed];
  const feedSnap = () => JSON.stringify(feeds[activeFeed]);
  const feedBefore = feedSnap();
  const nsfwBefore = showNsfw;
  const hiddenBefore = hiddenSubs.size;
  const done = el('button', 'editor-btn editor-done editor-done-sm', 'Done');
  let back = null;
  const close = () => overlay.remove();

  const head = el('div', 'editor-head');
  head.appendChild(el('div', 'editor-title', `Feeds — v${APP_VERSION}`));
  head.appendChild(done);
  card.appendChild(head);

  /* ----- your feeds: switch, create, delete ----- */
  const feedList = el('div', 'editor-list');
  const subsTitle = el('div', 'editor-sect');
  // declared before renderFeeds, whose first run precedes the preset loop
  const presetBtns = [];
  const paintPresets = () => presetBtns.forEach(([b, p]) => {
    const have = feeds.some(f => f.name === p.name);
    b.textContent = (have ? '✓ ' : '') + p.name;
    b.classList.toggle('preset-have', have);
  });
  const renderFeeds = () => {
    feedList.replaceChildren();
    feeds.forEach((f, i) => {
      const row = el('div', 'editor-row' + (i === activeFeed ? ' active-feed' : ''));
      const name = el('span', null, (i === activeFeed ? '▶ ' : '') + f.name);
      name.style.cursor = 'pointer';
      name.onclick = () => {
        saveSubs();                        // persist edits to the feed we're leaving
        activeFeed = i;
        subs = feeds[i].subs;
        saveSubs();
        expanded = false;
        renderFeeds();
        renderList();
      };
      row.appendChild(name);
      const rm = el('button', 'editor-remove', '✕');
      rm.setAttribute('aria-label', 'Delete feed ' + f.name);
      rm.onclick = () => {
        if (feeds.length === 1) return alert('Keep at least one feed');
        if (!confirm(`Delete "${f.name}" (${f.subs.length} subs)?`)) return;
        saveSubs();
        feeds.splice(i, 1);
        if (i < activeFeed) activeFeed--;
        else if (activeFeed >= feeds.length) activeFeed = feeds.length - 1;
        subs = feeds[activeFeed].subs;
        saveSubs();
        renderFeeds();
        renderList();
      };
      row.appendChild(rm);
      feedList.appendChild(row);
    });
    subsTitle.textContent = 'Subreddits in ' + feeds[activeFeed].name;
    paintPresets();
  };
  card.appendChild(feedList);

  const newFeedRow = el('div', 'editor-add');
  const feedInput = document.createElement('input');
  feedInput.placeholder = 'new feed name, e.g. Chill';
  const newFeedBtn = el('button', 'editor-btn', 'Create');
  const createFeed = () => {
    const name = feedInput.value.trim().slice(0, 24);
    if (!name) return;
    saveSubs();
    feeds.push({ name, subs: [] });
    activeFeed = feeds.length - 1;
    subs = feeds[activeFeed].subs;
    saveSubs();
    feedInput.value = '';
    renderFeeds();
    renderList();
  };
  newFeedBtn.onclick = createFeed;
  feedInput.addEventListener('keydown', e => { if (e.key === 'Enter') createFeed(); });
  newFeedRow.appendChild(feedInput);
  newFeedRow.appendChild(newFeedBtn);
  card.appendChild(newFeedRow);

  /* ----- subreddits of the selected feed ----- */
  card.appendChild(subsTitle);
  const list = el('div', 'editor-list');
  let expanded = false;
  const renderList = () => {
    list.replaceChildren();
    const shown = subs.length > 8 && !expanded ? subs.slice(0, 8) : subs;
    for (const sub of shown) {
      const row = el('div', 'editor-row');
      row.appendChild(el('span', null, 'r/' + sub));
      const rm = el('button', 'editor-remove', '✕');
      rm.setAttribute('aria-label', 'Remove r/' + sub);
      rm.onclick = () => {
        // splice, not filter: subs must stay the same array as feeds[activeFeed].subs
        const k = subs.indexOf(sub);
        if (k >= 0) subs.splice(k, 1);
        renderList();
      };
      row.appendChild(rm);
      list.appendChild(row);
    }
    if (shown !== subs) {
      const more = el('button', 'editor-btn', `Show all ${subs.length}`);
      more.onclick = () => { expanded = true; renderList(); };
      list.appendChild(more);
    }
  };

  const addRow = el('div', 'editor-add');
  const input = document.createElement('input');
  input.placeholder = 'add subreddit, e.g. r/space';
  input.autocapitalize = 'none';
  const addBtn = el('button', 'editor-btn', 'Add');
  const add = () => {
    const name = input.value.trim().replace(/^\/?(r\/)?/i, '');
    if (!/^[A-Za-z0-9_]{2,21}$/.test(name)) return alert('That does not look like a subreddit name');
    if (!subs.some(s => s.toLowerCase() === name.toLowerCase())) subs.push(name);
    if (hiddenSubs.delete(name.toLowerCase())) { saveHidden(); renderHidden(); }
    input.value = '';
    expanded = true;   // the new sub lands at the end, past a collapsed list
    renderList();
  };
  addBtn.onclick = add;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  card.appendChild(addRow);

  renderFeeds();
  renderList();
  card.appendChild(list);

  /* ----- smart feeds: one tap adds the combo (or opens your copy) ----- */
  const smart = fold('Smart feeds — tap to add or open', 'editor-fold');
  const sfwGrid = el('div', 'preset-grid');
  const nsfwGrid = el('div', 'preset-grid');
  for (const preset of PRESET_FEEDS) {
    const b = el('button', 'editor-btn');
    presetBtns.push([b, preset]);
    b.onclick = () => {
      // ask before touching feeds: a cancelled tap must leave nothing behind
      if (preset.nsfw && !showNsfw) {
        if (!confirm('Turn on 18+ posts?')) return;
        showNsfw = true;
        persistNsfw();
      }
      saveSubs();
      // an existing copy only switches — re-tapping must not restore removed subs
      let idx = feeds.findIndex(f => f.name === preset.name);
      if (idx === -1) {
        feeds.push({ name: preset.name, subs: preset.subs.slice(), nsfw: !!preset.nsfw });
        idx = feeds.length - 1;
      }
      if (idx === activeFeed && mode === 'my') return done.onclick();   // already watching it
      close();
      switchFeed(idx);
    };
    (preset.nsfw ? nsfwGrid : sfwGrid).appendChild(b);
  }
  paintPresets();
  smart.appendChild(sfwGrid);
  const adult = fold('18+ presets');
  adult.appendChild(nsfwGrid);
  smart.appendChild(adult);
  card.appendChild(smart);

  // 18+ toggle — only affects what YOUR logged-in Reddit account can already see
  const nsfwRow = el('label', 'editor-row');
  nsfwRow.appendChild(el('span', null, 'Show 18+ posts'));
  const nsfwToggle = document.createElement('input');
  nsfwToggle.type = 'checkbox';
  nsfwToggle.checked = showNsfw;
  nsfwToggle.onchange = () => {
    showNsfw = nsfwToggle.checked;
    persistNsfw();
  };
  nsfwRow.appendChild(nsfwToggle);
  card.appendChild(nsfwRow);

  /* ----- advanced: transfer, debug, cache ----- */
  const advanced = fold('Advanced', 'editor-fold');

  // transfer settings between devices (desktop Chrome ⇄ iPhone Orion, …)
  const xferRow = el('div', 'editor-add');
  const copyBtn = el('button', 'editor-btn', 'Copy my settings');
  copyBtn.onclick = async () => {
    saveSubs();
    const payload = JSON.stringify({ feeds, activeFeed, nsfw: showNsfw });
    try { await navigator.clipboard.writeText(payload); copyBtn.textContent = 'Copied ✓'; }
    catch { prompt('Copy this:', payload); }
    setTimeout(() => (copyBtn.textContent = 'Copy my settings'), 1500);
  };
  const pasteBtn = el('button', 'editor-btn', 'Paste settings');
  pasteBtn.onclick = () => {
    const raw = prompt('Paste your settings (from "Copy my settings" on the other device):');
    if (!raw) return;
    const validSubs = a => Array.isArray(a) && a.every(s => /^[A-Za-z0-9_]{2,21}$/.test(s));
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j.feeds) && j.feeds.every(f => f && f.name && validSubs(f.subs))) {
        if (!confirm(`Replace your ${feeds.length} feeds with the ${j.feeds.length} pasted ones?`)) return;
        feeds = j.feeds;
        activeFeed = Math.min(Math.max(0, j.activeFeed | 0), feeds.length - 1);
      } else if (validSubs(j.subs) && j.subs.length) {   // legacy single-list payload
        if (!confirm('Replace the subreddits in ' + feeds[activeFeed].name + '?')) return;
        feeds[activeFeed].subs = j.subs;
      } else throw 0;
      subs = feeds[activeFeed].subs;
      showNsfw = !!j.nsfw;
      persistNsfw();
      nsfwToggle.checked = showNsfw;
      saveSubs();
      renderFeeds();
      renderList();
    } catch {
      // also accept a plain comma/space separated list of subreddit names
      const names = raw.split(/[,\s]+/).map(s => s.trim().replace(/^\/?(r\/)?/i, '')).filter(Boolean);
      if (names.length && names.every(s => /^[A-Za-z0-9_]{2,21}$/.test(s))) {
        if (!confirm('Replace the subreddits in ' + feeds[activeFeed].name + '?')) return;
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
  advanced.appendChild(xferRow);

  // hidden from ⋯ on a post; unhiding needs no rebuild — the next refill fetches it
  advanced.appendChild(el('div', 'editor-sect', 'Hidden subreddits'));
  const hiddenList = el('div', 'editor-list');
  const renderHidden = () => {
    hiddenList.replaceChildren();
    if (!hiddenSubs.size) hiddenList.appendChild(el('div', 'editor-hint', 'None — hide one from ⋯ on any post'));
    for (const sub of [...hiddenSubs].sort()) {
      const row = el('div', 'editor-row');
      row.appendChild(el('span', null, 'r/' + sub));
      const rm = el('button', 'editor-remove', '✕');
      rm.setAttribute('aria-label', 'Unhide r/' + sub);
      rm.onclick = () => { hiddenSubs.delete(sub); saveHidden(); renderHidden(); };
      row.appendChild(rm);
      hiddenList.appendChild(row);
    }
  };
  renderHidden();
  advanced.appendChild(hiddenList);

  const dbg = el('button', 'editor-btn', 'Sound debug');
  dbg.onclick = () => { saveSubs(); close(); rebuildTopbar(); soundDebug(); };
  advanced.appendChild(dbg);

  const cacheBtn = el('button', 'editor-btn',
    `Clear video cache · ${fmtBytes(cacheTotalBytes())} of ${fmtBytes(VID_CACHE_CAP)}`);
  cacheBtn.onclick = async () => {
    if (CACHE_OK) await caches.delete(VIDCACHE);
    vidIndex = {};
    flushVidIndex();
    cacheBtn.textContent = 'Video cache cleared ✓';
  };
  advanced.appendChild(cacheBtn);
  if (matchMedia('(hover: hover)').matches) {
    advanced.appendChild(el('div', 'editor-hint',
      'Keys: ↑↓ / j k next · Space pause · ←→ gallery · m sound · s save · d download · r refresh · Esc close'));
  }
  card.appendChild(advanced);

  done.onclick = () => {
    saveSubs();
    // 18+ just turned off on an 18+ feed: fall back to the first safe feed
    if (!showNsfw && isNsfwFeed(feeds[activeFeed])) {
      const j = feeds.findIndex(f => !isNsfwFeed(f));
      if (j !== -1) { activeFeed = j; subs = feeds[j].subs; saveSubs(); }
    }
    close();
    if (back?.isConnected) back.focus({ preventScroll: true });
    const feedChanged = feeds[activeFeed] !== feed0 || feedSnap() !== feedBefore;
    const changed = feedChanged || showNsfw !== nsfwBefore;
    // only 18+ flipped: stay in Saved / r/sub instead of falling back to the mix
    if (changed && !feedChanged && (mode === 'saved' || mode === 'sub')) {
      dropStash();   // the parked mix was built under the old 18+ setting
      return mode === 'saved' ? enterSavedFeed(currentSlide?._post?.id) : enterSub(currentSub, false);
    }
    if (changed && subs.length === 0) {
      newBuild();    // an in-flight load of the old feed must not render behind the status
      dropStash();
      removeModePill();
      mode = 'my';
      currentSub = null;
      clearFeed();   // nothing may keep playing behind the status layer
      rebuildTopbar();
      return showStatus(EMPTY_FEED_MSG, false, EDIT_FEEDS);
    }
    rebuildTopbar();
    // unhiding can revive a feed that was empty because every sub was hidden
    if (changed || (hiddenSubs.size !== hiddenBefore && mode === 'my' && !feed.children.length)) enterMyFeed(true);
  };
  overlay._close = () => done.onclick();

  overlay.appendChild(card);
  overlay.addEventListener('click', e => { if (e.target === overlay) done.onclick(); });
  document.body.appendChild(overlay);
  back = document.activeElement;
  done.focus({ preventScroll: true });
}

/* =======================================================================
   DOWNLOADS + PROFILE + SAVED FEED
   ======================================================================= */
// best single-file representation of a post, favoring files with audio
function downloadTargetOf(post, s) {
  if (s && s._mp4Url) return { url: s._mp4Url, ext: '.mp4' };          // redgifs/external — audio included
  const rv = post._rv || videoInfoOf(post);
  if (rv && rv.fallback_url) return { url: rv.fallback_url, ext: '.mp4' };
  const src = post.preview && post.preview.images && post.preview.images[0] && post.preview.images[0].source;
  if (src && src.url) return { url: src.url, ext: '.jpg' };
  if (post.media_metadata) {                                            // gallery: first image
    const first = Object.values(post.media_metadata)[0];
    const u = first && first.s && (first.s.u || first.s.gif);
    if (u) return { url: u, ext: first.s && first.s.gif ? '.gif' : '.jpg' };
  }
  if (isDirectImage(post)) return { url: post.url, ext: '.jpg' };
  return null;
}
async function downloadPost(post, s, btn) {
  const icon = btn && btn.querySelector('.icon');
  if (icon) icon.textContent = '⏳';
  // redgifs resolve lazily — wait for the original rather than take the video-only rehost
  const rg = s && s._rgId && !s._mp4Url ? await resolveRedgifs(s._rgId) : null;
  const t = rg ? { url: rg, ext: '.mp4' } : downloadTargetOf(post, s);
  if (!t) {
    if (icon) icon.textContent = '⬇';
    alert('Nothing downloadable on this post');
    return false;
  }
  let ok = false;
  try {
    const res = await fetch(t.url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (post.subreddit || 'reddit') + '-' + post.id + t.ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    if (icon) icon.textContent = '✅';
    ok = true;
  } catch (e) {
    if (icon) icon.textContent = '⚠️';
    alert('Download failed: ' + e.message);
  }
  setTimeout(() => { if (icon) icon.textContent = '⬇'; }, 2000);
  return ok;
}

function enterSavedFeed(startId) {
  newBuild();
  stashFeed();   // before mode changes: only a 'my' feed is stashed
  removeModePill();
  mode = 'saved';
  currentSub = null;
  rebuildTopbar();   // drops a single-sub chip
  let target = null, hidden = 0;
  for (const orig of savedPosts) {
    if (orig.over_18 && !showNsfw) { hidden++; continue; }
    // runtime fields go on a copy so they never reach storage
    const p = { ...orig };
    delete p._rv; delete p._redgifs;
    const rg = (p.url || '').match(/redgifs\.com\/(?:watch|ifr)\/([a-z0-9]+)/i);
    if (rg) p._redgifs = rg[1].toLowerCase();
    const rv = videoInfoOf(p);
    if (rv) p._rv = rv;
    else if (p._redgifs) p._rv = {};   // same as usablePosts: original only
    // saves from before post_hint was kept: a preview is enough for a still
    else if (!p.post_hint && !(p.is_gallery && p.media_metadata) && posterOf(p)) p.post_hint = 'image';
    const slide = buildSlide(p);
    if (slide) {
      feed.appendChild(slide);
      if (p.id === startId) target = slide;
    }
  }
  const n = feed.children.length;
  if (n === 0) {
    return showStatus(hidden ? 'Saved 18+ posts are hidden — turn on "Show 18+ posts" in ＋'
                             : 'Nothing saved yet — tap 🔖 on any post', false, BACK_TO_FEED);
  }
  const end = el('div', 'slide end-card');
  end.appendChild(el('div', null, "That's all your saves"));
  const back = el('button', 'editor-btn', '← Back to feed');
  back.onclick = e => { e.stopPropagation(); restoreFeed(); };
  end.appendChild(back);
  feed.appendChild(end);
  const pill = el('button', null, `💛 Saved · ${n}  ✕`);
  pill.id = 'mode-pill';
  pill.title = 'Back to your feed';
  pill.onclick = () => restoreFeed();
  document.body.appendChild(pill);
  hideStatus();
  if (target) target.scrollIntoView();
}
function removeModePill() { document.getElementById('mode-pill')?.remove(); }

function openProfile() {
  if (document.querySelector('.editor-overlay')) return;
  const overlay = el('div', 'editor-overlay');
  const card = el('div', 'editor-card');
  let back = null;
  const close = () => { overlay.remove(); if (back?.isConnected) back.focus({ preventScroll: true }); };
  const head = el('div', 'editor-head');
  head.appendChild(el('div', 'editor-title', '👤 Profile'));
  const done = el('button', 'editor-btn editor-done editor-done-sm', 'Close');
  done.onclick = close;
  head.appendChild(done);
  card.appendChild(head);

  const sect = el('div', 'editor-sect');
  card.appendChild(sect);
  const watch = el('button', 'editor-btn editor-done', '▶ Watch saved feed');
  watch.onclick = () => { overlay.remove(); enterSavedFeed(); };
  card.appendChild(watch);
  const grid = el('div', 'saved-grid');
  const render = () => {
    grid.replaceChildren();
    let visible = 0, hidden = 0;
    for (const p of savedPosts) {
      if (p.over_18 && !showNsfw) { hidden++; continue; }
      visible++;
      const c = el('div', 'saved-card');
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = sizedPreview(p, 216) || posterOf(p) || '';
      c.appendChild(img);
      const info = el('div', 'saved-info');
      info.appendChild(el('div', 'saved-title', p.title));
      info.appendChild(el('div', 'saved-sub', 'r/' + p.subreddit));
      c.appendChild(info);
      const rm = el('button', 'editor-remove', '✕');
      rm.setAttribute('aria-label', 'Unsave post');
      rm.onclick = e => {
        e.stopPropagation();
        savedPosts = savedPosts.filter(x => x.id !== p.id);
        persistSaved();
        dropMp4Cache(p.id);
        render();
      };
      c.appendChild(rm);
      c.onclick = () => { overlay.remove(); enterSavedFeed(p.id); };
      c.tabIndex = 0;
      c.setAttribute('role', 'button');
      c.onkeydown = e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); c.click(); }
      };
      grid.appendChild(c);
    }
    sect.textContent = `Saved posts (${visible}${hidden ? ', ' + hidden + ' hidden 18+' : ''})`;
    watch.style.display = visible ? '' : 'none';
    if (!visible) {
      grid.appendChild(el('div', null, hidden ? 'Saved 18+ posts are hidden — turn on "Show 18+ posts" in ＋'
                                              : 'Nothing saved yet — tap 🔖 on any post'));
    }
  };
  render();
  card.appendChild(grid);

  /* ----- your taste: what the mixer has learned ----- */
  card.appendChild(el('div', 'editor-sect', 'Your taste'));
  const tasteList = el('div', 'editor-list');
  // stored keys are lowercase; show the casing the feeds use
  const subName = k => feeds.flatMap(f => f.subs).find(s => s.toLowerCase() === k) || k;
  const renderTaste = () => {
    tasteList.replaceChildren();
    const top = Object.keys(T.subs).map(k => [k, aff(T.subs, k)]).filter(x => x[1] > 0.05)
      .sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!top.length) tasteList.appendChild(el('div', 'editor-hint', 'Nothing learned yet — watch, save and share what you like'));
    for (const [k, a] of top) {
      const row = el('div', 'editor-row');
      row.appendChild(el('span', null, 'r/' + subName(k)));
      row.appendChild(el('span', null, '♥'.repeat(Math.max(1, Math.ceil(a * 3)))));
      tasteList.appendChild(row);
    }
  };
  renderTaste();
  card.appendChild(tasteList);
  const learnRow = el('label', 'editor-row');
  learnRow.appendChild(el('span', null, 'Learn from what I watch'));
  const learn = document.createElement('input');
  learn.type = 'checkbox';
  learn.checked = !T.off;
  learn.onchange = () => { T.off = !learn.checked; flushTaste(); };
  learnRow.appendChild(learn);
  card.appendChild(learnRow);
  const resetTaste = el('button', 'editor-btn', 'Reset taste');
  resetTaste.onclick = () => {
    if (!confirm('Forget everything the feed has learned about your taste?')) return;
    taste.reset();
    renderTaste();
  };
  card.appendChild(resetTaste);

  card.appendChild(el('div', 'editor-sect', 'Stats'));
  card.appendChild(el('div', null,
    `${feeds.length} feed${feeds.length === 1 ? '' : 's'} · video cache ${fmtBytes(cacheTotalBytes())} · v${APP_VERSION}`));

  overlay.appendChild(card);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  back = document.activeElement;
  done.focus({ preventScroll: true });
}

/* =======================================================================
   SOUND SELF-TEST — ＋ editor → "Sound debug"
   ======================================================================= */
async function soundDebug() {
  const slides = [...feed.querySelectorAll('.slide:not(.placeholder)')];
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
function showStatus(msg, spin = true, action) {
  statusEl.classList.remove('hidden');
  statusEl.querySelector('.spinner').style.display = spin ? '' : 'none';
  statusText.textContent = msg;
  statusEl.querySelector('.status-action')?.remove();
  if (action) {
    const b = el('button', 'editor-btn status-action', action.label);
    b.onclick = e => { e.stopPropagation(); action.onClick(); };
    statusEl.appendChild(b);
  }
}
function hideStatus() { statusEl.classList.add('hidden'); }
const EDIT_FEEDS = { label: 'Edit feeds', onClick: openEditor };
const BACK_TO_FEED = { label: '← Back to feed', onClick: () => restoreFeed() };
const EMPTY_FEED_MSG = 'This feed is empty — add subreddits';

let toastEl = null, toastT = 0;
function toast(msg, { action, onAction, ms = 2500 } = {}) {
  toastEl?.remove();
  clearTimeout(toastT);
  toastEl = el('div', 'toast');
  toastEl.appendChild(el('span', null, msg));
  if (action) {
    const b = el('button', null, action);
    b.onclick = e => { e.stopPropagation(); toastEl?.remove(); onAction(); };
    toastEl.appendChild(b);
  }
  document.body.appendChild(toastEl);
  toastT = setTimeout(() => { toastEl?.remove(); toastEl = null; }, ms);
}
statusEl.addEventListener('click', () => {
  if (!loading && feed.children.length === 0) {
    if (mode === 'saved') return;   // finite: there is nothing to retry
    if (mode === 'sub' && subExhausted) return;   // the listing ended with nothing playable
    // the empty and 18+ statuses stay: a retry would fetch the 18+ feed anyway
    if (mode === 'my' && (subs.length === 0 || (!showNsfw && isNsfwFeed(feeds[activeFeed])))) return;
    // un-blacklist subs a logged-out 403 (or a 404 blip) marked exhausted
    if (mode === 'my') for (const s of subs) if (my.afters[s] === null) delete my.afters[s];
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
  b.setAttribute('aria-label', label);
  b.onclick = onClick;
  return b;
}

function baseSlide(post, typeLabel) {
  const s = el('div', 'slide');
  s._post = post;
  s._sub = (post.subreddit || '').toLowerCase();
  s._mode = mode;   // a view is judged by the feed it was built for, not the one active at teardown
  s._kind = post._rv ? 'video' : (post.is_gallery ? 'gallery' : 'still');

  const overlay = el('div', 'overlay');
  const subEl = el('div', 'sub', 'r/' + post.subreddit);
  subEl.setAttribute('role', 'button');
  subEl.tabIndex = 0;
  subEl.title = 'More from r/' + post.subreddit;
  subEl.onclick = e => {
    e.stopPropagation();   // not a pause tap
    if (mode === 'sub' && currentSub && currentSub.toLowerCase() === s._sub) return;
    enterSub(post.subreddit, true);
  };
  subEl.onkeydown = e => { if (e.key === 'Enter') subEl.click(); };
  overlay.appendChild(subEl);
  overlay.appendChild(el('div', 'title', post.title));
  overlay.appendChild(el('div', 'meta',
    `▲ ${fmt(post.ups)} · 💬 ${fmt(post.num_comments)} · u/${post.author}`));
  s.appendChild(overlay);

  // each explicit action teaches once per slide; sound is a global toggle, so it never does
  s._credited = new Set();
  s._credit = (k, d) => { if (!s._credited.has(k)) { s._credited.add(k); taste.event(post, d); } };
  const rail = el('div', 'rail');
  rail.appendChild(railButton('↗', 'open', e => {
    e.stopPropagation();
    openOnReddit(post, s);
  }));
  rail.appendChild(railButton('⋯', 'more', e => {
    e.stopPropagation();
    openPostSheet(post, s);
  }));
  const saveBtn = railButton(isSaved(post.id) ? '💛' : '🔖', isSaved(post.id) ? 'saved' : 'save', e => {
    e.stopPropagation();
    toggleSave(post, saveBtn);
  });
  rail.appendChild(saveBtn);
  s._saveBtn = saveBtn;
  const dlBtn = railButton('⬇', 'download', e => {
    e.stopPropagation();
    downloadPost(post, s, dlBtn).then(ok => { if (ok) s._credit('dl', 2); });
  });
  rail.appendChild(dlBtn);
  s._dlBtn = dlBtn;
  s.appendChild(rail);

  if (typeLabel) s.appendChild(el('div', 'type-badge', typeLabel));
  return s;
}

const permalinkOf = post => 'https://www.reddit.com' + post.permalink;
function openOnReddit(post, s) {
  window.open(permalinkOf(post), '_blank', 'noopener');
  s._credit('open', 1);
}
async function sharePost(post, s) {
  const url = permalinkOf(post);
  try {
    if (navigator.share) await navigator.share({ title: post.title, url });
    else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    s._credit('share', 1.5);
  } catch {}   // share sheet dismissed, or clipboard refused
}

// ⋯ on a post. Must run inside the tap: share and window.open need the activation.
function openPostSheet(post, s) {
  const name = post.subreddit || '';
  const sub = name.toLowerCase();
  if (document.querySelector('.editor-overlay')) return;
  const overlay = el('div', 'editor-overlay');
  const card = el('div', 'editor-card');
  // preventScroll: refocusing ⋯ on an off-screen slide would scroll the feed back to it
  let back = null;
  const close = () => { overlay.remove(); if (back?.isConnected) back.focus({ preventScroll: true }); };
  const head = el('div', 'editor-head');
  head.appendChild(el('div', 'editor-title', 'r/' + name));
  const x = el('button', 'editor-btn editor-done editor-done-sm', 'Close');
  x.onclick = close;
  head.appendChild(x);
  card.appendChild(head);
  const list = el('div', 'editor-list');
  const action = (label, fn) => {
    const b = el('button', 'editor-btn sheet-btn', label);
    b.onclick = () => { overlay.remove(); fn(); };   // fn may navigate away: no refocus
    list.appendChild(b);
  };
  if (mode !== 'saved') {   // saved mode never teaches the taste model
    action('👍 More from r/' + name, () => { taste.event(post, 2); toast('More r/' + name); });
    action('👎 Less from r/' + name, () => { taste.event(post, -3); toast('Less r/' + name); stepSlide(1); });
  }
  if (mode === 'my') action('🚫 Hide r/' + name, () => hideSub(name, s));
  if (!(mode === 'sub' && currentSub && currentSub.toLowerCase() === sub)) {
    action('▶ Watch only r/' + name, () => enterSub(name, true));
  }
  action('➦ Share', () => sharePost(post, s));
  action('↗ Open on Reddit', () => openOnReddit(post, s));
  card.appendChild(list);
  overlay.appendChild(card);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  back = document.activeElement;
  x.focus({ preventScroll: true });
}

// drops the sub's queued posts and the slides already built ahead of s
function hideSub(name, s) {
  const sub = name.toLowerCase();
  hiddenSubs.add(sub);
  saveHidden();
  my.buffer = my.buffer.filter(p => (p.subreddit || '').toLowerCase() !== sub);
  let ahead = 0;
  for (let n = s.nextElementSibling; n; ) {
    const nx = n.nextElementSibling;
    if (n !== currentSlide && n._sub === sub) { teardownSlide(n); n.remove(); }
    else ahead++;
    n = nx;
  }
  stepSlide(1);
  toast('Hidden r/' + name, { action: 'Undo', ms: 4000, onAction: () => { hiddenSubs.delete(sub); saveHidden(); } });
  if (ahead < 4) loadMore();   // fewer than 3 left once the step lands
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
  s._rv = rv;

  const media = el('div', 'media');

  const v = document.createElement('video');
  v.playsInline = true;
  v.muted = true;
  v.loop = true;
  // preload nothing by default — the warm-up observer upgrades the current and
  // next few slides to preload=auto so they don't all fight for bandwidth.
  v.preload = 'none';
  s._poster = sizedPreview(post, 640) || posterOf(post);   // set by warmIO in range

  media.appendChild(v);
  s.prepend(media);
  s._video = v;
  const bdu = innerWidth > 700 && sizedPreview(post, 108);   // desktop letterbox only
  if (bdu) {
    const bd = el('div', 'backdrop');
    s._bdEl = bd;
    s._bd = bdu;
    s.prepend(bd);
  }

  // Safari plays HLS natively (with sound); everywhere else use the mp4
  // fallback (video-only) plus a synced <audio> element for sound.
  // Reddit's is_gif/has_audio metadata is unreliable in BOTH directions, so it
  // never decides routing: anything with an HLS stream goes through HLS, which
  // carries the audio whenever the source has any.
  if (post._redgifs && EXTENSION) {
    // reddit's rehost of redgifs is video-only — fetch the original, which
    // is a plain mp4 with the audio muxed in. Resolved lazily by armRedgifs.
    s._path = 'redgifs';
    s._rgId = post._redgifs;
  } else if (IS_SAFARI && rv.hls_url) {
    s._path = 'native-hls';
    s._src = rv.hls_url;
    v.src = rv.hls_url;        // native HLS — audio is muxed in
  } else if (rv.hls_url && window.Hls && Hls.isSupported()) {
    // hls.js — audio muxed in, adaptive bitrate for smoother buffering.
    // Attached lazily by the warm-up observer so off-screen slides cost nothing.
    s._path = 'hls.js';
    s._hlsUrl = rv.hls_url;
    s._fallbackUrl = rv.fallback_url;
  } else {
    armMp4(s, rv.fallback_url);
  }

  s.appendChild(el('div', 'paused-badge', '▶'));

  // reddit's audio metadata lies both ways — verify against what's actually
  // being decoded and correct the badge accordingly
  v.addEventListener('playing', () => {
    s._played = true;   // watched videos become cache candidates on teardown
    if (s._enter && s._ttff == null) s._ttff = performance.now() - s._enter;
    clearTimeout(s._audChk);
    s._audChk = setTimeout(() => {
      if (v.paused || s._audio || v.webkitAudioDecodedByteCount === undefined) return;
      if (v.webkitAudioDecodedByteCount > 0) setBadge(s, null);          // it has sound
      else setBadge(s, s._rgFallback ? '🔇 original unavailable' : '🔇 no sound in this video');
    }, 1800);
  });

  // a jump back in time while on screen is the loop wrapping around
  v.addEventListener('timeupdate', () => {
    if (s._enter && v.currentTime + 0.5 < s._lastT) s._loops++;
    s._lastT = v.currentTime;
    // a fatal hls error only counts as healed once playback gets past where it struck
    if (s._hlsFails && v.currentTime > Math.min(s._hlsErrAt, (v.duration || Infinity) - 0.5)) s._hlsFails = 0;
  });

  // first frame of the current slide opens the warm gate for its neighbours
  const firstFrame = () => { s._loadedOnce = true; if (s === currentSlide) openWarmGate(); };
  v.addEventListener('canplay', firstFrame);
  v.addEventListener('playing', firstFrame);

  // current video comfortably ahead (or fully buffered, for short clips) →
  // hand idle bandwidth to the next slide
  const maybePromoteNext = () => {
    if (v.paused) return;
    try {
      const b = v.buffered;
      if (!b.length) return;
      const end = b.end(b.length - 1);
      const full = isFinite(v.duration) && v.duration > 0 && end >= v.duration - 0.3;
      if (end - v.currentTime > 10 || full) promoteNextSlide(s);
    } catch {}
  };
  v.addEventListener('progress', maybePromoteNext);
  v.addEventListener('playing', maybePromoteNext);
  // current video stalled → take the bandwidth back from the next one
  v.addEventListener('waiting', () => {
    const n = nextVideoSlide(s);
    if (n && n._hls && n._hls.config.maxBufferLength > WARM_BUFFER_S) n._hls.config.maxBufferLength = WARM_BUFFER_S;
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
    if (v.paused) { attachHls(s, true); startWarm(s); v.play().catch(() => {}); s.classList.remove('paused'); }
    else { v.pause(); s.classList.add('paused'); }
  });

  return s;
}

// mp4 playback: external files play as-is; v.redd.it mp4s are video-only, so
// pair them with a separate audio element. Resolves once the src is set.
function armMp4(s, url) {
  const v = s._video, media = s.querySelector('.media');
  if (s._audio) return setMp4Src(s, v, url);
  if (!/^https:\/\/v\.redd\.it\//.test(url || '')) {
    s._path = 'mp4-external';
    return setMp4Src(s, v, url);   // e.g. imgur .gifv — no side-audio scheme exists
  }
  s._path = 'mp4+audio-el';
  // Reddit's audio filename varies by transcoding era, so walk the candidates
  // until one loads.
  const ready = setMp4Src(s, v, url);
  const cut = url.indexOf('?');
  const query = cut >= 0 ? url.slice(cut) : '';
  const base = url.slice(0, url.lastIndexOf('/'));
  const AUDIO_NAMES = ['CMAF_AUDIO_128.mp4', 'CMAF_AUDIO_64.mp4', 'DASH_AUDIO_128.mp4',
                       'DASH_AUDIO_64.mp4', 'DASH_audio.mp4', 'audio.mp4'];
  let ai = 0;
  const a = document.createElement('audio');
  a.src = base + '/' + AUDIO_NAMES[ai] + query;
  a.addEventListener('error', () => {
    if (s._dead) return;
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
  return ready;
}

function toggleSound() {
  soundOn = !soundOn;
  blessNearbyVideos();   // we're inside a tap — grant sound rights to nearby videos
  feed.querySelectorAll('.slide:not(.placeholder)').forEach(s => {
    if (s._soundBtn) s._soundBtn.querySelector('.icon').textContent = soundOn ? '🔊' : '🔇';
    if (!s._video) return;
    if (s._audio) {           // mp4 + separate audio track
      if (soundOn && !s._video.paused) {
        s._audio.currentTime = s._video.currentTime;
        s._audioBlessed = true;   // played inside the tap
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
// innerWidth can read 0 in a tab that hasn't been laid out yet
const TARGET_W = Math.min(1080, Math.ceil(innerWidth * (devicePixelRatio || 1)) || 1080);
// smallest preview rendition at least minW wide
function sizedPreview(post, minW = TARGET_W) {
  const img = post.preview && post.preview.images && post.preview.images[0];
  if (!img) return null;
  const r = (img.resolutions || []).find(r => r.width >= minW) || img.source;   // fall back UP, never down
  return (r && r.url) || null;
}

/* ----- gallery → horizontal carousel ----- */
function gallerySlide(post) {
  const items = (post.gallery_data && post.gallery_data.items) || [];
  const urls = [], bdUrls = [];
  for (const it of items) {
    const m = post.media_metadata[it.media_id];
    if (!m || m.status !== 'valid' || !m.s) continue;
    const anim = (m.e === 'AnimatedImage' || !m.s.u) && m.s.gif;
    const frame = anim ? m.s.gif : (((m.p || []).find(r => r.x >= TARGET_W)) || m.s).u;
    if (!frame) continue;
    urls.push(frame);
    bdUrls.push((m.p && m.p[0] && m.p[0].u) || frame);
  }
  if (urls.length === 0) return null;

  const s = baseSlide(post, `📷 1/${urls.length} — swipe →`);

  const media = el('div', 'media');
  const car = el('div', 'carousel');
  for (const u of urls) {
    const f = el('div', 'frame');
    const img = document.createElement('img');
    img.loading = 'lazy';
    if (!s._img) shownAt(s, img);
    img.src = u;
    f.appendChild(img);
    car.appendChild(f);
  }
  media.appendChild(car);
  s.prepend(media);

  const bd = el('div', 'backdrop');
  s._bdEl = bd;
  s._bd = bdUrls[0];   // set by warmIO in range
  s.prepend(bd);

  const dots = el('div', 'dots');
  urls.forEach((_, i) => {
    const d = el('span');
    if (i === 0) d.className = 'on';
    dots.appendChild(d);
  });
  s.appendChild(dots);

  const nav = (dir, cls, label) => {
    const b = el('button', 'car-nav ' + cls, dir < 0 ? '‹' : '›');
    b.setAttribute('aria-label', label);
    b.onclick = e => { e.stopPropagation(); pageCarousel(car, dir); };
    s.appendChild(b);
    return b;
  };
  const prev = nav(-1, 'car-prev', 'Previous image');
  const next = nav(1, 'car-next', 'Next image');
  prev.hidden = true;
  next.hidden = urls.length < 2;

  const badge = s.querySelector('.type-badge');
  car.addEventListener('scroll', () => {
    const i = Math.round(car.scrollLeft / car.clientWidth);
    s._frames = Math.max(s._frames || 1, i + 1);
    prev.hidden = i === 0;
    next.hidden = i >= urls.length - 1;
    dots.querySelectorAll('span').forEach((d, j) => d.classList.toggle('on', j === i));
    if (badge) badge.textContent = `📷 ${i + 1}/${urls.length}` + (i + 1 < urls.length ? ' — swipe →' : '');
    s._bdSet = true;   // warmIO must not reset it to the first frame
    bd.style.backgroundImage = `url("${bdUrls[Math.min(i, bdUrls.length - 1)]}")`;
  }, { passive: true });

  return s;
}

// a still's view, like a video's, counts from when it first paints
function shownAt(s, img) {
  s._img = img;
  img.addEventListener('load', () => { if (s._enter && s._ttff == null) s._ttff = performance.now() - s._enter; }, { once: true });
}

function pageCarousel(car, dir) {
  car.scrollBy({ left: dir * car.clientWidth, behavior: 'smooth' });
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
  shownAt(s, img);
  const src = /\.gif$/i.test(url) ? url : (sizedPreview(post) || url);   // a preview of a gif is a still
  img.src = src;
  media.appendChild(img);
  s.prepend(media);

  const bd = el('div', 'backdrop');
  s._bdEl = bd;
  s._bd = sizedPreview(post, 108) || src;   // set by warmIO in range
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

// every new Hls instance starts ABR from the last measured network speed
const BW_MIN = 300_000, BW_MAX = 20_000_000;
let netBwBps = (() => {
  try { const v = +localStorage.getItem('rs.bw'); return v >= BW_MIN && v <= BW_MAX ? v : 1_000_000; }
  catch { return 1_000_000; }
})();
let warmGateOpen = false, warmGateTimer = 0, bwSaveT = 0;

// Warm gate: neighbours only download fragments once the current slide has
// its first frame (or after 2.5s), so they don't split its first fragment's
// bandwidth. Until then a warm hls.js instance holds just its playlists.
function startWarm(s) {
  if (s && s._hls && !s._loadStarted) { s._loadStarted = true; s._hls.startLoad(-1); }
}
function openWarmGate() {
  if (warmGateOpen) return;
  warmGateOpen = true;
  clearTimeout(warmGateTimer);
  let n = currentSlide && currentSlide.nextElementSibling, k = 0;
  while (n && k < 2) {
    if (n._video) { startWarm(n); k++; }
    n = n.nextElementSibling;
  }
  let p = currentSlide && currentSlide.previousElementSibling;
  while (p && !p._video) p = p.previousElementSibling;
  startWarm(p);
}

function attachHls(s, current = false) {
  if (!s._hlsUrl || s._hls) return;
  const h = new Hls({
    capLevelToPlayerSize: true,   // don't pull 1080p for a phone-sized viewport
    startLevel: 0,                // first frame ASAP at low quality; ABR upgrades
    autoStartLoad: false,         // fragments wait for startWarm (the warm gate)
    abrEwmaDefaultEstimate: netBwBps,
    startFragPrefetch: current,   // fetch the first fragment alongside the playlist
    maxBufferLength: WARM_BUFFER_S, // off-screen slides only grab an instant-start
                                    // buffer; promoted to FULL_BUFFER_S when current
    backBufferLength: 10,         // small enough to not hog memory/bandwidth
    manifestLoadingTimeOut: 8000, // defaults wait ~20s before retrying — on a
    fragLoadingTimeOut: 10000,    // flaky link, failing fast and retrying wins
    enableWorker: false,          // extension CSP blocks blob workers; hls.js's
                                  // silent fallback can kill the audio pipeline
    fLoader: makeCacheFragLoader(),  // disk-cache segments for instant rewatch
  });
  // self-heal instead of freezing on the poster; a stream that keeps dying
  // degrades to the mp4
  h.on(Hls.Events.ERROR, (_, d) => {
    s._hlsErr = d.type + '/' + d.details + (d.fatal ? ' FATAL' : '');
    if (!d.fatal || s._hls !== h) return;
    s._hlsFails = (s._hlsFails || 0) + 1;
    s._hlsErrAt = d.frag ? d.frag.start + d.frag.duration : s._video.currentTime + 5;
    // recovery reloads the element, which pauses it and rejects a pending play()
    const resume = () => { if (s._hls === h && s === currentSlide && !s.classList.contains('paused')) s._video.play().catch(() => {}); };
    const giveUp = () => {
      detachHls(s);
      s._hlsUrl = null;
      if (!s._fallbackUrl) return;
      // full download ('auto') is only for the on-screen video
      if (s !== currentSlide) s._video.preload = 'metadata';
      armMp4(s, s._fallbackUrl).then(() => {
        if (!s._dead && isCentered(s) && !s.classList.contains('paused')) s._video.play().catch(() => {});
      });
    };
    if (s._hlsFails > 3) return giveUp();
    if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
      // startLoad() can't recover a manifest that never loaded — reload it.
      // loadSource() stops loading, so re-request it if it had started.
      if (!h.levels || !h.levels.length) {
        setTimeout(() => {
          if (s._hls !== h) return;
          h.loadSource(s._hlsUrl);
          if (s._loadStarted) h.startLoad(-1);
          resume();
        }, 1000);
      } else if (s._loadStarted) h.startLoad();
    } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
      if (s._hlsFails === 2) h.swapAudioCodec();
      // recoverMediaError() only restarts loading from a non-zero currentTime;
      // with autoStartLoad off, an error at 0 would otherwise stall for good
      const t = s._video.currentTime;
      h.recoverMediaError();
      if (!t && s._loadStarted) h.startLoad(-1);
      resume();
    } else giveUp();
  });
  // learn the network speed from real downloads only (not cache hits)
  h.on(Hls.Events.FRAG_BUFFERED, (_, d) => {
    if (d.frag.type !== 'main' || d.frag.sn === 'initSegment' || d.frag.stats._fromCache || d.frag.stats.aborted) return;
    const bw = h.bandwidthEstimate;
    if (!(bw > 0)) return;
    netBwBps = Math.min(BW_MAX, Math.max(BW_MIN, bw));
    if (!bwSaveT) bwSaveT = setTimeout(() => {
      bwSaveT = 0;
      try { localStorage.setItem('rs.bw', String(Math.round(netBwBps))); } catch {}
    }, 5000);
  });
  h.loadSource(s._hlsUrl);
  h.attachMedia(s._video);
  s._hls = h;
  s._hlsFails = 0;   // a fresh instance starts with a clean slate
  s._hlsErrAt = 0;
  liveHls.add(s);
  s._loadStarted = false;
  if (current) startWarm(s);
  s._video.muted = !soundOn;
}
function detachHls(s) {
  if (s._hls) { s._hls.destroy(); s._hls = null; liveHls.delete(s); }
}

let currentSlide = null;
const liveHls = new Set();
function releaseMedia(s, force) {
  detachHls(s);
  s._loadedOnce = false;                      // buffer is gone: the warm gate waits again
  const v = s._video; if (!v) return;
  s._gen = (s._gen || 0) + 1;                 // cancels in-flight setMp4Src/redgifs
  v.pause(); if (s._audio) s._audio.pause();  // keep audio src: its candidate walk can't re-arm
  const hadBlob = !!s._blobUrl;               // a revoked blob src must go even at preload=none
  if (hadBlob) { URL.revokeObjectURL(s._blobUrl); s._blobUrl = null; }
  if (v.getAttribute('src') && (force || hadBlob || v.preload !== 'none')) { v.removeAttribute('src'); v.load(); }
  v.preload = 'none';
}
function teardownSlide(s) {
  if (s._enter) logView(s, true);   // never a swipe: a tap on r/X, a refresh, a feed switch
  s._dead = true; io.unobserve(s); warmIO.unobserve(s); engageIO.unobserve(s);
  releaseMedia(s, true); clearTimeout(s._audChk);
  if (s._audio) { s._audio.removeAttribute('src'); s._audio.load(); }
}
function clearFeed() {
  for (const s of feed.children) teardownSlide(s);
  feed.replaceChildren();
  feed.scrollTop = 0;
  currentSlide = null;
  warmGateOpen = false;   // a new feed's first slide gets the bandwidth alone
  clearTimeout(warmGateTimer);
}
// Saved and single-sub mode park the 'my' feed instead of destroying it, so
// leaving them returns to the same slide without a refetch or reshuffle.
// Call before mode changes; any other mode (or an empty feed) is just cleared,
// so a refresh inside sub or saved mode never overwrites the stash.
function stashFeed() {
  if (mode !== 'my' || stash || !feed.children.length) return clearFeed();
  const nodes = [...feed.children];
  for (const s of nodes) {
    if (s._enter) logView(s, true);
    io.unobserve(s); warmIO.unobserve(s); engageIO.unobserve(s);   // re-observed by the MutationObserver on restore
    s._warm = false;
    releaseMedia(s);
  }
  stash = { nodes, top: feed.scrollTop, seen: new Set(seen) };   // enterSub clears seen
  feed.replaceChildren();
  feed.scrollTop = 0;
  currentSlide = null;
  warmGateOpen = false;
  clearTimeout(warmGateTimer);
}
function dropStash() { if (stash) { stash.nodes.forEach(teardownSlide); stash = null; } }
function restoreFeed() {
  if (!stash) return switchFeed(activeFeed);
  newBuild();
  clearFeed();
  const st = stash;
  stash = null;
  removeModePill();
  mode = 'my';
  currentSub = null;
  my.announced = gen;   // the persona toast already ran for this feed
  seen.clear();
  st.seen.forEach(id => seen.add(id));
  // saves and sound may have changed while parked (toggleSound only walks the live feed)
  for (const s of st.nodes) {
    if (s._saveBtn) paintSave(s._saveBtn, s._post.id);
    if (s._soundBtn) s._soundBtn.querySelector('.icon').textContent = soundOn ? '🔊' : '🔇';
  }
  feed.replaceChildren(...st.nodes);
  feed.scrollTop = st.top;
  rebuildTopbar();
  hideStatus();
  const g = gen;
  requestAnimationFrame(() => {
    if (g !== gen) return;
    feed.scrollTop = st.top;   // again once laid out: WebKit can drop the first set
    maybeLoadMore();           // the build that would have topped up the feed was dropped
  });
}
function onBecameCurrent(s) {
  currentSlide = s;
  armRedgifs(s);
  warmGateOpen = false;
  clearTimeout(warmGateTimer);
  if (!s._video || s._loadedOnce) openWarmGate();
  else warmGateTimer = setTimeout(openWarmGate, 2500);
  if (mp4Ctl) mp4Ctl.abort();   // background caching yields to the new slide
  trimBehind(s);
  // later items append here
}

// Bound the live DOM: slides more than 8 behind the current one become
// same-height placeholders (scroll position holds); warmIO rebuilds them from
// their post if the user scrolls back up.
function trimBehind(cur) {
  let n = cur, k = 0;
  while ((n = n.previousElementSibling)) {
    if (n.classList.contains('placeholder')) break;
    if (++k > 8) {
      const prev = n.previousElementSibling;
      teardownSlide(n);
      const ph = el('div', 'slide placeholder');
      ph._post = n._post;
      n.replaceWith(ph);
      n = ph;
      if (prev && prev.classList.contains('placeholder')) break;
    }
  }
}

function isCentered(s) {
  const r = s.getBoundingClientRect();
  return r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.5;
}
// redgifs resolve only once a slide is near; when the original can't be had,
// fall back to reddit's own (video-only) rehost instead of a frozen poster
function armRedgifs(s) {
  if (!s._rgId || s._mp4Url || s._rgPending || s._rgDone) return;
  s._rgPending = true;
  const rv = s._rv || {};
  resolveRedgifs(s._rgId).then(url => {
    if (s._dead) return;
    s._rgDone = true;
    const live = s._warm || s === currentSlide;   // out of range: warmIO arms it on approach
    if (url) {
      if (!live) { s._mp4Url = url; return; }
      return setMp4Src(s, s._video, url).then(() => { if (isCentered(s)) s._video.play().catch(() => {}); });
    }
    if (IS_SAFARI && rv.hls_url) {
      s._path = 'native-hls(rg-fallback)';
      s._src = rv.hls_url;
      if (live) s._video.src = rv.hls_url;
    } else if (rv.hls_url && window.Hls && Hls.isSupported()) {
      s._path = 'hls.js(rg-fallback)';
      s._hlsUrl = rv.hls_url;
      s._fallbackUrl = rv.fallback_url;
      if (live) {
        attachHls(s, s === currentSlide);
        if (s === currentSlide || warmGateOpen) startWarm(s);
      }
      // io sized liveHls before this instance existed
      if (s._hls && s === currentSlide) s._hls.config.maxBufferLength = FULL_BUFFER_S;
    } else if (rv.fallback_url) {
      armMp4(s, rv.fallback_url);
      // io's play() already fired 'play' before armMp4 hooked the side audio
      if (s._audio && soundOn && !s._video.paused) s._audio.play().catch(() => {});
    } else { setBadge(s, '⚠️ video unavailable'); return; }
    s._rgFallback = true;
    setBadge(s, '🔇 original unavailable');
    if (isCentered(s)) s._video.play().catch(() => {});
  }).catch(() => {}).finally(() => { s._rgPending = false; });
}

// Waterfall prefetch: once the CURRENT video is comfortably buffered, spend
// the now-idle bandwidth deepening the NEXT video instead of leaving it at
// the minimal warm buffer — so the next swipe starts instantly.
function nextVideoSlide(s) {
  let n = s.nextElementSibling;
  while (n && !n._video) n = n.nextElementSibling;   // skip stills
  return n;
}
function promoteNextSlide(s) {
  const next = nextVideoSlide(s);
  if (!next) return;
  armRedgifs(next);
  // beyond warm range warmIO would never tear a new instance down
  if (!next._hls && next.getBoundingClientRect().top > innerHeight * 2.5) return;
  if (next._hlsUrl) {
    attachHls(next);
    startWarm(next);
    if (next._hls && next._hls.config.maxBufferLength < 15) {
      next._hls.config.maxBufferLength = 15;
    }
  } else if (next._mp4Url && next._video.preload !== 'auto') {
    next._video.preload = 'auto';   // let the whole file stream down while idle
  }
}

// play/pause exactly the on-screen video
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    const s = e.target;
    // records queued before teardown still arrive; a placeholder never becomes
    // current (warmIO swaps it for a real slide first)
    if (s._dead || !s.isConnected || s.classList.contains('placeholder')) continue;
    if (e.isIntersecting && e.intersectionRatio >= 0.6 && s !== currentSlide) onBecameCurrent(s);
    if (!s._video) continue;
    if (e.isIntersecting && e.intersectionRatio >= 0.6) {
      s.classList.remove('paused');
      attachHls(s, true);
      startWarm(s);
      // this video gets the bandwidth: deep buffer for it, starve the others
      // back down to their instant-start buffer
      for (const other of liveHls) {
        other._hls.config.maxBufferLength = other === s ? FULL_BUFFER_S : WARM_BUFFER_S;
      }
      if (s._video.preload !== 'auto') s._video.preload = 'auto';
      if (!s._audio) s._video.muted = !soundOn;   // hls/native slides follow global sound
      // a released native-HLS slide: src must land before play(), or warmIO's
      // later re-arm aborts this play()
      if (s._src && !s._video.getAttribute('src')) s._video.src = s._src;
      const p = s._video.play();
      if (p) p.catch(err => {
        // WebKit (Safari/Orion) refuses unmuted programmatic play on elements
        // it hasn't user-activated — better muted than frozen. Any other
        // rejection (AbortError from a pause/src change) stays paused.
        if (!err || err.name !== 'NotAllowedError' || s !== currentSlide || s._video.muted) return;
        s._video.muted = true;
        s._video.play().catch(() => {});
      });
    } else {
      s._video.pause();
      if (s._audio) s._audio.pause();
      s._video.currentTime = 0;
    }
  }
}, { threshold: [0, 0.6] });

// engagement: how long a slide stays on screen and what happened while it did
const engageIO = new IntersectionObserver(es => {
  for (const e of es) {
    const s = e.target;
    if (s.classList.contains('placeholder')) continue;
    if (e.isIntersecting && e.intersectionRatio >= 0.6) {
      if (!s._enter && !s._dead && s.isConnected) startView(s);
    } else if (s._enter) logView(s);
  }
}, { threshold: [0, 0.6] });
// resumed: the tab came back mid-view, so leaving soon after is not a skip
function startView(s, resumed) {
  s._enter = performance.now();
  s._loops = 0;
  s._lastT = 0;
  s._ttff = s._video ? (s._loadedOnce ? 0 : null) : (s._img && s._img.complete && s._img.naturalWidth ? 0 : null);
  s._frames = s._frames || 1;
  s._resumed = !!resumed;
}

// Turns one view into a taste signal. Time only counts from the first frame,
// and a slow start is skipped: that is the network, not the viewer. A soft
// exit (a tap elsewhere, a hidden page) is never read as a skip.
function logView(s, soft) {
  const dwell = performance.now() - s._enter;
  s._enter = 0;
  const post = s._post;
  if (!post || s._mode === 'saved') return;
  if (dwell < 250) return;   // passed over by a programmatic scroll, not a choice
  if (s._ttff == null) return;   // never painted: neither a view nor a verdict
  const shown = dwell - s._ttff;
  if (shown > 1500) rememberSeen(post.id);
  if (s._ttff > 4000) return;
  let sig = 0;
  if (s._video) {
    const dur = (s._rv && s._rv.duration) || s._video.duration || 15;
    const frac = shown / 1000 / dur;
    const quick = Math.min(1500, dur * 900);   // a short clip seen through once is not a skip
    sig = shown < quick ? -1
      : (s._loops >= 1 || frac >= 0.9) ? 1 + 0.5 * Math.min(s._loops, 3)
      : Math.max(0, Math.min(frac, 0.9)) * 0.6;
  } else if (s._kind === 'gallery') {
    sig = shown < 800 ? -0.7 : 0.8 * s._frames / (s.querySelectorAll('.frame').length || 1);
  } else sig = shown < 800 ? -0.7 : shown > 4000 ? 0.6 : 0;
  if ((soft || s._resumed) && sig < 0) sig = 0;
  taste.event(post, sig);
}
// the flush listeners above ran before this view was logged; WebKit may never
// run their timers once backgrounded
document.addEventListener('visibilitychange', () => {
  const s = currentSlide;
  if (document.hidden) {
    if (s && s._enter) logView(s, true);
    if (tasteT) flushTaste();
    if (seenT) flushSeen();
  } else if (s && !s._enter && !s._dead && s.isConnected && isCentered(s)) startView(s, true);   // engageIO won't fire again for it
});

// warm-up: when a slide is within ~2.5 screens of the viewport, start
// downloading its video so it plays instantly when swiped to; when it
// drifts far away again, tear the hls instance down to free memory.
// Root is #feed: it is the scroller and clips the slides, so a viewport root's
// margin would never reach them.
const warmIO = new IntersectionObserver(entries => {
  for (const e of entries) {
    const s = e.target;
    if (s._dead || !s.isConnected) continue;   // incl. placeholders cleared by clearFeed, stashed slides
    if (e.isIntersecting && s.classList.contains('placeholder')) {
      warmIO.unobserve(s); io.unobserve(s); engageIO.unobserve(s);
      s._dead = true;   // a second record for it in this batch must not build again
      // the fallback is not a placeholder, so a post that no longer builds can't loop
      const ns = s._post && buildSlide(s._post);
      s.replaceWith(ns || el('div', 'slide'));   // the MutationObserver observes the new node
      continue;
    }
    // posters and blurred backdrops load only once a slide is in warm range
    if (e.isIntersecting) {
      if (s._bd && s._bdEl && !s._bdSet) { s._bdSet = true; s._bdEl.style.backgroundImage = `url("${s._bd}")`; }
      if (s._poster && s._video && !s._video.getAttribute('poster')) s._video.poster = s._poster;
    }
    const v = s._video;
    if (!v) continue;
    s._warm = e.isIntersecting;
    if (e.isIntersecting) {
      armRedgifs(s);
      if (s._hlsUrl) {
        attachHls(s);
        if (warmGateOpen) startWarm(s);   // else it parks with only its playlists
      } else {
        // slide coming back into range after a cold teardown — re-arm from cache
        if (!v.getAttribute('src')) {
          if (s._mp4Url) setMp4Src(s, v, s._mp4Url).then(() => {
            // io's play() can run before the src lands (e.g. a cached redgifs url)
            if (s === currentSlide && v.paused && v.getAttribute('src') && !s.classList.contains('paused')) v.play().catch(() => {});
          });
          else if (s._src) v.src = s._src;
        }
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
      // free decoder, buffers and blob; re-armed above if the slide ever
      // scrolls back into range
      releaseMedia(s);
      // a watched, saved mp4/redgifs video becomes a cache candidate now that
      // it's off-screen (the download still yields to every swipe)
      if (s._played && s._mp4Url && isSaved(s._post && s._post.id)) queueMp4Cache(s._mp4Url, s._post.id);
    }
  }
}, { root: feed, rootMargin: '150% 0px 150% 0px', threshold: 0 });

// WebKit (iPhone Safari/Orion) only lets a media element produce sound if a
// play() was ever issued on it DURING a user gesture. A swipe is a gesture:
// on every touch/pointer release, synchronously play()+pause() the nearby
// not-yet-blessed videos so they may autoplay WITH sound when swiped to.
// Chrome needs none of this. Each element is blessed once: the sync pause()
// always rejects play() with AbortError, so only NotAllowedError retries.
const NEEDS_BLESS = IS_SAFARI;
let lastBlessTs = -1;
function blessNearbyVideos(e) {
  if (!soundOn || !NEEDS_BLESS) return;
  if (e) {                                       // touchend + pointerup: one gesture
    if (e.timeStamp - lastBlessTs < 80) return;
    lastBlessTs = e.timeStamp;
  }
  const base = currentSlide || feed.firstElementChild;
  if (!base) return;
  const after = base.nextElementSibling;
  const near = [base.previousElementSibling, base, after, after && after.nextElementSibling];
  for (const s of near) {
    const v = s && s._video;
    if (!v) continue;
    const a = s._audio;                          // mp4+audio-el: separate element, blessed separately
    if (a && a.paused && !s._audioBlessed) {
      s._audioBlessed = true;
      if (!v.paused) a.currentTime = v.currentTime;
      const pa = a.play();
      if (v.paused) a.pause();                   // playing video: keep its sound running
      if (pa) pa.catch(err => { if (err && err.name === 'NotAllowedError') s._audioBlessed = false; });
    }
    if (s._blessed) continue;
    if (!v.paused) {                             // can't play()+pause() it without stopping it
      // muted after an autoplay refusal: leave it unblessed for a later gesture
      if (!v.muted || a) s._blessed = true;
      continue;
    }
    s._blessed = true;
    const p = v.play();                          // inside the gesture → grants sound
    v.pause();                                   // sync pause: no audible blip
    if (p) p.catch(err => { if (err && err.name === 'NotAllowedError') s._blessed = false; });
  }
}
feed.addEventListener('touchend', blessNearbyVideos, { passive: true });
feed.addEventListener('pointerup', blessNearbyVideos, { passive: true });

// recovery: if a browser silently stripped sound (blocked unmute), any click
// re-asserts it on whatever is currently playing
document.addEventListener('click', () => {
  if (!soundOn || !currentSlide) return;
  const s = currentSlide;
  if (s._video && !s._video.paused && !s._audio) s._video.muted = false;
});

new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (!n.classList) continue;
    io.observe(n);
    warmIO.observe(n);
    engageIO.observe(n);
  }
}).observe(feed, { childList: true });

function maybeLoadMore() {
  const remaining = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
  if (remaining < window.innerHeight * LOAD_MORE_AT) loadMore();
}
feed.addEventListener('scroll', maybeLoadMore, { passive: true });

/* ---------- desktop keyboard ---------- */
function stepSlide(dir) {
  const cur = currentSlide;
  const t = cur && (dir > 0 ? cur.nextElementSibling : cur.previousElementSibling);
  if (t) feed.scrollTo({ top: t.offsetTop, behavior: 'smooth' });
}
// a mouse or touch click must not leave a button focused (detail is 0 for Enter/Space),
// so a focused button below always means keyboard focus
document.addEventListener('click', e => {
  if (e.detail && document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
}, true);
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  // before the input check: Escape must close an overlay from its own checkboxes and fields
  const ov = document.querySelector('.editor-overlay');
  if (ov) {
    // every overlay closes on a click whose target is the backdrop itself
    if (e.key === 'Escape') { e.preventDefault(); ov.click(); return; }
    // keys aimed at the page behind must not re-fire its buttons
    if (!ov.contains(t) && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    if (e.key === 'Tab') {
      const f = [...ov.querySelectorAll('button, input, summary, [tabindex="0"]')].filter(x => x.getClientRects().length);
      const first = f[0], last = f[f.length - 1];
      if (first && (!ov.contains(t) || t === (e.shiftKey ? first : last))) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
    return;
  }
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const cur = currentSlide;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (k) {
    case 'ArrowDown': case 'j': case 'PageDown': if (!e.repeat) stepSlide(1); break;
    case 'ArrowUp': case 'k': case 'PageUp': if (!e.repeat) stepSlide(-1); break;
    // toggles ignore auto-repeat: a held key must not flip save or queue downloads
    case ' ':
      if (document.activeElement instanceof HTMLButtonElement) return;   // keyboard focus: native activation
      if (!e.repeat && cur?._video) cur.click();
      break;
    case 'm': if (!e.repeat) toggleSound(); break;
    case 's': if (!e.repeat) cur?._saveBtn?.click(); break;
    case 'd': if (!e.repeat) cur?._dlBtn?.click(); break;
    case 'r': if (!e.repeat) tryRefresh(); break;
    case 'ArrowLeft': case 'ArrowRight': {
      const car = cur?.querySelector('.carousel');
      if (car) pageCarousel(car, k === 'ArrowRight' ? 1 : -1);
      break;
    }
    default: return;
  }
  e.preventDefault();
  // a focused button would otherwise turn the next Space into its own click
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
});

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
