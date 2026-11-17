// Het doel van een bladwijzer (#1157): de omzetting tussen bestemming en
// model, het beeld dat bij het volgen hoort, en de plek die uit het beeld
// teruggerekend wordt. Pure functies; de rondgang door de saver staat in
// bladwijzer-plek-rondgang.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  doelVeldenUitDest, doelOnderdelen, doelVorm, heeftPlek, destVanBladwijzer, doelVelden, titelUitSelectie,
} from './bladwijzer-doel.js';
import {
  parseDestinationArray, destDoelbeeld, paginaPlekInVenster, pdfNaarWeergave, weergaveNaarPdf, xyzVoorWeergavepunt,
} from './link-destination.js';

const A4 = [0, 0, 595, 842];
const venster = { breedte: 800, hoogte: 600, honderd: 1 };

test('doelVeldenUitDest leest elke vorm: /XYZ als left/top/zoom, de rest met naam en getallen', () => {
  assert.deepEqual(doelVeldenUitDest([{ num: 4, gen: 0 }, { name: 'XYZ' }, 72, 700, null]), { left: 72, top: 700, zoom: null });
  assert.deepEqual(doelVeldenUitDest([0, { name: 'XYZ' }, null, 300, 1.5]), { left: null, top: 300, zoom: 1.5 });
  assert.deepEqual(doelVeldenUitDest([0, { name: 'XYZ' }, 0, 0, 0]), { left: 0, top: 0, zoom: null }, 'zoom 0 = laten staan');
  assert.deepEqual(doelVeldenUitDest([0, { name: 'FitH' }, 640]),
    { left: null, top: null, zoom: null, destType: 'FitH', destArgs: [640] });
  assert.deepEqual(doelVeldenUitDest([0, { name: 'FitBV' }, 12]),
    { left: null, top: null, zoom: null, destType: 'FitBV', destArgs: [12] });
  assert.deepEqual(doelVeldenUitDest([0, { name: 'FitR' }, 1, 2, 3, 4]),
    { left: null, top: null, zoom: null, destType: 'FitR', destArgs: [1, 2, 3, 4] });
  assert.deepEqual(doelVeldenUitDest([0, { name: 'Fit' }]),
    { left: null, top: null, zoom: null, destType: 'Fit', destArgs: [] });
  // Onleesbaar of onbekend: alleen de pagina.
  assert.deepEqual(doelVeldenUitDest(null), { left: null, top: null, zoom: null });
  assert.deepEqual(doelVeldenUitDest([0, { name: 'Vreemd' }, 5, 6]), { left: null, top: null, zoom: null });
});

test('doelOnderdelen en destVanBladwijzer geven de bestemming terug zoals ze gelezen is', () => {
  for (const dest of [
    [1, { name: 'XYZ' }, 72, 700, null],
    [1, { name: 'XYZ' }, null, 300, 2],
    [1, { name: 'FitH' }, 640],
    [1, { name: 'FitV' }, 30],
    [1, { name: 'FitR' }, 10, 20, 300, 400],
    [1, { name: 'Fit' }],
    [1, { name: 'FitB' }],
  ]) {
    const bm = { page: 2, ...doelVeldenUitDest(dest) };
    assert.deepEqual(destVanBladwijzer(bm), dest, JSON.stringify(dest));
    assert.equal(doelOnderdelen(bm).vorm, dest[1].name);
    assert.equal(heeftPlek(bm), true);
  }
});

test('een bladwijzer met alleen een pagina heeft geen plek', () => {
  const alleenPagina = { page: 3, left: null, top: null, zoom: null };
  assert.equal(heeftPlek(alleenPagina), false);
  assert.equal(heeftPlek({ page: 3 }), false, 'oude modellen zonder de velden');
  assert.equal(doelVorm({ page: 3, destType: null }), 'XYZ');
  assert.deepEqual(destVanBladwijzer(alleenPagina), [2, { name: 'XYZ' }, null, null, null]);
  assert.equal(heeftPlek({ page: 3, left: null, top: 500, zoom: null }), true);
  assert.equal(heeftPlek({ page: 3, left: null, top: null, zoom: 2 }), true);
  // Een onbekende vorm in het model telt als de gewone.
  assert.equal(doelVorm({ destType: 'Vreemd' }), 'XYZ');
});

