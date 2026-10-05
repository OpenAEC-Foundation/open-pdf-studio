// Het vak van een typemachine-tekst bij opslaan (zie typemachine.js).

import assert from 'node:assert/strict';
import test from 'node:test';
import { StandardFonts } from 'pdf-lib';

import { mapFontToPdfName, vervangendeStandaardFont } from './utils.js';
import { breedteInStandaardFont, typemachineRegelBreedte, typemachineVak } from './typemachine.js';

const bij = (werkelijk, verwacht, wat) =>
  assert.ok(Math.abs(werkelijk - verwacht) <= 1e-6, `${wat}: ${werkelijk} ≠ ${verwacht}`);

const layoutVan = (regels, padding = 0) => ({ padding, lines: regels.map(([text, width]) => ({ text, width, chunks: [{ text, bold: false, italic: false }] })) });

test('de vervangende standaardfont volgt de vlaggen van de FontDescriptor', () => {
  assert.equal(vervangendeStandaardFont('Swis721CnBT'), StandardFonts.Helvetica);
  assert.equal(vervangendeStandaardFont('Swis721CnBT-Bold'), StandardFonts.HelveticaBold);
  assert.equal(vervangendeStandaardFont('SegoeUI-Italic'), StandardFonts.HelveticaOblique);
  assert.equal(vervangendeStandaardFont('SegoeUI-BoldItalic'), StandardFonts.HelveticaBoldOblique);
  assert.equal(vervangendeStandaardFont('Georgia'), StandardFonts.TimesRoman);
  assert.equal(vervangendeStandaardFont('Cambria-Bold'), StandardFonts.TimesRomanBold);
  assert.equal(vervangendeStandaardFont('Consolas'), StandardFonts.Courier);
  // De standaardfonts zelf blijven wat ze zijn.
  for (const naam of ['Helvetica', 'Helvetica-Bold', 'Times-Roman', 'Times-BoldItalic', 'Courier-Oblique']) {
    assert.equal(vervangendeStandaardFont(naam), naam);
  }
});

test('een niet-standaard Helvetica-, Courier- of Times-naam krijgt de standaardfont van zijn familie', () => {
  // Uit /DS komt de fontnaam zoals hij er staat ('font-family:Helvetica-Narrow');
  // mapFontToPdfName laat hem dan staan, of plakt er nog -Bold achter.
  const STANDAARD = new Set(Object.values(StandardFonts));
  const gevallen = [
    ['Helvetica-Narrow', false, StandardFonts.Helvetica],
    ['Helvetica-Light', false, StandardFonts.Helvetica],
    ['Helvetica-Bold', true, StandardFonts.HelveticaBold],
  ];
  for (const [familie, vet, verwacht] of gevallen) {
    const pdfNaam = mapFontToPdfName(familie, vet, false);
    assert.equal(vervangendeStandaardFont(pdfNaam), verwacht, pdfNaam);
    assert.ok(STANDAARD.has(vervangendeStandaardFont(pdfNaam)), `${pdfNaam}: standaardnaam`);
    assert.doesNotThrow(() => breedteInStandaardFont('M.D. Vroegindeweij', pdfNaam, 14), pdfNaam);
    const ann = { type: 'textbox', noWrap: true, x: 0, y: 0, width: 50, height: 18, fontSize: 14, fontFamily: familie, fontBold: vet, text: 'M.D. Vroegindeweij' };
    const layout = { padding: 0, lines: [{ text: ann.text, width: 100, chunks: [{ text: ann.text, bold: vet, italic: false }] }] };
    assert.doesNotThrow(() => typemachineVak(ann, layout), `${familie}: vak`);
  }
  assert.equal(vervangendeStandaardFont('Courier-Light'), StandardFonts.Courier);
  assert.equal(vervangendeStandaardFont('Times-Narrow'), StandardFonts.TimesRoman);
  // Een naam die geen enkele regel herkent, laat het opslaan niet vallen.
  assert.doesNotThrow(() => breedteInStandaardFont('abc', 'Symbol-Onbekend', 10));
});

test('breedte in de standaardfont: som van de glyphbreedtes, zonder kerning', () => {
  // Helvetica: M 833, . 278, D 722, spatie 278 (per 1000).
  bij(breedteInStandaardFont('M.D. ', 'Swis721CnBT', 10), (833 + 278 + 722 + 278 + 278) / 100, 'M.D. ');
  // "Va" kernt in Helvetica, maar een lezer tekent een Tj-string zonder kerning.
  bij(breedteInStandaardFont('Va', 'Helvetica', 10), (667 + 556) / 100, 'Va');
  assert.equal(breedteInStandaardFont('', 'Helvetica', 10), 0);
});

