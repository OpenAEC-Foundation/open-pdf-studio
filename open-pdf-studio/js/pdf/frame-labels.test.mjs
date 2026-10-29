// Names of the drawing-frame styles in the New Document dialog (#835):
// the three built-in styles are translated, any other prefix found on disk
// (user or tenant frames) keeps its own file-name prefix, and the preview
// caption shows style, paper size, orientation and size in the app language.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';

import { BUILTIN_FRAME_STYLES, frameStyleLabel, framePreviewText } from './frame-labels.js';

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '../i18n/locales');
const talen = readdirSync(LOCALES).sort();
const lees = (taal) => JSON.parse(readFileSync(join(LOCALES, taal, 'dialogs.json'), 'utf8'));
const plekhouders = (tekst) => [...new Set(String(tekst).match(/\{\{\s*\w+\s*\}\}/g) || [])]
  .map((p) => p.replace(/\s/g, '')).sort();

async function vertaler(taal) {
  const inst = i18next.createInstance();
  const resources = {};
  for (const l of new Set(['en', taal])) resources[l] = { dialogs: lees(l) };
  await inst.init({ lng: taal, fallbackLng: 'en', ns: ['dialogs'], defaultNS: 'dialogs', resources,
    interpolation: { escapeValue: false } });
  return (key, opts) => inst.t(key, opts);
}

const A1_LIGGEND = { widthMm: 841, heightMm: 594, label: 'A1' };

test('every language has a name for each built-in style and both orientations', () => {
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const nd = lees(taal).newDoc || {};
    for (const stijl of BUILTIN_FRAME_STYLES) {
      assert.equal(typeof nd.frameStyles?.[stijl], 'string', `${taal} newDoc.frameStyles.${stijl}`);
      assert.ok(nd.frameStyles[stijl].trim(), `${taal} newDoc.frameStyles.${stijl} is empty`);
    }
    for (const o of ['portrait', 'landscape']) {
      assert.equal(typeof nd.frameOrientation?.[o], 'string', `${taal} newDoc.frameOrientation.${o}`);
      assert.ok(nd.frameOrientation[o].trim(), `${taal} newDoc.frameOrientation.${o} is empty`);
    }
  }
});

test('the preview caption uses the same placeholders in every language', () => {
  const verwacht = plekhouders(lees('en').newDoc.framePreview);
  assert.deepEqual(verwacht, ['{{height}}', '{{orientation}}', '{{paper}}', '{{style}}', '{{width}}']);
  for (const taal of talen) {
    assert.deepEqual(plekhouders(lees(taal).newDoc.framePreview), verwacht, taal);
  }
});

test('the new keys appear only once in each dialogs file', () => {
  for (const taal of talen) {
    const raw = readFileSync(join(LOCALES, taal, 'dialogs.json'), 'utf8');
    for (const key of ['frameStyles', 'framePreview', 'frameOrientation']) {
      assert.equal(raw.split(`"${key}"`).length - 1, 1, `${taal}: "${key}"`);
    }
  }
});

test('English and Dutch names for the built-in styles', async () => {
  const en = await vertaler('en');
  const nl = await vertaler('nl');
  assert.deepEqual(BUILTIN_FRAME_STYLES.map((s) => frameStyleLabel(s, en)),
    ['Large format', 'Detail sheet', 'Cover sheet']);
  assert.deepEqual(BUILTIN_FRAME_STYLES.map((s) => frameStyleLabel(s, nl)),
    ['Grootformaat', 'Detailblad', 'Voorblad']);
});

test('a custom prefix keeps its own name, also for names that exist on Object', async () => {
  const en = await vertaler('en');
  for (const [stijl, label] of [['customstudio', 'Customstudio'], ['constructor', 'Constructor'],
    ['tostring', 'Tostring'], ['__proto__', '__proto__'], ['framestyles', 'Framestyles']]) {
    assert.equal(frameStyleLabel(stijl, en), label, stijl);
  }
  assert.equal(frameStyleLabel('', en), '');
});

test('the caption is translated and has no raw file name', async () => {
  const en = await vertaler('en');
  const nl = await vertaler('nl');
  const de = await vertaler('de');
  const frame = { stijl: 'grootformaat', fileName: 'grootformaat_a1_liggend.pdf' };
  assert.equal(framePreviewText({ dims: A1_LIGGEND, frame, orientation: 'landscape', t: en }),
    'Large format, A1 landscape, 841 x 594 mm');
  assert.equal(framePreviewText({ dims: A1_LIGGEND, frame, orientation: 'landscape', t: nl }),
    'Grootformaat, A1 liggend, 841 x 594 mm');
  assert.equal(framePreviewText({ dims: { widthMm: 594, heightMm: 841, label: 'A1' }, frame,
    orientation: 'portrait', t: de }), 'Großformat, A1 Hochformat, 594 x 841 mm');
  const eigen = { stijl: 'customstudio', fileName: 'customstudio_a1_liggend.pdf' };
  assert.equal(framePreviewText({ dims: A1_LIGGEND, frame: eigen, orientation: 'landscape', t: en }),
    'Customstudio, A1 landscape, 841 x 594 mm');
});

test('without a frame the caption is the blank-page size', async () => {
  const en = await vertaler('en');
  assert.equal(framePreviewText({ dims: A1_LIGGEND, frame: null, orientation: 'landscape', t: en }),
    '841 x 594 mm (A1)');
});

test('the dialog uses these helpers in reactive positions, so a language switch updates it', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
    '../solid/components/dialogs/NewDocDialog.jsx'), 'utf8');
  assert.match(src, /import \{ frameStyleLabel, framePreviewText \} from '\.\.\/\.\.\/\.\.\/pdf\/frame-labels\.js'/);
  assert.match(src, /<option value=\{s\}>\{frameStyleLabel\(s, t\)\}<\/option>/);
  assert.match(src, /const previewText = createMemo\(\(\) => \{\s*return framePreviewText\(/);
  assert.doesNotMatch(src, /f\.fileName/);
});
