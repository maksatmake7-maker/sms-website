/**
 * check-incidents.js
 * ---------------------------------------------------------------
 * Раз в неделю (см. .github/workflows/incidents-watch.yml) собирает
 * свежие новости с тега tengrinews.kz/tag/завод/ и отбирает те,
 * что ПОХОЖИ на промышленную аварию/пожар/взрыв на производстве.
 *
 * ВАЖНО: скрипт НИКОГДА не публикует новость на сайт напрямую.
 * Он только добавляет кандидата в data/incident-candidates.md —
 * человек (Максат) должен вручную проверить источник и, если всё
 * подтверждается, оформить нормальную карточку в resources.html,
 * как это делалось раньше. Это сознательное решение: общая лента
 * "происшествия" на казахстанских новостных сайтах вперемешку
 * содержит бытовые конфликты, ДТП и криминал — публиковать такое
 * без проверки на профессиональном сайте по промышленной
 * безопасности нельзя.
 *
 * Фильтр: заголовок должен содержать И слово из группы "объект"
 * (завод/цех/предприятие/производство/шахта/рудник/нефтебаза/
 * склад/комбинат), И слово из группы "инцидент" (пожар/взрыв/
 * авари/обруш/утечк/отравлен/погиб/пострада/ЧС). Такое пересечение
 * сильно снижает вероятность ложных срабатываний (одно только
 * слово "завод" в заголовке про продажу актива, зарплаты и т.п.
 * не пройдёт фильтр).
 *
 * Если структура страницы tengrinews.kz изменится и парсинг
 * перестанет находить ссылки — воркфлоу просто ничего не добавит
 * (см. лог запуска в разделе Actions на GitHub), сайт при этом
 * не пострадает, это не критичная зависимость.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://tengrinews.kz/tag/завод/';
const SEEN_FILE = path.join(__dirname, '..', 'data', 'incident-candidates-seen.json');
const CANDIDATES_FILE = path.join(__dirname, '..', 'data', 'incident-candidates.md');

const OBJECT_WORDS = ['завод', 'цех', 'предприяти', 'производств', 'шахт', 'рудник', 'нефтебаз', 'склад', 'комбинат', 'фабрик', 'котельн', 'элеватор'];
const INCIDENT_WORDS = ['пожар', 'взрыв', 'авари', 'обруш', 'утечк', 'отравлен', 'погиб', 'постра', 'чс ', 'возгоран', 'травм'];

function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchesFilter(title) {
  const t = normalize(title);
  const hasObject = OBJECT_WORDS.some((w) => t.includes(w));
  const hasIncident = INCIDENT_WORDS.some((w) => t.includes(w));
  return hasObject && hasIncident;
}

function loadSeen() {
  try {
    return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveSeen(set) {
  fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...set], null, 2));
}

function extractCandidates(html) {
  // Ищем ссылки вида https://tengrinews.kz/<раздел>/<slug>-<цифры>/
  // вместе с текстом заголовка внутри тега <a>...</a>.
  const linkRe = /<a[^>]+href="(https:\/\/tengrinews\.kz\/(?:accidents|events)\/[a-z0-9\-]+-\d+\/)"[^>]*>(.*?)<\/a>/gis;
  const results = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const url = m[1];
    const rawTitle = m[2].replace(/<[^>]+>/g, '').trim();
    if (!rawTitle) continue;
    results.push({ url, title: rawTitle });
  }
  return results;
}

async function main() {
  let html;
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SMS-incident-watcher/1.0)' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
  } catch (err) {
    console.error('Не удалось загрузить источник:', err.message);
    process.exit(0); // не роняем workflow — просто ничего не находим в этот раз
  }

  const all = extractCandidates(html);
  const seen = loadSeen();
  const fresh = all.filter((c) => matchesFilter(c.title) && !seen.has(c.url));

  if (fresh.length === 0) {
    console.log('Новых кандидатов не найдено.');
    return;
  }

  console.log('Найдено новых кандидатов:', fresh.length);

  const today = new Date().toISOString().slice(0, 10);
  let block = `\n## Проверка от ${today}\n\n`;
  for (const c of fresh) {
    block += `- [ ] **${c.title}**\n  ${c.url}\n`;
    seen.add(c.url);
  }

  fs.mkdirSync(path.dirname(CANDIDATES_FILE), { recursive: true });
  fs.appendFileSync(CANDIDATES_FILE, block);
  saveSeen(seen);

  console.log('Записано в', CANDIDATES_FILE);
}

main();
