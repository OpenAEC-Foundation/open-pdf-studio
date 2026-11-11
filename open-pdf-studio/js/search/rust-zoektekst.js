// Zoektekst uit de PDFium-worker (desktop).
//
// Het zoeken (zoekbalk, zoeken in documenten en mappen, MCP) haalt de tekst
// van een pagina voorheen altijd met pdf.js `getTextContent()` op. Op de
// desktop leest de PDFium-worker de pagina's nu zelf (Tauri-commando
// extract_search_text, pdfium-worker/src/page_text/) en geeft hij de
// tekstitems die pdf.js zou maken: dezelfde tekst, dezelfde spaties en
// itemgrenzen, en per teken zijn plek op de basislijn, zodat de markering
// precies op de tekens valt in plaats van op een geschatte breedte.
// Het zoeken zelf (hoofdletters, hele woorden, de reguliere expressie) blijft
// in JavaScript (find-controller.js), net als de nog niet opgeslagen
// OCR-woorden (ocr-laag.js) en de tekst van annotaties.
//
// JavaScript (pdf.js) blijft de terugval: in de webversie en op Android/iOS,
// voor documenten zonder bestand op schijf of waarvan het bestand op schijf
// niet meer is wat de app heeft (andere lengte of ander aantal pagina's),
// voor pagina's met verticaal schrift of schrift van rechts naar links (daar
// wijkt PDFium af, zie docs/rust-stappen.md), als de worker het commando niet
// kent en bij elke fout (één waarschuwing in de console, dan pdf.js).
// OPDS_RUST_SEARCH=0 in de omgeving van de app, of
// `window.__opdsRustZoeken = false` in de ontwikkelconsole, dwingt pdf.js af.
//
// Puur, op de afhankelijkheden van maakRustZoektekst() na, zodat het onder
// node getest kan worden (rust-zoektekst.test.mjs).

export const MAGIC = 'OPT1';
export const VLAG_VERTICAAL = 1;
export const VLAG_RTL = 2;
const ITEM_EOL = 1;
const ITEM_RTL = 2;
/** Pagina's per aanvraag na de eerste (de worker stopt ook na ~150 ms). */
export const STUK = 32;
/** Workers die tegelijk een document lezen (de pool heeft er vier; de rest
 * blijft vrij voor het tekenen). */
export const BANEN = 2;
/** Zoveel gelezen pagina's mogen er hooguit klaarliggen vóór het zoeken. */
export const VOORUIT = 4 * STUK;

const utf16 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : null;
const utf8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

/**
 * Decodeer een `OPT1`-antwoord (zie pdfium-worker/src/page_text/mod.rs).
 * @returns {{ paginaAantal:number, paginas: Array<{ index:number, view:number[],
 *   vlaggen:number, tekst:string, items: Array<{ str:string, transform:number[],
 *   width:number, height:number, fontName:string, hasEOL:boolean, rtl:boolean,
 *   vakken: Uint16Array }> }> }}
 */
export function decodeerZoektekst(data) {
  const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== MAGIC) throw new Error(`PDF_TEXT_FORMAT: ${magic}`);
  const aantal = dv.getUint32(4, true);
  const paginaAantal = dv.getUint32(8, true);
  let o = 16;
  const paginas = [];
  for (let p = 0; p < aantal; p++) {
    const index = dv.getUint32(o, true);
    const view = [dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true), dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true)];
    const nItems = dv.getUint32(o + 20, true);
    const nUnits = dv.getUint32(o + 24, true);
    const nFonts = dv.getUint32(o + 28, true);
    const vlaggen = dv.getUint32(o + 32, true);
    o += 36;
    const fonts = [];
    for (let f = 0; f < nFonts; f++) {
      const len = dv.getUint32(o, true);
      fonts.push(utf8.decode(new Uint8Array(buf, o + 4, len)));
      o += 4 + len + ((4 - (len % 4)) % 4);
    }
    const itemsAt = o;
    o += nItems * 48;
    const tekst = nUnits ? utf16.decode(new Uint8Array(buf, o, nUnits * 2)) : '';
    o += nUnits * 2 + ((4 - ((nUnits * 2) % 4)) % 4);
    const vakken = new Uint16Array(buf, o, nUnits * 2);
    o += nUnits * 4;
    const items = [];
    for (let i = 0; i < nItems; i++) {
      const a = itemsAt + i * 48;
      const begin = dv.getUint32(a + 32, true);
      const lengte = dv.getUint32(a + 36, true);
      const vlag = dv.getUint32(a + 44, true);
      items.push({
        str: tekst.slice(begin, begin + lengte),
        transform: [0, 4, 8, 12, 16, 20].map((k) => dv.getFloat32(a + k, true)),
        width: dv.getFloat32(a + 24, true),
        height: dv.getFloat32(a + 28, true),
        fontName: fonts[dv.getUint32(a + 40, true)] ?? '',
        hasEOL: !!(vlag & ITEM_EOL),
        rtl: !!(vlag & ITEM_RTL),
        vakken: vakken.subarray(begin * 2, (begin + lengte) * 2),
      });
    }
    paginas.push({ index, view, vlaggen, tekst, items });
  }
  return { paginaAantal, paginas };
}

