// 安全 decodeURIComponent：旧按钮载荷可能已被下划线破坏，解码失败时原样返回
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

// 统一解析 callback_data：新格式用 | 分隔且仅含 ID，同时兼容历史下划线格式
function parseCallback(data) {
  if (typeof data !== 'string' || !data) return null;
  if (data === 'refresh_dashboard') return { action: 'refresh_dashboard', args: [] };

  if (data.includes('|')) {
    const [action, ...args] = data.split('|');
    return { action, args };
  }

  // 旧格式 pick_<cinema>_<session>_<name>_<HH:MM>（name 里可能混入下划线）
  const legacyPick = data.match(/^pick_([^_]+)_([^_]+)_(.+)_(\d{1,2}:\d{2})$/);
  if (legacyPick) {
    return { action: 'pick', args: [legacyPick[1], legacyPick[2], legacyPick[4], safeDecode(legacyPick[3])] };
  }

  // 旧格式 pick（无时间部分）：场次与标题仍可救回
  const legacyPickLoose = data.match(/^pick_([^_]+)_([^_]+)_(.*)$/);
  if (legacyPickLoose) {
    return { action: 'pick', args: [legacyPickLoose[1], legacyPickLoose[2], '', safeDecode(legacyPickLoose[3])] };
  }

  // 旧格式 quicksub_<cinema>_<session>_<name>
  const legacyQuick = data.match(/^quicksub_([^_]+)_([^_]+)(?:_(.*))?$/);
  if (legacyQuick) {
    return { action: 'quicksub', args: [legacyQuick[1], legacyQuick[2], legacyQuick[3] ? safeDecode(legacyQuick[3]) : ''] };
  }

  // 旧格式 showall_/suball_/sub_/del_（载荷内无用户文本）
  const legacy = data.match(/^(showall|suball|sub|del)_(.+)$/);
  if (legacy) {
    return { action: legacy[1], args: legacy[2].split('_') };
  }

  return null;
}

module.exports = {
  safeDecode,
  parseCallback
};
