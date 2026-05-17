/* =========================================================
   player.js – Anime detail + watch page
   ========================================================= */

// ── State ────────────────────────────────────────────────
let currentAnime  = null;
let allEpisodes   = [];
let filteredEps   = [];
let currentEpIdx  = 0;
let provider      = null;
let progressTimer = null;

const video    = document.getElementById('main-video');
const iframeBox = document.getElementById('iframe-container');
const playerMsg = document.getElementById('player-loading');

// ── URL Params ───────────────────────────────────────────
const params  = new URLSearchParams(location.search);
const animeId = params.get('id');
const startEp = parseInt(params.get('ep') || '0');

if (!animeId) {
  document.body.innerHTML = '<p style="padding:40px;color:#888">No anime ID provided. <a href="index.html">Go home</a></p>';
  throw new Error('No anime ID');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Search bar ───────────────────────────────────────────
const searchInput = document.getElementById('search-input');
const searchBox   = document.getElementById('search-results');
let searchTimeout = null;

if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (q.length < 2) { searchBox.classList.add('hidden'); return; }
    searchTimeout = setTimeout(async () => {
      const res = await searchAnime(q);
      renderSearchResults(res, searchBox);
    }, 350);
  });
  document.addEventListener('click', e => {
    if (!searchInput.contains(e.target) && !searchBox.contains(e.target))
      searchBox.classList.add('hidden');
  });
}

// ── Auth state ───────────────────────────────────────────
let authResolved = false;
let authUser     = null;

window.onUserReady = async function(user) {
  authUser     = user;
  authResolved = true;
  // Refresh fav/watchlist buttons now that we know auth state
  const btnFav = document.getElementById('btn-favorite');
  const btnWl  = document.getElementById('btn-watchlist');
  if (btnFav) refreshFavBtn(btnFav);
  if (btnWl)  refreshWlBtn(btnWl);
  // Resume progress if init already finished
  if (currentAnime && allEpisodes.length) {
    await resumeOrStart();
  }
};

// ── INIT ─────────────────────────────────────────────────
async function init() {
  try {
    currentAnime = await getAnimeById(animeId);
    renderDetails(currentAnime);

    const result = await fetchEpisodes(currentAnime.title, animeId);
    provider    = result.provider;
    allEpisodes = result.episodes;
    filteredEps = [...allEpisodes];
    renderEpisodeList(filteredEps);
    document.getElementById('player-section').classList.remove('hidden');

    if (authResolved) {
      await resumeOrStart();
    }
    // else: onUserReady will call resumeOrStart

  } catch (e) {
    console.error('Init failed:', e);
    document.getElementById('details-loading').textContent = 'Failed to load: ' + e.message;
  }
}

async function resumeOrStart() {
  let resumeTime  = 0;
  let targetEpNum = startEp || 1;

  // Only touch Firebase if user is signed in
  if (authUser && window.fbDB) {
    try {
      const saved = await window.fbDB.getProgress(animeId);
      if (saved) {
        targetEpNum = startEp || saved.episode || 1;
        resumeTime  = saved.currentTime || 0;
      }
    } catch(e) { console.warn('Could not load progress:', e); }
  }

  const idx = allEpisodes.findIndex(e => e.number === targetEpNum);
  if (idx !== -1) {
    currentEpIdx = idx;
    await loadEpisode(idx, resumeTime);
  } else if (allEpisodes.length) {
    currentEpIdx = 0;
    await loadEpisode(0, 0);
  }
}

