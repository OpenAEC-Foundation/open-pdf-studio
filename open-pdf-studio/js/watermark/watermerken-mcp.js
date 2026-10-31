// MCP-opdracht app_watermarks: de watermerken en kop-/voetteksten van het
// actieve document opvragen, toevoegen en verwijderen.
//
// Een watermerk krijgt dezelfde velden en standaardwaarden als in de dialogen
// Watermerk en Kop-/voettekst, en gaat door dezelfde functies
// (watermerk-bewerken.js): één ongedaan-maakstap, het document gewijzigd, het
// scherm opnieuw getekend; de saver schrijft het bij opslaan in de pagina's.
//
// `o` is de app; de tests geven een eigen omgeving.

import { voegWatermerkToe, verwijderWatermerk, nieuwWatermerkId } from './watermerk-bewerken.js';
import { batesInstellingen } from './kopvoet-tekst.js';
import { WATERMARK_FONT_MIN, WATERMARK_FONT_MAX } from './watermark-layout.js';
import {
  fout, onbekendArgument, bewerkbaarDocument, paginaLijst, geheelGetal, getal, padFout, hexKleur,
} from '../core/mcp-document-regels.js';

export const WATERMERK_ACTIES = ['list', 'add', 'remove'];
export const WATERMERK_SOORTEN = { text: 'textWatermark', image: 'imageWatermark', headerFooter: 'headerFooter' };
export const WATERMERK_LETTERS = ['Helvetica', 'Arial', 'Times New Roman', 'Courier', 'Georgia'];
export const KOPVOET_LETTERS = ['Helvetica', 'Arial', 'Times New Roman', 'Courier'];
export const WATERMERK_POSITIES = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'custom'];
export const WATERMERK_LAGEN = ['behind', 'infront'];
export const KOPVOET_VAKKEN = ['headerLeft', 'headerCenter', 'headerRight', 'footerLeft', 'footerCenter', 'footerRight'];
export const MAX_TEKST = 500;
export const MAX_AFBEELDING_BYTES = 20 * 1024 * 1024;

const GEMEEN = ['action', 'type', 'pages'];
const VELDEN = {
  text: [...GEMEEN, 'text', 'fontFamily', 'fontSize', 'color', 'opacity', 'rotation', 'position', 'customX', 'customY', 'layer'],
  image: [...GEMEEN, 'imagePath', 'opacity', 'scale', 'rotation', 'position', 'customX', 'customY', 'layer'],
  headerFooter: [...GEMEEN, ...KOPVOET_VAKKEN, 'fontFamily', 'fontSize', 'color', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
    'batesPrefix', 'batesStart', 'batesDigits', 'batesSuffix'],
};

async function appOmgeving() {
  const [st, beveiliging, platform] = await Promise.all([
    import('../core/state.js'),
    import('../pdf/wachtwoord-pdf.js'),
    import('../core/platform.js'),
  ]);
  return {
    document: st.getActiveDocument,
    alleenLezen: beveiliging.isAlleenLezen,
    leesBestand: async (pad) => {
      // Een pad dat de client noemt valt buiten de fs-scope van de app.
      try { await window.__TAURI__?.core?.invoke?.('allow_fs_scope', { path: pad }); } catch { /* best-effort */ }
      return new Uint8Array(await platform.readBinaryFile(pad));
    },
    // `bewerken` undefined: watermerk-bewerken.js gebruikt dan de app zelf.
    bewerken: undefined,
  };
}

/** Een watermerk zoals de client het ziet: zonder de afbeelding zelf. */
export function beschrijfWatermerk(wm) {
  const uit = {};
  for (const [sleutel, waarde] of Object.entries(wm || {})) {
    if (sleutel === 'imageData') continue;
    uit[sleutel] = waarde;
  }
  const soort = Object.entries(WATERMERK_SOORTEN).find(([, intern]) => intern === wm?.type)?.[0] ?? wm?.type;
  uit.type = soort;
  if (wm?.type === 'imageWatermark') uit.hasImage = typeof wm.imageData === 'string' && wm.imageData.length > 0;
  return uit;
}

function keuze(waarde, naam, opties, standaard) {
  if (waarde === undefined) return { waarde: standaard };
  if (!opties.includes(waarde)) return { error: `${naam} must be one of: ${opties.join(', ')}` };
  return { waarde };
}

