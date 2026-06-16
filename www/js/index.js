/* ================================================================
   WAVE — core application script
   ----------------------------------------------------------------
   This file contains:
     1. Configuration & constants (public API endpoints)
     2. Persistent state (localStorage)
     3. DOM references
     4. Utility helpers
     5. Audio extraction engine        -> getRawAudioStream()
     6. Lyrics engine                  -> fetchLyrics()
     7. Search engine                  -> searchTracks()
     8. Playlist import / parser       -> fetchPlaylistTracks()
     9. Rendering (home / library / lyrics / player)
    10. Playback engine (queue, shuffle, repeat)
    11. UI event wiring
    12. Cordova hooks (background-mode + music-controls)
   ----------------------------------------------------------------
   NOTE ON PUBLIC ENDPOINTS
   Cobalt (api.cobalt.tools) and Invidious instances are free,
   community-run services. Their availability, URLs and response
   formats change over time. If extraction or search stops working,
   update INVIDIOUS_INSTANCES below with currently-online instances
   from https://api.invidious.io/ and/or COBALT_API_URL with your
   own self-hosted Cobalt instance.
   ================================================================ */

/* ----------------------------------------------------------------
   1. CONFIGURATION
   ---------------------------------------------------------------- */
const COBALT_API_URL = 'https://api.cobalt.tools/';

const INVIDIOUS_INSTANCES = [
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://invidious.protokolla.fi',
  'https://iv.melmac.space',
  'https://invidious.privacyredirect.com'
];

const LYRIST_API_BASE = 'https://lyrist.vercel.app/api';
const LRCLIB_API_BASE = 'https://lrclib.net/api';

const STORAGE_KEYS = {
  LIKED: 'likedSongs',
  RECENT: 'recentlyPlayed',
  PLAYLISTS: 'customPlaylists'
};

/* ----------------------------------------------------------------
   2. PERSISTENT STATE
   ---------------------------------------------------------------- */
function safeParse(json, fallback) {
  try {
    const val = JSON.parse(json);
    return val == null ? fallback : val;
  } catch (e) {
    return fallback;
  }
}

let likedSongs = safeParse(localStorage.getItem(STORAGE_KEYS.LIKED), []);
let recentlyPlayed = safeParse(localStorage.getItem(STORAGE_KEYS.RECENT), []);
let customPlaylists = safeParse(localStorage.getItem(STORAGE_KEYS.PLAYLISTS), []);

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEYS.LIKED, JSON.stringify(likedSongs));
    localStorage.setItem(STORAGE_KEYS.RECENT, JSON.stringify(recentlyPlayed));
    localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(customPlaylists));
  } catch (err) {
    console.error('Failed to persist state to localStorage', err);
  }
}

/* ----------------------------------------------------------------
   3. DOM REFERENCES
   ---------------------------------------------------------------- */
const greetingEl = document.getElementById('greeting');

const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear');
const quickGrid = document.getElementById('quick-grid');
const resultsSection = document.getElementById('results-section');
const resultsTitle = document.getElementById('results-title');
const resultsClose = document.getElementById('results-close');
const searchResultsEl = document.getElementById('search-results');
const searchLoading = document.getElementById('search-loading');
const resultsEmpty = document.getElementById('results-empty');

const createPlaylistBtn = document.getElementById('create-playlist-btn');
const filterChips = Array.from(document.querySelectorAll('.chip'));
const likedFolder = document.getElementById('liked-folder');
const likedCountEl = document.getElementById('liked-count');
const playlistsSection = document.getElementById('playlists-section');
const playlistsListEl = document.getElementById('playlists-list');
const playlistsEmpty = document.getElementById('playlists-empty');
const artistsSection = document.getElementById('artists-section');
const artistsListEl = document.getElementById('artists-list');
const artistsEmpty = document.getElementById('artists-empty');
const albumsSection = document.getElementById('albums-section');
const recentSection = document.getElementById('recent-section');
const recentListEl = document.getElementById('recent-list');
const recentEmpty = document.getElementById('recent-empty');

const lyricsTrackTitle = document.getElementById('lyrics-track-title');
const lyricsTrackArtist = document.getElementById('lyrics-track-artist');
const lyricsContent = document.getElementById('lyrics-content');

const miniPlayer = document.getElementById('mini-player');
const miniProgressFill = document.getElementById('mini-progress-fill');
const miniThumb = document.getElementById('mini-thumb');
const miniTitle = document.getElementById('mini-title');
const miniArtist = document.getElementById('mini-artist');
const miniHeart = document.getElementById('mini-heart');
const miniPlayPause = document.getElementById('mini-play-pause');

const navItems = Array.from(document.querySelectorAll('.nav-item'));
const views = {
  home: document.getElementById('view-home'),
  library: document.getElementById('view-library'),
  lyrics: document.getElementById('view-lyrics')
};