test('doelVelden: een nieuwe plek is /XYZ met behoud van de zoom, afgerond op honderdsten', () => {
  assert.deepEqual(doelVelden({ page: 2, left: 72.123456, top: 700.987654 }),
    { page: 2, left: 72.12, top: 700.99, zoom: null, destType: null, destArgs: null });
  assert.deepEqual(doelVelden({ page: 5 }),
    { page: 5, left: null, top: null, zoom: null, destType: null, destArgs: null });
  assert.equal(heeftPlek(doelVelden({ page: 5 })), false);
});

test('het beeld bij het volgen: bladwijzers op één pagina met verschillende hoogtes komen elk op hun eigen plek', () => {
  const pagina = { view: A4, rotatie: 0 };
  const tops = [800, 500, 120];
  const plekken = tops.map((top) => {
    const bm = { page: 2, left: 72, top, zoom: null };
    const info = parseDestinationArray(destVanBladwijzer(bm));
    assert.equal(info.pageRef, 1, 'de pagina-index vanaf 0');
    const beeld = destDoelbeeld(info, pagina, venster);
    assert.equal(beeld.zoom, null, 'de zoom blijft zoals hij is');
    assert.equal(beeld.y, 842 - top, 'afstand vanaf de bovenkant van de pagina');
    assert.equal(beeld.x, 72);
    // Bij zoom 2: waar de pagina in het venster komt te liggen.
    return paginaPlekInVenster(beeld, 2, venster, 0);
  });
  assert.deepEqual(plekken, [{ x: -144, y: -84 }, { x: -144, y: -684 }, { x: -144, y: -1444 }]);
  assert.equal(new Set(plekken.map((p) => p.y)).size, 3);

  // Een vaste zoom uit een ander programma telt tegen 100%.
  const metZoom = destDoelbeeld(parseDestinationArray(destVanBladwijzer({ page: 1, left: 0, top: 842, zoom: 1.5 })),
    pagina, { ...venster, honderd: 1.25 });
  assert.equal(metZoom.zoom, 1.875);

  // /FitH uit een ander programma: de paginabreedte passend, `top` bovenaan.
  const fitH = destDoelbeeld(parseDestinationArray(destVanBladwijzer({ page: 1, destType: 'FitH', destArgs: [600] })), pagina, venster);
  assert.equal(fitH.zoom, 800 / 595);
  assert.equal(fitH.y, 242);
});

test('weergaveNaarPdf is het omgekeerde van pdfNaarWeergave, bij elke draaiing en een verschoven CropBox', () => {
  for (const view of [A4, [20, 30, 320, 530]]) {
    for (const rotatie of [0, 90, 180, 270, -90, 450]) {
      for (const [x, y] of [[view[0], view[1]], [100, 200], [view[2], view[3]]]) {
        const w = pdfNaarWeergave(view, rotatie, x, y);
        assert.deepEqual(weergaveNaarPdf(view, rotatie, w.x, w.y), { x, y }, `${view} ${rotatie} ${x},${y}`);
      }
    }
  }
});

test('xyzVoorWeergavepunt: de plek uit het beeld komt bij het volgen op hetzelfde punt terug', () => {
  for (const view of [A4, [20, 30, 320, 530]]) {
    for (const rotatie of [0, 90, 180, 270]) {
      const pagina = { view, rotatie };
      const punt = { x: 40.5, y: 123.25 };
      const plek = xyzVoorWeergavepunt(pagina, punt.x, punt.y);
      const bm = { ...doelVelden({ page: 1, ...plek }) };
      const beeld = destDoelbeeld(parseDestinationArray(destVanBladwijzer(bm)), pagina, venster);
      assert.deepEqual({ x: beeld.x, y: beeld.y, zoom: beeld.zoom, ankerX: beeld.ankerX, ankerY: beeld.ankerY },
        { x: punt.x, y: punt.y, zoom: null, ankerX: 'begin', ankerY: 'begin' }, `${view} ${rotatie}`);
    }
  }
  // Rechtop, A4: 100 punten onder de bovenrand is top 742.
  assert.deepEqual(xyzVoorWeergavepunt({ view: A4, rotatie: 0 }, 0, 100), { left: 0, top: 742 });
});

test('xyzVoorWeergavepunt klemt een punt buiten de pagina op haar rand', () => {
  const pagina = { view: A4, rotatie: 0 };
  // De bovenkant van de pagina staat in beeld: het venster begint erboven.
  assert.deepEqual(xyzVoorWeergavepunt(pagina, -30, -80), { left: 0, top: 842 });
  assert.deepEqual(xyzVoorWeergavepunt(pagina, 9999, 9999), { left: 595, top: 0 });
  assert.equal(xyzVoorWeergavepunt({ view: [0, 0, 0, 0] }, 1, 1), null);
  assert.equal(xyzVoorWeergavepunt(null, 1, 1), null);
});

