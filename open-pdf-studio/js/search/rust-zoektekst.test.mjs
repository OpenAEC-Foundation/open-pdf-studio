// Zoektekst uit de PDFium-worker: decoderen van `OPT1` en de bron met haar
// banen en terugvallen (rust-zoektekst.js). De worker zelf wordt hier
// nagebootst met een encoder die dezelfde indeling schrijft als
// pdfium-worker/src/page_text/mod.rs (encode_page).

import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeerZoektekst, paginaDataUitRust, maakRustZoektekst, VLAG_RTL, STUK } from './rust-zoektekst.js';
import { matchFractionsUitVakken } from './match-rect.js';

/** OPT1 van pagina's: [{ index, items: [{ str, transform, width, height, font, eol, vakken? }], vlaggen }] */
function opt1(paginas, paginaAantal) {
  const delen = [];
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); delen.push(b); };
  const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); delen.push(b); };
  const pad = () => { const n = delen.reduce((t, b) => t + b.length, 0); if (n % 4) delen.push(Buffer.alloc(4 - (n % 4))); };
  delen.push(Buffer.from('OPT1'));
  u32(paginas.length); u32(paginaAantal); u32(0);
  for (const p of paginas) {
    const fonts = ['Helvetica'];
    const units = p.items.reduce((t, i) => t + i.str.length, 0);
    u32(p.index); [0, 0, 612, 792].forEach(f32);
    u32(p.items.length); u32(units); u32(fonts.length); u32(p.vlaggen || 0);
    for (const f of fonts) { u32(f.length); delen.push(Buffer.from(f)); pad(); }
    let begin = 0;
    for (const it of p.items) {
      (it.transform || [10, 0, 0, 10, 72, 700]).forEach(f32);
      f32(it.width ?? it.str.length * 5); f32(it.height ?? 10);
      u32(begin); u32(it.str.length); u32(0); u32((it.eol ? 1 : 0) | (it.rtl ? 2 : 0));
      begin += it.str.length;
    }
    for (const it of p.items) for (const c of it.str) { const b = Buffer.alloc(2); b.writeUInt16LE(c.charCodeAt(0)); delen.push(b); }
    pad();
    for (const it of p.items) {
      const n = it.str.length;
      for (let k = 0; k < n; k++) {
        const [a, e] = it.vakken?.[k] ?? [k / n, (k + 1) / n];
        const b = Buffer.alloc(4); b.writeUInt16LE(Math.round(a * 65535)); b.writeUInt16LE(Math.round(e * 65535), 2); delen.push(b);
      }
    }
  }
  return new Uint8Array(Buffer.concat(delen));
}

const paginaMet = (index, tekst = `pagina ${index + 1}`) => ({ index, items: [{ str: tekst, eol: true }, { str: '' }, { str: 'tweede' }] });

/** Nagebootste worker: geeft `budget` pagina's per aanvraag, telt de aanroepen. */
function nepWorker({ paginaAantal, budget = Infinity, fout = null, vlaggen = () => 0 } = {}) {
  const aanroepen = [];
  return {
    aanroepen,
    async call(cmd, args) {
      aanroepen.push({ cmd, ...args });
      await new Promise((r) => setTimeout(r, 1));
      if (fout) throw new Error(fout);
      const eind = Math.min(paginaAantal, args.first + Math.min(args.count, budget));
      const paginas = [];
      for (let i = args.first; i < eind; i++) paginas.push({ ...paginaMet(i), vlaggen: vlaggen(i) });
      return opt1(paginas, paginaAantal);
    },
  };
}

function route(w, extra = {}) {
  const meldingen = [];
  const r = maakRustZoektekst({ inTauri: () => true, call: w.call, warn: (...a) => meldingen.push(a.join(' ')), ...extra });
  return { r, meldingen };
}