const playerDrawer = document.getElementById('player-drawer');
const drawerClose = document.getElementById('drawer-close');
const drawerTopSource = document.getElementById('drawer-top-source');
const drawerArt = document.getElementById('drawer-art');
const drawerTitle = document.getElementById('drawer-title');
const drawerArtist = document.getElementById('drawer-artist');
const drawerHeart = document.getElementById('drawer-heart');
const progressSlider = document.getElementById('progress-slider');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const shuffleBtn = document.getElementById('shuffle-btn');
const prevBtn = document.getElementById('prev-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const nextBtn = document.getElementById('next-btn');
const repeatBtn = document.getElementById('repeat-btn');
const repeatOneDot = document.getElementById('repeat-one-dot');
const drawerLyricsBtn = document.getElementById('drawer-lyrics-btn');

const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');

const toastEl = document.getElementById('toast');

/* ----------------------------------------------------------------
   4. UTILITY HELPERS
   ---------------------------------------------------------------- */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function generateId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function isLikelyUrl(text) {
  return /^https?:\/\//i.test(text.trim());
}

function fetchWithTimeout(url, options, timeoutMs) {
  options = options || {};
  timeoutMs = timeoutMs || 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(() => clearTimeout(timer));
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toastEl.classList.add('hidden'), 3000);
}

function normalizeInvidiousItem(item) {
  return {
    videoId: item.videoId,
    title: item.title || 'Unknown title',
    artist: item.author || 'Unknown artist',
    thumbnail: 'https://i.ytimg.com/vi/' + item.videoId + '/hqdefault.jpg',
    duration: item.lengthSeconds || 0
  };
}

/* ================================================================
   5. DIRECT AUDIO EXTRACTION ENGINE
   ================================================================ */

/**
 * Attempts to resolve a direct, audio-only streamable URL for a
 * given YouTube video ID using the public Cobalt API.
 */
async function tryCobalt(videoId) {
  const youtubeUrl = 'https://www.youtube.com/watch?v=' + videoId;
  const res = await fetchWithTimeout(COBALT_API_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: youtubeUrl,
      downloadMode: 'audio',
      audioFormat: 'best',
      filenameStyle: 'basic'
    })
  }, 12000);

  if (!res.ok) {
    throw new Error('Cobalt HTTP ' + res.status);
  }

  const data = await res.json();

  if ((data.status === 'tunnel' || data.status === 'redirect' || data.status === 'stream') && data.url) {
    return data.url;
  }

  if (data.status === 'picker' && Array.isArray(data.picker) && data.picker.length) {
    const audioItem = data.picker.find(p => p.type === 'audio') || data.picker[0];
    if (audioItem && audioItem.url) return audioItem.url;
  }

  throw new Error('Cobalt response: ' + (data.error ? JSON.stringify(data.error) : data.status));
}

/**
 * Fallback extractor: queries a list of public Invidious instances
 * for the adaptive (DASH) formats of the video and returns the
 * highest-bitrate audio-only stream URL (.webm / .m4a).
 */
async function tryInvidious(videoId) {
  let lastError = null;

  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetchWithTimeout(base + '/api/v1/videos/' + videoId, {}, 9000);
      if (!res.ok) {
        lastError = new Error(base + ' responded HTTP ' + res.status);
        continue;
      }

      const data = await res.json();
      const formats = data.adaptiveFormats || [];
      const audioFormats = formats.filter(f => f.type && f.type.indexOf('audio/') === 0);

      if (!audioFormats.length) {
        lastError = new Error(base + ' returned no audio-only formats');
        continue;
      }

      audioFormats.sort((a, b) => (parseInt(b.bitrate || 0, 10)) - (parseInt(a.bitrate || 0, 10)));

      if (audioFormats[0].url) {
        return audioFormats[0].url;
      }

      lastError = new Error(base + ' audio format missing url');
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('All Invidious instances failed');
}

/**
 * Public entry point: resolves a raw, audio-only stream URL for a
 * YouTube video ID. Tries Cobalt first (cleanest single-file
 * results), then falls back to Invidious adaptive formats.
 *
 * Returns the stream URL string, or null if every source failed.
 */
async function getRawAudioStream(videoId) {
  try {
    const url = await tryCobalt(videoId);
    if (url) return url;
  } catch (err) {
    console.warn('[audio] Cobalt extraction failed, falling back to Invidious:', err.message);
  }

  try {
    const url = await tryInvidious(videoId);
    if (url) return url;
  } catch (err) {
    console.error('[audio] Invidious extraction failed:', err.message);
  }

  return null;
}

/* ================================================================
   6. LIVE LYRICS ENGINE
   ================================================================ */

/**
 * Parses an LRC-formatted lyric block into an array of
 * { time: <seconds>, text: <line> } objects sorted by time.
 */
