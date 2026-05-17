/* =========================================================
   api.js – All API calls for AniStream
   Sources: AniList GraphQL API, ani.zip (episodes), anify (streams)
   ========================================================= */

// ── Config ──────────────────────────────────────────────
const ANILIST_URL = 'https://graphql.anilist.co';

// ani.zip: maps AniList IDs → episode lists (no API key needed)
const ANIZIP_BASE = 'https://api.ani.zip/mappings';

// Anify: free anime streaming API with AniList ID support
const ANIFY_BASE = 'https://api.anify.tv';

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

// ── Fetch Episodes ───────────────────────────────────────
/**
 * Fetch episode list using AniList ID.
 * Primary:  ani.zip  (fast, reliable, has episode metadata)
 * Fallback: Anify    (also uses AniList IDs directly)
 */
async function fetchEpisodes(animeTitle, anilistId) {
  // 1. Try ani.zip (best option — direct AniList ID mapping)
  try {
    const eps = await fetchEpisodesAnizip(anilistId);
    if (eps && eps.length > 0) return { provider: 'anify', episodes: eps };
  } catch (e) {
    console.warn('ani.zip failed, trying Anify:', e.message);
  }

  // 2. Fallback: Anify API
  try {
    const eps = await fetchEpisodesAnify(anilistId);
    if (eps && eps.length > 0) return { provider: 'anify', episodes: eps };
  } catch (e) {
    console.warn('Anify also failed:', e.message);
  }

  return { provider: null, episodes: [] };
}

/**
 * Fetch episodes from ani.zip using AniList ID.
 * Returns episode list in the format player.js expects.
 */
async function fetchEpisodesAnizip(anilistId) {
  const url = `${ANIZIP_BASE}?anilist_id=${anilistId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`ani.zip HTTP ${res.status}`);
  const json = await res.json();

  // ani.zip returns { episodes: { "1": {...}, "2": {...} } }
  const episodesObj = json.episodes;
  if (!episodesObj || typeof episodesObj !== 'object') throw new Error('No episodes in ani.zip response');

  return Object.values(episodesObj).map(ep => ({
    id:     `${anilistId}-episode-${ep.episodeNumber || ep.episode}`,  // synthetic ID for Anify stream lookup
    number: ep.episodeNumber || ep.episode || 0,
    title:  ep.title?.en || ep.title?.ja || `Episode ${ep.episodeNumber || ep.episode}`,
    image:  ep.image || null,
    url:    null,
    // store anilistId on each ep so fetchStreamSources can use it
    _anilistId: String(anilistId)
  })).sort((a, b) => a.number - b.number);
}

/**
 * Fetch episodes from Anify using AniList ID.
 */
async function fetchEpisodesAnify(anilistId) {
  // Anify info endpoint accepts AniList ID
  const url = `${ANIFY_BASE}/info/${anilistId}?type=anime`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Anify info HTTP ${res.status}`);
  const json = await res.json();

  // Anify returns episodes under episodes[].providerId episodes
  // The structure is: { episodes: { data: [ { providerId, episodes: [...] } ] } }
  const episodeProviders = json.episodes?.data || [];
  if (!episodeProviders.length) throw new Error('No episode providers from Anify');

  // Prefer 'gogoanime' or 'zoro' provider
  const preferred = episodeProviders.find(p => p.providerId === 'zoro') ||
                    episodeProviders.find(p => p.providerId === 'gogoanime') ||
                    episodeProviders[0];

  return (preferred.episodes || []).map(ep => ({
    id:     ep.id,
    number: ep.number,
    title:  ep.title || `Episode ${ep.number}`,
    image:  ep.img || ep.image || null,
    url:    null,
    _providerId: preferred.providerId,
    _anilistId:  String(anilistId)
  })).sort((a, b) => a.number - b.number);
}

// ── Fetch Stream Sources ─────────────────────────────────
/**
 * Fetch video streaming sources for an episode via Anify.
 * @param {string} episodeId  - episode ID from our episode list
 * @param {string} provider   - always 'anify' now (kept for compat)
 * @param {object} epObj      - the full episode object (has _anilistId, _providerId)
 * @returns {{ sources: [], headers: {}, subtitles: [] }}
 */
async function fetchStreamSources(episodeId, provider, epObj = {}) {
  const anilistId  = epObj._anilistId;
  const providerId = epObj._providerId || 'zoro';

  // Extract episode number from synthetic IDs like "12345-episode-3"
  const epNumMatch = String(episodeId).match(/episode-(\d+)/i);
  const episodeNum = epNumMatch ? epNumMatch[1] : null;

  // Build Anify watch URL
  // Format: /watch/{anilistId}/{providerId}/{watchId}?subType=sub
  let watchId = episodeId;

  // If it's a synthetic ani.zip ID, we need to find the real Anify episode ID
  if (epNumMatch && anilistId) {
    try {
      const anifyEps = await fetchEpisodesAnify(anilistId);
      const match = anifyEps.find(e => String(e.number) === String(episodeNum));
      if (match) {
        watchId = match.id;
        epObj._providerId = match._providerId || 'zoro';
      }
    } catch(e) {
      console.warn('Could not resolve real episode ID from Anify:', e.message);
    }
  }

  const finalProvider = epObj._providerId || providerId;
  const url = `${ANIFY_BASE}/watch/${anilistId}/${finalProvider}/${encodeURIComponent(watchId)}?subType=sub`;

  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Anify watch HTTP ${res.status}`);
  const json = await res.json();

  const sources = (json.sources || []).map(s => ({
    url:     s.url,
    quality: s.quality || 'default',
    isM3U8:  s.isM3U8 !== undefined ? s.isM3U8 : (s.url || '').includes('.m3u8')
  }));

  return {
    sources,
    headers:   json.headers   || {},
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