test('decodes pages, items, text and boxes', () => {
  const data = opt1([{ index: 4, items: [{ str: 'Hello', transform: [12, 0, 0, 12, 72, 740], width: 30, eol: true, vakken: [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1]] }, { str: '' }, { str: 'world', rtl: true }], vlaggen: 0 }], 9);
  const { paginaAantal, paginas } = decodeerZoektekst(data);
  assert.equal(paginaAantal, 9);
  assert.equal(paginas.length, 1);
  const p = paginas[0];
  assert.equal(p.index, 4);
  assert.deepEqual(p.view, [0, 0, 612, 792]);
  assert.equal(p.tekst, 'Helloworld');
  assert.deepEqual(p.items.map((i) => i.str), ['Hello', '', 'world']);
  assert.deepEqual(p.items[0].transform, [12, 0, 0, 12, 72, 740]);
  assert.equal(p.items[0].width, 30);
  assert.equal(p.items[0].fontName, 'Helvetica');
  assert.ok(p.items[0].hasEOL && !p.items[2].hasEOL && p.items[2].rtl);
  assert.equal(p.items[0].vakken.length, 10);
  assert.deepEqual(matchFractionsUitVakken(p.items[0].vakken, 1, 3).map((v) => +v.toFixed(3)), [0.2, 0.6]);
});

test('page data matches what extractPageText builds from pdf.js', () => {
  const p = decodeerZoektekst(opt1([paginaMet(0, 'Een')], 1)).paginas[0];
  const d = paginaDataUitRust(p);
  assert.equal(d.text, 'Eentweede');
  // Het lege regeleinde-item telt mee in de itemindex, net als in de tekstlaag.
  assert.deepEqual(d.items.map((i) => [i.str, i.startPos, i.endPos, i.itemIndex]), [['Een', 0, 3, 0], ['tweede', 3, 9, 2]]);
  assert.equal(d.items[0].fontFamily, '');
  assert.ok(d.items[0].vakken instanceof Uint16Array);
});

test('rejects a buffer that is not OPT1', () => {
  assert.throws(() => decodeerZoektekst(new Uint8Array(16)), /PDF_TEXT_FORMAT/);
});

test('match fractions from boxes take the outer edges (right-to-left too)', () => {
  const vakken = new Uint16Array([40000, 65535, 20000, 40000, 0, 20000]); // drie tekens van rechts naar links
  assert.deepEqual(matchFractionsUitVakken(vakken, 0, 3).map((v) => +v.toFixed(4)), [0, 1]);
  assert.deepEqual(matchFractionsUitVakken(vakken, 1, 2).map((v) => +v.toFixed(4)), [+(20000 / 65535).toFixed(4), +(40000 / 65535).toFixed(4)]);
  assert.equal(matchFractionsUitVakken(vakken, 5, 6), null);
});

test('the first page comes alone, then the document in chunks over the lanes', async () => {
  const w = nepWorker({ paginaAantal: 100 });
  const { r } = route(w);
  const bron = r.bron({ path: 'C:\\a.pdf', expectLen: 123, paginaAantal: 100, banen: 2 });
  const eerste = await bron.pagina(40);
  assert.equal(eerste.text, 'pagina 40tweede');
  assert.deepEqual(w.aanroepen[0], { cmd: 'extract_search_text', path: 'C:\\a.pdf', first: 39, count: 1, expectLen: 123, lane: 0 });
  for (let n = 1; n <= 100; n++) {
    if (n === 40) continue;
    const d = await bron.pagina(n);
    assert.equal(d?.text, `pagina ${n}tweede`, `pagina ${n}`);
  }
  const stukken = w.aanroepen.slice(1);
  assert.ok(stukken.every((a) => a.count === STUK || a.first + a.count === 100));
  assert.deepEqual(new Set(stukken.map((a) => a.lane)), new Set([0, 1]));
  bron.sluit();
});

test('a worker that stops early (time budget) is asked for the rest', async () => {
  const w = nepWorker({ paginaAantal: 50, budget: 7 });
  const { r } = route(w);
  const bron = r.bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 50, banen: 1 });
  for (let n = 1; n <= 50; n++) assert.equal((await bron.pagina(n))?.text, `pagina ${n}tweede`);
  // Na de eerste losse pagina telkens het vervolg van het stuk.
  assert.deepEqual(w.aanroepen.slice(1, 4).map((a) => [a.first, a.count]), [[0, STUK], [7, STUK - 7], [14, STUK - 14]]);
  bron.sluit();
});