function parseLRC(lrcText) {
  const timeTag = /\[(\d{2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const lines = lrcText.split(/\r?\n/);
  const out = [];

  for (const rawLine of lines) {
    const matches = Array.from(rawLine.matchAll(timeTag));
    if (!matches.length) continue;

    const text = rawLine.replace(timeTag, '').trim();

    for (const m of matches) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      let fraction = 0;
      if (m[3]) {
        const frac = m[3].length === 1 ? m[3] + '00' : m[3].padEnd(3, '0');
        fraction = parseInt(frac, 10) / 1000;
      }
      out.push({ time: (minutes * 60) + seconds + fraction, text });
    }
  }

  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * Fetches lyrics for a track. Returns:
 *   { synced: [{time, text}, ...], lines: null }  - time-synced lyrics
 *   { synced: null, lines: ["line1", "line2"] }    - plain text lyrics
 *   null                                            - no lyrics found
 */
async function fetchLyrics(trackTitle, artistName) {
  const cleanTitle = (trackTitle || '').replace(/\(.*?\)|\[.*?\]/g, '').trim();
  const cleanArtist = (artistName || '').trim();

  // 1. LRCLIB — supports time-synced (.lrc) lyrics
  try {
    const url = LRCLIB_API_BASE + '/get?track_name=' + encodeURIComponent(cleanTitle) +
      '&artist_name=' + encodeURIComponent(cleanArtist);
    const res = await fetchWithTimeout(url, {}, 8000);
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics) {
        const synced = parseLRC(data.syncedLyrics);
        if (synced.length) return { synced, lines: null };
      }
      if (data.plainLyrics) {
        const lines = data.plainLyrics.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
        if (lines.length) return { synced: null, lines };
      }
    }
  } catch (err) {
    console.warn('[lyrics] LRCLIB direct lookup failed:', err.message);
  }

  // 2. LRCLIB search — looser match fallback
  try {
    const url = LRCLIB_API_BASE + '/search?track_name=' + encodeURIComponent(cleanTitle) +
      '&artist_name=' + encodeURIComponent(cleanArtist);
    const res = await fetchWithTimeout(url, {}, 8000);
    if (res.ok) {
      const results = await res.json();
      if (Array.isArray(results) && results.length) {
        const best = results[0];
        if (best.syncedLyrics) {
          const synced = parseLRC(best.syncedLyrics);
          if (synced.length) return { synced, lines: null };
        }
        if (best.plainLyrics) {
          const lines = best.plainLyrics.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
          if (lines.length) return { synced: null, lines };
        }
      }
    }
  } catch (err) {
    console.warn('[lyrics] LRCLIB search failed:', err.message);
  }

  // 3. Lyrist — plain-text fallback
  try {
    const url = LYRIST_API_BASE + '/' + encodeURIComponent(cleanTitle) + '/' + encodeURIComponent(cleanArtist);
    const res = await fetchWithTimeout(url, {}, 8000);
    if (res.ok) {
      const data = await res.json();
      if (data && data.lyrics && data.lyrics.trim().length) {
        const lines = data.lyrics.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
        if (lines.length) return { synced: null, lines };
      }
    }
  } catch (err) {
    console.warn('[lyrics] Lyrist lookup failed:', err.message);
  }

  return null;
}

/* ================================================================
   7. SEARCH ENGINE (YouTube Music via Invidious)
   ================================================================ */
async function searchTracks(query) {
  let lastError = null;

  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const url = base + '/api/v1/search?q=' + encodeURIComponent(query) + '&type=video';
      const res = await fetchWithTimeout(url, {}, 9000);
      if (!res.ok) {
        lastError = new Error(base + ' responded HTTP ' + res.status);
        continue;
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        lastError = new Error(base + ' returned an unexpected response');
        continue;
      }

      return data
        .filter(item => item.type === 'video' && item.videoId)
        .map(normalizeInvidiousItem);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('All search instances failed');
}

/* ================================================================
   8. PLAYLIST IMPORT / PARSER
   ================================================================ */
function extractPlaylistId(text) {
  const match = text.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function fetchPlaylistTracks(playlistId) {
  let lastError = null;

  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetchWithTimeout(base + '/api/v1/playlists/' + playlistId, {}, 12000);
      if (!res.ok) {
        lastError = new Error(base + ' responded HTTP ' + res.status);
        continue;
      }

      const data = await res.json();
      if (!Array.isArray(data.videos)) {
        lastError = new Error(base + ' returned no videos array');
        continue;
      }

      return {
        title: data.title || 'Imported Playlist',
        tracks: data.videos.filter(v => v.videoId).map(normalizeInvidiousItem)
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('All playlist instances failed');
}

/* ================================================================
   9. PLAYBACK STATE
   ================================================================ */
const audioPlayer = new Audio();
audioPlayer.preload = 'auto';

let currentTrack = null;
let queue = [];
let queueIndex = -1;
let queueSourceLabel = 'Search';
let isShuffle = false;
let repeatMode = 'off'; // 'off' | 'all' | 'one'
let currentLyrics = { synced: null, lines: null };
let isSeeking = false;

/* ================================================================
   10. LIBRARY HELPERS (liked songs / recently played / playlists)
   ================================================================ */
function isLiked(videoId) {
  return likedSongs.some(t => t.videoId === videoId);
}

function toggleLike(track) {
  const idx = likedSongs.findIndex(t => t.videoId === track.videoId);
  if (idx >= 0) {
    likedSongs.splice(idx, 1);
  } else {
    likedSongs.unshift(track);
  }
  saveState();
  updateHeartButtons();
  renderLibrary();
}

function addToRecentlyPlayed(track) {
  recentlyPlayed = recentlyPlayed.filter(t => t.videoId !== track.videoId);
  recentlyPlayed.unshift(track);
  if (recentlyPlayed.length > 50) recentlyPlayed = recentlyPlayed.slice(0, 50);
  saveState();
}

/* ================================================================
   11. RENDERING — HOME / RESULTS
   ================================================================ */
function buildTrackRow(track, contextQueue, sourceLabel) {
  const row = document.createElement('div');
  row.className = 'result-item';

  const main = document.createElement('button');
  main.className = 'result-main';
  main.dataset.videoId = track.videoId;

  const img = document.createElement('img');
  img.className = 'result-thumb';
  img.src = track.thumbnail;
  img.loading = 'lazy';
  img.alt = '';

  const info = document.createElement('div');
  info.className = 'result-info';

  const titleEl = document.createElement('span');
  titleEl.className = 'result-title';
  titleEl.textContent = track.title;
  if (currentTrack && currentTrack.videoId === track.videoId) {
    titleEl.classList.add('playing');
  }

  const artistEl = document.createElement('span');
  artistEl.className = 'result-artist';
  artistEl.textContent = track.artist;

  info.appendChild(titleEl);
  info.appendChild(artistEl);
  main.appendChild(img);
  main.appendChild(info);
  main.addEventListener('click', () => playTrack(track, contextQueue, sourceLabel));

  const addBtn = document.createElement('button');
  addBtn.className = 'result-add-btn';
  addBtn.setAttribute('aria-label', 'Add to playlist');
  addBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openAddToPlaylistModal(track);
  });

  row.appendChild(main);
  row.appendChild(addBtn);
  return row;
}

function renderResultsList(tracks, sourceLabel) {
  searchResultsEl.innerHTML = '';
  resultsEmpty.classList.toggle('hidden', tracks.length > 0);
  tracks.forEach(track => searchResultsEl.appendChild(buildTrackRow(track, tracks, sourceLabel)));
}

function showResults(title, tracks, sourceLabel) {
  quickGrid.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  searchLoading.classList.add('hidden');
  resultsTitle.textContent = title;
  renderResultsList(tracks, sourceLabel);
}

function hideResults() {
  resultsSection.classList.add('hidden');
  quickGrid.classList.remove('hidden');
  searchInput.value = '';
  searchClearBtn.classList.add('hidden');
  searchResultsEl.innerHTML = '';
}

function refreshPlayingHighlight() {
  document.querySelectorAll('#search-results .result-main').forEach(el => {
    const titleEl = el.querySelector('.result-title');
    const isPlaying = !!currentTrack && el.dataset.videoId === currentTrack.videoId;
    titleEl.classList.toggle('playing', isPlaying);
  });
}

/* ================================================================
   12. RENDERING — LIBRARY
   ================================================================ */
function buildPlaylistRow(playlist) {
  const btn = document.createElement('button');
  btn.className = 'library-item';

  let thumb;
  if (playlist.tracks.length) {
    thumb = document.createElement('div');
    thumb.className = 'library-thumb-grid';
    playlist.tracks.slice(0, 4).forEach(t => {
      const img = document.createElement('img');
      img.src = t.thumbnail;
      img.alt = '';
      thumb.appendChild(img);
    });
    while (thumb.children.length < 4) {
      thumb.appendChild(document.createElement('div'));
    }
  } else {
    thumb = document.createElement('div');
    thumb.className = 'library-thumb';
  }

  const info = document.createElement('div');
  info.className = 'library-item-info';

  const title = document.createElement('span');
  title.className = 'library-item-title';
  title.textContent = playlist.name;

  const sub = document.createElement('span');
  sub.className = 'library-item-sub';
  sub.textContent = 'Playlist • ' + playlist.tracks.length + (playlist.tracks.length === 1 ? ' song' : ' songs');

  info.appendChild(title);
  info.appendChild(sub);
  btn.appendChild(thumb);
  btn.appendChild(info);

  btn.addEventListener('click', () => {
    showResults(playlist.name, playlist.tracks, playlist.name);
    switchView('home');
  });

  return btn;
}

function buildRecentRow(track) {
  const btn = document.createElement('button');
  btn.className = 'library-item';

  const img = document.createElement('img');
  img.className = 'library-thumb';
  img.src = track.thumbnail;
  img.alt = '';

  const info = document.createElement('div');
  info.className = 'library-item-info';

  const title = document.createElement('span');
  title.className = 'library-item-title';
  title.textContent = track.title;

  const sub = document.createElement('span');
  sub.className = 'library-item-sub';
  sub.textContent = track.artist;

  info.appendChild(title);
  info.appendChild(sub);
  btn.appendChild(img);
  btn.appendChild(info);

  btn.addEventListener('click', () => playTrack(track, recentlyPlayed, 'Recently Played'));
  return btn;
}

function buildArtistRow(name, tracks) {
  const btn = document.createElement('button');
  btn.className = 'library-item';

  const icon = document.createElement('div');
  icon.className = 'folder-icon';
  icon.style.background = 'var(--bg-highlight)';
  icon.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';

  const info = document.createElement('div');
  info.className = 'library-item-info';

  const title = document.createElement('span');
  title.className = 'library-item-title';
  title.textContent = name;

  const sub = document.createElement('span');
  sub.className = 'library-item-sub';
  sub.textContent = 'Artist • ' + tracks.length + (tracks.length === 1 ? ' song' : ' songs');

  info.appendChild(title);
  info.appendChild(sub);
  btn.appendChild(icon);
  btn.appendChild(info);

  btn.addEventListener('click', () => {
    showResults(name, tracks, name);
    switchView('home');
  });

  return btn;
}

function renderArtists() {
  const map = new Map();
  const pool = [...likedSongs, ...recentlyPlayed, ...customPlaylists.flatMap(p => p.tracks)];

  pool.forEach(track => {
    const key = track.artist || 'Unknown artist';
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    if (!list.some(t => t.videoId === track.videoId)) list.push(track);
  });

  artistsListEl.innerHTML = '';
  const artists = Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  artists.forEach(([name, tracks]) => artistsListEl.appendChild(buildArtistRow(name, tracks)));
  artistsEmpty.classList.toggle('hidden', artists.length > 0);
}

function renderLibrary() {
  likedCountEl.textContent = 'Playlist • ' + likedSongs.length + (likedSongs.length === 1 ? ' song' : ' songs');

  playlistsListEl.innerHTML = '';
  customPlaylists.forEach(pl => playlistsListEl.appendChild(buildPlaylistRow(pl)));
  playlistsEmpty.classList.toggle('hidden', customPlaylists.length > 0);

  recentListEl.innerHTML = '';
  recentlyPlayed.slice(0, 25).forEach(track => recentListEl.appendChild(buildRecentRow(track)));
  recentEmpty.classList.toggle('hidden', recentlyPlayed.length > 0);

  renderArtists();
}

/* ================================================================
   13. RENDERING — LYRICS
   ================================================================ */
function renderLyricsContent() {
  lyricsContent.innerHTML = '';

  if (currentLyrics.synced) {
    currentLyrics.synced.forEach((line, idx) => {
      const p = document.createElement('p');
      p.className = 'lyrics-line';
      p.textContent = line.text || '•';
      p.dataset.index = String(idx);
      lyricsContent.appendChild(p);
    });
    return;
  }

  if (currentLyrics.lines) {
    currentLyrics.lines.forEach(line => {
      const p = document.createElement('p');
      p.className = 'lyrics-line active';
      p.textContent = line;
      lyricsContent.appendChild(p);
    });
    return;
  }

  lyricsContent.innerHTML = '<p class="lyrics-placeholder">No lyrics found for this track.</p>';
}

function updateLyricsHighlight(currentTimeSec) {
  if (!currentLyrics.synced) return;

  const lineEls = lyricsContent.querySelectorAll('.lyrics-line');
  if (!lineEls.length) return;

  let activeIdx = -1;
  for (let i = 0; i < currentLyrics.synced.length; i++) {
    if (currentTimeSec >= currentLyrics.synced[i].time) activeIdx = i;
    else break;
  }

  lineEls.forEach((el, idx) => el.classList.toggle('active', idx === activeIdx));

  if (activeIdx >= 0 && views.lyrics.classList.contains('active')) {
    lineEls[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function loadLyricsForTrack(track) {
  currentLyrics = { synced: null, lines: null };
  lyricsContent.innerHTML = '<p class="lyrics-loading">Loading lyrics…</p>';

  try {
    const result = await fetchLyrics(track.title, track.artist);
    if (!result) {
      lyricsContent.innerHTML = '<p class="lyrics-placeholder">No lyrics found for this track.</p>';
      return;
    }
    currentLyrics = result;
    renderLyricsContent();
  } catch (err) {
    console.error('[lyrics] failed to load:', err);
    lyricsContent.innerHTML = '<p class="lyrics-placeholder">Lyrics unavailable right now.</p>';
  }
}

/* ================================================================
   14. NOW-PLAYING UI (mini player + drawer + lyrics header)
   ================================================================ */
function updateHeartButtons() {
  const liked = currentTrack ? isLiked(currentTrack.videoId) : false;
  miniHeart.classList.toggle('active', liked);
  drawerHeart.classList.toggle('active', liked);
}

function showMiniPlayer() {
  miniPlayer.classList.remove('hidden');
}

function updateNowPlayingUI() {
  if (!currentTrack) return;

  miniThumb.src = currentTrack.thumbnail;
  miniTitle.textContent = currentTrack.title;
  miniArtist.textContent = currentTrack.artist;

  drawerArt.src = currentTrack.thumbnail;
  drawerTitle.textContent = currentTrack.title;
  drawerArtist.textContent = currentTrack.artist;
  drawerTopSource.textContent = queueSourceLabel;

  lyricsTrackTitle.textContent = currentTrack.title;
  lyricsTrackArtist.textContent = currentTrack.artist;

  updateHeartButtons();
  refreshPlayingHighlight();
}

function setLoadingState(isLoading) {
  miniPlayPause.classList.toggle('loading', isLoading);
  playPauseBtn.classList.toggle('loading', isLoading);
}

/* ================================================================
   15. PLAYBACK ENGINE
   ================================================================ */
async function loadTrack(track) {
  currentTrack = track;
  addToRecentlyPlayed(track);
  showMiniPlayer();
  updateNowPlayingUI();
  renderLibrary();
  setLoadingState(true);

  audioPlayer.pause();
  audioPlayer.removeAttribute('src');
  audioPlayer.load();

  try {
    const streamUrl = await getRawAudioStream(track.videoId);
    if (!streamUrl) throw new Error('No playable audio stream found.');
    audioPlayer.src = streamUrl;
    await audioPlayer.play();
  } catch (err) {
    console.error('[playback] failed to load track:', err);
    showToast('Could not load audio for "' + track.title + '".');
  } finally {
    setLoadingState(false);
  }

  updateMusicControlsMeta(track);
  loadLyricsForTrack(track);
}

function playTrack(track, contextQueue, sourceLabel) {
  if (contextQueue && contextQueue.length) {
    queue = contextQueue.slice();
    queueIndex = queue.findIndex(t => t.videoId === track.videoId);
    if (queueIndex === -1) {
      queue.unshift(track);
      queueIndex = 0;
    }
  } else {
    queue = [track];
    queueIndex = 0;
  }

  if (sourceLabel) queueSourceLabel = sourceLabel;
  loadTrack(track);
}

function togglePlayPause() {
  if (!currentTrack) return;
  if (audioPlayer.paused) {
    audioPlayer.play().catch(err => console.warn('[playback] resume failed', err));
  } else {
    audioPlayer.pause();
  }
}

function playNext(isAutoAdvance) {
  if (!queue.length) return;

  let nextIndex;
  if (isShuffle) {
    if (queue.length === 1) {
      nextIndex = 0;
    } else {
      do {
        nextIndex = Math.floor(Math.random() * queue.length);
      } while (nextIndex === queueIndex);
    }
  } else {
    nextIndex = queueIndex + 1;
    if (nextIndex >= queue.length) {
      if (repeatMode === 'all') {
        nextIndex = 0;
      } else if (isAutoAdvance) {
        audioPlayer.pause();
        return;
      } else {
        nextIndex = 0;
      }
    }
  }

  queueIndex = nextIndex;
  loadTrack(queue[queueIndex]);
}

function playPrevious() {
  if (!queue.length) return;

  if (audioPlayer.currentTime > 3) {
    audioPlayer.currentTime = 0;
    return;
  }

  let prevIndex = queueIndex - 1;
  if (prevIndex < 0) {
    if (isShuffle) {
      prevIndex = Math.floor(Math.random() * queue.length);
    } else if (repeatMode === 'all') {
      prevIndex = queue.length - 1;
    } else {
      prevIndex = 0;
    }
  }

  queueIndex = prevIndex;
  loadTrack(queue[queueIndex]);
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  shuffleBtn.classList.toggle('active', isShuffle);
}

function cycleRepeat() {
  if (repeatMode === 'off') repeatMode = 'all';
  else if (repeatMode === 'all') repeatMode = 'one';
  else repeatMode = 'off';

  repeatBtn.classList.toggle('active', repeatMode !== 'off');
  repeatOneDot.classList.toggle('hidden', repeatMode !== 'one');
}

/* ----- audio element event wiring -------------------------------- */
audioPlayer.addEventListener('play', () => {
  miniPlayPause.classList.add('is-playing');
  playPauseBtn.classList.add('is-playing');
  updateMusicControlsPlaybackState(true);
});

audioPlayer.addEventListener('pause', () => {
  miniPlayPause.classList.remove('is-playing');
  playPauseBtn.classList.remove('is-playing');
  updateMusicControlsPlaybackState(false);
});

audioPlayer.addEventListener('timeupdate', () => {
  const duration = audioPlayer.duration || (currentTrack && currentTrack.duration) || 0;
  const current = audioPlayer.currentTime || 0;
  const pct = duration ? (current / duration) * 100 : 0;

  miniProgressFill.style.width = pct + '%';

  if (!isSeeking) {
    progressSlider.value = String(duration ? (current / duration) * 1000 : 0);
    progressSlider.style.setProperty('--progress', pct + '%');
    currentTimeEl.textContent = formatTime(current);
  }

  totalTimeEl.textContent = formatTime(duration);
  updateLyricsHighlight(current);
});

audioPlayer.addEventListener('loadedmetadata', () => {
  totalTimeEl.textContent = formatTime(audioPlayer.duration || 0);
});

audioPlayer.addEventListener('ended', () => {
  if (repeatMode === 'one') {
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => {});
    return;
  }
  playNext(true);
});

audioPlayer.addEventListener('error', () => {
  console.error('[audio] element error', audioPlayer.error);
});

/* ----- progress slider (seek) ------------------------------------- */
progressSlider.addEventListener('input', () => {
  isSeeking = true;
  const pct = Number(progressSlider.value) / 1000;
  progressSlider.style.setProperty('--progress', (pct * 100) + '%');
  const duration = audioPlayer.duration || (currentTrack && currentTrack.duration) || 0;
  currentTimeEl.textContent = formatTime(pct * duration);
});

progressSlider.addEventListener('change', () => {
  const duration = audioPlayer.duration || (currentTrack && currentTrack.duration) || 0;
  if (duration) {
    audioPlayer.currentTime = (Number(progressSlider.value) / 1000) * duration;
  }
  isSeeking = false;
});

/* ================================================================
   16. NAVIGATION
   ================================================================ */
function switchView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
  navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
}

navItems.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

/* ================================================================
   17. PLAYER DRAWER
   ================================================================ */
function openDrawer() {
  if (!currentTrack) return;
  playerDrawer.classList.add('open');
}

function closeDrawer() {
  playerDrawer.classList.remove('open');
}

miniPlayer.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);

drawerLyricsBtn.addEventListener('click', () => {
  closeDrawer();
  switchView('lyrics');
});

/* ================================================================
   18. TRANSPORT CONTROLS
   ================================================================ */
miniPlayPause.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlayPause();
});

