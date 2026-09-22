// Pure rekenregels achter het importvenster voor DWG en DXF (#400). Geen
// imports uit de app, zodat de unit-tests ze onder node kunnen draaien.

/** Punten per millimeter (1 pt = 1/72 inch). */
export const PT_PER_MM = 72 / 25.4;

/**
 * Millimeters per tekeneenheid. Naast de eenheden die in het venster te kiezen
 * zijn staan hier ook de eenheden die alleen uit een bestand kunnen komen
 * (`$INSUNITS`), zodat de maten dan toch kloppen.
 */
export const MM_PER_EENHEID = Object.freeze({
  mm: 1, cm: 10, dm: 100, m: 1000, km: 1_000_000, in: 25.4, ft: 304.8, yd: 914.4, mi: 1_609_344,
});

/** Papierformaten van het importvenster; maten in mm, staand. */
export const PAPIERFORMATEN = Object.freeze([
  { id: 'A4', breedte: 210, hoogte: 297 },
  { id: 'A3', breedte: 297, hoogte: 420 },
  { id: 'A3L', breedte: 297, hoogte: 630 },
  { id: 'A2', breedte: 420, hoogte: 594 },
  { id: 'A2L', breedte: 420, hoogte: 804 },
  { id: 'A1', breedte: 594, hoogte: 841 },
  { id: 'A1L', breedte: 594, hoogte: 1051 },
  { id: 'A0', breedte: 841, hoogte: 1189 },
  { id: 'Letter', breedte: 215.9, hoogte: 279.4 },
  { id: 'Tabloid', breedte: 279.4, hoogte: 431.8 },
]);

/** Standaardschalen als noemer N van 1:N (kleiner dan 1 is een vergroting). */
export const STANDAARDSCHALEN = Object.freeze([
  0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000,
  100000,
]);

/** Boven deze coördinaatwaarde verschuift de import standaard de oorsprong. */
export const GROTE_COORDINAAT = 1e5;

/**
 * Grootste zijde van een pagina in millimeters: 14 400 punten, wat een PDF
 * hoogstens kan dragen. De import weigert alles daarboven
 * (`IMPORT_PAGE_TOO_LARGE`); het venster laat het daarom niet invullen.
 */
export const MAX_PAGINA_MM = 5080;

/**
 * Een ingevulde papiermaat: tussen 1 mm en de grootste pagina; wat geen getal
 * is, wordt de terugval.
 */
export function papiermaatMm(waarde, terugval) {
  const getal = Number(waarde);
  if (waarde === '' || waarde == null || !Number.isFinite(getal) || getal === 0) return terugval;
  return Math.min(MAX_PAGINA_MM, Math.max(1, getal));
}

/**
 * Kleinste standaardschaal waarbij de tekening past (N ≥ `exact`).
 * Dezelfde regel als de crate, zodat het venster hetzelfde voorstelt als de
 * omzetting doet.
 */
export function schaalNaarBoven(exact) {
  if (!(exact > 0) || !Number.isFinite(exact)) return 1;
  for (const n of STANDAARDSCHALEN) {
    if (n >= exact * (1 - 1e-9)) return n;
  }
  const orde = 10 ** (Math.floor(Math.log10(exact)) - 1);
  return Math.ceil(exact / orde) * orde;
}

/** Decimaalteken van een taal (`,` in het Nederlands, `.` in het Engels). */
export function decimaalTeken(taal) {
  try {
    return new Intl.NumberFormat(taal || undefined).format(1.1).replace(/[0-9]/g, '') || '.';
  } catch {
    return '.';
  }
}

/** Schaal als tekst: `1:100`, `1:2,5` of `5:1`. */
export function schaalTekst(n, decimaal = ',') {
  if (!(n > 0) || !Number.isFinite(n)) return '';
  const kort = (v) => String(Math.round(v * 100) / 100).replace('.', decimaal);
  return n >= 1 ? `1:${kort(n)}` : `${kort(1 / n)}:1`;
}

/** De ruimte (modelruimte of layout) met dit kenmerk. */
export function ruimteVan(scan, id) {
  const ruimtes = scan?.spaces || [];
  return ruimtes.find((r) => r.id === id) || ruimtes.find((r) => r.id === scan?.defaultSpace) || ruimtes[0] || null;
}

/**
 * Lagen zoals het venster ze toont: de lagentabel van het bestand, aangevuld
 * met het aantal objecten en de omhullende in de gekozen ruimte.
 */
export function lagenVoorRuimte(scan, ruimteId) {
  const ruimte = ruimteVan(scan, ruimteId);
  const perNaam = new Map((ruimte?.layers || []).map((l) => [l.name.toUpperCase(), l]));
  const uit = (scan?.layers || []).map((laag) => {
    const info = perNaam.get(laag.name.toUpperCase());
    return { ...laag, objects: info?.objects ?? 0, bounds: info?.bounds ?? null };
  });
  // Lagen die alleen in de ruimte voorkomen (niet in de tabel) toch tonen.
  for (const [sleutel, info] of perNaam) {
    if (!uit.some((l) => l.name.toUpperCase() === sleutel)) {
      uit.push({ name: info.name, color: '#FFFFFF', aci: 7, off: false, frozen: false, locked: false, plottable: true, linetype: '', lineweightMm: null, objects: info.objects, bounds: info.bounds });
    }
  }
  return uit;
}

/**
 * Lagen die standaard uit staan: wat in het bestand uit of bevroren is, en
 * (desgewenst) wat niet geplot wordt.
 * @returns {Set<string>} namen in hoofdletters
 */
export function standaardUitgesloten(lagen, ookNietPlotbaar = true) {
  const uit = new Set();
  for (const laag of lagen || []) {
    if (laag.off || laag.frozen || (ookNietPlotbaar && laag.plottable === false)) uit.add(laag.name.toUpperCase());
  }
  return uit;
}

/**
 * Filtert de lagenlijst op een zoektekst. Zonder jokertekens telt de tekst
 * overal in de naam; met `*` (willekeurig veel tekens) of `?` (precies één
 * teken) moet de hele naam passen, zoals in de lagenfilters van
 * CAD-programma's. Hoofdletterongevoelig.
 */
