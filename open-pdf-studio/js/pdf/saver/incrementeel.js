// Incrementeel opslaan (#679), achter de voorkeur `incrementalSave` (standaard
// uit). Ontwerp, capaciteitsmatrix en metingen: docs/incrementeel-opslaan.md.
//
// De saver bouwt het document zoals altijd in pdf-lib op. Deze module legt
// vlak na het laden een momentopname van alle objecten vast en vergelijkt die
// vlak voor het schrijven met de context: alleen de gewijzigde en nieuwe
// objecten die vanaf de trailer bereikbaar zijn, gaan als toevoeging achter
// de oorspronkelijke bytes (ISO 32000-1 §7.5.6), met een eigen xref-sectie in
// dezelfde vorm als de laatste van de bron (tabel of stroom) en een trailer
// met /Prev. De bronbytes blijven byte voor byte staan.
//
// Alles wat niet zeker past, weigert met een reden; de saver schrijft dan het
// hele bestand opnieuw, zoals zonder deze voorkeur. Nooit incrementeel:
// versleutelde bestanden, een xref-keten die niet klopt, verwijderde objecten,
// gewijzigde pagina-inhoud, paginaboom, bladwijzers, bijlagen of metadata,
// redactie en het verwijderen van verborgen informatie (#646): wat in een
// eerdere revisie staat, blijft daar terug te halen.
//
// Ondertekend of gecertificeerd: DocMDP P=1 weigert, P=2 staat alleen
// formulierwijzigingen toe, P=3 ook annotaties; een met FieldMDP vergrendeld
// veld, of een handtekening zelf, wordt nooit aangeraakt. Bewaarde bytes
// betekenen niet dat een handtekening na de wijziging nog geldig is.
//
// Puur: alleen pdf-lib, geen app-state; de unit-tests toetsen het los.

import {
  PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFStream, PDFRawStream, PDFString, PDFHexString,
  PDFObjectParser, PDFContext, decodePDFRawStream,
} from 'pdf-lib';

/** Fout met een vaste reden; de saver valt daarop terug op herschrijven. */
export class IncrementeelWeigering extends Error {
  constructor(reden, detail = '') {
    super(detail ? `${reden}: ${detail}` : reden);
    this.name = 'IncrementeelWeigering';
    this.reden = reden;
    this.detail = detail;
  }
}

const weiger = (reden, detail) => { throw new IncrementeelWeigering(reden, detail); };

const N = (s) => PDFName.of(s);
const latin1 = (bytes, van, tot) => {
  let s = '';
  const eind = Math.min(tot, bytes.length);
  for (let i = van; i < eind; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, eind)));
  }
  return s;
};
const isWit = (c) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;

const MAX_SECTIES = 4096;

// ── De xref-keten van de bron lezen ──────────────────────────────────────────

/** Offset van de laatste `startxref`. */
function leesStartxref(bytes) {
  const staart = Math.max(0, bytes.length - 4096);
  const tekst = latin1(bytes, staart, bytes.length);
  const i = tekst.lastIndexOf('startxref');
  if (i < 0) weiger('geen-startxref');
  const m = /^startxref\s+(\d+)/.exec(tekst.slice(i));
  if (!m) weiger('geen-startxref');
  const offset = Number(m[1]);
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= bytes.length) weiger('xref-onjuist', 'startxref buiten het bestand');
  return offset;
}

function parseObject(bytes, offset, context) {
  try {
    return PDFObjectParser.forBytes(bytes.subarray(offset), context).parseObject();
  } catch (e) {
    weiger('xref-onjuist', e?.message || String(e));
  }
}