[miniHeart, drawerHeart].forEach(btn => btn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentTrack) toggleLike(currentTrack);
}));

playPauseBtn.addEventListener('click', togglePlayPause);
prevBtn.addEventListener('click', playPrevious);
nextBtn.addEventListener('click', () => playNext(false));
shuffleBtn.addEventListener('click', toggleShuffle);
repeatBtn.addEventListener('click', cycleRepeat);

/* ================================================================
   19. MODAL (create playlist / add to playlist)
   ================================================================ */
let modalConfirmHandler = null;

function openModal(title, bodyEl, onConfirm, confirmLabel) {
  modalTitle.textContent = title;
  modalBody.innerHTML = '';
  modalBody.appendChild(bodyEl);
  modalConfirm.textContent = confirmLabel || 'Done';
  modalOverlay.classList.remove('hidden');
  modalConfirmHandler = onConfirm;
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  modalBody.innerHTML = '';
  modalConfirmHandler = null;
}

modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});
modalConfirm.addEventListener('click', () => {
  if (modalConfirmHandler) modalConfirmHandler();
});

function promptForPlaylistName(initialTrack) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'modal-input';
  input.placeholder = 'Playlist name';

  openModal('Create playlist', input, () => {
    const name = input.value.trim();
    if (!name) return;
    const playlist = {
      id: generateId(),
      name,
      tracks: initialTrack ? [initialTrack] : [],
      source: 'local',
      createdAt: Date.now()
    };
    customPlaylists.unshift(playlist);
    saveState();
    renderLibrary();
    closeModal();
    showToast('Created "' + name + '"' + (initialTrack ? ' and added track' : ''));
  }, 'Create');

  setTimeout(() => input.focus(), 50);
}

