import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ONDERDEEL_SOORTEN, MIN_BREEDTE,
  aanrechtTemplate, aanrechtHoekTemplate, kookeilandTemplate, KEUKEN_TEMPLATES,
  keukenMaat, benenVan, normaliseerOnderdelen, voegOnderdeelToe, wijzigOnderdeel,
  verwijderOnderdeel, wisselOnderdelen, keukenGeometrie, onderdeelVormen,
} from './keuken.js';
import { coordinaten, spiegelVorm } from './mm-tekening.js';
import { getTemplate, defaultParams, normalizeListParam, normalizeParams } from '../registry.js';
import { ifcCategoryForParametric } from '../../solid/data/ifcCategoryMap.js';
import { NL_CATEGORIES } from '../../solid/data/nlSymbolLibrary.js';

const RECHT = { lengte: 3000, diepte: 600 };
const HOEK = { lengte: 3000, lengte2: 1800, diepte: 600 };

// ── maten ────────────────────────────────────────────────────────────────

test('werkelijke maat: strekkende meter, hoekopstelling en eiland', () => {
  assert.deepEqual(aanrechtTemplate.realSizeMm(defaultParams(aanrechtTemplate)), { width: 3000, height: 600 });
  assert.deepEqual(aanrechtHoekTemplate.realSizeMm(defaultParams(aanrechtHoekTemplate)), { width: 3000, height: 1800 });
  assert.deepEqual(kookeilandTemplate.realSizeMm(defaultParams(kookeilandTemplate)), { width: 2400, height: 1000 });
  assert.deepEqual(aanrechtTemplate.realSizeMm({ lengte: 4200, diepte: 650 }), { width: 4200, height: 650 });
  // Standaarddiepte 600.
  assert.equal(aanrechtTemplate.params.find((p) => p.key === 'diepte').default, 600);
  assert.equal(aanrechtHoekTemplate.params.find((p) => p.key === 'diepte').default, 600);
});

test('maten blijven bruikbaar: geen piepklein aanrecht, een hoekbeen is langer dan de diepte', () => {
  assert.ok(aanrechtTemplate.realSizeMm({ lengte: 3, diepte: 6 }).width >= 300);
  const m = keukenMaat({ lengte: 500, lengte2: 400, diepte: 600 }, 'hoek');
  assert.ok(m.lengte > m.diepte && m.lengte2 > m.diepte, JSON.stringify(m));
  // Overstek van het eiland laat altijd een kast over.
  const e = keukenMaat({ lengte: 2400, diepte: 1000, overstek: 5000 }, 'eiland');
  assert.ok(e.overstek < e.diepte && e.kastDiepte >= 300, JSON.stringify(e));
});

test('benen: recht één been over de hele lengte; hoek slaat het hoekvak over', () => {
  assert.deepEqual(benenVan(RECHT, 'recht'), [{ nr: 1, min: 0, max: 3000 }]);
  assert.deepEqual(benenVan(HOEK, 'hoek'), [{ nr: 1, min: 0, max: 2400 }, { nr: 2, min: 600, max: 1800 }]);
});

// ── onderdelen: normaliseren, toevoegen, wijzigen, wisselen ──────────────

test('normaliseren: onbekend weg, breedte uit de soort, positie binnen het been, op volgorde', () => {
  const uit = normaliseerOnderdelen([
    { soort: 'kookplaat-4', vanaf: 2800 },
    { soort: 'oven' },
    null,
    { soort: 'spoelbak-dubbel', vanaf: -50 },
    { soort: 'vaatwasser', vanaf: 1000, breedte: 20 },
  ], RECHT, 'recht');
  assert.deepEqual(uit, [
    { soort: 'spoelbak-dubbel', vanaf: 0, breedte: 900 },
    { soort: 'vaatwasser', vanaf: 1000, breedte: MIN_BREEDTE },
    { soort: 'kookplaat-4', vanaf: 2400, breedte: 600 },
  ]);
  assert.deepEqual(normaliseerOnderdelen('onzin', RECHT, 'recht'), []);
});

test('normaliseren in de hoek: been 2 begint na het hoekvak, been 1 houdt ervoor op', () => {
  const uit = normaliseerOnderdelen([
    { soort: 'kookplaat-4', vanaf: 0, been: 2 },
    { soort: 'spoelbak', vanaf: 2300, been: 1 },
    { soort: 'koelkast', vanaf: 5000, been: '2' },
  ], HOEK, 'hoek');
  assert.deepEqual(uit, [
    { soort: 'spoelbak', vanaf: 1800, breedte: 600, been: 1 },
    { soort: 'kookplaat-4', vanaf: 600, breedte: 600, been: 2 },
    { soort: 'koelkast', vanaf: 1200, breedte: 600, been: 2 },
  ]);
  // Een recht aanrecht kent geen tweede been.
  assert.deepEqual(normaliseerOnderdelen([{ soort: 'spoelbak', vanaf: 100, been: 2 }], RECHT, 'recht'),
    [{ soort: 'spoelbak', vanaf: 100, breedte: 600 }]);
});

