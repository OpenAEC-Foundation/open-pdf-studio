// window.__OPDS_APP__ voor de OpenAEC-werkplek: de acht gereedschappen van
// het protocol, met een nagebootste omgeving (document, pdf.js en handlers).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EIGENSCHAPPEN, MAX_PAGINATEKST, MAX_TREFFERS, SOORTEN, TOOL_NAMEN,
  annotatieSamenvatting, eigenschappenNaarVelden, kapAf, maakWerkplekApp, tekstUitItems, zoekInTekst,
} from './werkplek-app.js';

const items = (...regels) => regels.map((str) => ({ str, hasEOL: true }));

function omgeving({ paginas = 3, tekst = {}, annotaties = [] } = {}) {
  const pdf = {};
  const opdrachten = [];
  const gelezen = [];
  const doc = {
    sleutel: pdf,
    paginas,
    pagina: 1,
    bestandsnaam: 'tekening.pdf',
    gewijzigd: false,
    geselecteerd: [],
    paginamaat: () => ({ breedte: 595.276, hoogte: 841.89 }),
    annotaties,
  };
  let open = true;
  const o = {
    doc,
    opdrachten,
    gelezen,
    sluit: () => { open = false; },
    document: () => (open ? doc : null),
    tekstItems: async (p) => { gelezen.push(p); return tekst[p] || []; },
    naarPagina: async (p) => { doc.pagina = p; },
    opdracht: async (naam, params) => {
      opdrachten.push([naam, params]);
      if (naam === 'mcp:create-annotation') return { ok: true, id: 'ann-1' };
      if (naam === 'mcp:delete-annotation' && params.id === 'weg') return { ok: false, error: 'annotation not found: weg' };
      return { ok: true, id: params.id };
    },
  };
  return o;
}

test('precies de acht gereedschappen van het protocol', () => {
  const app = maakWerkplekApp(omgeving());
  assert.deepEqual(app.tools(), [
    'pdf_stand', 'pdf_naar_pagina', 'pdf_paginatekst', 'pdf_zoeken',
    'pdf_annotaties', 'pdf_annotatie_maken', 'pdf_annotatie_wijzigen', 'pdf_annotatie_verwijderen',
  ]);
  assert.deepEqual(app.tools(), [...TOOL_NAMEN]);
  assert.deepEqual(SOORTEN, ['stamp', 'highlight', 'textbox', 'note', 'rectangle', 'ellipse', 'cloud', 'arrow', 'line']);
  assert.deepEqual(Object.keys(EIGENSCHAPPEN), SOORTEN);
});

test('stand: pagina, aantal, naam, gewijzigd, selectie en paginamaat; zonder document leeg', async () => {
  const o = omgeving();
  o.doc.geselecteerd = ['a1'];
  const app = maakWerkplekApp(o);
  const verwacht = { pagina: 1, paginas: 3, bestandsnaam: 'tekening.pdf', gewijzigd: false, geselecteerd: ['a1'], paginamaat: { breedte: 595.28, hoogte: 841.89 } };
  assert.deepEqual(await app.run('pdf_stand', {}), verwacht);
  assert.deepEqual(app.stand(), verwacht);
  o.sluit();
  assert.deepEqual(await app.run('pdf_stand'), { pagina: null, paginas: 0, bestandsnaam: null, gewijzigd: false, geselecteerd: [], paginamaat: null });
  await assert.rejects(app.run('pdf_paginatekst', { pagina: 1 }), /geen PDF geopend/);
});

test('naar een pagina: binnen het document, 1-gebaseerd', async () => {
  const o = omgeving();
  const app = maakWerkplekApp(o);
  assert.deepEqual(await app.run('pdf_naar_pagina', { pagina: 3 }), { pagina: 3 });
  assert.equal(o.doc.pagina, 3);
  await assert.rejects(app.run('pdf_naar_pagina', { pagina: 4 }), /pagina 4 bestaat niet/);
  await assert.rejects(app.run('pdf_naar_pagina', { pagina: 1.5 }), /geheel getal/);
  await assert.rejects(app.run('pdf_naar_pagina', {}), /geheel getal/);
});