createPlaylistBtn.addEventListener('click', () => promptForPlaylistName(null));

function openAddToPlaylistModal(track) {
  const wrap = document.createElement('div');

  if (!customPlaylists.length) {
    const p = document.createElement('p');
    p.className = 'empty-text';
    p.textContent = 'You have no playlists yet.';
    wrap.appendChild(p);
  }

  customPlaylists.forEach(pl => {
    const item = document.createElement('button');
    item.className = 'modal-list-item';
    item.textContent = pl.name;
    item.addEventListener('click', () => {
      if (pl.tracks.some(t => t.videoId === track.videoId)) {
        showToast('Already in "' + pl.name + '"');
      } else {
        pl.tracks.push(track);
        saveState();
        renderLibrary();
        showToast('Added to "' + pl.name + '"');
      }
      closeModal();
    });
    wrap.appendChild(item);
  });

  const newItem = document.createElement('button');
  newItem.className = 'modal-list-item';
  newItem.style.color = 'var(--accent-green)';
  newItem.textContent = '+ New playlist';
  newItem.addEventListener('click', () => {
    closeModal();
    promptForPlaylistName(track);
  });
  wrap.appendChild(newItem);

  openModal('Add to playlist', wrap, closeModal, 'Close');
}

/* ================================================================
   20. LIBRARY VIEW INTERACTIONS
   ================================================================ */