test('flagged pages (vertical or right-to-left script) are left to pdf.js', async () => {
  const w = nepWorker({ paginaAantal: 3, vlaggen: (i) => (i === 1 ? VLAG_RTL : 0) });
  const bron = route(w).r.bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 3 });
  assert.ok(await bron.pagina(1));
  assert.equal(await bron.pagina(2), null);
  assert.ok(await bron.pagina(3));
});

test('another page count than the app has: no worker text for this document', async () => {
  const w = nepWorker({ paginaAantal: 5 });
  const { r, meldingen } = route(w);
  const bron = r.bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 4 });
  assert.equal(await bron.pagina(1), null);
  assert.equal(await bron.pagina(2), null);
  assert.ok(bron.kapot);
  // Een gewijzigd bestand is geen storing: geen waarschuwing, de route blijft aan.
  assert.deepEqual(meldingen, []);
  assert.ok(r.bruikbaar());
});

test('a real failure warns once and falls back; an unknown command switches the route off', async () => {
  const kapot = nepWorker({ paginaAantal: 3, fout: 'PDF_TEXT_FAILED: boom' });
  const { r, meldingen } = route(kapot);
  assert.equal(await r.bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 3 }).pagina(1), null);
  assert.equal(await r.bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 3 }).pagina(1), null);
  assert.equal(meldingen.length, 1);
  assert.ok(r.bruikbaar());

  const oud = nepWorker({ paginaAantal: 3, fout: 'PDF_TEXT_UNSUPPORTED' });
  const r2 = route(oud).r;
  assert.equal(await r2.bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 3 }).pagina(1), null);
  assert.equal(r2.bruikbaar(), false);
  assert.equal(r2.bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 3 }), null);
});

test('no source without a desktop, a file path or known bytes', () => {
  const w = nepWorker({ paginaAantal: 1 });
  assert.equal(maakRustZoektekst({ inTauri: () => false, call: w.call }).bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 1 }), null);
  assert.equal(maakRustZoektekst({ inTauri: () => true, mobile: () => true, call: w.call }).bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 1 }), null);
  const { r } = route(w);
  assert.equal(r.bron({ path: 'relatief.pdf', expectLen: 1, paginaAantal: 1 }), null);
  assert.equal(r.bron({ path: '/x.pdf', expectLen: 0, paginaAantal: 1 }), null);
  globalThis.__opdsRustZoeken = false;
  try {
    assert.equal(r.bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 1 }), null);
  } finally {
    delete globalThis.__opdsRustZoeken;
  }
});

test('closing stops the lanes and later pages fall back', async () => {
  const w = nepWorker({ paginaAantal: 200 });
  const bron = route(w).r.bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 200, banen: 2 });
  assert.ok(await bron.pagina(1));
  bron.sluit();
  const voor = w.aanroepen.length;
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(w.aanroepen.length <= voor + 2, 'hooguit de aanvragen die al onderweg waren');
  assert.equal(await bron.pagina(150), null);
});

test('the lanes do not run more than VOORUIT pages ahead of the search', async () => {
  const w = nepWorker({ paginaAantal: 1000 });
  const bron = route(w).r.bron({ path: '/x.pdf', expectLen: 1, paginaAantal: 1000, banen: 2 });
  await bron.pagina(1);
  await new Promise((r) => setTimeout(r, 50));
  const gelezen = w.aanroepen.slice(1).reduce((t, a) => t + a.count, 0);
  assert.ok(gelezen <= 4 * STUK + 2 * STUK, `gelezen ${gelezen}`);
  // Het zoeken springt vooruit: het stuk met die pagina komt toch.
  assert.equal((await bron.pagina(900))?.text, 'pagina 900tweede');
  bron.sluit();
});