/** PNG-voorspellers (/Predictor >= 10) van een xref-stroom terugdraaien. */
function zonderVoorspeller(data, parms) {
  const voorspeller = parms instanceof PDFDict ? parms.get(N('Predictor')) : null;
  const p = voorspeller instanceof PDFNumber ? voorspeller.asNumber() : 1;
  if (p <= 1) return data;
  if (p < 10) weiger('xref-onjuist', `TIFF-voorspeller ${p}`);
  const kol = parms.get(N('Columns'));
  const kolommen = kol instanceof PDFNumber ? kol.asNumber() : 1;
  const rij = kolommen + 1;
  if (data.length % rij !== 0) weiger('xref-onjuist', 'voorspellerrijen kloppen niet');
  const uit = new Uint8Array((data.length / rij) * kolommen);
  const vorige = new Uint8Array(kolommen);
  for (let r = 0, o = 0; r < data.length; r += rij, o += kolommen) {
    const soort = data[r];
    for (let k = 0; k < kolommen; k++) {
      const x = data[r + 1 + k];
      const a = k > 0 ? uit[o + k - 1] : 0;
      const b = vorige[k];
      const c = k > 0 ? vorige[k - 1] : 0;
      let v;
      if (soort === 0) v = x;
      else if (soort === 1) v = x + a;
      else if (soort === 2) v = x + b;
      else if (soort === 3) v = x + ((a + b) >> 1);
      else if (soort === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else weiger('xref-onjuist', `onbekend PNG-filter ${soort}`);
      uit[o + k] = v & 0xff;
    }
    vorige.set(uit.subarray(o, o + kolommen));
  }
  return uit;
}

function getal(d, sleutel) {
  const v = d.get(N(sleutel));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

/** Een xref-stroom op `offset`: { dict, regels: [num, {soort, offset|stroom, gen}] }. */
function leesXrefStroom(bytes, offset, context) {
  const kop = /^\s*(\d+)\s+(\d+)\s+obj\b/.exec(latin1(bytes, offset, offset + 64));
  if (!kop) weiger('xref-onjuist', `geen xref op ${offset}`);
  const stroom = parseObject(bytes, offset + kop[0].length, context);
  if (!(stroom instanceof PDFRawStream) || stroom.dict.get(N('Type'))?.toString() !== '/XRef') {
    weiger('xref-onjuist', `object op ${offset} is geen xref-stroom`);
  }
  const d = stroom.dict;
  let data;
  try {
    data = decodePDFRawStream(stroom).decode();
  } catch (e) {
    weiger('xref-onjuist', `xref-stroom niet te decoderen: ${e?.message || e}`);
  }
  data = zonderVoorspeller(data, d.get(N('DecodeParms')));
  const W = d.get(N('W'));
  if (!(W instanceof PDFArray) || W.size() !== 3) weiger('xref-onjuist', 'xref-stroom zonder /W');
  const w = W.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : -1));
  if (w.some((x) => x < 0 || x > 8)) weiger('xref-onjuist', 'ongeldige /W');
  const size = getal(d, 'Size');
  if (size === undefined) weiger('xref-onjuist', 'xref-stroom zonder /Size');
  const Index = d.get(N('Index'));
  const subsecties = [];
  if (Index instanceof PDFArray) {
    const a = Index.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : -1));
    for (let i = 0; i + 1 < a.length; i += 2) subsecties.push([a[i], a[i + 1]]);
  } else subsecties.push([0, size]);
  const breedte = w[0] + w[1] + w[2];
  const lees = (pos, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + data[pos + i]; return v; };
  const regels = [];
  let pos = 0;
  for (const [eerste, aantal] of subsecties) {
    if (eerste < 0 || aantal < 0) weiger('xref-onjuist', 'ongeldige /Index');
    for (let i = 0; i < aantal; i++) {
      if (pos + breedte > data.length) weiger('xref-onjuist', 'xref-stroom te kort');
      const soort = w[0] ? lees(pos, w[0]) : 1;
      const v2 = lees(pos + w[0], w[1]);
      const v3 = lees(pos + w[0] + w[1], w[2]);
      pos += breedte;
      if (soort === 1) regels.push([eerste + i, { soort: 1, offset: v2, gen: v3 }]);
      else if (soort === 2) regels.push([eerste + i, { soort: 2, stroom: v2, index: v3, gen: 0 }]);
      else regels.push([eerste + i, { soort: 0 }]);
    }
  }
  return { dict: d, regels, nummer: Number(kop[1]) };
}

/** Een klassieke xref-tabel op `offset` met zijn trailer. */
function leesXrefTabel(bytes, offset, context) {
  // Tot aan 'trailer'. Ruim genoeg venster: 20 bytes per regel.
  let eind = offset;
  const regels = [];
  const tekstStart = latin1(bytes, offset, Math.min(bytes.length, offset + 32));
  if (!/^\s*xref/.test(tekstStart)) weiger('xref-onjuist', `geen xref op ${offset}`);
  // Zoek 'trailer' na offset.
  const zoek = (van) => {
    const stap = 1 << 20;
    for (let i = van; i < bytes.length; i += stap - 16) {
      const t = latin1(bytes, i, Math.min(bytes.length, i + stap));
      const j = t.indexOf('trailer');
      if (j >= 0) return i + j;
    }
    return -1;
  };
  eind = zoek(offset);
  if (eind < 0) weiger('xref-onjuist', 'xref-tabel zonder trailer');
  const tabel = latin1(bytes, offset, eind).replace(/^\s*xref/, '');
  const tokens = tabel.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const eerste = Number(tokens[i]);
    const aantal = Number(tokens[i + 1]);
    if (!Number.isSafeInteger(eerste) || !Number.isSafeInteger(aantal) || aantal < 0) weiger('xref-onjuist', 'ongeldige subsectie');
    i += 2;
    for (let k = 0; k < aantal; k++, i += 3) {
      const off = Number(tokens[i]);
      const gen = Number(tokens[i + 1]);
      const vlag = tokens[i + 2];
      if (!Number.isSafeInteger(off) || !Number.isSafeInteger(gen) || (vlag !== 'n' && vlag !== 'f')) {
        weiger('xref-onjuist', 'ongeldige xref-regel');
      }
      regels.push([eerste + k, vlag === 'n' ? { soort: 1, offset: off, gen } : { soort: 0 }]);
    }
  }
  const trailer = parseObject(bytes, eind + 'trailer'.length, context);
  if (!(trailer instanceof PDFDict)) weiger('xref-onjuist', 'trailer is geen woordenboek');
  return { dict: trailer, regels };
}

/**
 * De hele xref-keten van `bytes`, nieuwste sectie eerst. Controleert dat elk
 * object in gebruik (soort 1) begint waar de xref zegt.
 * @returns {{ startxref:number, vorm:'tabel'|'stroom', hybride:boolean,
 *   size:number, root:PDFRef, info:PDFRef|null, id:PDFArray|null,
 *   versleuteld:boolean, secties:number, regels:Map<number,object>, xrefStromen:Set<number> }}
 */
