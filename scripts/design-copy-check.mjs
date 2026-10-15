import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = ['index.html', 'app.js', 'styles.css', 'import-worker.js', 'app-exploration.js', 'app-graph.js', 'app-motion.js', 'demo-data.js'];
const forbidden = [
  ['LOCAL', 'ARCHIVE'].join(' '), ['01', 'IMPORT'].join(' / '), ['02', 'VIEW'].join(' / '),
  ['03', 'FILTERS'].join(' / '), ['04', 'TIME'].join(' / '), ['FOCUS', ''].join(' / '),
  ['TEXT', 'ALTERNATIVE'].join(' '), ['ARCHIVE', 'NOTE'].join(' '), ['ATLAS', 'FIELD'].join(' '),
  ['WAITING FOR A', 'LOCAL FILE'].join(' '), ['MSG', 'NODES'].join(' / '), ['SCALE', '1.0'].join(' '),
  ['Локальный файл', ' · без API · без аккаунта'].join(''),
];
const required = [
  'файл остаётся в браузере',
  'тексты сообщений не выводятся',
  'загрузите архив',
  '<h1>telegram constellation</h1>',
  '<title>telegram constellation',
  'сбросить фильтры',
];
const hits = [];
for (const file of files) {
  const content = readFileSync(resolve(root, file), 'utf8');
  for (const match of content.matchAll(/telegram constellation/gi)) if (match[0] !== 'telegram constellation') hits.push(`${file}: название продукта должно быть строчным`);
  for (const phrase of forbidden) if (content.includes(phrase)) hits.push(`${file}: ${phrase}`);
  if (file === 'index.html') {
    const authoredMarkup = content.replace(/ data-i18n(?:-[a-z-]+)?="[^"]*"/g, '');
    for (const phrase of required) if (!authoredMarkup.includes(phrase)) hits.push(`${file}: пропущен обязательный текст «${phrase}»`);
  }
}
for (const file of ['README.md', 'README.ru.md', 'docs/DESIGN-RULES.md']) {
  const content = readFileSync(resolve(root, file), 'utf8');
  for (const match of content.matchAll(/telegram constellation/gi)) if (match[0] !== 'telegram constellation') hits.push(`${file}: название продукта должно быть строчным`);
}
if (hits.length) {
  console.error('Найдены запрещённые технические метки:\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`Design copy check passed (${files.length} source files).`);