test('een vak dat de tekst al bevat blijft hetzelfde object', () => {
  const ann = { type: 'textbox', noWrap: true, x: 10, y: 20, width: 200, height: 18, fontSize: 14, fontFamily: 'Swis721 Cn BT', text: 'kort' };
  assert.equal(typemachineVak(ann, layoutVan([['kort', 30]])), ann);
});

test('te smal: breder tot de breedste regel in de canvas- of standaardmeting, linkerrand blijft', () => {
  const ann = {
    type: 'textbox', noWrap: true, x: 10, y: 20, width: 103.334, height: 17.6756,
    fontSize: 14, fontFamily: 'Swis721 Cn BT', text: 'M.D. Vroegindeweij\nab',
  };
  const helv = breedteInStandaardFont('M.D. Vroegindeweij', 'Swis721CnBT', 14);
  const uit = typemachineVak(ann, layoutVan([['M.D. Vroegindeweij', 103.3389], ['ab', 12]], 1));
  bij(uit.width, helv + 2, 'breedte: Helvetica plus twee keer de inzet');
  assert.equal(uit.x, 10);
  assert.equal(uit.y, 20);
  assert.equal(uit.height, 17.6756);
  assert.notEqual(uit, ann, 'kopie, het model blijft ongemoeid');
  assert.equal(ann.width, 103.334);
  // Is de canvasmeting breder, dan telt die.
  const breed = typemachineVak(ann, layoutVan([['M.D. Vroegindeweij', 130]]));
  bij(breed.width, 130, 'canvasbreedte');
});

test('een onbekende fontnaam: ook de Helvetica-breedte telt, want pdf.js leest de breedtes op naam', () => {
  // Zonder /Widths negeert pdf.js de vlaggen van de FontDescriptor (vaste
  // breedte: Courier, 600/1000) en neemt het voor een onbekende naam de
  // Helvetica-breedtes. "WAMMES BOUW" is in Helvetica 8000/1000 em breed.
  const ann = { type: 'textbox', noWrap: true, x: 0, y: 0, width: 60, height: 18, fontSize: 14, fontFamily: 'Consolas', text: 'WAMMES BOUW' };
  const uit = typemachineVak(ann, layoutVan([['WAMMES BOUW', 84.7]]));
  assert.ok(uit.width >= 112.0 - 1e-9, `breedte ${uit.width}, verwacht minstens 112`);
  bij(typemachineRegelBreedte(ann, layoutVan([['WAMMES BOUW', 84.7]]).lines[0]), 112, 'regelbreedte');
  // Een standaardfont houdt zijn eigen maten: Courier blijft 600/1000 per teken.
  const courier = { ...ann, fontFamily: 'Courier New' };
  bij(typemachineRegelBreedte(courier, layoutVan([['WAMMES BOUW', 84.7]]).lines[0]), 11 * 600 * 14 / 1000, 'Courier');
});

test('de vaste kant hangt af van de uitlijning en draait mee met het vak', () => {
  const basis = { type: 'textbox', noWrap: true, x: 0, y: 0, width: 100, height: 20, fontSize: 10, fontFamily: 'Arial', text: 'x' };
  const layout = layoutVan([['x', 140]]);
  // Midden: het midden blijft.
  const midden = typemachineVak({ ...basis, textAlign: 'center' }, layout);
  bij(midden.x + midden.width / 2, 50, 'midden x');
  // Rechts: de rechterrand blijft.
  const rechts = typemachineVak({ ...basis, textAlign: 'right' }, layout);
  bij(rechts.x + rechts.width, 100, 'rechterrand');
  // Gedraaid (90°, met de klok mee): de tekst loopt omlaag, dus het vak groeit
  // omlaag; de linkerrand (nu boven) blijft staan.
  const gedraaid = typemachineVak({ ...basis, rotation: 90 }, layout);
  const midden90 = { x: gedraaid.x + gedraaid.width / 2, y: gedraaid.y + gedraaid.height / 2 };
  bij(midden90.x, 50, 'gedraaid midden x');
  bij(midden90.y, 10 + 20, 'gedraaid midden y (20 omlaag)');
});

test('alleen een typemachine-tekst (noWrap) groeit', () => {
  const layout = layoutVan([['lange regel', 500]]);
  const gewoon = { type: 'textbox', x: 0, y: 0, width: 100, height: 20, fontSize: 10, text: 'lange regel' };
  assert.equal(typemachineVak(gewoon, layout), gewoon);
  const callout = { ...gewoon, type: 'callout', noWrap: true };
  assert.equal(typemachineVak(callout, layout), callout);
});