export function leesXrefKeten(bytes, { controleerOffsets = true } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32) weiger('xref-onjuist', 'te kort');
  const context = PDFContext.create();
  const startxref = leesStartxref(bytes);
  const regels = new Map();
  const xrefStromen = new Set();
  const gezien = new Set();
  let offset = startxref;
  let nieuwste = null;
  let vorm = null;
  let hybride = false;
  let secties = 0;
  const neem = (lijst) => { for (const [n, r] of lijst) if (!regels.has(n)) regels.set(n, r); };
  while (offset !== undefined) {
    if (gezien.has(offset)) weiger('xref-onjuist', 'lus in /Prev');
    if (++secties > MAX_SECTIES) weiger('xref-onjuist', 'te veel xref-secties');
    gezien.add(offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) weiger('xref-onjuist', `/Prev ${offset} buiten het bestand`);
    let p = offset;
    while (p < bytes.length && isWit(bytes[p])) p++;
    let sectie;
    if (latin1(bytes, p, p + 4) === 'xref') {
      sectie = leesXrefTabel(bytes, offset, context);
      // Hybride (§7.5.8.4): de tabel gaat voor, daarna de /XRefStm.
      const stm = getal(sectie.dict, 'XRefStm');
      neem(sectie.regels);
      if (stm !== undefined) {
        if (!nieuwste) hybride = true;
        const s = leesXrefStroom(bytes, stm, context);
        xrefStromen.add(s.nummer);
        neem(s.regels);
      }
      if (!vorm) vorm = 'tabel';
    } else {
      sectie = leesXrefStroom(bytes, offset, context);
      xrefStromen.add(sectie.nummer);
      neem(sectie.regels);
      if (!vorm) vorm = 'stroom';
    }
    if (!nieuwste) nieuwste = sectie.dict;
    offset = getal(sectie.dict, 'Prev');
  }
  const root = nieuwste.get(N('Root'));
  if (!(root instanceof PDFRef)) weiger('xref-onjuist', 'trailer zonder /Root');
  const info = nieuwste.get(N('Info'));
  const id = nieuwste.get(N('ID'));
  const size = getal(nieuwste, 'Size');
  if (size === undefined || size <= 0) weiger('xref-onjuist', 'trailer zonder /Size');

  if (controleerOffsets) {
    for (const [n, r] of regels) {
      if (r.soort !== 1) continue;
      if (n >= size) weiger('xref-onjuist', `object ${n} boven /Size`);
      if (r.offset >= bytes.length) weiger('xref-onjuist', `object ${n} buiten het bestand`);
      const m = /^\s{0,4}(\d+)\s+(\d+)\s+obj\b/.exec(latin1(bytes, r.offset, r.offset + 40));
      if (!m || Number(m[1]) !== n || Number(m[2]) !== r.gen) weiger('xref-onjuist', `object ${n} staat niet op offset ${r.offset}`);
    }
  }

  return {
    startxref, vorm, hybride, size, root,
    info: info instanceof PDFRef ? info : null,
    id: id instanceof PDFArray ? id : null,
    versleuteld: nieuwste.has(N('Encrypt')),
    secties, regels, xrefStromen,
  };
}

// ── Ondertekening en wijzigingsbeperkingen ───────────────────────────────────

const naamVan = (o) => (o instanceof PDFName ? o.decodeText() : null);

function veldNaam(context, dict) {
  const delen = [];
  const gezien = new Set();
  let d = dict;
  while (d instanceof PDFDict && !gezien.has(d)) {
    gezien.add(d);
    const t = d.get(N('T'));
    if (t instanceof PDFString || t instanceof PDFHexString) delen.unshift(t.decodeText());
    d = context.lookup(d.get(N('Parent')));
  }
  return delen.join('.');
}

function namenLijst(context, arr) {
  const a = context.lookup(arr);
  if (!(a instanceof PDFArray)) return [];
  return a.asArray().map((x) => context.lookup(x)).filter((x) => x instanceof PDFString || x instanceof PDFHexString).map((x) => x.decodeText());
}

function vergrendeling(context, lock, uit) {
  const d = context.lookup(lock);
  if (!(d instanceof PDFDict)) return;
  const actie = naamVan(context.lookup(d.get(N('Action'))));
  const velden = namenLijst(context, d.get(N('Fields')));
  if (actie === 'All') uit.alle = true;
  else if (actie === 'Include') velden.forEach((v) => uit.inclusief.add(v));
  else if (actie === 'Exclude') { uit.alleBehalve.push(new Set(velden)); }
}

/**
 * Handtekeningen, certificering (DocMDP) en vergrendelde velden (FieldMDP).
 * @returns {{ ondertekend:boolean, docMdp:number|null, sigFlags:number,
 *   handtekeningen:number, vergrendeld:(naam:string)=>boolean, heeftVergrendeling:boolean }}
 */
