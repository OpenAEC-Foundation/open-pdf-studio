// Een nagebootste werkplek van de OpenAEC SuperCloud (#704), voor de
// browsercontroles van de gehoste bundel (gehost-brug-e2e.mjs en
// test-gehost-csp.mjs).
//
// Zoals de host (openaec-bench, frontend/apps/werkplek/src/gast/ouder.ts):
//  - de bundel staat onder een subpad, /werkplek/app/pdf/, op oorsprong A,
//    met op elk bestand de koppen van de host: de CSP met de sandbox en zonder
//    'self' (werkplekCsp), Access-Control-Allow-Origin: *, CORP cross-origin,
//    nosniff en Referrer-Policy no-referrer;
//  - de gastpagina /werkplek/pdf staat op oorsprong B (Referrer-Policy
//    same-origin) en laadt de bundel in
//      <iframe sandbox="allow-scripts allow-downloads allow-modals" credentialless>
//    met #ouder=<B>&app=pdf&bestand=<id>: een opaque origin ("null");
//  - de gastpagina telt alleen berichten van haar eigen iframe met origin
//    "null" en antwoordt met "*" aan dat frame; bytes gaan als overgedragen
//    ArrayBuffer;
//  - de soorten en velden van voerUit: hallo, open, opslaan (met een
//    conflictkopie als `conflict` aan staat), lijst, versies, geopend, melding
//    en ai.vraag (een nepantwoord in OpenAI-chatvorm; een vraag met
//    "tegoed" erin geeft de foutcode geen_tegoed);
//  - open met `versie` (#712, commit 6997255 van de host): die versie,
//    alleen-lezen en zonder slot; geen geheel getal vanaf 1 geeft de code
//    versie_ongeldig, een versie die niet bestaat een gewone fout; daarna
//    weigert opslaan met de code versie_alleen_lezen, tot een open zonder
//    versie.
//  - met ?opslaanals=1 (#726): hallo noemt { soorten: ['opslaan_als'] };
//    lijst kent mappen (soort "map", schrijfbaar) en `map`; opslaan_als
//    { naam, map?, bytes } maakt een nieuw bestand (alleen .pdf), met
//    "naam (2).pdf" en hernoemd: true bij een bestaande naam; een map die
//    niet schrijfbaar is weigert met de code alleen_lezen.
//
// De opslag van de gastpagina zit in de pagina zelf; de server levert alleen
// de begininhoud van de documenten (/werkplek/doc/<id>), zoals de klantsite.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WERKPLEK_SANDBOX, werkplekCsp } from './gehost-html.mjs';

export const APP_PAD = '/werkplek/app/pdf/';
export const BRUG_PAD = '/werkplek/app/brug/';
export const GAST_PAD = '/werkplek/pdf';

const SOORTEN = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.map': 'application/json', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
};

function luister(handler, poort, host) {
  return new Promise((klaar, mis) => {
    const s = http.createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch((e) => { try { res.writeHead(500).end(String(e)); } catch { /* */ } });
    });
    s.once('error', mis);
    s.listen(poort, host, () => klaar(s));
  });
}

function serveerBestand(res, bestand, koppen) {
  res.writeHead(200, { 'Content-Type': SOORTEN[path.extname(bestand).toLowerCase()] || 'application/octet-stream', ...koppen });
  fs.createReadStream(bestand).pipe(res);
}

/**
 * Start de nagebootste werkplek.
 * @param {object} o
 * @param {string} o.bundel        map met de gebouwde bundel (base ./)
 * @param {number} o.poortApp      oorsprong A: http://127.0.0.1:<poortApp>
 * @param {number} o.poortGast     oorsprong B: http://localhost:<poortGast>; C: http://127.0.0.1:<poortGast>
 * @param {{ [id: string]: { naam: string, bytes: Uint8Array, alleenLezen?: boolean } }} o.documenten
 * @param {{ [subpad: string]: string }} [o.extraInBundel] extra mappen onder APP_PAD (bv. een tegenproef)
 */
