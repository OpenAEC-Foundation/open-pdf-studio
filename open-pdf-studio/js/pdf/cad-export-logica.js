// Pure rekenregels achter het exportvenster voor DXF/DWG (#400). Geen imports
// uit de app, zodat de unit-tests ze onder node kunnen draaien.

/** Punten per millimeter (1 pt = 1/72 inch). */
export const PT_PER_MM = 72 / 25.4;
/** Millimeters per punt. */
export const MM_PER_PT = 25.4 / 72;
/** Standaardgrens: boven dit aantal objecten per bestand vraagt de app eerst. */
export const MAX_ENTITEITEN = 750000;

/** Millimeters per eenheid van de maatvoering van de app. */
export const MM_PER_EENHEID = Object.freeze({ mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 });

/**
 * Schaalnoemer N (van 1:N) uit een meetschaal van de app.
 * `pixelsPerUnit` is het aantal PDF-punten per eenheid.
 * @param {{pixelsPerUnit?: number, unit?: string} | null | undefined} schaal
 * @returns {number | null} null als er geen bruikbare meetschaal is
 */
export function schaalnoemerUitMeetschaal(schaal) {
  const ppu = Number(schaal?.pixelsPerUnit);
  const mmPerEenheid = MM_PER_EENHEID[schaal?.unit] ?? null;
  if (!(ppu > 0) || !Number.isFinite(ppu) || mmPerEenheid === null) return null;
  // De app geeft zonder kalibratie { pixelsPerUnit: 1, unit: 'mm' }: 1 pt per
  // mm is geen echte schaal (1:2,83) maar "niets ingesteld".
  if (ppu === 1 && schaal.unit === 'mm') return null;
  const mmPerPunt = mmPerEenheid / ppu;
  return mmPerPunt / MM_PER_PT;
}

/**
 * Schaal als tekst: 1:50, 1:2,5 of 5:1.
 * @param {number} n  schaalnoemer
 * @param {string} [decimaal] decimaalteken
 */
export function schaalTekst(n, decimaal = ',') {
  if (!(n > 0) || !Number.isFinite(n)) return '';
  const rond = (v) => {
    const r = Math.round(v * 100) / 100;
    return String(r).replace('.', decimaal);
  };
  if (n >= 1) return `1:${rond(n)}`;
  return `${rond(1 / n)}:1`;
}

/**
 * Rechthoek uit de app-ruimte (linksboven, y omlaag, punten) naar de
 * weergegeven pagina met oorsprong linksonder: [x, y, breedte, hoogte].
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {number} paginaHoogtePt  hoogte van de weergegeven pagina in punten
 */
export function appRechthoekNaarWeergave(rect, paginaHoogtePt) {
  const x = Math.min(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height);
  const w = Math.abs(rect.width);
  const h = Math.abs(rect.height);
  return [x, paginaHoogtePt - top - h, w, h];
}

/**
 * Venster in millimeters op papier (oorsprong linksonder) naar punten.
 * @param {{x:number,y:number,breedte:number,hoogte:number}} venster
 * @returns {number[] | null}
 */
export function vensterNaarWeergave(venster) {
  const w = Number(venster?.breedte);
  const h = Number(venster?.hoogte);
  const x = Number(venster?.x) || 0;
  const y = Number(venster?.y) || 0;
  if (!(w > 0) || !(h > 0)) return null;
  return [x * PT_PER_MM, y * PT_PER_MM, w * PT_PER_MM, h * PT_PER_MM];
}

/**
 * Weergegeven paginamaat in punten, uit de ongedraaide maat en /Rotate.
 */
export function weergaveMaat(breedtePt, hoogtePt, rotatie) {
  const r = (((Number(rotatie) || 0) % 360) + 360) % 360;
  return r === 90 || r === 270 ? { breedte: hoogtePt, hoogte: breedtePt } : { breedte: breedtePt, hoogte: hoogtePt };
}

/**
 * Doelbestand per pagina: één pagina schrijft naar het gekozen pad, meerdere
 * pagina's krijgen `_p<nummer>` achter de naam.
 * @param {string} pad        gekozen bestand
 * @param {number[]} paginas  1-gebaseerde paginanummers
 * @returns {Map<number,string>}
 */
