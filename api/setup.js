// Одноразовая настройка: регистрирует вебхук и команды бота.
// Открыть в браузере: https://<адрес-проекта>/api/setup?key=<WEBHOOK_SECRET>
import { tg } from '../lib/tg.js';

export default async function handler(req, res) {
  if (!process.env.WEBHOOK_SECRET || req.query.key !== process.env.WEBHOOK_SECRET) {
    return res.status(403).send('Нет доступа');
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `https://${host}/api/bot`;

  const webhook = await tg('setWebhook', {
    url,
    secret_token: process.env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  const commands = await tg('setMyCommands', {
    commands: [
      { command: 'start', description: 'Начать / запросить доступ' },
      { command: 'help', description: 'Как добавлять задачи' },
    ],
  });

  res.status(200).json({ webhook_url: url, webhook, commands });
}