test('paginatekst: regels uit pdf.js, afgekapt boven het maximum', async () => {
  const lang = 'x'.repeat(MAX_PAGINATEKST + 10);
  const app = maakWerkplekApp(omgeving({ tekst: { 1: items('Fundering', 'Peil 0 = NAP +1,20'), 2: [{ str: lang }] } }));
  assert.deepEqual(await app.run('pdf_paginatekst', { pagina: 1 }), { pagina: 1, tekst: 'Fundering\nPeil 0 = NAP +1,20' });
  const uit = await app.run('pdf_paginatekst', { pagina: 2 });
  assert.equal(uit.afgekapt, true);
  assert.equal(uit.tekst.length, MAX_PAGINATEKST);
  assert.deepEqual(kapAf('kort', 10), { tekst: 'kort', afgekapt: false });
  assert.equal(tekstUitItems([{ str: 'a ' }, { str: 'b', hasEOL: true }, { str: 'c' }, {}]), 'a b\nc');
});

test('zoeken: zonder hoofdletters en accenten, met fragment en pagina; tekst één keer gelezen', async () => {
  const o = omgeving({ tekst: { 1: items('De Fundering op staal'), 3: items('Funderingsplan', 'zie détail fundering') } });
  const app = maakWerkplekApp(o);
  const { treffers } = await app.run('pdf_zoeken', { tekst: 'FUNDERING' });
  assert.deepEqual(treffers.map((t) => t.pagina), [1, 3, 3]);
  assert.equal(treffers[0].fragment, 'De Fundering op staal');
  assert.deepEqual((await app.run('pdf_zoeken', { tekst: 'detail' })).treffers, [{ pagina: 3, fragment: 'Funderingsplan zie détail fundering' }]);
  assert.deepEqual(o.gelezen, [1, 2, 3], 'de tweede zoekopdracht leest uit de cache');
  await assert.rejects(app.run('pdf_zoeken', { tekst: '  ' }), /zoekterm/);
});

test('zoeken: hoogstens 50 treffers, dan afgekapt; fragmenten met context', async () => {
  const veel = Array.from({ length: 30 }, () => 'paal').join(' ');
  const app = maakWerkplekApp(omgeving({ tekst: { 1: [{ str: veel }], 2: [{ str: veel }] } }));
  const uit = await app.run('pdf_zoeken', { tekst: 'paal' });
  assert.equal(uit.treffers.length, MAX_TREFFERS);
  assert.equal(uit.afgekapt, true);
  const [t] = zoekInTekst(`${'a'.repeat(100)} gevonden ${'b'.repeat(100)}`, 'gevonden', 7);
  assert.equal(t.pagina, 7);
  assert.match(t.fragment, /^…a+ gevonden b+…$/);
  assert.ok(t.fragment.length < 140);
});

