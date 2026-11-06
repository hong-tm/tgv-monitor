const crypto = require('crypto');
const axios = require('axios');
const { COMMON_HEADERS, DEFAULT_AREA_CATEGORY } = require('./config');

function generateUserSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function getTodayBusinessDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

const API_BASE = 'https://api.tgv.com.my/api/boxoffice/v1';

// The content/v1 movie endpoints (movie_getbyitemkey / movie_getdetails /
// movies_getnowshowing) started answering 404 in Nov 2026. The catalogue now
// lives in boxoffice/v1: getcinemamovies lists a cinema's movie ids and
// moviesession_get returns the movie record (recid/itemkey/name) for any date
// the movie has sessions. One lookup walks all ~17 movies of a cinema, so the
// metadata is cached per (movie, date) for 10 minutes.
const META_TTL_MS = 10 * 60 * 1000;
const MAX_META_CACHE = 500; // same FIFO bound as store.sessionCache
const movieMetaCache = new Map(); // `${movieId}_${cinemaId}_${date}` -> { expires, meta }

// Empty catches are silent failover: a failing endpoint degrades the lookup to
// "no match", same as the pre-split single-file behaviour.
async function fetchMovieIds(cinemaId) {
  try {
    const res = await axios.post(`${API_BASE}/moviesession_getcinemamovies`, { cinemaid: cinemaId }, { headers: COMMON_HEADERS, timeout: 8000 });
    return res.data?.results?.movieidlist || [];
  } catch (e) {
    return [];
  }
}

// Returns null when the movie has no sessions on that date (movies: null).
async function fetchMovieMeta(movieId, cinemaId, date) {
  const key = `${movieId}_${cinemaId}_${date}`;
  const hit = movieMetaCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.meta;
  try {
    const res = await axios.post(`${API_BASE}/moviesession_get`, { cinemaid: cinemaId, businessdate: date, movieid: movieId }, { headers: COMMON_HEADERS, timeout: 8000 });
    const movie = res.data?.results?.movies?.[0];
    const meta = movie?.recid ? { movieId: movie.recid, name: movie.name, itemkey: movie.itemkey } : null;
    if (movieMetaCache.size >= MAX_META_CACHE && !movieMetaCache.has(key)) {
      const oldest = movieMetaCache.keys().next().value;
      if (oldest !== undefined) movieMetaCache.delete(oldest);
    }
    movieMetaCache.set(key, { expires: Date.now() + META_TTL_MS, meta });
    return meta;
  } catch (e) {
    return null;
  }
}

// Advance-selling movies have no sessions today and are only visible on their
// nearest session date; resolve that date, then read the metadata from it.
async function fetchNearestDate(movieId, cinemaId) {
  try {
    const res = await axios.post(`${API_BASE}/moviesession_getnearestsessiondate`, { cinemaid: cinemaId, movieid: movieId }, { headers: COMMON_HEADERS, timeout: 8000 });
    const when = res.data?.results?.showtimemy;
    return when ? when.substring(0, 10) : null;
  } catch (e) {
    return null;
  }
}