test('toevoegen: in de eerste vrije plek die breed genoeg is', () => {
  const lijst = [
    { soort: 'koelkast', vanaf: 0, breedte: 600 },
    { soort: 'spoelbak', vanaf: 800, breedte: 600 },
  ];
  // 600-800 is te smal voor een vaatwasser; 1400 is vrij.
  const uit = voegOnderdeelToe(lijst, 'vaatwasser', RECHT, 'recht');
  assert.equal(uit.length, 3);
  assert.deepEqual(uit[2], { soort: 'vaatwasser', vanaf: 1400, breedte: 600 });
  // De invoer blijft onaangeroerd.
  assert.equal(lijst.length, 2);
  // Hoek: been 1 vol, dan in been 2 (na het hoekvak).
  const vol = [{ soort: 'hoge-kast', vanaf: 0, breedte: 2400, been: 1 }];
  const hoek = voegOnderdeelToe(vol, 'kookplaat-5', HOEK, 'hoek');
  assert.deepEqual(hoek[1], { soort: 'kookplaat-5', vanaf: 600, breedte: 900, been: 2 });
  // Geen plek: toch toegevoegd (achteraan been 1), zodat de knop nooit stil faalt.
  const propvol = voegOnderdeelToe([{ soort: 'hoge-kast', vanaf: 0, breedte: 3000 }], 'spoelbak', RECHT, 'recht');
  assert.equal(propvol.length, 2);
  assert.ok(propvol.some((o) => o.soort === 'spoelbak' && o.vanaf === 2400));
});

test('wijzigen: een andere soort krijgt zijn eigen breedte, een positie wordt geklemd', () => {
  const lijst = [{ soort: 'kookplaat-4', vanaf: 1200, breedte: 600 }];
  assert.deepEqual(wijzigOnderdeel(lijst, 0, { soort: 'kookplaat-5' }, RECHT, 'recht'),
    [{ soort: 'kookplaat-5', vanaf: 1200, breedte: 900 }]);
  assert.deepEqual(wijzigOnderdeel(lijst, 0, { soort: 'inductie', breedte: 600 }, RECHT, 'recht'),
    [{ soort: 'inductie', vanaf: 1200, breedte: 600 }]);
  assert.deepEqual(wijzigOnderdeel(lijst, 0, { vanaf: 9999 }, RECHT, 'recht'),
    [{ soort: 'kookplaat-4', vanaf: 2400, breedte: 600 }]);
  // Buiten de lijst: niets.
  assert.deepEqual(wijzigOnderdeel(lijst, 4, { vanaf: 0 }, RECHT, 'recht'), lijst);
});

test('verwijderen', () => {
  const lijst = [{ soort: 'spoelbak', vanaf: 0 }, { soort: 'vaatwasser', vanaf: 600 }];
  assert.deepEqual(verwijderOnderdeel(lijst, 0, RECHT, 'recht'), [{ soort: 'vaatwasser', vanaf: 600, breedte: 600 }]);
});

test('wisselen: twee buren ruilen van plaats, de tussenruimte blijft', () => {
  const lijst = [
    { soort: 'spoelbak-dubbel', vanaf: 300, breedte: 900 },
    { soort: 'kookplaat-4', vanaf: 1500, breedte: 600 },
  ];
  const uit = wisselOnderdelen(lijst, 0, RECHT, 'recht');
  assert.deepEqual(uit, [
    { soort: 'kookplaat-4', vanaf: 300, breedte: 600 },
    { soort: 'spoelbak-dubbel', vanaf: 1200, breedte: 900 },
  ]);
  // Tussenruimte: eerst 1500 - 1200 = 300, daarna 1200 - 900 = 300.
  // De laatste van een been heeft geen buur: niets verandert.
  assert.deepEqual(wisselOnderdelen(lijst, 1, RECHT, 'recht'), normaliseerOnderdelen(lijst, RECHT, 'recht'));
  // Hoek: wisselen gaat niet over het hoekvak heen.
  const hoek = [
    { soort: 'spoelbak', vanaf: 0, breedte: 600, been: 1 },
    { soort: 'kookplaat-4', vanaf: 900, breedte: 600, been: 2 },
  ];
  assert.deepEqual(wisselOnderdelen(hoek, 0, HOEK, 'hoek'), normaliseerOnderdelen(hoek, HOEK, 'hoek'));
});