export function bestandenPerPagina(pad, paginas) {
  const uit = new Map();
  if (!pad || !paginas?.length) return uit;
  if (paginas.length === 1) {
    uit.set(paginas[0], pad);
    return uit;
  }
  const scheiding = Math.max(pad.lastIndexOf('/'), pad.lastIndexOf('\\'));
  const punt = pad.lastIndexOf('.');
  const heeftExtensie = punt > scheiding;
  const stam = heeftExtensie ? pad.slice(0, punt) : pad;
  const ext = heeftExtensie ? pad.slice(punt) : '';
  for (const p of paginas) uit.set(p, `${stam}_p${p}${ext}`);
  return uit;
}

/** Bestandsextensie per formaat. */
export function extensieVoor(formaat) {
  return formaat === 'dwg' ? 'dwg' : 'dxf';
}

/**
 * Formaat dat bij een getypt of gekozen doelbestand hoort: `.dwg` wordt DWG,
 * `.dxf` wordt DXF (tekst of binair blijft zoals het was). Andere of
 * ontbrekende extensies laten het formaat ongemoeid.
 */
export function formaatUitPad(pad, huidig) {
  const m = /\.([^.\\/]+)$/.exec(String(pad || '').trim());
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'dwg') return 'dwg';
  if (ext === 'dxf') return huidig === 'dxf_binary' ? 'dxf_binary' : 'dxf';
  return huidig;
}

/**
 * Doelbestand met de extensie van het formaat: vervangt `.dxf`/`.dwg` en
 * voegt de extensie toe als die ontbreekt. Een lege naam blijft leeg.
 */
export function padMetFormaat(pad, formaat) {
  const p = String(pad || '').trim().replace(/\.+$/, '');
  if (!p) return '';
  const ext = extensieVoor(formaat);
  const scheiding = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const punt = p.lastIndexOf('.');
  if (punt > scheiding + 1) {
    const huidige = p.slice(punt + 1).toLowerCase();
    if (huidige === 'dxf' || huidige === 'dwg') return p.slice(0, punt + 1) + ext;
  }
  return `${p}.${ext}`;
}

/** Basisnaam van een PDF zonder map en extensie. */
export function basisnaam(pad) {
  const naam = String(pad || '').split(/[\\/]/).pop() || 'tekening';
  const punt = naam.lastIndexOf('.');
  return punt > 0 ? naam.slice(0, punt) : naam;
}

/**
 * Argumenten voor het Tauri-commando `export_page_to_cad` (en de telronde).
 * @param {object} inst  instellingen (zie cad-export-instellingen.js)
 * @param {object} o
 * @param {string} o.pdfPath
 * @param {number} o.pageIndex           0-gebaseerd
 * @param {string} [o.outputPath]
 * @param {number | null} [o.schaalnoemer]  null = papiermaat
 * @param {number[] | null} [o.gebied]      [x, y, b, h] in punten, oorsprong linksonder
 * @param {string[]} [o.uitgeslotenLagen]
 * @param {number | null} [o.maxEntiteiten]
 */
export function exportArgumenten(inst, o) {
  const args = {
    pdfPath: o.pdfPath,
    pageIndex: o.pageIndex,
    outputPath: o.outputPath || '',
    format: inst.format === 'dxf_binary' ? 'dxf_binary' : inst.format === 'dwg' ? 'dwg' : 'dxf',
    version: inst.version,
    units: inst.units,
    curves: inst.curves,
    curveToleranceMm: inst.curveToleranceMm,
    mergeCollinear: inst.mergeCollinear,
    joinConnected: inst.joinConnected,
    layers: inst.layers,
    fills: inst.fills,
    skipPageFills: inst.skipPageFills,
    text: inst.text ? 'text' : 'skip',
    textHeightFactor: inst.textHeightFactor,
    annotations: inst.annotations,
    origin: inst.origin,
    offsetX: inst.offsetX,
    offsetY: inst.offsetY,
  };
  if (o.schaalnoemer && o.schaalnoemer > 0) args.scaleDenominator = o.schaalnoemer;
  if (o.gebied) args.area = o.gebied;
  if (o.uitgeslotenLagen?.length) args.excludedLayers = o.uitgeslotenLagen;
  if (o.maxEntiteiten) args.maxEntities = o.maxEntiteiten;
  return args;
}