export function leesOndertekening(context, catalogus) {
  const uit = { alle: false, inclusief: new Set(), alleBehalve: [] };
  let docMdp = null;
  const perms = context.lookup(catalogus.get(N('Perms')));
  if (perms instanceof PDFDict) {
    const sig = context.lookup(perms.get(N('DocMDP')));
    if (sig instanceof PDFDict) {
      docMdp = 2; // standaard als /P ontbreekt (§12.8.2.2)
      const refs = context.lookup(sig.get(N('Reference')));
      if (refs instanceof PDFArray) {
        for (const r of refs.asArray()) {
          const sr = context.lookup(r);
          if (!(sr instanceof PDFDict)) continue;
          if (naamVan(context.lookup(sr.get(N('TransformMethod')))) !== 'DocMDP') continue;
          const tp = context.lookup(sr.get(N('TransformParams')));
          const p = tp instanceof PDFDict ? context.lookup(tp.get(N('P'))) : null;
          if (p instanceof PDFNumber) docMdp = p.asNumber();
        }
      }
    }
  }
  const acro = context.lookup(catalogus.get(N('AcroForm')));
  const sf = acro instanceof PDFDict ? context.lookup(acro.get(N('SigFlags'))) : null;
  const sigFlags = sf instanceof PDFNumber ? sf.asNumber() : 0;

  let handtekeningen = 0;
  const velden = acro instanceof PDFDict ? context.lookup(acro.get(N('Fields'))) : null;
  const stapel = velden instanceof PDFArray ? velden.asArray().slice() : [];
  const gezien = new Set();
  while (stapel.length) {
    const ref = stapel.pop();
    const d = context.lookup(ref);
    if (!(d instanceof PDFDict) || gezien.has(d)) continue;
    gezien.add(d);
    if (naamVan(context.lookup(d.get(N('FT')))) === 'Sig') {
      const v = context.lookup(d.get(N('V')));
      if (v instanceof PDFDict) {
        handtekeningen++;
        const refs = context.lookup(v.get(N('Reference')));
        if (refs instanceof PDFArray) {
          for (const r of refs.asArray()) {
            const sr = context.lookup(r);
            if (sr instanceof PDFDict && naamVan(context.lookup(sr.get(N('TransformMethod')))) === 'FieldMDP') {
              vergrendeling(context, sr.get(N('TransformParams')), uit);
            }
          }
        }
      }
      if (d.has(N('Lock'))) vergrendeling(context, d.get(N('Lock')), uit);
    }
    const kids = context.lookup(d.get(N('Kids')));
    if (kids instanceof PDFArray) stapel.push(...kids.asArray());
  }
  const heeftVergrendeling = uit.alle || uit.inclusief.size > 0 || uit.alleBehalve.length > 0;
  return {
    ondertekend: handtekeningen > 0 || docMdp !== null || (sigFlags & 1) === 1,
    docMdp, sigFlags, handtekeningen, heeftVergrendeling,
    vergrendeld: (naam) => uit.alle || uit.inclusief.has(naam) || uit.alleBehalve.some((s) => !s.has(naam)),
  };
}

// ── Momentopname en vergelijking ─────────────────────────────────────────────

function vingerafdruk(obj) {
  if (obj instanceof PDFDict) {
    const t = obj.get(PDFName.of('Type'));
    const soort = t instanceof PDFName ? t.decodeText() : null;
    const sleutels = soort === 'Catalog' || soort === 'Page' || soort === 'Pages'
      ? new Map(obj.entries().map(([k, v]) => [k.decodeText(), v.toString()])) : null;
    return { stroom: false, tekst: obj.toString(), sleutels };
  }
  if (obj instanceof PDFRawStream) return { stroom: true, dict: obj.dict.toString(), inhoud: obj.contents, lengte: obj.contents.length };
  if (obj instanceof PDFStream) return { stroom: true, dict: null, inhoud: null, lengte: -1 };
  return { stroom: false, tekst: obj.toString() };
}

function gewijzigd(oud, obj) {
  if (oud.obj !== obj) return true; // vervangen (context.assign)
  if (oud.stroom) {
    if (!(obj instanceof PDFRawStream) || oud.dict === null) return true;
    return obj.contents !== oud.inhoud || obj.contents.length !== oud.lengte || obj.dict.toString() !== oud.dict;
  }
  return obj.toString() !== oud.tekst;
}

/**
 * Vlak na PDFDocument.load(bytes, { updateMetadata: false }): de xref-keten
 * lezen, alle objecten vastleggen, nieuwe nummers boven /Size laten beginnen
 * en daarna pas de documentgegevens bijwerken zoals pdf-lib dat bij het laden
 * doet (dan valt /Info onder de wijzigingen).
 *
 * Weigert nooit met een uitzondering: een plan met `weigering` laat de saver
 * gewoon herschrijven. `vereistVolledig` is een reden van de aanroeper
 * (redactie, sanitiseren) om het hoe dan ook niet incrementeel te doen.
 */
export function bereidIncrementeelVoor(bytes, pdfDocLib, { vereistVolledig = null } = {}) {
  const plan = { bron: bytes, weigering: null, keten: null, momentopname: null, ondertekening: null };
  try {
    if (vereistVolledig) weiger('volledig-vereist', vereistVolledig);
    const keten = leesXrefKeten(bytes);
    if (keten.versleuteld) weiger('versleuteld');
    const ctx = pdfDocLib.context;
    if (!ctx.trailerInfo.Root || ctx.trailerInfo.Root.toString() !== keten.root.toString()) weiger('root-verschilt');
    if (keten.info && (!(ctx.trailerInfo.Info instanceof PDFRef) || ctx.trailerInfo.Info.toString() !== keten.info.toString())) weiger('info-verschilt');
    // Wat pdf-lib zag, moet ook in de xref staan (en andersom niet per se:
    // vrijgegeven objecten). Een object dat pdf-lib kent maar de xref niet,
    // of dat in de xref een xref-/objectstroom is, mag hier niet onder een
    // ander nummer verder.
    const momentopname = new Map();
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      const r = keten.regels.get(ref.objectNumber);
      if (!r || r.soort === 0) continue; // niet in de xref: geldt niet als origineel
      momentopname.set(ref.tag, { ref, obj, ...vingerafdruk(obj) });
    }
    // Nieuwe objecten beginnen boven alles wat de keten noemt, ook boven
    // objectstromen en xref-stromen die pdf-lib niet als object bewaart.
    let hoogste = keten.size - 1;
    for (const n of keten.regels.keys()) if (n > hoogste) hoogste = n;
    if (ctx.largestObjectNumber < hoogste) ctx.largestObjectNumber = hoogste;
    plan.keten = keten;
    plan.momentopname = momentopname;
    plan.ondertekening = leesOndertekening(ctx, pdfDocLib.catalog);
    if (plan.ondertekening.docMdp === 1) weiger('docmdp-geen-wijzigingen');
  } catch (e) {
    if (!(e instanceof IncrementeelWeigering)) throw e;
    plan.weigering = e;
  } finally {
    // Zoals PDFDocument.load met updateMetadata (de standaard) het doet.
    if (typeof pdfDocLib.updateInfoDict === 'function') pdfDocLib.updateInfoDict();
  }
  return plan;
}

