// Kader passend maken (#1144): de pure maatregel uit kader-passend.js, met
// een vaste meetfunctie (6 pt per teken, vet 7 pt). De aanhaallijn komt uit
// de ECHTE transforms.js (recalcCalloutLeader), met de zware imports gestubd.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  passendeMaat, passendKader, maakKaderPassend, maakKadersPassend, ankerVan,
  heeftTekstkader, BREEDTE_SPELING_PT,
} from './kader-passend.js';
import { layoutTextboxLines, textboxTekstInzet } from './rendering/textbox-layout.js';
import { tekstvakMinimum } from './minimummaat.js';

const measure = (t, bold) => t.length * (bold ? 7 : 6);
const near = (a, b, eps = 0.011) => Math.abs(a - b) < eps;
const REGEL = 14 * 1.2;

const vak = (o = {}) => ({ type: 'textbox', x: 100, y: 200, width: 200, height: 120, fontSize: 14, lineWidth: 1, text: '', ...o });

// De hoek linksboven van het vak zoals hij op het blad staat (draaiing om het midden).
function hoekOpBlad(a, fx = 0, fy = 0) {
  const h = ((a.rotation || 0) * Math.PI) / 180;
  const px = (fx - 0.5) * a.width;
  const py = (fy - 0.5) * a.height;
  return {
    x: a.x + a.width / 2 + px * Math.cos(h) - py * Math.sin(h),
    y: a.y + a.height / 2 + px * Math.sin(h) + py * Math.cos(h),
  };
}

function aantalRegels(a) {
  return layoutTextboxLines(a, a.width - 2 * textboxTekstInzet(a), measure).length;
}

test('een regel: het vak krimpt naar de regel, linksboven blijft staan', () => {
  const a = vak({ text: 'Hello' });
  assert.equal(maakKaderPassend(a, measure), true);
  assert.ok(near(a.width, 30 + 2 + BREEDTE_SPELING_PT), `breedte ${a.width}`);
  assert.ok(near(a.height, 2 + REGEL), `hoogte ${a.height}`);
  assert.equal(a.x, 100);
  assert.equal(a.y, 200);
  assert.equal(aantalRegels(a), 1);
  assert.equal(a.text, 'Hello');
  assert.equal(a.fontSize, 14);
});

test('een te klein vak groeit naar zijn ene woord', () => {
  const a = vak({ text: 'Onafbreekbaar', width: 40, height: 10 });
  maakKaderPassend(a, measure);
  assert.ok(near(a.width, 13 * 6 + 2 + BREEDTE_SPELING_PT));
  assert.ok(near(a.height, 2 + REGEL));
});

test('afgebroken tekst: de breedte blijft, alleen de hoogte volgt', () => {
  const a = vak({ text: 'aaaa bbbb cccc dddd', width: 60, height: 300 });
  const maat = passendeMaat(a, measure);
  assert.equal(maat.afgebroken, true);
  maakKaderPassend(a, measure);
  assert.equal(a.width, 60);
  assert.ok(near(a.height, 2 + 2 * REGEL), `hoogte ${a.height}`);
  assert.equal(a.x, 100);
  assert.equal(a.y, 200);
  // Te laag vak met dezelfde tekst groeit naar dezelfde hoogte.
  const b = vak({ text: 'aaaa bbbb cccc dddd', width: 60, height: 5 });
  maakKaderPassend(b, measure);
  assert.equal(b.width, 60);
  assert.ok(near(b.height, a.height));
});

test('meer alinea\'s zonder afbreken: langste regel en alle regels, ook de lege', () => {
  const a = vak({ text: 'abc\n\nabcdef' });
  maakKaderPassend(a, measure);
  assert.ok(near(a.width, 36 + 2 + BREEDTE_SPELING_PT));
  assert.ok(near(a.height, 2 + 3 * REGEL));
  assert.equal(aantalRegels(a), 3);
});

test('meer alinea\'s waarvan een afbreekt: breedte blijft', () => {
  const a = vak({ text: 'kort\neen lange regel die afbreekt', width: 80 });
  maakKaderPassend(a, measure);
  assert.equal(a.width, 80);
  assert.ok(near(a.height, 2 + aantalRegels(a) * REGEL));
  assert.ok(aantalRegels(a) > 2);
});

test('lege tekst en alleen spaties: de kleinste maat van een tekstvak', () => {
  for (const text of ['', '   ', undefined]) {
    const a = vak({ text });
    const min = tekstvakMinimum(a);
    maakKaderPassend(a, measure);
    assert.equal(a.width, min.minBreedte);
    assert.equal(a.height, min.minHoogte);
    assert.equal(a.x, 100);
    assert.equal(a.y, 200);
  }
});