test('annotaties: id, pagina, soort, tekst, kleur en rechthoek; filter op pagina', async () => {
  const annotaties = [
    { id: 'a1', type: 'box', page: 1, x: 10, y: 20.123, width: 30, height: 40, color: '#ff0000' },
    { id: 'a2', type: 'stamp', page: 2, x: 0, y: 0, width: 160, height: 50, stampText: 'GOEDGEKEURD', stampColor: '#22c55e', color: '#000000' },
    { id: 'a3', type: 'arrow', page: 2, startX: 50, startY: 60, endX: 10, endY: 100, color: '#0000ff' },
    { id: 'a4', type: 'comment', page: 1, x: 5, y: 5, text: 'Controleren' },
    { id: 'a5', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 10, endY: 0, measureText: '1,00 m' },
  ];
  const app = maakWerkplekApp(omgeving({ annotaties }));
  const alle = (await app.run('pdf_annotaties', {})).annotaties;
  assert.equal(alle.length, 5);
  assert.deepEqual(alle[0], { id: 'a1', pagina: 1, soort: 'rectangle', kleur: '#ff0000', rechthoek: { x: 10, y: 20.12, breedte: 30, hoogte: 40 } });
  assert.deepEqual(alle[1], { id: 'a2', pagina: 2, soort: 'stamp', tekst: 'GOEDGEKEURD', kleur: '#22c55e', rechthoek: { x: 0, y: 0, breedte: 160, hoogte: 50 } });
  assert.deepEqual(alle[2], {
    id: 'a3', pagina: 2, soort: 'arrow', kleur: '#0000ff',
    rechthoek: { x: 10, y: 60, breedte: 40, hoogte: 40 }, begin: { x: 50, y: 60 }, eind: { x: 10, y: 100 },
  });
  assert.equal(alle[3].soort, 'note');
  assert.equal(alle[4].soort, 'measureDistance');
  assert.equal(alle[4].tekst, '1,00 m');
  assert.deepEqual((await app.run('pdf_annotaties', { pagina: 2 })).annotaties.map((a) => a.id), ['a2', 'a3']);
  assert.equal(annotatieSamenvatting({ id: 7, type: 'highlight' }).id, '7');
});

test('maken: soort en eigenschappen worden een create-opdracht van de app', async () => {
  const o = omgeving();
  const app = maakWerkplekApp(o);
  assert.deepEqual(await app.run('pdf_annotatie_maken', {
    pagina: 2, soort: 'rectangle',
    eigenschappen: { rechthoek: { x: 10, y: 20, breedte: 100, hoogte: 50 }, kleur: '#FF0000', vulkleur: 'geen', lijndikte: 2 },
  }), { id: 'ann-1' });
  assert.deepEqual(o.opdrachten[0], ['mcp:create-annotation', {
    type: 'box', page: 2,
    props: { x: 10, y: 20, width: 100, height: 50, color: '#ff0000', strokeColor: '#ff0000', fillColor: null, lineWidth: 2 },
  }]);
  await app.run('pdf_annotatie_maken', { pagina: 1, soort: 'note', eigenschappen: { positie: { x: 5, y: 6 }, tekst: 'Klopt dit?' } });
  assert.deepEqual(o.opdrachten[1][1], { type: 'comment', page: 1, props: { x: 5, y: 6, text: 'Klopt dit?' } });
  await app.run('pdf_annotatie_maken', { pagina: 1, soort: 'arrow', eigenschappen: { begin: { x: 1, y: 2 }, eind: { x: 3, y: 4 } } });
  assert.deepEqual(o.opdrachten[2][1].props, { startX: 1, startY: 2, endX: 3, endY: 4 });
});

test('maken: een stempel is een tekststempel zonder SVG-beeld, met standaardkleur', async () => {
  const o = omgeving();
  const app = maakWerkplekApp(o);
  await app.run('pdf_annotatie_maken', { pagina: 1, soort: 'stamp', eigenschappen: { rechthoek: { x: 0, y: 0, breedte: 160, hoogte: 50 }, tekst: 'GOEDGEKEURD' } });
  const props = o.opdrachten[0][1].props;
  assert.equal(o.opdrachten[0][1].type, 'stamp');
  assert.equal(props.stampText, 'GOEDGEKEURD');
  assert.ok('stampSvg' in props && props.stampSvg === undefined, 'geen standaard-SVG van de handler');
  assert.equal(props.stampColor, '#ef4444');
  assert.equal(props.opacity, 0.85);
  const groen = eigenschappenNaarVelden('stamp', { rechthoek: { x: 0, y: 0, breedte: 1, hoogte: 1 }, kleur: '#22c55e' }, { nieuw: true });
  assert.equal(groen.stampColor, '#22c55e');
  assert.equal(groen.stampText, 'STEMPEL');
});