/**
 * Tekst en items van een pagina zoals extractPageText (find-controller.js)
 * ze uit pdf.js opbouwt: alleen items met tekst, met hun plek in de
 * paginatekst en de index in de volledige itemlijst (zoals de tekstlaag ze
 * nummert). `vakken`: per teken [begin, eind] als deel van de itembreedte
 * × 65535 (match-rect.js matchFractionsUitVakken).
 */
export function paginaDataUitRust(pagina) {
  let text = '';
  const items = [];
  pagina.items.forEach((item, i) => {
    if (!item.str) return;
    items.push({
      str: item.str,
      startPos: text.length,
      endPos: text.length + item.str.length,
      transform: item.transform,
      width: item.width,
      height: item.height,
      fontName: item.fontName,
      fontFamily: '',
      itemIndex: i,
      vakken: item.vakken,
    });
    text += item.str;
  });
  return { text, items };
}

const _absoluut = (p) => typeof p === 'string' && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\'));

/**
 * De worker-route met haar toestand. Na een fout die niet overgaat (uitgezet,
 * een app of worker zonder het commando) blijft hij de rest van de sessie
 * uit; een echte fout komt één keer in de console.
 * @param {{ inTauri:() => boolean, mobile?:() => boolean,
 *   call:(cmd:string, args:object) => Promise<ArrayBuffer|Uint8Array>, warn?:(...a) => void }} deps
 */