async function fetchMovieByItemKey(itemKey, cinemaId = 'VIV') {
  const cleanKey = itemKey.trim().toLowerCase();
  if (!cleanKey) return null;
  const ids = await fetchMovieIds(cinemaId);
  const today = getTodayBusinessDate();
  const metas = await Promise.all(ids.map((id) => fetchMovieMeta(id, cinemaId, today)));

  // itemkey is exact (seat links and /movies/ URLs carry it); a typed name
  // matches by substring with dashes read as spaces. Exact beats substring in
  // both stages so a currently-showing title can never shadow a future
  // movie's exact itemkey.
  const byKey = (list) => list.find((m) => m && m.itemkey?.toLowerCase() === cleanKey);
  const byName = (list) => list.find((m) => m && m.name?.toLowerCase().includes(cleanKey.replace(/-/g, ' ')));

  const exactToday = byKey(metas);
  if (exactToday) return { movieId: exactToday.movieId, name: exactToday.name };

  // Advance-selling movies without sessions today; keep the resolved date so
  // callers can list sessions on the day the movie actually plays.
  const missing = ids.filter((id, i) => !metas[i]);
  const filled = await Promise.all(missing.map(async (id) => {
    const date = await fetchNearestDate(id, cinemaId);
    return date ? { date, meta: await fetchMovieMeta(id, cinemaId, date) } : null;
  }));
  const exactFuture = filled.find((f) => f && f.meta && f.meta.itemkey?.toLowerCase() === cleanKey);
  if (exactFuture) return { movieId: exactFuture.meta.movieId, name: exactFuture.meta.name, nearestDate: exactFuture.date };

  // Exact beats substring in both groups; a loose title match on a showing
  // movie must never shadow an exact hit, so exact was checked first above.
  const namedToday = byName(metas);
  if (namedToday) return { movieId: namedToday.movieId, name: namedToday.name };
  const namedFuture = filled.find((f) => f && f.meta && f.meta.name?.toLowerCase().includes(cleanKey.replace(/-/g, ' ')));
  return namedFuture ? { movieId: namedFuture.meta.movieId, name: namedFuture.meta.name, nearestDate: namedFuture.date } : null;
}

async function fetchMovieSessions(movieId, cinemaId = 'VIV', date = null) {
  const businessDate = date || getTodayBusinessDate();
  const url = `${API_BASE}/moviesession_get`;
  const payload = {
    cinemaid: cinemaId,
    businessdate: businessDate,
    movieid: movieId
  };

  try {
    const res = await axios.post(url, payload, { headers: COMMON_HEADERS, timeout: 8000 });
    const movieMeta = res.data?.results?.movies?.[0] || {};
    const movieName = movieMeta.name || '未知电影';
    const cinemaNode = res.data?.results?.businessday?.cinemas?.[0];
    const sessionsList = [];

    if (cinemaNode?.movies) {
      for (const m of cinemaNode.movies) {
        if (m.experiences) {
          for (const exp of m.experiences) {
            if (exp.sessions) {
              for (const s of exp.sessions) {
                const timeStr = s.showtimemy ? s.showtimemy.substring(11, 16) : '未知时间';
                sessionsList.push({
                  sessionId: String(s.sessionid),
                  screen: s.screenname,
                  time: timeStr,
                  showTimeMy: s.showtimemy
                });
              }
            }
          }
        }
      }
    }

    return { movieName, businessDate, sessions: sessionsList };
  } catch (e) {
    return null;
  }
}

// quantityAvailablePerOrder is the per-order cap and stays >0 after the daily
// promo limit is reached; this text marker is the only sold-out signal.
function isPromoSoldOut(ticket) {
  return Boolean(ticket?.longDescription && ticket.longDescription.includes("Today's Promotion Limit Reached"));
}

async function fetchTickets(cinemaId, sessionId, areaCategory = DEFAULT_AREA_CATEGORY) {
  const url = `${API_BASE}/moviesession_gettickets`;
  const payload = {
    cinemaid: cinemaId,
    sessionid: sessionId,
    areacategorycodes: areaCategory,
    usersessionid: generateUserSessionId(),
    usetemplateuser: true
  };

  const res = await axios.post(url, payload, { headers: COMMON_HEADERS, timeout: 8000 });
  const body = res.data;
  // A dead/expired session answers HTTP 200 with success:false (error EX-V).
  // Returning [] here would silently reset failCount and the 15-strike
  // auto-removal would never fire; throw so callers treat it as a failure.
  if (body && body.success === false) {
    const err = body.error || {};
    throw new Error(`TGV API ${err.code || 'ERR'}: ${err.message || 'request rejected'}`);
  }
  return body?.results?.tickets || [];
}

module.exports = {
  generateUserSessionId,
  getTodayBusinessDate,
  fetchMovieByItemKey,
  fetchMovieSessions,
  fetchTickets,
  isPromoSoldOut,
  movieMetaCache
};
