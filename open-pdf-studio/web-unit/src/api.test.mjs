import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSIE, ATTRIBUTEN, STANDAARD, leesInstellingen, magGereedschap,
  GEBEURTENISSEN, geladenDetail, gewijzigdDetail, opgeslagenDetail, foutDetail,
  maakBericht, maakAntwoord, maakFoutAntwoord, keurBericht,
} from './api.js';

test('zonder attributen krijg je de standaardinstellingen', () => {
  const i = leesInstellingen({});
  assert.equal(i.src, null);
  assert.equal(i.schaal, null);
  assert.equal(i.eenheid, 'mm');
  assert.equal(i.taal, 'en');
  assert.equal(i.motor, 'pdfjs');
  assert.equal(i.modus, 'edit');
  assert.deepEqual([...i.gereedschappen], ['measure', 'comment', 'shape']);
  assert.equal(i.pagina, 1);
  assert.equal(i.zoom, 'fit');
  assert.equal(i.opslag, 'none');
  assert.deepEqual([...i.gastheerOrigins], []);
});

test('alle gedocumenteerde attributen worden gelezen', () => {
  const i = leesInstellingen({
    src: '/t/1.pdf', scale: '1:50', unit: 'm', lang: 'NL', engine: 'MuPDF',
    mode: 'view', tools: 'measure, comment', page: '3', zoom: '175%',
    storage: 'local', 'host-origin': 'https://a.example https://b.example',
  });
  assert.equal(i.src, '/t/1.pdf');
  assert.equal(i.schaal.noemer, 50);
  assert.equal(i.schaal.eenheid, 'm');
  assert.equal(i.eenheid, 'm');
  assert.equal(i.taal, 'nl');
  assert.equal(i.motor, 'mupdf');
  assert.equal(i.modus, 'view');
  assert.deepEqual([...i.gereedschappen], ['measure', 'comment']);
  assert.equal(i.pagina, 3);
  assert.equal(i.zoom, 1.75);
  assert.equal(i.opslag, 'local');
  assert.deepEqual([...i.gastheerOrigins], ['https://a.example', 'https://b.example']);
});

test('de schaal wordt in de gevraagde eenheid gelezen, niet in millimeters', () => {
  const mm = leesInstellingen({ scale: '1:100', unit: 'mm' });
  const m = leesInstellingen({ scale: '1:100', unit: 'm' });
  assert.ok(mm.schaal.eenheidPerPunt > m.schaal.eenheidPerPunt * 999);
  assert.equal(mm.schaal.noemer, m.schaal.noemer);
});

test('een onzinnige waarde valt terug op de standaard in plaats van te gooien', () => {
  const i = leesInstellingen({
    unit: 'el', engine: 'webgl', mode: 'kijken', tools: 'ocr,print',
    page: '-2', zoom: 'kaas', storage: 'server', scale: '1:0',
  });
  assert.equal(i.eenheid, 'mm');
  assert.equal(i.motor, 'pdfjs');
  assert.equal(i.modus, 'edit');
  assert.deepEqual([...i.gereedschappen], []);
  assert.equal(i.pagina, 1);
  assert.equal(i.zoom, 'fit');
  assert.equal(i.opslag, 'none');
  assert.equal(i.schaal, null);
});

test('zoom accepteert zowel procenten als een factor', () => {
  assert.equal(leesInstellingen({ zoom: '175%' }).zoom, 1.75);
  assert.equal(leesInstellingen({ zoom: '175' }).zoom, 1.75);
  assert.equal(leesInstellingen({ zoom: '1.75' }).zoom, 1.75);
  assert.equal(leesInstellingen({ zoom: 'fit-width' }).zoom, 'fit-width');
});

test('in de alleen-lezenstand is geen enkel gereedschap toegestaan', () => {
  const i = leesInstellingen({ mode: 'view', tools: 'measure,comment,shape' });
  for (const g of ['measure', 'comment', 'shape']) assert.equal(magGereedschap(i, g), false);
});

test('in de bewerkstand mag alleen wat in tools staat', () => {
  const i = leesInstellingen({ mode: 'edit', tools: 'measure' });
  assert.equal(magGereedschap(i, 'measure'), true);
  assert.equal(magGereedschap(i, 'comment'), false);
});