// ── Zones: waar hangt een object onder? ──────────────────────────────────────
//
// Een gewijzigd bestaand object mag alleen mee als het uitsluitend onder
// annotaties, het formulier, de annotatielagen of /Info hangt. Pagina's en
// de catalogus worden per sleutel beoordeeld. Wat ook onder pagina-inhoud,
// bladwijzers, namen of structuur hangt, weigert.

const ZONE_TOEGESTAAN = new Set(['annotatie', 'formulier', 'lagen', 'info']);
const CATALOGUS_SLEUTELS = new Set(['AcroForm', 'OCProperties']);
const PAGINA_SLEUTELS = new Set(['Annots']);
const ANNOT_SUBTYPES = new Set([
  'Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline',
  'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'FileAttachment', 'Sound', 'Movie', 'Widget',
  'Screen', 'PrinterMark', 'TrapNet', 'Watermark', '3D', 'Redact', 'Projection', 'RichMedia',
]);

const dictVan = (o) => (o instanceof PDFStream ? o.dict : o instanceof PDFDict ? o : null);
const typeVan = (d) => naamVan(d?.get(N('Type')));

function isPaginaKnoop(d) {
  const t = typeVan(d);
  return t === 'Page' || t === 'Pages';
}
export function isAnnotatie(d) {
  if (!(d instanceof PDFDict)) return false;
  if (typeVan(d) === 'Annot') return true;
  const s = naamVan(d.get(N('Subtype')));
  return !!s && ANNOT_SUBTYPES.has(s) && d.has(N('Rect'));
}
function isHandtekening(d) {
  if (!(d instanceof PDFDict)) return false;
  const t = typeVan(d);
  return t === 'Sig' || t === 'DocTimeStamp' || d.has(N('ByteRange'));
}

/**
 * Loop vanaf de trailer door het document en noteer per indirect object in
 * welke zones het hangt. Pagina's en de paginaboom krijgen alleen de zone
 * 'paginaboom' (via /Pages en /Kids); een verwijzing naar een pagina van
 * elders (/Dest, /P van een annotatie) loopt de pagina niet opnieuw in.
 * @returns {Map<string, Set<string>>} tag -> zones
 */
const ZONES = ['catalogus', 'info', 'paginaboom', 'inhoud', 'annotatie', 'formulier', 'lagen', 'overig'];
const Z = Object.fromEntries(ZONES.map((z, i) => [z, 1 << i]));

function zones(context) {
  const masker = new Map(); // tag -> bitmasker van zones
  const t = context.trailerInfo;
  const stapel = [];
  if (t.Root) stapel.push(t.Root, Z.catalogus);
  if (t.Info) stapel.push(t.Info, Z.info);
  const direct = new Map(); // direct object -> bitmasker
  while (stapel.length) {
    const zone = stapel.pop();
    const waarde = stapel.pop();
    let o = waarde;
    if (o instanceof PDFRef) {
      o = context.lookup(waarde);
      if (o === undefined) continue;
      if (zone !== Z.paginaboom && isPaginaKnoop(dictVan(o))) continue;
      const m = masker.get(waarde.tag) || 0;
      if (m & zone) continue;
      masker.set(waarde.tag, m | zone);
    } else {
      if (!(o instanceof PDFDict) && !(o instanceof PDFArray) && !(o instanceof PDFStream)) continue;
      const m = direct.get(o) || 0;
      if (m & zone) continue;
      direct.set(o, m | zone);
    }
    const d = dictVan(o);
    if (d) {
      const soort = zone === Z.paginaboom ? typeVan(d) : null;
      const annot = zone !== Z.catalogus && zone !== Z.paginaboom && isAnnotatie(d);
      const widget = annot && naamVan(d.get(N('Subtype'))) === 'Widget';
      for (const [k, v] of d.entries()) {
        if (!(v instanceof PDFRef) && !(v instanceof PDFDict) && !(v instanceof PDFArray)) continue;
        const sleutel = k.decodeText();
        let z = zone;
        if (zone === Z.catalogus) {
          z = sleutel === 'Pages' ? Z.paginaboom : sleutel === 'AcroForm' ? Z.formulier
            : sleutel === 'OCProperties' ? Z.lagen : Z.overig;
        } else if (zone === Z.paginaboom) {
          if (sleutel === 'Parent') z = 0;
          else if (soort === 'Page') z = sleutel === 'Annots' ? Z.annotatie : Z.inhoud;
          else if (soort === 'Pages') z = sleutel === 'Kids' ? Z.paginaboom : Z.inhoud;
          else z = Z.inhoud;
        } else if (annot && sleutel === 'P') {
          z = 0;
        } else if (widget && sleutel === 'Parent') {
          z = Z.formulier;
        }
        if (z) stapel.push(v, z);
      }
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) if (v instanceof PDFRef || v instanceof PDFDict || v instanceof PDFArray) stapel.push(v, zone);
    }
  }
  const kaart = new Map();
  for (const [tag, m] of masker) kaart.set(tag, new Set(ZONES.filter((z) => m & Z[z])));
  return kaart;
}

function verschilSleutels(oud, nieuw) {
  if (!oud.sleutels || !(nieuw instanceof PDFDict)) return ['?'];
  const verschil = [];
  const nieuwe = new Map(nieuw.entries().map(([k, v]) => [k.decodeText(), v.toString()]));
  for (const k of new Set([...oud.sleutels.keys(), ...nieuwe.keys()])) {
    if (oud.sleutels.get(k) !== nieuwe.get(k)) verschil.push(k);
  }
  return verschil;
}