export async function startWerkplek({ bundel, poortApp, poortGast, documenten, extraInBundel = {} }) {
  const APP = `http://127.0.0.1:${poortApp}`;
  const GAST = `http://localhost:${poortGast}`;
  const DERDE = `http://127.0.0.1:${poortGast}`;
  const bundelUrl = `${APP}${APP_PAD}`;
  const csp = werkplekCsp(bundelUrl, GAST, `${APP}${BRUG_PAD}`);
  const appKoppen = {
    'Content-Security-Policy': csp,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  const verzoeken = { app: [], gast: [] };
  const wortel = path.resolve(bundel);

  // Oorsprong A: alleen de bundel (en wat de test erbij legt), met de koppen van de host.
  async function appServer(req, res) {
    const url = new URL(req.url, APP);
    const pad = decodeURIComponent(url.pathname);
    verzoeken.app.push({ pad, origin: req.headers.origin ?? null, cookie: req.headers.cookie ?? null });
    if (!pad.startsWith(APP_PAD)) return res.writeHead(404, appKoppen).end('niet gevonden');
    let rel = pad.slice(APP_PAD.length) || 'index.html';
    let map = wortel;
    for (const [sub, extra] of Object.entries(extraInBundel)) {
      if (rel.startsWith(sub)) { map = path.resolve(extra); rel = rel.slice(sub.length) || 'index.html'; break; }
    }
    const bestand = path.resolve(map, rel);
    if (!bestand.startsWith(map + path.sep) || !fs.existsSync(bestand) || !fs.statSync(bestand).isFile()) {
      return res.writeHead(404, appKoppen).end('niet gevonden');
    }
    return serveerBestand(res, bestand, appKoppen);
  }

  // Oorsprong B (de klantsite) en C (een derde; zelfde server, andere hostnaam).
  async function gastServer(req, res) {
    const host = req.headers.host || '';
    const url = new URL(req.url, `http://${host}`);
    const p = url.pathname;
    verzoeken.gast.push({ host, pad: p, origin: req.headers.origin ?? null });
    const koppen = { 'Referrer-Policy': 'same-origin' };
    const stuur = (type, tekst) => res.writeHead(200, { 'Content-Type': type, ...koppen }).end(tekst);
    if (p === GAST_PAD) return stuur('text/html; charset=utf-8', GAST_HTML);
    if (p === '/werkplek/gast.js') return stuur('text/javascript; charset=utf-8', gastJs({ APP, DERDE, documenten }));
    if (p === '/ander.html') return stuur('text/html; charset=utf-8', ANDER_HTML);
    if (p === '/kwaad.html') return stuur('text/html; charset=utf-8', KWAAD_HTML);
    if (p.startsWith('/werkplek/doc/')) {
      // Alleen voor de gastpagina zelf (zelfde oorsprong, geen CORS-kop).
      const doc = documenten[decodeURIComponent(p.slice('/werkplek/doc/'.length))];
      if (!doc) return res.writeHead(404, koppen).end();
      return res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', ...koppen }).end(Buffer.from(doc.bytes));
    }
    return res.writeHead(404, koppen).end('niet gevonden');
  }

  const servers = [];
  servers.push(await luister(appServer, poortApp, '127.0.0.1'));
  servers.push(await luister(gastServer, poortGast, '127.0.0.1'));
  // localhost kan in de browser ook ::1 zijn.
  try { servers.push(await luister(gastServer, poortGast, '::1')); } catch { /* geen IPv6 */ }

  /** Het adres van de gastpagina; opties gaan als query mee (zie gastJs). */
  const gastAdres = (opties = {}) => {
    const q = new URLSearchParams(Object.entries(opties).map(([k, v]) => [k, String(v)]));
    return `${GAST}${GAST_PAD}${q.size ? `?${q}` : ''}`;
  };

  return {
    APP, GAST, DERDE, bundelUrl, csp, verzoeken, gastAdres,
    sluit: async () => {
      for (const s of servers) {
        s.closeAllConnections?.();
        await new Promise((r) => s.close(() => r()));
      }
    },
  };
}

// ── De gastpagina ───────────────────────────────────────────────────────────
const GAST_HTML = `<!doctype html><meta charset="utf-8"><title>Werkplek</title>
<style>html,body{margin:0;height:100%}iframe{border:0}#wp-app{width:100%;height:100%}.klein{position:absolute;width:1px;height:1px;left:-10px}</style>
<body><script src="/werkplek/gast.js"></script></body>`;

function gastJs({ APP, DERDE, documenten }) {
  const docs = Object.fromEntries(Object.entries(documenten).map(([id, d]) => [id, { naam: d.naam, alleen_lezen: !!d.alleenLezen }]));
  return `
'use strict';
const zoek = new URLSearchParams(location.search);
const APP = ${JSON.stringify(APP)};
const DERDE = ${JSON.stringify(DERDE)};
const SANDBOX = ${JSON.stringify(WERKPLEK_SANDBOX)};
const OUDER = zoek.get('ouder') || location.origin;   // voor de controle met een verkeerde ouder
const BESTAND = zoek.get('bestand') || 'DOC-1';
const PAGINA = zoek.get('pagina') || 'index.html';   // een andere pagina in de bundel (de tegenproef)
const ZWIJG_MS = Number(zoek.get('zwijg') || 0);       // de gastpagina "laadt later"
const VERVALSERS = zoek.get('vervalsers') === '1';
const CONFLICT = zoek.get('conflict') === '1';         // de tweede opslag geeft een conflict
const OPSLAAN_ALS = zoek.get('opslaanals') === '1';    // de gastpagina kent opslaan_als (#726)
const UITSTEL_MS = VERVALSERS ? 300 : 0;               // eerst de vervalsers, dan wij
// Een sessiecookie van de klantsite: die mag nooit in het iframe of bij een verzoek komen.
document.cookie = 'sessie=geheim; path=/';

const docs = ${JSON.stringify(docs)};
for (const d of Object.values(docs)) { d.versies = []; d.map = 'MAP-ROOT'; }
// Mappen voor opslaan_als (#726): de map van het geopende document is MAP-ROOT.
const mappen = {
  'MAP-PROJECT': { naam: 'Project', ouder: 'MAP-ROOT', schrijfbaar: true },
  'MAP-ARCHIEF': { naam: 'Archief', ouder: 'MAP-ROOT', schrijfbaar: false },
};
let nieuwVolgnummer = 0;
const doel = new Map();                                 // id -> conflictkopie (volgende opslagen)
const versieOpen = new Map();                           // id -> getoonde oudere versie (sessie.ts: versieOpen)
const toegestaan = new Set([BESTAND]);
const gast = window.__gast = {
  log: [], opgeslagen: [], opgeslagenAls: [], geopend: [], meldingen: [], vragen: [], vervalsingen: 0, start: 0, eersteAntwoord: null,
  // Voor de test: de laatste versie van een document als base64, en een overzicht.
  bytes(id) {
    const v = docs[id] && docs[id].versies.at(-1);
    if (!v) return null;
    let s = '';
    for (const b of v.bytes) s += String.fromCharCode(b);
    return btoa(s);
  },
  overzicht() {
    return Object.fromEntries(Object.entries(docs).map(([id, d]) => [id, { naam: d.naam, map: d.map, versies: d.versies.length }]));
  },
};

function maakFrame(src, klasse) {
  const f = document.createElement('iframe');
  if (klasse) f.className = klasse;
  f.src = src;
  document.body.appendChild(f);
  return new Promise((r) => f.addEventListener('load', () => r(f), { once: true }));
}

class MetOverdracht { constructor(waarde, lijst) { this.waarde = waarde; this.lijst = lijst; } }
function fout(tekst, code) { const f = new Error(tekst); if (code) f.code = code; return f; }

(async () => {
  let ander = null;
  let kwaad = null;
  if (VERVALSERS) {
    ander = await maakFrame('/ander.html', 'klein');           // zelfde oorsprong, ander venster
    kwaad = await maakFrame(DERDE + '/kwaad.html', 'klein');   // een derde oorsprong
  }
  const app = document.createElement('iframe');
  app.id = 'wp-app';
  app.name = 'opds-app';
  app.setAttribute('sandbox', SANDBOX);
  app.setAttribute('credentialless', '');
  app.src = APP + '${APP_PAD}' + PAGINA + '#ouder=' + encodeURIComponent(OUDER) + '&app=pdf&bestand=' + encodeURIComponent(BESTAND);
  gast.start = performance.now();
  document.body.appendChild(app);
  const frame = () => app.contentWindow;
  const index = () => {
    for (let i = 0; i < window.frames.length; i++) if (window.frames[i] === frame()) return i;
    return -1;
  };

  function vervals(data) {
    if (!VERVALSERS) return;
    gast.vervalsingen++;
    ander.contentWindow.vervals(index(), data);
    kwaad.contentWindow.postMessage({ vervals: data, frame: index() }, DERDE);
  }

  function antwoord(id, inhoud, overdracht = []) {
    // Een opaque frame heeft geen oorsprong om op te richten: "*", alleen aan dit frame.
    frame()?.postMessage({ werkplek: 1, antwoord: id, ...inhoud }, '*', overdracht);
  }

  function bestandVan(v) {
    const id = v.bestand ?? BESTAND;
    if (!id || !toegestaan.has(id)) throw fout('Dit bestand mag deze pagina niet openen.');
    return id;
  }

  async function voerUit(v) {
    switch (v.soort) {
      case 'hallo': return OPSLAAN_ALS ? { soorten: ['opslaan_als'] } : true;
      case 'open': {
        const id = bestandVan(v);
        const echt = doel.get(id) || id;
        const d = docs[echt];
        if (!d) throw fout('Onbekend bestand.');
        if (v.versie != null) {
          // Zoals ouder.ts: alleen een geheel getal vanaf 1; altijd alleen-lezen, zonder slot.
          if (typeof v.versie !== 'number' || !Number.isInteger(v.versie) || v.versie < 1) {
            throw fout('Ongeldig versienummer.', 'versie_ongeldig');
          }
          const aantal = d.versies.length + 1;
          if (v.versie > aantal) throw fout('Deze versie bestaat niet of je hebt er geen toegang toe.');
          // Versie 1 is de begininhoud van de server, versie k de (k-1)e opslag.
          const bytes = v.versie === 1
            ? await (await fetch('/werkplek/doc/' + encodeURIComponent(echt))).arrayBuffer()
            : d.versies[v.versie - 2].bytes.slice(0).buffer;
          versieOpen.set(id, v.versie);
          return new MetOverdracht({ bestand: id, naam: d.naam, versie: v.versie, alleen_lezen: true, bytes }, [bytes]);
        }
        versieOpen.delete(id);
        // De laatste opgeslagen versie, anders de begininhoud van de server (een
        // conflictkopie heeft daar niets: die bestaat alleen in deze pagina).
        const bytes = d.versies.length
          ? d.versies.at(-1).bytes.slice(0).buffer
          : await (await fetch('/werkplek/doc/' + encodeURIComponent(echt))).arrayBuffer();
        return new MetOverdracht({ bestand: id, naam: d.naam, versie: d.versies.length + 1, alleen_lezen: d.alleen_lezen, bytes }, [bytes]);
      }
      case 'opslaan': {
        const id = bestandVan(v);
        // Zoals sessie.ts (weigerVersie): een getoonde oudere versie slaat niet op.
        if (versieOpen.has(id)) {
          throw fout('Versie ' + versieOpen.get(id) + ' is alleen-lezen geopend; open de huidige versie om op te slaan.', 'versie_alleen_lezen');
        }
        if (!(v.bytes instanceof ArrayBuffer)) throw fout('Geen bestand ontvangen.');
        const bytes = new Uint8Array(v.bytes);
        let echt = doel.get(id) || id;
        const d = docs[echt];
        if (d.alleen_lezen) throw fout('Dit bestand is alleen-lezen geopend; opslaan kan niet.');
        gast.opgeslagen.push({ bestand: id, doel: echt, lengte: bytes.length });
        if (CONFLICT && !doel.has(id) && d.versies.length >= 1) {
          // Iemand anders sloeg intussen op: een kopie, en volgende opslagen gaan daarheen.
          echt = id + '-conflict';
          const naam = d.naam.replace(/\\.pdf$/i, '') + ' (conflict).pdf';
          docs[echt] = { naam, alleen_lezen: false, versies: [] };
          doel.set(id, echt);
          docs[echt].versies.push({ bytes, modified: new Date().toISOString() });
          return { bestand: echt, naam, versie: 1, conflict: true, vergrendeld: false,
            melding: 'Iemand anders sloeg dit bestand intussen op. Jouw versie staat in ' + naam + '.' };
        }
        d.versies.push({ bytes, modified: new Date().toISOString() });
        return { bestand: echt, naam: d.naam, versie: d.versies.length + 1, conflict: false, melding: null, vergrendeld: true };
      }
      case 'lijst': {
        const map = OPSLAAN_ALS ? (v.map ?? 'MAP-ROOT') : null;
        if (map !== null && map !== 'MAP-ROOT' && !mappen[map]) throw fout('Onbekende map.');
        const lijst = Object.entries(docs).filter(([id, d]) => !id.endsWith('-conflict') && (map === null || d.map === map))
          .map(([id, d]) => ({ id, name: d.naam, modified: '2026-10-20 09:00:00' }));
        for (const b of lijst) toegestaan.add(b.id);
        if (map === null) return lijst;
        const submappen = Object.entries(mappen).filter(([, m]) => m.ouder === map)
          .map(([id, m]) => ({ id, naam: m.naam, soort: 'map', schrijfbaar: m.schrijfbaar }));
        return [...submappen, ...lijst];
      }
      case 'opslaan_als': {
        if (!OPSLAAN_ALS) throw fout('Onbekend verzoek: ' + v.soort, 'onbekende_soort');
        if (!(v.bytes instanceof ArrayBuffer)) throw fout('Geen bestand ontvangen.');
        const naam = String(v.naam ?? '');
        if (!/\\.pdf$/i.test(naam) || /[\\u0000-\\u001f\\u007f\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069\\/\\\\]/.test(naam)) {
          throw fout('Deze naam kan niet.', 'ongeldige_naam');
        }
        const map = v.map ?? docs[BESTAND]?.map ?? 'MAP-ROOT';
        if (map !== 'MAP-ROOT' && !mappen[map]) throw fout('Onbekende map.');
        if (mappen[map] && !mappen[map].schrijfbaar) throw fout('Je mag in deze map niet schrijven.', 'alleen_lezen');
        let definitief = naam;
        const bezet = (n) => Object.values(docs).some((d) => d.map === map && d.naam === n);
        for (let i = 2; bezet(definitief); i++) definitief = naam.replace(/\\.pdf$/i, ' (' + i + ').pdf');
        const id = 'NIEUW-' + (++nieuwVolgnummer);
        const bytes = new Uint8Array(v.bytes);
        docs[id] = { naam: definitief, alleen_lezen: false, map, versies: [{ bytes, modified: new Date().toISOString() }] };
        toegestaan.add(id);
        gast.opgeslagenAls.push({ id, naam, map: v.map ?? null, definitief, lengte: bytes.length });
        return { bestand: id, naam: definitief, versie: 1, hernoemd: definitief !== naam };
      }
      case 'versies': {
        const id = bestandVan(v);
        const d = docs[doel.get(id) || id];
        return [{ version: 1, modified: '2026-10-01 08:00:00', author: 'beheer@klant.example' },
          ...d.versies.map((x, i) => ({ version: i + 2, modified: x.modified, author: 'gebruiker@klant.example' }))];
      }
      case 'geopend': {
        gast.geopend.push(bestandVan(v));
        return true;
      }
      case 'melding': {
        gast.meldingen.push({ tekst: String(v.tekst ?? ''), toon: v.toon ?? 'fout' });
        return true;
      }
      case 'ai.vraag': {
        const vraag = v.vraag;
        if (!vraag || typeof vraag !== 'object' || !Array.isArray(vraag.messages)) throw fout('Stuur de vraag als {messages: [...]}.', 'ongeldige_vraag');
        gast.vragen.push(JSON.parse(JSON.stringify(vraag)));
        const laatste = [...vraag.messages].reverse().find((m) => m.role === 'user');
        if (String(laatste?.content ?? '').includes('tegoed')) throw fout('Je AI-tegoed is op.', 'geen_tegoed');
        const n = gast.vragen.length;
        return {
          bericht: { role: 'assistant', content: 'Nep-antwoord ' + n, openaec_denkblokken: [{ type: 'thinking', thinking: 'denk ' + n, signature: 'sig-' + n }] },
          stop: 'stop', vraag_id: 'V-' + n,
        };
      }
      default: throw fout('Onbekend verzoek: ' + v.soort);
    }
  }

  window.addEventListener('message', async (e) => {
    // Zoals ouder.ts: alleen ons eigen iframe, en dat is opaque ("null").
    if (!frame() || e.source !== frame() || e.origin !== 'null') return;
    const v = e.data;
    if (!v || v.werkplek !== 1 || typeof v.soort !== 'string') return;
    const t = Math.round(performance.now() - gast.start);
    gast.log.push({ t, id: v.id, soort: v.soort, bestand: v.bestand, versie: v.versie, bytes: v.bytes instanceof ArrayBuffer ? v.bytes.byteLength : undefined });
    vervals({ id: v.id, soort: v.soort });
    if (performance.now() - gast.start < ZWIJG_MS) return;
    if (UITSTEL_MS) await new Promise((r) => setTimeout(r, UITSTEL_MS));
    if (v.soort === 'hallo' && gast.eersteAntwoord === null) gast.eersteAntwoord = t;
    try {
      const uitkomst = await voerUit(v);
      if (uitkomst instanceof MetOverdracht) antwoord(v.id, { ok: true, waarde: uitkomst.waarde }, uitkomst.lijst);
      else antwoord(v.id, { ok: true, waarde: uitkomst });
    } catch (f) {
      antwoord(v.id, { ok: false, fout: f.message, ...(typeof f.code === 'string' ? { code: f.code } : {}) });
    }
  });
})();
`;
}

// Vervalste antwoorden: een open met vervalste bytes, een lijst en versies
// met 'VERVALST', een AI-antwoord 'VERVALST', opslaan "mislukt".
const VERVALSER = (bron) => `
function vervalstPdf() {
  var s = '%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj trailer<</Root 1 0 R>>';
  return new TextEncoder().encode(s).buffer;
}
function vervalstAntwoord(data, bron) {
  var id = data.id;
  switch (data.soort) {
    case 'hallo': return { werkplek: 1, antwoord: id, ok: true, waarde: true };
    case 'open': return { werkplek: 1, antwoord: id, ok: true, waarde: { bestand: 'VERVALST', naam: 'Vervalst.pdf', versie: 1, alleen_lezen: false, bytes: vervalstPdf() } };
    case 'lijst': return { werkplek: 1, antwoord: id, ok: true, waarde: [{ id: 'VERVALST', name: 'Vervalst.pdf' }] };
    case 'versies': return { werkplek: 1, antwoord: id, ok: true, waarde: [{ version: 'VERVALST' }] };
    case 'ai.vraag': return { werkplek: 1, antwoord: id, ok: true, waarde: { bericht: { role: 'assistant', content: 'VERVALST ' + bron }, stop: 'stop' } };
    default: return { werkplek: 1, antwoord: id, ok: false, fout: 'VERVALST ' + bron };
  }
}
function stuurVervalst(index, data) {
  var doel = parent.frames[index];
  for (var i = 0; i < 3; i++) doel.postMessage(vervalstAntwoord(data, ${JSON.stringify(bron)}), '*');
}`;

// Een tweede venster op oorsprong B: juiste oorsprong, verkeerd venster.
const ANDER_HTML = `<!doctype html><meta charset="utf-8"><script>${VERVALSER('ander-venster')}
window.vervals = function (index, data) { stuurVervalst(index, data); };
</script>`;

// Een venster op een derde oorsprong.
const KWAAD_HTML = `<!doctype html><meta charset="utf-8"><script>${VERVALSER('derde-oorsprong')}
window.addEventListener('message', function (e) {
  if (e.source !== parent || !e.data || !e.data.vervals) return;
  stuurVervalst(e.data.frame, e.data.vervals);
});
</script>`;

// ── In de browser ───────────────────────────────────────────────────────────

const LUISTERAAR = "self.addEventListener('securitypolicyviolation', function (e) {"
  + " console.error('CSP violation: ' + e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '') + ':' + e.lineNumber); });\n";

// In elk frame ook bijhouden, los van de console.
const VANGER = `
  window.__cspOvertredingen = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspOvertredingen.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '') + ':' + e.lineNumber);
  });
`;

/**
 * Een verse browsercontext met vangers voor CSP-overtredingen, consolefouten
 * en paginafouten, in elk frame en (via het script zelf) in elke worker.
 * @param {Set<string>} metSri URL's die index.html met integrity laadt: die
 *   blijven onaangeroerd, anders klopt de hash niet meer.
 */
export async function nieuweContext(browser, appOrigin, metSri, opties = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US', ...opties });
  await ctx.addInitScript(VANGER);
  await ctx.route((url) => url.origin === appOrigin && /\.m?js$/.test(url.pathname) && !metSri.has(url.href), async (route) => {
    const antwoord = await route.fetch();
    await route.fulfill({ response: antwoord, body: LUISTERAAR + await antwoord.text() });
  });
  const page = await ctx.newPage();
  const consolefouten = [];
  const paginafouten = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consolefouten.push(`${m.worker() ? '[worker] ' : ''}${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => paginafouten.push(String(e.message).slice(0, 300)));
  const overtredingen = async () => {
    const uit = [];
    for (const f of page.frames()) uit.push(...await f.evaluate(() => window.__cspOvertredingen || []).catch(() => []));
    return uit;
  };
  return { ctx, page, consolefouten, paginafouten, overtredingen };
}

/** De URL's die index.html met integrity laadt, absoluut. */
export function sriUrls(html, basisUrl) {
  const uit = new Set();
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*\bintegrity=[^>]*>/gi)) {
    const url = /\b(?:src|href)="([^"]+)"/.exec(m[0])?.[1];
    if (url) uit.add(new URL(url, basisUrl).href);
  }
  return uit;
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wacht tot `f` iets waars geeft. */
export async function totDat(f, ms, wat) {
  const eind = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > eind) throw new Error(`Time-out: ${wat}`);
    await wacht(100);
  }
}

/** Het app-iframe van de gastpagina. */
export async function appFrameVan(page) {
  return totDat(() => page.frame({ name: 'opds-app' }), 30_000, 'app-iframe');
}

/** Wacht tot het document in de app op het blad staat. */
export async function wachtOpDocument(frame, naam) {
  await totDat(() => frame.evaluate((n) => {
    const c = document.querySelector('canvas#pdf-canvas') || document.querySelector('#continuous-container canvas');
    return !!c && c.width > 200 && document.body.innerText.includes(n);
  }, naam).catch(() => false), 90_000, `document ${naam} open in de app`);
  await wacht(1000);
}

/** Teken een rechthoek op het blad (het gereedschap in het lint, slepen). */
export async function tekenRechthoek(page, frame, { x = 0.55, y = 0.15 } = {}) {
  await frame.locator('button.tp-btn[title="Rect"]').first().click();
  const canvas = await frame.$('canvas#annotation-canvas') || await frame.$('canvas#pdf-canvas');
  const vak = await canvas.boundingBox();
  // Alleen het zichtbare deel van het blad telt (het canvas kan hoger zijn dan het venster).
  const hoogte = page.viewportSize()?.height ?? 900;
  const boven = Math.max(vak.y, 0);
  const onder = Math.min(vak.y + vak.height, hoogte - 100);
  const x0 = vak.x + vak.width * x;
  const y0 = boven + (onder - boven) * y;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 60, y0 + 40, { steps: 5 });
  await page.mouse.move(x0 + 120, y0 + 80, { steps: 5 });
  await page.mouse.up();
  await wacht(400);
}

/** Het aantal annotaties volgens de statusbalk van de app. */
export async function aantalAnnotaties(frame) {
  const tekst = await frame.evaluate(() => document.querySelector('.status-bar, #status-bar')?.textContent || document.body.innerText);
  return Number(/Annotations:\s*(\d+)/.exec(tekst)?.[1] ?? NaN);
}

/** De tekst van de open meldingsdialoog in de app, of null. */
export async function melding(frame) {
  return frame.evaluate(() => document.querySelector('.message-dialog .message-dialog-body')?.innerText ?? null).catch(() => null);
}

/** Sluit de meldingsdialoog. */
export async function sluitMelding(frame) {
  await frame.locator('.message-dialog .message-dialog-footer button').first().click();
  await totDat(async () => (await melding(frame)) === null, 10_000, 'melding dicht');
}

/** De bytes die de gastpagina als laatste versie van `id` bewaarde. */
export async function bewaardeBytes(page, id) {
  const b64 = await page.evaluate((i) => window.__gast.bytes(i), id);
  return b64 ? Buffer.from(b64, 'base64') : null;
}