likedFolder.addEventListener('click', () => {
  showResults('Liked Songs', likedSongs, 'Liked Songs');
  switchView('home');
});

filterChips.forEach(chip => chip.addEventListener('click', () => {
  filterChips.forEach(c => c.classList.toggle('active', c === chip));
  const filter = chip.dataset.filter;

  likedFolder.classList.toggle('hidden', !(filter === 'all' || filter === 'playlists'));
  playlistsSection.classList.toggle('hidden', !(filter === 'all' || filter === 'playlists'));
  artistsSection.classList.toggle('hidden', !(filter === 'all' || filter === 'artists'));
  albumsSection.classList.toggle('hidden', filter !== 'albums');
  recentSection.classList.toggle('hidden', filter !== 'all');
}));

/* ================================================================
   21. HOME VIEW INTERACTIONS (quick grid / search / playlist import)
   ================================================================ */
quickGrid.addEventListener('click', (e) => {
  const tile = e.target.closest('.grid-tile');
  if (!tile) return;

  if (tile.dataset.action === 'liked-songs') {
    showResults('Liked Songs', likedSongs, 'Liked Songs');
  } else if (tile.dataset.action === 'recently-played') {
    showResults('Recently Played', recentlyPlayed, 'Recently Played');
  } else if (tile.dataset.mixQuery) {
    searchInput.value = '';
    runSearch(tile.dataset.mixQuery);
  }
});

