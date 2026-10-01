// Вебхук Telegram-бота: доступ по заявкам и добавление задач
import { sql } from '../lib/db.js';
import { send, edit, answer, esc } from '../lib/tg.js';
import { parseTask } from '../lib/parse.js';
import { todayMsk, addDays, formatRu, parseRuDate } from '../lib/dates.js';

const ADMIN = Number(process.env.ADMIN_TELEGRAM_ID);

const HELP =
  '📝 <b>Как добавить задачу</b>\n' +
  'Пришли мне одно сообщение:\n' +
  '• первая строка — название\n' +
  '• дальше — описание\n' +
  '• ссылки на файлы — в любом месте; подпись пиши перед ссылкой: <i>ТЗ: https://...</i>\n\n' +
  'Можно просто переслать сообщение из другого чата — оно тоже станет задачей.\n' +
  'После этого я спрошу дедлайн.';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok');
  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) {
    return res.status(401).send('unauthorized');
  }
  try {
    const u = req.body;
    if (u.message) await onMessage(u.message);
    else if (u.callback_query) await onCallback(u.callback_query);
  } catch (e) {
    console.error(e);
  }
  // Всегда отвечаем 200, иначе Telegram будет повторять одно и то же обновление
  res.status(200).send('ok');
}

async function getUser(id) {
  const rows = await sql`SELECT telegram_id, access FROM users WHERE telegram_id = ${id}`;
  return rows[0] ?? null;
}

// ---------- Сообщения ----------

async function onMessage(msg) {
  if (msg.chat.type !== 'private') return; // в группах бот не работает
  const from = msg.from;
  const text = msg.text ?? msg.caption ?? '';
  const user = await getUser(from.id);

  if (text.startsWith('/start')) return onStart(from, user);
  if (!user) return send(from.id, 'Нажми /start, чтобы запросить доступ.');
  if (user.access === 'pending') return send(from.id, 'Заявка ещё на рассмотрении ⏳');
  if (user.access === 'rejected') return send(from.id, 'Доступ к боту закрыт.');

  if (text.startsWith('/help')) return send(from.id, HELP);

  // Ответ на просьбу ввести дату
  const reply = msg.reply_to_message;
  if (reply?.from?.is_bot) {
    const m = (reply.text ?? '').match(/задачи #(\d+)/);
    if (m) return onDateReply(from, Number(m[1]), text);
  }

  if (text.startsWith('/')) return send(from.id, 'Не знаю такой команды. ' + HELP);
  if (!text.trim()) return send(from.id, 'Пришли задачу текстом 🙂\n\n' + HELP);

  return createTask(from, text, msg.entities ?? msg.caption_entities ?? []);
}

async function onStart(from, user) {
  const isAdmin = from.id === ADMIN;

  if (!user) {
    const access = isAdmin ? 'approved' : 'pending';
    await sql`
      INSERT INTO users (telegram_id, username, first_name, access)
      VALUES (${from.id}, ${from.username ?? null}, ${from.first_name ?? null}, ${access})`;
    if (!isAdmin) {
      await notifyAdmin(from);
      return send(from.id, 'Привет! Заявка на доступ отправлена ✉️\nКак только её одобрят, я напишу.');
    }
    user = { access };
  } else {
    await sql`
      UPDATE users SET username = ${from.username ?? null}, first_name = ${from.first_name ?? null}
      WHERE telegram_id = ${from.id}`;
    if (isAdmin && user.access !== 'approved') {
      await sql`UPDATE users SET access = 'approved' WHERE telegram_id = ${from.id}`;
      user.access = 'approved';
    }
  }

  if (user.access === 'pending') return send(from.id, 'Заявка уже отправлена, жду решения ⏳');
  if (user.access === 'rejected') return send(from.id, 'Доступ к боту закрыт.');
  return send(from.id, `Привет, ${esc(from.first_name)}! 👋\n\n` + HELP);
}

async function notifyAdmin(from) {
  const name = esc([from.first_name, from.last_name].filter(Boolean).join(' '));
  const uname = from.username ? ` (@${esc(from.username)})` : '';
  return send(ADMIN, `🙋 <b>Новая заявка на доступ</b>\n${name}${uname}\nID: <code>${from.id}</code>`, {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Одобрить', callback_data: `acc:ok:${from.id}` },
        { text: '❌ Отклонить', callback_data: `acc:no:${from.id}` },
      ]],
    },
  });
}

// ---------- Задачи ----------

function deadlineKeyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: 'Сегодня', callback_data: `dl:${id}:today` },
        { text: 'Завтра', callback_data: `dl:${id}:tomorrow` },
        { text: 'Через неделю', callback_data: `dl:${id}:week` },
      ],
      [
        { text: '📅 Выбрать дату', callback_data: `dl:${id}:pick` },
        { text: 'Без срока', callback_data: `dl:${id}:none` },
      ],
    ],
  };
}

function taskText(id, title, labels, deadline) {
  let t = `✅ Задача #${id} сохранена\n<b>${esc(title)}</b>`;
  if (labels.length) t += `\n🔗 ${labels.map(esc).join(', ')}`;
  if (deadline !== undefined) t += `\n📅 Дедлайн: ${formatRu(deadline)}`;
  return t;
}

async function createTask(from, text, entities) {
  const { title, body, links } = parseTask(text, entities);

  const [task] = await sql`
    INSERT INTO tasks (author_id, title, body)
    VALUES (${from.id}, ${title}, ${body || null})
    RETURNING id`;

  for (let i = 0; i < links.length; i++) {
    await sql`
      INSERT INTO task_links (task_id, url, label, position)
      VALUES (${task.id}, ${links[i].url}, ${links[i].label}, ${i})`;
  }

  return send(from.id, taskText(task.id, title, links.map((l) => l.label)) + '\n\nКогда дедлайн?', {
    reply_markup: deadlineKeyboard(task.id),
  });
}

async function getOwnTask(taskId, userId) {
  const rows = await sql`SELECT id, title FROM tasks WHERE id = ${taskId} AND author_id = ${userId}`;
  return rows[0] ?? null;
}

async function getLabels(taskId) {
  const rows = await sql`SELECT label FROM task_links WHERE task_id = ${taskId} ORDER BY position`;
  return rows.map((r) => r.label);
}

async function onDateReply(from, taskId, text) {
  const task = await getOwnTask(taskId, from.id);
  if (!task) return send(from.id, 'Не нашёл такую задачу.');

  const date = parseRuDate(text);
  if (!date) {
    return send(from.id, `Не понял дату 🤔 Напиши дату для задачи #${taskId} ещё раз, например 15.10 или 15.10.2026`, {
      reply_markup: { force_reply: true, input_field_placeholder: 'ДД.ММ' },
    });
  }

  await sql`UPDATE tasks SET deadline = ${date}, updated_at = now() WHERE id = ${taskId}`;
  return send(from.id, taskText(taskId, task.title, await getLabels(taskId), date));
}

// ---------- Кнопки ----------

async function onCallback(q) {
  const [kind, a, b] = (q.data ?? '').split(':');
  const chatId = q.message?.chat.id;
  const msgId = q.message?.message_id;

  if (kind === 'acc') {
    if (q.from.id !== ADMIN) return answer(q.id, 'Нет прав');
    const uid = Number(b);
    const access = a === 'ok' ? 'approved' : 'rejected';
    const rows = await sql`
      UPDATE users SET access = ${access} WHERE telegram_id = ${uid}
      RETURNING first_name, username`;
    const u = rows[0];
    const who = u ? esc(u.first_name ?? '') + (u.username ? ` (@${esc(u.username)})` : '') : uid;
    await edit(chatId, msgId, `${access === 'approved' ? '✅ Одобрено' : '❌ Отклонено'}: ${who}`);
    if (access === 'approved') await send(uid, '🎉 Доступ открыт!\n\n' + HELP);
    else await send(uid, 'К сожалению, заявка на доступ отклонена.');
    return answer(q.id, 'Готово');
  }

  if (kind === 'dl') {
    const user = await getUser(q.from.id);
    if (user?.access !== 'approved') return answer(q.id, 'Нет доступа');
    const taskId = Number(a);
    const task = await getOwnTask(taskId, q.from.id);
    if (!task) return answer(q.id, 'Задача не найдена');

    if (b === 'pick') {
      await send(q.from.id, `📅 Напиши дату для задачи #${taskId} в формате ДД.ММ (например, 15.10)`, {
        reply_markup: { force_reply: true, input_field_placeholder: 'ДД.ММ' },
      });
      return answer(q.id);
    }

    const today = todayMsk();
    const date = { today, tomorrow: addDays(today, 1), week: addDays(today, 7), none: null }[b];
    if (date === undefined) return answer(q.id);

    await sql`UPDATE tasks SET deadline = ${date}, updated_at = now() WHERE id = ${taskId}`;
    await edit(chatId, msgId, taskText(taskId, task.title, await getLabels(taskId), date));
    return answer(q.id, date ? `Дедлайн: ${formatRu(date)}` : 'Без срока');
  }

  return answer(q.id);
}
