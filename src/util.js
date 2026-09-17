// HTML 转义：动态内容（TGV 接口数据/用户输入）进入 HTML 消息前必须转义，否则 Telegram 返回 400 会整条丢消息
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
