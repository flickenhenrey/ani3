/* =========================================================
   api.js – All API calls for AniStream
   Sources: AniList GraphQL API, ani.zip (episodes), MegaPlay (player)
   ========================================================= */

const ANILIST_URL  = 'https://graphql.anilist.co';
const ANIZIP_BASE  = 'https://api.ani.zip/mappings';
const MEGAPLAY_BASE = 'https://megaplay.buzz/stream/ani';

// ── AniList ──────────────────────────────────────────────
async function anilistQuery(query, variables = {}) {
  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error('AniList request failed');
  return (await res.json()).data;
}

const MEDIA_FRAGMENT = `
  id title { romaji english }
  coverImage { large medium }
  bannerImage description(asHtml: false)
  genres episodes status season seasonYear averageScore format
`;

async function searchAnime(query) {
  const gql = `query($search:String){Page(page:1,perPage:12){media(search:$search,type:ANIME,sort:SEARCH_MATCH){${MEDIA_FRAGMENT}}}}`;
  try {
    const data = await anilistQuery(gql, { search: query });
    return data.Page.media.map(normalizeMedia);
  } catch (e) { console.error('Search failed:', e); return []; }
}

async function getTrending(page = 1, perPage = 20) {
  const gql = `query($page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){media(type:ANIME,sort:TRENDING_DESC,isAdult:false){${MEDIA_FRAGMENT}}}}`;
  return (await anilistQuery(gql, { page, perPage })).Page.media.map(normalizeMedia);
}

async function getPopular(page = 1, perPage = 20) {
  const gql = `query($page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){${MEDIA_FRAGMENT}}}}`;
  return (await anilistQuery(gql, { page, perPage })).Page.media.map(normalizeMedia);
}

async function getRecentlyAdded(page = 1, perPage = 20) {
  const gql = `query($page:Int,$perPage:Int,$season:MediaSeason,$year:Int){Page(page:$page,perPage:$perPage){media(type:ANIME,sort:START_DATE_DESC,isAdult:false,season:$season,seasonYear:$year){${MEDIA_FRAGMENT}}}}`;
  const now = new Date();
  const seasons = ['WINTER','WINTER','SPRING','SPRING','SPRING','SUMMER','SUMMER','SUMMER','FALL','FALL','FALL','WINTER'];
  return (await anilistQuery(gql, { page, perPage, season: seasons[now.getMonth()], year: now.getFullYear() })).Page.media.map(normalizeMedia);
}

async function getAnimeById(id) {
  const gql = `query($id:Int){Media(id:$id,type:ANIME){${MEDIA_FRAGMENT} trailer{id site}}}`;
  return normalizeMedia((await anilistQuery(gql, { id: parseInt(id) })).Media);
}

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
  return str.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#039;/g,"'").replace(/&quot;/g,'"');
}

// ── Episodes via ani.zip ─────────────────────────────────
async function fetchEpisodes(animeTitle, anilistId) {
  try {
    const eps = await fetchEpisodesAnizip(anilistId);
    if (eps && eps.length > 0) return { provider: 'megaplay', episodes: eps };
  } catch (e) {
    console.warn('ani.zip failed, generating stubs:', e.message);
  }

  // Fallback: numbered stubs from AniList episode count
  try {
    const info = await getAnimeById(anilistId);
    const count = typeof info.episodes === 'number' ? info.episodes : 0;
    if (count > 0) {
      return {
        provider: 'megaplay',
        episodes: Array.from({ length: count }, (_, i) => ({
          id:    `${anilistId}-episode-${i + 1}`,
          number: i + 1,
          title: `Episode ${i + 1}`,
          image: null,
          _anilistId: String(anilistId)
        }))
      };
    }
  } catch (e) { /* ignore */ }

  return { provider: null, episodes: [] };
}

async function fetchEpisodesAnizip(anilistId) {
  const res = await fetch(`${ANIZIP_BASE}?anilist_id=${anilistId}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`ani.zip HTTP ${res.status}`);
  const json = await res.json();

  const episodesObj = json.episodes;
  if (!episodesObj || typeof episodesObj !== 'object') throw new Error('No episodes in ani.zip response');

  // ani.zip also returns series-level dub count — if > 0 the show has a dub
  const hasDub = (json.episodes && Object.values(json.episodes).some(ep => ep.dubAvailable)) ||
                 (json.mappings?.['thetvdb-dub'] != null) ||
                 false;

  return Object.values(episodesObj)
    .filter(ep => (ep.episodeNumber ?? ep.episode) > 0) // skip specials (ep 0)
    .map(ep => ({
      id:    `${anilistId}-episode-${ep.episodeNumber ?? ep.episode}`,
      number: ep.episodeNumber ?? ep.episode ?? 0,
      title: ep.title?.en || ep.title?.ja || `Episode ${ep.episodeNumber ?? ep.episode}`,
      // Use the ani.zip episode image; fall back to series cover later in player
      image: ep.image || null,
      _anilistId: String(anilistId)
    }))
    .sort((a, b) => a.number - b.number);
}

// ── MegaPlay embed URL ───────────────────────────────────
function getMegaplayEmbedUrl(ep, language = 'sub') {
  return `${MEGAPLAY_BASE}/${ep._anilistId}/${ep.number}/${language}`;
}

// ── fetchStreamSources (player.js compat) ────────────────
async function fetchStreamSources(episodeId, provider, epObj = {}) {
  if (!epObj._anilistId) throw new Error('Missing _anilistId on episode object');
  return {
    sources: [{ url: getMegaplayEmbedUrl(epObj, 'sub'), quality: 'embed', isM3U8: false, isEmbed: true }],
    headers: {},
    subtitles: []
  };
}

// ── Search UI ────────────────────────────────────────────
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
    item.addEventListener('click', () => { window.location.href = `anime.html?id=${anime.id}`; });
    box.appendChild(item);
  });
  box.classList.remove('hidden');
}