/**
 * Kan de oorsprong "modelcoördinaten" op deze pagina's iets opleveren? De
 * terugweg naar CAD staat in de viewports van de pagina (`/VP` met
 * `/OPS_ModelMatrix`, geschreven door de import). De app leest de viewports
 * al (`doc.pdfViewports`, per pagina een lijst), maar niet of ze een matrix
 * dragen; zonder enige viewport is de keuze zeker zinloos en staat ze uit.
 * Met viewports zonder matrix meldt de export zelf `NO_MODEL_SPACE`.
 * @param {Record<number, unknown[]> | undefined} pdfViewports
 * @param {number[]} paginas  1-gebaseerd
 */
export function modelOorsprongMogelijk(pdfViewports, paginas) {
  return (paginas || []).some((p) => Array.isArray(pdfViewports?.[p])
    && pdfViewports[p].some((v) => v.heeftModelMatrix === true));
}

/**
 * Herkent de fout "te veel objecten" van de export.
 * @returns {{entities:number, limit:number} | null}
 */
export function leesTeGroot(fout) {
  const m = /TOO_LARGE:(\d+):(\d+)/.exec(String(fout?.message ?? fout ?? ''));
  return m ? { entities: Number(m[1]), limit: Number(m[2]) } : null;
}

/**
 * Fout uit de export naar een sleutel (onder `cadExport.`) met waarden, zodat
 * het venster hem in de taal van de gebruiker kan tonen. De crate geeft vaste
 * codes voor de terugweg naar CAD: `NO_MODEL_SPACE` (de pagina draagt geen
 * modelcoördinaten), `MODEL_SPACE_AMBIGUOUS:<n>` (meer viewports met eigen
 * modelcoördinaten, en uit het exportgebied volgt niet welke bedoeld is) en
 * `MODEL_UNITS_UNKNOWN:<eenheid>` (de pagina noemt een onbekende eenheid).
 * @returns {{sleutel:string, n?:number, unit?:string, error?:string}}
 */
export function leesExportFout(fout) {
  const tekst = String(fout?.message ?? fout ?? '');
  const meerdere = /MODEL_SPACE_AMBIGUOUS:(\d+)/.exec(tekst);
  if (meerdere) return { sleutel: 'modelSpaceAmbiguous', n: Number(meerdere[1]) };
  // De pagina noemt een eenheid die de export niet kent (de naam, of niets
  // als er geen tekst stond): stil millimeter aannemen zou de maat bederven.
  const eenheid = /MODEL_UNITS_UNKNOWN:(.*)$/.exec(tekst);
  if (eenheid) return { sleutel: 'modelUnitsUnknown', unit: eenheid[1].trim() || '?' };
  if (tekst.includes('NO_MODEL_SPACE')) return { sleutel: 'noModelSpace' };
  return { sleutel: 'failed', error: tekst };
}

/**
 * Tellingen van meerdere pagina's samenvoegen tot één lagenlijst (op naam,
 * niet hoofdlettergevoelig), in volgorde van eerste voorkomen.
 * @param {Array<{layers: Array<{name:string, color:{r:number,g:number,b:number}, entities:number, from_ocg:boolean, from_annotation:boolean}>}>} scans
 */
export function voegTellingenSamen(scans) {
  const perNaam = new Map();
  for (const scan of scans || []) {
    for (const laag of scan?.layers || []) {
      const sleutel = laag.name.toUpperCase();
      const bestaand = perNaam.get(sleutel);
      if (bestaand) bestaand.entities += laag.entities;
      else perNaam.set(sleutel, { ...laag, color: { ...laag.color } });
    }
  }
  return [...perNaam.values()];
}

/** Aantal objecten dat overblijft na het uitsluiten van lagen. */
export function objectenNaUitsluiten(lagen, uitgesloten) {
  const uit = new Set([...(uitgesloten || [])].map((n) => n.toUpperCase()));
  return (lagen || []).reduce((som, l) => som + (uit.has(l.name.toUpperCase()) ? 0 : l.entities), 0);
}

/** Bytes leesbaar: 1,2 MB. */
export function grootteTekst(bytes, decimaal = ',') {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} kB`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', decimaal)} MB`;
}