export function maakRustZoektekst(deps) {
  const { inTauri, call } = deps;
  const mobile = deps.mobile || (() => false);
  // eslint-disable-next-line no-console
  const warn = deps.warn || ((...a) => console.warn(...a));
  let uit = false;
  let gemeld = false;

  function fout(err) {
    const msg = String((err && err.message) || err);
    if (/PDF_TEXT_(UNSUPPORTED|DISABLED)|not found|unknown command|NIET_IN_BROWSER|not available in the browser/i.test(msg)) uit = true;
    const stil = /PDF_TEXT_DISABLED|PDF_WORKER_UNAVAILABLE|PDF_TEXT_STALE/.test(msg);
    if (!gemeld && !stil) {
      gemeld = true;
      warn('[zoeken] tekst uit de PDFium-worker mislukt, pdf.js leest de tekst:', msg);
    }
  }

  return {
    bruikbaar() {
      return !uit && globalThis.__opdsRustZoeken !== false && !!inTauri() && !mobile();
    },

    /**
     * Een bron voor één document: pagina(n) geeft { text, items } van
     * pagina n (1-gebaseerd), of null (dan leest pdf.js die pagina).
     * De eerste gevraagde pagina (bij de zoekbalk de huidige) komt alleen, voor
     * een snelle eerste treffer; daarna lezen `banen` workers tegelijk het hele
     * document in stukken van STUK pagina's, vooruit op wat het zoeken vraagt
     * (hooguit VOORUIT pagina's die nog niet gevraagd zijn).
     * `paginaAantal`: wat de app van het document weet; wijkt de worker af,
     * dan doet de bron niets meer.
     * @param {{ path:string, expectLen:number, paginaAantal:number, banen?:number }} doc
     */
    bron({ path, expectLen, paginaAantal, banen = BANEN }) {
      const route = this;
      if (!route.bruikbaar() || !_absoluut(path) || !(expectLen > 0)) return null;
      const klaar = new Map(); // pagina-index → decoded pagina
      const wachtrij = []; // [{ first, count }] nog te lezen
      const onderweg = new Set(); // stukken die een baan nu leest
      const luisteraars = new Set(); // wie opnieuw kijkt als er iets verandert
      let dicht = false;
      let kapot = false;
      let gestart = false;
      let eerste = true;
      let positie = 0; // de laatst gevraagde pagina-index
      let gevraagd = null; // de pagina waar het zoeken nu op wacht

      const meld = () => { for (const l of [...luisteraars]) l(); };
      const wacht = () => new Promise((r) => { const l = () => { luisteraars.delete(l); r(); }; luisteraars.add(l); });
      const binnen = (r, i) => i >= r.first && i < r.first + r.count;
      const komtNog = (i) => wachtrij.some((r) => binnen(r, i)) || [...onderweg].some((r) => binnen(r, i));
      // Gelezen pagina's vóór het zoeken uit; pagina's achter de laatst
      // gevraagde tellen niet (die vraagt het zoeken niet meer).
      const voorsprong = () => { let n = 0; for (const i of klaar.keys()) if (i > positie) n++; return n; };

      async function haal(first, count, lane) {
        const data = await call('extract_search_text', { path, first, count, expectLen, lane });
        const { paginaAantal: n, paginas } = decodeerZoektekst(data);
        if (n !== paginaAantal) throw new Error(`PDF_TEXT_STALE: worker sees ${n} pages, the app ${paginaAantal}`);
        if (!dicht) for (const p of paginas) klaar.set(p.index, p);
        return paginas.length ? paginas[paginas.length - 1].index + 1 : first + count;
      }

      async function baan(lane) {
        while (!dicht && !kapot && wachtrij.length) {
          if (gevraagd === null && voorsprong() >= VOORUIT) {
            await wacht();
            continue;
          }
          // Het stuk waar het zoeken op wacht eerst.
          const k = gevraagd === null ? -1 : wachtrij.findIndex((q) => binnen(q, gevraagd));
          const r = wachtrij.splice(Math.max(0, k), 1)[0];
          onderweg.add(r);
          try {
            const volgende = await haal(r.first, r.count, lane);
            // Tijdsbudget van de worker: de rest van dit stuk als eerste opnieuw.
            if (volgende < r.first + r.count) wachtrij.unshift({ first: volgende, count: r.first + r.count - volgende });
          } catch (err) {
            kapot = true;
            fout(err);
          } finally {
            onderweg.delete(r);
            meld();
          }
        }
      }

      function start() {
        gestart = true;
        for (let first = 0; first < paginaAantal; first += STUK) wachtrij.push({ first, count: Math.min(STUK, paginaAantal - first) });
        for (let l = 0; l < Math.max(1, banen); l++) baan(l);
      }

      return {
        async pagina(n) {
          const index = n - 1;
          positie = index;
          meld();
          if (eerste) {
            eerste = false;
            try {
              await haal(index, 1, 0);
            } catch (err) {
              kapot = true;
              fout(err);
            }
          }
          if (!gestart && !kapot && !dicht) start();
          while (!kapot && !dicht && !klaar.has(index) && komtNog(index)) {
            gevraagd = index;
            meld();
            await wacht();
          }
          gevraagd = null;
          const p = klaar.get(index);
          if (!p) return null;
          klaar.delete(index);
          // Ruim op wat ver achter het zoeken ligt.
          for (const i of klaar.keys()) if (i < index - VOORUIT) klaar.delete(i);
          meld();
          return p.vlaggen ? null : paginaDataUitRust(p);
        },
        sluit() {
          dicht = true;
          klaar.clear();
          wachtrij.length = 0;
          meld();
        },
        get kapot() {
          return kapot;
        },
      };
    },
  };
}