function tekstVeld(waarde, naam, standaard = '') {
  if (waarde === undefined) return { waarde: standaard };
  if (typeof waarde !== 'string') return { error: `${naam} must be a string` };
  if (waarde.length > MAX_TEKST) return { error: `${naam} is longer than ${MAX_TEKST} characters` };
  if (/[\u0000-\u001f\u007f]/.test(waarde)) return { error: `${naam} contains control characters or line breaks` };
  return { waarde };
}

function kleurVeld(waarde, standaard) {
  if (waarde === undefined) return { waarde: standaard };
  const k = hexKleur(waarde);
  return k ? { waarde: k } : { error: 'color must be #rrggbb' };
}

/** Controleert een rij velden; de eerste fout wint. */
function velden(regels) {
  const uit = {};
  for (const [naam, r] of Object.entries(regels)) {
    if (r.error) return { error: r.error };
    uit[naam] = r.waarde;
  }
  return { waarde: uit };
}

/** De pagina's waarop het staat: alle, of een lijst (customPages zoals de dialoog die schrijft). */
function paginaBereik(pages, totaal) {
  if (pages === undefined) return { waarde: { pageRange: 'all', customPages: '' } };
  const lijst = paginaLijst(pages, totaal);
  if (lijst.error) return { error: lijst.error };
  return { waarde: { pageRange: 'custom', customPages: [...lijst.pages].sort((a, b) => a - b).join(',') } };
}