test('vette runs tellen met hun eigen breedte', () => {
  const a = vak({ text: 'abcd', textRuns: [[{ text: 'ab', bold: true }, { text: 'cd' }]] });
  maakKaderPassend(a, measure);
  assert.ok(near(a.width, 14 + 12 + 2 + BREEDTE_SPELING_PT));
});

test('tekstinzet uit het bestand en randdikte bepalen de marge', () => {
  const a = vak({ text: 'Hello', textPadding: 5, lineWidth: 2 });
  maakKaderPassend(a, measure);
  assert.ok(near(a.width, 30 + 10 + BREEDTE_SPELING_PT));
  assert.ok(near(a.height, 10 + REGEL));
});

test('typemachine-tekst (noWrap) volgt altijd zijn langste regel', () => {
  const a = vak({ text: 'een lange regel zonder afbreken\nkort', width: 40, noWrap: true });
  maakKaderPassend(a, measure);
  assert.ok(near(a.width, 31 * 6 + 2 + BREEDTE_SPELING_PT));
  assert.ok(near(a.height, 2 + 2 * REGEL));
});

test('rechts en gecentreerd uitgelijnd: de tekst blijft staan, niet de linkerrand', () => {
  const r = vak({ text: 'Hello', textAlign: 'right' });
  maakKaderPassend(r, measure);
  assert.ok(near(r.x + r.width, 300), 'rechterrand blijft');
  const c = vak({ text: 'Hello', textAlign: 'center', textVAlign: 'middle' });
  maakKaderPassend(c, measure);
  assert.ok(near(c.x + c.width / 2, 200), 'midden blijft');
  assert.ok(near(c.y + c.height / 2, 260), 'verticaal midden blijft');
  // Rechts-naar-links zonder eigen uitlijning staat rechts.
  assert.deepEqual(ankerVan({}, { rtl: true }), { fx: 1, fy: 0 });
  // Tekst die niet in het vak past begint bovenaan, ook bij 'onder'.
  assert.deepEqual(ankerVan({ textVAlign: 'bottom' }, { pastInHoogte: false }), { fx: 0, fy: 0 });
});

