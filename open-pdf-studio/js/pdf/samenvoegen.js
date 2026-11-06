// PDF's samenvoegen met alles wat erbij hoort, niet alleen de kale pagina's.
//
// pdf-lib's copyPages kopieert een pagina met alles waar die naar verwijst,
// maar kent het document eromheen niet: verwijzingen naar een pagina (de /P
// van een annotatie, de bestemming van een koppeling of bladwijzer) worden
// losse kopieën van die pagina buiten de paginaboom, en de formuliervelden,
// bladwijzers, benoemde bestemmingen, lagen en paginalabels van de catalogus
// blijven achter. Hier gebeurt het per bronbestand met één kopieerder, waarin
// elke bronpagina vooraf haar nieuwe nummer krijgt: zo wijst elke verwijzing
// naar een pagina daarna naar de pagina in het resultaat.
//
// Per bron:
//   - pagina's met hun annotaties (appearances, beelden, popups, /IRT),
//     /Rotate, /CropBox en /UserUnit;
//   - formuliervelden in één /AcroForm; een veldnaam die al bestaat krijgt
//     het achtervoegsel van het bronbestand; /DR wordt aangevuld, /DA en /Q
//     van de bron gaan mee naar de velden die ze erfden, /NeedAppearances
//     blijft aan als één bron het vroeg;
//   - bladwijzers onder één bladwijzer met de naam van het bestand;
//   - benoemde bestemmingen (/Names /Dests en de oude /Dests); een naam die
//     al bestaat krijgt een achtervoegsel en de verwijzingen uit die bron
//     gaan mee;
//   - lagen (/OCProperties): de lijst, de zichtbaarheid, de volgorde (als
//     groep met de bestandsnaam), vergrendeling en keuzegroepen; een laag van
//     deze app met hetzelfde id is dezelfde laag;
//   - paginalabels, en bijlagen (/EmbeddedFiles).
//
// Een ondertekend bestand is na samenvoegen niet meer ondertekend: de
// handtekeningwaarde (/V) gaat eraf, het veld en zijn uiterlijk blijven.
// De logische structuur (tags) gaat niet mee: de verwijzingen ernaar
// (/StructParents, /StructParent) vallen weg, zodat ze niet in de structuur
// van het doeldocument terechtkomen.
//
// Alleen pdf-lib: de unit-tests draaien hier onder node op.

import {
  PDFName, PDFArray, PDFDict, PDFRef, PDFString, PDFHexString, PDFNumber, PDFBool,
  PDFObjectCopier, PDFPage, PDFStream,
} from 'pdf-lib';
import { voegLagenSamen } from './cad-import-logica.js';
import { relinkZonesInPages, zoneIdsInPages } from './spatial-zone-relink.js';
import { kortBronIn } from './samenvoegen-deel.js';

const N = (s) => PDFName.of(s);

// ── Kleine hulpjes ─────────────────────────────────────────────────────────

function opgezocht(context, raw) {
  return raw instanceof PDFRef ? context.lookup(raw) : raw;
}

function alsDict(context, raw) {
  const v = opgezocht(context, raw);
  return v instanceof PDFDict ? v : null;
}

function alsArray(context, raw) {
  const v = opgezocht(context, raw);
  return v instanceof PDFArray ? v : null;
}

function tekstVan(raw) {
  if (raw instanceof PDFString || raw instanceof PDFHexString) {
    try { return raw.decodeText(); } catch { return null; }
  }
  return null;
}

/** Een tekst als PDF-string: letterlijk als het kan, anders UTF-16. */
function pdfTekst(s) {
  return /^[\x20-\x7e]*$/.test(s) ? PDFString.of(s.replace(/[\\()]/g, (c) => `\\${c}`)) : PDFHexString.fromText(s);
}

/** Het achtervoegsel van een bronbestand voor een naam die al bestaat. */
export function achtervoegselVoor(bestandsnaam, nummer) {
  const stam = String(bestandsnaam || '').replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return stam || `bron${nummer}`;
}

/** `naam` als hij vrij is, anders `naam_<achtervoegsel>`, `naam_<achtervoegsel>_2`, … */
export function uniekeNaam(naam, bezet, achtervoegsel) {
  if (!bezet.has(naam)) return naam;
  let kandidaat = `${naam}_${achtervoegsel}`;
  for (let n = 2; bezet.has(kandidaat); n += 1) kandidaat = `${naam}_${achtervoegsel}_${n}`;
  return kandidaat;
}

// ── Naambomen en getalbomen ────────────────────────────────────────────────

