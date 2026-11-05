// #957: combinerende tekens buiten de Hebreeuwse/Arabische blokken krijgen in
// bidi() het type NSM, zodat tekstextractie de logische volgorde behoudt.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { patchBidiCombiningMarks } from './pdfjs-bidi-marks.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const legacyPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
// De losse webunit (vite.web-unit.config.js) levert de moderne build.
const modernPath = require.resolve('pdfjs-dist/build/pdf.worker.mjs');
const builds = [['legacy', legacyPath], ['modern', modernPath]];
const MARKER = 'charType = "NSM";\n    } else if (0x0700';
const probe = fileURLToPath(new URL('./bidi-marks-probe.mjs', import.meta.url));

const temp = mkdtempSync(join(tmpdir(), 'opds-bidi-test-'));
test.after(() => rmSync(temp, { recursive: true, force: true }));
let copies = 0;
async function workerModule(workerSource) {
  const file = join(temp, `pdf.worker.${copies++}.mjs`);
  writeFileSync(file, `${workerSource}\nexport { bidi };\n`);
  return (await import(pathToFileURL(file).href)).bidi;
}
const rev = s => [...s].reverse().join('');
const cps = s => [...s].map(c => c.codePointAt(0).toString(16));

// [logische tekst, verwachte richting] — de PDF bevat de visuele volgorde.
const MARKS = {
  'CGJ U+034F (#957)': 'مَ͏رْ',
  'U+0301 combining acute': 'بَ́اب',
  'U+036F (end of block)': 'بَͯاب',
  'variation selector U+FE00': 'بَ︀اب',
  'variation selector U+FE0F': 'بَ️اب',
  'combining half mark U+FE20': 'بَ︠اب',
  'diacritical supplement U+1DC0': 'بَ᷀اب',
  'Arabic Extended-A mark U+08F0': 'بࣰَاب',
  'two marks in a row': 'م͏َ́ر',
};
// Gedrag dat niet mag veranderen (ongepatcht = gepatcht).
const CONTROLS = [
  'café au lait', // LTR met combinerend teken: geen bidi
  'plain LTR text 123',
  'שָׁלוֹם', // Hebreeuws met punten
  'مرحبا', // Arabisch zonder merktekens
  rev('عدد') + ' 12', // RTL met cijfers
  '12.5 ' + rev('مرحبا') + ' (x)', // gemengd met leestekens
  'abc ' + rev('مر') + ' def ghi jkl', // LTR-regel met Arabisch woord
  'مرحبا، ١٢', // Arabische komma en cijfers
];

for (const [build, path] of builds) {
  const source = readFileSync(path, 'utf8');
  test(`${build} build: bidi patch matches once, is idempotent and rejects dependency drift`, () => {
    const fixed = patchBidiCombiningMarks(source);
    assert.notEqual(fixed, source);
    assert.equal(fixed.split(MARKER).length, 2, 'exactly one site patched');
    assert.equal(patchBidiCombiningMarks(fixed), fixed);
    assert.throws(() => patchBidiCombiningMarks(source + source), /no longer matches.*#957/);
    assert.throws(() => patchBidiCombiningMarks(source.replace('charCode <= 0x08ac ||', 'charCode <= 0x08b4 ||')), /no longer matches/);
    const all = patchPdfjsWorker(source);
    assert.equal(all.split(MARKER).length, 2, 'the shipped worker carries the patch');
    assert.equal(patchPdfjsWorker(all), all);
  });

  test(`${build} build: real bidi() keeps combining marks in logical order`, async () => {
    const original = await workerModule(source);
    const fixed = await workerModule(patchPdfjsWorker(source));
    // Ongepatcht: precies de verwisseling uit #957.
    assert.deepEqual(cps(original(rev(MARKS['CGJ U+034F (#957)'])).str), ['645', '34f', '64e', '631', '652']);
    for (const [name, logical] of Object.entries(MARKS)) {
      const r = fixed(rev(logical));
      assert.deepEqual(cps(r.str), cps(logical), name);
      assert.equal(r.dir, 'rtl', name);
    }
    for (const visual of CONTROLS) {
      assert.deepEqual(fixed(visual), original(visual), JSON.stringify(visual));
      assert.deepEqual(fixed(visual, 0), original(visual, 0));
      assert.deepEqual(fixed(visual, 1), original(visual, 1));
    }
    // Verticale tekst en lege tekst blijven ongemoeid.
    assert.deepEqual(fixed(rev(MARKS['CGJ U+034F (#957)']), -1, true), original(rev(MARKS['CGJ U+034F (#957)']), -1, true));
    assert.deepEqual(fixed(''), original(''));
  });
}

// Via de publieke PDF.js-API (Type 3-font met ToUnicode) en de Office-export.
function run(mode, path) {
  const p = spawnSync(process.execPath, [probe, mode, path], { encoding: 'utf8', timeout: 60000 });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  return Object.fromEntries(p.stdout.trim().split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)).map(r => [r.name, r]));
}
for (const [build, path] of builds) test(`${build} build: getTextContent and DOCX export keep the exact Unicode order`, () => {
  const original = run('original', path);
  assert.notDeepEqual(original.cgj.raw, original.cgj.expected, 'reproduces #957 unpatched');
  assert.notDeepEqual(original.cgj.normal, original.cgj.expected, 'disableNormalization is no workaround');
  const fixed = run('patched', path);
  assert.deepEqual(Object.keys(fixed), ['cgj', 'acute', 'vs', 'hebrew']);
  for (const r of Object.values(fixed)) {
    assert.deepEqual(r.normal, r.expected, `${r.name}: getTextContent()`);
    assert.deepEqual(r.raw, r.expected, `${r.name}: disableNormalization`);
    assert.deepEqual(r.dir, ['rtl'], r.name);
    assert.deepEqual(r.docx.slice(-r.expected.length), r.expected, `${r.name}: DOCX text`);
  }
  assert.deepEqual(fixed.hebrew, original.hebrew, 'Hebrew control unchanged');
});
