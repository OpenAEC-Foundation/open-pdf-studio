// Bewaakt de bedrading van proefleescorrecties (#508) in de opslag en de lader.
//
// saver.js en de converter zijn in node niet te laden (ze hangen via
// core/state aan de DOM), dus deze test leest de broncode. De gevaarlijke
// halve toestand is: '/Caret' wel omgezet maar niet afgehandeld (elke save
// verdubbelt de invoegtekens) of afgehandeld maar niet omgezet (elke save
// gooit ze weg). Beide helften moeten dus samen in de code staan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { SOORTEN_MET_EIGEN_TEKST } from './loader/annotatie-opmerking.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('saver.js handelt /Caret af en schrijft correcties met de gedeelde bouwstenen', () => {
  const opslag = bron('./saver.js');
  const handled = /const handledSubtypes = new Set\(\[([^\]]*)\]\)/.exec(opslag);
  assert.ok(handled, 'handledSubtypes gevonden');
  assert.match(handled[1], /'\/Caret'/, "handledSubtypes bevat '/Caret'");
  assert.match(opslag, /from '\.\/saver\/correction-dicts\.js'/);
  assert.match(opslag, /from '\.\/saver\/rotatie-mapper\.js'/);
  assert.doesNotMatch(opslag, /function _rotVisualMapper/, 'de omrekening staat alleen in rotatie-mapper.js');
  assert.match(opslag, /linkPlanForSave\(pageAnnotations\)/);
  assert.match(opslag, /case 'caret':[\s\S]{0,400}buildCaretDict\(/);
  assert.match(opslag, /isTextEditStrike\(annRaw\)[\s\S]{0,600}buildTextEditStrikeDict\(context, annRaw,/,
    'de quads komen uit de niet omgerekende annotatie');
  assert.match(opslag, /buildTextMarkupDict\(context, ann,/);
  // /NM is per pagina uniek: één verzameling per pagina voor alle correcties
  // en geladen markeringen (een kopie draagt de naam van het origineel mee).
  assert.match(opslag, /const gebruikteNm = new Set\(\);[\s\S]{0,200}for \(const annRaw of pageAnnotations\)/);
  assert.match(opslag, /addLoadedMarkupKeys\(annotDict, ann, gebruikteNm\)/);
  assert.match(opslag, /buildTextEditStrikeDict\(context, annRaw, puntNaarPdf, \{[\s\S]{0,300}gebruikteNm,/);
  assert.match(opslag, /buildCaretDict\(context, karet, puntNaarPdf, \{[\s\S]{0,300}gebruikteNm,/);
  assert.match(opslag, /refById\.set\(/);
  assert.match(opslag, /dictById\.set\(/);
  const annots = opslag.indexOf("page.node.set(PDFName.of('Annots'), context.obj(annotsArray))");
  const koppel = opslag.indexOf('applyGroupLinks(context, plan, refById, dictById, annotsArray)');
  const popups = opslag.indexOf('dropOrphanPopups(context, annotsArray,');
  assert.ok(koppel > 0 && popups > koppel && annots > popups, 'eerst koppelen, dan popups, dan /Annots zetten');
});

test('de converter zet /Caret om en geeft markeringen de correctie-eigenschappen', () => {
  const lader = bron('./loader/annotation-converter.js');
  assert.match(lader, /case 'Caret':/);
  assert.match(lader, /caretPropsFromPdf\(annot, extraColors, convertRect, /);
  assert.match(lader, /\.\.\.textEditPropsFromPdf\(annot, extraColors, convertPoint, /);
  assert.match(lader, /from '\.\/correction-load\.js'/);
});

test('loader.js vraagt extra gegevens voor /Caret en koppelt vervangingen', () => {
  const lader = bron('./loader.js');
  const lijsten = lader.match(/needsExtraData = annotations\.some\(a => \[[^\]]*\]\.includes\(a\.subtype\)\)/g) || [];
  assert.equal(lijsten.length, 3, 'drie needsExtraData-lijsten');
  for (const lijst of lijsten) assert.match(lijst, /'Caret'/);
  assert.match(lader, /resolveGroupLinks\(/);
  assert.match(lader, /from '\.\/loader\/correction-load\.js'/);
});

test("SOORTEN_MET_EIGEN_TEKST bevat 'caret'", () => {
  assert.ok(SOORTEN_MET_EIGEN_TEKST.has('caret'));
});

test('text-markup.js laat het id aan de factory over', () => {
  assert.doesNotMatch(bron('../text/text-markup.js'), /id: Date\.now\(\)/);
});
