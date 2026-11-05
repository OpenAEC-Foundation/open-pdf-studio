// Alleen een deel van een bronbestand samenvoegen (#963).
//
// Wie bij Samenvoegen maar een paar pagina's van een bestand kiest, wil niet
// dat de rest via een achterdeur meekomt. pdf-lib's kopieerder volgt elke
// verwijzing: een bladwijzer, koppeling of benoemde bestemming naar een
// pagina die niet meegaat, of een formulierveld met een widget op zo'n
// pagina, zou die pagina als losse kopie buiten de paginaboom meenemen.
// Daarom wordt de (geladen, wegwerpbare) bron hier eerst ingekort tot de
// gekozen pagina's, en daarna samengevoegd zoals een heel bestand:
//
//   - bladwijzers naar een pagina die wegvalt gaan weg; heeft zo'n
//     bladwijzer kinderen die blijven, dan blijft hij als kop zonder doel;
//   - benoemde bestemmingen (/Names /Dests en de oude /Dests) naar een
//     weggevallen pagina gaan weg;
//   - koppelingen op de gekozen pagina's naar een weggevallen pagina (direct
//     of via een benoemde bestemming) gaan weg; een GoTo-actie op een ander
//     soort annotatie verliest die actie;
//   - formuliervelden: widgets op weggevallen pagina's gaan uit het veld; een
//     veld zonder widgets die blijven, gaat weg (ook uit /CO);
//   - lagen (/OCProperties) die alleen op weggevallen pagina's gebruikt
//     werden, gaan weg uit de lijst, de zichtbaarheid, de volgorde,
//     vergrendeling, keuzegroepen en /AS; lagen zonder pagina (zoals de lagen
//     van deze app) blijven;
//   - paginalabels lopen door zoals ze op de gekozen pagina's stonden;
//   - wat daarna nog naar een weggevallen pagina of haar annotaties wijst
//     (een /P, /IRT, /Popup, een bestemming in een veldactie), wordt
//     losgemaakt, zodat er nooit een weespagina meekomt.
//
// Alleen pdf-lib: de unit-tests draaien hier onder node op.

import { PDFName, PDFArray, PDFDict, PDFRef, PDFString, PDFHexString, PDFNumber, PDFNull, PDFStream } from 'pdf-lib';

const N = (s) => PDFName.of(s);

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

/** De 0-based indexen die echt bestaan, uniek en in bronvolgorde. */
export function geldigeIndexen(paginas, aantal) {
  return [...new Set(paginas || [])]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < aantal)
    .sort((a, b) => a - b);
}

// ── Naambomen ──────────────────────────────────────────────────────────────

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

// ── Bestemmingen ───────────────────────────────────────────────────────────

/**
 * Een oplosser voor bestemmingen van de bron: welke pagina-ref een /Dest of
 * GoTo-/D aanwijst (direct, via een naam of een dict met /D), of null.
 */
