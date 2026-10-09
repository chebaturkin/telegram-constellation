import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const files = ['index.html', 'app.js', 'styles.css', 'import-worker.js'];
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
  'сбросить фильтры',
];
const hits = [];
for (const file of files) {
  const content = readFileSync(resolve(root, file), 'utf8');
  for (const phrase of forbidden) if (content.includes(phrase)) hits.push(`${file}: ${phrase}`);
  if (file === 'index.html') {
    for (const phrase of required) if (!content.includes(phrase)) hits.push(`${file}: пропущен обязательный текст «${phrase}»`);
  }
}
if (hits.length) {
  console.error('Найдены запрещённые технические метки:\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`Design copy check passed (${files.length} source files).`);
