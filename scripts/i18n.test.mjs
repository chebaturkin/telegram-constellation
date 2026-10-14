import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const helper = new URL('../i18n.js', import.meta.url);
test('locale helper exists for local static deployment', () => assert.ok(existsSync(helper), 'locale helper is missing'));
if (existsSync(helper)) {
 const { resolveLocale, dictionaries, setLocale, t } = await import(helper);
 test('query > stored > first supported browser language > english', () => {
  assert.equal(resolveLocale({search:'?lang=ru',stored:'en',languages:['en-US']}),'ru');
  assert.equal(resolveLocale({search:'?lang=xx',stored:'ru',languages:['en-US']}),'ru');
  assert.equal(resolveLocale({languages:['fr-FR','ru-RU','en-US']}),'ru');
  assert.equal(resolveLocale({languages:['fr']}),'en');
  assert.equal(resolveLocale({search:'?lang=en',stored:'ru'}),'en');
 });
 test('dictionaries have matching keys and interpolation tokens', () => {
  assert.deepEqual(Object.keys(dictionaries.ru).sort(),Object.keys(dictionaries.en).sort());
  for(const key of Object.keys(dictionaries.ru)) assert.deepEqual([...dictionaries.ru[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...dictionaries.en[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(), key);
 });
 test('manual choice remains usable with blocked storage and history', () => {
  const blocked = { getItem(){throw Error('blocked')},setItem(){throw Error('blocked')} };
  assert.doesNotThrow(()=>setLocale('ru',{storage:blocked,history:{replaceState(){throw Error('blocked')}},url:'https://example.com/?keep=1#draft'}));
  assert.equal(t('language'),'язык');
  setLocale('en'); assert.equal(t('language'),'language');
 });
}