test('titelUitSelectie: witruimte wordt één spatie, een lange selectie wordt op een woordgrens afgekort', () => {
  assert.equal(titelUitSelectie('  2.1   Uitgangspunten\r\n '), '2.1 Uitgangspunten');
  assert.equal(titelUitSelectie('Regel een\nregel\ttwee'), 'Regel een regel twee');
  assert.equal(titelUitSelectie(''), '');
  assert.equal(titelUitSelectie(null), '');
  const lang = 'De constructie wordt uitgevoerd in gewapend beton met een sterkteklasse die in de volgende paragraaf nader wordt toegelicht.';
  const kort = titelUitSelectie(lang);
  assert.ok([...kort].length <= 81, 'hooguit 80 tekens en het beletselteken');
  assert.ok(kort.endsWith('…'));
  assert.ok(lang.startsWith(kort.slice(0, -1)), 'het begin van de selectie');
  assert.ok(lang[kort.length - 1] === ' ', 'afgebroken op een woordgrens');
  // Eén lang woord: hard afkappen.
  assert.equal(titelUitSelectie('x'.repeat(200), 10), 'x'.repeat(10) + '…');
  // Precies passend: geen beletselteken.
  assert.equal(titelUitSelectie('abcde', 5), 'abcde');
});

// ── Aansluiting in de app (bronniveau: zonder venster te testen) ─────────────

const { readFileSync, readdirSync } = await import('node:fs');
const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('een bladwijzer met een plek volgt dezelfde weg als een link; alleen een pagina blijft goToPage', () => {
  const paneel = bron('../ui/panels/bookmarks.js');
  const volgen = paneel.slice(paneel.indexOf('async function navigateToBookmark'));
  const blok = volgen.slice(0, volgen.indexOf('\n}\n'));
  assert.match(blok, /if \(!heeftPlek\(bm\)\) \{ goToPage\(bm\.page\); return; \}/);
  assert.match(blok, /handleInternalLink\(destVanBladwijzer\(bm\)\)/);
  // De gedeelde navigatie neemt een pagina-index als eerste element aan.
  assert.match(bron('./link-layer.js'), /typeof ref === 'number'/);
});

test('het venster en de menu\'s bieden de bestemming aan, in elke taal', () => {
  const venster = bron('../solid/components/dialogs/BookmarkDialog.jsx');
  for (const sleutel of ['destinationLabel', 'destKeep', 'destSelection', 'destView', 'destPageTop']) {
    assert.ok(venster.includes(`bookmark.${sleutel}`), sleutel);
  }
  const menu = bron('../solid/components/ContextMenu.jsx');
  assert.match(menu, /setBookmarkDestination\('beeld'\)/);
  assert.match(menu, /setBookmarkDestination\('selectie'\)/);
  assert.match(menu, /textSelection\.bookmarkSelection/);

  const talen = readdirSync(new URL('../i18n/locales/', import.meta.url));
  const lees = (taal, naam) => JSON.parse(bron(`../i18n/locales/${taal}/${naam}.json`));
  for (const taal of talen) {
    const d = lees(taal, 'dialogs').bookmark;
    const c = lees(taal, 'context');
    for (const sleutel of ['destinationLabel', 'destKeep', 'destSelection', 'destView', 'destPageTop']) {
      assert.ok(typeof d[sleutel] === 'string' && d[sleutel], `${taal} dialogs.bookmark.${sleutel}`);
    }
    for (const sleutel of ['setDestView', 'setDestSelection']) {
      assert.ok(typeof c.bookmark[sleutel] === 'string' && c.bookmark[sleutel], `${taal} context.bookmark.${sleutel}`);
    }
    assert.ok(c.textSelection.bookmarkSelection, `${taal} context.textSelection.bookmarkSelection`);
  }
  // Nederlands en Spaans zijn echt vertaald.
  const en = lees('en', 'dialogs').bookmark;
  for (const taal of ['nl', 'es']) {
    const d = lees(taal, 'dialogs').bookmark;
    for (const sleutel of ['destinationLabel', 'destKeep', 'destSelection', 'destView', 'destPageTop']) {
      assert.notEqual(d[sleutel], en[sleutel], `${taal} ${sleutel}`);
    }
    assert.notEqual(lees(taal, 'context').bookmark.setDestView, lees('en', 'context').bookmark.setDestView);
  }
});
