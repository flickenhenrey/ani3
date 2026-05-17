/* =========================================================
   player.js – Anime detail + watch page
   ========================================================= */

let currentAnime  = null;
let allEpisodes   = [];
let filteredEps   = [];
let currentEpIdx  = 0;
let provider      = null;
let progressTimer = null;
let currentLang   = 'sub'; // 'sub' or 'dub'
let dubAvailable  = false;

const video     = document.getElementById('main-video');
const iframeBox = document.getElementById('iframe-container');
const playerMsg = document.getElementById('player-loading');

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
    searchTimeout = setTimeout(async () => renderSearchResults(await searchAnime(q), searchBox), 350);
  });
  document.addEventListener('click', e => {
    if (!searchInput.contains(e.target) && !searchBox.contains(e.target)) searchBox.classList.add('hidden');
  });
}

// ── Auth ─────────────────────────────────────────────────
let authResolved = false;
let authUser     = null;

window.onUserReady = async function(user) {
  authUser = user; authResolved = true;
  const btnFav = document.getElementById('btn-favorite');
  const btnWl  = document.getElementById('btn-watchlist');
  if (btnFav) refreshFavBtn(btnFav);
  if (btnWl)  refreshWlBtn(btnWl);
  if (currentAnime && allEpisodes.length) await resumeOrStart();
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

    // Inject sub/dub toggle UI
    injectLangToggle();

    // Test dub availability by probing MegaPlay's error event
    probeDubAvailability();

    if (authResolved) await resumeOrStart();
  } catch (e) {
    console.error('Init failed:', e);
    document.getElementById('details-loading').textContent = 'Failed to load: ' + e.message;
  }
}

// ── Dub availability probe ────────────────────────────────
// Load a hidden iframe with the dub URL. MegaPlay sends a postMessage
// error event if the dub doesn't exist for this title.
function probeDubAvailability() {
  if (!allEpisodes.length) return;

  const ep  = allEpisodes[0];
  const dubUrl = getMegaplayEmbedUrl(ep, 'dub');

  const probe = document.createElement('iframe');
  probe.src = dubUrl;
  probe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(probe);

  let resolved = false;

  const handler = (event) => {
    let data = event.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch(e) { return; } }
    if (!data || resolved) return;

    if (data.channel === 'megacloud' || data.event || data.type === 'watching-log') {
      resolved = true;
      window.removeEventListener('message', handler);
      probe.remove();

      if (data.event === 'error') {
        // Dub not available — keep dubAvailable = false, hide toggle
        setDubAvailable(false);
      } else {
        // Got a valid event (time, watching-log) — dub exists
        setDubAvailable(true);
      }
    }
  };

  window.addEventListener('message', handler);

  // Timeout fallback: if no response in 6s, assume no dub
  setTimeout(() => {
    if (!resolved) {
      resolved = true;
      window.removeEventListener('message', handler);
      probe.remove();
      setDubAvailable(false);
    }
  }, 6000);
}

function setDubAvailable(available) {
  dubAvailable = available;
  const toggle = document.getElementById('lang-toggle');
  if (!toggle) return;
  if (available) {
    toggle.style.display = 'flex';
  } else {
    toggle.style.display = 'none';
    // If user was on dub but dub isn't available, switch back to sub
    if (currentLang === 'dub') {
      currentLang = 'sub';
      reloadCurrentEpisode();
    }
  }
}

// ── Sub/Dub toggle UI ────────────────────────────────────
function injectLangToggle() {
  // Don't inject twice
  if (document.getElementById('lang-toggle')) return;

  const toggle = document.createElement('div');
  toggle.id = 'lang-toggle';
  toggle.innerHTML = `
    <button id="btn-sub" class="lang-btn active">SUB</button>
    <button id="btn-dub" class="lang-btn">DUB</button>
  `;

  // Insert inside player-wrap, directly above the player container
  const playerWrap = document.querySelector('.player-wrap');
  if (playerWrap) {
    playerWrap.insertBefore(toggle, playerWrap.firstChild);
  }

  document.getElementById('btn-sub').addEventListener('click', () => switchLang('sub'));
  document.getElementById('btn-dub').addEventListener('click', () => switchLang('dub'));
}

