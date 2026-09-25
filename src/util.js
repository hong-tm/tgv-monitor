// HTML-escape dynamic content (TGV API data / user input) before it enters HTML messages, or Telegram returns 400 and drops the whole message
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  escapeHtml
};