// ── geometrie ────────────────────────────────────────────────────────────

test('contour: rechthoek, L-vorm met de hoek rechtsboven, en het eiland met overstek', () => {
  const recht = keukenGeometrie({ ...RECHT, onderdelen: [] }, 'recht');
  assert.deepEqual(recht.maat, { breedte: 3000, diepte: 600 });
  assert.deepEqual(recht.vormen[0].points, [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 600 }, { x: 0, y: 600 }]);

  const hoek = keukenGeometrie({ ...HOEK, onderdelen: [] }, 'hoek');
  assert.deepEqual(hoek.maat, { breedte: 3000, diepte: 1800 });
  assert.deepEqual(hoek.vormen[0].points, [
    { x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 1800 },
    { x: 2400, y: 1800 }, { x: 2400, y: 600 }, { x: 0, y: 600 },
  ]);

  const eiland = keukenGeometrie({ lengte: 2400, diepte: 1000, overstek: 300, onderdelen: [] }, 'eiland');
  const kastlijn = eiland.vormen.find((v) => v.kind === 'line' && v.stippel);
  assert.ok(kastlijn, 'gestippelde achterkant van de kasten');
  assert.equal(kastlijn.y1, 300);
});

test('onderdelen liggen in hun eigen vak en binnen het aanrecht', () => {
  for (const [opstelling, params] of [
    ['recht', { ...RECHT, onderdelen: Object.keys(ONDERDEEL_SOORTEN).map((soort, i) => ({ soort, vanaf: i * 370, breedte: 360 })) }],
    ['hoek', { ...HOEK, onderdelen: [
      { soort: 'spoelbak', vanaf: 100, been: 1 }, { soort: 'kookplaat-5', vanaf: 700, been: 2 },
    ] }],
    ['eiland', { lengte: 2400, diepte: 1000, overstek: 300, onderdelen: [{ soort: 'inductie', vanaf: 800 }] }],
  ]) {
    const { maat, vormen } = keukenGeometrie(params, opstelling);
    const { xs, ys } = coordinaten(vormen);
    for (const x of xs) assert.ok(x >= -1e-6 && x <= maat.breedte + 1e-6, `${opstelling}: x=${x}`);
    for (const y of ys) assert.ok(y >= -1e-6 && y <= maat.diepte + 1e-6, `${opstelling}: y=${y}`);
  }
  // Been 2 van de hoek: de kookplaat ligt in de strook langs de rechterwand.
  const { vormen } = keukenGeometrie({ ...HOEK, onderdelen: [{ soort: 'kookplaat-4', vanaf: 900, been: 2 }] }, 'hoek');
  const plaat = vormen.filter((v) => v.onderdeel === 0);
  const { xs, ys } = coordinaten(plaat);
  assert.ok(Math.min(...xs) >= 2400 - 1e-6 && Math.max(...xs) <= 3000 + 1e-6, 'binnen de diepte van been 2');
  assert.ok(Math.min(...ys) >= 900 - 1e-6 && Math.max(...ys) <= 1500 + 1e-6, 'op de plek langs been 2');
});

test('been 2 draait mee: de kraan van een spoelbak staat aan de wandkant', () => {
  const { vormen } = keukenGeometrie({ ...HOEK, onderdelen: [{ soort: 'spoelbak', vanaf: 900, been: 2 }] }, 'hoek');
  const kraan = vormen.find((v) => v.rol === 'kraan');
  const bak = vormen.find((v) => v.rol === 'bak');
  const bakX = coordinaten([bak]).xs;
  // De wand van been 2 is x = 3000; de kraan zit tussen de bak en die wand.
  assert.ok(kraan.cx > Math.max(...bakX), `kraan ${kraan.cx} niet achter de bak`);
});