async function runSearch(query) {
  quickGrid.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  resultsTitle.textContent = 'Results for "' + query + '"';
  resultsEmpty.classList.add('hidden');
  searchResultsEl.innerHTML = '';
  searchLoading.classList.remove('hidden');

  try {
    const results = await searchTracks(query);
    renderResultsList(results, 'Search: ' + query);
  } catch (err) {
    console.error('[search] failed:', err);
    resultsEmpty.textContent = 'Search failed. Check your connection and try again.';
    resultsEmpty.classList.remove('hidden');
    showToast('Search failed. Please try again.');
  } finally {
    searchLoading.classList.add('hidden');
  }
}

async function handlePlaylistImport(playlistId) {
  quickGrid.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  resultsTitle.textContent = 'Importing playlist…';
  resultsEmpty.classList.add('hidden');
  searchResultsEl.innerHTML = '';
  searchLoading.classList.remove('hidden');

  try {
    const { title, tracks } = await fetchPlaylistTracks(playlistId);
    if (!tracks.length) throw new Error('Playlist is empty or unavailable.');

    let playlist = customPlaylists.find(p => p.sourceId === playlistId);
    if (playlist) {
      playlist.tracks = tracks;
      playlist.name = title;
    } else {
      playlist = {
        id: generateId(),
        name: title,
        tracks,
        source: 'youtube',
        sourceId: playlistId,
        createdAt: Date.now()
      };
      customPlaylists.unshift(playlist);
    }

    saveState();
    renderLibrary();

    resultsTitle.textContent = 'Imported: ' + title;
    renderResultsList(tracks, title);
    showToast('Imported "' + title + '" — ' + tracks.length + ' tracks');
  } catch (err) {
    console.error('[playlist import] failed:', err);
    resultsTitle.textContent = 'Import failed';
    resultsEmpty.textContent = 'Could not import this playlist. It may be private or unavailable.';
    resultsEmpty.classList.remove('hidden');
  } finally {
    searchLoading.classList.add('hidden');
  }
}

