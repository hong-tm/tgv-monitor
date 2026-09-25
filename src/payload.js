// Safe decodeURIComponent: legacy button payloads may already be corrupted by underscores; return as-is on failure
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

// Unified callback_data parsing: the new format uses | separators with IDs only; legacy underscore formats still accepted
function parseCallback(data) {
  if (typeof data !== 'string' || !data) return null;
  if (data === 'refresh_dashboard') return { action: 'refresh_dashboard', args: [] };

  if (data.includes('|')) {
    const [action, ...args] = data.split('|');
    return { action, args };
  }

  // Legacy pick_<cinema>_<session>_<name>_<HH:MM> (name may contain underscores)
  const legacyPick = data.match(/^pick_([^_]+)_([^_]+)_(.+)_(\d{1,2}:\d{2})$/);
  if (legacyPick) {
    return { action: 'pick', args: [legacyPick[1], legacyPick[2], legacyPick[4], safeDecode(legacyPick[3])] };
  }

  // Legacy pick without a time part: session and title are still recoverable
  const legacyPickLoose = data.match(/^pick_([^_]+)_([^_]+)_(.*)$/);
  if (legacyPickLoose) {
    return { action: 'pick', args: [legacyPickLoose[1], legacyPickLoose[2], '', safeDecode(legacyPickLoose[3])] };
  }

  // Legacy quicksub_<cinema>_<session>_<name>
  const legacyQuick = data.match(/^quicksub_([^_]+)_([^_]+)(?:_(.*))?$/);
  if (legacyQuick) {
    return { action: 'quicksub', args: [legacyQuick[1], legacyQuick[2], legacyQuick[3] ? safeDecode(legacyQuick[3]) : ''] };
  }

  // Legacy showall_/suball_/sub_/del_ (payload carries no user text)
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