test('tekenwijze per onderdeel', () => {
  const cirkels = (soort, w) => onderdeelVormen(soort, w, 600).filter((v) => v.kind === 'circle');
  assert.equal(cirkels('kookplaat-4', 600).length, 8, '4 gaspitten, elk een dubbele ring');
  assert.equal(cirkels('kookplaat-5', 900).length, 10, '5 gaspitten, elk een dubbele ring');
  assert.equal(cirkels('inductie', 800).length, 4, '4 kookzones, enkele ring');
  const bakken = (soort, w) => onderdeelVormen(soort, w, 600).filter((v) => v.rol === 'bak').length;
  assert.equal(bakken('spoelbak', 600), 1);
  assert.equal(bakken('spoelbak-dubbel', 900), 2);
  const vw = onderdeelVormen('vaatwasser', 600, 600);
  assert.ok(vw.some((v) => v.stippel), 'vaatwasser onder het blad: gestippeld');
  assert.ok(vw.some((v) => v.kind === 'text' && v.text === 'VW'));
  assert.ok(onderdeelVormen('koelkast', 600, 600).some((v) => v.kind === 'text' && v.text === 'K'));
  assert.equal(onderdeelVormen('hoge-kast', 600, 600).filter((v) => v.kind === 'line').length, 2, 'kruis');
  // Elke soort blijft binnen zijn vak.
  for (const soort of Object.keys(ONDERDEEL_SOORTEN)) {
    const { xs, ys } = coordinaten(onderdeelVormen(soort, 600, 600));
    for (const x of xs) assert.ok(x >= 0 && x <= 600, `${soort} x`);
    for (const y of ys) assert.ok(y >= 0 && y <= 600, `${soort} y`);
  }
});

test('spiegelen: het hele blok gespiegeld, tekst blijft leesbaar', () => {
  for (const [opstelling, params] of [['recht', RECHT], ['hoek', HOEK], ['eiland', { lengte: 2400, diepte: 1000 }]]) {
    const t = KEUKEN_TEMPLATES.find((k) => k.opstelling === opstelling);
    const p = { ...defaultParams(t), ...params };
    const recht = keukenGeometrie(p, opstelling);
    const gespiegeld = keukenGeometrie({ ...p, spiegelen: true }, opstelling);
    assert.deepEqual(gespiegeld.vormen, recht.vormen.map((v) => spiegelVorm(v, recht.maat.breedte)), opstelling);
  }
});

test('render: in het vak, en het vak volgt de werkelijke maat', () => {
  for (const t of KEUKEN_TEMPLATES) {
    const p = defaultParams(t);
    const m = t.realSizeMm(p);
    const vak = { x: 10, y: 20, width: m.width * 0.0567, height: m.height * 0.0567 };
    const cmds = t.render(p, vak);
    assert.ok(cmds.length > 5, t.id);
    for (const c of cmds) {
      const pts = c.kind === 'line' ? [{ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }]
        : c.kind === 'circle' || c.kind === 'text' ? [{ x: c.cx ?? c.x, y: c.cy ?? c.y }] : c.points;
      for (const q of pts) {
        assert.ok(q.x >= vak.x - 1e-6 && q.x <= vak.x + vak.width + 1e-6, `${t.id} x`);
        assert.ok(q.y >= vak.y - 1e-6 && q.y <= vak.y + vak.height + 1e-6, `${t.id} y`);
      }
    }
  }
});

test('grepen en maatwijziging: lengte uit het vak, het begin of de hoek blijft staan', () => {
  assert.deepEqual(aanrechtTemplate.paramsUitMaat({ ...RECHT }, { breedteMm: 3614, hoogteMm: 598 }),
    { lengte: 3610, diepte: 600 });
  assert.deepEqual(aanrechtHoekTemplate.paramsUitMaat({ ...HOEK }, { breedteMm: 3200, hoogteMm: 2104 }),
    { lengte: 3200, lengte2: 2100, diepte: 600 });
  assert.deepEqual(kookeilandTemplate.paramsUitMaat({ lengte: 2400, diepte: 1000 }, { breedteMm: 2800, hoogteMm: 1100 }),
    { lengte: 2800, diepte: 1100 });
  assert.equal(aanrechtTemplate.maatAnker({}), 'back-left');
  assert.equal(aanrechtTemplate.maatAnker({ spiegelen: true }), 'back-right');
  assert.equal(aanrechtHoekTemplate.maatAnker({}), 'back-right');
  assert.equal(aanrechtHoekTemplate.maatAnker({ spiegelen: true }), 'back-left');
  assert.equal(kookeilandTemplate.maatAnker({}), 'center');
});

// ── parameterlijst, register, palet ──────────────────────────────────────