const debouncedSearchInput = debounce(handleSearchInputValue, 500);

async function handleSearchInputValue(value) {
  if (!value) {
    hideResults();
    return;
  }

  if (isLikelyUrl(value)) {
    const playlistId = extractPlaylistId(value);
    if (playlistId) {
      await handlePlaylistImport(playlistId);
      return;
    }
  }

  await runSearch(value);
}

searchInput.addEventListener('input', () => {
  const value = searchInput.value.trim();
  searchClearBtn.classList.toggle('hidden', !value);
  debouncedSearchInput(value);
});

searchClearBtn.addEventListener('click', hideResults);
resultsClose.addEventListener('click', hideResults);

/* ================================================================
   22. CORDOVA INTEGRATION
   ================================================================ */
document.addEventListener('deviceready', onDeviceReady, false);

function onDeviceReady() {
  initBackgroundMode();
  initMusicControls();
}

function initBackgroundMode() {
  if (!(window.cordova && cordova.plugins && cordova.plugins.backgroundMode)) {
    console.warn('[cordova] background-mode plugin not available');
    return;
  }

  const bgMode = cordova.plugins.backgroundMode;

  bgMode.setDefaults({
    title: 'Wave',
    text: 'Playing music',
    icon: 'icon',
    color: '1DB954',
    resume: true,
    hidden: false,
    bigText: false,
    silent: false
  });

  bgMode.enable();

  bgMode.on('activate', () => {
    bgMode.disableWebViewOptimizations();
    if (typeof bgMode.disableBatteryOptimizations === 'function') {
      bgMode.disableBatteryOptimizations();
    }
  });

  document.addEventListener('pause', () => {
    if (!bgMode.isEnabled()) bgMode.enable();
  }, false);
}

function initMusicControls() {
  if (!window.MusicControls) {
    console.warn('[cordova] music-controls plugin not available');
    return;
  }

  MusicControls.subscribe(handleMusicControlsAction);
  MusicControls.listen();

  setInterval(() => {
    if (currentTrack && !audioPlayer.paused) {
      MusicControls.updateElapsed({
        elapsed: audioPlayer.currentTime || 0,
        isPlaying: true
      });
    }
  }, 15000);
}

function handleMusicControlsAction(action) {
  let parsed;
  try {
    parsed = JSON.parse(action);
  } catch (err) {
    parsed = { message: action };
  }

  switch (parsed.message) {
    case 'music-controls-next':
    case 'music-controls-media-button-next':
      playNext(false);
      break;

    case 'music-controls-previous':
    case 'music-controls-media-button-previous':
      playPrevious();
      break;

    case 'music-controls-play':
    case 'music-controls-pause':
    case 'music-controls-media-button-play':
    case 'music-controls-media-button-pause':
    case 'music-controls-media-button-play-pause':
      togglePlayPause();
      break;

    case 'music-controls-seek-to':
      if (typeof parsed.position === 'number' && audioPlayer.duration) {
        audioPlayer.currentTime = parsed.position;
      }
      break;

    case 'music-controls-headset-unplugged':
      audioPlayer.pause();
      break;

    case 'music-controls-destroy':
    default:
      break;
  }
}

function updateMusicControlsMeta(track) {
  if (!window.MusicControls) return;

  MusicControls.create({
    track: track.title,
    artist: track.artist,
    cover: track.thumbnail,
    isPlaying: true,
    dismissable: false,
    hasPrev: true,
    hasNext: true,
    hasClose: false,
    album: 'Wave',
    duration: track.duration || 0,
    elapsedTime: 0,
    playIcon: 'media_play',
    pauseIcon: 'media_pause',
    prevIcon: 'media_prev',
    nextIcon: 'media_next',
    closeIcon: 'media_close',
    notificationIcon: 'notification'
  }, () => {}, (err) => console.warn('[music-controls] create failed:', err));
}

function updateMusicControlsPlaybackState(isPlaying) {
  if (!window.MusicControls) return;
  MusicControls.updateIsPlaying(isPlaying);
}

/* ================================================================
   23. INITIALIZATION
   ================================================================ */
function init() {
  greetingEl.textContent = getGreeting();
  renderLibrary();
  switchView('home');
}

document.addEventListener('DOMContentLoaded', init);
