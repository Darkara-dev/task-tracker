// Обёртка над Telegram Bot API
const API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

export async function tg(method, params) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await r.json();
  if (!data.ok) console.error('Telegram error:', method, data);
  return data;
}

const noPreview = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

export const send = (chat_id, text, extra = {}) =>
  tg('sendMessage', { chat_id, text, ...noPreview, ...extra });

export const edit = (chat_id, message_id, text, extra = {}) =>
  tg('editMessageText', { chat_id, message_id, text, ...noPreview, ...extra });

export const answer = (callback_query_id, text) =>
  tg('answerCallbackQuery', { callback_query_id, text });

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