function switchLang(lang) {
  if (currentLang === lang) return;
  currentLang = lang;
  document.getElementById('btn-sub').classList.toggle('active', lang === 'sub');
  document.getElementById('btn-dub').classList.toggle('active', lang === 'dub');
  reloadCurrentEpisode();
}

function reloadCurrentEpisode() {
  if (allEpisodes.length) loadEpisode(currentEpIdx, 0);
}

async function resumeOrStart() {
  let resumeTime  = 0;
  let targetEpNum = startEp || 1;

  if (authUser && window.fbDB) {
    try {
      const saved = await window.fbDB.getProgress(animeId);
      if (saved) { targetEpNum = startEp || saved.episode || 1; resumeTime = saved.currentTime || 0; }
    } catch(e) { console.warn('Could not load progress:', e); }
  }

  const idx = allEpisodes.findIndex(e => e.number === targetEpNum);
  currentEpIdx = idx !== -1 ? idx : 0;
  await loadEpisode(currentEpIdx, resumeTime);
}

// ── Render Details ───────────────────────────────────────
function renderDetails(anime) {
  document.title = `${anime.title} – AniStream`;

  if (anime.banner) {
    const banner = document.getElementById('anime-banner');
    if (banner) { banner.style.backgroundImage = `url(${anime.banner})`; banner.classList.remove('hidden'); }
  }

  document.getElementById('anime-poster').src = anime.image;
  document.getElementById('anime-poster').alt = anime.title;
  document.getElementById('anime-title').textContent = anime.title;
  document.getElementById('anime-desc').textContent = anime.description || 'No description available.';

  document.getElementById('anime-meta').innerHTML = [
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
  if (btnFav) { btnFav.textContent = '☆ Favorite';  btnFav.addEventListener('click', () => toggleFavorite(anime, btnFav)); }
  if (btnWl)  { btnWl.textContent  = '+ Watchlist'; btnWl.addEventListener('click',  () => toggleWatchlist(anime, btnWl)); }
  if (authResolved) { if (btnFav) refreshFavBtn(btnFav); if (btnWl) refreshWlBtn(btnWl); }
}

// ── Episode List ─────────────────────────────────────────
function renderEpisodeList(episodes) {
  const list = document.getElementById('episode-list');
  if (!episodes.length) {
    list.innerHTML = '<div class="loading">No episodes found.</div>';
    return;
  }
  list.innerHTML = '';
  episodes.forEach((ep) => {
    const realIdx = allEpisodes.indexOf(ep);
    const div = document.createElement('div');
    div.className = 'ep-item' + (realIdx === currentEpIdx ? ' active' : '');
    div.dataset.idx = realIdx;

    // ── Thumbnail fix ──────────────────────────────────────
    // ani.zip often returns a URL that 404s for early episodes.
    // We render the img but swap it to a numbered placeholder on error.
    let thumbHtml;
    if (ep.image) {
      thumbHtml = `<img
        class="ep-thumb"
        src="${ep.image}"
        alt="ep${ep.number}"
        loading="lazy"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
      /><div class="ep-thumb-placeholder" style="display:none">${ep.number}</div>`;
    } else {
      thumbHtml = `<div class="ep-thumb-placeholder">${ep.number}</div>`;
    }

    div.innerHTML = `
      ${thumbHtml}
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
    ? allEpisodes.filter(ep => String(ep.number).includes(q) || (ep.title||'').toLowerCase().includes(q))
    : [...allEpisodes];
  renderEpisodeList(filteredEps);
});

// ── Load Episode ─────────────────────────────────────────
async function loadEpisode(idx, resumeTime = 0) {
  const ep = allEpisodes[idx];
  if (!ep) return;

  document.querySelectorAll('.ep-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.idx) === idx));

  playerMsg.textContent = 'Loading stream…';
  playerMsg.style.display = 'flex';
  video.style.display = 'none';
  iframeBox.style.display = 'none';
  document.getElementById('custom-controls').classList.add('hidden');

  if (!provider) { playerMsg.textContent = 'No streaming provider available.'; return; }

  try {
    // Build embed URL using currentLang (sub/dub)
    const embedUrl = getMegaplayEmbedUrl(ep, currentLang);
    playInIframe(embedUrl);
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

// ── MegaPlay postMessage: auto-next & progress ───────────
window.addEventListener('message', (event) => {
  let data = event.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch(e) { return; } }
  if (!data) return;

  // Auto-next on episode complete
  if (data.event === 'complete' || data.channel === 'megacloud' && data.event === 'complete') {
    if (document.getElementById('auto-next')?.checked && currentEpIdx < allEpisodes.length - 1) {
      setTimeout(() => loadEpisode(++currentEpIdx, 0), 1500);
    }
  }

  // Save progress from iframe postMessage (since we can't access video.currentTime)
  if (data.type === 'watching-log' && authUser && window.fbDB) {
    const ep = allEpisodes[currentEpIdx];
    if (ep && data.currentTime && data.duration) {
      window.fbDB.saveProgress({
        animeId,
        title:       currentAnime?.title || '',
        image:       currentAnime?.image || '',
        episode:     ep.number,
        currentTime: Math.floor(data.currentTime),
        duration:    Math.floor(data.duration)
      }).catch(() => {});
    }
  }
});

// ── Custom Controls (for native video tag fallback) ───────
document.getElementById('btn-skip-back')?.addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); });
document.getElementById('btn-skip-fwd')?.addEventListener('click',  () => { video.currentTime = Math.min(video.duration, video.currentTime + 10); });
document.getElementById('btn-prev-ep')?.addEventListener('click',   () => { if (currentEpIdx > 0) loadEpisode(--currentEpIdx, 0); });
document.getElementById('btn-next-ep')?.addEventListener('click',   () => { if (currentEpIdx < allEpisodes.length - 1) loadEpisode(++currentEpIdx, 0); });

video.addEventListener('ended', () => {
  if (document.getElementById('auto-next')?.checked && currentEpIdx < allEpisodes.length - 1)
    setTimeout(() => loadEpisode(++currentEpIdx, 0), 1500);
});

video.addEventListener('timeupdate', updateTimeDisplay);
function updateTimeDisplay() {
  const el = document.getElementById('time-display');
  if (el) el.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration || 0)}`;
}
function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

// ── Progress (native video fallback) ─────────────────────
function startProgressSave(ep) {
  clearInterval(progressTimer);
  // For iframe embeds, progress is saved via postMessage handler above.
  // This interval handles native video tag fallback only.
  progressTimer = setInterval(async () => {
    if (!video.duration || video.paused || !authUser || !window.fbDB) return;
    try {
      await window.fbDB.saveProgress({
        animeId, title: currentAnime?.title||'', image: currentAnime?.image||'',
        episode: ep.number, currentTime: Math.floor(video.currentTime), duration: Math.floor(video.duration)
      });
    } catch(e) { console.warn('Progress save failed:', e); }
  }, 5000);
}

// ── Favorites ────────────────────────────────────────────
async function refreshFavBtn(btn) {
  if (!authUser || !window.fbDB) { btn.textContent = '☆ Favorite'; return; }
  try { const a = await window.fbDB.isFavorite(animeId); btn.textContent = a ? '★ Favorited' : '☆ Favorite'; btn.classList.toggle('active', a); }
  catch(e) { btn.textContent = '☆ Favorite'; }
}
async function toggleFavorite(anime, btn) {
  if (!authUser) { window.showAuthModal?.(); return; }
  try {
    const a = await window.fbDB.isFavorite(animeId);
    if (a) await window.fbDB.removeFavorite(animeId);
    else await window.fbDB.addFavorite({ id: anime.id, title: anime.title, image: anime.image });
    refreshFavBtn(btn);
  } catch(e) { console.warn('Toggle favorite failed:', e); }
}

// ── Watchlist ─────────────────────────────────────────────
async function refreshWlBtn(btn) {
  if (!authUser || !window.fbDB) { btn.textContent = '+ Watchlist'; return; }
  try { const a = await window.fbDB.isInWatchlist(animeId); btn.textContent = a ? '✓ In Watchlist' : '+ Watchlist'; btn.classList.toggle('active', a); }
  catch(e) { btn.textContent = '+ Watchlist'; }
}
async function toggleWatchlist(anime, btn) {
  if (!authUser) { window.showAuthModal?.(); return; }
  try {
    const a = await window.fbDB.isInWatchlist(animeId);
    if (a) await window.fbDB.removeFromWatchlist(animeId);
    else await window.fbDB.addToWatchlist({ id: anime.id, title: anime.title, image: anime.image });
    refreshWlBtn(btn);
  } catch(e) { console.warn('Toggle watchlist failed:', e); }
}

init();