test('gedraaid 90 en 180 graden: de hoek linksboven blijft op het blad staan', () => {
  for (const rotation of [90, 180, 270, 30]) {
    for (const text of ['Hello', 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp']) {
      const a = vak({ text, rotation, width: 120, height: 90 });
      const voor = hoekOpBlad(a);
      assert.equal(maakKaderPassend(a, measure), true);
      const na = hoekOpBlad(a);
      assert.ok(near(na.x, voor.x) && near(na.y, voor.y), `rotatie ${rotation}: ${JSON.stringify(voor)} -> ${JSON.stringify(na)}`);
      assert.equal(a.rotation, rotation);
    }
  }
  // 90 graden, uitgeschreven: het midden schuift, x/y dus ook.
  const a = vak({ text: 'Hello', rotation: 90, x: 0, y: 0, width: 100, height: 40 });
  maakKaderPassend(a, measure);
  // Hoek linksboven stond op (50 + 20, 20 - 50) = (70, -30).
  assert.ok(near(a.x + a.width / 2 + a.height / 2, 70));
  assert.ok(near(a.y + a.height / 2 - a.width / 2, -30));
});

test('afgerond en ovaal vak: de tekst past in de nieuwe maat (zelfde regelafbraak)', () => {
  for (const boxShape of ['rounded', 'ellipse']) {
    const a = vak({ text: 'Hello world', boxShape });
    const maat = passendeMaat(a, measure);
    maakKaderPassend(a, measure);
    assert.equal(aantalRegels(a), 1, boxShape);
    const inzet = textboxTekstInzet(a);
    assert.ok(a.width - 2 * inzet >= 66, `${boxShape}: binnenbreedte ${a.width - 2 * inzet}`);
    assert.ok(a.height - 2 * inzet >= REGEL - 0.011, `${boxShape}: binnenhoogte`);
    assert.equal(maat.afgebroken, false);
    const b = vak({ text: 'aaaa bbbb cccc dddd eeee ffff', boxShape, width: 80 });
    maakKaderPassend(b, measure);
    assert.equal(b.width, 80);
    assert.ok(b.height - 2 * textboxTekstInzet(b) >= aantalRegels(b) * REGEL - 0.011, `${boxShape}: afgebroken past`);
  }
});

test('een tweede keer verandert niets', () => {
  for (const a of [vak({ text: 'Hello' }), vak({ text: 'aaaa bbbb cccc dddd', width: 60 }), vak({ text: '' }),
    vak({ text: 'Hello world', boxShape: 'ellipse' }), vak({ text: 'Hello', rotation: 90 })]) {
    maakKaderPassend(a, measure);
    const kopie = JSON.parse(JSON.stringify(a));
    assert.equal(maakKaderPassend(a, measure), false);
    assert.deepEqual(a, kopie);
  }
});

test('selectie: alleen tekstvakken en aanhaalvakken, vergrendeld blijft staan', () => {
  const lijst = [
    vak({ id: 1, text: 'Hello' }),
    { id: 2, type: 'box', x: 0, y: 0, width: 50, height: 50 },
    vak({ id: 3, text: 'Hello', locked: true }),
    vak({ id: 4, type: 'callout', text: 'Hello', arrowX: 20, arrowY: 260 }),
    { id: 5, type: 'line', startX: 0, startY: 0, endX: 5, endY: 5 },
  ];
  const voor = JSON.parse(JSON.stringify(lijst));
  const gewijzigd = maakKadersPassend(lijst, { measureVoor: () => measure, magBewerken: (a) => !a.locked });
  assert.deepEqual(gewijzigd.map(a => a.id), [1, 4]);
  assert.deepEqual(lijst[1], voor[1]);
  assert.deepEqual(lijst[2], voor[2]);
  assert.deepEqual(lijst[4], voor[4]);
  assert.equal(heeftTekstkader(lijst[1]), false);
  assert.equal(passendKader(lijst[1], measure), null);
});

// ── Aanhaalvak: de echte recalcCalloutLeader uit transforms.js ───────────────

const constantsBron = readFileSync(new URL('../core/constants.ts', import.meta.url), 'utf8');
const handleTypesLiteral = constantsBron.match(/export const HANDLE_TYPES = (\{[\s\S]*?\n\}) as const;/)[1];
const stubs = `const HANDLE_TYPES = ${handleTypesLiteral};\nconst state = { preferences: {}, shiftKeyPressed: false };\n`;
const bron = readFileSync(new URL('./transforms.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+'([^']+)';[ \t]*\r?$/gm, (hele, pad) => {
    if (pad === './minimummaat.js' || pad === './polygon-transform.js' || pad === './veelhoek-punten.js') {
      return hele.replace(`'${pad}'`, `'${new URL(pad, import.meta.url).href}'`);
    }
    return '';
  });
const { recalcCalloutLeader } =
  await import('data:text/javascript;base64,' + Buffer.from(stubs + bron, 'utf8').toString('base64'));

test('aanhaalvak: de punt blijft staan, aanzet en knie volgen de nieuwe vakrand', () => {
  // Punt links van het vak: de aanzet zit op de linkerrand, halverwege de hoogte.
  const links = vak({ type: 'callout', text: 'Hello', arrowX: 20, arrowY: 300, kneeX: 70, kneeY: 260, armOriginX: 100, armOriginY: 260 });
  maakKaderPassend(links, measure, { herberekenAanhaallijn: recalcCalloutLeader });
  assert.equal(links.arrowX, 20);
  assert.equal(links.arrowY, 300);
  assert.equal(links.x, 100);
  assert.equal(links.armOriginX, links.x);
  assert.ok(near(links.armOriginY, links.y + links.height / 2));
  assert.equal(links.kneeY, links.armOriginY);
  assert.ok(links.kneeX < links.armOriginX && links.kneeX > links.arrowX);

  // Punt rechts van het vak: de aanzet volgt de rechterrand die naar links schuift.
  const rechts = vak({ type: 'callout', text: 'Hello', arrowX: 400, arrowY: 210, kneeX: 330, kneeY: 260, armOriginX: 300, armOriginY: 260 });
  maakKaderPassend(rechts, measure, { herberekenAanhaallijn: recalcCalloutLeader });
  assert.equal(rechts.arrowX, 400);
  assert.equal(rechts.arrowY, 210);
  assert.ok(near(rechts.armOriginX, rechts.x + rechts.width));
  assert.ok(rechts.armOriginX < 200, 'het vak is gekrompen');
  assert.ok(near(rechts.armOriginY, rechts.y + rechts.height / 2));
  assert.ok(rechts.kneeX > rechts.armOriginX && rechts.kneeX < rechts.arrowX);

  // Punt onder het vak: de aanzet zit midden op de onderrand.
  const onder = vak({ type: 'callout', text: 'aaaa bbbb cccc dddd', width: 60, arrowX: 130, arrowY: 500 });
  maakKaderPassend(onder, measure, { herberekenAanhaallijn: recalcCalloutLeader });
  assert.equal(onder.arrowX, 130);
  assert.equal(onder.arrowY, 500);
  assert.ok(near(onder.armOriginX, onder.x + onder.width / 2));
  assert.ok(near(onder.armOriginY, onder.y + onder.height));
  assert.ok(onder.kneeY > onder.armOriginY && onder.kneeY < onder.arrowY);
});