test('de onderdelen zijn een lijst-parameter met velden en bewerkingen', () => {
  for (const t of KEUKEN_TEMPLATES) {
    const def = t.params.find((p) => p.key === 'onderdelen');
    assert.equal(def.type, 'list', t.id);
    const soort = def.items.find((f) => f.key === 'soort');
    assert.deepEqual(soort.options.map((o) => o.value), Object.keys(ONDERDEEL_SOORTEN));
    assert.ok(def.items.some((f) => f.key === 'vanaf') && def.items.some((f) => f.key === 'breedte'));
    assert.equal(def.items.some((f) => f.key === 'been'), t.id === 'aanrecht-hoek', `${t.id}: been-veld`);
    for (const fn of ['normalize', 'add', 'update', 'remove', 'swap']) assert.equal(typeof def[fn], 'function', fn);
    // De standaardindeling past en overlapt niet.
    const p = defaultParams(t);
    const lijst = def.normalize(p.onderdelen, p);
    assert.equal(lijst.length, p.onderdelen.length, `${t.id}: standaard past`);
    const perBeen = new Map();
    for (const o of lijst) perBeen.set(o.been || 1, [...(perBeen.get(o.been || 1) || []), o]);
    for (const reeks of perBeen.values()) {
      for (let i = 1; i < reeks.length; i++) {
        assert.ok(reeks[i].vanaf >= reeks[i - 1].vanaf + reeks[i - 1].breedte, `${t.id}: overlap`);
      }
    }
  }
});

test('defaultParams geeft elk symbool een eigen kopie van de onderdelen', () => {
  const a = defaultParams(aanrechtTemplate);
  const b = defaultParams(aanrechtTemplate);
  assert.notEqual(a.onderdelen, b.onderdelen);
  a.onderdelen.push({ soort: 'spoelbak' });
  assert.equal(defaultParams(aanrechtTemplate).onderdelen.length, b.onderdelen.length);
});

test('normalizeListParam gebruikt de normalisatie van de parameter, ook voor ruwe invoer', () => {
  const def = aanrechtTemplate.params.find((p) => p.key === 'onderdelen');
  assert.deepEqual(normalizeListParam(def, [{ soort: 'vaatwasser', vanaf: -3 }], RECHT),
    [{ soort: 'vaatwasser', vanaf: 0, breedte: 600 }]);
  assert.equal(normalizeListParam(def, 'geen lijst', RECHT), undefined);
  // Zonder eigen normalisatie: een kopie van de objecten.
  const kaal = { key: 'x', type: 'list' };
  const invoer = [{ a: 1 }];
  const uit = normalizeListParam(kaal, invoer, {});
  assert.deepEqual(uit, invoer);
  assert.notEqual(uit[0], invoer[0]);
});

test('normalizeParams: alleen de lijsten, met de maten van dezelfde parameters', () => {
  const uit = normalizeParams(aanrechtTemplate, {
    lengte: 1800, diepte: 600, onderdelen: [{ soort: 'kookplaat-5', vanaf: 1500 }, { soort: 'wasmachine' }],
  });
  assert.deepEqual(uit, { lengte: 1800, diepte: 600, onderdelen: [{ soort: 'kookplaat-5', vanaf: 900, breedte: 900 }] });
  // Geen lijst meegegeven: de standaard van het template blijft gelden.
  assert.deepEqual(normalizeParams(aanrechtTemplate, { lengte: 2000, onderdelen: 'x' }), { lengte: 2000 });
  // Templates zonder lijst: ongewijzigd (maar een kopie).
  const deur = getTemplate('door');
  const p = { width: 900 };
  assert.deepEqual(normalizeParams(deur, p), p);
  assert.notEqual(normalizeParams(deur, p), p);
  assert.deepEqual(normalizeParams(null, p), p);
});

test('geregistreerd, in de keuken-categorie en als meubilair voor IFC', () => {
  assert.deepEqual(KEUKEN_TEMPLATES.map((t) => t.id), ['aanrecht', 'aanrecht-hoek', 'kookeiland']);
  for (const t of KEUKEN_TEMPLATES) {
    assert.equal(getTemplate(t.id), t);
    assert.equal(t.category, 'NL Keuken');
    assert.equal(ifcCategoryForParametric(t.id), 'IfcFurniture');
  }
});

test('in het symbolenpalet: NL Sanitair en NL Keuken, elk symbool een parametrische ingang', () => {
  const cat = (id) => NL_CATEGORIES.find((c) => c.id === id);
  const verwacht = {
    'nl-sanitair': ['wandcloset', 'staand-closet', 'fontein', 'hoekfontein'],
    'nl-keuken': ['aanrecht', 'aanrecht-hoek', 'kookeiland'],
  };
  for (const [id, ids] of Object.entries(verwacht)) {
    const c = cat(id);
    assert.ok(c, id);
    assert.equal(c.builtin, true);
    assert.equal(c.industry, 'aec');
    assert.equal(c.country, 'nl');
    assert.deepEqual(c.symbols.map((s) => s.parametricId), ids);
    for (const s of c.symbols) {
      assert.ok(getTemplate(s.parametricId), s.parametricId);
      assert.ok(s.svg.startsWith('<svg') && s.name, s.id);
    }
  }
});