test('de attributenlijst dekt alles wat leesInstellingen kent', () => {
  for (const naam of ['src', 'scale', 'unit', 'lang', 'engine', 'mode', 'tools', 'page', 'zoom', 'storage', 'host-origin']) {
    assert.ok(ATTRIBUTEN.includes(naam), naam + ' ontbreekt');
  }
  assert.equal(ATTRIBUTEN.length, 11);
  assert.equal(STANDAARD.motor, 'pdfjs');
});

test('de gebeurtenissen hebben de namen uit het ontwerp', () => {
  assert.deepEqual(GEBEURTENISSEN, {
    geladen: 'opds:geladen', gewijzigd: 'opds:gewijzigd',
    opgeslagen: 'opds:opgeslagen', fout: 'opds:fout',
  });
});

test('de inhoud van de gebeurtenissen', () => {
  const schaal = { eenheidPerPunt: 35.2778, noemer: 100, eenheid: 'mm', extra: 'weg' };
  const g = geladenDetail({ paginas: 4, breedtePt: 3370, hoogtePt: 2384, schaal });
  assert.deepEqual(g, {
    paginas: 4, breedtePt: 3370, hoogtePt: 2384,
    schaal: { eenheidPerPunt: 35.2778, noemer: 100, eenheid: 'mm' },
  });
  assert.equal(geladenDetail({ paginas: 1, breedtePt: 1, hoogtePt: 1, schaal: null }).schaal, null);

  assert.deepEqual(gewijzigdDetail([]), { aantal: 0, laatste: null });
  assert.deepEqual(gewijzigdDetail([{ id: 'a' }, { id: 'b' }]), { aantal: 2, laatste: { id: 'b' } });
  assert.deepEqual(gewijzigdDetail(null), { aantal: 0, laatste: null });

  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(opgeslagenDetail(bytes, [{}, {}]), { bytes, aantalAnnotaties: 2 });
  assert.deepEqual(foutDetail(null, null), { code: 'onbekend', bericht: '' });
});

test('een bericht draagt de protocolversie', () => {
  const b = maakBericht('laad', 'x1', { src: '/a.pdf' });
  assert.deepEqual(b, { opds: PROTOCOL_VERSIE, id: 'x1', type: 'laad', src: '/a.pdf' });
  assert.deepEqual(maakAntwoord(b, { paginas: 2 }), { opds: 1, id: 'x1', type: 'laad:klaar', paginas: 2 });
  assert.deepEqual(maakFoutAntwoord(b, 'netwerk', 'kapot'), { opds: 1, id: 'x1', type: 'laad:fout', code: 'netwerk', bericht: 'kapot' });
});

test('een bericht van een vreemde origin wordt geweigerd', () => {
  const b = maakBericht('laad', 'x1');
  assert.deepEqual(keurBericht(b, 'https://kwaad.example', ['https://goed.example']),
    { geldig: false, reden: 'vreemde-origin' });
  assert.equal(keurBericht(b, 'https://goed.example', ['https://goed.example']).geldig, true);
});

test('zonder host-origin accepteert de unit niets', () => {
  const b = maakBericht('laad', 'x1');
  assert.deepEqual(keurBericht(b, 'https://goed.example', []),
    { geldig: false, reden: 'geen-toegestane-origin' });
});

test('rommel, een verkeerde versie, een lege id en een onbekende opdracht worden geweigerd', () => {
  const ok = ['https://goed.example'];
  assert.equal(keurBericht(null, 'https://goed.example', ok).reden, 'geen-object');
  assert.equal(keurBericht('laad', 'https://goed.example', ok).reden, 'geen-object');
  assert.equal(keurBericht({ opds: 2, id: 'a', type: 'laad' }, 'https://goed.example', ok).reden, 'verkeerde-versie');
  assert.equal(keurBericht({ opds: 1, id: '', type: 'laad' }, 'https://goed.example', ok).reden, 'geen-id');
  assert.equal(keurBericht({ opds: 1, id: 'a', type: 'formatteerSchijf' }, 'https://goed.example', ok).reden, 'onbekende-opdracht');
});