// ── Render Details ───────────────────────────────────────
function renderDetails(anime) {
  document.title = `${anime.title} – AniStream`;

  if (anime.banner) {
    const banner = document.getElementById('anime-banner');
    if (banner) {
      banner.style.backgroundImage = `url(${anime.banner})`;
      banner.classList.remove('hidden');
    }
  }

  document.getElementById('anime-poster').src = anime.image;
  document.getElementById('anime-poster').alt = anime.title;
  document.getElementById('anime-title').textContent = anime.title;
  document.getElementById('anime-desc').textContent = anime.description || 'No description available.';

  const meta = document.getElementById('anime-meta');
  meta.innerHTML = [
    anime.format   ? `<span>${anime.format}</span>`           : '',
    anime.year     ? `<span>${anime.year}</span>`             : '',
    anime.season   ? `<span>${anime.season}</span>`           : '',
    anime.episodes ? `<span>${anime.episodes} eps</span>`     : '',
    anime.status   ? `<span>${anime.status}</span>`           : '',
    anime.score    ? `<span>⭐ ${anime.score / 10}/10</span>` : ''
  ].join('');

  document.getElementById('anime-genres').innerHTML =
    anime.genres.map(g => `<span class="genre-tag">${escHtml(g)}</span>`).join('');

  document.getElementById('details-loading').classList.add('hidden');
  document.getElementById('details-content').classList.remove('hidden');

  const btnFav = document.getElementById('btn-favorite');
  const btnWl  = document.getElementById('btn-watchlist');

  // Set placeholder text immediately — real state loads once auth resolves
  if (btnFav) {
    btnFav.textContent = '☆ Favorite';
    btnFav.addEventListener('click', () => toggleFavorite(anime, btnFav));
  }
  if (btnWl) {
    btnWl.textContent = '+ Watchlist';
    btnWl.addEventListener('click', () => toggleWatchlist(anime, btnWl));
  }

  // If auth already resolved, update buttons now
  if (authResolved) {
    if (btnFav) refreshFavBtn(btnFav);
    if (btnWl)  refreshWlBtn(btnWl);
  }
  // else: onUserReady will call refreshFavBtn / refreshWlBtn
}

// ── Episode List ─────────────────────────────────────────
function renderEpisodeList(episodes) {
  const list = document.getElementById('episode-list');
  if (!episodes.length) {
    list.innerHTML = '<div class="loading">No episodes found. The streaming provider may be temporarily unavailable.</div>';
    return;
  }
  list.innerHTML = '';
  episodes.forEach((ep) => {
    const realIdx = allEpisodes.indexOf(ep);
    const div = document.createElement('div');
    div.className = 'ep-item' + (realIdx === currentEpIdx ? ' active' : '');
    div.dataset.idx = realIdx;

    const thumb = ep.image
      ? `<img class="ep-thumb" src="${ep.image}" alt="ep${ep.number}" loading="lazy" onerror="this.style.display='none'" />`
      : `<div class="ep-thumb-placeholder">${ep.number}</div>`;

    div.innerHTML = `
      ${thumb}
      <div class="ep-info">
        <div class="ep-num">Episode ${ep.number}</div>
        <div class="ep-title">${escHtml(ep.title || `Episode ${ep.number}`)}</div>
      </div>`;

    div.addEventListener('click', async () => {
      currentEpIdx = realIdx;
      await loadEpisode(currentEpIdx, 0);
      div.scrollIntoView({ block: 'nearest' });
    });
    list.appendChild(div);
  });
}

document.getElementById('ep-search')?.addEventListener('input', function() {
  const q = this.value.toLowerCase();
  filteredEps = q
    ? allEpisodes.filter(ep => String(ep.number).includes(q) || (ep.title || '').toLowerCase().includes(q))
    : [...allEpisodes];
  renderEpisodeList(filteredEps);
});

// ── Load & Play Episode ──────────────────────────────────
async function loadEpisode(idx, resumeTime = 0) {
  const ep = allEpisodes[idx];
  if (!ep) return;

  document.querySelectorAll('.ep-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.idx) === idx);
  });

  playerMsg.textContent = 'Loading stream…';
  playerMsg.style.display = 'flex';
  video.style.display = 'none';
  iframeBox.style.display = 'none';
  document.getElementById('custom-controls').classList.add('hidden');

  if (!provider) {
    playerMsg.textContent = 'No streaming provider available.';
    return;
  }

  try {
    const { sources } = await fetchStreamSources(ep.id, provider, ep);
    if (!sources.length) { playerMsg.textContent = 'No streams found for this episode.'; return; }

    const source = sources[0];

    if (source.isEmbed) {
      playInIframe(source.url);
    } else if (source.isM3U8 && !video.canPlayType('application/vnd.apple.mpegurl')) {
      playInIframe(source.url);
    } else {
      playInVideoTag(source.url, resumeTime);
    }

    startProgressSave(ep);

  } catch (e) {
    console.error('Stream load failed:', e);
    playerMsg.textContent = 'Stream unavailable: ' + e.message;
  }
}

