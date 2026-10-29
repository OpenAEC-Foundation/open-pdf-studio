import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initialLanguage } from './initial-language.js';

// Execute the real startup module with Vite's glob and browser storage supplied
// by the harness. Locale JSON and both i18next libraries are real.
async function start(t, browser, stored) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: browser });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
  const loaded = new Set();
  const modules = new Proxy({}, { get: (_, path) => async () => {
    loaded.add(path.split('/')[2]);
    return { default: JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) };
  } });
  const source = (await readFile(new URL('./config.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '')
    .replace("import.meta.glob('./locales/*/*.json')", 'modules')
    .replace(/export default i18next;/, '')
    .replace(/export /g, '');
  const instance = i18next.createInstance();
  const storage = () => {
    if (stored instanceof Error) throw stored;
    return stored;
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('i18next', 'LanguageDetector', 'leesOpslag', 'modules', 'initialLanguage', source)(
    instance, LanguageDetector, storage, modules, initialLanguage,
  );
  return { instance, loaded };
}

test('Italian preference is loaded even when navigator.language says English', async t => {
  const { instance, loaded } = await start(t, { languages: ['it-IT', 'en-US'], language: 'en-US' });
  assert.equal(instance.t('cancel'), 'Annulla');
  assert.deepEqual([...loaded].sort(), ['en', 'it']);
});

test('unsupported first preference falls through to the next supported language', async t => {
  const { instance, loaded } = await start(t, { languages: ['zz-ZZ', 'it-IT'], language: 'zz-ZZ' });
  assert.equal(instance.t('cancel'), 'Annulla');
  assert.deepEqual([...loaded].sort(), ['en', 'it']);
});

test('stored regional language overrides the browser preferences', async t => {
  const { instance, loaded } = await start(t, { languages: ['en-US'], language: 'en-US' }, 'it-CH');
  assert.equal(instance.t('cancel'), 'Annulla');
  assert.deepEqual([...loaded].sort(), ['en', 'it']);
});

test('unavailable storage still permits Italian startup', async t => {
  const { instance } = await start(t, { languages: ['it-IT'], language: 'it-IT' }, new Error('Storage blocked'));
  assert.equal(instance.t('cancel'), 'Annulla');
});

test('unknown saved preference does not hide a supported browser preference', async t => {
  const { instance } = await start(t, { languages: ['it-IT'], language: 'it-IT' }, 'unknown');
  assert.equal(instance.t('cancel'), 'Annulla');
});

test('without a supported preference startup falls back to English only', async t => {
  const { instance, loaded } = await start(t, { languages: ['zz-ZZ'], language: 'zz-ZZ' });
  assert.equal(instance.t('cancel'), 'Cancel');
  assert.deepEqual([...loaded], ['en']);
});

test('resolver handles auto, regional codes, old browser fields and absent navigator', () => {
  const supported = ['en', 'it', 'nl'];
  assert.equal(initialLanguage('auto', { languages: ['IT-it'] }, supported), 'it');
  assert.equal(initialLanguage(null, { userLanguage: 'nl-NL', language: 'en-US' }, supported), 'nl');
  assert.equal(initialLanguage(null, undefined, supported), 'en');
});

test('choosing "auto" later uses the same resolver as startup', async () => {
  const source = (await readFile(new URL('./useTranslation.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const auto = source.slice(source.indexOf("if (lang === 'auto') {"), source.indexOf('await loadLocale(finalLang);'));
  assert.match(auto, /finalLang = initialLanguage\(undefined, /);
  assert.doesNotMatch(auto, /detected\[0\]/);
});
