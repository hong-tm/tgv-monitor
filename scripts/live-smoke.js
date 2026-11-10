'use strict';

// Read-only contract check against the real TGV boxoffice API. The offline
// suite stubs axios, so it stayed green for days while TGV retired the
// content/v1 endpoints (Nov 2026). This walks the same chain the bot uses:
// catalogue -> sessions -> tickets, plus the dead-session error contract.
// No credentials, no Telegram, no writes. Exit 0 = contract holds, 1 = broken.

const axios = require('axios');
const { COMMON_HEADERS } = require('../src/config');
const { fetchMovieByItemKey, fetchMovieSessions, fetchTickets, getTodayBusinessDate } = require('../src/tgv-api');

const CINEMA = process.env.SMOKE_CINEMA || 'VIV';
const API_BASE = 'https://api.tgv.com.my/api/boxoffice/v1';
const MAX_TICKET_TRIES = 6;

function check(cond, label) {
  if (!cond) throw new Error(label);
  console.log(`ok   ${label}`);
}

function nextDay(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Sessions that already started answer EX-V, so walk from the latest showtime back.
async function findSellableSession(ids, date) {
  let seen = null;
  let tries = 0;
  for (const id of ids) {
    const data = await fetchMovieSessions(id, CINEMA, date);
    if (!data || data.sessions.length === 0) continue;
    seen = seen || { movieId: id, movieName: data.movieName, session: data.sessions[0] };
    for (const session of data.sessions.slice().reverse().slice(0, 2)) {
      if (tries++ >= MAX_TICKET_TRIES) return { seen };
      try {
        const tickets = await fetchTickets(CINEMA, session.sessionId);
        if (tickets.length > 0) return { seen, hit: { movieId: id, movieName: data.movieName, session, tickets } };
      } catch (e) {
        // started or sold-through session; try the next candidate
      }
    }
  }
  return { seen };
}

async function main() {
  const today = getTodayBusinessDate();
  console.log(`TGV live smoke: cinema ${CINEMA}, business date ${today}`);

  const res = await axios.post(`${API_BASE}/moviesession_getcinemamovies`, { cinemaid: CINEMA }, { headers: COMMON_HEADERS, timeout: 15000 });
  const ids = res.data?.results?.movieidlist;
  check(Array.isArray(ids) && ids.length > 0, 'getcinemamovies returns a non-empty movieidlist');

  let found = await findSellableSession(ids, today);
  if (!found.hit) {
    const tomorrow = await findSellableSession(ids, nextDay(today));
    found = { hit: tomorrow.hit, seen: found.seen || tomorrow.seen };
  }
  check(found.seen || found.hit, 'moviesession_get lists sessions for at least one movie');

  const sample = found.hit || found.seen;
  check(typeof sample.movieName === 'string' && sample.movieName !== '未知电影', 'moviesession_get carries the movie name');
  check(/^\d+$/.test(sample.session.sessionId) && /^\d{2}:\d{2}$/.test(sample.session.time), 'sessions carry a numeric sessionid and an HH:MM showtime');

  const lookup = await fetchMovieByItemKey(sample.movieName, CINEMA);
  // Substring search may land on a sibling title (e.g. an IMAX re-listing), so compare names, not ids.
  check(lookup && lookup.name.toLowerCase().includes(sample.movieName.toLowerCase()), 'a title search resolves to a movie carrying that title');

  check(found.hit, 'gettickets returns ticket types for a sellable session');
  const t = found.hit.tickets[0];
  check(
    t.ticketTypeCode !== undefined && typeof t.description === 'string' &&
    typeof t.priceInCents === 'number' && typeof t.quantityAvailablePerOrder === 'number',
    'tickets carry ticketTypeCode, description, priceInCents, quantityAvailablePerOrder'
  );

  // The 15-strike auto-removal depends on a dead session failing loudly.
  let deadError = null;
  try {
    await fetchTickets(CINEMA, '1');
  } catch (e) {
    deadError = e;
  }
  check(deadError && /^TGV API /.test(deadError.message), 'a dead session is rejected with success:false (fetchTickets throws)');

  console.log('TGV live smoke: PASS');
}

main().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
