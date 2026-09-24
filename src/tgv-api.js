const crypto = require('crypto');
const axios = require('axios');
const { COMMON_HEADERS, DEFAULT_AREA_CATEGORY } = require('./config');

function generateUserSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function getTodayBusinessDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

// 1. 通过 itemkey 获取电影详情与 UUID
async function fetchMovieByItemKey(itemKey) {
  const cleanKey = itemKey.trim().toLowerCase();
  const endpoints = [
    { url: 'https://api.tgv.com.my/api/content/v1/movie_getbyitemkey', payload: { itemkey: cleanKey } },
    { url: 'https://api.tgv.com.my/api/content/v1/movie_getdetails', payload: { itemkey: cleanKey } }
  ];

  for (const ep of endpoints) {
    try {
      const res = await axios.post(ep.url, ep.payload, { headers: COMMON_HEADERS, timeout: 8000 });
      const movie = res.data?.results?.movie || res.data?.results;
      if (movie?.recid) {
        return { movieId: movie.recid, name: movie.name || cleanKey };
      }
    } catch (e) {}
  }

  try {
    const listRes = await axios.post('https://api.tgv.com.my/api/content/v1/movies_getnowshowing', { cinemaid: 'VIV' }, { headers: COMMON_HEADERS, timeout: 8000 });
    const movies = listRes.data?.results?.movies || [];
    const matched = movies.find(m => m.itemkey?.toLowerCase() === cleanKey || m.name?.toLowerCase().includes(cleanKey.replace(/-/g, ' ')));
    if (matched?.recid) {
      return { movieId: matched.recid, name: matched.name };
    }
  } catch (e) {}

  return null;
}

// 2. 获取指定日期、指定影院的全天排片场次
async function fetchMovieSessions(movieId, cinemaId = 'VIV', date = null) {
  const businessDate = date || getTodayBusinessDate();
  const url = 'https://api.tgv.com.my/api/boxoffice/v1/moviesession_get';
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

// 3. 获取具体场次票种
async function fetchTickets(cinemaId, sessionId, areaCategory = DEFAULT_AREA_CATEGORY) {
  const url = 'https://api.tgv.com.my/api/boxoffice/v1/moviesession_gettickets';
  const payload = {
    cinemaid: cinemaId,
    sessionid: sessionId,
    areacategorycodes: areaCategory,
    usersessionid: generateUserSessionId(),
    usetemplateuser: true
  };

  const res = await axios.post(url, payload, { headers: COMMON_HEADERS, timeout: 8000 });
  return res.data?.results?.tickets || [];
}

module.exports = {
  generateUserSessionId,
  getTodayBusinessDate,
  fetchMovieByItemKey,
  fetchMovieSessions,
  fetchTickets
};