function bestemmingsOplosser(context, catalogus) {
  const benoemd = new Map();
  const names = alsDict(context, catalogus.get(N('Names')));
  for (const [k, v] of leesNaamBoom(context, names?.get(N('Dests')))) {
    const t = tekstVan(k);
    if (t !== null && !benoemd.has(t)) benoemd.set(t, v);
  }
  const oud = alsDict(context, catalogus.get(N('Dests')));
  const naarRef = (raw, diepte = 0) => {
    if (diepte > 4) return null;
    let dest = opgezocht(context, raw);
    const t = tekstVan(dest);
    if (t !== null) return benoemd.has(t) ? naarRef(benoemd.get(t), diepte + 1) : null;
    if (dest instanceof PDFName) {
      const v = oud?.get(dest);
      return v !== undefined ? naarRef(v, diepte + 1) : null;
    }
    const d = dest instanceof PDFDict ? dest : null;
    if (d) dest = opgezocht(context, d.get(N('D')));
    if (!(dest instanceof PDFArray)) return null;
    const ref = dest.get(0);
    return ref instanceof PDFRef ? ref : null;
  };
  /** De bestemming van een bladwijzer of annotatie (/Dest, of /A met /S /GoTo). */
  const vanItem = (dict) => {
    if (dict.get(N('Dest')) !== undefined) return naarRef(dict.get(N('Dest')));
    const a = alsDict(context, dict.get(N('A')));
    if (a && a.get(N('S'))?.toString() === '/GoTo') return naarRef(a.get(N('D')));
    return null;
  };
  return { naarRef, vanItem, benoemd, oud };
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

/** Snoei de kinderen van `ouder`; geeft het aantal weggehaalde bladwijzers. */
function snoeiBladwijzers(context, ouder, wegDoel, diepte = 0) {
  if (diepte > 64) return 0;
  let weg = 0;
  const blijven = [];
  for (const { raw, dict } of kinderenVan(context, ouder)) {
    weg += snoeiBladwijzers(context, dict, wegDoel, diepte + 1);
    const heeftKinderen = dict.get(N('First')) !== undefined;
    if (wegDoel(dict)) {
      if (!heeftKinderen) { weg += 1; continue; }
      // Kop zonder doel: de kinderen blijven bereikbaar.
      dict.delete(N('Dest'));
      dict.delete(N('A'));
    }
    blijven.push({ raw, dict });
  }
  // Opnieuw aan elkaar rijgen.
  blijven.forEach(({ dict }, i) => {
    if (i > 0) dict.set(N('Prev'), blijven[i - 1].raw); else dict.delete(N('Prev'));
    if (i + 1 < blijven.length) dict.set(N('Next'), blijven[i + 1].raw); else dict.delete(N('Next'));
  });
  if (blijven.length) {
    ouder.set(N('First'), blijven[0].raw);
    ouder.set(N('Last'), blijven[blijven.length - 1].raw);
  } else {
    ouder.delete(N('First'));
    ouder.delete(N('Last'));
  }
  // /Count: het teken (open of dicht) blijft, het getal klopt weer.
  const c = ouder.get(N('Count'));
  const dicht = c instanceof PDFNumber && c.asNumber() < 0;
  const n = zichtbaarAlsOpen(context, ouder);
  if (!n) ouder.delete(N('Count'));
  else ouder.set(N('Count'), context.obj(dicht && diepte > 0 ? -n : n));
  return weg;
}

// ── Velden ─────────────────────────────────────────────────────────────────

/**
 * Snoei de veldboom: widgets op weggevallen pagina's eruit, velden zonder
 * widget die blijft eruit. Geeft { weg: aantal velden met naam, wegRefs }.
 */
function snoeiVelden(context, af, isWegWidget) {
  const wegRefs = new Set();
  let weg = 0;
  const gezien = new Set();
  const houd = (raw) => {
    const d = alsDict(context, raw);
    if (!d) return true;
    if (gezien.has(d)) return true;
    gezien.add(d);
    const kids = alsArray(context, d.get(N('Kids')));
    let blijft;
    if (kids && kids.size()) {
      const over = kids.asArray().filter((k) => houd(k));
      if (over.length !== kids.size()) d.set(N('Kids'), context.obj(over));
      blijft = over.length > 0;
    } else {
      blijft = !isWegWidget(raw, d);
    }
    if (!blijft) {
      if (raw instanceof PDFRef) wegRefs.add(raw);
      if (d.get(N('T')) !== undefined) weg += 1;
    }
    return blijft;
  };
  const fields = alsArray(context, af.get(N('Fields')));
  if (fields) {
    const over = fields.asArray().filter((f) => houd(f));
    if (over.length !== fields.size()) af.set(N('Fields'), context.obj(over));
  }
  const co = alsArray(context, af.get(N('CO')));
  if (co) {
    const over = co.asArray().filter((r) => !(r instanceof PDFRef && wegRefs.has(r)));
    if (over.length !== co.size()) af.set(N('CO'), context.obj(over));
  }
  return { weg, wegRefs };
}

// ── Lagen ──────────────────────────────────────────────────────────────────

/** Alle OCG-refs die vanaf deze pagina's bereikbaar zijn (inhoud, annotaties, /OC). */
function bereikbareLagen(context, paginaRefs) {
  const lagen = new Set();
  const gezien = new Set();
  const paginaSet = new Set(paginaRefs);
  const loop = (raw, diepte) => {
    if (diepte > 200) return;
    if (raw instanceof PDFRef) {
      if (gezien.has(raw)) return;
      gezien.add(raw);
      const v = context.lookup(raw);
      if (v instanceof PDFDict && v.get(N('Type'))?.toString() === '/OCG') { lagen.add(raw); return; }
      // Niet via een bestemming naar een andere pagina doorlopen.
      if (v instanceof PDFDict && v.get(N('Type'))?.toString() === '/Page' && !paginaSet.has(raw)) return;
      loop(v, diepte + 1);
      return;
    }
    const dict = raw instanceof PDFStream ? raw.dict : raw;
    if (dict instanceof PDFDict) {
      for (const [k, v] of dict.entries()) {
        const sleutel = k.toString();
        if (sleutel === '/Parent' || sleutel === '/P') continue;
        loop(v, diepte + 1);
      }
    } else if (dict instanceof PDFArray) {
      for (const v of dict.asArray()) loop(v, diepte + 1);
    }
  };
  for (const ref of paginaRefs) {
    gezien.add(ref);
    loop(context.lookup(ref), 0);
  }
  return lagen;
}

/** Haal refs in `weg` uit een (geneste) array; lege groepen vallen weg. */
function zonder(context, arr, weg) {
  const uit = [];
  for (const e of arr.asArray()) {
    if (e instanceof PDFRef) {
      if (weg.has(e)) continue;
      const genest = alsArray(context, e);
      if (!genest) { uit.push(e); continue; }
    }
    const genest = alsArray(context, e);
    if (genest) {
      const sub = zonder(context, genest, weg);
      const echt = sub.some((x) => x instanceof PDFRef || x instanceof PDFArray);
      if (echt) uit.push(context.obj(sub));
      continue;
    }
    uit.push(e);
  }
  return uit;
}

function snoeiLaagConfig(context, cfg, weg) {
  if (!cfg) return;
  for (const sleutel of ['ON', 'OFF', 'Locked', 'Order']) {
    const arr = alsArray(context, cfg.get(N(sleutel)));
    if (arr) cfg.set(N(sleutel), context.obj(zonder(context, arr, weg)));
  }
  const rb = alsArray(context, cfg.get(N('RBGroups')));
  if (rb) {
    const groepen = [];
    for (const g of rb.asArray()) {
      const arr = alsArray(context, g);
      if (!arr) continue;
      const over = arr.asArray().filter((r) => !(r instanceof PDFRef && weg.has(r)));
      if (over.length) groepen.push(context.obj(over));
    }
    cfg.set(N('RBGroups'), context.obj(groepen));
  }
  const as = alsArray(context, cfg.get(N('AS')));
  if (as) {
    for (const e of as.asArray()) {
      const d = alsDict(context, e);
      const lijst = alsArray(context, d?.get(N('OCGs')));
      if (d && lijst) d.set(N('OCGs'), context.obj(lijst.asArray().filter((r) => !(r instanceof PDFRef && weg.has(r)))));
    }
  }
}

function snoeiLagen(context, catalogus, wegLagen) {
  const oc = alsDict(context, catalogus.get(N('OCProperties')));
  if (!oc || !wegLagen.size) return 0;
  const ocgs = alsArray(context, oc.get(N('OCGs')));
  let weg = 0;
  if (ocgs) {
    const over = ocgs.asArray().filter((r) => !(r instanceof PDFRef && wegLagen.has(r)));
    weg = ocgs.size() - over.length;
    oc.set(N('OCGs'), context.obj(over));
  }
  snoeiLaagConfig(context, alsDict(context, oc.get(N('D'))), wegLagen);
  for (const c of alsArray(context, oc.get(N('Configs')))?.asArray() || []) snoeiLaagConfig(context, alsDict(context, c), wegLagen);
  return weg;
}

// ── Paginalabels ───────────────────────────────────────────────────────────

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

/**
 * Labelreeksen voor de gekozen pagina's: een pagina die direct op haar
 * voorganger in dezelfde reeks volgt, loopt door; anders begint een reeks
 * met de /St die de pagina in de bron had.
 * @param {{start:number, dict:object|null}[]} reeksen van de bron, gesorteerd
 * @param {number[]} indexen gekozen 0-based bronpagina's, gesorteerd
 * @returns {{start:number, reeks:number, st:number|null}[]} start = nieuwe index;
 *   reeks = index in `reeksen` (-1: vóór de eerste reeks, geen label)
 */
export function labelsVoorSelectie(reeksen, indexen) {
  const uit = [];
  let vorige = null;
  indexen.forEach((p, j) => {
    let r = -1;
    for (let i = 0; i < reeksen.length; i++) if (reeksen[i].start <= p) r = i;
    if (vorige && vorige.reeks === r && vorige.p === p - 1) { vorige = { reeks: r, p }; return; }
    const basis = r >= 0 ? (reeksen[r].st ?? 1) : null;
    uit.push({ start: j, reeks: r, st: r >= 0 ? basis + (p - reeksen[r].start) : null });
    vorige = { reeks: r, p };
  });
  return uit;
}

function snoeiLabels(context, catalogus, indexen) {
  const wortel = catalogus.get(N('PageLabels'));
  if (!wortel) return;
  const reeksen = leesGetalBoom(context, wortel)
    .map(([start, v]) => ({ start, dict: alsDict(context, v) }))
    .filter((r) => r.dict)
    .map((r) => {
      const st = r.dict.get(N('St'));
      return { ...r, st: st instanceof PDFNumber ? st.asNumber() : 1 };
    });
  if (!reeksen.length) return;
  const nums = context.obj([]);
  for (const s of labelsVoorSelectie(reeksen, indexen)) {
    nums.push(context.obj(s.start));
    if (s.reeks < 0) { nums.push(context.obj({})); continue; }
    const dict = reeksen[s.reeks].dict.clone(context);
    dict.set(N('St'), context.obj(s.st));
    nums.push(dict);
  }
  catalogus.set(N('PageLabels'), context.register(context.obj({ Nums: nums })));
}

// ── Losmaken van wat overblijft ────────────────────────────────────────────

const LOSSE_SLEUTELS = new Set(['/P', '/IRT', '/Popup', '/Parent']);

function maakLos(context, obj, weg, gezien) {
  const dict = obj instanceof PDFStream ? obj.dict : obj;
  if (dict instanceof PDFDict) {
    for (const [k, v] of [...dict.entries()]) {
      if (v instanceof PDFRef) {
        if (weg.paginas.has(v) || weg.annots.has(v)) {
          if (LOSSE_SLEUTELS.has(k.toString()) || weg.annots.has(v)) dict.delete(k);
          else dict.set(k, PDFNull);
        }
      } else if (v instanceof PDFDict || v instanceof PDFArray) {
        if (!gezien.has(v)) { gezien.add(v); maakLos(context, v, weg, gezien); }
      }
    }
  } else if (dict instanceof PDFArray) {
    const lijst = dict.asArray();
    for (let i = lijst.length - 1; i >= 0; i--) {
      const v = lijst[i];
      if (v instanceof PDFRef) {
        if (weg.annots.has(v)) dict.remove(i);
        else if (weg.paginas.has(v)) dict.set(i, PDFNull);
      } else if (v instanceof PDFDict || v instanceof PDFArray) {
        if (!gezien.has(v)) { gezien.add(v); maakLos(context, v, weg, gezien); }
      }
    }
  }
}

// ── Inkorten ───────────────────────────────────────────────────────────────

/**
 * Kort `bron` in tot de pagina's `indexen` (0-based, bronvolgorde). De bron
 * wordt aangepast: geef een geladen kopie.
 * @returns {{paginas:number, bladwijzers:number, bestemmingen:number, koppelingen:number, velden:number, lagen:number}}
 *   wat er wegviel
 */
export function kortBronIn(bron, indexen) {
  const context = bron.context;
  const catalogus = bron.catalog;
  const paginas = bron.getPages();
  const gekozen = geldigeIndexen(indexen, paginas.length);
  const verslag = { paginas: 0, bladwijzers: 0, bestemmingen: 0, koppelingen: 0, velden: 0, lagen: 0 };
  if (!gekozen.length || gekozen.length === paginas.length) return verslag;
  const houden = new Set(gekozen);
  const wegPaginas = new Set();
  paginas.forEach((p, i) => { if (!houden.has(i)) wegPaginas.add(p.ref); });
  const blijfRefs = gekozen.map((i) => paginas[i].ref);

  // Annotaties per kant.
  const annotsVan = (p) => alsArray(context, p.node.get(N('Annots')))?.asArray() || [];
  const wegAnnots = new Set();
  const blijfAnnots = new Set();
  paginas.forEach((p, i) => {
    for (const a of annotsVan(p)) if (a instanceof PDFRef) (houden.has(i) ? blijfAnnots : wegAnnots).add(a);
  });

  const oplosser = bestemmingsOplosser(context, catalogus);
  const naarWeg = (dict) => {
    const ref = oplosser.vanItem(dict);
    return !!ref && wegPaginas.has(ref);
  };

  // Lagen: vóór er iets verandert, wie welke laag gebruikt.
  const lagenBlijf = bereikbareLagen(context, blijfRefs);
  const lagenWeg = bereikbareLagen(context, [...wegPaginas]);
  const wegLagen = new Set([...lagenWeg].filter((r) => !lagenBlijf.has(r)));

  // Bladwijzers.
  const outline = alsDict(context, catalogus.get(N('Outlines')));
  if (outline) verslag.bladwijzers = snoeiBladwijzers(context, outline, naarWeg);

  // Koppelingen en acties op de pagina's die blijven.
  for (const i of gekozen) {
    const p = paginas[i];
    const annots = alsArray(context, p.node.get(N('Annots')));
    if (!annots) continue;
    const over = [];
    for (const a of annots.asArray()) {
      const d = alsDict(context, a);
      if (d && naarWeg(d)) {
        if (d.get(N('Subtype'))?.toString() === '/Link') {
          verslag.koppelingen += 1;
          if (a instanceof PDFRef) { blijfAnnots.delete(a); wegAnnots.add(a); }
          continue;
        }
        d.delete(N('Dest'));
        d.delete(N('A'));
      }
      over.push(a);
    }
    if (over.length !== annots.size()) p.node.set(N('Annots'), context.obj(over));
  }

  // Benoemde bestemmingen.
  const names = alsDict(context, catalogus.get(N('Names')));
  if (names?.get(N('Dests')) !== undefined) {
    const paren = leesNaamBoom(context, names.get(N('Dests')));
    const over = paren.filter(([, v]) => {
      const ref = oplosser.naarRef(v);
      return !(ref && wegPaginas.has(ref));
    });
    if (over.length !== paren.length) {
      verslag.bestemmingen += paren.length - over.length;
      names.set(N('Dests'), context.register(naamBoom(context, over)));
    }
  }
  if (oplosser.oud) {
    for (const k of oplosser.oud.keys()) {
      const ref = oplosser.naarRef(oplosser.oud.get(k));
      if (ref && wegPaginas.has(ref)) { oplosser.oud.delete(k); verslag.bestemmingen += 1; }
    }
  }

  // Formuliervelden.
  const af = alsDict(context, catalogus.get(N('AcroForm')));
  if (af) {
    const isWegWidget = (raw, d) => {
      if (raw instanceof PDFRef && wegAnnots.has(raw)) return true;
      if (raw instanceof PDFRef && blijfAnnots.has(raw)) return false;
      const p = d.get(N('P'));
      return p instanceof PDFRef && wegPaginas.has(p);
    };
    const { weg, wegRefs } = snoeiVelden(context, af, isWegWidget);
    verslag.velden = weg;
    // Een veldouder die wegviel, hoort bij de losgemaakte objecten.
    for (const r of wegRefs) if (!blijfAnnots.has(r)) wegAnnots.add(r);
  }

  // Lagen die alleen op weggevallen pagina's stonden.
  verslag.lagen = snoeiLagen(context, catalogus, wegLagen);

  // Paginalabels, zoals ze op de gekozen pagina's stonden.
  snoeiLabels(context, catalogus, gekozen);

  // Pagina's uit de boom (van achter naar voren).
  for (let i = paginas.length - 1; i >= 0; i--) if (!houden.has(i)) bron.removePage(i);
  // pdf-lib's removePage laat de paginalijst van getPages() staan.
  bron.pageCache?.invalidate?.();
  verslag.paginas = paginas.length - gekozen.length;

  // Wat nog naar een weggevallen pagina of haar annotaties wijst, losmaken.
  const weg = { paginas: wegPaginas, annots: wegAnnots };
  const gezien = new Set();
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (wegPaginas.has(ref) || wegAnnots.has(ref)) continue;
    maakLos(context, obj, weg, gezien);
  }
  return verslag;
}
