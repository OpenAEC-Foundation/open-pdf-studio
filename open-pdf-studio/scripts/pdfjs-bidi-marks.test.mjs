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
  'CGJ U+034F (#957)': '\u0645\u064E\u034F\u0631\u0652',
  'U+0301 combining acute': '\u0628\u064E\u0301\u0627\u0628',
  'U+036F (end of block)': '\u0628\u064E\u036F\u0627\u0628',
  'variation selector U+FE00': '\u0628\u064E\uFE00\u0627\u0628',
  'variation selector U+FE0F': '\u0628\u064E\uFE0F\u0627\u0628',
  'combining half mark U+FE20': '\u0628\u064E\uFE20\u0627\u0628',
  'diacritical supplement U+1DC0': '\u0628\u064E\u1DC0\u0627\u0628',
  'Arabic Extended-A mark U+08F0': '\u0628\u064E\u08F0\u0627\u0628',
  'two marks in a row': '\u0645\u034F\u0301\u064E\u0631',
};
// Gedrag dat niet mag veranderen (ongepatcht = gepatcht).
const CONTROLS = [
  'cafe\u0301 au lait', // LTR met combinerend teken: geen bidi
  'plain LTR text 123',
  '\u05E9\u05B8\u05C1\u05DC\u05D5\u05B9\u05DD', // Hebreeuws met punten
  '\u0645\u0631\u062D\u0628\u0627', // Arabisch zonder merktekens
  rev('\u0639\u062F\u062F') + ' 12', // RTL met cijfers
  '12.5 ' + rev('\u0645\u0631\u062D\u0628\u0627') + ' (x)', // gemengd met leestekens
  'abc ' + rev('\u0645\u0631') + ' def ghi jkl', // LTR-regel met Arabisch woord
  '\u0645\u0631\u062D\u0628\u0627\u060C \u0661\u0662', // Arabische komma en cijfers
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
