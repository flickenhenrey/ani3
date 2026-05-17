/* =========================================================
   api.js – All API calls for AniStream
   Sources: AniList GraphQL API, Consumet API (public instance)
   ========================================================= */

// ── Config ──────────────────────────────────────────────
const ANILIST_URL = 'https://graphql.anilist.co';

// Public Consumet instances (fallback chain)
const CONSUMET_BASES = [
  'https://api.consumet.org',
  'https://consumet-api.onrender.com'
];

let CONSUMET_BASE = CONSUMET_BASES[0];

// Test which Consumet instance responds
async function resolveConsumetBase() {
  for (const base of CONSUMET_BASES) {
    try {
      const r = await fetch(`${base}/anime/gogoanime/spy-x-family?page=1`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) { CONSUMET_BASE = base; return; }
    } catch { /* try next */ }
  }
}
resolveConsumetBase();

// ── AniList Helpers ──────────────────────────────────────
async function anilistQuery(query, variables = {}) {
  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error('AniList request failed');
  const json = await res.json();
  return json.data;
}

// Common media fragment
const MEDIA_FRAGMENT = `
  id
  title { romaji english }
  coverImage { large medium }
  bannerImage
  description(asHtml: false)
  genres
  episodes
  status
  season
  seasonYear
  averageScore
  format
`;

// ── Search ───────────────────────────────────────────────
/**
 * Search anime by title via AniList
 * @param {string} query
 * @returns {Array} list of anime objects
 */
async function searchAnime(query) {
  const gql = `
    query($search: String) {
      Page(page: 1, perPage: 12) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          ${MEDIA_FRAGMENT}
        }
      }
    }`;
  try {
    const data = await anilistQuery(gql, { search: query });
    return data.Page.media.map(normalizeMedia);
  } catch (e) {
    console.error('Search failed:', e);
    return [];
  }
}

// ── Homepage Lists ───────────────────────────────────────
async function getTrending(page = 1, perPage = 20) {
  const gql = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
    }`;
  const data = await anilistQuery(gql, { page, perPage });
  return data.Page.media.map(normalizeMedia);
}

async function getPopular(page = 1, perPage = 20) {
  const gql = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
    }`;
  const data = await anilistQuery(gql, { page, perPage });
  return data.Page.media.map(normalizeMedia);
}

async function getRecentlyAdded(page = 1, perPage = 20) {
  const gql = `
    query($page: Int, $perPage: Int, $season: MediaSeason, $year: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, sort: START_DATE_DESC, isAdult: false, season: $season, seasonYear: $year) {
          ${MEDIA_FRAGMENT}
        }
      }
    }`;
  const now = new Date();
  const month = now.getMonth();
  const seasons = ['WINTER','WINTER','SPRING','SPRING','SPRING','SUMMER','SUMMER','SUMMER','FALL','FALL','FALL','WINTER'];
  const season = seasons[month];
  const year = now.getFullYear();
  const data = await anilistQuery(gql, { page, perPage, season, year });
  return data.Page.media.map(normalizeMedia);
}

// ── Anime Details ────────────────────────────────────────
async function getAnimeById(id) {
  const gql = `
    query($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FRAGMENT}
        trailer { id site }
      }
    }`;
  const data = await anilistQuery(gql, { id: parseInt(id) });
  return normalizeMedia(data.Media);
}

// ── Normalize AniList media object ──────────────────────
function normalizeMedia(m) {
  return {
    id: m.id,
    title: m.title.english || m.title.romaji || 'Unknown',
    titleRomaji: m.title.romaji,
    image: m.coverImage?.large || m.coverImage?.medium || '',
    banner: m.bannerImage || '',
    description: stripHtml(m.description || ''),
    genres: m.genres || [],
    episodes: m.episodes || '?',
    status: m.status || '',
    season: m.season || '',
    year: m.seasonYear || '',
    score: m.averageScore || 0,
    format: m.format || ''
  };
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#039;/g,"'").replace(/&quot;/g,'"');
}

// ── Consumet: Fetch Episodes ─────────────────────────────
/**
 * Search Consumet for the anime title, return episode list
 * Uses aniwatch (zoro) provider first, falls back to gogoanime
 */