/** Alle [sleutel, waarde]-paren van een naamboom (/Names en /Kids). */
function leesNaamBoom(context, wortel, uit = [], gezien = new Set()) {
  const knoop = alsDict(context, wortel);
  if (!knoop || gezien.has(knoop)) return uit;
  gezien.add(knoop);
  const names = alsArray(context, knoop.get(N('Names')));
  if (names) for (let i = 0; i + 1 < names.size(); i += 2) uit.push([names.get(i), names.get(i + 1)]);
  const kids = alsArray(context, knoop.get(N('Kids')));
  if (kids) for (const k of kids.asArray()) leesNaamBoom(context, k, uit, gezien);
  return uit;
}

/** Een naamboom met één blad, gesorteerd op sleutel. */
function naamBoom(context, paren) {
  const gesorteerd = [...paren].sort((a, b) => {
    const x = tekstVan(a[0]) ?? '';
    const y = tekstVan(b[0]) ?? '';
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const arr = context.obj([]);
  for (const [k, v] of gesorteerd) { arr.push(k); arr.push(v); }
  return context.obj({ Names: arr });
}

/** Alle [index, waarde]-paren van een getalboom (/Nums en /Kids). */
function leesGetalBoom(context, wortel, uit = [], gezien = new Set()) {
  const knoop = alsDict(context, wortel);
  if (!knoop || gezien.has(knoop)) return uit;
  gezien.add(knoop);
  const nums = alsArray(context, knoop.get(N('Nums')));
  if (nums) {
    for (let i = 0; i + 1 < nums.size(); i += 2) {
      const k = nums.get(i);
      if (k instanceof PDFNumber) uit.push([k.asNumber(), nums.get(i + 1)]);
    }
  }
  const kids = alsArray(context, knoop.get(N('Kids')));
  if (kids) for (const k of kids.asArray()) leesGetalBoom(context, k, uit, gezien);
  return uit.sort((a, b) => a[0] - b[0]);
}

// ── Velden ─────────────────────────────────────────────────────────────────

/** Alle veldknopen van een formulier, met het (geërfde) veldtype. */
function veldKnopen(context, af) {
  const uit = [];
  const gezien = new Set();
  const loop = (raw, ftOuder) => {
    const d = alsDict(context, raw);
    if (!d || gezien.has(d)) return;
    gezien.add(d);
    const ft = d.get(N('FT'))?.toString() || ftOuder;
    uit.push({ dict: d, ft });
    const kids = alsArray(context, d.get(N('Kids')));
    if (kids) for (const k of kids.asArray()) loop(k, ft);
  };
  const fields = alsArray(context, af?.get(N('Fields')));
  if (fields) for (const f of fields.asArray()) loop(f, undefined);
  return uit;
}

/** Handtekeningvelden met een waarde (een gezette handtekening). */
function handtekeningKnopen(doc) {
  const context = doc.context;
  const af = alsDict(context, doc.catalog.get(N('AcroForm')));
  const uit = veldKnopen(context, af).filter((k) => k.ft === '/Sig' && k.dict.get(N('V')) !== undefined);
  // Een handtekeningwidget die niet (meer) in /Fields staat, telt ook.
  for (const pagina of doc.getPages()) {
    const annots = alsArray(context, pagina.node.get(N('Annots')));
    for (const a of annots?.asArray() || []) {
      const d = alsDict(context, a);
      if (d && d.get(N('FT'))?.toString() === '/Sig' && d.get(N('V')) !== undefined && !uit.some((k) => k.dict === d)) {
        uit.push({ dict: d, ft: '/Sig' });
      }
    }
  }
  return uit;
}

/** Hoeveel gezette handtekeningen een document heeft. */
export function telHandtekeningen(doc) {
  try { return handtekeningKnopen(doc).length; } catch { return 0; }
}

// ── Bladwijzers ────────────────────────────────────────────────────────────

function kinderenVan(context, item) {
  const uit = [];
  const gezien = new Set();
  let raw = item.get(N('First'));
  while (raw) {
    const d = alsDict(context, raw);
    if (!d || gezien.has(d)) break;
    gezien.add(d);
    uit.push({ raw, dict: d });
    raw = d.get(N('Next'));
  }
  return uit;
}

/** Zichtbare nakomelingen als het item open is (de /Count van een open item). */
function zichtbaarAlsOpen(context, item, diepte = 0) {
  if (diepte > 64) return 0;
  let n = 0;
  for (const { dict } of kinderenVan(context, item)) {
    n += 1;
    const c = dict.get(N('Count'));
    const open = !(c instanceof PDFNumber) || c.asNumber() > 0;
    if (open) n += zichtbaarAlsOpen(context, dict, diepte + 1);
  }
  return n;
}

/** De pagina-index (0-gebaseerd) waar een bladwijzer naartoe gaat, of -1. */
function paginaVanBladwijzer(doc, item, benoemd) {
  const context = doc.context;
  let dest = item.get(N('Dest'));
  if (dest === undefined) {
    const a = alsDict(context, item.get(N('A')));
    if (a && a.get(N('S'))?.toString() === '/GoTo') dest = a.get(N('D'));
  }
  dest = opgezocht(context, dest);
  const naam = tekstVan(dest) ?? (dest instanceof PDFName ? dest.decodeText() : null);
  if (naam !== null && benoemd.has(naam)) dest = opgezocht(context, benoemd.get(naam));
  const d = alsDict(context, dest);
  if (d) dest = alsArray(context, d.get(N('D')));
  if (!(dest instanceof PDFArray)) return -1;
  const ref = dest.get(0);
  if (!(ref instanceof PDFRef)) return -1;
  return doc.getPages().findIndex((p) => p.ref === ref);
}

/** Zet `itemRef` als kind van `ouder` na `naRef` (null: vooraan). */
function voegKindIn(context, ouder, ouderRef, itemRef, naRef) {
  const item = context.lookup(itemRef);
  item.set(N('Parent'), ouderRef);
  if (naRef) {
    const na = context.lookup(naRef);
    const volgende = na.get(N('Next'));
    na.set(N('Next'), itemRef);
    item.set(N('Prev'), naRef);
    if (volgende) {
      item.set(N('Next'), volgende);
      context.lookup(volgende).set(N('Prev'), itemRef);
    } else {
      item.delete(N('Next'));
      ouder.set(N('Last'), itemRef);
    }
  } else {
    const eerste = ouder.get(N('First'));
    item.delete(N('Prev'));
    if (eerste) {
      item.set(N('Next'), eerste);
      context.lookup(eerste).set(N('Prev'), itemRef);
    } else {
      item.delete(N('Next'));
      ouder.set(N('Last'), itemRef);
    }
    ouder.set(N('First'), itemRef);
  }
}

// ── Paginalabels ───────────────────────────────────────────────────────────

/** Labelreeksen van een document: [{ start, dict }] (dict null = geen label). */
function labelReeksen(doc) {
  const context = doc.context;
  const wortel = doc.catalog.get(N('PageLabels'));
  if (!wortel) return null;
  return leesGetalBoom(context, wortel)
    .map(([start, v]) => ({ start, dict: alsDict(context, v) }))
    .filter((r) => r.dict);
}

/**
 * Het stuk [van, tot) van een document met reeksen, verschoven naar `doelStart`.
 * Een reeks die vóór `van` begint, loopt door met de juiste /St.
 */
function stukReeksen(context, reeksen, van, tot, doelStart) {
  const uit = [];
  if (!reeksen || !reeksen.length) {
    if (tot > van) uit.push({ start: doelStart, dict: context.obj({ S: 'D', St: doelStart + 1 }) });
    return uit;
  }
  // Pagina's vóór de eerste reeks hadden in hun document een leeg label;
  // dat blijft zo (een reeks zonder stijl en voorvoegsel).
  if (reeksen[0].start > van && tot > van) {
    uit.push({ start: doelStart, dict: context.obj({}) });
  }
  for (let i = 0; i < reeksen.length; i++) {
    const r = reeksen[i];
    const eind = i + 1 < reeksen.length ? reeksen[i + 1].start : Infinity;
    const a = Math.max(r.start, van);
    const b = Math.min(eind, tot);
    if (b <= a) continue;
    const dict = r.dict.clone(context);
    const st = dict.get(N('St'));
    const basis = st instanceof PDFNumber ? st.asNumber() : 1;
    if (a > r.start) dict.set(N('St'), context.obj(basis + (a - r.start)));
    uit.push({ start: doelStart + (a - van), dict });
  }
  return uit;
}

// ── Lagen ──────────────────────────────────────────────────────────────────

function ocgNaam(context, ref) {
  return tekstVan(alsDict(context, ref)?.get(N('Name')));
}

function eigenLaagId(context, ref) {
  return tekstVan(alsDict(context, ref)?.get(N('OPS_LayerId')));
}

function lijstIn(context, ouder, sleutel, beginwaarde = []) {
  let arr = alsArray(context, ouder.get(N(sleutel)));
  if (!arr) {
    arr = context.obj([...beginwaarde]);
    ouder.set(N(sleutel), arr);
  }
  return arr;
}

/** Refs uit een (geneste) /Order-array die niet in `houden` staan, eruit. */
function filterVolgorde(context, arr, houden) {
  const uit = [];
  for (const e of arr.asArray()) {
    if (e instanceof PDFRef) {
      if (houden.has(e)) uit.push(e);
      continue;
    }
    const genest = alsArray(context, e);
    if (genest) {
      const sub = filterVolgorde(context, genest, houden);
      if (sub.length && !(sub.length === 1 && !(sub[0] instanceof PDFRef) && !(sub[0] instanceof PDFArray))) {
        uit.push(context.obj(sub));
      }
      continue;
    }
    uit.push(e); // een label (tekst) van een groep
  }
  return uit;
}

// ── Samenvoegen ────────────────────────────────────────────────────────────

/**
 * Voeg de bronnen in `doel` in, vanaf pagina-index `invoegIndex`, in volgorde.
 * De bronnen zelf worden aangepast (handtekeningen, structuurverwijzingen):
 * geef geladen kopieën, nooit een document dat nog ergens anders dient.
 *
 * `zoneIds`: ids van ruimtelijke zones die het documentmodel al gebruikt;
 * een ingevoegde zone met zo'n id (of een id van het doel of van een
 * eerdere bron) krijgt een nieuw id, zodat beide geldig blijven.
 *
 * @param {import('pdf-lib').PDFDocument} doel
 * Een bron met `paginas` (0-based indexen) brengt alleen die pagina's mee,
 * en niets dat naar de andere wijst (samenvoegen-deel.js).
 *
 * @param {{doc: import('pdf-lib').PDFDocument, naam: string, paginas?: number[]}[]} bronnen
 * @param {{invoegIndex: number, positie?: 'start'|'after'|'end', zoneIds?: Iterable<string>}} opties
 * @returns {Promise<{bronnen: object[], paginasIngevoegd: number}>}
 */
export async function voegPdfsSamen(doel, bronnen, { invoegIndex, positie = 'end', zoneIds = [] } = {}) {
  const context = doel.context;
  const catalogus = doel.catalog;
  const oudAantal = doel.getPageCount();
  const bezetteZones = new Set([...zoneIds, ...zoneIdsInPages(context, doel.getPages())]);
  const start0 = Math.max(0, Math.min(Number.isFinite(invoegIndex) ? invoegIndex : oudAantal, oudAantal));

  // Wat het doel al had, vóór er iets bij kwam.
  const doelLabels = labelReeksen(doel);
  const doelBenoemd = new Map();
  const namesDoel = alsDict(context, catalogus.get(N('Names')));
  for (const [k, v] of leesNaamBoom(context, namesDoel?.get(N('Dests')))) {
    const t = tekstVan(k);
    if (t !== null) doelBenoemd.set(t, v);
  }
  const oudeDests = alsDict(context, catalogus.get(N('Dests')));
  const doelOudeNamen = new Set(oudeDests ? oudeDests.keys().map((k) => k.decodeText()) : []);
  const doelOutline = alsDict(context, catalogus.get(N('Outlines')));
  const doelTopItems = doelOutline ? kinderenVan(context, doelOutline).map((k) => k.raw) : [];

  const verslag = { bronnen: [], paginasIngevoegd: 0, bladwijzerGroepen: [] };
  const groepRefs = [];
  const labelStukken = []; // [{ start, reeksen }] van elke bron, in volgorde
  let heeftLabels = !!(doelLabels && doelLabels.length);
  let offset = 0;
  let vorigeGroep = null;

  for (let nummer = 0; nummer < bronnen.length; nummer++) {
    const { doc: bron, naam, paginas: gekozen } = bronnen[nummer];
    const bctx = bron.context;
    const achtervoegsel = achtervoegselVoor(naam, nummer + 1);
    await bron.flush();
    const info = {
      naam, start: start0 + offset, aantal: 0, annotaties: 0, velden: 0, hernoemdeVelden: [],
      bestemmingen: 0, hernoemdeBestemmingen: [], bladwijzers: 0, lagen: 0, handtekeningen: 0,
    };
    // Alleen de gekozen pagina's, en niets dat naar de andere wijst.
    if (Array.isArray(gekozen)) info.weggelaten = kortBronIn(bron, gekozen);

    // Handtekeningen gelden niet meer: de waarde weg, het veld blijft.
    for (const { dict } of handtekeningKnopen(bron)) {
      dict.delete(N('V'));
      info.handtekeningen += 1;
    }
    const bronAf = alsDict(bctx, bron.catalog.get(N('AcroForm')));
    if (bronAf) bronAf.delete(N('SigFlags'));

    // Structuur en artikelen gaan niet mee (zie de kop).
    const bronPaginas = bron.getPages();
    for (const p of bronPaginas) {
      p.node.delete(N('StructParents'));
      p.node.delete(N('B'));
      const annots = alsArray(bctx, p.node.get(N('Annots')));
      for (const a of annots?.asArray() || []) alsDict(bctx, a)?.delete(N('StructParent'));
    }

    const kopie = PDFObjectCopier.for(bctx, context);
    // Elke bronpagina krijgt vooraf haar nummer in het resultaat.
    const nieuweRefs = bronPaginas.map((p) => {
      const ref = context.nextRef();
      kopie.traversedObjects.set(p.ref, ref);
      return ref;
    });
    // De bladwijzerwortel van de bron wordt de bladwijzer van dit bestand.
    const bronOutlineRaw = bron.catalog.get(N('Outlines'));
    const bronOutline = alsDict(bctx, bronOutlineRaw);
    const groepRef = context.nextRef();
    if (bronOutlineRaw instanceof PDFRef) kopie.traversedObjects.set(bronOutlineRaw, groepRef);
    // Een laag van deze app met hetzelfde id is dezelfde laag.
    const doelOc = alsDict(context, catalogus.get(N('OCProperties')));
    const eigenInDoel = new Map();
    const doelEigenLijst = alsArray(context, alsDict(context, catalogus.get(N('OPS_AnnotLayers')))?.get(N('Layers')));
    for (const r of [...(doelEigenLijst?.asArray() || []), ...(alsArray(context, doelOc?.get(N('OCGs')))?.asArray() || [])]) {
      const id = r instanceof PDFRef ? eigenLaagId(context, r) : null;
      if (id && !eigenInDoel.has(id)) eigenInDoel.set(id, r);
    }
    const bronOc = alsDict(bctx, bron.catalog.get(N('OCProperties')));
    const bronEigenLijst = alsArray(bctx, alsDict(bctx, bron.catalog.get(N('OPS_AnnotLayers')))?.get(N('Layers')));
    for (const r of [...(alsArray(bctx, bronOc?.get(N('OCGs')))?.asArray() || []), ...(bronEigenLijst?.asArray() || [])]) {
      const id = r instanceof PDFRef ? eigenLaagId(bctx, r) : null;
      if (id && eigenInDoel.has(id)) kopie.traversedObjects.set(r, eigenInDoel.get(id));
    }

    // Pagina's.
    const nieuwePaginas = [];
    for (let i = 0; i < bronPaginas.length; i++) {
      const knoop = kopie.copy(bronPaginas[i].node);
      context.assign(nieuweRefs[i], knoop);
      const pagina = PDFPage.of(knoop, nieuweRefs[i], doel);
      doel.insertPage(start0 + offset + i, pagina);
      nieuwePaginas.push(pagina);
      const annots = alsArray(context, knoop.get(N('Annots')));
      for (const a of annots?.asArray() || []) {
        const st = alsDict(context, a)?.get(N('Subtype'))?.toString();
        if (st && !['/Popup', '/Link', '/Widget'].includes(st)) info.annotaties += 1;
      }
    }
    info.aantal = bronPaginas.length;
    // Zones van deze bron met een id dat al bestaat: een nieuw id.
    relinkZonesInPages(context, nieuwePaginas, bezetteZones);

    // Formuliervelden.
    if (bronAf) {
      let doelAf = alsDict(context, catalogus.get(N('AcroForm')));
      if (!doelAf) {
        doelAf = context.obj({ Fields: [] });
        catalogus.set(N('AcroForm'), context.register(doelAf));
      }
      const velden = lijstIn(context, doelAf, 'Fields');
      const bezet = new Set(velden.asArray().map((r) => tekstVan(alsDict(context, r)?.get(N('T')))).filter((t) => t !== null));
      const bronDa = bronAf.get(N('DA'));
      const bronQ = bronAf.get(N('Q'));
      const doelDa = tekstVan(doelAf.get(N('DA')));
      const doelQ = doelAf.get(N('Q'))?.toString() ?? '0';
      for (const raw of alsArray(bctx, bronAf.get(N('Fields')))?.asArray() || []) {
        const nieuw = kopie.copy(raw);
        const veld = alsDict(context, nieuw);
        if (!veld) continue;
        const t = tekstVan(veld.get(N('T')));
        if (t !== null) {
          const vrij = uniekeNaam(t, bezet, achtervoegsel);
          if (vrij !== t) {
            veld.set(N('T'), pdfTekst(vrij));
            info.hernoemdeVelden.push({ van: t, naar: vrij });
          }
          bezet.add(vrij);
        }
        // Wat het veld van het formulier van de bron erfde, krijgt het zelf.
        if (veld.get(N('DA')) === undefined && bronDa !== undefined && tekstVan(bronDa) !== doelDa) {
          veld.set(N('DA'), kopie.copy(bronDa));
        }
        if (veld.get(N('Q')) === undefined && bronQ !== undefined && bronQ.toString() !== doelQ) {
          veld.set(N('Q'), kopie.copy(bronQ));
        }
        velden.push(nieuw);
        info.velden += 1;
      }
      // Bronnen van het formulier aanvullen; bij dezelfde sleutel wint het doel.
      const bronDr = alsDict(bctx, bronAf.get(N('DR')));
      if (bronDr) {
        let doelDr = alsDict(context, doelAf.get(N('DR')));
        if (!doelDr) {
          doelDr = context.obj({});
          doelAf.set(N('DR'), doelDr);
        }
        for (const soort of bronDr.keys()) {
          const bronDeel = alsDict(bctx, bronDr.get(soort));
          const doelDeel = alsDict(context, doelDr.get(soort));
          if (bronDeel && doelDeel) {
            for (const k of bronDeel.keys()) if (doelDeel.get(k) === undefined) doelDeel.set(k, kopie.copy(bronDeel.get(k)));
          } else if (doelDr.get(soort) === undefined) {
            doelDr.set(soort, kopie.copy(bronDr.get(soort)));
          }
        }
      }
      if (doelAf.get(N('DA')) === undefined && bronDa !== undefined) doelAf.set(N('DA'), kopie.copy(bronDa));
      if (opgezocht(bctx, bronAf.get(N('NeedAppearances'))) === PDFBool.True) doelAf.set(N('NeedAppearances'), PDFBool.True);
      const co = alsArray(bctx, bronAf.get(N('CO')));
      if (co?.size()) {
        const doelCo = lijstIn(context, doelAf, 'CO');
        for (const r of co.asArray()) doelCo.push(kopie.copy(r));
      }
      // Lege handtekeningvelden blijven velden: het formulier heeft ze nog.
      if (veldKnopen(bctx, bronAf).some((k) => k.ft === '/Sig')) {
        const sf = doelAf.get(N('SigFlags'));
        const huidig = sf instanceof PDFNumber ? sf.asNumber() : 0;
        doelAf.set(N('SigFlags'), context.obj(huidig | 1));
      }
    }

    // Benoemde bestemmingen (naamboom en de oude /Dests).
    const hernoem = new Map(); // tekst → nieuwe tekst (strings)
    const hernoemOud = new Map(); // naam → nieuwe naam (/Dests)
    const bronNames = alsDict(bctx, bron.catalog.get(N('Names')));
    const bronBenoemd = leesNaamBoom(bctx, bronNames?.get(N('Dests')));
    if (bronBenoemd.length) {
      for (const [k, v] of bronBenoemd) {
        const t = tekstVan(k);
        if (t === null) continue;
        const vrij = uniekeNaam(t, new Set(doelBenoemd.keys()), achtervoegsel);
        if (vrij !== t) {
          hernoem.set(t, vrij);
          info.hernoemdeBestemmingen.push({ van: t, naar: vrij });
        }
        doelBenoemd.set(vrij, kopie.copy(v));
        info.bestemmingen += 1;
      }
    }
    const bronOud = alsDict(bctx, bron.catalog.get(N('Dests')));
    if (bronOud) {
      let doelOud = alsDict(context, catalogus.get(N('Dests')));
      if (!doelOud) {
        doelOud = context.obj({});
        catalogus.set(N('Dests'), context.register(doelOud));
      }
      for (const k of bronOud.keys()) {
        const t = k.decodeText();
        const vrij = uniekeNaam(t, doelOudeNamen, achtervoegsel);
        if (vrij !== t) {
          hernoemOud.set(t, vrij);
          info.hernoemdeBestemmingen.push({ van: t, naar: vrij });
        }
        doelOudeNamen.add(vrij);
        doelOud.set(N(vrij), kopie.copy(bronOud.get(k)));
        info.bestemmingen += 1;
      }
    }

    // Bladwijzers: één bladwijzer voor dit bestand, met de bladwijzers van de bron eronder.
    const eersteRef = nieuweRefs[0];
    const groep = context.obj({
      Title: pdfTekst(String(naam || `PDF ${nummer + 1}`)),
      Dest: [eersteRef, N('XYZ'), null, null, null],
    });
    if (bronOutline) {
      const kinderen = kinderenVan(bctx, bronOutline);
      if (kinderen.length) {
        groep.set(N('First'), kopie.copy(bronOutline.get(N('First'))));
        groep.set(N('Last'), kopie.copy(bronOutline.get(N('Last'))));
        // Ook een directe wortel (zonder eigen object): de kinderen wijzen naar de groep.
        for (const { raw } of kinderenVan(context, groep)) context.lookup(raw)?.set(N('Parent'), groepRef);
      }
    }
    context.assign(groepRef, groep);
    info.bladwijzers = zichtbaarAlsOpen(context, groep);
    if (info.bladwijzers) groep.set(N('Count'), context.obj(info.bladwijzers));
    let outline = alsDict(context, catalogus.get(N('Outlines')));
    let outlineRef = catalogus.get(N('Outlines'));
    if (!outline || !(outlineRef instanceof PDFRef)) {
      const nieuw = context.obj({ Type: 'Outlines' });
      if (outline) for (const [k, v] of outline.entries()) nieuw.set(k, v);
      outline = nieuw;
      outlineRef = context.register(outline);
      catalogus.set(N('Outlines'), outlineRef);
      for (const { raw } of kinderenVan(context, outline)) context.lookup(raw)?.set(N('Parent'), outlineRef);
    }
    let na = vorigeGroep;
    if (!na) {
      if (positie === 'start') na = null;
      else if (positie === 'end') na = doelTopItems[doelTopItems.length - 1] || null;
      else {
        na = null;
        for (const raw of doelTopItems) {
          const idx = paginaVanBladwijzer(doel, context.lookup(raw), doelBenoemd);
          if (idx >= 0 && idx < start0) na = raw;
        }
      }
    }
    voegKindIn(context, outline, outlineRef, groepRef, na);
    vorigeGroep = groepRef;
    groepRefs.push(groepRef);
    outline.set(N('Count'), context.obj(zichtbaarAlsOpen(context, outline)));

    // Verwijzingen naar hernoemde bestemmingen in wat uit deze bron kwam.
    if (hernoem.size || hernoemOud.size) {
      const zetOm = (dict, sleutel) => {
        const v = dict.get(N(sleutel));
        const t = tekstVan(v);
        if (t !== null && hernoem.has(t)) dict.set(N(sleutel), pdfTekst(hernoem.get(t)));
        else if (v instanceof PDFName && hernoemOud.has(v.decodeText())) dict.set(N(sleutel), N(hernoemOud.get(v.decodeText())));
      };
      for (const v of kopie.traversedObjects.values()) {
        const dict = v instanceof PDFStream ? null : v;
        if (!(dict instanceof PDFDict)) continue;
        if (dict.get(N('Dest')) !== undefined) zetOm(dict, 'Dest');
        if (dict.get(N('S'))?.toString() === '/GoTo') zetOm(dict, 'D');
      }
    }

    // Lagen.
    if (bronOc) {
      let oc = alsDict(context, catalogus.get(N('OCProperties')));
      if (!oc) {
        oc = context.obj({});
        catalogus.set(N('OCProperties'), oc);
      }
      const ocgs = lijstIn(context, oc, 'OCGs');
      const bestaand = new Set(ocgs.asArray());
      let d = alsDict(context, oc.get(N('D')));
      if (!d) {
        d = context.obj({});
        oc.set(N('D'), d);
      }
      const bronD = alsDict(bctx, bronOc.get(N('D')));
      const bronBasisUit = bronD?.get(N('BaseState'))?.toString() === '/OFF';
      const bronAan = new Set(alsArray(bctx, bronD?.get(N('ON')))?.asArray() || []);
      const bronUit = new Set(alsArray(bctx, bronD?.get(N('OFF')))?.asArray() || []);
      const doelBasisUit = d.get(N('BaseState'))?.toString() === '/OFF';
      const namen = new Set(ocgs.asArray().map((r) => ocgNaam(context, r)).filter(Boolean));
      const nieuw = new Set();
      const volgorde = lijstIn(context, d, 'Order', ocgs.asArray());
      for (const bronRef of alsArray(bctx, bronOc.get(N('OCGs')))?.asArray() || []) {
        const ref = kopie.copy(bronRef);
        if (!(ref instanceof PDFRef) || bestaand.has(ref) || nieuw.has(ref)) continue;
        const dict = alsDict(context, ref);
        if (!dict) continue;
        const oorspronkelijk = ocgNaam(context, ref);
        if (oorspronkelijk && namen.has(oorspronkelijk)) {
          let uniek = `${oorspronkelijk} (${naam})`;
          for (let n = 2; namen.has(uniek); n += 1) uniek = `${oorspronkelijk} (${naam}) ${n}`;
          dict.set(N('Name'), pdfTekst(uniek));
          namen.add(uniek);
        } else if (oorspronkelijk) {
          namen.add(oorspronkelijk);
        }
        ocgs.push(ref);
        nieuw.add(ref);
        const zichtbaar = bronBasisUit ? bronAan.has(bronRef) : !bronUit.has(bronRef);
        if (doelBasisUit && zichtbaar) lijstIn(context, d, 'ON').push(ref);
        if (!doelBasisUit && !zichtbaar) lijstIn(context, d, 'OFF').push(ref);
      }
      info.lagen = nieuw.size;
      if (nieuw.size) {
        // Volgorde: de lagen van dit bestand als groep met de bestandsnaam.
        const bronVolgorde = bronD?.get(N('Order')) !== undefined ? alsArray(context, kopie.copy(bronD.get(N('Order')))) : null;
        let items = bronVolgorde ? filterVolgorde(context, bronVolgorde, nieuw) : [];
        const genoemd = new Set();
        const verzamel = (lijst) => {
          for (const e of lijst) {
            if (e instanceof PDFRef) genoemd.add(e);
            else if (e instanceof PDFArray) verzamel(e.asArray());
          }
        };
        verzamel(items);
        items = [...items, ...[...nieuw].filter((r) => !genoemd.has(r))];
        volgorde.push(context.obj([pdfTekst(String(naam || `PDF ${nummer + 1}`)), ...items]));
        for (const sleutel of ['Locked', 'RBGroups', 'AS']) {
          const bronLijst = alsArray(bctx, bronD?.get(N(sleutel)));
          if (!bronLijst?.size()) continue;
          const doelLijst = lijstIn(context, d, sleutel);
          for (const e of bronLijst.asArray()) {
            const k = kopie.copy(e);
            if (sleutel === 'Locked' && !(k instanceof PDFRef && nieuw.has(k))) continue;
            doelLijst.push(k);
          }
        }
      }
    }
    // Lagen waar alleen de inhoud van een pagina naar wijst, niet de lijst.
    try {
      info.lagen += voegLagenSamen(doel, nieuwePaginas, { PDFName, PDFArray, PDFDict, PDFString, PDFHexString }, bron, naam);
    } catch { /* lagen zijn bijzaak; de pagina's staan er */ }
    // De lijst met lagen van deze app.
    if (bronEigenLijst?.size()) {
      let eigen = alsDict(context, catalogus.get(N('OPS_AnnotLayers')));
      if (!eigen) {
        eigen = context.obj({ Layers: [...eigenInDoel.values()] });
        catalogus.set(N('OPS_AnnotLayers'), eigen);
      }
      const lijst = lijstIn(context, eigen, 'Layers');
      const al = new Set(lijst.asArray());
      for (const r of bronEigenLijst.asArray()) {
        const k = kopie.copy(r);
        if (k instanceof PDFRef && !al.has(k)) { lijst.push(k); al.add(k); }
      }
    }

    // Bijlagen.
    const bronBijlagen = leesNaamBoom(bctx, bronNames?.get(N('EmbeddedFiles')));
    if (bronBijlagen.length) {
      let names = alsDict(context, catalogus.get(N('Names')));
      if (!names) {
        names = context.obj({});
        catalogus.set(N('Names'), names);
      }
      const doelBijlagen = leesNaamBoom(context, names.get(N('EmbeddedFiles')));
      const bezet = new Set(doelBijlagen.map(([k]) => tekstVan(k)).filter((t) => t !== null));
      for (const [k, v] of bronBijlagen) {
        const t = tekstVan(k);
        if (t === null) continue;
        const vrij = uniekeNaam(t, bezet, achtervoegsel);
        bezet.add(vrij);
        doelBijlagen.push([pdfTekst(vrij), kopie.copy(v)]);
      }
      names.set(N('EmbeddedFiles'), context.register(naamBoom(context, doelBijlagen)));
    }

    // Paginalabels: pas aan het eind, als alle pagina's er zijn.
    const bronLabels = labelReeksen(bron);
    if (bronLabels?.length) heeftLabels = true;
    labelStukken.push({
      start: start0 + offset,
      aantal: bronPaginas.length,
      reeksen: bronLabels?.length
        ? bronLabels.map((r) => ({ start: r.start, dict: alsDict(context, kopie.copy(r.dict)) }))
        : null,
    });

    offset += bronPaginas.length;
    verslag.bronnen.push(info);
  }
  verslag.paginasIngevoegd = offset;
  // Waar de bladwijzer van elk bestand bovenaan staat (voor het model van de app).
  {
    const outline = alsDict(context, catalogus.get(N('Outlines')));
    const boven = outline ? kinderenVan(context, outline).map((k) => String(k.raw)) : [];
    verslag.bladwijzerGroepen = groepRefs.map((r) => boven.indexOf(String(r))).filter((i) => i >= 0);
  }

  // Benoemde bestemmingen als één naamboom.
  if (doelBenoemd.size && verslag.bronnen.some((b) => b.bestemmingen)) {
    let names = alsDict(context, catalogus.get(N('Names')));
    if (!names) {
      names = context.obj({});
      catalogus.set(N('Names'), names);
    }
    const paren = [...doelBenoemd].map(([t, v]) => [pdfTekst(t), v]);
    names.set(N('Dests'), context.register(naamBoom(context, paren)));
  }

  // Paginalabels: het doel tot de invoegplek, de bronnen, en de rest van het doel.
  if (heeftLabels && offset > 0) {
    const reeksen = [
      ...stukReeksen(context, doelLabels, 0, start0, 0),
    ];
    for (const stuk of labelStukken) {
      if (stuk.reeksen) {
        // Ook hier: vóór de eerste reeks van de bron een leeg label.
        if (stuk.reeksen[0].start > 0) reeksen.push({ start: stuk.start, dict: context.obj({}) });
        reeksen.push(...stuk.reeksen.map((r) => ({ start: stuk.start + r.start, dict: r.dict })));
      }
      else reeksen.push(...stukReeksen(context, null, 0, stuk.aantal, stuk.start));
    }
    reeksen.push(...stukReeksen(context, doelLabels, start0, oudAantal, start0 + offset));
    const nums = context.obj([]);
    for (const r of reeksen.sort((a, b) => a.start - b.start)) {
      nums.push(context.obj(r.start));
      nums.push(r.dict);
    }
    catalogus.set(N('PageLabels'), context.register(context.obj({ Nums: nums })));
  }

  return verslag;
}
