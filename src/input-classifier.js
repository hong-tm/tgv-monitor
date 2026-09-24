// 输入分类：把用户文本路由到六种意图之一，纯函数、无 I/O。分支顺序即优先级。
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function classifyInput(text, defaultCinemaId = 'VIV') {
  const trimmed = text.trim();
  const isExplicitUuidCmd = /^\/?uuid\b/i.test(trimmed) || /@\w+\s+uuid\b/i.test(trimmed);

  let input = trimmed
    .replace(/^@\w+\s*/i, '')
    .replace(/^\/?(uuid|add)\s*/i, '')
    .trim();

  if (!input) return { kind: 'empty', input };

  // 选座直链：/select-seats/{itemkey}/{date}/{cinema}/{sessionid}，位置从右往左取
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

  // 电影详情链接：/movies/details/{itemkey} 或 /movies/{itemkey}
  if (input.includes('/movies/details/') || input.includes('/movies/')) {
    const match = input.match(/\/movies\/(?:details\/)?([^\/?#]+)/i);
    if (match && match[1]) {
      // 旧行为：解析失败后会继续用整条链接试 UUID 分支，故预存候选
      const uuidMatch = input.match(UUID_PATTERN);
      return { kind: 'movie-link', input, itemKey: match[1], fallbackUuid: uuidMatch ? uuidMatch[0] : null };
    }
  }

  const uuidMatch = input.match(UUID_PATTERN);
  if (uuidMatch) return { kind: 'uuid', input, uuid: uuidMatch[0] };

  // TGV 场次号为 5-8 位纯数字
  if (/^\d{5,8}$/.test(input)) return { kind: 'session', input };

  // itemkey 连字符别名，如 spider-man-brand-new-day
  if (/^[a-z0-9-]+$/.test(input) && input.includes('-')) return { kind: 'alias', input };

  return { kind: 'search', input };
}

module.exports = { classifyInput };