test('maken: ontbrekende of onbekende eigenschappen en verkeerde waarden zijn een fout', async () => {
  const app = maakWerkplekApp(omgeving());
  const maak = (soort, eigenschappen, pagina = 1) => app.run('pdf_annotatie_maken', { pagina, soort, eigenschappen });
  await assert.rejects(maak('rectangle', {}), /rechthoek nodig/);
  await assert.rejects(maak('line', { begin: { x: 0, y: 0 } }), /begin en eind nodig/);
  await assert.rejects(maak('note', { tekst: 'x' }), /positie nodig/);
  await assert.rejects(maak('highlight', { rechthoek: { x: 0, y: 0, breedte: 1, hoogte: 1 }, tekst: 'x' }), /highlight kent tekst niet/);
  await assert.rejects(maak('ellipse', { rechthoek: { x: 0, y: 0, breedte: 0, hoogte: 1 } }), /groter dan 0/);
  await assert.rejects(maak('cloud', { rechthoek: { x: 0, y: 0, breedte: 1, hoogte: 1 }, kleur: 'rood' }), /hexkleur/);
  await assert.rejects(maak('textbox', { rechthoek: { x: 0, y: 0, breedte: 1, hoogte: 1 }, dekking: 2 }), /dekking moet een getal van 0 tot 1/);
  await assert.rejects(maak('polygon', {}), /onbekende soort: polygon/);
  await assert.rejects(maak('line', { begin: { x: 0, y: 0 }, eind: { x: 1, y: 1 } }, 9), /pagina 9 bestaat niet/);
});

test('wijzigen: alleen wat genoemd is, met de soort van de bestaande annotatie', async () => {
  const o = omgeving({ annotaties: [{ id: 'a1', type: 'textbox', page: 1, x: 0, y: 0, width: 10, height: 10 }, { id: 'p1', type: 'polyline', page: 1 }] });
  const app = maakWerkplekApp(o);
  assert.deepEqual(await app.run('pdf_annotatie_wijzigen', { id: 'a1', eigenschappen: { tekst: 'Nieuw', vulkleur: null, lettergrootte: 14 } }), { id: 'a1' });
  assert.deepEqual(o.opdrachten[0], ['mcp:update-annotation', { id: 'a1', props: { text: 'Nieuw', fillColor: 'none', fontSize: 14 } }]);
  await assert.rejects(app.run('pdf_annotatie_wijzigen', { id: 'a1', eigenschappen: {} }), /minstens één eigenschap/);
  await assert.rejects(app.run('pdf_annotatie_wijzigen', { id: 'xx', eigenschappen: { tekst: 'a' } }), /geen annotatie met id xx/);
  await assert.rejects(app.run('pdf_annotatie_wijzigen', { id: 'p1', eigenschappen: { kleur: '#000000' } }), /polyline kan hier niet gewijzigd/);
});

test('verwijderen: de delete-opdracht; een fout van de app komt als melding terug', async () => {
  const o = omgeving();
  const app = maakWerkplekApp(o);
  assert.deepEqual(await app.run('pdf_annotatie_verwijderen', { id: 'a1' }), { id: 'a1' });
  assert.deepEqual(o.opdrachten[0], ['mcp:delete-annotation', { id: 'a1' }]);
  await assert.rejects(app.run('pdf_annotatie_verwijderen', { id: 'weg' }), /annotation not found: weg/);
  await assert.rejects(app.run('pdf_annotatie_verwijderen', {}), /id moet/);
});

test('een onbekend gereedschap of verkeerde argumenten: een afgewezen belofte', async () => {
  const app = maakWerkplekApp(omgeving());
  await assert.rejects(app.run('app_screenshot_view', {}), /onbekend gereedschap: app_screenshot_view/);
  await assert.rejects(app.run('toString', {}), /onbekend gereedschap/);
  await assert.rejects(app.run('pdf_stand', [1]), /argumenten moet een object/);
});
