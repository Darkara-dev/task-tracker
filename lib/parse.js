// Разбор сообщения в задачу: первая строка — название, остальное — описание, ссылки отдельно

const KINDS = [
  [/docs\.google\.com\/document/, 'Google Документ'],
  [/docs\.google\.com\/spreadsheets/, 'Google Таблица'],
  [/docs\.google\.com\/presentation/, 'Google Презентация'],
  [/docs\.google\.com\/forms/, 'Google Форма'],
  [/drive\.google\.com/, 'Google Диск'],
  [/disk\.yandex\.|yadi\.sk/, 'Яндекс Диск'],
  [/docs\.yandex\./, 'Яндекс Документы'],
  [/figma\.com/, 'Figma'],
  [/notion\.(so|site)/, 'Notion'],
  [/dropbox\.com/, 'Dropbox'],
  [/cloud\.mail\.ru/, 'Облако Mail'],
  [/youtube\.com|youtu\.be/, 'YouTube'],
  [/miro\.com/, 'Miro'],
];

export function linkKind(url) {
  for (const [re, name] of KINDS) if (re.test(url)) return name;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Ссылка'; }
}

const URL_RE = /https?:\/\/[^\s<>"«»]+/g;
const cleanUrl = (u) => u.replace(/[.,;:!?)\]]+$/, '');
const cleanLabel = (s) => s.replace(/[\s:—–\-|•]+$/, '').replace(/^[\s:—–\-|•]+/, '').trim();

export function parseTask(text, entities = []) {
  const links = [];
  const seen = new Set();
  const add = (url, label) => {
    url = cleanUrl(url);
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ url, label: (label || '').slice(0, 100) || linkKind(url) });
  };

  // Ссылки, спрятанные под текстом (гиперссылки в пересланных сообщениях)
  for (const e of entities) {
    if (e.type === 'text_link' && e.url) add(e.url, text.substr(e.offset, e.length).trim());
  }

  const kept = [];
  for (const line of text.split('\n')) {
    const urls = line.match(URL_RE);
    if (!urls) { kept.push(line); continue; }
    // Подпись — текст перед ссылкой на той же строке ("ТЗ: https://...")
    let rest = line;
    for (const u of urls) {
      const idx = rest.indexOf(u);
      add(u, cleanLabel(rest.slice(0, idx)));
      rest = rest.slice(idx + u.length);
    }
    kept.push(null); // строка со ссылкой уходит в ссылки, а не в описание
  }

  // Название — первая непустая строка без ссылки
  const titleIdx = kept.findIndex((l) => l !== null && l.trim());
  let title = titleIdx >= 0 ? kept[titleIdx].trim() : '';
  if (!title) title = links[0] ? links[0].label : 'Новая задача';

  const body = kept
    .filter((l, i) => l !== null && i !== titleIdx)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title: title.slice(0, 200), body, links };
}
