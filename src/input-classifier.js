// Input classification: routes user text to one of six intents. Pure function, no I/O. Branch order is priority.
function classifyInput(text, defaultCinemaId = 'VIV') {
  const trimmed = text.trim();
  const isExplicitUuidCmd = /^\/?uuid\b/i.test(trimmed) || /@\w+\s+uuid\b/i.test(trimmed);

  let input = trimmed
    .replace(/^@\w+\s*/i, '')
    .replace(/^\/?(uuid|add)\s*/i, '')
    .trim();

  if (!input) return { kind: 'empty', input };

  // Seat link: /select-seats/{itemkey}/{date}/{cinema}/{sessionid}, positions counted from the right
  if (input.includes('/select-seats/')) {
    const parts = input.split('/');
    const itemKey = parts[parts.length - 4] || '';
    return {
      kind: 'seat-link',
      input,
      isExplicitUuidCmd,
      sessionId: parts[parts.length - 1],
      cinemaId: parts[parts.length - 2] || defaultCinemaId,
      targetDate: parts[parts.length - 3],
      itemKey,
      movieName: decodeURIComponent(itemKey).replace(/-/g, ' ')
    };
  }

  // Movie detail link: /movies/details/{itemkey} or /movies/{itemkey}
  if (input.includes('/movies/details/') || input.includes('/movies/')) {
    const match = input.match(/\/movies\/(?:details\/)?([^\/?#]+)/i);
    if (match && match[1]) return { kind: 'movie-link', input, itemKey: match[1] };
  }

  const uuidMatch = input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch) return { kind: 'uuid', input, uuid: uuidMatch[0] };

  // TGV session ids are 5-8 digit numbers
  if (/^\d{5,8}$/.test(input)) return { kind: 'session', input };

  // itemkey hyphenated alias, e.g. spider-man-brand-new-day
  if (/^[a-z0-9-]+$/.test(input) && input.includes('-')) return { kind: 'alias', input };

  return { kind: 'search', input };
}

module.exports = { classifyInput };