async function fetchEpisodes(animeTitle, anilistId) {
  // Try aniwatch (Zoro/Hianime) first
  try {
    const eps = await fetchEpisodesAniwatch(anilistId);
    if (eps && eps.length > 0) return { provider: 'aniwatch', episodes: eps };
  } catch (e) { console.warn('Aniwatch failed, trying gogoanime:', e.message); }

  // Fallback: gogoanime
  try {
    const eps = await fetchEpisodesGogoanime(animeTitle);
    if (eps && eps.length > 0) return { provider: 'gogoanime', episodes: eps };
  } catch (e) { console.warn('Gogoanime also failed:', e.message); }

  return { provider: null, episodes: [] };
}

async function fetchEpisodesAniwatch(anilistId) {
  const url = `${CONSUMET_BASE}/meta/anilist/episodes/${anilistId}?provider=zoro`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // May return array directly or { results: [] }
  const list = Array.isArray(json) ? json : (json.results || json.episodes || []);
  return list.map(ep => ({
    id: ep.id,
    number: ep.number,
    title: ep.title || `Episode ${ep.number}`,
    image: ep.image || ep.img || null,
    url: ep.url || null
  }));
}

async function fetchEpisodesGogoanime(animeTitle) {
  // Search for the anime on gogoanime
  const search = encodeURIComponent(animeTitle);
  const searchRes = await fetch(`${CONSUMET_BASE}/anime/gogoanime/${search}`, { signal: AbortSignal.timeout(8000) });
  if (!searchRes.ok) throw new Error(`Gogoanime search HTTP ${searchRes.status}`);
  const searchJson = await searchRes.json();
  const results = searchJson.results || [];
  if (!results.length) throw new Error('No results on gogoanime');

  // Pick the best match (first result)
  const match = results[0];
  const detailRes = await fetch(`${CONSUMET_BASE}/anime/gogoanime/info/${match.id}`, { signal: AbortSignal.timeout(8000) });
  if (!detailRes.ok) throw new Error(`Gogoanime info HTTP ${detailRes.status}`);
  const detail = await detailRes.json();
  const eps = detail.episodes || [];
  return eps.map(ep => ({
    id: ep.id,
    number: ep.number,
    title: ep.title || `Episode ${ep.number}`,
    image: ep.image || null,
    url: ep.url || null
  }));
}

// ── Consumet: Fetch Stream Sources ───────────────────────
/**
 * Fetch video streaming sources for an episode
 * @param {string} episodeId - episode ID from Consumet
 * @param {string} provider  - 'aniwatch' | 'gogoanime'
 * @returns {{ sources: [], headers: {} }}
 */
async function fetchStreamSources(episodeId, provider) {
  let url;
  if (provider === 'aniwatch') {
    url = `${CONSUMET_BASE}/anime/zoro/watch?episodeId=${encodeURIComponent(episodeId)}`;
  } else {
    url = `${CONSUMET_BASE}/anime/gogoanime/watch/${encodeURIComponent(episodeId)}`;
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Stream fetch HTTP ${res.status}`);
  const json = await res.json();

  const sources = (json.sources || []).map(s => ({
    url: s.url,
    quality: s.quality || 'default',
    isM3U8: s.isM3U8 || (s.url || '').includes('.m3u8')
  }));

  return {
    sources,
    headers: json.headers || {},
    subtitles: json.subtitles || []
  };
}

// ── Search UI helper (shared across pages) ───────────────
function renderSearchResults(results, box) {
  if (!results.length) {
    box.innerHTML = '<div class="search-item" style="color:#888">No results found.</div>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = '';
  results.slice(0, 8).forEach(anime => {
    const item = document.createElement('div');
    item.className = 'search-item';
    item.innerHTML = `
      <img src="${anime.image}" alt="${anime.title}" loading="lazy" />
      <div class="search-item-info">
        <div class="search-item-title">${anime.title}</div>
        <div class="search-item-meta">${anime.format || ''} · ${anime.year || ''} · ${anime.episodes} eps</div>
      </div>`;
    item.addEventListener('click', () => {
      window.location.href = `anime.html?id=${anime.id}`;
    });
    box.appendChild(item);
  });
  box.classList.remove('hidden');
}