function playInIframe(url) {
  playerMsg.style.display = 'none';
  video.style.display = 'none';
  document.getElementById('custom-controls').classList.add('hidden');

  let iframe = iframeBox.querySelector('iframe');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    iframeBox.appendChild(iframe);
  }

  iframe.src = url;
  iframeBox.style.display = 'block';
}

function playInVideoTag(url, resumeTime) {
  playerMsg.style.display = 'none';
  iframeBox.style.display = 'none';
  video.src = url;
  video.style.display = 'block';
  document.getElementById('custom-controls').classList.remove('hidden');
  video.load();
  video.addEventListener('loadedmetadata', () => {
    if (resumeTime > 0 && resumeTime < video.duration - 10) video.currentTime = resumeTime;
    video.play().catch(() => {});
    updateTimeDisplay();
  }, { once: true });
}

// ── Custom Controls ──────────────────────────────────────
document.getElementById('btn-skip-back')?.addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); });
document.getElementById('btn-skip-fwd')?.addEventListener('click',  () => { video.currentTime = Math.min(video.duration, video.currentTime + 10); });
document.getElementById('btn-prev-ep')?.addEventListener('click',   () => { if (currentEpIdx > 0) loadEpisode(--currentEpIdx, 0); });
document.getElementById('btn-next-ep')?.addEventListener('click',   () => { if (currentEpIdx < allEpisodes.length - 1) loadEpisode(++currentEpIdx, 0); });

video.addEventListener('ended', () => {
  if (document.getElementById('auto-next')?.checked && currentEpIdx < allEpisodes.length - 1) {
    setTimeout(() => loadEpisode(++currentEpIdx, 0), 1500);
  }
});

video.addEventListener('timeupdate', updateTimeDisplay);
function updateTimeDisplay() {
  const el = document.getElementById('time-display');
  if (el) el.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration || 0)}`;
}
function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ── Progress Saving ──────────────────────────────────────
function startProgressSave(ep) {
  clearInterval(progressTimer);
  progressTimer = setInterval(async () => {
    if (!video.duration || video.paused || !authUser || !window.fbDB) return;
    try {
      await window.fbDB.saveProgress({
        animeId,
        title:       currentAnime?.title || '',
        image:       currentAnime?.image || '',
        episode:     ep.number,
        currentTime: Math.floor(video.currentTime),
        duration:    Math.floor(video.duration)
      });
    } catch(e) { console.warn('Progress save failed:', e); }
  }, 5000);
}

// ── Favorites ────────────────────────────────────────────
async function refreshFavBtn(btn) {
  if (!authUser || !window.fbDB) { btn.textContent = '☆ Favorite'; return; }
  try {
    const active = await window.fbDB.isFavorite(animeId);
    btn.textContent = active ? '★ Favorited' : '☆ Favorite';
    btn.classList.toggle('active', active);
  } catch(e) { btn.textContent = '☆ Favorite'; }
}

async function toggleFavorite(anime, btn) {
  if (!authUser) { window.showAuthModal?.(); return; }
  try {
    const active = await window.fbDB.isFavorite(animeId);
    if (active) await window.fbDB.removeFavorite(animeId);
    else await window.fbDB.addFavorite({ id: anime.id, title: anime.title, image: anime.image });
    refreshFavBtn(btn);
  } catch(e) { console.warn('Toggle favorite failed:', e); }
}

// ── Watchlist ─────────────────────────────────────────────
async function refreshWlBtn(btn) {
  if (!authUser || !window.fbDB) { btn.textContent = '+ Watchlist'; return; }
  try {
    const active = await window.fbDB.isInWatchlist(animeId);
    btn.textContent = active ? '✓ In Watchlist' : '+ Watchlist';
    btn.classList.toggle('active', active);
  } catch(e) { btn.textContent = '+ Watchlist'; }
}

async function toggleWatchlist(anime, btn) {
  if (!authUser) { window.showAuthModal?.(); return; }
  try {
    const active = await window.fbDB.isInWatchlist(animeId);
    if (active) await window.fbDB.removeFromWatchlist(animeId);
    else await window.fbDB.addToWatchlist({ id: anime.id, title: anime.title, image: anime.image });
    refreshWlBtn(btn);
  } catch(e) { console.warn('Toggle watchlist failed:', e); }
}

// ── Start ─────────────────────────────────────────────────
init();