function positieVelden(p) {
  return {
    position: keuze(p.position, 'position', WATERMERK_POSITIES, 'center'),
    customX: getal(p.customX, 'customX', 0, 14400, 0),
    customY: getal(p.customY, 'customY', 0, 14400, 0),
    layer: keuze(p.layer, 'layer', WATERMERK_LAGEN, 'behind'),
  };
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

function isPng(b) { return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }
function isJpeg(b) { return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; }

function base64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function afbeeldingData(pad, o) {
  const padfout = padFout(pad, 'imagePath', Object.keys(MIME));
  if (padfout) return { error: padfout };
  let bytes;
  try {
    bytes = await o.leesBestand(pad);
  } catch (e) {
    return { error: `could not read imagePath: ${e?.message ?? e}` };
  }
  if (!bytes?.length) return { error: 'imagePath is empty' };
  if (bytes.length > MAX_AFBEELDING_BYTES) return { error: `imagePath is larger than ${MAX_AFBEELDING_BYTES / 1024 / 1024} MB` };
  const ext = pad.match(/\.([a-z]+)$/i)[1].toLowerCase();
  const mime = MIME[ext];
  if (mime === 'image/png' ? !isPng(bytes) : !isJpeg(bytes)) return { error: `imagePath is not a ${ext.toUpperCase()} image` };
  return { waarde: `data:${mime};base64,${base64(bytes)}` };
}

/** Het watermerk dat de dialoog zou maken, uit de argumenten van de client. */
async function bouwWatermerk(p, totaal, o) {
  const bereik = paginaBereik(p.pages, totaal);
  if (bereik.error) return bereik;
  const basis = { id: nieuwWatermerkId(), type: WATERMERK_SOORTEN[p.type] };

  if (p.type === 'text') {
    if (typeof p.text !== 'string' || !p.text.trim()) return { error: 'text must be a non-empty string' };
    const v = velden({
      text: tekstVeld(p.text, 'text'),
      fontFamily: keuze(p.fontFamily, 'fontFamily', WATERMERK_LETTERS, 'Helvetica'),
      // Dezelfde grenzen als het lettergrootteveld van de dialoog.
      fontSize: geheelGetal(p.fontSize, 'fontSize', WATERMARK_FONT_MIN, WATERMARK_FONT_MAX, 72),
      color: kleurVeld(p.color, '#ff0000'),
      opacity: getal(p.opacity, 'opacity', 0, 1, 0.3),
      rotation: getal(p.rotation, 'rotation', -360, 360, -45),
      ...positieVelden(p),
    });
    if (v.error) return v;
    return { waarde: { ...basis, ...v.waarde, ...bereik.waarde, enabled: true } };
  }

  if (p.type === 'image') {
    const v = velden({
      opacity: getal(p.opacity, 'opacity', 0, 1, 0.2),
      scale: getal(p.scale, 'scale', 0.01, 10, 1),
      rotation: getal(p.rotation, 'rotation', -360, 360, 0),
      ...positieVelden(p),
    });
    if (v.error) return v;
    const data = await afbeeldingData(p.imagePath, o);
    if (data.error) return data;
    return { waarde: { ...basis, imageData: data.waarde, width: 200, height: 200, ...v.waarde, ...bereik.waarde, enabled: true } };
  }

  // headerFooter
  const vakken = {};
  for (const vak of KOPVOET_VAKKEN) vakken[vak] = tekstVeld(p[vak], vak);
  const v = velden({
    ...vakken,
    fontFamily: keuze(p.fontFamily, 'fontFamily', KOPVOET_LETTERS, 'Helvetica'),
    fontSize: geheelGetal(p.fontSize, 'fontSize', 1, 200, 10),
    color: kleurVeld(p.color, '#000000'),
    marginTop: getal(p.marginTop, 'marginTop', 0, 1000, 30),
    marginBottom: getal(p.marginBottom, 'marginBottom', 0, 1000, 30),
    marginLeft: getal(p.marginLeft, 'marginLeft', 0, 1000, 40),
    marginRight: getal(p.marginRight, 'marginRight', 0, 1000, 40),
    batesPrefix: tekstVeld(p.batesPrefix, 'batesPrefix'),
    batesStart: geheelGetal(p.batesStart, 'batesStart', 0, 999999999999, 1),
    batesDigits: geheelGetal(p.batesDigits, 'batesDigits', 1, 12, 6),
    batesSuffix: tekstVeld(p.batesSuffix, 'batesSuffix'),
  });
  if (v.error) return v;
  if (!KOPVOET_VAKKEN.some((vak) => v.waarde[vak].trim())) {
    return { error: `give at least one of ${KOPVOET_VAKKEN.join(', ')} (variables: {page} {pages} {date} {time} {filename} {title} {bates})` };
  }
  return {
    waarde: {
      ...basis,
      ...v.waarde,
      ...batesInstellingen(v.waarde),
      ...bereik.waarde,
      enabled: true,
      // Nog niet zo in het bestand: het scherm tekent hem (kopvoet-weergave.js).
      uitBestand: false,
    },
  };
}

export async function watermarks(params, o) {
  const p = params || {};
  if (!WATERMERK_ACTIES.includes(p.action)) return fout(`action must be one of: ${WATERMERK_ACTIES.join(', ')}`);
  o = o || await appOmgeving();

  if (p.action === 'list') {
    const onbekend = onbekendArgument(p, ['action']);
    if (onbekend) return fout(onbekend);
    const { doc, fout: f } = bewerkbaarDocument(o, { lezen: true });
    if (f) return f;
    const lijst = (doc.watermarks || []).map(beschrijfWatermerk);
    return { ok: true, count: lijst.length, watermarks: lijst };
  }

  if (p.action === 'remove') {
    const onbekend = onbekendArgument(p, ['action', 'id']);
    if (onbekend) return fout(onbekend);
    const { doc, fout: f } = bewerkbaarDocument(o);
    if (f) return f;
    if (typeof p.id !== 'string' || !(doc.watermarks || []).some((w) => w.id === p.id)) return fout(`unknown watermark id: ${p.id}`);
    const weg = await verwijderWatermerk(doc, p.id, o.bewerken);
    if (!weg) return fout('the watermark was not removed (the active document changed)');
    return { ok: true, removed: beschrijfWatermerk(weg), remaining: (doc.watermarks || []).length };
  }

  // add
  if (!Object.hasOwn(WATERMERK_SOORTEN, p.type)) return fout(`type must be one of: ${Object.keys(WATERMERK_SOORTEN).join(', ')}`);
  const onbekend = onbekendArgument(p, VELDEN[p.type]);
  if (onbekend) return fout(`${onbekend} (not used by type ${p.type})`);
  const { doc, fout: f } = bewerkbaarDocument(o);
  if (f) return f;
  const wm = await bouwWatermerk(p, doc.pdfDoc.numPages, o);
  if (wm.error) return fout(wm.error);
  if (o.document() !== doc) return fout('the active document changed while the image was read');
  const toegevoegd = await voegWatermerkToe(doc, wm.waarde, o.bewerken);
  return { ok: true, watermark: beschrijfWatermerk(toegevoegd), count: doc.watermarks.length };
}