export function filterLagen(lagen, zoek) {
  const tekst = String(zoek || '').trim();
  if (!tekst) return lagen;
  if (!/[*?]/.test(tekst)) {
    const los = tekst.toLowerCase();
    return lagen.filter((l) => l.name.toLowerCase().includes(los));
  }
  const patroon = new RegExp(
    `^${tekst.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
    'i',
  );
  return lagen.filter((l) => patroon.test(l.name));
}

const naamVergelijker = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Status van een laag als sorteersleutel: hoe meer bijzonderheden, hoe hoger. */
function statusRang(l) {
  return (l.off ? 8 : 0) + (l.frozen ? 4 : 0) + (l.locked ? 2 : 0) + (l.plottable === false ? 1 : 0);
}

/**
 * Sorteert de lagenlijst op een kolom (`name`, `objects`, `state`, `color`).
 * Zonder kolom blijft de volgorde van het bestand. Geeft een nieuwe lijst.
 */
export function sorteerLagen(lagen, kolom, oplopend = true) {
  const lijst = [...(lagen || [])];
  if (!kolom) return lijst;
  const vergelijk = {
    name: (a, b) => naamVergelijker.compare(a.name, b.name),
    objects: (a, b) => (a.objects || 0) - (b.objects || 0),
    state: (a, b) => statusRang(a) - statusRang(b),
    color: (a, b) => String(a.color || '').localeCompare(String(b.color || '')),
  }[kolom];
  if (!vergelijk) return lijst;
  const richting = oplopend ? 1 : -1;
  return lijst.sort((a, b) => richting * vergelijk(a, b) || naamVergelijker.compare(a.name, b.name));
}

/**
 * Schakelaar "niet-plotbare lagen uitsluiten": zet alleen de lagen met "niet
 * plotten" uit of weer aan en laat de rest van de keuze van de gebruiker staan.
 * @returns {Set<string>} nieuwe set, namen in hoofdletters
 */
export function zetNietPlotbaar(lagen, uit, uitsluiten) {
  const s = new Set(uit);
  for (const laag of lagen || []) {
    if (laag.plottable !== false) continue;
    if (uitsluiten) s.add(laag.name.toUpperCase());
    else s.delete(laag.name.toUpperCase());
  }
  return s;
}

/**
 * Welke lagen de omzetting weglaat en welke hij verborgen meeneemt. Verborgen
 * meenemen kan alleen met PDF-lagen: zonder OCG is er niets om uit te zetten,
 * en dan blijft een uitgezette laag gewoon weg.
 *
 * Bij doel 'underlay' (op de huidige pagina) gaan ze ook weg: het blad wordt
 * dan als vectorknipsel in de pagina gezet, en daarbij reizen de laagdicts
 * wel mee maar de /OCProperties van de omgezette PDF (en dus de OFF-lijst)
 * niet. Een lezer beschouwt zo'n laag als zichtbaar, zodat "verborgen" op de
 * pagina en in het bestand voluit in beeld zou staan. Er is op een knipsel
 * toch niets om aan of uit te zetten.
 * @param {string} [doel]  'new', 'append' of 'underlay'
 * @returns {{excludedLayers: string[], hiddenLayers: string[]}}
 */
export function lagenKeuze(lagen, uit, inst, doel) {
  const namen = (lagen || []).filter((l) => uit?.has?.(l.name.toUpperCase())).map((l) => l.name);
  if (inst?.includeOffLayers && inst?.layersAsOcg !== false && doel !== 'underlay') return { excludedLayers: [], hiddenLayers: namen };
  return { excludedLayers: namen, hiddenLayers: [] };
}

/**
 * De lagen die de omzetting helemaal weglaat, als set van namen in
 * hoofdletters. Verborgen meegenomen lagen staan er niet in: de omzetter
 * tekent ze en rekent ze mee in de omhullende, dus het venster moet dat ook
 * doen, anders stelt het een ander blad voor dan er gemaakt wordt.
 * @returns {Set<string>}
 */
export function weggelatenLagen(lagen, uit, inst, doel) {
  return new Set(lagenKeuze(lagen, uit, inst, doel).excludedLayers.map((naam) => naam.toUpperCase()));
}

/**
 * Omhullende van de lagen die meedoen: `[x0, y0, x1, y1]` in tekeningeenheden,
 * of null als er niets overblijft.
 */
export function gebiedUitLagen(lagen, uitgesloten) {
  let uit = null;
  for (const laag of lagen || []) {
    if (!laag.bounds || uitgesloten?.has?.(laag.name.toUpperCase())) continue;
    const [x0, y0, x1, y1] = laag.bounds;
    if (![x0, y0, x1, y1].every((v) => Number.isFinite(v))) continue;
    uit = uit
      ? [Math.min(uit[0], x0), Math.min(uit[1], y0), Math.max(uit[2], x1), Math.max(uit[3], y1)]
      : [x0, y0, x1, y1];
  }
  return uit;
}

/**
 * Omhullende van een gedraaid gebied, zoals de omzetting hem gebruikt: bij
 * een vrije hoek wordt het vlak groter, niet alleen bij kwartslagen.
 */
export function gedraaideMaat(maat, graden) {
  if (!maat) return null;
  const hoek = ((Number(graden) || 0) * Math.PI) / 180;
  let [s, c] = [Math.abs(Math.sin(hoek)), Math.abs(Math.cos(hoek))];
  // Kwartslagen exact houden.
  if (s < 1e-12) [s, c] = [0, 1];
  else if (c < 1e-12) [s, c] = [1, 0];
  return { breedte: maat.breedte * c + maat.hoogte * s, hoogte: maat.breedte * s + maat.hoogte * c };
}

/** Maat van een gebied in millimeters. */
export function gebiedMaatMm(gebied, mmPerEenheid) {
  if (!gebied) return null;
  const k = Number(mmPerEenheid) > 0 ? Number(mmPerEenheid) : 1;
  return { breedte: Math.max(0, (gebied[2] - gebied[0]) * k), hoogte: Math.max(0, (gebied[3] - gebied[1]) * k) };
}

/** Liggen de limits om de hele tekening heen? Alleen dan zijn ze kiesbaar. */
export function limitsOmvatten(limits, grenzen) {
  if (!limits || !grenzen) return false;
  const [lx0, ly0, lx1, ly1] = limits;
  if (!(lx1 > lx0 && ly1 > ly0)) return false;
  const eps = 1e-6 * Math.max(1, Math.abs(lx1 - lx0), Math.abs(ly1 - ly0));
  return lx0 <= grenzen[0] + eps && ly0 <= grenzen[1] + eps && lx1 >= grenzen[2] - eps && ly1 >= grenzen[3] - eps;
}

/**
 * Het gebied dat werkelijk gebruikt wordt: onthouden "limits" van een vorige
 * tekening die deze tekening niet omsluiten, tellen als extents. Het venster
 * rekent daarmee, en de omzetter moet precies hetzelfde gebied krijgen; de
 * omzetter neemt de header-limits anders klakkeloos over en maakt een leeg blad.
 */
export function effectiefGebied(area, limitsBruikbaar) {
  return area === 'limits' && !limitsBruikbaar ? 'extents' : area;
}

/**
 * Welk punt van de tekening op de oorsprong van de pagina komt: dezelfde
 * rekenregel als de omzetting (`PageResult.offset`). De verschuiving is dus
 * wat het venster toont, niet een benadering.
 * @param {number[]|null} gebied  `[x0, y0, x1, y1]` in tekeningeenheden
 * @param {object} inst           instellingen (plaatsing, marge, draaiing)
 * @param {{schaal:number, breedteMm:number, hoogteMm:number}|null} voorstel
 * @param {number} mmPerEenheid
 * @param {number[]|null} [basispunt]  `[x, y]` voor plaatsing "op oorsprong"
 * @returns {{x:number, y:number} | null}
 */
export function oorsprongVerschuiving(gebied, inst, voorstel, mmPerEenheid = 1, basispunt = null) {
  if (!gebied || !voorstel || !(voorstel.schaal > 0)) return null;
  if (![gebied[0], gebied[1], gebied[2], gebied[3]].every((v) => Number.isFinite(v))) return null;
  const k = mmPerEenheid > 0 ? mmPerEenheid : 1;
  const marge = Math.max(0, Number(inst?.marginMm) || 0);
  const maat = gebiedMaatMm(gebied, k);
  const gedraaid = gedraaideMaat(maat, inst?.rotation);
  // Papiermaten in tekeningeenheden: 1 mm papier = schaal / mmPerEenheid.
  const perMm = Number(voorstel.schaal) / k;
  const midden = [(gebied[0] + gebied[2]) / 2, (gebied[1] + gebied[3]) / 2];
  let ref = midden;
  let pagina = [(voorstel.breedteMm / 2) * perMm, (voorstel.hoogteMm / 2) * perMm];
  if (inst?.placement === 'lower_left') {
    pagina = [(marge + gedraaid.breedte / Number(voorstel.schaal) / 2) * perMm, (marge + gedraaid.hoogte / Number(voorstel.schaal) / 2) * perMm];
  } else if (inst?.placement === 'origin') {
    ref = basispunt && basispunt.every((v) => Number.isFinite(v)) ? basispunt : [0, 0];
    pagina = [marge * perMm, marge * perMm];
  }
  // Draaiing: de pagina-as terugdraaien naar de tekening.
  const hoek = ((Number(inst?.rotation) || 0) * Math.PI) / 180;
  const [s, c] = [Math.sin(hoek), Math.cos(hoek)];
  const x = ref[0] - (pagina[0] * c + pagina[1] * s);
  const y = ref[1] - (-pagina[0] * s + pagina[1] * c);
  return { x: rond(x), y: rond(y) };
}

/** Rondt af op een duizendste; -0 wordt 0. */
function rond(v) {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
}

/** Getal in de notatie van de taal, met een echt minteken. */
export function getalTekst(n, taal) {
  let tekst;
  try {
    tekst = new Intl.NumberFormat(taal || undefined, { maximumFractionDigits: 3 }).format(n);
  } catch {
    tekst = String(Math.round(n * 1000) / 1000);
  }
  return tekst.replace(/^-/, '−');
}

/**
 * Het doel dat werkelijk gebruikt wordt: een nieuwe pagina en een tekening op
 * de huidige pagina kunnen alleen in een geopend document; anders wordt het
 * een nieuw document.
 */
export function effectiefDoel(doel, heeftDocument) {
  return (doel === 'append' || doel === 'underlay') && heeftDocument ? doel : 'new';
}

/** Is dit pad een CAD-tekening (DWG of DXF)? */
export function isCadTekening(pad) {
  // Een naam moet vóór de extensie staan: "dwg" of "map/.dxf" tellen niet.
  return /[^\\/]\.(dwg|dxf)$/i.test(String(pad || ''));
}

/** Papierformaat opzoeken. */
export function papierVan(id) {
  return PAPIERFORMATEN.find((p) => p.id.toLowerCase() === String(id || '').toLowerCase()) || null;
}

/**
 * Voorstel voor papier en schaal, dezelfde regels als de omzetting: met een
 * vaste schaal het kleinste formaat waar het op past, met "passend" de
 * eerstvolgende standaardschaal op het gekozen papier.
 * @returns {{papier:string, liggend:boolean, schaal:number, breedteMm:number, hoogteMm:number} | null}
 */
export function papierVoorstel(maat, inst) {
  if (!maat || !(maat.breedte >= 0) || !(maat.hoogte >= 0)) return null;
  const marge = Math.max(0, Number(inst?.marginMm) || 0);
  const gedraaid = gedraaideMaat(maat, Number(inst?.rotation) || 0);
  const b = Math.max(gedraaid.breedte, 1e-6);
  const h = Math.max(gedraaid.hoogte, 1e-6);
  const liggendVoorkeur = (bb, hh) =>
    inst?.orientation === 'landscape' ? true : inst?.orientation === 'portrait' ? false : bb > hh;

  const schaal = Number(inst?.scale) > 0 ? Number(inst.scale) : null;
  if (schaal) {
    const [cw, ch] = [b / schaal, h / schaal];
    if (inst?.paper === 'custom') {
      const bp = Number(inst.paperWidthMm) || 297;
      const hp = Number(inst.paperHeightMm) || 420;
      return { papier: 'custom', liggend: bp > hp, schaal, breedteMm: bp, hoogteMm: hp };
    }
    if (inst?.paper && inst.paper !== 'auto') {
      const p = papierVan(inst.paper);
      if (p) {
        const liggend = liggendVoorkeur(cw, ch);
        return { papier: p.id, liggend, schaal, breedteMm: liggend ? p.hoogte : p.breedte, hoogteMm: liggend ? p.breedte : p.hoogte };
      }
    }
    for (const p of PAPIERFORMATEN) {
      if (p.id === 'Letter' || p.id === 'Tabloid') continue;
      const orientaties = inst?.orientation === 'landscape' ? [true]
        : inst?.orientation === 'portrait' ? [false]
          : cw > ch ? [true, false] : [false, true];
      for (const liggend of orientaties) {
        const [pw, ph] = liggend ? [p.hoogte, p.breedte] : [p.breedte, p.hoogte];
        if (cw + 2 * marge <= pw + 1e-9 && ch + 2 * marge <= ph + 1e-9) {
          return { papier: p.id, liggend, schaal, breedteMm: pw, hoogteMm: ph };
        }
      }
    }
    return { papier: 'custom', liggend: cw > ch, schaal, breedteMm: Math.ceil(cw + 2 * marge), hoogteMm: Math.ceil(ch + 2 * marge) };
  }

  // Passend op papier.
  let pw;
  let ph;
  let naam;
  if (inst?.paper === 'custom') {
    [pw, ph] = [Number(inst.paperWidthMm) || 297, Number(inst.paperHeightMm) || 420];
    naam = 'custom';
  } else {
    const p = papierVan(inst?.paper && inst.paper !== 'auto' ? inst.paper : 'A3');
    const liggend = liggendVoorkeur(b, h);
    [pw, ph] = liggend ? [p.hoogte, p.breedte] : [p.breedte, p.hoogte];
    naam = p.id;
  }
  const beschikbaar = [Math.max(1, pw - 2 * marge), Math.max(1, ph - 2 * marge)];
  const exact = Math.max(b / beschikbaar[0], h / beschikbaar[1]);
  return { papier: naam, liggend: pw > ph, schaal: schaalNaarBoven(exact), breedteMm: pw, hoogteMm: ph };
}

/**
 * Papierkeuze waarmee een layout begint: het papier van de layout zelf. Het
 * onthouden papierformaat hoort bij de modelruimte; op een layout zou het de
 * inhoud stil afkappen (een blad van 841 × 1260 mm op een onthouden A3).
 */
export const LAYOUT_PAPIER_STANDAARD = Object.freeze({
  paper: 'auto', orientation: 'auto', paperWidthMm: 297, paperHeightMm: 420,
});

/**
 * De papierinstellingen die voor een ruimte gelden: voor de modelruimte wat
 * onthouden is (`inst`), voor een layout de keuze die bij die layout gemaakt
 * is (`layoutKeuze`, standaard het papier van de layout).
 * @returns {{paper:string, orientation:string, paperWidthMm:number, paperHeightMm:number}}
 */
export function papierInstellingen(inst, isModel, layoutKeuze) {
  const bron = isModel ? inst : { ...LAYOUT_PAPIER_STANDAARD, ...(layoutKeuze || {}) };
  return {
    paper: bron?.paper || 'auto',
    orientation: bron?.orientation || 'auto',
    paperWidthMm: Number(bron?.paperWidthMm) || 297,
    paperHeightMm: Number(bron?.paperHeightMm) || 420,
  };
}

/**
 * De pagina die een layout krijgt, met dezelfde regels als de omzetting: het
 * papier van de layout (een kwartslag gedraaid geplot wisselt de zijden), een
 * gekozen formaat (liggend of staand naar de inhoud, anders naar het blad) of
 * een eigen maat. `bekend` is false als de layout geen bruikbare papiermaat
 * draagt; dan kiest de omzetting zelf een formaat om de inhoud.
 * @param {{paper:string, orientation:string, paperWidthMm:number, paperHeightMm:number}} keuze
 * @param {{widthMm:number, heightMm:number, rotation:number}|null} layoutPapier  uit de verkenning
 * @param {{breedte:number, hoogte:number}|null} inhoudMm  maat van de inhoud in mm
 * @returns {{papier:string, breedteMm:number, hoogteMm:number, liggend:boolean, bekend:boolean}}
 */
export function layoutPagina(keuze, layoutPapier, inhoudMm) {
  const [lw, lh] = [Number(layoutPapier?.widthMm) || 0, Number(layoutPapier?.heightMm) || 0];
  const gedraaid = Math.abs(Number(layoutPapier?.rotation) || 0) % 2 === 1;
  const [bladB, bladH] = gedraaid ? [lh, lw] : [lw, lh];
  if (keuze?.paper === 'custom') {
    const [b, h] = [Number(keuze.paperWidthMm) || 297, Number(keuze.paperHeightMm) || 420];
    return { papier: 'custom', breedteMm: b, hoogteMm: h, liggend: b > h, bekend: true };
  }
  const formaat = keuze?.paper && keuze.paper !== 'auto' ? papierVan(keuze.paper) : null;
  if (formaat) {
    const liggend = keuze.orientation === 'landscape' ? true
      : keuze.orientation === 'portrait' ? false
        : inhoudMm ? inhoudMm.breedte > inhoudMm.hoogte : lw > lh;
    const [b, h] = liggend ? [formaat.hoogte, formaat.breedte] : [formaat.breedte, formaat.hoogte];
    return { papier: formaat.id, breedteMm: b, hoogteMm: h, liggend, bekend: true };
  }
  const bekend = bladB > 0 && bladH > 0;
  return { papier: 'layout', breedteMm: bekend ? bladB : 0, hoogteMm: bekend ? bladH : 0, liggend: bekend && bladB > bladH, bekend };
}

/**
 * Wat de inhoud van de modelruimte op papier inneemt, in mm: de (gedraaide)
 * maat op schaal, met de marge aan weerszijden.
 */
export function modelInhoudOpPapier(maat, inst, voorstel) {
  if (!maat || !(voorstel?.schaal > 0)) return null;
  const gedraaid = gedraaideMaat(maat, Number(inst?.rotation) || 0);
  const marge = Math.max(0, Number(inst?.marginMm) || 0);
  return { breedte: gedraaid.breedte / voorstel.schaal + 2 * marge, hoogte: gedraaid.hoogte / voorstel.schaal + 2 * marge };
}

/**
 * Past de inhoud niet op het gekozen papier? Geeft dan de maat van de inhoud
 * (voor de waarschuwing), anders null. Het papier van de layout zelf en een
 * onbekende maat geven geen melding: daar kiest de omzetting de pagina om de
 * inhoud. Een halve millimeter speling.
 * @returns {{width:number, height:number} | null}
 */
export function papierTeKlein(inhoudMm, pagina) {
  if (!inhoudMm || !pagina || pagina.bekend === false || pagina.papier === 'layout') return null;
  const speling = 0.5;
  if (inhoudMm.breedte <= pagina.breedteMm + speling && inhoudMm.hoogte <= pagina.hoogteMm + speling) return null;
  return { width: Math.round(inhoudMm.breedte), height: Math.round(inhoudMm.hoogte) };
}

/**
 * Het papier en de schaal voor de statusregel: wat de omzetting werkelijk
 * gebruikt. Modelruimte: het voorstel (zonder voorstel, bijvoorbeeld bij een
 * ongeldig venster, niets). Layout: de pagina van `layoutPagina` op 1:1;
 * `papier: 'layout'` met maat 0 betekent "het papier van de layout", maat
 * onbekend.
 * @returns {{papier:string, breedteMm:number, hoogteMm:number, liggend:boolean, schaal:number} | null}
 */
export function papierSamenvatting(isModel, voorstel, pagina) {
  if (isModel) {
    if (!voorstel) return null;
    return { papier: voorstel.papier, breedteMm: voorstel.breedteMm, hoogteMm: voorstel.hoogteMm, liggend: !!voorstel.liggend, schaal: voorstel.schaal };
  }
  if (!pagina) return null;
  return { papier: pagina.papier, breedteMm: pagina.breedteMm || 0, hoogteMm: pagina.hoogteMm || 0, liggend: !!pagina.liggend, schaal: 1 };
}

/**
 * De melding naast het veld voor de eenheid: het bestand noemt er geen
 * (`noUnits`), of het noemt er een die de import niet kent
 * (`warn_unitsUnsupported`, met de code). Geen melding als de eenheid bekend
 * is of als de gebruiker er zelf een heeft gekozen.
 * @returns {{sleutel:string, value?:number} | null}  sleutel onder `cadImport.`
 */
export function eenheidMelding(units, gekozen) {
  if (!units || units.fromFile || (gekozen && gekozen !== 'file')) return null;
  const code = Number(units.code) || 0;
  return code === 0 ? { sleutel: 'noUnits' } : { sleutel: 'warn_unitsUnsupported', value: code };
}

// ── Tabblad Weergave: kleurentabel, lettertabel, zoekpaden ────────────────
/**
 * Hoogste aantal regels dat het venster bijhoudt. De omzetter kent eigen,
 * ruimere grenzen (`cad_import_limits`); het venster neemt de kleinste van de
 * twee. Een test bewaakt dat deze getallen niet boven die van de omzetter
 * uitkomen.
 */
export const MAX_PENNEN = 256;
export const MAX_LETTERS = 256;
export const MAX_ZOEKPADEN = 16;
/** Dikste lijn in de kleurentabel, in mm (zoals de vaste lijndikte). */
export const MAX_PENDIKTE_MM = 5;

const grens = (max, standaard) => {
  const n = Math.floor(Number(max));
  return max !== undefined && max !== null && Number.isFinite(n) && n >= 0 ? Math.min(n, standaard) : standaard;
};

/** `#RRGGBB` uit `#rrggbb` of `rrggbb`, of null. Dezelfde regel als de omzetter. */
export function kleurTekst(waarde) {
  const tekst = typeof waarde === 'string' ? waarde.trim() : '';
  const hex = tekst.startsWith('#') ? tekst.slice(1) : tekst;
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

/** Een lijndikte in mm uit een getal of getypte tekst, of null. */
export function pendikte(waarde) {
  if (typeof waarde !== 'number' && typeof waarde !== 'string') return null;
  if (typeof waarde === 'string' && !waarde.trim()) return null;
  const mm = Number(typeof waarde === 'string' ? waarde.trim().replace(',', '.') : waarde);
  return Number.isFinite(mm) && mm >= 0 && mm <= MAX_PENDIKTE_MM ? mm : null;
}

/**
 * Maakt de kleurentabel schoon: alleen geldige kleuren en diktes van 0 tot
 * MAX_PENDIKTE_MM. Bij een dubbele kleur telt de laatste regel (zoals in de
 * omzetter), op de plaats van de eerste.
 * @returns {{color:string, lineweightMm:number}[]}
 */
export function schoonPennen(lijst, max) {
  if (!Array.isArray(lijst)) return [];
  const hoogste = grens(max, MAX_PENNEN);
  const uit = new Map();
  for (const regel of lijst) {
    const color = kleurTekst(regel?.color);
    const mm = pendikte(regel?.lineweightMm);
    if (!color || mm === null) continue;
    if (!uit.has(color) && uit.size >= hoogste) continue;
    uit.set(color, mm);
  }
  return [...uit].map(([color, lineweightMm]) => ({ color, lineweightMm }));
}

/** Dikte van een nieuwe regel in de kleurentabel, in mm. */
export const PENDIKTE_STANDAARD_MM = 0.25;

/**
 * De kleurentabel aangevuld met de laagkleuren uit de tekening die er nog niet
 * in staan, in de volgorde van de lagen. Een nieuwe regel begint bij de
 * lijndikte van de (eerste) laag met die kleur, of bij de standaarddikte. Wat
 * er al stond blijft zoals het was.
 * @param {{color:string, lineweightMm:number}[]} pennen
 * @param {{color?:string, lineweightMm?:number|null}[]} lagen  lagen uit de verkenning
 */
export function pennenUitLagen(pennen, lagen, max) {
  const hoogste = grens(max, MAX_PENNEN);
  const uit = schoonPennen(pennen, hoogste);
  const bekend = new Set(uit.map((p) => p.color));
  for (const laag of Array.isArray(lagen) ? lagen : []) {
    if (uit.length >= hoogste) break;
    const color = kleurTekst(laag?.color);
    if (!color || bekend.has(color)) continue;
    bekend.add(color);
    const vanLaag = pendikte(laag?.lineweightMm);
    uit.push({ color, lineweightMm: vanLaag !== null && vanLaag > 0 ? vanLaag : PENDIKTE_STANDAARD_MM });
  }
  return uit;
}

/**
 * Een nieuwe, lege regel erbij: de eerste kleur uit `voorkeur` (de laagkleuren)
 * die nog geen regel heeft, anders zwart, anders de eerste vrije grijstint.
 * Geeft de lijst ongewijzigd terug als ze vol is.
 */
export function metNieuwePen(pennen, voorkeur, max) {
  const hoogste = grens(max, MAX_PENNEN);
  const uit = schoonPennen(pennen, hoogste);
  if (uit.length >= hoogste) return uit;
  const bekend = new Set(uit.map((p) => p.color));
  const kandidaten = [...(Array.isArray(voorkeur) ? voorkeur : []).map(kleurTekst), '#000000'];
  let color = kandidaten.find((k) => k && !bekend.has(k));
  for (let g = 1; !color && g < 256; g += 1) {
    const hex = g.toString(16).padStart(2, '0').toUpperCase();
    if (!bekend.has(`#${hex}${hex}${hex}`)) color = `#${hex}${hex}${hex}`;
  }
  return color ? [...uit, { color, lineweightMm: PENDIKTE_STANDAARD_MM }] : uit;
}

/**
 * Wijzigt de kleur van regel `index`. Geweigerd (`null`) als de kleur ongeldig
 * is of al een andere regel heeft: twee regels voor één kleur zou de omzetter
 * stil samenvoegen.
 */
export function metPenKleur(pennen, index, kleur) {
  const color = kleurTekst(kleur);
  if (!color || !Array.isArray(pennen) || !pennen[index]) return null;
  if (pennen.some((p, i) => i !== index && kleurTekst(p?.color) === color)) return null;
  return pennen.map((p, i) => (i === index ? { ...p, color } : p));
}

/** De woorden van een letternaam, zoals de omzetter ze leest (`name_words`). */
function naamWoorden(naam) {
  const woorden = [];
  let woord = '';
  let vorigeKlein = false;
  for (const c of naam) {
    if (!/[\p{L}\p{N}]/u.test(c)) {
      if (woord) woorden.push(woord);
      woord = '';
      vorigeKlein = false;
      continue;
    }
    const hoofd = c !== c.toLowerCase();
    if (hoofd && vorigeKlein && woord) {
      woorden.push(woord);
      woord = '';
    }
    vorigeKlein = c !== c.toUpperCase();
    woord += c.toLowerCase();
  }
  if (woord) woorden.push(woord);
  return woorden;
}

/** Woorden die met "mono" beginnen en wél een letter met vaste breedte noemen (als in de omzetter). */
const VASTE_BREEDTE_WOORDEN = Object.freeze(['monotxt', 'monofur', 'monoid', 'mono821']);

/**
 * De letter die de omzetter zonder regel kiest, geraden uit de naam. Dezelfde
 * regel als `FontMap::guess`: "mono" telt alleen als woord.
 * @returns {{family:'sans'|'mono', bold:boolean, italic:boolean}}
 */
export function raadLetter(naam) {
  const bestand = String(naam ?? '').split(/[\\/]/).pop();
  const stam = bestand.toLowerCase();
  const monoWoord = naamWoorden(bestand)
    .some((w) => w.endsWith('mono') || w.startsWith('monospac') || VASTE_BREEDTE_WOORDEN.includes(w));
  return {
    family: monoWoord || stam.includes('courier') || stam.includes('consol') ? 'mono' : 'sans',
    bold: stam.includes('bold') || stam.includes('black') || stam.includes('heavy'),
    italic: stam.includes('italic') || stam.includes('oblique'),
  };
}

/** Langste letternaam die het venster onthoudt. */
const MAX_LETTERNAAM = 260;
const letterSleutel = (naam) => String(naam ?? '').trim().toLowerCase();

/**
 * Maakt de lettertabel schoon: een naam uit de tekening en een letterfamilie
 * die de omzetter kent. Bij een dubbele naam (hoofdletters tellen niet) wint
 * de laatste regel, op de plaats van de eerste.
 * @returns {{from:string, family:'sans'|'mono', bold:boolean, italic:boolean}[]}
 */
export function schoonLetters(lijst, max) {
  if (!Array.isArray(lijst)) return [];
  const hoogste = grens(max, MAX_LETTERS);
  const uit = new Map();
  for (const regel of lijst) {
    const from = typeof regel?.from === 'string' ? regel.from.trim() : '';
    // Stuurtekens horen niet in een naam; zo'n regel komt niet uit het venster.
    if (!from || from.length > MAX_LETTERNAAM || /[\x00-\x1f\x7f]/.test(from)) continue;
    if (regel.family !== 'sans' && regel.family !== 'mono') continue;
    const sleutel = letterSleutel(from);
    if (!uit.has(sleutel) && uit.size >= hoogste) continue;
    uit.set(sleutel, {
      from: uit.get(sleutel)?.from || from,
      family: regel.family,
      bold: regel.bold === true,
      italic: regel.italic === true,
    });
  }
  return [...uit.values()];
}

/** De letternamen uit de verkenning, elk één keer, in de volgorde van het bestand. */
export function lettersVanScan(scan) {
  const uit = [];
  const gezien = new Set();
  for (const item of Array.isArray(scan?.fonts) ? scan.fonts : []) {
    const naam = typeof item?.font === 'string' ? item.font.trim() : '';
    if (!naam || gezien.has(letterSleutel(naam))) continue;
    gezien.add(letterSleutel(naam));
    uit.push(naam);
    if (uit.length >= MAX_LETTERS) break;
  }
  return uit;
}

/**
 * De regels van de lettertabel voor deze tekening: elke letter uit het bestand
 * met de onthouden keuze, of anders met wat de omzetter uit de naam raadt
 * (`eigen: false`).
 * @returns {{from:string, family:string, bold:boolean, italic:boolean, eigen:boolean}[]}
 */
export function lettersVoorTekening(scan, regels) {
  const onthouden = new Map(schoonLetters(regels).map((r) => [letterSleutel(r.from), r]));
  return lettersVanScan(scan).map((from) => {
    const regel = onthouden.get(letterSleutel(from));
    return regel ? { ...regel, from, eigen: true } : { from, ...raadLetter(from), eigen: false };
  });
}

/**
 * Zet een keuze in de lettertabel. Een keuze die gelijk is aan wat de omzetter
 * zelf raadt, is geen regel: ze valt weg, zodat de onthouden tabel klein
 * blijft. Een nieuwe regel in een volle tabel verdringt de oudste.
 */
export function metLetterRegel(regels, regel, max) {
  const hoogste = grens(max, MAX_LETTERS);
  const [nieuw] = schoonLetters([regel]);
  const rest = schoonLetters(regels, hoogste).filter((r) => letterSleutel(r.from) !== letterSleutel(regel?.from));
  if (!nieuw) return rest;
  const geraden = raadLetter(nieuw.from);
  if (geraden.family === nieuw.family && geraden.bold === nieuw.bold && geraden.italic === nieuw.italic) return rest;
  return hoogste > 0 ? [...rest, nieuw].slice(-hoogste) : [];
}

/** Zoekpaden: tekst, niet leeg, geen dubbele, hoogstens MAX_ZOEKPADEN. */
export function schoonZoekpaden(lijst, max) {
  if (!Array.isArray(lijst)) return [];
  const hoogste = grens(max, MAX_ZOEKPADEN);
  const uit = [];
  const gezien = new Set();
  for (const pad of lijst) {
    const schoon = typeof pad === 'string' ? pad.trim() : '';
    // Hoofdletters en de schuine streep aan het eind maken geen andere map.
    const sleutel = schoon.replace(/[\\/]+$/, '').toLowerCase();
    if (!schoon || schoon.length > 1024 || /[\x00-\x1f\x7f]/.test(schoon) || gezien.has(sleutel)) continue;
    if (uit.length >= hoogste) break;
    gezien.add(sleutel);
    uit.push(schoon);
  }
  return uit;
}

/** Drempel van "zuiver zwart-wit": standaard, en als heel percentage van 0 tot 100. */
export const MONO_DREMPEL_STANDAARD = 50;
export function drempelProcent(waarde) {
  const n = typeof waarde === 'number' || (typeof waarde === 'string' && waarde.trim()) ? Number(waarde) : NaN;
  return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : MONO_DREMPEL_STANDAARD;
}

/** Grootste afbeelding die het venster toelaat, in megapixels (de grens van de omzetter). */
export const MAX_MEGAPIXELS = 200;

/**
 * De grens op beeldpunten per afbeelding voor de omzetter, uit het veld in
 * megapixels. `null` als het veld op zijn hoogste stand staat of onbruikbaar
 * is: dan geldt de grens van de omzetter zelf. Nooit meer dan `plafond`
 * (`cad_import_limits().maxImagePixels`).
 */
export function beeldpuntenGrens(megapixels, plafond) {
  const mp = Number(megapixels);
  if (typeof megapixels === 'boolean' || megapixels === null || !Number.isFinite(mp) || mp < 1 || mp >= MAX_MEGAPIXELS) return null;
  const punten = Math.round(mp * 1e6);
  const hoogste = Number(plafond);
  return Number.isFinite(hoogste) && hoogste > 0 ? Math.min(punten, hoogste) : punten;
}

/**
 * Argumenten voor het Tauri-commando `import_cad_to_pdf`.
 * @param {object} inst  instellingen (zie cad-import-instellingen.js)
 * @param {object} o
 * @param {string} o.path        pad van de tekening
 * @param {string} o.outputPath  pad van de PDF
 * @param {string[]} o.spaces    ruimtes (model of layoutnamen)
 * @param {string[]} [o.excludedLayers]
 * @param {string[]} [o.hiddenLayers]
 * @param {number[] | null} [o.window]  eigen venster in tekeningeenheden
 * @param {string} [o.doel]  'new', 'append' of 'underlay'
 */
export function importArgumenten(inst, o) {
  // Op de huidige pagina komt alleen de inhoud van het blad (als knipsel of
  // afbeelding); /VP, /Measure en /OPS_ModelMatrix van de omgezette PDF gaan
  // daarbij verloren. Ze vragen zou doen alsof ze geschreven worden.
  const onderlegger = o.doel === 'underlay';
  const args = {
    path: o.path,
    outputPath: o.outputPath,
    spaces: o.spaces?.length ? o.spaces : ['model'],
    excludedLayers: o.excludedLayers || [],
    hiddenLayers: o.hiddenLayers || [],
    layersAsOcg: inst.layersAsOcg !== false,
    area: inst.area,
    paper: inst.paper,
    orientation: inst.orientation,
    marginMm: inst.marginMm,
    placement: inst.placement,
    rotation: inst.rotation,
    measure: !onderlegger && inst.measure !== false,
    modelMatrix: !onderlegger && inst.modelMatrix !== false,
    colors: inst.colors,
    linetypes: inst.linetypes !== false,
    text: inst.text !== false,
    hatch: inst.hatch,
    dimensions: inst.dimensions !== false,
    attributes: inst.attributes !== false,
    points: inst.points === true,
    lineweight: inst.lineweight,
    lineweightFactor: inst.lineweightFactor,
    lineweightMinMm: inst.lineweightMinMm,
    // De kleurentabel gaat alleen mee in de stand die hem gebruikt; de
    // lettertabel, de verwijzingen en de afbeeldingen gelden altijd.
    pens: inst.lineweight === 'pens' ? schoonPennen(inst.pens, o.limits?.maxPens) : [],
    fonts: schoonLetters(inst.fonts, o.limits?.maxFontRules),
    xrefs: inst.xrefs !== false,
    images: inst.images !== false,
    searchPaths: schoonZoekpaden(inst.searchPaths, o.limits?.maxSearchPaths),
    reuseBlocks: inst.reuseBlocks !== false,
  };
  if (inst.colors === 'mono') args.monoThreshold = drempelProcent(inst.monoThreshold);
  if (inst.colors === 'single') args.singleColor = kleurTekst(inst.singleColor) || '#000000';
  const beeldpunten = beeldpuntenGrens(inst.maxImageMegapixels, o.limits?.maxImagePixels);
  if (beeldpunten) args.maxImagePixels = beeldpunten;
  if (inst.units && inst.units !== 'file') args.units = inst.units;
  if (inst.placement === 'origin' && inst.ownBasePoint) {
    args.basePoint = [Number(inst.basePointX) || 0, Number(inst.basePointY) || 0];
  }
  if (Number(inst.scale) > 0) args.scale = Number(inst.scale);
  if (inst.paper === 'custom') {
    args.paperWidthMm = Number(inst.paperWidthMm) || 297;
    args.paperHeightMm = Number(inst.paperHeightMm) || 420;
  }
  if (inst.lineweight === 'fixed') args.lineweightMm = Number(inst.lineweightMm) || 0.25;
  if (inst.area === 'window' && o.window?.length === 4) args.window = o.window;
  return args;
}

const FASE_SLEUTEL = Object.freeze({ read: 'phaseRead', scan: 'phaseScan', draw: 'phaseDraw', write: 'phaseWrite', open: 'phaseOpen' });

/**
 * Wat de voet van het venster toont bij een voortgangsmelding: de tekstsleutel
 * (onder `cadImport.`) en het percentage, of `null` als het totaal onbekend is
 * (dan is de balk onbepaald). Het lezen van een DWG kent geen totaal; tijdens
 * het verkennen staat er dan "tekening lezen" zonder percentage.
 * @param {{phase:string, done:number, total:number}|null} voortgang
 * @param {string} bezigMet  'scan' of 'import'
 * @returns {{sleutel:string, pct:number|null}}
 */
export function faseWeergave(voortgang, bezigMet) {
  const verkennen = bezigMet === 'scan';
  if (!voortgang) return { sleutel: verkennen ? 'reading' : 'phaseRead', pct: null };
  const totaal = Number(voortgang.total);
  const klaar = Number(voortgang.done);
  // Alleen een percentage als beide getallen er zijn: nooit "NaN%".
  const telbaar = Number.isFinite(totaal) && totaal > 0 && Number.isFinite(klaar);
  const pct = telbaar ? Math.max(0, Math.min(100, Math.round((100 * klaar) / totaal))) : null;
  if (verkennen && voortgang.phase === 'read' && pct === null) return { sleutel: 'reading', pct: null };
  return { sleutel: FASE_SLEUTEL[voortgang.phase] || 'phaseRead', pct };
}

/**
 * Waarschuwingen uit de crate (`xrefs:3`) naar sleutel en aantal, zodat het
 * venster ze in de taal van de gebruiker kan tonen.
 */
export function leesWaarschuwingen(lijst) {
  return (lijst || []).map((regel) => {
    const [sleutel, waarde] = String(regel).split(':');
    const aantal = Number(waarde);
    return { sleutel, aantal: Number.isFinite(aantal) ? aantal : null, waarde: waarde ?? '' };
  });
}

/** Hoeveel namen één regel van het venster hooguit noemt. */
const MAX_NAMEN_PER_REGEL = 12;

const BUITEN_GROEPEN = Object.freeze([
  { sleutel: 'externalsFound', statussen: ['found'] },
  { sleutel: 'externalsUsed', statussen: ['loaded'] },
  { sleutel: 'externalsMissing', statussen: ['missing'] },
  { sleutel: 'externalsRefused', statussen: ['refused', 'oddName', 'tooLarge', 'unsupported'] },
]);

/**
 * De bestanden van buiten de tekening (externe verwijzingen en afbeeldingen)
 * zoals het venster ze toont: per uitkomst één regel met de bestandsnamen. De
 * verkenning levert `found`/`missing`/`refused`, het importverslag `loaded` en
 * de redenen waarom iets niet meekwam. Er komen alleen namen in beeld, nooit
 * een pad; een lange of afgekapte lijst eindigt op een beletselteken.
 * @param {{name:string, kind:string, status:string}[]} lijst
 * @param {boolean} afgekapt  het verslag noemde niet alles
 * @returns {{sleutel:string, namen:string}[]}  sleutel onder `cadImport.`
 */
export function buitenBestanden(lijst, afgekapt) {
  const uit = [];
  for (const groep of BUITEN_GROEPEN) {
    const namen = [];
    for (const item of lijst || []) {
      if (!groep.statussen.includes(item?.status) || typeof item?.name !== 'string') continue;
      const naam = item.name.split(/[\\/]/).pop().trim();
      if (naam && !namen.includes(naam)) namen.push(naam);
    }
    if (!namen.length) continue;
    const getoond = namen.slice(0, MAX_NAMEN_PER_REGEL);
    if (namen.length > getoond.length || afgekapt) getoond.push('…');
    uit.push({ sleutel: groep.sleutel, namen: getoond.join(', ') });
  }
  return uit;
}

/**
 * Fout uit de omzetting naar een sleutel (onder `cadImport.`) met waarden,
 * zodat het venster hem in de taal van de gebruiker kan tonen. De crate geeft
 * vaste voorvoegsels (`IMPORT_CANCELLED`, `IMPORT_EMPTY:…`, …).
 */
export function leesImportFout(fout) {
  const tekst = String(fout?.message ?? fout ?? '');
  // Een te lange tabel wordt geweigerd terwijl de app de argumenten leest; de
  // vaste code staat dan midden in de melding van de app.
  const teLang = /IMPORT_ARGS_TOO_LONG:(\w+):(\d+)/.exec(tekst);
  if (teLang) return { sleutel: 'argsTooLong', field: teLang[1], max: teLang[2] };
  const [code, ...rest] = tekst.split(':');
  const waarde = rest.join(':');
  switch (code) {
    case 'IMPORT_CANCELLED': return { sleutel: 'cancelled' };
    case 'IMPORT_TOO_COMPLEX': return { sleutel: 'tooComplex' };
    case 'IMPORT_INSERT_FAILED': return { sleutel: 'insertFailed' };
    case 'IMPORT_EMPTY': return { sleutel: 'emptySpace' };
    case 'IMPORT_PAGE_TOO_LARGE': return { sleutel: 'pageTooLarge', width: rest[0] || '', height: rest[1] || '' };
    case 'IMPORT_TOO_OLD': return { sleutel: 'tooOld', version: waarde };
    case 'IMPORT_READ': return { sleutel: 'readFailed', error: waarde };
    case 'IMPORT_IO': return { sleutel: 'failed', error: waarde };
    case 'IMPORT_EXISTS': return { sleutel: 'exists', path: waarde };
    case 'IMPORT_WINDOW_INVALID': return { sleutel: 'windowInvalid' };
    default: return { sleutel: 'failed', error: tekst };
  }
}

/** Naam voor de PDF naast een tekening: `plan.dwg` → `plan.pdf`. */
export function pdfNaamVoor(pad) {
  const naam = String(pad || '').split(/[\\/]/).pop() || 'tekening';
  const punt = naam.lastIndexOf('.');
  return `${punt > 0 ? naam.slice(0, punt) : naam}.pdf`;
}

/** Map van een pad (met scheidingsteken aan het eind), of leeg. */
export function mapVan(pad) {
  const s = String(pad || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(0, i + 1) : '';
}

/** Bytes kort weergeven. */
export function grootteTekst(bytes, decimaal = ',') {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${(Math.round(kb * 10) / 10).toString().replace('.', decimaal)} kB`;
  return `${(Math.round((kb / 1024) * 10) / 10).toString().replace('.', decimaal)} MB`;
}

/** Naam van een OCG-woordenboek (of null). */
function ocgNaam(dict, PDFName) {
  const naam = dict?.lookup?.(PDFName.of('Name'));
  try { return naam?.decodeText ? naam.decodeText() : null; } catch { return null; }
}

/** Namen van de lagen die in een document standaard uit staan (`/D /OFF`). */
function lagenUit(doc, { PDFName, PDFArray, PDFDict }) {
  const uit = new Set();
  const oc = doc?.catalog?.lookup?.(PDFName.of('OCProperties'));
  const d = oc instanceof PDFDict ? oc.lookup(PDFName.of('D')) : null;
  const off = d instanceof PDFDict ? d.lookup(PDFName.of('OFF')) : null;
  if (!(off instanceof PDFArray)) return uit;
  for (let i = 0; i < off.size(); i++) {
    const naam = ocgNaam(off.lookup(i), PDFName);
    if (naam) uit.add(naam);
  }
  return uit;
}

/** Sleutel waarmee de import een voorbeeld-PDF merkt (catalogus en pagina's). */
export const VOORBEELD_MERK = 'OPS_Preview';

/**
 * Is dit een voorbeeld-PDF van het importvenster? Zo'n bestand kan bij een
 * zware tekening arceringen, tekst en maatvoering missen en draagt daarom
 * `/OPS_Preview true` in de catalogus en op elke pagina. Het merk op één
 * pagina is genoeg: dan zijn er pagina's uit een voorbeeld overgenomen.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {{PDFName: any}} pdfLib
 */
export function isVoorbeeldPdf(pdfDoc, pdfLib) {
  if (!pdfDoc || !pdfLib?.PDFName) return false;
  const sleutel = pdfLib.PDFName.of(VOORBEELD_MERK);
  const gemerkt = (dict) => {
    try { return dict?.lookup?.(sleutel)?.asBoolean?.() === true; } catch { return false; }
  };
  if (gemerkt(pdfDoc.catalog)) return true;
  try { return pdfDoc.getPages().some((pagina) => gemerkt(pagina.node)); } catch { return false; }
}

/**
 * Zet de PDF-lagen (OCG's) van ingevoegde pagina's in `/OCProperties` van het
 * doeldocument. pdf-lib kopieert de laagverwijzingen in de inhoud wel mee,
 * maar niet de lagenlijst van de catalogus; zonder deze stap kent het
 * lagenpaneel ze niet. Een laag die in de bron standaard uit stond (een
 * uitgezette laag die verborgen meekwam) staat ook in het doel uit, en een
 * naam die al bestaat krijgt de herkomst erbij, zodat twee imports in
 * hetzelfde document uit elkaar te houden zijn.
 * @param {import('pdf-lib').PDFDocument} destDoc
 * @param {import('pdf-lib').PDFPage[]} paginas  de zojuist gekopieerde pagina's
 * @param {object} pdfLib  { PDFName, PDFArray, PDFDict, PDFString, PDFHexString }
 * @param {import('pdf-lib').PDFDocument} [bronDoc]  voor de standaardzichtbaarheid
 * @param {string} [herkomst]  naam van het bronbestand, voor dubbele laagnamen
 * @returns {number} aantal toegevoegde lagen
 */
export function voegLagenSamen(destDoc, paginas, pdfLib, bronDoc, herkomst = '') {
  const { PDFName, PDFArray, PDFDict, PDFString, PDFHexString } = pdfLib;
  const ocgs = [];
  // Inline lagen die al een eigen object kregen, op inhoud: dezelfde laag op
  // meerdere pagina's wordt één object, niet per pagina een nieuwe laag.
  const inlineGeregistreerd = new Map();
  for (const pagina of paginas || []) {
    const resources = pagina.node?.Resources?.();
    const props = resources?.lookup?.(PDFName.of('Properties'));
    if (!(props instanceof PDFDict)) continue;
    for (const key of props.keys()) {
      let ref = props.get(key);
      let dict = destDoc.context.lookup(ref);
      // Alleen echte lagen; /Properties bevat ook markeringen van getagde PDF's.
      if (!(dict instanceof PDFDict) || dict.lookup(PDFName.of('Type'))?.toString() !== '/OCG') continue;
      if (ref instanceof PDFDict) {
        // Een laag die rechtstreeks in /Properties staat: /OCProperties mag
        // alleen verwijzingen bevatten, dus eerst een eigen object maken.
        const inhoud = dict.toString();
        if (!inlineGeregistreerd.has(inhoud)) inlineGeregistreerd.set(inhoud, destDoc.context.register(dict));
        ref = inlineGeregistreerd.get(inhoud);
        props.set(key, ref);
      }
      if (!ocgs.some((o) => String(o) === String(ref))) ocgs.push(ref);
    }
  }
  if (!ocgs.length) return 0;
  const bronUit = bronDoc ? lagenUit(bronDoc, pdfLib) : new Set();
  const catalog = destDoc.catalog;
  const lijst = (ouder, naam, beginwaarde = []) => {
    let arr = ouder.lookup(PDFName.of(naam));
    if (!(arr instanceof PDFArray)) {
      arr = destDoc.context.obj([]);
      for (const item of beginwaarde) arr.push(item);
      ouder.set(PDFName.of(naam), arr);
    }
    return arr;
  };
  let ocProps = catalog.lookup(PDFName.of('OCProperties'));
  if (!(ocProps instanceof PDFDict)) {
    ocProps = destDoc.context.obj({});
    catalog.set(PDFName.of('OCProperties'), ocProps);
  }
  const alle = lijst(ocProps, 'OCGs');
  const bestaandeRefs = alle.asArray().slice();
  let d = ocProps.lookup(PDFName.of('D'));
  if (!(d instanceof PDFDict)) {
    d = destDoc.context.obj({});
    ocProps.set(PDFName.of('D'), d);
  }
  // Een nieuwe volgorde begint met de lagen die er al waren; anders raken die
  // uit het lagenpaneel.
  const order = lijst(d, 'Order', bestaandeRefs);
  const bestaandeNamen = new Set(
    bestaandeRefs.map((ref) => ocgNaam(destDoc.context.lookup(ref), PDFName)).filter(Boolean),
  );
  const bestaand = new Set(bestaandeRefs.map((r) => String(r)));
  let toegevoegd = 0;
  for (const ref of ocgs) {
    if (bestaand.has(String(ref))) continue;
    const dict = destDoc.context.lookup(ref);
    const origineel = ocgNaam(dict, PDFName);
    let naam = origineel;
    if (naam && bestaandeNamen.has(naam)) {
      const achtervoegsel = herkomst ? ` (${herkomst})` : ' (2)';
      let uniek = `${naam}${achtervoegsel}`;
      for (let n = 2; bestaandeNamen.has(uniek); n += 1) uniek = `${naam}${achtervoegsel} ${n}`;
      // Als UTF-16: een letterlijke tekenreeks kent alleen PDFDocEncoding en
      // zou een naam met andere tekens (ä, –, 壁) verminken.
      try {
        dict.set(PDFName.of('Name'), PDFHexString ? PDFHexString.fromText(uniek) : PDFString.of(uniek));
      } catch { /* laat de naam staan */ }
      naam = uniek;
    }
    if (naam) bestaandeNamen.add(naam);
    alle.push(ref);
    order.push(ref);
    lijst(d, origineel && bronUit.has(origineel) ? 'OFF' : 'ON').push(ref);
    toegevoegd += 1;
  }
  return toegevoegd;
}

/**
 * Wachtrij voor tekeningen die nog geïmporteerd moeten worden: het venster
 * kan er maar één tegelijk aan, en meerdere bestanden tegelijk openen of
 * slepen mag geen enkele stilletjes laten vallen.
 */
export function maakWachtrij() {
  const rij = [];
  const luisteraars = new Set();
  const meld = () => {
    for (const cb of luisteraars) {
      try { cb(rij.length); } catch { /* een luisteraar die valt, houdt de rij niet op */ }
    }
  };
  return {
    voegToe(pad) {
      if (!isCadTekening(pad) || rij.includes(pad)) return false;
      rij.push(pad);
      meld();
      return true;
    },
    volgende() {
      const pad = rij.shift() || null;
      if (pad) meld();
      return pad;
    },
    /** Wacht deze tekening nog? Wat uitgedeeld is, staat er niet meer in. */
    bevat(pad) {
      return rij.includes(pad);
    },
    get lengte() {
      return rij.length;
    },
    leeg() {
      if (!rij.length) return;
      rij.length = 0;
      meld();
    },
    /**
     * Roept `cb(aantal)` aan bij elke wijziging, zodat het venster kan tonen
     * hoeveel tekeningen nog wachten. Geeft de afmeldfunctie terug.
     */
    luister(cb) {
      luisteraars.add(cb);
      return () => luisteraars.delete(cb);
    },
  };
}

/** Is het venstergebied geldig (rechtsboven ligt boven links-onder)? */
export function vensterGeldig(venster) {
  const v = [venster?.x0, venster?.y0, venster?.x1, venster?.y1].map(Number);
  return v.every((n) => Number.isFinite(n)) && v[2] > v[0] && v[3] > v[1];
}