// ── De toevoeging schrijven ──────────────────────────────────────────────────

const enc = new TextEncoder();

function aaneengesloten(regels) {
  const groepen = [];
  let groep = [];
  for (const r of regels) {
    if (groep.length && r[0] !== groep[groep.length - 1][0] + 1) { groepen.push(groep); groep = []; }
    groep.push(r);
  }
  if (groep.length) groepen.push(groep);
  return groepen;
}

function trailerTekst(keten, size, extra = '') {
  let s = `/Size ${size} /Root ${keten.root.toString()}`;
  if (keten.infoNieuw) s += ` /Info ${keten.infoNieuw.toString()}`;
  if (keten.id) s += ` /ID ${keten.id.toString()}`;
  s += ` /Prev ${keten.startxref}`;
  return s + extra;
}

/**
 * Bron + toevoeging. `objecten`: [[PDFRef, PDFObject]], gesorteerd of niet.
 * @returns {Uint8Array}
 */
export function schrijfToevoeging(bron, keten, objecten) {
  const delen = [bron];
  let lengte = bron.length;
  const voeg = (b) => { delen.push(b); lengte += b.length; };
  const last = bron[bron.length - 1];
  if (last !== 0x0a && last !== 0x0d) voeg(enc.encode('\n'));
  const lijst = objecten.slice().sort((a, b) => a[0].objectNumber - b[0].objectNumber);
  const regels = [];
  for (const [ref, obj] of lijst) {
    regels.push([ref.objectNumber, ref.generationNumber, lengte]);
    voeg(enc.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    const buf = new Uint8Array(obj.sizeInBytes());
    const n = obj.copyBytesInto(buf, 0);
    voeg(n === buf.length ? buf : buf.subarray(0, n));
    voeg(enc.encode('\nendobj\n'));
  }
  const hoogste = lijst.reduce((m, [r]) => Math.max(m, r.objectNumber), 0);
  const xrefStart = lengte;
  if (keten.vorm === 'stroom') {
    const nummer = Math.max(keten.size, hoogste + 1);
    regels.push([nummer, 0, xrefStart]);
    const groepen = aaneengesloten(regels);
    const ow = Math.max(4, Math.ceil(Math.log2(xrefStart + 2) / 8));
    const data = new Uint8Array(regels.length * (1 + ow + 2));
    let p = 0;
    for (const [, gen, off] of regels) {
      data[p++] = 1;
      for (let i = ow - 1; i >= 0; i--) data[p++] = Math.floor(off / 2 ** (8 * i)) & 0xff;
      data[p++] = (gen >> 8) & 0xff;
      data[p++] = gen & 0xff;
    }
    const index = groepen.map((g) => `${g[0][0]} ${g.length}`).join(' ');
    const dict = `<< /Type /XRef ${trailerTekst(keten, nummer + 1)} /W [1 ${ow} 2] /Index [${index}] /Length ${data.length} >>`;
    voeg(enc.encode(`${nummer} 0 obj\n${dict}\nstream\n`));
    voeg(data);
    voeg(enc.encode('\nendstream\nendobj\n'));
  } else {
    const size = Math.max(keten.size, hoogste + 1);
    let s = 'xref\n';
    for (const groep of aaneengesloten(regels)) {
      s += `${groep[0][0]} ${groep.length}\n`;
      for (const [, gen, off] of groep) s += `${String(off).padStart(10, '0')} ${String(gen).padStart(5, '0')} n\r\n`;
    }
    s += `trailer\n<< ${trailerTekst(keten, size)} >>\n`;
    voeg(enc.encode(s));
  }
  voeg(enc.encode(`startxref\n${xrefStart}\n%%EOF\n`));
  const uit = new Uint8Array(lengte);
  let o = 0;
  for (const d of delen) { uit.set(d, o); o += d.length; }
  return uit;
}

/**
 * Welke objecten de toevoeging moet bevatten, of een weigering.
 * @returns {{ objecten: Array<[PDFRef, any]>, nieuw:number, gewijzigd:number }}
 */
export function kiesObjecten(plan, pdfDocLib) {
  const ctx = pdfDocLib.context;
  const { momentopname, keten, ondertekening } = plan;
  // Verwijderd: een functie wilde iets uit het bestand halen. Incrementeel
  // blijft het in de vorige revisie staan; dus herschrijven.
  for (const [tag, oud] of momentopname) {
    if (!ctx.lookup(oud.ref)) weiger('verwijderd-object', tag);
  }
  if (!ctx.trailerInfo.Root || ctx.trailerInfo.Root.toString() !== keten.root.toString()) weiger('root-verschilt');
  if (ctx.trailerInfo.Encrypt) weiger('versleuteld');
  const zoneKaart = zones(ctx);
  const uit = [];
  let nieuw = 0;
  let gewijzigdAantal = 0;
  const annotatiesErbij = [];
  for (const [tag, zs] of zoneKaart) {
    const [n, g] = tag.split(' ').map(Number);
    const ref = PDFRef.of(n, g);
    const obj = ctx.lookup(ref);
    if (obj === undefined) continue; // verwijzing naar niets: laten zoals het was
    const oud = momentopname.get(tag);
    if (oud) {
      if (!gewijzigd(oud, obj)) continue;
      gewijzigdAantal++;
      const d = dictVan(obj);
      if (isHandtekening(d) || naamVan(d?.get(N('FT'))) === 'Sig') weiger('handtekening-gewijzigd', tag);
      if (ref.toString() === keten.root.toString()) {
        const fout = verschilSleutels(oud, obj).filter((k) => !CATALOGUS_SLEUTELS.has(k));
        if (fout.length) weiger('catalogus-gewijzigd', fout.join(','));
      } else if (typeVan(d) === 'Page') {
        if (ondertekening?.docMdp === 2) weiger('docmdp-alleen-formulier', `pagina ${tag}`);
        const fout = verschilSleutels(oud, obj).filter((k) => !PAGINA_SLEUTELS.has(k));
        if (fout.length) weiger('pagina-gewijzigd', fout.join(','));
      } else if (typeVan(d) === 'Pages') {
        weiger('paginaboom-gewijzigd', tag);
      } else {
        const fout = [...zs].filter((z) => !ZONE_TOEGESTAAN.has(z));
        if (fout.length) weiger('inhoud-gewijzigd', `${tag} (${fout.join(',')})`);
        if (naamVan(d?.get(N('Type'))) === 'Font') weiger('inhoud-gewijzigd', `${tag} (lettertype)`);
      }
    } else {
      if (n < keten.size || keten.regels.has(n)) weiger('nummer-botsing', tag);
      nieuw++;
    }
    const d = dictVan(obj);
    if (isAnnotatie(d)) annotatiesErbij.push({ d, nieuw: !oud });
    if (ondertekening?.heeftVergrendeling && (d?.has(N('FT')) || d?.has(N('T')) || naamVan(d?.get(N('Subtype'))) === 'Widget')) {
      const naam = veldNaam(ctx, d);
      if (naam && ondertekening.vergrendeld(naam)) weiger('fieldmdp-vergrendeld', naam);
    }
    uit.push([ref, obj]);
  }
  if (ondertekening?.docMdp === 2) {
    const markering = annotatiesErbij.find(({ d }) => naamVan(d.get(N('Subtype'))) !== 'Widget');
    if (markering) weiger('docmdp-alleen-formulier');
    if (uit.some(([ref]) => (zoneKaart.get(ref.tag) || new Set()).has('lagen'))) weiger('docmdp-alleen-formulier');
  }
  return { objecten: uit, nieuw, gewijzigd: gewijzigdAantal };
}

/** Begint `uit` met precies `bron`? Per 4 bytes waar dat kan. */
export function zelfdeVoorvoegsel(bron, uit) {
  if (uit.length < bron.length) return false;
  let i = 0;
  if (bron.byteOffset % 4 === 0 && uit.byteOffset % 4 === 0) {
    const n = bron.length >>> 2;
    const a = new Uint32Array(bron.buffer, bron.byteOffset, n);
    const b = new Uint32Array(uit.buffer, uit.byteOffset, n);
    for (; i < n; i++) if (a[i] !== b[i]) return false;
    i = n << 2;
  }
  for (; i < bron.length; i++) if (bron[i] !== uit[i]) return false;
  return true;
}

/**
 * Controle van de eigen uitkomst vóór het wegschrijven: het voorvoegsel is
 * de bron, de nieuwe sectie verwijst met /Prev naar de vorige en elk object
 * staat waar de nieuwe xref zegt.
 */
export function controleerToevoeging(bron, uit, oud = leesXrefKeten(bron, { controleerOffsets: false })) {
  if (uit.length <= bron.length) weiger('zelfcontrole', 'niets toegevoegd');
  if (!zelfdeVoorvoegsel(bron, uit)) weiger('zelfcontrole', 'bronbytes gewijzigd');
  const nieuw = leesXrefKeten(uit, { controleerOffsets: false });
  if (nieuw.startxref <= bron.length - 1) weiger('zelfcontrole', 'startxref niet in de toevoeging');
  if (nieuw.secties !== oud.secties + 1) weiger('zelfcontrole', 'keten niet één sectie langer');
  if (nieuw.size < oud.size) weiger('zelfcontrole', '/Size gekrompen');
  if (nieuw.root.toString() !== oud.root.toString()) weiger('zelfcontrole', '/Root verschilt');
  for (const [n, r] of nieuw.regels) {
    if (r.soort !== 1 || r.offset < bron.length) continue;
    const m = /^(\d+)\s+(\d+)\s+obj\b/.exec(latin1(uit, r.offset, r.offset + 32));
    if (!m || Number(m[1]) !== n) weiger('zelfcontrole', `object ${n} niet op ${r.offset}`);
  }
  return nieuw;
}

/**
 * De incrementele bytes, of `{ weigering }`. Gooit alleen bij een
 * programmeerfout; elke bekende reden komt terug als weigering.
 * @returns {{ bytes?: Uint8Array, weigering?: IncrementeelWeigering, objecten?: number, nieuw?: number, gewijzigd?: number }}
 */
export function bouwIncrementeleUpdate(plan, pdfDocLib) {
  if (plan.weigering) return { weigering: plan.weigering };
  try {
    const { objecten, nieuw, gewijzigd: gew } = kiesObjecten(plan, pdfDocLib);
    if (!objecten.length) weiger('geen-wijzigingen');
    const info = pdfDocLib.context.trailerInfo.Info;
    const keten = { ...plan.keten, infoNieuw: info instanceof PDFRef ? info : plan.keten.info };
    const bytes = schrijfToevoeging(plan.bron, keten, objecten);
    controleerToevoeging(plan.bron, bytes, plan.keten);
    return { bytes, objecten: objecten.length, nieuw, gewijzigd: gew };
  } catch (e) {
    if (e instanceof IncrementeelWeigering) return { weigering: e };
    return { weigering: new IncrementeelWeigering('interne-fout', e?.message || String(e)) };
  }
}

/**
 * Redenen in het model om nooit incrementeel op te slaan, ongeacht wat de
 * vergelijking zegt: verwijderen van gevoelige inhoud hoort te herschrijven.
 * @returns {string|null}
 */
export function vereistVolledigeHerschrijving(doc) {
  if (!doc) return null;
  if (doc.vereistVolledigeHerschrijving) return String(doc.vereistVolledigeHerschrijving);
  if ((doc.annotations || []).some((a) => a?.type === 'redaction' || a?.redacted === true)) return 'redactie';
  const bijlagen = doc.bijlagenWijzigingen;
  if (bijlagen && Array.isArray(bijlagen.verwijderd) && bijlagen.verwijderd.length) return 'bijlage-verwijderd';
  return null;
}

// ── Bladwijzers: niet herschrijven wat niet veranderde ───────────────────────
//
// De saver bouwt de outline bij elke save opnieuw op uit het model
// (saver/bookmarks.js). Voor herschrijven maakt dat niet uit; incrementeel
// zou elke save met bladwijzers op /Outlines in de catalogus stuiten. Is de
// nieuwe outline item voor item gelijk aan de oude (titel, doelpagina en
// -positie, stijl, kleur, open/dicht, volgorde), dan blijft de oude staan.
// Bij het minste verschil, of een doel dat hier niet te vergelijken is
// (benoemde bestemming, ander soort doel), blijft de nieuwe staan en wordt
// er dus volledig herschreven.

function doelVan(ctx, item) {
  let dest = ctx.lookup(item.get(N('Dest')));
  if (!dest) {
    const a = ctx.lookup(item.get(N('A')));
    if (a instanceof PDFDict && naamVan(ctx.lookup(a.get(N('S')))) === 'GoTo') dest = ctx.lookup(a.get(N('D')));
  }
  if (!(dest instanceof PDFArray) || !(dest.get(0) instanceof PDFRef)) return null;
  if (naamVan(dest.get(1)) !== 'XYZ') return null;
  const num = (i) => { const v = ctx.lookup(dest.get(i)); return v instanceof PDFNumber ? v.asNumber() : null; };
  const zoom = num(4);
  return { pagina: dest.get(0).toString(), left: num(2), top: num(3), zoom: zoom === 0 ? null : zoom };
}

function kleurVan(ctx, item) {
  const c = ctx.lookup(item.get(N('C')));
  if (!(c instanceof PDFArray) || c.size() < 3) return [0, 0, 0];
  return [0, 1, 2].map((i) => { const v = ctx.lookup(c.get(i)); return v instanceof PDFNumber ? v.asNumber() : 0; });
}

function tekstVan(ctx, item) {
  const t = ctx.lookup(item.get(N('Title')));
  return t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : null;
}

function kinderenVan(ctx, d, max = 100000) {
  const uit = [];
  const gezien = new Set();
  let ref = d.get(N('First'));
  while (ref instanceof PDFRef && !gezien.has(ref.tag) && uit.length < max) {
    gezien.add(ref.tag);
    const item = ctx.lookup(ref);
    if (!(item instanceof PDFDict)) return null;
    uit.push(item);
    ref = item.get(N('Next'));
  }
  return uit;
}

function itemsGelijk(ctx, a, b, diepte = 0) {
  if (diepte > 64) return false;
  const ka = kinderenVan(ctx, a);
  const kb = kinderenVan(ctx, b);
  if (!ka || !kb || ka.length !== kb.length) return false;
  const teken = (d) => { const c = ctx.lookup(d.get(N('Count'))); return c instanceof PDFNumber ? Math.sign(c.asNumber()) : 0; };
  if (diepte > 0 && ka.length && teken(a) !== teken(b)) return false;
  for (let i = 0; i < ka.length; i++) {
    const x = ka[i]; const y = kb[i];
    if (tekstVan(ctx, x) !== tekstVan(ctx, y)) return false;
    const dx = doelVan(ctx, x); const dy = doelVan(ctx, y);
    if (!dx || !dy || dx.pagina !== dy.pagina || dx.left !== dy.left || dx.top !== dy.top || dx.zoom !== dy.zoom) return false;
    const fx = ctx.lookup(x.get(N('F'))); const fy = ctx.lookup(y.get(N('F')));
    if ((fx instanceof PDFNumber ? fx.asNumber() & 3 : 0) !== (fy instanceof PDFNumber ? fy.asNumber() & 3 : 0)) return false;
    const cx = kleurVan(ctx, x); const cy = kleurVan(ctx, y);
    if (cx.some((v, j) => Math.abs(v - cy[j]) > 1 / 255 + 1e-6)) return false;
    if (!itemsGelijk(ctx, x, y, diepte + 1)) return false;
  }
  return true;
}

/**
 * Na saveBookmarksToOutline: zet de oude /Outlines terug als de nieuwe er
 * inhoudelijk gelijk aan is. Geeft true als er teruggezet is.
 */
export function herstelOngewijzigdeOutline(pdfDocLib, oudeWaarde) {
  const ctx = pdfDocLib.context;
  const catalogus = pdfDocLib.catalog;
  const nieuweWaarde = catalogus.get(N('Outlines'));
  if (!oudeWaarde || !nieuweWaarde) return false;
  if (oudeWaarde === nieuweWaarde) return false;
  const oud = ctx.lookup(oudeWaarde);
  const nieuw = ctx.lookup(nieuweWaarde);
  if (!(oud instanceof PDFDict) || !(nieuw instanceof PDFDict)) return false;
  if (!itemsGelijk(ctx, oud, nieuw)) return false;
  catalogus.set(N('Outlines'), oudeWaarde);
  return true;
}
